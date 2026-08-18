// views/flyview.js — FlyView 风格主视图 (地图 + 仪表 + 底部遥测栏)
// 仿 QGC FlyView + CustomFlyViewOverlay 布局

import { createAttitude } from '../widgets/attitude.js';
import { createCompass } from '../widgets/compass.js';
import { createMap } from '../widgets/map.js';
import { createChart } from '../widgets/chart.js';
import { perf } from '../perf.js';

let mapCtl = null;
let tools = null; // reference to overlay tool buttons

/** 获取当前 Fly 视图地图控制句柄 (供 GCS 定位等外部模块使用) */
export function getMapControl() { return mapCtl; }

export function renderFlyView(root) {
  root.innerHTML = `
    <div class="flightmap" id="flightmap">
      <!-- 左上: 仪表叠加层 (仿 QGC CustomFlyViewOverlay 布局) -->
      <div class="instrument-overlay" id="instOverlay">
        <!-- 顶部罗盘条 (QGC compassBar) -->
        <div class="compass-bar" id="compassBar">
          <div class="compass-ticks" id="compassTicks"></div>
          <div class="heading-readout" id="headingReadout">000°</div>
        </div>

        <!-- 仪表主体行: 人工地平仪 + 罗盘 + 读数 -->
        <div class="instrument-row">
          <div class="attitude-box" id="attHost">
            <div class="att-label">ATTITUDE</div>
          </div>
          <div class="compass-box" id="compHost">
            <div class="compass-label">HEADING</div>
          </div>
          <div class="instrument-readouts">
            <div class="ir" id="irAlt">
              <span class="k">ALT</span>
              <span><span class="v" id="irAltV">0.0</span><span class="u">m</span></span>
            </div>
            <div class="ir" id="irRel">
              <span class="k">REL</span>
              <span><span class="v" id="irRelV">0.0</span><span class="u">m</span></span>
            </div>
            <div class="ir" id="irGSpd">
              <span class="k">GSPD</span>
              <span><span class="v" id="irGSpdV">0.0</span><span class="u">m/s</span></span>
            </div>
            <div class="ir" id="irASpd">
              <span class="k">ASPD</span>
              <span><span class="v" id="irASpdV">0.0</span><span class="u">m/s</span></span>
            </div>
            <div class="ir armed" id="irArm">
              <span class="k">ARM</span>
              <span><span class="v" id="irArmV">DISARM</span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- 右上: 地图缩放/居中/类型控件 (QGCMapToolButton 风格, QGC FlightMap SVG 资源) -->
      <div class="map-widgets" id="mapWidgets">
        <button class="map-widget-btn" id="mapZoomIn" title="放大" aria-label="放大">
          <img src="qrc/resources/FlightMap/ZoomPlus.svg" alt="+"/>
        </button>
        <button class="map-widget-btn" id="mapZoomOut" title="缩小" aria-label="缩小">
          <img src="qrc/resources/FlightMap/ZoomMinus.svg" alt="-"/>
        </button>
        <button class="map-widget-btn" id="mapCenter" title="居中飞行器" aria-label="居中飞行器">
          <img src="qrc/resources/FlightMap/MapCenter.svg" alt="center"/>
        </button>
        <button class="map-widget-btn" id="mapType" title="地图类型 (Street / Satellite / Terrain)" aria-label="地图类型">
          <img src="qrc/resources/FlightMap/Layers.svg" alt="layers"/>
        </button>
      </div>

      <!-- 右下: 状态信息 -->
      <div class="map-status" id="mapStatus">
        <div class="row"><span class="k">HOME</span><span class="v mono" id="msHome">—</span></div>
        <div class="row"><span class="k">DIST</span><span class="v mono" id="msDist">0 m</span></div>
        <div class="row"><span class="k">HEAD</span><span class="v mono" id="msHead">0°</span></div>
        <div class="row"><span class="k">MODE</span><span class="v mono" id="msMode">—</span></div>
        <div class="row"><span class="k">GPS</span><span class="v mono" id="msFix">No Fix</span></div>
        <div class="row"><span class="k">LAT</span><span class="v mono" id="msLat">No GPS</span></div>
        <div class="row"><span class="k">LON</span><span class="v mono" id="msLon"></span></div>
        <div class="row"><span class="k">ALT</span><span class="v mono" id="msAlt">0.0 m</span></div>
      </div>
    </div>

    <!-- 底部: TelemetryValuesBar -->
    <div class="telemetry-bar">
      <div class="t-cell">
        <div class="l">Altitude</div>
        <div><span class="v mono" id="tbAlt">0.0</span><span class="u">m</span></div>
        <div class="bar"><span id="tbAltBar" style="width:0%"></span></div>
      </div>
      <div class="t-cell">
        <div class="l">Ground Speed</div>
        <div><span class="v mono" id="tbGSpd">0.0</span><span class="u">m/s</span></div>
        <div class="bar"><span id="tbGSpdBar" style="width:0%"></span></div>
      </div>
      <div class="t-cell">
        <div class="l">Air Speed</div>
        <div><span class="v mono" id="tbASpd">0.0</span><span class="u">m/s</span></div>
        <div class="bar"><span id="tbASpdBar" style="width:0%"></span></div>
      </div>
      <div class="t-cell">
        <div class="l">VSPEED</div>
        <div><span class="v mono" id="tbVSpd">0.0</span><span class="u">m/s</span></div>
        <div class="bar"><span id="tbVSpdBar" style="width:50%;background:#536dff"></span></div>
      </div>
      <div class="t-cell">
        <div class="l">Distance</div>
        <div><span class="v mono" id="tbDist">0</span><span class="u">m</span></div>
        <div class="bar"><span id="tbDistBar" style="width:0%"></span></div>
      </div>
      <div class="t-cell">
        <div class="l">Battery</div>
        <div><span class="v mono" id="tbBat">--</span><span class="u">%</span></div>
        <div class="bar"><span id="tbBatBar" style="width:0%"></span></div>
      </div>
      <div class="t-cell">
        <div class="l">GPS</div>
        <div><span class="v mono" id="tbSat">0</span><span class="u">SAT</span></div>
        <div class="bar"><span id="tbSatBar" style="width:0%"></span></div>
      </div>
      <div class="t-cell">
        <div class="l">RSSI</div>
        <div><span class="v mono" id="tbRssi">--</span><span class="u">%</span></div>
        <div class="bar"><span id="tbRssiBar" style="width:0%"></span></div>
      </div>
    </div>
  `;

  // 初始化 widgets (用 setTimeout 确保 DOM 已 layout)
  requestAnimationFrame(() => {
    createAttitude(root.querySelector('#attHost'));
    createCompass(root.querySelector('#compHost'));
    mapCtl = createMap(root.querySelector('#flightmap'));
  });

  // 绘制顶部罗盘条 (静态 tick 标签, 内容由 updateFlyView 实时更新)
  initCompassBarTicks();

  // 绑定右上角地图缩放按钮事件 (QGC QGCMapToolButton.onClicked 风格)
  bindMapWidgetButtons(root);
}

