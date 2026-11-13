// Раздел «Казино билдов»: случайная опубликованная сборка игрока.
// Соло — слот-машина (три барабана: герой, инвест, редкость), пати 2–6 игроков — лутбокс с карточками.
// Редкость — по винрейту сборки за 30 дней: Trash … Legendary (60%+ — джекпот).
// Все данные — напрямую из Deadlock API в браузере, как в лаборатории.
import { encodeBuildCode } from './buildcode.js';
import { initAnalytics, track } from './analytics.js';
import { NS, markDev } from './env.js';
import { getLang, setLang } from './lang.js';
import { play, loop as sndLoop, loopSpeed, setSound } from './slots-sound.js';

const LANG = getLang();
const EN = LANG === 'en';
const L = (ru, en) => (EN ? en : ru);

const API = 'https://api.deadlock-api.com/v1';
const HOUR = 3600, DAY = 86400;
// Сборки с 50+ матчами от 10+ игроков за 30 дней (меньше — винрейт почти чистый шум) — те же пороги, что в лаборатории.
const RND = { days: 30, minMatches: 50, minPlayers: 10, maxChecks: 24, extraHeroes: 10 };
const PARTY_MAX = 6;
// Гарантия лутбокса: одна карточка не ниже этой редкости (индекс в RARITY) — по размеру пати.
// 2–3 → Unique+, 4–5 → Rare+, 6 → Ultra Rare+; на 1 карточку гарантии нет. Остальные карточки крутятся как обычно.
const GUARANTEE = { 2: 2, 3: 2, 4: 3, 5: 3, 6: 4 };

// Редкости по винрейту сборки. min — нижняя граница (доля побед).
const RARITY = [
  { k: 'trash', name: 'Trash', min: 0 },
  { k: 'common', name: 'Common', min: 0.45 },
  { k: 'unique', name: 'Unique', min: 0.5 },
  { k: 'rare', name: 'Rare', min: 0.53 },
  { k: 'ultra', name: 'Ultra Rare', min: 0.56 },
  { k: 'legendary', name: 'Legendary', min: 0.6 },
];
const rarityOf = (wr) => { let i = 0; for (let j = 0; j < RARITY.length; j++) if (wr >= RARITY[j].min) i = j; return i; };
const rarRange = (i) => (i === 0 ? L('до 45%', 'under 45%') : i === RARITY.length - 1 ? '60%+' : `${Math.round(RARITY[i].min * 100)}–${Math.round(RARITY[i + 1].min * 100)}%`);

const CATS = ['weapon', 'spirit', 'vitality'];
const CAT_NAME = { weapon: L('Оружие', 'Weapon'), spirit: L('Спиритизм', 'Spirit'), vitality: L('Живучесть', 'Vitality') };
const LEANS = [['any', L('Любой', 'Any')], ...CATS.map((c) => [c, CAT_NAME[c]])];

const root = document.getElementById('slots');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString(EN ? 'en-US' : 'ru-RU');
const num = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : 0);
const pct = (v, d = 1) => { const s = (v * 100).toFixed(d); return (EN ? s : s.replace('.', ',')) + '%'; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mod = (a, n) => ((a % n) + n) % n;
const shuffled = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// ---------- справочник ----------
let D = null;
let heroById = {}, itemById = {}, abilityById = {};

// ---------- настройки (запоминаются) ----------
const OPT_KEY = NS + 'slots:opts';
const opts = { mode: 'slot', heroes: [], lean: 'any', floor: 0, party: 1, sound: true }; // mode: 'slot' — автомат, 'box' — лутбокс
function loadOpts() {
  try {
    const v = JSON.parse(localStorage.getItem(OPT_KEY) || 'null');
    if (!v) return;
    if (Array.isArray(v.heroes)) opts.heroes = v.heroes.map(Number).filter((id) => heroById[id]);
    if (LEANS.some(([k]) => k === v.lean)) opts.lean = v.lean;
    if (Number.isInteger(v.floor) && v.floor >= 0 && v.floor < RARITY.length) opts.floor = v.floor;
    if (Number.isInteger(v.party) && v.party >= 1 && v.party <= PARTY_MAX) opts.party = v.party;
    opts.sound = v.sound !== false;
    if (v.mode === 'slot' || v.mode === 'box') opts.mode = v.mode;
  } catch {}
}
function saveOpts() { try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch {} }

// ---------- запросы к API ----------
const since = () => Math.floor(Date.now() / 1000 / HOUR) * HOUR - RND.days * DAY; // до часа — общий кэш у всех зрителей
async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status === 503) && attempt < 3) {
      const ra = parseFloat(r.headers.get('retry-after'));
      await sleep(Math.min(20, Number.isFinite(ra) && ra > 0 ? ra : 4 * attempt) * 1000);
      continue;
    }
    if (r.status === 429) throw new Error(L('Слишком много запросов к API — подожди минуту и повтори.', 'Too many API requests — wait a minute and try again.'));
    if (r.status === 503) throw new Error(L('API перегружен — попробуй через пару минут.', 'The API is overloaded — try again in a couple of minutes.'));
    throw new Error(L(`API ответил ${r.status}`, `API returned ${r.status}`));
  }
}

// Пул сборок героя: [id, матчи, игроки, победы]. Кэш на час в памяти и в localStorage (компактно — ответ API весит ~50 КБ на героя).
const pools = new Map();
const POOL_PREFIX = NS + 'slots:pool:';
function heroPoolRows(heroId) {
  if (pools.has(heroId)) return pools.get(heroId);
  const t = since();
  const p = (async () => {
    try {
      const c = JSON.parse(localStorage.getItem(POOL_PREFIX + heroId) || 'null');
      if (c && c.t === t && Array.isArray(c.v)) return c.v;
    } catch {}
    const rows = await getJson(`${API}/analytics/hero-build-stats/${heroId}?min_unix_timestamp=${t}&min_matches=${RND.minMatches}`);
    const v = (rows || []).filter((x) => x.matches >= RND.minMatches && x.players >= RND.minPlayers)
      .map((x) => [num(x.hero_build_id), num(x.matches), num(x.players), num(x.wins)]);
    try { localStorage.setItem(POOL_PREFIX + heroId, JSON.stringify({ t, v })); } catch {}
    return v;
  })();
  pools.set(heroId, p);
  p.catch(() => pools.delete(heroId));
  return p;
}

const builds = new Map();
function getBuild(id) {
  if (!builds.has(id)) {
    const p = getJson(`${API}/builds?build_id=${id}&only_latest=true`).then((r) => (r && r[0] ? r[0].hero_build : null));
    builds.set(id, p);
    p.catch(() => builds.delete(id));
  }
  return builds.get(id);
}
// Свежая версия прямо из игры (база API отстаёт). Лимит этого запроса — 20/мин с IP, поэтому не больше 10 в минуту; иначе версия из базы.
const refetchLog = [];
async function freshBuild(id, old) {
  const now = Date.now();
  while (refetchLog.length && now - refetchLog[0] > 60000) refetchLog.shift();
  if (!old || refetchLog.length >= 10) return old;
  refetchLog.push(now);
  try {
    const r = await fetch(`${API}/builds/${num(old.hero_id)}/${num(id)}?force_refetch=true`);
    if (!r.ok) return old;
    const d = await r.json();
    const b = d && (d.hero_build || d);
    if (!b || !b.hero_id) return old;
    return (b.version || 0) >= (old.version || 0) ? b : old;
  } catch { return old; }
}

// склонность: куда вложено больше всего душ. Разделы «Необязательно» (optional) не считаем — это запасные варианты,
// а не то, что игрок реально собирает; если в сборке только такие разделы — считаем по всем.
function leanOf(b) {
  const cats = (b && b.details && b.details.mod_categories) || [];
  const tally = (list) => {
    const sum = { weapon: 0, spirit: 0, vitality: 0 };
    for (const cat of list) for (const m of cat.mods || []) { const it = itemById[m.ability_id >>> 0]; if (it && sum[it.cat] !== undefined) sum[it.cat] += it.cost || 0; }
    return sum;
  };
  let sum = tally(cats.filter((c) => !c.optional));
  if (!(sum.weapon + sum.spirit + sum.vitality)) sum = tally(cats);
  const total = sum.weapon + sum.spirit + sum.vitality;
  if (!total) return null;
  const cat = CATS.slice().sort((a, b2) => sum[b2] - sum[a])[0];
  return { cat, share: sum[cat] / total };
}

