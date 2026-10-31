import { encodeBuildCode, CATEGORY_KEYS } from './buildcode.js';
import { initAnalytics, track } from './analytics.js';
import { NS, markDev } from './env.js';
import { loadTips, tipCard } from './tips.js';
import { buildSnapshot, fetchRawLite, fetchHeroAbilities, normalizeAbility, latestPatch, applyEnglishNames, isNewHero, attachTune, SCHEMA, API, PATCHES } from './normalize.js';
import { roll, rng, newSeed, DEFAULTS, rollItem, orderBuild, PHASES, phaseOf, phaseTiers, curveTiers, curveUpgrade, buildCost, encodeResult, decodeResult, CATS, rollSkillOrder, ultIndexOf, rollHeroFor, scoreBuild, meterPos, MAX_ACTIVE } from './random.js';

const CFG = Object.assign({ live: true, dataUrl: 'data/', cacheHours: 6 }, window.DS_CONFIG || {});
const app = document.getElementById('app');

// ---------- i18n ----------
const I18N = {
  ru: {
    tagline: 'рандомайзер', loading: 'Загружаю героев и предметы…', patch: 'Патч', fresh: 'данные актуальны', stale: 'снимок данных',
    updated: 'Данные обновлены до свежей версии игры', yourHero: 'Твой герой', build: 'Затар [на матч]',
    toGame: 'В игру', toGameDone: 'Код скопирован. В игре: Поиск сборок → Создать сборку → Вставить сборку', toGameFail: 'Не удалось собрать код сборки', gameCat: 'Порядок покупки',
    gameT: 'Перенос в игру', game: ['Нажми <strong>«В игру»</strong> — сайт скопирует код сборки. Дальше в Deadlock: выбери этого же героя → <strong>Поиск сборок</strong> → <strong>Создать сборку</strong> → <strong>Вставить сборку</strong>. Предметы и порядок прокачки встанут сами, без модов и аддонов.'],
    howBtn: 'Как вставить в игру?', howT: 'Как вставить сборку в игру', howCopied: 'Код сборки скопирован', howCopy: 'Скопировать код сборки', howOk: 'Понятно',
    how1T: 'Выбери в игре героя', how1: 'Сборка вставляется только на того героя, для которого её собрали.',
    how2T: 'Открой сборки и нажми «Поиск сборок»', how2: 'Кнопка справа вверху в окне сборок.',
    how3T: 'Нажми «Создать сборку»', how3: 'Откроется пустая сборка этого героя.',
    how4T: 'Нажми «Вставить сборку»', how4: 'Маленькая квадратная кнопка рядом с «i». Предметы и прокачка встанут сами — останется сохранить.',
    howWarn: '<b>Нет кнопки «Вставить сборку»?</b> Значит, в игре выбран другой герой или код пропал из буфера обмена. Проверь героя и скопируй код ещё раз.',
    orderT: 'Режим крутки', o_chaos: 'Полный рандом', o_pseudo: 'Псевдо-рандом', o_curve: 'Баланс рандом', o_phases: 'По фазам',
    ph_early: 'Ранняя игра', ph_mid: 'Середина', ph_late: 'Поздняя игра', slotHint: 'Слоты по порядку покупки: сверху вниз, затем следующий столбец — как в игре.', copyOrder: 'Порядок покупки',
    souls: 'душ', roll: 'Крутить', newHero: 'Другой герой', newItems: 'Другие предметы',
    copy: 'Скопировать', link: 'Ссылка', copied: 'Скопировано', linkCopied: 'Ссылка скопирована', rerollSlot: 'Заменить предмет', infoT: 'Что это?',
    info_order: [['curve', 'Баланс рандом', 'Самый удобный: дешёвые предметы в начале, дорогие в конце — не нужно копить на первый слот.'], ['pseudo', 'Псевдо-рандом', 'Случайная сборка в разумных рамках: играть ей реально, но порядок покупки свободный — дорогой предмет может выпасть рано.'], ['chaos', 'Полный рандом', 'Никаких правил: любые предметы в любом порядке. Для любителей челленджа.']],
    info_mode: [['chaos', 'Хаос', 'Оружие, спиритизм и живучесть — как выпадет.'], ['balanced', 'Поровну', 'Каждой категории по 4 предмета.'], ['mono', 'Все в один', 'Все 12 предметов из одной категории.']],
    laneOpt: 'Выбирать линию на матч', laneHint: 'С каждой круткой сайт подскажет, на какую линию идти.', laneT: 'Линия', tapHint: 'Тап по предмету — описание и перекрут', rerollBtn: 'Перекрутить предмет', closeBtn: 'Закрыть',
    skills: 'Порядок [прокачки]', unlock: 'Открыть', newHeroBadge: 'Новинка',
    ult: 'ульта', settings: 'Правила [рандома]', settingsSub: 'Настройки запоминаются в этом браузере.',
    slots: 'Слотов в сборке', mode: 'Баланс инвеста', chaos: 'Хаос', balanced: 'Поровну', mono: 'Все в один', grpReroll: 'Перекрутить', grpTake: 'Забрать', heroShort: 'Героя', itemsShort: 'Предметы',
    tiers: 'Тиры предметов', actives: 'Активные предметы', activesRandom: 'Случайно 0–4', activesHint: 'В игре максимум 4 активных слота. Крайнее левое положение — каждую крутку случайно.',
    scoreT: 'Оценка затара', gapNote: 'Без категории «{c}» герою тяжело — оценка снижена', gapNoteN: 'Без категорий {c} герою тяжело — оценка снижена', chanceNote: 'шанс на победу', realNote: 'Средний винрейт с такими предметами на этом герое', scoreNone: 'По этому герою пока мало матчей — оценка появится через несколько дней.', vs: 'к соседям по тиру',
    v_meta: 'Мета-затар', v_solid: 'Рабочая сборка', v_risky: 'Рискованно', v_challenge: 'Челлендж', v_troll: 'Чистый троллинг', copyScore: 'Оценка затара',
    classes: 'Классы героев', all: 'Все', pool: 'Пул героев',
    poolHint: 'Нажми на портрет — останется только этот герой. Следующие клики добавляют и убирают героев.', allHeroes: 'Все герои', poolCount: 'в пуле', reset: 'Сбросить правила',
    weapon: 'Оружие', spirit: 'Спиритизм', vitality: 'Живучесть',
    assassin: 'Убийца', brawler: 'Боец', marksman: 'Стрелок', mystic: 'Мистик', unknown: 'Герой',
    complexity: 'Сложность', active: 'активный',
    aboutT: 'Как играть', about: [
      'Жми <strong>«Крутить»</strong> — сайт выдаст случайного героя, сборку с порядком покупки и порядок прокачки. Твоя задача — собрать весь затар к концу матча.',
      'Слоты в Deadlock универсальные, поэтому по умолчанию баланс инвеста — <strong>«Хаос»</strong>. <strong>«Поровну»</strong> делит слоты между оружием, спиритизмом и живучестью, <strong>«Все в один»</strong> — для настоящих мазохистов.',
      'Улучшение «съедает» свой компонент, поэтому рандом не выдаёт их вместе. Нажми на предмет, чтобы заменить только его.',
    ],
    dataT: 'Откуда данные', data: [
      'Герои, предметы, иконки и номер патча подтягиваются автоматически из открытого <a href="https://deadlock-api.com" target="_blank" rel="noopener">Deadlock API</a>. Сайт сам замечает новую версию игры и обновляет список — новые герои и предметы появляются без ручной правки.',
      'Ссылка «Ссылка» сохраняет конкретный результат: друг увидит ровно ту же сборку.',
    ],
    socialT: 'Каналы podvalni akrobat', donate: 'Поддержать',
    labLink: 'Лаборатория', labSub: 'сборки игроков, рандом билд и сравнение',
    legal: 'Фанатский проект. Deadlock и все игровые материалы принадлежат Valve Corporation. Сайт не связан с Valve.',
    copyHead: 'RANDOMLOCK', copySkills: 'Прокачка', empty: 'Под эти правила не подошёл ни один герой — сброшу фильтр.',
    error: 'Не удалось загрузить данные. Проверь соединение и обнови страницу.',
  },
  en: {
    tagline: 'randomizer', loading: 'Loading heroes and items…', patch: 'Patch', fresh: 'data is live', stale: 'data snapshot',
    updated: 'Data updated to the latest game version', yourHero: 'Your hero', build: 'Your [build]',
    toGame: 'To game', toGameDone: 'Code copied. In game: Browse builds → Create build → Paste build', toGameFail: 'Could not build the code', gameCat: 'Purchase order',
    gameT: 'Send to the game', game: ['Hit <strong>To game</strong> to copy the build code. Then in Deadlock: pick the same hero → <strong>Browse builds</strong> → <strong>Create build</strong> → <strong>Paste build</strong>. Items and the ability order fill in on their own, no mods or add-ons.'],
    howBtn: 'How to paste it in game?', howT: 'How to paste the build in game', howCopied: 'Build code copied', howCopy: 'Copy build code', howOk: 'Got it',
    how1T: 'Pick the hero in game', how1: 'A build can only be pasted for the hero it was made for.',
    how2T: 'Open builds and press “Browse builds”', how2: 'The button in the top right of the builds window. (Screenshots are from the Russian client.)',
    how3T: 'Press “Create build”', how3: 'An empty build for this hero opens.',
    how4T: 'Press “Paste build”', how4: 'The small square button next to the “i”. Items and abilities fill in on their own — just save.',
    howWarn: '<b>No “Paste build” button?</b> The game has a different hero selected, or the code is no longer in your clipboard. Check the hero and copy the code again.',
    orderT: 'Roll mode', o_chaos: 'Full Random', o_pseudo: 'Smart Random', o_curve: 'Balanced Random', o_phases: 'By phase',
    ph_early: 'Early game', ph_mid: 'Mid game', ph_late: 'Late game', slotHint: 'Slots in purchase order: top to bottom, then the next column, as in the game.', copyOrder: 'Purchase order',
    souls: 'souls', roll: 'Shuffle', newHero: 'New hero', newItems: 'New items',
    copy: 'Copy', link: 'Link', copied: 'Copied', linkCopied: 'Link copied', rerollSlot: 'Replace item', infoT: 'What is this?',
    info_order: [['curve', 'Balanced Random', 'The most comfortable: cheap items first, expensive ones at the end — no saving up for slot one.'], ['pseudo', 'Smart Random', 'A random build within reason: playable, but the purchase order is loose — an expensive item can come early.'], ['chaos', 'Full Random', 'No rules: any items in any order. For challenge lovers.']],
    info_mode: [['chaos', 'Chaos', 'Weapon, spirit and vitality — whatever drops.'], ['balanced', 'Even', '4 items from each category.'], ['mono', 'All in one', 'All 12 items from a single category.']],
    laneOpt: 'Pick a lane for the match', laneHint: 'Every roll also tells you which lane to take.', laneT: 'Lane', tapHint: 'Tap an item for info and reroll', rerollBtn: 'Reroll item', closeBtn: 'Close',
    skills: 'Ability [order]', unlock: 'Unlock', newHeroBadge: 'New',
    ult: 'ult', settings: 'Shuffle [rules]', settingsSub: 'Settings are saved in this browser.',
    slots: 'Build slots', mode: 'Investment balance', chaos: 'Chaos', balanced: 'Even', mono: 'All in one', grpReroll: 'Reroll', grpTake: 'Take it', heroShort: 'Hero', itemsShort: 'Items',
    tiers: 'Item tiers', actives: 'Active items', activesRandom: 'Random 0–4', activesHint: 'The game has 4 active slots at most. Far left — random on every shuffle.',
    scoreT: 'Build Rating', gapNote: 'Missing {c} items hurts this hero — rating lowered', gapNoteN: 'Missing {c} items hurts this hero — rating lowered', chanceNote: 'build win rate', realNote: 'Average win rate with these items on this hero', scoreNone: 'Not enough matches on this hero yet — the rating will appear in a few days.', vs: 'vs. same tier',
    v_meta: 'Meta build', v_solid: 'Solid build', v_risky: 'Risky', v_challenge: 'Challenge', v_troll: 'Pure troll', copyScore: 'Build rating',
    classes: 'Hero classes', all: 'All', pool: 'Hero pool',
    poolHint: 'Click a portrait to keep only that hero. Further clicks add or remove heroes.', allHeroes: 'All heroes', poolCount: 'in pool', reset: 'Reset rules',
    weapon: 'Weapon', spirit: 'Spirit', vitality: 'Vitality',
    assassin: 'Assassin', brawler: 'Brawler', marksman: 'Marksman', mystic: 'Mystic', unknown: 'Hero',
    complexity: 'Complexity', active: 'active',
    aboutT: 'How to play', about: [
      'Hit <strong>Shuffle</strong> to get a random hero, build, purchase order and ability order. Your job is to finish the whole build by the end of the match.',
      'Deadlock slots are universal, so the investment balance defaults to <strong>Chaos</strong>. <strong>Even</strong> shares slots between weapon, spirit and vitality; <strong>All in one</strong> is for true masochists.',
      'An upgrade consumes its component, so they never roll together. Click an item to replace just that one.',
    ],
    dataT: 'Where the data comes from', data: [
      'Heroes, items, icons and the patch number come straight from the open <a href="https://deadlock-api.com" target="_blank" rel="noopener">Deadlock API</a>. The site notices new game versions on its own, so new heroes and items show up without manual edits.',
      'The Link button saves this exact result, so a friend sees the same build.',
    ],
    socialT: 'podvalni akrobat channels', donate: 'Support',
    labLink: 'Lab', labSub: 'player builds, random build and compare (in Russian)',
    legal: 'Fan project. Deadlock and all game assets belong to Valve Corporation. Not affiliated with Valve.',
    copyHead: 'RANDOMLOCK', copySkills: 'Ability order', empty: 'No hero matches these rules, resetting the filter.',
    error: 'Could not load data. Check your connection and refresh the page.',
  },
};
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

