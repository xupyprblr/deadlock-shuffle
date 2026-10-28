// Журнал круток (фаза 2.0, разведка): при «В игру» сохраняем крутку в браузере.
// На этапе 2.1 журнал переедет на сервер (время забора — по часам сервера), а этот останется как локальный кэш.
import { NS } from './env.js';

const KEY = NS + 'ds:journal';
const MAX = 200;
export const JOURNAL_V = 1;

export function loadJournal() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((e) => e && e.v === JOURNAL_V && e.hero && Array.isArray(e.items)) : [];
  } catch { return []; }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); return true; } catch { return false; }
}

// res — результат крутки (state.res), extra — { order, invest, score, code }
export function entryFrom(res, extra = {}) {
  return {
    v: JOURNAL_V,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Date.now(),
    hero: { id: res.hero.id, name: res.hero.name },
    items: res.build.map((i) => i.id),
    skills: (res.skills || []).slice(),
    order: extra.order || null,
    invest: extra.invest || null,
    score: extra.score || null,
    code: extra.code || null,
  };
}

// Повторное копирование той же сборки (тот же код) — обновляем время, а не плодим записи
export function addEntry(entry) {
  const list = loadJournal();
  const same = entry.code ? list.findIndex((e) => e.code === entry.code) : -1;
  if (same >= 0) {
    const old = list.splice(same, 1)[0];
    entry = { ...old, at: entry.at, score: entry.score || old.score };
  }
  list.unshift(entry);
  save(list);
  return entry;
}

export function removeEntry(id) {
  save(loadJournal().filter((e) => e.id !== id));
}

export function clearJournal() {
  try { localStorage.removeItem(KEY); } catch {}
}
