/* ============================================================
   Sélecteur de couleur unique pour toute l'appli : nuancier (grille de couleurs prêtes), roue chromatique
   (teinte + saturation, luminosité au curseur), pipette (EyeDropper sur ordinateur ; sur iPhone : toucher une couleur
   dans une image ou dans la page du PDF), code HEX, dernières couleurs. Il ne vole jamais le focus de l'éditeur de notes.
   ============================================================ */
const CP_SWATCHES = ['#000000', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#ffffff', '#7c2d12', '#78350f',
    '#dc2626', '#ea580c', '#f59e0b', '#eab308', '#84cc16', '#16a34a', '#0d9488', '#0891b2',
    '#2563eb', '#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#e11d48', '#0f766e', '#1d4ed8',
    '#fecaca', '#fed7aa', '#fde68a', '#fef08a', '#d9f99d', '#bbf7d0', '#a5f3fc', '#bfdbfe',
    '#c7d2fe', '#ddd6fe', '#f5d0fe', '#fbcfe8', '#fda4af', '#e7e5e4', '#cbd5e1', '#fef3c7'];
const cpHex = v => { v = String(v || '').trim().replace(/^#/, ''); if (/^[0-9a-f]{3}$/i.test(v)) v = v.split('').map(c => c + c).join(''); return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : ''; };
const cpHsv2hex = (h, s, v) => { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); };
const cpHex2hsv = hex => { const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h * 60, mx ? d / mx : 0, mx]; };
Object.assign(SuperAnki.prototype, {
    cpRecent() { try { return JSON.parse(localStorage.getItem('lh_colors') || '[]').filter(cpHex).slice(0, 8); } catch { return []; } },
    cpRemember(c) { try { localStorage.setItem('lh_colors', JSON.stringify([c, ...this.cpRecent().filter(x => x !== c)].slice(0, 8))); } catch { /* ignore */ } },
    cpClose() { const o = document.getElementById('cpk'); if (o) o.remove(); document.removeEventListener('pointerdown', this._cpOut, true); },
    /* opts: anchor, title, cur (#hex or ''), none (offer « aucune »), swatches (replace the grid), onPick(hex | '') */
    colorPicker({ anchor, title = 'Couleur', cur = '', none = false, swatches = CP_SWATCHES, onPick }) {
        this.cpClose();
        const el = document.createElement('div'); el.id = 'cpk'; el.className = 'cpk'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', title);
        const hsv = cpHex(cur) ? cpHex2hsv(cpHex(cur)) : [210, 0.8, 0.9]; let color = cpHex(cur) || cpHsv2hex(...hsv);
        const canEye = !!window.EyeDropper, recent = this.cpRecent();
        el.innerHTML = `<div class="cpk-h"><b>${esc(title)}</b><button class="icon-btn" data-cp="x" aria-label="Fermer">${ic('x')}</button></div>
            <div class="cpk-grid">${none ? `<button class="cpk-sw none" data-cp="none" aria-label="Aucune couleur" title="Aucune"></button>` : ''}${swatches.map(c => `<button class="cpk-sw ${c === cur ? 'on' : ''}" style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div>
            ${recent.length ? `<div class="cpk-lab">Dernières couleurs</div><div class="cpk-grid">${recent.map(c => `<button class="cpk-sw" style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div>` : ''}
            <details class="cpk-wheelbox"><summary>Roue chromatique</summary>
                <canvas class="cpk-wheel" width="180" height="180" aria-label="Roue des couleurs"></canvas>
                <label class="cpk-lab">Luminosité <input type="range" class="cpk-v" min="0" max="100" value="${Math.round(hsv[2] * 100)}"></label></details>
            <div class="cpk-row"><span class="cpk-prev" style="background:${color}"></span><input class="input cpk-hex" value="${color.slice(1).toUpperCase()}" maxlength="7" autocomplete="off" spellcheck="false" aria-label="Code HEX"><button class="btn btn-primary btn-sm" data-cp="ok">${ic('check')}Choisir</button></div>
            <div class="cpk-row"><button class="btn btn-soft btn-sm" data-cp="eye">${ic('pipette')}Pipette</button>${this.pv ? `<button class="btn btn-soft btn-sm" data-cp="eyepdf">${ic('file')}Dans le PDF</button>` : ''}<button class="btn btn-soft btn-sm" data-cp="eyeimg">${ic('image')}Dans une image</button></div>`;
        document.body.appendChild(el);
        const prev = $('.cpk-prev', el), hexIn = $('.cpk-hex', el), cv = $('.cpk-wheel', el), vr = $('.cpk-v', el), ctx = cv.getContext('2d');
        const set = (c, fromHex) => { color = c; prev.style.background = c; if (!fromHex) hexIn.value = c.slice(1).toUpperCase(); };
        const drawWheel = () => { const W = 180, img = ctx.createImageData(W, W), R = W / 2; for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const dx = x - R, dy = y - R, d = Math.hypot(dx, dy), i = (y * W + x) * 4; if (d > R) { img.data[i + 3] = 0; continue; } const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, c = cpHsv2hex(h, d / R, hsv[2]), n = parseInt(c.slice(1), 16); img.data[i] = n >> 16; img.data[i + 1] = (n >> 8) & 255; img.data[i + 2] = n & 255; img.data[i + 3] = 255; } ctx.putImageData(img, 0, 0); const px = R + Math.cos(hsv[0] * Math.PI / 180) * hsv[1] * R, py = R + Math.sin(hsv[0] * Math.PI / 180) * hsv[1] * R; ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.stroke(); };
        const wheelAt = e => { const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 180 - 90, y = (e.clientY - r.top) / r.height * 180 - 90, d = Math.min(1, Math.hypot(x, y) / 90); hsv[0] = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; hsv[1] = d; set(cpHsv2hex(...hsv)); drawWheel(); };
        let drag = false; cv.addEventListener('pointerdown', e => { drag = true; cv.setPointerCapture(e.pointerId); wheelAt(e); }); cv.addEventListener('pointermove', e => { if (drag) wheelAt(e); }); cv.addEventListener('pointerup', () => { drag = false; });
        vr.addEventListener('input', () => { hsv[2] = vr.value / 100; set(cpHsv2hex(...hsv)); drawWheel(); });
        hexIn.addEventListener('input', () => { const c = cpHex(hexIn.value); if (c) { set(c, true); Object.assign(hsv, cpHex2hsv(c)); vr.value = Math.round(hsv[2] * 100); drawWheel(); } });
        const finish = c => { this.cpClose(); if (c) this.cpRemember(c); onPick(c); };
        const useImage = async src => { const c = await this.cpPickFromImage(src); if (c) { set(c); Object.assign(hsv, cpHex2hsv(c)); vr.value = Math.round(hsv[2] * 100); drawWheel(); } };
        el.addEventListener('click', async e => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.dataset.c) { finish(b.dataset.c); return; }
            const k = b.dataset.cp;
            if (k === 'x') this.cpClose();
            else if (k === 'none') finish('');
            else if (k === 'ok') { const c = cpHex(hexIn.value) || color; finish(c); }
            else if (k === 'eye') { if (canEye) { try { const r = await new EyeDropper().open(); const c = cpHex(r.sRGBHex); if (c) { set(c); Object.assign(hsv, cpHex2hsv(c)); vr.value = Math.round(hsv[2] * 100); drawWheel(); } } catch { /* cancelled */ } } else useImage('file'); }
            else if (k === 'eyeimg') useImage('file');
            else if (k === 'eyepdf') useImage('pdf');
        });
        el.addEventListener('pointerdown', e => { if (!e.target.closest('input, summary, canvas')) e.preventDefault(); });   // keep the text selection of the editor
        drawWheel();
        const place = () => { const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 130, right: innerWidth / 2 + 130, top: innerHeight / 2, bottom: innerHeight / 2 }, w = el.offsetWidth, h = el.offsetHeight; el.style.left = `${clamp(r.left, 8, innerWidth - w - 8)}px`; const below = r.bottom + 8 + h <= innerHeight - 8; el.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - h - 8)}px`; };
        place(); el.querySelector('.cpk-wheelbox').addEventListener('toggle', place);
        this._cpOut = e => { if (!el.contains(e.target) && !(anchor && anchor.contains && anchor.contains(e.target)) && !e.target.closest('.modal-back')) this.cpClose(); };
        setTimeout(() => document.addEventListener('pointerdown', this._cpOut, true), 50);
    },
    /* touch a colour inside an image (a picture of the phone, a photo) or the open PDF page: resolves with #hex or '' */
    cpPickFromImage(src) {
        return new Promise(async res => {
            let img = null;
            try {
                if (src === 'pdf') {
                    const pv = this.pv, i = this.pdfCurrent ? this.pdfCurrent() : 0, pg = pv && pv.pages[i], cvs = pg && pg.el && pg.el.querySelector('canvas');
                    if (!cvs) { this.toast('Cette page n\'est pas encore affichée : touche-la d\'abord.', 'warning'); res(''); return; }
                    img = cvs;
                } else {
                    const input = $('#hidden-file'); input.accept = 'image/*'; input.value = '';
                    const f = await new Promise(r => { input.onchange = () => r(input.files[0]); input.click(); }); if (!f) { res(''); return; }
                    const url = URL.createObjectURL(f); img = await new Promise((r2, rj) => { const im = new Image(); im.onload = () => r2(im); im.onerror = rj; im.src = url; });
                }
            } catch { this.toast('Impossible de lire cette image.', 'warning'); res(''); return; }
            const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, sc = Math.min(1, 520 / W), cw = Math.round(W * sc), ch = Math.round(H * sc);
            const m = this.openModal({ title: `${ic('pipette')} Touche la couleur voulue`, size: 'wide', body: `<div class="cpk-img"><canvas id="cpk-cv" width="${cw}" height="${ch}"></canvas></div><div class="cpk-row" style="margin-top:10px"><span class="cpk-prev" id="cpk-p2"></span><b id="cpk-h2">Touche l'image</b></div>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="cpk-use" disabled>${ic('check')}Utiliser cette couleur</button>`, onClose: () => { if (!done) { done = true; res(''); } } });
            let done = false, pick = ''; const cv = $('#cpk-cv', m), cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, cw, ch);
            cv.addEventListener('pointerdown', e => { const r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * cw), y = Math.floor((e.clientY - r.top) / r.height * ch); try { const d = cx.getImageData(clamp(x, 0, cw - 1), clamp(y, 0, ch - 1), 1, 1).data; pick = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''); $('#cpk-p2', m).style.background = pick; $('#cpk-h2', m).textContent = pick.toUpperCase(); $('#cpk-use', m).disabled = false; } catch { this.toast('Cette image ne se laisse pas lire.', 'warning'); } });
            $('#cpk-use', m).addEventListener('click', () => { done = true; this.closeModal(m); res(pick); });
        });
    }
});
