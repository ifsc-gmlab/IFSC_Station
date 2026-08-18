// attitude.js — 人工地平仪 (Artificial Horizon)
// 仿 QGC custom-example: CustomArtificialHorizon + CustomAttitudeWidget
// 天空 (#0a2e50 -> #2f85d4) + 大地 (#897459 -> #4b3820) + dial + crosshair

export function createAttitude(container) {
  // 复用已有 canvas
  let canvas = container.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
  }
  const ctx = canvas.getContext('2d');
  let raf = null;
  let lastRoll = 0, lastPitch = 0, lastYaw = 0;

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
    let r = Math.min(w, h) / 2 - 4;
    if (r < 8) r = 8;

    // 平滑过渡 (lerp)
    if (typeof d.roll === 'number' && isFinite(d.roll))
      lastRoll  += (d.roll  - lastRoll)  * 0.25;
    if (typeof d.pitch === 'number' && isFinite(d.pitch))
      lastPitch += (d.pitch - lastPitch) * 0.25;
    if (typeof d.yaw === 'number' && isFinite(d.yaw)) {
      lastYaw   += angleDelta(lastYaw, d.yaw) * 0.25;
      lastYaw   = wrapPi(lastYaw);
    }

    ctx.clearRect(0, 0, w, h);

    // ---- 圆形剪裁区 (QGC CustomArtificialHorizon + OpacityMask) ----
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // 天地背景 (QGC skyColor1/2, groundColor1/2)
    const pitchPx = lastPitch * (r / 3) * (180 / Math.PI);
    const horizonY = cy + pitchPx;

    // 天空: 顶部深蓝 -> 底部亮蓝
    const skyGrad = ctx.createLinearGradient(0, cy - r, 0, horizonY);
    skyGrad.addColorStop(0, '#0a2e50');
    skyGrad.addColorStop(1, '#2f85d4');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    // 大地: 顶部浅褐 -> 底部深褐
    const gndGrad = ctx.createLinearGradient(0, horizonY, 0, cy + r);
    gndGrad.addColorStop(0, '#897459');
    gndGrad.addColorStop(1, '#4b3820');
    ctx.fillStyle = gndGrad;
    ctx.fillRect(cx - r, horizonY, r * 2, r * 2);

    // 滚转旋转 (QGC Rotation { angle: -rollAngle })
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-lastRoll);
    ctx.translate(-cx, -cy);

    // 地平线 (白色)
    ctx.beginPath();
    ctx.moveTo(cx - r, horizonY);
    ctx.lineTo(cx + r, horizonY);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 俯仰刻度 (QGC QGCPitchIndicator 风格)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.font = `${Math.max(8, r * 0.06)}px "Open Sans", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let p = -30; p <= 30; p += 10) {
      if (p === 0) continue;
      const y = horizonY + p * (r / 3);
      const w1 = (p === -20 || p === 20) ? r * 0.4 : r * 0.27;
      ctx.beginPath();
      ctx.moveTo(cx - w1 / 2, y);
      ctx.lineTo(cx + w1 / 2, y);
      ctx.stroke();
      ctx.fillText(String(Math.abs(p)), cx + w1 / 2 + r * 0.08, y);
      ctx.fillText(String(Math.abs(p)), cx - w1 / 2 - r * 0.08, y);
    }
    ctx.restore();

    ctx.restore(); // 取消圆形剪裁

    // ---- 仪表 dial 圈 (QGC instrumentDial 滚转旋转) ----
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-lastRoll);

    // 外圈 (深)
    ctx.beginPath();
    ctx.arc(0, 0, r - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 滚转刻度
    for (let a = -60; a <= 60; a += 10) {
      const rad = (a - 90) * Math.PI / 180;
      const tickLen = (a % 30 === 0) ? r * 0.1 : r * 0.06;
      const inner = r - 2 - tickLen;
      ctx.beginPath();
      ctx.moveTo(Math.cos(rad) * (r - 2), Math.sin(rad) * (r - 2));
      ctx.lineTo(Math.cos(rad) * inner, Math.sin(rad) * inner);
      ctx.strokeStyle = a === 0 ? '#fbbf24' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = a === 0 ? 2 : 1;
      ctx.stroke();
      if (a % 30 === 0 && a !== 0) {
        ctx.save();
        ctx.translate(Math.cos(rad) * (r - r * 0.14), Math.sin(rad) * (r - r * 0.14));
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `${Math.max(7, r * 0.06)}px "Open Sans", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.abs(a)), 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();

    // ---- 顶部指针 (QGC attitude_pointer) ----
    ctx.save();
    ctx.translate(cx, cy - r + r * 0.06);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.03);
    ctx.lineTo(-r * 0.04, r * 0.04);
    ctx.lineTo(r * 0.04, r * 0.04);
    ctx.closePath();
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.restore();

    // ---- 十字准星 (QGC attitude_crosshair, 不旋转) ----
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = Math.max(1.5, r * 0.013);
    ctx.lineCap = 'round';
    // 水平线
    ctx.beginPath();
    ctx.moveTo(-r * 0.36, 0); ctx.lineTo(-r * 0.12, 0);
    ctx.moveTo(r * 0.12, 0);  ctx.lineTo(r * 0.36, 0);
    // 垂直短线
    ctx.moveTo(0, -r * 0.015); ctx.lineTo(0, r * 0.015);
    ctx.stroke();
    // 中心点
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2, r * 0.018), 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.restore();

    // ---- 外圈高光 ----
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
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
  // 初始 size - 延迟一次, 等布局完成
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
