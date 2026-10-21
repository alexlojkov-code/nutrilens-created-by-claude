/* Целевые проверки гипотез исследовательского тестирования. Каждая проверка — отдельный
   рискованный сценарий; после исправления бага проверка остаётся регрессионной.
     const m = await import('/tests/e2e/probes.js?' + Date.now()); await m.probes();  */
import { installFastTimers, uninstallFastTimers } from './clock.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const count = () => Object.values(Store.state.days).reduce((a, d) => a + MEALS.reduce((b, m) => b + ((d.meals && d.meals[m]) || []).length, 0), 0);

async function fresh() {
  UI.closeModal(); await sleep(650);
  Store.state = defaultState();
  Store.state.profile = { name: 'Проба', sex: 'f', age: 30, height: 168, weight: 62, activity: 'light', goal: 'maintain', pregnant: false };
  Store.state.targets = calcTargets(Store.state.profile).targets;
  Store.state.settings.onboarded = true;
  Store.save(); resetOnb(); addState = null; draft = null;
}
async function go(h) { Router.silent = true; if (location.hash === h) Router.render(); else location.hash = h; await sleep(350); }
const plov = () => makeItem({ name: 'Плов', grams: 300, per100: { kcal: 210, protein_g: 6.5, fat_g: 11, carbs_g: 21 } });

