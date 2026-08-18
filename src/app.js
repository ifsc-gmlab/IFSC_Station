// app.js — QGroundControl Web 入口
// 完整复刻 MainRootWindow + MainToolBar + ToolStrip 行为

import { subscribe, disconnect, getState, connectSerial, connectWebSocket, isConnected, getSource } from './telemetry.js';
import { renderFlyView, updateFlyView, resetFlyViewSession, getMapControl } from './views/flyview.js';
import { renderPlanView } from './views/planview.js';
import { renderLogs } from './views/logs.js';
import { renderSetupView } from './views/setupview.js';
import { renderParamsView, cleanupParamsView } from './views/params.js';
import { startGCS } from './widgets/gcs.js';
import { perf, perfReport } from './perf.js';

// 性能报告: 控制台可手动调用 window.__perfReport(); 连接期间每 10s 自动打印一次
window.__perfReport = perfReport;
setInterval(() => {
  try { if (isConnected() && currentView === 'fly') perfReport(); } catch (e) {}
}, 10000);

const view = document.getElementById('view');
const toolstrip = document.getElementById('toolstrip');

// ============================================================
// ToolStrip 配置 (FlyViewToolStrip) — 仿 QGC custom-example
// ============================================================
// 各视图的默认 toolstrip 按钮
const STRIPS = {
  fly: [
    { icon: 'qrc/resources/toolbar/PaperPlane.svg', label: 'Fly',    title: 'Fly View' },
    { icon: 'qrc/resources/takeoff.svg',           label: 'T/O',    title: 'Takeoff', popup: 'takeoff' },
    { icon: 'qrc/resources/land.svg',              label: 'Land',   title: 'Land',    popup: 'land' },
    { icon: 'qrc/resources/rtl.svg',               label: 'RTL',    title: 'Return to Launch', popup: 'rtl' },
    { icon: 'qrc/resources/Pause.svg',             label: 'Pause',  title: 'Pause',   popup: 'pause' },
  ],
  plan: [
    { icon: 'qrc/resources/toolbar/Plan.svg',      label: 'Plan',   title: 'Plan View' },
    { icon: 'qrc/resources/waypoint.svg',          label: 'WP',     title: 'Add Waypoint', action: 'add-wp' },
    { icon: 'qrc/resources/PatternGrid.png',       label: 'Grid',   title: 'Survey Pattern', popup: 'pattern' },
    { icon: 'qrc/resources/camera.svg',            label: 'Cam',    title: 'Camera',  popup: 'camera' },
  ],
  analyze: [
    { icon: 'qrc/resources/toolbar/Analyze.svg',   label: 'Analyze', title: 'Analyze View' },
    { icon: 'qrc/resources/land.svg',              label: 'Logs',    title: 'Logs',  action: 'goto-analyze' },
  ],
  setup: [
    { icon: 'qrc/resources/toolbar/Gears.svg',     label: 'Setup',   title: 'Setup View' },
    { icon: 'qrc/resources/toolbar/Help.svg',    label: 'Help',    title: 'Help', popup: 'help' },
  ],
  params: [],
};

let currentView = 'fly';

