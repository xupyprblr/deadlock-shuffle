// Аркада «Подвальный бой»: персонажи, обычные удары, спецприёмы и зоны ударов. Без DOM — модуль можно гонять в Node (тесты).
// Координаты — внутреннее разрешение 384×216, ось Y вниз. x в ударах — «вперёд» по взгляду бойца.

export const W = 384, H = 216, FLOOR = 196;

// Позы бойцов лежат в anims.js: абсолютные углы в градусах. Корпус и голова: 0 — вверх, + — наклон вперёд.
// Руки и ноги: 0 — вниз, 90 — вперёд, 180 — вверх, отрицательные — назад. rot — поворот всего тела (−90 — лёжа на спине).

// Обычные удары. Кнопок атаки две: p — Рука, k — Нога; глубину дают направления (INPUTS ниже).
// s/a/r — кадры замаха, активной фазы и возврата (60 кадров = 1 с). dmg — урон, hs — оглушение при попадании, kb — отброс.
// adv — на столько px боец подаётся вперёд за замах, ret — на столько отходит за возврат, если удар никого не задел.
// lv — ступень в серии: удар, который попал или пришёл в блок, прерывается ударом с большим lv или спецприёмом (см. engine.js).
// kind: mid — обычный, low — держит только блок в приседе, over (из прыжка) — только стоячий блок. kd — сбивает с ног (скорость отлёта).
// crouch — удар из приседа; stand — заканчивается стоя. Зоны ударов — в HB, у каждого бойца свои.
export const MOVES = {
  p: { s: 6, a: 3, r: 10, dmg: 3, adv: 3, ret: 3, kind: 'mid', hs: 18, kb: 1.2, lv: 1 },
  k: { s: 9, a: 4, r: 14, dmg: 5, adv: 8, ret: 8, kind: 'mid', hs: 22, kb: 1.6, lv: 2 },
  fp: { s: 13, a: 4, r: 18, dmg: 6, adv: 26, kind: 'mid', hs: 26, kb: 2, lv: 3 },
  fk: { s: 15, a: 4, r: 20, dmg: 5, adv: 18, kind: 'low', hs: 27, kb: 1.4, lv: 3 },
  up: { s: 14, a: 6, r: 28, dmg: 10, adv: 6, kind: 'mid', hs: 36, kb: 1, kd: { vx: 1.3, vy: -5.7 }, crouch: true, stand: true, lv: 4 },
  sweep: { s: 15, a: 5, r: 26, dmg: 6, adv: 6, ret: 6, kind: 'low', hs: 25, kb: 1, kd: { vx: 0.8, vy: -2 }, crouch: true, lv: 4 },
  round: { s: 18, a: 5, r: 24, dmg: 8, adv: 10, ret: 10, kind: 'mid', hs: 25, kb: 3, kd: { vx: 2.1, vy: -3.2 }, lv: 4 },
  jp: { s: 6, a: 16, r: 0, dmg: 5, kind: 'over', hs: 20, kb: 1.6, air: true },
  jk: { s: 7, a: 18, r: 0, dmg: 7, kind: 'over', hs: 22, kb: 2, air: true },
};
// Какой удар выходит: кнопка + направление. Вниз важнее, чем вперёд и назад (↘ + Рука — апперкот).
export const INPUTS = {
  p: { n: 'p', f: 'fp', d: 'up', air: 'jp' },
  k: { n: 'k', f: 'fk', b: 'round', d: 'sweep', air: 'jk' },
};
export const BTNS = Object.keys(INPUTS);

// Удары бойца: общая таблица MOVES плюс свои поправки. У Bebop главный удар — шар: рука бьёт дальше и сильнее, но медленнее.
const OWN = { bebop: { p: { s: 7, adv: 8, ret: 8 } }, lash: {} };
export const MV = Object.fromEntries(Object.entries(OWN).map(([id, own]) => [id, Object.fromEntries(Object.entries(MOVES).map(([n, m]) => [n, { ...m, ...own[n] }]))]));

