// Прогон файтинга «компьютер против компьютера»: нет NaN, раунды заканчиваются, спецприёмы срабатывают.
import assert from 'node:assert/strict';
import { Game, matchSeq } from '../public/arcade/js/engine.js';
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
        for (const v of [f.x, f.y, f.vx, f.vy, f.hp, f.meter]) assert.ok(Number.isFinite(v), `NaN у ${f.id} в состоянии ${f.st}`);
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