// ---------- подбор сборок ----------
const seen = new Set();
// Одна сборка для героя под текущие условия или null; minRar — поднять нижнюю планку редкости (гарантия лутбокса)
async function findFor(hero, minRar = 0) {
  const floor = RARITY[Math.max(opts.floor, minRar)].min;
  const rows = (await heroPoolRows(hero.id)).map(([id, matches, players, wins]) => ({ id, matches, players, wins, wr: wins / matches })).filter((r) => r.wr >= floor);
  if (!rows.length) return null;
  const order = [...shuffled(rows.filter((r) => !seen.has(r.id))), ...shuffled(rows.filter((r) => seen.has(r.id)))];
  const hit = (r, b) => { const lean = leanOf(b); return b && lean && (opts.lean === 'any' || lean.cat === opts.lean) ? { hero, row: r, build: b, lean, pool: rows.length, rar: rarityOf(r.wr) } : null; };
  if (opts.lean === 'any') {
    // без фильтра по инвесту подходит первая же сборка; до трёх попыток, если какая-то не открылась
    for (const r of order.slice(0, 3)) { const g = hit(r, await getBuild(r.id).catch(() => null)); if (g) return g; }
    return null;
  }
  // с фильтром — смотрим содержимое пачками по 6
  const cand = order.slice(0, RND.maxChecks);
  for (let i = 0; i < cand.length; i += 6) {
    const part = cand.slice(i, i + 6);
    const blds = await Promise.all(part.map((r) => getBuild(r.id).catch(() => null)));
    for (let k = 0; k < part.length; k++) { const g = hit(part[k], blds[k]); if (g) return g; }
  }
  return null;
}

// Гарантированная карточка: герой, у которого есть сборка не ниже rar. Сначала по кэшу пулов отсеиваем героев без таких сборок
// (пулы грузятся пачками по 6), потом открываем сборку. Не нашлось — гарантия на ступень ниже. Возвращает сборку или null.
async function rollLucky(rar) {
  const picked = shuffled(opts.heroes.length ? D.heroes.filter((h) => opts.heroes.includes(h.id)) : D.heroes);
  for (let r = rar; r > opts.floor; r--) {
    const min = RARITY[r].min;
    for (let i = 0; i < picked.length && i < 24; i += 6) {
      const part = picked.slice(i, i + 6);
      const rows = await Promise.all(part.map((h) => heroPoolRows(h.id).catch(() => [])));
      for (let k = 0; k < part.length; k++) {
        if (!rows[k].some(([, m, , w]) => w / m >= min)) continue;
        const g = await findFor(part[k], r);
        if (g) return g;
      }
    }
  }
  return null;
}

// n сборок на разных героев. Возвращает { list, short } — short: в выбранном пуле не хватило героев.
// skip — герои, которых брать нельзя (уже в команде автомата); при непустом skip можно добрать героя вне пула.
async function rollBuilds(n, skip = new Set()) {
  // лутбокс: сначала гарантированная карточка, остальные — обычной круткой без её героя
  const g0 = n > 1 && GUARANTEE[n] > opts.floor ? await rollLucky(GUARANTEE[n]) : null;
  const skip2 = new Set(skip); if (g0) skip2.add(g0.hero.id);
  const [res, fresh] = await Promise.all([rollRest(g0 ? n - 1 : n, skip2, n === 1 && !skip.size), g0 && freshBuild(g0.row.id, g0.build)]);
  if (g0) {
    if (fresh && fresh !== g0.build) { g0.build = fresh; if (opts.lean === 'any') g0.lean = leanOf(fresh) || g0.lean; }
    res.list.splice(Math.floor(Math.random() * (res.list.length + 1)), 0, g0); seen.add(g0.row.id); // место случайное, вскроется всё равно последней
  }
  return res;
}
async function rollRest(n, skip, solo) {
  const all = D.heroes.filter((h) => !skip.has(h.id));
  const picked = opts.heroes.length ? all.filter((h) => opts.heroes.includes(h.id)) : all;
  let queue = shuffled(picked);
  let limit = opts.heroes.length ? queue.length : Math.min(queue.length, n + RND.extraHeroes);
  let short = false;
  const list = [];
  let i = 0;
  for (;;) {
    while (list.length < n && i < limit) {
      const part = queue.slice(i, Math.min(limit, i + (n - list.length)));
      i += part.length;
      const got = await Promise.all(part.map((h) => findFor(h)));
      for (const g of got) if (g && list.length < n) list.push(g);
    }
    if (list.length >= n || short || !opts.heroes.length || solo) break;
    // пати больше, чем героев в пуле с подходящими сборками — добираем из остальных
    short = true;
    queue = shuffled(all.filter((h) => !opts.heroes.includes(h.id)));
    i = 0; limit = Math.min(queue.length, n + RND.extraHeroes);
  }
  // свежие версии из игры — параллельно, в пределах лимита
  await Promise.all(list.map(async (g) => {
    const b = await freshBuild(g.row.id, g.build);
    if (b !== g.build) { g.build = b; if (opts.lean === 'any') g.lean = leanOf(b) || g.lean; }
  }));
  for (const g of list) seen.add(g.row.id);
  return { list, short: short && list.length > 0 };
}

// ---------- звук: public/js/slots-sound.js (синтез, любой звук можно заменить файлом) ----------
const RAR_SND = ['win-trash', 'win-common', 'win-unique', 'win-rare', 'win-ultra', 'win-jackpot'];
const SFX = {
  lever: () => play('lever'),
  // у каждого барабана своя петля стрекота чуть разной высоты: по звуку слышно, сколько их ещё крутится
  reel: (i, on) => sndLoop('spin-loop', on, { id: i, rate: [1, 1.12, 1.26][i] || 1, vol: 0.75 }),
  reelSpeed: (i, k) => loopSpeed('spin-loop', i, k),
  spinOff: () => { for (let i = 0; i < 3; i++) sndLoop('spin-loop', false, { id: i }); },
  tick: () => play('tick'),
  stop: (i) => play('reel-stop', { i }),
  win(i) { play(RAR_SND[i]); if (i === 5) setTimeout(() => play('coins'), 250); },
  shake: (on) => sndLoop('crate-shake', on),
  pop: () => play('crate-open'),
  flip: () => play('card-flip'),
};

