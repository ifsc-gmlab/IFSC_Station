// params.js — 参数编辑器 (完整复刻 QGC ParameterEditor.qml / ParameterEditorController.cc /
//                           ParameterEditorDialog.qml / ParameterDiffDialog.qml)
//
// 与 QGC 的对应关系:
//   - ParameterEditorController::_buildLists       → getParamCategory/getParamGroup + renderCategories (两级树)
//   - ParameterEditorController::searchParameters  → renderList 的搜索过滤
//   - ParameterEditorController::_shouldShow       → modified 过滤 (QGC 用 FactMetaData default, 我们用会话写入跟踪)
//   - Tools 菜单 (Refresh / Reset all / Load / Save / Reboot) → Tools 下拉菜单
//   - ParameterEditorDialog.accept (fact.validate + forceSave) → 类型感知校验 + Force save
//   - ParameterDiffDialog + controller.sendDiff    → 加载文件差异对话框

import { subscribe, refreshAllParams, setParam, getState,
         resetAllParamsToDefaults, resetAllToVehicleConfiguration, rebootVehicle, loadParamsFromFile } from '../telemetry.js';
import { perf } from '../perf.js';
// CONTROLLER_SWITCH_CLEANED_MARKER

let _unsub = null;
let _root = null;
let _state = null;
let _filter = { search: '', showModified: false, category: null, group: null };

// MAV_PARAM_TYPE (与 mavlink.js 一致)
const MAV_T = { REAL32: 1, REAL64: 2, INT8: 3, UINT8: 4, INT16: 5, UINT16: 6, INT32: 7, UINT32: 8, INT64: 9, UINT64: 10 };

// 各类型的默认范围 (QGC FactMetaData::_minForType/_maxForType)
const TYPE_RANGES = {
  [MAV_T.INT8]:   [-128, 127],
  [MAV_T.UINT8]:  [0, 255],
  [MAV_T.INT16]:  [-32768, 32767],
  [MAV_T.UINT16]: [0, 65535],
  [MAV_T.INT32]:  [-2147483648, 2147483647],
  [MAV_T.UINT32]: [0, 4294967295],
};

function isIntType(t) {
  return t === MAV_T.INT8 || t === MAV_T.UINT8 || t === MAV_T.INT16 || t === MAV_T.UINT16 ||
         t === MAV_T.INT32 || t === MAV_T.UINT32 || t === MAV_T.INT64 || t === MAV_T.UINT64;
}

// ---- IFSC-Station 控制器切换 (扰动切换参数 IFSC_DIST_SW) ----
// 与飞控端 src/modules/param_control/module.yaml 的 enum values 保持一致:
//   0 = PID Control        (飞控内置 PID 控制律)
//   1 = LQR (INDI) Control  (LQR, 主要实现为增量非线性动态逆 INDI)
//   2 = MPC Control         (模型预测控制)
const IFSC_SW_PARAM = 'IFSC_DIST_SW';
const IFSC_CONTROLLERS = [
  { value: 0, name: 'PID', full: 'PID Control', desc: '飞控内置 PID 控制律' },
  { value: 1, name: 'LQR (INDI)', full: 'LQR (INDI) Control', desc: 'LQR 控制器 (增量非线性动态逆 INDI)' },
  { value: 2, name: 'MPC', full: 'MPC Control', desc: '模型预测控制' },
];

// 已知枚举参数 → 编辑对话框渲染为下拉选择 (QGC FactMetaData <values> 对应)
const KNOWN_ENUM_PARAMS = { [IFSC_SW_PARAM]: IFSC_CONTROLLERS };

function ifscSwValue(state) {
  if (!state || !state.params) return null;
  const key = paramKeyFor(state);
  const rec = key && state.params.byName[key] && state.params.byName[key][IFSC_SW_PARAM];
  return rec ? rec.value : null;
}

