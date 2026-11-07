import { createAccumulator, percentiles, chooseBucketSec, STATUS_CLASSES } from "./accumulator.js";

export { percentiles, chooseBucketSec, STATUS_CLASSES };

/**
 * 一次性聚合一批 entry。浏览器里流式解析走 accumulator.js，
 * 这里保留为便捷入口：测试、Node 脚本、导出校验都用它，两边结果形状一致。
 */
export function aggregate(entries, options = {}) {
  const acc = createAccumulator(options);
  for (const entry of entries) acc.add(entry);
  return acc.finish();
}
