/**
 * LogLens 前端：读文件 → 切行 → 交给 Worker 解析 → 渲染结果。
 * 没有框架，全部用原生 DOM；图表在 charts.js，统计在 src/core。
 */

import {
  formatNumber,
  formatCompact,
  formatBytes,
  formatMs,
  formatPercent,
  formatDateTime,
  formatClock,
  formatDuration
} from "../src/core/format.js";
import { parseLine } from "../src/core/parser.js";
import { detectFormat } from "../src/core/detect.js";
import { createAccumulator } from "../src/core/accumulator.js";
import { createTimelineChart, createDonutChart, createColumnChart } from "./charts.js";

const NS = "http://www.w3.org/2000/svg";
const CHUNK_LINES = 4000;
const SAMPLE_LIMIT = 1500;
const SAMPLE_ROWS = 200;
const REPO_URL = "https://github.com/pzj060726-png/loglens";

const state = {
  worker: null,
  running: false,
  demo: false,
  stats: null,
  sample: [],
  bad: [],
  lines: 0,
  parsed: 0,
  failed: 0,
  format: null,
  confidence: null,
  elapsedMs: 0,
  file: null
};

/* ---------------- DOM 小工具 ---------------- */

function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  appendKids(el, children);
  return el;
}

function appendKids(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendKids(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

function replaceKids(parent, children) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  appendKids(parent, children);
}

const el = (id) => document.getElementById(id);

/* ---------------- 图标 ---------------- */

const ICONS = {
  lens: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"],
  upload: ["M12 15V3", "M7.5 7.5L12 3l4.5 4.5", "M4 21h16"],
  file: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z", "M14 3v5h5"],
  shield: ["M12 3l7 3v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z"],
  cpu: ["M9 8h6v8H9z", "M4 10h2", "M4 14h2", "M18 10h2", "M18 14h2", "M10 4v2", "M14 4v2", "M10 18v2", "M14 18v2", "M4 4h16v16H4z"],
  zap: ["M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z"],
  trend: ["M3 17l5.5-5.5 3.5 3.5L21 6", "M21 11V6h-5"],
  alert: ["M12 4l9 16H3z", "M12 10v4", "M12 17h.01"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  layers: ["M12 3l8.5 4.7L12 12.4 3.5 7.7z", "M3.5 12.5L12 17.2l8.5-4.7"],
  hash: ["M9 3L7 21", "M17 3l-2 18", "M4 9h16", "M3 15h16"],
  globe: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M3.5 9h17", "M3.5 15h17", "M12 3c2.6 2.6 2.6 15.4 0 18", "M12 3c-2.6 2.6-2.6 15.4 0 18"],
  gauge: ["M12 14l4-4", "M4.5 18a9 9 0 1 1 15 0"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"],
  database: ["M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z", "M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6", "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"],
  moon: ["M20.5 13.5A8.5 8.5 0 0 1 10.5 3.5a8.5 8.5 0 1 0 10 10z"],
  sun: ["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z", "M12 2v2", "M12 20v2", "M2 12h2", "M20 12h2", "M5 5l1.5 1.5", "M17.5 17.5L19 19", "M19 5l-1.5 1.5", "M6.5 17.5L5 19"],
  refresh: ["M20 12a8 8 0 1 1-2.3-5.6", "M20 4v4h-4"],
  x: ["M6 6l12 12", "M18 6L6 18"]
};

const GITHUB_PATH =
  "M9 19c-4 1.2-4-2.2-6-2.8M15 21v-3.3c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.8 2.7 5.8 3 5.8 3a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.4 9.4c0 4.6 2.7 5.7 5.5 6-.5.6-.5 1.1-.5 2V21";

function svgNode(name, attrs = {}, paths = []) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const d of paths) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    node.appendChild(path);
  }
  return node;
}

function icon(name, size = 16) {
  if (name === "github") {
    const node = svgNode("svg", {
      viewBox: "0 0 24 24", width: size, height: size, fill: "currentColor",
      "aria-hidden": "true", focusable: "false"
    }, [GITHUB_PATH]);
    return node;
  }
  return svgNode("svg", {
    viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor",
    "stroke-width": 1.7, "stroke-linecap": "round", "stroke-linejoin": "round",
    "aria-hidden": "true", focusable: "false"
  }, ICONS[name] || ICONS.file);
}