// ---------- частицы (монеты, искры) ----------
const fx = { cv: null, ctx: null, parts: [], raf: 0 };
const RAR_COLOR = { trash: '#8a8580', common: '#f7e9d5', unique: '#97da79', rare: '#5aa2ff', ultra: '#b77dff', legendary: '#ffc83d' };
function fxCanvas() {
  if (fx.cv) return fx.cv;
  const cv = document.createElement('canvas'); cv.className = 'fx-canvas'; cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv); fx.cv = cv; fx.ctx = cv.getContext('2d');
  const fit = () => { const r = Math.min(2, window.devicePixelRatio || 1); cv.width = innerWidth * r; cv.height = innerHeight * r; fx.ctx.setTransform(r, 0, 0, r, 0, 0); };
  fit(); addEventListener('resize', fit);
  return cv;
}
function fxLoop(t) {
  const { ctx, parts } = fx;
  const dt = Math.min(0.05, (t - (fx.last || t)) / 1000); fx.last = t;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    if (p.life <= 0 || p.y > innerHeight + 40) { parts.splice(i, 1); continue; }
    ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = Math.min(1, p.life * 2);
    if (p.coin) {
      const sx = Math.abs(Math.cos(p.rot)) * 0.9 + 0.1; // монета «вращается» вокруг вертикальной оси
      ctx.scale(sx, 1); ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.arc(0, 0, p.s, 0, 7); ctx.fill();
      ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(0, 0, p.s * 0.78, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-p.s * 0.16, -p.s * 0.45, p.s * 0.32, p.s * 0.9);
    } else { ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); }
    ctx.restore();
  }
  if (parts.length) fx.raf = requestAnimationFrame(fxLoop); else { fx.raf = 0; fx.last = 0; }
}
function fxRun() { if (!fx.raf) fx.raf = requestAnimationFrame(fxLoop); }
// искры из точки
function burst(x, y, color, n = 30, power = 420) {
  if (reduced()) return;
  fxCanvas();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = power * (0.35 + Math.random() * 0.65);
    fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - power * 0.35, g: 900, s: 4 + Math.random() * 6, c: Math.random() < 0.25 ? '#fff' : color, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, life: 0.7 + Math.random() * 0.7 });
  }
  fxRun();
}
// дождь монет на весь экран
function coinRain(n = 110) {
  if (reduced()) return;
  fxCanvas();
  for (let i = 0; i < n; i++) {
    fx.parts.push({ coin: true, x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.9, vx: (Math.random() - 0.5) * 80, vy: 180 + Math.random() * 320, g: 500, s: 8 + Math.random() * 9, c: Math.random() < 0.5 ? '#ffc83d' : '#ffe14d', rot: Math.random() * 6, vr: 5 + Math.random() * 9, life: 4 });
  }
  fxRun();
}
const centerOf = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

// ---------- барабаны ----------
// арт автомата: public/img/slots/, нарезка и замеры — slot_machine/cut.py → slot_machine/layout.json
const IMG = (n) => `img/slots/${n}.webp`;
const BULBS = [[13.45, 7.9], [24.03, 4.43], [36.43, 2.64], [50.42, 1.94], [64.37, 2.64], [77.03, 4.48], [87.49, 7.96]]; // центры ламп вывески, % корпуса
const heroCell = (h) => `<div class="rc rc-hero">${h.small ? `<img src="${esc(h.small)}" alt="" draggable="false">` : ''}<span>${esc(h.name)}</span></div>`;
const invCell = (c) => `<div class="rc rc-inv ${c}"><img src="${IMG('sym-' + c)}" alt="" draggable="false"><span>${esc(CAT_NAME[c])}</span></div>`;
const rarCell = (i) => `<div class="rc rc-rar rar-${RARITY[i].k}"><img src="${IMG('rar-' + RARITY[i].k)}" alt="" draggable="false"><b>${RARITY[i].name}</b></div>`;
const RAR_STRIP = [0, 1, 2, 3, 1, 0, 4, 2, 1, 5, 0, 3, 1, 2];
const SPEED = 24; // клеток в секунду на свободном ходу

class Reel {
  constructor(el, gen, render) {
    this.el = el; this.strip = el.querySelector('.reel-strip'); this.gen = gen; this.render = render;
    this.syms = gen(); this.L = this.syms.length; this.p = 0; this.mode = 'idle'; this.cell = 0;
    // элемент k полосы показывает символ (k−1): сверху — последний, снизу — первые два (для прокрутки по кругу)
    this.strip.innerHTML = Array.from({ length: this.L + 3 }, (_, k) => this.render(this.syms[mod(k - 1, this.L)])).join('');
    this.measure(); this.draw();
  }
  measure() { const c = this.strip.firstElementChild; this.cell = c ? c.getBoundingClientRect().height : 0; }
  set(i, sym) {
    i = mod(i, this.L); this.syms[i] = sym;
    const put = (k) => { const old = this.strip.children[k]; if (old) old.outerHTML = this.render(sym); };
    put(i + 1); if (i === this.L - 1) put(0); if (i === 0) put(this.L + 1); if (i === 1) put(this.L + 2);
  }
  draw() { this.strip.style.transform = `translate3d(0, ${(-(mod(this.p, this.L) + 0.5) * this.cell).toFixed(2)}px, 0)`; }
  free() { this.mode = 'free'; this.el.classList.add('rolling'); this.el.classList.remove('landed'); SFX.reel(this.idx, true); }
  // остановиться на символе sym через dist клеток (плавное торможение)
  stopOn(sym, dist) {
    return new Promise((done) => {
      const from = this.p, to = Math.floor(from) - dist;
      // всё, что сейчас не в окне, перемешиваем заново, целевой символ кладём в точку остановки
      const fresh = this.gen(), keep = new Set([-1, 0, 1, 2].map((d) => mod(Math.floor(from) + d, this.L)));
      for (let i = 0; i < this.L; i++) if (!keep.has(i)) this.set(i, fresh[i]);
      this.set(to, sym);
      this.stop = { from, to, t0: performance.now(), dur: (3 * (from - to) / SPEED) * 1000, done, last: Math.floor(from) };
      this.mode = 'stop';
    });
  }
  // мгновенно показать символ (без анимации)
  show(sym) { this.set(Math.round(this.p), sym); this.p = Math.round(this.p); this.mode = 'idle'; this.draw(); }
  tick(t, dt) {
    if (this.mode === 'free') { this.p -= SPEED * dt; this.draw(); }
    else if (this.mode === 'stop') {
      const s = this.stop, x = Math.min(1, (t - s.t0) / s.dur), e = 1 - Math.pow(1 - x, 3);
      this.p = s.from + (s.to - s.from) * e; this.draw();
      const k = (1 - x) * (1 - x); // скорость относительно полного хода (производная ease-out cubic)
      if (Math.abs(k - (s.k ?? 1)) > 0.04) { s.k = k; SFX.reelSpeed(this.idx, k); }
      const cur = Math.floor(this.p);
      if (cur !== s.last) { s.last = cur; if (x > 0.45 && this.ticks) SFX.tick(); }
      if (x >= 1) { this.p = s.to; this.mode = 'idle'; this.draw(); this.el.classList.remove('rolling'); this.el.classList.add('landed'); SFX.reel(this.idx, false); SFX.stop(this.idx); s.done(); }
    }
  }
}

let reels = [];
let raf = 0, lastT = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
  let active = false;
  for (const r of reels) { r.tick(t, dt); if (r.mode !== 'idle') active = true; }
  if (active) raf = requestAnimationFrame(loop); else { raf = 0; lastT = 0; }
}
function runLoop() { if (!raf) raf = requestAnimationFrame(loop); }

// ---------- состояние ----------
// Результаты у каждого режима свои: переключение их не стирает. open — чья сборка раскрыта внизу.
// slot.cur — игрок команды, который сейчас на автомате (его перекручивает «Крутить»).
const state = { busy: false, slot: { list: [], cur: 0, open: -1 }, box: { list: [], short: false, open: -1 }, shared: false }; // shared — открыта ссылка тиммейта (?party=)

// ---------- разметка ----------
const SPEAKER = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path class="snd-on" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11"/><path class="snd-off" d="m16 9.5 5 5M21 9.5l-5 5"/></svg>';
const svg = (p) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  dice: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none"/>'),
  mask: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  team: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.8-3.6 3.2-5.5 6-5.5s5.2 1.9 6 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.6c2.6.1 4.3 1.8 5 5.4"/>'),
  slot: svg('<rect x="3" y="5" width="15" height="14" rx="2"/><path d="M8 5v14M13 5v14M21 6v7M18 13h3"/><circle cx="21" cy="5" r="1.4" fill="currentColor"/>'),
  game: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v3h16v-3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  box: svg('<path d="M3 9h18v11H3z"/><path d="M2 5h20v4H2z"/><path d="M10 13h4"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  flask: svg('<path d="M9 3h6"/><path d="M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>'),
};

