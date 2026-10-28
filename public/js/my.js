// «Мои рандомы» (фаза 2.0, разведка): журнал забранных сборок + сопоставление с матчами игрока.
// Всё в браузере: журнал и SteamID в localStorage, матчи — напрямую из Deadlock API.
// На этапе 2.1 это переедет на сервер (вход через Steam, журнал по часам сервера, фоновый сборщик).
import { NS, markDev } from './env.js';
import { loadJournal, removeEntry, clearJournal } from './journal.js';
import { parseSteamId, toSteam64, playerEvents, compareBuild, candidateMatches, pickPlayer, isWin, RANDOM_MIN, FULL } from './match.js';

const API = 'https://api.deadlock-api.com/v1';
const K = { steam: NS + 'ds:steam', cache: NS + 'ds:mcache', diag: NS + 'ds:mdiag' };
const BULK = 20; // матчей в одном запросе пачкой (лимит API — 30 запросов/мин с IP)
const SINGLE_MAX = 5; // одиночных запросов за проверку (ответ ~1 МБ на матч)

const root = document.getElementById('my');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : 0);
const pct = (v) => Math.round(v * 100) + '%';
const when = (ms) => new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hours = (ms) => (ms / 3600e3 < 1 ? Math.round(ms / 60e3) + ' мин' : (ms / 3600e3).toFixed(1).replace('.', ',') + ' ч');
const ORDER = { pseudo: 'Псевдо-рандом', chaos: 'Полный рандом', phases: 'По фазам' };
const INVEST = { chaos: 'Хаос', balanced: 'Поровну', mono: 'Все в один' };
const VERDICT = { meta: 'Мета-затар', solid: 'Рабочая сборка', risky: 'Рискованно', challenge: 'Челлендж', troll: 'Чистый троллинг' };

const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const st = {
  data: null, itemsById: null, bySlug: null, heroes: null,
  account: get(K.steam, null),
  nick: null,
  history: null, // матчи игрока (из истории)
  cache: get(K.cache, {}), // match_id → { b: buildId, e: [[t, id, up, sold], …] } — только события этого игрока
  diag: get(K.diag, {}), // match_id → { miss: первый раз не нашли (мс), seen: первый раз нашли (мс), src }
  busy: false,
  status: '', statusErr: false,
};

async function api(path) {
  for (let i = 1; ; i++) {
    const r = await fetch(API + path);
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if ((r.status === 429 || r.status === 503) && i < 3) {
      const ra = parseFloat(r.headers.get('retry-after'));
      const wait = Math.min(60, Number.isFinite(ra) && ra > 0 ? ra : 10 * i);
      status(`Лимит API — жду ${Math.ceil(wait)} с…`);
      await new Promise((res) => setTimeout(res, wait * 1000));
      continue;
    }
    throw new Error(r.status === 429 ? 'Слишком много запросов к API — подожди минуту.' : `API ответил ${r.status}`);
  }
}

function status(msg, err = false) {
  st.status = msg; st.statusErr = err;
  const el = document.getElementById('my-status');
  if (el) { el.textContent = msg; el.className = 'my-status' + (err ? ' err' : ''); }
}

// ---------- сохранение событий матча (компактно, только этот игрок) ----------
function remember(matchId, player, src) {
  st.cache[matchId] = { b: player.buildId, e: player.events.map((x) => [x.game_time_s, x.item_id >>> 0, x.upgrade_id >>> 0, x.sold_time_s || 0]), src };
  const ids = Object.keys(st.cache);
  if (ids.length > 150) for (const id of ids.sort((a, b) => a - b).slice(0, ids.length - 150)) delete st.cache[id];
  set(K.cache, st.cache);
  const d = st.diag[matchId] || {};
  if (!d.seen) { d.seen = Date.now(); d.src = src; st.diag[matchId] = d; set(K.diag, st.diag); }
}
function noteMiss(matchId) {
  const d = st.diag[matchId] || {};
  if (!d.seen && !d.miss) { d.miss = Date.now(); st.diag[matchId] = d; set(K.diag, st.diag); }
}
const cachedEvents = (c) => c.e.map(([t, id, up, sold]) => ({ game_time_s: t, item_id: id, upgrade_id: up, sold_time_s: sold }));