function mountIcon(id, name, size) {
  const target = el(id);
  if (target) target.appendChild(icon(name, size || 16));
}

/* ---------------- 主题 ---------------- */

const THEME_KEY = "loglens-theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* 隐私模式下忽略 */ }
  const label = el("themeLabel");
  if (label) label.textContent = theme === "light" ? "浅色" : "深色";
  const slot = el("themeIcon");
  if (slot) replaceKids(slot, icon(theme === "light" ? "moon" : "sun", 15));
  if (state.stats) renderCharts();
}

function initTheme() {
  const params = new URLSearchParams(location.search);
  const forced = params.get("theme");
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* 忽略 */ }
  applyTheme(forced || saved || "dark");
}

/* ---------------- 加载与解析 ---------------- */

function showLoading(file) {
  el("hero").classList.add("hidden");
  el("results").classList.remove("visible");
  el("loading").classList.remove("hidden");
  el("loadingFile").textContent = file.name + " · " + formatBytes(file.size);
  setProgress(0, 0);
}

function setProgress(ratio, lines) {
  const fill = el("progressFill");
  const text = el("progressText");
  const lineText = el("progressLines");
  const percent = Math.max(0, Math.min(100, ratio * 100));
  if (fill) fill.style.width = percent.toFixed(1) + "%";
  if (text) text.textContent = percent.toFixed(0) + "%";
  if (lineText) lineText.textContent = formatNumber(lines) + " 行";
}

function updateProgressBar(bytesRead, totalBytes) {
  if (!totalBytes) return;
  setProgress(bytesRead / totalBytes, state.lines);
}

function notify(title, message, timeout = 9000) {
  const box = document.createElement("div");
  box.className = "toast";
  replaceKids(box, [
    h("strong", { text: title }),
    h("span", { text: message }),
    h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: () => box.remove() }, ["关闭"])
  ]);
  document.body.appendChild(box);
  setTimeout(() => box.remove(), timeout);
  return box;
}

function showError(message) {
  el("loading").classList.add("hidden");
  el("hero").classList.remove("hidden");
  notify("没能完成解析", message);
}

