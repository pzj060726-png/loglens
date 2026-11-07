import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNginxTime,
  parseRequest,
  parseCombinedLine,
  parseCommonLine,
  parseJsonLine,
  parseLine,
  parseText
} from "../src/core/parser.js";

const COMBINED =
  '203.0.113.24 - - [08/Nov/2026:02:15:31 +0800] "GET /api/products?page=2 HTTP/1.1" 200 1523 "https://shop.example.com/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" 0.032';

test("parseNginxTime 处理时区偏移", () => {
  assert.equal(parseNginxTime("08/Nov/2026:02:15:31 +0800"), Date.UTC(2026, 10, 7, 18, 15, 31));
  assert.equal(parseNginxTime("08/Nov/2026:02:15:31 -0500"), Date.UTC(2026, 10, 8, 7, 15, 31));
  assert.equal(parseNginxTime("garbage"), null);
  assert.equal(parseNginxTime("32/Nov/2026:02:15:31 +0800"), null);
});

test("parseRequest 拆出 path 与 query", () => {
  assert.deepEqual(parseRequest("GET /api/products?page=2 HTTP/1.1"), {
    method: "GET",
    path: "/api/products",
    query: "page=2",
    proto: "HTTP/1.1"
  });
  assert.equal(parseRequest("-").path, null);
});

test("parseCombinedLine 解析完整字段", () => {
  const entry = parseCombinedLine(COMBINED);
  assert.ok(entry);
  assert.equal(entry.ip, "203.0.113.24");
  assert.equal(entry.method, "GET");
  assert.equal(entry.path, "/api/products");
  assert.equal(entry.query, "page=2");
  assert.equal(entry.status, 200);
  assert.equal(entry.bytes, 1523);
  assert.equal(entry.ms, 32);
  assert.equal(entry.referer, "https://shop.example.com/");
  assert.match(entry.ua, /Mozilla/);
  assert.equal(entry.time, Date.UTC(2026, 10, 7, 18, 15, 31));
});

test("parseCombinedLine 支持缺省 request_time 与 - 字节数", () => {
  const line =
    '198.51.100.7 - - [08/Nov/2026:03:00:00 +0800] "POST /api/cart HTTP/1.1" 201 - "-" "curl/8.4.0"';
  const entry = parseCombinedLine(line);
  assert.ok(entry);
  assert.equal(entry.bytes, null);
  assert.equal(entry.ms, null);
  assert.equal(entry.referer, null);
});

test("parseCommonLine 解析 Apache 通用格式", () => {
  const entry = parseCommonLine(
    '192.0.2.10 - frank [08/Nov/2026:04:00:00 +0800] "GET /index.html HTTP/1.0" 304 0'
  );
  assert.ok(entry);
  assert.equal(entry.method, "GET");
  assert.equal(entry.path, "/index.html");
  assert.equal(entry.status, 304);
  assert.equal(entry.referer, null);
  assert.equal(entry.ua, null);
});

test("parseJsonLine 兼容字段别名", () => {
  const line = JSON.stringify({
    remote_addr: "203.0.113.9",
    time_iso8601: "2026-11-08T02:15:31+08:00",
    request: "GET /api/orders?limit=20 HTTP/2.0",
    status: 502,
    body_bytes_sent: 87,
    request_time: 1.25,
    http_referer: "https://shop.example.com/cart",
    http_user_agent: "Mozilla/5.0"
  });
  const entry = parseJsonLine(line);
  assert.ok(entry);
  assert.equal(entry.ip, "203.0.113.9");
  assert.equal(entry.path, "/api/orders");
  assert.equal(entry.query, "limit=20");
  assert.equal(entry.status, 502);
  assert.equal(entry.bytes, 87);
  assert.equal(entry.ms, 1250);
  assert.equal(entry.time, Date.parse("2026-11-08T02:15:31+08:00"));
});

test("parseJsonLine 接受毫秒时间戳与数字秒时间戳", () => {
  const ms = Date.UTC(2026, 10, 7, 18, 15, 31);
  assert.equal(parseJsonLine(JSON.stringify({ time: ms, status: 200, path: "/x" })).time, ms);
  assert.equal(parseJsonLine(JSON.stringify({ time: ms / 1000, status: 200, path: "/x" })).time, ms);
});

test("parseJsonLine 拒绝非对象与缺字段", () => {
  assert.equal(parseJsonLine("[1,2,3]"), null);
  assert.equal(parseJsonLine("not json"), null);
  assert.equal(parseJsonLine(JSON.stringify({ hello: "world" })), null);
});

test("parseLine auto 依次尝试三种格式", () => {
  assert.equal(parseLine(COMBINED).format, "combined");
  assert.equal(parseLine('192.0.2.10 - - [08/Nov/2026:04:00:00 +0800] "GET / HTTP/1.1" 200 12').format, "common");
  assert.equal(parseLine('{"status":200,"path":"/"}').format, "json");
  assert.equal(parseLine("hello world").ok, false);
});

test("parseLine 强制格式时不回退", () => {
  const result = parseLine(COMBINED, "json");
  assert.equal(result.ok, false);
});

test("parseText 统计成功/失败并保留坏行样本", () => {
  const text = [COMBINED, "broken line", "", '{"status":200,"path":"/"}', COMBINED].join("\n");
  const result = parseText(text);
  assert.equal(result.total, 4);
  assert.equal(result.parsed, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.bad.length, 1);
  assert.equal(result.bad[0].lineNo, 2);
  assert.equal(result.detectedFormats.combined, 2);
  assert.equal(result.detectedFormats.json, 1);
});
