/* Самовосстанавливающиеся локаторы (self-healing).
   Локатор описывает элемент несколькими признаками. Если основной CSS-селектор перестал находить
   элемент (переименовали id, класс, поменяли разметку или подпись), локатор пробует запасные стратегии:
     проверенный ранее «вылеченный» селектор → data-testid → aria-label → роль + текст → поле по подписи →
     отпечаток элемента → нечёткое совпадение текста → похожие id/классы/href.
   Отпечаток (тег, классы, родитель, текст, href, data-атрибуты) запоминается при каждом успешном
   поиске по CSS — то есть тесты «учатся» на зелёных прогонах. Каждое лечение пишется в журнал,
   а найденный селектор сохраняется (с перепроверкой по отпечатку перед повторным использованием). */

const HEAL_KEY = 'nl.e2e.heal', FP_KEY = 'nl.e2e.fp';
const ROLE_SEL = {
  button: 'button, [role=button], a.btn, a.pill, input[type=submit]',
  link: 'a[href]',
  input: 'input:not([type=hidden]):not([type=file]), textarea, select',
  any: '*',
};

export const healLog = [];

const load = k => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const resetHealCache = () => { try { localStorage.removeItem(HEAL_KEY); } catch {} };
export const resetFingerprints = () => { try { localStorage.removeItem(FP_KEY); } catch {} };

export const visible = el => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const textOf = el => norm(el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || '');

// похожесть строк: доля общих биграмм (Dice) — устойчиво к перестановкам и небольшим правкам
export function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9 * Math.min(a.length, b.length) / Math.max(a.length, b.length) + 0.1;
  const big = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = big(a), B = big(b); let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1));
}
const tokens = s => String(s || '').toLowerCase().split(/[^a-zа-я0-9]+/).filter(x => x.length > 1);
const jaccard = (a, b) => { a = new Set(a); b = new Set(b); if (!a.size && !b.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); };

/* ---------- отпечаток элемента ---------- */
function fingerprint(el) {
  const p = el.parentElement;
  return {
    tag: el.tagName, cls: [...el.classList], text: textOf(el).slice(0, 80), href: el.getAttribute('href'),
    name: el.getAttribute('name'), type: el.getAttribute('type'), ph: el.getAttribute('placeholder'),
    data: [...el.attributes].filter(a => a.name.startsWith('data-') && !a.name.startsWith('data-v-')).map(a => a.value).filter(Boolean),
    pcls: p ? [...p.classList] : [], ptag: p ? p.tagName : null,
  };
}
// насколько кандидат похож на запомненный отпечаток (0..1); другой тег — сразу 0
function fpScore(el, fp) {
  if (!fp || el.tagName !== fp.tag) return 0;
  const c = fingerprint(el);
  const parts = [[2, jaccard(c.cls, fp.cls)], [1, c.ptag === fp.ptag ? jaccard(c.pcls, fp.pcls) : 0], [2, similarity(c.text, fp.text)]];
  if (fp.href) parts.push([4, c.href === fp.href ? 1 : 0]);
  if (fp.name) parts.push([3, c.name === fp.name ? 1 : 0]);
  if (fp.type) parts.push([1, c.type === fp.type ? 1 : 0]);
  if (fp.ph) parts.push([2, similarity(c.ph, fp.ph)]);
  if (fp.data.length) parts.push([2, jaccard(c.data, fp.data)]);
  const w = parts.reduce((a, [k]) => a + k, 0);
  return parts.reduce((a, [k, v]) => a + k * v, 0) / w;
}

