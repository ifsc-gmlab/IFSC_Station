// widgets/map.js — FlightMap (QGC 风格真实地图)
// 瓦片源: 高德地图 (GCJ-02 火星坐标系)
// 交互 / 比例尺 / 地图类型参考 QGroundControl FlightMap.qml + MapScale.qml
//
// 替换旧的"假地图"(SVG 网格 + 模拟色块), 加载真实 XYZ 瓦片:
//   - 拖动平移 (QGC PanGesture)
//   - 滚轮/按钮缩放 (QGC zoomLevel += 0.5)
//   - 跟踪飞行器 (QGC keepMapCenteredOnVehicle)
//   - 航迹 / HOME / 飞行器覆盖层, 比例尺, 地图源切换
//
// 注意: MAVLink/GPS 数据是 WGS-84 坐标系, 高德瓦片是 GCJ-02 坐标系,
// 渲染时需要对所有坐标做 WGS-84 → GCJ-02 转换以避免 ~300-500m 偏移.

import { perf } from '../perf.js';

const TILE = 256;              // 瓦片像素 (QGC averageSize = 256)
const MIN_ZOOM = 1;
const MAX_ZOOM = 18;           // 高德瓦片最大 18 级
const INITIAL_ZOOM = 15;       // 未连接时默认级别
const FOLLOW_ZOOM = 17;        // 首次定位飞行器时缩放到该级别

// 默认中心 (未连接飞行器时) — 与 PlanView 默认航点区域一致 (IFSC 实验室)
// 存 WGS-84, 渲染时转 GCJ-02
const DEFAULT_CENTER = { lat: 30.2741, lon: 120.1551 };

// ---- 瓦片源: 高德地图 ----
// Hybrid: 卫星影像 (style=6) + 路网标注叠加 (style=8)
// 子域名稳定性: webst01-04 在部分网络环境连接不稳, 需失败自动换子域名重试
const AMAP_SUBS = ['01', '02', '03', '04'];
const amapFailCount = {};     // 子域名 → 连续失败次数
const amapSick = new Set();   // 连续失败被剔除的子域名 (临时)
const AMAP_FAIL_LIMIT = 2;    // 连续失败 N 次 → 剔除该子域名

// ---- 启动健康探测 ----
// 原因: 高德部分子域名在当前网络环境下可能完全不可达 (TCP 通但 TLS/HTTP 无响应,
// 实测 webst02 多次 10s 超时)。若浏览器轮换到它, 每个瓦片请求都会空等超时,
// 地图加载被明显拖慢。方案: 页面加载时并行探测全部子域名, 超时/失败的立即
// 加入 amapSick (本次会话内不再使用), 瓦片请求从一开始就避开坏子域。
const PROBE_TIMEOUT_MS = 2500;
const PROBE_TILE = { z: 12, x: 3415, y: 1686 };   // 杭州实验室附近 z12 瓦片 (固定坐标, 存在)
async function probeAmapSub(sub) {
  // &probe=1 标记: sw.js 识别后走真实网络 (不读缓存), 保证探测结果反映实际连通性
  const url = `https://webst${sub}.is.autonavi.com/appmaptile?style=6&x=${PROBE_TILE.x}&y=${PROBE_TILE.y}&z=${PROBE_TILE.z}&probe=1`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (r.body) await r.body.cancel();   // headers 已到达即视为可达, 不下载瓦片内容
  } catch {
    amapFailCount[sub] = (amapFailCount[sub] || 0) + 1;
    amapSick.add(sub);
    console.warn(`[QGC-WEB] 高德子域名 webst${sub} 健康探测失败, 本次会话已剔除`);
  } finally {
    clearTimeout(timer);
  }
}
// 模块加载即启动探测 (不阻塞页面, 结果在首次瓦片渲染前大概率就绪)
for (const s of AMAP_SUBS) probeAmapSub(s);

// 从健康子域名池中轮换 (避开近期失败的)
function amapSub(x, y, retry) {
  const pool = AMAP_SUBS.filter(s => !amapSick.has(s));
  const list = pool.length ? pool : AMAP_SUBS;  // 全被剔除时回退全部
  return list[(x + y + (retry || 0)) % list.length];
}

