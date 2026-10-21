/* Исследовательское тестирование (exploratory): агент сам обходит экраны, нажимает ещё не
   опробованные элементы, вводит пограничные данные и после каждого шага проверяет «оракулы»:
   ошибки JS, горизонтальная прокрутка, сырые значения (NaN, undefined, ключи переводов),
   выполнение внедрённой разметки (XSS), отрицательные/бесконечные числа в сохранённых данных.
     const m = await import('/tests/e2e/explore.js?' + Date.now());
     const report = await m.explore({ steps: 250, seed: 7 });
   Опасные и внешние действия (выход, удаление, ключ API, файлы, отправка в чат) пропускаются. */

import { installFastTimers, uninstallFastTimers, throttled } from './clock.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const visible = el => el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

const ROUTES = ['#/', '#/add', '#/foods', '#/foods/cat/uzbek', '#/foods/cat/drinks', '#/foods/cat/snacks', '#/foods/cat/base', '#/stats', '#/chat', '#/settings', '#/day/2024-02-29', '#/meal/TODAY/lunch'];
const SKIP = '#adel, #dwipe, #alogout, #achpw, #async, #dimp, #f-gal, #f-cam, #akey, #asave, #atest, #cin, #cform button, [data-gal], [data-cam], #lai, [data-theme-toggle], a[href^="http"], a[href^="mailto"], [data-set="lang"] button, [data-set="theme"] button';
// пограничные значения для полей ввода
const PAYLOADS = ['', '0', '-50', '999999', '1e309', '12,5', '  ', 'abc', '<img src=x onerror="window.__xss=1">', '"><svg onload=window.__xss=1>', '🍕🍣', 'А'.repeat(300), '0.0001', 'NaN'];

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export async function explore({ steps = 200, seed = 1, verbose = false } = {}) {
  const rand = rng(seed);
  const pick = a => a[Math.floor(rand() * a.length)];
  const saved = localStorage.getItem('nutrilens.v1');
  const findings = new Map();
  const add = (kind, where, detail) => { const k = kind + '|' + detail; if (!findings.has(k)) findings.set(k, { kind, where, detail, count: 0 }); findings.get(k).count++; };
  const jsErr = [];
  const onErr = e => jsErr.push(String((e.error && e.error.stack) || e.message || e.reason));
  addEventListener('error', onErr); addEventListener('unhandledrejection', onErr);
  const origErr = console.error; console.error = (...a) => { jsErr.push(a.map(String).join(' ')); origErr(...a); };
  const wasThrottled = await throttled();
  const fastTimers = installFastTimers();
  window.__xss = 0;

  // старт с заполненного профиля и нескольких записей
  Store.state = defaultState();
  Store.state.profile = { name: 'Исследователь', sex: 'm', age: 34, height: 180, weight: 80, activity: 'moderate', goal: 'lose', pregnant: false };
  Store.state.targets = calcTargets(Store.state.profile).targets;
  Store.state.settings.onboarded = true;
  Store.addItems(todayKey(), 'lunch', [makeItem({ name: 'Гречка', grams: 200, per100: { kcal: 110, protein_g: 4, fat_g: 2, carbs_g: 20 } })]);
  Store.save(); resetOnb();
  await Catalog.load().catch(() => {});

  const tried = new Set();
  const log = [];
  const key = el => (location.hash.split('?')[0]) + '|' + (el.id || el.dataset.i || el.dataset.id || el.dataset.m || el.dataset.s || el.dataset.c || el.getAttribute('href') || el.innerText.trim().slice(0, 30));
  const oracle = where => {
    if (document.documentElement.scrollWidth > innerWidth + 1) add('layout', where, `горизонтальная прокрутка: ${document.documentElement.scrollWidth}px при ширине ${innerWidth}px`);
    const txt = (document.querySelector('#view') || document.body).innerText + ' ' + (document.querySelector('#modal') || {}).innerText;
    const raw = txt.match(/\b(NaN|undefined|Infinity|\[object Object\])\b|(?<![\w@/])(err|cat|set|onb|res|nav|src|diet|al|auth|sync|stats|foods|meal|add)\.[a-z][\w.]*/g);
    if (raw) add('raw-text', where, 'сырые значения на экране: ' + [...new Set(raw)].slice(0, 5).join(', '));
    if (window.__xss) { add('xss', where, 'выполнился внедрённый код из пользовательского ввода'); window.__xss = 0; }
    for (const [d, day] of Object.entries(Store.state.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) add('data', where, `в дневнике появился день с неверным ключом «${d}»`);
      for (const m of MEALS) for (const it of (day.meals && day.meals[m]) || []) {
        if (!(it.grams > 0) || !isFinite(it.grams)) add('data', where, `запись «${String(it.name).slice(0, 30)}» с массой ${it.grams}`);
        if (Object.values(it.per100 || {}).some(v => !isFinite(v) || v < 0)) add('data', where, `запись «${String(it.name).slice(0, 30)}» с некорректным составом`);
      }
    }
    for (const f of Store.state.myFoods) if (!(f.portion > 0) || !isFinite(f.portion)) add('data', where, `свой продукт «${String(f.name).slice(0, 30)}» с порцией ${f.portion}`);
    for (const w of Store.state.weights) if (!(w.kg > 0)) add('data', where, `вес ${w.kg}`);
    const p = Store.state.profile;
    if (p && (p.age > 120 || p.height > 260 || p.weight > 400 || p.age < 1)) add('data', where, `профиль сохранился с нереалистичными значениями: возраст ${p.age}, рост ${p.height}, вес ${p.weight}`);
    while (jsErr.length) add('js-error', where, jsErr.shift().split('\n').slice(0, 2).join(' '));
  };

  for (let i = 0; i < steps; i++) {
    // иногда — переход на новый экран, чтобы покрыть все разделы
    if (i % 25 === 0 || rand() < 0.06) {
      UI.closeModal(); await sleep(150);
      const r = pick(ROUTES).replace('TODAY', todayKey());
      Router.silent = true; location.hash = r; await sleep(450);
      log.push('→ ' + r); oracle(r);
      continue;
    }
    const scope = document.querySelector('#modal.open .sheet') || document;
    const cands = $$('button, a[href^="#"], input:not([type=hidden]):not([type=file]):not([type=range]), textarea, select, input[type=range]', scope)
      .filter(visible).filter(el => !el.matches(SKIP) && !el.closest(SKIP) && !el.disabled);
    if (!cands.length) { UI.closeModal(); await sleep(200); continue; }
    const fresh = cands.filter(el => !tried.has(key(el)));
    const el = fresh.length && rand() < 0.75 ? pick(fresh) : pick(cands);
    tried.add(key(el));
    const where = location.hash + (scope !== document ? ' (окно)' : '');
    try {
      if (el.matches('input[type=range]')) {
        el.value = String(Math.round(Number(el.min || 0) + rand() * (Number(el.max || 100) - Number(el.min || 0))));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        log.push(`${where}: ползунок = ${el.value}`);
      } else if (el.matches('input, textarea')) {
        const v = pick(PAYLOADS);
        el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        log.push(`${where}: ввод в ${el.id || el.name || el.dataset.k || el.placeholder || 'поле'} = ${JSON.stringify(v.slice(0, 40))}`);
        // иногда сразу отправляем форму, в которой находится поле
        const form = el.closest('form');
        if (form && rand() < 0.4) { form.requestSubmit(); log.push(`${where}: отправка формы ${form.id}`); }
      } else if (el.matches('select')) {
        el.selectedIndex = Math.floor(rand() * el.options.length); el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        log.push(`${where}: клик «${(el.innerText || el.getAttribute('aria-label') || el.id).trim().slice(0, 40)}»`);
        el.click();
      }
    } catch (e) { add('js-error', where, 'исключение при действии: ' + e.message); }
    await sleep(140 + rand() * 260);
    oracle(where);
  }

  if (fastTimers) uninstallFastTimers();
  console.error = origErr;
  removeEventListener('error', onErr); removeEventListener('unhandledrejection', onErr);
  UI.closeModal();
  if (saved) localStorage.setItem('nutrilens.v1', saved); else localStorage.removeItem('nutrilens.v1');
  Store.load(); resetOnb(); draft = null; addState = null;
  Router.silent = true; location.hash = '#/';
  const list = [...findings.values()];
  return { steps, seed, envHealing: wasThrottled, covered: tried.size, findings: list, log: verbose ? log : log.slice(-25) };
}
