#!/usr/bin/env node
// Синхронизация данных Deadlock -> public/data/{lang}.json
//
//   node scripts/sync.mjs                 # ru + en, ссылки на CDN deadlock-api
//   node scripts/sync.mjs --icons         # + скачать иконки в public/icons (без хотлинка)
//   node scripts/sync.mjs --langs ru      # только русский
//
// Выходит с кодом 0 и печатает CHANGED/UNCHANGED — удобно для CI.

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRaw, buildSnapshot, applyEnglishNames, bannedFromStats, itemScores, tuneHero, buildTips, STATS } from '../public/js/normalize.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const LANGS_TO_SYNC = opt('--langs', 'ru,en').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(root, opt('--out', 'public/data'));
const ICONS = flag('--icons');
const ICON_DIR = path.resolve(root, 'public/icons');

// Повторы: при перегрузке API (429/5xx) ждём Retry-After или 5/10/15 с, при прочих ошибках — 1,5/3 с
async function fetchJson(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    let wait = 1500 * (i + 1);
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 60_000);
      const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'deadlock-shuffle-sync/1.0' } });
      clearTimeout(t);
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          const ra = parseInt(res.headers.get('retry-after') || '', 10);
          wait = Number.isFinite(ra) ? Math.min(30, ra) * 1000 : 5000 * (i + 1);
        }
        throw new Error(`${res.status} ${url}`);
      }
      return await res.json();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

const hash = (obj) => createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 12);

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

// Скачивает картинку один раз и возвращает локальный путь (относительно public/)
async function mirror(url) {
  if (!url || !url.startsWith('http')) return url;
  let rel;
  try { rel = decodeURIComponent(new URL(url).pathname).split('/assets-api-res/')[1] || path.basename(new URL(url).pathname); } catch { return url; }
  const file = path.resolve(ICON_DIR, rel);
  // защита от подмены данных API: файл только внутри public/icons и только картинка
  if (!file.startsWith(ICON_DIR + path.sep) || !/\.(webp|png|jpe?g|svg|gif)$/i.test(file)) return url;
  if (!(await exists(file))) {
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) return url; // нет картинки — оставляем внешнюю ссылку
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, Buffer.from(await res.arrayBuffer()));
        break;
      } catch {
        if (i === 2) return url; // сеть подвела — сайт возьмёт картинку с CDN
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  return 'icons/' + rel.replace(/\\/g, '/');
}

// Карточки предметов (data/tips.{lang}.json): иконки свойств — общей таблицей, при --icons скачаны к себе
async function writeTips(raw, snap, lang) {
  const tips = buildTips(raw.upgrades, snap.items, lang);
  if (Object.keys(tips).length < snap.items.length * 0.9) { console.warn(`tips.${lang}: мало данных, оставляю прошлый файл`); return; }
  const icons = [];
  const at = new Map();
  const ref = (u) => { if (!u) return -1; if (!at.has(u)) { at.set(u, icons.length); icons.push(u); } return at.get(u); };
  const pack = (rows) => rows.map(([ic, v, l, c]) => (c ? [ref(ic), v, l, c] : [ref(ic), v, l]));
  for (const t of Object.values(tips)) {
    t.innate = pack(t.innate);
    for (const sec of t.sections) { sec.small = pack(sec.small); sec.big = pack(sec.big); if (sec.cd) sec.cd = [ref(sec.cd[0]), sec.cd[1]]; }
  }
  for (let i = 0; i < icons.length; i++) icons[i] = ICONS ? await mirror(icons[i]) : icons[i];
  const body = JSON.stringify({ v: 1, lang, icons, items: tips });
  const file = path.join(OUT, `tips.${lang}.json`);
  let prev = '';
  try { prev = await readFile(file, 'utf8'); } catch {}
  if (prev !== body) { await writeFile(file, body); changed = true; console.log(`tips.${lang}: ${Object.keys(tips).length} карточек, ${icons.length} иконок свойств`); }
}