function buildAmapUrl(style, z, x, y, retry) {
  return `https://webst${amapSub(x, y, retry)}.is.autonavi.com/appmaptile?style=${style}&x=${x}&y=${y}&z=${z}`;
}

const PROVIDERS = {
  hybrid: {
    key: 'hybrid',
    label: 'Hybrid',
    attribution: '\u00a9 高德地图',
    url: (z, x, y) => buildAmapUrl(6, z, x, y, 0),
    overlay: (z, x, y) => buildAmapUrl(8, z, x, y, 0),
  },
};

// ---- WGS-84 → GCJ-02 坐标转换 (火星坐标系) ----
const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function _transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function _transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

function wgs84ToGcj02(lng, lat) {
  // 境外不转换
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) {
    return { lng, lat };
  }
  let dlat = _transformLat(lng - 105.0, lat - 35.0);
  let dlng = _transformLng(lng - 105.0, lat - 35.0);
  const radlat = lat / 180.0 * PI;
  let magic = Math.sin(radlat);
  magic = 1 - EE * magic * magic;
  const sqrtmagic = Math.sqrt(magic);
  dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI);
  dlng = (dlng * 180.0) / (A / sqrtmagic * Math.cos(radlat) * PI);
  return { lng: lng + dlng, lat: lat + dlat };
}