// ---------- storage ----------
const store = {
  // на тестовом сайте (/dev/) свои ключи, чтобы не портить настройки основного
  get(k, d) { try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch {} },
};

// Язык браузера: русский для RU и соседних языков (часто знают русский), иначе английский
function browserLang() {
  let list = [];
  try { list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']); } catch {}
  for (const l of list) {
    const code = String(l || '').toLowerCase().split('-')[0];
    if (['ru', 'uk', 'be', 'kk', 'ky', 'uz', 'tg', 'hy', 'az', 'ka', 'tk', 'mo'].includes(code)) return 'ru';
    if (code === 'en') return 'en';
  }
  return 'en';
}

const state = {
  lang: store.get('ds:lang', browserLang()), // выбор зрителя; если не выбирал — по языку браузера
  // старые сохранённые настройки (слоты, классы, лимит активок) больше не используются
  opts: (({ slots, types, maxActive, ...rest }) => {
    const o = Object.assign({}, DEFAULTS, rest);
    // «По фазам» убран из интерфейса; с версии 2 по умолчанию псевдо-рандом (переводим всех один раз)
    if (o.order === 'phases' || !rest.ov) o.order = 'pseudo';
    o.ov = 2;
    return o;
  })(store.get('ds:opts', {})),
  stats: null,
  data: null,
  res: null,
  live: false,
  rerolls: 0,
};
const t = (k) => (I18N[state.lang] || I18N.ru)[k] ?? k;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// В демо-сборке картинки встроены в страницу (window.DS_IMG), на сайте — обычные пути
const src = (p) => (p && window.DS_IMG && window.DS_IMG[p]) || p || '';
// внешние ссылки из API — только http(s), чтобы подменённые данные не могли подсунуть javascript:
// Valve пишет дату патча как ММ-ДД-ГГГГ; в русской версии показываем ДД-ММ-ГГГГ
const patchTitle = (s) => (state.lang === 'ru' ? String(s || '').replace(/^(\d{2})-(\d{2})-(\d{4})/, '$2-$1-$3') : String(s || ''));
const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; } };
// «Слово в [скобках]» -> выделенная плашка, как «updated» на официальной странице
const hl = (s) => esc(s).replace(/\[(.+?)\]/g, '<mark>$1</mark>');
const fmt = (n) => Number(n || 0).toLocaleString(state.lang === 'ru' ? 'ru-RU' : 'en-US');

