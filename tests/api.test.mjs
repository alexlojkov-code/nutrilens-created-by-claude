/* Сквозные тесты серверной части (регистрация, вход, сессии, синхронизация, защита).
   Запуск против локального сервера разработки (node scripts/dev.mjs):
     node tests/api.test.mjs                 # http://localhost:3000
   Создаёт временные аккаунты e2e-…@example.com и удаляет их в конце, поэтому работает только
   с локальным адресом. */
const BASE = process.env.BASE || 'http://localhost:3000';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error('Только локальный сервер: ' + BASE); process.exit(2); }

const rnd = () => Math.random().toString(36).slice(2, 10);
const strongPw = () => 'Api-' + crypto.randomUUID();
const cleanup = []; // [cookieJar, password] для удаления аккаунтов в конце

class Client {
  constructor() { this.cookie = ''; this.lastSetCookie = ''; }
  async req(method, path, body, { headers = {}, raw = false } = {}) {
    const h = { 'x-nl': '1', ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (this.cookie) h.cookie = this.cookie;
    const res = await fetch(BASE + '/api/' + path, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) { this.lastSetCookie = sc; const v = sc.split(';')[0]; this.cookie = v.endsWith('=') ? '' : v; }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, headers: res.headers };
  }
}

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: e.message }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`); }
function ok(c, msg) { if (!c) throw new Error(msg); }

async function register(email = `e2e-${rnd()}@example.com`, password = strongPw(), name = 'API') {
  const c = new Client();
  const r = await c.req('POST', 'auth/register', { email, password, name });
  if (r.status === 201) cleanup.push([c, password]);
  return { c, r, email, password };
}

console.log(`API-тесты: ${BASE}\n`);

await test('Регистрация: 201, пользователь и защищённая cookie сессии', async () => {
  const { c, r, email } = await register();
  eq(r.status, 201, 'код ответа');
  eq(r.json.user.email, email, 'email');
  ok(!('password_hash' in r.json.user), 'в ответе не должно быть хэша пароля');
  const sc = c.lastSetCookie;
  ok(/HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc) && /Secure/i.test(sc), 'cookie должна быть HttpOnly, Secure, SameSite=Lax: ' + sc);
  eq((await c.req('GET', 'auth/me')).status, 200, '/me после регистрации');
});

await test('Регистрация: проверки email и пароля', async () => {
  const c = new Client();
  eq((await c.req('POST', 'auth/register', { email: 'not-an-email', password: strongPw() })).json.code, 'INVALID_EMAIL', 'неверный email');
  eq((await c.req('POST', 'auth/register', { email: `e2e-${rnd()}@example.com`, password: 'short' })).json.code, 'PASSWORD_TOO_SHORT', 'короткий пароль');
  eq((await c.req('POST', 'auth/register', { email: `e2e-${rnd()}@example.com`, password: '1234567890' })).json.code, 'PASSWORD_WEAK', 'слабый пароль');
  eq((await c.req('POST', 'auth/register', { email: `e2e-${rnd()}@example.com`, password: 'x'.repeat(201) })).json.code, 'PASSWORD_TOO_LONG', 'длинный пароль');
  const e = `e2e-${rnd()}@example.com`;
  eq((await c.req('POST', 'auth/register', { email: e, password: e })).json.code, 'PASSWORD_WEAK', 'пароль совпадает с email');
  eq((await c.req('POST', 'auth/register', { email: "x'; drop table users;--@example.com", password: strongPw() })).status, 400, 'попытка SQL-инъекции в email');
});

await test('Регистрация: повтор email (без учёта регистра) → 409', async () => {
  const { email } = await register();
  const r = await new Client().req('POST', 'auth/register', { email: email.toUpperCase(), password: strongPw() });
  eq(r.status, 409, 'код ответа'); eq(r.json.code, 'EMAIL_TAKEN', 'код ошибки');
});

await test('Защита от CSRF: без заголовка x-nl и с чужого сайта → 403', async () => {
  const c = new Client();
  const a = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  eq(a.status, 403, 'без x-nl');
  const b = await c.req('POST', 'auth/login', { email: 'a@b.cd', password: 'x' }, { headers: { origin: 'https://evil.example' } });
  eq(b.status, 403, 'чужой Origin');
});

await test('Неподдерживаемый метод → 405 с заголовком Allow', async () => {
  const r = await new Client().req('DELETE', 'auth/login');
  eq(r.status, 405, 'код'); ok(r.headers.get('allow') === 'POST', 'заголовок Allow');
});

await test('Вход: неверный пароль и несуществующий email дают одинаковый ответ', async () => {
  const { email } = await register();
  const a = await new Client().req('POST', 'auth/login', { email, password: 'wrong-password-1' });
  const b = await new Client().req('POST', 'auth/login', { email: `nobody-${rnd()}@example.com`, password: 'wrong-password-1' });
  eq(a.status, 401, 'неверный пароль'); eq(b.status, 401, 'нет такого email');
  eq(a.json.code, b.json.code, 'коды ошибок должны совпадать (не раскрываем, есть ли аккаунт)');
});

await test('Блокировка после 5 неудачных входов: даже верный пароль → 429', async () => {
  const { email, password } = await register();
  for (let i = 0; i < 5; i++) await new Client().req('POST', 'auth/login', { email, password: 'wrong-password-' + i });
  const r = await new Client().req('POST', 'auth/login', { email, password });
  eq(r.status, 429, 'код'); eq(r.json.code, 'LOCKED', 'код ошибки'); ok(Number(r.headers.get('retry-after')) > 800, 'Retry-After ≈ 15 минут');
});

await test('Синхронизация: сохранение, версия, конфликт 409, ключ ИИ не хранится', async () => {
  const { c } = await register();
  eq((await c.req('GET', 'data')).json.version, 0, 'пустой дневник');
  const d1 = { days: { '2026-01-01': { meals: { breakfast: [{ name: 'Каша', grams: 200 }], lunch: [], dinner: [], snack: [] }, note: '' } }, settings: { apiKey: 'sk-ant-secret', lang: 'ru' } };
  const p1 = await c.req('PUT', 'data', { data: d1, version: 0 });
  eq(p1.status, 200, 'первое сохранение'); eq(p1.json.version, 1, 'версия 1');
  const g = await c.req('GET', 'data');
  ok(!JSON.stringify(g.json.data).includes('sk-ant-secret'), 'ключ ИИ сохранился на сервере');
  eq(g.json.data.days['2026-01-01'].meals.breakfast[0].name, 'Каша', 'данные');
  eq((await c.req('PUT', 'data', { data: d1, version: 1 })).json.version, 2, 'второе сохранение');
  const stale = await c.req('PUT', 'data', { data: { days: {} }, version: 1 });
  eq(stale.status, 409, 'устаревшая версия'); eq(stale.json.version, 2, 'в ответе актуальная версия'); ok(stale.json.data.days['2026-01-01'], 'в ответе серверная копия');
  eq((await c.req('PUT', 'data', { data: [1, 2], version: 2 })).status, 400, 'массив вместо объекта');
  eq((await c.req('PUT', 'data', '{not json', { raw: true })).status, 400, 'битый JSON');
});

await test('Слишком большой дневник (> 4 МБ) → 413', async () => {
  const { c } = await register();
  const r = await c.req('PUT', 'data', { data: { blob: 'x'.repeat(4.2 * 1024 * 1024) }, version: 0 });
  eq(r.status, 413, 'код');
});

await test('Без входа данные недоступны: /data и /me → 401', async () => {
  const c = new Client();
  eq((await c.req('GET', 'data')).status, 401, 'GET /data'); eq((await c.req('PUT', 'data', { data: {}, version: 0 })).status, 401, 'PUT /data');
  eq((await c.req('GET', 'auth/me')).status, 401, '/me');
  c.cookie = 'nl_session=forged-token-' + rnd();
  eq((await c.req('GET', 'auth/me')).status, 401, 'поддельная cookie');
});

await test('Выход: сессия перестаёт действовать', async () => {
  const { c, email, password } = await register();
  const stolen = c.cookie;
  eq((await c.req('POST', 'auth/logout')).status, 204, 'выход');
  const old = new Client(); old.cookie = stolen;
  eq((await old.req('GET', 'auth/me')).status, 401, 'старая cookie после выхода');
  eq((await c.req('POST', 'auth/login', { email, password })).status, 200, 'повторный вход (нужен для уборки)');
});

await test('Смена пароля: неверный текущий → 401; после смены другие устройства выходят', async () => {
  const { c: a, email, password } = await register();
  const b = new Client(); eq((await b.req('POST', 'auth/login', { email, password })).status, 200, 'вход со второго устройства');
  eq((await a.req('POST', 'auth/password', { current: 'wrong-password-1', next: strongPw() })).status, 401, 'неверный текущий');
  eq((await a.req('POST', 'auth/password', { current: password, next: 'short' })).json.code, 'PASSWORD_TOO_SHORT', 'короткий новый');
  const next = strongPw();
  eq((await a.req('POST', 'auth/password', { current: password, next })).status, 204, 'смена');
  cleanup.find(x => x[0] === a)[1] = next;
  eq((await a.req('GET', 'auth/me')).status, 200, 'текущее устройство остаётся в аккаунте');
  eq((await b.req('GET', 'auth/me')).status, 401, 'второе устройство вышло');
  eq((await new Client().req('POST', 'auth/login', { email, password })).status, 401, 'старый пароль не подходит');
  eq((await new Client().req('POST', 'auth/login', { email, password: next })).status, 200, 'новый пароль подходит');
});

await test('Удаление аккаунта: неверный пароль → 401; затем данные и вход исчезают', async () => {
  const { c, email, password } = await register();
  await c.req('PUT', 'data', { data: { days: { x: 1 } }, version: 0 });
  eq((await c.req('DELETE', 'account', { password: 'wrong-password-1' })).status, 401, 'неверный пароль');
  eq((await c.req('DELETE', 'account', { password })).status, 204, 'удаление');
  cleanup.splice(cleanup.findIndex(x => x[0] === c), 1);
  eq((await new Client().req('POST', 'auth/login', { email, password })).status, 401, 'вход после удаления');
});

// уборка: удалить все созданные тестовые аккаунты
let removed = 0;
for (const [c, password] of cleanup) { const r = await c.req('DELETE', 'account', { password }); if (r.status === 204) removed++; }
const failed = results.filter(r => !r.ok).length;
console.log(`\nИтого: ${results.length - failed} пройдено, ${failed} не пройдено · удалено тестовых аккаунтов: ${removed}/${cleanup.length}`);
if (process.env.JSON_OUT) (await import('node:fs')).writeFileSync(process.env.JSON_OUT, JSON.stringify({ base: BASE, results, cleanup: { removed, total: cleanup.length } }, null, 1));
process.exit(failed ? 1 : 0);
