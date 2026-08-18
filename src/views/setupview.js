// views/setupview.js — Setup 视图 (QGC SetupView / SensorsSetup.qml / RadioComponent.qml)
//
// 校准功能参考 QGC:
//   - SensorsComponentController.cc  状态机: 发 MAV_CMD_PREFLIGHT_CALIBRATION + 解析 [cal] 消息
//   - SensorsSetup.qml              UI 布局: 按钮列 + 进度条 + 6 方位图 + 状态文本区
//   - RadioComponent.qml            RC 校准: 通道条显示摇杆实时值
//   - 逻辑封装在 src/calibration.js, 这里只负责渲染与交互

import { getState, subscribe } from '../telemetry.js';
import {
  startCalibration, cancelCalibration, resetSensorCalibration, rebootVehicle,
  subscribeCalibration, getCalibrationState, getRCChannels, CAL_TYPE, CAL_TYPE_LABEL,
} from '../calibration.js';

const SIDES = [
  { key: 'down',  label: '底部朝下', img: 'VehicleDown' },
  { key: 'up',    label: '顶部朝下', img: 'VehicleUpsideDown' },
  { key: 'front', label: '机头朝下', img: 'VehicleNoseDown' },
  { key: 'back',  label: '机尾朝下', img: 'VehicleTailDown' },
  { key: 'left',  label: '左侧朝下', img: 'VehicleLeft' },
  { key: 'right', label: '右侧朝下', img: 'VehicleRight' },
];
const IMG = (name, rotate) => `qrc/resources/calibration/${name}${rotate ? 'Rotate' : ''}.png`;

let unsubs = [];

function paramValue(name) {
  const s = getState();
  if (!s || !s.params || !s.params.byName) return null;
  for (const key of Object.keys(s.params.byName)) {
    const rec = s.params.byName[key] && s.params.byName[key][name];
    if (rec) return rec.value;
  }
  return null;
}

// 传感器已校准判定 (QGC IndicatorButton indicatorGreen: CAL_*_ID != 0)
const SENSOR_CAL_PARAM = {
  [CAL_TYPE.MAG]:   'CAL_MAG0_ID',
  [CAL_TYPE.GYRO]:  'CAL_GYRO0_ID',
  [CAL_TYPE.ACCEL]: 'CAL_ACC0_ID',
};

