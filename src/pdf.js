/* ============================================================
   PDF : un PDF importé est un document (dans un dossier), avec SON paquet de cartes, SA note, ses annotations.
   - le fichier lui-même (octets) est gardé à part, dans IndexedDB, sous son empreinte (le même PDF n'est jamais gardé deux fois) ;
   - tout le reste (pages, surlignages, dessins, dernière page lue…) est dans data.pdfs : sauvegardé, synchronisé, mis en corbeille avec lui ;
   - les gros fichiers (lecteur PDF, écriture PDF) ne se chargent que quand un PDF s'ouvre (vendor/ → lazy/).
   ============================================================ */
Object.assign(ICONS, {
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h1.5a1.5 1.5 0 0 1 0 3H8v-3zM13 13v3M13 13h2M17 16v-3h1.5"/>',
    highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3.2-2.4L8 15"/>',
    textcursor: '<path d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1M7 22h1a4 4 0 0 0 4-4v-1M7 2h1a4 4 0 0 1 4 4v1"/>',
    typeT: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    pen: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 7.6 7.6"/><circle cx="11" cy="11" r="2"/>',
    area: '<path d="M5 3h2M11 3h2M17 3h2M5 21h2M11 21h2M17 21h2M3 5v2M3 11v2M3 17v2M21 5v2M21 11v2M21 17v2"/>',
    fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
    pageadd: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8"/><path d="M14 2v6h6M18 14v6M15 17h6"/>',
    toc: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4"/>',
    minus: '<path d="M5 12h14"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>'
});
const PDF_MAX_LOCAL = 150 * 1024 * 1024, PDF_MAX_SYNC = 25 * 1024 * 1024, PDF_CHUNK = 400 * 1024;
const PDF_COLORS = ['#fde047', '#86efac', '#7dd3fc', '#f9a8d4', '#fdba74', '#c4b5fd'];   // yellow, green, blue, pink, orange, purple
const PDF_PEN = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#9333ea'];