function segHtml(attr, items, val, cls = '') {
  return `<div class="seg-order rnd-seg ${cls}" role="radiogroup">${items.map(([v, l, sub]) => `<button data-${attr}="${v}" aria-pressed="${String(val) === String(v)}">${l}${sub ? `<small>${sub}</small>` : ''}</button>`).join('')}</div>`;
}
function shell() {
  document.getElementById('views').innerHTML = `
    <div class="views-seg views-2" role="tablist">
      <a role="tab" href="./" aria-selected="false">${ICON.dice}<span>${L('Рандом', 'Randomizer')}</span></a>
      <span role="tab" aria-selected="true" aria-current="page">${ICON.slot}<span>${L('Казино билдов', 'Build Casino')}</span></span>
    </div>
    <div id="modes"></div>`;
  root.innerHTML = `
    <div class="sl-head">
      <h1 class="sr-only">${L('Казино билдов', 'Build Casino')}</h1>
      <p class="lab-summary">${L('Случайная сборка настоящего игрока.', 'A random build from a real player.')}</p>
    </div>
    <div id="stage" class="sl-stage"></div>
    <div id="out" class="sl-out"></div>
    <section class="rnd-box sl-opts" id="opts"></section>
    <section class="sl-legend" id="legend"></section>`;
  renderModes(); renderOpts(); renderStage(); renderLegend();
}
function renderModes() {
  document.getElementById('modes').innerHTML = `<div class="mode-seg" role="radiogroup" aria-label="${L('Режим', 'Mode')}">
    ${[['slot', ICON.slot, L('Автомат', 'Slot machine')], ['box', ICON.box, L('Лутбокс', 'Loot box')]].map(([m, ic, l]) => `<button data-mode="${m}" aria-pressed="${mode() === m}">${ic}<span>${l}</span></button>`).join('')}
  </div>`;
}

function renderOpts() {
  const any = !opts.heroes.length;
  document.getElementById('opts').innerHTML = `
    <div class="rnd-row">
      ${isParty() ? `<div class="rnd-opt"><span class="rnd-lbl">${L('Сколько вас', 'Party size')}</span>${segHtml('party', Array.from({ length: PARTY_MAX }, (_, i) => [i + 1, String(i + 1)]), opts.party, 'sl-party')}</div>` : ''}
      <div class="rnd-opt"><span class="rnd-lbl">${L('Инвест в билде', 'Build investment')}</span>${segHtml('lean', LEANS.map(([k, l]) => [k, esc(l)]), opts.lean, 'sl-lean')}</div>
    </div>
    <div class="rnd-opt"><span class="rnd-lbl">${L('Нижняя планка винрейта', 'Win-rate floor')}</span>
      ${segHtml('floor', RARITY.map((r, i) => [i, i ? r.name + (i < RARITY.length - 1 ? '+' : '') : L('Любой', 'Any'), i ? Math.round(r.min * 100) + '%+' : L('всё подряд', 'anything')]), opts.floor, 'sl-floor')}</div>
    <div class="rnd-opt"><span class="rnd-lbl">${L('Герои', 'Heroes')} <small class="sl-pool">${any ? L('все', 'all') : opts.heroes.length + L(' в пуле', ' in pool')}</small></span>
      <div class="lab-pick rnd-pick">
        <button class="hp hp-any" data-hero="0" aria-pressed="${any}">${L('Любой', 'Any')}</button>
        ${D.heroes.map((h) => `<button class="hp" data-hero="${h.id}" aria-pressed="${opts.heroes.includes(h.id)}" title="${esc(h.name)}">${h.small ? `<img src="${esc(h.small)}" alt="${esc(h.name)}" width="52" height="52" loading="lazy">` : esc(h.name)}</button>`).join('')}
      </div>
    </div>
    <div class="sl-misc"><button class="btn btn-mini sl-sound" data-sound="1" aria-pressed="${opts.sound}">${SPEAKER}<span>${L('Звук', 'Sound')}</span></button></div>`;
}

function renderLegend() {
  document.getElementById('legend').innerHTML = `
    <h2>${L('Редкости', 'Rarities')}</h2>
    <div class="sl-rars">${RARITY.map((r, i) => `<div class="sl-rar rar-${r.k}"><b>${r.name}</b><span>${L('винрейт ', 'win rate ')}${rarRange(i)}</span></div>`).join('')}</div>
    <p class="lab-legend">${L(`В пуле — опубликованные сборки с ${RND.minMatches}+ матчами от ${RND.minPlayers}+ игроков за ${RND.days} дней. На малом числе матчей высокий винрейт часто просто везение: Legendary — это редкий дроп, а не гарантия побед.`, `The pool is published builds with ${RND.minMatches}+ matches from ${RND.minPlayers}+ players over ${RND.days} days. On a small sample a high win rate is often just luck: Legendary is a rare drop, not a guaranteed win.`)}</p>`;
}

const mode = () => (state.shared ? 'box' : opts.mode); // ссылка тиммейта всегда показывается видом лутбокса
const isParty = () => mode() === 'box';
const S = () => (isParty() ? state.box : state.slot); // результаты активного режима
const shareBtn = () => (S().list.length ? `<button class="btn btn-game sl-share" data-share="1">${ICON.link}<span>${S().list.length > 1 ? L('Ссылка на команду', 'Team link') : L('Ссылка на сборку', 'Build link')}</span></button>` : '');
const boxLabel = () => (state.shared ? L('Открыть свой лутбокс', 'Open your own box') : state.box.list.length ? L('Открыть ещё', 'Open another') : L('Открыть лутбокс', 'Open the loot box'));
const boxGo = () => `<button class="btn btn-main sl-roll" data-spin="1">${boxLabel()}</button>${shareBtn()}`;
const slotGo = () => {
  const n = state.slot.list.length;
  return `<button class="btn btn-main sl-roll" data-spin="1">${L('Крутить билд', 'Spin a build')}</button>
    ${n && n < PARTY_MAX ? `<button class="btn btn-next sl-next" data-next="1">${ICON.plus}<span>${L('Следующий игрок', 'Next player')}</span><small>${n + 1}/${PARTY_MAX}</small></button>` : ''}${shareBtn()}`;
};
function paintGo() { const go = document.getElementById('go'); if (go) go.innerHTML = isParty() ? boxGo() : slotGo(); }
function renderStage() {
  const st = document.getElementById('stage');
  reels = [];
  if (isParty()) {
    st.innerHTML = `
      <div class="lb" id="lb" data-state="idle">
        <div class="lb-scene">
          <i class="lb-rays"></i>
          <button class="lb-box" data-spin="1" aria-label="${L('Открыть лутбокс', 'Open the loot box')}">
            <i class="lb-shadow"></i>
            <img class="lb-closed" src="${IMG('crate-closed')}" width="520" height="552" alt="" draggable="false">
            <img class="lb-open" src="${IMG('crate-open')}" width="520" height="552" alt="" draggable="false">
            <b class="lb-n">${opts.party}</b>
          </button>
        </div>
        <div class="sl-go" id="go">${boxGo()}</div>
        <p class="sl-msg" id="msg" role="status"></p>
        <div class="lb-cards" id="cards"></div>
      </div>`;
    if (state.box.list.length) paintParty(false);
  } else {
    st.innerHTML = `
      <div class="sm-wrap">
        <div class="sm" id="sm" data-state="idle">
          <img class="sm-cab" src="${IMG('cabinet')}" width="878" height="1511" alt="" draggable="false">
          <i class="sm-bulbs" aria-hidden="true">${BULBS.map(([x, y]) => `<i style="--x:${x}%;--y:${y}%"></i>`).join('')}</i>
          <div class="sm-reels">
            ${[L('Герой', 'Hero'), L('Инвест', 'Investment'), L('Редкость', 'Rarity')].map((lbl, i) => `<div class="reel" data-reel="${i}" role="group" aria-label="${lbl}"><div class="reel-strip"></div></div>`).join('')}
            <i class="sm-line" aria-hidden="true"></i>
          </div>
          <button class="sm-lever" data-spin="1" aria-label="${L('Дёрнуть рычаг', 'Pull the lever')}" title="${L('Дёрнуть рычаг', 'Pull the lever')}">
            <img class="lv-up" src="${IMG('lever-up')}" alt="" draggable="false"><img class="lv-down" src="${IMG('lever-down')}" alt="" draggable="false">
          </button>
          <div class="sm-plate" id="plate" role="status"><span class="sm-idle">${L('Дёрни рычаг', 'Pull the lever')}</span></div>
        </div>
      </div>
      <div class="sl-go" id="go">${slotGo()}</div>
      <p class="sl-msg" id="msg" role="status"></p>
      <div class="lb-cards sl-team" id="cards"></div>`;
    const els = st.querySelectorAll('.reel');
    reels = [
      new Reel(els[0], () => shuffled(D.heroes), heroCell),
      new Reel(els[1], () => shuffled([...CATS, ...CATS, ...CATS, ...CATS]), invCell),
      new Reel(els[2], () => { const k = Math.floor(Math.random() * RAR_STRIP.length); return RAR_STRIP.map((_, i) => RAR_STRIP[(i + k) % RAR_STRIP.length]); }, rarCell),
    ];
    reels.forEach((r, i) => { r.idx = i; });
    reels[2].ticks = true;
    const g = state.slot.list[state.slot.cur];
    if (g) { reels[0].show(g.hero); reels[1].show(g.lean.cat); reels[2].show(g.rar); paintSoloWin(false); }
    paintTeam();
  }
  renderOut();
}

