/* ============================================================
   Image occlusion: draw boxes over an image, one card per box.
   Stored as a note kind 'occl': nf.front = image reference (media:<id>),
   nf.back = JSON {m: [[x, y, w, h] in %], mode: 'all' | 'one'}, nf.extra = text shown with the answer.
   ============================================================ */
function occlusionData(c) {
    let d = null;
    try { d = JSON.parse(c.nf.back); } catch { d = null; }
    d = d && Array.isArray(d.m) ? d : { m: [], mode: 'all' };
    d.m = d.m.filter(r => Array.isArray(r) && r.length === 4).map(r => r.map(v => Math.round(clamp(num(v), 0, 100) * 100) / 100));
    return d;
}
function occlusionHtml(c) {
    const d = occlusionData(c), act = c.ord - 1;
    const box = (r, cls) => `<span class="${cls}" style="left:${r[0]}%;top:${r[1]}%;width:${r[2]}%;height:${r[3]}%"></span>`;
    const img = `<img src="${esc(c.nf.front)}" alt="">`;
    const others = (cls) => d.mode === 'one' ? '' : d.m.map((r, i) => (i === act ? '' : box(r, cls))).join('');
    const extra = isBlank(c.nf.extra) ? '' : `<br><div>${c.nf.extra}</div>`;
    return {
        front: sanitizeHtml(`<div class="occl">${img}${others('om')}${d.m[act] ? box(d.m[act], 'om on') : ''}</div>`),
        back: sanitizeHtml(`<div class="occl">${img}${others('om')}${d.m[act] ? box(d.m[act], 'om hit') : ''}</div>${extra}`)
    };
}

