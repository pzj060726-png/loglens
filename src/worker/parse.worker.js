/**
 * 解析 Worker。
 *
 * 主线程负责读文件、切行、按批发送；这里逐行解析并增量聚合，
 * 只把统计结果和少量样本回传 —— 日志内容不会整份留在内存里。
 */

import { parseLine } from "../core/parser.js";
import { detectFormat } from "../core/detect.js";
import { createAccumulator } from "../core/accumulator.js";

let format = "auto";
let detected = null;
let formatLocked = false;
let accumulator = null;
let bad = [];
let parsed = 0;
let failed = 0;
let seen = 0;
let sample = [];
let sampleLimit = 1500;
let startedAt = 0;

function reset(options = {}) {
  format = options.format || "auto";
  detected = null;
  formatLocked = format !== "auto";
  accumulator = createAccumulator(options.accumulator || {});
  bad = [];
  parsed = 0;
  failed = 0;
  seen = 0;
  sample = [];
  sampleLimit = options.sampleLimit ?? 1500;
  startedAt = Date.now();
}

/** 第一批数据里挑前 20 行识别格式，一次就够 */
function maybeDetect(lines) {
  if (detected) return;
  const probe = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    probe.push(line);
    if (probe.length >= 20) break;
  }
  if (!probe.length) return;
  detected = detectFormat(probe);
  if (detected.format !== "unknown") format = detected.format;
  formatLocked = true;
}

function handleChunk(lines) {
  if (!accumulator) reset({});
  maybeDetect(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    seen += 1;
    const result = parseLine(line, format);
    if (result.ok) {
      parsed += 1;
      accumulator.add(result.entry);
      if (sample.length < sampleLimit) sample.push(result.entry);
    } else {
      failed += 1;
      if (bad.length < 50) {
        bad.push({ lineNo: seen, text: line.slice(0, 300), reason: result.reason });
      }
    }
  }

  if (sample.length) {
    self.postMessage({ type: "sample", entries: sample });
    sample = [];
  }
  self.postMessage({ type: "progress", lines: seen, parsed, failed });
}

self.onmessage = (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;

  if (message.type === "init") {
    reset(message.options || {});
    return;
  }

  if (message.type === "chunk") {
    handleChunk(message.lines || []);
    return;
  }

  if (message.type === "done") {
    if (!accumulator) reset({});
    const stats = accumulator.finish();
    self.postMessage({
      type: "done",
      result: {
        stats,
        bad,
        parsed,
        failed,
        lines: seen,
        format: detected ? detected.format : format,
        confidence: detected ? detected.confidence : null,
        elapsedMs: Date.now() - startedAt
      }
    });
  }
};