// 绑定地图缩放/居中按钮的 click 事件 (对应 QGC QGCMapToolButton.onClicked)
function bindMapWidgetButtons(root) {
  const handlers = [
    ['#mapZoomIn',  'zoomIn'],
    ['#mapZoomOut', 'zoomOut'],
    ['#mapCenter',  'centerVehicle'],
  ];
  for (const [sel, action] of handlers) {
    const btn = root.querySelector(sel);
    if (!btn) continue;
    btn.addEventListener('click', () => {
      if (mapCtl && typeof mapCtl[action] === 'function') {
        mapCtl[action]();
      }
    });
  }
  const typeBtn = root.querySelector('#mapType');
  if (typeBtn) typeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    showMapTypeMenu(typeBtn);
  });
}

// 地图类型切换菜单 (QGC FlightMapSettings: mapProvider + mapType)
// 高德地图 Hybrid = 卫星影像 (style=6) + 路网/注记叠加 (style=8)
const MAP_TYPES = [
  ['hybrid', 'Hybrid'],
];

function showMapTypeMenu(btn) {
  closeMapTypeMenu();
  const menu = document.createElement('div');
  menu.className = 'map-type-menu';
  const cur = mapCtl ? mapCtl.getProvider() : 'street';
  menu.innerHTML = MAP_TYPES.map(([k, label]) => `
    <button class="map-type-item ${k === cur ? 'active' : ''}" data-k="${k}">
      <span>${label}</span>${k === cur ? '●' : ''}
    </button>
  `).join('');
  const r = btn.getBoundingClientRect();
  menu.style.top = (r.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - r.right) + 'px';
  document.body.appendChild(menu);

  menu.addEventListener('click', (ev) => ev.stopPropagation());
  const onDoc = (ev) => {
    if (menu.contains(ev.target) || btn.contains(ev.target)) return;
    closeMapTypeMenu();
  };
  setTimeout(() => document.addEventListener('click', onDoc), 0);
  menu._cleanup = () => document.removeEventListener('click', onDoc);

  menu.querySelectorAll('.map-type-item').forEach(b => {
    b.addEventListener('click', () => {
      if (mapCtl) mapCtl.setProvider(b.dataset.k);
      closeMapTypeMenu();
    });
  });
}