// ---------- данные ----------
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.json();
}

// Служебные данные для псевдо-рандома (data/tune.json, раз в сутки). Без них псевдо-рандом
// работает по-старому, поэтому ошибки загрузки молча игнорируем.
let tunePromise = null;
function loadTune() {
  if (!tunePromise) {
    tunePromise = window.DS_TUNE ? Promise.resolve(window.DS_TUNE)
      : fetchJson(CFG.dataUrl + 'tune.json?v=' + Math.floor(Date.now() / 36e5)).catch(() => null);
  }
  return tunePromise;
}
async function loadData(lang) {
  const [snap, tune] = await Promise.all([loadSnapshot(lang), loadTune()]);
  return attachTune(snap, tune);
}
async function loadSnapshot(lang) {
  const inline = window.DS_SNAPSHOT && window.DS_SNAPSHOT[lang];
  if (inline) return inline;
  const cached = store.get('ds:data:' + lang, null);
  let snap = null;
  try { snap = await fetchJson(CFG.dataUrl + lang + '.json?v=' + Math.floor(Date.now() / 36e5)); } catch {}
  // берём более свежий из двух: кэш живого обновления или серверный снимок
  if (cached && cached.schema === SCHEMA && (!snap || (cached.clientVersion || 0) > (snap.clientVersion || 0))) {
    if (snap) cached.patch = latestPatch(cached.patch, snap.patch); // дату патча сервер знает лучше (новости Steam)
    return cached;
  }
  if (snap) return snap;
  if (cached) return cached;
  throw new Error('no data');
}

// Живое обновление: сравниваем версию клиента игры со снимком,
// при расхождении собираем свежий снимок прямо в браузере.
async function liveCheck() {
  if (!CFG.live) return;
  const lang = state.lang;
  try {
    const versions = await fetchJson(API + '/client-versions');
    const latest = Math.max(...versions);
    state.live = true;
    store.set('ds:check:' + lang, Date.now());
    if (!state.data.clientVersion || latest <= state.data.clientVersion) { renderTop(); return; }
    const raw = await fetchRawLite(fetchJson, lang);
    const fresh = buildSnapshot(raw);
    // старые способности и патч переносим заранее, чтобы английские имена легли и на них
    const oldAb0 = Object.fromEntries(state.data.heroes.map((h) => [h.slug, h.abilities]));
    for (const h of fresh.heroes) h.abilities = oldAb0[h.slug] && oldAb0[h.slug].length ? oldAb0[h.slug] : [];
    // запреты считаются на сервере по статистике — переносим их из снимка
    const oldBan = Object.fromEntries(state.data.heroes.map((h) => [h.slug, h.banned || []]));
    for (const h of fresh.heroes) h.banned = oldBan[h.slug] || [];
    // герой, которого не было в снимке, только что вышел — помечаем «Новинкой»
    const oldAdded = Object.fromEntries(state.data.heroes.map((h) => [h.slug, h.addedAt || null]));
    const nowIso = new Date().toISOString();
    for (const h of fresh.heroes) h.addedAt = h.slug in oldAdded ? oldAdded[h.slug] : nowIso;
    if (lang !== 'en') applyEnglishNames(fresh, buildSnapshot(await fetchRawLite(fetchJson, 'en')));
    // переносим способности и патч из старого снимка, новых героев догрузим по запросу
    fresh.patch = state.data.patch;
    try { fresh.patch = latestPatch(await fetchJson(PATCHES), fresh.patch) || fresh.patch; } catch {}
    if (lang !== state.lang) return;
    store.set('ds:data:' + lang, fresh);
    state.data = attachTune(fresh, await loadTune());
    renderTop(); renderOpts();
    toast(t('updated'));
  } catch {
    state.live = false;
    renderTop();
  }
}

async function ensureAbilities(hero) {
  if (hero.abilities && hero.abilities.length >= 4) return;
  if (!CFG.live) return;
  try {
    const [list, listEn] = await Promise.all([
      fetchHeroAbilities(fetchJson, state.lang, hero.id),
      state.lang === 'en' ? null : fetchHeroAbilities(fetchJson, 'en', hero.id),
    ]);
    const by = Object.fromEntries(list.map((a) => [a.class_name, a]));
    const en = Object.fromEntries((listEn || []).map((a) => [a.class_name, a.name]));
    hero.abilities = hero.abilitySlugs.map((s) => normalizeAbility(by[s])).filter(Boolean);
    for (const a of hero.abilities) if (en[a.slug]) a.name = en[a.slug];
    store.set('ds:data:' + state.lang, state.data);
    if (state.res && state.res.hero === hero) renderSkills();
  } catch {}
}

// ---------- рандом ----------
function doRoll(kind = 'all', src = 'button') {
  const d = state.data;
  if (!d || spinning) return;
  const seed = newSeed();
  const prev = state.res;
  const keepHero = kind === 'items' && prev ? prev.hero : null;
  let res = roll(d, state.opts, seed, keepHero);
  if (kind === 'hero' && prev) {
    // новый герой должен уметь купить всю текущую сборку
    const hero = rollHeroFor(rng(seed), d, state.opts, prev.build, prev.hero.id);
    if (hero) res = { ...prev, hero, skills: rollSkillOrder(rng(seed + ':s'), 4, ultIndexOf(hero)), seed };
  }
  if (kind !== 'hero' || !prev) res.orders = { [state.opts.order]: res.build };
  state.res = res;
  state.rerolls = 0;
  state.heroIn = kind !== 'items';
  syncUrl();
  renderStage(kind !== 'hero');
  state.heroIn = false;
  kick(kind === 'all' ? '#roll-btn' : `[data-act="${kind}"]`);
  scrollToStage();
  const sc = state.stats ? scoreBuild(res.build, heroStats(res.hero)) : null;
  track('roll', { kind, src, order: state.opts.order, invest: state.opts.mode, hero: res.hero.name, verdict: sc ? sc.verdict : '', chance: sc ? Math.round(sc.chance) : '', actives: res.build.filter((i) => i.active).length });
  renderSkills();
  ensureAbilities(res.hero);
}