async function mirrorAll(snap) {
  const jobs = [];
  for (const h of snap.heroes) {
    for (const k of ['card', 'small']) jobs.push(mirror(h[k]).then((v) => (h[k] = v)));
    for (const a of h.abilities) jobs.push(mirror(a.icon).then((v) => (a.icon = v)));
  }
  for (const i of snap.items) {
    jobs.push(mirror(i.icon).then((v) => (i.icon = v)));
  }
  // ограничиваем параллельность пачками
  for (let i = 0; i < jobs.length; i += 24) await Promise.all(jobs.slice(i, i + 24));
}

await mkdir(OUT, { recursive: true });
let changed = false;
const meta = { updatedAt: new Date().toISOString(), langs: {} };

// Английский снимок нужен всегда: из него берутся имена героев, предметов и способностей
const enRaw = await fetchRaw(fetchJson, 'en');
const enSnap = buildSnapshot(enRaw);

// Журнал героев: когда каждый появился в пуле. Новые герои логируются и получают дату —
// по ней сайт показывает бейдж «Новинка».
const ROSTER = path.join(OUT, 'roster.json');
let roster = { heroes: {} };
try { roster = JSON.parse(await readFile(ROSTER, 'utf8')); } catch {}
const nowIso = new Date().toISOString();
const firstRun = !Object.keys(roster.heroes).length;
const activeIds = new Set(enSnap.heroes.map((h) => String(h.id)));
const added = [];
for (const h of enSnap.heroes) {
  const r = roster.heroes[h.id];
  if (!r) {
    // при самом первом запуске все текущие герои считаются «старыми»
    roster.heroes[h.id] = { name: h.name, firstSeen: firstRun ? null : nowIso, active: true };
    if (!firstRun) added.push(h.name);
  } else {
    if (r.active === false) { added.push(`${h.name} (вернулся)`); r.firstSeen = r.firstSeen || nowIso; }
    r.active = true; r.name = h.name;
  }
  h.addedAt = roster.heroes[h.id].firstSeen || null;
}
const removed = [];
for (const [id, r] of Object.entries(roster.heroes)) if (r.active && !activeIds.has(id)) { r.active = false; removed.push(r.name); }
if (added.length) console.log(`НОВЫЕ ГЕРОИ: ${added.join(', ')}`);
if (removed.length) console.log(`УБРАНЫ ИЗ ПУЛА: ${removed.join(', ')}`);
await writeFile(ROSTER, JSON.stringify(roster, null, 2));

