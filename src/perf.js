// perf.js — 轻量性能插桩: 零开销整数计数 + 控制台对比报告
//
// 用途: 验证卡顿优化效果. 所有计数均为整数自增 (性能可忽略), 不改变任何运行行为.
// 报告对比口径:
//   旧行为 (优化前)  = 每条遥测消息同步执行一次全部 DOM 操作 (perf.raw)
//   新行为 (优化后)  = rAF 合并 + 缓存跳过后的实际执行次数 (perf.ui 等实测值)
//
// 关键计数含义:
//   raw            emit() 调用次数 = 收到的遥测消息数 (旧行为每次消息都同步更新 UI)
//   ui             rAF 合并后实际执行的 UI 更新次数 (updateIndicators + updateFlyView)
//   paramRender    参数表整表重建次数 (旧行为每个消息都重建, 新行为仅在参数数据变化时)
//   trailRebuild   航迹 path 'd' 重建次数 (旧行为每次消息 innerHTML 重建)
//   trailSkip      航迹重建被缓存跳过次数
//   compassLayout  罗盘条宽度/布局重算次数 (getBoundingClientRect + 9 次宽度写入; 旧行为每次消息一次)
//   compassFrame   罗盘条每帧 transform 写入次数
export const perf = {
  raw: 0,
  ui: 0,
  paramRender: 0,
  trailRebuild: 0,
  trailSkip: 0,
  compassLayout: 0,
  compassFrame: 0,
  startedAt: Date.now(),
};

// 估算每次 UI 更新平均触发的 DOM 写入次数 (textContent/style/attribute/innerHTML)
const UI_WRITES_PER_UPDATE = 35;
const PARAM_ROWS_EST = 30;

function pct(oldV, newV) {
  if (!oldV) return '—';
  return ((1 - newV / oldV) * 100).toFixed(1) + '%';
}

// 打印累计/周期对比报告到控制台
export function perfReport() {
  const s = perf;
  const elapsed = Math.max(1, (Date.now() - s.startedAt) / 1000);
  const rows = [
    ['遥测消息数 (旧=每次同步全量更新)', s.raw, s.raw, ''],
    ['UI 更新 (updateIndicators/FlyView)', s.raw, s.ui, pct(s.raw, s.ui)],
    ['参数表整表重建 (innerHTML)', s.raw, s.paramRender, pct(s.raw, s.paramRender)],
    ['航迹 path 重建', s.raw, s.trailRebuild, pct(s.raw, s.trailRebuild)],
    ['罗盘条布局重算 (getBoundingClientRect)', s.raw, s.compassLayout, pct(s.raw, s.compassLayout)],
    ['罗盘条 transform 写入', s.raw, s.compassFrame, pct(s.raw, s.compassFrame)],
  ];
  const w = 46;
  console.log(`%c[PERF] 累计统计 (运行 ${elapsed.toFixed(0)}s, 消息速率 ${(s.raw / elapsed).toFixed(0)} msg/s)%c`, 'color:#7fd0ff;font-weight:bold', '');
  console.log('='.repeat(w + 34));
  console.log(
    '  操作'.padEnd(30) + '旧行为'.padStart(8) + '新行为'.padStart(10) + '降低'.padStart(10)
  );
  console.log('-'.repeat(w + 34));
  for (const [name, oldV, newV, red] of rows) {
    console.log(
      '  ' + name.padEnd(28) +
      String(oldV).padStart(8) +
      String(newV).padStart(10) +
      red.padStart(10)
    );
  }
  console.log('-'.repeat(w + 34));
  // DOM 总写入量估算: 新 = UI 更新×N + 参数表行数 + 航迹重建 + 罗盘 transform
  const domOld = s.raw * UI_WRITES_PER_UPDATE;
  const domNew = s.ui * UI_WRITES_PER_UPDATE + s.paramRender * PARAM_ROWS_EST + s.trailRebuild * 2 + s.compassFrame;
  console.log(
    '  估算 DOM 写入/秒'.padEnd(30) +
    Math.round(domOld / elapsed).toString().padStart(8) +
    Math.round(domNew / elapsed).toString().padStart(10) +
    pct(Math.round(domOld / elapsed), Math.round(domNew / elapsed)).padStart(10)
  );
  console.log(
    '  (航迹重建跳过次数: ' + s.trailSkip + ')' + '  估算: 每次 UI 更新 ≈' + UI_WRITES_PER_UPDATE + ' 次 DOM 写入'
  );
  console.log('='.repeat(w + 34));
}
