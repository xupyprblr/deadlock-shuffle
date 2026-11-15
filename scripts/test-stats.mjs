// Тест счётчика статистики (stats/worker.js) на базе в памяти: node scripts/test-stats.mjs
import assert from 'node:assert/strict';
import worker, { parseHit, cleanVal, EVENTS, dayOf, isBot, cleanEgg, EGG_DEFAULT } from '../stats/worker.js';
import { memDB } from '../stats/memdb.mjs';

// чистка значений
assert.equal(cleanVal('Lady Geist'), 'Lady Geist');
assert.equal(cleanVal("Mo & Krill"), 'Mo & Krill');
assert.equal(cleanVal(3), '3');
assert.equal(cleanVal('<script>'), null);
assert.equal(cleanVal('https://x.y/'), null);
assert.equal(cleanVal({}), null);
assert.equal(cleanVal('a'.repeat(80)).length, 40);

// разбор тела
assert.equal(parseHit('not json'), null);
assert.equal(parseHit(JSON.stringify({ env: 'prod', ev: 'roll' })), null, 'неизвестный env');
assert.equal(parseHit(JSON.stringify({ env: 'main', ev: 'Hack me!' })), null, 'кривое имя события');
assert.equal(parseHit(JSON.stringify({ env: 'main', ev: 'x'.repeat(31) })), null, 'слишком длинное имя');
assert.deepEqual(parseHit(JSON.stringify({ env: 'main', ev: 'setting', p: { k: 'lang' } })).rows, [['', '']], 'не из белого списка — только итог');
assert.deepEqual(parseHit(JSON.stringify({ env: 'main', ev: 'constructor', p: { a: 1 } })).rows, [['', '']], 'имя из прототипа — без разрезов');
assert.equal(parseHit('x'.repeat(2000)), null, 'слишком большое тело');
assert.equal(parseHit(JSON.stringify({ env: 'main', ev: 'visitor' })), null, 'посетителей с сайта не накрутить');
const h = parseHit(JSON.stringify({ env: 'dev', ev: 'slots_spin', p: { mode: 'slot', rarity: 'legendary', got: 'Bebop', secret: 'x', kind: '<b>' } }));
assert.deepEqual(h.rows, [['', ''], ['mode', 'slot'], ['mode+rarity', 'slot|legendary'], ['got', 'Bebop']], 'лишнее и мусор отброшены, составной разрез');
assert.deepEqual(parseHit(JSON.stringify({ env: 'main', ev: 'to_game', p: { from: 'slots' } })).rows, [['', ''], ['from', 'slots']], 'составной разрез без второй части не пишется');
assert.ok(isBot('Mozilla/5.0 HeadlessChrome/140') && isBot('Googlebot/2.1') && isBot('') && !isBot('Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537.36'));
for (const dims of Object.values(EVENTS)) assert.ok(dims.length <= 5, 'на событие не больше 6 строк');

// весь путь через fetch
const env = { DB: memDB(), ADMIN_TOKEN: 'secret-token', VISIT_SALT: 'salt' };
const O = 'https://randomlock.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537.36';
const post = (body, origin = O, h = {}) => worker.fetch(new Request('https://s/hit', { method: 'POST', headers: { 'User-Agent': UA, ...(origin ? { Origin: origin } : {}), ...h }, body: JSON.stringify(body) }), env);
assert.equal((await post({ env: 'main', ev: 'roll', p: { team: 0, hero: 'Haze' } })).status, 204);
assert.equal((await post({ env: 'main', ev: 'roll', p: { team: 1, hero: 'Haze' } })).status, 204);
assert.equal((await post({ env: 'main', ev: 'to_game', p: { from: 'slots', mode: 'box', rarity: 'rare', hero: 'Vyper' } })).status, 204);
// посетители: два просмотра с одного адреса — один посетитель; другой адрес — второй; бот не считается
const pv = (ip, ua = UA) => post({ env: 'main', ev: 'pageview', p: { page: 'slots' } }, O, { 'CF-Connecting-IP': ip, 'User-Agent': ua });
await pv('1.1.1.1'); await pv('1.1.1.1'); await pv('2.2.2.2'); await pv('3.3.3.3', 'Mozilla/5.0 HeadlessChrome/140');
assert.ok([...env.DB.seen].every((k) => !k.includes('1.1.1.1')), 'IP в базе не хранится, только отпечаток');
assert.equal((await post({ env: 'dev', ev: 'roll', p: {} })).status, 204);
assert.equal((await post({ env: 'main', ev: 'roll' }, 'https://evil.example')).status, 403, 'чужой сайт');
assert.equal((await post({ env: 'main', ev: 'No pe' })).status, 400);

