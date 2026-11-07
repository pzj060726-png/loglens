/**
 * 日志行解析器。
 *
 * 支持三种格式：
 *   - combined  Nginx/Apache 组合格式（含 referer、user-agent，可选末尾 request_time）
 *   - common    Apache 通用格式（没有 referer / user-agent）
 *   - json      JSON Lines，每行一个对象
 *
 * 设计要点：
 *   - 纯函数、无 DOM、无副作用，Node 端可以直接测；
 *   - 坏行不抛异常，只返回 { ok: false, reason }，由调用方计数并保留样本。
 */

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

export const COMBINED_RE = /^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"(?: (\d+(?:\.\d+)?))?$/;

export const COMMON_RE = /^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|-)$/;

/** Nginx 时间：08/Nov/2026:02:15:31 +0800 → 毫秒时间戳（UTC） */
export function parseNginxTime(local) {
  if (typeof local !== "string") return null;
  const m = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (month === undefined) return null;
  const day = Number(m[1]);
  const year = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6]);
  if (hh > 23 || mm > 59 || ss > 60 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month, day, hh, mm, ss);
  const offsetMin = (Number(m[8]) * 60 + Number(m[9])) * (m[7] === "-" ? -1 : 1);
  return utc - offsetMin * 60000;
}

/** "GET /path?q=1 HTTP/1.1" → { method, path, query, proto } */
export function parseRequest(raw) {
  if (!raw || raw === "-") return { method: null, path: null, query: null, proto: null };
  const m = /^(\S+)\s+(\S+)(?:\s+(HTTP\/[\d.]+))?$/.exec(raw);
  if (!m) return { method: null, path: raw, query: null, proto: null };
  const target = m[2];
  const q = target.indexOf("?");
  return {
    method: m[1],
    path: q === -1 ? target : target.slice(0, q),
    query: q === -1 ? null : target.slice(q + 1),
    proto: m[3] || null
  };
}

function toInt(value) {
  if (value === "-" || value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildEntry(fields) {
  return {
    ip: fields.ip || null,
    time: fields.time ?? null,
    method: fields.method || null,
    path: fields.path || null,
    query: fields.query || null,
    status: fields.status ?? null,
    bytes: fields.bytes ?? null,
    ms: fields.ms ?? null,
    referer: fields.referer || null,
    ua: fields.ua || null
  };
}

export function parseCombinedLine(line) {
  const m = COMBINED_RE.exec(line);
  if (!m) return null;
  const time = parseNginxTime(m[4]);
  const req = parseRequest(m[5]);
  const rt = m[10] === undefined ? null : Number(m[10]);
  return buildEntry({
    ip: m[1],
    time,
    method: req.method,
    path: req.path,
    query: req.query,
    status: Number(m[6]),
    bytes: toInt(m[7]),
    ms: rt === null ? null : rt * 1000,
    referer: m[8] === "-" ? null : m[8],
    ua: m[9] === "-" ? null : m[9]
  });
}

export function parseCommonLine(line) {
  const m = COMMON_RE.exec(line);
  if (!m) return null;
  const req = parseRequest(m[5]);
  return buildEntry({
    ip: m[1],
    time: parseNginxTime(m[4]),
    method: req.method,
    path: req.path,
    query: req.query,
    status: Number(m[6]),
    bytes: toInt(m[7]),
    referer: null,
    ua: null
  });
}

const JSON_FIELD_ALIASES = {
  ip: ["remote_addr", "client_ip", "ip", "remote_ip"],
  time: ["time_iso8601", "timestamp", "time", "ts", "@timestamp"],
  request: ["request", "request_uri", "uri"],
  method: ["request_method", "method"],
  path: ["path", "uri_path"],
  status: ["status", "status_code", "response_status"],
  bytes: ["body_bytes_sent", "bytes", "size", "body_bytes"],
  ms: ["request_time", "response_time", "latency", "duration"],
  referer: ["http_referer", "referer", "referrer"],
  ua: ["http_user_agent", "user_agent", "ua"]
};

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return undefined;
}

function parseJsonTime(value) {
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  if (typeof value !== "string" || !value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && /^\d+(\.\d+)?$/.test(value)) {
    return asNumber > 1e12 ? asNumber : asNumber * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseJsonLine(line) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const request = pick(obj, JSON_FIELD_ALIASES.request);
  const req = typeof request === "string" ? parseRequest(request) : { method: null, path: null, query: null };
  const rawMs = pick(obj, JSON_FIELD_ALIASES.ms);
  const status = pick(obj, JSON_FIELD_ALIASES.status);
  if (status === undefined && !req.path) return null;
  return buildEntry({
    ip: pick(obj, JSON_FIELD_ALIASES.ip),
    time: parseJsonTime(pick(obj, JSON_FIELD_ALIASES.time)),
    method: pick(obj, JSON_FIELD_ALIASES.method) || req.method,
    path: pick(obj, JSON_FIELD_ALIASES.path) || req.path,
    query: req.query,
    status: status === undefined ? null : Number(status),
    bytes: toInt(pick(obj, JSON_FIELD_ALIASES.bytes)),
    ms: rawMs === undefined ? null : Number(rawMs) * 1000,
    referer: pick(obj, JSON_FIELD_ALIASES.referer),
    ua: pick(obj, JSON_FIELD_ALIASES.ua)
  });
}

/**
 * 解析一行，返回 { ok, entry } 或 { ok: false, reason }。
 * format 为 "auto" 时依次尝试 json → combined → common。
 */
export function parseLine(line, format = "auto") {
  const text = line.trim();
  if (!text) return { ok: false, reason: "空行" };
  const order = format === "auto" ? ["json", "combined", "common"] : [format];
  for (const candidate of order) {
    let entry = null;
    if (candidate === "json") entry = text.startsWith("{") ? parseJsonLine(text) : null;
    else if (candidate === "combined") entry = parseCombinedLine(text);
    else if (candidate === "common") entry = parseCommonLine(text);
    if (entry) {
      if (entry.status === null || !Number.isFinite(entry.status)) {
        return { ok: false, reason: "缺少状态码" };
      }
      return { ok: true, entry, format: candidate };
    }
  }
  return { ok: false, reason: "无法识别的日志行" };
}

/**
 * 解析整段文本。
 * @returns {{ format, total, parsed, failed, entries, bad, detectedFormats }}
 */
export function parseText(text, options = {}) {
  const format = options.format || "auto";
  const maxBadSamples = options.maxBadSamples ?? 50;
  const lines = String(text).split("\n");
  const entries = [];
  const bad = [];
  const formats = {};
  let total = 0;
  let failed = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, "");
    if (!raw.trim()) continue;
    total += 1;
    const result = parseLine(raw, format);
    if (result.ok) {
      entries.push(result.entry);
      formats[result.format] = (formats[result.format] || 0) + 1;
    } else {
      failed += 1;
      if (bad.length < maxBadSamples) {
        bad.push({ lineNo: i + 1, text: raw.slice(0, 300), reason: result.reason });
      }
    }
  }
  return {
    format,
    total,
    parsed: entries.length,
    failed,
    entries,
    bad,
    detectedFormats: formats
  };
}
