// Код сборки для импорта в игру без аддонов.
// В редакторе сборок Deadlock есть кнопки «копировать» и «вставить» код сборки.
// Формат кода: base64( zstd( protobuf-сообщение сборки ) ). Valve его не документирует;
// схема полей взята из открытого проекта Deadlock Browser Build Maker (MIT, © 2026 Jonas Smith,
// github.com/JoniSmiff/Deadlock-Browser-Build-Maker). Игра принимает zstd-кадр
// без сжатия (raw block), поэтому компрессор не нужен.
//
// Сообщение сборки:
//   1 build_id (varint)  2 hero_id  5 name (string)  6 description  7 language  8 version
//   10 details { 1 category* { 1 mod* { 1 item_id  2 annotation  4 ?  5 imbue_target }
//                              2 name  3 description  4 width (float)  5 height (float)  6 optional }
//                2 ability_order { 1 change* { 1 ability_id  2 currency_type  3 delta (sint как int64) } } }
//   11 tag (varint, до 3)
// currency_type 2 — очко открытия способности, 1 — очки улучшения (−1, −2, −5).

export const MAX_BYTES = 16000; // с обновления 06.10.2026 игра не публикует сборки больше этого
export const UPGRADE_COST = [1, 2, 5];
// Системные названия разделов: игра сама переводит их на язык игрока
export const CATEGORY_KEYS = {
  early: '#Citadel_HeroBuilds_EarlyGame',
  mid: '#Citadel_HeroBuilds_MidGame',
  late: '#Citadel_HeroBuilds_LateGame',
};

const te = new TextEncoder();

class Writer {
  constructor() { this.a = []; }
  varint(v) {
    v = BigInt.asUintN(64, BigInt(v));
    while (v > 0x7fn) { this.a.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
    this.a.push(Number(v));
    return this;
  }
  V(f, v) { return this.varint(f << 3).varint(v); }
  B(f, bytes) {
    this.varint((f << 3) | 2).varint(bytes.length);
    for (const b of bytes) this.a.push(b);
    return this;
  }
  S(f, str) { return this.B(f, te.encode(str || '')); }
  F(f, x) {
    this.varint((f << 3) | 5);
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, x, true);
    for (const v of b) this.a.push(v);
    return this;
  }
  bytes() { return Uint8Array.from(this.a); }
}

// zstd-кадр с одним несжатым блоком
export function zstdRaw(p) {
  const n = p.length;
  let head;
  if (n <= 255) head = [0x20, n];
  else if (n <= 65791) head = [0x60, (n - 256) & 255, (n - 256) >> 8];
  else throw new Error('build too large');
  const bh = (n << 3) | 1; // last block, raw
  const out = new Uint8Array(4 + head.length + 3 + n);
  out.set([0x28, 0xb5, 0x2f, 0xfd], 0);
  out.set(head, 4);
  out.set([bh & 255, (bh >> 8) & 255, (bh >> 16) & 255], 4 + head.length);
  out.set(p, 7 + head.length);
  return out;
}

function toB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// Размеры раздела как у редактора игры: до 13 предметов в ряд
const PER_ROW = 13;
const ROW_H = 112.125;
const fitWidth = (n) => 12 + 81.75 * Math.min(Math.max(n, 1), PER_ROW);
const fitHeight = (n) => { const rows = Math.ceil(n / PER_ROW); return rows > 1 ? 178.5 + ROW_H * (rows - 1) : 0; };

/**
 * @param {object} b
 *   heroId, name, desc,
 *   categories: [{ name, items: [itemId, …] }],
 *   abilityOrder: [abilityIndex …] (16 шагов), abilityIds: [id ×4]
 */
export function buildPayload(b) {
  const details = new Writer();
  for (const c of b.categories) {
    const cw = new Writer();
    for (const id of c.items) cw.B(1, new Writer().V(1, id >>> 0).bytes());
    cw.S(2, c.name).S(3, c.desc || '').F(4, fitWidth(c.items.length));
    const h = fitHeight(c.items.length);
    if (h) cw.F(5, h);
    details.B(1, cw.bytes());
  }
  if (b.abilityOrder && b.abilityIds && b.abilityIds.length === 4) {
    const aw = new Writer();
    const seen = [0, 0, 0, 0];
    for (const idx of b.abilityOrder) {
      const k = seen[idx]++;
      const change = k === 0 ? [2, -1] : [1, -UPGRADE_COST[k - 1]]; // открытие или улучшение
      aw.B(1, new Writer().V(1, b.abilityIds[idx] >>> 0).V(2, change[0]).V(3, change[1]).bytes());
    }
    details.B(2, aw.bytes());
  }
  return new Writer().V(1, 1).V(2, b.heroId).S(5, b.name).S(6, b.desc || '').V(7, 0).V(8, 0).B(10, details.bytes()).bytes();
}

export function encodeBuildCode(b) {
  const p = buildPayload(b);
  if (p.length > MAX_BYTES) throw new Error('build too large');
  return toB64(zstdRaw(p));
}

// ---- Обратное чтение (для тестов и проверки) ----
function readVarint(d, pos) {
  let v = 0n, sh = 0n, c;
  do { c = d[pos.i++]; v |= BigInt(c & 0x7f) << sh; sh += 7n; } while (c & 0x80);
  return v;
}
function readFields(d) {
  const pos = { i: 0 }, out = [];
  while (pos.i < d.length) {
    const key = Number(readVarint(d, pos)), f = key >>> 3, w = key & 7;
    let v;
    if (w === 0) v = readVarint(d, pos);
    else if (w === 2) { const l = Number(readVarint(d, pos)); v = d.subarray(pos.i, pos.i + l); pos.i += l; }
    else if (w === 5) { v = d.subarray(pos.i, pos.i + 4); pos.i += 4; }
    else throw new Error('wire type ' + w);
    out.push({ f, w, v });
  }
  return out;
}

export function decodeBuildCode(code) {
  const bin = atob(code);
  const raw = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (raw[0] !== 0x28 || raw[1] !== 0xb5 || raw[2] !== 0x2f || raw[3] !== 0xfd) throw new Error('not zstd');
  const fhd = raw[4];
  const headLen = fhd === 0x20 ? 2 : fhd === 0x60 ? 3 : 0;
  const p = raw.subarray(4 + headLen + 3);
  const td = new TextDecoder();
  const b = { heroId: 0, name: '', desc: '', categories: [], changes: [] };
  for (const x of readFields(p)) {
    if (x.f === 2) b.heroId = Number(x.v);
    else if (x.f === 5) b.name = td.decode(x.v);
    else if (x.f === 6) b.desc = td.decode(x.v);
    else if (x.f === 10) {
      for (const y of readFields(x.v)) {
        if (y.f === 1) {
          const c = { name: '', items: [] };
          for (const z of readFields(y.v)) {
            if (z.f === 1) c.items.push(Number(readFields(z.v).find((m) => m.f === 1).v));
            else if (z.f === 2) c.name = td.decode(z.v);
          }
          b.categories.push(c);
        } else if (y.f === 2) {
          for (const z of readFields(y.v)) {
            const m = Object.fromEntries(readFields(z.v).map((q) => [q.f, q.v]));
            b.changes.push({ id: Number(m[1]), type: Number(m[2]), delta: Number(BigInt.asIntN(64, m[3])) });
          }
        }
      }
    }
  }
  return b;
}
