/* ============================================================
   Notes : une seule barre à la fois, image (rogner / masquer une zone), date limite sur une case à cocher,
   enregistrement audio, impression / PDF de la note.
   ============================================================ */
Object.assign(ICONS, { mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>' });
Object.assign(SuperAnki.prototype, {
    /* ---------- image: crop ---------- */
    nbImageCrop(i) {
        const n = this.note(this.ui.note), b = n && n.b[i]; if (!b || b.t !== 'img') return;
        const url = /^media:/.test(b.src) ? this.data.media[b.src.slice(6)] : b.src; if (!url) return;
        const m = this.openModal({ title: `${ic('crop')} Rogner l'image`, size: 'wide', body: `<p class="small muted" style="margin:0 0 8px">Trace un cadre sur la partie à garder.</p><div id="ic-stage" style="position:relative;display:inline-block;max-width:100%;touch-action:none;user-select:none;-webkit-user-select:none"><img id="ic-img" src="${esc(url)}" alt="" draggable="false" style="display:block;max-width:100%;max-height:60vh"><div id="ic-box" style="position:absolute;border:2px solid var(--primary);background:rgba(79,70,229,.15);box-shadow:0 0 0 9999px rgba(0,0,0,.45);display:none;pointer-events:none"></div></div>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="ic-go" disabled>${ic('check')}Rogner</button>` });
        const st = $('#ic-stage', m), img = $('#ic-img', m), box = $('#ic-box', m), go = $('#ic-go', m); let r = null, x0 = 0, y0 = 0;
        const pt = e => { const q = img.getBoundingClientRect(); return [clamp(e.clientX - q.left, 0, q.width), clamp(e.clientY - q.top, 0, q.height)]; };
        st.addEventListener('pointerdown', e => { e.preventDefault(); st.setPointerCapture(e.pointerId); [x0, y0] = pt(e); r = null; box.style.display = 'none'; go.disabled = true; });
        st.addEventListener('pointermove', e => { if (!st.hasPointerCapture(e.pointerId)) return; const [x, y] = pt(e); r = [Math.min(x, x0), Math.min(y, y0), Math.abs(x - x0), Math.abs(y - y0)]; Object.assign(box.style, { display: 'block', left: `${r[0]}px`, top: `${r[1]}px`, width: `${r[2]}px`, height: `${r[3]}px` }); go.disabled = r[2] < 12 || r[3] < 12; });
        go.addEventListener('click', () => {
            const q = img.getBoundingClientRect(), k = img.naturalWidth / q.width, cv = document.createElement('canvas');
            cv.width = Math.max(4, Math.round(r[2] * k)); cv.height = Math.max(4, Math.round(r[3] * k)); cv.getContext('2d').drawImage(img, r[0] * k, r[1] * k, r[2] * k, r[3] * k, 0, 0, cv.width, cv.height);
            const ref = this.addMedia(cv.toDataURL('image/jpeg', 0.9)); this.closeModal(m);
            this.nbOp(() => { b.src = ref; }, i, 'end');
        });
    },
    /* ---------- image: hide parts of it (cards) ---------- */
    nbImageOcclude(i) {
        const n = this.note(this.ui.note), b = n && n.b[i]; if (!b || b.t !== 'img') return;
        const url = /^media:/.test(b.src) ? this.data.media[b.src.slice(6)] : b.src; if (!url) return;
        this.openOcclusionModal(null, n.deckId || '', { img: url, ref: /^media:/.test(b.src) ? b.src : '' });
    },
    /* ---------- a due date on a to-do ---------- */
    nbDueChip(b) {
        if (b.t !== 'todo' || !b.due) return '';
        const d = new Date(b.due + 'T12:00:00'), late = !b.done && b.due < dayKey();
        return `<button class="nb-due ${late ? 'late' : ''}" data-nbk="due" title="Date limite : toucher pour changer">${ic('calendar')}${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</button>`;
    },
    nbDuePrompt(i) {
        const n = this.note(this.ui.note), b = n && n.b[i]; if (!b || b.t !== 'todo') return;
        const m = this.openModal({ title: `${ic('calendar')} Date limite`, size: 'narrow', body: `<label class="field"><span class="label">Réviser / faire avant le</span><input class="input" id="due-d" type="date" value="${esc(b.due || '')}"></label>`, foot: `${b.due ? '<button class="btn btn-danger-soft" id="due-x" style="margin-right:auto">Retirer</button>' : ''}<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="due-go">OK</button>` });
        $('#due-go', m).addEventListener('click', () => { const v = $('#due-d', m).value; this.closeModal(m); this.nbOp(() => { if (/^\d{4}-\d\d-\d\d$/.test(v)) b.due = v; else delete b.due; }, i, 'end'); });
        const x = $('#due-x', m); if (x) x.addEventListener('click', () => { this.closeModal(m); this.nbOp(() => { delete b.due; }, i, 'end'); });
    },
    /* ---------- audio recording (one clip per block, kept on the device like attached files) ---------- */
    nbAudioRecord(i) {
        if (!navigator.mediaDevices || !window.MediaRecorder) { this.toast('Ton navigateur ne permet pas d\'enregistrer ici.', 'warning'); return; }
        let rec = null, chunks = [], stream = null, t0 = 0, tm = 0, blob = null, mime = '';
        const m = this.openModal({ title: `${ic('mic')} Enregistrer un audio`, size: 'narrow', body: `<div style="text-align:center"><b id="au-t" style="font-size:2rem">0:00</b><p class="small muted" id="au-st">Touche pour démarrer. Garde l'écran allumé pendant l'enregistrement.</p><div id="au-prev"></div></div>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="au-main">${ic('mic')}Démarrer</button>`, onClose: () => { clearInterval(tm); try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ } if (stream) stream.getTracks().forEach(t => t.stop()); } });
        const main = $('#au-main', m), st = $('#au-st', m), fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
        main.addEventListener('click', async () => {
            if (blob) { const ext = /mp4/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm', f = new File([blob], `Audio ${new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/[/:]/g, '-')}.${ext}`, { type: mime }); this.closeModal(m); await this.nbFileAdd(i, f); return; }
            if (rec && rec.state === 'recording') { rec.stop(); return; }
            try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { st.textContent = 'Micro refusé : autorise-le dans les réglages du navigateur.'; return; }
            mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(x => MediaRecorder.isTypeSupported(x)) || '';
            rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); mime = rec.mimeType || mime || 'audio/webm';
            rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
            rec.onstop = () => { clearInterval(tm); stream.getTracks().forEach(t => t.stop()); blob = new Blob(chunks, { type: mime }); st.textContent = 'Écoute puis ajoute à la note.'; main.innerHTML = `${ic('check')}Ajouter à la note`; const a = document.createElement('audio'); a.controls = true; a.src = URL.createObjectURL(blob); a.style.width = '100%'; $('#au-prev', m).appendChild(a); };
            rec.start(1000); t0 = Date.now(); tm = setInterval(() => { $('#au-t', m).textContent = fmt((Date.now() - t0) / 1000); }, 500);
            st.textContent = 'Enregistrement…'; main.innerHTML = `${ic('x')}Arrêter`;
        });
    },
    /* ---------- print / save the note as a PDF ---------- */
    nbPrintHtml(n) {
        const esch = s => esc(String(s));
        const body = n.b.map((b, i) => {
            const pad = `margin-left:${b.d * 18}px`, x = this.inlineHtml ? this.inlineHtml(b.x) : esch(b.x);
            if (b.t === 'h1' || b.t === 'h2' || b.t === 'h3') return `<${b.t} style="${pad}">${x}</${b.t}>`;
            if (b.t === 'hr') return '<hr>';
            if (b.t === 'img') return `<p style="${pad}"><img src="${esch(/^media:/.test(b.src) ? this.data.media[b.src.slice(6)] || '' : b.src)}" style="max-width:100%"></p>`;
            if (b.t === 'table') return `<table style="${pad}">${b.rows.map((r, ri) => `<tr>${r.map(c => `<${ri === 0 && b.hdr ? 'th' : 'td'}>${this.inlineHtml ? this.inlineHtml(c) : esch(c)}</${ri === 0 && b.hdr ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>`;
            if (b.t === 'code') return `<pre style="${pad}">${esch(b.x)}</pre>`;
            if (b.t === 'quote') return `<blockquote style="${pad}">${x}</blockquote>`;
            if (b.t === 'callout') return `<div class="co" style="${pad}">${x}</div>`;
            if (b.t === 'todo') return `<p style="${pad}">${b.done ? '☑' : '☐'} ${x}${b.due ? ` <small>(avant le ${new Date(b.due + 'T12:00:00').toLocaleDateString('fr-FR')})</small>` : ''}</p>`;
            if (b.t === 'num') return `<p style="${pad}">${this.nbNumOf(n.b, i)}. ${x}</p>`;
            if (b.t === 'video' || b.t === 'file' || b.t === 'toc') return b.t === 'video' ? `<p style="${pad}">▶ ${esch(b.u)}</p>` : b.t === 'file' ? `<p style="${pad}">📎 ${esch(b.name)}</p>` : '';
            return b.x || b.cd ? `<p style="${pad}">• ${x}${b.cd ? ` → ${this.inlineHtml ? this.inlineHtml(b.cd.a || '') : ''}` : ''}</p>` : '';
        }).join('\n');
        return `<!doctype html><html><head><meta charset="utf-8"><title>${esch(this.noteName(n))}</title><style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px}h1{font-size:1.6em}h2{font-size:1.3em}h3{font-size:1.1em}p{margin:4px 0}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #888;padding:4px 8px}th{background:#eee}blockquote{border-left:3px solid #999;margin:6px 0;padding-left:10px;color:#444}pre{background:#f3f3f3;padding:8px;border-radius:6px;white-space:pre-wrap}.co{background:#eef2ff;border-radius:8px;padding:8px 10px;margin:6px 0}mark{background:#fde047}img{border-radius:6px}</style></head><body><h1 style="font-size:1.9em">${esch(this.noteName(n))}</h1>${body}</body></html>`;
    },
    nbPrint(n) {
        n = n || this.note(this.ui.note); if (!n) return;
        const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;height:600px;border:0'; fr.setAttribute('aria-hidden', 'true');
        fr.onload = () => { setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { this.toast('L\'impression n\'est pas disponible ici.', 'warning'); } setTimeout(() => fr.remove(), 60000); }, 300); };
        fr.srcdoc = this.nbPrintHtml(n); document.body.appendChild(fr);
    }
});
/* one bar at a time: while text is selected the selection bar replaces the block bar */
(() => {
    const base = SuperAnki.prototype.nbSelBarUpdate;
    SuperAnki.prototype.nbSelBarUpdate = function (...a) { const r = base.apply(this, a); clearTimeout(this._nbSmT); this._nbSmT = setTimeout(() => document.body.classList.toggle('nb-selmode', !!document.getElementById('nb-sel')), 130); return r; };
})();