async function streamFile(file, sink) {
  let stream = file.stream();
  if (/\.gz$/i.test(file.name) && typeof DecompressionStream !== "undefined") {
    try {
      stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
    } catch {
      stream = file.stream();
    }
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let carry = "";
  let batch = [];
  let bytesRead = 0;
  let lastTick = performance.now();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    carry += decoder.decode(value, { stream: true });

    let index = carry.indexOf("\n");
    while (index !== -1) {
      const line = carry.slice(0, index).replace(/\r$/, "");
      carry = carry.slice(index + 1);
      batch.push(line);
      if (batch.length >= CHUNK_LINES) {
        sink.chunk(batch);
        batch = [];
      }
      index = carry.indexOf("\n");
    }

    if (performance.now() - lastTick > 80) {
      lastTick = performance.now();
      updateProgressBar(bytesRead, file.size);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  carry += decoder.decode();
  if (carry.length) batch.push(carry.replace(/\r$/, ""));
  if (batch.length) sink.chunk(batch);
}

/** Worker 在 file:// 下会被浏览器拒绝，这里先判断能不能用；?noworker=1 可以验证主线程兜底 */
function canUseWorker() {
  if (typeof Worker === "undefined" || location.protocol === "file:") return false;
  return !new URLSearchParams(location.search).has("noworker");
}

/**
 * 主线程解析器：与 src/worker/parse.worker.js 同一套 core 模块，
 * 接口对齐成 { chunk(lines), finish() } —— 读文件的 streamFile 不关心算力在哪。
 */
function createLocalEngine(handlers) {
  let format = "auto";
  let detected = null;
  const accumulator = createAccumulator({});
  const badSamples = [];
  let parsed = 0;
  let failed = 0;
  let seen = 0;
  let sample = [];
  const startedAt = Date.now();

  function detect(lines) {
    const probe = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      probe.push(line);
      if (probe.length >= 20) break;
    }
    if (!probe.length) return;
    detected = detectFormat(probe);
    if (detected.format !== "unknown") format = detected.format;
  }

  return {
    chunk(lines) {
      if (!detected) detect(lines);
      for (const line of lines) {
        if (!line || !line.trim()) continue;
        seen += 1;
        const result = parseLine(line, format);
        if (result.ok) {
          parsed += 1;
          accumulator.add(result.entry);
          if (sample.length < SAMPLE_LIMIT) sample.push(result.entry);
        } else {
          failed += 1;
          if (badSamples.length < 50) {
            badSamples.push({ lineNo: seen, text: line.slice(0, 300), reason: result.reason });
          }
        }
      }
      if (sample.length) {
        handlers.sample(sample);
        sample = [];
      }
      handlers.progress(seen, parsed, failed);
    },
    finish() {
      handlers.done({
        stats: accumulator.finish(),
        bad: badSamples,
        parsed,
        failed,
        lines: seen,
        format: detected ? detected.format : format,
        confidence: detected ? detected.confidence : null,
        elapsedMs: Date.now() - startedAt
      });
    }
  };
}

function analyzeFile(file, options = {}) {
  if (state.running) return Promise.resolve(false);
  state.running = true;
  state.demo = Boolean(options.demo);
  state.file = file;
  state.sample = [];
  state.bad = [];
  state.lines = 0;
  state.parsed = 0;
  state.failed = 0;

  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }

  showLoading(file);

  return new Promise((resolve) => {
    let finished = false;
    const settle = (ok) => {
      if (finished) return;
      finished = true;
      state.running = false;
      resolve(ok);
    };

    const handlers = {
      sample(entries) {
        for (const entry of entries) {
          if (state.sample.length < SAMPLE_LIMIT) state.sample.push(entry);
        }
      },
      progress(lines, parsed, failed) {
        state.lines = lines;
        state.parsed = parsed;
        state.failed = failed;
        const lineText = el("progressLines");
        if (lineText) lineText.textContent = formatNumber(lines) + " 行";
      },
      done(result) {
        handleDone(result);
        settle(true);
      },
      error(message) {
        showError(message);
        settle(false);
      }
    };

    const streamInto = (engine) => {
      streamFile(file, engine)
        .then(() => engine.finish())
        .catch((error) => handlers.error(error && error.message ? error.message : "读取文件失败"));
    };

    // 主线程兜底：重新从头读，之前半途的样本与统计都要清掉
    const startLocal = (notice) => {
      state.sample = [];
      state.bad = [];
      state.lines = 0;
      state.parsed = 0;
      state.failed = 0;
      if (notice) notify("改为单线程解析", notice, 12000);
      streamInto(createLocalEngine(handlers));
    };

    if (!canUseWorker()) {
      startLocal("浏览器不允许 file:// 页面加载模块 Worker。日志仍在你本机解析，只是大文件会慢一些；用 npm start 打开本地服务器就能用上 Worker。");
      return;
    }

    let worker = null;
    try {
      worker = new Worker(new URL("../src/worker/parse.worker.js", import.meta.url), { type: "module" });
    } catch {
      startLocal("解析线程启动失败，已经改在主线程里跑。");
      return;
    }

    state.worker = worker;
    let cancelled = false;
    let workerDone = false;

    worker.onmessage = (event) => {
      const message = event.data;
      if (!message) return;
      if (message.type === "sample") {
        handlers.sample(message.entries || []);
      } else if (message.type === "progress") {
        handlers.progress(message.lines, message.parsed, message.failed);
      } else if (message.type === "done") {
        workerDone = true;
        handlers.done(message.result);
      }
    };

    // Worker 加载失败（脚本 404、CSP 拦截等）不会走 onerror 之外的路径，这里兜底重试
    worker.onerror = () => {
      if (cancelled || workerDone || finished) return;
      cancelled = true;
      worker.terminate();
      state.worker = null;
      startLocal("解析线程没能启动，已经改在主线程里跑。");
    };

    streamInto({
      chunk(lines) {
        if (!cancelled) worker.postMessage({ type: "chunk", lines });
      },
      finish() {
        if (!cancelled) worker.postMessage({ type: "done" });
      }
    });
  });
}

