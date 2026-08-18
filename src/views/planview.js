// views/planview.js — Plan 视图 (QGC PlanView 简化)
// 列出航点 + 右侧航点编辑器

let waypoints = [
  { id: 1, action: 'TAKEOFF', alt: 20, lat: 30.2741, lon: 120.1551, dist: 0 },
  { id: 2, action: 'WAYPOINT', alt: 25, lat: 30.2748, lon: 120.1560, dist: 95 },
  { id: 3, action: 'WAYPOINT', alt: 30, lat: 30.2760, lon: 120.1572, dist: 240 },
  { id: 4, action: 'WAYPOINT', alt: 30, lat: 30.2758, lon: 120.1590, dist: 410 },
  { id: 5, action: 'WAYPOINT', alt: 25, lat: 30.2745, lon: 120.1580, dist: 540 },
  { id: 6, action: 'RTL',     alt: 0,  lat: 30.2741, lon: 120.1551, dist: 620 },
];

export function renderPlanView(root) {
  root.innerHTML = `
    <div class="view-padded" style="height:100%;">
      <h1 class="section-title">Mission Plan</h1>
      <p class="section-sub">规划飞行任务航点 / 动作 / 高度</p>

      <div style="display:grid;grid-template-columns:1fr 320px;gap:16px;">
        <div class="card">
          <div class="card-head">
            <div class="card-title">Waypoints</div>
            <div class="row" style="gap:6px;">
              <button class="btn" id="addWp">添加航点</button>
              <button class="btn primary" id="uploadWp">上传至飞行器</button>
            </div>
          </div>
          <table class="table">
            <thead>
              <tr>
                <th style="width:50px;">#</th>
                <th>ACTION</th>
                <th>ALT</th>
                <th>LAT</th>
                <th>LON</th>
                <th>DIST</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="wpTbody">
              ${waypoints.map((w, i) => `
                <tr data-id="${w.id}">
                  <td class="mono" style="color:var(--text-disabled);">${String(i+1).padStart(2,'0')}</td>
                  <td><span class="badge ${w.action === 'RTL' ? 'warn' : (w.action === 'TAKEOFF' || w.action === 'LAND' ? 'ok' : '')}">${w.action}</span></td>
                  <td class="mono">${w.alt.toFixed(0)} m</td>
                  <td class="mono" style="color:var(--text-disabled);">${w.lat.toFixed(6)}</td>
                  <td class="mono" style="color:var(--text-disabled);">${w.lon.toFixed(6)}</td>
                  <td class="mono">${w.dist.toFixed(0)} m</td>
                  <td style="text-align:right;">
                    <button class="btn" data-act="del" data-id="${w.id}">删除</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-head"><div class="card-title">Mission Summary</div></div>
          <div class="card-body">
            <div class="kv-grid" style="grid-template-columns:1fr 1fr;">
              <div class="kv"><span class="k">Waypoints</span><span class="v mono">${waypoints.length}</span></div>
              <div class="kv"><span class="k">Distance</span><span class="v mono">${waypoints[waypoints.length-1].dist.toFixed(0)}<span class="u">m</span></span></div>
              <div class="kv"><span class="k">Max Alt</span><span class="v mono">${Math.max(...waypoints.map(w=>w.alt)).toFixed(0)}<span class="u">m</span></span></div>
              <div class="kv"><span class="k">Est. Time</span><span class="v mono">${(waypoints[waypoints.length-1].dist/5).toFixed(0)}<span class="u">s</span></span></div>
            </div>
            <div style="margin-top:14px;">
              <div class="popup-title">Default Altitude</div>
              <input class="input" type="number" value="25" style="width:100%;"/>
              <div class="popup-title" style="margin-top:10px;">Flight Speed</div>
              <input class="input" type="number" value="5" style="width:100%;"/>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  root.querySelector('#addWp').addEventListener('click', () => {
    const last = waypoints[waypoints.length - 1];
    const newId = (waypoints[waypoints.length - 1]?.id || 0) + 1;
    waypoints.push({
      id: newId, action: 'WAYPOINT', alt: 25,
      lat: last.lat + 0.0005, lon: last.lon + 0.0005,
      dist: (last.dist + 80),
    });
    renderPlanView(root);
  });

  root.querySelector('#uploadWp').addEventListener('click', () => {
    const s = getState();
    if (!(s && s.connected)) {
      alert('请先连接飞控');
      return;
    }
    alert('任务上传尚未实现, 需先实现 MAVLink MISSION_PROTOCOL');
  });

  root.querySelectorAll('button[data-act="del"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      waypoints = waypoints.filter(w => w.id !== id);
      renderPlanView(root);
    });
  });
}