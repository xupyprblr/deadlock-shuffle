// Лаборатория: сборки игроков, сравнение, рандомная сборка игрока.
// Все данные — напрямую из Deadlock API в браузере (CORS открыт).
import { encodeBuildCode } from './buildcode.js';
import { initAnalytics, track } from './analytics.js';

const API = 'https://api.deadlock-api.com/v1';
const DAY = 86400;
const PERIODS = [7, 14, 30, 90];
// Ранги: значок = тир × 10 + подуровень (см. /v1/assets/ranks)
const RANKS = [
  [0, 'Все ранги'], [61, 'Ritualist+'], [71, 'Emissary+'], [81, 'Oracle+'], [91, 'Phantom+'], [101, 'Ascendant+'],
];
const SORTS = [['wr', 'Винрейт'], ['matches', 'Матчи'], ['delta', 'Отклонение от героя'], ['low', 'Нижняя граница WR']];
const TOP_N = 40; // для скольких сборок подгружать названия и содержимое

// ---------- аномалии и самородки ----------
// Малые сборки (< 50 матчей) почти целиком шум: из 1313 таких сборок у 313 «60%+».
// Поэтому голого порога по винрейту мало — нужна статистическая надёжность (калибровка 24.10.2026, 12 героев):
//  • кандидат: не в топ-10% сборок героя по матчам (непопулярная), ≥ 50 матчей, ≥ 10 разных игроков
//    (иначе это личная сборка одного человека);
//  • «Аномалия»: WR ≥ 55% и нижняя граница одностороннего 95% интервала Уилсона выше винрейта героя;
//  • «Самородок»: то же, но WR ≥ 60%.
// «Реалистичная оценка» — эмпирический байес: WR поджимается к винрейту героя с весом K матчей.
// Настоящий разброс между сборками ≈ 3 п.п. (наблюдаемый разброс минус шум выборки), K = p(1−p)/τ² ≈ 0,25/0,03² ≈ 275.
const ANOM = { minMatches: 50, minPlayers: 10, popularPct: 0.9, wr: 0.55, gemWr: 0.6, z: 1.645, k: 275, fetchMin: 20 };
const SHOWS = [['all', 'Все сборки'], ['anom', 'Аномалии и самородки'], ['gem', 'Только самородки']];

function wilsonLow(w, n, z) {
  const p = w / n, d = 1 + (z * z) / n;
  return ((p + (z * z) / (2 * n)) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
}
// Помечает сборки героя: r.kind = 'gem' | 'anom' | null, r.est — реалистичная оценка
function classify(rows, base) {
  if (!rows.length || !base) return { cut: 0 };
  const ms = rows.map((r) => r.matches).sort((a, b) => a - b);
  const cut = ms[Math.floor(ms.length * ANOM.popularPct)] || Infinity; // граница топ-10% по популярности
  for (const r of rows) {
    r.est = base.wr + (r.wr - base.wr) * (r.matches / (r.matches + ANOM.k));
    r.kind = null;
    if (r.matches < ANOM.minMatches || r.players < ANOM.minPlayers || r.matches >= cut) continue;
    if (wilsonLow(r.wins, r.matches, ANOM.z) <= base.wr) continue;
    if (r.wr >= ANOM.gemWr) r.kind = 'gem';
    else if (r.wr >= ANOM.wr) r.kind = 'anom';
  }
  return { cut };
}

const root = document.getElementById('lab');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
const num = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : 0); // числовые поля из API — только числа
const pct = (v, d = 1) => (v * 100).toFixed(d).replace('.', ',') + '%';
const pp = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v * 100).toFixed(1).replace('.', ',');
const day = (t) => (t ? new Date(t * 1000).toLocaleDateString('ru-RU') : '—');
// Начало периода округляем до начала часа: у всех зрителей в течение часа получаются одинаковые
// адреса запросов, и их отдают кэш Cloudflare и часовой кэш самого API, не тратя лимит.
const HOUR = 3600;
const ALL_TIME = 1704067200; // 01.01.2024 — без даты API отдаёт только последний месяц
const since = (days) => days == null ? ALL_TIME : Math.floor(Date.now() / 1000 / HOUR) * HOUR - days * DAY;

// 95% интервал Уилсона для доли побед
function wilson(w, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = w / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// ---------- запросы с кэшем и ограничением параллельности ----------
const cache = new Map();
let active = 0;
const queue = [];
function limited(fn) {
  return new Promise((res, rej) => {
    const run = async () => { active++; try { res(await fn()); } catch (e) { rej(e); } finally { active--; queue.length && queue.shift()(); } };
    active < 6 ? run() : queue.push(run);
  });
}
// Кэш в браузере на час: повторный просмотр той же сборки или героя не тратит запросы к API.
// localStorage может быть недоступен (приватный режим, переполнение) — тогда работаем без него.
const STORE_TTL = HOUR * 1000;
const STORE_PREFIX = 'lab:api:';
function storeGet(key) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    if (!raw) return undefined;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > STORE_TTL) { localStorage.removeItem(STORE_PREFIX + key); return undefined; }
    return v;
  } catch { return undefined; }
}
function storeSet(key, v) {
  const put = () => localStorage.setItem(STORE_PREFIX + key, JSON.stringify({ t: Date.now(), v }));
  try { put(); } catch {
    // нет места — выкидываем свои старые записи и пробуем ещё раз
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(STORE_PREFIX)) localStorage.removeItem(k); }
      put();
    } catch { /* без кэша */ }
  }
}

