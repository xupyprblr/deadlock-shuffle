// База в памяти с тем же интерфейсом, что D1 (prepare/bind/batch), — только под запросы worker.js.
// Для автотеста (scripts/test-stats.mjs) и локального сервера (stats/dev.mjs), чтобы не ставить wrangler.
export function memDB() {
  const rows = new Map(); // ключ day|env|ev|dim|val → строка
  const run = ({ sql, a }) => {
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
    rows,
    prepare: (sql) => ({ bind: (...a) => ({ sql, a }) }),
    batch: async (list) => list.map(run),
  };
}