const get = (token, q = 'env=main&days=7') => worker.fetch(new Request('https://s/stats?' + q, { headers: { Origin: O, ...(token ? { Authorization: 'Bearer ' + token } : {}) } }), env);
assert.equal((await get()).status, 401, 'без ключа');
assert.equal((await get('wrong-token!')).status, 401, 'неверный ключ');
const r = await get('secret-token');
assert.equal(r.status, 200);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), O);
const s = await r.json();
assert.equal(s.to, dayOf());
const total = (ev) => s.daily.filter((x) => x.ev === ev).reduce((a, x) => a + x.n, 0);
const dim = (ev, d, v) => (s.dims.find((x) => x.ev === ev && x.dim === d && x.val === v) || { n: 0 }).n;
assert.equal(total('roll'), 2, 'dev не смешивается с main');
assert.equal(dim('roll', 'hero', 'Haze'), 2);
assert.equal(dim('roll', 'team', '1'), 1);
assert.equal(dim('to_game', 'mode', 'box'), 1);
assert.equal(dim('to_game', 'from+hero', 'slots|Vyper'), 1);
assert.equal(total('pageview'), 3, 'просмотры без бота');
assert.equal(total('visitor'), 2, 'уникальные посетители');
assert.equal(dim('pageview', 'page', 'slots'), 3);
const sd = await (await get('secret-token', 'env=dev&days=1')).json();
assert.equal(sd.daily.reduce((a, x) => a + x.n, 0), 1);

// пул пасхалки
assert.deepEqual(cleanEgg([{ id: 5, ru: ' Привет <b> ', en: '' }]), [{ id: 5, ru: 'Привет b', en: 'Привет b' }], 'текст чистится, пустой EN берёт RU');
assert.equal(cleanEgg([{ id: 'x', ru: 'a' }]), null);
assert.equal(cleanEgg([{ id: 1 }]), null, 'без текста нельзя');
assert.equal(cleanEgg('nope'), null);
const eggReq = (method, q, body, token) => worker.fetch(new Request('https://s/egg?' + q, { method, headers: { Origin: O, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body }), env);
assert.deepEqual((await (await eggReq('GET', 'env=main')).json()).pool, EGG_DEFAULT, 'по умолчанию — встроенный пул');
assert.equal((await eggReq('PUT', 'env=dev', JSON.stringify({ pool: [{ id: 7, ru: 'ТЕСТ', en: 'TEST' }] }))).status, 401, 'без ключа не сохранить');
assert.equal((await eggReq('PUT', 'env=dev', JSON.stringify({ pool: [{ id: 7, ru: 'ТЕСТ', en: 'TEST' }] }), 'secret-token')).status, 200);
assert.deepEqual((await (await eggReq('GET', 'env=dev')).json()).pool, [{ id: 7, ru: 'ТЕСТ', en: 'TEST' }]);
assert.deepEqual((await (await eggReq('GET', 'env=main')).json()).pool, EGG_DEFAULT, 'main и dev раздельно');

console.log('OK: счётчик статистики (белый список, составные разрезы, посетители без IP, ключ, Origin, main/dev)');