function paramKeyFor(state) {
  if (!state || !state.params) return null;
  for (const k of Object.keys(state.params.byName)) {
    return k; // 单机场景取第一个 sys-comp 分片
  }
  return null;
}

export function renderParamsView(root) {
  _root = root;
  _state = getState();
  root.innerHTML = `
    <div class="params-editor">
      <!-- 控制器切换条 (IFSC-Station 扰动切换): 运行时切换 PID / LQR(INDI) / MPC -->
      <!-- 对应飞控端 IFSC_DIST_SW 参数 (0/1/2), 由 param_control 模块边沿检测后切换 -->
      <div class="ctrl-switch" id="ctrlSwitch">
        <span class="ctrl-switch-title" title="IFSC_DIST_SW — 扰动/控制器切换参数">控制器</span>
        <button class="ctrl-btn" data-sw="0">PID</button>
        <button class="ctrl-btn" data-sw="1">LQR (INDI)</button>
        <button class="ctrl-btn" data-sw="2">MPC</button>
        <span class="ctrl-switch-state" id="ctrlState">未连接</span>
      </div>
      <!-- 顶部工具栏: Search / Show modified / Tools (QGC header Row + Tools 按钮) -->
      <div class="params-header">
        <div class="params-search-wrap">
          <img class="params-search-icon" src="qrc/resources/search.svg" alt="" aria-hidden="true" />
          <input class="params-search" id="pSearch" placeholder="搜索参数 (例: MPC_XY_P, SYS_AUTOSTART)..." />
        </div>
        <label class="params-check"><input type="checkbox" id="pModOnly" />仅显示已修改</label>
        <button class="params-btn" id="pRefresh" title="重新拉取所有参数">
          <img src="qrc/resources/refresh.svg" alt="" aria-hidden="true" />刷新
        </button>
        <button class="params-btn" id="pSave" title="保存所有参数到文件 (.param)">
          <img src="qrc/resources/save-disk.svg" alt="" aria-hidden="true" />导出
        </button>
        <div class="params-tools-wrap">
          <button class="params-btn" id="pTools" title="更多参数工具">
            <img src="qrc/resources/toolbar/Gears.svg" alt="" aria-hidden="true" />工具
          </button>
          <div class="params-tools-menu" id="pToolsMenu" style="display:none;"></div>
        </div>
        <div class="params-status" id="pStatus"></div>
      </div>

      <!-- 主体: 左分类树(两级) + 右参数列表 -->
      <div class="params-body">
        <aside class="params-categories" id="pCats"></aside>
        <main class="params-list" id="pList"></main>
      </div>
    </div>
    <input type="file" id="pFileLoad" accept=".param,text/plain" style="display:none;" />
  `;

  // 事件绑定
  root.querySelector('#pSearch').addEventListener('input', (e) => {
    _filter.search = e.target.value.trim();
    renderList();
  });
  root.querySelector('#pModOnly').addEventListener('change', (e) => {
    _filter.showModified = e.target.checked;
    renderList();
  });
  root.querySelector('#pRefresh').addEventListener('click', () => {
    if (!_state || !_state.connected) return;
    refreshAllParams();
  });
  root.querySelector('#pSave').addEventListener('click', () => {
    saveParamsToFile();
  });
  root.querySelector('#pTools').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleToolsMenu();
  });
  document.addEventListener('click', onDocClickForTools, { capture: true });

  // 控制器切换按钮: 点击即写 IFSC_DIST_SW (INT32), 由飞控 param_control 模块边沿检测后切换
  root.querySelectorAll('#ctrlSwitch .ctrl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_state || !_state.connected) return;
      setParam(IFSC_SW_PARAM, Number(btn.dataset.sw), MAV_T.INT32);
      renderControllerSwitcher();  // 立即反馈; 飞控回执后 renderList 会刷新表格
    });
  });

  // 加载文件
  root.querySelector('#pFileLoad').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => showDiffDialog(reader.result);
    reader.readAsText(file);
  });

  // 订阅 state 变化
  if (_unsub) _unsub();
  // 性能: 遥测消息可达 50-100 Hz, 但参数表只在参数数据变化 (params.rev 变化) 时重绘.
  // 用 requestAnimationFrame 合并同一帧内的多次变化, 避免参数加载风暴期反复重建整表.
  let lastRev = -1;
  let lastConnected = null;
  let rafScheduled = false;
  _unsub = subscribe((s) => {
    _state = s;
    const rev = (s && s.params && s.params.rev) || 0;
    const connectedChanged = !!(s && s.connected) !== !!lastConnected;
    lastConnected = !!(s && s.connected);
    if (rev === lastRev && !connectedChanged) return;
    lastRev = rev;
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      renderList();
      renderStatus();
      renderControllerSwitcher();
    });
  });

  // 首次渲染
  renderCategories();
  renderList();
  renderStatus();
  renderControllerSwitcher();

  // 如果未加载, 自动触发
  if (_state && _state.connected && _state.params && !_state.params.loading && !_state.params.ready) {
    refreshAllParams();
  }
}

