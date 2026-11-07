/**
 * 增量聚合器。
 *
 * 为什么要它：浏览器里读大文件是按块流式解析的，不能把所有 entry 都存在内存里再算。
 * 所以边解析边累加：状态码计数、Top 列表、每分钟时间轴、延迟抽样。
 * 内存上限：
 *   - Top 映射最多保留 topMapLimit(默认 4000) 个 key，超出后只计数不再新增（capped 标记）；
 *   - 时间轴按秒累加，超过 30 万个桶自动折叠到分钟；
 *   - 延迟值最多保留 latencyCap(默认 20 万) 个，超出改用蓄水池抽样，均值仍是精确值。
 */

export const STATUS_CLASSES = ["1xx", "2xx", "3xx", "4xx", "5xx"];

const HISTOGRAM_EDGES = [0, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, Infinity];
const BUCKET_STEPS_SEC = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400];

export function percentiles(values, points = [50, 95, 99]) {
  const result = {};
  if (!values || !values.length) return result;
  const sorted = Float64Array.from(values).sort();
  for (const p of points) {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    result["p" + p] = sorted[index];
  }
  return result;
}

export function chooseBucketSec(rangeMs, maxBuckets = 120) {
  const rangeSec = Math.max(1, rangeMs / 1000);
  for (const step of BUCKET_STEPS_SEC) {
    if (rangeSec / step <= maxBuckets) return step;
  }
  return BUCKET_STEPS_SEC[BUCKET_STEPS_SEC.length - 1];
}

function statusClassOf(status) {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  if (status >= 200) return "2xx";
  return "1xx";
}

function createTopMap(limit) {
  const map = new Map();
  let capped = false;
  let dropped = 0;
  return {
    add(key, isError) {
      if (key === null || key === undefined) return;
      let item = map.get(key);
      if (!item) {
        if (map.size >= limit) {
          capped = true;
          dropped += 1;
          return;
        }
        item = { key, count: 0, errors: 0 };
        map.set(key, item);
      }
      item.count += 1;
      if (isError) item.errors += 1;
    },
    top(n) {
      return [...map.values()].sort((a, b) => b.count - a.count).slice(0, n);
    },
    get size() {
      return map.size;
    },
    get capped() {
      return capped;
    },
    get dropped() {
      return dropped;
    }
  };
}

