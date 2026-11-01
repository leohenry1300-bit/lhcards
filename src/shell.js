/* ============================================================
   Phone : the page does not scroll, #main does (fixed frame, see styles.css). The rest of the app still talks about « the window scroll »
   (window.scrollY, scrollTo, scroll events…) : on a phone these are mapped to #main, so nothing else had to change.
   ============================================================ */
(() => {
    const mq = matchMedia('(max-width: 767px)'), shell = () => mq.matches, main = () => document.getElementById('main');
    const d = k => Object.getOwnPropertyDescriptor(window, k) || Object.getOwnPropertyDescriptor(Window.prototype, k);
    try {
        ['scrollY', 'pageYOffset'].forEach(k => { const o = d(k); if (o && o.get) Object.defineProperty(window, k, { configurable: true, get() { const m = main(); return shell() && m ? m.scrollTop : o.get.call(window); } }); });
        ['scrollX', 'pageXOffset'].forEach(k => { const o = d(k); if (o && o.get) Object.defineProperty(window, k, { configurable: true, get() { return shell() ? 0 : o.get.call(window); } }); });
        const st = window.scrollTo.bind(window), sb = window.scrollBy.bind(window);
        window.scrollTo = function (...a) { const m = main(); if (!(shell() && m)) return st(...a); if (a[0] && typeof a[0] === 'object') m.scrollTo({ top: a[0].top, behavior: a[0].behavior }); else m.scrollTop = Number(a[1]) || 0; };
        window.scrollBy = function (...a) { const m = main(); if (!(shell() && m)) return sb(...a); if (a[0] && typeof a[0] === 'object') m.scrollBy({ top: a[0].top || 0, behavior: a[0].behavior }); else m.scrollTop += Number(a[1]) || 0; };
        window.scroll = window.scrollTo;
        const hook = () => { const m = main(); if (!m || m._shell) return; m._shell = true; m.addEventListener('scroll', () => { if (shell()) window.dispatchEvent(new Event('scroll')); }, { passive: true }); };
        hook(); document.addEventListener('DOMContentLoaded', hook); setTimeout(hook, 500);
    } catch (e) { console.warn('shell', e); }
})();