function renderToolstrip(view) {
  const items = STRIPS[view] || STRIPS.fly;
  toolstrip.style.display = items.length ? '' : 'none';
  toolstrip.innerHTML = items.map((it, i) => {
    const iconHtml = it.iconInline
      || (it.icon ? `<img class="ic" src="${it.icon}" alt=""/>` : '');
    return `
    <button class="toolstrip-btn${it.label === items[0].label ? ' active' : ''}" data-idx="${i}" title="${it.title || it.label}">
      ${iconHtml}
      <span>${it.label}</span>
    </button>
  `;
  }).join('');

  toolstrip.querySelectorAll('.toolstrip-btn').forEach((btn, i) => {
    btn.addEventListener('click', e => {
      const it = items[i];
      if (it.popup) showPopup(it.popup, btn);
      else if (it.action) handleAction(it.action);
      else {
        toolstrip.querySelectorAll('.toolstrip-btn').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });
}

function handleAction(a) {
  if (a === 'goto-analyze') switchView('analyze');
  if (a === 'add-wp') alert('已在 Plan 视图,点击 "添加航点"');
}

// ============================================================
// Popup 菜单
// ============================================================
function showPopup(name, anchor) {
  closePopup();
  const host = document.getElementById('popupHost');
  const pop = document.createElement('div');
  pop.className = 'popup';
  pop.id = 'popupMenu';

  let content = '';
  if (name === 'takeoff') {
    content = `
      <div class="popup-title">Takeoff</div>
      <button class="popup-item success">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19 V5 M5 12 L12 5 L19 12"/></svg>
        <div><div style="font-weight:600;">起飞到 25 m</div><div class="muted" style="font-size:11px;">已解锁后执行</div></div>
      </button>
    `;
  } else if (name === 'land') {
    content = `
      <div class="popup-title">Land</div>
      <button class="popup-item success">
        <img class="ic" src="qrc/resources/land.svg" alt=""/>
        <div><div style="font-weight:600;">立即降落</div><div class="muted" style="font-size:11px;">在当前位置</div></div>
      </button>
    `;
  } else if (name === 'rtl') {
    content = `
      <div class="popup-title">Return to Launch</div>
      <button class="popup-item success">
        <img class="ic" src="qrc/resources/rtl.svg" alt=""/>
        <div><div style="font-weight:600;">返回出发点</div><div class="muted" style="font-size:11px;">自动返航</div></div>
      </button>
    `;
  } else if (name === 'pause') {
    content = `
      <div class="popup-title">Pause</div>
      <button class="popup-item">
        <img class="ic" src="qrc/resources/Pause.svg" alt=""/>
        <div><div style="font-weight:600;">暂停任务</div><div class="muted" style="font-size:11px;">当前位置盘旋</div></div>
      </button>
    `;
  } else if (name === 'camera') {
    content = `
      <div class="popup-title">Camera</div>
      <button class="popup-item">📷 拍照</button>
      <button class="popup-item">🎥 开始录像</button>
      <hr/>
      <button class="popup-item">设置...</button>
    `;
  } else if (name === 'pattern') {
    content = `
      <div class="popup-title">Survey Pattern</div>
      <button class="popup-item"><img class="ic" src="qrc/resources/PatternGrid.png"/>Grid</button>
      <button class="popup-item"><img class="ic" src="qrc/resources/PatternCamera.png"/>Corridor</button>
      <button class="popup-item"><img class="ic" src="qrc/resources/PatternTerrain.png"/>Terrain</button>
    `;
  } else if (name === 'help') {
    content = `
      <div class="popup-title">Help</div>
      <button class="popup-item">📘 用户手册</button>
      <button class="popup-item">🎬 视频教程</button>
      <hr/>
      <button class="popup-item">🐞 报告 Bug</button>
      <button class="popup-item">ℹ 关于 QGC</button>
    `;
  }
  pop.innerHTML = content;
  document.body.appendChild(pop);

  // 定位
  const r = anchor.getBoundingClientRect();
  pop.style.left = (r.right + 8) + 'px';
  pop.style.top  = (r.top - 8) + 'px';

  // 关闭: 弹窗内 stopPropagation, 弹窗外 click 关闭
  pop.addEventListener('click', (ev) => ev.stopPropagation());
  const onDocClick = (ev) => {
    if (pop.contains(ev.target) || anchor.contains(ev.target)) return;
    closePopup();
  };
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
  pop._cleanup = () => document.removeEventListener('click', onDocClick);
}

function closePopup() {
  const m = document.getElementById('popupMenu');
  if (m) {
    if (m._cleanup) m._cleanup();
    m.remove();
  }
}

// ============================================================
// 顶部 toolbar 视图切换
// ============================================================
document.querySelectorAll('.tb-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(v) {
  currentView = v;
  document.querySelectorAll('.tb-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (view._cleanup) { view._cleanup(); view._cleanup = null; }
  if (v === 'fly') {
    resetFlyViewSession();
    renderFlyView(view);
    updateFlyView(getState());
  } else if (v === 'plan') {
    renderPlanView(view);
  } else if (v === 'analyze') {
    renderLogs(view);
  } else if (v === 'setup') {
    renderSetupView(view);
  } else if (v === 'params') {
    renderParamsView(view);
    view._cleanup = () => cleanupParamsView();
  }
  renderToolstrip(v);
  closePopup();
}

// ============================================================
// Connect 按钮 & Popup (QGC LinkIndicator)
// ============================================================
function showConnectPopup() {
  closePopup();
  const host = document.getElementById('popupHost');
  const pop = document.createElement('div');
  pop.className = 'popup';
  pop.id = 'popupMenu';
  pop.style.minWidth = '380px';
  const s = getState();
  const cur = (s && s.source) || 'none';
  const hasSerial = 'serial' in navigator;

  pop.innerHTML = `
    <div class="popup-title">Connect to Vehicle</div>
    <div style="padding:6px 10px;">
      <div class="row" style="gap:6px;flex-wrap:wrap;">
        <div class="chip ${cur === 'serial' ? 'active' : ''}" data-src="serial" ${hasSerial ? '' : 'style="opacity:.4;cursor:not-allowed;" title="此浏览器不支持 Web Serial"'}>Serial (USB/UART)</div>
        <div class="chip ${cur === 'ws' ? 'active' : ''}" data-src="ws">WebSocket Bridge</div>
      </div>

      <!-- Serial 设置 -->
      <div id="serialFields" style="margin-top:10px;${cur === 'serial' ? '' : 'display:none;'};">
        <div class="popup-title">波特率 (Baud Rate)</div>
        <select class="input" id="serialBaud" style="width:100%;">
          <option value="9600">9600</option>
          <option value="57600">57600</option>
          <option value="115200" selected>115200 (PX4/ArduPilot 默认)</option>
          <option value="230400">230400</option>
          <option value="921600">921600</option>
        </select>
        <div class="muted" style="font-size:10px;margin-top:4px;">
          Chrome/Edge 浏览器需 https 或 localhost
        </div>
      </div>

      <!-- WebSocket 设置 -->
      <div id="wsFields" style="margin-top:10px;${cur === 'ws' ? '' : 'display:none;'};">
        <div class="popup-title">WebSocket URL</div>
        <input class="input" id="wsUrl" value="ws://localhost:8766" style="width:100%;" placeholder="ws://192.168.x.x:8766"/>
        <div class="muted" style="font-size:10px;margin-top:4px;">
          先运行 <code>python3 ws_bridge.py</code> 启动桥 (串口由 pyserial 打开, 稳定), 再在此连接
        </div>
      </div>

      <div class="row" style="margin-top:14px;gap:6px;">
        <button class="btn primary" id="btnConnectNow">连接</button>
        <button class="btn danger" id="btnDisconnectNow">断开</button>
      </div>

      <div style="margin-top:12px;padding:8px;background:rgba(96,69,197,.08);border:1px solid rgba(96,69,197,.3);border-radius:4px;">
        <div class="popup-title" style="color:var(--branding-blue);">需要帮助?</div>
        <div style="font-size:10px;color:var(--text-disabled);line-height:1.6;">
          <b>串口模式</b>: 直连飞控, 无需额外软件<br>
          <b>WebSocket</b>: 运行 <code>python3 ws_bridge.py</code> 启动桥脚本<br>
          提示: 部分飞控 (Pixhawk USB 口) 对 Web Serial 直连会触发 USB 复位, 桥模式更稳定
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(pop);

  const r = document.getElementById('tbConnect').getBoundingClientRect();
  pop.style.right = (window.innerWidth - r.right) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
  pop.style.left = 'auto';

  // 用 stopPropagation 阻止冒泡到 document 关闭逻辑
  pop.addEventListener('click', (ev) => ev.stopPropagation());
  // document 监听器: 在 next tick 之后才绑定, 只关闭 popup 之外的点击
  const onDocClick = (ev) => {
    if (ev.target.id === 'tbConnect' || ev.target.closest('#tbConnect')) return;
    if (pop.contains(ev.target)) return;
    closePopup();
  };
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
  const onKey = (ev) => { if (ev.key === 'Escape') closePopup(); };
  setTimeout(() => document.addEventListener('keydown', onKey), 0);
  // 清理
  pop._cleanup = () => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  };

  // 切换连接类型
  pop.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => {
      if (c.dataset.src === 'serial' && !hasSerial) return;
      pop.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      pop.querySelector('#serialFields').style.display = c.dataset.src === 'serial' ? '' : 'none';
      pop.querySelector('#wsFields').style.display     = c.dataset.src === 'ws' ? '' : 'none';
    });
  });

  pop.querySelector('#btnConnectNow').addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const active = pop.querySelector('.chip.active');
    const src = active ? active.dataset.src : 'serial';
    console.log('[QGC-WEB] Connect button clicked, src =', src, 'hasSerial =', hasSerial);
    const btn = pop.querySelector('#btnConnectNow');
    btn.disabled = true; btn.textContent = '连接中...';
    try {
      if (src === 'serial') {
        const baud = parseInt(pop.querySelector('#serialBaud').value);
        await connectSerial(baud);
      } else if (src === 'ws') {
        await connectWebSocket(pop.querySelector('#wsUrl').value.trim());
      }
      console.log('[QGC-WEB] Connect success, closing popup');
      closePopup();
    } catch (e) {
      console.error('[QGC-WEB] Connect failed:', e);
      alert('连接失败:\n' + e.message + '\n\n请打开浏览器开发者工具 (F12) → Console 查看详细日志');
    } finally {
      btn.disabled = false; btn.textContent = '连接';
    }
  });

  pop.querySelector('#btnDisconnectNow').addEventListener('click', async () => {
    await disconnect();
    closePopup();
  });
}

document.getElementById('tbConnect').addEventListener('click', showConnectPopup);
document.getElementById('messageIndicator').addEventListener('click', showMessagePanel);

// ============================================================
// MAVLink 消息详情面板 (点击 MSG 指示器弹出)
// ============================================================
function showMessagePanel(ev) {
  ev.stopPropagation();
  closePopup();
  const anchor = ev.currentTarget;
  const state = window.__qgc_lastTelemetry;
  const stats = (state && state.msgStats) || {};
  const statRows = Object.keys(stats).sort().map(k => {
    const v = stats[k];
    return `<div class="msg-stat-row"><span class="msg-stat-name">${k}</span><span class="msg-stat-count">${v}</span></div>`;
  }).join('') || '<div class="msg-empty">尚无 MAVLink 消息</div>';

  const msgs = (window.__qgc_messages || []).slice().reverse().slice(0, 50).map(m => {
    const sev = ['EMERGENCY','ALERT','CRITICAL','ERROR','WARNING','NOTICE','INFO','DEBUG'][Math.min(7, Math.max(0, m.severity || 6))];
    const cls = m.severity <= 4 ? 'sev-high' : (m.severity === 5 ? 'sev-med' : 'sev-low');
    return `<div class="msg-row ${cls}"><span class="msg-sev">${sev}</span><span class="msg-txt">${escapeHtml(m.text)}</span></div>`;
  }).join('') || '<div class="msg-empty">尚无系统消息</div>';

  const rate = state && state.msgRate || 0;
  const age = state && state.lastMsgT ? (Date.now() - state.lastMsgT) : -1;
  const ageStr = age < 0 ? '—' : (age < 1500 ? age + 'ms' : (age / 1000).toFixed(1) + 's');

  const pop = document.createElement('div');
  pop.className = 'popup msg-panel';
  pop.id = 'popupMenu';
  pop.innerHTML = `
    <div class="popup-title">MAVLink 消息流</div>
    <div class="msg-panel-summary">
      <div><b>${rate}</b> Hz</div>
      <div>最近: <b>${ageStr}</b></div>
      <div>类型: <b>${Object.keys(stats).length}</b></div>
    </div>
    <div class="msg-panel-cols">
      <div class="msg-panel-col">
        <div class="msg-panel-h">每种 MAVLink 消息计数</div>
        <div class="msg-stat-list">${statRows}</div>
      </div>
      <div class="msg-panel-col">
        <div class="msg-panel-h">最近 50 条系统消息</div>
        <div class="msg-list">${msgs}</div>
      </div>
    </div>
    <div class="popup-actions">
      <button class="btn-secondary" onclick="document.getElementById('popupMenu')?.remove()">关闭</button>
    </div>
  `;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.right = (window.innerWidth - r.right) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
  pop.style.left = 'auto';
  pop.addEventListener('click', (ev) => ev.stopPropagation());
  const onDoc = (ev) => {
    if (pop.contains(ev.target) || anchor.contains(ev.target)) return;
    closePopup();
  };
  setTimeout(() => document.addEventListener('click', onDoc), 0);
  pop._cleanup = () => document.removeEventListener('click', onDoc);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============================================================
// Link indicator 点击
// ============================================================
document.getElementById('linkIndicator').addEventListener('click', showConnectPopup);

// ============================================================
// 主菜单 (汉堡按钮) — 仿 QGC MainToolBar hamburger menu
// ============================================================
function showMainMenu(anchor) {
  closePopup();
  const pop = document.createElement('div');
  pop.className = 'popup main-menu';
  pop.id = 'popupMenu';
  pop.style.minWidth = '280px';

  const curView = currentView;
  const viewItems = [
    { id: 'fly',     label: 'Fly View',     icon: 'qrc/resources/toolbar/PaperPlane.svg' },
    { id: 'plan',    label: 'Plan View',    icon: 'qrc/resources/toolbar/Plan.svg' },
    { id: 'analyze', label: 'Analyze View', icon: 'qrc/resources/toolbar/Analyze.svg' },
    { id: 'setup',   label: 'Setup View',   icon: 'qrc/resources/toolbar/Gears.svg' },
  ];

  pop.innerHTML = `
    <div class="popup-title">视图 (View)</div>
    ${viewItems.map(v => `
      <button class="popup-item ${v.id === curView ? 'active' : ''}" data-view="${v.id}">
        <img class="ic" src="${v.icon}" alt=""/>
        <span>${v.label}</span>
        ${v.id === curView ? '<span style="margin-left:auto;color:var(--color-green);font-size:11px;">●</span>' : ''}
      </button>
    `).join('')}
    <hr/>
    <div class="popup-title">工具 (Tools)</div>
    <button class="popup-item" data-act="connect">
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12 L19 12 M12 5 L12 19"/></svg>
      <span>连接飞控...</span>
    </button>
    <button class="popup-item" data-act="messages">
      <img class="ic" src="qrc/resources/toolbar/Megaphone.svg" alt=""/>
      <span>MAVLink 消息</span>
    </button>
    <hr/>
    <div class="popup-title">应用 (App)</div>
    <button class="popup-item" data-act="manual">
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4 H20 V20 H4 Z M4 8 H20 M8 4 V20"/></svg>
      <span>用户手册</span>
    </button>
    <button class="popup-item" data-act="about">
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8 V13 M12 16.5 V17"/></svg>
      <span>关于 IFSC-Station</span>
    </button>
  `;
  document.body.appendChild(pop);

  // 定位: 在汉堡按钮下方
  const r = anchor.getBoundingClientRect();
  pop.style.left = (r.left) + 'px';
  pop.style.top  = (r.bottom + 4) + 'px';

  pop.addEventListener('click', (ev) => ev.stopPropagation());
  const onDocClick = (ev) => {
    if (pop.contains(ev.target) || anchor.contains(ev.target)) return;
    closePopup();
  };
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
  pop._cleanup = () => document.removeEventListener('click', onDocClick);

  // 视图切换
  pop.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      closePopup();
    });
  });
  // 操作
  pop.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      closePopup();
      if (act === 'connect') showConnectPopup();
      else if (act === 'messages') showMessagePanel({ currentTarget: document.getElementById('messageIndicator'), stopPropagation: () => {} });
      else if (act === 'manual') window.open('https://github.com/mavlink/qgroundcontrol', '_blank');
      else if (act === 'about') {
        alert('IFSC-Station\n版本 1.0.5\n\n基于 QGroundControl (qgroundcontrol.org)\n本版本为 IFSC 智能飞行与安全控制实验室定制\n\nLogo: IFSC_logo.png\n品牌色: #00427F (深蓝)');
      }
    });
  });
}

document.getElementById('btnMenu').addEventListener('click', (ev) => {
  ev.stopPropagation();
  showMainMenu(ev.currentTarget);
});

// ============================================================
// 全局订阅 — 更新 toolbar indicators + 当前视图
// ============================================================
// 性能: 飞控消息可达 50-100 Hz, 每次 emit() 都同步更新 DOM 会阻塞主线程导致卡顿.
// 这里用 requestAnimationFrame 合并: 同一帧内的多条消息只触发一次 DOM 更新 (≤60 fps).
window.__qgc_lastTelemetry = null;
let _uiDirty = false;
subscribe((state) => {
  window.__qgc_lastTelemetry = state;
  if (_uiDirty) return;
  _uiDirty = true;
  requestAnimationFrame(() => {
    _uiDirty = false;
    perf.ui++;
    updateIndicators(state);
    if (currentView === 'fly') updateFlyView(state);
  });
});

function updateIndicators(state) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  // Link
  const li = document.getElementById('linkIndicator');
  const lt = document.getElementById('linkText');
  if (state && state.connected) {
    li.classList.add('connected');
    lt.textContent = 'Connected';
  } else {
    li.classList.remove('connected');
    lt.textContent = 'Disconnected';
  }

  // Battery
  if (state) {
    set('batteryText', Math.round(state.battery.remaining) + '%');
    const bi = document.getElementById('batteryIndicator');
    bi.querySelector('.v').className = 'v ' + (state.battery.remaining < 20 ? 'bad' : (state.battery.remaining < 50 ? 'warn' : 'ok'));

    set('gpsText', state.gps.sats + ' Sats');
    const gi = document.getElementById('gpsIndicator');
    gi.querySelector('.v').className = 'v ' + (state.gps.sats < 8 ? 'bad' : (state.gps.sats < 12 ? 'warn' : 'ok'));

    set('rcText', state.rc.rssi + '%');
    const ri = document.getElementById('rcIndicator');
    ri.querySelector('.v').className = 'v ' + (state.rc.rssi < 30 ? 'bad' : (state.rc.rssi < 60 ? 'warn' : 'ok'));

    set('modeText', state.mode);
    const ai = document.getElementById('armedIndicator');
    const at = document.getElementById('armedText');
    const aiIcon = document.getElementById('armedIcon');
    if (at) {
      if (state.armed) {
        at.textContent = 'Armed';
        at.className = 'v bad';
        if (aiIcon) aiIcon.src = 'qrc/resources/toolbar/Armed.svg';
      } else {
        at.textContent = 'Disarmed';
        at.className = 'v';
        if (aiIcon) aiIcon.src = 'qrc/resources/toolbar/Disarmed.svg';
      }
    }
  }

  // Connect 按钮文字
  const ct = document.getElementById('tbConnectText');
  const cb = document.getElementById('tbConnect');
  if (state && state.connected) {
    ct.textContent = 'Disconnect';
    cb.classList.add('connected');
  } else {
    ct.textContent = 'Connect';
    cb.classList.remove('connected');
  }

  // MAVLink 消息速率 (条/秒) + 最近一条消息距今 ms
  if (state) {
    const mri = document.getElementById('mavRate');
    if (mri) {
      const r = state.msgRate || 0;
      const age = state.lastMsgT ? (Date.now() - state.lastMsgT) : -1;
      let ageTxt = '';
      if (age < 0) ageTxt = '无数据';
      else if (age < 1500) ageTxt = age + 'ms';
      else if (age < 5000) ageTxt = (age / 1000).toFixed(1) + 's';
      else ageTxt = '已断 (' + (age / 1000).toFixed(0) + 's)';
      mri.textContent = state.connected ? (r + ' Hz · ' + ageTxt) : '';
      mri.className = 'mav-rate ' + (age > 3000 ? 'bad' : (age > 1500 ? 'warn' : 'ok'));
    }
    // 消息计数
    const mt = document.getElementById('messageText');
    if (mt && state.messages) mt.textContent = state.messages.length;
  }
}

// ============================================================
// 启动
// ============================================================
switchView('fly');
// 不再自动 connect('mock') — 等待用户点 Connect 真实连接飞控

// ============================================================
// GCS 定位 (对应 QGC QGCPositionManager)
// 全局单例订阅系统定位, 地图创建后自动绘制 GCS 标记;
// 无飞行器位置时首次定位居中到 GCS (QGC FlightMap allowGCSLocationCenter)
// ============================================================
startGCS((gcs) => {
  const ctl = getMapControl();
  if (ctl && ctl.setGCSPosition) ctl.setGCSPosition(gcs);
});