function normalizePdfAnn(a) {
    if (!a || typeof a !== 'object') return null;
    const t = ['hl', 'tx', 'nt', 'dr', 'sh', 'ar'].includes(a.t) ? a.t : null; if (!t) return null;
    const o = { i: String(a.i || uid('a')), t, c: /^#[0-9a-f]{6}$/i.test(String(a.c || '')) ? String(a.c) : '#fde047', m: num(a.m, 0) };
    const r4 = v => Math.round(num(v, 0) * 10000) / 10000;
    if (t === 'hl') { o.r = toArray(a.r).slice(0, 60).map(r => toArray(r).slice(0, 4).map(r4)).filter(r => r.length === 4); o.s = String(a.s || '').slice(0, 2000); if (!o.r.length) return null; }
    else if (t === 'tx' || t === 'nt') { o.x = r4(a.x); o.y = r4(a.y); o.w = Math.max(0.05, r4(a.w || 0.4)); o.s = String(a.s || '').slice(0, 2000); o.fs = clamp(num(a.fs, 14), 8, 60); o.b = !!a.b; o.f = ['s', 'r', 'm'].includes(a.f) ? a.f : 's'; o.bg = /^#[0-9a-f]{6}$/i.test(String(a.bg || '')) ? String(a.bg) : ''; }
    else if (t === 'sh') { o.k = ['r', 'o', 't', 'd', 's', 'h'].includes(a.k) ? a.k : 'r'; o.x = r4(a.x); o.y = r4(a.y); o.h = r4(a.h); o.w = Math.max(0.003, r4(a.w)); o.sw = clamp(num(a.sw, 0.004), 0.0008, 0.05); o.f = /^#[0-9a-f]{6}$/i.test(String(a.f || '')) ? String(a.f) : ''; }
    else if (t === 'ar') { o.k = ['a', 'b', 'l'].includes(a.k) ? a.k : 'a'; o.x1 = r4(a.x1); o.y1 = r4(a.y1); o.x2 = r4(a.x2); o.y2 = r4(a.y2); o.w = clamp(num(a.w, 0.004), 0.0008, 0.05); }
    else { o.w = clamp(num(a.w, 0.004), 0.0008, 0.05); o.op = clamp(num(a.op, 1), 0.1, 1); o.p = toArray(a.p).slice(0, 4000).map(p => toArray(p).slice(0, 2).map(r4)).filter(p => p.length === 2); if (o.p.length < 1) return null; }
    return o;
}
/* « Étude du PDF » : niveau choisi et chapitres (titre + pages) ; la progression est calculée à partir des cartes et des QCM réels */
function normalizePdfStudy(s, pages) {
    s = s && typeof s === 'object' ? s : {};
    const ch = toArray(s.ch).slice(0, 80).map(c => { if (!c || typeof c !== 'object') return null; const a = clamp(Math.round(num(c.a, 1)), 1, pages), b = clamp(Math.round(num(c.b, a)), a, pages); return { id: String(c.id || uid('h')).slice(0, 40), t: String(c.t || 'Chapitre').slice(0, 120), a, b }; }).filter(Boolean);
    return { level: ['new', 'basic', 'review'].includes(s.level) ? s.level : '', ch, src: ['toc', 'ai', 'hand'].includes(s.src) ? s.src : '' };
}
function normalizePdf(x) {
    if (!x || typeof x !== 'object' || !x.hash) return null;
    const pages = Math.max(1, Math.round(num(x.pages, 1)));
    let pg = toArray(x.pg).map(g => g && g.k === 'b' ? { id: String(g.id || uid('g')), k: 'b' } : g && g.k === 'p' && num(g.n, 0) >= 1 ? { id: String(g.id || 'p' + g.n), k: 'p', n: Math.round(num(g.n)) } : null).filter(Boolean).slice(0, 2000);
    if (!pg.some(g => g.k === 'p')) pg = Array.from({ length: pages }, (_, i) => ({ id: 'p' + (i + 1), k: 'p', n: i + 1 }));
    const ids = new Set(pg.map(g => g.id)), ann = {};
    if (x.ann && typeof x.ann === 'object') Object.entries(x.ann).forEach(([pid, list]) => { if (!ids.has(pid)) return; const l = toArray(list).map(normalizePdfAnn).filter(Boolean).slice(0, 3000); if (l.length) ann[pid] = l; });
    const trash = toArray(x.trash).map(t => { const a = t && normalizePdfAnn(t.a); return a && ids.has(String(t.pid)) ? { pid: String(t.pid), at: num(t.at, 0), a } : null; }).filter(Boolean).slice(0, 400);
    return {
        id: String(x.id || uid('f')), hash: String(x.hash).slice(0, 64), name: String(x.name || 'PDF').replace(/\.pdf$/i, '').slice(0, 120), size: Math.max(0, num(x.size, 0)), pages,
        deckId: x.deckId ? String(x.deckId) : '', pdeck: x.pdeck ? String(x.pdeck) : '', noteId: x.noteId ? String(x.noteId) : '', created: num(x.created, 0), mod: num(x.mod, 0),
        last: clamp(Math.round(num(x.last, 0)), 0, pg.length - 1), zoom: clamp(num(x.zoom, 1), 0.4, 4), mode: x.mode === 'text' ? 'text' : 'pdf',
        pg, ann, trash, up: !!x.up, toc: toArray(x.toc).slice(0, 300).map(t => ({ t: String(t && t.t || '').slice(0, 120), n: Math.max(1, Math.round(num(t && t.n, 1))), d: clamp(Math.round(num(t && t.d, 0)), 0, 4) })).filter(t => t.t),
        prio: ['none', 'high', 'normal', 'low'].includes(x.prio) ? x.prio : 'none',
        bm: toArray(x.bm).slice(0, 8).map(b => b && ids.has(String(b.pid)) ? { id: String(b.id || uid('k')), pid: String(b.pid), t: String(b.t || '').slice(0, 40) } : null).filter(Boolean),
        study: normalizePdfStudy(x.study, pages),
        ocr: (o => { const r = {}; if (o && typeof o === 'object') Object.entries(o).slice(0, 800).forEach(([k, v]) => { if (/^\d+$/.test(k) && typeof v === 'string' && v.trim()) r[k] = v.slice(0, 20000); }); return r; })(x.ocr)
    };
}
const pdfSig = p => JSON.stringify([p.name, p.deckId, p.pdeck, p.noteId, p.last, p.zoom, p.mode, p.pg, p.ann, p.trash.length, p.up, p.prio, Object.keys(p.ocr || {}).length, p.study]);
/* two devices annotated the same PDF: the lines are united (a line erased on one side stays erased), the rest follows the newer copy */
function mergePdfList(la, ra, tomb, mark) {
    const lm = new Map(la.map(x => [x.id, x])), rm = new Map(ra.map(x => [x.id, x])), out = [];
    new Set([...lm.keys(), ...rm.keys()]).forEach(id => {
        const l = lm.get(id), r = rm.get(id), t = tomb[id] || 0;
        if (l && r) {
            if (t > Math.max(l.mod, r.mod)) { mark(true, true); return; }
            if (pdfSig(l) === pdfSig(r)) { out.push(l); return; }
            const base = l.mod >= r.mod ? l : r, other = base === l ? r : l, m = JSON.parse(JSON.stringify(base));
            const pids = new Set([...Object.keys(l.ann), ...Object.keys(r.ann)]), gone = new Map();
            [...l.trash, ...r.trash].forEach(x => { const k = x.a.i; if (!gone.has(k) || gone.get(k).at < x.at) gone.set(k, x); });
            m.ann = {};
            pids.forEach(pid => {
                const byId = new Map();
                [...(l.ann[pid] || []), ...(r.ann[pid] || [])].forEach(a => { const o = byId.get(a.i); if (!o || a.m > o.m) byId.set(a.i, a); });
                const keep = [...byId.values()].filter(a => !(gone.has(a.i) && gone.get(a.i).at >= a.m));
                if (keep.length) m.ann[pid] = keep;
            });
            const seen = new Set(); m.trash = [...gone.values()].filter(x => !seen.has(x.a.i) && seen.add(x.a.i)).slice(0, 400);
            m.up = l.up || r.up; m.last = Math.max(l.last, r.last);
            if (other.pg.length > base.pg.length && other.mod === base.mod) m.pg = other.pg;
            out.push(normalizePdf(m)); mark(base !== l || true, base !== r || true);
        } else if (l) { if (t > 0 && t >= l.mod) mark(true, false); else { out.push(l); mark(false, true); } }
        else if (t > 0 && t >= r.mod) mark(false, true);
        else { out.push(r); mark(true, false); }
    });
    return out;
}

/* the bytes of the PDF files: IndexedDB, one entry per fingerprint */
const PdfStore = {
    mem: new Map(), _p: null,
    open() {
        return this._p || (this._p = new Promise(res => {
            try { const r = indexedDB.open('lh_pdf', 1); r.onupgradeneeded = () => r.result.createObjectStore('blobs', { keyPath: 'hash' }); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); } catch { res(null); }
        }));
    },
    async get(hash) {
        if (this.mem.has(hash)) return this.mem.get(hash);
        const db = await this.open(); if (!db) return null;
        return new Promise(res => { try { const q = db.transaction('blobs').objectStore('blobs').get(hash); q.onsuccess = () => res(q.result ? q.result.buf : null); q.onerror = () => res(null); } catch { res(null); } });
    },
    async put(hash, buf) {
        const db = await this.open();
        if (!db) { this.mem.set(hash, buf); return true; }
        return new Promise(res => { try { const t = db.transaction('blobs', 'readwrite'); t.objectStore('blobs').put({ hash, buf, size: buf.byteLength, at: Date.now() }); t.oncomplete = () => res(true); t.onerror = () => { this.mem.set(hash, buf); res(false); }; } catch { this.mem.set(hash, buf); res(false); } });
    },
    async del(hash) { this.mem.delete(hash); const db = await this.open(); if (!db) return; try { db.transaction('blobs', 'readwrite').objectStore('blobs').delete(hash); } catch { /* ignore */ } },
    async keys() {
        const db = await this.open(), out = new Set(this.mem.keys()); if (!db) return [...out];
        return new Promise(res => { try { const q = db.transaction('blobs').objectStore('blobs').getAllKeys(); q.onsuccess = () => { (q.result || []).forEach(k => out.add(k)); res([...out]); }; q.onerror = () => res([...out]); } catch { res([...out]); } });
    }
};
async function pdfHashOf(buf) {
    if (crypto && crypto.subtle) { const d = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 40); }
    let h = 0; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 7) h = (Math.imul(h, 31) + u[i]) | 0; return 'x' + (h >>> 0).toString(16) + buf.byteLength.toString(16);
}
const bytesToB64Chunked = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToBytes = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const fmtBytes = n => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

