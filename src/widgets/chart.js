// chart.js — 实时曲线 (高度 + 速度)

export function createChart(container, series = ['alt', 'spd']) {
  container.innerHTML = `
    <div class="chart-wrap">
      <canvas id="chartCv"></canvas>
      <div class="chart-legend">
        <span style="color:#22d3ee;" data-series="alt">— ALT (m)</span>
        <span style="color:#f59e0b;" data-series="spd">— SPD (m/s)</span>
      </div>
    </div>
  `;
  const canvas = container.querySelector('#chartCv');
  const ctx = canvas.getContext('2d');
  let raf = null;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    const state = window.__qgc_lastTelemetry;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);

    // 网格
    ctx.strokeStyle = 'rgba(34,211,238,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const y = (h / 8) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let i = 0; i <= 12; i++) {
      const x = (w / 12) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    const trail = state && state.trail ? state.trail : [];
    if (trail.length < 2) return;

    const N = trail.length;
    const altMax = Math.max(60, ...trail.map(s => s.alt)) * 1.1;
    const spdMax = Math.max(15, ...trail.map(s => s.spd)) * 1.1;

    function plot(getter, max, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const v = getter(trail[i]);
        const y = h - (v / max) * (h - 8) - 4;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (series.includes('alt')) plot(s => s.alt, altMax, '#22d3ee');
    if (series.includes('spd')) plot(s => s.spd, spdMax, '#f59e0b');

    // 当前值标线
    const last = trail[trail.length - 1];
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(w - 2, 0); ctx.lineTo(w - 2, h); ctx.stroke();
    ctx.setLineDash([]);
  }

  function tick() {
    draw();
    raf = requestAnimationFrame(tick);
  }
  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(tick);
  return { destroy() { if (raf) cancelAnimationFrame(raf); } };
}