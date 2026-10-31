// Логика рандомайзера Deadlock. Чистые функции, без DOM.

// --- Сидированный генератор: одинаковый сид = одинаковый результат ---
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function rng(seed) {
  let a = xmur3(String(seed))();
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Порядок как в игровом магазине: Оружие, Спиритизм, Живучесть
export const CATS = ['weapon', 'spirit', 'vitality'];
export const SLOTS = 12;
export const MAX_ACTIVE = 4;

export const DEFAULTS = {
  slots: 12, // универсальные слоты (без привязки к категориям), фиксировано
  tiers: [1, 2, 3, 4], // какие тиры участвуют
  mode: 'chaos', // chaos | balanced | mono
  order: 'pseudo', // порядок покупки: chaos — полный рандом, pseudo — псевдо-рандом, phases — по фазам игры
  actives: 'random', // сколько активных предметов: 'random' (0–4 каждую крутку) или число 0–4
  types: [], // фильтр по классам героев (в интерфейсе убран); пусто = все
  exclude: [], // id героев, которых не выдавать
  lane: false, // разыгрывать линию на матч (флажок в «Правилах рандома»)
};

// Проверка: можно ли добавить item в текущую сборку героя
function compatible(item, build, opts, bySlug, hero) {
  if (hero && hero.banned && hero.banned.includes(item.slug)) return false; // герою не продаётся
  if (build.some((b) => b.slug === item.slug)) return false;
  // Улучшение «съедает» свой компонент, поэтому вместе их иметь нельзя (с учётом цепочек A <- B <- C)
  for (const b of build) {
    if (deepFrom(item, bySlug).has(b.slug) || deepFrom(b, bySlug).has(item.slug)) return false;
  }
  // у игрока всего 4 слота под активные предметы
  if (item.active && build.filter((b) => b.active).length >= MAX_ACTIVE) return false;
  return true;
}

const fromCache = new WeakMap();
function deepFrom(item, bySlug) {
  if (fromCache.has(item)) return fromCache.get(item);
  const out = new Set();
  const stack = [...item.from];
  while (stack.length) {
    const s = stack.pop();
    if (out.has(s)) continue;
    out.add(s);
    const it = bySlug[s];
    if (it) stack.push(...it.from);
  }
  fromCache.set(item, out);
  return out;
}

export function itemPool(items, opts) {
  const tiers = new Set(opts.tiers);
  return items.filter((i) => tiers.has(i.tier));
}

export function heroPool(heroes, opts) {
  return heroes.filter(
    (h) => (!opts.types.length || opts.types.includes(h.type)) && !opts.exclude.includes(h.id),
  );
}

// План категорий по слотам
function categoryPlan(r, opts) {
  const n = SLOTS;
  if (opts.mode === 'balanced') {
    const order = shuffle(r, CATS);
    return Array.from({ length: n }, (_, i) => order[i % 3]);
  }
  if (opts.mode === 'mono') {
    const c = pick(r, CATS);
    return Array(n).fill(c);
  }
  return Array(n).fill(null); // chaos
}

// ---- Псевдо-рандом: скрытая подкрутка под героя (полный рандом её не использует) ----
// hero.tune.w — множитель шанса предмета на этом герое (из реальных покупок и сборок, см. normalize.tuneHero),
// hero.tune.t — когда предмет обычно покупают (доля матча). Пользователю это нигде не показываем.
export const PSEUDO = {
  sharp: 0.8, // степень для весов: 0 — как полный рандом, больше — ближе к мете
  tau: 0.19, // «температура» порядка покупки: ниже — строже по времени покупки
  tries: 4, // сколько раз пересобрать, если сборка не прошла скрытые проверки
  minVit: 2, // в «Хаосе» минимум предметов живучести
};
const tuned = (opts, hero) => (opts.order === 'pseudo' || opts.order === 'curve') && hero && hero.tune && hero.tune.w && hero.tune.w.size;
function weightedPick(r, arr, wf) {
  const w = arr.map(wf);
  let x = r() * w.reduce((a, v) => a + v, 0);
  for (let k = 0; k < arr.length; k++) if ((x -= w[k]) <= 0) return arr[k];
  return arr[arr.length - 1];
}
const itemWeight = (hero, i) => Math.pow(hero.tune.w.get(i.id >>> 0) || 1, PSEUDO.sharp);

// want: true — нужен активный предмет, false — пассивный, null — любой
// tiers — ограничение по тирам для слота (режим «по фазам»), null — любые включённые
// pred — доп. условие для слота (режим «Баланс рандом»: апгрейд, собираемый из дешёвого компонента)
// widen — сначала соседний тир той же категории, и только потом другая категория («Баланс рандом»)
// onlyPred — вернуть null, если предмета под условие слота нет (тогда слот берёт обычную полку)
export function rollItem(r, items, build, opts, cat, hero, want = null, tiers = null, pred = null, widen = false, onlyPred = false) {
  const bySlug = Object.fromEntries(items.map((i) => [i.slug, i]));
  const ok = (i, c, w, t, pr) => (!c || i.cat === c) && (w === null || i.active === w) && (!t || t.includes(i.tier)) && (!pr || pr(i, bySlug)) && compatible(i, build, opts, bySlug, hero);
  const pool = itemPool(items, opts);
  // сначала строго, потом ослабляем: условие слота → тир → категория → тип слота
  const wide = widen && tiers ? [...new Set(tiers.flatMap((x) => [x - 1, x, x + 1]))].filter((x) => opts.tiers.includes(x)) : null;
  // в «Баланс рандоме» категория слота («Поровну», «Все в один») и ценовая полка важнее, чем активка
  const steps = wide
    ? [[cat, want, tiers], [cat, want, wide], [cat, null, tiers], [cat, null, wide], [null, want, tiers], [null, null, tiers], [cat, want, null], [null, want, null], [null, null, null]]
    : [[cat, want, tiers], [null, want, tiers], [cat, null, tiers], [null, null, tiers], [cat, want, null], [null, want, null], [null, null, null]];
  // «скачок» на апгрейд — только в категории слота; не нашёлся — слот получает обычную полку
  const predSteps = pred ? (wide ? [[cat, want, tiers, pred], [cat, null, tiers, pred]] : [[cat, want, tiers, pred], [null, want, tiers, pred], [cat, null, tiers, pred]]) : [];
  for (const [c, w, t, pr] of onlyPred ? predSteps : [...predSteps, ...steps]) {
    const p = pool.filter((i) => ok(i, c, w, t, pr));
    if (p.length) return tuned(opts, hero) ? weightedPick(r, p, (i) => itemWeight(hero, i)) : pick(r, p);
  }
  return null;
}

// ---- Порядок покупки ----
// Слоты в Deadlock нумеруются сверху вниз, затем следующий столбец; build хранится в порядке покупки.
// Фазы для режима «по фазам»: 12 слотов = 3 фазы по 4 предмета.
export const PHASES = [
  { key: 'early', from: 0, to: 4, tiers: [1, 2] },
  { key: 'mid', from: 4, to: 8, tiers: [2, 3] },
  { key: 'late', from: 8, to: 12, tiers: [3, 4] },
];
export const phaseOf = (idx) => PHASES.find((p) => idx >= p.from && idx < p.to) || PHASES[PHASES.length - 1];

// Тиры фазы с учётом включённых в настройках; если пересечения нет — любые включённые
export function phaseTiers(idx, opts) {
  const t = phaseOf(idx).tiers.filter((x) => opts.tiers.includes(x));
  return t.length ? t : null;
}

// ---- «Баланс рандом»: порядок покупки по кривой стоимости ----
// Подбор предметов — как в псевдо-рандоме (под героя), но каждый слот имеет свою «ценовую полку»:
// дешёвый старт без накоплений, дорогое — в конце. Иногда слот «прыгает» на апгрейд, который
// собирается из дешёвого компонента (его можно купить сразу, а доплатить позже).
// up.from — максимальный тир компонентов апгрейда, up.p — шанс такого слота.
export const CURVE = [
  { t: [1] },
  { t: [1], up: { t: [2], from: 1, p: 0.3 } },
  { t: [1, 2] },
  { t: [2] },
  { t: [2], up: { t: [3], from: 2, p: 0.3 } },
  { t: [3], up: { t: [4], from: 2, p: 0.35 } },
  { t: [3] },
  { t: [3, 4] },
  { t: [4] },
  { t: [4] },
  { t: [4] },
  { t: [4] },
];
const fromCheap = (maxTier) => (i, bySlug) => i.from.length > 0 && i.from.every((sl) => bySlug[sl] && bySlug[sl].tier <= maxTier);
// тиры и условие для слота idx с учётом включённых в настройках тиров
function curveSlot(r, idx, opts) {
  const c = CURVE[Math.min(idx, CURVE.length - 1)];
  const useUp = c.up && r() < c.up.p;
  const t = (useUp ? c.up.t : c.t).filter((x) => opts.tiers.includes(x));
  const base = c.t.filter((x) => opts.tiers.includes(x));
  if (!t.length) return { tiers: base.length ? base : null, base: base.length ? base : null, pred: null };
  return { tiers: t, base: base.length ? base : t, pred: useUp ? fromCheap(c.up.from) : null };
}
// Слоты 1, 5 и 6: если у выпавшего предмета есть апгрейд на тир выше — показываем сразу апгрейд
// (дешёвую часть покупают на старте, доводят позже). Выбор между апгрейдами — с подкруткой под героя.
// Потолок: слот 1 — до 1600 (тир II), слот 5 — до 3200 (III), слот 6 — до 6400 (IV); «скачки» выше не поднимаем.
export const CURVE_UPGRADE_MAX = { 0: 2, 4: 3, 5: 4 };
export const CURVE_UPGRADE_SLOTS = Object.keys(CURVE_UPGRADE_MAX).map(Number);
export function curveUpgrade(r, items, build, idx, item, opts, hero) {
  if (!item || !(idx in CURVE_UPGRADE_MAX) || item.tier + 1 > CURVE_UPGRADE_MAX[idx] || !opts.tiers.includes(item.tier + 1)) return item;
  const bySlug = Object.fromEntries(items.map((i) => [i.slug, i]));
  const rest = build.filter((b) => b !== item);
  const ups = items.filter((u) => u.tier === item.tier + 1 && u.from.includes(item.slug) && u.active === item.active && (opts.mode === 'chaos' || u.cat === item.cat) && compatible(u, rest, opts, bySlug, hero));
  if (!ups.length) return item;
  return tuned(opts, hero) ? weightedPick(r, ups, (u) => itemWeight(hero, u)) : pick(r, ups);
}

// для перекрута одного слота: его обычная полка + тир текущего предмета
export function curveTiers(idx, opts, cur) {
  const c = CURVE[Math.min(idx, CURVE.length - 1)];
  const t = [...new Set([...c.t, ...(c.up ? c.up.t : []), ...(cur ? [cur.tier] : [])])].filter((x) => opts.tiers.includes(x));
  return t.length ? t : null;
}

// примерная доля матча, когда покупают предмет тира (если по герою нет данных)
const TIER_T = { 1: 0.22, 2: 0.33, 3: 0.48, 4: 0.64 };
export function orderBuild(r, build, mode, hero = null) {
  const b = build.slice();
  if (mode === 'curve') {
    // запасной вариант (обычно «Баланс рандом» сразу собирается в нужном порядке): по цене, равные — случайно
    return shuffle(r, b).sort((x, y) => x.cost - y.cost);
  }
  if (mode === 'phases') {
    // по возрастанию цены; равные по цене — в случайном порядке
    return shuffle(r, b).sort((x, y) => x.cost - y.cost);
  }
  if (mode === 'pseudo' && hero && hero.tune && hero.tune.t && hero.tune.t.size) {
    // как обычно покупают на этом герое: шанс оказаться следующим ∝ exp(−время покупки / τ).
    // Ранние предметы обычно раньше, но дорогой предмет может выпасть и в 1–2 слот.
    const tOf = (i) => (hero.tune.t.has(i.id >>> 0) ? hero.tune.t.get(i.id >>> 0) : TIER_T[i.tier] || 0.4);
    const out = [];
    while (b.length) out.push(b.splice(b.indexOf(weightedPick(r, b, (i) => Math.exp(-tOf(i) / PSEUDO.tau))), 1)[0]);
    return out;
  }
  if (mode === 'pseudo') {
    // взвешенный рандом: шанс оказаться следующим ∝ 1 / цена — дешёвые обычно раньше, но не всегда
    const out = [];
    while (b.length) {
      const w = b.map((i) => 1 / Math.max(1, i.cost));
      let x = r() * w.reduce((a, v) => a + v, 0);
      let k = 0;
      while (k < b.length - 1 && (x -= w[k]) > 0) k++;
      out.push(b.splice(k, 1)[0]);
    }
    return out;
  }
  return shuffle(r, b); // chaos
}

// Сколько активок в этой крутке: случайно 0–4 или фиксированное число из настроек
export function activeTarget(r, opts) {
  if (opts.actives === 'random' || opts.actives === undefined || opts.actives === null) return Math.floor(r() * (MAX_ACTIVE + 1));
  return Math.max(0, Math.min(MAX_ACTIVE, Math.round(+opts.actives) || 0));
}

export function rollBuild(r, items, opts, hero, k = activeTarget(r, opts)) {
  if (!tuned(opts, hero)) return rollBuildOnce(r, items, opts, hero, k);
  // псевдо-рандом: несколько попыток, берём первую, прошедшую скрытые проверки
  let best = null, bestScore = -Infinity;
  for (let a = 0; a < PSEUDO.tries; a++) {
    const b = rollBuildOnce(r, items, opts, hero, k);
    const sc = pseudoCheck(b, opts);
    if (sc >= 0) return b;
    if (sc > bestScore) { best = b; bestScore = sc; }
  }
  return best;
}
// ≥ 0 — сборка годится; меньше — насколько не хватило
function pseudoCheck(build, opts) {
  if (opts.mode !== 'chaos') return 0; // «Поровну» и «Все в один» и так задают категории
  return build.filter((i) => i.cat === 'vitality').length - PSEUDO.minVit;
}

function rollBuildOnce(r, items, opts, hero, k) {
  const plan = categoryPlan(r, opts);
  const curve = opts.order === 'curve';
  const slotRule = curve ? plan.map((_, i) => curveSlot(r, i, opts)) : null;
  // в «Баланс рандоме» активки — со 3-го слота: активных предметов за 800 в игре всего 4
  const activeFrom = curve ? 2 : 0;
  const activeSlots = new Set(shuffle(r, plan.map((_, i) => i).filter((i) => i >= activeFrom)).slice(0, k));
  // активки выбираем первыми: их меньше, и им важнее не упереться в запреты
  const order = [...activeSlots, ...plan.map((_, i) => i).filter((i) => !activeSlots.has(i))];
  const build = [];
  const bySlot = [];
  for (const idx of order) {
    const tiers = curve ? slotRule[idx].tiers : opts.order === 'phases' ? phaseTiers(idx, opts) : null;
    let it = null;
    if (curve && slotRule[idx].pred) it = rollItem(r, items, build, opts, plan[idx], hero, activeSlots.has(idx), tiers, slotRule[idx].pred, true, true);
    if (!it) it = rollItem(r, items, build, opts, plan[idx], hero, activeSlots.has(idx), curve ? slotRule[idx].base : tiers, null, curve);
    if (it) { build.push(it); bySlot[idx] = it; }
  }
  // «Баланс рандом»: предметы стоят в слотах своей полки — порядок покупки уже готов
  if (curve) {
    for (const idx of CURVE_UPGRADE_SLOTS) {
      const cur = bySlot[idx];
      const up = curveUpgrade(r, items, bySlot.filter(Boolean), idx, cur, opts, hero);
      if (up !== cur) bySlot[idx] = up;
    }
    return bySlot.filter(Boolean);
  }
  return build;
}

// ---- Оценка затара ----
// stats.heroes[heroId] = { base: WR героя ×1000, items: { itemId: delta ×1000 } }
// delta — разница винрейта предмета со средним по его тиру на этом герое (см. normalize.itemScores).
// Пороги вердиктов откалиброваны по 20 000 случайных сборок (scripts/calibrate.mjs).
export const VERDICTS = [
  { min: 0, key: 'meta' }, // лучшие ~10% случайных сборок
  { min: -10, key: 'solid' }, // ~10–40%
  { min: -20, key: 'risky' }, // ~40–70%
  { min: -32, key: 'challenge' }, // ~70–90%
  { min: -Infinity, key: 'troll' }, // худшие ~10%
];

// Положение на шкале оценки (0–100%). Шкала поделена на 5 равных зон — по одной на вердикт,
// границы зон = пороги вердиктов, поэтому указатель всегда стоит в зоне своего вердикта.
// Внутри зоны — линейно; края шкалы: −6 п.п. и +2 п.п. (×10 = −60 и +20).
export const METER_ENDS = [-60, 20];
export function meterPos(mean10) {
  const bounds = [METER_ENDS[0], ...VERDICTS.slice(0, -1).map((v) => v.min).reverse(), METER_ENDS[1]]; // [-60,-32,-20,-10,0,20]
  const zones = bounds.length - 1;
  const x = Math.max(bounds[0], Math.min(bounds[zones], mean10));
  let z = 0;
  while (z < zones - 1 && x >= bounds[z + 1]) z++;
  const frac = (x - bounds[z]) / (bounds[z + 1] - bounds[z]);
  return Math.min(99.5, Math.max(0.5, ((z + frac) / zones) * 100));
}

// Игровая шкала «вклад в победу». Реальная разница между затарами — единицы процентов
// (46% против 50% выглядят одинаково), поэтому для человека растягиваем её по зонам вердиктов:
// «Мета» ≈ 50–62%, «Рабочая» 41–50%, «Рискованно» 33–41%, «Челлендж» 25–33%, «Троллинг» 12–25%.
// Узлы совпадают с порогами вердиктов, поэтому число всегда в своей зоне шкалы. Честная оценка — realChance.
export const IMPACT_POINTS = [[-60, 12], [-32, 25], [-20, 33], [-10, 41], [0, 50], [20, 62]];
export function impactChance(mean10) {
  const P = IMPACT_POINTS;
  const x = Math.max(P[0][0], Math.min(P[P.length - 1][0], mean10));
  for (let i = 1; i < P.length; i++) {
    if (x <= P[i][0]) {
      const [x0, y0] = P[i - 1], [x1, y1] = P[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return P[P.length - 1][1];
}

// Поправка за состав затара. Сила предметов считается по отдельности, поэтому 12 сильных предметов
// одного цвета давали завышенный шанс, хотя герой без живучести умирает, а стрелок без оружия не наносит урон.
// mix — как игроки на этом герое обычно делят души (stats.json, считает sync). Штраф ×1000, как и оценки:
//  • перекос: расстояние между долями душ затара и типичными долями героя сверх допуска;
//  • пустая категория, в которую герой обычно вкладывает заметную долю (gaps — для подписи).
export const MIX = { tol: 0.25, k: 40, miss: { vitality: 40, weapon: 30, spirit: 20 }, missMin: 0.15, def: { weapon: 0.3, spirit: 0.45, vitality: 0.25 } };
export function mixPenalty(build, mix) {
  const m = mix || MIX.def;
  const souls = { weapon: 0, spirit: 0, vitality: 0 };
  let total = 0;
  for (const i of build) if (souls[i.cat] !== undefined) { souls[i.cat] += i.cost || 0; total += i.cost || 0; }
  if (!total) return { penalty: 0, gaps: [] };
  let dist = 0;
  for (const c of CATS) dist += Math.abs(souls[c] / total - (m[c] || 0));
  let penalty = Math.max(0, dist / 2 - MIX.tol) * MIX.k;
  const gaps = [];
  for (const c of CATS) if (!souls[c] && (m[c] || 0) >= MIX.missMin) { penalty += MIX.miss[c] * m[c]; gaps.push(c); }
  return { penalty: Math.round(penalty * 10) / 10, gaps };
}

export function scoreBuild(build, heroStats) {
  if (!heroStats || !heroStats.items) return null;
  const known = build.filter((i) => heroStats.items[i.id >>> 0] !== undefined);
  if (known.length < Math.ceil(build.length / 2)) return null; // мало данных — например, совсем новый герой
  const avg = known.reduce((a, i) => a + heroStats.items[i.id >>> 0], 0) / known.length; // ×1000
  const { penalty, gaps } = mixPenalty(build, heroStats.mix);
  const mean = Math.round(avg - penalty); // целые ×1000: процент и вердикт меняются вместе, без споров округления на границах
  const base = heroStats.base || 500;
  // Шанс сборки при «среднем» герое: 50% + вклад предметов. Силу героя (base) не добавляем,
  // иначе сильный герой с плохим затаром показывал бы больше, чем слабый с хорошим.
  const realChance = Math.max(250, Math.min(750, 500 + mean)) / 10; // честная оценка, в процентах
  const chance = Math.round(impactChance(mean) * 10) / 10; // то, что видит игрок
  const verdict = VERDICTS.find((v) => mean >= v.min).key;
  return { mean: mean / 10, chance, realChance, base: base / 10, verdict, known: known.length, total: build.length, penalty: penalty / 10, gaps };
}

// Порядок прокачки как в игре: у каждой способности 4 шага — открытие и 3 улучшения
// (за 1, 2 и 5 очков). Ульту можно открыть только после того, как открыты
// три базовые способности. Возвращает индексы способностей длиной 16, например [2,0,2,1,...]
// plan (псевдо и баланс рандом): pos — типичный шаг каждого события умения (hero.tune.s, 4×4),
// force — умение, которое открываем первым и качаем раньше (заряды под Extra Charge), need — до какого улучшения.
export function rollSkillOrder(r, abilityCount = 4, ultIndex = abilityCount - 1, steps = 4, plan = null) {
  const left = Array(abilityCount).fill(steps);
  const out = [];
  const basesOpen = () => left.every((v, i) => i === ultIndex || v < steps);
  const target = (i, e) => {
    if (plan.force === i && e <= plan.need) return e * 2; // открыть сразу, нужные улучшения — через шаг
    const p = plan.pos ? plan.pos[i * steps + e] : e * 4 + 1.5;
    return plan.force === i ? p - SKILL.charge : p;
  };
  while (out.length < abilityCount * steps) {
    const avail = [];
    for (let i = 0; i < abilityCount; i++) {
      if (left[i] <= 0) continue;
      if (i === ultIndex && left[i] === steps && !basesOpen()) continue;
      avail.push(i);
    }
    const n = out.length;
    const i = !plan ? pick(r, avail)
      : n === 0 && plan.force >= 0 && avail.includes(plan.force) ? plan.force
      : weightedPick(r, avail, (a) => Math.exp(-Math.max(-6, target(a, steps - left[a]) - n) / SKILL.tau));
    left[i]--;
    out.push(i);
  }
  return out;
}

// Прокачка с учётом героя и затара. Полный рандом — как раньше, равновероятно.
// Псевдо и баланс рандом: порядок близок к тому, как героя качают игроки (hero.tune.s, скрыто),
// а если Extra Charge / Rapid Recharge в первых 4 слотах — первым открываем и раньше качаем умение с зарядами.
export const SKILL = { tau: 1.4, charge: 3, early: 4 };
const CHARGE_ITEMS = new Set(['upgrade_extra_charge', 'upgrade_rapid_recharge']);
export function skillsFor(r, hero, build, opts) {
  const ult = ultIndexOf(hero);
  if (!opts || (opts.order !== 'pseudo' && opts.order !== 'curve')) return rollSkillOrder(r, 4, ult);
  const ab = (hero && hero.abilities) || [];
  const pos = hero && hero.tune && hero.tune.s ? hero.tune.s : null;
  let force = -1, need = 0;
  if ((build || []).slice(0, SKILL.early).some((i) => CHARGE_ITEMS.has(i.slug))) {
    const c = ab.map((a, i) => ({ a, i })).filter((x) => !x.a.ult && x.i !== ult && x.a.charge !== undefined && x.a.charge !== null);
    if (c.length) {
      const best = Math.min(...c.map((x) => x.a.charge));
      const top = c.filter((x) => x.a.charge === best);
      // из равных — то, что игроки обычно открывают раньше
      top.sort((x, y) => (pos ? pos[x.i * 4] - pos[y.i * 4] : 0));
      force = top[0].i;
      need = best;
    }
  }
  if (!pos && force < 0) return rollSkillOrder(r, 4, ult);
  return rollSkillOrder(r, 4, ult, 4, { pos, force, need });
}

export function ultIndexOf(hero) {
  const ab = (hero && hero.abilities) || [];
  const i = ab.findIndex((a) => a.ult);
  return i >= 0 ? i : 3;
}

export function sortBuild(build) {
  const order = { weapon: 0, spirit: 1, vitality: 2 };
  return build.slice().sort((a, b) => order[a.cat] - order[b.cat] || b.tier - a.tier || a.name.localeCompare(b.name));
}

export function roll(data, opts, seed, lockedHero) {
  const r = rng(seed);
  const heroes = heroPool(data.heroes, opts);
  const hero = lockedHero || (heroes.length ? pick(r, heroes) : pick(r, data.heroes));
  const k = activeTarget(r, opts);
  const built = rollBuild(r, data.items, opts, hero, k);
  const build = opts.order === 'curve' ? built : orderBuild(r, built, opts.order, hero);
  const skills = skillsFor(r, hero, build, opts);
  // линию разыгрываем последней, чтобы флажок не менял героя и сборку при том же сиде
  const lane = opts.lane && data.lanes && data.lanes.length ? pick(r, data.lanes) : null;
  return { seed, hero, lane, build, skills, actives: k };
}

// Новый герой под уже выпавшую сборку: только те, кому все предметы доступны
export function rollHeroFor(r, data, opts, build, exceptId) {
  const ok = (h) => !build.some((i) => h.banned && h.banned.includes(i.slug));
  let pool = heroPool(data.heroes, opts).filter((h) => h.id !== exceptId && ok(h));
  if (!pool.length) pool = data.heroes.filter((h) => h.id !== exceptId && ok(h));
  return pool.length ? pick(r, pool) : null;
}

export function buildCost(build) {
  return build.reduce((s, i) => s + (i.cost || 0), 0);
}

// Компактная ссылка на конкретный результат (не зависит от сида и обновлений данных)
export function encodeResult(res) {
  const parts = [
    res.hero.id.toString(36),
    res.lane ? res.lane.css : '-',
    res.build.map((i) => (i.id >>> 0).toString(36)).join('.'),
    res.skills.join(''),
  ];
  return parts.join('~');
}

export function decodeResult(code, data) {
  try {
    const [h, lane, items, skills] = String(code).split('~');
    const hero = data.heroes.find((x) => x.id === parseInt(h, 36));
    if (!hero) return null;
    const byId = Object.fromEntries(data.items.map((i) => [(i.id >>> 0).toString(36), i]));
    const build = items ? items.split('.').map((k) => byId[k]).filter(Boolean) : [];
    return {
      seed: null,
      hero,
      lane: data.lanes.find((l) => l.css === lane) || null,
      build,
      skills: (skills || '').split('').map(Number).filter((n) => n >= 0 && n < 4),
    };
  } catch {
    return null;
  }
}
