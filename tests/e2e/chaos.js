/* «Хаос-режим» для проверки самовосстановления: имитирует редизайн интерфейса.
   После каждой отрисовки переименовывает id, классы и data-атрибуты и меняет подписи кнопок.
   Трогаем только то, что приложение читает один раз при монтировании экрана, — сам сайт
   продолжает работать, а тесты с «жёсткими» селекторами без лечения бы упали. */

const RENAME_ID = { lok: 'log-confirm', sq: 'search-query', calc: 'analyze-btn', txt: 'meal-text', manual: 'find-by-hand', 'nf-save': 'food-store', gq: 'section-search', newfood: 'create-food', cq: 'catalog-q', wadd: 'weight-log' };
const RENAME_CLASS = { crow: 'cat-row', ctile: 'cuisine-card' };
const RENAME_ATTR = { 'data-next': 'data-forward' };
const RETEXT = { 'Добавить': 'Записать в дневник', 'Дальше': 'Далее →', 'Рассчитать': 'Посчитать КБЖУ', 'Новый продукт': 'Создать продукт', 'Сначала калорийные': 'Калорийные сверху' };

let observer = null;
export const chaosStats = { ids: 0, classes: 0, attrs: 0, texts: 0 };

function mutate(root) {
  if (!(root instanceof Element)) return;
  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    if (el.id && RENAME_ID[el.id]) { el.id = RENAME_ID[el.id]; chaosStats.ids++; }
    for (const [from, to] of Object.entries(RENAME_CLASS)) if (el.classList.contains(from)) { el.classList.replace(from, to); chaosStats.classes++; }
    for (const [from, to] of Object.entries(RENAME_ATTR)) if (el.hasAttribute(from)) { el.setAttribute(to, el.getAttribute(from)); el.removeAttribute(from); chaosStats.attrs++; }
    if ((el.tagName === 'BUTTON' || el.tagName === 'A') && el.childNodes.length) {
      for (const n of el.childNodes) if (n.nodeType === 3 && RETEXT[n.textContent.trim()]) { n.textContent = RETEXT[n.textContent.trim()]; chaosStats.texts++; }
    }
  }
}

export function enableChaos() {
  if (observer) return;
  mutate(document.body);
  observer = new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(mutate)));
  observer.observe(document.body, { childList: true, subtree: true });
}
export function disableChaos() { observer && observer.disconnect(); observer = null; }
