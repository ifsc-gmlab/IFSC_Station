// telemetry.js — 数据源 (QGC 风格实现):
//   serial:    Web Serial API 直连飞控 (Chrome/Edge, 需 localhost 或 https)
//   ws:        WebSocket 桥 (任意浏览器, 通过 mavproxy 转发 MAVLink 字节流)
//
// 参考 QGC (qgroundcontrol/src/comm/, qgroundcontrol/src/Vehicle/Vehicle.cc):
//   - SerialLink  使用 QSerialPort::open(QIODevice::ReadWrite) + readyRead 信号
//   - MAVLinkProtocol 逐字节 mavlink_parse_char (本项目用 MAVLinkParser 流式解析)
//   - Vehicle::_setMessageInterval 主动发 MAV_CMD_SET_MESSAGE_INTERVAL 请求消息流
//   - GCS HEARTBEAT 1Hz 让飞控把 GCS 加入数据流目标

import { MAVLinkParser, encodeFrame, MSG, FTP_OP, FTP_ERR, encodeFTPPayload, decodeFTPPayload, paramValueToNumber, numberToParamUnion, MAV_PARAM_TYPE } from './mavlink.js';
import { perf } from './perf.js';

const SUBS = new Set();
const MSG_SUBS = new Set();   // 消息级订阅 (校准等模块用): fn(msg) 每条解析成功的消息都会回调
let state = null;
let source = 'none';
let conn = null;            // 当前连接对象 (serial port / ws)
let parser = null;          // MAVLinkParser
let gcsSysId = 255;         // QGC 也用 255
let gcsCompId = 190;        // MAV_COMP_ID_MISSIONPLANNER
let seq = 0;
let ftpSeq = 0;             // 独立的 FTP seq_number 计数器 (uint16, 用于匹配响应)
let ftp = null;             // { session, callback }
let hbTimer = null;
let streamConfigTimer = null;
let streamConfigState = null;  // 消息流协商状态机
let serialReader = null;
let readLoopAlive = false;          // 读取循环是否正在运行
let readLoopRestarts = 0;           // 读取循环重启次数 (30s 窗口内)
let readLoopRestartWindowStart = 0; // 重启计数窗口起点
let lastMsgName = '';               // 最后处理的消息名 (诊断用)
let watchdogTimer = null;           // 链路看门狗
let disconnecting = false;          // 是否正在主动断开 (防止误触发自动恢复)

function emit() { perf.raw++; for (const fn of SUBS) fn(state); }

function makeBlankState() {
  return {
    connected: false,
    source,
    armed: false,
    mode: '—',
    attitude: { roll: 0, pitch: 0, yaw: 0 },
    position: { lat: 0, lon: 0, alt: 0, relative_alt: 0 },
    velocity: { vx: 0, vy: 0, vz: 0, groundspeed: 0, airspeed: 0, climb: 0, heading: 0, throttle: 0 },
    gps: { fix_type: 0, sats: 0, hdop: 99, eph: 999 },
    battery: { voltage: 0, current: 0, remaining: 0 },
    rc: { rssi: 0, connected: false },
    link: { type: '—', quality: 0, tx_rate: 0, rx_rate: 0 },
    health: {},
    messages: [],
    home: { lat: 0, lon: 0 },
    path: [],
    trail: [],
    timestamp: Date.now(),
    targetSysId: 1,
    targetCompId: 1,
    // QGC 内部状态标志
    _homeSet: false,           // HOME_POSITION 消息是否已收到 (QGC: homePositionChanged 已触发)
    _gpsPosAvailable: false,   // 是否收到有效 GLOBAL_POSITION_INT (QGC: _globalPositionIntMessageAvailable)
    _altAvailable: false,      // 是否收到高度数据 (QGC: _altitudeMessageAvailable)
    _altTerrain: 0,
    _altLocal: 0,
    // ---- 参数缓存 (QGC ParameterManager 简化版) ----
    // byIndex: { 'sys-comp': { idx: {name, value, type, index} } }
    // byName:  { 'sys-comp': { name: {value, type, index} } }
    // waitingRead:  { 'sys-comp': { idx: retryCount } }   重试计数
    // waitingWrite: { 'sys-comp': { name: {retry, value, type} } }  写入中 (含待写入的 typed 值)
    // modified:     { 'sys-comp': { name: true } }  本会话内用户写入过的参数 (近似 QGC "modified=value!=default")
    // count: 总数
    // ready: 初始加载完成
    // loading: 正在拉取
    params: {
      byIndex: {},
      byName: {},
      count: 0,
      waitingRead: {},
      waitingWrite: {},
      modified: {},
      ready: false,
      loading: false,
      lastError: null,
      rev: 0,   // 参数数据版本号 — 每次参数缓存变化 +1, UI 用它在消息风暴中跳过无关重绘
    },
  };
}

