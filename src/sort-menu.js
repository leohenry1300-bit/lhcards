/* ============================================================
   Tri : le même bouton (« Trier : … ») et le même petit menu partout (accueil, Paquets, Notes, page d'un dossier).
   Les mêmes propositions ont toujours le même texte et la même icône, et gardent le même ordre.
   ============================================================ */
const SORT_META = {
    manual: ['Mon ordre', 'list'], alpha: ['A à Z', 'typeT'], alpharev: ['Z à A', 'typeT'], recent: ['Du plus récent', 'clock'], created: ['Date de création', 'calendar'],
    studied: ['Révisés récemment', 'eye'], due: ['À revoir d\'abord', 'repeat'], hard: ['Plus difficiles d\'abord', 'flame'], auto: ['Pertinence', 'search']
};
Object.assign(SuperAnki.prototype, {
    sortLabel(k) { const m = SORT_META[k] || SORT_META.recent; return `<span class="sb-ico">${ic(m[1])}</span><span class="sb-t">${m[0]}</span>`; },
    sortBtn(action, key, extra = '') { return `<button class="btn btn-soft sort-btn" data-action="${action}" ${extra} aria-label="Trier" title="Trier">${this.sortLabel(key)}</button>`; },
    sortMenu(anchor, keys, cur, pick) { this.showMenu(anchor, keys.map(k => ({ icon: k === cur ? 'check' : SORT_META[k][1], label: SORT_META[k][0], fn: () => pick(k) }))); }
});
