/* ============================================================
   Anki package import (.apkg, older-versions format): zip -> SQLite -> notes, cards, media.
   Self-contained: a small zip reader (native DecompressionStream) and a read-only SQLite reader.
   Cards arrive as new cards (scheduling is not imported).
   ============================================================ */
const Zip = {
    async inflate(bytes) {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
    },
    async open(buf) {
        const dv = new DataView(buf), u8 = new Uint8Array(buf);
        let e = buf.byteLength - 22;
        while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
        if (e < 0) throw new Error('Ce fichier n\'est pas une archive valide');
        const n = dv.getUint16(e + 10, true);
        let p = dv.getUint32(e + 16, true);
        const files = {};
        for (let i = 0; i < n; i++) {
            if (dv.getUint32(p, true) !== 0x02014b50) break;
            const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
            const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
            files[name] = { method, csize, off };
            p += 46 + nlen + xlen + clen;
        }
        const read = async name => {
            const f = files[name];
            if (!f) return null;
            const nlen = dv.getUint16(f.off + 26, true), xlen = dv.getUint16(f.off + 28, true), start = f.off + 30 + nlen + xlen;
            const data = u8.subarray(start, start + f.csize);
            return f.method === 0 ? data : f.method === 8 ? Zip.inflate(data) : null;
        };
        return { names: Object.keys(files), read };
    }
};

/* minimal read-only SQLite (table b-trees only): enough for Anki collections */
class MiniSqlite {
    constructor(bytes) {
        this.b = bytes; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (new TextDecoder().decode(bytes.subarray(0, 15)) !== 'SQLite format 3') throw new Error('Base de données illisible');
        const ps = this.dv.getUint16(16); this.ps = ps === 1 ? 65536 : ps;
        this.U = this.ps - this.b[20];
    }
    varint(p) {
        let v = 0n;
        for (let i = 0; i < 9; i++) {
            const c = this.b[p + i];
            if (i === 8) { v = (v << 8n) | BigInt(c); return [Number(v), 9]; }
            v = (v << 7n) | BigInt(c & 0x7f);
            if (!(c & 0x80)) return [Number(v), i + 1];
        }
    }
    payload(pos, total, localSize) {
        if (localSize >= total) return this.b.subarray(pos, pos + total);
        const out = new Uint8Array(total);
        out.set(this.b.subarray(pos, pos + localSize), 0);
        let got = localSize, next = this.dv.getUint32(pos + localSize);
        while (got < total && next) {
            const o = (next - 1) * this.ps, take = Math.min(this.U - 4, total - got);
            out.set(this.b.subarray(o + 4, o + 4 + take), got);
            got += take; next = this.dv.getUint32(o);
        }
        return out;
    }
    record(buf) {
        const dec = new TextDecoder();
        let [hl, n] = (() => { const v = this.varintIn(buf, 0); return v; })();
        const types = []; let p = n;
        while (p < hl) { const [t, k] = this.varintIn(buf, p); types.push(t); p += k; }
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), row = [];
        p = hl;
        for (const t of types) {
            let v = null;
            if (t === 0) v = null;
            else if (t >= 1 && t <= 6) { const len = [0, 1, 2, 3, 4, 6, 8][t]; let x = 0n; for (let i = 0; i < len; i++) x = (x << 8n) | BigInt(buf[p + i]); if (buf[p] & 0x80) x -= 1n << BigInt(len * 8); v = Number(x); p += len; }
            else if (t === 7) { v = dv.getFloat64(p); p += 8; }
            else if (t === 8) v = 0; else if (t === 9) v = 1;
            else if (t >= 12) { const len = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2; const sl = buf.subarray(p, p + len); v = t % 2 === 0 ? sl : dec.decode(sl); p += len; }
            row.push(v);
        }
        return row;
    }
    varintIn(buf, p) {
        let v = 0n;
        for (let i = 0; i < 9; i++) {
            const c = buf[p + i];
            if (i === 8) { v = (v << 8n) | BigInt(c); return [Number(v), 9]; }
            v = (v << 7n) | BigInt(c & 0x7f);
            if (!(c & 0x80)) return [Number(v), i + 1];
        }
    }
    /* all rows of a table: [{id: rowid, c: [columns]}] */
    rows(rootPage) {
        const out = [];
        const walk = pg => {
            const base = (pg - 1) * this.ps, hdr = pg === 1 ? 100 : 0, type = this.b[base + hdr], cells = this.dv.getUint16(base + hdr + 3);
            if (type === 0x05) {
                const ptr = base + hdr + 12;
                for (let i = 0; i < cells; i++) walk(this.dv.getUint32(base + this.dv.getUint16(ptr + i * 2)));
                walk(this.dv.getUint32(base + hdr + 8));
            } else if (type === 0x0d) {
                const ptr = base + hdr + 8;
                for (let i = 0; i < cells; i++) {
                    let p = base + this.dv.getUint16(ptr + i * 2);
                    const [plen, a] = this.varint(p); p += a;
                    const [rowid, b2] = this.varint(p); p += b2;
                    const X = this.U - 35;
                    let local = plen;
                    if (plen > X) { const M = Math.floor((this.U - 12) * 32 / 255) - 23, K = M + ((plen - M) % (this.U - 4)); local = K <= X ? K : M; }
                    out.push({ id: rowid, c: this.record(this.payload(p, plen, local)) });
                }
            }
        };
        walk(rootPage);
        return out;
    }
    table(name) {
        const master = this.rows(1).find(r => r.c[0] === 'table' && r.c[1] === name);
        return master ? this.rows(master.c[3]) : [];
    }
}