function onDocClickForTools(e) {
  if (!_root) return;
  const wrap = _root.querySelector('.params-tools-wrap');
  const menu = _root.querySelector('#pToolsMenu');
  if (!wrap || !menu || menu.style.display === 'none') return;
  if (wrap.contains(e.target)) return;
  menu.style.display = 'none';
}

function toggleToolsMenu() {
  const menu = _root && _root.querySelector('#pToolsMenu');
  if (!menu) return;
  if (menu.style.display !== 'none') { menu.style.display = 'none'; return; }
  const connected = !!(_state && _state.connected);
  // QGC ParameterEditor.qml Tools 菜单项
  menu.innerHTML = `
    <button class="params-menu-item" data-act="refresh" ${connected ? '' : 'disabled'}>
      <img src="qrc/resources/refresh.svg" alt=""/>刷新 (Refresh)
    </button>
    <button class="params-menu-item" data-act="reset-default" ${connected ? '' : 'disabled'}>
      <img src="qrc/resources/clockwise-arrow.svg" alt=""/>重置为固件默认值
    </button>
    <button class="params-menu-item" data-act="reset-vehicle-config" ${connected ? '' : 'disabled'}>
      <img src="qrc/resources/toolbar/Gears.svg" alt=""/>重置为出厂配置 (PX4)
    </button>
    <div class="params-menu-sep"></div>
    <button class="params-menu-item" data-act="load" ${connected ? '' : 'disabled'}>
      <img src="qrc/resources/ArrowDown.svg" alt=""/>从文件加载... (Load from file)
    </button>
    <button class="params-menu-item" data-act="save" ${connected ? '' : 'disabled'}>
      <img src="qrc/resources/save-disk.svg" alt=""/>保存到文件... (Save to file)
    </button>
    <div class="params-menu-sep"></div>
    <button class="params-menu-item danger" data-act="reboot" ${connected ? '' : 'disabled'}>
      <img src="qrc/resources/PowerButton.svg" alt=""/>重启飞控 (Reboot Vehicle)
    </button>
  `;
  menu.style.display = 'block';
  menu.querySelectorAll('.params-menu-item').forEach(btn => {
    btn.addEventListener('click', () => {
      menu.style.display = 'none';
      handleToolsAction(btn.dataset.act);
    });
  });
}

function handleToolsAction(act) {
  if (!_state || !_state.connected) return;
  if (act === 'refresh') {
    refreshAllParams();
  } else if (act === 'reset-default') {
    // QGC resetToDefaultConfirmComponent
    if (confirm('确定要将所有参数重置为固件默认值吗？\n\n注意：这将同时重置 UAVCAN 节点、全部飞行器设置、安装与校准。')) {
      resetAllParamsToDefaults();
    }
  } else if (act === 'reset-vehicle-config') {
    if (confirm('确定要将所有参数重置为出厂配置吗？(SYS_AUTOCONFIG=2)')) {
      resetAllToVehicleConfiguration();
    }
  } else if (act === 'load') {
    _root.querySelector('#pFileLoad').click();
  } else if (act === 'save') {
    saveParamsToFile();
  } else if (act === 'reboot') {
    if (confirm('确定要重启飞控吗？')) {
      rebootVehicle();
    }
  }
}

