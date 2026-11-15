#!/usr/bin/env node
// Пулы «Казино билдов» для CI: статистика опубликованных сборок каждого героя → public/data/pools/<heroId>.json.
// Сайт сначала берёт пул отсюда (свой сервер, без запроса к API на крутке), а к API идёт, только если файла нет или он устарел.
// Запуск: node scripts/pools.mjs. В CI — раз в окно POOL_WINDOW_H (кэш actions/cache, см. .github/workflows/sync.yml).
// Файлы в git не коммитятся (public/data/pools/ в .gitignore) — собираются при деплое.
//
// Условия пула — те же, что RND в public/js/slots.js (менять вместе!): 30 дней, от 50 матчей, от 10 игроков.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const POOL = { days: 30, minMatches: 50, minPlayers: 10 };
const API = 'https://api.deadlock-api.com/v1'; // как API в slots.js
const HOUR = 3600, DAY = 86400;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'public/data/pools');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// повторяем только перегрузку (429 / 5xx) и сетевые сбои, до 4 раз с паузой
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'randomlock-pools/1.0' } }); }
    catch (e) { if (attempt >= 4) throw e; await sleep(2000 * attempt); continue; }
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await sleep(2000 * attempt); continue; }
    throw new Error(`${r.status} ${url}`);
  }
}

// строки пула: [id, матчи, игроки, победы] — тот же формат, что кэш в slots.js
export function poolRows(stats) {
  return (stats || [])
    .filter((x) => x.matches >= POOL.minMatches && x.players >= POOL.minPlayers)
    .map((x) => [x.hero_build_id >>> 0, x.matches | 0, x.players | 0, x.wins | 0])
    .sort((a, b) => b[1] - a[1]);
}

async function main() {
  const data = JSON.parse(await readFile(path.join(root, 'public/data/en.json'), 'utf8'));
  const heroes = data.heroes.map((h) => h.id);
  const now = Math.floor(Date.now() / 1000);
  const t = Math.floor(now / HOUR) * HOUR - POOL.days * DAY; // начало окна статистики, как since() в slots.js
  await mkdir(OUT, { recursive: true });
  let ok = 0, rows = 0, bytes = 0;
  const queue = [...heroes];
  // по 4 героя параллельно: ~45 лёгких запросов на обновление
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let id; (id = queue.shift()) !== undefined;) {
      try {
        const v = poolRows(await get(`${API}/analytics/hero-build-stats/${id}?min_unix_timestamp=${t}&min_matches=${POOL.minMatches}`));
        const json = JSON.stringify({ t, at: now, v });
        await writeFile(path.join(OUT, `${id}.json`), json);
        ok++; rows += v.length; bytes += json.length;
      } catch (e) { console.error(`пул героя ${id}: ${e.message}`); }
    }
  }));
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify({ t, at: now, heroes: ok }));
  console.log(`пулы: ${ok}/${heroes.length} героев, ${rows} сборок, ${(bytes / 1024).toFixed(0)} КБ`);
  if (ok < heroes.length * 0.9) { console.error('Слишком много ошибок — пулы не сохраняем в кэш'); process.exit(1); }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) await main();
