// Прогон файтинга «компьютер против компьютера»: нет NaN, раунды заканчиваются, спецприёмы срабатывают.
import assert from 'node:assert/strict';
import { Game, matchSeq, minGap } from '../public/arcade/js/engine.js';
import { MOVES } from '../public/arcade/js/data.js';
import { makeAI } from '../public/arcade/js/ai.js';

assert.ok(matchSeq([{ k: 'D', t: 10 }, { k: 'F', t: 14 }], ['D', 'F'], 20));
assert.ok(!matchSeq([{ k: 'D', t: 10 }, { k: 'F', t: 14 }], ['D', 'F'], 40));
assert.ok(!matchSeq([{ k: 'F', t: 10 }, { k: 'D', t: 14 }], ['D', 'F'], 20));

const used = {}, sfx = {};
let matches = 0;
for (const [a, b] of [['bebop', 'lash'], ['lash', 'bebop'], ['bebop', 'bebop'], ['lash', 'lash']]) {
  for (let rep = 0; rep < 6; rep++) {
    const G = new Game(a, b);
    const ai = [makeAI('hard'), makeAI(rep % 2 ? 'normal' : 'easy')];
    let n = 0;
    while (G.phase !== 'over' && n < 60 * 60 * 8) {
      G.update([ai[0](G, G.f[0]), ai[1](G, G.f[1])]);
      for (const e of G.events) { if (e.type === 'special') used[`${G.f[e.side].id}:${e.name}`] = (used[`${G.f[e.side].id}:${e.name}`] || 0) + 1; if (e.type === 'sfx') sfx[e.s] = 1; }
      G.events.length = 0;
      for (const f of G.f) {
        for (const v of [f.x, f.y, f.vx, f.vy, f.hp, f.meter]) assert.ok(Number.isFinite(v), `NaN у ${f.id} в состоянии ${f.st}: ${JSON.stringify({x:f.x,y:f.y,vx:f.vx,vy:f.vy,hp:f.hp,m:f.meter})}`);
        assert.ok(f.x >= 0 && f.x <= 384, `${f.id} за экраном: ${f.x}`);
        for (const k of Object.keys(f.pose)) assert.ok(Number.isFinite(f.pose[k]), `поза ${k}`);
      }
      n++;
    }
    assert.equal(G.phase, 'over', `матч ${a}-${b} не закончился за 8 минут`);
    matches++;
  }
}
console.log('матчей:', matches, '\nприёмы:', used, '\nзвуки:', Object.keys(sfx).join(' '));
for (const id of ['Hyper Beam', 'Grapple Arm', 'Sticky Bomb', 'Exploding Uppercut', 'Death Slam', 'Grapple', 'Flog']) assert.ok(Object.keys(used).some((k) => k.endsWith(id)), `не сработал ${id}`);
console.log('ok');

// Ввод игрока: ↓ → + верхний рукой у Bebop (смотрит вправо) — липкая бомба; ← → + нижний рукой — рука-захват.
function play(seq, id = 'bebop') {
  const G = new Game(id, 'lash');
  while (G.phase !== 'fight') G.update([{}, {}]);
  const names = [];
  for (const inp of seq) { G.update([inp, {}]); for (const e of G.events) if (e.type === 'special') names.push(e.name); G.events.length = 0; }
  return { G, names };
}
const fr = (o, n = 1) => Array(n).fill(o);
assert.deepEqual(play([...fr({ d: true }, 3), ...fr({ d: true, r: true }, 2), ...fr({ r: true, hp: true }, 2), ...fr({}, 5)]).names, ['Sticky Bomb']);
assert.deepEqual(play([...fr({ l: true }, 3), ...fr({ r: true }, 2), ...fr({ r: true, lp: true }, 2), ...fr({}, 5)]).names, ['Grapple Arm']);
assert.deepEqual(play([...fr({ r: true }, 2), {}, ...fr({ r: true }, 2), ...fr({ r: true, hp: true }, 2), ...fr({}, 5)]).names, ['Exploding Uppercut']);
// апперкот: присед + верхний рукой
{ const { G } = play([...fr({ d: true }, 3), ...fr({ d: true, hp: true }, 2)]); assert.equal(G.f[0].mn, 'up'); }
// Ground Strike у Lash: прыжок, затем ↓ + верхний ногой
assert.deepEqual(play([...fr({ u: true }, 2), ...fr({}, 12), ...fr({ d: true, hk: true }, 2), ...fr({}, 40)], 'lash').names, ['Ground Strike']);
console.log('ввод ok');