function setBusy(b) {
  state.busy = b;
  document.body.classList.toggle('sl-busy', b);
  for (const el of document.querySelectorAll('[data-spin],[data-next],[data-mode],[data-drop]')) el.disabled = b;
}
function showMsg(html) { const m = document.getElementById('msg'); if (m) m.innerHTML = html || ''; }
const emptyMsg = () => (opts.heroes.length === 1
  ? L(`У ${esc(heroById[opts.heroes[0]].name)} нет сборок под эти условия. Опусти планку винрейта или смени инвест.`, `${esc(heroById[opts.heroes[0]].name)} has no builds for these settings. Lower the win-rate floor or change the investment.`)
  : L('Не нашёл сборок под эти условия. Опусти планку винрейта или смени инвест и крутани ещё раз.', 'No builds found for these settings. Lower the win-rate floor or change the investment and spin again.'));

// ---------- автомат: соло и команда ----------
// kind: 'reroll' — перекрутить игрока на автомате (первая крутка создаёт его), 'next' — добавить игрока в команду
async function spinSolo(kind = 'reroll') {
  if (state.busy) return;
  const T = state.slot;
  if (kind === 'next' && (!T.list.length || T.list.length >= PARTY_MAX)) return;
  const slot = kind === 'next' || !T.list.length ? T.list.length : T.cur; // куда ляжет результат
  setBusy(true); showMsg('');
  const sm = document.getElementById('sm'), plate = document.getElementById('plate');
  sm.dataset.state = 'spin'; delete sm.dataset.rar;
  plate.innerHTML = `<span class="sm-idle">${kind === 'next' ? L(`Игрок ${slot + 1}…`, `Player ${slot + 1}…`) : L('Кручу…', 'Spinning…')}</span>`;
  T.open = -1; renderOut();
  for (const el of document.querySelectorAll('#cards .lc')) el.classList.toggle('spinning', +el.dataset.card === slot);
  const lever = sm.querySelector('.sm-lever'); lever.classList.remove('pull'); void lever.offsetWidth; lever.classList.add('pull');
  SFX.lever();
  const still = reduced();
  if (!still) { for (const r of reels) { r.measure(); r.free(); } runLoop(); }
  const t0 = performance.now();
  let res = null, err = '';
  // герои остальных игроков команды не повторяются
  const skip = new Set(T.list.filter((_, i) => i !== slot).map((g) => g.hero.id));
  let short = false;
  try { const got = await rollBuilds(1, skip); res = got.list[0] || null; short = got.short; } catch (e) { err = e.message; }
  if (!still) await sleep(Math.max(0, 700 - (performance.now() - t0)));
  track('slots_spin', { mode: 'slot', kind, team: T.list.length + (kind === 'next' ? 1 : 0), hero: opts.heroes.length === 1 ? heroById[opts.heroes[0]].name : opts.heroes.length ? 'pool' : 'any', invest: opts.lean, floor: RARITY[opts.floor].k, found: res ? 1 : 0, rarity: res ? RARITY[res.rar].k : '', build: res ? res.row.id : '' });
  if (!res) {
    // нечего показать — барабаны просто останавливаются где были
    if (!still) await Promise.all(reels.map((r, i) => r.stopOn(r.syms[mod(Math.floor(r.p) - 6 - i * 2, r.L)], 6 + i * 2)));
    SFX.spinOff();
    sm.dataset.state = 'idle';
    plate.innerHTML = `<span class="sm-idle">${L('Пусто', 'Nothing')}</span>`;
    showMsg(err ? L('Не удалось получить статистику: ', 'Could not load the stats: ') + esc(err) : emptyMsg());
    paintTeam(); paintGo();
    setBusy(false);
    return;
  }
  if (still) { reels[0].show(res.hero); reels[1].show(res.lean.cat); reels[2].show(res.rar); }
  else {
    // герой → инвест → редкость; последний барабан тянем дольше всех
    const a = reels[0].stopOn(res.hero, 9);
    await sleep(350);
    const b = reels[1].stopOn(res.lean.cat, 15);
    await sleep(400);
    const c = reels[2].stopOn(res.rar, res.rar >= 4 ? 20 : 17);
    await Promise.all([a, b, c]);
    SFX.spinOff();
    await sleep(180);
  }
  T.list[slot] = res; T.cur = slot; T.open = slot;
  paintSoloWin(true);
  if (short) showMsg(L('В пуле не хватило героев без повторов — добрал из остальных.', 'Not enough unique heroes in the pool — filled in from the rest.'));
  paintTeam(); paintGo(); renderOut();
  setBusy(false);
}
// ряд карточек команды под автоматом (когда игроков 2+)
function paintTeam() {
  const cards = document.getElementById('cards'), T = state.slot;
  if (!cards || isParty()) return;
  cards.style.setProperty('--n', T.list.length);
  cards.innerHTML = T.list.length > 1 ? T.list.map((g, i) => partyCard(g, i, true)).join('') : '';
}
// поставить игрока команды на автомат: барабаны и табло показывают его, «Крутить» перекручивает его
function pickSlot(i) {
  const T = state.slot; if (!T.list[i]) return;
  T.cur = i; T.open = i;
  const g = T.list[i];
  reels[0].show(g.hero); reels[1].show(g.lean.cat); reels[2].show(g.rar);
  paintSoloWin(false); paintTeam(); renderOut();
}
function dropSlot(i) {
  const T = state.slot; if (!T.list[i]) return;
  T.list.splice(i, 1);
  if (T.cur > i || T.cur >= T.list.length) T.cur = Math.max(0, T.cur - 1);
  T.open = T.list.length ? T.cur : -1;
  renderStage();
}

function paintSoloWin(animate) {
  const g = state.slot.list[state.slot.cur], sm = document.getElementById('sm'), plate = document.getElementById('plate');
  if (!g || !sm) return;
  const r = RARITY[g.rar];
  sm.dataset.state = 'win'; sm.dataset.rar = r.k;
  sm.classList.toggle('fresh', animate);
  const line = `${g.hero.name} ${pct(g.row.wr)}`;
  plate.innerHTML = `<div class="sm-win rar-${r.k}${animate ? ' in' : ''}" title="${r.name} · ${esc(g.hero.name)} · ${L('винрейт', 'win rate')} ${pct(g.row.wr)} · ${fmt(g.row.matches)} ${L('матчей', 'matches')}">${g.rar === 5 ? '<em class="sm-jack">Jackpot!</em>' : ''}<b style="--len:${line.length}">${esc(line)}</b></div>`;
  if (!animate) return;
  SFX.win(g.rar);
  const [x, y] = centerOf(sm.querySelector('.sm-reels'));
  if (g.rar === 5) { coinRain(); burst(x, y, RAR_COLOR.legendary, 70, 620); flash('legendary'); }
  else if (g.rar === 4) { burst(x, y, RAR_COLOR.ultra, 55, 520); flash('ultra'); }
  else if (g.rar === 3) burst(x, y, RAR_COLOR.rare, 26, 380);
}
function flash(k) {
  if (reduced()) return;
  const f = document.createElement('i'); f.className = `fx-flash rar-${k}`; document.body.appendChild(f);
  setTimeout(() => f.remove(), 900);
}