function closeMapTypeMenu() {
  const m = document.querySelector('.map-type-menu');
  if (m) { if (m._cleanup) m._cleanup(); m.remove(); }
}

// 顶部罗盘条: 渲染水平 N E S W 标签 (按 heading 横向滚动)
function initCompassBarTicks() {
  const wrap = document.getElementById('compassTicks');
  if (!wrap) return;
  // 显示 9 个主要方位 (N NE E SE S SW W NW N)
  const labels = [
    { txt: 'N',  cls: 'major n' },
    { txt: 'NE', cls: '' },
    { txt: 'E',  cls: 'major' },
    { txt: 'SE', cls: '' },
    { txt: 'S',  cls: 'major s' },
    { txt: 'SW', cls: '' },
    { txt: 'W',  cls: 'major' },
    { txt: 'NW', cls: '' },
    { txt: 'N',  cls: 'major n' },
  ];
  wrap.innerHTML = labels.map(l => `<span class="tick ${l.cls}">${l.txt}</span>`).join('');
  _compassTickEls = [...wrap.children];
  // 窗口尺寸变化时清空宽度缓存, 下次帧重算 (避免每帧 getBoundingClientRect 强制布局)
  _compassBarW = 0;
  if (_compassResizeHandler) window.removeEventListener('resize', _compassResizeHandler);
  _compassResizeHandler = () => { _compassBarW = 0; };
  window.addEventListener('resize', _compassResizeHandler);
}

// 罗盘条缓存: tick 元素与容器宽度只计算一次, 每帧仅更新 transform (航向)
let _compassTickEls = [];
let _compassBarW = 0;
let _compassResizeHandler = null;

// 每帧只写 transform; 布局相关 (宽度/每个 tick 宽度) 仅在缓存失效时重算
function updateCompassBar(yawDeg) {
  const ticks = document.getElementById('compassTicks');
  const bar = document.getElementById('compassBar');
  if (!ticks || !bar) return;
  const barW = _compassBarW || bar.getBoundingClientRect().width;
  if (barW && barW !== _compassBarW) {
    perf.compassLayout++;  // 布局重算 (getBoundingClientRect + 10 次样式写入) — 旧行为每次消息都发生
    _compassBarW = barW;
    const tickStep = barW / 6;
    ticks.style.width = (9 * tickStep) + 'px';
    for (const el of _compassTickEls) el.style.width = tickStep + 'px';
  }
  // yawDeg=0 -> 第一个 N 对准中心; 9 个 tick 每 45° 一个
  const tickStep = barW / 6;
  const tx = barW / 2 - (yawDeg / 45) * tickStep;
  ticks.style.transform = `translateX(${tx}px)`;
  perf.compassFrame++;
}

