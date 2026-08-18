// calibration.js — 传感器 / RC 校准状态机 (网页版 QGC SensorsComponentController)
//
// 实现参考:
//   - QGC  SensorsComponentController.cc   (UI 状态机, 解析飞控 STATUSTEXT)
//   - QGC  Vehicle::startCalibration        (MAV_CMD_PREFLIGHT_CALIBRATION 参数映射)
//   - PX4  calibration_messages.h           (飞控侧 [cal] 消息格式)
//   - PX4  calibration_routines.cpp         (方位命名: back/front/left/right/up/down)
//
// 校准协议 (MAVLink):
//   1) GCS 发 COMMAND_LONG MAV_CMD_PREFLIGHT_CALIBRATION(241):
//        gyro   -> param1=1
//        mag    -> param2=1
//        radio  -> param4=1
//        accel  -> param5=1
//        level  -> param5=2 (水平校准)
//        airspeed -> param6=1
//        取消   -> 全部参数为 0
//   2) 飞控通过 STATUSTEXT 回传进度 (QGC 状态机依赖这些字符串):
//        "[cal] calibration started: 2 accel"  校准开始 (2=协议版本)
//        "[cal] progress <50>"                 进度 0-100
//        "[cal] down orientation detected"     检测到某个方位 (旧版/规范消息)
//        "[cal] Hold still, measuring down side"  当前 PX4 accel 消息
//        "[cal] down side done, rotate to a different side"  该方位完成 (mag)
//        "[cal] calibration done: accel"       成功
//        "[cal] calibration cancelled" / "calibration failed: ..."
//   3) 视觉校准: 用户按方位图把飞机摆成 6 个面, 状态块依次从"待校准"->"进行中"->"完成"

import { sendMavCommand, onMessage, getState, requestParamByName } from './telemetry.js';

// ---------------- MAV_CMD 常量 (common.xml) ----------------
export const MAV_CMD_PREFLIGHT_CALIBRATION = 241;   // 触发校准
export const MAV_CMD_PREFLIGHT_STORAGE     = 245;   // 参数存储/重置
export const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246; // 重启飞控
export const MAV_CMD_SET_MESSAGE_INTERVAL  = 511;   // 请求消息流 (RC 校准用)

// ---------------- 校准类型 ----------------
export const CAL_TYPE = {
  GYRO:     'gyro',
  MAG:      'mag',
  ACCEL:    'accel',
  LEVEL:    'level',
  AIRSPEED: 'airspeed',
  RADIO:    'radio',
};

export const CAL_TYPE_LABEL = {
  gyro:     '陀螺仪',
  mag:      '罗盘',
  accel:    '加速度计',
  level:    '水平',
  airspeed: '空速',
  radio:    '遥控器',
};

// PX4 方位名 (calibration_routines.cpp detect_orientation_str)
const SIDE_KEYS = ['down', 'up', 'left', 'right', 'front', 'back'];
const SIDE_LABEL = {
  down:  '底部朝下', up:    '顶部朝下',
  left:  '左侧朝下', right: '右侧朝下',
  front: '机头朝下', back:  '机尾朝下',
};

// CAL_MAG_SIDES 位图 (QGC SensorsComponentController 读取同一参数决定罗盘校准要哪些面)
//   bit0=back, bit1=front, bit2=left, bit3=right, bit4=up, bit5=down
const MAG_SIDE_BITS = { back: 0, front: 1, left: 2, right: 3, up: 4, down: 5 };

// ---------------- 校准状态 ----------------
const listeners = new Set();
let cal = createBlankState();
let rcChannels = null;          // RC_CHANNELS_RAW 最新通道值 [8]
let rcChannelsTs = 0;

function createBlankState() {
  const sides = {};
  for (const k of SIDE_KEYS) sides[k] = { visible: false, done: false, inProgress: false, rotate: false };
  return {
    active: false,          // 是否正在校准
    type: null,             // CAL_TYPE
    progress: 0,            // 0..100
    helpText: '选择左侧按钮开始单项校准。校准期间请勿断电、保持机体静止。',
    status: 'idle',         // idle | started | running | done | cancelled | failed
    waitingForCancel: false,
    log: [],                // 校准过程日志 (最新在前)
    sides,
  };
}

