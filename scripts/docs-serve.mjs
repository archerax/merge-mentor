#!/usr/bin/env node
/**
 * Minimal static file server for local API docs browsing.
 * Uses only Node.js built-ins — works in Termux and constrained environments.
 *
 * Usage: node scripts/docs-serve.mjs [port]
 */

import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const PORT = Number(process.argv[2]) || 4000;
const ROOT = join(process.cwd(), "docs/site");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  let filePath = join(ROOT, pathname);

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");

    const content = await readFile(filePath);
    const mime = MIME_TYPES[extname(filePath)] ?? "text/plain";
    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Docs ready → http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});
