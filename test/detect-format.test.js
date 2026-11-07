import test from "node:test";
import assert from "node:assert/strict";
import { detectFormat } from "../src/core/detect.js";
import { formatNumber, formatBytes, formatCompact, formatMs, formatDuration, formatPercent } from "../src/core/format.js";

const COMBINED =
  '203.0.113.24 - - [08/Nov/2026:02:15:31 +0800] "GET /api/products HTTP/1.1" 200 1523 "-" "curl/8.4.0"';

test("detectFormat 识别 combined / common / json", () => {
  assert.equal(detectFormat([COMBINED, COMBINED]).format, "combined");
  const common = '192.0.2.10 - frank [08/Nov/2026:04:00:00 +0800] "GET / HTTP/1.0" 304 0';
  assert.equal(detectFormat([common, common, common]).format, "common");
  assert.equal(detectFormat(['{"status":200,"path":"/" }', '{"status":500,"path":"/x"}']).format, "json");
  assert.equal(detectFormat(["garbage", "garbage"]).format, "unknown");
  assert.equal(detectFormat([]).format, "unknown");
});

test("formatCompact 压缩大数字", () => {
  assert.equal(formatCompact(999), "999");
  assert.equal(formatCompact(12000), "12K");
  assert.equal(formatCompact(1500000), "1.5M");
});

test("formatNumber / formatBytes / formatMs", () => {
  assert.equal(formatNumber(12345), "12,345");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.50 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.00 MB");
  assert.equal(formatMs(32), "32 ms");
  assert.equal(formatMs(2500), "2.50 s");
});

test("formatDuration 与 formatPercent", () => {
  assert.equal(formatDuration(9000), "9 秒");
  assert.equal(formatDuration(3600 * 1000 + 60 * 1000), "1 小时 1 分");
  assert.equal(formatPercent(0.1234), "12.3%");
});