// ---------- пати: лутбокс ----------
async function openBox() {
  if (state.busy) return;
  if (state.shared) leaveShared();
  setBusy(true); showMsg('');
  const lb = document.getElementById('lb'), cards = document.getElementById('cards');
  state.box = { list: [], short: false, open: -1 }; cards.innerHTML = ''; renderOut(); paintGo();
  lb.dataset.state = 'shake';
  const still = reduced();
  const t0 = performance.now();
  SFX.shake(true);
  let got = null, err = '';
  try { got = await rollBuilds(opts.party); } catch (e) { err = e.message; }
  if (!still) await sleep(Math.max(0, 1500 - (performance.now() - t0)));
  const list = got ? got.list : [];
  const best = list.reduce((m, g) => Math.max(m, g.rar), 0);
  track('slots_spin', { mode: 'box', size: opts.party, hero: opts.heroes.length ? 'pool' : 'any', invest: opts.lean, floor: RARITY[opts.floor].k, found: list.length, rarity: list.length ? RARITY[best].k : '' });
  SFX.shake(false);
  if (!list.length) {
    lb.dataset.state = 'idle';
    showMsg(err ? L('Не удалось получить статистику: ', 'Could not load the stats: ') + esc(err) : emptyMsg());
    setBusy(false);
    return;
  }
  state.box = { list, short: got.short, open: list.length === 1 ? 0 : -1 }; // одна карточка — сборку сразу раскрываем
  lb.dataset.state = 'burst'; lb.dataset.rar = RARITY[best].k;
  SFX.pop();
  const box = lb.querySelector('.lb-box');
  const [bx, by] = centerOf(box);
  burst(bx, by - 20, RAR_COLOR[RARITY[best].k], 60, 640);
  paintParty(!still, [bx, by]);
  const notes = [];
  if (list.length < opts.party) notes.push(L(`Под эти условия нашлось только ${list.length} из ${opts.party} — опусти планку или расширь пул героев.`, `Only ${list.length} of ${opts.party} found for these settings — lower the floor or widen the hero pool.`));
  if (got.short) notes.push(L('В пуле не хватило героев — добрал из остальных.', 'Not enough heroes in the pool — filled in from the rest.'));
  showMsg(notes.join(' '));
  if (!still) {
    await sleep(500 + list.length * 110);
    // вскрываем от худшей к лучшей — самая редкая последней
    const order = list.map((g, i) => [g.rar, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [rar, i] of order) {
      const el = cards.children[i]; if (!el) continue;
      el.classList.add('flipped'); SFX.flip();
      await sleep(260);
      if (rar) SFX.win(rar); else SFX.stop(2); // Trash в пати — глухой «клац», без долгой грустной мелодии на каждую карту
      const [x, y] = centerOf(el);
      if (rar === 5) { coinRain(); burst(x, y, RAR_COLOR.legendary, 60, 560); flash('legendary'); await sleep(900); }
      else if (rar === 4) { burst(x, y, RAR_COLOR.ultra, 40, 460); await sleep(450); }
      else if (rar === 3) { burst(x, y, RAR_COLOR.rare, 20, 340); await sleep(250); }
      else await sleep(220);
    }
  }
  lb.dataset.state = 'open';
  paintGo(); renderOut();
  setBusy(false);
}

function partyCard(g, i, flipped) {
  const r = RARITY[g.rar], team = !isParty(), cur = team && state.slot.cur === i;
  return `<article class="lc rar-${r.k}${flipped ? ' flipped' : ''}${cur ? ' cur' : ''}" style="--i:${i}" data-card="${i}">
    <div class="lc-in">
      <div class="lc-back"></div>
      <div class="lc-front">
        <div class="lc-art">${g.hero.card ? `<img src="${esc(g.hero.card)}" alt="" loading="lazy">` : ''}<span class="lc-n"${cur ? ` title="${L('Сейчас на автомате', 'On the machine now')}"` : ''}>${L('Игрок', 'Player')} ${i + 1}</span>${team ? `<button class="sl-x" data-drop="${i}" title="${L('Убрать игрока', 'Remove player')}" aria-label="${L('Убрать игрока', 'Remove player')} ${i + 1}">×</button>` : ''}</div>
        <div class="lc-rar">${g.rar === 5 ? 'Jackpot · ' : ''}${r.name}</div>
        <h3>${esc(g.hero.name)}</h3>
        <p class="lc-wr"><b>${pct(g.row.wr)}</b> · ${fmt(g.row.matches)} ${L('матчей', 'matches')}</p>
        <p class="lc-lean"><i class="dotc ${g.lean.cat}"></i>${esc(CAT_NAME[g.lean.cat])} ${pct(g.lean.share, 0)}</p>
        <div class="lc-btns">
          <button class="btn btn-mini btn-game" data-game="${i}">${L('В игру', 'To game')}</button>
          <button class="btn btn-mini" data-open="${i}" aria-pressed="${S().open === i}">${L('Сборка', 'Build')}</button>
        </div>
      </div>
    </div>
  </article>`;
}
function paintParty(animate, from) {
  const cards = document.getElementById('cards'), lb = document.getElementById('lb');
  if (!cards || !state.box.list.length) return;
  const { list } = state.box;
  cards.style.setProperty('--n', list.length);
  cards.innerHTML = list.map((g, i) => partyCard(g, i, !animate)).join('');
  if (!animate) { lb.dataset.state = 'open'; lb.dataset.rar = RARITY[list.reduce((m, g) => Math.max(m, g.rar), 0)].k; return; }
  // карточки вылетают из коробки на свои места
  for (const el of cards.children) {
    const [x, y] = centerOf(el);
    el.style.setProperty('--dx', (from[0] - x).toFixed(0) + 'px');
    el.style.setProperty('--dy', (from[1] - y).toFixed(0) + 'px');
    el.classList.add('fly');
  }
}

// ---------- сборка: предметы по разделам, как в игре ----------
const CAT_NAMES = { '#Citadel_HeroBuilds_EarlyGame': L('Ранний этап', 'Early game'), '#Citadel_HeroBuilds_MidGame': L('Середина матча', 'Mid game'), '#Citadel_HeroBuilds_LateGame': L('Поздний этап', 'Late game'), '#Citadel_HeroBuilds_Early': L('Ранний этап', 'Early game'), '#Citadel_HeroBuilds_Mid': L('Середина', 'Mid game'), '#Citadel_HeroBuilds_Late': L('Поздний этап', 'Late game'), '#Citadel_HeroBuilds_Lane': L('Линия', 'Laning') };
function itemTile(m) {
  const it = itemById[m.ability_id >>> 0];
  const name = it ? it.name : `#${num(m.ability_id)}`;
  const cls = it ? `${it.cat} t${it.tier}${it.active ? ' act' : ''}` : 'unk';
  const tip = `${name}${it ? ` · ${L(`${it.tier} тир`, `tier ${it.tier}`)}${it.active ? L(' · активный', ' · active') : ''}` : ''}${m.annotation ? ' — ' + m.annotation : ''}`;
  return `<div class="g-item ${cls}" title="${esc(tip)}">
    <div class="g-ic">${it && it.icon ? `<img src="${esc(it.icon)}" alt="" loading="lazy">` : ''}</div>
    <div class="g-nm"><span>${esc(name)}</span></div>${m.annotation ? '<i class="g-note">✎</i>' : ''}
  </div>`;
}
function catPanel(cat) {
  const items = cat.mods || [];
  return `<section class="g-cat${cat.optional ? ' opt' : ''}">
    <h3><b>${esc(CAT_NAMES[cat.name] || cat.name || L('Без названия', 'Untitled'))}</b>${cat.description ? `<span>${esc(cat.description)}</span>` : ''}${cat.optional ? `<em>${L('Необязательно', 'Optional')}</em>` : ''}</h3>
    <div class="g-items">${items.length ? items.map(itemTile).join('') : `<span class="muted">${L('пусто', 'empty')}</span>`}</div>
  </section>`;
}
// ---------- прокачка умений (как в лаборатории, компактно) ----------
const BOLT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1 3.5 9h4l-1 6 6-8h-4z" fill="currentColor"/></svg>';
const PT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 14.5 8 8 14.5 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.6"/></svg>';
// В API после 16 шагов бывает «хвост» с повторами (история правок): проигрываем шаги как игра —
// умение открывается один раз, улучшается максимум трижды; чужие умения и старые ID отбрасываем (та же логика, что в lab.js).
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
function abilityPlan(b) {
  const h = heroById[b.hero_id];
  const abs = ((h && h.abilities) || []).filter((a) => a.id);
  const own = new Set(abs.map((a) => a.id >>> 0));
  const ch = cleanAbilityOrder(b.details && b.details.ability_order && b.details.ability_order.currency_changes, own);
  if (!ch.length) return '';
  // приоритет: в каком порядке умения доводят до максимума (кто раньше получил 3-е улучшение; недокачанные — по числу улучшений)
  const st = new Map(abs.map((a) => [a.id >>> 0, { a, ups: 0, first: Infinity, max: Infinity }]));
  ch.forEach((c, i) => {
    const x = st.get(c.ability_id >>> 0); if (!x || c.currency_type === 2) return;
    x.ups++; x.first = Math.min(x.first, i); if (x.ups === 3) x.max = i;
  });
  const prio = [...st.values()].filter((x) => x.ups).sort((p, q) => p.max - q.max || q.ups - p.ups || p.first - q.first);
  const ic = (a) => (a.icon ? `<img src="${esc(a.icon)}" alt="">` : '');
  const cols = `grid-template-columns: 30px repeat(${ch.length}, minmax(24px, 1fr))`;
  return `<section class="g-abil sl-abil">
    <h3>${L('Прокачка', 'Ability order')}</h3>
    ${prio.length ? `<ol class="sl-prio" aria-label="${L('Приоритет улучшений', 'Upgrade priority')}">${prio.map((x) => `<li title="${esc(x.a.name)}: ${x.ups} ${L('улучш.', 'upgr.')}"><i class="g-ab-ic">${ic(x.a)}</i><span>${esc(x.a.name)}</span></li>`).join('')}</ol>` : ''}
    <div class="g-abil-scroll"><div class="g-abil-grid">
      ${abs.map((a) => `<div class="g-ab-row" style="${cols}">
        <div class="g-ab-ic" title="${esc(a.name)}">${ic(a)}</div>
        ${ch.map((c, i) => ((c.ability_id >>> 0) === (a.id >>> 0)
          ? `<div class="g-ab-cell"><span class="g-pt${c.currency_type === 2 ? ' unlock' : ''}" title="${i + 1}. ${esc(a.name)}: ${c.currency_type === 2 ? L('открыть', 'unlock') : L('улучшение за ', 'upgrade for ') + -c.delta}">${c.currency_type === 2 ? BOLT : PT + '<b>' + -c.delta + '</b>'}</span></div>`
          : '<div class="g-ab-cell"></div>')).join('')}
      </div>`).join('')}
    </div></div>
  </section>`;
}
function buildPanel(g, idx) {
  const b = g.build, r = RARITY[g.rar], id = g.row.id;
  const cats = (b.details && b.details.mod_categories) || [];
  return `<article class="g-build sl-build rar-${r.k}">
    <header class="g-head">
      ${g.hero.small ? `<img class="g-hero" src="${esc(g.hero.small)}" alt="${esc(g.hero.name)}">` : ''}
      <div class="g-title">
        <div class="sl-tags"><span class="sl-tag rar-${r.k}">${r.name}</span><span class="sl-tag inv ${g.lean.cat}">${esc(CAT_NAME[g.lean.cat])} ${pct(g.lean.share, 0)}</span></div>
        <h2>${esc(b.name || L('Без названия', 'Untitled'))}</h2>
        <div class="g-sub"><span>${esc(g.hero.name)}</span><span>${L('Винрейт', 'Win rate')}: <b>${pct(g.row.wr)}</b></span><span>${fmt(g.row.matches)} ${L('матчей', 'matches')} · ${fmt(g.row.players)} ${L('игроков', 'players')}</span></div>
        <div class="g-upd">${L(`за ${RND.days} дней`, `over ${RND.days} days`)} · <button class="id-copy" data-copy-id="${id}" title="${L('Скопировать ID', 'Copy ID')}">ID ${id}</button> ${g.pool ? ` · ${L('подходящих сборок у героя', 'matching builds for this hero')}: ${fmt(g.pool)}` : ''}</div>
      </div>
    </header>
    <div class="g-actions">
      <button class="btn btn-game" data-game="${idx}">${ICON.game}<span>${L('Скопировать в игру', 'Copy to game')}</span></button>
      <a class="btn" href="lab/builds.html?ids=${id}">${ICON.flask}<span>${L('Статистика и прокачка', 'Stats and skill order')}</span></a>
    </div>
    ${abilityPlan(b)}
    <div class="g-overview">
      ${b.description ? `<p class="g-desc">${esc(b.description)}</p>` : ''}
      <div class="g-cats">${cats.map(catPanel).join('') || `<p class="lab-empty">${L('В сборке нет предметов.', 'This build has no items.')}</p>`}</div>
    </div>
  </article>`;
}
const current = (i) => S().list[i];
function renderOut() {
  const out = document.getElementById('out');
  if (!out) return;
  const s = S(), g = s.open >= 0 ? s.list[s.open] : null;
  out.innerHTML = g ? `${s.list.length > 1 ? `<p class="sl-out-h">${L('Игрок', 'Player')} ${s.open + 1} · ${esc(g.hero.name)}</p>` : ''}${buildPanel(g, s.open)}` : '';
  for (const b of root.querySelectorAll('[data-open]')) b.setAttribute('aria-pressed', String(+b.dataset.open === s.open));
}

function gameCode(g) {
  const b = g.build;
  return encodeBuildCode({
    heroId: b.hero_id,
    name: b.name || `Build ${g.row.id}`,
    desc: `${b.description || ''}\n— ${L('копия сборки', 'copy of build')} #${g.row.id} (RANDOMLOCK · ${RARITY[g.rar].name})`.trim(),
    categories: ((b.details && b.details.mod_categories) || []).map((cat) => ({
      name: cat.name, desc: cat.description || '',
      items: (cat.mods || []).map((m) => ({ id: m.ability_id, note: m.annotation || '', imbue: m.imbue_target_ability_id || 0 })),
    })),
    abilityChanges: (b.details && b.details.ability_order && b.details.ability_order.currency_changes) || [],
  });
}

let toastT;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600);
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(msg); } catch {} ta.remove();
  }
}

