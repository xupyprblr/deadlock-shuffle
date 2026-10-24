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
  };
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

export function latestPatch(patches) {
  if (!Array.isArray(patches) || !patches.length) return null;
  const p = [...patches].sort((a, b) => String(b.pub_date).localeCompare(String(a.pub_date)))[0];
  return { title: p.title, date: p.pub_date, link: p.link };
}

// Главная функция: собирает всё в один снимок.
export function buildSnapshot({ lang, heroes, upgrades, abilities, generic, patches, clientVersion }) {
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
    patch: latestPatch(patches),
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
  const [heroes, upgrades, abilities, generic, patches, versions] = await Promise.all([
    fetchJson(`${API}/heroes?language=${l}&only_active=true`),
    fetchJson(`${API}/items/by-type/upgrade?language=${l}`),
    fetchJson(`${API}/items/by-type/ability?language=${l}`),
    fetchJson(`${API}/generic-data`),
    fetchJson(PATCHES).catch(() => []),
    fetchJson(`${API}/client-versions`).catch(() => []),
  ]);
  const clientVersion = Array.isArray(versions) && versions.length ? Math.max(...versions) : null;
  return { lang, heroes, upgrades, abilities, generic, patches, clientVersion };
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
