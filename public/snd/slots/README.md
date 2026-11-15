# Звуки «Казино билдов»

Подключаются в `public/js/slots-sound.js` (таблица `FILES`); всё, чего здесь нет, синтезируется в браузере.
Исходники лежат в `sound/` (не в git): `sound/casino/` — присланные Алексом, `sound/gen/` — генерации ElevenLabs
(`node slot_machine/sfx.mjs`, описания звуков там же). Сюда их перегоняет `python -I slot_machine/snd.py`
(mp3 моно 64 кбит/с, обрезка тишины, выравнивание громкости; нужен PyAV: `pip install av`).

| Файлы | Где звучит | Источник |
|---|---|---|
| `card-slide-1…8` | вылет карточек из лутбокса (`card-fly`) | Kenney, «Casino Audio», CC0 |
| `card-place-1, 2, 4` | переворот карточки (`card-flip`) | Kenney, «Casino Audio», CC0 |
| `win-trash`, `win-common`, `win-unique`, `win-rare`, `win-ultra`, `coins` | выпадение редкости, монеты джекпота | сгенерированы в ElevenLabs Sound Effects (бесплатный тариф: некоммерческое использование, с указанием ElevenLabs) |
| `slot-unique`, `slot-rare`, `slot-ultra` | выигрыш Unique / Rare / Ultra Rare в автомате (длиннее, чем у карт лутбокса) | сгенерированы в ElevenLabs Sound Effects (как выше) |
| `win-jackpot` | Legendary (и в автомате, и в лутбоксе) | прислал Алекс (источник и лицензию — уточнить) |

Если проект станет коммерческим — звуки ElevenLabs с бесплатного тарифа заменить (платный тариф или свой звуковой дизайн).