function rerollSlot(idx) {
  const res = state.res;
  if (!res || spinning) return;
  const r = rng(res.seed + ':' + idx + ':' + ++state.rerolls + ':' + Math.random());
  const others = res.build.filter((_, i) => i !== idx);
  const cur = res.build[idx];
  const opts = state.opts;
  const cat = state.opts.mode === 'chaos' ? null : cur.cat;
  // замена сохраняет тип слота: активка меняется на активку, пассивка на пассивку
  const tiers = opts.order === 'phases' ? phaseTiers(idx, opts) : opts.order === 'curve' ? curveTiers(idx, opts, cur) : null;
  let next = rollItem(r, state.data.items, [...others, cur], opts, cat, res.hero, cur.active, tiers) || rollItem(r, state.data.items, others, opts, cat, res.hero, cur.active, tiers);
  if (!next) return;
  // «Баланс рандом»: в слотах 1, 5, 6 предмет с апгрейдом показываем сразу апгрейдом
  if (opts.order === 'curve') next = curveUpgrade(r, state.data.items, [...others, next], idx, next, opts, res.hero);
  // замена встаёт на место старого предмета во всех уже показанных порядках покупки
  for (const m of Object.keys(res.orders || {})) {
    const arr = res.orders[m].map((i) => (i === cur ? next : i));
    res.orders[m] = m === 'phases' ? arr.map((i, n) => [i, n]).sort((a, b) => a[0].cost - b[0].cost || a[1] - b[1]).map((x) => x[0]) : arr;
  }
  res.build = (res.orders && res.orders[opts.order]) || res.build.map((i) => (i === cur ? next : i));
  syncUrl();
  renderStage(false);
}

function syncUrl() {
  try {
    const u = new URL(location.href);
    u.searchParams.set('b', encodeResult(state.res));
    history.replaceState(null, '', u);
  } catch {}
}

function shareUrl() {
  try {
    const u = new URL(location.href);
    u.searchParams.set('b', encodeResult(state.res));
    return u.toString();
  } catch { return encodeResult(state.res); }
}


async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); if (msg) toast(msg); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); if (ok && msg) toast(msg); } catch {}
    ta.remove();
    return ok;
  }
}