// ---------------- HEARTBEAT 处理 ----------------
let hbLossT = null;
const msgStats = {};      // 每种消息计数
let lastMsgT = 0;         // 上一条消息时间戳 (ms)
function handleMessage(msg) {
  if (!state) return;
  msgStats[msg._name] = (msgStats[msg._name] || 0) + 1;
  lastMsgT = Date.now();
  if (msg._name === 'HEARTBEAT') {
    // 来自飞控的 HEARTBEAT
    state.targetSysId = msg._sysid;
    state.targetCompId = msg._compid;
    state.armed = !!(msg.base_mode & 0x80);  // MAV_MODE_FLAG_SAFETY_ARMED
    state.mode = decodeMode(msg.custom_mode, msg.type);
    state.link.type = (source === 'serial') ? 'Serial' : (source === 'ws' ? 'UDP/WS' : '—');
    state.connected = true;
    scheduleHeartbeatLoss(msg);
    pushMessage(6, `Vehicle HB: sys=${msg._sysid} comp=${msg._compid} type=${msg.type} mode=${state.mode} armed=${state.armed}`);
    // 关键: QGC 流程 — 收到飞控 HEARTBEAT 后, 主动请求消息流 (PX4 不主动推 ATTITUDE/GPS 等)
    if (!streamConfigState || streamConfigState.targetSysId !== msg._sysid) {
      startStreamConfig(msg._sysid, msg._compid);
    }
    // 同时触发参数拉取 (类似 QGC 打开 SetupView)
    autoRequestParamsOnHB();
  } else if (msg._name === 'COMMAND_ACK') {
    if (msg.command === 511 /* MAV_CMD_SET_MESSAGE_INTERVAL */) {
      // 推进一步 stream config 状态机
      if (streamConfigTimer) { clearTimeout(streamConfigTimer); streamConfigTimer = null; }
      advanceStreamConfig();
    }
  } else if (msg._name === 'ATTITUDE') {
    if (!state.health.attitude) {
      pushMessage(6, '收到 ATTITUDE — 姿态数据已激活');
      state.health.attitude = true;
    }
    state.attitude = { roll: msg.roll, pitch: msg.pitch, yaw: msg.yaw };
  } else if (msg._name === 'GLOBAL_POSITION_INT') {
    // QGC Vehicle::_handleGlobalPositionInt: 过滤 ArduPilot 无 GPS 时发 (0,0) 的无效坐标
    if (msg.lat === 0 && msg.lon === 0) {
      // ArduPilot 在无 GPS 时仍发送 GLOBAL_POSITION_INT 携带高度信息, 坐标 0/0 无效
      if (!state._altAvailable) {
        // 第一次收到 (0,0) 时提示
        pushMessage(5, 'GPS 未锁定 (收到 0,0 坐标), 等待 GPS fix...');
        state._altAvailable = true;
      }
      // 仍然更新高度 (如 ArduPilot 在无 GPS 时发的相关高度)
      state.position.alt = msg.alt / 1000;
      state.position.relative_alt = msg.relative_alt / 1000;
      emit();
      return;
    }
    state._gpsPosAvailable = true;  // QGC _globalPositionIntMessageAvailable
    state.position = {
      lat: msg.lat / 1e7,
      lon: msg.lon / 1e7,
      alt: msg.alt / 1000,
      relative_alt: msg.relative_alt / 1000,
    };
    state.velocity = {
      vx: msg.vx / 100, vy: msg.vy / 100, vz: msg.vz / 100,
      groundspeed: Math.hypot(msg.vx, msg.vy) / 100,
      // airspeed 由 VFR_HUD 提供 (真实空速); 未收到 VFR_HUD 前用地速兜底 (QGC: 无空速计时显示地速)
      airspeed: (state.velocity.airspeed > 0 ? state.velocity.airspeed : Math.hypot(msg.vx, msg.vy) / 100),
    };
    // QGC: 仅当 HOME_POSITION 消息未收到时, 用首次 GPS 坐标作为 home (fallback)
    if (!state._homeSet && state.path.length === 0) {
      state.home = { lat: state.position.lat, lon: state.position.lon };
      pushMessage(6, `Home (fallback from first GPS): ${state.home.lat.toFixed(6)}, ${state.home.lon.toFixed(6)}`);
    }
    state.path.push({ lat: state.position.lat, lon: state.position.lon, alt: state.position.alt, yaw: state.attitude.yaw });
    if (state.path.length > 800) state.path.shift();
    state.trail.push({ t: Date.now(), alt: state.position.alt, spd: state.velocity.groundspeed });
    if (state.trail.length > 800) state.trail.shift();
  } else if (msg._name === 'VFR_HUD') {
    // QGC Vehicle::_handleVfrHud (msgid=74): 空速/地速/爬升率/油门/航向
    const v = state.velocity;
    if (typeof msg.airspeed === 'number' && isFinite(msg.airspeed)) v.airspeed = msg.airspeed;
    if (typeof msg.groundspeed === 'number' && isFinite(msg.groundspeed)) v.groundspeed = msg.groundspeed;
    if (typeof msg.climb === 'number' && isFinite(msg.climb)) v.climb = msg.climb;
    v.heading = msg.heading || 0;
    v.throttle = msg.throttle || 0;
  } else if (msg._name === 'HOME_POSITION') {
    // QGC Vehicle::_handleHomePosition: 飞控明确上报的 HOME 点
    const home = {
      lat: msg.latitude / 1e7,
      lon: msg.longitude / 1e7,
      alt: msg.altitude / 1000,
    };
    if (home.lat !== state.home.lat || home.lon !== state.home.lon) {
      state.home = home;
      state._homeSet = true;
      pushMessage(6, `Home (飞控 HOME_POSITION): ${home.lat.toFixed(6)}, ${home.lon.toFixed(6)} alt=${home.alt.toFixed(1)}m`);
    }
  } else if (msg._name === 'ALTITUDE') {
    // QGC Vehicle::_handleAltitude: 独立高度消息 (GLOBAL_POSITION_INT 之外的后备高度源)
    if (!state._altAvailable) {
      state._altAvailable = true;
      pushMessage(6, '收到 ALTITUDE 消息 — 高度数据已激活');
    }
    state.position.alt = msg.altitude_amsl;
    state.position.relative_alt = msg.altitude_relative;
    // 填充 terrain / local 高度供后续使用
    state._altTerrain = msg.altitude_terrain;
    state._altLocal = msg.altitude_local;
  } else if (msg._name === 'GPS_RAW_INT') {
    state.gps = {
      fix_type: msg.fix_type,
      sats: msg.satellites_visible,
      hdop: msg.eph / 100,
      eph: msg.eph,
    };
    state.health.gps = msg.fix_type >= 3;
  } else if (msg._name === 'SYS_STATUS') {
    state.battery = {
      voltage: msg.voltage_battery / 1000,
      current: msg.current_battery / 100,
      remaining: msg.battery_remaining === -1 ? 0 : msg.battery_remaining,
    };
  } else if (msg._name === 'RADIO_STATUS' || msg._name === 'RC_CHANNELS_RAW') {
    state.rc = { rssi: msg.rssi, connected: msg.rssi > 0 };
    if (msg._name === 'RC_CHANNELS_RAW') {
      // RC 校准需要看每个通道的原始 PWM 值 (QGC RadioComponentController _handleRCChannels)
      state.rc.channels = [
        msg.chan1_raw, msg.chan2_raw, msg.chan3_raw, msg.chan4_raw,
        msg.chan5_raw, msg.chan6_raw, msg.chan7_raw, msg.chan8_raw,
      ];
      state.rc.timestamp = msg.time_boot_ms;
    }
  } else if (msg._name === 'STATUSTEXT') {
    pushMessage(msg.severity, msg.text);
  } else if (msg._name === 'PARAM_VALUE') {
    handleParamValue(msg);
  }
  // FILE_TRANSFER_PROTOCOL 由 ftpOp 自己的 onMessage 钩子处理, 不在这里重复处理
  // 消息级订阅 (校准模块等): 任何异常都不能中断主流程
  for (const fn of MSG_SUBS) {
    try { fn(msg); } catch (err) { console.error('[Telemetry] 消息订阅回调异常:', err); }
  }
  state.timestamp = Date.now();
  state.msgStats = msgStats;
  state.lastMsgT = lastMsgT;
  state.msgRate = computeRate();
  emit();
}

let _rateSamples = [];
function computeRate() {
  const now = Date.now();
  _rateSamples.push(now);
  while (_rateSamples.length > 0 && now - _rateSamples[0] > 1000) _rateSamples.shift();
  return _rateSamples.length;
}

// PX4 custom_mode -> 飞行模式名 (PX4 main_mode bits)
function decodeMode(custom, type) {
  // PX4: custom_mode 高 8 位 = main_mode
  // 1=MANUAL, 2=ALTCTL, 3=POSCTL, 4=AUTO, 5=ACRO, 6=OFFBOARD, 7=STABILIZED, 8=RATTITUDE, 9=SIMPLE
  // 16=TAKEOFF, 17=LAND, 18=RTL, 19=HOLD
  const main = (custom >> 16) & 0xFF;
  const modes = {
    1: 'Manual', 2: 'Altitude', 3: 'Position', 4: 'Mission',
    5: 'Acro', 6: 'Offboard', 7: 'Stabilized', 8: 'Rattitude',
    9: 'Simple',
    16: 'Takeoff', 17: 'Land', 18: 'RTL', 19: 'Hold',
    20: 'Follow Me', 21: 'Precision Land',
  };
  return modes[main] || 'Mode ' + main;
}

function pushMessage(severity, text) {
  if (!state) return;
  state.messages.push({ ts: Date.now(), severity, text });
  if (state.messages.length > 200) state.messages.shift();
  try { window.__qgc_messages = state.messages; } catch (e) {}
}

function scheduleHeartbeatLoss(msg) {
  if (hbLossT) clearTimeout(hbLossT);
  // 3 秒无 HEARTBEAT 视为失联
  hbLossT = setTimeout(() => {
    if (state) {
      state.link.quality = 0;
      // 不立即断连, 但显示链路不佳
    }
  }, 3500);
}

// ============================================================================
// MAVLink 参数协议 (参考 QGC ParameterManager.cc / ParameterManager.h)
//
// 实现:
//   - refreshAllParams()        触发 PARAM_REQUEST_LIST
//   - setParam(name, value)     发 PARAM_SET
//   - handleParamValue()        处理飞控回传的 PARAM_VALUE
//   - _scheduleParamRetry()     3s 后重试未收到的索引
//   - state.params              缓存, UI 直接订阅
// ============================================================================
const _paramRetryTimers = new Map();        // sysKey -> timer
const _paramMaxRetries = 5;                 // 每个参数最多重试 5 次 (QGC 同样)
const _paramInitialListRetries = 4;         // 整个列表最多重发 4 次
let   _paramListRetryCount = 0;             // 已重发 list 的次数

function _paramKey(sysId, compId) { return sysId + '-' + compId; }

function _sendParamRequestList(sysId, compId) {
  if (!conn || !state) return;
  const frame = encodeFrame(MSG.PARAM_REQUEST_LIST, gcsSysId, gcsCompId, seq++, {
    target_system: sysId,
    target_component: compId,
  });
  sendRaw(frame);
  pushMessage(6, `[PARAM] 发送 PARAM_REQUEST_LIST sys=${sysId} comp=${compId}`);
}

