// 手元で動作確認するための小さな静的サーバー（公開時は GitHub Pages が配信するので使わない）
// 使い方：npm start → http://localhost:8080
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const file = path.join(ROOT, decodeURIComponent(pathname.endsWith('/') ? `${pathname}index.html` : pathname));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
