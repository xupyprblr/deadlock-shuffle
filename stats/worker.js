// Счётчик статистики RANDOMLOCK: Cloudflare Worker + D1. Развёртывание — stats/README.md.
// Хранит только обезличенные агрегаты «день × событие × измерение × значение → сколько раз».
// Без cookies. IP не сохраняется: для лимита частоты он не пишется в базу, а для подсчёта уникальных посетителей
// из него делается отпечаток sha256(соль дня + IP + браузер); соль своя на каждый день (секрет VISIT_SALT + дата),
// отпечатки живут только до конца следующих суток и удаляются — остаётся одно число «посетителей за день».
//
//   POST /hit    { env: 'main'|'dev', ev, p: {...} }  — тело text/plain (navigator.sendBeacon без preflight)
//   GET  /stats?env=main&days=30                      — только с заголовком Authorization: Bearer <ADMIN_TOKEN>

// Белый список: событие → измерения, которые считаем. Остальные параметры отбрасываются.
// Любое другое событие с нормальным именем считается только итогом (сколько раз за день), без разрезов.
// Составной разрез 'a+b' — значение «a|b» (например, раздел + герой), чтобы делить героев и редкости по разделам.
export const EVENTS = {
  pageview: ['page'], // открыли страницу (roulette / slots / lab); заодно считает уникальных посетителей
  roll: ['team', 'verdict', 'order', 'invest', 'hero'], // крутка на главной (team: 1 — режим «Команда»; verdict — оценка затара)
  team_add: [],
  reroll_slot: [],
  slots_spin: ['mode', 'kind', 'mode+rarity', 'got', 'size'], // автомат / лутбокс; got — выпавший герой (в лутбоксе — лучшей карты)
  to_game: ['from', 'mode', 'via', 'rarity', 'from+hero'], // в казино ещё where: take | card | howto — пока без разреза // «Скопировать в игру»: from — раздел, via — code (код сборки) | id (ID сборки)
  share_link: [],
  team_link: ['from'],
  slots_share: ['mode', 'size'],
  slots_shared_open: ['size'],
  social: ['target'], // yt | tw | tg
  donate: ['target'],
  view: ['value'],
  slots_open: [],
  lab_open: [],
};
export const ENVS = ['main', 'dev'];
export const ORIGINS = ['https://randomlock.com', 'http://localhost:5173'];
const MAX_BODY = 1024;

// значение измерения: короткая строка из безопасных символов, иначе null
export function cleanVal(v) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 40);
  return /^[\p{L}\p{N} _.'%+&-]+$/u.test(s) ? s : null;
}

// разобрать тело запроса в строки счётчиков; null — запрос отбрасываем
export function parseHit(text) {
  if (typeof text !== 'string' || !text || text.length > MAX_BODY) return null;
  let b; try { b = JSON.parse(text); } catch { return null; }
  if (!b || typeof b !== 'object' || !ENVS.includes(b.env) || typeof b.ev !== 'string' || !/^[a-z][a-z0-9_]{1,29}$/.test(b.ev) || b.ev === 'visitor') return null; // visitor считает только сам Worker
  const rows = [['', '']];
  const p = b.p && typeof b.p === 'object' ? b.p : {};
  for (const dim of Object.hasOwn(EVENTS, b.ev) ? EVENTS[b.ev] : []) {
    const vals = dim.split('+').map((k) => cleanVal(p[k]));
    if (vals.every((v) => v !== null)) rows.push([dim, vals.join('|')]);
  }
  return { env: b.env, ev: b.ev, rows };
}

// день по Москве (UTC+3): статистику Алекс смотрит по своему времени
export const dayOf = (ms = Date.now()) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);

export function allowedOrigin(req) {
  const o = req.headers.get('Origin') || '';
  return ORIGINS.includes(o) ? o : '';
}
function cors(origin, extra = {}) {
  return origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Allow-Methods': 'GET, POST', Vary: 'Origin', ...extra } : extra;
}
const json = (data, status, origin) => new Response(JSON.stringify(data), { status, headers: cors(origin, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }) });

