import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const relative = normalize(pathname.replace(/^\/+/, ''));
  if (relative.startsWith('..')) { response.writeHead(403).end(); return; }
  const file = join(root, relative || 'tests/e2e/fixtures/form-lab.html');
  response.setHeader('Content-Type', contentTypes[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).on('error', () => response.writeHead(404).end()).pipe(response);
}).listen(4173, '127.0.0.1');
