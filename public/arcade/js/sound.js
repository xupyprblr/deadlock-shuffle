// Звук аркады: эффекты, музыка и диктор. Всё синтезируется в браузере (Web Audio), файлов не нужно.
// Любой звук можно заменить файлом: положить его в public/arcade/snd/ и вписать в FILES ниже —
// тогда вместо синтеза играет файл (ogg или mp3). Имена эффектов — ключи SFX, музыка — music_menu и music_fight (зациклены),
// диктор — v_round1..v_round3, v_fight, v_ko, v_time, v_draw, v_win_bebop, v_win_lash, v_flawless.
const FILES = {
  // hit: 'snd/hit.ogg',
  // music_fight: 'snd/fight.ogg',
};
const VOL = { master: 1.4, sfx: 0.9, music: 0.4, voice: 1 }; // громкость шин

let AC = null, bus = null, noiseBuf = null, armed = false, on = { sound: true, music: true, voice: true };
const bufs = {};

function ctx() {
  if (!on.sound || !armed) return null; // до первого нажатия браузер звук не разрешает
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    const comp = AC.createDynamicsCompressor(), master = AC.createGain();
    master.gain.value = VOL.master; master.connect(comp).connect(AC.destination);
    bus = {};
    for (const k of ['sfx', 'music', 'voice']) { bus[k] = AC.createGain(); bus[k].gain.value = VOL[k]; bus[k].connect(master); }
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (const [k, url] of Object.entries(FILES)) fetch(url).then((r) => r.arrayBuffer()).then((b) => AC.decodeAudioData(b)).then((b) => { bufs[k] = b; if (k === 'music_' + track) music(track, true); }).catch(() => {});
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function file(name, dest, loop = false) {
  const s = AC.createBufferSource(); s.buffer = bufs[name]; s.loop = loop; s.connect(dest); s.start(); return s;
}

// ---------- кирпичики синтеза ----------
const hz = (m) => 440 * 2 ** ((m - 69) / 12); // нота MIDI → частота
// тон: частота f0 → f1 за dur секунд, огибающая с атакой; cut — срез фильтра
function tone(f0, dur, { type = 'square', vol = 0.08, f1 = f0, at = 0, attack = 0.004, cut = 0, dest = bus.sfx, detune = 0 } = {}) {
  const t = AC.currentTime + at, o = AC.createOscillator(), v = AC.createGain();
  o.type = type; o.detune.value = detune; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(vol, t + attack); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let n = o;
  if (cut) { const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; n = o.connect(f); }
  n.connect(v).connect(dest); o.start(t); o.stop(t + dur + 0.03);
}
// шум через фильтр: freq → freq1
function noise(dur, { vol = 0.2, freq = 1200, freq1 = freq, type = 'lowpass', q = 1, at = 0, attack = 0.002, dest = bus.sfx } = {}) {
  const t = AC.currentTime + at, s = AC.createBufferSource(), f = AC.createBiquadFilter(), v = AC.createGain();
  s.buffer = noiseBuf; s.loop = true; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
  if (freq1 !== freq) f.frequency.exponentialRampToValueAtTime(freq1, t + dur);
  v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(vol, t + attack); v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(v).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.03);
}

