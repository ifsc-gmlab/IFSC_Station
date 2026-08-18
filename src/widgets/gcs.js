// widgets/gcs.js — GCS 定位模块 (对应 QGC QGCPositionManager)
// QGC 参考: src/PositionManager/PositionManager.cpp + src/FlightMap/FlightMap.qml
//   - 系统定位源 (Qt: QGeoPositionInfoSource / Web: navigator.geolocation)
//   - 精度过滤: MinHorizonalAccuracyMeters = 100, 精度 > 100m 的位置丢弃
//   - 无效坐标过滤: |lat| > 0.001 && |lon| > 0.001
//   - 暴露 gcsPosition / gcsHeading, 供地图绘制 GCS 标记与首次居中

const MIN_HORIZONTAL_ACCURACY = 100;   // QGC PositionManager::MinHorizonalAccuracyMeters

let state = null;          // { lat, lon, accuracy, heading, timestamp } — 最近一个有效位置
const watchers = new Set();
let watchId = null;

function isValidCoordinate(lat, lon) {
  // QGC _positionUpdated: 过滤近似 0,0 的无效坐标
  return Math.abs(lat) > 0.001 && Math.abs(lon) > 0.001;
}

function handlePosition(pos) {
  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;
  const accuracy = pos.coords.accuracy || Infinity;
  // QGC: 水平精度 > 100m 时 gcsPosition 保持上一个有效值 (不更新)
  if (accuracy > MIN_HORIZONTAL_ACCURACY) return;
  if (!isValidCoordinate(lat, lon)) return;
  state = {
    lat,
    lon,
    accuracy,
    heading: pos.coords.heading,     // 可能为 null (静止/无罗盘), 标记不旋转
    timestamp: pos.timestamp,
  };
  for (const cb of watchers) cb(state);
}

/** 获取最近一个有效的 GCS 位置 (无则为 null) */
export function getGCSPosition() { return state; }

/**
 * 订阅 GCS 位置更新 (QGC: gcsPositionChanged 信号)。
 * 全局单例: 首次调用启动 watchPosition, 后续调用只追加订阅者。
 */
export function startGCS(onUpdate) {
  watchers.add(onUpdate);
  if (state) onUpdate(state);
  if (watchId !== null) return;      // 已在监听
  if (!('geolocation' in navigator)) return;   // 浏览器不支持定位
  watchId = navigator.geolocation.watchPosition(
    handlePosition,
    () => { /* 定位失败 / 用户拒绝: 静默, 不显示 GCS 标记 (QGC _error 仅告警) */ },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
  );
}