export function createAccumulator(options = {}) {
  const maxBuckets = options.maxBuckets ?? 120;
  const topMapLimit = options.topMapLimit ?? 4000;
  const latencyCap = options.latencyCap ?? 200000;
  const maxSeconds = options.maxSeconds ?? 300000;

  const statusClasses = { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  const statusCodes = new Map();
  const paths = createTopMap(topMapLimit);
  const ips = createTopMap(topMapLimit);
  const methods = createTopMap(32);

  let total = 0;
  let bytes = 0;
  let bytesCount = 0;
  let clientErrors = 0;
  let serverErrors = 0;
  let minTime = Infinity;
  let maxTime = -Infinity;
  let timedEntries = 0;

  let latencyCount = 0;
  let latencySum = 0;
  const latencySample = [];

  const secondsMap = new Map();
  let resolutionSec = 1;

  function addLatency(value) {
    latencyCount += 1;
    latencySum += value;
    if (latencySample.length < latencyCap) {
      latencySample.push(value);
    } else {
      const index = Math.floor(Math.random() * latencyCount);
      if (index < latencyCap) latencySample[index] = value;
    }
  }

  function foldSeconds(stepSec) {
    const folded = new Map();
    for (const [sec, bucket] of secondsMap) {
      const key = Math.floor(sec / stepSec) * stepSec;
      const target = folded.get(key);
      if (target) {
        target.count += bucket.count;
        target.errors += bucket.errors;
      } else {
        folded.set(key, { count: bucket.count, errors: bucket.errors });
      }
    }
    secondsMap.clear();
    for (const [key, bucket] of folded) secondsMap.set(key, bucket);
    resolutionSec = stepSec;
  }

  function addTimeline(time, isError) {
    let sec = Math.floor(time / 1000);
    if (secondsMap.size >= maxSeconds && resolutionSec < 60) {
      foldSeconds(60);
    }
    if (resolutionSec > 1) sec = Math.floor(sec / resolutionSec) * resolutionSec;
    let bucket = secondsMap.get(sec);
    if (!bucket) {
      bucket = { count: 0, errors: 0 };
      secondsMap.set(sec, bucket);
    }
    bucket.count += 1;
    if (isError) bucket.errors += 1;
  }

  function add(entry) {
    if (!entry) return;
    total += 1;
    const status = entry.status;
    const hasStatus = Number.isFinite(status);
    const isError = hasStatus && status >= 400;
    if (hasStatus) {
      const cls = statusClassOf(status);
      statusClasses[cls] += 1;
      statusCodes.set(status, (statusCodes.get(status) || 0) + 1);
      if (cls === "4xx") clientErrors += 1;
      if (cls === "5xx") serverErrors += 1;
    }
    paths.add(entry.path, isError);
    ips.add(entry.ip, isError);
    methods.add(entry.method, false);
    if (Number.isFinite(entry.bytes)) {
      bytes += entry.bytes;
      bytesCount += 1;
    }
    if (Number.isFinite(entry.ms)) addLatency(entry.ms);
    if (Number.isFinite(entry.time)) {
      timedEntries += 1;
      if (entry.time < minTime) minTime = entry.time;
      if (entry.time > maxTime) maxTime = entry.time;
      addTimeline(entry.time, isError);
    }
  }

  function finish() {
    const durationMs = timedEntries ? Math.max(0, maxTime - minTime) : 0;
    const bucketSec = Math.max(chooseBucketSec(durationMs, maxBuckets), resolutionSec);
    const bucketMs = bucketSec * 1000;
    const folded = new Map();
    for (const [sec, bucket] of secondsMap) {
      const key = Math.floor(sec / bucketSec) * bucketMs;
      const target = folded.get(key);
      if (target) {
        target.count += bucket.count;
        target.errors += bucket.errors;
      } else {
        folded.set(key, { t: key, count: bucket.count, errors: bucket.errors });
      }
    }
    const timeline = [...folded.values()].sort((a, b) => a.t - b.t);

    let latency = null;
    if (latencyCount) {
      const stats = percentiles(latencySample, [50, 95, 99]);
      const sorted = Float64Array.from(latencySample).sort();
      const histogram = HISTOGRAM_EDGES.slice(0, -1).map((edge, i) => ({
        label: HISTOGRAM_EDGES[i + 1] === Infinity
          ? "≥ " + edge + " ms"
          : edge + "–" + HISTOGRAM_EDGES[i + 1] + " ms",
        count: 0
      }));
      for (const value of sorted) {
        for (let i = 0; i < HISTOGRAM_EDGES.length - 1; i++) {
          if (value >= HISTOGRAM_EDGES[i] && value < HISTOGRAM_EDGES[i + 1]) {
            histogram[i].count += 1;
            break;
          }
        }
      }
      latency = {
        count: latencyCount,
        sampled: latencyCount > latencySample.length,
        avg: latencySum / latencyCount,
        p50: stats.p50,
        p95: stats.p95,
        p99: stats.p99,
        max: sorted[sorted.length - 1],
        histogram
      };
    }

    return {
      total,
      distinctPaths: paths.size,
      distinctIps: ips.size,
      topPathsCapped: paths.capped,
      topIpsCapped: ips.capped,
      statusClasses,
      statusCodes: [...statusCodes.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count || a.code - b.code),
      clientErrors,
      serverErrors,
      errorRate: total ? (clientErrors + serverErrors) / total : 0,
      bytes,
      avgBytes: bytesCount ? bytes / bytesCount : 0,
      qps: timedEntries ? (durationMs > 0 ? total / (durationMs / 1000) : 1) : 0,
      timeRange: timedEntries ? { start: minTime, end: maxTime, durationMs } : null,
      timeline: { bucketMs, buckets: timeline },
      topPaths: paths.top(10),
      topIps: ips.top(10),
      methods: methods.top(10),
      latency
    };
  }

  return { add, finish, get total() { return total; } };
}
