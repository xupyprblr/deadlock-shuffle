// Тесты сопоставления матча со сборкой (фаза 2) на реальном матче из Deadlock API (scripts/fixtures/match-sample.json).
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parseSteamId, toSteam64, playerEvents, compareBuild, activeEntry, candidateMatches, pickPlayer, creditsOf, isWin, WINDOW_MS } from '../public/js/match.js';

const data = JSON.parse(await readFile(new URL('../public/data/ru.json', import.meta.url), 'utf8'));
const meta = JSON.parse(await readFile(new URL('./fixtures/match-sample.json', import.meta.url), 'utf8'));
const itemsById = new Map(data.items.map((i) => [i.id >>> 0, i]));
const bySlug = new Map(data.items.map((i) => [i.slug, i]));

// SteamID в разных видах
const acc = 1710092569;
const s64 = toSteam64(acc);
assert.equal(parseSteamId(String(acc)), acc);
assert.equal(parseSteamId(s64), acc);
assert.equal(parseSteamId(`https://steamcommunity.com/profiles/${s64}/`), acc);
assert.equal(parseSteamId(`[U:1:${acc}]`), acc);
assert.equal(parseSteamId('https://steamcommunity.com/id/somename'), null);
assert.equal(parseSteamId('abc'), null);

// разбор событий: покупки и прокачка
const p = pickPlayer(meta, acc);
assert.ok(p && p.events.length > 20, 'игрок найден в матче');
const hero = data.heroes.find((h) => h.id === meta.players[0].hero_id);
assert.ok(hero, 'герой матча есть в снимке');
const ev = playerEvents(p.events, hero, itemsById);
assert.equal(ev.unknown, 0, 'все события — предметы магазина или умения героя');
assert.ok(ev.buys.length >= 12, `покупок ${ev.buys.length}`);
assert.ok(ev.skills.length >= 10, `шагов прокачки ${ev.skills.length}`);
assert.ok(ev.skills.every((s) => s >= 0 && s < 4));

// сборка = первые 12 разных покупок в их порядке → 12/12, порядок 100%
const bought = [...new Set(ev.buys.map((b) => b.id))].slice(0, 12);
const entry = { hero: { id: hero.id }, items: bought, skills: ev.skills.slice(0, 16), at: 0 };
let r = compareBuild(entry, ev, itemsById, bySlug);
assert.equal(r.hit, 12); assert.ok(r.collected && r.isRandom);
assert.equal(r.order, 1);
assert.equal(r.skills.prefix, Math.min(16, ev.skills.length));

// обратный порядок покупки → порядок 0%
r = compareBuild({ ...entry, items: bought.slice().reverse() }, ev, itemsById, bySlug);
assert.equal(r.hit, 12); assert.ok(r.order < 0.05, `обратный порядок ${r.order}`);

// половина сборки не куплена → 6/12, ещё «рандом», но не «собран»
const notBought = data.items.filter((i) => ![...ev.buys].some((b) => creditsOf(itemsById.get(b.id), bySlug).has(i.id >>> 0)));
r = compareBuild({ ...entry, items: [...bought.slice(0, 6), ...notBought.slice(0, 6).map((i) => i.id)] }, ev, itemsById, bySlug);
assert.equal(r.hit, 6); assert.ok(r.isRandom && !r.collected); assert.equal(r.missIds.length, 6);

// компонент засчитывается покупкой улучшения
const up = ev.buys.map((b) => itemsById.get(b.id)).find((i) => i.from && i.from.length && !ev.buys.some((b) => itemsById.get(b.id).slug === i.from[0]));
if (up) {
  const comp = bySlug.get(up.from[0]);
  r = compareBuild({ ...entry, items: [comp.id] }, ev, itemsById, bySlug);
  assert.equal(r.hit, 1, `компонент ${comp.name} засчитан покупкой ${up.name}`);
}

// другой порядок прокачки
r = compareBuild({ ...entry, skills: ev.skills.map((s) => (s + 1) % 4) }, ev, itemsById, bySlug);
assert.equal(r.skills.same, 0); assert.equal(r.skills.prefix, 0);

// активная сборка: последняя до начала матча, того же героя, в окне 7 дней
const H = hero.id, t0 = 1_800_000_000_000;
const j = [
  { id: 'a', hero: { id: H }, at: t0 - 3600e3 },
  { id: 'b', hero: { id: H }, at: t0 - 600e3 },
  { id: 'c', hero: { id: H }, at: t0 + 60e3 }, // забрана после начала — не в зачёт
  { id: 'd', hero: { id: H + 1 }, at: t0 - 60e3 },
];
assert.equal(activeEntry(j, H, t0).id, 'b');
assert.equal(activeEntry(j, H, t0 - 1800e3).id, 'a');
assert.equal(activeEntry(j, H, t0 - 7200e3), null);
assert.equal(activeEntry(j, H, t0 - 600e3 + WINDOW_MS + 1).id, 'c');
const cand = candidateMatches(j, [
  { match_id: 1, hero_id: H, start_time: t0 / 1000 },
  { match_id: 2, hero_id: H + 5, start_time: t0 / 1000 },
]);
assert.deepEqual(cand.map((c) => [c.match.match_id, c.entry.id]), [[1, 'b']]);

// победа по истории
assert.ok(isWin({ match_result: 0, player_team: 0 }));
assert.ok(!isWin({ match_result: 1, player_team: 0 }));

// одиночный ответ API: игрок внутри match_info, hero_build_ids — словарь
assert.equal(pickPlayer({ match_info: { players: [{ account_id: 5, items: [] }] }, hero_build_ids: { 5: 777 } }, 5).buildId, 777);
assert.equal(pickPlayer({ match_info: { players: [{ account_id: 5, items: [] }] }, hero_build_ids: [] }, 5).buildId, null);

console.log(`OK: сопоставление матчей (${hero.name}: ${ev.buys.length} покупок, ${ev.skills.length} шагов прокачки)`);