/* copy of the PDF files between devices : encrypted with the backup code, cut in pieces of 400 Ko (one row each), resumable */
const PdfSync = {
    ok() { const s = app.data.settings; return !!(s.cloudSync && s.syncKey); },
    async rid(hash, k) { return `pdf_${(await SyncCrypto.sha(`superanki-pdf:${app.data.settings.syncKey}:${hash}`)).slice(0, 28)}_${k}`; },
    async getRow(id) { const r = await Cloud.client.from('game_state').select('data').eq('id', id).maybeSingle(); if (r.error) throw new Error(r.error.message); return r.data ? r.data.data : null; },
    async upload(p, progress = () => {}) {
        if (!this.ok()) return false;
        if (!(await Cloud.ensure())) throw new Error('hors ligne');
        const buf = await PdfStore.get(p.hash); if (!buf) return false;
        if (buf.byteLength > PDF_MAX_SYNC) return 'big';
        const n = Math.max(1, Math.ceil(buf.byteLength / PDF_CHUNK)), key = app.data.settings.syncKey, u8 = new Uint8Array(buf);
        for (let k = 0; k < n; k++) {
            const id = await this.rid(p.hash, k);
            let have = null; try { have = await this.getRow(id); } catch (e) { if (k === 0) throw e; }
            if (have) { progress(k + 1, n); continue; }   // already there (the upload was interrupted before): resumes
            const part = u8.subarray(k * PDF_CHUNK, (k + 1) * PDF_CHUNK), data = await SyncCrypto.encrypt({ h: p.hash, k, n, size: buf.byteLength, b: bytesToB64Chunked(part) }, key);
            const r = await Cloud.client.from('game_state').upsert({ id, data, updated_at: new Date().toISOString() });
            if (r.error) throw new Error(r.error.message);
            progress(k + 1, n);
        }
        return true;
    },
    async download(p, progress = () => {}) {
        if (!(await Cloud.ensure())) throw new Error('hors ligne');
        const key = app.data.settings.syncKey; if (!key) throw new Error('code de sauvegarde manquant');
        let n = 1, parts = [];
        for (let k = 0; k < n; k++) {
            const row = await this.getRow(await this.rid(p.hash, k)); if (!row) throw new Error('PDF absent du cloud');
            const o = row.enc ? await SyncCrypto.decrypt(row, key) : row; n = o.n; parts.push(b64ToBytes(o.b)); progress(k + 1, n);
        }
        const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0)); let at = 0; parts.forEach(x => { out.set(x, at); at += x.length; });
        const hash = await pdfHashOf(out.buffer); if (hash !== p.hash) throw new Error('fichier reçu incomplet');
        await PdfStore.put(p.hash, out.buffer); return true;
    }
};