// ---------- проверка матчей ----------
async function check() {
  if (st.busy || !st.account) return;
  const journal = loadJournal();
  if (!journal.length) { status('Журнал пуст: забери сборку кнопкой «В игру» на главной.', true); return; }
  st.busy = true; render();
  try {
    status('Загружаю историю матчей…');
    const hist = await api(`/players/${st.account}/match-history`);
    st.history = Array.isArray(hist) ? hist : [];
    if (!st.nick) api(`/players/steam?account_ids=${st.account}`).then((p) => { const x = Array.isArray(p) && p[0]; if (x) { st.nick = x.personaname || null; render(); } }).catch(() => {});
    const cand = candidateMatches(journal, st.history);
    const need = cand.map((c) => c.match.match_id).filter((id) => !st.cache[id]);
    let got = 0;
    for (let i = 0; i < need.length; i += BULK) {
      const ids = need.slice(i, i + BULK);
      status(`Ищу покупки в ${ids.length} матч(ах)…`);
      const rows = await api(`/matches/metadata?match_ids=${ids.join(',')}&account_ids=${st.account}&only_filtered_players=true&include_player_items=true&include_player_info=true&limit=${BULK}`);
      for (const m of rows || []) { const p = pickPlayer(m, st.account); if (p) { remember(m.match_id, p, 'bulk'); got++; } }
    }
    // чего нет в базе пачкой — по одному (берётся из кэша/S3 API, если матч уже скачан)
    const rest = need.filter((id) => !st.cache[id]);
    let single = 0;
    for (const id of rest.slice(0, SINGLE_MAX)) {
      status(`Матч ${id}: запрашиваю по одному…`);
      try {
        const m = await api(`/matches/${id}/metadata`);
        const p = m && pickPlayer(m, st.account);
        if (p) { remember(id, p, 'single'); single++; } else noteMiss(id);
      } catch { noteMiss(id); }
    }
    for (const id of rest.slice(SINGLE_MAX)) noteMiss(id);
    const left = need.length - got - single;
    status(`Готово: матчей на героях из журнала — ${cand.length}, новых с покупками — ${got + single}${single ? ` (по одному: ${single})` : ''}${left > 0 ? `, ещё не обработаны — ${left}` : ''}.`);
  } catch (e) {
    status(e.message || 'Не удалось загрузить данные', true);
  } finally { st.busy = false; render(); }
}

// ---------- отрисовка ----------
function itemTiles(entry, cmp) {
  const got = new Set(cmp ? cmp.hitIds : []);
  return `<div class="my-items">${entry.items.map((id, n) => {
    const it = st.itemsById.get(id >>> 0);
    const cls = [it ? it.cat : '', cmp ? (got.has(id >>> 0) ? 'got' : 'miss') : ''].join(' ');
    return `<div class="my-it ${cls}" title="${esc(it ? it.name : 'предмет ' + num(id))}"><b>${n + 1}</b>${it ? `<img src="${esc(it.icon)}" alt="" loading="lazy">` : ''}</div>`;
  }).join('')}</div>`;
}

function matchRow(m, entry, best) {
  const c = st.cache[m.match_id];
  const ago = Date.now() - (m.start_time + (m.match_duration_s || 0)) * 1000;
  const head = `<span class="my-res ${isWin(m) ? 'win' : 'loss'}">${isWin(m) ? 'Победа' : 'Поражение'}</span>
    <span>${when(m.start_time * 1000)}</span>
    <span class="muted">${num(m.player_kills)}/${num(m.player_deaths)}/${num(m.player_assists)} · ${Math.round(num(m.match_duration_s) / 60)} мин · через ${hours(m.start_time * 1000 - entry.at)} после забора</span>`;
  if (!c) return `<div class="my-match"><div class="my-mrow">${head}</div><p class="my-wait">Покупок в API пока нет (матч закончился ${hours(ago)} назад) — проверь позже.</p></div>`;
  const hero = st.heroes.get(m.hero_id);
  const ev = playerEvents(cachedEvents(c), hero, st.itemsById);
  const r = compareBuild(entry, ev, st.itemsById, st.bySlug);
  const d = st.diag[m.match_id] || {};
  const delay = d.seen ? `найден через ≤ ${hours(d.seen - (m.start_time + num(m.match_duration_s)) * 1000)} после конца${d.src === 'single' ? ', по одному' : ''}` : '';
  return `<div class="my-match">
    <div class="my-mrow">${head}
      ${r.collected ? '<span class="my-badge full">Затар собран</span>' : r.isRandom ? '<span class="my-badge rand">На рандоме</span>' : '<span class="my-badge">Не на рандоме</span>'}
    </div>
    <div class="my-mrow"><span>Предметы: <b>${r.hit}/${r.total}</b></span>
      <span>Порядок: <b>${r.order == null ? '—' : pct(r.order)}</b></span>
      <span>Прокачка: <b>${r.skills.same}/${Math.min(r.skills.planned, r.skills.played)}</b> шагов совпало, начало — ${r.skills.prefix}</span>
      ${r.extraIds.length ? `<span class="muted">Лишние покупки: ${r.extraIds.map((id) => esc((st.itemsById.get(id) || {}).name || id)).join(', ')}</span>` : ''}
    </div>
    <p class="my-diag">Сборка в начале матча (hero_build_id): ${c.b ? num(c.b) : 'нет данных'}${delay ? ' · ' + delay : ''}${best ? '' : ' · не лучший матч по этой сборке'}</p>
    ${best ? itemTiles(entry, r) : ''}
  </div>`;
}

