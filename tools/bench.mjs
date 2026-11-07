#!/usr/bin/env node
/**
 * 解析吞吐基准。
 *   node tools/bench.mjs                 # 20 万行
 *   node tools/bench.mjs --lines 500000
 *   node tools/bench.mjs --format json
 *
 * 说明：这是 Node 端的纯解析+聚合速度，浏览器里还多一层 Worker 传输，
 * 所以真实数字会略低，量级参考。
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLine } from "../src/core/parser.js";
import { createAccumulator } from "../src/core/accumulator.js";
import { formatNumber } from "../src/core/format.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const lineCount = Number(arg("--lines", 200000));
const format = arg("--format", "auto");
const source = resolve(rootDir, "demo/sample.log");

if (!existsSync(source)) {
  console.error("找不到 demo/sample.log，先运行 npm run gen:demo");
  process.exit(1);
}

const baseLines = readFileSync(source, "utf8").split("\n").filter(Boolean);
const lines = [];
for (let i = 0; i < lineCount; i++) lines.push(baseLines[i % baseLines.length]);

console.log("LogLens 解析基准");
console.log("  输入：" + formatNumber(lines.length) + " 行（格式 " + format + "）");

const accumulator = createAccumulator();
let parsed = 0;
let failed = 0;
const startedAt = process.hrtime.bigint();

for (const line of lines) {
  const result = parseLine(line, format);
  if (result.ok) {
    parsed += 1;
    accumulator.add(result.entry);
  } else {
    failed += 1;
  }
}

const stats = accumulator.finish();
const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
const perSecond = Math.round((lines.length / elapsedMs) * 1000);

console.log("  解析：" + formatNumber(parsed) + " 行，失败 " + formatNumber(failed) + " 行");
console.log("  耗时：" + elapsedMs.toFixed(0) + " ms");
console.log("  速度：" + formatNumber(perSecond) + " 行/秒（约 " + (perSecond / 1e6).toFixed(2) + " M 行/秒）");
console.log("  内存：常驻 " + (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1) + " MB");
console.log("  校验：总请求 " + formatNumber(stats.total) + "，独立路径 " + formatNumber(stats.distinctPaths) + "，错误率 " + (stats.errorRate * 100).toFixed(2) + "%");
