// Сопоставление сыгранного матча с забранной сборкой (фаза 2.0).
// Чистые функции без DOM и сети — одинаково работают в браузере, в тестах и позже на сервере.
//
// Данные матча (Deadlock API, /v1/matches/metadata и /v1/matches/{id}/metadata):
//   players[].items — события по времени: { game_time_s, item_id, upgrade_id, sold_time_s, flags }.
//   В одном списке и покупки (item_id = id предмета магазина), и прокачка умений
//   (item_id = id умения героя; upgrade_id = 0 — открытие, иначе улучшение).

export const STEAM64_BASE = 76561197960265728n;
export const RANDOM_MIN = 6; // «матч на рандом-сборке»: куплено ≥ 6 из 12 (откалибруем на разведке)
export const FULL = 12; // «затар собран»
export const WINDOW_MS = 7 * 24 * 3600 * 1000; // матчи в течение 7 дней после забора

// SteamID в любом виде → account_id (32 бита) или null.
// Понимает: account_id, SteamID64, [U:1:N], ссылку steamcommunity.com/profiles/7656…
export function parseSteamId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  let m = s.match(/\[U:1:(\d+)\]/i);
  if (m) return toAccount(m[1]);
  m = s.match(/profiles\/(\d{17})/);
  if (m) return toAccount(m[1]);
  if (/^\d+$/.test(s)) return toAccount(s);
  return null;
}
function toAccount(digits) {
  try {
    const n = BigInt(digits);
    const id = n >= STEAM64_BASE ? n - STEAM64_BASE : n;
    return id > 0n && id < 4294967296n ? Number(id) : null;
  } catch { return null; }
}
export const toSteam64 = (accountId) => (BigInt(accountId) + STEAM64_BASE).toString();

// Предметы, которые засчитывает покупка item: он сам и все его компоненты (вглубь).
export function creditsOf(item, bySlug) {
  const out = new Set();
  const walk = (it, depth) => {
    if (!it || out.has(it.id) || depth > 6) return;
    out.add(it.id);
    for (const slug of it.from || []) walk(bySlug.get(slug), depth + 1);
  };
  walk(item, 0);
  return out;
}

// События игрока → покупки предметов и порядок прокачки (индексы умений героя 0..3).
export function playerEvents(events, hero, itemsById) {
  const abilityIdx = new Map((hero.abilities || []).map((a, i) => [a.id, i]));
  const list = (events || []).slice().sort((a, b) => (a.game_time_s || 0) - (b.game_time_s || 0));
  const buys = [];
  const skills = [];
  let unknown = 0;
  for (const e of list) {
    const id = e.item_id >>> 0;
    if (abilityIdx.has(id)) skills.push(abilityIdx.get(id));
    else if (itemsById.has(id)) buys.push({ id, t: e.game_time_s || 0, sold: e.sold_time_s || 0 });
    else unknown++;
  }
  return { buys, skills, unknown };
}

// Сравнение: entry — запись журнала (items: id предметов по порядку покупки, skills: индексы умений),
// ev — результат playerEvents. Возвращает точность по предметам, порядку и прокачке.
export function compareBuild(entry, ev, itemsById, bySlug) {
  // первое время, когда каждый предмет сборки оказался «куплен» (сам или через улучшение)
  const firstAt = new Map();
  for (const b of ev.buys) {
    for (const id of creditsOf(itemsById.get(b.id), bySlug)) {
      if (!firstAt.has(id) || firstAt.get(id) > b.t) firstAt.set(id, b.t);
    }
  }
  const want = entry.items.map((id) => id >>> 0);
  const hit = want.filter((id) => firstAt.has(id));
  const miss = want.filter((id) => !firstAt.has(id));
  const wantSet = new Set(want);
  const extra = [...new Set(ev.buys.map((b) => b.id))].filter((id) => ![...creditsOf(itemsById.get(id), bySlug)].some((c) => wantSet.has(c)));

  // порядок: доля пар купленных предметов сборки, купленных в том же порядке (в одну секунду — совпадает)
  let pairs = 0, good = 0;
  for (let i = 0; i < hit.length; i++) {
    for (let j = i + 1; j < hit.length; j++) {
      const a = firstAt.get(hit[i]), b = firstAt.get(hit[j]);
      pairs++;
      if (a <= b) good++;
    }
  }
  const order = pairs ? good / pairs : null;

  // прокачка: совпадения по шагам и длина совпавшего начала
  const plan = entry.skills || [];
  const n = Math.min(plan.length, ev.skills.length);
  let same = 0, prefix = 0, broken = false;
  for (let k = 0; k < n; k++) {
    if (plan[k] === ev.skills[k]) { same++; if (!broken) prefix++; } else broken = true;
  }

  return {
    hit: hit.length,
    total: want.length,
    hitIds: hit,
    missIds: miss,
    extraIds: extra,
    order,
    skills: { same, played: ev.skills.length, planned: plan.length, prefix },
    isRandom: hit.length >= RANDOM_MIN,
    collected: want.length > 0 && hit.length === want.length,
  };
}

// Какая сборка «активна» для матча: последняя забранная на этого героя до начала матча, не старше окна.
// startMs — время начала матча (мс). Сборки, забранные после начала, не засчитываются.
export function activeEntry(entries, heroId, startMs) {
  let best = null;
  for (const e of entries) {
    if (e.hero.id !== heroId || e.at > startMs || startMs - e.at > WINDOW_MS) continue;
    if (!best || e.at > best.at) best = e;
  }
  return best;
}

// Матчи истории, которые могли быть сыграны на сборках из журнала
export function candidateMatches(entries, history) {
  const out = [];
  for (const m of history || []) {
    const startMs = (m.start_time || 0) * 1000;
    const e = activeEntry(entries, m.hero_id, startMs);
    if (e) out.push({ match: m, entry: e });
  }
  return out;
}

// Игрок из ответа metadata (пачкой или одиночного) → { events, buildId }
export function pickPlayer(meta, accountId) {
  const info = meta && (meta.match_info || meta);
  const players = (info && info.players) || [];
  const p = players.find((x) => (x.account_id >>> 0) === (accountId >>> 0));
  if (!p) return null;
  let buildId = p.hero_build_id ?? null;
  const ids = meta && meta.hero_build_ids;
  if (buildId == null && ids) {
    if (Array.isArray(ids)) {
      const f = ids.find((x) => x && (x.account_id >>> 0) === (accountId >>> 0));
      buildId = f ? (f.hero_build_id ?? f.build_id ?? null) : null;
    } else if (typeof ids === 'object') buildId = ids[accountId] ?? ids[String(accountId)] ?? null;
  }
  return { events: p.items || [], buildId: buildId || null };
}

// Победа по данным истории матчей
export const isWin = (m) => m.match_result === m.player_team;