Object.assign(SuperAnki.prototype, {
    openOcclusionModal(cardId, presetDeck) {
        if (!this.data.decks.length) { this.toast('Crée d\'abord un paquet.', 'warning'); this.openDeckModal(); return; }
        const card = cardId ? this.card(cardId) : null;
        const sibs = card ? this.noteSiblings(card).sort((a, b) => a.ord - b.ord) : [];
        const old = card ? occlusionData(card) : null;
        let img = card ? (this.data.media[card.nf.front.slice(6)] || '') : '';
        let imgRef = card ? card.nf.front : '';
        let masks = old ? old.m.map(r => [...r]) : [];
        const deckId = card ? card.deckId : presetDeck || (this.ui.deck !== 'all' && this.ui.deck !== 'errors' ? this.ui.deck : this.lastDeckUsed) || this.sortedDecks()[0].id;
        const m = this.openModal({
            title: card ? 'Modifier l\'image à masquer' : 'Nouvelle image à masquer', size: 'wide',
            body: `<div class="field two-col">
                    <div><label class="label" for="oc-deck">Paquet</label><select class="select" id="oc-deck">${this.sortedDecks().map(d => `<option value="${esc(d.id)}" ${d.id === deckId ? 'selected' : ''}>${esc(d.emoji)} ${esc(this.deckPath(d.id))}</option>`).join('')}</select></div>
                    <div><label class="label" for="oc-mode">Mode</label><select class="select" id="oc-mode"><option value="all" ${!old || old.mode === 'all' ? 'selected' : ''}>Tout masquer, un cadre à la fois</option><option value="one" ${old && old.mode === 'one' ? 'selected' : ''}>Masquer un seul cadre à la fois</option></select></div>
                </div>
                <div class="field"><span class="label">Image</span><button class="btn btn-soft" id="oc-pick" type="button">${ic('image')}<span id="oc-pick-t">${img ? 'Changer l\'image' : 'Choisir une image'}</span></button>
                    <span class="help" style="margin-left:8px">Schéma, carte, anatomie, tableau...</span></div>
                <div class="field"><div class="occ-wrap" id="oc-wrap"><div class="occ-stage" id="oc-stage"></div></div>
                    <p class="help" id="oc-help">Dessine des cadres sur ce que tu veux cacher (un cadre = une carte). Touche un cadre pour le supprimer.</p>
                    <div class="row-gap" style="margin-top:8px"><button class="btn btn-soft btn-sm" id="oc-undo" type="button">${ic('undo')}Retirer le dernier</button><button class="btn btn-danger-soft btn-sm" id="oc-clear" type="button">${ic('trash')}Tout effacer</button><span class="small muted" id="oc-count"></span></div></div>
                <div class="field"><label class="label" for="oc-extra">Texte affiché avec la réponse (optionnel)</label><input class="input" id="oc-extra" placeholder="Ex : Source, explication…" value="${esc(card ? stripHtml(card.nf.extra) : '')}"></div>
                <div class="field"><label class="label" for="oc-tags">Tags (séparés par des virgules)</label><input class="input" id="oc-tags" value="${esc(card ? card.tags.join(', ') : '')}"></div>`,
            foot: `${card ? `<button class="btn btn-danger-soft" id="oc-del" style="margin-right:auto">${ic('trash')}Supprimer</button>` : ''}<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="oc-save">${ic('check')}Enregistrer</button>`
        });
        const stage = $('#oc-stage', m);
        const draw = () => {
            stage.innerHTML = img ? `<img src="${esc(img)}" alt="" draggable="false">${masks.map((r, i) => `<span class="occ-m" data-i="${i}" style="left:${r[0]}%;top:${r[1]}%;width:${r[2]}%;height:${r[3]}%"><b>${i + 1}</b></span>`).join('')}` : '<div class="occ-empty">Choisis d\'abord une image</div>';
            $('#oc-count', m).textContent = masks.length ? `${plural(masks.length, 'cadre')} = ${plural(masks.length, 'carte')}` : '';
        };
        draw();
        $('#oc-pick', m).addEventListener('click', () => {
            const input = $('#hidden-file');
            input.accept = 'image/*'; input.value = '';
            input.onchange = async () => {
                const f = input.files[0];
                if (!f || !f.type.startsWith('image/')) return;
                try {
                    img = await this.compressImage(f);
                    imgRef = '';
                    if (masks.length && !(await this.confirm({ title: 'Garder les cadres ?', message: 'Les cadres déjà dessinés seront gardés sur la nouvelle image.', ok: 'Garder' }))) masks = [];
                    $('#oc-pick-t', m).textContent = 'Changer l\'image';
                    draw();
                } catch { this.toast('Impossible de lire cette image.', 'error'); }
            };
            input.click();
        });
        let start = null, temp = null;
        const pt = e => { const r = stage.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width * 100, 0, 100), clamp((e.clientY - r.top) / r.height * 100, 0, 100)]; };
        stage.addEventListener('pointerdown', e => {
            if (!img) return;
            const mk = e.target.closest('.occ-m');
            if (mk) { masks.splice(Number(mk.dataset.i), 1); draw(); return; }
            start = pt(e);
            temp = document.createElement('span'); temp.className = 'occ-m temp'; stage.appendChild(temp);
            stage.setPointerCapture(e.pointerId);
        });
        stage.addEventListener('pointermove', e => {
            if (!start) return;
            const p = pt(e), x = Math.min(start[0], p[0]), y = Math.min(start[1], p[1]);
            Object.assign(temp.style, { left: `${x}%`, top: `${y}%`, width: `${Math.abs(p[0] - start[0])}%`, height: `${Math.abs(p[1] - start[1])}%` });
        });
        const end = e => {
            if (!start) return;
            const p = pt(e), w = Math.abs(p[0] - start[0]), h = Math.abs(p[1] - start[1]);
            if (w >= 2 && h >= 2) masks.push([Math.min(start[0], p[0]), Math.min(start[1], p[1]), w, h].map(v => Math.round(v * 100) / 100));
            start = null; temp = null; draw();
        };
        stage.addEventListener('pointerup', end);
        stage.addEventListener('pointercancel', () => { start = null; draw(); });
        $('#oc-undo', m).addEventListener('click', () => { masks.pop(); draw(); });
        $('#oc-clear', m).addEventListener('click', () => { masks = []; draw(); });
        const del = $('#oc-del', m);
        if (del) del.addEventListener('click', async () => { if (await this.opDelete(sibs.map(c => c.id), true)) this.closeModal(m); });
        $('#oc-save', m).addEventListener('click', () => {
            if (!img) { this.toast('Choisis une image.', 'warning'); return; }
            if (!masks.length) { this.toast('Dessine au moins un cadre sur l\'image.', 'warning'); return; }
            const dId = $('#oc-deck', m).value, mode = $('#oc-mode', m).value;
            const tags = $('#oc-tags', m).value.split(',').map(t => t.trim()).filter(Boolean);
            const extra = sanitizeHtml(esc($('#oc-extra', m).value.trim()));
            const ref = imgRef || this.addMedia(img);
            const nf = { front: ref, back: JSON.stringify({ m: masks, mode }), text: '', extra };
            const now = Date.now();
            this.lastDeckUsed = dId;
            this.change(card ? 'modification d\'image à masquer' : 'nouvelle image à masquer', sibs.map(c => c.id), () => {
                const created = [];
                const nid = card ? card.nid : uid('n');
                masks.forEach((r, i) => {
                    let c = sibs.find(x => x.ord === i + 1);
                    if (!c) {
                        c = { id: uid('c'), ...freshCard(), deckId: dId, hint: '', detail: '', tags, created: now + i, nid, kind: 'occl', ord: i + 1, nf: null, front: '', back: '' };
                        this.data.cards.push(c); created.push(c.id);
                    }
                    Object.assign(c, { deckId: dId, tags: [...tags], nf: { ...nf }, mod: now });
                    materializeCard(c);
                });
                sibs.filter(c => c.ord > masks.length).forEach(c => { const k = this.data.cards.indexOf(c); if (k >= 0) this.data.cards.splice(k, 1); });
                return created;
            });
            this.closeModal(m);
            this.toast(card ? 'Image modifiée' : `${plural(masks.length, 'carte créée', 'cartes créées')}`, 'success');
            if (this.view === 'decks') this.renderDecks(); else if (this.view === 'dashboard') this.renderDashboard();
        });
    }
});