function handleDone(result) {
  if (!result || !result.stats) {
    showError("解析线程没有返回结果");
    return;
  }
  state.stats = result.stats;
  state.bad = result.bad || [];
  state.lines = result.lines;
  state.parsed = result.parsed;
  state.failed = result.failed;
  state.format = result.format;
  state.confidence = result.confidence;
  state.elapsedMs = result.elapsedMs;

  el("loading").classList.add("hidden");
  el("results").classList.add("visible");
  renderResults();
  document.body.dataset.ready = "1";
}

/* ---------------- 渲染 ---------------- */

function currentColors() {
  const css = getComputedStyle(document.documentElement);
  const read = (name) => css.getPropertyValue(name).trim();
  return {
    accent: read("--accent"),
    accent2: read("--accent-2"),
    ok: read("--ok"),
    warn: read("--warn"),
    bad: read("--bad"),
    info: read("--info"),
    text: read("--text-strong"),
    muted: read("--muted"),
    faint: read("--faint"),
    grid: read("--border")
  };
}

function bucketLabel(bucketMs) {
  if (bucketMs >= 3600000) return (bucketMs / 3600000).toFixed(bucketMs % 3600000 ? 1 : 0) + " 小时";
  if (bucketMs >= 60000) return Math.round(bucketMs / 60000) + " 分钟";
  return Math.round(bucketMs / 1000) + " 秒";
}

const FORMAT_LABEL = {
  combined: "combined（Nginx/Apache 组合格式）",
  common: "common（Apache 通用格式）",
  json: "JSON Lines",
  auto: "自动识别",
  unknown: "未识别"
};

function kpiCard({ label, iconName, value, sub, tone }) {
  return h("div", { class: "kpi" }, [
    h("div", { class: "kpi-label" }, [icon(iconName, 14), h("span", { text: label })]),
    h("div", { class: "kpi-value" + (tone ? " " + tone : ""), text: value }),
    sub ? h("div", { class: "kpi-sub", text: sub }) : null
  ]);
}

function renderResults() {
  const stats = state.stats;
  const isDemo = state.demo;

  el("resultTitle").textContent = isDemo ? "示例日志分析结果" : "分析结果";
  el("resultFile").textContent = state.file.name + " · " + formatBytes(state.file.size) + " · " + formatNumber(state.lines) + " 行";
  el("formatPill").textContent = "格式 " + (FORMAT_LABEL[state.format] || state.format);
  const perSecond = state.elapsedMs > 0 ? Math.round((state.lines / state.elapsedMs) * 1000) : 0;
  el("elapsedPill").textContent = "解析 " + formatMs(state.elapsedMs) + " · " + formatCompact(perSecond) + " 行/秒";

  const successRate = state.lines ? state.parsed / state.lines : 0;
  const duration = stats.timeRange ? formatDuration(stats.timeRange.durationMs) : "无时间字段";
  const kpis = [
    kpiCard({
      label: "总请求数", iconName: "layers", value: formatNumber(stats.total),
      sub: state.lines + " 行中解析成功"
    }),
    kpiCard({
      label: "解析成功率", iconName: "shield", value: formatPercent(successRate, successRate === 1 ? 0 : 2),
      sub: state.failed ? state.failed + " 行无法解析" : "没有坏行",
      tone: state.failed ? (successRate > 0.98 ? "warn" : "bad") : "ok"
    }),
    kpiCard({
      label: "错误请求", iconName: "alert", value: formatPercent(stats.errorRate),
      sub: "4xx " + formatNumber(stats.clientErrors) + " · 5xx " + formatNumber(stats.serverErrors),
      tone: stats.errorRate > 0.05 ? "bad" : stats.errorRate > 0.01 ? "warn" : "ok"
    }),
    kpiCard({
      label: "平均 QPS", iconName: "zap", value: stats.qps >= 100 ? formatNumber(stats.qps) : stats.qps.toFixed(stats.qps >= 1 ? 1 : 2),
      sub: "跨度 " + duration
    }),
    kpiCard({
      label: "响应流量", iconName: "database", value: formatBytes(stats.bytes),
      sub: "平均 " + formatBytes(stats.avgBytes) + " / 请求"
    }),
    kpiCard({
      label: "独立路径", iconName: "hash",
      value: formatNumber(stats.distinctPaths),
      sub: stats.topPathsCapped ? "路径过多，Top 榜已封顶" : "去重后统计"
    }),
    kpiCard({
      label: "独立 IP", iconName: "globe",
      value: formatNumber(stats.distinctIps),
      sub: stats.topIpsCapped ? "IP 过多，Top 榜已封顶" : "去重后统计"
    }),
    kpiCard({
      label: "P95 延迟", iconName: "gauge",
      value: stats.latency ? formatMs(stats.latency.p95) : "—",
      sub: stats.latency
        ? "P99 " + formatMs(stats.latency.p99) + " · 最大 " + formatMs(stats.latency.max)
        : "日志里没有耗时字段",
      tone: stats.latency && stats.latency.p95 > 1000 ? "warn" : undefined
    })
  ];
  replaceKids(el("kpis"), kpis);

  el("timelineHint").textContent = "桶宽 " + bucketLabel(stats.timeline.bucketMs) + " · 红线为错误数";
  el("statusHint").textContent = formatNumber(stats.total) + " 个请求";
  el("codesHint").textContent = stats.statusCodes.length + " 种状态码";
  el("pathsHint").textContent = stats.topPathsCapped ? "Top 10（已封顶）" : "Top 10 / 共 " + formatNumber(stats.distinctPaths) + " 个";
  el("ipsHint").textContent = stats.topIpsCapped ? "Top 10（已封顶）" : "Top 10 / 共 " + formatNumber(stats.distinctIps) + " 个";
  el("sampleHint").textContent = formatNumber(state.sample.length) + " 条样本，最多显示 " + SAMPLE_ROWS + " 条";

  renderCharts();
  renderStatusTable();
  renderTopTables();
  renderMethods();
  renderSampleTable();
  renderBadLines();
}