// ---------- ссылка на пати ----------
// ?party=id.матчи.победы.игроки_… в base36: тиммейты видят те же карточки и редкости и забирают свою сборку.
const b36 = (n) => num(n).toString(36);
function encodeParty(list) { return list.map((g) => [g.row.id, g.row.matches, g.row.wins, g.row.players].map(b36).join('.')).join('_'); }
function decodeParty(code) {
  return String(code || '').split('_').slice(0, PARTY_MAX).map((p) => p.split('.').map((x) => parseInt(x, 36)))
    .filter((a) => a.length === 4 && a.every((x) => Number.isFinite(x) && x >= 0) && a[0] > 0 && a[1] >= a[2])
    .map(([id, matches, wins, players]) => ({ id, matches, wins, players, wr: matches ? wins / matches : 0 }));
}
function partyUrl() {
  const list = S().list; if (!list.length) return '';
  try { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('party', encodeParty(list)); return u.toString(); } catch { return ''; }
}
function leaveShared() {
  state.shared = false; opts.mode = 'box'; // экран сейчас — лутбокс; переключатель режима потом сам поставит нужный
  try { const u = new URL(location.href); u.searchParams.delete('party'); history.replaceState(null, '', u); } catch {}
}
async function loadShared(rows) {
  state.shared = true; opts.party = rows.length; // в настройки не сохраняем: это чужой лутбокс
  shell();
  setBusy(true);
  const lb = document.getElementById('lb');
  if (lb) lb.dataset.state = 'shake';
  showMsg(L('Открываю лутбокс тиммейта…', 'Opening your teammate’s loot box…'));
  const got = await Promise.all(rows.map(async (row) => {
    const b = await getBuild(row.id).catch(() => null);
    const hero = b && heroById[b.hero_id];
    const lean = b && leanOf(b);
    return hero && lean ? { hero, row, build: b, lean, pool: 0, rar: rarityOf(row.wr) } : null;
  }));
  const list = got.filter(Boolean);
  setBusy(false);
  if (!list.length) {
    if (lb) lb.dataset.state = 'idle';
    showMsg(L('Не удалось открыть сборки по этой ссылке. Возможно, их удалили — открой свой лутбокс.', 'Could not load the builds from this link. They may have been deleted — open your own box.'));
    paintGo();
    return;
  }
  state.box = { list, short: false, open: list.length === 1 ? 0 : -1 };
  paintParty(false); paintGo(); renderOut();
  showMsg(list.length < rows.length
    ? L(`Лутбокс тиммейта: открылось ${list.length} из ${rows.length}. Выбери свою карточку и жми «В игру».`, `Teammate’s loot box: ${list.length} of ${rows.length} loaded. Pick your card and hit “To game”.`)
    : L('Лутбокс тиммейта. Выбери свою карточку и жми «В игру».', 'Your teammate’s loot box. Pick your card and hit “To game”.'));
  track('slots_shared_open', { size: list.length });
}