// ---------- инструкция «В игру» ----------
async function toGame() {
  const code = gameCode();
  if (!code) { toast(t('toGameFail')); return; }
  // при нажатии — только короткое уведомление; подробная инструкция — по ссылке «Как вставить в игру?»
  const ok = await copy(code);
  toast(ok ? t('toGameDone') : t('toGameFail'));
  track('to_game', { from: 'button', ok: ok ? 1 : 0, hero: state.res && state.res.hero.name, order: state.opts.order });
}
// смена темы (js/theme.js) — в аналитику как настройка
document.addEventListener('ds:theme', (e) => track('setting', { name: 'theme', value: e.detail }));
function openHow(copied) {
  closeHow();
  const h = state.res && state.res.hero;
  const el = document.createElement('div');
  el.className = 'how-modal'; el.id = 'how';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'how-t');
  const step = (n, title, text, body = '') => `<li class="how-step"><span class="how-n">${n}</span><div><h3>${title}</h3><p>${text}</p>${body}</div></li>`;
  el.innerHTML = `<div class="how-box">
    <button class="how-x" data-how="close" aria-label="${t('howOk')}">✕</button>
    ${copied ? `<p class="how-ok">${ICON.game}<span>${t('howCopied')}</span></p>` : ''}
    <h2 id="how-t">${t('howT')}</h2>
    <ol class="how-steps">
      ${step(1, t('how1T'), t('how1'), h ? `<div class="how-hero">${h.small ? `<img src="${esc(src(h.small))}" alt="" width="56" height="56">` : ''}<b>${esc(h.name)}</b></div>` : '')}
      ${step(2, t('how2T'), t('how2'), '<img class="how-shot" src="img/howto/search.webp" alt="" loading="lazy">')}
      ${step(3, t('how3T'), t('how3'), '<img class="how-shot" src="img/howto/create.webp" alt="" loading="lazy">')}
      ${step(4, t('how4T'), t('how4'), '<img class="how-shot" src="img/howto/paste.webp" alt="" loading="lazy">')}
    </ol>
    <p class="how-warn">${t('howWarn')}</p>
    <div class="how-foot">
      <div class="btn-row">
        <button class="btn" data-how="again">${ICON.game}<span>${t('howCopy')}</span></button>
        <button class="btn btn-game" data-how="close">${t('howOk')}</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(el);
  document.body.classList.add('noscroll');
  el.querySelector('[data-how="close"].btn').focus();
}
function closeHow() {
  const el = document.getElementById('how');
  if (el) { el.remove(); document.body.classList.remove('noscroll'); }
}
document.addEventListener('click', async (e) => {
  const m = document.getElementById('how');
  if (!m) return;
  if (e.target === m) { closeHow(); return; }
  const b = e.target.closest('[data-how]');
  if (!b) return;
  const a = b.dataset.how;
  if (a === 'close') closeHow();
  else if (a === 'again') { const code = gameCode(); const ok = !!code && await copy(code); toast(ok ? t('howCopied') : t('toGameFail')); track('to_game', { from: 'howto', ok: ok ? 1 : 0, hero: state.res && state.res.hero.name }); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHow(); });

let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), String(msg).length > 40 ? 4200 : 2200);
}

// ---------- рендер ----------
function shell() {
  app.innerHTML = `
    <header class="top" id="top"></header>
    <main>
      <div class="stage" id="stage"></div>
      <section class="block" id="skills"></section>
      <section class="block" id="opts"></section>
      <section class="block" id="about"></section>
    </main>
    <footer id="foot"></footer>`;
}

function renderTop() {
  const d = state.data;
  const p = d.patch;
  const when = d.fetchedAt ? new Date(d.fetchedAt).toLocaleDateString(state.lang === 'ru' ? 'ru-RU' : 'en-US') : '';
  document.getElementById('top').innerHTML = `
    <a class="brand" href="./" aria-label="RANDOMLOCK by podvalni akrobat"><b>Random<em>lock</em></b><span class="tag">by podvalni akrobat</span></a>
    <div class="top-side">
    <nav class="social" aria-label="${t('socialT')}">
      ${SOCIAL.map((x) => `<a class="soc soc-${x.k}" href="${x.url}" target="_blank" rel="noopener" data-track="social" data-track-v="${x.k}">${ICON[x.icon]}<span>${x.name}</span></a>`).join('')}
      <a class="soc soc-donate" href="${DONATE}" target="_blank" rel="noopener" data-track="donate" data-track-v="header">${ICON.heart}<span>${t('donate')}</span></a>
    </nav>
    <div class="top-meta">
      <span class="patch"><i class="dot ${state.live ? '' : 'stale'}"></i>${p ? `${t('patch')} ${safeUrl(p.link) ? `<a href="${esc(safeUrl(p.link))}" target="_blank" rel="noopener">${esc(patchTitle(p.title))}</a>` : esc(patchTitle(p.title))} · ` : ''}${state.live ? t('fresh') : `${t('stale')} ${when}`}</span>
      <span class="seg" role="group" aria-label="Language">
        <button data-act="lang" data-v="ru" aria-pressed="${state.lang === 'ru'}">RU</button>
        <button data-act="lang" data-v="en" aria-pressed="${state.lang === 'en'}">EN</button>
      </span>
      ${window.DS_THEME ? window.DS_THEME.button() : ''}
    </div>
    </div>`;
  if (window.DS_THEME) window.DS_THEME.sync();
}

function renderStage(dealItems = true) {
  const { hero, build } = state.res;
  const order = state.opts.order || 'chaos';
  document.documentElement.style.setProperty('--hero', hero.color || '#c9a45c');
  const cost = buildCost(build);
  const per = Object.fromEntries(CATS.map((c) => [c, build.filter((i) => i.cat === c).length]));
  const stage = document.getElementById('stage');
  stage.innerHTML = `
    <article class="hero ${state.heroIn ? 'hero-in' : ''}" aria-live="polite">
      <div class="hero-art">${isNewHero(hero) ? `<span class="new-badge">${t('newHeroBadge')}</span>` : ''}${hero.card ? `<img src="${esc(src(hero.card))}" alt="${esc(hero.name)}" width="330" height="440">` : ''}</div>
      <div class="hero-info">
        <span class="eyebrow">${t('yourHero')}</span>
        <h1 class="hero-name">${esc(hero.name)}</h1>
        ${hero.role ? `<p class="hero-role">${esc(hero.role)}</p>` : ''}
        <div class="chips">
          <span class="tag">${esc(t(hero.type))}</span>
          ${state.opts.lane && state.res.lane ? lanePill(state.res.lane) : ''}
        </div>
        ${hero.complexity ? `<span class="complex">${t('complexity')}: <b>${'◆'.repeat(hero.complexity)}${'◇'.repeat(Math.max(0, 3 - hero.complexity))}</b></span>` : ''}
      </div>
    </article>
    <div class="build">
      <div class="build-head">
        <h2>${hl(t('build'))}</h2>
        <span class="souls">${fmt(cost)}<small>${t('souls')}</small></span>
      </div>
      ${order === 'phases' ? `<div class="phase-head" aria-hidden="true">${PHASES.map((p) => `<span class="ph-${p.key}">${t('ph_' + p.key)}<small>${p.from + 1}–${p.to}</small></span>`).join('')}</div>` : ''}
      <p class="tap-hint">${t('tapHint')}</p>
      <div class="slots ${dealItems ? 'dealt' : ''} ${order === 'phases' ? 'by-phase' : ''}">
        ${build.map((i, idx) => `
          <button class="slot ${i.cat}" style="--i:${idx}" data-act="slot" data-i="${idx}" aria-label="${esc(i.name)} — ${t(i.cat)}, ${ROMAN[i.tier]}${i.active ? ', ' + t('active') : ''}. ${t('rerollSlot')}">
            <span class="slot-tile">
              ${i.icon ? `<img src="${esc(src(i.icon))}" alt="" loading="lazy" width="200" height="200">` : ''}
              <span class="tier">${ROMAN[i.tier]}</span>${i.active ? `<span class="act" title="${t('active')}">A</span>` : ''}<span class="num ${order === 'phases' ? 'ph-' + phaseOf(idx).key : ''}">${idx + 1}</span>
            </span>
            <span class="slot-name">${esc(i.name)}</span>
            <span class="slot-cost">${fmt(i.cost)}</span>
            <span class="reroll" aria-hidden="true">↻</span>
          </button>`).join('')}
      </div>
      <div class="split" aria-hidden="true">${CATS.map((c) => `<span style="flex-grow:${per[c]};background:var(--${c})"></span>`).join('')}</div>
      <div class="legend-row">${CATS.map((c) => `<span><i class="sw" style="background:var(--${c})"></i>${t(c)} <b>${per[c]}</b></span>`).join('')}</div>
      ${renderScore(hero, build)}
    </div>
    <div class="actions">
    <div class="hero-opts act-left">
      <div class="order-switch">
        <span class="lbl">${t('orderT')}${infoBtn('order')}</span>
        <div class="seg-order seg-modes" role="radiogroup" aria-label="${t('orderT')}">
          ${['curve', 'pseudo', 'chaos'].map((m) => `<button class="m-${m}" data-act="order" data-v="${m}" role="radio" aria-checked="${order === m}" aria-pressed="${order === m}">${t('o_' + m)}</button>`).join('')}
        </div>
      </div>
      <div class="order-switch">
        <span class="lbl">${t('mode')}${infoBtn('mode')}</span>
        <div class="seg-order" role="radiogroup" aria-label="${t('mode')}">
          ${['chaos', 'balanced', 'mono'].map((m) => `<button data-act="mode" data-v="${m}" role="radio" aria-checked="${state.opts.mode === m}" aria-pressed="${state.opts.mode === m}">${t(m)}</button>`).join('')}
        </div>
      </div>
    </div>
      <div class="act-main">
        <button class="btn btn-main" data-act="roll" id="roll-btn">${ICON.dice}<span>${t('roll')}</span></button>
        <span class="kbd">Space</span>
      </div>
      <div class="act-right">
      <div class="act-group">
        <span class="act-lbl">${t('grpReroll')}</span>
        <div class="btn-row">
          <button class="btn" data-act="hero">${ICON.mask}<span>${t('heroShort')}</span></button>
          <button class="btn" data-act="items">${ICON.cards}<span>${t('itemsShort')}</span></button>
        </div>
      </div>
      <div class="act-group">
        <span class="act-lbl">${t('grpTake')}</span>
        <div class="btn-row">
          <button class="btn btn-game" data-act="game">${ICON.game}<span>${t('toGame')}</span></button>
          <button class="btn" data-act="link">${ICON.link}<span>${t('link')}</span></button>
        </div>
        <button class="how-link" data-act="how">${t('howBtn')}</button>
      </div>
      </div>
    </div>`;
  if (dealItems) spinSlots();
}

// На телефоне кнопки под сборкой — после крутки поднимаем экран к результату
function scrollToStage() {
  let mobile = false;
  try { mobile = matchMedia('(max-width: 820px)').matches; } catch {}
  const el = document.getElementById('stage');
  if (!mobile || !el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 8;
  if (window.scrollY <= top) return;
  window.scrollTo({ top, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

// ---------- значок «i» с описанием режимов ----------
function infoBtn(key) {
  const rows = t('info_' + key).map(([m, name, text]) => `<li class="m-${m}"><b>${esc(name)}</b> — ${esc(text)}</li>`).join('');
  return `<span class="info"><button type="button" class="info-btn" data-info="${key}" aria-expanded="false" aria-label="${esc(t('infoT'))}">i</button><span class="info-pop" role="tooltip"><ul>${rows}</ul></span></span>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.info-btn');
  document.querySelectorAll('.info.open').forEach((x) => { if (!b || !x.contains(b)) { x.classList.remove('open'); x.querySelector('.info-btn').setAttribute('aria-expanded', 'false'); } });
  if (b) { const box = b.parentElement; const on = !box.classList.contains('open'); box.classList.toggle('open', on); b.setAttribute('aria-expanded', String(on)); if (on) track('info_open', { key: b.dataset.info }); }
});

// ---------- линия на матч ----------
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#60cde3');
function lanePill(lane) {
  return `<span class="lane-pill" style="--lc:${safeColor(lane.color)}"><i>${esc(String(lane.name || '?').charAt(0))}</i>${esc(t('laneT'))}: ${esc(lane.name)}</span>`;
}

