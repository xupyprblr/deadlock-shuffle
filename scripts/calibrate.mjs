// Калибровка порогов «Оценки затара»: распределение средней дельты по 20 000 случайным сборкам.
import { readFile } from 'node:fs/promises';
import { roll, DEFAULTS, scoreBuild } from '../public/js/random.js';
const data = JSON.parse(await readFile(new URL('../public/data/en.json', import.meta.url), 'utf8'));
const stats = JSON.parse(await readFile(new URL('../public/data/stats.json', import.meta.url), 'utf8'));
const xs = [];
for (let i = 0; i < 20000; i++) {
  const res = roll(data, DEFAULTS, 'c' + i);
  const s = scoreBuild(res.build, stats.heroes[res.hero.id]);
  if (s) xs.push(s.mean * 10);
}
xs.sort((a, b) => a - b);
const q = (p) => xs[Math.floor(p * (xs.length - 1))];
console.log(`сборок с оценкой: ${xs.length}`);
for (const p of [0.1, 0.3, 0.6, 0.9]) console.log(`перцентиль ${p * 100}%: ${q(p).toFixed(1)} (×1000)`);
