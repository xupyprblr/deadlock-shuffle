# Счётчик статистики RANDOMLOCK

Cloudflare Worker + база D1 (бесплатный тариф). Сайт шлёт события (`track()` в `public/js/analytics.js` → `POST /hit`),
админка `public/admin/` показывает их по ключу (`GET /stats`). Хранятся только итоги «день × событие × значение → сколько раз»:
без cookies, без IP и личных данных. Работает и для основного сайта (`env=main`), и для /dev/ (`env=dev`).

| Файл | Что |
|---|---|
| `worker.js` | сам Worker: белый список событий и разрезов (`EVENTS`), чистка значений, лимит частоты, проверка ключа |
| `schema.sql` | таблица `hits` |
| `wrangler.toml` | имя Worker, привязки D1 и лимита частоты |
| `memdb.mjs`, `dev.mjs` | база в памяти и локальный сервер для разработки: `node stats/dev.mjs` → http://localhost:8787, ключ `dev` |

Тест: `node scripts/test-stats.mjs`.

Уникальные посетители: событие `pageview` → отпечаток sha256(соль дня + IP + браузер) в таблице `visitors`
(только на текущие сутки, старые Worker удаляет сам) → счётчик `visitor` за день. Соль — секрет `VISIT_SALT`
(`npx wrangler secret put VISIT_SALT`, любая длинная случайная строка). Боты и headless-браузеры не считаются.

## Где развёрнуто
https://randomlock-stats.randomlock.workers.dev — аккаунт Cloudflare Алекса, база D1 `randomlock-stats`.
Ключ админки — `stats/.admin-token` (не в git).

## Развёртывание (один раз)
Нужен бесплатный аккаунт Cloudflare. Команды из папки `stats/`:

1. `npx wrangler login` — откроется браузер, войти в Cloudflare.
2. `npx wrangler d1 create randomlock-stats` — выведет `database_id`, вписать его в `wrangler.toml`.
3. `npx wrangler d1 execute randomlock-stats --remote --file schema.sql` — создать таблицу.
4. `npx wrangler secret put ADMIN_TOKEN` — ключ админки (длинная случайная строка; хранить у себя, в git не класть).
5. `npx wrangler deploy` — выведет адрес вида `https://randomlock-stats.<аккаунт>.workers.dev`.
6. Этот адрес вписать:
   - в `STATS_URL` в `public/js/analytics.js`;
   - в CSP `connect-src` страниц `index.html`, `slots.html`, `my.html`, `lab/builds.html`, `admin/index.html`.

Обновить Worker после правок `worker.js`: `npx wrangler deploy`.

## Ограничения бесплатного тарифа
- D1: около 100 тыс. записанных строк в сутки. Одно событие пишет до 6 строк → примерно 15 тыс. событий в сутки.
- Workers: 100 тыс. запросов в сутки.
При превышении лишние события просто не посчитаются, сайт работает как обычно.

## Добавить событие или разрез
Любое событие с именем `[a-z0-9_]` считается итогом автоматически. Чтобы считать разрез по параметру
(например, герою), добавить имя параметра в `EVENTS` в `worker.js` и выкатить Worker. Не больше 5 разрезов на событие.