// Ответы 429 (лимит) и 503 (API перегружен) — ждём, сколько просит Retry-After, и повторяем.
const MAX_TRIES = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchWithRetry(url) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status === 503) && attempt < MAX_TRIES) {
      const ra = parseFloat(r.headers.get('retry-after'));
      const wait = Math.min(60, Number.isFinite(ra) && ra > 0 ? ra : 5 * attempt);
      toast(r.status === 429 ? `Лимит API — повторю через ${Math.ceil(wait)} с` : `API перегружен — повторю через ${Math.ceil(wait)} с`);
      await sleep(wait * 1000);
      continue;
    }
    if (r.status === 429) throw new Error('Слишком много запросов к API — подожди минуту и повтори.');
    if (r.status === 503) throw new Error('API перегружен — попробуй через пару минут.');
    throw new Error(`API ответил ${r.status}`);
  }
}

function api(path, params = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== 0) u.searchParams.set(k, v);
  const key = u.toString();
  if (!cache.has(key)) {
    const stored = storeGet(key);
    if (stored !== undefined) cache.set(key, Promise.resolve(stored));
    else {
      cache.set(key, limited(() => fetchWithRetry(key))
        .then((v) => { storeSet(key, v); return v; })
        .catch((e) => { cache.delete(key); throw e; }));
    }
  }
  return cache.get(key);
}
const getBuild = (id) => api('/builds', { build_id: id, only_latest: 'true' }).then((r) => (r && r[0] ? r[0].hero_build : null));
// Свежая версия прямо из игры: база API обновляет сборки с опозданием (бывает на месяцы).
// Лимит этого запроса — 20/мин с IP, поэтому только для открытых карточек, кэш на час, без долгих повторов.
// Не больше 12 таких запросов за открытие страницы: общий лимит API — 500/мин на всех,
// при наплыве зрителей не хотим выбрать его в одиночку (дальше — версия из базы).
let refetchBudget = 12;
async function getFreshBuild(id) {
  const old = await getBuild(id);
  if (!old) return null;
  const key = `${API}/builds/${num(old.hero_id)}/${num(id)}?force_refetch=true`;
  const stored = storeGet(key);
  if (stored !== undefined) return stored;
  if (refetchBudget <= 0) return old;
  refetchBudget--;
  try {
    const r = await fetch(key);
    if (!r.ok) return old;
    const d = await r.json();
    const b = d && (d.hero_build || d);
    if (!b || !b.hero_id) return old;
    const fresh = (b.version || 0) >= (old.version || 0) ? b : old;
    storeSet(key, fresh);
    return fresh;
  } catch { return old; }
}
async function heroBase(heroId, days, badge) {
  const r = await api('/analytics/hero-stats', { min_unix_timestamp: since(days), min_average_badge: badge });
  const h = r.find((x) => x.hero_id === heroId);
  return h && h.matches ? { wr: h.wins / h.matches, matches: h.matches } : null;
}

// ---------- справочник ----------
let D = null;
let heroById = {}, itemById = {}, abilityById = {};
const icon = (p) => (p && !p.startsWith('http') ? '../' + p : p || '');

const state = {
  tab: 'hero', heroId: null, days: 30, badge: 0, minMatches: 500, sort: 'wr', show: 'all',
  ids: '', rows: null, loading: false, error: '',
  compare: [], modal: null,
};

// ---------- рендер ----------
function shell() {
  root.innerHTML = `
    <h1 class="lab-title">Лаборатория <mark>сборок</mark></h1>
    <div class="seg-order lab-tabs" role="tablist">
      <button data-tab="hero" aria-pressed="${state.tab === 'hero'}">По герою</button>
      <button data-tab="ids" aria-pressed="${state.tab === 'ids'}">По ID</button>
      <button data-tab="rnd" aria-pressed="${state.tab === 'rnd'}">Рандом билд</button>
      <button data-tab="cmp" aria-pressed="${state.tab === 'cmp'}">${cmpLabel()}</button>
    </div>
    <section id="panel"></section>`;
  renderPanel();
}

function renderPanel() {
  const el = document.getElementById('panel');
  if (state.tab === 'hero') el.innerHTML = heroPanel();
  else if (state.tab === 'ids') el.innerHTML = idsPanel();
  else if (state.tab === 'rnd') el.innerHTML = rndPanel();
  else el.innerHTML = cmpPanel();
  syncUrl();
  renderLists();
}