function entryCard(entry, matches) {
  const sc = entry.score;
  // лучший матч сборки подсвечиваем плитками (больше всего совпавших предметов)
  let bestId = null, bestHit = -1;
  for (const m of matches) {
    const c = st.cache[m.match_id];
    if (!c) continue;
    const r = compareBuild(entry, playerEvents(cachedEvents(c), st.heroes.get(m.hero_id), st.itemsById), st.itemsById, st.bySlug);
    if (r.hit > bestHit) { bestHit = r.hit; bestId = m.match_id; }
  }
  return `<article class="my-entry">
    <div class="my-head"><span class="my-hero">${esc(entry.hero.name)}</span>
      <span class="my-meta">забрана ${when(entry.at)} · ${esc(ORDER[entry.order] || entry.order || '—')} · ${esc(INVEST[entry.invest] || entry.invest || '—')}${sc ? ` · ${esc(VERDICT[sc.verdict] || sc.verdict)}, ≈${String(sc.chance).replace('.', ',')}%` : ''}</span>
      <button class="my-del" data-act="del" data-id="${esc(entry.id)}">убрать</button>
    </div>
    ${bestId ? '' : itemTiles(entry, null)}
    <div class="my-matches">${matches.length
      ? matches.map((m) => matchRow(m, entry, m.match_id === bestId)).join('')
      : `<p class="my-none">${st.history ? 'Матчей на этом герое после забора пока нет.' : 'Нажми «Проверить матчи».'}</p>`}</div>
  </article>`;
}

function render() {
  if (!st.data) return;
  const journal = loadJournal();
  const cand = st.history ? candidateMatches(journal, st.history) : [];
  const byEntry = new Map();
  for (const c of cand) { if (!byEntry.has(c.entry.id)) byEntry.set(c.entry.id, []); byEntry.get(c.entry.id).push(c.match); }
  const s64 = st.account ? toSteam64(st.account) : '';
  root.innerHTML = `
    <h1 class="lab-title">Мои рандомы</h1>
    <p class="my-lead">Каждая сборка, забранная кнопкой «В игру», попадает в журнал. Здесь видно, в каких матчах ты её сыграл, сколько предметов из 12 купил, в каком порядке и как прокачал умения. Пока это проверка идеи: журнал живёт только в этом браузере, а матч появляется в данных через несколько часов.</p>
    <section class="my-box">
      <h2>Твой Steam</h2>
      <form class="my-steam" id="steam-form">
        <label>Ссылка на профиль Steam или SteamID
          <input id="steam-in" name="steam" autocomplete="off" spellcheck="false" placeholder="https://steamcommunity.com/profiles/7656119…" value="${esc(s64)}">
        </label>
        <button class="btn" type="submit"><span>Сохранить</span></button>
      </form>
      ${st.account ? `<p class="my-who">Аккаунт: <b>${esc(st.nick || '…')}</b> · account_id ${num(st.account)} · <a href="https://steamcommunity.com/profiles/${esc(s64)}" target="_blank" rel="noopener">профиль</a></p>`
        : '<p class="my-who">Ссылка вида steamcommunity.com/id/ник не подойдёт — нужен номер: открой профиль в Steam → «Скопировать адрес страницы» в режиме с цифрами, или возьми SteamID на steamid.io.</p>'}
      <div class="my-actions">
        <button class="btn" data-act="check" ${!st.account || st.busy ? 'disabled' : ''}><span>${st.busy ? 'Проверяю…' : 'Проверить матчи'}</span></button>
        <button class="btn" data-act="report" ${journal.length ? '' : 'disabled'}><span>Скопировать отчёт</span></button>
      </div>
      <p id="my-status" class="my-status${st.statusErr ? ' err' : ''}">${esc(st.status)}</p>
    </section>
    <section class="my-list">
      ${journal.length ? journal.map((e) => entryCard(e, byEntry.get(e.id) || [])).join('') : '<p class="my-none">Журнал пуст. Открой рандомайзер, крутани и нажми «В игру» — сборка появится здесь.</p>'}
    </section>
    ${journal.length ? '<p><button class="my-del" data-act="clear">Очистить журнал</button></p>' : ''}`;
}

