// Админка: статистика своего счётчика (Cloudflare Worker, папка stats/). Только RU, нигде не ссылается.
// Ключ (ADMIN_TOKEN Worker) вводится один раз и хранится в этом браузере.
import { STATS_URL } from './analytics.js';
import { NS, IS_DEV, markDev } from './env.js';

const root = document.getElementById('admin');
const KEY = NS + 'admin:token';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => (Number.isFinite(+n) ? Math.round(+n).toLocaleString('ru-RU') : '0');
const avgNum = (n) => (n > 0 && n < 10 ? (Math.round(n * 10) / 10).toLocaleString('ru-RU') : num(n)); // среднее: до 10 — с десятыми
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + '%' : '—');

const st = { token: store.get(KEY) || '', env: IS_DEV ? 'dev' : 'main', days: 7, data: null, err: '', busy: false };
const PERIODS = [[1, 'Сегодня'], [7, '7 дней'], [30, '30 дней'], [90, '90 дней']];

// подписи значений
const RAR = [['trash', 'Trash', '#8a8580'], ['common', 'Common', '#f7e9d5'], ['unique', 'Unique', '#97da79'], ['rare', 'Rare', '#5aa2ff'], ['ultra', 'Ultra Rare', '#b77dff'], ['legendary', 'Legendary', '#ffc83d'], ['egg', 'Пасхалка (лого)', '#2be38a']];
const ORDER = { pseudo: 'Псевдо-рандом', curve: 'Баланс рандом', chaos: 'Полный рандом' };
const INVEST = { chaos: 'Хаос', balanced: 'Поровну', mono: 'Все в один' };
const SOCIAL = { yt: 'YouTube', tw: 'Twitch', tg: 'Telegram' };
const MODE = { slot: 'Автомат', box: 'Лутбокс' };
const VIA = { code: 'Кнопка «В игру»', id: 'Скопировали ID' };
const VERDICT = [['meta', 'Мета-затар'], ['solid', 'Рабочая сборка'], ['risky', 'Рискованно'], ['challenge', 'Челлендж'], ['troll', 'Чистый троллинг']];
const PAGE = { roulette: 'Рандом (главная)', slots: 'Казино билдов', lab: 'Лаборатория' };
const RAND_FROM = ['button', 'howto', 'team']; // «в игру» из раздела «Рандом»

// ---------- данные ----------
async function load() {
  if (!STATS_URL) { st.err = 'Счётчик ещё не развёрнут: адрес STATS_URL в js/analytics.js пустой (см. stats/README.md).'; paint(); return; }
  if (!st.token) { paint(); return; }
  st.busy = true; st.err = ''; paint();
  try {
    const r = await fetch(`${STATS_URL}/stats?env=${st.env}&days=${st.days}`, { headers: { Authorization: 'Bearer ' + st.token }, cache: 'no-store' });
    if (r.status === 401) { st.err = 'Неверный ключ.'; st.token = ''; store.set(KEY, ''); st.data = null; }
    else if (!r.ok) st.err = `Счётчик ответил ошибкой ${r.status}.`;
    else st.data = await r.json();
  } catch { st.err = 'Нет связи со счётчиком.'; }
  st.busy = false; paint();
}