function renderCharts() {
  const stats = state.stats;
  if (!stats) return;
  const colors = currentColors();

  const timelineHolder = el("timelineChart");
  const timelineWidth = Math.max(280, timelineHolder.clientWidth || 640);
  replaceKids(timelineHolder, createTimelineChart({
    buckets: stats.timeline.buckets,
    width: timelineWidth,
    height: 232,
    colors,
    formatCompact,
    formatClock
  }));

  const classes = [
    ["2xx", stats.statusClasses["2xx"], colors.ok, "成功"],
    ["3xx", stats.statusClasses["3xx"], colors.info, "重定向"],
    ["4xx", stats.statusClasses["4xx"], colors.warn, "客户端错误"],
    ["5xx", stats.statusClasses["5xx"], colors.bad, "服务端错误"],
    ["1xx", stats.statusClasses["1xx"], colors.faint, "信息"]
  ].filter((row) => row[1] > 0);

  replaceKids(el("donutChart"), createDonutChart({
    slices: classes.map((row) => ({ label: row[0], value: row[1], color: row[2] })),
    size: 172,
    thickness: 20,
    colors,
    centerValue: formatCompact(stats.total),
    centerLabel: "请求总数"
  }));

  replaceKids(el("donutLegend"), classes.map((row) => h("div", { class: "legend-row" }, [
    h("span", { class: "legend-dot", style: "background:" + row[2] }),
    h("span", { class: "legend-name", text: row[0] + " " + row[3] }),
    h("span", { class: "legend-count", text: formatNumber(row[1]) }),
    h("span", { class: "legend-pct", text: formatPercent(row[1] / (stats.total || 1), 1) })
  ])));

  const latencyHolder = el("latencyChart");
  const latencyWidth = Math.max(280, latencyHolder.clientWidth || 640);
  if (stats.latency) {
    replaceKids(latencyHolder, createColumnChart({
      items: stats.latency.histogram,
      width: latencyWidth,
      height: 200,
      colors,
      formatCompact,
      unit: "个请求"
    }));
    replaceKids(el("latencyCards"), [
      h("span", { class: "feature-chip" }, ["P50 " + formatMs(stats.latency.p50)]),
      h("span", { class: "feature-chip" }, ["P95 " + formatMs(stats.latency.p95)]),
      h("span", { class: "feature-chip" }, ["P99 " + formatMs(stats.latency.p99)]),
      h("span", { class: "feature-chip" }, ["平均 " + formatMs(stats.latency.avg)]),
      h("span", { class: "feature-chip" }, [
        stats.latency.count + " 个样本" + (stats.latency.sampled ? "（抽样）" : "（全量）")
      ])
    ]);
  } else {
    replaceKids(latencyHolder, [
      h("div", { class: "sample-note", text: "这份日志里没有 request_time / response_time 字段，所以没有延迟统计。加上它就能看到 P50/P95/P99 和直方图。" })
    ]);
    replaceKids(el("latencyCards"), []);
  }
}

