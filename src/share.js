/* ============================================================
   Sharing a deck (no server): a .lhcards file (cards, images, sub-decks; never your progress), a link or a QR code (text only, small decks).
   The link carries the deck itself after the "#" (nothing is sent anywhere). Receiving: file, pasted link/code, QR scan with the camera.
   ============================================================ */
const SHARE_QR_MAX = 2200, SHARE_LINK_MAX = 7000;
const shareB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const shareUnb64 = t => { const s = atob(String(t).replace(/-/g, '+').replace(/_/g, '/')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
const shareStream = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const shareZip = (bytes, fmt) => typeof CompressionStream === 'function' ? shareStream(bytes, new CompressionStream(fmt)) : Promise.resolve(null);
const shareUnzip = (bytes, fmt) => shareStream(bytes, new DecompressionStream(fmt));

Object.assign(SuperAnki.prototype, {
    /* the deck and its sub-decks as plain data */
    shareCollect(deckId, withMedia) {
        const ids = this.descendantIds(deckId), idx = {}, decks = [], seen = new Set(), media = {};
        let skipped = 0;
        ids.forEach(id => { const d = this.deck(id); if (!d) return; idx[id] = decks.length; decks.push({ n: d.name, e: d.emoji || '📁', p: id === deckId ? -1 : (idx[d.parent] != null ? idx[d.parent] : 0), c: [] }); });
        this.data.cards.forEach(c => {
            const di = idx[c.deckId]; if (di == null) return;
            const common = { h: c.hint || '', d: c.detail || '', t: c.tags || [] };
            let e;
            if (c.kind === 'basic' || !c.nf) e = { k: 'b', f: c.front, b: c.back };
            else if (c.kind === 'rev' || c.kind === 'cloze') { if (seen.has(c.nid)) return; seen.add(c.nid); e = c.kind === 'rev' ? { k: 'r', f: c.nf.front, b: c.nf.back } : { k: 'c', f: c.nf.text, b: c.nf.extra || '' }; }
            else if (withMedia) e = { k: c.kind, nf: c.nf, o: c.ord, g: c.nid };
            else { skipped++; return; }
            const raw = JSON.stringify(e);
            if (!withMedia && /media:[a-z0-9]+|data:(image|audio)/.test(raw)) { skipped++; return; }
            if (withMedia) (raw.match(/media:[a-z0-9]+/g) || []).forEach(m => { const id = m.slice(6); if (this.data.media[id]) media[id] = this.data.media[id]; });
            decks[di].c.push({ ...e, ...(common.h ? { h: common.h } : {}), ...(common.d ? { d: common.d } : {}), ...(common.t.length ? { t: common.t } : {}) });
        });
        const total = decks.reduce((a, d) => a + d.c.length, 0);
        return { payload: { v: 1, d: decks, ...(withMedia && Object.keys(media).length ? { m: media } : {}) }, total, skipped, images: Object.keys(media).length };
    },
    async shareFileBlob(deckId) {
        const { payload } = this.shareCollect(deckId, true), raw = new TextEncoder().encode(JSON.stringify(payload));
        const z = await shareZip(raw, 'gzip');
        return new Blob([z || raw], { type: 'application/octet-stream' });
    },
    async shareCode(deckId) {
        const col = this.shareCollect(deckId, false), raw = new TextEncoder().encode(JSON.stringify(col.payload));
        const z = await shareZip(raw, 'deflate-raw');
        return { ...col, code: z ? 'z' + shareB64(z) : 'r' + shareB64(raw) };
    },
    shareLink(code) { return `${location.origin}${location.pathname}#partage=${code}`; },
    /* file bytes / text of a link or a code  ->  payload (or null) */
    async shareParseBytes(bytes) {
        try { if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await shareUnzip(bytes, 'gzip'); const p = JSON.parse(new TextDecoder().decode(bytes)); return p && p.v === 1 && Array.isArray(p.d) ? p : null; } catch { return null; }
    },
    async shareParseCode(text) {
        const m = /(?:#partage=)?([zr][A-Za-z0-9_-]{8,})\s*$/.exec(String(text).trim()); if (!m) return null;
        try { const b = shareUnb64(m[1].slice(1)); return await this.shareParseBytes(m[1][0] === 'z' ? await shareUnzip(b, 'deflate-raw') : b); } catch { return null; }
    },

    /* ---------- sending ---------- */
    async shareDeckOpen(deckId) {
        const d = this.deck(deckId); if (!d) return;
        const col = await this.shareCode(deckId), full = this.shareCollect(deckId, true);
        if (!full.total) { this.toast('Ce paquet n\'a aucune carte à partager.', 'warning'); return; }
        const link = this.shareLink(col.code), okLink = link.length <= SHARE_LINK_MAX && col.total > 0, okQr = link.length <= SHARE_QR_MAX && col.total > 0;
        const why = col.skipped ? ` ${plural(col.skipped, 'carte avec image ou occlusion n\'est', 'cartes avec images ou occlusions ne sont')} pas dans le lien ni le QR (seulement dans le fichier).` : '';
        const m = this.openModal({
            title: `Partager « ${esc(d.name)} »`, size: 'narrow',
            body: `<p class="small muted">${plural(full.total, 'carte')}${full.images ? `, ${plural(full.images, 'image')}` : ''}, sous-paquets compris. <b>Ta progression n'est pas partagée</b> : les cartes arrivent neuves.</p>
            <div class="stack" style="gap:10px;margin-top:12px">
                <button class="btn btn-primary btn-block" data-sh="file">${ic('export')}Envoyer le fichier (.lhcards)</button>
                <button class="btn btn-soft btn-block" data-sh="link" ${okLink ? '' : 'disabled'}>${ic('link')}Copier le lien</button>
                <button class="btn btn-soft btn-block" data-sh="qr" ${okQr ? '' : 'disabled'}>${ic('layers')}Afficher un QR code</button>
                ${okLink ? '' : '<p class="small muted">Trop gros pour un lien ou un QR : utilise le fichier.</p>'}
                ${!okQr && okLink ? '<p class="small muted">Trop gros pour un QR code (quelques dizaines de cartes au maximum) : lien ou fichier.</p>' : ''}
                <p class="small muted">${esc(why.trim())} Le lien contient le paquet lui-même, il ne passe par aucun serveur. Si la personne ouvre le lien dans Safari alors que son appli est installée sur l'écran d'accueil, qu'elle le copie puis le colle dans « Recevoir un paquet ».</p>
                <div id="sh-out"></div>
            </div>`
        });
        m.addEventListener('click', async e => {
            const b = e.target.closest('[data-sh]'); if (!b || b.disabled) return;
            const out = $('#sh-out', m), kind = b.dataset.sh;
            if (kind === 'file') {
                const blob = await this.shareFileBlob(deckId), name = `${(d.name || 'paquet').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'paquet'}.lhcards`;
                const file = new File([blob], name, { type: 'application/octet-stream' });
                try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: d.name }); return; } } catch (er) { if (er && er.name === 'AbortError') return; }
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            } else if (kind === 'link') {
                let ok = false; try { await navigator.clipboard.writeText(link); ok = true; } catch { /* below */ }
                out.innerHTML = ok ? `<p class="small">${ic('check')} Lien copié.</p>` : `<textarea class="input" rows="4" readonly onclick="this.select()">${esc(link)}</textarea>`;
            } else if (kind === 'qr') {
                out.innerHTML = '<p class="small muted">Création du QR code…</p>';
                if (!(await loadLazy('qrgen')) || !window.qrcode) { out.innerHTML = '<p class="small muted">Le QR code n\'a pas pu se charger (hors ligne ?).</p>'; return; }
                try { const q = qrcode(0, 'L'); q.addData(link); q.make(); out.innerHTML = `<div class="sh-qr">${q.createSvgTag({ cellSize: 4, margin: 4, scalable: true })}</div><p class="small muted" style="text-align:center">Fais-le scanner dans « Recevoir un paquet › Scanner un QR code ».</p>`; }
                catch { out.innerHTML = '<p class="small muted">Trop gros pour un QR code : utilise le lien ou le fichier.</p>'; }
            }
        });
    },

    /* ---------- receiving ---------- */
    shareReceiveOpen() {
        const m = this.openModal({
            title: 'Recevoir un paquet', size: 'narrow',
            body: `<div class="stack" style="gap:10px">
                <button class="btn btn-primary btn-block" data-rc="file">${ic('layers')}Choisir un fichier .lhcards</button>
                <button class="btn btn-soft btn-block" data-rc="scan">${ic('layers')}Scanner un QR code</button>
                <label class="field"><span class="label">Ou coller un lien / un code</span><textarea class="input" id="rc-text" rows="3" placeholder="https://…#partage=…" spellcheck="false"></textarea></label>
                <button class="btn btn-soft btn-block" data-rc="paste">${ic('check')}Lire ce lien</button>
                <p class="small muted" id="rc-msg"></p>
            </div>`
        });
        const msg = t => { $('#rc-msg', m).textContent = t; };
        m.addEventListener('click', async e => {
            const b = e.target.closest('[data-rc]'); if (!b) return;
            if (b.dataset.rc === 'file') {
                const input = $('#hidden-file'); input.accept = '.lhcards,application/octet-stream,*/*'; input.value = '';
                input.onchange = async () => { const f = input.files[0]; if (!f) return; const p = await this.shareParseBytes(new Uint8Array(await f.arrayBuffer())); if (!p) { msg('Ce fichier n\'est pas un paquet LH Cards.'); return; } this.closeModal(m); this.shareReceive(p); };
                input.click();
            } else if (b.dataset.rc === 'paste') {
                const p = await this.shareParseCode($('#rc-text', m).value); if (!p) { msg('Lien ou code non reconnu. Copie-le en entier.'); return; } this.closeModal(m); this.shareReceive(p);
            } else if (b.dataset.rc === 'scan') { this.closeModal(m); this.shareScan(); }
        });
    },
    async shareScan() {
        let stream = null, alive = true;
        const m = this.openModal({ title: 'Scanner un QR code', size: 'narrow', body: '<video id="sc-v" playsinline muted style="width:100%;border-radius:14px;background:#000;min-height:220px"></video><p class="small muted" id="sc-msg">Ouverture de la caméra…</p>', onClose: () => { alive = false; if (stream) stream.getTracks().forEach(t => t.stop()); } });
        const msg = t => { const e = $('#sc-msg', m); if (e) e.textContent = t; };
        if (!(await loadLazy('qrscan')) || !window.jsQR) { msg('Le lecteur n\'a pas pu se charger (hors ligne ?).'); return; }
        try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); } catch { msg('Caméra refusée ou absente. Tu peux aussi scanner avec l\'appareil photo du téléphone puis coller le lien.'); return; }
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = $('#sc-v', m); v.srcObject = stream; try { await v.play(); } catch { /* ignore */ }
        msg('Place le QR code dans l\'image.');
        const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
        const tick = async () => {
            if (!alive) return;
            if (v.videoWidth) {
                const k = Math.min(1, 640 / v.videoWidth); cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k); cx.drawImage(v, 0, 0, cv.width, cv.height);
                const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
                if (r && r.data) { const p = await this.shareParseCode(r.data); if (p) { this.closeModal(m); this.shareReceive(p); return; } msg('Ce QR code n\'est pas un paquet LH Cards.'); }
            }
            setTimeout(tick, 220);
        };
        tick();
    },
    /* preview, then adding (new cards, none of the sender's progress) */
    async shareReceive(p) {
        if (typeof p === 'string') p = await this.shareParseCode(p);
        if (!p || !Array.isArray(p.d) || !p.d.length) { this.toast('Ce paquet partagé est illisible.', 'warning'); return; }
        const total = p.d.reduce((a, d) => a + (d.c || []).length, 0), root = p.d[0];
        const ok = await this.confirm({ title: `Recevoir « ${String(root.n || 'Paquet').slice(0, 60)} » ?`, message: `${plural(total, 'carte')}${p.d.length > 1 ? `, ${plural(p.d.length - 1, 'sous-paquet')}` : ''}. Elles seront ajoutées comme un nouveau paquet, avec des cartes neuves.`, ok: 'Ajouter' });
        if (!ok) return;
        const now = Date.now(), dmap = [], clean = s => sanitizeHtml(String(s == null ? '' : s));
        let rootId = '';
        this.change('paquet reçu', [], () => {
            const ids = [];
            if (p.m && typeof p.m === 'object') Object.keys(p.m).forEach(id => { if (/^[a-z0-9]+$/i.test(id) && /^data:(image|audio)\//.test(String(p.m[id])) && !this.data.media[id]) this.data.media[id] = p.m[id]; });
            p.d.slice(0, 200).forEach((d, i) => {
                let name = String(d.n || 'Paquet').slice(0, 80);
                if (d.p < 0 || d.p == null) { let k = 2, base = name; while (this.data.decks.some(x => !x.parent && x.name === name)) name = `${base} (${k++})`; }
                const id = uid('d'); dmap[i] = id; if (!rootId) rootId = id;
                this.data.decks.push({ id, name, emoji: String(d.e || '📥').slice(0, 8), description: '', created: now, parent: d.p >= 0 && dmap[d.p] ? dmap[d.p] : null, opts: null, mod: 0 });
            });
            const groups = {};
            p.d.slice(0, 200).forEach((d, i) => (d.c || []).forEach((e, j) => {
                const deckId = dmap[i], base = { hint: clean(e.h), detail: clean(e.d), tags: Array.isArray(e.t) ? e.t.map(x => String(x).slice(0, 40)).slice(0, 20) : [] };
                if (e.k === 'b') { const c = { id: uid('c'), ...freshCard(), deckId, ...base, front: clean(e.f), back: clean(e.b), created: now + ids.length, nid: '', kind: 'basic', ord: 0, nf: null }; this.data.cards.push(c); ids.push(c.id); }
                else if (e.k === 'r') (this.createNote({ type: 'rev', deckId, front: clean(e.f), back: clean(e.b), ...base }) || []).forEach(x => ids.push(x));
                else if (e.k === 'c') (this.createNote({ type: 'cloze', deckId, front: clean(e.f), back: clean(e.b), ...base }) || []).forEach(x => ids.push(x));
                else if ((e.k === 'occl' || e.k === 'custom') && e.nf && typeof e.nf === 'object') {
                    const nid = groups[e.g || ('x' + i + j)] || (groups[e.g || ('x' + i + j)] = uid('n'));
                    const c = { id: uid('c'), ...freshCard(), deckId, ...base, front: '', back: '', created: now + ids.length, nid, kind: e.k, ord: Number(e.o) || 0, nf: JSON.parse(JSON.stringify(e.nf)) };
                    materializeCard(c); this.data.cards.push(c); ids.push(c.id);
                }
            }));
            return ids;
        }, { decks: true });
        this.save(); this.ui.deck = rootId; this.go('decks');
    },
    shareAction(a, el) {
        if (a === 'share-deck') this.shareDeckOpen(el.dataset.deck);
        else if (a === 'share-receive') this.shareReceiveOpen();
    }
});
/* a shared link opened in the app: offer to receive it once the app is up */
setTimeout(() => {
    try {
        const m = /#partage=([zr][A-Za-z0-9_-]+)/.exec(location.hash); if (!m) return;
        history.replaceState(null, '', location.pathname + location.search);
        const go = () => { if (window.app && app.data && !document.getElementById('boot')) app.shareReceive('#partage=' + m[1]); else setTimeout(go, 400); };
        go();
    } catch { /* ignore */ }
}, 1500);