// устойчивый селектор для найденного элемента — его и предлагаем как правку теста
export function selectorFor(el) {
  if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
  for (const a of ['data-testid', 'href', 'name', 'data-act', 'data-s', 'data-m', 'data-v', 'data-t', 'data-c', 'aria-label']) {
    const v = el.getAttribute(a);
    if (v != null) { const s = `${el.tagName.toLowerCase()}[${a}="${CSS.escape(v)}"]`; if (document.querySelectorAll(s).length === 1) return s; }
  }
  const path = [];
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.id) { path.unshift('#' + CSS.escape(n.id)); break; }
    const i = [...n.parentElement.children].filter(x => x.tagName === n.tagName).indexOf(n) + 1;
    path.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`);
  }
  return path.join(' > ');
}

/* Описание локатора:
   { key, css, testid, label, role, text: ['Добавить', 'Add'], field: 'Возраст', attrHint: 'lok', within: '.sheet', strict, minScore } */
export function L(key, spec) { return Object.assign({ key, role: 'any', minScore: 0.62 }, spec); }

function scopeOf(spec) {
  if (!spec.within) return document;
  const s = [...document.querySelectorAll(spec.within)].filter(visible);
  return s[s.length - 1] || null;
}

function attempt(spec) {
  const root = scopeOf(spec);
  if (!root) return null;
  const q = sel => { try { return [...root.querySelectorAll(sel)].filter(visible); } catch { return []; } };
  const texts = [].concat(spec.text || []);
  const fp = load(FP_KEY)[spec.key];
  const startsWith = el => texts.some(tx => textOf(el).startsWith(norm(tx)));
  const plausible = el => (!fp || fpScore(el, fp) >= 0.5) && (!texts.length || !spec.strict || startsWith(el));

  // 1. основной селектор (strict: текст элемента должен начинаться с ожидаемого)
  if (spec.css) { const r = q(spec.css).filter(e => !spec.strict || startsWith(e)); if (r.length) return { el: r[0], strategy: 'css' }; }
  // 2. ранее вылеченный селектор — только если элемент всё ещё похож на запомненный
  const cached = load(HEAL_KEY)[spec.key];
  if (cached) { const r = q(cached).filter(plausible); if (r.length) return { el: r[0], strategy: 'cache', healed: cached }; }
  // 3. data-testid
  if (spec.testid) { const r = q(`[data-testid="${spec.testid}"]`); if (r.length) return { el: r[0], strategy: 'testid' }; }
  const pool = q(ROLE_SEL[spec.role] || ROLE_SEL.any);
  // 4. aria-label
  if (spec.label) { const r = pool.filter(e => norm(e.getAttribute('aria-label')) === norm(spec.label)); if (r.length) return { el: r[0], strategy: 'aria-label' }; }
  // 5. роль + точный текст; затем текст, начинающийся с ожидаемого
  for (const tx of texts) { const r = pool.filter(e => textOf(e) === norm(tx)); if (r.length) return { el: r[0], strategy: 'role+text' }; }
  if (spec.strict) { const r = pool.filter(startsWith); if (r.length) return { el: r[0], strategy: 'role+text-prefix' }; }
  // 6. поле ввода по тексту подписи (<label><span>Возраст</span><input></label>)
  if (spec.field) {
    let best = null;
    for (const e of q('input:not([type=hidden]):not([type=file]), textarea, select')) {
      const lab = e.closest('label, .tcell, .field');
      const lt = lab ? norm((lab.querySelector('span, label') || lab).innerText) : '';
      const s = Math.max(norm(e.getAttribute('aria-label')) ? similarity(e.getAttribute('aria-label').split(',')[0], [].concat(spec.field)[0]) : 0, ...[].concat(spec.field).map(f => similarity(lt.split(',')[0], f)));
      if (s >= 0.75 && (!best || s > best.score)) best = { el: e, score: s };
    }
    if (best) return { el: best.el, strategy: 'field-label', score: +best.score.toFixed(2) };
  }
  // 7. отпечаток, запомненный на зелёном прогоне
  if (fp) {
    let best = null, second = 0;
    for (const e of pool) { const s = fpScore(e, fp); if (!best || s > best.score) { second = best ? best.score : 0; best = { el: e, score: s }; } else if (s > second) second = s; }
    if (best && best.score >= 0.55 && best.score - second >= 0.05) return { el: best.el, strategy: 'fingerprint', score: +best.score.toFixed(2) };
  }
  // 8. нечёткий текст (самый похожий элемент выше порога)
  if (texts.length) {
    let best = null;
    for (const e of pool) {
      if (spec.role === 'any' && e.children.length > 3) continue; // не цепляемся за крупные контейнеры
      const s = Math.max(...texts.map(tx => similarity(textOf(e), tx)));
      if (s >= spec.minScore && (!best || s > best.score)) best = { el: e, score: s };
    }
    if (best) return { el: best.el, strategy: 'fuzzy-text', score: +best.score.toFixed(2) };
  }
  // 9. похожие id / классы / href / data-атрибуты («lok» → «lok_v2», «ctile» → «cuisine-tile»)
  if (spec.attrHint) {
    const hint = tokens(spec.attrHint);
    let best = null;
    for (const e of pool) {
      const attrs = [e.id, typeof e.className === 'string' ? e.className : '', e.getAttribute('href'), ...[...e.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name + ' ' + a.value)].join(' ');
      const s = Math.max(0, ...tokens(attrs).flatMap(tk => hint.map(h => similarity(tk, h))));
      if (s >= 0.6 && (!best || s > best.score)) best = { el: e, score: s };
    }
    if (best) return { el: best.el, strategy: 'attr-similarity', score: +best.score.toFixed(2) };
  }
  return null;
}

// найти элемент, дожидаясь его появления; при успехе по CSS — запомнить отпечаток, при лечении — записать
export async function find(spec, { timeout = 6000 } = {}) {
  const t0 = performance.now();
  let r = null;
  while (performance.now() - t0 < timeout) {
    r = attempt(spec);
    if (r) break;
    await new Promise(res => setTimeout(res, 80));
  }
  if (!r) throw new Error(`Не найден элемент «${spec.key}» (css: ${spec.css || '—'}, текст: ${[].concat(spec.text || []).join(' / ') || '—'})`);
  if (r.strategy === 'css') { const f = load(FP_KEY); f[spec.key] = fingerprint(r.el); save(FP_KEY, f); }
  else {
    const healed = r.healed || selectorFor(r.el);
    if (r.strategy !== 'cache') { const c = load(HEAL_KEY); c[spec.key] = healed; save(HEAL_KEY, c); }
    healLog.push({ key: spec.key, broken: spec.css || null, strategy: r.strategy, score: r.score ?? null, healed });
  }
  return r.el;
}

// действия с повтором: элемент мог быть перерисован между поиском и кликом
export async function click(spec, opts) {
  for (let i = 0; i < 3; i++) {
    const el = await find(spec, opts);
    if (!el.isConnected) continue;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return el;
  }
  throw new Error(`Не удалось нажать «${spec.key}»`);
}
export async function type(spec, value, opts) {
  const el = await find(spec, opts);
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el;
}
