// compass.js — 圆形罗盘 (QGC custom-example 风格)
// 仿 QGC CustomFlyViewOverlay.compassBackground + compassBezel + headingNeedle
//   - 外圈 bezel (qgcPal.text 描边)
//   - N/S/E/W 文字标签
//   - 中央红色指北针 (旋转到当前 heading)

export function createCompass(container) {
  let canvas = container.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
  }
  const ctx = canvas.getContext('2d');
  let raf = null;
  let lastYaw = 0;

  // 用 ResizeObserver 监听容器尺寸变化 (响应式关键)
  let pendingResize = false;
  function scheduleResize() {
    if (pendingResize) return;
    pendingResize = true;
    requestAnimationFrame(() => { pendingResize = false; resize(); });
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(d) {
    if (!d) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    if (w <= 0 || h <= 0) return;
    const cx = w / 2, cy = h / 2;
    let r = Math.min(w, h) / 2 - 6;
    if (r < 8) r = 8;

    // 累积 yaw
    if (typeof d.yaw === 'number' && isFinite(d.yaw)) {
      lastYaw += angleDelta(lastYaw, d.yaw) * 0.2;
      lastYaw = wrapPi(lastYaw);
    }
    const headingDeg = (lastYaw * 180 / Math.PI + 360) % 360;

    ctx.clearRect(0, 0, w, h);

    // ---- 罗盘 dial 旋转 (QGC compassBackground: bezel 内旋转刻度) ----
    // lastYaw 是弧度 (-π..π), 直接 rotate 即可
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-lastYaw);

    // 外圈
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,20,20,0.4)';
    ctx.fill();

    // 刻度线 (每 10°, 主刻度 30°)
    for (let a = 0; a < 360; a += 10) {
      const rad = (a - 90) * Math.PI / 180;
      const isMajor = (a % 90 === 0);
      const isMid   = (a % 30 === 0);
      const len = isMajor ? r * 0.13 : (isMid ? r * 0.09 : r * 0.04);
      const inner = r - 2 - len;
      const x1 = Math.cos(rad) * (r - 2);
      const y1 = Math.sin(rad) * (r - 2);
      const x2 = Math.cos(rad) * inner;
      const y2 = Math.sin(rad) * inner;
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = isMajor ? '#fff' : (isMid ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)');
      ctx.lineWidth = isMajor ? 1.6 : 1;
      ctx.stroke();
    }

    // 方位标签 (N E S W) — N 在顶部, 因为 dial 已经旋转到 0°=机头朝上
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.max(10, r * 0.12)}px "Open Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelOffset = r - r * 0.18;
    ctx.fillText('N', 0, -labelOffset);
    ctx.fillText('E', labelOffset, 0);
    ctx.fillText('S', 0, labelOffset);
    ctx.fillText('W', -labelOffset, 0);

    // 副方位 NE/SE/SW/NW
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `600 ${Math.max(8, r * 0.08)}px "Open Sans", sans-serif`;
    const diag = (r - r * 0.18) * 0.72;
    ctx.fillText('NE', diag, -diag);
    ctx.fillText('SE', diag, diag);
    ctx.fillText('SW', -diag, diag);
    ctx.fillText('NW', -diag, -diag);

    ctx.restore();

    // ---- 中央指北针 (QGC headingNeedle 风格, 不旋转) ----
    ctx.save();
    ctx.translate(cx, cy);
    // 红色指北针 (飞机当前航向)
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.78);
    ctx.lineTo(-r * 0.08, r * 0.05);
    ctx.lineTo(0, -r * 0.02);
    ctx.lineTo(r * 0.08, r * 0.05);
    ctx.closePath();
    ctx.fillStyle = '#f32836';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.fill(); ctx.stroke();
    // 暗色南针
    ctx.beginPath();
    ctx.moveTo(0, r * 0.78);
    ctx.lineTo(-r * 0.05, -r * 0.02);
    ctx.lineTo(0, r * 0.02);
    ctx.lineTo(r * 0.05, -r * 0.02);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
    // 中心点
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2, r * 0.025), 0, Math.PI * 2);
    ctx.fillStyle = '#00427F';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // ---- 顶部固定航向数字 (QGC headingLabel 风格) ----
    ctx.save();
    ctx.translate(cx, cy - r + Math.max(2, r * 0.04));
    const lblW = Math.max(28, r * 0.32);
    const lblH = Math.max(12, r * 0.10);
    ctx.fillStyle = '#000';
    ctx.fillRect(-lblW / 2, 0, lblW, lblH);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.max(9, lblH * 0.7)}px "Open Sans", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(headingDeg)).padStart(3, '0') + '°', 0, lblH / 2);
    ctx.restore();

    // ---- 外圈高光 ----
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function tick() {
    const state = window.__qgc_lastTelemetry;
    if (state && state.attitude) draw(state.attitude);
    raf = requestAnimationFrame(tick);
  }

  // 用 ResizeObserver 监听容器尺寸变化
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(scheduleResize);
    ro.observe(container);
  }
  window.addEventListener('resize', scheduleResize);
  // 初始 size - 多延迟一次, 等布局完成
  requestAnimationFrame(() => requestAnimationFrame(() => { resize(); tick(); }));

  return {
    destroy() { if (raf) cancelAnimationFrame(raf); },
    resize: scheduleResize,
  };
}

function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