export function updateFlyView(state) {
  if (!state) return;
  const r2d = 180 / Math.PI;
  const yawDeg = ((state.attitude.yaw * r2d + 360) % 360);

  // 仪表叠加层
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('irAltV',   state.position.alt.toFixed(1));
  set('irRelV',   state.position.relative_alt.toFixed(1));
  set('irGSpdV',  state.velocity.groundspeed.toFixed(2));
  set('irASpdV',  state.velocity.airspeed.toFixed(2));
  set('irArmV',   state.armed ? 'ARMED' : 'DISARM');
  const irArmEl = document.getElementById('irArm');
  if (irArmEl) irArmEl.querySelector('.v').style.color = state.armed ? 'var(--color-red)' : 'var(--text)';

  // 顶部罗盘条 — 横向滚动 ticks, 中央蓝色读数显示当前航向
  // 9 个 tick (N NE E SE S SW W NW N), 容器宽度 = 9 * tickStep
  updateCompassBar(yawDeg);
  const hr = document.getElementById('headingReadout');
  if (hr) hr.textContent = Math.round(yawDeg).toString().padStart(3, '0') + '°';

  // 地图右下状态
  // QGC fix_type: 0=无, 1=无, 2=2D, 3=3D, 4=DGPS, 5=RTK
  const hasGPS = state.gps && state.gps.fix_type >= 3;
  const hasPosition = state._gpsPosAvailable;
  const fixLabel = hasGPS ? '3D' : (state.gps && state.gps.fix_type === 2 ? '2D' : '—');
  const fixColor = hasGPS ? 'var(--color-green)' : (state.gps && state.gps.fix_type === 2 ? 'var(--color-orange)' : 'var(--color-red)');

  set('msHome', state.home ? `${state.home.lat.toFixed(4)}, ${state.home.lon.toFixed(4)}` : '—');
  const dist = haversine(state.home, state.position);
  set('msDist', hasGPS ? dist.toFixed(0) + ' m' : '—');
  set('msHead', yawDeg.toFixed(0) + '°');
  set('msMode', state.mode || '—');
  // GPS fix 状态: 3D(绿) / 2D(橙) / No Fix(红)
  const fixEl = document.getElementById('msFix');
  if (fixEl) {
    fixEl.textContent = hasGPS ? `${state.gps.fix_type}D · ${state.gps.sats} sats` :
      (state.gps && state.gps.fix_type === 2 ? '2D · ' + state.gps.sats + ' sats' : 'No Fix');
    fixEl.style.color = fixColor;
  }
  // LAT / LON: 无 GPS 锁定时有明显提示
  if (hasPosition && hasGPS) {
    set('msLat', state.position.lat.toFixed(6));
    set('msLon', state.position.lon.toFixed(6));
  } else {
    set('msLat', 'No GPS');
    set('msLon', '');
  }
  set('msAlt', state.position.alt.toFixed(1) + ' m');

  // 用颜色标记 LAT 行的 fix 状态
  const msLatEl = document.getElementById('msLat');
  if (msLatEl) msLatEl.style.color = fixColor;

  // 底部 telemetry bar
  const altPct = Math.min(100, state.position.alt / 50 * 100);
  set('tbAlt', state.position.alt.toFixed(1));
  document.getElementById('tbAltBar').style.width = altPct + '%';

  const gspdPct = Math.min(100, state.velocity.groundspeed / 20 * 100);
  set('tbGSpd', state.velocity.groundspeed.toFixed(1));
  document.getElementById('tbGSpdBar').style.width = gspdPct + '%';

  const aspdPct = Math.min(100, state.velocity.airspeed / 20 * 100);
  set('tbASpd', state.velocity.airspeed.toFixed(1));
  document.getElementById('tbASpdBar').style.width = aspdPct + '%';

  // VSPEED: 优先 VFR_HUD.climb (m/s, 向上为正, 与 QGC climbRate 一致);
  // 未收到 VFR_HUD 时用 GLOBAL_POSITION_INT vz (cm/s 转 m/s, NED 正=向下, 取负)
  const vspeed = state.velocity.climb !== 0 ? state.velocity.climb : -state.velocity.vz;
  set('tbVSpd', vspeed.toFixed(1));
  const vb = document.getElementById('tbVSpdBar');
  if (vb) {
    vb.style.width = Math.min(100, Math.abs(vspeed) / 5 * 100 + 5) + '%';
    vb.style.background = vspeed > 0.1 ? 'var(--color-green)' : (vspeed < -0.1 ? 'var(--color-orange)' : '#536dff');
  }

  set('tbDist', dist.toFixed(0));
  document.getElementById('tbDistBar').style.width = Math.min(100, dist / 200 * 100) + '%';

  const bat = state.battery.remaining;
  set('tbBat', Math.round(bat));
  const bb = document.getElementById('tbBatBar');
  bb.style.width = bat + '%';
  bb.classList.toggle('warn', bat < 50 && bat >= 20);
  bb.classList.toggle('bad', bat < 20);

  set('tbSat', state.gps.sats);
  const sb = document.getElementById('tbSatBar');
  sb.style.width = Math.min(100, state.gps.sats / 20 * 100) + '%';

  set('tbRssi', state.rc.rssi);
  const rb = document.getElementById('tbRssiBar');
  rb.style.width = state.rc.rssi + '%';
  rb.classList.toggle('warn', state.rc.rssi < 60 && state.rc.rssi >= 30);
  rb.classList.toggle('bad', state.rc.rssi < 30);

  // 地图
  if (mapCtl) mapCtl.update(state);
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function resetFlyViewSession() { mapCtl = null; }