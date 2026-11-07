/**
 * 数字 / 字节 / 时间格式化。纯函数，浏览器与 Node 通用。
 */

const KB = 1024;
const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatNumber(n) {
  if (!Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString("en-US");
}

export function formatCompact(n) {
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (abs >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return formatNumber(n);
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "-";
  let value = n;
  let unit = 0;
  while (value >= KB && unit < UNITS.length - 1) {
    value /= KB;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return value.toFixed(digits) + " " + UNITS[unit];
}

export function formatMs(ms) {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1) return ms.toFixed(2) + " ms";
  if (ms < 1000) return Math.round(ms) + " ms";
  return (ms / 1000).toFixed(2) + " s";
}

export function formatPercent(ratio, digits = 1) {
  if (!Number.isFinite(ratio)) return "-";
  return (ratio * 100).toFixed(digits) + "%";
}

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

export function formatDateTime(ms) {
  if (!Number.isFinite(ms)) return "-";
  const d = new Date(ms);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

export function formatClock(ms) {
  if (!Number.isFinite(ms)) return "-";
  const d = new Date(ms);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0 秒";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(h + " 小时");
  if (m) parts.push(m + " 分");
  if (s || !parts.length) parts.push(s + " 秒");
  return parts.join(" ");
}
