// scale.js — Map scale bar widget (QGC MapScale.qml 风格)
// 显示当前缩放比例下的米数, 带 + / - 缩放按钮

const SCALE_M = [5, 10, 25, 50, 100, 150, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000];

function pickScale(metersFor100px) {
  // metersFor100px: 当前 100 像素对应的实际米数
  for (let i = 0; i < SCALE_M.length - 1; i++) {
    if (metersFor100px < (SCALE_M[i] + SCALE_M[i + 1]) / 2) {
      return SCALE_M[i];
    }
  }
  return SCALE_M[SCALE_M.length - 1];
}

function formatMeters(m) {
  if (m >= 1000) {
    if (m >= 100000) return Math.round(m / 1000) + ' km';
    return (m / 1000).toFixed(1) + ' km';
  }
  return m + ' m';
}

export function createScale(container, mapCtl) {
  // 结构: [-] [==== N m ====] [+]
  container.innerHTML = `
    <button class="ms-btn" id="msMinus" title="缩小">−</button>
    <div class="ms-bar" id="msBar">500 m</div>
    <button class="ms-btn" id="msPlus" title="放大">+</button>
  `;

  const bar = container.querySelector('#msBar');
  const plus = container.querySelector('#msPlus');
  const minus = container.querySelector('#msMinus');

  function recalc() {
    if (!mapCtl || !mapCtl.getMetersPerPixel) {
      bar.textContent = '— m';
      return;
    }
    const mpp = mapCtl.getMetersPerPixel();
    // 把比例尺条绘制在 100px 长度上, 计算该长度的实际米数
    const meters = mpp * 100;
    const rounded = pickScale(meters);
    bar.textContent = formatMeters(rounded);
  }

  function zoom(delta) {
    if (mapCtl && mapCtl.zoomBy) mapCtl.zoomBy(delta);
    setTimeout(recalc, 30);
  }
  plus.addEventListener('click', () => zoom(1));
  minus.addEventListener('click', () => zoom(-1));

  // 初始计算 + 周期性更新 (跟随飞控)
  recalc();
  const id = setInterval(recalc, 500);
  return { recalc, destroy() { clearInterval(id); } };
}