// ---------- эффекты ----------
const SFX = {
  // бой
  swing: (e) => (e?.heavy ? noise(0.16, { vol: 0.5, freq: 900, freq1: 2600, type: 'bandpass', q: 2 }) : noise(0.08, { vol: 0.35, freq: 1800, freq1: 3600, type: 'bandpass', q: 2 })),
  hit: () => { noise(0.09, { vol: 0.3, freq: 1400, freq1: 500 }); tone(170, 0.09, { vol: 0.12, f1: 70, type: 'triangle' }); tone(900, 0.03, { vol: 0.05 }); },
  hitH: () => { noise(0.2, { vol: 0.42, freq: 1100, freq1: 250 }); tone(120, 0.2, { vol: 0.2, f1: 38, type: 'sine' }); tone(240, 0.07, { vol: 0.09, f1: 90 }); noise(0.05, { vol: 0.15, freq: 5000, type: 'highpass' }); },
  block: () => { tone(980, 0.06, { vol: 0.07, f1: 620 }); tone(1470, 0.05, { vol: 0.04, f1: 900, type: 'triangle' }); noise(0.05, { vol: 0.12, freq: 3200, type: 'highpass' }); },
  jump: () => noise(0.12, { vol: 0.06, freq: 500, freq1: 1500, type: 'bandpass', q: 1.5 }),
  land: () => { noise(0.12, { vol: 0.2, freq: 320 }); tone(80, 0.1, { vol: 0.1, f1: 45, type: 'sine' }); },
  whoosh: () => noise(0.26, { vol: 0.16, freq: 600, freq1: 2200, type: 'bandpass', q: 1.2 }),
  ko: () => { noise(0.9, { vol: 0.45, freq: 900, freq1: 90 }); tone(90, 0.9, { vol: 0.3, f1: 28, type: 'sine' }); tone(440, 0.5, { vol: 0.06, f1: 110, type: 'sawtooth', cut: 1500 }); },
  // способности Bebop
  special: () => { tone(660, 0.08, { vol: 0.05 }); tone(990, 0.1, { vol: 0.04, at: 0.05 }); },
  chain: () => { for (let i = 0; i < 7; i++) tone(520 + i * 35, 0.03, { vol: 0.05, at: i * 0.035, type: 'sawtooth' }); noise(0.3, { vol: 0.08, freq: 3000, type: 'highpass' }); },
  throw: () => { tone(380, 0.14, { vol: 0.09, f1: 620, type: 'triangle' }); noise(0.1, { vol: 0.07, freq: 2000, type: 'highpass' }); },
  stick: () => { tone(1500, 0.04, { vol: 0.07 }); tone(1500, 0.04, { vol: 0.07, at: 0.11 }); tone(1900, 0.06, { vol: 0.07, at: 0.22 }); },
  boom: () => { noise(0.55, { vol: 0.5, freq: 1600, freq1: 120 }); tone(75, 0.5, { vol: 0.32, f1: 26, type: 'sine' }); noise(0.08, { vol: 0.2, freq: 6000, type: 'highpass' }); },
  charge: () => { tone(110, 0.66, { vol: 0.1, f1: 880, type: 'sawtooth', cut: 2400, attack: 0.3 }); noise(0.66, { vol: 0.07, freq: 400, freq1: 5000, type: 'bandpass', q: 3, attack: 0.4 }); },
  beam: () => { tone(160, 1.4, { vol: 0.16, f1: 120, type: 'sawtooth', cut: 1800 }); tone(163, 1.4, { vol: 0.12, f1: 121, type: 'square', cut: 1200, detune: 14 }); noise(1.4, { vol: 0.22, freq: 2400, freq1: 900, type: 'bandpass', q: 0.7 }); tone(1300, 0.25, { vol: 0.06, f1: 300 }); },
  // способности Lash
  whip: () => { noise(0.1, { vol: 0.1, freq: 900, freq1: 6000, type: 'bandpass', q: 3 }); noise(0.03, { vol: 0.3, freq: 5000, type: 'highpass', at: 0.1 }); tone(2400, 0.04, { vol: 0.05, f1: 700, at: 0.1, type: 'sawtooth' }); },
  grab: () => { tone(200, 0.18, { vol: 0.12, f1: 520, type: 'sawtooth', cut: 1600 }); noise(0.16, { vol: 0.12, freq: 1500, type: 'bandpass' }); },
  slam: () => { noise(0.3, { vol: 0.48, freq: 900, freq1: 140 }); tone(95, 0.3, { vol: 0.3, f1: 30, type: 'sine' }); },
  heal: () => { for (const [i, m] of [76, 81, 88].entries()) tone(hz(m), 0.22, { vol: 0.05, at: i * 0.06, type: 'sine' }); },
  ult: () => { tone(70, 0.7, { vol: 0.25, f1: 35, type: 'sine' }); noise(0.5, { vol: 0.14, freq: 6000, freq1: 500, type: 'bandpass', q: 2 }); for (const [i, m] of [57, 64, 69].entries()) tone(hz(m), 0.5, { vol: 0.06, at: i * 0.04, type: 'sawtooth', cut: 2200 }); },
  // раунд и меню
  gong: () => { for (const [f, v] of [[98, 0.2], [147, 0.1], [233, 0.06], [392, 0.03]]) tone(f, 1.6, { vol: v, type: 'sine', f1: f * 0.985 }); noise(0.6, { vol: 0.06, freq: 4000, freq1: 800, type: 'bandpass' }); },
  go: () => { tone(110, 0.3, { vol: 0.2, f1: 55, type: 'sine' }); noise(0.2, { vol: 0.2, freq: 3000, freq1: 400 }); for (const m of [64, 71, 76]) tone(hz(m), 0.3, { vol: 0.05, type: 'sawtooth', cut: 3000 }); },
  tick: () => tone(1100, 0.05, { vol: 0.05, type: 'square' }),
  combo: (e) => tone(hz(72 + Math.min(12, (e?.n || 2) * 2)), 0.09, { vol: 0.05, type: 'triangle' }),
  ui: () => tone(620, 0.04, { vol: 0.04, type: 'triangle' }),
  uiGo: () => { tone(440, 0.08, { vol: 0.06, type: 'triangle' }); tone(660, 0.14, { vol: 0.06, at: 0.07, type: 'triangle' }); },
  win: () => { for (const [i, m] of [64, 68, 71, 76, 80, 83, 88].entries()) tone(hz(m), i === 6 ? 1.1 : 0.2, { vol: 0.08, at: i * 0.11, type: 'square', cut: 3200 }); for (const m of [52, 59, 64]) tone(hz(m), 1.3, { vol: 0.07, at: 0.66, type: 'sawtooth', cut: 1400 }); },
  lose: () => { for (const [i, m] of [67, 64, 60, 59, 55].entries()) tone(hz(m), i === 4 ? 1.2 : 0.3, { vol: 0.07, at: i * 0.26, type: 'triangle' }); tone(hz(40), 1.6, { vol: 0.12, at: 1.0, type: 'sine' }); },
};
export function sfx(name, e) {
  if (!ctx()) return;
  if (bufs[name]) file(name, bus.sfx); else SFX[name]?.(e);
}