// ---- 状态条 ----
function renderStatus() {
  const el = _root && _root.querySelector('#pStatus');
  if (!el || !_state) return;
  const p = _state.params;
  if (!_state.connected) {
    el.innerHTML = '<span class="ps-warn">⚠ 未连接飞控</span>';
    return;
  }
  if (p.lastError) {
    el.innerHTML = `<span class="ps-bad">✗ ${p.lastError}</span>`;
    return;
  }
  const received = countReceived();
  const pending = countPendingWrites();
  if (p.ready) {
    let html = `<span class="ps-ok">✓ ${received}/${p.count} 参数</span>`;
    if (pending > 0) html += `<span class="ps-warn" style="margin-left:8px;">⟳ ${pending} 写入中</span>`;
    el.innerHTML = html;
  } else if (p.loading) {
    el.innerHTML = `<span class="ps-warn">⟳ 加载中... ${received}/${p.count}</span>`;
  } else {
    el.innerHTML = '<span class="ps-muted">未拉取</span>';
  }
}

function countReceived() {
  const p = _state.params;
  return Object.keys(p.byIndex).reduce((s, k) => s + Object.keys(p.byIndex[k]).length, 0);
}

function countPendingWrites() {
  const p = _state.params;
  let n = 0;
  for (const k of Object.keys(p.waitingWrite)) n += Object.keys(p.waitingWrite[k]).length;
  return n;
}

// ---- 控制器切换条 (IFSC_DIST_SW) ----
function renderControllerSwitcher() {
  const wrap = document.getElementById('ctrlSwitch');
  if (!wrap) return;
  const state = _state || getState();
  const connected = !!(state && state.connected);
  const val = ifscSwValue(state);
  wrap.querySelectorAll('.ctrl-btn').forEach(b => {
    b.classList.toggle('active', connected && Number(b.dataset.sw) === val);
    b.disabled = !connected;
  });
  const st = wrap.querySelector('#ctrlState');
  if (!st) return;
  if (!connected) {
    st.textContent = '未连接';
  } else if (val == null) {
    st.textContent = '等待参数 (IFSC_DIST_SW)…';
  } else {
    const c = IFSC_CONTROLLERS.find(c => c.value === val);
    st.textContent = c ? `当前: ${c.full}` : `当前: 未知 (${val})`;
  }
}

// ---- 分类树 (两级: Category -> Group, 仿 QGC ParameterEditorController._buildLists) ----
// QGC 用 FactMetaData 的 category/group; 我们没有元数据, 用参数名前缀近似:
//   MPC_XY_P -> category "MPC", group "XY"; SYS_AUTOSTART -> category "SYS", group "AUTOSTART"
function getParamCategory(name) {
  const parts = name.split('_');
  if (parts.length < 2) return 'Other';
  return parts[0];
}

function getParamGroup(name) {
  const parts = name.split('_');
  if (parts.length < 2) return 'All';
  return parts[1] || 'All';
}

