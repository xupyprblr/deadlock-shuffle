// Собирает dist/demo.html — одна страница со встроенными данными и иконками.
// Нужна для предпросмотра там, где нельзя ходить в API (например, в песочнице).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p) => path.join(root, 'public', p);
const strip = (code) => code.replace(/^import .*$/gm, '').replace(/^export /gm, '');

const ru = JSON.parse(await readFile(pub('data/ru.json'), 'utf8'));
const en = JSON.parse(await readFile(pub('data/en.json'), 'utf8'));
const paths = new Set();
for (const d of [ru, en]) {
  for (const h of d.heroes) { [h.card, h.small, ...h.abilities.map((a) => a.icon)].forEach((p) => p && paths.add(p)); }
  for (const i of d.items) i.icon && paths.add(i.icon);
}
const img = {};
for (const p of paths) {
  if (p.startsWith('http')) continue;
  try { img[p] = 'data:image/webp;base64,' + (await readFile(pub(p))).toString('base64'); } catch {}
}
const stats = JSON.parse(await readFile(pub('data/stats.json'), 'utf8'));
let tune = null;
try { tune = JSON.parse(await readFile(pub('data/tune.json'), 'utf8')); } catch {}
const css = await readFile(pub('css/styles.css'), 'utf8');
const js = [await readFile(pub('js/normalize.js'), 'utf8'), await readFile(pub('js/random.js'), 'utf8'), await readFile(pub('js/buildcode.js'), 'utf8'), await readFile(pub('js/app.js'), 'utf8')].map(strip).join('\n');
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

const html = `<title>Deadlock Shuffle</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya:wght@800&family=Jost:wght@400;500;600&family=Rubik:wght@700;900&display=swap">
<style>${css}</style>
<div id="app" class="wrap"><div class="loading">Загружаю героев и предметы…</div></div>
<script>
window.DS_CONFIG = { live: false };
window.DS_SNAPSHOT = { ru: ${json(ru)}, en: ${json(en)} };
window.DS_IMG = ${json(img)};
window.DS_STATS = ${json(stats)};
window.DS_TUNE = ${json(tune)};
</script>
<script type="module">
${js}
</script>
`;
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/demo.html'), html);
console.log('dist/demo.html', (html.length / 1024 / 1024).toFixed(1) + ' MB', Object.keys(img).length, 'картинок');
