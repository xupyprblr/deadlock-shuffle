// Генерация звуков «Казино билдов» через ElevenLabs Sound Effects → sound/gen/<имя>-<вариант>.mp3 (папка sound/ не в git).
// Ключ: переменная ELEVENLABS_API_KEY, файл ~/.elevenlabs.key или sound/elven.key (sound/ в .gitignore; в git ключ не класть!).
// Запуск: node slot_machine/sfx.mjs [имя ...] [--n 3]   — без имён генерирует всё из SFX.
// Лучшие варианты потом копируются в sound/casino/<имя>.mp3 и перегоняются python -I slot_machine/snd.py.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Описания под сайт и игру: старый латунный игровой автомат в стиле ар-деко из оккультного Нью-Йорка 1930-х
// (Deadlock: джаз-эпоха, нуар, магия, души-валюта). Чем выше редкость — тем больше «латуни», джаза и мистики.
// ElevenLabs лучше слушается конкретики: предметы, инструменты, материал, а не абстракции вроде «ощущение триумфа».
const STYLE = 'Single short sound effect for a vintage 1930s brass slot machine in an occult art deco New York. No speech, no singing.';
const SFX = {
  'win-trash': [1.8, `${STYLE} Losing result: a muted jazz trombone plays a sad comedic "wah wah" falling slide, followed by a dull mechanical clunk of the old slot machine. Dry and funny.`],
  'win-common': [1.0, `${STYLE} A single plain ding of a small brass service bell on a wooden counter, with a soft mechanical click before it. Short, dry, modest.`],
  'win-unique': [1.4, `${STYLE} Old mechanical cash register: crank click, drawer slides open and a bright brass bell rings twice. Pleasant small reward.`],
  'win-rare': [2.2, `${STYLE} Glowing glass soul orb is collected: a clear magical glass chime with a soft whoosh, a gentle low hum underneath and a shimmering sparkle tail. Mysterious and satisfying.`],
  'win-ultra': [3.0, `${STYLE} Occult magic reward: a fast rising celesta arpeggio over a dark pipe organ swell, ending on a heavy brass gong hit with ghostly shimmering reverb.`],
  'win-jackpot': [4.0, `${STYLE} JACKPOT: the slot machine alarm bell rings rapidly, a 1930s big band brass section blasts a short triumphant fanfare stab with a big bass drum hit, then a magical golden shimmer with a long reverb tail.`],
  coins: [3.0, `${STYLE} Payout: a pile of heavy brass casino tokens pours out of the slot machine and clatters into a metal tray, loud metallic jingling that slowly settles.`],
  // автомат: выигрыш звучит дольше, чем вскрытие карты в лутбоксе (там карты идут подряд и короткий звук лучше)
  'slot-unique': [2.6, `${STYLE} Small slot machine win: the reels stop with a clack, an old electromechanical bell rings a cheerful short pattern, a few brass tokens drop into the metal tray, a light sparkle at the end.`],
  'slot-rare': [3.6, `${STYLE} Good slot machine win: an electromechanical bell rings steadily, a magical glass chime rises like a glowing soul orb being collected, a handful of brass coins clink into the metal tray, shimmering mysterious tail.`],
  'slot-ultra': [4.6, `${STYLE} Big slot machine win: rapid bell ringing, a rising celesta arpeggio over a dark pipe organ swell, a heavy brass gong hit, then brass coins pour into the metal tray under a ghostly occult reverb tail.`],
};

const args = process.argv.slice(2);
const nIdx = args.indexOf('--n');
const N = nIdx >= 0 ? Math.max(1, Math.min(6, +args[nIdx + 1] || 3)) : 3;
const names = args.filter((a, i) => !a.startsWith('--') && (nIdx < 0 || i !== nIdx + 1));
const todo = names.length ? names : Object.keys(SFX);

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const files = [path.join(os.homedir(), '.elevenlabs.key'), 'sound/elven.key', 'sound/elven.key.txt']; // sound/ в .gitignore
  for (const f of files) if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim();
  console.error('Нет ключа: задай ELEVENLABS_API_KEY или положи ключ в ' + files.join(' или '));
  process.exit(1);
}

const key = apiKey();
const OUT = 'sound/gen';
fs.mkdirSync(OUT, { recursive: true });
for (const name of todo) {
  const spec = SFX[name];
  if (!spec) { console.error('нет такого звука: ' + name); continue; }
  const [dur, text] = spec;
  for (let v = 1; v <= N; v++) {
    const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, duration_seconds: dur, prompt_influence: 0.75 }),
    });
    if (!res.ok) { console.error(`${name}-${v}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`); process.exit(2); }
    const buf = Buffer.from(await res.arrayBuffer());
    const file = path.join(OUT, `${name}-${v}.mp3`);
    fs.writeFileSync(file, buf);
    console.log(`${file} ${(buf.length / 1024).toFixed(0)} KB`);
  }
}