function renderCategories() {
  const el = _root.querySelector('#pCats');
  if (!el || !_state) return;
  const allParams = collectAllParams();

  // 按 category 分组
  const groups = {};   // cat -> { group -> count }
  for (const p of allParams) {
    const cat = getParamCategory(p.name);
    const grp = getParamGroup(p.name);
    if (!groups[cat]) groups[cat] = {};
    groups[cat][grp] = (groups[cat][grp] || 0) + 1;
  }
  const cats = Object.keys(groups).sort();
  // "全部" 放最前; 默认分类 (SYS 近似 Standard) 也放前
  const std = cats.indexOf('SYS');
  if (std > 0) { const c = cats.splice(std, 1)[0]; cats.unshift(c); }

  let html = `<div class="cat-item ${_filter.category == null && _filter.group == null ? 'active' : ''}" data-cat="" data-grp="">全部 (${allParams.length})</div>`;
  for (const c of cats) {
    const grps = Object.keys(groups[c]).sort();
    const active = _filter.category === c && _filter.group == null;
    const arrow = _filter.category === c ? '▾' : '▸';
    html += `<div class="cat-item ${active ? 'active' : ''}" data-cat="${c}" data-grp="">
      <span><span class="cat-arrow">${arrow}</span>${c}</span>
      <span class="cat-count">${grps.reduce((s, g) => s + groups[c][g], 0)}</span>
    </div>`;
    if (_filter.category === c) {
      for (const g of grps) {
        const gActive = _filter.group === g;
        html += `<div class="cat-item cat-group ${gActive ? 'active' : ''}" data-cat="${c}" data-grp="${g}">
          <span>${g}</span>
          <span class="cat-count">${groups[c][g]}</span>
        </div>`;
      }
    }
  }
  el.innerHTML = html;
  el.querySelectorAll('.cat-item').forEach(it => {
    it.addEventListener('click', () => {
      const cat = it.dataset.cat || null;
      const grp = it.dataset.grp || null;
      if (cat && !grp && _filter.category === cat) {
        // 再次点击已展开的分类 → 折叠
        _filter.category = null; _filter.group = null;
      } else {
        _filter.category = cat;
        _filter.group = grp;
      }
      renderCategories();
      renderList();
    });
  });
}

