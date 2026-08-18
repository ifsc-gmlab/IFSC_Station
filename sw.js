// sw.js — IFSC-Station 地图瓦片持久化缓存 (Cache API)
//
// 目标: 解决"每次打开页面都要重新从高德下载瓦片"的问题。
// QGC 桌面版用 1GB 本地磁盘缓存 (QGCMapEngine), 瓦片下载一次永久使用;
// 网页版此前只有内存 Map + 浏览器 1 小时 HTTP 缓存, 打开页面就要重下瓦片。
// 本 Service Worker 是 QGC 磁盘缓存的浏览器等价物:
//   策略: 缓存优先 (cache-first)
//     命中   → 直接返回本地缓存 (毫秒级, 无需网络, 可离线)
//     未命中 → 网络请求并写入缓存 (下次命中)
//
// 约束:
//   - 仅在 localhost / https 下生效 (Service Worker 平台限制);
//     file:// 打开时注册失败, 自动降级为无缓存 (照常网络加载)。
//   - 只拦截高德瓦片请求 (webstXX.is.autonavi.com), 其余请求全部放行。

const CACHE_NAME = 'ifsc-tiles-v1';

// 只处理高德瓦片 URL (底图 style=6 / 标注 style=8)
const TILE_PATTERN = /^https:\/\/webst\d{2}\.is\.autonavi\.com\/appmaptile\?/;

// 缓存上限 (条): 超过后删除最早的瓦片, 防止无限增长占用磁盘。
// 地面站常用区域 12-18 级瓦片约几千张, 2 万条余量充足。
const MAX_CACHE_ENTRIES = 20000;

// trim 检查节流: 每写入 N 次才遍历一次 key 列表 (keys() 有成本)
const TRIM_EVERY = 20;
let _writeCount = 0;

// URL 规范化: 把 webst01-04 统一为 webst00 作为缓存 key,
// 同一张瓦片经不同子域加载只缓存一份, 子域切换/失效也不影响缓存命中。
function normalizeUrl(url) {
  return url.replace(/webst\d{2}\.is\.autonavi\.com/, 'webst00.is.autonavi.com');
}

// 健康探测请求 (map.js probeAmapSub 带 &probe=1): 必须走真实网络, 不读缓存
function isProbe(url) {
  return /[?&]probe=1/.test(url);
}

async function trimCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= MAX_CACHE_ENTRIES) return;
    const excess = keys.length - MAX_CACHE_ENTRIES;
    // cache.keys() 顺序近似写入顺序, 删最早的
    for (let i = 0; i < excess && i < 200; i++) {
      await cache.delete(keys[i]);
    }
  } catch {}
}

// 网络获取瓦片: 优先 mode:'cors' 以便校验 status (高德返回 access-control-allow-origin:*);
// CORS 不可用(个别网络环境)时退化为 no-cors, 此时 opaque 响应 status=0, 不会写入缓存。
async function fetchTile(request) {
  try {
    return await fetch(request, { mode: 'cors' });
  } catch {
    return await fetch(request);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = normalizeUrl(request.url);

  // 1) 命中缓存 → 直接返回 (毫秒级, 无需网络, 可离线)
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // 2) 未命中 → 网络请求并写入缓存
  //    cors 成功 (高德返回 access-control-allow-origin:*): 校验 status===200 才缓存
  //    cors 失败退化为 no-cors: 得到 opaque 响应无法校验 status, 但高德瓦片 URL
  //      稳定正确且真正的网络失败不会产生响应, 因此也缓存 (无 CORS 环境同样可持久化)
  const resp = await fetchTile(request);
  if (resp.status === 200 || (resp.type === 'opaque' && resp.status === 0)) {
    const clone = resp.clone();
    await cache.put(cacheKey, clone);
    if (++_writeCount % TRIM_EVERY === 0) trimCache(cache);
  }
  return resp;
}

self.addEventListener('install', () => {
  // 新 SW 立即激活, 不等旧页面全部关闭
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 清理旧版本缓存 (版本号变更时残留的旧瓦片库)
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (!TILE_PATTERN.test(url)) return;   // 非高德瓦片: 放行
  if (isProbe(url)) return;              // 健康探测: 走真实网络, 不读缓存
  event.respondWith(cacheFirst(event.request));
});
