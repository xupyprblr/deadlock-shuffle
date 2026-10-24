// Технический раздел «Сборки игроков» (не входит в релиз 1).
// Все данные — напрямую из Deadlock API в браузере (CORS открыт).
import { encodeBuildCode } from './buildcode.js';

const API = 'https://api.deadlock-api.com/v1';
const DAY = 86400;
const PERIODS = [7, 14, 30, 90];
// Ранги: значок = тир × 10 + подуровень (см. /v1/assets/ranks)
const RANKS = [
  [0, 'Все ранги'], [61, 'Ritualist+'], [71, 'Emissary+'], [81, 'Oracle+'], [91, 'Phantom+'], [101, 'Ascendant+'],
];
const SORTS = [['wr', 'Винрейт'], ['matches', 'Матчи'], ['delta', 'Отклонение от героя'], ['low', 'Нижняя граница WR']];
const TOP_N = 40; // для скольких сборок подгружать названия и содержимое

const root = document.getElementById('lab');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
const pct = (v, d = 1) => (v * 100).toFixed(d).replace('.', ',') + '%';
const pp = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v * 100).toFixed(1).replace('.', ',');
const day = (t) => (t ? new Date(t * 1000).toLocaleDateString('ru-RU') : '—');
const since = (days) => Math.floor(Date.now() / 1000) - days * DAY;

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
function api(path, params = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== 0) u.searchParams.set(k, v);
  const key = u.toString();
  if (!cache.has(key)) {
    cache.set(key, limited(async () => {
      const r = await fetch(key);
      if (r.status === 429) throw new Error('Слишком много запросов к API — подожди минуту и повтори.');
      if (!r.ok) throw new Error(`API ответил ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}
const getBuild = (id) => api('/builds', { build_id: id, only_latest: 'true' }).then((r) => (r && r[0] ? r[0].hero_build : null));
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
  tab: 'hero', heroId: null, days: 30, badge: 0, minMatches: 500, sort: 'wr',
  ids: '', rows: null, loading: false, error: '',
};

// ---------- рендер ----------
function shell() {
  root.innerHTML = `
    <h1 class="lab-title">Сборки <mark>игроков</mark></h1>
    <div class="seg-order lab-tabs" role="tablist">
      <button data-tab="hero" aria-pressed="${state.tab === 'hero'}">По герою</button>
      <button data-tab="ids" aria-pressed="${state.tab === 'ids'}">По ID / сравнение</button>
    </div>
    <section id="panel"></section>`;
  renderPanel();
}

function renderPanel() {
  const el = document.getElementById('panel');
  if (state.tab === 'hero') el.innerHTML = heroPanel();
  else el.innerHTML = idsPanel();
  if (state.tab === 'ids' && state.cards) renderCards();
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
      <label>Мин. матчей ${selectHtml('f-min', [[100, '100'], [500, '500'], [1000, '1 000'], [2000, '2 000'], [5000, '5 000']], state.minMatches)}</label>
      <label>Сортировка ${selectHtml('f-sort', SORTS, state.sort)}</label>
    </div>
    <div id="hero-out">${heroOut()}</div>`;
}

function heroOut() {
  if (!state.heroId) return '<p class="lab-empty">Выбери героя.</p>';
  if (state.loading) return '<p class="lab-empty">Считаю статистику…</p>';
  if (state.error) return `<p class="lab-error">${esc(state.error)}</p>`;
  if (!state.rows) return '';
  const { rows, base, total } = state.rows;
  if (!rows.length) return `<p class="lab-empty">Нет сборок с ${fmt(state.minMatches)}+ матчей за этот период и ранг. Уменьши порог.</p>`;
  const sorted = rows.slice().sort((a, b) => {
    if (state.sort === 'matches') return b.matches - a.matches;
    if (state.sort === 'delta') return (b.wr - (base?.wr || 0)) - (a.wr - (base?.wr || 0));
    if (state.sort === 'low') return b.ci[0] - a.ci[0];
    return b.wr - a.wr;
  });
  const h = heroById[state.heroId];
  return `
    <p class="lab-summary"><b>${esc(h.name)}</b>: ${base ? `винрейт героя ${pct(base.wr)} на ${fmt(base.matches)} матчах` : 'нет данных по герою'} · сборок с ${fmt(state.minMatches)}+ матчей: <b>${rows.length}</b> (${fmt(total)} матчей)</p>
    <div class="lab-table-wrap"><table class="lab-table">
      <thead><tr><th>#</th><th>Сборка</th><th class="n">Матчи</th><th class="n">Игроки</th><th class="n">WR</th><th class="n">95% интервал</th><th class="n">к герою</th><th></th></tr></thead>
      <tbody>${sorted.map((r, i) => {
        const d = base ? r.wr - base.wr : 0;
        const sig = base ? (r.ci[0] > base.wr ? 'up' : r.ci[1] < base.wr ? 'down' : 'flat') : 'flat';
        const b = r.build;
        return `<tr>
          <td class="n muted">${i + 1}</td>
          <td><div class="b-name">${b ? esc(b.name || 'Без названия') : `<span class="muted">загрузка…</span>`}</div>
              <div class="b-meta">ID ${r.id}${b ? ` · v${b.version} · обновлена ${day(b.last_updated_timestamp)}` : ''}</div></td>
          <td class="n">${fmt(r.matches)}</td>
          <td class="n">${fmt(r.players)}</td>
          <td class="n wr">${pct(r.wr)}</td>
          <td class="n muted">${pct(r.ci[0])}–${pct(r.ci[1])}</td>
          <td class="n"><span class="sig ${sig}">${base ? pp(d) : '—'}</span></td>
          <td class="n"><button class="btn btn-mini" data-open="${r.id}">Открыть</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="lab-legend"><span class="sig up">зелёный</span> — выше героя с учётом погрешности, <span class="sig down">красный</span> — ниже, <span class="sig flat">серый</span> — в пределах погрешности.</p>`;
}

async function loadHero() {
  const hid = state.heroId;
  state.loading = true; state.error = ''; state.rows = null;
  document.getElementById('hero-out').innerHTML = heroOut();
  try {
    const [stats, base] = await Promise.all([
      api(`/analytics/hero-build-stats/${hid}`, { min_unix_timestamp: since(state.days), min_average_badge: state.badge, min_matches: state.minMatches }),
      heroBase(hid, state.days, state.badge),
    ]);
    if (hid !== state.heroId) return;
    const rows = (stats || []).map((x) => ({ id: x.hero_build_id, matches: x.matches, players: x.players, wins: x.wins, wr: x.wins / x.matches, ci: wilson(x.wins, x.matches), build: null }));
    state.rows = { rows, base, total: rows.reduce((a, r) => a + r.matches, 0) };
    state.loading = false;
    document.getElementById('hero-out').innerHTML = heroOut();
    // названия — для самых популярных сборок, постепенно
    const top = rows.slice().sort((a, b) => b.matches - a.matches).slice(0, TOP_N);
    await Promise.all(top.map(async (r) => {
      try { r.build = await getBuild(r.id); } catch { /* пропускаем */ }
      if (hid === state.heroId && state.tab === 'hero') document.getElementById('hero-out').innerHTML = heroOut();
    }));
  } catch (e) {
    state.loading = false; state.error = e.message;
    document.getElementById('hero-out').innerHTML = heroOut();
  }
}

// ---------- по ID / сравнение ----------
function idsPanel() {
  return `
    <form id="ids-form" class="lab-ids">
      <label for="ids-input">ID сборок через запятую — до 6 штук для сравнения</label>
      <div class="lab-ids-row">
        <input id="ids-input" type="text" inputmode="numeric" placeholder="410706, 697756" value="${esc(state.ids)}">
        <button class="btn btn-game" type="submit">Найти</button>
      </div>
      <label>Ранг для статистики ${selectHtml('i-badge', RANKS, state.badge)}</label>
    </form>
    <div id="cards" class="lab-cards"></div>`;
}

function parseIds(s) {
  return [...new Set(String(s).split(/[^0-9]+/).filter(Boolean).map(Number).filter((n) => n > 0))].slice(0, 6);
}

async function loadIds() {
  const ids = parseIds(state.ids);
  try { const u = new URL(location.href); u.searchParams.set('ids', ids.join(',')); history.replaceState(null, '', u); } catch {}
  state.cards = ids.map((id) => ({ id, loading: true }));
  renderCards();
  await Promise.all(state.cards.map(async (c) => {
    try {
      const b = await getBuild(c.id);
      if (!b) { c.error = 'Сборка не найдена'; return; }
      c.build = b;
      const hid = b.hero_id;
      c.periods = await Promise.all(PERIODS.map(async (d) => {
        const r = await api(`/analytics/hero-build-stats/${hid}`, { hero_build_id: c.id, min_unix_timestamp: since(d), min_average_badge: state.badge });
        const x = (r || [])[0];
        return x ? { days: d, matches: x.matches, players: x.players, wr: x.wins / x.matches, ci: wilson(x.wins, x.matches) } : { days: d, matches: 0 };
      }));
      c.base = await heroBase(hid, 30, state.badge);
    } catch (e) { c.error = e.message; } finally { c.loading = false; renderCards(); }
  }));
}

function verdict(p, base) {
  if (!p || !p.matches) return ['flat', 'нет матчей за 30 дней'];
  if (!base) return ['flat', 'нет данных по герою'];
  if (p.ci[0] > base.wr) return ['up', 'выше среднего героя — уверенно'];
  if (p.ci[1] < base.wr) return ['down', 'ниже среднего героя — уверенно'];
  return ['flat', `в пределах погрешности (±${(((p.ci[1] - p.ci[0]) / 2) * 100).toFixed(1).replace('.', ',')} п.п.)`];
}

function itemChip(m) {
  const it = itemById[m.ability_id >>> 0];
  const name = it ? it.name : `#${m.ability_id}`;
  return `<span class="chip-item ${it ? it.cat : ''}" title="${esc(name)}${m.annotation ? ' — ' + esc(m.annotation) : ''}">${it && it.icon ? `<img src="${esc(icon(it.icon))}" alt="" width="34" height="34" loading="lazy">` : ''}<span>${esc(name)}${m.annotation ? ' <i>✎</i>' : ''}</span></span>`;
}

const CAT_NAMES = { '#Citadel_HeroBuilds_EarlyGame': 'Ранний этап', '#Citadel_HeroBuilds_MidGame': 'Середина матча', '#Citadel_HeroBuilds_LateGame': 'Поздний этап', '#Citadel_HeroBuilds_Early': 'Ранний этап', '#Citadel_HeroBuilds_Mid': 'Середина', '#Citadel_HeroBuilds_Late': 'Поздний этап', '#Citadel_HeroBuilds_Lane': 'Линия' };

function abilityStrip(b) {
  const ch = b.details && b.details.ability_order && b.details.ability_order.currency_changes;
  if (!ch || !ch.length) return '';
  return `<div class="ab-strip">${ch.map((c, i) => {
    const a = abilityById[c.ability_id >>> 0];
    const lab = c.currency_type === 2 ? '◆' : String(-c.delta);
    return `<span class="ab-step ${c.currency_type === 2 ? 'open' : ''}" title="${i + 1}. ${esc(a ? a.name : c.ability_id)}">${a && a.icon ? `<img src="${esc(icon(a.icon))}" alt="" width="22" height="22">` : ''}<b>${lab}</b></span>`;
  }).join('')}</div>`;
}

function renderCards() {
  const box = document.getElementById('cards');
  if (!box || !state.cards) return;
  if (!state.cards.length) { box.innerHTML = '<p class="lab-empty">Введи хотя бы один ID.</p>'; return; }
  box.innerHTML = state.cards.map((c, idx) => {
    if (c.loading) return `<article class="b-card"><p class="lab-empty">ID ${c.id}: загрузка…</p></article>`;
    if (c.error) return `<article class="b-card"><p class="lab-error">ID ${c.id}: ${esc(c.error)}</p></article>`;
    const b = c.build, h = heroById[b.hero_id];
    const p30 = c.periods.find((p) => p.days === 30);
    const [vcls, vtxt] = verdict(p30, c.base);
    return `<article class="b-card">
      <header class="b-head">
        ${h && h.small ? `<img class="b-hero" src="${esc(icon(h.small))}" alt="" width="52" height="52">` : ''}
        <div><h2>${esc(b.name || 'Без названия')}</h2>
        <div class="b-meta">ID ${c.id} · ${esc(h ? h.name : 'герой ' + b.hero_id)} · v${b.version} · опубликована ${day(b.publish_timestamp)}, обновлена ${day(b.last_updated_timestamp)}${b.origin_build_id ? ` · копия #${b.origin_build_id}` : ''}</div></div>
      </header>
      <div class="b-verdict sig ${vcls}">30 дней: ${p30 && p30.matches ? `${pct(p30.wr)} на ${fmt(p30.matches)} матчах` : 'нет матчей'} — ${vtxt}${c.base ? ` · герой ${pct(c.base.wr)}` : ''}</div>
      <div class="lab-table-wrap"><table class="lab-table b-periods"><thead><tr><th>Период</th><th class="n">Матчи</th><th class="n">Игроки</th><th class="n">WR</th><th class="n">95% интервал</th></tr></thead>
        <tbody>${c.periods.map((p) => `<tr><td>${p.days} дн.</td><td class="n">${fmt(p.matches)}</td><td class="n">${p.matches ? fmt(p.players) : '—'}</td><td class="n wr">${p.matches ? pct(p.wr) : '—'}</td><td class="n muted">${p.matches ? `${pct(p.ci[0])}–${pct(p.ci[1])}` : '—'}</td></tr>`).join('')}</tbody></table></div>
      ${(b.details && b.details.mod_categories || []).map((cat) => `
        <div class="b-cat"><h3>${esc(CAT_NAMES[cat.name] || cat.name)}${cat.optional ? ' <small>необязательно</small>' : ''}</h3>
        <div class="b-items">${(cat.mods || []).map(itemChip).join('')}</div></div>`).join('')}
      ${abilityStrip(b)}
      ${b.description ? `<details class="b-desc"><summary>Описание автора</summary><p>${esc(b.description)}</p></details>` : ''}
      <div class="b-actions"><button class="btn btn-game" data-game="${idx}">В игру</button></div>
    </article>`;
  }).join('');
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
    desc: `${b.description || ''}\n— копия сборки #${c.id} (Deadlock Shuffle Lab)`.trim(),
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
root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab],[data-hero],[data-open],[data-game]');
  if (!t) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; shell(); if (state.tab === 'ids' && state.ids && !state.cards) loadIds(); return; }
  if (t.dataset.hero) { state.heroId = +t.dataset.hero; renderPanel(); loadHero(); return; }
  if (t.dataset.open) {
    const cur = parseIds(state.ids);
    state.ids = [...new Set([...cur, +t.dataset.open])].slice(-6).join(', ');
    state.tab = 'ids'; shell(); loadIds(); return;
  }
  if (t.dataset.game) {
    const c = state.cards[+t.dataset.game];
    try { copy(gameCode(c), 'Код скопирован. В игре: Сборки → Создать → Вставить'); } catch { toast('Не удалось собрать код сборки'); }
  }
});
root.addEventListener('change', (e) => {
  const id = e.target.id;
  if (id === 'f-days') state.days = +e.target.value;
  else if (id === 'f-badge' || id === 'i-badge') state.badge = +e.target.value;
  else if (id === 'f-min') state.minMatches = +e.target.value;
  else if (id === 'f-sort') { state.sort = e.target.value; document.getElementById('hero-out').innerHTML = heroOut(); return; }
  else return;
  if (id === 'i-badge') { if (state.ids) loadIds(); return; }
  if (state.heroId) loadHero();
});
root.addEventListener('submit', (e) => {
  if (e.target.id !== 'ids-form') return;
  e.preventDefault();
  state.ids = document.getElementById('ids-input').value;
  loadIds();
});

// ---------- старт ----------
(async function boot() {
  try {
    D = await fetch('../data/ru.json').then((r) => r.json());
  } catch {
    root.innerHTML = '<p class="lab-error">Не удалось загрузить справочник героев и предметов.</p>';
    return;
  }
  heroById = Object.fromEntries(D.heroes.map((h) => [h.id, h]));
  itemById = Object.fromEntries(D.items.map((i) => [i.id >>> 0, i]));
  for (const h of D.heroes) for (const a of h.abilities || []) if (a.id) abilityById[a.id >>> 0] = a;
  let q = null;
  try { q = new URL(location.href).searchParams.get('ids'); } catch {}
  if (q) { state.ids = q; state.tab = 'ids'; }
  shell();
  if (q) loadIds();
})();