// Спецприёмы — способности героев. Последовательность: F — к сопернику, B — от него, D — вниз; btn — кнопка (p или k).
// Направления набираются быстро, последнее нажатое — последнее в комбинации; ult — нужна полная шкала.
// Порядок важен: проверяются сверху вниз (ульта ↓↓→ раньше приёма ↓→).
export const SPECIALS = {
  bebop: [
    { id: 'beam', seq: ['D', 'D', 'F'], btn: 'p', ult: true, name: 'Hyper Beam', icon: 'bebop/bebop_hyper_beam.webp', desc: 'Гигантский луч через весь экран. Нужна полная шкала.' },
    { id: 'hook', seq: ['B', 'F'], btn: 'p', name: 'Grapple Arm', icon: 'bebop/bebop_hook.webp', desc: 'Рука-захват: притягивает соперника, он на миг оглушён.' },
    { id: 'bomb', seq: ['D', 'F'], btn: 'p', name: 'Sticky Bomb', icon: 'bebop/bebop_sticky_bomb.webp', desc: 'Липкая бомба: цепляется и взрывается через секунду.' },
    { id: 'xup', seq: ['D', 'D'], btn: 'p', name: 'Exploding Uppercut', icon: 'bebop/bebop_uppercut.webp', desc: 'Взрывной апперкот, подбрасывает высоко.' },
  ],
  lash: [
    { id: 'slam', seq: ['D', 'D', 'F'], btn: 'p', ult: true, name: 'Death Slam', icon: 'lash/lash_counter_lash.webp', desc: 'Хлыст поднимает соперника и трижды бьёт о землю. Нужна полная шкала.' },
    { id: 'grap', seq: ['B', 'F'], btn: 'k', air: true, name: 'Grapple', icon: 'lash/lash_lash.webp', desc: 'Рывок на хлысте с ударом ногой. Можно в прыжке.' },
    { id: 'flog', seq: ['D', 'F'], btn: 'p', name: 'Flog', icon: 'lash/lash_flog.webp', desc: 'Хлыст на полэкрана, лечит Lash.' },
    { id: 'gstrike', hold: 'd', btn: 'k', airOnly: true, name: 'Ground Strike', icon: 'lash/lash_death_slam.webp', desc: 'В прыжке: удар о землю, урон растёт с высотой.' },
  ],
};

// Зоны ударов под нарисованные позы: кулак, шар или стопа в активной фазе лежат в зоне, зона выходит за арт не больше чем на 2 px.
// x — от точки опоры вперёд, y — от пола вверх (отрицательные). Зоны спецприёмов, которых нет в списке, — в SP (engine.js).
// Проверка: каждый обычный удар достаёт стоящего соперника с минимальной дистанции (тест в scripts/test-arcade.mjs).
const B = (x, y, w, h) => ({ x, y, w, h });
export const HB = {
  bebop: {
    p: B(10, -76, 39, 18), k: B(8, -44, 38, 16), fp: B(12, -76, 44, 26), fk: B(6, -22, 39, 14), round: B(8, -56, 37, 20),
    sweep: B(6, -22, 41, 14), up: B(0, -110, 44, 66), jp: B(14, -54, 33, 26), jk: B(8, -20, 33, 22), xup: B(0, -112, 44, 74),
  },
  lash: {
    p: B(10, -64, 35, 14), k: B(8, -45, 40, 14), fp: B(10, -58, 38, 16), fk: B(6, -22, 40, 14), round: B(8, -58, 39, 20),
    sweep: B(6, -22, 42, 14), up: B(2, -92, 38, 56), jp: B(10, -34, 31, 18), jk: B(8, -18, 34, 20), grap: B(10, -53, 32, 38),
  },
};

// Персонажи. walk — скорость ходьбы вперёд и назад, jump — толчок прыжка, push — полуширина тела для расталкивания
// (минимальная дистанция между бойцами — сумма их push), power — множитель урона обычных ударов: Bebop крупнее и медленнее,
// в него проще попасть, зато бьёт он тяжелее. Цвета col/alt остались от прототипа.
export const CHARS = {
  bebop: {
    name: 'Bebop', card: 'bebop_card.webp', small: 'bebop_sm.webp',
    dim: { th: 18, sh: 18, torso: 27, ua: 13, fa: 14, head: 8, w: 13 },
    walk: [1.2, 0.95], jump: 5.1, push: 30, power: 1.2,
    col: { body: '#d9622b', body2: '#a8441c', metal: '#4b4b52', yellow: '#f0b83a', cloth: '#8a7a4a', eye: '#60f0e8', ball: '#3a2a22' },
    alt: { body: '#5f8fd9', body2: '#3a5f9e', metal: '#3c3f4a', yellow: '#d9d9d9', cloth: '#4a4a3a', eye: '#ff6a4a', ball: '#262626' },
  },
  lash: {
    name: 'Lash', card: 'lash_card.webp', small: 'lash_sm.webp',
    dim: { th: 18, sh: 18, torso: 25, ua: 13, fa: 13, head: 8, w: 11 },
    walk: [1.35, 1.05], jump: 5.45, push: 26, power: 1,
    col: { skin: '#d39a72', shirt: '#3c6fb5', pants: '#3d3028', boot: '#6b3f22', hair: '#2a1c14', strap: '#5a3a1e', wrap: '#e8e0d0' },
    alt: { skin: '#c48a64', shirt: '#b53c3c', pants: '#2a2a30', boot: '#3a2a20', hair: '#5a3a1a', strap: '#2a1a10', wrap: '#ffd27a' },
  },
};