// ---------- события ----------
const spin = () => (isParty() ? openBox() : spinSolo('reroll'));
// на документе: переключатель режима (#modes) стоит в навигации, вне #slots
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-spin],[data-next],[data-mode],[data-drop],[data-party],[data-lean],[data-floor],[data-hero],[data-sound],[data-game],[data-open],[data-copy-id],[data-share],.lc.flipped');
  if (!t) return;
  const d = t.dataset;
  if (d.spin) { spin(); return; }
  if (d.next) { spinSolo('next'); return; }
  if (d.share) {
    const url = partyUrl(); if (!url) return;
    copy(url, S().list.length > 1
      ? L('Ссылка скопирована — кидай в чат пати: каждый откроет свою карточку и заберёт сборку кнопкой «В игру»', 'Link copied — drop it in the party chat: everyone opens their card and grabs the build with “To game”')
      : L('Ссылка на сборку скопирована', 'Build link copied'));
    track('slots_share', { size: S().list.length, mode: mode() });
    return;
  }
  if (d.copyId) { copy(d.copyId, L(`ID ${d.copyId} скопирован`, `ID ${d.copyId} copied`)); return; }
  if (d.game !== undefined) {
    const g = current(+d.game); if (!g) return;
    try {
      copy(gameCode(g), L(`Код для ${g.hero.name} скопирован. В игре: Поиск сборок → Создать сборку → Вставить сборку`, `Code for ${g.hero.name} copied. In game: Build Browser → Create new Build → Paste Build`));
      track('to_game', { from: 'slots', build: g.row.id, hero: g.hero.name, rarity: RARITY[g.rar].k });
    } catch { toast(L('Не удалось собрать код сборки', 'Could not build the code')); }
    return;
  }
  const openIdx = d.open !== undefined ? +d.open : t.classList.contains('lc') ? +d.card : -1;
  if (openIdx >= 0) {
    const s = S();
    if (!isParty() && !state.busy && state.slot.cur !== openIdx) pickSlot(openIdx); // в автомате — ставим игрока на автомат и раскрываем
    else { s.open = s.open === openIdx ? -1 : openIdx; renderOut(); }
    if (s.open >= 0) document.getElementById('out').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
    return;
  }
  if (d.sound) { opts.sound = !opts.sound; setSound(opts.sound); saveOpts(); t.setAttribute('aria-pressed', String(opts.sound)); if (opts.sound) SFX.flip(); return; }
  if (state.busy) return; // условия во время крутки не меняем
  if (d.drop !== undefined) { dropSlot(+d.drop); return; }
  if (d.mode) {
    if (d.mode === mode()) return;
    if (state.shared) leaveShared();
    opts.mode = d.mode; saveOpts(); showMsg('');
    renderModes(); renderOpts(); renderStage();
    return;
  }
  if (d.party) {
    const n = +d.party;
    if (n === opts.party) return;
    if (state.shared) leaveShared();
    opts.party = n; saveOpts(); state.box = { list: [], short: false, open: -1 };
    renderOpts(); renderStage();
    return;
  }
  if (d.lean) { opts.lean = d.lean; saveOpts(); renderOpts(); return; }
  if (d.floor !== undefined) { opts.floor = +d.floor; saveOpts(); renderOpts(); return; }
  if (d.hero !== undefined) {
    const id = +d.hero;
    if (!id) opts.heroes = [];
    else if (opts.heroes.includes(id)) opts.heroes = opts.heroes.filter((x) => x !== id);
    else opts.heroes.push(id);
    saveOpts(); renderOpts();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test((e.target && e.target.tagName) || '')) return;
  e.preventDefault(); spin();
});
addEventListener('resize', () => { for (const r of reels) { r.measure(); r.draw(); } });

// ---------- язык: статичная часть страницы и переключатель RU / EN ----------
function localizeStatic() {
  document.documentElement.lang = LANG;
  document.title = L('Казино билдов — RANDOMLOCK', 'Build Casino — RANDOMLOCK');
  for (const el of document.querySelectorAll('[data-en]')) el.innerHTML = EN ? el.dataset.en : el.innerHTML;
  for (const el of document.querySelectorAll('[data-en-label]')) el.setAttribute('aria-label', EN ? el.dataset.enLabel : el.dataset.ruLabel);
  const side = document.querySelector('.top-side');
  if (!side) return;
  side.insertAdjacentHTML('beforeend', `<div class="top-meta lab-meta"><span class="seg lab-lang" role="group" aria-label="Language">${['ru', 'en'].map((l) => `<button type="button" data-lang="${l}" aria-pressed="${LANG === l}">${l.toUpperCase()}</button>`).join('')}</span></div>`);
  document.addEventListener('DOMContentLoaded', () => { const ts = side.querySelector('.theme-slot'); const m = side.querySelector('.lab-meta'); if (ts && m) m.appendChild(ts); });
  side.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b || b.dataset.lang === LANG) return;
    setLang(b.dataset.lang);
    track('setting', { name: 'lang', value: b.dataset.lang, page: 'slots' });
    location.reload();
  });
}

// ---------- старт ----------
(async function boot() {
  if (!root) return;
  markDev();
  initAnalytics('slots');
  localizeStatic();
  try {
    D = await fetch(`data/${LANG}.json`).then((r) => r.json());
  } catch {
    root.innerHTML = `<p class="lab-error">${L('Не удалось загрузить справочник героев и предметов.', 'Could not load the hero and item data.')}</p>`;
    return;
  }
  heroById = Object.fromEntries(D.heroes.map((h) => [h.id, h]));
  itemById = Object.fromEntries(D.items.map((i) => [i.id >>> 0, i]));
  for (const h of D.heroes) for (const a of h.abilities || []) if (a.id) abilityById[a.id >>> 0] = a;
  loadOpts(); setSound(opts.sound);
  let shared = [];
  try { shared = decodeParty(new URL(location.href).searchParams.get('party')); } catch {}
  if (shared.length) loadShared(shared); else shell();
})();
