// Компьютерный соперник: раз в несколько кадров решает, что делать, и «держит» кнопки как игрок.
// Держит дистанцию своего лучшего удара: подходит ровно настолько, чтобы достать, а не ломится вплотную.
import { FLOOR, MOVES, HB } from './data.js';

const LEVELS = {
  easy: { react: 24, block: 0.15, aa: 0.2, sp: 0.15, agg: 0.45 },
  normal: { react: 14, block: 0.4, aa: 0.45, sp: 0.3, agg: 0.6 },
  hard: { react: 7, block: 0.65, aa: 0.7, sp: 0.4, agg: 0.75 },
};
const R = Math.random;

// Что нажать, чтобы вышел удар: кнопка и что при этом держать (back — «от соперника», d — вниз). w — как часто выбирать.
const KIT = [
  { n: 'lp', btn: 'lp', w: 3 }, { n: 'hp', btn: 'hp', w: 2 }, { n: 'lk', btn: 'lk', w: 3 }, { n: 'hk', btn: 'hk', w: 2 },
  { n: 'sweep', btn: 'lk', hold: 'back', w: 1.5 }, { n: 'round', btn: 'hk', hold: 'back', w: 1 },
  { n: 'clp', btn: 'lp', hold: 'd', w: 1 }, { n: 'up', btn: 'hp', hold: 'd', w: 1.5 }, { n: 'clk', btn: 'lk', hold: 'd', w: 1 }, { n: 'chk', btn: 'hk', hold: 'd', w: 1 },
];
const POKE = 'lk'; // удар, дистанцию которого компьютер держит
// Дальность удара: докуда от точки опоры достаёт зона, с частью шага вперёд.
export function reach(id, n) { const m = MOVES[n], hb = HB[id]?.[n] || m.hb; return hb.x + hb.w + (m.adv || 0) * 0.7; }

export function makeAI(level = 'normal') {
  const L = LEVELS[level] || LEVELS.normal;
  let hold = {}, holdT = 0, cd = 20, press = null, pressT = 0, walk = 0;
  return function think(G, f) {
    const o = f.o, dist = Math.abs(o.x - f.x), fwd = f.face > 0 ? 'r' : 'l', back = f.face > 0 ? 'l' : 'r';
    if (G.phase !== 'fight') { hold = {}; holdT = 0; walk = 0; return {}; }
    // нажатие кнопки держим 2 кадра, потом отпускаем, чтобы движок увидел новое нажатие в следующий раз
    if (press) { if (--pressT <= 0) { const r = press; press = null; return { ...r.held }; } return { ...press.held, [press.btn]: true }; }
    const doPress = (btn, held = {}) => { press = { btn, held }; pressT = 2; return { ...held, [btn]: true }; };
    // сколько до ближнего края соперника и с какой дистанции достаёт основной удар
    const gap = f.face > 0 ? o.rig.box.x0 - f.x : f.x - o.rig.box.x1;
    const pref = reach(f.id, POKE) - 3;
    const near = dist < f.ch.push + o.ch.push + 8; // почти вплотную

    if (f.st === 'jump' && !f.airUsed) {
      if (f.id === 'lash' && f.y < FLOOR - 40 && dist < 40 && R() < 0.15) return doPress('hk', { d: true });
      if (f.vy > -1 && gap < 36 && R() < 0.35) return doPress(R() < 0.5 ? 'hk' : 'hp');
      return { ...hold };
    }
    // подход: идём, пока основной удар не начнёт доставать, и ни шагом дальше
    if (walk > 0) {
      walk--;
      if (gap > pref && !f.busy) return { [fwd]: true };
      walk = 0; cd = Math.min(cd, 2 + Math.floor(R() * L.react * 0.5));
    }
    if (holdT > 0) { holdT--; return { ...hold }; }
    hold = {};
    if (f.busy) return {};
    // отклик на атаку соперника — проверяем каждый кадр, но с вероятностью уровня
    const oAtk = (o.st === 'atk' && o.mv && o.mf < o.mv.s + o.mv.a) || G.proj.some((p) => p.owner === o && !p.stuck);
    if (oAtk && dist < 130 && R() < L.block / 6) { hold = { blk: true, d: o.mv?.kind === 'low' }; holdT = 16; return { ...hold }; }
    if (o.st === 'jump' && gap < 50 && o.y < FLOOR - 20 && R() < L.aa / 4) return doPress('hp', { d: true });
    if (--cd > 0) return {};
    cd = L.react + Math.floor(R() * 10);

    if (f.meter >= 100 && (f.id === 'bebop' ? dist < 300 : dist < 70) && R() < 0.7) { f.aiSpecial = f.id === 'bebop' ? 'beam' : 'slam'; return {}; }
    const down = ['down', 'getup', 'ko'].includes(o.st);
    if (down) { if (gap < pref - 8 && R() < 0.5) { hold = { [back]: true }; holdT = 10; } return { ...hold }; }

    if (gap > pref + 70) { // далеко
      if (R() < L.sp) {
        if (f.id === 'bebop') { f.aiSpecial = dist > 175 || R() < 0.5 ? 'hook' : 'bomb'; return {}; } // бомба летит примерно на 150 px
        f.aiSpecial = 'grap'; return {};
      }
      if (R() < 0.12 * L.agg) { hold = { u: true, [fwd]: true }; holdT = 3; return { ...hold }; }
      if (R() < 0.3 * L.agg) { f.aiDash = 1; return {}; }
      walk = 20 + Math.floor(R() * 30); return { [fwd]: true };
    }
    if (gap > pref) { // средняя дистанция: подойти на удар или достать приёмом
      if (R() < L.sp) {
        if (f.id === 'bebop') { f.aiSpecial = dist > 115 && R() < 0.4 ? 'bomb' : 'hook'; return {}; }
        f.aiSpecial = gap < 80 ? 'flog' : 'grap'; return {};
      }
      if (R() < 0.1 * L.agg && gap > 30) { hold = { u: true, [fwd]: true }; holdT = 3; return { ...hold }; }
      if (R() < 0.12) { hold = { [back]: true }; holdT = 10; return { ...hold }; }
      if (R() < 0.25 - L.agg * 0.2) { hold = {}; holdT = 8; return {}; } // выжидает
      walk = 40; return { [fwd]: true };
    }
    // на дистанции удара
    const r = R();
    if (r < 0.1) { hold = { blk: true, d: R() < 0.4 }; holdT = 18; return { ...hold }; }
    if (r < 0.16) { hold = { [back]: true }; holdT = 12; return { ...hold }; }
    if (r < 0.19) { f.aiDash = -1; return {}; }
    // слишком близко для ног — чаще отходит на свою дистанцию
    if (gap < pref - 14 && r < 0.19 + 0.25) { hold = { [back]: true }; holdT = 10 + Math.floor(R() * 8); return { ...hold }; }
    if (r < 0.19 + L.agg * 0.12 && near) { f.aiSpecial = f.id === 'bebop' ? 'xup' : 'flog'; return {}; }
    // выбор удара из тех, что достают; у самого края дальности — только самые длинные
    const can = KIT.filter((k) => reach(f.id, k.n) >= gap + 2);
    if (!can.length) { walk = 12; return { [fwd]: true }; }
    let sum = 0; for (const k of can) sum += k.w;
    let q = R() * sum, k = can[0];
    for (const c of can) { q -= c.w; if (q <= 0) { k = c; break; } }
    return doPress(k.btn, k.hold ? { [k.hold === 'back' ? back : k.hold]: true } : {});
  };
}