const PROBES = [
  ['Двойной клик «Добавить» в окне записи добавляет одну запись', async () => {
    await fresh(); await go('#/');
    logSheet(plov(), { meal: 'lunch' }); await sleep(500);
    const b = $('#modal .sheet #lok'); b.click(); b.click();
    await sleep(300);
    return { ok: count() === 1, detail: `записей: ${count()}` };
  }],
  ['Двойной клик «Добавить в дневник» на экране результата добавляет записи один раз', async () => {
    await fresh(); await go('#/add');
    addState.text = '2 яйца'; await runAnalysis($('#composer'));
    for (let i = 0; i < 40 && !$('#save'); i++) await sleep(100);
    const n = draft.items.length, b = $('#save'); b.click(); b.click();
    await sleep(500);
    return { ok: count() === n, detail: `распознано ${n}, записано ${count()}` };
  }],
  ['Импорт повреждённой резервной копии не ломает приложение', async () => {
    await fresh();
    const bad = { days: { '2026-01-05': {}, '2026-01-06': { meals: { lunch: [{ name: 'x', grams: 'abc' }] } }, 'zzz': null }, myFoods: 'oops', weights: [{}], recent: null };
    const file = new File([JSON.stringify(bad)], 'b.json', { type: 'application/json' });
    await go('#/settings');
    const inp = $('#dimp'); const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
    await sleep(800);
    const errs = [];
    const h = e => errs.push(e.message); addEventListener('error', h);
    for (const r of ['#/', '#/day/2026-01-05', '#/day/2026-01-06', '#/stats', '#/foods', '#/add']) { try { Router.silent = true; location.hash = r; await sleep(350); if (!$('#view').children.length) errs.push('пустой экран ' + r); } catch (e) { errs.push(r + ': ' + e.message); } }
    removeEventListener('error', h);
    try { exportCSV(); } catch (e) { errs.push('CSV: ' + e.message); }
    return { ok: !errs.length, detail: errs.slice(0, 3).join('; ') || 'ок' };
  }],
  ['Внедрённая разметка в названиях и заметке не выполняется (XSS)', async () => {
    await fresh(); window.__x = 0;
    const evil = '<img src=x onerror="window.__x=1"><svg onload="window.__x=1">';
    Store.state.myFoods.unshift({ id: 'e', name: evil, per100: { kcal: 1 }, portion: 10 });
    Store.addItems(todayKey(), 'lunch', [makeItem({ name: evil, grams: 10, per100: { kcal: 1 } })]);
    Store.day(todayKey()).note = evil; Store.state.profile.name = evil; Store.save();
    for (const r of ['#/', '#/add', '#/foods', '#/stats', `#/meal/${todayKey()}/lunch`, '#/settings']) { foodsTab = 'my'; await go(r); }
    searchSheet({ title: evil, query: '<img', onPick() {} }); await sleep(400); UI.closeModal(); foodsTab = 'catalog';
    await sleep(300);
    return { ok: window.__x === 0, detail: window.__x ? 'код выполнился' : 'ок' };
  }],
  ['Профиль в настройках: нереалистичные возраст/рост/вес не сохраняются', async () => {
    await fresh(); await go('#/settings');
    const f = $('#fprof'); f.age.value = '999'; f.height.value = '999'; f.weight.value = '9999'; f.requestSubmit();
    await sleep(300);
    const p = Store.state.profile;
    return { ok: p.age === 30 && p.height === 168, detail: `возраст ${p.age}, рост ${p.height}, вес ${p.weight}` };
  }],
  ['Единицы: ввод в унциях пересчитывается в граммы', async () => {
    await fresh(); Store.state.settings.mass = 'oz'; Store.save(); await go('#/');
    logSheet(plov(), { meal: 'dinner' }); await sleep(500);
    const g = $('#modal .sheet #lg'); g.value = '10'; g.dispatchEvent(new Event('input', { bubbles: true }));
    $('#modal .sheet #lok').click(); await sleep(300);
    const it = Store.peekDay(todayKey()).meals.dinner[0];
    return { ok: Math.abs(it.grams - 283.5) < 0.6, detail: `10 oz → ${it.grams} г` };
  }],
  ['Вес: бесконечность и ноль отклоняются', async () => {
    await fresh(); Store.addItems(todayKey(), 'lunch', [plov()]); await go('#/stats');
    const n0 = Store.state.weights.length;
    for (const v of ['1e309', '0', '-5']) { $('#wv').value = v; $('#wadd').click(); await sleep(150); }
    return { ok: Store.state.weights.length === n0 && Store.state.weights.every(w => w.kg > 0 && isFinite(w.kg)), detail: `записей веса: ${Store.state.weights.length - n0} лишних` };
  }],
  ['Несуществующая дата в адресе добавления (#/add?date=2026-02-30)', async () => {
    await fresh(); await go('#/add?date=2026-02-30');
    Store.addItems(addState.date, addState.meal, [plov()]);
    return { ok: !Store.state.days['2026-02-30'], detail: Object.keys(Store.state.days).join(', ') };
  }],
  ['Длинное название без пробелов не растягивает страницу', async () => {
    await fresh(); Store.addItems(todayKey(), 'lunch', [makeItem({ name: 'Суперкалифрагилистик'.repeat(12), grams: 10, per100: { kcal: 1 } })]);
    const bad = [];
    for (const r of ['#/', `#/meal/${todayKey()}/lunch`, '#/foods']) { foodsTab = 'recent'; await go(r); await sleep(200); if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(r); }
    foodsTab = 'catalog';
    return { ok: !bad.length, detail: bad.join(', ') || 'ок' };
  }],
  ['Отмена удаления возвращает запись на её место', async () => {
    await fresh();
    Store.addItems(todayKey(), 'lunch', [plov(), makeItem({ name: 'Салат', grams: 100, per100: { kcal: 50 } }), makeItem({ name: 'Чай', grams: 200, per100: { kcal: 1 } })]);
    await go('#/');
    const id = Store.peekDay(todayKey()).meals.lunch[1].id;
    itemSheet(todayKey(), id, () => {}); await sleep(450);
    $('#modal .sheet #idel').click(); await sleep(200);
    $$('#toasts .toast button').pop().click(); await sleep(200);
    const names = Store.peekDay(todayKey()).meals.lunch.map(x => x.name).join(', ');
    return { ok: names === 'Плов, Салат, Чай', detail: names };
  }],
];

export async function probes() {
  const saved = localStorage.getItem('nutrilens.v1');
  const fast = installFastTimers();
  const out = [];
  for (const [name, fn] of PROBES) {
    try { const r = await fn(); out.push({ name, ...r }); } catch (e) { out.push({ name, ok: false, detail: 'исключение: ' + e.message }); }
  }
  UI.closeModal(); await sleep(650);
  if (fast) uninstallFastTimers();
  if (saved) localStorage.setItem('nutrilens.v1', saved); else localStorage.removeItem('nutrilens.v1');
  Store.load(); resetOnb(); draft = null; addState = null; foodsTab = 'catalog';
  Router.silent = true; location.hash = '#/';
  return out;
}