function _sendParamRequestRead(sysId, compId, paramId, paramIndex) {
  if (!conn || !state) return;
  const frame = encodeFrame(MSG.PARAM_REQUEST_READ, gcsSysId, gcsCompId, seq++, {
    param_id: paramId || '',
    param_index: paramIndex < 0 ? 65535 : paramIndex,  // 0xFFFF = "by name"
    target_system: sysId,
    target_component: compId,
  });
  sendRaw(frame);
}

function _sendParamSet(sysId, compId, name, value, type) {
  if (!conn || !state) return;
  const mavType = type || MAV_PARAM_TYPE.REAL32;
  const frame = encodeFrame(MSG.PARAM_SET, gcsSysId, gcsCompId, seq++, {
    param_id: name,
    // 关键: param_value 必须按 param_type 做 union 位转换, 否则整型参数被 PX4 拒收
    // 参考 QGC _sendParamSetToVehicle (mavlink_param_union_t + p.param_value = union_value.param_float)
    param_value: numberToParamUnion(value, mavType),
    target_system: sysId,
    target_component: compId,
    param_type: mavType,
  });
  sendRaw(frame);
}

// 有类型参数值的显示格式 (QGC Fact::_variantToString)
function formatParamValue(v, type) {
  if (v == null || isNaN(v)) return '—';
  const isInt = (type === MAV_PARAM_TYPE.INT8 || type === MAV_PARAM_TYPE.UINT8 ||
                 type === MAV_PARAM_TYPE.INT16 || type === MAV_PARAM_TYPE.UINT16 ||
                 type === MAV_PARAM_TYPE.INT32 || type === MAV_PARAM_TYPE.UINT32 ||
                 type === MAV_PARAM_TYPE.INT64 || type === MAV_PARAM_TYPE.UINT64);
  if (isInt) return String(v);
  // REAL32/REAL64: 最多 6 位小数, 去掉末尾 0
  return String(v.toFixed(6).replace(/\.?0+$/, ''));
}

function handleParamValue(msg) {
  if (!state) return;
  const sysId = msg._sysid;
  const compId = msg._compid;
  const key = _paramKey(sysId, compId);
  const p = state.params;
  // 初始化分片
  if (!p.byIndex[key]) p.byIndex[key] = {};
  if (!p.byName[key]) p.byName[key] = {};
  if (!p.waitingRead[key]) p.waitingRead[key] = {};
  if (!p.waitingWrite[key]) p.waitingWrite[key] = {};
  if (!p.modified[key]) p.modified[key] = {};

  const name = msg.param_id || '';
  const index = msg.param_index;
  const total = msg.param_count;
  const type = msg.param_type;
  // 关键: param_value 是 4 字节 union (mavlink_param_union_t), 必须按 param_type 位转换
  // 参考 QGC ParameterManager::mavlinkMessageReceived (paramUnion.param_float -> typed member)
  const value = paramValueToNumber(msg.param_value, type);

  if (index !== 65535) {
    // 列表加载/按索引读取: 写入缓存
    p.byIndex[key][index] = { name, value, type, index };
    p.byName[key][name] = { value, type, index };
    delete p.waitingRead[key][index];
  } else if (p.byName[key][name]) {
    // 飞控主动广播 / 写后确认 (param_index=0xFFFF): QGC 始终更新 fact 值
    p.byName[key][name].value = value;
    const oldIdx = p.byName[key][name].index;
    if (oldIdx != null && p.byIndex[key][oldIdx]) p.byIndex[key][oldIdx].value = value;
  }
  // 写后回包: 飞控广播 PARAM_VALUE 确认, 从 waitingWrite 移除 (QGC _waitingWriteParamNameMap.remove)
  if (name && p.waitingWrite[key][name] != null) {
    delete p.waitingWrite[key][name];
    if (_isWriteQueueEmpty(p)) _stopWriteTimeout();
    pushMessage(6, `[PARAM] 写确认: ${name} = ${formatParamValue(value, type)}`);
  }
  // 设定总参数数 (第一个响应携带, 或用已收到的最大索引+1)
  if (total && total > 0) {
    p.count = Math.max(p.count, total);
  } else if (index !== 65535) {
    p.count = Math.max(p.count, index + 1);
  }
  // 仅在索引加载阶段更新 loading/ready 状态 (写确认广播不应把 UI 打回"加载中")
  if (index !== 65535) {
    p.loading = true;
    p.ready = false;
    _checkParamsReady();
  }
  p.rev++;
}

function _isWriteQueueEmpty(p) {
  return Object.keys(p.waitingWrite).every(k => Object.keys(p.waitingWrite[k]).length === 0);
}

function _checkParamsReady() {
  if (!state) return;
  const p = state.params;
  let allReceived = true;
  let hasAny = false;
  for (const key of Object.keys(p.byIndex)) {
    hasAny = true;
    const idxs = p.byIndex[key];
    const wait = p.waitingRead[key] || {};
    if (Object.keys(wait).length > 0) allReceived = false;
    if (p.count > 0 && Object.keys(idxs).length < p.count) allReceived = false;
  }
  if (hasAny && p.count > 0 && allReceived) {
    p.ready = true;
    p.loading = false;
    pushMessage(6, `[PARAM] 加载完成: ${p.count} 个参数`);
    // 清除重试 timer
    for (const t of _paramRetryTimers.values()) clearTimeout(t);
    _paramRetryTimers.clear();
  }
}

function _scheduleParamRetry(sysId, compId) {
  const key = _paramKey(sysId, compId);
  if (_paramRetryTimers.has(key)) clearTimeout(_paramRetryTimers.get(key));
  const t = setTimeout(() => {
    if (!state) return;
    const p = state.params;
    const wait = p.waitingRead[key] || {};
    const idxs = Object.keys(wait).map(k => parseInt(k));
    if (idxs.length === 0) return;
    if (_paramListRetryCount < _paramInitialListRetries) {
      // 整个 list 重发
      _paramListRetryCount++;
      pushMessage(5, `[PARAM] 重发 PARAM_REQUEST_LIST (${_paramListRetryCount}/${_paramInitialListRetries})`);
      _sendParamRequestList(sysId, compId);
      _scheduleParamRetry(sysId, compId);
    } else {
      // 按索引单个重试, 跳过超过上限的
      const todo = [];
      for (const idx of idxs) {
        if (wait[idx] >= _paramMaxRetries) continue;
        wait[idx] = (wait[idx] || 0) + 1;
        todo.push(idx);
        if (todo.length >= 10) break;  // 批次大小 10 (QGC 同样)
      }
      if (todo.length) {
        pushMessage(5, `[PARAM] 重试 ${todo.length} 个缺失参数`);
        for (const idx of todo) {
          const rec = p.byIndex[key] && p.byIndex[key][idx];
          _sendParamRequestRead(sysId, compId, rec ? rec.name : '', idx);
        }
        _scheduleParamRetry(sysId, compId);
      } else {
        p.lastError = `缺失 ${idxs.length} 个参数 (重试 ${_paramMaxRetries} 次后放弃)`;
        pushMessage(3, `[PARAM] ${p.lastError}`);
      }
    }
  }, 3000);
  _paramRetryTimers.set(key, t);
}

// ---------------- 参数写入超时/重试 (QGC ParameterManager::_waitingParamTimeout) ----------------
// QGC 每写一个参数就把名字加入 _waitingWriteParamNameMap 并启动 3s 定时器;
// 超时后对仍在等待的参数重发 PARAM_SET, 最多 _maxReadWriteRetry(3) 次, 之后报错
// "Parameter write failed: veh:%1 comp:%2 param:%3" 并从等待列表移除。
let _writeTimeoutTimer = null;
const _maxReadWriteRetry = 3;

function _stopWriteTimeout() {
  if (_writeTimeoutTimer) { clearTimeout(_writeTimeoutTimer); _writeTimeoutTimer = null; }
}