function model(d) {
  const tot = (ev) => d.daily.reduce((a, x) => a + (x.ev === ev ? x.n : 0), 0);
  const dim = (ev, k, v) => d.dims.reduce((a, x) => a + (x.ev === ev && x.dim === k && x.val === String(v) ? x.n : 0), 0);
  const list = (ev, k) => d.dims.filter((x) => x.ev === ev && x.dim === k).map((x) => ({ val: x.val, n: x.n })).sort((a, b) => b.n - a.n);
  // составной разрез «a|b»: оставить строки, где a подходит, и сложить по b
  const split = (ev, k, keep) => {
    const m = new Map();
    for (const x of d.dims) if (x.ev === ev && x.dim === k) { const [a, b] = x.val.split('|'); if (keep(a)) m.set(b, (m.get(b) || 0) + x.n); }
    return [...m].map(([val, n]) => ({ val, n })).sort((p, q) => q.n - p.n);
  };
  const sections = [
    { name: 'Рандом · соло', spins: dim('roll', 'team', 0), game: dim('to_game', 'from', 'button') + dim('to_game', 'from', 'howto') },
    { name: 'Рандом · команда', spins: dim('roll', 'team', 1), game: dim('to_game', 'from', 'team') },
    { name: 'Казино · автомат', spins: dim('slots_spin', 'mode', 'slot'), game: dim('to_game', 'mode', 'slot') },
    { name: 'Казино · лутбокс', spins: dim('slots_spin', 'mode', 'box'), game: dim('to_game', 'mode', 'box') },
    { name: 'Лаборатория', spins: tot('lab_random'), game: dim('to_game', 'from', 'lab') },
  ];
  // по дням: все крутки и все «в игру»
  const days = [];
  const end = new Date(d.to + 'T00:00:00Z');
  for (let i = st.days - 1; i >= 0; i--) days.push(new Date(end - i * 86400e3).toISOString().slice(0, 10));
  const perDay = (evs) => days.map((day) => ({ day, n: d.daily.reduce((a, x) => a + (x.day === day && evs.includes(x.ev) ? x.n : 0), 0) }));
  return {
    tot, dim, list, split, sections, days,
    visitorsByDay: perDay(['visitor']),
    spinsByDay: perDay(['roll', 'slots_spin', 'lab_random']),
    gameByDay: perDay(['to_game']),
  };
}

