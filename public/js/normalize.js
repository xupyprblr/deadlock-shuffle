// Общий модуль нормализации данных Deadlock.
// Работает и в Node (scripts/sync.mjs), и в браузере (живое обновление).
// Вход — сырые ответы https://api.deadlock-api.com/v1/assets/*
// Выход — компактный JSON, который понимает фронтенд.

export const API = 'https://api.deadlock-api.com/v1/assets';
export const PATCHES = 'https://api.deadlock-api.com/v1/patches';
export const SCHEMA = 3;

export const LANGS = { ru: 'russian', en: 'english' };

const SHOP_CATS = ['weapon', 'vitality', 'spirit'];

// Убираем HTML, встроенные SVG и лишние пробелы из описаний.
export function plain(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function rgbHex(c) {
  if (!c) return null;
  if (c.style_hex) return c.style_hex;
  const a = c.style || c.ui;
  if (!Array.isArray(a)) return null;
  return '#' + a.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Герой доступен игрокам: выбираемый, не выключен и вышел в релиз.
// Главный признак — development_state: у свежих героев (Violet, Baba) старый флаг
// in_development остаётся true уже после выхода, поэтому на него опираемся только
// если статуса нет. Пре-релизные герои (pre_release, как Nurse Harrow до выхода) отсекаются,
// а после релиза подхватываются сами при следующей синхронизации.
export function isPlayable(h) {
  if (!h || !h.player_selectable || h.disabled) return false;
  if (h.development_state) return h.development_state === 'release';
  return !h.in_development && !h.prerelease_only;
}

export function normalizeAbility(a) {
  if (!a) return null;
  const d = a.description || {};
  return {
    id: a.id >>> 0, // id способности нужен для кода сборки (порядок прокачки)
    slug: a.class_name,
    name: a.name,
    icon: a.image_webp || a.image || null,
    ult: a.ability_type === 'ultimate',
    quip: plain(d.quip) || plain(d.desc).slice(0, 160),
    up: [plain(d.t1_desc), plain(d.t2_desc), plain(d.t3_desc)],
    // заряды: 0 — есть с открытия, 1–3 — появляются с этого улучшения, нет поля — умение без зарядов
    // (нужно для прокачки: с Extra Charge в начале сборки первым качаем умение с зарядами)
    ...chargeTier(a),
  };
}
function chargeTier(a) {
  const base = Number(a.properties && a.properties.AbilityCharges && a.properties.AbilityCharges.value);
  if (base > 0) return { charge: 0 };
  const k = (a.upgrades || []).findIndex((u) => (u.property_upgrades || []).some((p) => p.name === 'AbilityCharges' && Number(p.bonus) > 0));
  return k >= 0 ? { charge: k + 1 } : {};
}

// Типичный порядок прокачки героя (ability-order-stats за 30 дней): для каждого умения средний номер шага
// (0–15), на котором его открывают и улучшают 1-й, 2-й, 3-й раз. 16 чисел по порядку умений героя.
// Веса — число матчей с этим порядком. Не сделанное до конца матча улучшение считается шагом 16.
export function skillTune(orders, abilities) {
  const ids = (abilities || []).map((a) => a.id >>> 0);
  if (ids.length !== 4 || !Array.isArray(orders) || !orders.length) return null;
  const sum = Array(16).fill(0);
  let W = 0;
  for (const o of orders) {
    const w = o.matches || 0;
    if (!w || !Array.isArray(o.abilities)) continue;
    const seen = [0, 0, 0, 0];
    const pos = Array(16).fill(16);
    o.abilities.forEach((id, step) => {
      const i = ids.indexOf(id >>> 0);
      if (i < 0 || seen[i] >= 4 || step > 15) return;
      pos[i * 4 + seen[i]++] = step;
    });
    for (let k = 0; k < 16; k++) sum[k] += pos[k] * w;
    W += w;
  }
  return W ? sum.map((v) => Math.round((v / W) * 10) / 10) : null;
}

export function normalizeHero(h, abilityByClass) {
  const img = h.images || {};
  const slots = h.items || {};
  const abilities = ['signature1', 'signature2', 'signature3', 'signature4']
    .map((k) => normalizeAbility(abilityByClass ? abilityByClass[slots[k]] : null))
    .filter(Boolean);
  return {
    id: h.id,
    slug: h.class_name,
    name: h.name,
    type: h.hero_type || 'unknown',
    complexity: h.complexity || null,
    color: rgbHex(h.colors),
    role: plain(h.description && h.description.role),
    tags: Array.isArray(h.tags) ? h.tags.slice(0, 3) : [],
    card: img.icon_hero_card_webp || img.icon_hero_card || null,
    small: img.icon_image_small_webp || img.icon_image_small || null,
    addedAt: null, // когда герой впервые появился в пуле (из roster.json); null — давно в игре
    banned: [], // предметы, которые этот герой купить не может (см. bannedFromStats)
    abilitySlugs: ['signature1', 'signature2', 'signature3', 'signature4'].map((k) => slots[k]).filter(Boolean),
    abilities,
  };
}

export function normalizeItem(i) {
  return {
    id: i.id,
    slug: i.class_name,
    name: i.name,
    cat: i.item_slot_type,
    tier: i.item_tier,
    cost: i.cost,
    active: !!i.is_active_item,
    // shop_image — актуальные иллюстрации из магазина; image — старые плоские иконки (запасной вариант)
    icon: i.shop_image_webp || i.shop_image || i.image_webp || i.image || null,
    // class_name предметов-компонентов: купив улучшение, компонент «съедается»
    from: Array.isArray(i.component_items) ? i.component_items : [],
  };
}

export function isShopItem(i) {
  return (
    i.type === 'upgrade' &&
    i.shopable &&
    !i.disabled &&
    SHOP_CATS.includes(i.item_slot_type) &&
    i.item_tier >= 1 &&
    i.item_tier <= 4 && // тир V (легендарки) выпадает только в спецрежиме и случайно — не учитываем
    typeof i.cost === 'number'
  );
}

function laneHex(c) {
  if (!c) return null;
  return '#' + [c.red, c.green, c.blue].map((v) => (v || 0).toString(16).padStart(2, '0')).join('');
}

export function normalizeLanes(generic) {
  const list = (generic && generic.lane_info) || [];
  return list
    .filter((l) => l && l.css_class && !l.is_enemy_lane && l.lane_name && l.lane_name !== 'Unused')
    .map((l) => ({ name: l.lane_name, css: l.css_class, color: laneHex(l.color) }));
}

// Новости Steam: Valve публикует патч там сразу, а тема на форуме (лента PATCHES) появляется с опозданием.
// Из браузера недоступна (нет CORS) — читает только sync.mjs.
export const STEAM_NEWS = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=1422450&count=15&maxlength=1&feeds=steam_community_announcements';
const ptDate = (iso) => {
  const [m, d, y] = new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/');
  return `${m}-${d}-${y}`; // как Valve подписывает патчи: дата по тихоокеанскому времени
};
export function steamPatches(news) {
  const items = (news && news.appnews && news.appnews.newsitems) || [];
  return items
    .filter((n) => (n.tags || []).includes('patchnotes') || /\b(update|patch)\b/i.test(n.title || ''))
    .map((n) => {
      const iso = new Date(n.date * 1000).toISOString();
      return { title: ptDate(iso), pub_date: iso, link: n.url };
    });
}
// Самый свежий патч из любых источников (форум, Steam, уже известный снимку)
export function latestPatch(...lists) {
  const all = [];
  for (const l of lists) {
    if (Array.isArray(l)) all.push(...l);
    else if (l && l.date) all.push({ title: l.title, pub_date: l.date, link: l.link });
  }
  const ok = all.filter((p) => p && p.pub_date && p.title);
  if (!ok.length) return null;
  const p = ok.sort((a, b) => Date.parse(b.pub_date) - Date.parse(a.pub_date))[0];
  return { title: p.title, date: p.pub_date, link: p.link };
}

// Главная функция: собирает всё в один снимок.
export function buildSnapshot({ lang, heroes, upgrades, abilities, generic, patches, steam, clientVersion }) {
  const abilityByClass = {};
  for (const a of abilities || []) abilityByClass[a.class_name] = a;

  const heroList = (heroes || []).filter(isPlayable).map((h) => normalizeHero(h, abilityByClass));
  heroList.sort((a, b) => a.name.localeCompare(b.name, lang === 'ru' ? 'ru' : 'en'));

  const items = (upgrades || []).filter(isShopItem).map(normalizeItem);
  // Оставляем в «from» только реальные товары магазина
  const known = new Set(items.map((i) => i.slug));
  for (const it of items) it.from = it.from.filter((s) => known.has(s));
  items.sort((a, b) => a.tier - b.tier || a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));

  return {
    schema: SCHEMA,
    lang,
    fetchedAt: new Date().toISOString(),
    clientVersion: clientVersion || null,
    patch: latestPatch(patches, steamPatches(steam)),
    prices: (generic && generic.item_price_per_tier) || [0, 800, 1600, 3200, 6400, 9999],
    lanes: normalizeLanes(generic),
    heroes: heroList,
    items,
  };
}

// Запреты на покупку. В данных игры через API их нет, поэтому определяем по статистике:
// предмет, который у героя не купили ни разу за 30 дней при тысячах матчей, ему недоступен.
// Так находятся, например, предметы на хедшоты у Deadman Danny и заряды у Abrams.
export const STATS = 'https://api.deadlock-api.com/v1/analytics/item-stats';
// Запрет ставится, только если без него предмет купили бы хотя бы BAN_MIN_EXPECTED раз:
// ожидание = доля предмета в общей статистике × размер выборки героя.
// Так случайный ноль у редкого предмета или нового героя не станет ложным запретом.
export const BAN_MIN_EXPECTED = 200;
// Запрет, если покупок не больше 0,05% от ожидаемого. Порог стоит в разрыве распределения (24.10.2026):
// настоящие запреты — 0 или ≤0,026% (единичный шум: Abrams/Extra Charge — 20 покупок при ~490 тыс. ожидаемых),
// а просто непопулярные предметы начинаются от ~0,09% (Vyper/Echo Shard — 26 при 28 тыс.).
export const BAN_MAX_RATIO = 0.0005;
// Новый герой (первые часы и дни после выхода) — выборка мала и перекошена, запреты не считаем.
export const BAN_MIN_SAMPLE = 5000; // матчей у самого популярного предмета героя

export function bannedFromStats(stats, items, globalStats) {
  if (!Array.isArray(stats) || !stats.length || !Array.isArray(globalStats) || !globalStats.length) return [];
  const mine = new Map(stats.map((s) => [s.item_id >>> 0, s.matches || 0]));
  const all = new Map(globalStats.map((s) => [s.item_id >>> 0, s.matches || 0]));
  const top = Math.max(...stats.map((s) => s.matches || 0));
  const gTop = Math.max(...globalStats.map((s) => s.matches || 0));
  if (top < BAN_MIN_SAMPLE) return [];
  return items
    .filter((i) => {
      const expected = ((all.get(i.id >>> 0) || 0) / gTop) * top;
      // «почти ноль»: единичные покупки из других режимов или старых записей не отменяют запрет
      return expected >= BAN_MIN_EXPECTED && (mine.get(i.id >>> 0) || 0) <= expected * BAN_MAX_RATIO;
    })
    .map((i) => i.slug);
}

// Оценка предметов на герое. Сырой винрейт смещён: дорогие и поздние предметы покупают те,
// кто уже выигрывает. Поэтому сравниваем предмет с предметами ТОГО ЖЕ тира на этом герое:
// delta = WR предмета − средний WR тира (взвешенный по покупкам). Это убирает смещение
// по времени покупки (корреляция с минутой покупки падает с 0,40 до 0,08).
// Результат — в десятых долях процентного пункта (+21 = +2,1 п.п.), ключ — id предмета.
export const SCORE_MIN_MATCHES = 300;
export function itemScores(stats, items) {
  const byId = new Map(items.map((i) => [i.id >>> 0, i]));
  const rows = (stats || []).filter((s) => byId.has(s.item_id >>> 0) && (s.matches || 0) >= SCORE_MIN_MATCHES);
  const out = {};
  for (const tier of [1, 2, 3, 4]) {
    const tr = rows.filter((s) => byId.get(s.item_id >>> 0).tier === tier);
    const M = tr.reduce((a, s) => a + s.matches, 0);
    if (!M) continue;
    const avg = tr.reduce((a, s) => a + s.wins, 0) / M;
    for (const s of tr) out[s.item_id >>> 0] = Math.round((s.wins / s.matches - avg) * 1000);
  }
  return out;
}

// Сколько дней показывать бейдж «Новинка» у недавно вышедшего героя
export const NEW_DAYS = 30;
export function isNewHero(h, now = Date.now()) {
  return !!(h && h.addedAt && now - Date.parse(h.addedAt) < NEW_DAYS * 86400e3);
}

// Имена героев, предметов и способностей всегда на английском (как привыкли игроки),
// описания и интерфейс остаются на языке снимка.
export function applyEnglishNames(snap, en) {
  if (!en || snap === en) return snap;
  const heroes = Object.fromEntries(en.heroes.map((h) => [h.slug, h]));
  const items = Object.fromEntries(en.items.map((i) => [i.slug, i.name]));
  const abilities = {};
  for (const h of en.heroes) for (const a of h.abilities) abilities[a.slug] = a.name;
  for (const h of snap.heroes) {
    if (heroes[h.slug]) h.name = heroes[h.slug].name;
    for (const a of h.abilities) if (abilities[a.slug]) a.name = abilities[a.slug];
  }
  for (const i of snap.items) if (items[i.slug]) i.name = items[i.slug];
  for (const h of snap.heroes) if (heroes[h.slug] && heroes[h.slug].banned && heroes[h.slug].banned.length) h.banned = heroes[h.slug].banned.slice();
  for (const h of snap.heroes) if (heroes[h.slug] && heroes[h.slug].addedAt) h.addedAt = heroes[h.slug].addedAt;
  snap.heroes.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  snap.namesLang = 'en';
  return snap;
}

// Загрузка сырых данных из API. fetchJson передаётся снаружи
// (в Node — с таймаутом и ретраями, в браузере — обычный fetch).
export async function fetchRaw(fetchJson, lang) {
  const l = LANGS[lang] || 'english';
  const [heroes, upgrades, abilities, generic, patches, versions, steam] = await Promise.all([
    fetchJson(`${API}/heroes?language=${l}&only_active=true`),
    fetchJson(`${API}/items/by-type/upgrade?language=${l}`),
    fetchJson(`${API}/items/by-type/ability?language=${l}`),
    fetchJson(`${API}/generic-data`),
    fetchJson(PATCHES).catch(() => []),
    fetchJson(`${API}/client-versions`).catch(() => []),
    fetchJson(STEAM_NEWS).catch(() => null),
  ]);
  const clientVersion = Array.isArray(versions) && versions.length ? Math.max(...versions) : null;
  return { lang, heroes, upgrades, abilities, generic, patches, steam, clientVersion };
}

// Облегчённая версия для браузера: без 4-мегабайтного списка всех способностей.
// Способности недостающих героев подгружаются отдельно (fetchHeroAbilities).
export async function fetchRawLite(fetchJson, lang) {
  const l = LANGS[lang] || 'english';
  const [heroes, upgrades, generic, versions] = await Promise.all([
    fetchJson(`${API}/heroes?language=${l}&only_active=true`),
    fetchJson(`${API}/items/by-type/upgrade?language=${l}`),
    fetchJson(`${API}/generic-data`),
    fetchJson(`${API}/client-versions`).catch(() => []),
  ]);
  const clientVersion = Array.isArray(versions) && versions.length ? Math.max(...versions) : null;
  return { lang, heroes, upgrades, abilities: [], generic, patches: null, clientVersion };
}

export async function fetchHeroAbilities(fetchJson, lang, heroId) {
  const l = LANGS[lang] || 'english';
  const list = await fetchJson(`${API}/items/by-hero-id/${heroId}?language=${l}`);
  return (list || []).filter((i) => i.type === 'ability');
}

// ---------- Псевдо-рандом: скрытая подкрутка под героя ----------
// Для каждой пары «герой + предмет» считаем:
//  • вес w — насколько предмет «родной» герою: лифт покупок (как часто берут на этом герое
//    относительно всех героев), лифт в опубликованных сборках героя и поправка на винрейт;
//  • t — когда его обычно покупают на этом герое (доля матча).
// Храним компактно: по символу base36 на предмет, порядок предметов — tune.items.
export const TUNE_Z = [-2.5, 1.8]; // диапазон «логарифма веса»: от ×0,08 до ×6
export const TUNE_MIX = { buy: 0.55, builds: 0.3, wr: 8 }; // wr: +1 п.п. винрейта (wr = 10) → +0,08 к z
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const encZ = (z) => B36[Math.round(((clamp(z, TUNE_Z[0], TUNE_Z[1]) - TUNE_Z[0]) / (TUNE_Z[1] - TUNE_Z[0])) * 35)];
export const decZ = (c) => TUNE_Z[0] + (B36.indexOf(c) / 35) * (TUNE_Z[1] - TUNE_Z[0]);
export const encT = (t) => B36[Math.round(clamp(t, 0, 1) * 35)];
export const decT = (c) => B36.indexOf(c) / 35;

export function tuneZ({ n, N, ng, Ng, b, B, bg, Bg, wr }) {
  // сглаживание: редкие предметы и малые выборки тянем к «нейтрально» (лифт 1)
  const expBuy = N * (ng / Math.max(1, Ng));
  const buyLift = (n + 40) / (expBuy + 40);
  const expB = B * (bg / Math.max(1, Bg));
  const bLift = B > 0 ? (b + 8) / (expB + 8) : 1;
  return TUNE_MIX.buy * Math.log(buyLift) + TUNE_MIX.builds * Math.log(bLift) + (wr || 0) / 1000 * TUNE_MIX.wr;
}

// heroItems — item-stats героя, globalItems — item-stats всех героев, heroBuilds/globalBuilds — build-item-stats,
// heroMatches/globalMatches — матчей героя / всех героев (из hero-stats), wr — itemScores героя (×1000)
export function tuneHero({ items, heroItems, globalItems, heroBuilds, globalBuilds, heroMatches, globalMatches, wr = {} }) {
  const hi = new Map((heroItems || []).map((s) => [s.item_id >>> 0, s]));
  const gi = new Map((globalItems || []).map((s) => [s.item_id >>> 0, s]));
  const hb = new Map((heroBuilds || []).map((s) => [s.item_id >>> 0, s.builds || 0]));
  const gb = new Map((globalBuilds || []).map((s) => [s.item_id >>> 0, s.builds || 0]));
  const B = [...hb.values()].reduce((a, v) => a + v, 0);
  const Bg = [...gb.values()].reduce((a, v) => a + v, 0);
  let w = '', t = '';
  for (const it of items) {
    const id = it.id >>> 0;
    const h = hi.get(id), g = gi.get(id);
    if (!heroMatches || !g) { w += '-'; t += '-'; continue; }
    w += encZ(tuneZ({ n: h ? h.matches : 0, N: heroMatches, ng: g.matches, Ng: globalMatches, b: hb.get(id) || 0, B, bg: gb.get(id) || 0, Bg, wr: wr[id] }));
    const rel = h && h.matches >= 200 ? h.avg_buy_time_relative : g.avg_buy_time_relative;
    t += rel == null ? '-' : encT(rel / 100);
  }
  return { w, t };
}

// Раскладываем tune.json по героям снимка: hero.tune = { w: Map(id → множитель), t: Map(id → доля матча) }
export function attachTune(data, tune) {
  if (!data || !tune || !tune.items || !tune.heroes) return data;
  const ids = tune.items.map((s) => parseInt(s, 36) >>> 0);
  for (const h of data.heroes) {
    const row = tune.heroes[h.id];
    if (!row) { h.tune = null; continue; }
    const w = new Map(), t = new Map();
    ids.forEach((id, k) => {
      const cw = row.w[k], ct = row.t[k];
      if (cw && cw !== '-') w.set(id, Math.exp(decZ(cw)));
      if (ct && ct !== '-') t.set(id, decT(ct));
    });
    h.tune = { w, t, s: Array.isArray(row.s) && row.s.length === 16 ? row.s : null };
  }
  return data;
}

// ---------- Карточка предмета как в игре (data/tips.{lang}.json) ----------
// Из сырых данных API берём только то, что показывает игровая подсказка:
// базовые бонусы, блоки «Пассивное»/«Активное» с текстом, крупные и мелкие значения, иконки свойств.
// Текст описаний — без HTML: выделение игры превращаем в маркеры **…**, всё остальное вырезаем.
export function tipText(html) {
  return String(html || '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '') // встроенные значки игры — целиком
    .replace(/<img[^>]*>/gi, '')
    .replace(/[\r\n]+/g, ' ') // переносы строк в исходнике — не смысловые; смысловые — только <br>
    .replace(/<span[^>]*class="(?:highlight|inlineattributename|inline-attribute-label)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '**$1**')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\*\*\s*\*\*/g, '')
    .trim();
}
function tipValue(p, lang) {
  if (!p) return null;
  let raw = String(p.value ?? '').trim().replace(/m$/i, '');
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  const pre = String(p.prefix || '');
  const sign = pre.includes('{s:sign}') ? (n > 0 ? '+' : '') : pre === '-' ? '-' : '';
  const num = Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1);
  const post = String(p.postfix || '').replace(/\{[^}]*\}/g, '');
  return sign + (lang === 'ru' ? num.replace('.', ',') : num) + post;
}
// строка свойства: [иконка, значение, подпись, условие] — условие: текст игры («после срабатывания») или 1 = «при условии»
function tipProp(props, key, lang) {
  const p = props && props[key];
  const v = tipValue(p, lang);
  if (!v) return null;
  const cond = p.conditional ? String(p.conditional) : Array.isArray(p.usage_flags) && p.usage_flags.includes('ConditionallyApplied') ? 1 : 0;
  return [p.icon || '', v, String(p.postvalue_label || p.label || key).replace(/\{[^}]*\}/g, '').trim(), cond];
}
export function buildTips(upgrades, shopItems, lang) {
  const want = new Set(shopItems.map((i) => i.id >>> 0));
  const out = {};
  for (const it of upgrades || []) {
    const id = it.id >>> 0;
    if (!want.has(id)) continue;
    const props = it.properties || {};
    const tip = { innate: [], sections: [] };
    for (const sec of it.tooltip_sections || []) {
      for (const at of sec.section_attributes || []) {
        if (sec.section_type === 'innate') {
          for (const k of [...(at.properties || []), ...(at.elevated_properties || [])]) { const x = tipProp(props, k, lang); if (x) tip.innate.push(x); }
          continue;
        }
        const text = tipText(at.loc_string);
        // перезарядка — в заголовок блока, как в игре
        const cdProp = (at.properties || []).includes('AbilityCooldown') ? tipProp(props, 'AbilityCooldown', lang) : null;
        const small = (at.properties || []).filter((k) => k !== 'AbilityCooldown').map((k) => tipProp(props, k, lang)).filter(Boolean);
        const big = (at.important_properties || []).map((k) => tipProp(props, k, lang)).filter(Boolean);
        if (!text && !small.length && !big.length) continue;
        tip.sections.push({ type: sec.section_type === 'active' ? 'active' : 'passive', text, small, big, ...(cdProp ? { cd: [cdProp[0], cdProp[1]] } : {}) });
      }
    }
    if (!tip.innate.length && !tip.sections.length && it.description && it.description.desc) {
      tip.sections.push({ type: it.is_active_item ? 'active' : 'passive', text: tipText(it.description.desc), small: [], big: [] });
    }
    out[id] = tip;
  }
  return out;
}

// Типичный инвест героя: доля душ, которую игроки на этом герое вкладывают в оружие / спиритизм / живучесть
// (покупки за 30 дней × цена предмета). Нужна оценке затара, чтобы штрафовать перекос по категориям.
export function heroMix(stats, items) {
  const byId = new Map(items.map((i) => [i.id >>> 0, i]));
  const sum = { weapon: 0, spirit: 0, vitality: 0 };
  for (const s of stats || []) {
    const it = byId.get(s.item_id >>> 0);
    if (it && sum[it.cat] !== undefined) sum[it.cat] += (s.matches || 0) * (it.cost || 0);
  }
  const total = sum.weapon + sum.spirit + sum.vitality;
  if (!total) return null;
  return { weapon: +(sum.weapon / total).toFixed(3), spirit: +(sum.spirit / total).toFixed(3), vitality: +(sum.vitality / total).toFixed(3) };
}