function renderStatusTable() {
  const stats = state.stats;
  const total = stats.total || 1;
  const rows = stats.statusCodes.slice(0, 12).map((row) => {
    const cls = row.code >= 500 ? "5xx" : row.code >= 400 ? "4xx" : row.code >= 300 ? "3xx" : row.code >= 200 ? "2xx" : "1xx";
    const names = { "1xx": "信息", "2xx": "成功", "3xx": "重定向", "4xx": "客户端错误", "5xx": "服务端错误" };
    return h("tr", {}, [
      h("td", {}, [h("span", { class: "status-code status-" + cls, text: String(row.code) })]),
      h("td", { text: names[cls] }),
      h("td", { class: "num", text: formatNumber(row.count) }),
      h("td", { class: "num", text: formatPercent(row.count / total) })
    ]);
  });
  replaceKids(el("statusTable"), [
    h("thead", {}, [h("tr", {}, [
      h("th", { text: "状态码" }), h("th", { text: "类别" }), h("th", { class: "num", text: "数量" }), h("th", { class: "num", text: "占比" })
    ])]),
    h("tbody", {}, rows)
  ]);
}

function topRows(items, total, renderName) {
  const max = items.length ? items[0].count : 1;
  return items.map((item, index) => h("tr", {}, [
    h("td", { class: "num", text: String(index + 1) }),
    h("td", {}, [renderName(item, max)]),
    h("td", { class: "num", text: formatNumber(item.count) }),
    h("td", { class: "num" }, [
      item.errors
        ? h("span", { class: "error-chip", text: formatNumber(item.errors) + " 错误" })
        : h("span", { style: "color:var(--faint)", text: "—" })
    ]),
    h("td", { class: "num", text: formatPercent(item.count / (total || 1)) })
  ]));
}

function renderTopTables() {
  const stats = state.stats;

  replaceKids(el("pathsTable"), [
    h("thead", {}, [h("tr", {}, [
      h("th", { class: "num", text: "#" }), h("th", { text: "路径" }),
      h("th", { class: "num", text: "请求" }), h("th", { class: "num", text: "错误" }), h("th", { class: "num", text: "占比" })
    ])]),
    h("tbody", {}, topRows(stats.topPaths, stats.total, (item, max) => h("div", { class: "path-cell" }, [
      h("span", { class: "path-text", text: item.key, title: item.key }),
      h("span", { class: "bar" + (item.errors ? " err" : ""), style: "width:" + Math.max(3, (item.count / max) * 110) + "px" })
    ])))
  ]);

  replaceKids(el("ipsTable"), [
    h("thead", {}, [h("tr", {}, [
      h("th", { class: "num", text: "#" }), h("th", { text: "客户端 IP" }),
      h("th", { class: "num", text: "请求" }), h("th", { class: "num", text: "错误" }), h("th", { class: "num", text: "占比" })
    ])]),
    h("tbody", {}, topRows(stats.topIps, stats.total, (item) => h("span", { class: "mono", text: item.key })))
  ]);
}

function renderMethods() {
  const stats = state.stats;
  const chips = stats.methods.map((item) => h("span", { class: "feature-chip" }, [
    h("strong", { text: item.key || "-" }), " " + formatNumber(item.count)
  ]));
  replaceKids(el("methodsBox"), chips.length ? chips : [h("span", { class: "sample-note", text: "没有方法字段" })]);
}

