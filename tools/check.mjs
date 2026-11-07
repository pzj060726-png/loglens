#!/usr/bin/env node
/**
 * 上线前自检：模块能不能 import、示例日志能不能解析、关键文件在不在。
 * 不依赖任何测试框架，CI 和本地都用它做一次快速冒烟。
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

async function check(label, fn) {
  try {
    const detail = await fn();
    console.log("  ok   " + label + (detail ? "  " + detail : ""));
  } catch (error) {
    failures.push(label + "：" + error.message);
    console.log("  fail " + label + "  " + error.message);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

console.log("LogLens 自检");

const modules = [
  ["src/core/format.js", ["formatNumber", "formatBytes", "formatMs", "formatCompact", "formatPercent", "formatDateTime", "formatClock", "formatDuration"]],
  ["src/core/parser.js", ["parseLine", "parseText", "parseCombinedLine", "parseCommonLine", "parseJsonLine", "parseNginxTime", "parseRequest"]],
  ["src/core/detect.js", ["detectFormat"]],
  ["src/core/accumulator.js", ["createAccumulator", "percentiles", "chooseBucketSec"]],
  ["src/core/stats.js", ["aggregate", "percentiles", "chooseBucketSec"]]
];

for (const [file, exportsList] of modules) {
  await check("import " + file, async () => {
    const mod = await import(new URL("../" + file, import.meta.url));
    for (const name of exportsList) {
      expect(typeof mod[name] === "function", "缺少导出 " + name);
    }
    return exportsList.length + " 个导出";
  });
}

await check("解析 demo/sample.log", async () => {
  const { parseText } = await import(new URL("../src/core/parser.js", import.meta.url));
  const { aggregate } = await import(new URL("../src/core/stats.js", import.meta.url));
  const demoPath = resolve(rootDir, "demo/sample.log");
  expect(existsSync(demoPath), "示例日志缺失，请先运行 npm run gen:demo");
  const text = readFileSync(demoPath, "utf8");
  const parsed = parseText(text);
  expect(parsed.total > 1000, "示例日志行数太少：" + parsed.total);
  expect(parsed.failed === 0, "示例日志出现无法解析的行：" + parsed.failed);
  const stats = aggregate(parsed.entries);
  expect(stats.total === parsed.parsed, "聚合数量与解析数量不一致");
  expect(stats.timeRange && stats.timeRange.durationMs > 0, "缺少时间范围");
  expect(stats.timeline.buckets.length > 10, "时间轴桶数太少");
  expect(stats.topPaths.length > 0, "Top 路径为空");
  expect(stats.latency && stats.latency.p95 > 0, "缺少延迟统计");
  return parsed.parsed + " 行 / " + stats.timeline.buckets.length + " 个时间桶";
});

await check("页面资源齐全", () => {
  const files = ["index.html", "assets/style.css", "assets/app.js", "assets/charts.js", "src/worker/parse.worker.js", "demo/sample.log"];
  for (const file of files) {
    expect(existsSync(resolve(rootDir, file)), "缺少 " + file);
  }
  return files.length + " 个文件";
});

if (failures.length) {
  console.error("\n自检失败 " + failures.length + " 项：");
  for (const failure of failures) console.error("  - " + failure);
  process.exit(1);
}
console.log("\n全部通过");
