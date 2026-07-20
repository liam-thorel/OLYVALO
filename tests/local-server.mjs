import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const HOST = '127.0.0.1';
const PORT = 43173;
const ROOT = process.cwd();
const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${HOST}:${PORT}`).pathname);
    const relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    const target = join(ROOT, relative);
    if (!target.startsWith(ROOT)) throw new Error('Invalid path');
    const details = await stat(target);
    const file = details.isDirectory() ? join(target, 'index.html') : target;
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`OLYVALO local server: http://${HOST}:${PORT}`);
});