function filteredSample() {
  const keyword = el("filterInput").value.trim().toLowerCase();
  const statusFilter = el("statusFilter").value;
  return state.sample.filter((entry) => {
    if (statusFilter !== "all") {
      const cls = entry.status >= 500 ? "5xx" : entry.status >= 400 ? "4xx" : entry.status >= 300 ? "3xx" : entry.status >= 200 ? "2xx" : "1xx";
      if (cls !== statusFilter) return false;
    }
    if (!keyword) return true;
    return (
      (entry.path && entry.path.toLowerCase().includes(keyword)) ||
      (entry.ip && entry.ip.toLowerCase().includes(keyword)) ||
      (entry.ua && entry.ua.toLowerCase().includes(keyword)) ||
      (entry.query && entry.query.toLowerCase().includes(keyword))
    );
  });
}

function renderSampleTable() {
  const rows = filteredSample();
  const visible = rows.slice(0, SAMPLE_ROWS).map((entry) => {
    const cls = entry.status >= 500 ? "5xx" : entry.status >= 400 ? "4xx" : entry.status >= 300 ? "3xx" : entry.status >= 200 ? "2xx" : "1xx";
    return h("tr", {}, [
      h("td", { class: "mono", text: formatDateTime(entry.time) }),
      h("td", { class: "mono", text: entry.method || "-" }),
      h("td", {}, [
        h("span", { class: "path-text", text: (entry.path || "-") + (entry.query ? "?" + entry.query : ""), title: entry.path })
      ]),
      h("td", {}, [h("span", { class: "status-code status-" + cls, text: entry.status === null ? "-" : String(entry.status) })]),
      h("td", { class: "num", text: entry.bytes === null || entry.bytes === undefined ? "-" : formatBytes(entry.bytes) }),
      h("td", { class: "num", text: entry.ms === null || entry.ms === undefined ? "-" : formatMs(entry.ms) }),
      h("td", { class: "mono", text: entry.ip || "-" })
    ]);
  });

  replaceKids(el("sampleTable"), [
    h("thead", {}, [h("tr", {}, [
      h("th", { text: "时间" }), h("th", { text: "方法" }), h("th", { text: "路径" }),
      h("th", { text: "状态" }), h("th", { class: "num", text: "大小" }), h("th", { class: "num", text: "耗时" }), h("th", { text: "IP" })
    ])]),
    h("tbody", {}, visible.length ? visible : [h("tr", {}, [h("td", { colspan: "7", text: "没有匹配的样本" })])])
  ]);

  el("sampleNote").textContent = rows.length
    ? "共 " + state.sample.length + " 条样本 · 匹配 " + rows.length + " 条 · 表格只渲染前 " + SAMPLE_ROWS + " 条（完整数据请看导出 CSV）"
    : "共 " + state.sample.length + " 条样本 · 当前过滤条件没有匹配项";
}

function renderBadLines() {
  const card = el("badCard");
  if (!state.failed) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  el("badHint").textContent = formatNumber(state.failed) + " 行 / 共 " + formatNumber(state.lines) + " 行";
  replaceKids(el("badList"), state.bad.map((row) => h("div", { class: "bad-item" }, [
    h("div", { class: "bad-item-head" }, [
      h("span", { text: "第 " + row.lineNo + " 行" }),
      h("span", { class: "pill pill-bad", text: row.reason })
    ]),
    h("div", { class: "bad-line", text: row.text })
  ])));
}

/* ---------------- 导出 ---------------- */

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportCsv() {
  if (!state.stats) return;
  const stats = state.stats;
  const rows = [];
  rows.push(["LogLens 汇总", state.file.name]);
  rows.push(["生成时间", new Date().toISOString()]);
  rows.push([]);
  rows.push(["指标", "值"]);
  rows.push(["总请求数", stats.total]);
  rows.push(["解析行数", state.parsed]);
  rows.push(["失败行数", state.failed]);
  rows.push(["独立路径", stats.distinctPaths]);
  rows.push(["独立 IP", stats.distinctIps]);
  rows.push(["错误率", (stats.errorRate * 100).toFixed(2) + "%"]);
  rows.push(["平均 QPS", stats.qps.toFixed(2)]);
  rows.push(["总流量", stats.bytes]);
  rows.push(["平均请求大小", Math.round(stats.avgBytes)]);
  if (stats.latency) {
    rows.push(["P50 延迟(ms)", stats.latency.p50.toFixed(1)]);
    rows.push(["P95 延迟(ms)", stats.latency.p95.toFixed(1)]);
    rows.push(["P99 延迟(ms)", stats.latency.p99.toFixed(1)]);
  }
  rows.push([]);
  rows.push(["状态码", "数量"]);
  for (const row of stats.statusCodes) rows.push([row.code, row.count]);
  rows.push([]);
  rows.push(["Top 路径", "请求数", "错误数"]);
  for (const row of stats.topPaths) rows.push([row.key, row.count, row.errors]);
  rows.push([]);
  rows.push(["Top IP", "请求数", "错误数"]);
  for (const row of stats.topIps) rows.push([row.key, row.count, row.errors]);
  rows.push([]);
  rows.push(["时间桶(开始)", "请求数", "错误数"]);
  for (const bucket of stats.timeline.buckets) {
    rows.push([new Date(bucket.t).toISOString(), bucket.count, bucket.errors]);
  }
  download("loglens-summary.csv", "\ufeff" + toCsv(rows), "text/csv;charset=utf-8");
}