function _scheduleWriteTimeout() {
  _stopWriteTimeout();
  _writeTimeoutTimer = setTimeout(() => { _writeTimeoutTimer = null; _waitingWriteTimeout(); }, 3000);
}

function _waitingWriteTimeout() {
  if (!state) return;
  const p = state.params;
  let paramsRequested = false;
  for (const key of Object.keys(p.waitingWrite)) {
    const [sysId, compId] = key.split('-').map(Number);
    for (const name of Object.keys(p.waitingWrite[key])) {
      const entry = p.waitingWrite[key][name];
      entry.retry = (entry.retry || 0) + 1;
      if (entry.retry <= _maxReadWriteRetry) {
        // 重发上次要写入的 typed 值 (QGC: fact->rawValue())
        _sendParamSet(sysId, compId, name, entry.value, entry.type);
        paramsRequested = true;
        pushMessage(6, `[PARAM] 写重发 (${entry.retry}/${_maxReadWriteRetry}): ${name}`);
      } else {
        // 超过最大重试次数, 报错并移除 (QGC showAppMessage)
        delete p.waitingWrite[key][name];
        p.lastError = `Parameter write failed: veh:${sysId} comp:${compId} param:${name}`;
        pushMessage(3, `[PARAM] ${p.lastError}`);
        p.rev++;
        emit();
      }
    }
  }
  if (paramsRequested) _scheduleWriteTimeout();
}

// ============================================================================

// ---------------- 心跳发送 (GCS -> Vehicle) ----------------
// 参考 QGC MultiVehicleManager::_sendGCSHeartbeat:
//   mavlink_msg_heartbeat_pack_chan(
//     GCS sysid, GCS compid, channel, &msg,
//     MAV_TYPE_GCS, MAV_AUTOPILOT_INVALID,
//     MAV_MODE_MANUAL_ARMED, 0, MAV_STATE_ACTIVE);
// 注: QGC 总是以 MAV_MODE_MANUAL_ARMED (192=0xC0) 发送,
//   这是 SAFETY_ARMED|0x80 + MANUAL_INPUT|0x40, 让 PX4 识别 GCS 在线并把 GCS 加入数据流目标
let hbCount = 0;
let firstRxT = 0;
function sendHeartbeat() {
  if (!conn || !state) return;
  hbCount++;
  // 5s 超时: 飞控完全没回话, 提醒用户检查硬件/波特率
  if (hbCount === 5 && (!state || !state._rxLogged)) {
    pushMessage(6, '⚠️ 5 秒内未收到任何字节, 请检查: 1) 飞控是否上电 2) 波特率是否 115200 3) 串口是否被 QGC 占用 4) 飞控 MAVLink 协议 (v1/v2) 是否匹配');
  }
  const frame = encodeFrame(MSG.HEARTBEAT, gcsSysId, gcsCompId, seq++, {
    type: 6,                  // MAV_TYPE_GCS
    autopilot: 8,             // MAV_AUTOPILOT_INVALID
    base_mode: 0xC0,           // MAV_MODE_MANUAL_ARMED = 192 (0xC0 = SAFETY_ARMED 0x80 | MANUAL_INPUT 0x40), 让 PX4 知道 GCS 在线并把 GCS 加入数据流目标
    custom_mode: 0,
    system_status: 4,         // MAV_STATE_ACTIVE
    mavlink_version: 3,
  });
  sendRaw(frame);
  // 仅在头部几帧日志上打印, 避免刷屏
  if (hbCount === 1 || hbCount === 3) {
    const hex = Array.from(frame).map(b => b.toString(16).padStart(2, '0')).join(' ');
    pushMessage(6, `GCS HB#${hbCount}: [${hex}] (${frame[0] === 0xFD ? 'v2' : 'v1'})`);
  }
}

// ---------------- MAV_CMD_SET_MESSAGE_INTERVAL 状态机 ----------------
// 参考 QGC MAVLinkStreamConfig.cc
// 收到飞控 HEARTBEAT 后, 依次请求关键消息流 (px4 不主动推)
const STREAM_REQUESTS = [
  // msgid,        rate_hz,    名称
  [30,  50, 'ATTITUDE'],
  [33,  10, 'GLOBAL_POSITION_INT'],
  [24,   5, 'GPS_RAW_INT'],
  [1,    1, 'SYS_STATUS'],
  [74,   4, 'VFR_HUD'],       // 空速/地速/爬升率 (QGC _handleVfrHud)
  [27,  10, 'RAW_IMU'],
  [29,  10, 'SCALED_IMU2'],
  [31,   4, 'ATTITUDE_QUATERNION'],
  [253,  1, 'STATUSTEXT'],
];

function startStreamConfig(targetSysId, targetCompId) {
  // QGC 先 restoreDefaults (把已知改过的设回 0), 再配置我们需要的 rate
  // 简化: 直接逐条发送 SET_MESSAGE_INTERVAL 命令
  streamConfigState = {
    targetSysId,
    targetCompId,
    queue: STREAM_REQUESTS.slice(),
    retried: 0,
  };
  pushMessage(6, 'StreamConfig: 开始请求消息流 (PX4 需 GCS 主动推)');
  advanceStreamConfig();
}

function advanceStreamConfig() {
  if (!streamConfigState) return;
  if (streamConfigState.queue.length === 0) {
    pushMessage(6, 'StreamConfig: 全部消息流已配置完成');
    streamConfigState = null;
    return;
  }
  const [msgid, rateHz, name] = streamConfigState.queue.shift();
  // interval = -1 (停推) 或 正数微秒 = 1000000 / rate_hz
  const intervalUs = rateHz > 0 ? Math.round(1000000 / rateHz) : -1;
  sendCommandLong(streamConfigState.targetSysId, streamConfigState.targetCompId,
    511 /* MAV_CMD_SET_MESSAGE_INTERVAL */,
    0, msgid, intervalUs, 0, 0, 0, 0);
  // 1.5s 超时 — 飞控不支持此消息流时返回 UNSUPPORTED, 我们也继续
  if (streamConfigTimer) clearTimeout(streamConfigTimer);
  streamConfigTimer = setTimeout(() => {
    pushMessage(6, `StreamConfig: ${name} 超时, 继续下一个`);
    advanceStreamConfig();
  }, 1500);
}

function sendCommandLong(targetSysId, targetCompId, command,
                        p1, p2, p3, p4, p5, p6, p7) {
  if (!conn) return;
  const frame = encodeFrame(MSG.COMMAND_LONG, gcsSysId, gcsCompId, seq++, {
    target_system: targetSysId,
    target_component: targetCompId,
    command: command,
    confirmation: 0,
    param1: p1 || 0,
    param2: p2 || 0,
    param3: p3 || 0,
    param4: p4 || 0,
    param5: p5 || 0,
    param6: p6 || 0,
    param7: p7 || 0,
  });
  sendRaw(frame);
  return frame;
}

/**
 * 发送 MAV_CMD_COMMAND_LONG 到飞控 (校准模块/外部 UI 复用)
 * @param {number} command  MAV_CMD_* 命令号 (如 241=MAV_CMD_PREFLIGHT_CALIBRATION)
 * @param {object} params   可选 {p1..p7} 参数
 */
export function sendMavCommand(command, params = {}) {
  if (!state || !state.connected) return null;
  const sysId = state.targetSysId || 1;
  const compId = state.targetCompId || 1;
  return sendCommandLong(sysId, compId, command,
    params.p1, params.p2, params.p3, params.p4, params.p5, params.p6, params.p7);
}