// ---------- карточка предмета (как в игре) ----------
const isTouch = () => { try { return !matchMedia('(hover: hover) and (pointer: fine)').matches; } catch { return false; } };
let tipEl = null, tipFor = -1;
function tipData() { return loadTips(CFG.dataUrl, state.lang); }
function cardFor(idx, data) {
  const it = state.res && state.res.build[idx];
  return it ? tipCard(it, data, state.lang, src, fmt, state.data.items) : '';
}
function placeTip(slot) {
  if (!tipEl || !slot.isConnected) return;
  const r = slot.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight, gap = 12;
  let x = r.right + gap;
  if (x + w > innerWidth - 8) x = r.left - gap - w;
  if (x < 8) x = Math.max(8, Math.min(innerWidth - w - 8, r.left));
  let y = Math.min(Math.max(8, r.top), innerHeight - h - 8);
  tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(8, y))}px)`;
}
async function showTip(slot) {
  const idx = +slot.dataset.i;
  if (spinning || slot.classList.contains('spinning')) return;
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip-float'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
  tipFor = idx;
  tipEl.innerHTML = cardFor(idx, null);
  tipEl.classList.add('show'); placeTip(slot);
  const data = await tipData();
  if (tipFor !== idx || !tipEl.classList.contains('show')) return;
  tipEl.innerHTML = cardFor(idx, data); placeTip(slot);
}
function hideTip() { tipFor = -1; if (tipEl) tipEl.classList.remove('show'); }
app.addEventListener('mouseover', (e) => {
  if (isTouch()) return;
  const slot = e.target.closest && e.target.closest('.slot');
  if (slot && +slot.dataset.i !== tipFor) showTip(slot);
});
app.addEventListener('mouseout', (e) => {
  const slot = e.target.closest && e.target.closest('.slot');
  if (slot && !(e.relatedTarget && slot.contains(e.relatedTarget))) hideTip();
});
app.addEventListener('focusin', (e) => { const slot = e.target.closest && e.target.closest('.slot'); if (slot && !isTouch()) showTip(slot); });
app.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('.slot')) hideTip(); });
addEventListener('scroll', hideTip, { passive: true });

// телефон: нижняя панель с карточкой и кнопкой перекрута
async function openTipSheet(idx) {
  closeTipSheet();
  const el = document.createElement('div');
  el.className = 'tip-sheet'; el.id = 'tip-sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  const paint = (data) => {
    el.innerHTML = `<div class="tip-sheet-in">${cardFor(idx, data)}<div class="tip-sheet-btns">
      <button class="btn" data-sheet="close">${t('closeBtn')}</button>
      <button class="btn btn-game" data-sheet="reroll">${ICON.cards}<span>${t('rerollBtn')}</span></button></div></div>`;
  };
  paint(null);
  el.addEventListener('click', (e) => {
    if (e.target === el) { closeTipSheet(); return; }
    const b = e.target.closest('[data-sheet]');
    if (!b) return;
    if (b.dataset.sheet === 'close') closeTipSheet();
    else { closeTipSheet(); rerollSlot(idx); track('reroll_slot', { slot: idx + 1, hero: state.res && state.res.hero.name, from: 'sheet' }); }
  });
  document.body.appendChild(el);
  document.body.classList.add('noscroll');
  track('item_info', { slot: idx + 1 });
  const data = await tipData();
  if (el.isConnected) paint(data);
}
function closeTipSheet() {
  const el = document.getElementById('tip-sheet');
  if (el) { el.remove(); document.body.classList.remove('noscroll'); }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeTipSheet(); hideTip(); } });

// ---------- анимации крутки ----------
const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
function kick(sel) {
  const b = document.querySelector(sel);
  if (!b || reduceMotion()) return;
  b.classList.remove('kick'); void b.offsetWidth; b.classList.add('kick');
}
// иконки всех предметов заранее в кэш браузера — чтобы «барабан» не мигал пустыми плитками
let pooled = false;
const REEL_SIZE = 20;
let reelPool = [];
function preloadIcons() {
  if (pooled || !state.data) return; pooled = true;
  // под размытием барабана хватает 20 иконок: грузим только их (все 156 — это 3,5 МБ трафика на каждого нового зрителя)
  const all = state.data.items.filter((i) => i.icon);
  for (let k = all.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [all[k], all[j]] = [all[j], all[k]]; }
  reelPool = all.slice(0, REEL_SIZE);
  const go = () => reelPool.forEach((i) => { const im = new Image(); im.decoding = 'async'; im.src = src(i.icon); });
  (window.requestIdleCallback || ((f) => setTimeout(f, 600)))(go);
}
// «Барабан»: каждая плитка прокручивает случайные иконки и останавливается по очереди, 1 → 12
let spinToken = 0;
let spinning = false; // пока крутится барабан, новые крутки и переключатели не принимаем
const SPIN_STEP = 85, SPIN_FIRST = 420;
function setSpinning(on) {
  spinning = on;
  document.body.classList.toggle('is-spinning', on);
}
function spinSlots() {
  const token = ++spinToken;
  const slots = [...document.querySelectorAll('#stage .slot')];
  if (!slots.length) return;
  if (reduceMotion() || !pooled) return; // при первой загрузке — только раздача, иконки ещё не в кэше
  const pool = reelPool.length ? reelPool : state.data.items.filter((i) => i.icon);
  setSpinning(true);
  // конец анимации: снимаем блокировку и на всякий случай ставим каждой плитке её настоящую иконку
  setTimeout(() => {
    if (token !== spinToken) return;
    document.querySelectorAll('#stage .slot').forEach((el, i) => {
      const it = state.res && state.res.build[i];
      const img = el.querySelector('.slot-tile img');
      if (it && img && it.icon) img.src = src(it.icon);
      el.classList.remove('spinning'); el.classList.add('landed');
    });
    setSpinning(false);
  }, SPIN_FIRST + (slots.length - 1) * SPIN_STEP + 160);
  slots.forEach((el, i) => {
    const img = el.querySelector('.slot-tile img');
    const fin = img && img.getAttribute('src');
    const stopAt = SPIN_FIRST + i * SPIN_STEP;
    const t0 = performance.now();
    el.classList.add('spinning');
    const tick = () => {
      if (token !== spinToken || !el.isConnected) return;
      if (performance.now() - t0 >= stopAt) {
        if (img) img.src = fin;
        el.classList.remove('spinning'); el.classList.add('landed');
        return;
      }
      if (img) img.src = src(pool[(Math.random() * pool.length) | 0].icon);
      setTimeout(tick, 75);
    };
    tick();
  });
}

// Порядок покупки фиксирован для каждой крутки: один и тот же для режима, сколько ни переключай.
// Первый показанный порядок запоминается, остальные выводятся из сида крутки.
function orderFor(res, mode) {
  res.orders = res.orders || {};
  if (!res.orders[mode]) {
    const base = res.build.slice().sort((a, b) => (a.id >>> 0) - (b.id >>> 0)); // не зависит от текущего порядка
    res.orders[mode] = orderBuild(rng(String(res.seed) + ':order:' + mode), base, mode, res.hero);
  }
  return res.orders[mode];
}

// ---------- соцсети podvalni akrobat ----------
const SOCIAL = [
  { k: 'yt', name: 'YouTube', icon: 'video', url: 'https://www.youtube.com/@podvalni_akrobat' },
  { k: 'tw', name: 'Twitch', icon: 'live', url: 'https://www.twitch.tv/podvalni_akrobat' },
  { k: 'tg', name: 'Telegram', icon: 'chat', url: 'https://t.me/podvalni_akrobat' },
];
const DONATE = 'https://www.donationalerts.com/r/podvalni_akrobat';

// ---------- иконки кнопок (inline SVG, цвет — currentColor) ----------
const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  dice: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none"/>'),
  mask: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  cards: svg('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
  game: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v3h16v-3"/>'),
  video: svg('<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9.2 5 2.8-5 2.8z" fill="currentColor"/>'),
  live: svg('<circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M8 8a5.6 5.6 0 0 0 0 8M16 8a5.6 5.6 0 0 1 0 8M5.2 5.2a9.6 9.6 0 0 0 0 13.6M18.8 5.2a9.6 9.6 0 0 1 0 13.6"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>'),
  heart: svg('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor"/>'),
  flask: svg('<path d="M9 3h6"/><path d="M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};

// ---------- код сборки для игры ----------
// Название сборки в игре: RANDOMLOCK.COM - [оценка затара] - [дата], например «RANDOMLOCK.COM - 50,5% - 27.10.2026»
function gameBuildName(sc) {
  const d = new Date();
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  return ['RANDOMLOCK.COM', sc ? `${dec(sc.chance)}%` : null, date].filter(Boolean).join(' - ');
}
function gameCode() {
  const r = state.res;
  const order = state.opts.order || 'chaos';
  const categories = order === 'phases'
    ? PHASES.map((p) => ({ name: CATEGORY_KEYS[p.key], items: r.build.slice(p.from, p.to).map((i) => i.id) }))
    : [{ name: `${t('gameCat')} 1→12`, items: r.build.map((i) => i.id) }];
  const ab = r.hero.abilities || [];
  const sc = scoreBuild(r.build, heroStats(r.hero));
  const desc = [sc ? `${t('copyScore')}: ${t('v_' + sc.verdict)}, ≈${dec(sc.chance)}%` : '', shareUrl()].filter(Boolean).join('\n');
  try {
    return encodeBuildCode({
      heroId: r.hero.id,
      name: gameBuildName(sc),
      desc,
      categories,
      abilityOrder: ab.length === 4 && ab.every((a) => a.id) ? r.skills : null,
      abilityIds: ab.map((a) => a.id),
    });
  } catch { return null; }
}

// ---------- оценка затара ----------
const heroStats = (hero) => (state.stats && state.stats.heroes ? state.stats.heroes[hero.id] : null);
const dec = (v, n = 1) => v.toFixed(n).replace('.', state.lang === 'ru' ? ',' : '.');
const pp = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + dec(Math.abs(v));


function renderScore(hero, build) {
  if (!state.stats) return '';
  const sc = scoreBuild(build, heroStats(hero));
  if (!sc) return `<div class="verdict none"><div class="v-head"><span class="v-label">${t('scoreT')}</span></div><p class="v-sub">${t('scoreNone')}</p></div>`;
  const pos = meterPos(sc.mean * 10);
  return `
    <div class="verdict v-${sc.verdict}">
      <div class="v-head">
        <span class="v-label">${t('scoreT')}</span>
        <span class="tag v-tag">${t('v_' + sc.verdict)}</span>
      </div>
      <div class="v-body">
        <div class="v-chance" title="${esc(t('realNote'))}: ≈${dec(sc.realChance)}%"><b>≈${dec(sc.chance)}%</b><span>${t('chanceNote')}</span></div>
        <div class="v-meter" aria-hidden="true"><span class="z-troll"></span><span class="z-challenge"></span><span class="z-risky"></span><span class="z-solid"></span><span class="z-meta"></span><i style="left:${pos}%"></i></div>
      </div>
      ${gapLine(sc)}
    </div>`;
}
// подпись, если в затаре нет категории, без которой герою обычно тяжело (см. mixPenalty)
function gapLine(sc) {
  if (!sc.gaps || !sc.gaps.length) return '';
  const ru = state.lang === 'ru';
  const names = sc.gaps.map((c) => (ru ? `«${t(c)}»` : t(c).toLowerCase()));
  const txt = sc.gaps.length === 1
    ? t('gapNote').replace('{c}', ru ? t(sc.gaps[0]) : names[0])
    : t('gapNoteN').replace('{c}', names.join(ru ? ' и ' : ' and '));
  return `<p class="v-gap">${esc(txt)}</p>`;
}

async function loadStats() {
  if (window.DS_STATS) { state.stats = window.DS_STATS; return; }
  try { state.stats = await fetchJson(CFG.dataUrl + 'stats.json?v=' + Math.floor(Date.now() / 36e5)); } catch { state.stats = null; }
}

// Ромб как в игровом интерфейсе прокачки
const GEM = '<svg class="gem" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1 15 8 8 15 1 8Z"/><path class="gem-in" d="M8 4.5 11.5 8 8 11.5 4.5 8Z"/></svg>';
const AP_COST = [0, 1, 2, 5]; // стоимость улучшений в очках способностей

function renderSkills() {
  const { hero, skills } = state.res;
  const ab = hero.abilities && hero.abilities.length ? hero.abilities : [0, 1, 2, 3].map((i) => ({ name: `#${i + 1}`, icon: null, ult: i === 3, up: [] }));
  const seen = [0, 0, 0, 0];
  const cellsByRow = ab.map(() => Array(16).fill(0));
  skills.forEach((s, step) => { if (cellsByRow[s]) cellsByRow[s][step] = ++seen[s]; });
  document.getElementById('skills').innerHTML = `
    <h2>${hl(t('skills'))}</h2>
    <div class="skills-scroll"><div class="skills" role="table">
      <span></span>${Array.from({ length: 16 }, (_, i) => `<span class="num">${i + 1}</span>`).join('')}
      ${ab.map((a, r) => `
        <span class="ab" title="${esc(a.quip || '')}">${a.icon ? `<img src="${esc(src(a.icon))}" alt="" width="28" height="28" loading="lazy">` : '<img alt="">'}<span>${esc(a.name)}</span></span>
        ${cellsByRow[r].map((v, c) => {
          const edge = c === 0 ? ' first' : c === 15 ? ' last' : '';
          if (!v) return `<span class="cell${edge}"></span>`;
          if (v === 1) return `<span class="cell${edge}"><span class="pip open" title="${esc(t('unlock'))}: ${esc(a.name)}">${GEM}</span></span>`;
          const lvl = v - 1;
          const tip = `${a.name} +${AP_COST[lvl]}${a.up && a.up[lvl - 1] ? ': ' + a.up[lvl - 1] : ''}`;
          return `<span class="cell${edge}"><span class="pip up" title="${esc(tip)}">${GEM}${AP_COST[lvl]}</span></span>`;
        }).join('')}`).join('')}
    </div></div>`;
}