Object.assign(SuperAnki.prototype, {
    pdf(id) { return id && this.data.pdfs.find(p => p.id === id) || null; },
    pdfSubline(p) { const a = Object.values(p.ann).flat().length, st = p.pdeck && this.deckStats().get(p.pdeck), nc = st ? st.total : 0; return `PDF · ${p.pg.length} p.${a ? ` · ${a} annot.` : ''}${nc ? ` · ${nc} carte${nc > 1 ? 's' : ''}` : ''}`; },
    pdfOfNote(noteId) { return noteId && this.data.pdfs.find(p => p.noteId === noteId) || null; },
    pdfOfDeck(deckId) { return this.data.pdfs.find(p => p.pdeck === deckId) || null; },
    pdfPage(p, pid) { return p.pg.find(g => g.id === pid) || null; },
    pdfPageIndex(p, pid) { return p.pg.findIndex(g => g.id === pid); },
    /* the libraries (loaded the first time a PDF is opened) */
    async pdfLibs() {
        if (window.pdfjsLib && window.pdfjsLib.getDocument) return true;
        const ok = await loadLazy('pdfjs'); if (!ok || !window.pdfjsLib) return false;
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = LAZY.pdfworker; return true;
    },
    async pdfDoc(p) {
        this._pdfDocs = this._pdfDocs || new Map();
        if (this._pdfDocs.has(p.id)) return this._pdfDocs.get(p.id);
        if (!(await this.pdfLibs())) throw new Error('Le lecteur PDF n\'a pas pu se charger (hors ligne ?).');
        const buf = await PdfStore.get(p.hash); if (!buf) { const e = new Error('Ce PDF n\'est pas sur cet appareil.'); e.missing = true; throw e; }
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
        this._pdfDocs.set(p.id, doc); return doc;
    },
    /* the deck that holds the cards of a PDF (re-made if it was deleted by hand) */
    pdfDeckOf(p) {
        let d = p.pdeck && this.deck(p.pdeck);
        if (!d) { d = { id: uid('d'), name: p.name.slice(0, 60), emoji: '📄', description: 'Les cartes de ce PDF.', created: Date.now(), parent: p.deckId && this.deck(p.deckId) ? p.deckId : null, opts: null, mod: 0, preset: null, limits: null, pdf: p.id }; this.data.decks.push(d); p.pdeck = d.id; }
        return d;
    },
    pdfNoteOf(p) {
        let n = this.note(p.noteId);
        if (!n) {
            n = this.noteNew(p.name, { deckId: p.deckId, emoji: '📄', b: [{ t: 'p', x: `PDF : [[pdf:${p.id}:|Ouvrir le PDF]]`, d: 0 }, nbEmpty()] });
            p.noteId = n.id;
        }
        return n;
    },
    pdfPick(deckId = '') {
        const input = $('#hidden-file'); input.accept = 'application/pdf,.pdf'; input.multiple = true; input.value = '';
        input.onchange = async () => { const fs = [...input.files]; input.multiple = false; for (const f of fs) await this.pdfImport(f, { deckId }); };
        input.click();
    },
    async pdfImport(file, { deckId = '', open = true } = {}) {
        if (!file || !(/pdf/i.test(file.type) || /\.pdf$/i.test(file.name))) { this.toast('Ce fichier n\'est pas un PDF.', 'warning'); return null; }
        if (file.size > PDF_MAX_LOCAL) { this.toast(`PDF trop lourd (${fmtBytes(file.size)}) : la limite est de ${fmtBytes(PDF_MAX_LOCAL)}.`, 'warning'); return null; }
        const t = this.toast('Lecture du PDF…', 'success', ic('pdf'));
        let buf; try { buf = await file.arrayBuffer(); } catch { this.toast('Impossible de lire ce fichier.', 'error'); return null; }
        const hash = await pdfHashOf(buf), have = this.data.pdfs.find(p => p.hash === hash);
        if (have) { this.toast('Ce PDF est déjà dans ton appli : je l\'ouvre.', 'success', ic('pdf')); if (open) this.pdfOpen(have.id); return have; }
        if (!(await this.pdfLibs())) { this.toast('Le lecteur PDF n\'a pas pu se charger (hors ligne ?).', 'error'); return null; }
        let doc, meta = {}, toc = [];
        try {
            doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
            try { const m = await doc.getMetadata(); meta = (m && m.info) || {}; } catch { /* no metadata */ }
            toc = await this.pdfOutline(doc);
        } catch (e) { this.toast(e && e.name === 'PasswordException' ? 'Ce PDF est protégé par un mot de passe.' : 'Ce PDF est illisible ou abîmé.', 'error'); return null; }
        await PdfStore.put(hash, buf);
        const name = String((meta.Title && String(meta.Title).trim().length > 2 ? meta.Title : file.name.replace(/\.pdf$/i, '')) || 'PDF').trim().slice(0, 120);
        const p = normalizePdf({ id: uid('f'), hash, name, size: file.size, pages: doc.numPages, deckId: deckId && this.deck(deckId) ? deckId : '', created: Date.now(), toc });
        this.data.pdfs.push(p); this._pdfDocs = this._pdfDocs || new Map(); this._pdfDocs.set(p.id, doc);
        this.pdfDeckOf(p); this.pdfNoteOf(p); this.save();
        this.toast(`PDF ajouté (${plural(p.pages, 'page')}) : son paquet et sa note sont créés.`, 'success', ic('pdf'));
        this.pdfSyncSoon(p);
        if (open) this.pdfOpen(p.id);
        return p;
    },
    /* the table of contents of the file, if it has one */
    async pdfOutline(doc) {
        const out = [];
        try {
            const ol = await doc.getOutline(); if (!ol) return out;
            const walk = async (items, d) => { for (const it of items) { if (out.length > 250) return; let n = 0; try { let dest = it.dest; if (typeof dest === 'string') dest = await doc.getDestination(dest); if (Array.isArray(dest) && dest[0]) n = (await doc.getPageIndex(dest[0])) + 1; } catch { /* no page */ } if (n && /[\p{L}\p{N}]/u.test(it.title || '')) out.push({ t: String(it.title).trim(), n, d: Math.min(d, 3) }); if (it.items && it.items.length && d < 3) await walk(it.items, d + 1); } };
            await walk(ol, 0);
        } catch { /* no outline */ }
        return out;
    },
    pdfRename(p, name) {
        name = String(name).trim().slice(0, 120); if (!name || name === p.name) return;
        p.name = name; const d = this.deck(p.pdeck); if (d) d.name = name.slice(0, 60); const n = this.note(p.noteId); if (n && /^PDF/.test((n.b[0] || {}).x || '')) { /* the note keeps its own title */ }
        this.save();
    },
    /* move to another folder: the PDF, its deck and its note */
    pdfMove(p, deckId) {
        const dk = deckId && this.deck(deckId) ? deckId : '';
        if (dk && (dk === p.pdeck || this.descendantIds(p.pdeck || '__').includes(dk))) { this.toast('Impossible de le déplacer dans son propre paquet.', 'warning'); return false; }
        p.deckId = dk; const d = this.deck(p.pdeck); if (d) d.parent = dk || null;
        const n = this.note(p.noteId); if (n && n.deckId !== dk && !n.parent) { n.deckId = dk; this.noteDescendants(n.id).forEach(x => { this.note(x).deckId = dk; }); this.nbCardsFollow(n); }
        this.save(); return true;
    },
    /* delete: the PDF, its deck and its cards go to the trash together; « Annuler » brings everything back */
    pdfDelete(p) {
        const set = new Set(p.pdeck ? this.descendantIds(p.pdeck) : []);
        const ids = this.data.cards.filter(c => set.has(c.deckId)).map(c => c.id), nset = new Set(p.noteId && this.note(p.noteId) ? [p.noteId, ...this.noteDescendants(p.noteId)] : []);
        this.change('suppression de PDF', ids, () => {
            this.data.pdfs = this.data.pdfs.filter(x => x.id !== p.id);
            if (nset.size) this.data.notes = this.data.notes.filter(n => !nset.has(n.id));
            if (set.size) { this.data.decks = this.data.decks.filter(d => !set.has(d.id)); this.data.cards = this.data.cards.filter(c => !set.has(c.deckId)); this.data.qcms = this.data.qcms.filter(q => !set.has(q.deckId)); }
        }, { decks: true, qcms: true, pdfs: true, notes: true });
        if (this.view === 'pdf') { this.pdfLeave(); this.go('notes'); } else this.render();
        this.undoToast(`PDF supprimé${ids.length ? ` (avec ${plural(ids.length, 'carte')})` : ''}`, ic('trash'));
    },
    /* bytes for the files the app does not need any more are dropped (never a PDF that is still in the app or in the trash) */
    async pdfGc() {
        try {
            const fids = n => (n && n.b ? n.b.filter(b => b.t === 'file').map(b => b.fid) : []);   // files joined to notes (notes-media.js) live in the same store
            const keep = new Set([...this.data.pdfs.map(p => p.hash), ...this.data.trash.filter(t => t.k === 'pdf').map(t => t.c.hash), ...this.data.notes.flatMap(fids), ...this.data.trash.filter(t => t.k === 'note').flatMap(t => fids(t.c))]);
            for (const k of await PdfStore.keys()) if (!keep.has(k)) await PdfStore.del(k);
        } catch { /* ignore */ }
    },
    /* where is the file : here, only in the cloud, nowhere */
    async pdfHere(p) { return !!(await PdfStore.get(p.hash)); },
    pdfSyncSoon(p) {
        if (!PdfSync.ok()) return;
        setTimeout(async () => {
            try {
                const r = await PdfSync.upload(p, (k, n) => { if (this.view === 'pdf' && this.pv && this.pv.p === p) { const el = $('#pdf-sync'); if (el) el.textContent = `Envoi vers tes autres appareils… ${Math.round(k / n * 100)} %`; } });
                if (r === 'big') { this.toast(`Ce PDF fait ${fmtBytes(p.size)} : au-delà de ${fmtBytes(PDF_MAX_SYNC)}, il reste sur cet appareil (les annotations se synchronisent quand même).`, 'warning', ic('pdf')); return; }
                if (r === true && !p.up) { p.up = true; this.save(); }
            } catch (e) { console.warn('PDF cloud:', e.message); }
        }, 1500);
    },
    /* a PDF known from another device but whose file is not here: fetched from the cloud */
    async pdfFetch(p, progress) {
        if (!PdfSync.ok()) throw new Error('La synchronisation n\'est pas activée sur cet appareil (Profil → Données).');
        if (!p.up) throw new Error('Ce PDF n\'a pas encore été envoyé dans le cloud depuis l\'autre appareil.');
        await PdfSync.download(p, progress); return true;
    },

    /* ---------- getting the file back ---------- */
    pdfSaveBlob(bytes, name, type = 'application/pdf') {
        const blob = new Blob([bytes], { type }), a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },
    async pdfExportOriginal(p) {
        const buf = await PdfStore.get(p.hash); if (!buf) { this.toast('Le fichier n\'est pas sur cet appareil.', 'warning'); return; }
        this.pdfSaveBlob(buf, `${p.name.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`); this.toast('PDF original exporté (jamais modifié)', 'success', ic('export'));
    },
    /* a real PDF with the highlights, texts and drawings drawn in it (opens in any reader) */
    async pdfAnnotatedBytes(p) {
        if (!(await loadLazy('pdflib')) || !window.PDFLib) throw new Error('L\'outil d\'export n\'a pas pu se charger (hors ligne ?).');
        const { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle, BlendMode } = PDFLib;
        const buf = await PdfStore.get(p.hash); if (!buf) throw new Error('Le fichier n\'est pas sur cet appareil.');
        const src = await PDFDocument.load(buf, { ignoreEncryption: true }), out = await PDFDocument.create(), fonts = {}, fontOf = async a => { const k = (a.f || 's') + (a.b ? 'b' : ''); if (!fonts[k]) fonts[k] = await out.embedFont({ s: StandardFonts.Helvetica, sb: StandardFonts.HelveticaBold, r: StandardFonts.TimesRoman, rb: StandardFonts.TimesRomanBold, m: StandardFonts.Courier, mb: StandardFonts.CourierBold }[k]); return fonts[k]; }, font = await fontOf({});
        const need = [...new Set(p.pg.filter(g => g.k === 'p').map(g => g.n - 1))], copied = await out.copyPages(src, need), byN = new Map(need.map((n, i) => [n, copied[i]]));
        const first = copied[0] ? copied[0].getSize() : { width: 595, height: 842 };
        const col = hex => { const v = parseInt(hex.slice(1), 16); return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255); };
        const safe = s => String(s).replace(/[^\x20-\x7E -ÿ€’‘“”–—…•]/g, '?').replace(/’/g, '\'');
        let warned = 0;
        for (const g of p.pg) {
            const page = g.k === 'p' ? byN.get(g.n - 1) : null, pg = page ? out.addPage(page) : out.addPage([first.width, first.height]);
            const rot = ((pg.getRotation().angle % 360) + 360) % 360, { width: Wu, height: Hu } = pg.getSize(), Vw = rot % 180 ? Hu : Wu, Vh = rot % 180 ? Wu : Hu;
            const map = (x, y) => { const vx = x * Vw, vy = y * Vh; return rot === 90 ? [vy, vx] : rot === 180 ? [Wu - vx, vy] : rot === 270 ? [Wu - vy, Hu - vx] : [vx, Hu - vy]; };
            for (const a of (p.ann[g.id] || [])) {
                if (a.t === 'hl') a.r.forEach(([x, y, w, h]) => { const [x1, y1] = map(x, y), [x2, y2] = map(x + w, y + h); pg.drawRectangle({ x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), color: col(a.c), opacity: 0.42, blendMode: BlendMode.Multiply, borderWidth: 0 });});
                else if (a.t === 'sh' || a.t === 'ar') {
                    const th = Math.max(0.6, (a.t === 'sh' ? a.sw : a.w) * Vw), seg = (A, B) => { const [x1, y1] = map(A[0], A[1]), [x2, y2] = map(B[0], B[1]); pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: th, color: col(a.c), lineCap: LineCapStyle.Round }); };
                    if (a.t === 'sh') { const P = pdfShapePts(a); if (a.f) { const d = P.map((q, k) => { const [mx, my] = map(q[0], q[1]); return `${k ? 'L' : 'M'}${mx} ${Hu - my}`; }).join('') + 'Z'; pg.drawSvgPath(d, { x: 0, y: Hu, color: col(a.f), borderWidth: 0 }); } for (let k = 0; k < P.length; k++) seg(P[k], P[(k + 1) % P.length]); }
                    else { const r0 = Vh / Vw; pdfArrowSegs(a, r0).forEach(([A, B]) => seg(A, B)); }
                }
                else if (a.t === 'dr') { for (let k = 1; k < a.p.length; k++) { const [x1, y1] = map(...a.p[k - 1]), [x2, y2] = map(...a.p[k]); pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: Math.max(0.6, a.w * Vw), color: col(a.c), opacity: a.op || 1, lineCap: LineCapStyle.Round }); } if (a.p.length === 1) { const [x1, y1] = map(...a.p[0]); pg.drawCircle({ x: x1, y: y1, size: Math.max(0.5, a.w * Vw / 2), color: col(a.c) }); } }
                else if (a.t === 'tx' || a.t === 'nt') {
                    const [x1, y1] = map(a.x, a.y), size = a.fs * (Vw / 600), maxW = Math.max(40, a.w * Vw), font = await fontOf(a);
                    if (a.t === 'tx' && a.bg) { const hh = size * 1.25 * Math.max(1, Math.ceil(font.widthOfTextAtSize(safe(a.s), size) / maxW)); pg.drawRectangle({ x: x1 - 2, y: y1 - hh - 2, width: maxW + 4, height: hh + 4, color: col(a.bg) }); }
                    if (rot) warned++;
                    if (a.t === 'nt') pg.drawRectangle({ x: x1 - 3, y: y1 - 3 - size * 1.2 * Math.max(1, Math.ceil(font.widthOfTextAtSize(safe(a.s), size) / maxW)), width: maxW + 6, height: size * 1.2 * Math.max(1, Math.ceil(font.widthOfTextAtSize(safe(a.s), size) / maxW)) + 6, color: rgb(1, 0.96, 0.62), borderColor: rgb(0.85, 0.7, 0.1), borderWidth: 0.6 });
                    pg.drawText(safe(a.s), { x: x1, y: y1 - size, size, font, color: a.t === 'nt' ? rgb(0.2, 0.15, 0) : col(a.c === '#fde047' ? '#111827' : a.c), maxWidth: maxW, lineHeight: size * 1.2 });
                }
            }
        }
        out.setTitle(p.name); out.setProducer('LH Cards');
        return { bytes: await out.save(), warned };
    },
    async pdfExportAnnotated(p) {
        try {
            const t = this.toast('Préparation du PDF annoté…', 'success', ic('pdf'));
            const { bytes, warned } = await this.pdfAnnotatedBytes(p);
            this.pdfSaveBlob(bytes, `${p.name.replace(/[\\/:*?"<>|]+/g, '-')} (annoté).pdf`);
            this.toast(`PDF annoté exporté (${fmtBytes(bytes.byteLength)}). Ouvre-le dans un autre lecteur pour vérifier.${warned ? ' Sur les pages tournées, les textes ajoutés restent à l\'endroit.' : ''}`, 'success', ic('export'));
        } catch (e) { this.toast(e.message || 'Export impossible.', 'error'); }
    },
    /* « Exporter » in the manual backup: the PDF files are an option (they can be heavy) */
    pdfExportChoice() {
        const total = this.pdfTotalSize(), m = this.openModal({ title: 'Exporter la sauvegarde', size: 'narrow', body: `<p class="small muted" style="margin:0 0 12px">La sauvegarde contient tes cartes, notes, annotations de PDF et réglages.</p><label class="check"><input type="checkbox" id="xp-pdf"> Inclure les fichiers PDF (${fmtBytes(total)})</label><p class="small faint" style="margin-top:8px">Sans cette case, le fichier reste léger : tes PDF ne sont pas dedans (annotations et cartes oui). Tu peux aussi exporter un PDF seul : ouvre-le, puis « Plus » → « Exporter le PDF ».</p>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="xp-go">${ic('export')}Exporter</button>` });
        $('#xp-go', m).addEventListener('click', async () => { const w = $('#xp-pdf', m).checked; this.closeModal(m); await this.exportJSONNow(w); });
    },
    /* PDF files known here but not yet in the cloud (the sync was switched on later, an upload was interrupted…) */
    pdfSyncAll() { if (!PdfSync.ok()) return; this.data.pdfs.filter(p => !p.up && p.size <= PDF_MAX_SYNC).forEach((p, i) => setTimeout(() => this.pdfSyncSoon(p), i * 4000)); },
    /* the manual backup file can carry the PDF files too */
    async pdfBlobsForExport() { const out = {}; for (const p of this.data.pdfs) { const b = await PdfStore.get(p.hash); if (b && !out[p.hash]) out[p.hash] = bytesToB64Chunked(new Uint8Array(b)); } return out; },
    pdfTotalSize() { const seen = new Set(); return this.data.pdfs.reduce((s, p) => (seen.has(p.hash) ? s : (seen.add(p.hash), s + p.size)), 0); },
    async pdfRestoreBlobs(blobs) { let n = 0; for (const [h, b64] of Object.entries(blobs || {})) { if (!/^[0-9a-z]+$/i.test(h)) continue; try { const u8 = b64ToBytes(b64); await PdfStore.put(h, u8.buffer); n++; } catch { /* skip */ } } return n; }
});

