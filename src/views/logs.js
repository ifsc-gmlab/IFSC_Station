// views/logs.js — Analyze 视图 (Log Download)
// 数据源: 真实飞控通过 MAVLink FTP 拉取
// 支持目录树浏览, 点击目录进入, 点击文件下载

import { getState, ftpListDirectory, ftpDownload, downloadBlob } from '../telemetry.js';

let cache = [];          // 当前目录的全部条目 (F+D)
let fileCache = [];      // 视图显示用的 (按搜索过滤)
let busy = false;
// 默认目录: fs/microsd/log (PX4 日志存储位置; 在你飞控的固件中 mavlink_ftp 根目录是 NuttX /)
let lastDir = 'fs/microsd/log';

export function renderLogs(root) {
  const s = getState();
  root.innerHTML = `
    <div class="view-padded" style="height:100%;">
      <h1 class="section-title">Log Download</h1>
      <p class="section-sub">从飞控 MicroSD 卡拉取日志 (MAVLink FTP)</p>

      <div class="toolbar-row">
        <input class="input" id="logSearch" placeholder="搜索日志名 / 时间..." style="max-width:200px;" />
        <div class="row" style="gap:6px;flex:1;">
          <button class="btn" id="btnUp" title="返回上级">↑</button>
          <span class="muted" style="font-size:11px;">DIR:</span>
          <input class="input" id="logDir" value="${escapeHtml(lastDir)}" placeholder="PX4: fs/microsd/log" style="min-width:200px;font-family:var(--font-mono);"/>
          <button class="btn primary" id="btnRefresh">刷新列表</button>
        </div>
        <span class="right muted" id="logStatus">
          ${s && s.connected ? '已连接飞控' : '未连接飞控'}
        </span>
      </div>

      <div class="card">
        <table class="table">
          <thead>
            <tr>
              <th style="width:42px;">#</th>
              <th>NAME</th>
              <th style="width:80px;">SIZE</th>
              <th style="width:60px;">TYPE</th>
              <th>STATUS</th>
              <th style="width:140px;text-align:right;">ACTIONS</th>
            </tr>
          </thead>
          <tbody id="logTbody">
            <tr><td colspan="6" style="text-align:center;color:var(--text-disabled);padding:40px;">${s && s.connected ? '点击 "刷新列表" 拉取飞控日志...' : '请先在工具栏点击 Connect 连接飞控'}</td></tr>
          </tbody>
        </table>
      </div>

      <div id="logDetailHost"></div>
    </div>
  `;

  root.querySelector('#btnRefresh').addEventListener('click', () => {
    const newDir = root.querySelector('#logDir').value.trim();
    lastDir = newDir;
    reload(newDir);
  });
  root.querySelector('#btnUp').addEventListener('click', () => {
    const p = parentPath(lastDir);
    if (p !== null) {
      lastDir = p;
      root.querySelector('#logDir').value = p;
      reload(p);
    }
  });
  root.querySelector('#logSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    renderList(fileCache.filter(l => !q || l.name.toLowerCase().includes(q)));
  });
}

// 父目录: "fs/microsd/log" -> "fs/microsd", "fs" -> "", "" -> null
function parentPath(p) {
  if (!p) return null;
  const s = p.replace(/\/+$/, '');
  const idx = s.lastIndexOf('/');
  if (idx < 0) return '';             // 单段目录 -> 根
  return s.substring(0, idx);
}