// ---------- музыка: пошаговый секвенсор, 16 шагов на такт ----------
// chords — аккорд на такт [бас (MIDI), ноты аккорда]; lead — мелодия по восьмым (0 — пауза); drums — на каких шагах такта бьёт инструмент.
const _ = 0;
const TRACKS = {
  // меню: медленно и тревожно, ре минор
  menu: {
    bpm: 76, bars: 8,
    chords: [[38, [62, 65, 69]], [38, [62, 65, 69]], [34, [58, 62, 65]], [34, [58, 62, 65]], [31, [58, 62, 67]], [31, [58, 62, 67]], [33, [57, 61, 64]], [33, [57, 61, 67]]],
    lead: [[81, _, _, _, _, _, 77, _], [_, _, 74, _, _, _, _, _], [77, _, _, _, 74, _, _, _], [_, _, _, _, 70, _, 74, _], [79, _, _, _, _, _, 74, _], [_, _, 70, _, _, _, _, _], [76, _, _, _, 73, _, _, _], [_, _, 69, _, 73, _, 76, _]],
    drums: { kick: [0], hat: [4, 12] },
    step(tr, bar, s, t, d) {
      const [root, ch] = tr.chords[bar];
      if (s === 0) { // подклад: аккорд на весь такт, бас
        for (const [i, m] of ch.entries()) for (const det of [-7, 7]) tone(hz(m - 12), d * 16.5, { type: 'sawtooth', vol: 0.028, at: t, attack: 0.5, cut: 700, dest: bus.music, detune: det + i });
        tone(hz(root), d * 15, { type: 'triangle', vol: 0.16, at: t, attack: 0.05, dest: bus.music });
      }
      if (s % 2 === 0) { const i = (s / 2) % 6, m = ch[[0, 1, 2, 1, 2, 1][i]] + ([3, 4].includes(i) ? 12 : 0); tone(hz(m), d * 2.4, { type: 'triangle', vol: 0.045, at: t, dest: bus.music }); } // перебор
      const m = s % 2 === 0 && tr.lead[bar][s / 2];
      if (m) { tone(hz(m), 1.4, { type: 'sine', vol: 0.07, at: t, dest: bus.music }); tone(hz(m + 12), 0.5, { type: 'sine', vol: 0.02, at: t, dest: bus.music }); } // колокольчик
    },
  },
  // бой: быстро и напористо, ми минор; мелодия вступает на втором круге
  fight: {
    bpm: 132, bars: 8,
    chords: [[40, [64, 67, 71]], [40, [64, 67, 71]], [36, [60, 64, 67]], [38, [62, 66, 69]], [40, [64, 67, 71]], [43, [62, 67, 71]], [36, [60, 64, 67]], [35, [59, 63, 66]]],
    lead: [[76, _, 79, _, 76, 74, 71, _], [74, _, 76, _, _, _, 71, 74], [76, _, 79, _, 81, 79, 76, _], [78, _, 74, _, _, _, 69, 74], [76, _, 83, _, 81, 79, 76, _], [79, _, 74, _, 71, _, 74, 79], [76, _, 72, _, 67, _, 72, 76], [75, _, 71, _, 78, _, 75, 71]],
    drums: { kick: [0, 6, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [14] },
    step(tr, bar, s, t, d, loop) {
      const [root, ch] = tr.chords[bar];
      if (s % 2 === 0) { const m = root + [0, 0, 12, 0, 0, 7, 12, 0][s / 2]; tone(hz(m), d * 1.7, { type: 'sawtooth', vol: 0.13, at: t, cut: 520, dest: bus.music }); } // бас восьмыми
      if (s === 0 || s === 6 || s === 12) for (const m of ch) tone(hz(m), d * 2.6, { type: 'square', vol: 0.022, at: t, cut: 1800, dest: bus.music }); // уколы аккордом
      if (loop % 2 === 0) { if (s % 4 === 2) tone(hz(ch[(s >> 2) % 3] + 12), d * 1.5, { type: 'triangle', vol: 0.04, at: t, dest: bus.music }); } // первый круг — перебор
      else { const m = s % 2 === 0 && tr.lead[bar][s / 2]; if (m) { tone(hz(m), d * 2.2, { type: 'square', vol: 0.05, at: t, cut: 2600, dest: bus.music }); tone(hz(m), d * 2.2, { type: 'sawtooth', vol: 0.025, at: t, cut: 2000, dest: bus.music, detune: 9 }); } }
      if (bar === 7 && s >= 12) drum('snare', t, 0.7); // сбивка в конце круга
    },
  },
};
function drum(k, t, v = 1) {
  const dest = bus.music;
  if (k === 'kick') { tone(150, 0.16, { type: 'sine', vol: 0.34 * v, f1: 42, at: t, dest }); }
  else if (k === 'snare') { noise(0.13, { vol: 0.16 * v, freq: 1800, type: 'bandpass', q: 0.7, at: t, dest }); tone(190, 0.08, { type: 'triangle', vol: 0.08 * v, f1: 120, at: t, dest }); }
  else if (k === 'hat') noise(0.035, { vol: 0.045 * v, freq: 7500, type: 'highpass', at: t, dest });
  else if (k === 'open') noise(0.16, { vol: 0.045 * v, freq: 6500, type: 'highpass', at: t, dest });
}

let track = null, timer = 0, step = 0, nextT = 0, loopSrc = null;
function tickMusic() {
  if (!AC || !track || AC.state !== 'running') return;
  const tr = TRACKS[track], d = 60 / tr.bpm / 4;
  if (nextT < AC.currentTime) nextT = AC.currentTime + 0.05; // после паузы вкладки не догоняем пропущенное
  while (nextT < AC.currentTime + 0.15) {
    const at = nextT - AC.currentTime, s = step % 16, bar = Math.floor(step / 16) % tr.bars, loop = Math.floor(step / 16 / tr.bars);
    for (const [k, steps] of Object.entries(tr.drums)) if (steps.includes(s)) drum(k, at);
    tr.step(tr, bar, s, at, d, loop);
    step++; nextT += d;
  }
}
// Включить музыку: 'menu', 'fight' или null — тишина.
export function music(name, restart = false) {
  if (name === track && !restart) return;
  track = name; step = 0; nextT = 0;
  clearInterval(timer); timer = 0;
  if (loopSrc) { try { loopSrc.stop(); } catch {} loopSrc = null; }
  if (!name || !on.music || !ctx()) return;
  bus.music.gain.cancelScheduledValues(AC.currentTime); bus.music.gain.setValueAtTime(VOL.music, AC.currentTime);
  if (bufs['music_' + name]) loopSrc = file('music_' + name, bus.music, true);
  else timer = setInterval(tickMusic, 25);
}
// Приглушить музыку (пауза, нокаут) или вернуть громкость.
export function duck(low) { if (AC) bus.music.gain.setTargetAtTime(low ? VOL.music * 0.25 : VOL.music, AC.currentTime, 0.12); }

// ---------- диктор: голос браузера (если есть русский), файл из FILES — если задан ----------
let ruVoice = null;
function pickVoice() {
  const vs = window.speechSynthesis?.getVoices() || [];
  ruVoice = vs.find((v) => /^ru/i.test(v.lang) && /male|муж|pavel|dmitr|yuri|maxim/i.test(v.name)) || vs.find((v) => /^ru/i.test(v.lang)) || null;
}
if (typeof window !== 'undefined' && window.speechSynthesis) { pickVoice(); window.speechSynthesis.addEventListener?.('voiceschanged', pickVoice); }
// key — имя реплики для файла (v_fight), text — что произнести голосом браузера.
export function say(key, text) {
  if (!on.voice || !ctx()) return;
  if (bufs[key]) { file(key, bus.voice); return; }
  if (!ruVoice) return;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = ruVoice; u.lang = ruVoice.lang; u.pitch = 0.55; u.rate = 0.95; u.volume = 1;
  window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
}

// ---------- настройки ----------
// Включить и выключить части звука: { sound, music, voice }. Первый вызов после жеста пользователя запускает звук.
export function setSound(opts) {
  const was = track;
  Object.assign(on, opts);
  if (!on.sound || !on.voice) window.speechSynthesis?.cancel();
  if (!on.sound || !on.music) { track = null; music(null, true); track = was; } // музыку глушим, но помним, что играло
  else if (was && !timer && !loopSrc) { track = null; music(was); }
}
// Разбудить звук по первому нажатию (браузеры не дают играть без жеста).
export function unlock() { armed = true; if (ctx() && track && on.music && !timer && !loopSrc) { const t = track; track = null; music(t); } }
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (AC) { if (document.hidden) AC.suspend(); else if (on.sound) AC.resume(); } });
