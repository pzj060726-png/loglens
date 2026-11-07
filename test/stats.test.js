import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, percentiles, chooseBucketSec } from "../src/core/stats.js";

const base = Date.UTC(2026, 10, 7, 18, 0, 0);

function entry(overrides) {
  return {
    ip: "203.0.113.1",
    time: base,
    method: "GET",
    path: "/",
    query: null,
    status: 200,
    bytes: 100,
    ms: 20,
    referer: null,
    ua: null,
    ...overrides
  };
}

test("percentiles 计算 P50/P95/P99", () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  const stats = percentiles(values, [50, 95, 99]);
  assert.equal(stats.p50, 50);
  assert.equal(stats.p95, 95);
  assert.equal(stats.p99, 99);
  assert.deepEqual(percentiles([]), {});
});

test("chooseBucketSec 控制在最大桶数内", () => {
  assert.equal(chooseBucketSec(30 * 1000, 120), 1);
  assert.equal(chooseBucketSec(3600 * 1000, 120), 30);
  assert.equal(chooseBucketSec(24 * 3600 * 1000, 120), 900);
});

test("aggregate 汇总状态码、错误率与流量", () => {
  const entries = [
    entry({ status: 200 }),
    entry({ status: 200 }),
    entry({ status: 404, path: "/missing" }),
    entry({ status: 500, path: "/api/orders" }),
    entry({ status: 301, bytes: 0 })
  ];
  const stats = aggregate(entries);
  assert.equal(stats.total, 5);
  assert.equal(stats.statusClasses["2xx"], 2);
  assert.equal(stats.statusClasses["3xx"], 1);
  assert.equal(stats.statusClasses["4xx"], 1);
  assert.equal(stats.statusClasses["5xx"], 1);
  assert.equal(stats.clientErrors, 1);
  assert.equal(stats.serverErrors, 1);
  assert.equal(stats.errorRate, 0.4);
  assert.equal(stats.bytes, 400);
  assert.equal(stats.statusCodes[0].count, 2);
});

test("aggregate 计算 Top 列表并带上错误数", () => {
  const entries = [
    entry({ path: "/a" }),
    entry({ path: "/a" }),
    entry({ path: "/a", status: 500 }),
    entry({ path: "/b", status: 404 })
  ];
  const stats = aggregate(entries, { topN: 2 });
  assert.equal(stats.topPaths.length, 2);
  assert.deepEqual(stats.topPaths[0], { key: "/a", count: 3, errors: 1 });
  assert.equal(stats.topPaths[1].key, "/b");
  assert.equal(stats.distinctPaths, 2);
  assert.equal(stats.methods[0].key, "GET");
});

test("aggregate 生成时间轴与 QPS", () => {
  const entries = [];
  for (let i = 0; i < 10; i++) {
    entries.push(entry({ time: base + i * 1000 }));
  }
  const stats = aggregate(entries);
  assert.ok(Math.abs(stats.qps - 10 / 9) < 1e-9);
  assert.equal(stats.timeRange.durationMs, 9000);
  assert.ok(stats.timeline.bucketMs > 0);
  const summed = stats.timeline.buckets.reduce((acc, b) => acc + b.count, 0);
  assert.equal(summed, 10);
  assert.equal(stats.timeline.buckets[0].t % stats.timeline.bucketMs, 0);
});

test("aggregate 直方图与分位数", () => {
  const entries = [5, 20, 120, 400, 900].map((ms) => entry({ ms }));
  const stats = aggregate(entries);
  assert.equal(stats.latency.count, 5);
  assert.equal(stats.latency.max, 900);
  assert.equal(stats.latency.histogram.reduce((acc, b) => acc + b.count, 0), 5);
  assert.ok(stats.latency.avg > 0);
});

test("aggregate 无时间字段时不出时间轴", () => {
  const stats = aggregate([entry({ time: null }), entry({ time: null, status: 404 })]);
  assert.equal(stats.timeRange, null);
  assert.equal(stats.timeline.buckets.length, 0);
  assert.equal(stats.qps, 0);
});