// Отчёт разведки: что нашли, когда, с какой точностью — чтобы вставить в чат разработки
function report() {
  const journal = loadJournal();
  const cand = st.history ? candidateMatches(journal, st.history) : [];
  const out = {
    at: new Date().toISOString(), account: st.account, journal: journal.length,
    history: st.history ? st.history.length : null,
    matches: cand.map(({ match: m, entry }) => {
      const c = st.cache[m.match_id];
      const d = st.diag[m.match_id] || {};
      const end = (m.start_time + num(m.match_duration_s)) * 1000;
      const row = { match: m.match_id, hero: entry.hero.name, startedAfterTakeMin: Math.round((m.start_time * 1000 - entry.at) / 60e3), win: isWin(m), found: !!c, src: d.src || null,
        foundAfterEndH: d.seen ? +((d.seen - end) / 3600e3).toFixed(2) : null, missingAfterEndH: !c && d.miss ? +((d.miss - end) / 3600e3).toFixed(2) : null };
      if (c) {
        const ev = playerEvents(cachedEvents(c), st.heroes.get(m.hero_id), st.itemsById);
        const r = compareBuild(entry, ev, st.itemsById, st.bySlug);
        Object.assign(row, { buildId: c.b, items: `${r.hit}/${r.total}`, order: r.order == null ? null : +r.order.toFixed(2), skills: r.skills, unknownEvents: ev.unknown,
          missing: r.missIds.map((id) => (st.itemsById.get(id) || {}).name || id), extra: r.extraIds.map((id) => (st.itemsById.get(id) || {}).name || id) });
      }
      return row;
    }),
  };
  copy(JSON.stringify(out, null, 1), 'Отчёт скопирован — вставь его в чат');
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); status(msg); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); status(msg); } catch { status('Не удалось скопировать', true); }
    ta.remove();
  }
}

root.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'check') check();
  else if (a === 'report') report();
  else if (a === 'del') { removeEntry(b.dataset.id); render(); }
  else if (a === 'clear') { if (confirm('Удалить все записи журнала в этом браузере?')) { clearJournal(); render(); } }
});
root.addEventListener('submit', (ev) => {
  if (ev.target.id !== 'steam-form') return;
  ev.preventDefault();
  const id = parseSteamId(document.getElementById('steam-in').value);
  if (!id) { status('Не понял SteamID. Нужна ссылка вида steamcommunity.com/profiles/7656… или число.', true); return; }
  if (id !== st.account) { st.account = id; st.nick = null; st.history = null; set(K.steam, id); }
  status('Сохранено.');
  render();
  check();
});

async function boot() {
  markDev();
  try {
    const r = await fetch('data/ru.json');
    st.data = await r.json();
  } catch { root.innerHTML = '<p class="lab-error">Не удалось загрузить данные. Обнови страницу.</p>'; return; }
  st.itemsById = new Map(st.data.items.map((i) => [i.id >>> 0, i]));
  st.bySlug = new Map(st.data.items.map((i) => [i.slug, i]));
  st.heroes = new Map(st.data.heroes.map((h) => [h.id, h]));
  render();
  if (st.account && loadJournal().length) check();
}
boot();
