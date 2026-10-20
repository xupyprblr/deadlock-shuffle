#!/usr/bin/env node
// Быстрый сторож: два лёгких запроса к API раз в 20 минут.
// Сравнивает версию клиента игры и список активных героев с последним снимком (public/data/meta.json).
// Печатает CHANGED, если вышел патч или изменился состав героев, — тогда CI запускает полную синхронизацию.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, isPlayable } from '../public/js/normalize.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const get = async (u) => {
  const r = await fetch(u, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'deadlock-shuffle-watch/1.0' } });
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.json();
};

let meta = {};
try { meta = JSON.parse(await readFile(path.join(root, 'public/data/meta.json'), 'utf8')); } catch {}

const [versions, heroes] = await Promise.all([get(`${API}/client-versions`), get(`${API}/heroes?only_active=true`)]);
const clientVersion = Math.max(...versions);
const ids = heroes.filter(isPlayable).map((h) => h.id).sort((a, b) => a - b);
const names = Object.fromEntries(heroes.map((h) => [h.id, h.name]));

const reasons = [];
if (!meta.clientVersion || clientVersion > meta.clientVersion) reasons.push(`версия клиента ${meta.clientVersion ?? '—'} → ${clientVersion}`);
const known = new Set(meta.heroIds || []);
const fresh = ids.filter((id) => !known.has(id));
const gone = (meta.heroIds || []).filter((id) => !ids.includes(id));
if (fresh.length) reasons.push(`новые герои: ${fresh.map((id) => names[id] || id).join(', ')}`);
if (gone.length) reasons.push(`убраны из пула: ${gone.join(', ')}`);

if (reasons.length) {
  console.log('Изменения: ' + reasons.join('; '));
  console.log('CHANGED');
} else {
  console.log(`Без изменений: версия ${clientVersion}, героев ${ids.length}`);
  console.log('UNCHANGED');
}