/* a PDF dropped on the Notes tab (or on a folder page) is imported there */
document.addEventListener('dragover', e => { if (window.app && app.view === 'notes' && e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files') && !e.target.closest('.editor-area')) e.preventDefault(); });
document.addEventListener('drop', e => {
    if (!window.app || app.view !== 'notes' || !e.dataTransfer) return;
    const fs = [...(e.dataTransfer.files || [])].filter(f => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name)); if (!fs.length) return;
    e.preventDefault(); const fp = document.querySelector('.nb-folderpage[data-deck]'), deckId = fp ? fp.dataset.deck : '';
    (async () => { for (const f of fs) await app.pdfImport(f, { deckId, open: fs.length === 1 }); })();
});

/* geometry of shapes and arrows (page coordinates 0 → 1; the arrow heads are computed with the real aspect ratio r = height / width) */
function pdfShapePts(a) {
    const { x, y, w, h } = a, cx = x + w / 2, cy = y + h / 2;
    if (a.k === 'o') return Array.from({ length: 28 }, (_, i) => [cx + w / 2 * Math.cos(i / 28 * 2 * Math.PI), cy + h / 2 * Math.sin(i / 28 * 2 * Math.PI)]);
    if (a.k === 't') return [[cx, y], [x + w, y + h], [x, y + h]];
    if (a.k === 'd') return [[cx, y], [x + w, cy], [cx, y + h], [x, cy]];
    if (a.k === 'h') return [[x + w * 0.25, y], [x + w * 0.75, y], [x + w, cy], [x + w * 0.75, y + h], [x + w * 0.25, y + h], [x, cy]];
    if (a.k === 's') return Array.from({ length: 10 }, (_, i) => { const rr = i % 2 ? 0.2 : 0.5, an = -Math.PI / 2 + i * Math.PI / 5; return [cx + w * rr * 2 * Math.cos(an) / 2 * 1, cy + h * rr * 2 * Math.sin(an) / 2 * 1]; });
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
function pdfArrowSegs(a, r) {
    const segs = [[[a.x1, a.y1], [a.x2, a.y2]]]; if (a.k === 'l') return segs;
    const head = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = (y2 - y1) * r, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, hs = Math.max(0.018, a.w * 5), ang = 0.45; return [-1, 1].map(s => { const c = Math.cos(ang * s), sn = Math.sin(ang * s), vx = -(ux * c - uy * sn) * hs, vy = -(ux * sn + uy * c) * hs; return [[x2, y2], [x2 + vx, y2 + vy / r]]; }); };
    segs.push(...head(a.x1, a.y1, a.x2, a.y2)); if (a.k === 'b') segs.push(...head(a.x2, a.y2, a.x1, a.y1));
    return segs;
}
