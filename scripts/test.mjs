// Быстрая проверка логики рандомайзера на реальном снимке данных.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { roll, DEFAULTS, encodeResult, decodeResult, rollSkillOrder, rng, ultIndexOf, rollHeroFor, scoreBuild, meterPos, VERDICTS, MAX_ACTIVE, PHASES } from '../public/js/random.js';
const stats = JSON.parse(await readFile(new URL('../public/data/stats.json', import.meta.url), 'utf8'));

const data = JSON.parse(await readFile(new URL('../public/data/ru.json', import.meta.url), 'utf8'));
const plain = JSON.parse(JSON.stringify(data)); // без подкрутки — для сравнения
const { attachTune } = await import('../public/js/normalize.js');
let tune = null;
try { tune = JSON.parse(await readFile(new URL('../public/data/tune.json', import.meta.url), 'utf8')); } catch {}
attachTune(data, tune);
const bySlug = Object.fromEntries(data.items.map((i) => [i.slug, i]));

function deep(i, seen = new Set()) {
  for (const s of i.from) if (!seen.has(s)) { seen.add(s); if (bySlug[s]) deep(bySlug[s], seen); }
  return seen;
}

const variants = [
  { ...DEFAULTS },
  { ...DEFAULTS, mode: 'balanced' },
  { ...DEFAULTS, mode: 'mono' },
  { ...DEFAULTS, tiers: [3, 4] },
  { ...DEFAULTS, actives: 2 },
  { ...DEFAULTS, actives: 4 },
  { ...DEFAULTS, actives: 0 },
  { ...DEFAULTS, order: 'pseudo' },
  { ...DEFAULTS, order: 'pseudo', mode: 'balanced', actives: 3 },
  { ...DEFAULTS, order: 'pseudo', mode: 'mono' },
  { ...DEFAULTS, order: 'chaos' },
  { ...DEFAULTS, order: 'phases' },
  { ...DEFAULTS, order: 'phases', mode: 'balanced', actives: 4 },
];

