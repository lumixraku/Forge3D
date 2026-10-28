// Local-only dev server for the promo video: serves the HTML, three.js from
// node_modules, files from public/, and stores frames POSTed by ?render=1.
// Binds 127.0.0.1 with no auth: stop it after rendering.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(root, '..');
const htmlFile = path.join(root, 'forge3d-shark-demo.html');
const outDir = path.resolve(process.argv[2] || path.join(root, 'render'));
const port = Number(process.argv[3]) || 5178;
const framesDir = path.join(outDir, 'frames');
fs.mkdirSync(framesDir, { recursive: true });
fs.rmSync(path.join(outDir, 'DONE'), { force: true });

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const mounts = [
  ['/vendor/three.module.min.js', path.join(project, 'node_modules/three/build/three.module.min.js')],
  ['/vendor/three.core.min.js', path.join(project, 'node_modules/three/build/three.core.min.js')],
  ['/vendor/', path.join(project, 'node_modules/three/examples/jsm/')],
  ['/public/', path.join(project, 'public/')],
  ['/assets/', path.join(root, 'assets/')],
];

// Maps a URL to a file inside one of the mounts; rejects path traversal.
function resolveFile(urlPath) {
  if (urlPath === '/') return htmlFile;
  for (const [prefix, dir] of mounts) {
    if (prefix.endsWith('/') ? !urlPath.startsWith(prefix) : urlPath !== prefix) continue;
    if (!prefix.endsWith('/')) return dir;
    const file = path.resolve(dir, urlPath.slice(prefix.length));
    return file.startsWith(dir) ? file : null;
  }
  return null;
}

let count = 0;
http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (req.method === 'POST' && url.startsWith('/frame/')) {
    const index = Number(url.slice('/frame/'.length));
    if (!Number.isInteger(index) || index < 0 || index > 99999) return res.writeHead(400).end();
    const file = fs.createWriteStream(path.join(framesDir, `f${String(index).padStart(5, '0')}.png`));
    req.pipe(file);
    file.on('finish', () => {
      count += 1;
      if (count % 60 === 0) console.log(`frames: ${count}`);
      res.writeHead(204).end();
    });
    return;
  }
  if (req.method === 'POST' && url === '/done') {
    fs.writeFileSync(path.join(outDir, 'DONE'), String(count));
    console.log(`done: ${count} frames`);
    return res.writeHead(204).end();
  }
  const file = req.method === 'GET' ? resolveFile(url) : null;
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'cache-control': 'no-store', 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