// Рывок и отскок: двойное нажатие в одну сторону; одиночное — обычная ходьба.
{
  const G = new Game('lash', 'bebop'); while (G.phase !== 'fight') G.update([{}, {}]);
  for (const inp of [{ r: true }, {}, {}, { r: true }]) G.update([inp, {}]);
  assert.equal(G.f[0].st, 'dash', 'двойное → не дало рывок');
  const x0 = G.f[0].x; for (let i = 0; i < 20; i++) G.update([{}, {}]);
  assert.ok(G.f[0].x - x0 > 30, 'рывок короткий'); assert.equal(G.f[0].st, 'idle');
  for (const inp of [{ l: true }, {}, {}, { l: true }]) G.update([inp, {}]);
  assert.equal(G.f[0].st, 'bdash', 'двойное ← не дало отскок');
  for (let i = 0; i < 40; i++) G.update([{}, {}]);
  assert.equal(G.f[0].st, 'idle'); assert.equal(G.f[0].y, 196);
  for (const inp of [{ r: true }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { r: true }]) G.update([inp, {}]);
  assert.equal(G.f[0].st, 'walk', 'медленное двойное нажатие не должно давать рывок');
}
console.log('рывок ok');

// Тренировка: таймер стоит, бессмертие держит 1 здоровья, без бессмертия нокаут не засчитывается и бой продолжается.
{
  const G = new Game('bebop', 'lash', { training: true, immortal: true });
  assert.equal(G.phase, 'fight');
  const ai = makeAI('hard'), t0 = G.timer;
  for (let i = 0; i < 60 * 60; i++) { G.update([ai(G, G.f[0]), {}]); G.events.length = 0; }
  assert.equal(G.timer, t0, 'таймер в тренировке идёт');
  assert.ok(G.f[1].hp >= 1, 'манекен умер при бессмертии');
  G.opts.immortal = false; G.opts.meter = true;
  let kos = 0;
  for (let i = 0; i < 60 * 120 && kos < 1; i++) { G.update([ai(G, G.f[0]), {}]); kos += G.events.filter((e) => e.type === 'ko').length; G.events.length = 0; }
  assert.equal(kos, 1, 'без бессмертия манекен не падает');
  for (let i = 0; i < 260; i++) { G.update([{}, {}]); G.events.length = 0; }
  assert.equal(G.phase, 'fight'); assert.equal(G.f[0].wins + G.f[1].wins, 0); assert.equal(G.f[1].hp, 100);
}
console.log('тренировка ok');

// Дистанция: бойцы, идущие навстречу, останавливаются на минимальной дистанции (сумма их push), корпуса не перекрываются,
// и с этой дистанции каждый обычный удар с земли достаёт стоящего соперника.
for (const [a, b] of [['bebop', 'lash'], ['lash', 'bebop'], ['bebop', 'bebop'], ['lash', 'lash']]) {
  const close = () => {
    const G = new Game(a, b, { training: true });
    for (let i = 0; i < 200; i++) { G.update([{ r: true }, { l: true }]); G.events.length = 0; }
    for (let i = 0; i < 20; i++) { G.update([{}, {}]); G.events.length = 0; }
    return G;
  };
  const G0 = close(), [p, q] = G0.f;
  assert.ok(Math.abs(q.x - p.x - minGap(a, b)) < 1, `${a}-${b}: дистанция ${q.x - p.x}, а нужна ${minGap(a, b)}`);
  assert.ok(p.rig.box.x1 < q.rig.box.x0 - 12, `${a}-${b}: корпуса слишком близко`);
  for (const [n, m] of Object.entries(MOVES)) {
    if (m.air) continue;
    const G = close(); let hit = false;
    G.startMove(G.f[0], n);
    for (let i = 0; i < m.s + m.a + 2; i++) { G.update([{}, {}]); hit ||= G.events.some((e) => e.type === 'dmg' && e.side === 1); G.events.length = 0; }
    assert.ok(hit, `${a} не достаёт ${b} ударом ${n} с минимальной дистанции`);
  }
}
// прыжок через соперника вплотную: тела не мешают в воздухе, после приземления бойцы снова на минимальной дистанции
{
  const G = new Game('lash', 'bebop', { training: true });
  for (let i = 0; i < 200; i++) { G.update([{ r: true }, {}]); G.events.length = 0; }
  const bx = G.f[1].x;
  for (let i = 0; i < 90; i++) { G.update([i < 3 ? { u: true, r: true } : {}, {}]); G.events.length = 0; }
  assert.ok(G.f[0].x > G.f[1].x, 'перепрыгнуть соперника вплотную не получилось');
  assert.ok(Math.abs(G.f[1].x - bx) < 12, 'прыжок через соперника слишком сильно его сдвинул');
  assert.ok(G.f[0].x - G.f[1].x >= minGap('lash', 'bebop') - 1, 'после прыжка бойцы стоят друг в друге');
}
console.log('дистанция ok');
