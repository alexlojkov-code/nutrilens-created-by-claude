/* Самовосстановление среды: в фоновой вкладке браузер замедляет setTimeout (до раза в минуту)
   и вовсе не вызывает requestAnimationFrame — анимации, модальные окна и ожидания тестов
   «замерзают». На время прогона подменяем планировщик: таймеры исполняются через MessageChannel
   (его браузер не тормозит), а кадры анимации — через те же таймеры с шагом ~16 мс. */

let installed = null;

export function throttled() {
  return new Promise(res => {
    if (document.hidden) return res(true);
    const t0 = performance.now();
    setTimeout(() => res(performance.now() - t0 > 250), 20);
  });
}

export function installFastTimers() {
  if (installed) return false;
  const orig = { setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, raf: window.requestAnimationFrame, caf: window.cancelAnimationFrame };
  const tasks = new Map();
  let seq = 1, pumping = false;
  const ch = new MessageChannel();
  const pump = () => {
    const now = performance.now();
    for (const [id, t] of [...tasks].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > now) continue;
      tasks.delete(id);
      try { t.fn(...t.args); } catch (e) { queueMicrotask(() => { throw e; }); }
    }
    if (tasks.size) ch.port2.postMessage(0); else pumping = false;
  };
  ch.port1.onmessage = pump;
  const kick = () => { if (!pumping) { pumping = true; ch.port2.postMessage(0); } };
  window.setTimeout = (fn, ms = 0, ...args) => {
    if (typeof fn !== 'function') return 0;
    const id = seq++; tasks.set(id, { fn, args, at: performance.now() + Math.max(0, Number(ms) || 0) }); kick(); return id;
  };
  window.clearTimeout = id => { tasks.delete(id); };
  window.requestAnimationFrame = fn => window.setTimeout(() => fn(performance.now()), 16);
  window.cancelAnimationFrame = id => window.clearTimeout(id);
  installed = orig;
  return true;
}

export function uninstallFastTimers() {
  if (!installed) return;
  window.setTimeout = installed.setTimeout; window.clearTimeout = installed.clearTimeout;
  window.requestAnimationFrame = installed.raf; window.cancelAnimationFrame = installed.caf;
  installed = null;
}
