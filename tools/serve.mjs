#!/usr/bin/env node
/**
 * 零依赖静态服务器，只为本地预览。
 *   node tools/serve.mjs          # http://127.0.0.1:4173
 *   node tools/serve.mjs 4180     # 自定义端口
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || process.env.PORT || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".log": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  let pathname = "/";
  try {
    const url = new URL(req.url, "http://localhost");
    pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    const target = normalize(join(rootDir, pathname));
    if (!target.startsWith(rootDir + sep) && target !== rootDir) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("403");
      return;
    }

    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");

    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 " + pathname);
  } finally {
    console.log(req.method + " " + pathname + " " + (Date.now() - startedAt) + "ms");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("LogLens 本地预览：http://127.0.0.1:" + port + "/");
  console.log("（Ctrl+C 停止）");
});