async function reload(dir) {
  if (busy) return;
  busy = true;
  const tbody = document.getElementById('logTbody');
  const status = document.getElementById('logStatus');
  if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-disabled);padding:40px;">拉取 ${escapeHtml(dir || '(根)')} 中...</td></tr>`;
  if (status) status.textContent = '正在拉取...';

  try {
    const s = getState();
    if (!(s && s.connected)) {
      cache = [];
      fileCache = [];
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-disabled);padding:40px;">请先在工具栏点击 Connect 连接飞控</td></tr>`;
      if (status) status.textContent = '未连接飞控';
      return;
    }
    const entries = await ftpListDirectory(dir);
    // 同时缓存 目录 + 文件
    cache = entries;
    fileCache = entries.map((e, i) => {
      const isDir = e.mode === 'D';
      return {
        name: e.name,
        size: e.size,
        mode: e.mode,
        isDir,
        remotePath: (dir ? (dir.endsWith('/') ? dir : dir + '/') : '') + e.name,
        status: isDir ? 'Directory' : 'Available',
        created_at: Date.now() - i * DAY,
      };
    });
    // 排序: 目录在前, 然后按名字
    fileCache.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    const fileCount = fileCache.filter(l => !l.isDir).length;
    const dirCount = fileCache.filter(l => l.isDir).length;
    if (status) status.textContent = `已连接 · ${dirCount} 目录, ${fileCount} 文件`;
    renderList(fileCache);
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--color-red);padding:40px;">拉取失败: ${e.message}<br><br><button class="btn" id="retryBtn">重试</button></td></tr>`;
    if (status) status.textContent = '拉取失败';
    const rb = document.getElementById('retryBtn');
    if (rb) rb.addEventListener('click', () => reload(dir));
  } finally {
    busy = false;
  }
}

const DAY = 24 * 3600 * 1000;

function renderList(list) {
  const tbody = document.getElementById('logTbody');
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-disabled);padding:40px;">目录为空</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((l, i) => {
    const icon = l.isDir ? '📁' : '📄';
    const typeBadge = l.isDir
      ? `<span class="badge" style="background:rgba(80,160,255,0.15);color:#80c0ff;">DIR</span>`
      : `<span class="badge ok">FILE</span>`;
    const actionBtn = l.isDir
      ? `<button class="btn" data-act="open">打开</button>`
      : `<button class="btn primary" data-act="dl">下载</button>`;
    return `
    <tr data-name="${escapeHtml(l.name)}" class="${l.isDir ? 'dir-row' : 'file-row'}" style="${l.isDir ? 'cursor:pointer;' : ''}">
      <td style="color:var(--text-disabled);">${String(i + 1).padStart(2, '0')}</td>
      <td class="mono" style="color:var(--text);">${icon} ${escapeHtml(l.name)}</td>
      <td class="mono">${l.isDir ? '—' : formatSize(l.size)}</td>
      <td>${typeBadge}</td>
      <td><span class="badge ${l.isDir ? '' : 'ok'}">${l.status}</span></td>
      <td style="text-align:right;">${actionBtn}</td>
    </tr>
  `;
  }).join('');

  // 文件行: 点击下载按钮
  tbody.querySelectorAll('button[data-act="dl"]').forEach((btn, i) => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const item = list[parseInt(btn.closest('tr').rowIndex - 1, 10)] || list.find(l => l.name === btn.closest('tr').dataset.name);
      if (item) downloadItem(item, btn);
    });
  });

  // 目录行: 点击行或打开按钮进入子目录
  tbody.querySelectorAll('button[data-act="open"]').forEach((btn) => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const tr = btn.closest('tr');
      const name = tr.dataset.name;
      const item = list.find(l => l.name === name);
      if (item) enterDir(item);
    });
  });
  tbody.querySelectorAll('tr.dir-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const name = tr.dataset.name;
      const item = list.find(l => l.name === name);
      if (item) enterDir(item);
    });
  });
}

function enterDir(item) {
  const newDir = item.remotePath;
  lastDir = newDir;
  // 同步输入框
  const dirInput = document.getElementById('logDir');
  if (dirInput) dirInput.value = newDir;
  reload(newDir);
}

async function downloadItem(item, btn) {
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = '0%';
  try {
    const blob = await ftpDownload(item.remotePath, p => {
      if (p.done) btn.textContent = '完成';
      else btn.textContent = Math.round(p.bytes / item.size * 100) + '%';
    });
    downloadBlob(blob, item.name);
  } catch (e) {
    alert('下载失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function escapeHtml(s) { return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'})[c]); }
function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}