function renderOpts() {
  const o = state.opts;
  const d = state.data;
  document.getElementById('opts').innerHTML = `
    <h2>${hl(t('settings'))}</h2>
    <p class="sub">${t('settingsSub')}</p>
    <div class="opts">
      <div class="opt">
        <span class="lbl">${t('tiers')}</span>
        <div class="toggle-row">${[1, 2, 3, 4].map((n) => `<button class="tog" data-act="tier" data-v="${n}" aria-pressed="${o.tiers.includes(n)}">${ROMAN[n]} · ${fmt(d.prices[n])}</button>`).join('')}</div>
      </div>
      <div class="opt">
        <label for="o-act">${t('actives')}</label>
        <div class="range"><input id="o-act" type="range" min="-1" max="${MAX_ACTIVE}" step="1" value="${o.actives === 'random' ? -1 : o.actives}" data-opt="actives"><output>${o.actives === 'random' ? t('activesRandom') : o.actives}</output></div>
        <span class="hint">${t('activesHint')}</span>
      </div>
    </div>
    <div class="opt opt-lane">
      <label class="check"><input type="checkbox" data-opt="lane" ${o.lane ? 'checked' : ''}><span>${t('laneOpt')}</span></label>
      <span class="hint">${t('laneHint')}</span>
    </div>
    <div class="opt" style="margin-top:20px">
      <span class="lbl">${t('pool')}</span>
      <span class="hint">${t('poolHint')}</span>
      <div class="heroes-pick ${o.exclude.length ? 'filtered' : ''}">
        ${d.heroes.map((h) => `<button class="hp" data-act="excl" data-v="${h.id}" aria-pressed="${!o.exclude.includes(h.id)}" title="${esc(h.name)}" aria-label="${esc(h.name)}">${isNewHero(h) ? `<span class="new-badge">${t('newHeroBadge')}</span>` : ''}${h.small ? `<img src="${esc(src(h.small))}" alt="" loading="lazy" width="52" height="52">` : esc(h.name.slice(0, 2))}</button>`).join('')}
      </div>
      <div class="opts-foot">
        <button class="btn" data-act="reset">${t('reset')}</button>
        ${o.exclude.length ? `<span class="pool-bar"><b>${d.heroes.length - d.heroes.filter((h) => o.exclude.includes(h.id)).length}</b> ${t('poolCount')} <button class="btn" data-act="all-heroes">${t('allHeroes')}</button></span>` : ''}
      </div>
    </div>`;
}