function _emit() { for (const fn of listeners) { try { fn(cal); } catch (e) {} } }

/** 订阅校准状态变化, 返回取消函数 */
export function subscribeCalibration(fn) {
  listeners.add(fn);
  fn(cal);
  return () => listeners.delete(fn);
}

export function getCalibrationState() { return cal; }

/** RC 通道原始值 (供 RC 校准 UI 显示) */
export function getRCChannels() { return rcChannels; }

function _log(text) {
  cal.log.unshift({ t: Date.now(), text });
  if (cal.log.length > 80) cal.log.pop();
}

function _setSide(key, patch) { Object.assign(cal.sides[key], patch); }

function _resetSides(visible = false) {
  for (const k of SIDE_KEYS) {
    _setSide(k, { visible, done: false, inProgress: false, rotate: false });
  }
}

function _finish(code, text) {
  cal.status = code;         // done / cancelled / failed
  cal.active = false;
  cal.waitingForCancel = false;
  cal.helpText = text;
  _log(text);
  if (code === 'done') {
    cal.progress = 100;
    // QGC _stopCalibration 后刷新 CAL_ 参数, 让 UI 的"已校准"指示灯更新
    requestParamByName('CAL_MAG0_ID');
    requestParamByName('CAL_GYRO0_ID');
    requestParamByName('CAL_ACC0_ID');
    requestParamByName('CAL_MAG_SIDES');
  } else {
    _resetSides(false);
  }
  _emit();
}

// ============================================================================
// 命令发送 (QGC Vehicle::startCalibration)
// ============================================================================

/** 开始校准 (QGC SensorsComponentController::calibrateXxx -> Vehicle::startCalibration) */
export function startCalibration(type) {
  const s = getState();
  if (!s || !s.connected) {
    _log('未连接飞控, 无法校准');
    _emit();
    return false;
  }
  const p = { p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0, p7: 0 };
  switch (type) {
    case CAL_TYPE.GYRO:     p.p1 = 1; break;   // gyro
    case CAL_TYPE.MAG:      p.p2 = 1; break;   // magnetometer
    case CAL_TYPE.RADIO:    p.p4 = 1; break;   // remote control
    case CAL_TYPE.ACCEL:    p.p5 = 1; break;   // accelerometer
    case CAL_TYPE.LEVEL:    p.p5 = 2; break;   // board level
    case CAL_TYPE.AIRSPEED: p.p6 = 1; break;   // airspeed
    default: return false;
  }

  // 重置状态 (QGC _startLogCalibration + _startVisualCalibration)
  cal = createBlankState();
  cal.active = true;
  cal.type = type;
  cal.status = 'started';
  cal.progress = 0;
  cal.helpText = type === CAL_TYPE.RADIO
    ? '校准开始, 请准备移动摇杆。'
    : '等待飞控确认校准开始…';
  _log(`▶ 开始 ${CAL_TYPE_LABEL[type]} 校准 (MAV_CMD_PREFLIGHT_CALIBRATION)`);

  if (type === CAL_TYPE.RADIO) {
    // RC 校准需要 RC_CHANNELS_RAW 消息流 (QGC 在 RadioComponent 里按需请求)
    sendMavCommand(MAV_CMD_SET_MESSAGE_INTERVAL, { p1: 0, p2: 35, p3: 100000 /* 10Hz */ });
    rcChannels = null;
  }
  if (type === CAL_TYPE.MAG) {
    // 罗盘校准: 请求 CAL_MAG_SIDES 决定需要哪些面 (QGC 同样读取)
    requestParamByName('CAL_MAG_SIDES');
  }

  sendMavCommand(MAV_CMD_PREFLIGHT_CALIBRATION, p);
  _emit();
  return true;
}