// 收集所有 (sys, comp) 下的参数
function collectAllParams() {
  if (!_state) return [];
  const out = [];
  for (const key of Object.keys(_state.params.byName)) {
    const map = _state.params.byName[key];
    for (const name of Object.keys(map)) {
      out.push({ name, ...map[name] });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function paramKey() {
  return (_state.targetSysId || 1) + '-' + (_state.targetCompId || 1);
}

function isModified(name) {
  const p = _state.params;
  return !!(p.modified[paramKey()] && p.modified[paramKey()][name]);
}

// ---- 参数列表 ----
function renderList() {
  perf.paramRender++;
  const el = _root && _root.querySelector('#pList');
  if (!el) return;
  let params = collectAllParams();

  // 应用过滤
  if (_filter.search) {
    const terms = _filter.search.split(/\s+/).filter(Boolean);
    params = params.filter(p => terms.every(t => p.name.toLowerCase().includes(t.toLowerCase())));
  }
  if (_filter.category) {
    params = params.filter(p => getParamCategory(p.name) === _filter.category &&
                               (!_filter.group || getParamGroup(p.name) === _filter.group));
  }
  if (_filter.showModified) {
    // QGC _shouldShow: fact->valueEqualsDefault() == false; 无元数据时用会话写入跟踪
    params = params.filter(p => isModified(p.name));
  }

  if (params.length === 0) {
    el.innerHTML = `<div class="params-empty">
      ${!_state || !_state.connected ? '⚠ 请先连接飞控' :
        _state.params.loading ? '⟳ 正在拉取参数...' :
        _state.params.ready ? '🔍 没有匹配项' :
        '点击 "刷新" 按钮拉取参数'}
    </div>`;
    return;
  }

  const key = paramKey();
  const waitMap = _state.params.waitingWrite[key] || {};
  let html = `
    <table class="params-table">
      <thead>
        <tr>
          <th class="col-name">名称 (Name)</th>
          <th class="col-val">值 (Value)</th>
          <th class="col-type">类型</th>
          <th class="col-idx">#</th>
        </tr>
      </thead>
      <tbody>
  `;
  for (const p of params) {
    const isPending = waitMap[p.name] != null;
    const mod = isModified(p.name);
    const cls = [isPending ? 'pending' : '', mod ? 'modified' : ''].filter(Boolean).join(' ');
    html += `<tr class="${cls}" data-name="${p.name}">
      <td class="col-name">${p.name}</td>
      <td class="col-val mono">${formatParamCell(p, isPending)}</td>
      <td class="col-type">${paramTypeName(p.type)}</td>
      <td class="col-idx">${p.index === 65535 ? '—' : p.index}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  el.innerHTML = html;

  // 点击行 → 打开编辑对话框
  el.querySelectorAll('tr[data-name]').forEach(tr => {
    tr.addEventListener('click', () => {
      const name = tr.dataset.name;
      const cur = _state.params.byName[key][name];
      if (cur) openEditDialog(name, cur.value, cur.type);
    });
  });
}

// 参数单元格: 已知枚举参数显示枚举标签 (如 IFSC_DIST_SW → "PID Control"), 其余显示数值
function formatParamCell(p, isPending) {
  const enums = KNOWN_ENUM_PARAMS[p.name];
  const suffix = isPending ? ' ⟳' : '';
  if (enums) {
    const c = enums.find(e => e.value === p.value);
    return (c ? c.full : String(p.value)) + suffix;
  }
  return formatValue(p.value, p.type) + suffix;
}

function formatValue(v, type) {
  if (v == null || isNaN(v)) return '—';
  if (isIntType(type)) return String(v);
  // REAL32/REAL64: 最多 6 位小数, 去掉末尾 0
  let s = v.toFixed(6);
  s = s.replace(/\.?0+$/, '');
  return s;
}

// QGC Fact::rawValueStringFullPrecision — 导出用, 浮点 18 位小数
function formatFullPrecision(v, type) {
  if (v == null || isNaN(v)) return '—';
  if (isIntType(type)) return String(v);
  return String(v.toFixed(18).replace(/\.?0+$/, ''));
}

function paramTypeName(type) {
  // MAV_PARAM_TYPE enum: 1=REAL32, 2=REAL64, 3=INT8, 4=UINT8, 5=INT16, 6=UINT16, 7=INT32, 8=UINT32
  const t = { 1: 'F32', 2: 'F64', 3: 'I8', 4: 'U8', 5: 'I16', 6: 'U16', 7: 'I32', 8: 'U32' };
  return t[type] || '?';
}

// ---- 类型感知校验 (QGC Fact.validate -> FactMetaData::convertAndValidateRaw) ----
// 返回 { ok, value, error }
function validateParamInput(text, type, forceSave) {
  const s = String(text).trim();
  if (isIntType(type)) {
    // QGC: rawValue.toInt/toUInt —— "3.7"、"abc" 转换失败
    if (!/^[+-]?\d+$/.test(s)) return { ok: false, error: 'Invalid number' };
    const v = Number(s);
    if (!Number.isSafeInteger(v)) return { ok: false, error: 'Invalid number' };
    const range = TYPE_RANGES[type];
    if (range && !forceSave && (v < range[0] || v > range[1])) {
      return { ok: false, error: `Value must be within ${range[0]} and ${range[1]}` };
    }
    return { ok: true, value: v };
  }
  // 浮点
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return { ok: false, error: 'Invalid number' };
  const v = Number(s);
  if (isNaN(v)) return { ok: false, error: 'Invalid number' };
  return { ok: true, value: v };
}

function typeRangeString(type) {
  const r = TYPE_RANGES[type];
  return r ? `${r[0]} ~ ${r[1]}` : '—';
}

// ---- 编辑对话框 (完整复刻 QGC ParameterEditorDialog.qml) ----
function openEditDialog(name, currentValue, type) {
  closeDialog();
  const enums = KNOWN_ENUM_PARAMS[name];  // 已知枚举参数 → 下拉选择 (QGC <values>)
  const overlay = document.createElement('div');
  overlay.className = 'param-dialog-overlay';
  overlay.id = 'pDialog';
  const inputHtml = enums
    ? `<select id="pNewVal" class="param-input mono">
         ${enums.map(e => `<option value="${e.value}" ${e.value === currentValue ? 'selected' : ''}>${e.full}</option>`).join('')}
       </select>`
    : `<input type="text" id="pNewVal" class="param-input mono" value="${formatValue(currentValue, type)}" />`;
  overlay.innerHTML = `
    <div class="param-dialog">
      <div class="param-dialog-h">编辑参数</div>
      <div class="param-dialog-body">
        <div class="row">
          <span class="k">名称 (Name):</span>
          <span class="v mono">${name}</span>
        </div>
        <div class="row">
          <span class="k">类型 (Type):</span>
          <span class="v">${paramTypeName(type)}</span>
        </div>
        <div class="row">
          <span class="k">范围 (Min/Max):</span>
          <span class="v mono">${typeRangeString(type)}</span>
        </div>
        <div class="row">
          <span class="k">当前值:</span>
          <span class="v mono">${enums ? (enums.find(e => e.value === currentValue) || {}).full || currentValue : formatValue(currentValue, type)}</span>
        </div>
        <div class="row edit-row">
          <span class="k">新值:</span>
          ${inputHtml}
        </div>
        <div class="param-validate-error" id="pValError" style="display:none;"></div>
        <label class="param-force-save" id="pForceWrap" style="display:none;">
          <input type="checkbox" id="pForceSave" />强制保存 (Force save, 危险!)
        </label>
        <div class="param-hint">飞行中修改参数可能导致飞行器失稳! 请确认无误后再保存。部分参数需重启飞控后生效。</div>
      </div>
      <div class="param-dialog-actions">
        <button class="params-btn" id="pCancel">取消</button>
        <button class="params-btn primary" id="pSaveBtn">写入 (Save to Vehicle)</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#pNewVal');
  const errEl = overlay.querySelector('#pValError');
  const forceWrap = overlay.querySelector('#pForceWrap');
  const forceCb = overlay.querySelector('#pForceSave');

  if (input.focus) input.focus();
  if (input.select) input.select();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') overlay.querySelector('#pSaveBtn').click();
    if (e.key === 'Escape') closeDialog();
  });
  overlay.querySelector('#pCancel').addEventListener('click', closeDialog);
  overlay.querySelector('#pSaveBtn').addEventListener('click', () => {
    // 枚举参数: 选项即合法值, 无需校验; 其余参数走类型感知校验
    const r = enums
      ? { ok: true, value: Number(input.value) }
      : validateParamInput(input.value, type, forceCb.checked);
    if (!r.ok) {
      // QGC: validationError.text = errorString; forceSave.visible = true
      errEl.textContent = '✗ ' + r.error;
      errEl.style.display = 'block';
      forceWrap.style.display = 'block';
      input.focus();
      return;
    }
    if (r.value === currentValue) { closeDialog(); return; }
    setParam(name, r.value, type);
    closeDialog();
  });
  // 点击 overlay 关闭
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeDialog();
  });
}