// Запреты на покупку по статистике матчей за 30 дней (по 6 героев параллельно)
const since = Math.floor(Date.now() / 1000) - 30 * 86400;
// Если аналитика API лежит (504 и т. п.), берём запреты из прошлого снимка, а не оставляем пустыми
let prevBans = {};
try { prevBans = Object.fromEntries(JSON.parse(await readFile(path.join(OUT, 'en.json'), 'utf8')).heroes.map((h) => [h.slug, h.banned || []])); } catch {}
let bansFound = 0;
const globalStats = await fetchJson(`${STATS}?min_unix_timestamp=${since}`).catch(() => null);
// Оценки предметов для «Оценки затара»: тот же запрос статистики, считаем раз в сутки
const STATS_FILE = path.join(OUT, 'stats.json');
let prevStats = null;
try { prevStats = JSON.parse(await readFile(STATS_FILE, 'utf8')); } catch {}
// Прошлая подкрутка: при сбое API по герою берём его прошлую строку (переложенную на текущий список предметов)
let prevTune = null;
try { prevTune = JSON.parse(await readFile(path.join(OUT, 'tune.json'), 'utf8')); } catch {}
function prevTuneRow(heroId, items) {
  const row = prevTune && prevTune.heroes && prevTune.heroes[heroId];
  if (!row || !Array.isArray(prevTune.items)) return null;
  const at = new Map(prevTune.items.map((k, idx) => [k, idx]));
  let w = '', t = '';
  for (const it of items) {
    const k = at.get((it.id >>> 0).toString(36));
    w += k === undefined ? '-' : row.w[k] || '-';
    t += k === undefined ? '-' : row.t[k] || '-';
  }
  return { w, t };
}
// если свежей статистики по герою нет — переносим его прошлые оценки и подкрутку, чтобы файлы оставались полными
function carryOver(h, why) {
  if (statsFresh) return;
  const ps = prevStats && prevStats.heroes && prevStats.heroes[h.id];
  if (ps && !scoreOut.heroes[h.id]) scoreOut.heroes[h.id] = ps;
  const pt = prevTuneRow(h.id, enSnap.items);
  if (pt && !tuneOut.heroes[h.id]) tuneOut.heroes[h.id] = pt;
  console.warn(`  ${h.name}: ${why} — оценки${ps ? '' : ' (нет)'} и подкрутка${pt ? '' : ' (нет)'} из прошлого снимка`);
}
const statsFresh = prevStats && Date.now() - Date.parse(prevStats.updatedAt) < 20 * 3600e3 && !flag('--force-stats');
const heroStats = statsFresh ? null : await fetchJson(`https://api.deadlock-api.com/v1/analytics/hero-stats?min_unix_timestamp=${since}`).catch(() => null);
const scoreOut = { updatedAt: new Date().toISOString(), windowDays: 30, minMatches: 300, heroes: {} };
// Скрытая подкрутка псевдо-рандома (data/tune.json): покупки за 30 дней + опубликованные сборки за 90 дней
const TUNE_FILE = path.join(OUT, 'tune.json');
const BUILD_STATS = 'https://api.deadlock-api.com/v1/analytics/build-item-stats';
const buildsSince = Math.floor(Date.now() / 1000) - 90 * 86400;
const globalBuilds = statsFresh ? null : await fetchJson(`${BUILD_STATS}?min_last_updated_unix_timestamp=${buildsSince}`).catch(() => null);
const globalMatches = (heroStats || []).reduce((a, x) => a + (x.matches || 0), 0);
const tuneOut = { v: 1, updatedAt: scoreOut.updatedAt, items: enSnap.items.map((i) => (i.id >>> 0).toString(36)), heroes: {} };
let freshHeroes = 0; // по скольким героям статистика пришла свежей (остальные — из прошлого снимка)
const PAR = 3; // 504 у аналитики API приходят пачками — не грузим её сильнее
// для проверки отказоустойчивости: SYNC_FAIL_HEROES='^V' — имитировать сбой API по этим героям
const FAIL_TEST = process.env.SYNC_FAIL_HEROES ? new RegExp(process.env.SYNC_FAIL_HEROES) : null;
for (let i = 0; i < enSnap.heroes.length; i += PAR) {
  await Promise.all(enSnap.heroes.slice(i, i + PAR).map(async (h) => {
    try {
      if (FAIL_TEST && FAIL_TEST.test(h.name)) throw new Error('504 (имитация сбоя)');
      const stats = await fetchJson(`${STATS}?hero_id=${h.id}&min_unix_timestamp=${since}`);
      if (!globalStats) throw new Error('нет общей статистики предметов');
      h.banned = bannedFromStats(stats, enSnap.items, globalStats);
      if (!statsFresh) {
        const hs = (heroStats || []).find((x) => x.hero_id === h.id);
        scoreOut.heroes[h.id] = {
          base: hs && hs.matches ? Math.round((hs.wins / hs.matches) * 1000) : null,
          matches: hs ? hs.matches : 0,
          items: itemScores(stats, enSnap.items),
        };
        freshHeroes++;
        try {
          const heroBuilds = await fetchJson(`${BUILD_STATS}?hero_id=${h.id}&min_last_updated_unix_timestamp=${buildsSince}`).catch(() => null);
          tuneOut.heroes[h.id] = tuneHero({
            items: enSnap.items, heroItems: stats, globalItems: globalStats, heroBuilds, globalBuilds,
            heroMatches: hs ? hs.matches : 0, globalMatches, wr: scoreOut.heroes[h.id].items,
          });
        } catch (e) {
          const pt = prevTuneRow(h.id, enSnap.items);
          if (pt) tuneOut.heroes[h.id] = pt;
          console.warn(`  ${h.name}: подкрутка не посчитана (${e.message})${pt ? ' — из прошлого снимка' : ''}`);
        }
      }
      bansFound += h.banned.length;
      if (h.banned.length) console.log(`  ${h.name}: нельзя купить ${h.banned.length} — ${h.banned.map((s) => enSnap.items.find((x) => x.slug === s).name).join(', ')}`);
    } catch (e) {
      h.banned = prevBans[h.slug] || [];
      bansFound += h.banned.length;
      console.warn(`  ${h.name}: статистика недоступна, запреты из прошлого снимка: ${h.banned.length} (${e.message})`);
      carryOver(h, 'статистика недоступна');
    }
  }));
}
console.log(`Запреты: ${bansFound} пар герой/предмет`);
// Оценки и подкрутка: свежие герои + прошлые данные для тех, по кому API не ответил (файлы всегда полные).
// Если свежих меньше 80%, дату обновления не трогаем — следующая синхронизация (через 3 ч) попробует снова,
// а не будет считать данные свежими 20 часов. Если нет ни свежих, ни прошлых данных — файлы не трогаем.
const enough = (o) => Object.keys(o.heroes).length >= Math.ceil(enSnap.heroes.length * 0.8) && Object.values(o.heroes).some((h) => h.base || h.w);
if (statsFresh) {
  console.log('Оценки предметов: свежие (моложе 20 ч), пропускаю');
} else if (!freshHeroes || !enough(scoreOut)) {
  console.warn(`Оценки предметов: свежая статистика по ${freshHeroes} из ${enSnap.heroes.length} героев — оставляю прошлые stats.json и tune.json`);
} else {
  const allFresh = freshHeroes >= Math.ceil(enSnap.heroes.length * 0.8);
  if (!allFresh && prevStats && prevStats.updatedAt) { scoreOut.updatedAt = prevStats.updatedAt; tuneOut.updatedAt = prevStats.updatedAt; }
  await writeFile(STATS_FILE, JSON.stringify(scoreOut));
  console.log(`Оценки предметов: ${Object.keys(scoreOut.heroes).length} героев, свежих ${freshHeroes}${allFresh ? '' : ' — дату не обновляю, повторю при следующей синхронизации'}`);
  if (enough(tuneOut)) {
    await writeFile(TUNE_FILE, JSON.stringify(tuneOut));
    console.log(`Подкрутка псевдо-рандома: ${Object.keys(tuneOut.heroes).length} героев`);
  }
}

