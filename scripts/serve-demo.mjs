import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/model.mjs';

const routes = new Map([
  ['/', ['demo/output/audit.html', 'text/html; charset=utf-8']],
  ['/audit.json', ['demo/output/audit.json', 'application/json; charset=utf-8']],
  ['/audit.md', ['demo/output/audit.md', 'text/plain; charset=utf-8']],
]);
const server = createServer(async (request, response) => {
  const entry = routes.get(request.url);
  if (!entry || !['GET','HEAD'].includes(request.method)) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const bytes = await readFile(path.join(ROOT, entry[0]));
    response.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'" });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(503); response.end('Run npm run demo first.'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Release Sieve synthetic demo: http://127.0.0.1:4173 (loopback only). Ctrl+C to stop.'));