let n = 0;
for (const opts of variants) {
  for (let k = 0; k < 400; k++) {
    const res = roll(data, opts, 'seed' + k);
    n++;
    assert.equal(res.build.length, 12, 'полная сборка');
    assert.equal(new Set(res.build.map((i) => i.slug)).size, res.build.length, 'без повторов');
    for (const a of res.build) for (const b of res.build) if (a !== b) assert.ok(!deep(a).has(b.slug), `компонент в сборке: ${a.name} + ${b.name}`);
    assert.ok(res.build.every((i) => opts.tiers.includes(i.tier)), 'тиры');
    for (const i of res.build) assert.ok(!res.hero.banned.includes(i.slug), `${res.hero.name} не может купить ${i.name}`);
    const other = rollHeroFor(rng('h' + k), data, opts, res.build, res.hero.id);
    if (other) for (const i of res.build) assert.ok(!other.banned.includes(i.slug), `смена героя: ${other.name} не может купить ${i.name}`);
    const act = res.build.filter((i) => i.active).length;
    assert.ok(act <= MAX_ACTIVE, 'не больше 4 активок');
    assert.ok(res.actives >= 0 && res.actives <= MAX_ACTIVE, 'цель активок 0–4');
    if (opts.mode === 'chaos') assert.equal(act, res.actives, `активок ровно ${res.actives}`);
    if (typeof opts.actives === 'number') assert.equal(res.actives, opts.actives, 'фиксированное число активок');
    const sc = scoreBuild(res.build, stats.heroes[res.hero.id]);
    if (sc) { const zone = Math.min(4, Math.floor(meterPos(sc.mean * 10) / 20)); assert.equal(['troll', 'challenge', 'risky', 'solid', 'meta'][zone], sc.verdict, `шкала: ${sc.mean} п.п.`); }
    if (sc) assert.ok(sc.chance >= 12 && sc.chance <= 62 && sc.realChance >= 25 && sc.realChance <= 75 && ['meta', 'solid', 'risky', 'challenge', 'troll'].includes(sc.verdict), 'оценка');
    if (opts.mode === 'mono') assert.equal(new Set(res.build.map((i) => i.cat)).size, 1, 'моно-категория');
    if (opts.mode === 'balanced') {
      const c = {}; for (const i of res.build) c[i.cat] = (c[i.cat] || 0) + 1;
      assert.ok(Math.max(...Object.values(c)) - Math.min(...Object.values(c)) <= 1, 'баланс категорий');
    }
    if (opts.order === 'phases') {
      for (let i = 1; i < 12; i++) assert.ok(res.build[i - 1].cost <= res.build[i].cost, 'по фазам: цены по возрастанию');
      for (const ph of PHASES) for (let i = ph.from; i < ph.to; i++) assert.ok(ph.tiers.includes(res.build[i].tier), `фаза ${ph.key}: тир ${res.build[i].tier} в слоте ${i + 1}`);
    }
    // порядок прокачки: каждая способность ровно 4 раза
    const cnt = [0, 0, 0, 0]; res.skills.forEach((s) => cnt[s]++);
    assert.deepEqual(cnt, [4, 4, 4, 4]);
    // ульта открывается только после трёх базовых способностей
    const u = ultIndexOf(res.hero);
    const firstUlt = res.skills.indexOf(u);
    for (let a = 0; a < 4; a++) if (a !== u) assert.ok(res.skills.indexOf(a) < firstUlt, `ульта раньше базовой (${res.hero.name})`);
    // ссылка восстанавливает тот же результат
    const back = decodeResult(encodeResult(res), data);
    assert.equal(back.hero.id, res.hero.id);
    assert.deepEqual(back.build.map((i) => i.id), res.build.map((i) => i.id));
    assert.deepEqual(back.skills, res.skills);
  }
}
// реальные запреты из игры
const hero = (n) => data.heroes.find((h) => h.name === n);
const nameOf = (s) => bySlug[s] && bySlug[s].name;
assert.ok(hero('Abrams').banned.map(nameOf).includes('Extra Charge'), 'Abrams: Extra Charge');
assert.ok(hero('Abrams').banned.map(nameOf).includes('Rapid Recharge'), 'Abrams: Rapid Recharge');
assert.ok(hero('Deadman Danny').banned.length >= 5, 'Danny: хедшот-предметы запрещены');
// новые герои с устаревшим флагом in_development на месте
for (const n of ['Violet', 'Baba']) assert.ok(hero(n), `${n} в пуле`);

// Sprint Boots -> Enduring Speed
const es = data.items.find((i) => i.name === 'Enduring Speed');
assert.ok(es.from.includes(data.items.find((i) => i.name === 'Sprint Boots').slug), 'Enduring Speed собирается из Sprint Boots');

// код сборки для игры: читается обратно, предметы и прокачка на месте
{
  const { encodeBuildCode, decodeBuildCode, MAX_BYTES } = await import('../public/js/buildcode.js');
  for (let k = 0; k < 200; k++) {
    const res = roll(data, DEFAULTS, 'g' + k);
    const code = encodeBuildCode({ heroId: res.hero.id, name: 'Shuffle · ' + res.hero.name, desc: 'https://example.com/?b=' + 'x'.repeat(80), categories: [{ name: 'Порядок покупки 1→12', items: res.build.map((i) => i.id) }], abilityOrder: res.skills, abilityIds: res.hero.abilities.map((a) => a.id) });
    const d = decodeBuildCode(code);
    assert.equal(d.heroId, res.hero.id);
    assert.deepEqual(d.categories[0].items, res.build.map((i) => i.id >>> 0));
    assert.equal(d.changes.length, 16);
    assert.equal(d.changes.filter((c) => c.type === 2).length, 4, '4 открытия');
    assert.ok(atob(code).length < MAX_BYTES);
  }
  for (const h of data.heroes) assert.equal(h.abilities.filter((a) => a.id).length, 4, `id способностей: ${h.name}`);
}

