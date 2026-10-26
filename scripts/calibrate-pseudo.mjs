#!/usr/bin/env node
// Калибровка псевдо-рандома: сравнение с полным рандомом на живых данных (data/*.json)
//   node scripts/calibrate-pseudo.mjs [sharp] [tau]
import { readFileSync } from 'node:fs';
import { roll, rng, DEFAULTS, PSEUDO, scoreBuild } from '../public/js/random.js';
import { attachTune } from '../public/js/normalize.js';
const D = JSON.parse(readFileSync('public/data/en.json', 'utf8'));
const tune = JSON.parse(readFileSync('public/data/tune.json', 'utf8'));
const stats = JSON.parse(readFileSync('public/data/stats.json', 'utf8'));
attachTune(D, tune);
if (process.argv[2]) PSEUDO.sharp = +process.argv[2];
if (process.argv[3]) PSEUDO.tau = +process.argv[3];

// «родной» предмет: в топ-25% по лифту покупок на этом герое
const top = {};
for (const h of D.heroes) {
  const arr = [...(h.tune ? h.tune.w : new Map()).entries()].sort((a, b) => b[1] - a[1]);
  top[h.id] = new Set(arr.slice(0, Math.round(arr.length * 0.25)).map((x) => x[0]));
}
function run(order, N = 6000) {
  let native = 0, n = 0, mean = 0, ms = 0, t4early = 0, troll = 0, vit = 0;
  const seen = {}; // разнообразие: сколько разных предметов выпадает герою
  for (let k = 0; k < N; k++) {
    const res = roll(D, { ...DEFAULTS, order }, 'c' + k);
    const h = res.hero;
    for (const i of res.build) { n++; if (top[h.id].has(i.id >>> 0)) native++; (seen[h.id] ||= new Set()).add(i.id); if (i.cat === 'vitality') vit++; }
    const sc = scoreBuild(res.build, stats.heroes[h.id]);
    if (sc) { mean += sc.mean; ms++; if (sc.verdict === 'troll') troll++; }
    if (res.build.slice(0, 2).some((i) => i.tier === 4)) t4early++;
  }
  const div = Object.values(seen).reduce((a, s) => a + s.size, 0) / Object.keys(seen).length;
  return { native: (native / n * 100).toFixed(1) + '%', meanPP: (mean / ms).toFixed(2), troll: (troll / ms * 100).toFixed(1) + '%', t4in12: (t4early / N * 100).toFixed(1) + '%', vitPerBuild: (vit / N).toFixed(2), itemsPerHero: div.toFixed(0) };
}
console.log('полный  ', run('chaos'));
console.log(`псевдо sharp=${PSEUDO.sharp} tau=${PSEUDO.tau}`, run('pseudo'));
