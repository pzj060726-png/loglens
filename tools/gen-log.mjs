#!/usr/bin/env node
/**
 * 生成一份虚构的电商站点访问日志（combined 格式，末尾带 request_time）。
 *
 * 用法：
 *   node tools/gen-log.mjs --out demo/sample.log --lines 5000 --seed 7
 *
 * 脚本里的 IP 全部取自 RFC 5737 文档保留段（203.0.113.0/24、198.51.100.0/24、192.0.2.0/24），
 * 站点、商品、UA 都是编的 —— 任何真实日志都不会长得这么巧。
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");

function parseArgs(argv) {
  const args = { out: "demo/sample.log", lines: 5000, seed: 7, start: "2026-11-08T00:00:00+08:00", hours: 24 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--lines") args.lines = Number(argv[++i]);
    else if (arg === "--seed") args.seed = Number(argv[++i]);
    else if (arg === "--start") args.start = argv[++i];
    else if (arg === "--hours") args.hours = Number(argv[++i]);
  }
  return args;
}

/** mulberry32：小而稳定的种子随机数 */
function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = createRandom(parseArgs(process.argv.slice(2)).seed);
const pick = (list) => list[Math.floor(rand() * list.length)];
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const chance = (p) => rand() < p;

const args = parseArgs(process.argv.slice(2));
const startMs = Date.parse(args.start);
const spanMs = args.hours * 3600 * 1000;
const incidentStart = startMs + 15 * 3600 * 1000 + 20 * 60 * 1000;
const incidentEnd = incidentStart + 15 * 60 * 1000;
const botStart = startMs + 3 * 3600 * 1000;
const botEnd = botStart + 160 * 60 * 1000;

// 访问量的日曲线：凌晨低、上午爬升、晚间高峰（电商站点的典型形状）
const HOUR_WEIGHTS = [3, 2, 2, 2, 3, 5, 9, 16, 26, 38, 46, 52, 48, 44, 42, 40, 46, 55, 68, 82, 96, 100, 92, 62];

const IPS = [];
for (let i = 0; i < 26; i++) IPS.push("203.0.113." + randInt(2, 250));
for (let i = 0; i < 12; i++) IPS.push("198.51.100." + randInt(2, 250));
for (let i = 0; i < 8; i++) IPS.push("192.0.2." + randInt(2, 250));
IPS.push("10.0.3.11", "10.0.3.12");

const BOT_IPS = ["198.51.100.66", "203.0.113.199"];

const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CURL = "curl/8.7.1";
const SCANNER = "Mozilla/5.0 (compatible; Nmap Scripting Engine)";

const UAS = [DESKTOP, DESKTOP, DESKTOP, ANDROID, ANDROID, IPHONE, IPHONE, MAC];

const REFERERS = [
  "https://shop.example.com/",
  "https://shop.example.com/products",
  "https://shop.example.com/product/",
  "https://www.google.com/",
  "https://shop.example.com/cart",
  "-"
];

/** 路径模板：权重决定出现频率，kind 决定状态码、延迟、字节数的量级 */
const ROUTES = [
  { weight: 18, method: "GET", path: "/", kind: "html" },
  { weight: 14, method: "GET", path: "/products", kind: "html", query: () => "page=" + randInt(1, 6) },
  { weight: 16, method: "GET", path: "/product/{id}", kind: "html" },
  { weight: 12, method: "GET", path: "/api/products", kind: "api", query: () => pick(["category=phone", "category=laptop", "category=audio", "sort=price_asc", "sort=new"]) },
  { weight: 10, method: "GET", path: "/api/product/{id}", kind: "api" },
  { weight: 7, method: "GET", path: "/api/cart", kind: "api" },
  { weight: 5, method: "POST", path: "/api/cart", kind: "api" },
  { weight: 3, method: "PUT", path: "/api/cart/{id}", kind: "api" },
  { weight: 2, method: "DELETE", path: "/api/cart/{id}", kind: "api" },
  { weight: 4, method: "GET", path: "/api/orders", kind: "api", query: () => "limit=" + randInt(10, 30) },
  { weight: 5, method: "GET", path: "/api/search", kind: "api", query: () => "q=" + pick(["耳机", "机械键盘", "显示器", "路由器", "充电器"]) },
  { weight: 2, method: "POST", path: "/api/checkout", kind: "checkout" },
  { weight: 2, method: "POST", path: "/api/auth/login", kind: "auth" },
  { weight: 1, method: "GET", path: "/login", kind: "html" },
  { weight: 8, method: "GET", path: "/assets/css/main.{hash}.css", kind: "asset" },
  { weight: 8, method: "GET", path: "/assets/js/app.{hash}.js", kind: "asset" },
  { weight: 7, method: "GET", path: "/images/products/{id}.webp", kind: "image" },
  { weight: 2, method: "GET", path: "/favicon.ico", kind: "asset" },
  { weight: 1, method: "GET", path: "/sitemap.xml", kind: "text" },
  { weight: 1, method: "GET", path: "/healthz", kind: "health" }
];

const BOT_ROUTES = [
  { method: "GET", path: "/.env", status: 403 },
  { method: "GET", path: "/wp-login.php", status: 404 },
  { method: "GET", path: "/admin", status: 403 },
  { method: "GET", path: "/phpmyadmin/", status: 404 },
  { method: "GET", path: "/.git/config", status: 403 },
  { method: "POST", path: "/xmlrpc.php", status: 404 },
  { method: "GET", path: "/api/../etc/passwd", status: 400 }
];

