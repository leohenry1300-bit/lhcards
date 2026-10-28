/* ============================================================
   Profil : le bouton rond à droite de la barre du haut ouvre la page Profil
   (avatar, nom, chiffres clés) avec les réglages rangés en rubriques cliquables, comme dans une appli classique.
   La page s'appelle toujours « settings » en interne : les réglages eux-mêmes n'ont pas changé.
   ============================================================ */
const PROFILE_EMOJIS = ['🦁', '🐯', '🐼', '🦊', '🐱', '🐶', '🦉', '🐸', '🐧', '🦄', '🐢', '🐙', '🌟', '🔥', '📚', '🎓', '🚀', '🎯', '🌈', '🍀', '☕', '🎧', '⚡', '🧠'];

Object.assign(SuperAnki.prototype, {
    avatarHtml(p = this.data.settings.profile) {
        const src = p.photo && this.data.media && this.data.media[p.photo.slice(6)];
        return src ? `<img class="av-img" src="${esc(src)}" alt="">` : `<span class="av-emoji" aria-hidden="true">${esc(p.emoji || '🦁')}</span>`;
    },
    renderProfileBtn() { const b = $('#profile-btn'); if (b && this.data) b.innerHTML = this.avatarHtml(); },
    /* a square photo, 256 px, centred: small enough to travel with the backups and the sync */
    async profilePhoto(file) {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
            const side = Math.min(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas');
            cv.width = cv.height = 256;
            cv.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
            return this.addMedia(cv.toDataURL('image/jpeg', 0.85));
        } finally { URL.revokeObjectURL(url); }
    },
    openProfileEditor() {
        const cur = this.data.settings.profile, draft = { name: cur.name, emoji: cur.emoji, photo: cur.photo };
        const m = this.openModal({
            title: 'Mon profil',
            body: `<div style="display:grid;justify-items:center;gap:10px;margin-bottom:14px"><div class="pc-av big" id="pe-av">${this.avatarHtml(draft)}</div>
                    <div class="row-gap"><button class="btn btn-soft btn-sm" id="pe-photo">${ic('image')}Choisir une photo</button><button class="btn btn-soft btn-sm ${draft.photo ? '' : 'hidden'}" id="pe-nophoto">${ic('x')}Retirer la photo</button></div></div>
                <div class="field"><label class="label" for="pe-name">Prénom ou pseudo</label><input class="input" id="pe-name" maxlength="30" value="${esc(draft.name)}" placeholder="Ex : Léo" autocomplete="off"></div>
                <div class="field"><span class="label">Emoji <span class="faint">(si tu n'as pas de photo)</span></span><div class="emoji-grid" id="pe-emojis">${PROFILE_EMOJIS.map(e => `<button type="button" class="${e === draft.emoji ? 'active' : ''}" data-e="${e}" aria-label="${e}">${e}</button>`).join('')}</div></div>`,
            foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="pe-save">${ic('check')}Enregistrer</button>`
        });
        const paint = () => { $('#pe-av', m).innerHTML = this.avatarHtml(draft); $('#pe-nophoto', m).classList.toggle('hidden', !draft.photo); };
        $('#pe-emojis', m).addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (!b) return; draft.emoji = b.dataset.e; $$('#pe-emojis button', m).forEach(x => x.classList.toggle('active', x === b)); paint(); });
        $('#pe-nophoto', m).addEventListener('click', () => { draft.photo = ''; paint(); });
        $('#pe-photo', m).addEventListener('click', () => {
            const input = $('#hidden-file'); input.accept = 'image/*'; input.value = '';
            input.onchange = async () => {
                const f = input.files[0]; if (!f) return;
                if (!f.type.startsWith('image/')) { this.toast('Ce fichier n\'est pas une image.', 'warning'); return; }
                try { draft.photo = await this.profilePhoto(f); paint(); } catch { this.toast('Impossible de lire cette image.', 'error'); }
            };
            input.click();
        });
        $('#pe-save', m).addEventListener('click', () => {
            const s = this.data.settings;
            s.profile = { name: $('#pe-name', m).value.trim().slice(0, 30), emoji: draft.emoji, photo: draft.photo };
            s.settingsMod = Date.now(); this.save();
            this.closeModal(m); this.renderProfileBtn(); if (this.view === 'settings') this.renderSettings();
            this.toast('Profil enregistré', 'success', ic('check'));
        });
    },
    /* the settings page becomes the profile page: card on top, then one row per section; a row opens its section */
    profileDecorate() {
        const root = document.getElementById('view-settings'); if (!root || !this.data) return;
        const stack = root.querySelector('.settings'); if (!stack) return;
        if (this._setSpy) { window.removeEventListener('scroll', this._setSpy); this._setSpy = null; }
        root.querySelectorAll('.set-nav, .profile-card, .set-hub, .set-back').forEach(n => n.remove());
        const groups = [...root.querySelectorAll('.set-group')], ids = groups.map(g => g.id);
        if (this.ui.setGroup && !ids.includes(this.ui.setGroup)) this.ui.setGroup = null;
        const sub = this.ui.setGroup || '', st = this.data.stats, p = this.data.settings.profile;
        root.dataset.sub = sub;
        const title = root.querySelector('.page-title'); if (title) { title.textContent = sub ? (((groups.find(g => g.id === sub).querySelector('.set-group-title') || {}).textContent || 'Réglages').replace(/^([^\p{L}]+)/u, '$1 ')) : 'Profil'; const sp = title.nextElementSibling; if (sp) sp.textContent = sub ? '' : 'Ton compte, tes réglages et tes données.'; if (sp && sub) sp.classList.add('hidden'); else if (sp) sp.classList.remove('hidden'); }
        groups.forEach(g => { g.classList.toggle('set-off', !sub || g.id !== sub); const t = g.querySelector('.set-group-title'); if (t) t.classList.toggle('hidden', !!sub); const su = g.querySelector('.set-group-sub'); if (su) su.classList.toggle('hidden', !!sub); });
        const upd = document.getElementById('ex-update'); if (upd) upd.classList.toggle('set-off', !!sub);
        const head = title ? title.parentElement : stack.firstElementChild, mature = this.data.cards.filter(c => c.state === 'review' && c.interval >= MATURE_IVL).length;
        if (sub) {
            head.insertAdjacentHTML('beforebegin', `<button class="set-back" data-action="pf-hub">${ic('chevronLeft')}<span>Profil</span></button>`);
            return;
        }
        const rows = groups.map(g => { const t = (g.querySelector('.set-group-title') || {}).textContent || '', sp = ((g.querySelector('.set-group-sub') || {}).textContent) || ''; const em = (t.match(/^[^\p{L}]+/u) || ['•'])[0].trim(); return `<button class="hub-row" data-action="pf-open" data-id="${g.id}"><span class="hub-ico">${esc(em)}</span><span class="hub-t"><b>${esc(t.replace(/^[^\p{L}]+/u, '').trim())}</b><small>${esc(sp)}</small></span>${ic('chevronRight', 'chev')}</button>`; });
        rows.push(`<button class="hub-row" data-action="tool-trash"><span class="hub-ico">🗑️</span><span class="hub-t"><b>Corbeille</b><small>Retrouver une carte, une note ou un paquet supprimé (30 jours).</small></span>${ic('chevronRight', 'chev')}</button>`);
        rows.push(`<button class="hub-row" data-nav="toeic"><span class="hub-ico">🎧</span><span class="hub-t"><b>Simulateur TOEIC</b><small>Entraînement et examens blancs.</small></span>${ic('chevronRight', 'chev')}</button>`);
        head.insertAdjacentHTML('afterend', `<div class="panel profile-card">
                <button class="pc-av" data-action="pf-edit" aria-label="Modifier mon profil">${this.avatarHtml(p)}<span class="pc-edit">${ic('pencil')}</span></button>
                <div class="pc-info"><h3>${p.name ? esc(p.name) : 'Ton profil'}</h3><p class="small muted">${p.name ? 'Révise un peu chaque jour.' : 'Ajoute ton prénom et une photo ou un emoji.'}</p><button class="btn btn-soft btn-sm" data-action="pf-edit">${ic('pencil')}Modifier le profil</button></div>
                <div class="pc-stats"><div><b>${st.streak}</b><span>jours de série</span></div><div><b>${st.longestStreak}</b><span>record de série</span></div><div><b>${this.data.cards.length}</b><span>cartes</span></div><div><b>${mature}</b><span>maîtrisées</span></div></div>
            </div>
            <div class="panel set-hub">${rows.join('')}</div>`);
    },
    profileAction(action, el) {
        const ds = el.dataset || {};
        if (action === 'pf-edit') this.openProfileEditor();
        else if (action === 'pf-open') { this.ui.setGroup = ds.id; this.renderSettings(); window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' }); }
        else if (action === 'pf-hub') { this.ui.setGroup = null; this.renderSettings(); window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' }); }
    }
});
(() => { const base = SuperAnki.prototype.renderSettings; SuperAnki.prototype.renderSettings = function (...a) { const r = base.apply(this, a); try { this.profileDecorate(); } catch (e) { console.warn(e); } return r; }; })();