// ---------------- 写队列 ----------------
// 多个并发 sendRaw 调用会撞 WritableStream 的锁; 用串行化队列保证帧顺序
let writeQueue = Promise.resolve();
let serialWriter = null;
async function getSerialWriter() {
  if (serialWriter) return serialWriter;
  if (!conn || !conn.writable) return null;
  serialWriter = conn.writable.getWriter();
  return serialWriter;
}
function sendRaw(bytes) {
  if (!conn) return;
  if (source === 'serial') {
    // 串行化所有写操作, 避免 WritableStream "Already locked"
    writeQueue = writeQueue.then(async () => {
      try {
        const w = await getSerialWriter();
        if (w) await w.write(bytes);
      } catch (e) { /* ignore */ }
    }).catch(() => {});
  } else if (source === 'ws' && conn.readyState === 1) {
    if (conn.binaryType) {
      conn.send(bytes);
    } else {
      // 字符串模式: 客户端期望 hex
      conn.send('HEX:' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
    }
  }
}

function setupParser() {
  parser = new MAVLinkParser();
  window.__qgc_parser = parser;   // 诊断: 控制台可查看 parser.stats (bytes/frames/crcFail/delivered)
  parser.onDebug = (msg) => {
    if (state) {
      pushMessage(6, msg);
      emit();
    }
  };
  parser.onRaw = (chunk) => {
    if (!state) return;
    state.link.rx_bytes = (state.link.rx_bytes || 0) + chunk.length;
    // 记录首次收到原始字节, 帮助用户判断: 串口是开了但飞控没说话, 还是飞控没回应我们
    if (!state._rxLogged) {
      state._rxLogged = true;
      const hex = Array.from(chunk.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      pushMessage(6, `RX 收到 ${chunk.length} 字节: [${hex}${chunk.length > 32 ? ' ...' : ''}]`);
    }
  };
  parser.onMessage = (msg) => {
    state && (state.link.rx_rate = (state.link.rx_rate || 0) + 1);
    // 关键防护: 单条消息的处理异常绝不能杀死串口读取循环
    // (否则姿态/参数/频率会同时冻结, 且无任何报错提示)
    lastMsgName = (msg && (msg._name || msg._msgid)) || '?';
    window.__qgc_lastMsgName = lastMsgName;   // 诊断: 控制台可见最后处理的消息名
    try {
      handleMessage(msg);
    } catch (err) {
      console.error('[Telemetry] 处理消息 ' + lastMsgName + ' 异常:', err);
      if (err && err.stack) console.error(err.stack);
      try {
        pushMessage(3, '⚠️ 处理 ' + lastMsgName + ' 消息异常: ' + (err && err.message || err));
        emit();
      } catch (e2) {}
    }
  };
}
// ============================================================
// 公共 API
// ============================================================
export function subscribe(fn) { SUBS.add(fn); fn(state); return () => SUBS.delete(fn); }
export function getState() { return state; }
export function isConnected() { return !!(state && state.connected); }
export function getSource() { return source; }

/** 消息级订阅: fn(msg) 在每条解析成功的 MAVLink 消息上回调 (含未知消息). 返回取消函数 */
export function onMessage(fn) {
  MSG_SUBS.add(fn);
  return () => MSG_SUBS.delete(fn);
}

// 诊断工具 — 在浏览器控制台运行 window.__debug() 查看实时遥测状态
window.__debug = () => {
  if (!state) return '❌ state = null (飞控未连接)';
  return {
    connected: state.connected,
    link: state.link.type,
    armed: state.armed,
    mode: state.mode,
    gps: {
      fix_type: state.gps.fix_type,    // 3=3D, 4=DGPS, 5=RTK
      sats: state.gps.sats,
      hdop: state.gps.hdop,
    },
    position: state.position,
    home: state.home,
    pathLength: state.path.length,
    _gpsPosAvailable: state._gpsPosAvailable,
    _homeSet: state._homeSet,
    msgRate: computeRate(),
    lastMsgAge: state.lastMsgT ? (Date.now() - state.lastMsgT) + 'ms' : '—',
  };
};

// ============================================================================
// 公共参数 API (供 params.js UI 调用)
// ============================================================================

/** 重新拉取所有参数 (QGC ParameterManager::refreshAllParameters 简化版) */
export function refreshAllParams() {
  if (!state || !state.connected) {
    pushMessage(4, '[PARAM] 未连接飞控, 无法刷新');
    return false;
  }
  const sysId = state.targetSysId || 1;
  const compId = state.targetCompId || 1;
  const key = _paramKey(sysId, compId);
  const p = state.params;

  // 重置状态
  p.byIndex[key] = {};
  p.byName[key] = {};
  p.waitingRead[key] = {};
  p.waitingWrite[key] = {};
  p.count = 0;
  p.ready = false;
  p.loading = true;
  p.lastError = null;
  _paramListRetryCount = 0;
  _stopWriteTimeout();
  p.rev++;

  _sendParamRequestList(sysId, compId);
  _scheduleParamRetry(sysId, compId);
  return true;
}

/**
 * 写一个参数 (QGC ParameterManager::setParameter + _factRawValueUpdateWorker 简化版)
 * 参数进入 waitingWrite 队列; 3s 未收到确认则重发, 最多 _maxReadWriteRetry 次后报错。
 */
export function setParam(name, value, type) {
  if (!state || !state.connected) {
    pushMessage(4, '[PARAM] 未连接飞控, 无法写参数');
    return false;
  }
  const sysId = state.targetSysId || 1;
  const compId = state.targetCompId || 1;
  const key = _paramKey(sysId, compId);
  const p = state.params;
  if (!p.waitingWrite[key]) p.waitingWrite[key] = {};

  // 飞控参数: 正常写队列
  p.waitingWrite[key][name] = { retry: 0, value, type: type || MAV_PARAM_TYPE.REAL32 };
  // 记录"本会话已修改" (近似 QGC modified = value != default)
  if (!p.modified[key]) p.modified[key] = {};
  p.modified[key][name] = true;
  p.rev++;
  _sendParamSet(sysId, compId, name, value, type || MAV_PARAM_TYPE.REAL32);
  _scheduleWriteTimeout();
  return true;
}

/** 按名称读一个参数 (用于 UI 主动刷新某一项) */
export function requestParamByName(name) {
  if (!state || !state.connected) return false;
  _sendParamRequestRead(state.targetSysId || 1, state.targetCompId || 1, name, -1);
  return true;
}

/** 重置所有参数为固件默认值 (QGC ParameterManager::resetAllParametersToDefaults) */
export function resetAllParamsToDefaults() {
  if (!state || !state.connected) return false;
  // MAV_CMD_PREFLIGHT_STORAGE(245): param1=2 (重置参数为默认), param2=-1 (不动 mission 存储)
  sendCommandLong(state.targetSysId || 1, state.targetCompId || 1, 245, 2, -1, 0, 0, 0, 0, 0);
  pushMessage(6, '[PARAM] 发送 MAV_CMD_PREFLIGHT_STORAGE: 重置所有参数为固件默认值');
  return true;
}

/** 重置为出厂配置 (QGC ParameterManager::resetAllToVehicleConfiguration, 仅 PX4) */
export function resetAllToVehicleConfiguration() {
  // https://github.com/PX4/Firmware/pull/11760: SYS_AUTOCONFIG=2 重新运行出厂配置
  return setParam('SYS_AUTOCONFIG', 2, MAV_PARAM_TYPE.INT32);
}

/** 重启飞控 (QGC Vehicle::rebootVehicle: MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN param1=1) */
export function rebootVehicle() {
  if (!state || !state.connected) return false;
  sendCommandLong(state.targetSysId || 1, state.targetCompId || 1, 246, 1, 0, 0, 0, 0, 0, 0);
  pushMessage(6, '[CMD] 发送 MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN: 重启飞控');
  return true;
}

/**
 * 从 .param 文件文本解析出与飞控当前值的差异列表 (QGC buildDiffFromFile 简化版)
 * 文件格式: "vehId\tcompId\tname\tvalue\tmavType" (QGC writeParametersToStream)
 * 返回: [{ name, compId, mavType, fileValue, fileValueStr, vehicleValue, vehicleValueStr,
 *          noVehicleValue, otherVehicle, typeMismatch }]
 */
export function loadParamsFromFile(text) {
  const diffs = [];
  if (!state) return diffs;
  const targetSysId = state.targetSysId || 1;
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length !== 5) continue;
    const vehId = parseInt(parts[0], 10);
    const compId = parseInt(parts[1], 10);
    const name = parts[2];
    const fileValueStr = parts[3];
    const mavType = parseInt(parts[4], 10);

    const key = _paramKey(vehId, compId);
    const rec = state.params.byName[key] && state.params.byName[key][name];
    const diff = {
      name, compId, mavType, fileValueStr,
      fileValue: parseFileValue(fileValueStr, mavType),
      vehicleValue: rec ? rec.value : null,
      vehicleValueStr: rec ? formatParamValue(rec.value, rec.type) : 'N/A',
      noVehicleValue: !rec,
      otherVehicle: vehId !== targetSysId,
      typeMismatch: !!(rec && rec.type !== mavType),
    };
    // 值相同则跳过 (QGC: rawValue == fileFact->rawValue 则 continue)
    if (rec && !diff.typeMismatch && rec.value === diff.fileValue) continue;
    diffs.push(diff);
  }
  return diffs;
}