/** 取消校准 (QGC cancelCalibration: 固件不支持立刻中断, 只能等待超时) */
export function cancelCalibration() {
  if (!cal.active) return false;
  cal.waitingForCancel = true;
  cal.helpText = '正在等待飞控响应取消命令 (可能需要数秒)…';
  _log('◼ 请求取消校准 (MAV_CMD_PREFLIGHT_CALIBRATION 全 0)');
  // 停止 RC 通道流
  if (cal.type === CAL_TYPE.RADIO) {
    sendMavCommand(MAV_CMD_SET_MESSAGE_INTERVAL, { p1: 0, p2: 35, p3: -1 });
  }
  sendMavCommand(MAV_CMD_PREFLIGHT_CALIBRATION, { p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0, p7: 0 });
  _emit();
  return true;
}

/** 重置传感器校准数据到出厂 (QGC SensorsComponentController::resetFactoryParameters: param1=3) */
export function resetSensorCalibration() {
  sendMavCommand(MAV_CMD_PREFLIGHT_STORAGE, { p1: 3, p2: -1 });
  _log('↺ 发送 MAV_CMD_PREFLIGHT_STORAGE: 重置传感器校准为出厂默认');
  _emit();
}

/** 重启飞控 (QGC Vehicle::rebootVehicle) */
export function rebootVehicle() {
  sendMavCommand(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, { p1: 1 });
  _log('↻ 发送 MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN: 重启飞控');
  _emit();
}

// ============================================================================
// STATUSTEXT 解析 (QGC SensorsComponentController::_handleUASTextMessage)
// ============================================================================

const RE_PROGRESS    = /progress\s*<(\d+)>/;
const RE_STARTED     = /^calibration started:\s*(\S+)\s*(\S+)/;      // "2 accel"
const RE_DONE        = /^calibration done:\s*(\S+)/;
const RE_FAILED      = /^calibration failed/;
const RE_ORI_DETECT  = /^(\S+) orientation detected/;               // 规范消息
const RE_SIDE_DONE   = /^(\S+) side done, rotate to a different side/; // 罗盘规范消息
const RE_ACCEL_HOLD  = /^Hold still, measuring (\S+) side/;          // 当前 PX4 accel
const RE_ACCEL_RESULT= /^(\S+) side result:/;                        // 当前 PX4 accel

function _sideKey(name) {
  // 兼容: "back"(机尾) 等均与 SIDE_KEYS 一致
  return SIDE_KEYS.includes(name) ? name : null;
}

function _handleStarted(type) {
  // 视觉校准 (QGC _startVisualCalibration): 只对需要摆位的类型显示 6 面图
  if (type === CAL_TYPE.ACCEL || type === CAL_TYPE.MAG || type === CAL_TYPE.GYRO) {
    cal.status = 'running';
    cal.helpText = type === CAL_TYPE.MAG
      ? '把机体按图所示方位连续旋转 (每面约停留/旋转数秒), 直到该方位标记为完成'
      : '把机体摆放成下方"未完成"的方位并保持静止';
    _resetSides(false);
    for (const k of SIDE_KEYS) {
      let visible = true;
      // 罗盘: 按 CAL_MAG_SIDES 决定要哪些面 (QGC SensorsComponentController 同样逻辑)
      if (type === CAL_TYPE.MAG && cal.magSides != null) {
        visible = ((cal.magSides >> MAG_SIDE_BITS[k]) & 1) > 0;
      }
      if (type === CAL_TYPE.GYRO) visible = (k === 'down');   // 陀螺仪只需静止
      _setSide(k, { visible, done: false, inProgress: false, rotate: false });
    }
  } else {
    cal.status = 'running';
    cal.helpText = `正在执行 ${CAL_TYPE_LABEL[type] || type} 校准…`;
  }
  _log(`▶ 飞控确认: 校准已开始 (${type})`);
}

function _handleOrientationDetected(side) {
  const key = _sideKey(side);
  if (!key || !cal.active) return;
  _setSide(key, { inProgress: true });
  if (cal.type === CAL_TYPE.MAG) {
    _setSide(key, { rotate: true });
    cal.helpText = '在图中所示方位连续旋转机体, 直到该方位显示完成';
  } else {
    cal.helpText = '保持当前方位静止, 等待测量完成';
  }
  _log(`↺ 检测到方位: ${SIDE_LABEL[key]} 正在测量…`);
}