for (const lang of LANGS_TO_SYNC) {
  const raw = lang === 'en' ? enRaw : await fetchRaw(fetchJson, lang);
  const snap = lang === 'en' ? enSnap : applyEnglishNames(buildSnapshot(raw), enSnap);
  if (snap.heroes.length < 10 || snap.items.length < 50) {
    throw new Error(`Подозрительно мало данных (${lang}): героев ${snap.heroes.length}, предметов ${snap.items.length}`);
  }
  if (ICONS) await mirrorAll(snap);
  await writeTips(raw, snap, lang);

  const { fetchedAt, ...stable } = snap;
  const h = hash(stable);
  const file = path.join(OUT, `${lang}.json`);
  let prev = null;
  try { prev = JSON.parse(await readFile(file, 'utf8')); } catch {}
  if (prev && prev.hash === h) {
    meta.langs[lang] = { hash: h, clientVersion: prev.clientVersion, fetchedAt: prev.fetchedAt };
    console.log(`${lang}: без изменений (${snap.heroes.length} героев, ${snap.items.length} предметов)`);
    continue;
  }
  snap.hash = h;
  await writeFile(file, JSON.stringify(snap));
  meta.langs[lang] = { hash: h, clientVersion: snap.clientVersion, fetchedAt };
  changed = true;
  console.log(`${lang}: обновлено -> ${snap.heroes.length} героев, ${snap.items.length} предметов, ${snap.lanes.length} линии, версия клиента ${snap.clientVersion}`);
}

// meta.json читает быстрый сторож (scripts/watch.mjs): версия клиента и список активных героев
meta.clientVersion = enSnap.clientVersion;
meta.heroIds = enSnap.heroes.map((h) => h.id).sort((a, b) => a - b);
if (changed || !(await exists(path.join(OUT, 'meta.json')))) {
  await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
}
console.log(changed ? 'CHANGED' : 'UNCHANGED');