// 按文件中的 MAV_PARAM_TYPE 解析数值 (QGC 用 fileFact 的 typed setRawValue)
function parseFileValue(valStr, mavType) {
  const isInt = (mavType === MAV_PARAM_TYPE.INT8 || mavType === MAV_PARAM_TYPE.UINT8 ||
                 mavType === MAV_PARAM_TYPE.INT16 || mavType === MAV_PARAM_TYPE.UINT16 ||
                 mavType === MAV_PARAM_TYPE.INT32 || mavType === MAV_PARAM_TYPE.UINT32 ||
                 mavType === MAV_PARAM_TYPE.INT64 || mavType === MAV_PARAM_TYPE.UINT64);
  return isInt ? parseInt(valStr, 10) : parseFloat(valStr);
}

/** 在 HEARTBEAT 收到时自动触发 (参考 QGC SetupView 打开时) */
export function autoRequestParamsOnHB() {
  // 不在这里直接发, 由 startStreamConfig 后 2s 自动触发, 避免 PX4 还没就绪
  setTimeout(() => {
    if (state && state.connected && !state.params.loading && !state.params.ready) {
      refreshAllParams();
    }
  }, 2000);
}

export async function disconnect() {
  disconnecting = true;
  stopWatchdog();
  if (hbTimer) clearInterval(hbTimer); hbTimer = null;
  if (streamConfigTimer) clearTimeout(streamConfigTimer); streamConfigTimer = null;
  streamConfigState = null;
  if (hbLossT) clearTimeout(hbLossT); hbLossT = null;
  _stopWriteTimeout();
  for (const t of _paramRetryTimers.values()) clearTimeout(t);
  _paramRetryTimers.clear();
  if (conn) {
    if (source === 'serial') {
      try { if (serialReader) await serialReader.cancel(); } catch {}
      try { if (serialWriter) { await serialWriter.close().catch(()=>{}); try { serialWriter.releaseLock(); } catch (e) {} serialWriter = null; } } catch {}
      try { await conn.close(); } catch {}
    } else if (source === 'ws') {
      try { conn.close(); } catch {}
    }
    conn = null;
  }
  if (state) {
    state.connected = false;
    state.armed = false;
    state.mode = '—';
    state.link.type = '—';
    emit();
  }
}

// (Mock 数据源已删除 — 不再生成假数据, 仅显示真实飞控 MAVLink)

// ---------------- Web Serial 连接 ----------------
export async function connectSerial(baudRate = 115200) {
  if (!('serial' in navigator)) {
    const msg = '此浏览器不支持 Web Serial API (请使用 Chrome / Edge 浏览器)';
    pushMessage(6, 'Serial: ' + msg);
    emit();
    throw new Error(msg);
  }
  if (window.isSecureContext === false && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    const msg = 'Web Serial 必须在 https:// 或 localhost 下访问 (当前是 ' + location.origin + ')';
    pushMessage(6, 'Serial: ' + msg);
    emit();
    throw new Error(msg);
  }
  await disconnect();
  let port;
  try {
    port = await navigator.serial.requestPort({});
  } catch (e) {
    if (e && e.name === 'NotFoundError') {
      pushMessage(4, 'Serial: 用户取消了串口选择');
      emit();
      throw new Error('未选择串口 (用户取消)');
    }
    const msg = '打开串口选择器失败: ' + (e && e.message || e);
    pushMessage(6, 'Serial: ' + msg);
    emit();
    throw new Error(msg);
  }
  try {
    await port.open({ baudRate });
  } catch (e) {
    const msg = '打开串口失败: ' + (e && e.message || e) + ' (该串口可能正被其他程序占用)';
    pushMessage(6, 'Serial: ' + msg);
    emit();
    throw new Error(msg);
  }
  source = 'serial';
  state = makeBlankState();
  state._rxLogged = false;     // 重置 RX 日志标记
  state.connected = true;          // 链路已建立
  state.link.type = 'Serial ' + baudRate;
  state.mode = '等待心跳...';
  setupParser();
  conn = port;
  hbTimer = setInterval(sendHeartbeat, 1000);
  hbCount = 0;                     // 重置 HB 计数
  disconnecting = false;
  readLoopRestarts = 0;
  readLoopRestartWindowStart = 0;
  lastMsgName = '';
  startSerialReadLoop();
  startWatchdog();
  emit();
  return { ok: true };
}

async function startSerialReadLoop() {
  if (readLoopAlive || !conn || !conn.readable) return;
  readLoopAlive = true;
  try {
    serialReader = conn.readable.getReader();
  } catch (e) {
    console.error('[Serial] 获取 serial reader 失败:', e);
    serialReader = null;
    readLoopAlive = false;
    return;
  }
  try {
    while (conn && conn.readable) {
      const { value, done } = await serialReader.read();
      if (done) break;
      if (parser && value) parser.push(value);
    }
    // 非主动断开时循环退出 (stream done) → 尝试自动恢复
    if (conn && state && state.connected && !disconnecting) {
      console.warn('[Serial] 读取循环意外结束 (stream done), 尝试自动恢复...');
      scheduleReadLoopRestart();
    }
  } catch (e) {
    // 单条消息异常已被 parser.onMessage 内部拦截; 能到这里的是 read()/push() 层错误
    console.error('[Serial] 读取循环异常 (最后消息: ' + lastMsgName + '):', e);
    if (e && e.stack) console.error(e.stack);
    if (conn && state && state.connected && !disconnecting) {
      try {
        pushMessage(3, '⚠️ Serial 读取中断: ' + (e && e.message || e));
        emit();
      } catch (e2) {}
      scheduleReadLoopRestart();
    }
  } finally {
    try { if (serialReader) serialReader.releaseLock(); } catch {}
    serialReader = null;
    readLoopAlive = false;
  }
}

// 读取循环自动恢复: 30s 窗口内最多重启 5 次, 防止反复崩溃死循环
function scheduleReadLoopRestart() {
  if (disconnecting || !conn || !state || !state.connected) return;
  const now = Date.now();
  if (now - readLoopRestartWindowStart > 30000) {
    readLoopRestartWindowStart = now;
    readLoopRestarts = 0;
  }
  if (readLoopRestarts >= 5) {
    console.error('[Serial] 读取循环连续崩溃 5 次, 停止自动恢复。请断开重连。');
    try {
      pushMessage(3, '⚠️ Serial 读取循环连续崩溃 5 次, 已停止自动恢复。请点击 Disconnect 后重新 Connect。');
      emit();
    } catch (e2) {}
    return;
  }
  readLoopRestarts++;
  setTimeout(() => {
    if (conn && state && state.connected && !disconnecting && !readLoopAlive) {
      console.warn('[Serial] 自动重启读取循环 (第 ' + readLoopRestarts + ' 次)...');
      startSerialReadLoop();
    }
  }, 500);
}