function _handleSideDone(side) {
  const key = _sideKey(side);
  if (!key || !cal.active) return;
  _setSide(key, { done: true, inProgress: false, rotate: false });
  cal.helpText = '该方位已完成, 请把机体摆放到下一个未完成方位';
  _log(`✓ ${SIDE_LABEL[key]} 方位完成`);
}

/** 由 telemetry 消息订阅回调 (已在 telemetry.js handleMessage 里注册) */
export function handleMessage(msg) {
  if (!msg) return;
  if (msg._name === 'RC_CHANNELS_RAW') {
    rcChannels = [
      msg.chan1_raw, msg.chan2_raw, msg.chan3_raw, msg.chan4_raw,
      msg.chan5_raw, msg.chan6_raw, msg.chan7_raw, msg.chan8_raw,
    ];
    rcChannelsTs = msg.time_boot_ms;
    return;
  }
  if (msg._name !== 'STATUSTEXT') return;
  handleCalStatustext(msg.text);
}

/** 解析飞控校准 STATUSTEXT (参考 QGC _handleUASTextMessage 逐条规则) */
export function handleCalStatustext(rawText) {
  const text = String(rawText || '');
  // 进度消息 (不要求 [cal] 前缀, QGC 同样如此)
  const pm = text.match(RE_PROGRESS);
  if (pm) {
    cal.progress = parseInt(pm[1], 10) || 0;
    _emit();
    return;
  }
  // 校准日志区显示原始文本
  _log(text);

  const body = text.startsWith('[cal] ') ? text.slice('[cal] '.length) : text;

  const sm = body.match(RE_STARTED);
  if (sm) {
    _handleStarted(sm[2]);
    _emit();
    return;
  }
  if (body.match(RE_DONE)) {
    _finish('done', '校准完成 ✓');
    return;
  }
  if (body.match(RE_FAILED)) {
    _finish('failed', '校准失败 ✗ (详见上方日志)');
    return;
  }
  if (body.startsWith('calibration cancelled')) {
    _finish(cal.waitingForCancel ? 'cancelled' : 'failed', cal.waitingForCancel ? '校准已取消' : '校准被中断');
    return;
  }
  // 罗盘: "down side done, rotate to a different side"
  const sd = body.match(RE_SIDE_DONE);
  if (sd) { _handleSideDone(sd[1]); _emit(); return; }
  // 规范: "down orientation detected"
  const od = body.match(RE_ORI_DETECT);
  if (od && !RE_ACCEL_RESULT.test(body)) { _handleOrientationDetected(od[1]); _emit(); return; }
  // 当前 PX4 accel: "Hold still, measuring down side"
  const ah = body.match(RE_ACCEL_HOLD);
  if (ah) { _handleOrientationDetected(ah[1]); _emit(); return; }
  // 当前 PX4 accel: "down side result: [9.8 ...]"
  const ar = body.match(RE_ACCEL_RESULT);
  if (ar) { _handleSideDone(ar[1]); _emit(); return; }
}

// 罗盘校准开始时读取 CAL_MAG_SIDES (参考 QGC: 参数不存在则默认全 6 面)
function _readMagSides() {
  const s = getState();
  if (!s || !s.params || !s.params.byName) return;
  for (const key of Object.keys(s.params.byName)) {
    const rec = s.params.byName[key] && s.params.byName[key]['CAL_MAG_SIDES'];
    if (rec) {
      cal.magSides = rec.value | 0;
      return;
    }
  }
}

// ---------------- 模块初始化: 注册消息订阅 (单向, 无循环依赖) ----------------
onMessage(handleMessage);

// 参数缓存更新时读取 CAL_MAG_SIDES (getState 引用同一对象, 轮询成本低)
setInterval(() => {
  if (cal.active && cal.type === CAL_TYPE.MAG && cal.magSides == null) _readMagSides();
}, 1000);