export function authorized(req, env) {
  const h = req.headers.get('Authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const want = env.ADMIN_TOKEN || '';
  if (!want || t.length !== want.length) return false;
  let d = 0; for (let i = 0; i < t.length; i++) d |= t.charCodeAt(i) ^ want.charCodeAt(i); // сравнение без утечки по времени
  return d === 0;
}

const UPSERT = 'INSERT INTO hits (day, env, ev, dim, val, n) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT (day, env, ev, dim, val) DO UPDATE SET n = n + 1';
const SEEN = 'INSERT OR IGNORE INTO visitors (day, env, h) VALUES (?, ?, ?)';
const FORGET = 'DELETE FROM visitors WHERE day < ?';

// боты, превью ссылок и безголовые браузеры не считаем посетителями
export const isBot = (ua) => !ua || /bot|crawl|spider|slurp|headless|preview|facebookexternalhit|telegram|whatsapp|discord|curl|wget|python|node/i.test(ua);

export async function visitorHash(salt, day, ip, ua) {
  const data = new TextEncoder().encode(`${salt}|${day}|${ip}|${ua}`);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hit(req, env, origin) {
  if (!origin) return new Response(null, { status: 403 });
  if (env.LIMIT) {
    const ip = req.headers.get('CF-Connecting-IP') || '';
    const { success } = await env.LIMIT.limit({ key: ip });
    if (!success) return new Response(null, { status: 429, headers: cors(origin) });
  }
  const h = parseHit(await req.text());
  if (!h) return new Response(null, { status: 400, headers: cors(origin) });
  const day = dayOf();
  const rows = h.rows.map(([dim, val]) => [h.ev, dim, val]);
  if (h.ev === 'pageview') {
    const ua = req.headers.get('User-Agent') || '';
    if (isBot(ua)) return new Response(null, { status: 204, headers: cors(origin) });
    if (env.VISIT_SALT) {
      // первый просмотр за день с этого отпечатка — новый посетитель
      const hash = await visitorHash(env.VISIT_SALT, day, req.headers.get('CF-Connecting-IP') || '', ua);
      const [r] = await env.DB.batch([env.DB.prepare(SEEN).bind(day, h.env, hash)]);
      if (r && r.meta && r.meta.changes) rows.push(['visitor', '', '']);
      if (Math.random() < 0.02) await env.DB.prepare(FORGET).bind(dayOf(Date.now() - 86400e3)).run(); // вчерашние и старше
    }
  }
  const st = env.DB.prepare(UPSERT);
  await env.DB.batch(rows.map(([ev, dim, val]) => st.bind(day, h.env, ev, dim, val)));
  return new Response(null, { status: 204, headers: cors(origin) });
}

async function stats(req, env, origin) {
  if (!authorized(req, env)) return json({ error: 'auth' }, 401, origin);
  const u = new URL(req.url);
  const e = ENVS.includes(u.searchParams.get('env')) ? u.searchParams.get('env') : 'main';
  const days = Math.max(1, Math.min(400, parseInt(u.searchParams.get('days'), 10) || 30));
  const from = dayOf(Date.now() - (days - 1) * 86400e3);
  // по дням — только итоги событий; разрезы — суммой за период (иначе строк слишком много)
  const [daily, dims] = await env.DB.batch([
    env.DB.prepare("SELECT day, ev, n FROM hits WHERE env = ? AND day >= ? AND dim = '' ORDER BY day").bind(e, from),
    env.DB.prepare("SELECT ev, dim, val, SUM(n) AS n FROM hits WHERE env = ? AND day >= ? AND dim != '' GROUP BY ev, dim, val").bind(e, from),
  ]);
  return json({ env: e, from, to: dayOf(), daily: daily.results, dims: dims.results }, 200, origin);
}

export default {
  async fetch(req, env) {
    const origin = allowedOrigin(req);
    const { pathname } = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin, { 'Access-Control-Max-Age': '86400' }) });
    try {
      if (req.method === 'POST' && pathname === '/hit') return await hit(req, env, origin);
      if (req.method === 'GET' && pathname === '/stats') return await stats(req, env, origin);
    } catch (err) {
      return json({ error: 'server' }, 500, origin);
    }
    return new Response('RANDOMLOCK stats', { status: 404 });
  },
};