function exportJson() {
  if (!state.stats) return;
  const payload = {
    tool: "LogLens",
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    file: { name: state.file.name, size: state.file.size },
    parse: {
      format: state.format,
      confidence: state.confidence,
      lines: state.lines,
      parsed: state.parsed,
      failed: state.failed,
      elapsedMs: state.elapsedMs
    },
    stats: state.stats,
    badSamples: state.bad
  };
  download("loglens-report.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

/* ---------------- 事件绑定 ---------------- */

let resizeTimer = null;

function bindEvents() {
  el("pickBtn").addEventListener("click", (event) => {
    event.stopPropagation();
    el("fileInput").click();
  });

  el("demoBtn").addEventListener("click", (event) => {
    event.stopPropagation();
    loadDemo();
  });

  el("fileInput").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) analyzeFile(file);
    event.target.value = "";
  });

  const dropzone = el("dropzone");
  dropzone.addEventListener("click", () => el("fileInput").click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      el("fileInput").click();
    }
  });
  for (const type of ["dragenter", "dragover"]) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragging");
    });
  }
  for (const type of ["dragleave", "dragend"]) {
    dropzone.addEventListener(type, () => dropzone.classList.remove("dragging"));
  }
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) analyzeFile(file);
  });
  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());

  el("themeBtn").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  });

  el("resetBtn").addEventListener("click", () => {
    el("results").classList.remove("visible");
    el("hero").classList.remove("hidden");
    if (state.worker) {
      state.worker.terminate();
      state.worker = null;
    }
    state.stats = null;
    state.sample = [];
    state.bad = [];
    state.running = false;
    delete document.body.dataset.ready;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  el("exportCsvBtn").addEventListener("click", exportCsv);
  el("exportJsonBtn").addEventListener("click", exportJson);

  const onFilter = () => {
    if (state.stats) renderSampleTable();
  };
  el("filterInput").addEventListener("input", onFilter);
  el("statusFilter").addEventListener("change", onFilter);

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.stats) renderCharts();
    }, 150);
  });
}

async function loadDemo() {
  try {
    const response = await fetch("demo/sample.log?ts=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("示例日志读取失败（HTTP " + response.status + "）");
    const text = await response.text();
    const file = new File([text], "sample.log", { type: "text/plain" });
    await analyzeFile(file, { demo: true });
  } catch (error) {
    showError(error && error.message ? error.message : "示例日志加载失败");
  }
}

/* ---------------- 启动 ---------------- */

function init() {
  initTheme();
  mountIcon("brandMark", "lens", 20);
  mountIcon("eyebrowIcon", "shield", 14);
  mountIcon("dropIcon", "upload", 26);
  mountIcon("pickIcon", "file", 15);
  mountIcon("demoIcon", "zap", 15);
  mountIcon("privacyIcon", "shield", 14);
  mountIcon("repoIcon", "github", 15);

  const features = [
    ["cpu", "Web Worker 解析，页面不卡"],
    ["shield", "日志不出浏览器"],
    ["layers", "combined / common / JSON Lines"],
    ["gauge", "P50 / P95 / P99 与直方图"]
  ];
  replaceKids(el("features"), features.map(([name, label]) => h("span", { class: "feature-chip" }, [icon(name, 14), label])));

  bindEvents();

  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "1") {
    loadDemo();
  }
}

init();