const ROUTE_WEIGHTS = ROUTES.reduce((sum, route) => sum + route.weight, 0);

const STATUS_MIX = {
  html: [[200, 86], [304, 9], [404, 4], [301, 1]],
  api: [[200, 82], [201, 6], [400, 3], [401, 4], [404, 3], [429, 2]],
  checkout: [[201, 76], [200, 12], [400, 5], [409, 4], [500, 3]],
  auth: [[200, 68], [401, 26], [429, 6]],
  asset: [[200, 62], [304, 38]],
  image: [[200, 92], [304, 8]],
  text: [[200, 97], [301, 3]],
  health: [[200, 100]]
};

const SIZE_RANGE = {
  html: [4200, 26000],
  api: [180, 6500],
  checkout: [320, 1400],
  auth: [120, 900],
  asset: [8000, 95000],
  image: [15000, 240000],
  text: [900, 4200],
  health: [12, 24]
};

const LATENCY_RANGE = {
  html: [14, 95],
  api: [6, 60],
  checkout: [120, 620],
  auth: [40, 260],
  asset: [2, 16],
  image: [3, 28],
  text: [2, 9],
  health: [1, 4]
};

function weightedStatus(kind) {
  const mix = STATUS_MIX[kind] || STATUS_MIX.api;
  const total = mix.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [status, weight] of mix) {
    roll -= weight;
    if (roll <= 0) return status;
  }
  return mix[0][0];
}

/** 按小时权重做拒绝采样，得到分布更好的访问时间 */
function sampleTime() {
  for (let attempt = 0; attempt < 64; attempt++) {
    const t = startMs + rand() * spanMs;
    const hour = new Date(t).getHours();
    if (rand() * 100 <= HOUR_WEIGHTS[hour]) return t;
  }
  return startMs + rand() * spanMs;
}

function expand(template) {
  return template
    .replace("{id}", String(randInt(100, 168)))
    .replace("{hash}", Math.floor(rand() * 0xfffff).toString(16).padStart(5, "0"));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function nginxTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return pad(d.getDate()) + "/" + MONTHS[d.getMonth()] + "/" + d.getFullYear() +
    ":" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
    " " + sign + pad(Math.floor(abs / 60)) + pad(abs % 60);
}

const lines = [];
const counts = { normal: 0, bot: 0, incident: 0 };

for (let i = 0; i < args.lines; i++) {
  const time = sampleTime();
  const isBot = time >= botStart && time <= botEnd && chance(0.9);
  const isIncident = time >= incidentStart && time <= incidentEnd;

  if (isBot) {
    const route = pick(BOT_ROUTES);
    const bytes = randInt(180, 620);
    const latency = randInt(1, 6) / 1000;
    lines.push({ time, text: pick(BOT_IPS) + " - - [" + nginxTime(time) + '] "' + route.method + " " + route.path +
      ' HTTP/1.1" ' + route.status + " " + bytes + ' "-" "' + SCANNER + '" ' + latency.toFixed(3) });
    counts.bot += 1;
    continue;
  }

  const roll = rand() * ROUTE_WEIGHTS;
  let route = ROUTES[0];
  let acc = 0;
  for (const candidate of ROUTES) {
    acc += candidate.weight;
    if (roll <= acc) {
      route = candidate;
      break;
    }
  }

  let status = weightedStatus(route.kind);
  let latency = randInt(LATENCY_RANGE[route.kind][0], LATENCY_RANGE[route.kind][1]);
  if (isIncident) {
    counts.incident += 1;
    if (chance(0.34)) {
      status = pick([500, 500, 502, 503, 504]);
      latency *= 3.5;
    }
  }

  const path = expand(route.path);
  const query = route.query ? "?" + route.query() : "";
  const bytes = status >= 500 || status === 401 ? randInt(40, 260) : randInt(SIZE_RANGE[route.kind][0], SIZE_RANGE[route.kind][1]);
  const ip = route.kind === "health" ? pick(["10.0.3.11", "10.0.3.12"]) : pick(IPS);
  const ua = route.kind === "health" ? CURL : route.kind === "text" ? GOOGLEBOT : pick(UAS);
  const referer = route.kind === "html" || route.kind === "api" ? pick(REFERERS) : "-";

  lines.push({
    time,
    text: ip + " - - [" + nginxTime(time) + '] "' + route.method + " " + path + query +
      ' HTTP/1.1" ' + status + " " + bytes + ' "' + referer + '" "' + ua + '" ' + (latency / 1000).toFixed(3)
  });
  counts.normal += 1;
}

lines.sort((a, b) => a.time - b.time);

const outPath = resolve(rootDir, args.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.map((line) => line.text).join("\n") + "\n", "utf8");

const spanHours = (lines[lines.length - 1].time - lines[0].time) / 3600000;
console.log("已生成 " + args.out);
console.log("  行数：" + lines.length + "（正常 " + counts.normal + " / 扫描器 " + counts.bot + " / 故障窗口 " + counts.incident + "）");
console.log("  时间跨度：" + spanHours.toFixed(2) + " 小时");
console.log("  种子：" + args.seed);