// 链路看门狗: 已连接但一段时间收不到消息时, 输出 parser 统计定位故障层, 并尝试恢复
let lastWatchdogWarnT = 0;
function startWatchdog() {
  stopWatchdog();
  lastWatchdogWarnT = 0;
  watchdogTimer = setInterval(() => {
    if (!state || !state.connected || !conn || disconnecting) return;
    const now = Date.now();
    if (now - lastMsgT < 4000) return;   // 链路正常
    const silentFor = ((now - lastMsgT) / 1000).toFixed(1);
    const st = parser && parser.stats ? parser.stats : null;
    console.warn('[Watchdog] 已连接但 ' + silentFor + 's 无 MAVLink 消息;',
      'parser.stats=', st,
      'lastMsg=', lastMsgName,
      'readLoopAlive=', readLoopAlive);
    if (now - lastWatchdogWarnT < 10000) {
      if (!readLoopAlive) scheduleReadLoopRestart();
      return;
    }
    lastWatchdogWarnT = now;
    try {
      pushMessage(5, '⚠️ 已连接但 ' + silentFor + 's 未收到飞控消息 (bytes=' + (st ? st.bytes : '?') +
        ' frames=' + (st ? st.frames : '?') + ' delivered=' + (st ? st.delivered : '?') + '), 尝试自动恢复...');
      emit();
    } catch (e2) {}
    if (!readLoopAlive) scheduleReadLoopRestart();
  }, 2000);
}

function stopWatchdog() {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
}

// ---------------- WebSocket 桥连接 ----------------
export async function connectWebSocket(url) {
  if (typeof WebSocket === 'undefined') throw new Error('WebSocket 不可用');
  await disconnect();
  source = 'ws';
  state = makeBlankState();
  state._rxLogged = false;
  state.link.type = 'WebSocket ' + url;
  setupParser();
  return new Promise((resolve, reject) => {
    conn = new WebSocket(url);
    conn.binaryType = 'arraybuffer';
    conn.onopen = () => {
      hbTimer = setInterval(sendHeartbeat, 1000);
      hbCount = 0;
      disconnecting = false;
      lastMsgName = '';
      startWatchdog();
      resolve({ ok: true });
    };
    conn.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const u8 = new Uint8Array(e.data);
        if (parser) parser.push(u8);
      } else if (typeof e.data === 'string') {
        // JSON 或 HEX:
        if (e.data.startsWith('HEX:')) {
          const hex = e.data.slice(4);
          const u8 = new Uint8Array(hex.length / 2);
          for (let i = 0; i < u8.length; i++) u8[i] = parseInt(hex.substr(i * 2, 2), 16);
          if (parser) parser.push(u8);
        } else {
          try {
            const m = JSON.parse(e.data);
            if (m.type) handleMessage(m);
          } catch {}
        }
      }
    };
    conn.onerror = (e) => {
      pushMessage(6, 'WebSocket error');
      emit();
      reject(new Error('WebSocket 连接失败'));
    };
    conn.onclose = () => {
      if (state) { state.connected = false; state.link.type = '—'; emit(); }
    };
  });
}

// (Mock 启动已删除 — 使用 connectSerial / connectWebSocket 真实连接飞控)

// ============================================================
// MAVLink FTP — 日志拉取 (PX4 实现)
// 参考 PX4 mavlink_ftp.cpp + QGC FTPManager.cc
// 协议: opcode 命令码, req_opcode=原命令, 飞控响应 opcode=ACK(128) 或 NAK(129)
// 关键: PX4 ListDirectory 直接在 ACK 响应里返回目录条目, 不需要 ReadFile
//       条目格式: <type(1)><name><\t><size_decimal><\0>  例如: "Flog.ulg\t12345\0Dsubdir\0"
//       OpenFileRO 后 session=0 (PX4 单 session), 飞控返 ACK size=4 data=file_size(uint32)
// ============================================================

// 列出目录 (返回 array of {name, size, mode})
export async function ftpListDirectory(dirPath) {
  console.log('[FTP] ftpListDirectory 入口: dirPath="' + dirPath + '"');
  if (!state || !state.connected) throw new Error('飞控未连接');
  if (!parser) throw new Error('解析器未初始化');

  const targetSysId = state.targetSysId || 1;
  const targetCompId = state.targetCompId || 1;
  console.log('[FTP] target sys=' + targetSysId + ' comp=' + targetCompId);

  // ListDirectory: 飞控直接返回条目 (PX4 _workList 实现)
  // ACK data 格式: F<filename>\t<size_dec>\0D<dirname>\0F<filename>\t<size_dec>\0...
  let resp;
  try {
    resp = await ftpOp({
      seq: ftpSeq++,
      session: 0,
      opcode: FTP_OP.LIST_DIRECTORY,    // 3
      size: dirPath.length,
      offset32: 0,
      dataStr: dirPath,
    }, targetSysId, targetCompId);
  } catch (e) {
    // 打印 NAK 错误码详情
    console.log('[FTP] ListDirectory 失败:', e.message, 'code=' + (e.code !== undefined ? e.code : 'N/A'));
    pushMessage(6, `FTP ListDirectory 失败: ${e.message}`);
    throw e;
  }

  // 调试: 打印原始数据
  const hex = Array.from(resp.data.slice(0, resp.size)).map(b => b.toString(16).padStart(2,'0')).join(' ');
  console.log('[FTP] ListDirectory 收到', resp.size, '字节, hex=', hex);
  console.log('[FTP] ListDirectory 收到 ascii=', JSON.stringify(new TextDecoder().decode(resp.data.slice(0, resp.size))));
  pushMessage(6, `FTP ListDirectory: 收到 ${resp.size} 字节`);

  // 解析 PX4 目录条目: 每个条目以 '\0' 结尾, 格式: <type><name>\t<size_dec>
  // 但 PX4 在某些情况下最后一个条目可能不写 '\0' (实际字节数 < size 字段), 这里兼容处理
  const entries = [];
  let i = 0;
  while (i < resp.size) {
    const type = String.fromCharCode(resp.data[i]);
    if (type !== 'F' && type !== 'D') {
      // 'S' = skip, 跳过这一字节
      i += 1;
      continue;
    }
    // 找 name 结束 (到 \0 或 size 边界)
    let j = i + 1;
    while (j < resp.size && resp.data[j] !== 0) j++;
    const nameEnd = (j < resp.size) ? j : resp.size;
    // 提取 name + size
    const entryStr = new TextDecoder().decode(resp.data.slice(i + 1, nameEnd));
    const tabIdx = entryStr.indexOf('\t');
    if (tabIdx >= 0) {
      const name = entryStr.slice(0, tabIdx);
      const size = parseInt(entryStr.slice(tabIdx + 1), 10) || 0;
      if (name) entries.push({ name, size, mode: type });
    } else {
      // 目录 (没有 size)
      if (entryStr) entries.push({ name: entryStr, size: 0, mode: type });
    }
    i = j + 1;  // j 可能是 resp.size, 此时 i 也会变成 resp.size, 循环结束
  }
  console.log('[FTP] ListDirectory 解析出', entries.length, '个条目:', entries);
  return entries;
}

