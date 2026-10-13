import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/model.mjs';

const root = path.join(ROOT, 'docs');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.wasm':'application/wasm', '.png':'image/png', '.svg':'image/svg+xml', '.txt':'text/plain; charset=utf-8', '.md':'text/plain; charset=utf-8', '.onnx':'application/octet-stream' };
const port = Number(process.env.RELEASE_SIEVE_PORT || 4173);
const server = createServer(async (request,response) => {
  if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end('Read-only server'); return; }
  let target;
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
    target = path.resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Outside document root');
    if (pathname.includes('\0')) throw new Error('Invalid path');
    if ((await stat(target)).isDirectory()) target = path.join(target,'index.html');
    const bytes = await readFile(target);
    response.writeHead(200, {'Content-Type':types[path.extname(target)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    response.end(request.method==='HEAD' ? undefined : bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(port,'127.0.0.1',()=>console.log(`Release Sieve browser app: http://127.0.0.1:${server.address().port} (loopback only). Ctrl+C to stop.`));