// ---- Web Mercator 投影 (QGC MapProvider.cpp: long2tileX / lat2tileY) ----
function lon2px(lon, z) {
  return (lon + 180) / 360 * Math.pow(2, z) * TILE;
}
function lat2px(lat, z) {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z) * TILE;
}
function px2lon(px, z) {
  return px / (Math.pow(2, z) * TILE) * 360 - 180;
}
function px2lat(py, z) {
  const n = Math.PI - 2 * Math.PI * py / (Math.pow(2, z) * TILE);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// QGC MapScale.qml _scaleLengthsMeters
const SCALE_M = [5, 10, 25, 50, 100, 150, 250, 500, 1000, 2000, 5000,
  10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000];

function formatMeters(m) {
  if (m >= 1000) {
    if (m >= 100000) return Math.round(m / 1000) + ' km';
    return (m / 1000).toFixed(1) + ' km';
  }
  return m + ' m';
}

export function createMap(container) {
  // ---------------- DOM ----------------
  const viewport = document.createElement('div');
  viewport.className = 'map-viewport';

  const tileLayer = document.createElement('div');
  tileLayer.className = 'map-tiles';

  const labelLayer = document.createElement('div');   // 标注叠加层 (路网 + 注记)
  labelLayer.className = 'map-tiles-overlay';

  const svgNS = 'http://www.w3.org/2000/svg';
  const overlay = document.createElementNS(svgNS, 'svg');
  overlay.setAttribute('class', 'map-overlay');
  overlay.innerHTML = `
    <defs>
      <radialGradient id="vehGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#be781c" stop-opacity=".45"/>
        <stop offset="100%" stop-color="#be781c" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <g id="mTrail"></g>
    <g id="mHome" style="display:none">
      <circle r="14" fill="rgba(0,224,75,.18)"/>
      <circle r="6" fill="#00e04b" stroke="#fff" stroke-width="1.5"/>
      <circle r="2" fill="#fff"/>
      <text x="0" y="-12" text-anchor="middle" fill="#00e04b" font-family="Open Sans" font-size="10" font-weight="700">HOME</text>
    </g>
    <g id="mVehicle" style="display:none">
      <g id="mVehicleGlow"><circle r="26" fill="url(#vehGlow)"/></g>
      <g id="mVehicleIcon">
        <circle cx="0" cy="0" r="7" fill="#ffffff" stroke="#000000" stroke-width="1.5"/>
        <path d="M 0 -13 L 3 -2 L 13 0 L 3 2 L 0 13 L -3 2 L -13 0 L -3 -2 Z"
              fill="#ffffff" stroke="#000000" stroke-width="1"/>
        <line x1="-20" y1="0" x2="-9" y2="0" stroke="#be781c" stroke-width="2"/>
        <line x1="9" y1="0" x2="20" y2="0" stroke="#be781c" stroke-width="2"/>
        <circle cx="0" cy="0" r="2" fill="#be781c"/>
      </g>
    </g>
    <!-- GCS 定位标记 (QGC FlightMap.qml: MapQuickItem + QGCLogo; 有 heading 时旋转) -->
    <g id="mGCS" style="display:none">
      <circle r="12" fill="rgba(83,109,255,.22)"/>
      <g id="mGCSIcon">
        <circle cx="0" cy="0" r="6" fill="#ffffff" stroke="#00427F" stroke-width="2"/>
        <path d="M 0 -10 L 2.5 -2 L 10 0 L 2.5 2 L 0 10 L -2.5 2 L -10 0 L -2.5 -2 Z" fill="#00427F"/>
        <circle cx="0" cy="0" r="1.8" fill="#ffffff"/>
      </g>
    </g>
  `;
  const mTrail = overlay.querySelector('#mTrail');
  // 航迹路径元素: 固定复用, 每帧用 setAttribute('d') 更新 — 比每次 innerHTML 重建整组 path 便宜得多
  const trailShadow = document.createElementNS(svgNS, 'path');
  trailShadow.setAttribute('fill', 'none');
  trailShadow.setAttribute('stroke', 'rgba(0,0,0,.45)');
  trailShadow.setAttribute('stroke-width', '4');
  trailShadow.setAttribute('opacity', '.5');
  trailShadow.setAttribute('transform', 'translate(0,1)');
  const trailMain = document.createElementNS(svgNS, 'path');
  trailMain.setAttribute('fill', 'none');
  trailMain.setAttribute('stroke', '#be781c');
  trailMain.setAttribute('stroke-width', '2.5');
  trailMain.setAttribute('stroke-linecap', 'round');
  trailMain.setAttribute('stroke-linejoin', 'round');
  trailMain.setAttribute('style', 'filter: drop-shadow(0 0 3px rgba(190,120,28,.5))');
  mTrail.append(trailShadow, trailMain);
  // 航迹缓存: 相同长度 + 相同尾点 + 相同中心 时跳过重建 (飞行器静止 / 中心未动时零成本)
  let trailCache = { len: -1, lastLat: NaN, lastLon: NaN, cLat: NaN, cLon: NaN };
  const mHome = overlay.querySelector('#mHome');
  const mVehicle = overlay.querySelector('#mVehicle');
  const mVehicleIcon = overlay.querySelector('#mVehicleIcon');
  const mGCS = overlay.querySelector('#mGCS');
  const mGCSIcon = overlay.querySelector('#mGCSIcon');

  const attrEl = document.createElement('div');
  attrEl.className = 'map-attribution';

  // 离线/瓦片加载失败提示 (网络不可用时避免反复请求瓦片 + 控制台刷错误)
  const offlineEl = document.createElement('div');
  offlineEl.className = 'map-offline';
  offlineEl.textContent = '地图瓦片加载失败 (网络不可用)';
  offlineEl.style.display = 'none';

  const scaleEl = document.createElement('div');
  scaleEl.className = 'map-scale-bar';
  scaleEl.innerHTML = `
    <div class="ms-text">0 m</div>
    <div class="ms-line"><span class="ms-end"></span><span class="ms-mid"></span><span class="ms-end"></span></div>
  `;
  const msText = scaleEl.querySelector('.ms-text');
  const msMid = scaleEl.querySelector('.ms-mid');

  viewport.append(tileLayer, labelLayer, overlay, attrEl, scaleEl, offlineEl);
  container.appendChild(viewport);

  // ---------------- 视图状态 ----------------
  // 所有坐标存储为 WGS-84 (与 MAVLink/GPS 一致), 渲染时按需转 GCJ-02
  const view = {
    provider: 'hybrid',
    zoom: INITIAL_ZOOM,
    center: { ...DEFAULT_CENTER },
    follow: true,
    initialized: false,    // 首次收到飞行器位置
    vehicleSeen: false,    // 是否已收到有效飞行器位置 (QGC firstVehiclePositionReceived)
    gcsCentered: false,    // 是否已响应首次 GCS 位置 (QGC firstGCSPositionReceived)
    offline: false,        // 连续瓦片加载失败 → 停止请求新瓦片并显示提示
    W: 0, H: 0,
  };

  const tiles = new Map();     // tileKey -> <img> (底图)
  const labels = new Map();    // tileKey -> <img> (标注叠加层)
  let lastT = null;
  let lastGCS = null;          // 最近有效 GCS 位置 (QGC gcsPosition)
  let panStart = null;         // {x, y, clat, clon} — 存 WGS-84

  function size() {
    const r = viewport.getBoundingClientRect();
    view.W = r.width;
    view.H = r.height;
  }

  function clampZoom(z) { return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)); }

  function zoomSplit() {
    const z0 = Math.floor(view.zoom);
    return { z0, s: Math.pow(2, view.zoom - z0) };
  }

  // 将 WGS-84 中心转为 GCJ-02 投影中心 (用于瓦片计算)
  function gcjCenter() {
    const gc = wgs84ToGcj02(view.center.lon, view.center.lat);
    return { cx: lon2px(gc.lng, zoomSplit().z0), cy: lat2px(gc.lat, zoomSplit().z0) };
  }

  // 地理坐标 (WGS-84) -> 屏幕坐标 (基于 GCJ-02 瓦片网格)
  function toScreen(lat, lon) {
    const gc = wgs84ToGcj02(lon, lat);
    const { z0, s } = zoomSplit();
    const { cx, cy } = gcjCenter();
    return [view.W / 2 + (lon2px(gc.lng, z0) - cx) * s, view.H / 2 + (lat2px(gc.lat, z0) - cy) * s];
  }

  // 屏幕坐标 -> 地理坐标 (WGS-84 逆转换)
  function toLatLon(sx, sy) {
    const { z0, s } = zoomSplit();
    const { cx, cy } = gcjCenter();
    // 从屏幕反算得到 GCJ-02 经纬度
    const gcjLon = px2lon(cx + (sx - view.W / 2) / s, z0);
    const gcjLat = px2lat(cy + (sy - view.H / 2) / s, z0);
    // GCJ-02 → WGS-84 近似逆转换 (迭代一次精度足够, 误差 < 1m)
    const wgs = gcj02ToWgs84(gcjLon, gcjLat);
    return { lat: wgs.lat, lon: wgs.lng };
  }

  // GCJ-02 → WGS-84 逆转换 (用差分法迭代一次)
  function gcj02ToWgs84(lng, lat) {
    if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) {
      return { lng, lat };
    }
    const gc = wgs84ToGcj02(lng, lat);
    const dLng = gc.lng - lng;
    const dLat = gc.lat - lat;
    return { lng: lng - dLng, lat: lat - dLat };
  }

  // ---------------- 瓦片渲染 ----------------
  let tileFailCount = 0;   // 连续失败计数 — 网络不可用时快速进入离线模式, 不再刷请求/报错

  function setOffline(on) {
    if (view.offline === on) return;
    view.offline = on;
    offlineEl.style.display = on ? '' : 'none';
  }

  function createTileImg() {
    const img = document.createElement('img');
    img.className = 'map-tile';
    img.draggable = false;
    img.alt = '';
    img.addEventListener('load', () => {
      img.style.opacity = '1';
      // 加载成功 → 该子域名恢复健康
      const m = /webst(\d+)/.exec(img.src);
      if (m) { amapFailCount[m[1]] = 0; amapSick.delete(m[1]); }
    });
    img.addEventListener('error', () => {
      // 子域名不稳: 换其它子域名重试 (最多 2 次)
      const m = /webst(\d+)/.exec(img.src);
      if (m) {
        const sub = m[1];
        amapFailCount[sub] = (amapFailCount[sub] || 0) + 1;
        if (amapFailCount[sub] >= AMAP_FAIL_LIMIT && amapSick.size < AMAP_SUBS.length - 1) {
          amapSick.add(sub);
          console.warn(`[QGC-WEB] 高德子域名 webst${sub} 连接不稳定, 已切换其它子域名`);
        }
        if (!view.offline && img._retries < 2 && img._tile) {
          const t = img._tile;
          img.src = buildAmapUrl(t.style, t.z, t.x, t.y, ++img._retries);
          return;  // 等待重试结果
        }
      }
      img.style.opacity = '0';
      if (!view.offline && ++tileFailCount >= 4) {
        setOffline(true);
      }
    });
    return img;
  }

  function renderTiles() {
    if (view.W <= 0 || view.H <= 0) return;
    const { z0, s } = zoomSplit();
    const n = 1 << z0;
    // 使用 GCJ-02 坐标计算瓦片网格
    const { cx, cy } = gcjCenter();
    const x0 = cx - view.W / 2 / s;
    const y0 = cy - view.H / 2 / s;
    const x1 = x0 + view.W / s;
    const y1 = y0 + view.H / s;
    const tx0 = Math.floor(x0 / TILE);
    const tx1 = Math.floor(x1 / TILE);
    const ty0 = Math.max(0, Math.floor(y0 / TILE));
    const ty1 = Math.min(n - 1, Math.floor(y1 / TILE));

    const provider = PROVIDERS[view.provider];
    const needed = new Set();
    const tileSize = TILE * s;
    const maxTiles = 128;
    let count = 0;
    for (let ty = ty0; ty <= ty1 && count < maxTiles; ty++) {
      for (let tx = tx0; tx <= tx1 && count < maxTiles; tx++) {
        const wx = ((tx % n) + n) % n;
        const key = `${view.provider}/${z0}/${wx}/${ty}`;
        needed.add(key);
        count++;
        const left = ((tx * TILE - x0) * s).toFixed(1);
        const top = ((ty * TILE - y0) * s).toFixed(1);

        let img = tiles.get(key);
        if (!img && !view.offline) {
          img = createTileImg();
          img._tile = { style: 6, z: z0, x: wx, y: ty };
          img._retries = 0;
          img.src = provider.url(z0, wx, ty);
          tiles.set(key, img);
        }
        if (!img) continue;  // 离线模式: 不再请求新瓦片, 只更新已缓存的
        img.style.left = left + 'px';
        img.style.top = top + 'px';
        img.style.width = tileSize.toFixed(1) + 'px';
        img.style.height = tileSize.toFixed(1) + 'px';
        tileLayer.appendChild(img);

        // 标注叠加层 (路网 + 注记, style=8)
        if (provider.overlay) {
          let limg = labels.get(key);
          if (!limg && !view.offline) {
            limg = createTileImg();
            limg._tile = { style: 8, z: z0, x: wx, y: ty };
            limg._retries = 0;
            limg.src = provider.overlay(z0, wx, ty);
            labels.set(key, limg);
          }
          if (!limg) continue;
          limg.style.left = left + 'px';
          limg.style.top = top + 'px';
          limg.style.width = tileSize.toFixed(1) + 'px';
          limg.style.height = tileSize.toFixed(1) + 'px';
          labelLayer.appendChild(limg);
        }
      }
    }
    for (const [k, img] of tiles) {
      if (!needed.has(k)) { img.remove(); tiles.delete(k); }
    }
    for (const [k, img] of labels) {
      if (!needed.has(k)) { img.remove(); labels.delete(k); }
    }
  }

  // ---------------- 覆盖层 (航迹 / HOME / 飞行器) ----------------
  function drawTelemetry(t) {
    const connected = !!(t && t.connected && t.path && t.path.length);
    if (!connected) {
      mVehicle.style.display = 'none';
      mHome.style.display = 'none';
      mTrail.innerHTML = '';
      trailCache = { len: -1, lastLat: NaN, lastLon: NaN, cLat: NaN, cLon: NaN };
      return;
    }
    const n = t.path.length;
    const last = t.path[n - 1];
    // 性能: 只有 航迹长度 / 尾点坐标 / 地图中心 三者之一变化时才重建 d 字符串.
    // follow 模式下中心恒等于尾点, 飞行器静止时整段航迹坐标不变 → 跳过重建 (每帧零成本).
    const changed = n !== trailCache.len ||
                    last.lat !== trailCache.lastLat || last.lon !== trailCache.lastLon ||
                    view.center.lat !== trailCache.cLat || view.center.lon !== trailCache.cLon;
    if (changed) {
      perf.trailRebuild++;
      // toScreen 内部已做 WGS-84 → GCJ-02 转换
      let d = '';
      for (let i = 0; i < n; i++) {
        const p = t.path[i];
        const [sx, sy] = toScreen(p.lat, p.lon);
        d += (i === 0 ? 'M' : 'L') + sx.toFixed(1) + ',' + sy.toFixed(1) + ' ';
      }
      trailShadow.setAttribute('d', d);
      trailMain.setAttribute('d', d);
      trailCache = { len: n, lastLat: last.lat, lastLon: last.lon,
                     cLat: view.center.lat, cLon: view.center.lon };
    } else {
      perf.trailSkip++;
    }

    const home = (t.home && (t.home.lat !== 0 || t.home.lon !== 0)) ? t.home : null;
    if (home) {
      const [hx, hy] = toScreen(home.lat, home.lon);
      mHome.style.display = '';
      mHome.setAttribute('transform', `translate(${hx.toFixed(1)},${hy.toFixed(1)})`);
    } else {
      mHome.style.display = 'none';
    }

    const [vx, vy] = toScreen(last.lat, last.lon);
    mVehicle.style.display = '';
    mVehicle.setAttribute('transform', `translate(${vx.toFixed(1)},${vy.toFixed(1)})`);
    const yawDeg = ((t.attitude.yaw * 180 / Math.PI) + 360) % 360;
    mVehicleIcon.setAttribute('transform', `rotate(${yawDeg.toFixed(1)})`);
  }

  // ---------------- 覆盖层: GCS 定位标记 (QGC gcsPosition) ----------------
  function drawGCS() {
    if (!lastGCS) {
      mGCS.style.display = 'none';
      return;
    }
    // toScreen 内部已做 WGS-84 → GCJ-02 转换
    const [gx, gy] = toScreen(lastGCS.lat, lastGCS.lon);
    mGCS.style.display = '';
    mGCS.setAttribute('transform', `translate(${gx.toFixed(1)},${gy.toFixed(1)})`);
    if (lastGCS.heading != null && !isNaN(lastGCS.heading)) {
      // QGC: 有 heading 时用 QGCLogoArrow 并旋转
      mGCSIcon.setAttribute('transform', `rotate(${lastGCS.heading.toFixed(1)})`);
    } else {
      mGCSIcon.removeAttribute('transform');
    }
  }

  // ---------------- 比例尺 (QGC MapScale.qml) ----------------
  function renderScale() {
    const mpp = 156543.03392 * Math.cos(view.center.lat * Math.PI / 180) / Math.pow(2, view.zoom);
    const metersFor100px = mpp * 100;
    let rounded = SCALE_M[SCALE_M.length - 1];
    for (let i = 0; i < SCALE_M.length - 1; i++) {
      if (metersFor100px < (SCALE_M[i] + SCALE_M[i + 1]) / 2) { rounded = SCALE_M[i]; break; }
    }
    msText.textContent = formatMeters(rounded);
    msMid.style.width = Math.max(30, Math.min(200, rounded / mpp)).toFixed(1) + 'px';
  }

  function renderAll() {
    renderTiles();
    renderScale();
    drawTelemetry(lastT);
    drawGCS();
  }

  // ---------------- 交互 (QGC 手势) ----------------
  function onPointerDown(e) {
    if (e.button !== 0) return;
    view.follow = false;
    panStart = { x: e.clientX, y: e.clientY, clat: view.center.lat, clon: view.center.lon };
    viewport.classList.add('panning');
    try { viewport.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!panStart) return;
    const { z0, s } = zoomSplit();
    // 拖拽时使用 GCJ-02 投影重算中心, 然后逆转为 WGS-84 存储
    const gc = wgs84ToGcj02(panStart.clon, panStart.clat);
    const cx = lon2px(gc.lng, z0) - (e.clientX - panStart.x) / s;
    const cy = lat2px(gc.lat, z0) - (e.clientY - panStart.y) / s;
    // 从 GCJ-02 像素反推到 GCJ-02 经纬度, 再转为 WGS-84 存储
    const gcjLon = px2lon(cx, z0);
    const gcjLat = px2lat(cy, z0);
    const wgs = gcj02ToWgs84(gcjLon, gcjLat);
    view.center.lat = wgs.lat;
    view.center.lon = wgs.lng;
    renderAll();
  }

  function onPointerEnd() {
    panStart = null;
    viewport.classList.remove('panning');
  }

  function onWheel(e) {
    e.preventDefault();
    view.follow = false;
    const rect = viewport.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? -0.5 : 0.5);
  }

  function zoomAt(sx, sy, dz) {
    const wgs = toLatLon(sx, sy);
    view.zoom = clampZoom(view.zoom + dz);
    const { z0, s } = zoomSplit();
    const gc = wgs84ToGcj02(wgs.lon, wgs.lat);
    const cx = lon2px(gc.lng, z0) - (sx - view.W / 2) / s;
    const cy = lat2px(gc.lat, z0) - (sy - view.H / 2) / s;
    const wgs2 = gcj02ToWgs84(px2lon(cx, z0), px2lat(cy, z0));
    view.center.lat = wgs2.lat;
    view.center.lon = wgs2.lng;
    renderAll();
  }

  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerEnd);
  viewport.addEventListener('pointercancel', onPointerEnd);
  viewport.addEventListener('wheel', onWheel, { passive: false });

  const ro = new ResizeObserver(() => { size(); renderAll(); });
  ro.observe(viewport);

  // 网络恢复 → 退出离线模式并重新拉取瓦片
  window.addEventListener('online', () => {
    tileFailCount = 0;
    setOffline(false);
    renderTiles();
  });

  // ---------------- 遥测更新 ----------------
  function update(t) {
    lastT = t;
    if (!t || !t.connected || !t.path || !t.path.length) {
      drawTelemetry(t);
      drawGCS();
      return;
    }
    view.vehicleSeen = true;   // QGC firstVehiclePositionReceived
    const last = t.path[t.path.length - 1];
    if (view.follow) {
      if (!view.initialized) {
        view.center.lat = last.lat;
        view.center.lon = last.lon;
        view.zoom = FOLLOW_ZOOM;
        view.initialized = true;
        renderAll();
      } else {
        // 位移阈值检测: 用 GCJ-02 投影差判断
        const { z0, s } = zoomSplit();
        const gc = wgs84ToGcj02(view.center.lon, view.center.lat);
        const gcLast = wgs84ToGcj02(last.lon, last.lat);
        const dx = Math.abs(lon2px(gcLast.lng, z0) - lon2px(gc.lng, z0)) * s;
        const dy = Math.abs(lat2px(gcLast.lat, z0) - lat2px(gc.lat, z0)) * s;
        view.center.lat = last.lat;
        view.center.lon = last.lon;
        if (dx > 8 || dy > 8) renderTiles();
        renderScale();
        drawTelemetry(t);
      }
    } else {
      drawTelemetry(t);
    }
  }

  // ---------------- 初始化 ----------------
  attrEl.textContent = PROVIDERS[view.provider].attribution;
  size();
  renderTiles();
  renderScale();

  return {
    update,
    zoomIn:  () => { view.follow = false; zoomAt(view.W / 2, view.H / 2, 0.5); },
    zoomOut: () => { view.follow = false; zoomAt(view.W / 2, view.H / 2, -0.5); },
    zoomBy:  (d) => { view.follow = false; zoomAt(view.W / 2, view.H / 2, d > 0 ? 0.5 : -0.5); },
    centerVehicle: () => {
      view.follow = true;
      view.initialized = true;
      if (lastT && lastT.connected && lastT.path && lastT.path.length) {
        const last = lastT.path[lastT.path.length - 1];
        view.center.lat = last.lat;
        view.center.lon = last.lon;
      }
      renderAll();
    },
    getProvider: () => view.provider,
    setProvider: (key) => {
      if (!PROVIDERS[key] || key === view.provider) return;
      view.provider = key;
      attrEl.textContent = PROVIDERS[key].attribution;
      for (const [, img] of tiles) { img.remove(); }
      tiles.clear();
      for (const [, img] of labels) { img.remove(); }
      labels.clear();
      renderTiles();
    },
    // GCS 定位 (QGC gcsPositionChanged): 更新标记, 无飞行器位置时首次居中到 GCS
    setGCSPosition: (gcs) => {
      lastGCS = gcs || null;
      // QGC FlightMap.qml onGcsPositionChanged:
      //   allowGCSLocationCenter && !firstGCSPositionReceived && !firstVehiclePositionReceived -> center = gcsPosition
      if (gcs && view.follow && !view.vehicleSeen && !view.gcsCentered) {
        view.gcsCentered = true;
        view.center.lat = gcs.lat;
        view.center.lon = gcs.lon;
        renderTiles();
        renderScale();
      }
      drawGCS();  // 必须在 center 可能更新之后调用, 确保标记位于正确位置
    },
    getMetersPerPixel: () =>
      156543.03392 * Math.cos(view.center.lat * Math.PI / 180) / Math.pow(2, view.zoom),
  };
}
