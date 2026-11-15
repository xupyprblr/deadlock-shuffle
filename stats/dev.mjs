// Локальный счётчик для разработки: node stats/dev.mjs → http://localhost:8787 (база в памяти, ключ админки: dev).
// На сайте при открытии с localhost события уходят сюда (STATS_URL в public/js/analytics.js).
import http from 'node:http';
import worker from './worker.js';
import { memDB } from './memdb.mjs';

const env = { DB: memDB(), ADMIN_TOKEN: 'dev' };
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request('http://localhost:8787' + req.url, { method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log('stats dev: http://localhost:8787 (ключ админки: dev)'));