function renderAbout() {
  document.getElementById('about').innerHTML = `
    <div class="about">
      <div><h3>${t('aboutT')}</h3>${t('about').map((p) => `<p>${p}</p>`).join('')}</div>
      <div><h3>${t('gameT')}</h3>${t('game').map((p) => `<p>${p}</p>`).join('')}<p><button class="how-link" data-act="how">${t('howBtn')}</button></p></div>
      <div><h3>${t('dataT')}</h3>${t('data').map((p) => `<p>${p}</p>`).join('')}</div>
    </div>`;
  document.getElementById('foot').innerHTML = `<a class="btn lab-link" href="lab/builds.html" data-track="lab_open" data-track-v="footer">${ICON.flask}<span>${t('labLink')}</span></a><span class="lab-sub">${t('labSub')}</span><p>${t('legal')}</p>`;
}

function renderAll() {
  renderTop();
  renderStage();
  renderSkills();
  renderOpts();
  renderAbout();
  document.documentElement.lang = state.lang;
}

function saveOpts() {
  store.set('ds:opts', state.opts);
}

// ---------- события ----------
app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const v = b.dataset.v;
  const o = state.opts;
  switch (act) {
    case 'roll': doRoll('all'); break;
    case 'hero': doRoll('hero'); break;
    case 'items': doRoll('items'); break;
    case 'slot':
      // на телефоне тап открывает карточку предмета, перекрут — кнопкой в ней
      if (isTouch()) { openTipSheet(+b.dataset.i); break; }
      hideTip(); rerollSlot(+b.dataset.i); track('reroll_slot', { slot: +b.dataset.i + 1, hero: state.res && state.res.hero.name }); break;
    case 'game': toGame(); break;
    case 'how': openHow(false); track('howto_open'); break;
    case 'link': copy(shareUrl(), t('linkCopied')); track('share_link', { hero: state.res && state.res.hero.name }); break;
    case 'lang': if (v !== state.lang) { switchLang(v); track('setting', { name: 'lang', value: v }); } break;
    case 'mode': if (o.mode === v || spinning) break; o.mode = v; saveOpts(); track('setting', { name: 'invest', value: v }); doRoll('all', 'setting'); break;
    case 'order':
      if (o.order === v || spinning) break;
      // режимы по-разному подбирают предметы — при переключении сразу новая крутка
      o.order = v; saveOpts();
      track('setting', { name: 'order', value: v });
      doRoll('all', 'setting'); break;
    case 'tier': {
      const n = +v;
      o.tiers = o.tiers.includes(n) ? o.tiers.filter((x) => x !== n) : [...o.tiers, n].sort();
      if (!o.tiers.length) o.tiers = [n];
      saveOpts(); renderOpts(); track('setting', { name: 'tiers', value: o.tiers.join('') }); break;
    }
    case 'excl': {
      const id = +v;
      const all = state.data.heroes.map((h) => h.id);
      // первый клик при полном пуле — остаётся только этот герой; дальше клики добавляют и убирают
      if (!o.exclude.length) o.exclude = all.filter((x) => x !== id);
      else o.exclude = o.exclude.includes(id) ? o.exclude.filter((x) => x !== id) : [...o.exclude, id];
      if (o.exclude.length >= all.length) o.exclude = []; // убрали последнего — снова все
      saveOpts(); renderOpts(); track('setting', { name: 'hero_pool', value: o.exclude.length ? all.length - o.exclude.length : 'all' }); break;
    }
    case 'all-heroes': {
      o.exclude = []; saveOpts(); renderOpts(); track('setting', { name: 'hero_pool', value: 'all' }); break;
    }
    case 'reset': state.opts = Object.assign({}, DEFAULTS); saveOpts(); renderOpts(); track('setting', { name: 'reset' }); break;
  }
});

// ползунок шлёт событие один раз — когда отпустили
app.addEventListener('change', (e) => {
  const k = e.target.dataset && e.target.dataset.opt;
  if (k === 'lane' && state.res) {
    if (state.opts.lane && !state.res.lane && state.data.lanes && state.data.lanes.length) state.res.lane = state.data.lanes[Math.floor(Math.random() * state.data.lanes.length)];
    renderStage(false); syncUrl();
  }
  if (k) track('setting', { name: k, value: String(state.opts[k]) });
});

app.addEventListener('input', (e) => {
  const el = e.target;
  const k = el.dataset && el.dataset.opt;
  if (!k) return;
  if (el.type === 'checkbox') state.opts[k] = el.checked;
  else {
    state.opts[k] = k === 'actives' && +el.value < 0 ? 'random' : +el.value;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = k === 'actives' && +el.value < 0 ? t('activesRandom') : el.value;
  }
  saveOpts();
});

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  if (document.getElementById('how')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
  e.preventDefault();
  doRoll('all', 'space');
});

async function switchLang(lang) {
  const code = state.res ? encodeResult(state.res) : null;
  state.lang = lang;
  store.set('ds:lang', lang);
  try {
    state.data = await loadData(lang);
  } catch { toast(t('error')); return; }
  const old = state.res;
  state.res = (code && decodeResult(code, state.data)) || roll(state.data, state.opts, newSeed());
  // та же крутка на другом языке: сохраняем сид и все уже показанные порядки покупки
  if (old) {
    state.res.seed = old.seed || newSeed();
    const byId = new Map(state.data.items.map((i) => [i.id >>> 0, i]));
    state.res.orders = {};
    for (const [m, arr] of Object.entries(old.orders || {})) state.res.orders[m] = arr.map((i) => byId.get(i.id >>> 0)).filter(Boolean);
  }
  if (!state.res.seed) state.res.seed = newSeed();
  if (!state.res.orders || !state.res.orders[state.opts.order]) state.res.orders = { ...(state.res.orders || {}), [state.opts.order]: state.res.build };
  renderAll();
  liveCheck();
}

// ---------- старт ----------
async function boot() {
  markDev();
  initAnalytics('roulette');
  try {
    state.data = await loadData(state.lang);
  } catch {
    app.innerHTML = `<div class="loading">${t('error')}</div>`;
    return;
  }
  shell();
  let fromUrl = null;
  try { fromUrl = new URL(location.href).searchParams.get('b'); } catch {}
  const shared = fromUrl && decodeResult(fromUrl, state.data);
  if (shared) { shared.seed = newSeed(); state.res = shared; }
  else state.res = roll(state.data, state.opts, newSeed());
  state.res.orders = { [state.opts.order || 'chaos']: state.res.build };
  if (!state.res.skills || state.res.skills.length !== 16) state.res.skills = rollSkillOrder(rng(newSeed()), 4, ultIndexOf(state.res.hero));
  renderAll();
  preloadIcons();
  ensureAbilities(state.res.hero);
  loadStats().then(() => renderStage(false));
  liveCheck();
}

boot();