function selectHtml(id, items, val) {
  return `<select id="${id}" class="lab-select">${items.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function heroPanel() {
  return `
    <div class="lab-pick">
      ${D.heroes.map((h) => `<button class="hp" data-hero="${h.id}" aria-pressed="${state.heroId === h.id}" title="${esc(h.name)}">${h.small ? `<img src="${esc(icon(h.small))}" alt="" width="52" height="52" loading="lazy">` : esc(h.name)}</button>`).join('')}
    </div>
    <div class="lab-filters">
      <label>Период ${selectHtml('f-days', PERIODS.map((d) => [d, d + ' дней']), state.days)}</label>
      <label>Ранг ${selectHtml('f-badge', RANKS, state.badge)}</label>
      <label>Показать ${selectHtml('f-show', SHOWS, state.show)}</label>
      ${state.show === 'all' ? `<label>Мин. матчей ${selectHtml('f-min', [[100, '100'], [500, '500'], [1000, '1 000'], [2000, '2 000'], [5000, '5 000']], state.minMatches)}</label>` : ''}
      <label>Сортировка ${selectHtml('f-sort', SORTS, state.sort)}</label>
    </div>
    <div id="hero-out">${heroOut()}</div>`;
}

function heroOut() {
  if (!state.heroId) return '<p class="lab-empty">Выбери героя.</p>';
  if (state.loading) return '<p class="lab-empty">Считаю статистику…</p>';
  if (state.error) return `<p class="lab-error">${esc(state.error)}</p>`;
  if (!state.rows) return '';
  const { base, total, cut } = state.rows;
  const anomMode = state.show !== 'all';
  const rows = anomMode ? state.rows.rows.filter((r) => (state.show === 'gem' ? r.kind === 'gem' : r.kind)) : state.rows.rows;
  if (!rows.length) {
    return anomMode
      ? `<p class="lab-empty">За этот период и ранг ${state.show === 'gem' ? 'самородков' : 'аномалий'} нет: ни одна непопулярная сборка не выше героя с достаточной уверенностью. Попробуй период 90 дней или «Все ранги».</p>`
      : `<p class="lab-empty">Нет сборок с ${fmt(state.minMatches)}+ матчей за этот период и ранг. Уменьши порог.</p>`;
  }
  const sorted = rows.slice().sort((a, b) => {
    if (anomMode && state.sort === 'wr') return b.est - a.est; // в поиске аномалий сначала самые правдоподобные
    if (state.sort === 'matches') return b.matches - a.matches;
    if (state.sort === 'delta') return (b.wr - (base?.wr || 0)) - (a.wr - (base?.wr || 0));
    if (state.sort === 'low') return b.ci[0] - a.ci[0];
    return b.wr - a.wr;
  });
  const h = heroById[state.heroId];
  return `
    <p class="lab-summary"><b>${esc(h.name)}</b>: ${base ? `винрейт героя ${pct(base.wr)} на ${fmt(base.matches)} матчах` : 'нет данных по герою'} · ${anomMode
      ? `самородков: <b>${state.rows.rows.filter((r) => r.kind === 'gem').length}</b>, аномалий: <b>${state.rows.rows.filter((r) => r.kind === 'anom').length}</b> из ${fmt(state.rows.rows.length)} сборок (непопулярные — до ${fmt(cut)} матчей)`
      : `сборок с ${fmt(state.minMatches)}+ матчей: <b>${rows.length}</b> (${fmt(total)} матчей)`}</p>
    <div class="lab-table-wrap"><table class="lab-table">
      <thead><tr><th>#</th><th>Сборка</th><th class="n">Матчи</th><th class="n">Игроки</th><th class="n">WR</th><th class="n">95% интервал</th><th class="n">к герою</th>${anomMode ? '<th class="n">Оценка</th>' : ''}<th></th></tr></thead>
      <tbody>${sorted.map((r, i) => {
        const d = base ? r.wr - base.wr : 0;
        const sig = base ? (r.ci[0] > base.wr ? 'up' : r.ci[1] < base.wr ? 'down' : 'flat') : 'flat';
        const b = r.build;
        return `<tr>
          <td class="n muted">${i + 1}</td>
          <td><div class="b-name">${r.kind === 'gem' ? '<span class="kind gem">Самородок</span>' : r.kind === 'anom' ? '<span class="kind anom">Аномалия</span>' : ''}${b ? esc(b.name || 'Без названия') : `<span class="muted">загрузка…</span>`}</div>
              <div class="b-meta">${idBtn(r.id)}${b ? ` · v${esc(b.version)} · обновлена ${day(b.last_updated_timestamp)}` : ''}</div></td>
          <td class="n">${fmt(r.matches)}</td>
          <td class="n">${fmt(r.players)}</td>
          <td class="n wr">${pct(r.wr)}</td>
          <td class="n muted">${pct(r.ci[0])}–${pct(r.ci[1])}</td>
          <td class="n"><span class="sig ${sig}">${base ? pp(d) : '—'}</span></td>
          ${anomMode ? `<td class="n" title="Реалистичная оценка с учётом размера выборки">${pct(r.est)}</td>` : ''}
          <td class="n"><div class="row-acts"><button class="btn btn-mini" data-open="${r.id}">Открыть</button>${cmpBtn(r.id, true)}</div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="lab-legend"><span class="sig up">зелёный</span> — выше героя с учётом погрешности, <span class="sig down">красный</span> — ниже, <span class="sig flat">серый</span> — в пределах погрешности.${anomMode ? ` <span class="kind anom">Аномалия</span> — непопулярная сборка с WR 55%+, надёжно выше героя; <span class="kind gem">Самородок</span> — то же с WR 60%+. «Оценка» — ожидаемый винрейт с поправкой на малую выборку.` : ''}</p>`;
}

async function loadHero() {
  const hid = state.heroId;
  state.loading = true; state.error = ''; state.rows = null;
  document.getElementById('hero-out').innerHTML = heroOut();
  try {
    const [stats, base] = await Promise.all([
      api(`/analytics/hero-build-stats/${hid}`, { min_unix_timestamp: since(state.days), min_average_badge: state.badge, min_matches: state.show === 'all' ? state.minMatches : ANOM.fetchMin }),
      heroBase(hid, state.days, state.badge),
    ]);
    if (hid !== state.heroId) return;
    const rows = (stats || []).map((x) => ({ id: num(x.hero_build_id), matches: x.matches, players: x.players, wins: x.wins, wr: x.wins / x.matches, ci: wilson(x.wins, x.matches), build: null }));
    const { cut } = classify(rows, base);
    state.rows = { rows, base, cut, total: rows.reduce((a, r) => a + r.matches, 0) };
    state.loading = false;
    document.getElementById('hero-out').innerHTML = heroOut();
    // названия — для самых популярных сборок, постепенно
    // в поиске аномалий — названия всех найденных, иначе самых популярных
    const top = state.show !== 'all' ? rows.filter((r) => r.kind) : rows.slice().sort((a, b) => b.matches - a.matches).slice(0, TOP_N);
    await Promise.all(top.map(async (r) => {
      try { r.build = await getBuild(r.id); } catch { /* пропускаем */ }
      if (hid === state.heroId && state.tab === 'hero') document.getElementById('hero-out').innerHTML = heroOut();
    }));
  } catch (e) {
    state.loading = false; state.error = e.message;
    document.getElementById('hero-out').innerHTML = heroOut();
  }
}

// ---------- сравнение: список ID ----------
const CMP_MAX = 6;
const CMP_KEY = 'lab:compare';
function loadCompare() {
  try { const v = JSON.parse(localStorage.getItem(CMP_KEY) || '[]'); return Array.isArray(v) ? v.map(Number).filter((n) => n > 0).slice(0, CMP_MAX) : []; } catch { return []; }
}
function saveCompare() { try { localStorage.setItem(CMP_KEY, JSON.stringify(state.compare)); } catch {} }
const inCmp = (id) => state.compare.includes(+id);
const cmpLabel = () => `Сравнение${state.compare.length ? ` · ${state.compare.length}` : ''}`;

function cmpBtn(id, mini) {
  return inCmp(id)
    ? `<button class="btn ${mini ? 'btn-mini' : ''} btn-cmp on" data-cmp-del="${id}" title="Убрать из сравнения">${mini ? '✓ В сравнении' : 'Убрать из сравнения'}</button>`
    : `<button class="btn ${mini ? 'btn-mini' : ''} btn-cmp" data-cmp-add="${id}">${mini ? '+ Сравнить' : 'Добавить в сравнение'}</button>`;
}
const idBtn = (id) => `<button class="id-copy" data-copy-id="${id}" title="Скопировать ID">ID ${id}</button>`;

function cmpAdd(id) {
  id = +id;
  if (inCmp(id)) return;
  if (state.compare.length >= CMP_MAX) { toast(`В сравнении максимум ${CMP_MAX} сборок — сначала убери одну`); return; }
  state.compare.push(id); saveCompare(); track('lab_compare_add', { build: id }); toast(`Сборка ${id} добавлена в сравнение`); refresh();
}
function cmpDel(id) {
  state.compare = state.compare.filter((x) => x !== +id); saveCompare(); refresh();
}

function syncUrl() {
  try {
    const u = new URL(location.href);
    u.searchParams.delete('ids'); u.searchParams.delete('cmp'); u.searchParams.delete('tab');
    if (state.tab === 'rnd') u.searchParams.set('tab', 'rnd');
    if (state.tab === 'ids' && parseIds(state.ids).length) u.searchParams.set('ids', parseIds(state.ids).join(','));
    if (state.tab === 'cmp' && state.compare.length) u.searchParams.set('cmp', state.compare.join(','));
    history.replaceState(null, '', u);
  } catch {}
}

// ---------- загрузка сборок (кэш на сессию, по рангу) ----------
const cards = new Map();
function cardFor(id) {
  const key = id + ':' + state.badge;
  if (!cards.has(key)) {
    const c = { id, loading: true };
    cards.set(key, c);
    fillCard(c).finally(() => { c.loading = false; renderLists(); });
  }
  return cards.get(key);
}
async function fillCard(c) {
  try {
    const b = await getFreshBuild(c.id);
    if (!b) { c.error = 'Сборка не найдена'; return; }
    c.build = b;
    const hid = b.hero_id;
    // для карточки — только 14 дней и всё время; сравнение с героем за тот же период
    c.periods = await Promise.all(CARD_PERIODS.map(async (d) => {
      const [r, base] = await Promise.all([
        api(`/analytics/hero-build-stats/${hid}`, { hero_build_id: c.id, min_unix_timestamp: since(d), min_average_badge: state.badge }),
        heroBase(hid, d, state.badge),
      ]);
      const x = (r || [])[0];
      return x ? { days: d, base, matches: x.matches, players: x.players, wr: x.wins / x.matches, ci: wilson(x.wins, x.matches) } : { days: d, base, matches: 0 };
    }));
  } catch (e) { c.error = e.message; }
}

function parseIds(s) {
  return [...new Set(String(s).split(/[^0-9]+/).filter(Boolean).map(Number).filter((n) => n > 0))].slice(0, CMP_MAX);
}

// ---------- панели ----------
function idsPanel() {
  return `
    <form id="ids-form" class="lab-ids">
      <label for="ids-input">ID сборки — можно несколько через запятую</label>
      <div class="lab-ids-row">
        <input id="ids-input" type="text" inputmode="numeric" placeholder="410706, 697756" value="${esc(state.ids)}">
        <button class="btn btn-game" type="submit">Найти</button>
      </div>
      <label>Ранг для статистики ${selectHtml('i-badge', RANKS, state.badge)}</label>
    </form>
    <div id="ids-cards" class="g-list"></div>`;
}
function cmpPanel() {
  return `
    <div class="lab-filters">
      <label>Ранг для статистики ${selectHtml('c-badge', RANKS, state.badge)}</label>
      ${state.compare.length ? '<button class="btn btn-mini" data-cmp-clear="1">Очистить сравнение</button>' : ''}
    </div>
    <div id="cmp-cards" class="g-compare"></div>`;
}

// ---------- рандомная сборка игрока ----------
// Берём опубликованные сборки с 50+ матчами от 10+ игроков за 30 дней (меньше — винрейт почти чистый шум),
// фильтруем по диапазону винрейта, затем случайно перебираем и проверяем склонность инвеста по содержимому.
const RND = { days: 30, minMatches: 50, minPlayers: 10, maxChecks: 24, maxHeroes: 10 };
const LEANS = [['any', 'Любая'], ['weapon', 'Оружие'], ['spirit', 'Спиритизм'], ['vitality', 'Живучесть']];
const WRS = [['any', 'Любой'], ['low', 'до 45%'], ['mid', '45–54%'], ['anom', 'Аномалия 55–60%'], ['gem', 'Самородок 60%+']];
const CAT_RU = { weapon: 'Оружие', spirit: 'Спиритизм', vitality: 'Живучесть' };
const inWr = (wr, k) => k === 'any' || (k === 'low' ? wr < 0.45 : k === 'mid' ? wr >= 0.45 && wr < 0.55 : k === 'anom' ? wr >= 0.55 && wr < 0.6 : wr >= 0.6);
const shuffled = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
// склонность: куда вложено больше всего душ (по всем предметам сборки)
function leanOf(b) {
  const sum = { weapon: 0, spirit: 0, vitality: 0 };
  for (const cat of (b && b.details && b.details.mod_categories) || []) {
    for (const m of cat.mods || []) { const it = itemById[m.ability_id >>> 0]; if (it && sum[it.cat] !== undefined) sum[it.cat] += it.cost || 0; }
  }
  const total = sum.weapon + sum.spirit + sum.vitality;
  if (!total) return null;
  const cat = Object.keys(sum).sort((a, b2) => sum[b2] - sum[a])[0];
  return { cat, share: sum[cat] / total };
}
const rnd = { hero: null, lean: 'any', wr: 'any', busy: false, msg: '', id: null, info: null, seen: new Set() };

function segHtml(attr, items, val) {
  return `<div class="seg-order rnd-seg" role="radiogroup">${items.map(([v, l]) => `<button data-${attr}="${v}" aria-pressed="${val === v}">${esc(l)}</button>`).join('')}</div>`;
}
function rndPanel() {
  return `
    <div class="rnd-box">
      <div class="rnd-opt"><span class="rnd-lbl">Герой</span>
        <div class="lab-pick rnd-pick">
          <button class="hp hp-any" data-rhero="0" aria-pressed="${!rnd.hero}">Любой</button>
          ${D.heroes.map((h) => `<button class="hp" data-rhero="${h.id}" aria-pressed="${rnd.hero === h.id}" title="${esc(h.name)}">${h.small ? `<img src="${esc(icon(h.small))}" alt="" width="52" height="52" loading="lazy">` : esc(h.name)}</button>`).join('')}
        </div>
      </div>
      <div class="rnd-row">
        <div class="rnd-opt"><span class="rnd-lbl">Инвест в билде</span>${segHtml('rlean', LEANS, rnd.lean)}</div>
        <div class="rnd-opt"><span class="rnd-lbl">Винрейт</span>${segHtml('rwr', WRS, rnd.wr)}</div>
      </div>
      <div class="rnd-go">
        <button class="btn btn-main rnd-roll" data-rroll="1" ${rnd.busy ? 'disabled' : ''}>${rnd.busy ? 'Ищу…' : 'Крутить билд'}</button>
        <span class="lab-legend">Сборки игроков с ${RND.minMatches}+ матчами от ${RND.minPlayers}+ игроков за ${RND.days} дней.</span>
      </div>
    </div>
    <div id="rnd-out" class="g-list"></div>`;
}

async function rollRandomBuild() {
  if (rnd.busy) return;
  rnd.busy = true; rnd.msg = ''; rnd.id = null; rnd.info = null;
  renderPanel();
  try {
    const heroes = rnd.hero ? [heroById[rnd.hero]] : shuffled(D.heroes).slice(0, RND.maxHeroes);
    let found = null, poolSize = 0;
    for (const h of heroes) {
      const rows = (await api(`/analytics/hero-build-stats/${h.id}`, { min_unix_timestamp: since(RND.days), min_matches: RND.minMatches })) || [];
      const pool = rows.map((x) => ({ id: num(x.hero_build_id), matches: x.matches, players: x.players, wr: x.wins / x.matches }))
        .filter((r) => r.players >= RND.minPlayers && inWr(r.wr, rnd.wr));
      poolSize = pool.length;
      // сначала ещё не показанные
      const order = [...shuffled(pool.filter((r) => !rnd.seen.has(r.id))), ...shuffled(pool.filter((r) => rnd.seen.has(r.id)))];
      if (rnd.lean === 'any') { if (order.length) found = { r: order[0], h }; }
      else {
        const cand = order.slice(0, RND.maxChecks);
        for (let i = 0; i < cand.length && !found; i += 6) {
          const part = cand.slice(i, i + 6);
          const blds = await Promise.all(part.map((r) => getBuild(r.id).catch(() => null)));
          const k = blds.findIndex((b) => { const l = leanOf(b); return l && l.cat === rnd.lean; });
          if (k >= 0) found = { r: part[k], h, lean: leanOf(blds[k]) };
        }
      }
      if (found) { found.pool = poolSize; break; }
    }
    track('lab_random', { hero: rnd.hero ? heroById[rnd.hero].name : 'any', invest: rnd.lean, wr: rnd.wr, found: found ? 1 : 0, build: found ? found.r.id : '' });
    if (!found) {
      rnd.msg = rnd.hero
        ? `У ${esc(heroById[rnd.hero].name)} нет сборок под эти условия. Попробуй другой винрейт или склонность.`
        : 'Не нашёл сборок под эти условия. Ослабь фильтры и крутани ещё раз.';
    } else {
      rnd.seen.add(found.r.id);
      rnd.id = found.r.id;
      rnd.info = found;
    }
  } catch (e) {
    rnd.msg = 'Не удалось получить статистику: ' + esc(e.message);
  }
  rnd.busy = false;
  renderPanel();
}

function rndOut() {
  if (rnd.busy) return '<p class="lab-empty">Перебираю сборки игроков…</p>';
  if (rnd.msg) return `<p class="lab-empty">${rnd.msg}</p>`;
  if (!rnd.id) return '<p class="lab-empty">Выбери условия и нажми «Крутить билд».</p>';
  const f = rnd.info;
  const c = cardFor(rnd.id);
  const lean = f.lean || (c.build ? leanOf(c.build) : null);
  return `<p class="lab-summary">Выпала сборка на <b>${esc(f.h.name)}</b> · ${pct(f.r.wr)} на ${fmt(f.r.matches)} матчах за ${RND.days} дней${lean ? ` · склонность: <b>${CAT_RU[lean.cat]}</b> (${pct(lean.share, 0)} душ)` : ''} · сборок под эти условия: ${fmt(f.pool)}</p>
    ${buildCard(c, 'view')}`;
}

function renderLists() {
  const rndBox = document.getElementById('rnd-out');
  if (rndBox) rndBox.innerHTML = rndOut();
  const idsBox = document.getElementById('ids-cards');
  if (idsBox) {
    const ids = parseIds(state.ids);
    idsBox.innerHTML = ids.length ? ids.map((id) => buildCard(cardFor(id), 'view')).join('') : '<p class="lab-empty">Введи ID сборки — он есть в игре в заголовке сборки.</p>';
  }
  const cmpBox = document.getElementById('cmp-cards');
  if (cmpBox) {
    cmpBox.innerHTML = state.compare.length
      ? state.compare.map((id) => buildCard(cardFor(id), 'compare')).join('')
      : '<p class="lab-empty">Сравнение пустое. Добавляй сборки кнопкой «Добавить в сравнение» на вкладках «По герою» и «По ID» — до 6 штук.</p>';
  }
  renderModal();
}

// обновить всё, что зависит от списка сравнения
function refresh() {
  const tab = document.querySelector('[data-tab="cmp"]');
  if (tab) tab.textContent = cmpLabel();
  if (state.tab === 'hero' && document.getElementById('hero-out')) document.getElementById('hero-out').innerHTML = heroOut();
  if (state.tab === 'cmp') { const el = document.getElementById('panel'); el.innerHTML = cmpPanel(); syncUrl(); }
  renderLists();
}

// ---------- окно просмотра ----------
function renderModal() {
  let el = document.getElementById('lab-modal');
  if (!state.modal) { if (el) { el.remove(); document.body.classList.remove('lab-noscroll'); } return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'lab-modal'; el.className = 'lab-modal';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    document.body.appendChild(el); document.body.classList.add('lab-noscroll');
  }
  const top = el.scrollTop;
  el.innerHTML = `<div class="lab-modal-in"><button class="lab-close" data-close="1" aria-label="Закрыть">✕</button>${buildCard(cardFor(state.modal), 'modal')}</div>`;
  el.scrollTop = top;
}

// ---------- карточка сборки в стиле игры ----------
const CARD_PERIODS = [14, null]; // null — за всё время
const periodName = (d) => (d ? `За ${d} дней` : 'За всё время');

// одна строка: на сколько WR сборки выше/ниже среднего по герою
function verdict(c) {
  const p = c.periods.find((x) => x.matches) || null;
  if (!p) return ['flat', 'Нет матчей с этой сборкой'];
  if (!p.base) return ['flat', `Винрейт ${pct(p.wr)} — нет данных по герою для сравнения`];
  const d = p.wr - p.base.wr;
  const n = Math.abs(d * 100).toFixed(1).replace('.', ',');
  const when = p.days ? `за ${p.days} дней` : 'за всё время';
  const cls = p.ci[0] > p.base.wr ? 'up' : p.ci[1] < p.base.wr ? 'down' : 'flat';
  const word = d >= 0.0005 ? `на ${n}% выше` : d <= -0.0005 ? `на ${n}% ниже` : 'на уровне';
  const tail = cls === 'flat' && Math.abs(d) >= 0.0005 ? ' · матчей пока мало, может быть случайность' : '';
  return [cls, `Винрейт ${word} среднего по герою (${pct(p.wr)} против ${pct(p.base.wr)} ${when})${tail}`];
}

const CAT_NAMES = { '#Citadel_HeroBuilds_EarlyGame': 'Ранний этап', '#Citadel_HeroBuilds_MidGame': 'Середина матча', '#Citadel_HeroBuilds_LateGame': 'Поздний этап', '#Citadel_HeroBuilds_Early': 'Ранний этап', '#Citadel_HeroBuilds_Mid': 'Середина', '#Citadel_HeroBuilds_Late': 'Поздний этап', '#Citadel_HeroBuilds_Lane': 'Линия' };

function itemTile(m) {
  const it = itemById[m.ability_id >>> 0];
  const name = it ? it.name : `#${num(m.ability_id)}`;
  const cls = it ? `${it.cat} t${it.tier}${it.active ? ' act' : ''}` : 'unk';
  const tip = `${name}${it ? ` · ${it.tier} тир${it.active ? ' · активный' : ''}` : ''}${m.annotation ? ' — ' + m.annotation : ''}`;
  return `<div class="g-item ${cls}" title="${esc(tip)}">
    <div class="g-ic">${it && it.icon ? `<img src="${esc(icon(it.icon))}" alt="" loading="lazy">` : ''}</div>
    <div class="g-nm"><span>${esc(name)}</span></div>${m.annotation ? '<i class="g-note">✎</i>' : ''}
  </div>`;
}

function catPanel(cat) {
  const sys = CAT_NAMES[cat.name];
  const items = cat.mods || [];
  return `<section class="g-cat${cat.optional ? ' opt' : ''}">
    <h3><b>${esc(sys || cat.name || 'Без названия')}</b>${cat.description ? `<span>${esc(cat.description)}</span>` : ''}${cat.optional ? '<em>Необязательно</em>' : ''}</h3>
    <div class="g-items">${items.length ? items.map(itemTile).join('') : '<span class="muted">пусто</span>'}</div>
  </section>`;
}

const BOLT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1 3.5 9h4l-1 6 6-8h-4z" fill="currentColor"/></svg>';
const PT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 14.5 8 8 14.5 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.6"/></svg>';

// В API у части сборок после 16 шагов идёт «хвост» с повторами (история правок).
// Проигрываем шаги как игра: умение открывается один раз, улучшается максимум трижды; лишнее отбрасываем.
// Также отбрасываем умения чужих героев и старые ID (бывает, когда прокачку копировали с другого героя).
function cleanAbilityOrder(raw, allowed) {
  const st = new Map(); const out = [];
  for (const c of raw || []) {
    const id = c.ability_id >>> 0;
    if (allowed && allowed.size && !allowed.has(id)) continue;
    const a = st.get(id) || { open: false, lvl: 0 };
    if (c.currency_type === 2) { if (a.open) continue; a.open = true; }
    else { if (!a.open || a.lvl >= 3 || c.delta >= 0) continue; a.lvl++; }
    st.set(id, a); out.push(c);
  }
  return out;
}

function abilityGrid(b) {
  const h = heroById[b.hero_id];
  const own = new Set(((h && h.abilities) || []).filter((a) => a.id).map((a) => a.id >>> 0));
  const ch = cleanAbilityOrder(b.details && b.details.ability_order && b.details.ability_order.currency_changes, own);
  if (!ch.length) return '';
  const abs = ((h && h.abilities) || []).filter((a) => a.id);
  const ids = abs.map((a) => a.id >>> 0);
  for (const c of ch) { const id = c.ability_id >>> 0; if (!ids.includes(id)) { ids.push(id); abs.push(abilityById[id] || { id, name: '#' + id }); } }
  const n = ch.length;
  const cols = `grid-template-columns: 38px repeat(${n}, minmax(30px, 1fr))`;
  return `<section class="g-abil">
    <h3>Порядок улучшения умений</h3>
    <div class="g-abil-scroll"><div class="g-abil-grid">
      ${abs.map((a) => `<div class="g-ab-row" style="${cols}">
        <div class="g-ab-ic" title="${esc(a.name)}">${a.icon ? `<img src="${esc(icon(a.icon))}" alt="${esc(a.name)}">` : ''}</div>
        ${ch.map((c, i) => ((c.ability_id >>> 0) === (a.id >>> 0)
          ? `<div class="g-ab-cell"><span class="g-pt${c.currency_type === 2 ? ' unlock' : ''}" title="${i + 1}. ${esc(a.name)}: ${c.currency_type === 2 ? 'открыть' : 'улучшение за ' + -c.delta}">${c.currency_type === 2 ? BOLT : PT + '<b>' + -c.delta + '</b>'}</span></div>`
          : '<div class="g-ab-cell"></div>')).join('')}
      </div>`).join('')}
    </div></div>
  </section>`;
}

const fullDate = (t) => {
  if (!t) return '—';
  const s = new Date(t * 1000).toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(' г.', '').replace(' в ', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function statsBlock(c) {
  const [vcls, vtxt] = verdict(c);
  return `<section class="g-stats">
    <div class="b-verdict sig ${vcls}">${vtxt}</div>
    <div class="lab-table-wrap"><table class="lab-table b-periods"><thead><tr><th>Период</th><th class="n">Матчи</th><th class="n">Игроки</th><th class="n">Винрейт</th></tr></thead>
      <tbody>${c.periods.map((p) => `<tr><td>${periodName(p.days)}</td><td class="n">${fmt(p.matches)}</td><td class="n">${p.matches ? fmt(p.players) : '—'}</td><td class="n wr">${p.matches ? pct(p.wr) : '—'}</td></tr>`).join('')}</tbody></table></div>
  </section>`;
}

function buildCard(c, mode) {
  if (c.loading) return `<article class="g-build"><p class="lab-empty">ID ${c.id}: загрузка…</p>${mode === 'compare' ? `<div class="g-actions">${cmpBtn(c.id)}</div>` : ''}</article>`;
  if (c.error) return `<article class="g-build"><p class="lab-error">ID ${c.id}: ${esc(c.error)}</p>${mode === 'compare' ? `<div class="g-actions">${cmpBtn(c.id)}</div>` : ''}</article>`;
  const b = c.build, h = heroById[b.hero_id];
  const cats = (b.details && b.details.mod_categories) || [];
  return `<article class="g-build ${mode}">
    <header class="g-head">
      ${h && h.small ? `<img class="g-hero" src="${esc(icon(h.small))}" alt="${esc(h.name)}" title="${esc(h.name)}">` : ''}
      <div class="g-title">
        <h2>${esc(b.name || 'Без названия')}</h2>
        <div class="g-sub">
          <span>Версия: ${esc(b.version)}</span>
          <button class="g-id" data-copy-id="${c.id}" title="Нажми, чтобы скопировать">ID сборки: <u>${c.id}</u></button>
        </div>
        <div class="g-upd">Последнее обновление: ${esc(fullDate(b.last_updated_timestamp))}${num(b.origin_build_id) ? ` · копия ${idBtn(num(b.origin_build_id))}` : ''}</div>
      </div>
    </header>
    <div class="g-actions">
      <button class="btn btn-game" data-game="${c.id}">В игру</button>
      ${cmpBtn(c.id)}
    </div>
    ${statsBlock(c)}
    <div class="g-overview">
      <div class="g-tabbar"><span>Обзор</span></div>
      ${b.description ? `<p class="g-desc">${esc(b.description)}</p>` : ''}
      <div class="g-cats">${cats.map(catPanel).join('') || '<p class="lab-empty">В сборке нет предметов.</p>'}</div>
    </div>
    ${abilityGrid(b)}
  </article>`;
}

function gameCode(c) {
  const b = c.build;
  const cats = (b.details && b.details.mod_categories || []).map((cat) => ({
    name: cat.name, desc: cat.description || '',
    items: (cat.mods || []).map((m) => ({ id: m.ability_id, note: m.annotation || '', imbue: m.imbue_target_ability_id || 0 })),
  }));
  return encodeBuildCode({
    heroId: b.hero_id,
    name: b.name || `Build ${c.id}`,
    desc: `${b.description || ''}\n— копия сборки #${c.id} (RANDOMLOCK Lab)`.trim(),
    categories: cats,
    abilityChanges: (b.details && b.details.ability_order && b.details.ability_order.currency_changes) || [],
  });
}

let toastT;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2400);
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(msg); } catch {} ta.remove();
  }
}

// ---------- события ----------
document.addEventListener('click', (e) => {
  const modal = document.getElementById('lab-modal');
  if (modal && e.target === modal) { state.modal = null; renderModal(); return; }
  const t = e.target.closest('[data-tab],[data-hero],[data-open],[data-game],[data-cmp-add],[data-cmp-del],[data-cmp-clear],[data-copy-id],[data-close],[data-rhero],[data-rlean],[data-rwr],[data-rroll]');
  if (!t) return;
  const d = t.dataset;
  if (d.close) { state.modal = null; renderModal(); return; }
  if (d.copyId) { copy(d.copyId, `ID ${d.copyId} скопирован`); return; }
  if (d.cmpAdd) { cmpAdd(d.cmpAdd); return; }
  if (d.cmpDel) { cmpDel(d.cmpDel); return; }
  if (d.cmpClear) { state.compare = []; saveCompare(); refresh(); return; }
  if (d.tab) { state.tab = d.tab; shell(); track('lab_tab', { tab: d.tab }); return; }
  if (d.rhero !== undefined) { rnd.hero = +d.rhero || null; renderPanel(); return; }
  if (d.rlean) { rnd.lean = d.rlean; renderPanel(); return; }
  if (d.rwr) { rnd.wr = d.rwr; renderPanel(); return; }
  if (d.rroll) { rollRandomBuild(); return; }
  if (d.hero) { state.heroId = +d.hero; renderPanel(); loadHero(); track('lab_hero', { hero: heroById[state.heroId] && heroById[state.heroId].name }); return; }
  if (d.open) { state.modal = +d.open; renderModal(); track('lab_open_build', { build: d.open }); return; }
  if (d.game) {
    const c = cardFor(+d.game);
    try { copy(gameCode(c), 'Код скопирован. В игре: Поиск сборок → Создать сборку → Вставить сборку'); track('to_game', { from: 'lab', build: d.game }); } catch { toast('Не удалось собрать код сборки'); }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.modal) { state.modal = null; renderModal(); }
});
root.addEventListener('change', (e) => {
  const id = e.target.id;
  if (id === 'f-days') state.days = +e.target.value;
  else if (id === 'f-badge' || id === 'i-badge' || id === 'c-badge') state.badge = +e.target.value;
  else if (id === 'f-min') state.minMatches = +e.target.value;
  else if (id === 'f-show') { state.show = e.target.value; renderPanel(); }
  else if (id === 'f-sort') { state.sort = e.target.value; document.getElementById('hero-out').innerHTML = heroOut(); return; }
  else return;
  if (id === 'i-badge' || id === 'c-badge') { renderLists(); return; }
  if (state.heroId) loadHero();
});
root.addEventListener('submit', (e) => {
  if (e.target.id !== 'ids-form') return;
  e.preventDefault();
  state.ids = document.getElementById('ids-input').value;
  track('lab_search_ids', { count: parseIds(state.ids).length });
  syncUrl();
  renderLists();
});

// ---------- старт ----------
(async function boot() {
  initAnalytics('lab');
  try {
    D = await fetch('../data/ru.json').then((r) => r.json());
  } catch {
    root.innerHTML = '<p class="lab-error">Не удалось загрузить справочник героев и предметов.</p>';
    return;
  }
  heroById = Object.fromEntries(D.heroes.map((h) => [h.id, h]));
  itemById = Object.fromEntries(D.items.map((i) => [i.id >>> 0, i]));
  for (const h of D.heroes) for (const a of h.abilities || []) if (a.id) abilityById[a.id >>> 0] = a;
  state.compare = loadCompare();
  let q = null, cmp = null;
  try { const sp = new URL(location.href).searchParams; q = sp.get('ids'); cmp = sp.get('cmp'); } catch {}
  if (cmp) { state.compare = parseIds(cmp); saveCompare(); state.tab = 'cmp'; }
  else if (q) { state.ids = q; state.tab = 'ids'; }
  else { try { if (new URL(location.href).searchParams.get('tab') === 'rnd') state.tab = 'rnd'; } catch {} }
  shell();
})();