function closeDialog() {
  const d = document.getElementById('pDialog');
  if (d) d.remove();
}

// ---- 保存参数到文件 (QGC writeParametersToStream 格式) ----
// 格式: "# Vehicle-Id Component-Id Name Value Type" — "vehId\tcompId\tname\tvalue(全精度)\tmavType"
function saveParamsToFile() {
  if (!_state || !_state.connected) {
    alert('未连接飞控');
    return;
  }
  const all = collectAllParams();
  if (all.length === 0) {
    alert('无参数可导出');
    return;
  }
  const sysId = _state.targetSysId || 1;
  const compId = _state.targetCompId || 1;
  let txt = `# Onboard parameters for Vehicle ${sysId}\n`;
  txt += `#\n`;
  txt += `# Vehicle-Id Component-Id Name Value Type\n`;
  txt += `#\n`;
  for (const p of all) {
    txt += `${sysId}\t${compId}\t${p.name}\t${formatFullPrecision(p.value, p.type)}\t${p.type}\n`;
  }
  const blob = new Blob([txt], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ifsc-params-${sysId}-${Date.now()}.param`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

// ---- 从文件加载 → 差异对话框 (QGC ParameterDiffDialog + controller.sendDiff) ----
function showDiffDialog(fileText) {
  if (!_state || !_state.connected) { alert('未连接飞控'); return; }
  const diffs = loadParamsFromFile(fileText);
  if (diffs.length === 0) {
    alert('文件中没有与飞控当前设置不同的参数。');
    return;
  }

  const otherVehicle = diffs.some(d => d.otherVehicle);
  const hasSkip = diffs.some(d => d.noVehicleValue || d.typeMismatch);
  const loadable = diffs.filter(d => !d.noVehicleValue && !d.typeMismatch);

  closeDialog();
  const overlay = document.createElement('div');
  overlay.className = 'param-dialog-overlay';
  overlay.id = 'pDialog';
  overlay.innerHTML = `
    <div class="param-dialog diff-dialog">
      <div class="param-dialog-h">从文件加载参数 (Load Parameters)</div>
      <div class="param-dialog-body">
        <div class="diff-desc">以下参数与飞控当前设置不同。勾选后点击 "应用" 写入飞控。</div>
        ${otherVehicle ? '<div class="diff-warn">⚠ 文件中的 Vehicle-Id 与当前飞控不一致 (QGC 会显示该警告)</div>' : ''}
        ${hasSkip ? '<div class="diff-warn">⚠ 部分参数因"飞控上不存在"或"类型不匹配"被跳过 (灰色行)。</div>' : ''}
        <table class="diff-table">
          <thead><tr>
            <th class="diff-check"><input type="checkbox" id="pDiffAll" checked /></th>
            <th>名称 (Name)</th>
            <th>文件值 (File)</th>
            <th>飞控值 (Vehicle)</th>
          </tr></thead>
          <tbody>
            ${diffs.map((d, i) => {
              const skip = d.noVehicleValue || d.typeMismatch;
              return `<tr class="${skip ? 'diff-skip' : ''}">
                <td class="diff-check"><input type="checkbox" class="pDiffRow" data-i="${i}" ${skip ? 'disabled' : 'checked'} /></td>
                <td class="mono">${d.name}${skip ? ` <span class="diff-skip-tag">${d.noVehicleValue ? '不存在' : '类型不符'}</span>` : ''}</td>
                <td class="mono">${d.fileValueStr} <span class="diff-type">${paramTypeName(d.mavType)}</span></td>
                <td class="mono">${d.noVehicleValue ? '<span class="diff-na">N/A</span>' : d.vehicleValueStr}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="param-dialog-actions">
        <button class="params-btn" id="pDiffCancel">取消</button>
        <button class="params-btn primary" id="pDiffApply">应用 (${loadable.length})</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const allCb = overlay.querySelector('#pDiffAll');
  allCb.addEventListener('change', () => {
    overlay.querySelectorAll('.pDiffRow:not(:disabled)').forEach(cb => cb.checked = allCb.checked);
  });

  overlay.querySelector('#pDiffCancel').addEventListener('click', closeDialog);
  overlay.querySelector('#pDiffApply').addEventListener('click', () => {
    let applied = 0;
    overlay.querySelectorAll('.pDiffRow:checked').forEach(cb => {
      const d = diffs[parseInt(cb.dataset.i, 10)];
      if (d && !d.noVehicleValue && !d.typeMismatch) {
        setParam(d.name, d.fileValue, d.mavType);
        applied++;
      }
    });
    closeDialog();
    if (applied > 0) {
      // 写入确认是异步的, 状态栏会自动显示"写入中"
    }
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeDialog();
  });
}

export function cleanupParamsView() {
  if (_unsub) { _unsub(); _unsub = null; }
  document.removeEventListener('click', onDocClickForTools, { capture: true });
  closeDialog();
}
