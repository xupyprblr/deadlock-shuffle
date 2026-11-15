// База в памяти с тем же интерфейсом, что D1 (prepare/bind/batch), — только под запросы worker.js.
// Для автотеста (scripts/test-stats.mjs) и локального сервера (stats/dev.mjs), чтобы не ставить wrangler.
export function memDB() {
  const rows = new Map(); // ключ day|env|ev|dim|val → строка
  const seen = new Set(); // отпечатки посетителей day|env|h
  const run = ({ sql, a }) => {
    if (sql.startsWith('INSERT OR IGNORE INTO visitors')) {
      const k = a.join('|'), had = seen.has(k); seen.add(k);
      return { results: [], meta: { changes: had ? 0 : 1 } };
    }
    if (sql.startsWith('DELETE FROM visitors')) { for (const k of [...seen]) if (k.split('|')[0] < a[0]) seen.delete(k); return { results: [], meta: {} }; }
    if (sql.startsWith('INSERT INTO hits')) {
      const [day, env, ev, dim, val] = a, k = a.slice(0, 5).join('|');
      const r = rows.get(k) || { day, env, ev, dim, val, n: 0 };
      r.n++; rows.set(k, r);
      return { results: [] };
    }
    const [env, from] = a;
    const all = [...rows.values()].filter((r) => r.env === env && r.day >= from);
    if (sql.includes("dim = ''")) return { results: all.filter((r) => r.dim === '').sort((p, q) => p.day.localeCompare(q.day)).map(({ day, ev, n }) => ({ day, ev, n })) };
    const sum = new Map();
    for (const r of all) if (r.dim !== '') { const k = [r.ev, r.dim, r.val].join('|'); const s = sum.get(k) || { ev: r.ev, dim: r.dim, val: r.val, n: 0 }; s.n += r.n; sum.set(k, s); }
    return { results: [...sum.values()] };
  };
  return {
    rows, seen,
    prepare: (sql) => ({ bind: (...a) => { const q = { sql, a }; q.run = async () => run(q); return q; } }),
    batch: async (list) => list.map(run),
  };
}
