/* ============================================================
   Notes : barre flottante qui apparaît quand on sélectionne du texte (comme RemNote) :
   type de bloc, cartes IA, lien, trou, gras / italique / souligné / barré, code, formule, couleurs, plus.
   + petit moteur de formules ($x^2$, \frac{a}{b}, \sqrt{x}, lettres grecques…) sans bibliothèque lourde.
   ============================================================ */
const NB_GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', Pi: 'Π', Phi: 'Φ',
    sum: 'Σ', int: '∫', infty: '∞', pm: '±', times: '×', cdot: '·', div: '÷', le: '≤', ge: '≥', leq: '≤', geq: '≥', neq: '≠', ne: '≠', approx: '≈', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', in: '∈', partial: '∂', sqrt: '√', degree: '°' };
function nbMathHtml(src) {
    let s = String(src || '');
    const group = (str, i) => { if (str[i] === '{') { let d = 0, j = i; for (; j < str.length; j++) { if (str[j] === '{') d++; else if (str[j] === '}' && --d === 0) break; } return [str.slice(i + 1, j), j + 1]; } return [str[i] || '', i + 1]; };
    const conv = str => {
        let out = '', i = 0;
        while (i < str.length) {
            const c = str[i];
            if (c === '\\') { const m = /^\\([A-Za-z]+)/.exec(str.slice(i)); if (m) { const w = m[1]; i += m[0].length; if (w === 'frac') { const [a, j] = group(str, i), [b, k] = group(str, j); out += `<span class="mf"><i>${conv(a)}</i><i>${conv(b)}</i></span>`; i = k; } else if (w === 'sqrt') { const [a, j] = group(str, i); out += `√<span class="mr">${conv(a)}</span>`; i = j; } else out += NB_GREEK[w] || w; continue; } }
            if (c === '^' || c === '_') { const [a, j] = group(str, i + 1); out += `<${c === '^' ? 'sup' : 'sub'}>${conv(a)}</${c === '^' ? 'sup' : 'sub'}>`; i = j; continue; }
            if (c === '-' && str[i + 1] === '>') { out += '→'; i += 2; continue; }
            out += c; i++;
        }
        return out;
    };
    return conv(s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).replace(/&/g, '&amp;');
}
Object.assign(SuperAnki.prototype, {
    nbSelInfo() {
        if (!this.nb || this.nb.active < 0) return null;
        const sel = window.getSelection && getSelection(); if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
        const t = $('.nb-t', this.nbEl ? this.nbEl(this.nb.active) : document); if (!t || !t.contains(sel.anchorNode) || !t.contains(sel.focusNode)) return null;
        const c = this.nbCaret(t); if (c.s === c.e) return null;
        return { t, s: c.s, e: c.e, rect: sel.getRangeAt(0).getBoundingClientRect() };
    },
    nbSelBarUpdate() {
        if (this._nbSelT) clearTimeout(this._nbSelT);
        this._nbSelT = setTimeout(() => {
            const info = (this.view === 'notes' || this.view === 'pdf') ? this.nbSelInfo() : null;
            let bar = document.getElementById('nb-sel');
            if (!info || info.rect.width + info.rect.height === 0) { if (bar) bar.remove(); return; }
            if (!bar) {
                bar = document.createElement('div'); bar.id = 'nb-sel'; bar.className = 'nb-sel'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Mise en forme de la sélection');
                bar.innerHTML = `<button data-sb="type" class="sb-type">Texte simple ${ic('chevronDown')}</button><i></i>
                    <button data-sb="ai" class="sb-ai" title="Créer des cartes avec l'IA à partir de la sélection">${ic('sparkle')}Cartes IA</button><i></i>
                    <button data-sb="link" title="Lien vers une note, un PDF ou une carte">${ic('link')}</button>
                    <button data-sb="cloze" title="Mettre la sélection en trou (carte à trous)">${ic('brackets')}</button><i></i>
                    <button data-sb="b" title="Gras" aria-label="Gras">${ic('bold')}</button><button data-sb="i" title="Italique" aria-label="Italique">${ic('italic')}</button><button data-sb="u" title="Souligné" aria-label="Souligné">${ic('underline')}</button><button data-sb="s" title="Barré" aria-label="Barré"><s>S</s></button>
                    <button data-sb="code" title="Code" aria-label="Code">${ic('code')}</button><button data-sb="math" title="Formule" aria-label="Formule">Σ</button>
                    <button data-sb="color" title="Couleur du texte et surlignage" aria-label="Couleurs"><b class="sb-a">A</b>${ic('chevronDown')}</button><i></i>
                    <button data-sb="more" title="Plus" aria-label="Plus">${ic('more')}</button>`;
                bar.addEventListener('pointerdown', e => e.preventDefault());
                bar.addEventListener('click', e => { const b = e.target.closest('[data-sb]'); if (b) this.nbSelAct(b.dataset.sb, b); });
                document.body.appendChild(bar);
            }
            const w = bar.offsetWidth, h = bar.offsetHeight, r = info.rect;
            bar.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
            bar.style.top = `${r.top - h - 10 >= 8 ? r.top - h - 10 : Math.min(innerHeight - h - 8, r.bottom + 10)}px`;
        }, 90);
    },
    nbSelAct(k, btn) {
        const info = this.nbSelInfo(), n = this.note(this.ui.note), i = this.nb.active, b = n && n.b[i]; if (!info || !b) return;
        const text = b.x.slice(info.s, info.e);
        if (k === 'b') this.nbWrap('**'); else if (k === 'i') this.nbWrap('*'); else if (k === 'u') this.nbWrap('__'); else if (k === 's') this.nbWrap('~~'); else if (k === 'code') this.nbWrap('`'); else if (k === 'math') this.nbWrap('$');
        else if (k === 'cloze') this.nbSelToCloze();
        else if (k === 'link') this.nbLinkPicker({ s: info.s, e: info.e });
        else if (k === 'ai') this.aiTextCards(text, n);
        else if (k === 'type') this.nbMenu([['p', 'Texte simple', 'file'], ['h1', 'Titre 1', 'heading'], ['h2', 'Titre 2', 'heading'], ['h3', 'Titre 3', 'heading'], ['todo', 'À faire', 'checkSq'], ['quote', 'Citation', 'quote'], ['callout', 'Encadré', 'info'], ['code', 'Code', 'code'], ['num', 'Liste numérotée', 'listOrdered']].map(([t, label, ico]) => ({ ico, label, on: b.t === t, fn: () => this.nbSetType(i, t) })), btn);
        else if (k === 'color') this.nbMenu([{ ico: 'palette', label: 'Couleur du texte…', fn: () => this.nbSelColor('text', btn) }, { ico: 'pencil', label: 'Couleur de surlignage…', fn: () => this.nbSelColor('hl', btn) }, { sep: true }, { ico: 'eraser', label: 'Retirer les couleurs', fn: () => this.nbSelColor('none', btn) }], btn);
        else if (k === 'more') this.nbMenu([{ ico: 'eraser', label: 'Effacer la mise en forme', fn: () => { const s = info.s, e = info.e; this.nbOp(() => { const seg = b.x.slice(s, e).replace(/==(?:\{(?:[ygbp]|#[0-9a-f]{6})\})?/gi, '').replace(/\{c:#[0-9a-f]{6}\|([^{}|]*)\}/gi, '$1').replace(/\*\*|~~|`|\$/g, '').replace(/(^|[^\w])__([^_]+)__(?!\w)/g, '$1$2'); b.x = b.x.slice(0, s) + seg + b.x.slice(e); }, i, 'end'); } }, { ico: 'copy', label: 'Copier le texte', fn: () => { try { navigator.clipboard.writeText(this.nbPlain(text)); } catch { /* ignore */ } } }, { ico: 'search', label: 'Rechercher dans la note', fn: () => { this.nbFindToggle(); const f = $('#nb-findin'); if (f) f.value = text; } }], btn);
    },
    /* colour the selection: text colour {c:#hex|…} or highlight =={#hex}…== (same picker everywhere) */
    nbSelColor(kind, anchor) {
        const info = this.nbSelInfo(); if (!info) return; const n = this.note(this.ui.note), i = this.nb.active, b = n.b[i], s = info.s, e = info.e;
        const strip = seg => kind === 'hl' ? seg.replace(/==(?:\{(?:[ygbp]|#[0-9a-f]{6})\})?/gi, '') : seg.replace(/\{c:#[0-9a-f]{6}\|([^{}|]*)\}/gi, '$1');
        const apply = hex => {
            const cur = this.nbInfoAfter ? null : null; void cur;
            this.nbOp(() => {
                let seg = b.x.slice(s, e);
                if (kind === 'none') seg = seg.replace(/==(?:\{(?:[ygbp]|#[0-9a-f]{6})\})?/gi, '').replace(/\{c:#[0-9a-f]{6}\|([^{}|]*)\}/gi, '$1');
                else { seg = strip(seg); if (hex) seg = kind === 'hl' ? `=={${hex}}${seg}==` : `{c:${hex}|${seg}}`; }
                b.x = b.x.slice(0, s) + seg + b.x.slice(e);
            }, i, 'end');
        };
        if (kind === 'none') { apply(''); return; }
        this.colorPicker({ anchor, title: kind === 'hl' ? 'Couleur de surlignage' : 'Couleur du texte', none: true, swatches: kind === 'hl' ? ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74', '#c4b5fd', '#fca5a5', '#67e8f9', '#e5e7eb', '#fef08a', '#bbf7d0', '#bfdbfe'] : undefined, onPick: apply });
    },
    nbSetType(i, t) {
        const n = this.note(this.ui.note), b = n.b[i]; if (!b || nbSolid(b.t)) return;
        this.nbOp(() => { delete b.cd; delete b.done; b.t = t; if (t === 'callout' && !b.k) b.k = 'info'; }, i, 'end');
    },
    aiTextCards(text, n) {
        if (!this.aiReady()) { this.aiNeedKey(); return; }
        this.aiCardsFrom(this.nbPlain(text), { label: 'Sélection de la note' }).then(lines => { if (lines) this.openImportModal({ text: lines.join('\n'), ai: true, deckId: (n && n.deckId) || '' }); });
    }
});
document.addEventListener('selectionchange', () => { if (window.app && app.nbSelBarUpdate) app.nbSelBarUpdate(); });
window.addEventListener('scroll', () => { const b = document.getElementById('nb-sel'); if (b) b.remove(); }, true);
