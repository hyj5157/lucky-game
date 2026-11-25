import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { attachLuckyGrabWS, getLocalIPv4s } from "./gameServer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");
const port = Number(process.env.PORT) || 5175;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  if (urlPath === "/api/share-info") {
    const hostHeader = req.headers.host || `localhost:${port}`;
    const p = hostHeader.includes(":") ? hostHeader.split(":")[1] : String(port);
    const ips = getLocalIPv4s();
    const urls = ips.map((ip) => `http://${ip}:${p}`);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ urls, primaryUrl: urls[0] || `http://${hostHeader}` }));
    return;
  }

  let filePath = path.join(distDir, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

attachLuckyGrabWS(server);

server.listen(port, "0.0.0.0", () => {
  console.log(`hi-ssam Lucky Grab server listening on http://0.0.0.0:${port}`);
});