// процент и вердикт растут вместе
{
  const rank = { troll: 0, challenge: 1, risky: 2, solid: 3, meta: 4 };
  const xs = [];
  for (let k = 0; k < 2000; k++) { const r = roll(data, DEFAULTS, 'v' + k); const sc = scoreBuild(r.build, stats.heroes[r.hero.id]); if (sc) xs.push(sc); }
  xs.sort((a, b) => a.chance - b.chance);
  for (let i = 1; i < xs.length; i++) assert.ok(rank[xs[i].verdict] >= rank[xs[i - 1].verdict], `шанс ${xs[i].chance} при вердикте ${xs[i].verdict} ниже ${xs[i - 1].verdict}`);
}

// детерминизм сида
assert.deepEqual(roll(data, DEFAULTS, 'abc').build.map((i) => i.id), roll(data, DEFAULTS, 'abc').build.map((i) => i.id));
assert.equal(rollSkillOrder(rng('x')).length, 16);

const ex = roll(data, DEFAULTS, 'demo');
// псевдо-рандом: дешёвые в среднем раньше, но не строго
let early = 0, inversions = 0;
for (let k = 0; k < 300; k++) {
  const b = roll(data, { ...DEFAULTS, order: 'pseudo' }, 'p' + k).build;
  early += b.slice(0, 4).reduce((a, i) => a + i.cost, 0) / 4 - b.slice(8).reduce((a, i) => a + i.cost, 0) / 4;
  for (let i = 1; i < 12; i++) if (b[i - 1].cost > b[i].cost) inversions++;
}
assert.ok(early < 0, 'псевдо: в начале дешевле, чем в конце');
assert.ok(inversions > 0, 'псевдо: порядок не строго по цене');

// скрытая подкрутка псевдо-рандома
if (tune) {
  const withTune = data.heroes.filter((h) => h.tune && h.tune.w.size).length;
  assert.ok(withTune >= data.heroes.length - 3, `подкрутка есть почти у всех героев (${withTune}/${data.heroes.length})`);
  // полный рандом от подкрутки не зависит — те же сборки, что и без неё
  for (let k = 0; k < 200; k++) {
    const o = { ...DEFAULTS, order: 'chaos' };
    assert.deepEqual(roll(data, o, 'c' + k).build.map((i) => i.id), roll(plain, o, 'c' + k).build.map((i) => i.id), 'полный рандом не изменился');
  }
  // псевдо-рандом заметно чаще выдаёт «родные» герою предметы, но остаётся разнообразным
  const fit = (o) => {
    let s = 0, n = 0; const seen = new Set();
    for (let k = 0; k < 1500; k++) { const r = roll(data, o, 'f' + k); for (const i of r.build) { s += Math.log(r.hero.tune.w.get(i.id >>> 0) || 1); n++; seen.add(r.hero.id + ':' + i.id); } }
    return { avg: s / n, variety: seen.size };
  };
  const a = fit({ ...DEFAULTS, order: 'chaos' }), b = fit({ ...DEFAULTS, order: 'pseudo' });
  assert.ok(b.avg > a.avg + 0.3, `псевдо ближе к герою (${b.avg.toFixed(2)} против ${a.avg.toFixed(2)})`);
  assert.ok(b.variety > a.variety * 0.75, `псевдо остаётся разнообразным (${b.variety} против ${a.variety})`);
  // дорогой предмет может выпасть в 1–2 слот
  let t4 = 0; for (let k = 0; k < 1000; k++) if (roll(data, { ...DEFAULTS, order: 'pseudo' }, 't' + k).build.slice(0, 2).some((i) => i.tier === 4)) t4++;
  assert.ok(t4 > 30 && t4 < 400, `T4 в 1–2 слоте: ${t4} из 1000`);
}

console.log(`OK: ${n} роллов. Пример: ${ex.hero.name} / ${ex.build.map((i) => i.name).join(', ')}`);
await import("./test-match.mjs");