// 下载日志文件
export async function ftpDownload(remotePath, onProgress) {
  console.log('[FTP] ftpDownload 入口: remotePath="' + remotePath + '"');
  if (!state || !state.connected) throw new Error('飞控未连接');
  const targetSysId = state.targetSysId || 1;
  const targetCompId = state.targetCompId || 1;

  // 1) OpenFileRO - PX4 返 ACK size=4, data=file_size(uint32 LE), session=0
  let openResp;
  try {
    openResp = await ftpOp({
      seq: ftpSeq++,
      session: 0,
      opcode: FTP_OP.OPEN_FILE_RO,    // 4
      size: remotePath.length,
      offset32: 0,
      dataStr: remotePath,
    }, targetSysId, targetCompId);
    console.log('[FTP] OpenFileRO 成功: fileSize=' + (openResp.openFileLength || 0));
  } catch (e) {
    console.log('[FTP] OpenFileRO 失败:', e.message, 'code=' + (e.code !== undefined ? e.code : 'N/A'));
    pushMessage(6, `FTP OpenFileRO 失败: ${e.message}`);
    throw e;
  }
  // session 必须是 0 (PX4 单 session)
  const fileSize = openResp.openFileLength || 0;
  pushMessage(6, `FTP OpenFileRO: 文件大小 = ${fileSize} 字节`);

  // 2) 多次 ReadFile 读回文件, 直到 NAK(EOF=6)
  // PX4 ReadFile: session=0, size=请求字节数, offset=文件内偏移
  // 飞控返 ACK size=实际读到的字节, data=数据
  const CHUNK = 200;  // 保守一点, 避免 buffer 问题
  const chunks = [];
  let offset = 0;
  let total = 0;
  const maxIter = fileSize > 0 ? Math.ceil(fileSize / CHUNK) + 4 : 10000;
  console.log('[FTP] ReadFile 循环: fileSize=' + fileSize + ' maxIter=' + maxIter);
  for (let iter = 0; iter < maxIter; iter++) {
    let resp;
    try {
      resp = await ftpOp({
        seq: ftpSeq++,
        session: 0,
        opcode: FTP_OP.READ_FILE,  // 5
        size: CHUNK,
        offset32: offset,
      }, targetSysId, targetCompId);
      console.log('[FTP] ReadFile iter=' + iter + ' offset=' + offset + ' 收到 size=' + resp.size);
    } catch (e) {
      console.log('[FTP] ReadFile iter=' + iter + ' offset=' + offset + ' 异常:', e.message, 'code=' + e.code);
      // NAK EOF = 6 视为正常结束
      if (e.code === FTP_ERR.EOF) {
        pushMessage(6, `FTP ReadFile: 到达 EOF, 共读 ${total}/${fileSize} 字节`);
        console.log('[FTP] ReadFile EOF: 共读 ' + total + '/' + fileSize + ' 字节');
        break;
      }
      console.log('[FTP] ReadFile 失败:', e.message, 'code=' + (e.code !== undefined ? e.code : 'N/A'), 'offset=' + offset);
      pushMessage(6, `FTP ReadFile 失败: ${e.message}`);
      throw e;
    }
    if (resp.size === 0) {
      pushMessage(6, `FTP ReadFile: 收到 size=0, 结束 (共 ${total} 字节)`);
      break;
    }
    chunks.push(resp.data.slice(0, resp.size));
    total += resp.size;
    offset += resp.size;
    if (onProgress) onProgress({ bytes: total, done: false });
    if (fileSize > 0 && total >= fileSize) break;
  }

  // 3) TerminateSession (PX4 不强制, 但调用是好的实践)
  try {
    await ftpOp({
      seq: ftpSeq++,
      session: 0,
      opcode: FTP_OP.TERM_SESSION,  // 1
      size: 0,
      offset32: 0,
    }, targetSysId, targetCompId);
  } catch (e) { /* 关闭失败不影响 */ }

  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  if (onProgress) onProgress({ bytes: total, done: true });
  return blob;
}

// 把 Blob 触发下载到本地
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

// 单次 FTP 操作: 发送请求, 等待匹配 req_opcode 的响应
function ftpOp(req, targetSys, targetComp) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // 超时也要还原 onMessage, 否则解析钩子永远被 FTP 占用 (泄漏)
        try { if (parser && parser.onMessage === wrapper) parser.onMessage = prevHandler; } catch (e3) {}
        reject(new Error('FTP 操作超时 (10s)'));
      }
    }, 10000);

    const cb = (msg) => {
      if (msg._name !== 'FILE_TRANSFER_PROTOCOL') return;
      const decoded = decodeFTPPayload(msg.payload);
      // 调试: 打印收到的所有 FTP 帧
      console.log('[FTP] 收到 FILE_TRANSFER_PROTOCOL:',
        'seq=' + decoded.seq_number,
        'req_opcode=' + decoded.req_opcode + '(' + ftpOpName(decoded.req_opcode) + ')',
        'opcode=' + decoded.opcode + '(' + ftpOpName(decoded.opcode) + ')',
        'size=' + decoded.size,
        '期望 req_opcode=' + req.opcode + '(' + ftpOpName(req.opcode) + ')');
      // 只接受匹配 req_opcode 的响应
      if (decoded.req_opcode !== req.opcode) return;
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      if (parser && parser.onMessage === wrapper) parser.onMessage = prevHandler;

      if (decoded.opcode === FTP_OP.ACK) {
        let openFileLength = 0;
        if (req.opcode === FTP_OP.OPEN_FILE_RO) {
          console.log('[FTP] OpenFileRO 响应: size=' + decoded.size + ', data.length=' + decoded.data.length +
            ', data.hex=' + Array.from(decoded.data).map(b => b.toString(16).padStart(2,'0')).join(' '));
          if (decoded.data.length >= 4) {
            const dv = new DataView(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
            openFileLength = dv.getUint32(0, true);
          } else if (decoded.data.length > 0) {
            // 兼容: PX4 在某些版本可能返回 < 4 字节 (例如只有 2 字节)
            let sz = 0;
            for (let k = 0; k < decoded.data.length; k++) {
              sz |= decoded.data[k] << (8 * k);
            }
            openFileLength = sz >>> 0;
          }
        }
        resolve({
          opcode: decoded.opcode,
          session: decoded.session,
          size: decoded.size,
          data: decoded.data,
          openFileLength,
        });
      } else if (decoded.opcode === FTP_OP.NAK) {
        const errCode = decoded.data.length > 0 ? decoded.data[0] : 0;
        console.log('[FTP] 收到 NAK: errCode=' + errCode + ' (' + ftpErrName(errCode) + ')');
        const err = new Error(`FTP NAK: ${ftpErrName(errCode)} (${errCode})`);
        err.code = errCode;
        reject(err);
      } else {
        // 飞控可能回与请求相同的 opcode (例如 ListDirectory 完成时)
        resolve({
          opcode: decoded.opcode,
          session: decoded.session,
          size: decoded.size,
          data: decoded.data,
        });
      }
    };
    const prevHandler = parser.onMessage;
    const wrapper = (m) => {
      // 先跑原 handler (遥测), 再跑 FTP 回调; 任何一边异常都不能中断读取循环
      try { prevHandler && prevHandler(m); } catch (err) { console.error('[Telemetry] FTP 期间处理消息异常:', err); }
      try { cb(m); } catch (err) { console.error('[FTP] 处理 FTP 响应异常:', err); }
    };
    parser.onMessage = wrapper;

    // 构造请求 payload
    // 注意: 请求时 req_opcode 必须填 0, 由飞控响应时填原请求的 opcode
    const ftpReq = {
      target_network: 0,
      target_system: targetSys,
      target_component: targetComp,
      payload: encodeFTPPayload({
        seq_number: req.seq,                              // FTP 独立 seq
        session: req.session,
        opcode: req.opcode,
        size: req.size || (req.dataStr ? req.dataStr.length : 0),
        req_opcode: 0,                                    // 请求时固定 0
        burst_complete: 0,
        offset32: req.offset32 || 0,
        dataStr: req.dataStr,
      }),
    };
    const frame = encodeFrame(MSG.FILE_TRANSFER_PROTOCOL, gcsSysId, gcsCompId, seq++, ftpReq);
    console.log('[FTP] 发送', ftpOpName(req.opcode),
      'seq=' + req.seq,
      'data=' + (req.dataStr || ''),
      'frameLen=' + frame.length,
      'frame[0..15]=', Array.from(frame.slice(0, 16)).map(b => b.toString(16).padStart(2,'0')).join(' '));
    sendRaw(frame);
  });
}

function ftpOpName(op) {
  const names = {
    0: 'None', 1: 'TermSession', 2: 'ResetSessions', 3: 'ListDirectory',
    4: 'OpenFileRO', 5: 'ReadFile', 6: 'CreateFile', 7: 'WriteFile',
    8: 'RemoveFile', 9: 'CreateDir', 10: 'RemoveDir', 11: 'OpenFileWO',
    12: 'TruncateFile', 13: 'Rename', 14: 'CalcFileCRC32', 15: 'BurstReadFile',
    128: 'ACK', 129: 'NAK',
  };
  return names[op] || ('Op' + op);
}

function ftpErrName(code) {
  return ({
    0: 'None', 1: 'Fail', 2: 'FailErrno', 3: 'InvalidDataSize',
    4: 'InvalidSession', 5: 'NoSessionsAvailable', 6: 'EOF',
    7: 'UnknownCommand', 8: 'FileExists', 9: 'FileProtected', 10: 'FileNotFound',
  })[code] || ('Err' + code);
}