const APKG_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm' };
const bytesToB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

/* Anki field template -> html (conditionals, field substitution; unknown tags dropped) */
function apkgRender(tpl, fields, front) {
    let out = String(tpl || '');
    for (let i = 0; i < 4; i++) {
        out = out.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (m, f, body) => (fields[f.trim()] || '').trim() ? body : '');
        out = out.replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (m, f, body) => (fields[f.trim()] || '').trim() ? '' : body);
    }
    return out.replace(/\{\{([^}]+)\}\}/g, (m, name) => {
        name = name.trim();
        if (name === 'FrontSide') return front || '';
        if (name === 'Tags' || name === 'Type' || name === 'Deck' || name === 'Subdeck' || name === 'Card') return '';
        const f = name.includes(':') ? name.split(':').pop() : name;
        return fields[f] || '';
    });
}

Object.assign(SuperAnki.prototype, {
    async importApkg(file) {
        const busy = this.openModal({ title: 'Import du paquet Anki', size: 'narrow', body: '<p class="muted" id="apkg-msg">Lecture du fichier...</p><div class="progress"><i id="apkg-bar" style="width:5%;background:var(--primary)"></i></div>' });
        const say = (t, pct) => { const m = $('#apkg-msg', busy), b = $('#apkg-bar', busy); if (m) m.textContent = t; if (b) b.style.width = `${pct}%`; };
        try {
            if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur est trop ancien pour lire les paquets Anki.');
            const zip = await Zip.open(await file.arrayBuffer());
            const dbName = zip.names.includes('collection.anki21') ? 'collection.anki21' : zip.names.includes('collection.anki2') ? 'collection.anki2' : null;
            if (!dbName) throw new Error('Aucune collection trouvée dans ce fichier.');
            say('Lecture des cartes...', 15);
            const dbBytes = await zip.read(dbName);
            const db = new MiniSqlite(dbBytes);
            const notes = db.table('notes'), cardsT = db.table('cards'), col = db.table('col')[0];
            if (!col || !notes.length) throw new Error('Paquet vide.');
            const looksStub = notes.length <= 2 && notes.some(n => /please update|mettez à jour|update to the latest/i.test(String(n.c[6])));
            if (looksStub || (zip.names.includes('collection.anki21b') && dbName === 'collection.anki2' && notes.length <= 2)) {
                throw new Error('Ce paquet est au nouveau format d\'Anki. Réexporte-le en cochant « Prendre en charge les anciennes versions d\'Anki ».');
            }
            const models = JSON.parse(col.c[9] || '{}'), decks = JSON.parse(col.c[10] || '{}');
            let mediaMap = {};
            try { const mb = await zip.read('media'); if (mb) mediaMap = JSON.parse(new TextDecoder().decode(mb)); } catch { mediaMap = {}; }
            const mediaByName = {};
            Object.entries(mediaMap).forEach(([k, v]) => { mediaByName[v] = k; mediaByName[(() => { try { return decodeURIComponent(v); } catch { return v; } })()] = k; });
            const cache = new Map();
            let skippedMedia = 0;
            const mediaRef = async name => {
                if (cache.has(name)) return cache.get(name);
                let ref = null;
                const key = mediaByName[name] ?? mediaByName[(() => { try { return decodeURIComponent(name); } catch { return name; } })()];
                if (key !== undefined) {
                    const bytes = await zip.read(String(key));
                    const ext = (name.split('.').pop() || '').toLowerCase(), mime = APKG_MIME[ext];
                    if (bytes && mime) {
                        if (mime.startsWith('audio/')) { if (bytes.length <= MEDIA_MAX_AUDIO * 2) ref = this.addMedia(`data:${mime};base64,${bytesToB64(bytes)}`); }
                        else if (bytes.length > 250 * 1024 && mime !== 'image/svg+xml') {
                            try { ref = this.addMedia(await this.compressImage(new File([bytes], name, { type: mime }))); } catch { ref = null; }
                        } else if (mime !== 'image/svg+xml') ref = this.addMedia(`data:${mime};base64,${bytesToB64(bytes)}`);
                    }
                }
                if (!ref) skippedMedia++;
                cache.set(name, ref);
                return ref;
            };
            const fixMedia = async html => {
                const names = new Set();
                html.replace(/<img[^>]+src=["']([^"']+)["']/gi, (m, n) => { names.add(n); return m; });
                html.replace(/\[sound:([^\]]+)\]/g, (m, n) => { names.add(n); return m; });
                for (const n of names) {
                    if (/^(data:|https?:)/i.test(n)) continue;
                    const ref = await mediaRef(n);
                    const esc2 = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    if (/\.(mp3|ogg|wav|m4a|aac|opus|oga|flac|webm)$/i.test(n)) html = html.replace(new RegExp(`\\[sound:${esc2}\\]`, 'g'), ref ? `<audio controls src="${ref}"></audio>` : '');
                    else html = html.replace(new RegExp(`(<img[^>]+src=["'])${esc2}(["'])`, 'gi'), ref ? `$1${ref}$2` : '$1x:$2');
                }
                return html.replace(/\[sound:[^\]]*\]/g, '');
            };
            const cardsByNote = new Map();
            cardsT.forEach(r => { const nid = r.c[1]; (cardsByNote.get(nid) || cardsByNote.set(nid, []).get(nid)).push({ did: r.c[2], ord: r.c[3] }); });
            const deckName = did => (decks[did] && decks[did].name) || 'Importé';
            const now = Date.now(), deckIds = new Set();
            const deckFor = path => {
                let parent = null, found = null;
                String(path).split('::').map(x => x.trim()).filter(Boolean).forEach(name => {
                    found = this.data.decks.find(d => d.name === name && (d.parent || null) === parent);
                    if (!found) { found = { id: uid('d'), name, emoji: '📥', description: '', created: now, parent, opts: null, mod: 0, preset: null, limits: null }; this.data.decks.push(found); }
                    parent = found.id;
                });
                return found ? found.id : null;
            };
            let count = 0, done = 0;
            const plan = [];
            for (const note of notes) {
                const model = models[note.c[2]], cs = cardsByNote.get(note.id);
                if (!model || !cs) continue;
                const vals = String(note.c[6]).split('\x1f'), fields = {};
                model.flds.forEach((f, i) => { fields[f.name] = vals[i] || ''; });
                plan.push({ note, model, cs, vals, fields });
            }
            if (!plan.length) throw new Error('Aucune carte lisible dans ce paquet.');
            const created = [];
            for (const it of plan) {
                if (done % 20 === 0) { say(`Conversion des cartes (${done}/${plan.length})...`, 20 + Math.round(done / plan.length * 75)); await new Promise(r => setTimeout(r, 0)); }
                done++;
                const tags = String(it.note.c[5]).split(/\s+/).filter(t => t && !/^(leech|marked)$/i.test(t)).map(t => t.replace(/::/g, '/'));
                const toHtml = async s => sanitizeHtml(await fixMedia(s));
                if (it.model.type === 1) {
                    const text = await toHtml(it.vals[0] || ''), extra = await toHtml(it.vals[1] || '');
                    const nums = clozeNumbers(text);
                    if (!nums.length) continue;
                    const did = deckFor(deckName(it.cs[0].did)), nid = uid('n');
                    nums.forEach((n, i) => { const c = { id: uid('c'), ...freshCard(), deckId: did, hint: '', detail: '', tags: [...tags], created: now + count++, nid, kind: 'cloze', ord: n, nf: { front: '', back: '', text, extra }, front: '', back: '' }; materializeCard(c); created.push(c); });
                } else {
                    for (const cd of it.cs) {
                        const t = it.model.tmpls.find(x => x.ord === cd.ord) || it.model.tmpls[0];
                        const q = apkgRender(t.qfmt, it.fields, ''), aRaw = apkgRender(t.afmt, it.fields, q);
                        const a = aRaw.split(/<hr id=["']?answer["']?\s*\/?>/i).pop();
                        const front = await toHtml(q), back = await toHtml(a);
                        if (isBlank(front)) continue;
                        created.push({ id: uid('c'), ...freshCard(), deckId: deckFor(deckName(cd.did)), front, back, hint: '', detail: '', tags: [...tags], created: now + count++, nid: '', kind: 'basic', ord: 0, nf: null });
                    }
                }
            }
            if (!created.length) throw new Error('Aucune carte n\'a pu être convertie.');
            this.change('import .apkg', [], () => { created.forEach(c => { deckIds.add(c.deckId); this.data.cards.push(c); }); return created.map(c => c.id); }, { decks: true });
            this.closeModal(busy);
            this.ui.deck = [...deckIds][0]; this.ui.filter = 'all';
            this.go('decks');
            this.toast(`${plural(created.length, 'carte importée', 'cartes importées')} dans ${plural(deckIds.size, 'paquet')}${skippedMedia ? ` · ${plural(skippedMedia, 'média ignoré', 'médias ignorés')} (format ou taille)` : ''}`, 'success', null, null);
        } catch (e) {
            console.error(e);
            this.closeModal(busy);
            this.toast(e.message || 'Import impossible', 'error');
        }
    }
});
