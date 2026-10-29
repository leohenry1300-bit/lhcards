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
    renderProfileBtn() { if (!this.data) return; const h = this.avatarHtml(), b = $('#profile-btn'), bb = $('#profile-btn-b .avatar-btn'); if (b) b.innerHTML = h; if (bb) bb.innerHTML = h; },   // (top bar on a computer, bottom bar on a phone, like Instagram)
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
    /* the settings page becomes the profile page: a coloured header with avatar, name and key figures on top,
       then the settings exactly as before (shortcut chips, then every section one after the other) */
    profileDecorate() {
        const root = document.getElementById('view-settings'); if (!root || !this.data) return;
        const stack = root.querySelector('.settings'); if (!stack) return;
        root.querySelectorAll('.profile-hero').forEach(n => n.remove());
        const p = this.data.settings.profile, st = this.data.stats, d = this.data;
        const mature = d.cards.filter(c => c.state === 'review' && c.interval >= MATURE_IVL).length;
        const firsts = [d.revlog.length ? d.revlog[0][0] : 0, ...d.cards.map(c => c.created).filter(t => t > 1e12)].filter(t => t > 1e12 && t < Date.now() + 864e5);
        const since = firsts.length ? new Date(Math.min(...firsts)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '';
        const tile = (icon, v, l) => `<div class="ph-tile">${ic(icon)}<b>${v}</b><span>${l}</span></div>`;
        const hero = `<section class="profile-hero">
            <div class="ph-main">
                <button class="pc-av ph-av" data-action="pf-edit" aria-label="Modifier mon profil">${this.avatarHtml(p)}<span class="pc-edit">${ic('pencil')}</span></button>
                <div class="ph-info"><h2>${p.name ? esc(p.name) : 'Ton profil'}</h2><p>${since ? `Sur LH Cards depuis ${esc(since)}` : 'Bienvenue sur LH Cards'}${st.streak ? ` · ${st.streak} jour${st.streak > 1 ? 's' : ''} de série 🔥` : ''}</p>${p.name ? '' : '<p class="ph-hint">Touche ta photo pour ajouter ton prénom.</p>'}</div>
            </div>
            <div class="ph-stats">${tile('flame', st.streak, 'jours de série')}${tile('award', st.longestStreak, 'record de série')}${tile('layers', d.cards.length, 'cartes')}${tile('check2', mature, 'maîtrisées')}${tile('repeat', d.revlog.length, 'révisions')}${tile('clock', fmtDuration(st.studySeconds || 0), 'd\'étude')}</div>
        </section>`;
        const head = (root.querySelector('.page-title') || {}).parentElement;
        if (head) { head.insertAdjacentHTML('beforebegin', hero); head.remove(); } else stack.insertAdjacentHTML('afterbegin', hero);
    },
    profileAction(action) { if (action === 'pf-edit') this.openProfileEditor(); }
});
(() => { const base = SuperAnki.prototype.renderSettings; SuperAnki.prototype.renderSettings = function (...a) { const r = base.apply(this, a); try { this.profileDecorate(); } catch (e) { console.warn(e); } return r; }; })();