// ---------- графики: один цвет, подписи и числа рядом, подсказка при наведении ----------
function bars(rows, { total, empty = 'пока пусто' } = {}) {
  rows = rows.filter((r) => r.n > 0);
  if (!rows.length) return `<p class="ad-empty">${empty}</p>`;
  const max = Math.max(...rows.map((r) => r.n));
  const sum = total ?? rows.reduce((a, r) => a + r.n, 0);
  return `<ul class="ad-bars">${rows.map((r) => `<li data-tip="${esc(r.label)}: ${num(r.n)} (${pct(r.n, sum)})">
    <span class="ad-lbl">${r.chip ? `<i class="ad-chip" style="--c:${r.chip}"></i>` : ''}${esc(r.label)}</span>
    <span class="ad-track"><i style="width:${Math.max(1.5, (r.n / max) * 100).toFixed(1)}%"></i></span>
    <b class="ad-val">${num(r.n)}</b><small class="ad-pct">${pct(r.n, sum)}</small></li>`).join('')}</ul>`;
}
const fmtDay = (day) => { const [, m, dd] = day.split('-'); return `${+dd}.${m}`; };
function columns(series, title, { avg = false } = {}) {
  const max = Math.max(1, ...series.map((x) => x.n));
  const sum = series.reduce((a, x) => a + x.n, 0);
  // уникальные посетители между днями не складываются — для них показываем среднее за день
  const note = avg ? `в среднем ${avgNum(sum / series.length)} в день · макс. ${num(max)}` : `${num(sum)} за период · макс. ${num(max)} в день`;
  return `<figure class="ad-cols">
    <figcaption><b>${esc(title)}</b><span>${note}</span></figcaption>
    <div class="ad-cols-plot" style="--n:${series.length}">${series.map((x) => `<div class="ad-col" data-tip="${fmtDay(x.day)}: ${num(x.n)}"><i style="height:${x.n ? Math.max(2, (x.n / max) * 100).toFixed(1) : 0}%"></i></div>`).join('')}</div>
    <div class="ad-cols-axis"><span>${fmtDay(series[0].day)}</span><span>${fmtDay(series[series.length - 1].day)}</span></div>
  </figure>`;
}
function tiles(items) {
  return `<div class="ad-tiles">${items.map(([label, value, sub]) => `<div class="ad-tile"><span>${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`).join('')}</div>`;
}
const labeled = (rows, names) => rows.map((r) => ({ label: names[r.val] || r.val, n: r.n }));
const top = (rows, k = 15) => rows.slice(0, k).map((r) => ({ label: r.val, n: r.n }));

// ---------- страница ----------
function seg(attr, items, val) {
  return `<div class="seg-order ad-seg" role="radiogroup">${items.map(([v, l]) => `<button data-${attr}="${v}" aria-pressed="${String(v) === String(val)}">${l}</button>`).join('')}</div>`;
}
function paint() {
  if (!st.token) {
    root.innerHTML = `<section class="ad-login">
      <h1>Статистика</h1>
      <p class="muted">Счётчик сайта: крутки, что выпадало, «в игру», ссылки и соцсети. Без cookies и личных данных.</p>
      <form id="login"><input type="password" name="t" placeholder="Ключ админки" autocomplete="current-password" required><button class="btn btn-game">Войти</button></form>
      ${st.err ? `<p class="ad-err">${esc(st.err)}</p>` : ''}
    </section>`;
    return;
  }
  const d = st.data;
  const head = `<div class="ad-head">
    <h1>Статистика</h1>
    <div class="ad-ctl">${seg('env', [['main', 'Сайт'], ['dev', 'Dev']], st.env)}${seg('days', PERIODS, st.days)}<button class="btn btn-mini" data-logout="1">Выйти</button></div>
    ${d ? `<p class="muted">${st.env === 'main' ? 'randomlock.com' : 'randomlock.com/dev'} · ${fmtDay(d.from)}–${fmtDay(d.to)} (по Москве)${st.busy ? ' · обновляю…' : ''}</p>` : ''}
    ${st.err ? `<p class="ad-err">${esc(st.err)}</p>` : ''}
  </div>`;
  if (!d) { root.innerHTML = head + (st.busy ? '<div class="loading">Загружаю…</div>' : ''); return; }
  const m = model(d);
  const spins = m.sections.reduce((a, s) => a + s.spins, 0), game = m.sections.reduce((a, s) => a + s.game, 0);
  const shares = m.tot('share_link') + m.tot('team_link') + m.tot('slots_share');
  const vis = m.visitorsByDay, visToday = vis[vis.length - 1].n;
  const visTile = st.days === 1 ? ['Посетители сегодня', num(visToday), 'уникальные'] : ['Посетители в день', avgNum(vis.reduce((a, x) => a + x.n, 0) / vis.length), `в среднем · сегодня ${num(visToday)}`];
  root.innerHTML = head + `
    ${tiles([visTile, ['Крутки', num(spins)], ['Забрали в игру', num(game), `${pct(game, spins)} от круток`], ['Поделились ссылкой', num(shares)]])}

    <section class="ad-sec">
      <h2>Посетители</h2>
      <div class="ad-grid2">${columns(m.visitorsByDay, 'Уникальные посетители по дням', { avg: true })}
        <div><h3>Просмотры страниц <small>всего ${num(m.tot('pageview'))}</small></h3>${bars(labeled(m.list('pageview', 'page'), PAGE))}</div></div>
    </section>

    <section class="ad-sec">
      <h2>Разделы</h2>
      <div class="ad-table-wrap"><table class="ad-table">
        <thead><tr><th>Раздел</th><th>Крутки</th><th>В игру</th><th>Конверсия</th></tr></thead>
        <tbody>${m.sections.map((s) => `<tr><th>${esc(s.name)}</th><td>${num(s.spins)}</td><td>${num(s.game)}</td><td>${pct(s.game, s.spins)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="ad-grid2">${columns(m.spinsByDay, 'Крутки по дням')}${columns(m.gameByDay, '«В игру» по дням')}</div>
    </section>

    <section class="ad-sec">
      <h2>Рандомайзер</h2>
      <div class="ad-grid2">
        <div><h3>Крутки: герои <small>топ-15</small></h3>${bars(top(m.list('roll', 'hero')))}</div>
        <div><h3>Забрали в игру: герои <small>топ-15</small></h3>${bars(top(m.split('to_game', 'from+hero', (f) => RAND_FROM.includes(f))))}</div>
        <div><h3>Оценка затара</h3>${bars(VERDICT.map(([k, label]) => ({ label, n: m.dim('roll', 'verdict', k) })))}</div>
        <div><h3>Режим крутки</h3>${bars(labeled(m.list('roll', 'order'), ORDER))}
          <h3>Баланс инвеста</h3>${bars(labeled(m.list('roll', 'invest'), INVEST))}</div>
      </div>
    </section>

    <section class="ad-sec">
      <h2>Казино билдов</h2>
      <div class="ad-grid2">
        <div><h3>Редкость · автомат</h3>${bars(RAR.map(([k, label, chip]) => ({ label, chip, n: m.dim('slots_spin', 'mode+rarity', 'slot|' + k) })))}</div>
        <div><h3>Редкость · лутбокс <small>лучшая карта</small></h3>${bars(RAR.map(([k, label, chip]) => ({ label, chip, n: m.dim('slots_spin', 'mode+rarity', 'box|' + k) })))}</div>
        <div><h3>Крутки: герои <small>топ-15</small></h3>${bars(top(m.list('slots_spin', 'got')))}</div>
        <div><h3>Забрали в игру: герои <small>топ-15</small></h3>${bars(top(m.split('to_game', 'from+hero', (f) => f === 'slots')))}</div>
        <div><h3>Забрали в игру: редкость</h3>${bars(RAR.map(([k, label, chip]) => ({ label, chip, n: m.dim('to_game', 'rarity', k) })))}</div>
        <div><h3>Как забирают</h3>${bars(labeled(m.list('to_game', 'via'), VIA))}
          <h3>Размер лутбокса</h3>${bars(labeled(m.list('slots_spin', 'size'), {}).sort((a, b) => +a.label - +b.label).map((r) => ({ ...r, label: r.label + ' ' + (r.label === '1' ? 'карта' : +r.label < 5 ? 'карты' : 'карт') })))}</div>
      </div>
    </section>

    <section class="ad-sec">
      <h2>Ссылки и соцсети</h2>
      <div class="ad-grid2">
        <div><h3>Поделились ссылкой</h3>${bars([
          { label: 'Рандом · сборка', n: m.tot('share_link') },
          { label: 'Рандом · команда', n: m.tot('team_link') },
          ...labeled(m.list('slots_share', 'mode'), MODE).map((r) => ({ ...r, label: 'Казино · ' + r.label.toLowerCase() })),
        ])}
          <h3>Открыли чужую ссылку казино</h3>${bars([{ label: 'Ссылка на сборку / пати', n: m.tot('slots_shared_open') }])}</div>
        <div><h3>Переходы</h3>${bars([
          ...labeled(m.list('social', 'target'), SOCIAL),
          { label: '«Поддержать»', n: m.tot('donate') },
          { label: 'Вкладка «Казино билдов»', n: m.tot('slots_open') },
          { label: 'Лаборатория', n: m.tot('lab_open') },
        ])}</div>
      </div>
    </section>
    <p class="muted ad-note">Счётчик не использует cookies и не хранит IP: для уникальных посетителей — только суточный обезличенный отпечаток, который удаляется на следующий день; остальное — итоги по дням. Данные GA4 — отдельно, в Google Analytics.</p>`;
}

// ---------- подсказка при наведении ----------
const tip = document.createElement('div'); tip.className = 'ad-tip'; tip.hidden = true; document.body.appendChild(tip);
document.addEventListener('pointerover', (e) => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) { tip.hidden = true; return; } tip.textContent = t.dataset.tip; tip.hidden = false; });
document.addEventListener('pointermove', (e) => { if (tip.hidden) return; const w = tip.offsetWidth; tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + 'px'; tip.style.top = e.clientY + 16 + 'px'; });

// ---------- события ----------
root.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = new FormData(e.target).get('t');
  st.token = String(t || '').trim(); store.set(KEY, st.token); load();
});
root.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || st.busy) return;
  if (b.dataset.env) { st.env = b.dataset.env; load(); }
  else if (b.dataset.days) { st.days = +b.dataset.days; load(); }
  else if (b.dataset.logout) { st.token = ''; st.data = null; store.set(KEY, ''); paint(); }
});

markDev();
load();