export function renderSetupView(root) {
  const s = getState();
  root.innerHTML = `
    <div class="view-padded" style="height:100%;">
      <h1 class="section-title">Vehicle Setup</h1>
      <p class="section-sub">传感器 / 遥控器校准 (协议同 QGC: MAV_CMD_PREFLIGHT_CALIBRATION)</p>

      <div class="cal-layout">
        <!-- 左: 校准按钮 (QGC SensorsSetup 左侧按钮列) -->
        <div class="card">
          <div class="card-head">
            <div class="card-title">Sensors</div>
            <span id="calConnected" class="badge">未连接</span>
          </div>
          <div class="card-body col" style="gap:8px;">
            <button id="calBtn-mag"     class="cal-btn" disabled>罗盘 Compass</button>
            <button id="calBtn-gyro"    class="cal-btn" disabled>陀螺仪 Gyroscope</button>
            <button id="calBtn-accel"   class="cal-btn" disabled>加速度计 Accelerometer</button>
            <button id="calBtn-level"   class="cal-btn" disabled>水平校准 Level Horizon</button>
            <button id="calBtn-airspeed" class="cal-btn" disabled>空速 Airspeed</button>
            <button id="calBtn-radio"   class="cal-btn" disabled>遥控器 Radio</button>
            <button id="calBtn-cancel"  class="btn danger" disabled>取消校准 Cancel</button>
            <div class="kv-grid" style="grid-template-columns:1fr;margin-top:4px;">
              <div class="kv"><span class="k">说明</span><span class="v" style="font-size:11px;color:var(--text-disabled);">校准前先做机架与传感器方向设置, 校准期间保持机体静止。</span></div>
            </div>
          </div>
        </div>

        <!-- 右: 进度 + 状态区 (QGC SensorsSetup 右侧) -->
        <div class="card">
          <div class="card-head"><div class="card-title">Calibration Status</div><span id="calType" class="badge">—</span></div>
          <div class="card-body col" style="gap:10px;">
            <div class="cal-progress"><div id="calProgressFill" class="cal-progress-fill"></div></div>
            <div id="calHelp" class="cal-help">选择左侧按钮开始单项校准。</div>
            <div id="calSides" class="cal-sides"></div>
            <div id="calLog" class="cal-log"></div>
          </div>
        </div>
      </div>

      <!-- RC 校准 (QGC RadioComponent.qml) -->
      <div class="card" style="margin-top:14px;">
        <div class="card-head">
          <div class="card-title">Radio 遥控器校准</div>
          <span id="rcBadge" class="badge">未校准</span>
        </div>
        <div class="card-body">
          <div id="rcBars" class="rc-bars"></div>
          <div id="rcHelp" class="cal-help" style="margin-top:8px;">点击"遥控器 Radio"按钮开始: 飞控将进入校准模式, 来回拨动各摇杆到极限, 观察通道条实时数值变化。</div>
        </div>
      </div>

      <!-- 操作区 -->
      <div class="card" style="margin-top:14px;">
        <div class="card-head"><div class="card-title">Actions</div></div>
        <div class="card-body">
          <div class="row" style="gap:8px;flex-wrap:wrap;">
            <button id="calBtn-reset" class="btn">重置传感器校准</button>
            <button id="calBtn-reboot" class="btn">重启飞控</button>
          </div>
          <div class="kv-grid" style="grid-template-columns:1fr;margin-top:8px;">
            <div class="kv"><span class="k">提示</span><span class="v" style="font-size:11px;color:var(--text-disabled);">重置传感器校准 = MAV_CMD_PREFLIGHT_STORAGE(param1=3), 需重新校准全部传感器。</span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const el = {
    connected: root.querySelector('#calConnected'),
    calType:   root.querySelector('#calType'),
    progress:  root.querySelector('#calProgressFill'),
    help:      root.querySelector('#calHelp'),
    sides:     root.querySelector('#calSides'),
    log:       root.querySelector('#calLog'),
    rcBars:    root.querySelector('#rcBars'),
    rcHelp:    root.querySelector('#rcHelp'),
    rcBadge:   root.querySelector('#rcBadge'),
  };

  // 按钮事件
  root.querySelector('#calBtn-mag').addEventListener('click', () => startCalibration(CAL_TYPE.MAG));
  root.querySelector('#calBtn-gyro').addEventListener('click', () => startCalibration(CAL_TYPE.GYRO));
  root.querySelector('#calBtn-accel').addEventListener('click', () => startCalibration(CAL_TYPE.ACCEL));
  root.querySelector('#calBtn-level').addEventListener('click', () => startCalibration(CAL_TYPE.LEVEL));
  root.querySelector('#calBtn-airspeed').addEventListener('click', () => startCalibration(CAL_TYPE.AIRSPEED));
  root.querySelector('#calBtn-radio').addEventListener('click', () => startCalibration(CAL_TYPE.RADIO));
  root.querySelector('#calBtn-cancel').addEventListener('click', () => cancelCalibration());
  root.querySelector('#calBtn-reset').addEventListener('click', () => resetSensorCalibration());
  root.querySelector('#calBtn-reboot').addEventListener('click', () => rebootVehicle());

  // 渲染 6 个方位块 (每个块含图片 + 标签 + 状态角标)
  el.sides.innerHTML = SIDES.map(side => `
    <div class="cal-side" id="side-${side.key}" data-key="${side.key}">
      <img class="cal-side-img" id="sideImg-${side.key}" src="${IMG(side.img, false)}" alt="${side.label}"/>
      <div class="cal-side-label">${side.label}</div>
      <div class="cal-side-state" id="sideState-${side.key}"></div>
    </div>
  `).join('');

  // 8 条 RC 通道条
  el.rcBars.innerHTML = Array.from({ length: 8 }, (_, i) => `
    <div class="rc-row">
      <div class="rc-label">CH${i + 1}</div>
      <div class="rc-track">
        <div class="rc-fill" id="rcFill-${i}"></div>
        <div class="rc-center"></div>
      </div>
      <div class="rc-value" id="rcVal-${i}">—</div>
    </div>
  `).join('');

  // 订阅更新
  unsubs.forEach(u => u()); unsubs = [];
  unsubs.push(subscribeCalibration(renderCal));
  unsubs.push(subscribe(renderCal));

  root._cleanup = () => { unsubs.forEach(u => u()); unsubs = []; };
  renderCal();
}

// ============================================================================
// 渲染更新 (订阅校准状态 + 遥测状态)
// ============================================================================

// 遥测 subscribe 在每条消息都会触发 (最高 50Hz), 而传感器按钮/方位图/日志只在
// 校准状态或连接状态变化时才有必要重绘 — 用指纹跳过大部分 DOM 操作, 只保留
// RC 通道条的实时更新 (摇杆校准需要高刷新率)。
let _lastFp = '';
function _fingerprint(cal, connected) {
  let fp = connected + '|' + cal.active + '|' + cal.status + '|' + cal.type + '|' + cal.progress + '|' + cal.helpText;
  for (const side of SIDES) {
    const st = cal.sides[side.key];
    fp += '|' + (st ? st.visible + ',' + st.done + ',' + st.inProgress + ',' + st.rotate : '');
  }
  fp += '|' + cal.log.length + '|' + (cal.log[0] ? cal.log[0].text : '');
  // 传感器已校准指示灯随参数刷新变化
  for (const type of Object.keys(SENSOR_CAL_PARAM)) {
    const v = paramValue(SENSOR_CAL_PARAM[type]);
    fp += '|' + (v === null ? 'n' : v);
  }
  return fp;
}

function renderCal() {
  const root = document.getElementById('view');
  if (!root || !root.querySelector('#calConnected')) return;   // 已切换到其他视图

  const s = getState();
  const connected = !!(s && s.connected);
  const cal = getCalibrationState();
  const active = cal.active;

  // RC 通道条: 始终实时更新 (摇杆校准高刷新率)
  renderRC(connected);

  // 其余部分只在状态变化时重绘
  const fp = _fingerprint(cal, connected);
  if (fp === _lastFp) return;
  _lastFp = fp;

  const el = {
    connected: root.querySelector('#calConnected'),
    calType:   root.querySelector('#calType'),
    progress:  root.querySelector('#calProgressFill'),
    help:      root.querySelector('#calHelp'),
    sides:     root.querySelector('#calSides'),
    log:       root.querySelector('#calLog'),
    rcBars:    root.querySelector('#rcBars'),
    rcBadge:   root.querySelector('#rcBadge'),
  };

  // ---- 连接状态 ----
  el.connected.textContent = connected ? '已连接' : '未连接';
  el.connected.className = 'badge' + (connected ? ' ok' : '');
  if (!connected && !active) {
    el.calType.textContent = '—';
    el.help.textContent = '未连接飞控。请先在上方 Connect 建立链路。';
  }

  // ---- 传感器按钮 (QGC IndicatorButton: 绿色指示灯 = 已校准) ----
  for (const type of [CAL_TYPE.MAG, CAL_TYPE.GYRO, CAL_TYPE.ACCEL, CAL_TYPE.LEVEL, CAL_TYPE.AIRSPEED, CAL_TYPE.RADIO]) {
    const btn = root.querySelector('#calBtn-' + type);
    if (!btn) continue;
    btn.disabled = !connected || active;
    const calParam = SENSOR_CAL_PARAM[type];
    const val = calParam ? paramValue(calParam) : null;
    const isCalibrated = calParam ? (val !== null && val !== 0) : false;
    btn.className = 'cal-btn' + (isCalibrated ? ' calibrated' : '');
    btn.title = isCalibrated ? `${CAL_TYPE_LABEL[type]}: 已校准 (${calParam}=${val})` : '';
  }
  const cancelBtn = root.querySelector('#calBtn-cancel');
  cancelBtn.disabled = !connected || !active;

  // ---- 进度条 / 类型 / 帮助文本 ----
  if (active) {
    el.calType.textContent = `${CAL_TYPE_LABEL[cal.type] || cal.type} 校准中`;
    el.calType.className = 'badge warn';
    el.progress.style.width = (cal.progress || 0) + '%';
  } else if (cal.status === 'done') {
    el.calType.textContent = '校准完成';
    el.calType.className = 'badge ok';
    el.progress.style.width = '100%';
  } else if (cal.status === 'failed' || cal.status === 'cancelled') {
    el.calType.textContent = cal.status === 'failed' ? '校准失败' : '已取消';
    el.calType.className = 'badge bad';
    el.progress.style.width = '0%';
  } else {
    el.calType.textContent = '—';
    el.calType.className = 'badge';
    el.progress.style.width = '0%';
  }
  el.help.textContent = cal.helpText;

  // ---- 6 方位状态块 ----
  for (const side of SIDES) {
    const st = cal.sides[side.key];
    if (!st) continue;
    const tile = root.querySelector('#side-' + side.key);
    if (!tile) continue;
    // QGC VehicleRotationCal: visible / calValid(绿) / calInProgress(高亮) / rotate(转图)
    tile.style.display = st.visible ? '' : 'none';
    let cls = 'cal-side';
    if (st.done) cls += ' done';
    else if (st.inProgress) cls += ' in-progress';
    tile.className = cls;

    const img = root.querySelector('#sideImg-' + side.key);
    if (img) img.src = IMG(side.img, !!(st.rotate && st.inProgress));

    const stateEl = root.querySelector('#sideState-' + side.key);
    if (stateEl) {
      stateEl.textContent = st.done ? '✓ 完成'
        : st.inProgress ? (st.rotate ? '↻ 旋转中' : '⏳ 保持静止')
        : '待校准';
    }
  }

  // ---- 校准日志 (最新在前, 截断显示) ----
  el.log.innerHTML = cal.log.length
    ? cal.log.slice(0, 14).map(l =>
        `<div class="cal-log-line">${new Date(l.t).toLocaleTimeString('zh-CN', { hour12: false })} ${l.text}</div>`
      ).join('')
    : '<div class="cal-log-line" style="color:var(--text-disabled);">暂无日志</div>';
}

function renderRC(connected) {
  const root = document.getElementById('view');
  if (!root) return;
  const cal = getCalibrationState();
  const rcActive = cal.active && cal.type === CAL_TYPE.RADIO;
  const ch = getRCChannels();

  const badge = root.querySelector('#rcBadge');
  if (rcActive) { badge.textContent = '校准中'; badge.className = 'badge warn'; }
  else if (ch)  { badge.textContent = '有信号'; badge.className = 'badge ok'; }
  else          { badge.textContent = '未校准'; badge.className = 'badge'; }

  const help = root.querySelector('#rcHelp');
  if (rcActive) {
    help.textContent = '校准中: 请来回拨动各摇杆到最大/最小位置, 观察通道条数值变化。完成后等待飞控返回 done 消息。';
  } else {
    help.textContent = '点击"遥控器 Radio"按钮开始: 飞控将进入校准模式, 来回拨动各摇杆到极限, 观察通道条实时数值变化。';
  }

  // 通道值 -> 条位置 (PWM 1000..2000, 中心 1500)
  const pct = v => {
    if (v == null || !isFinite(v)) return 0;
    const p = Math.max(-100, Math.min(100, ((v - 1500) / 500) * 100));
    return p;
  };
  for (let i = 0; i < 8; i++) {
    const fill = root.querySelector('#rcFill-' + i);
    const val = root.querySelector('#rcVal-' + i);
    if (!fill || !val) continue;
    const v = ch ? ch[i] : null;
    if (v == null || !rcActive) {
      fill.style.width = '0%';
      fill.style.left = '50%';
      val.textContent = v != null ? v : '—';
      val.style.color = '';
      continue;
    }
    const p = pct(v);
    fill.style.width = Math.abs(p) + '%';
    fill.style.left = (50 + (p >= 0 ? 0 : p)) + '%';
    val.textContent = v;
    // 超出正常范围 (1000-2000) 高亮
    val.style.color = (v < 1000 || v > 2000) ? 'var(--color-red)' : 'var(--color-green)';
  }
}

