/* ============================================================
   IA avec sa propre clé (Vague 4, premier lot) : réglages, appels directs au fournisseur,
   cartes depuis un texte / un PDF / une note, « Pourquoi ? » sur une carte.
   - La clé reste dans le navigateur (localStorage `lh_ai`), jamais dans `data` : elle ne part donc
     ni dans les exports, ni dans les sauvegardes, ni dans la synchro.
   - Rien n'est envoyé sans un aperçu (nombre de pages / caractères) et un clic sur « Envoyer ».
   - Tout ce que l'IA produit est signalé « généré par IA » et relu avant d'être ajouté.
   ============================================================ */
const AI_PROVIDERS = {
    anthropic: { name: 'Claude (Anthropic)', short: 'Claude', model: 'claude-haiku-5-5', site: 'console.anthropic.com' },
    openai: { name: 'OpenAI', short: 'OpenAI', model: 'gpt-4o-mini', site: 'platform.openai.com' },
    gemini: { name: 'Google Gemini', short: 'Gemini', model: 'gemini-2.5-flash', site: 'aistudio.google.com' },
    custom: { name: 'Compatible OpenAI (Groq, OpenRouter, Ollama…)', short: 'Perso', model: '', site: 'groq.com, openrouter.ai, ou ollama.com pour une IA sur ton ordinateur', custom: true }
};
const AI_CHUNK = 12000;       // characters per request
const AI_MAX_CHARS = 60000;   // above this the text is cut (and the user is told)
const AI_TAG = 'généré-par-ia';
const AiStore = {
    get() { try { const o = JSON.parse(localStorage.getItem('lh_ai') || '{}') || {}; return { provider: AI_PROVIDERS[o.provider] ? o.provider : 'anthropic', keys: o.keys || {}, models: o.models || {}, urls: o.urls || {} }; } catch { return { provider: 'anthropic', keys: {}, models: {}, urls: {} }; } },
    set(o) { try { localStorage.setItem('lh_ai', JSON.stringify(o)); } catch { /* storage blocked */ } }
};
class AiError extends Error { constructor(msg) { super(msg); this.ai = true; } }

Object.assign(SuperAnki.prototype, {
    aiCfg() { const s = AiStore.get(), p = s.provider; return { provider: p, name: AI_PROVIDERS[p].short, key: String(s.keys[p] || '').trim(), model: String(s.models[p] || '').trim() || AI_PROVIDERS[p].model, url: String((s.urls || {})[p] || '').trim().replace(/\/+$/, '') }; },
    aiReady() { const c = this.aiCfg(); return c.provider === 'custom' ? !!(c.url && c.model) : !!c.key; },
    aiVision() { return true; },
    /* what each provider wants : url, headers, body (several messages, images on the last one, optional streaming) */
    aiBuild(c, { system = '', messages, maxTokens = 3000, web = false, images = [], stream = false }) {
        const msgs = messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) })), last = msgs.length - 1;
        let url, headers = { 'content-type': 'application/json' }, body;
        if (c.provider === 'anthropic') {
            url = 'https://api.anthropic.com/v1/messages';
            Object.assign(headers, { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
            body = { model: c.model, max_tokens: maxTokens, system, messages: msgs.map((m, k) => ({ role: m.role, content: k === last && images.length ? [...images.map(u => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: u.split(',')[1] } })), { type: 'text', text: m.content }] : m.content })) };
            if (web) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
            if (stream) body.stream = true;
        } else if (c.provider === 'openai' || c.provider === 'custom') {
            url = (c.provider === 'custom' ? c.url : 'https://api.openai.com/v1') + '/chat/completions';
            if (c.key) headers.authorization = `Bearer ${c.key}`;
            body = { model: c.model, max_tokens: maxTokens, messages: [...(system ? [{ role: 'system', content: system }] : []), ...msgs.map((m, k) => ({ role: m.role, content: k === last && images.length ? [{ type: 'text', text: m.content }, ...images.map(u => ({ type: 'image_url', image_url: { url: u } }))] : m.content }))] };
            if (stream) body.stream = true;
        } else {
            url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
            headers['x-goog-api-key'] = c.key;
            body = { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: msgs.map((m, k) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [...(k === last ? images.map(u => ({ inlineData: { mimeType: 'image/jpeg', data: u.split(',')[1] } })) : []), { text: m.content }] })), generationConfig: { maxOutputTokens: maxTokens }, ...(web ? { tools: [{ google_search: {} }] } : {}) };
        }
        return { url, headers, body };
    },
    aiHttpError(c, st, j) {
        const detail = j && ((j.error && (j.error.message || j.error)) || j.message) || '';
        if (st === 401 || st === 403) return new AiError(`${c.name} refuse la clé. Vérifie-la dans Profil › Intelligence artificielle.`);
        if (st === 404) return new AiError(`Modèle « ${c.model} » introuvable chez ${c.name}. Change son nom dans les réglages IA.`);
        if (st === 429) return new AiError(`Limite ou quota atteint chez ${c.name}. Attends un peu ou vérifie ton compte.`);
        if (st >= 500) return new AiError(`${c.name} est indisponible pour le moment. Réessaie dans un instant.`);
        return new AiError(`${c.name} a répondu une erreur (${st})${detail ? ` : ${String(detail).slice(0, 160)}` : '.'}`);
    },
    /* one request to the chosen provider; returns the text. Errors are AiError with a clear French message. */
    async aiCall({ system = '', prompt, messages, maxTokens = 3000, signal, web = false, images = [], onDelta }) {
        this.aiLinks = [];
        const c = this.aiCfg();
        if (!this.aiReady()) throw new AiError(c.provider === 'custom' ? 'Renseigne l\'adresse et le modèle dans Profil › Intelligence artificielle.' : 'Aucune clé IA : ajoute-la dans Profil › Intelligence artificielle.');
        if (!navigator.onLine && c.provider !== 'custom') throw new AiError('Pas de connexion : l\'IA a besoin d\'internet.');
        const stream = !!onDelta && !web, { url, headers, body } = this.aiBuild(c, { system, messages: messages || [{ role: 'user', content: prompt }], maxTokens, web, images, stream });
        let res;
        try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
        catch (e) {
            if (e && e.name === 'AbortError') throw new AiError('Annulé.');
            throw new AiError(c.provider === 'custom' ? `Impossible de joindre ${c.url} (le serveur tourne ? sur iPhone, une IA locale n'est pas joignable).` : `Impossible de joindre ${c.name} (réseau coupé ou blocage du navigateur).`);
        }
        if (stream && res.ok && res.body) {   // answer shown while it is written
            const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', full = '';
            const take = line => {
                if (!line.startsWith('data:')) return; const d = line.slice(5).trim(); if (!d || d === '[DONE]') return; let j; try { j = JSON.parse(d); } catch { return; }
                const piece = c.provider === 'anthropic' ? (j.type === 'content_block_delta' && j.delta && j.delta.text) || '' : c.provider === 'gemini' ? (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(x => x.text || '').join('') : ((j.choices || [])[0] || {}).delta && (((j.choices || [])[0] || {}).delta.content || '');
                if (piece) { full += piece; onDelta(piece, full); }
            };
            try { for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let k; while ((k = buf.indexOf('\n')) >= 0) { take(buf.slice(0, k).trim()); buf = buf.slice(k + 1); } } take(buf.trim()); }
            catch (e) { if (e && e.name === 'AbortError') throw new AiError('Annulé.'); if (!full) throw new AiError('La réponse a été coupée. Réessaie.'); }
            if (!full.trim()) throw new AiError(`${c.name} n'a rien répondu. Réessaie.`);
            return full;
        }
        let j = null; try { j = await res.json(); } catch { /* not json */ }
        if (!res.ok) throw this.aiHttpError(c, res.status, j);
        let text = '';
        const links = [], addLink = (u, t) => { if (/^https?:\/\//i.test(u || '') && !links.some(l => l.url === u) && links.length < 6) links.push({ url: u, title: String(t || u).slice(0, 90) }); };
        if (c.provider === 'anthropic') {
            const blocks = (j && j.content) || [];
            text = blocks.map(x => x.type === 'text' || x.text ? x.text || '' : '').join('');
            blocks.forEach(x => { (x.citations || []).forEach(q => addLink(q.url, q.title)); if (x.type === 'web_search_tool_result' && Array.isArray(x.content)) x.content.forEach(q => addLink(q.url, q.title)); });
        }
        else if (c.provider === 'openai' || c.provider === 'custom') text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
        else {
            const cand = j && j.candidates && j.candidates[0];
            text = ((cand && cand.content && cand.content.parts) || []).map(x => x.text || '').join('');
            ((cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || []).forEach(g => g.web && addLink(g.web.uri, g.web.title));
        }
        this.aiLinks = web ? links : [];
        if (!String(text).trim()) throw new AiError(`${c.name} n'a rien répondu. Réessaie.`);
        if (onDelta) onDelta(String(text), String(text));
        return String(text);
    },
    /* The only way anything leaves the device: a window that shows what will be sent, waits for « Envoyer », then runs
       the requests (one per chunk) with a Cancel button. Resolves with the list of answers, or null (cancelled / error shown). */
    aiRun({ title, what, chars, pages = 0, preview = '', jobs, note = '', asImages = false }) {
        return new Promise(resolve => {
            const c = this.aiCfg(); let ctl = null, done = false;
            const m = this.openModal({
                title: `${ic('sparkle')} ${esc(title)}`, size: 'narrow',
                body: `<p style="margin:0 0 10px">Ce texte va être envoyé à <b>${esc(c.name)}</b> (modèle ${esc(c.model)}) avec ta clé :</p>
                    <div class="info-grid"><div><span>${esc(what)}</span><b>${asImages ? plural(pages, 'page') + ' envoyées comme images' : (pages ? plural(pages, 'page') + ' · ' : '') + plural(chars, 'caractère') + ` (≈ ${Math.round(chars / 4).toLocaleString('fr-FR')} jetons)`}</b></div>${jobs.length > 1 ? `<div><span>Envois</span><b>${jobs.length}</b></div>` : ''}</div>
                    ${preview ? `<details style="margin-top:10px"><summary class="small">Voir le début du texte envoyé</summary><pre class="ai-prev">${esc(preview.slice(0, 600))}${preview.length > 600 ? '…' : ''}</pre></details>` : ''}
                    ${note ? `<p class="small" style="color:var(--due);margin-top:10px">${esc(note)}</p>` : ''}
                    <p class="help" id="ai-run-st" style="margin-top:10px">Rien n'est envoyé tant que tu ne touches pas « Envoyer ». Le résultat sera relu par toi avant d'être ajouté.</p>`,
                foot: `<button class="btn btn-soft" id="ai-cancel">Annuler</button><button class="btn btn-primary" id="ai-send">${ic('sparkle')}Envoyer</button>`,
                onClose: () => { if (!done) { done = true; if (ctl) ctl.abort(); resolve(null); } }
            });
            $('#ai-cancel', m).addEventListener('click', () => this.closeModal(m));
            $('#ai-send', m).addEventListener('click', async () => {
                ctl = new AbortController();
                const st = $('#ai-run-st', m), send = $('#ai-send', m);
                send.disabled = true; $('#ai-cancel', m).textContent = 'Arrêter';
                const out = [];
                try {
                    for (let i = 0; i < jobs.length; i++) {
                        st.textContent = jobs.length > 1 ? `L'IA travaille… partie ${i + 1} sur ${jobs.length}` : 'L\'IA travaille…';
                        const jb = { ...jobs[i] }; if (typeof jb.images === 'function') jb.images = await jb.images();
                        out.push(await this.aiCall({ ...jb, signal: ctl.signal }));
                    }
                } catch (e) {
                    if (done) return;
                    st.style.color = 'var(--due)'; st.textContent = e && e.ai ? e.message : 'Erreur inattendue. Réessaie.';
                    send.disabled = false; send.innerHTML = `${ic('refresh')}Réessayer`; $('#ai-cancel', m).textContent = 'Fermer';
                    return;
                }
                done = true; this.closeModal(m); resolve(out);
            });
        });
    },
    aiNeedKey() {
        const m = this.openModal({ title: `${ic('sparkle')} Branche ton IA`, size: 'narrow', body: `<p style="margin:0">Cette fonction utilise <b>ta propre clé</b> (Claude, OpenAI ou Gemini). Elle reste sur cet appareil et n'est jamais sauvegardée ni synchronisée.</p>`, foot: `<button class="btn btn-soft" data-close>Plus tard</button><button class="btn btn-primary" id="ai-goset">Ajouter ma clé</button>` });
        $('#ai-goset', m).addEventListener('click', () => { this.closeModal(m); this.go('settings'); setTimeout(() => { const p = document.getElementById('ai-panel'); if (p) p.scrollIntoView({ block: 'start' }); }, 200); });
    },
    /* ---------- settings panel ---------- */
    aiSettingsHtml() {
        const s = AiStore.get(), p = s.provider, c = AI_PROVIDERS[p];
        return `<div class="panel panel-pad set-section" id="ai-panel">
            <h3>${ic('sparkle')} Intelligence artificielle</h3>
            <p class="small muted">Utilise ta propre clé. Elle reste <b>sur cet appareil</b> : jamais dans les exports, les sauvegardes ni la synchro. Rien n'est envoyé sans que tu voies d'abord ce qui part.</p>
            <div class="set-row"><div class="txt"><b>Fournisseur</b><span>Chaque fournisseur garde sa propre clé.</span></div>
                <div class="segmented">${Object.entries(AI_PROVIDERS).map(([k, v]) => `<button class="${k === p ? 'active' : ''}" data-action="ai-prov" data-v="${k}">${v.short}</button>`).join('')}</div></div>
            ${c.custom ? `<div class="field"><label class="label" for="ai-url">Adresse de l'API</label><input class="input" id="ai-url" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc((s.urls || {})[p] || '')}" placeholder="https://api.groq.com/openai/v1"><p class="help">Groq, OpenRouter, Together… ou <b>Ollama / LM Studio sur ton ordinateur</b> (http://localhost:11434/v1) : aucune donnée ne sort de ta machine. Ne marche pas sur iPhone pour une IA locale.</p></div>` : ''}
            <div class="field"><label class="label" for="ai-key">Clé API ${esc(c.short)}${c.custom ? ' <span class="faint">(vide si IA locale)</span>' : ''}</label><input class="input" id="ai-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.keys[p] || '')}" placeholder="Colle ta clé ici"><p class="help">Elle se crée sur ${esc(c.site)}. Une clé dans un navigateur n'est jamais totalement secrète : utilise une clé avec une limite de dépense.</p></div>
            <div class="field"><label class="label" for="ai-model">Modèle</label><input class="input" id="ai-model" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.models[p] || '')}" placeholder="${esc(c.model)}"><p class="help">Laisse vide pour le modèle conseillé (${esc(c.model)}).</p></div>
            <div class="row-gap"><button class="btn btn-soft btn-sm" data-action="ai-test">${ic('check')}Tester la clé</button><button class="btn btn-soft btn-sm" data-action="ai-clear">${ic('trash')}Effacer la clé</button></div>
            <p class="help" id="ai-st" style="margin-top:8px"></p>
            <div class="row-gap" style="margin:8px 0"><button class="btn btn-primary btn-sm" data-action="ai-assist">${ic('sparkle')}Assistant de mes cours</button><button class="btn btn-soft btn-sm" data-action="ai-exam">${ic('quiz')}Examen blanc sur mesure</button></div>
            <p class="help">Fonctions : « Cartes avec l'IA » (dans Importer, le menu d'un PDF et celui d'une note) et « Pourquoi ? » pendant une révision.</p>
        </div>`;
    },
    aiSaveFields() {
        const s = AiStore.get(), k = $('#ai-key'), md = $('#ai-model'), u = $('#ai-url'); if (!k) return s;
        s.keys[s.provider] = k.value.trim(); s.models[s.provider] = md ? md.value.trim() : ''; s.urls = s.urls || {}; if (u) s.urls[s.provider] = u.value.trim();
        AiStore.set(s); return s;
    },
    async aiTest() {
        const st = $('#ai-st'); this.aiSaveFields();
        const say = (t, bad) => { if (st) { st.style.color = bad ? 'var(--due)' : 'var(--easy)'; st.textContent = t; } };
        if (!this.aiReady()) { say(this.aiCfg().provider === 'custom' ? 'Renseigne l\'adresse et le modèle.' : 'Colle d\'abord ta clé.', true); return; }
        say('Test en cours…');
        try { await this.aiCall({ prompt: 'Réponds uniquement par le mot OK.', maxTokens: 20 }); say(`Ça marche : ${this.aiCfg().name} répond.`); }
        catch (e) { say(e && e.ai ? e.message : 'Erreur inattendue.', true); }
    },
    /* ---------- text → cards ---------- */
    aiChunks(text) {
        text = String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        const cut = text.length > AI_MAX_CHARS; if (cut) text = text.slice(0, AI_MAX_CHARS);
        const out = []; let cur = '';
        text.split(/\n\n/).forEach(par => {
            while (par.length > AI_CHUNK) { if (cur) { out.push(cur); cur = ''; } out.push(par.slice(0, AI_CHUNK)); par = par.slice(AI_CHUNK); }
            if (cur && cur.length + par.length + 2 > AI_CHUNK) { out.push(cur); cur = ''; }
            cur += (cur ? '\n\n' : '') + par;
        });
        if (cur) out.push(cur);
        return { chunks: out, cut, chars: text.length };
    },
    /* turn the model's answer into clean import lines (question >> réponse / Phrase {{trou}}) */
    aiCleanLines(t) {
        return String(t || '').replace(/```[a-z]*/gi, '').split('\n').map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
            .filter(l => l && l !== 'NONE' && (/>>|<>/.test(l) || /\{\{[^}]+\}\}/.test(l))).map(l => l.replace(/\{\{c\d+::/g, '{{'));
    },
    aiExistingFronts(deckId) { if (!deckId) return []; const ids = new Set(this.descendantIds(deckId)); return this.data.cards.filter(c => ids.has(c.deckId)).slice(-40).map(c => truncate(stripHtml(c.kind === 'cloze' && c.nf ? c.nf.text : c.front).replace(CLOZE_RE, '…'), 70)); },
    /* the whole flow: confirm → send → lines. `text` is the course text, `label` says where it comes from. Resolves with the lines (or null). */
    async aiCardsFrom(text, { label = 'Texte', pages = 0, count = 20, hint = '', deckId = '' } = {}) {
        const avoid = this.aiExistingFronts(deckId);
        if (!this.aiReady()) { this.aiNeedKey(); return null; }
        const { chunks, cut, chars } = this.aiChunks(text);
        if (chars < 40) { this.toast('Pas assez de texte pour créer des fiches.', 'warning'); return null; }
        const per = Math.max(3, Math.ceil(count / chunks.length));
        const system = 'Tu crées des fiches de révision pour un étudiant. Réponds UNIQUEMENT par des lignes, une fiche par ligne, sans titre ni commentaire. Formats permis, à VARIER selon le contenu : "question >> réponse" (notions, causes, comparaisons), "terme <> définition" (paires qu\'on doit savoir dans les deux sens, vocabulaire), ou une phrase avec le mot clé entre doubles accolades, par exemple "Le {{trou}} est…" (faits, chiffres, dates, listes). Règles : une seule idée par fiche, question précise et autonome (compréhensible sans le texte), jamais de question oui/non, réponse courte, priorité à l\'essentiel qui tombe à l\'examen, uniquement ce qui est dit dans le texte (n\'invente rien), même langue que le texte. Si le texte ne contient rien d\'utile à retenir, réponds exactement NONE.';
        const jobs = chunks.map(ch => ({ system, prompt: `Crée au maximum ${per} fiches à partir de ce texte :${hint ? '\n(' + hint + ')' : ''}${avoid.length ? `\n(Fiches qui existent déjà, ne les répète pas : ${avoid.join(' ; ')})` : ''}\n\n${ch}`, maxTokens: 2500 }));
        const out = await this.aiRun({ title: 'Cartes avec l\'IA', what: label, chars, pages, preview: chunks[0], jobs, note: cut ? `Le texte est très long : seuls les ${AI_MAX_CHARS.toLocaleString('fr-FR')} premiers caractères sont envoyés.` : '' });
        if (!out) return null;
        const lines = [...new Set(out.flatMap(o => this.aiCleanLines(o)))];
        if (!lines.length) { this.toast('L\'IA n\'a rien trouvé à retenir dans ce texte.', 'warning'); return null; }
        return lines;
    },
    /* choose the pages of the open PDF, read their text. Resolves { a, b, pages, text, vals } or null.
       `extra` is html with controls carrying data-v="name" (their values come back in `vals`). */
    aiPdfRange({ title, extra = '', all = false, cta = 'Continuer', noText = false, range = null }) {
        return new Promise(resolve => {
            const pv = this.pv; if (!pv) { resolve(null); return; }
            if (!this.aiReady()) { this.aiNeedKey(); resolve(null); return; }
            const total = pv.p.pages || pv.p.pg.filter(g => g.k === 'p').length, cur = clamp(((pv.p.pg[this.pdfCurrent()] || {}).n) || 1, 1, total);
            let fin = false;
            const m = this.openModal({ title: `${ic('sparkle')} ${esc(title)}`, size: 'narrow',
                body: `<p style="margin:0 0 10px">Choisis les pages à lire. Tu verras ce qui part avant l'envoi.</p>
                    <div class="row-gap"><label class="field" style="flex:1"><span class="label">De la page</span><input class="input" id="aipg-a" type="number" min="1" max="${total}" value="${range ? range[0] : all ? 1 : cur}"></label><label class="field" style="flex:1"><span class="label">à la page</span><input class="input" id="aipg-b" type="number" min="1" max="${total}" value="${range ? Math.min(total, range[1]) : all ? total : Math.min(total, cur + 4)}"></label></div>
                    ${extra}<p class="help" id="aipg-st"></p>`,
                foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="aipg-go">${esc(cta)}</button>`,
                onClose: () => { if (!fin) { fin = true; resolve(null); } } });
            $('#aipg-go', m).addEventListener('click', async () => {
                let a = clamp(parseInt($('#aipg-a', m).value, 10) || 1, 1, total), b = clamp(parseInt($('#aipg-b', m).value, 10) || a, 1, total); if (b < a) [a, b] = [b, a];
                if (b - a > 199) b = a + 199;
                const st = $('#aipg-st', m), go = $('#aipg-go', m); go.disabled = true;
                let text = '';
                if (!noText) for (let i = a; i <= b; i++) { st.style.color = ''; st.textContent = `Lecture du texte… ${i - a + 1}/${b - a + 1}`; const t = await this.pdfPageText(i); if (t) text += `[page ${i}]\n${t}\n\n`; }
                if (!noText && text.replace(/\[page \d+\]/g, '').trim().length < 10 * (b - a + 1)) { st.style.color = 'var(--due)'; st.textContent = 'Ces pages n\'ont presque pas de texte (PDF scanné ou fait d\'images). Je ne peux pas en tirer de bons résultats.'; go.disabled = false; return; }
                const vals = {}; m.querySelectorAll('[data-v]').forEach(el => { vals[el.dataset.v] = el.type === 'checkbox' ? el.checked : el.value; });
                fin = true; this.closeModal(m); resolve({ a, b, pages: b - a + 1, text, vals });
            });
        });
    },
    /* PDF menu → fiches */
    async aiPdfCards(st = {}) {
        if (!this.pv) return;
        const lv = this.stLevelInfo(this.pv.p), dn = st.n || lv.cards;
        const r = await this.aiPdfRange({ title: 'Cartes avec l\'IA', range: st.range, extra: `<label class="field"><span class="label">Nombre de fiches</span><select class="select" data-v="n">${[10, 20, 40].map(v => `<option value="${v}" ${v === dn ? 'selected' : ''}>Environ ${v}</option>`).join('')}</select></label>` });
        if (!r) return;
        const p = this.pv.p, lines = await this.aiCardsFrom(r.text, { label: `PDF « ${p.name} »`, pages: r.pages, count: Number(r.vals.n), hint: lv.cardsHint, deckId: p.pdeck || '' });
        if (lines) this.openImportModal({ text: lines.join('\n'), ai: true, deckId: p.pdeck || '', tags: st.ch ? [`ch-${st.ch}`] : [] });
    },
    /* ---------- summary → written in the note, with [[page N]] links ---------- */
    aiBlocksFromSummary(raw, p) {
        const pageLink = n => { const g = p && p.pg.find(x => x.k === 'p' && x.n === n); return g ? `[[pdf:${p.id}:${g.id}|page ${n}]]` : `(page ${n})`; };
        const blocks = [];
        String(raw || '').replace(/```[a-z]*/gi, '').split('\n').forEach(l => {
            l = l.trim(); if (!l) return;
            const h = /^#{1,4}\s+(.*)$/.exec(l);
            if (h) { blocks.push({ t: 'h3', x: h[1].trim(), d: 0 }); return; }
            let x = l.replace(/^(?:[-*•]|\d+[.)])\s+/, '').replace(/\*\*/g, '').trim();
            x = p ? x.replace(/\[p\.?\s*(\d+)\s*(?:[-–]\s*\d+)?\]/gi, (m, n) => pageLink(Number(n))) : x.replace(/\s*\[p\.?[^\]]*\]/gi, '');
            if (x) blocks.push({ t: 'p', x, d: 1 });
        });
        return blocks;
    },
    aiSummaryInto(noteObj, raw, p, kind) {
        const blocks = this.aiBlocksFromSummary(raw, p);
        if (!blocks.length) { this.toast('L\'IA n\'a rien renvoyé d\'exploitable.', 'warning'); return false; }
        const head = [{ t: 'h2', x: kind === 'short' ? 'Résumé en 2 minutes (IA)' : 'Résumé détaillé (IA)', d: 0 }, { t: 'quote', x: `✨ Généré par IA le ${new Date().toLocaleDateString('fr-FR')} : à relire et corriger.`, d: 0 }];
        const n = noteObj, add = [...head, ...blocks, nbEmpty()];
        const last = n.b[n.b.length - 1];
        if (this.view === 'pdf' && this.pv && p && this.pdfNoteOf(p) === n) { if (!this.pv.notes) this.pdfToggleNotes(true); this.nbPush(); if (last && !last.x && n.b.length > 1) n.b.splice(n.b.length - 1, 1, ...add); else n.b.push(...add); this.nbChanged(); this.nbRender(); }
        else { if (last && !last.x && n.b.length > 1) n.b.splice(n.b.length - 1, 1, ...add); else n.b.push(...add); n.mod = Date.now(); this.save(); if (this.ui.note === n.id) this.renderNotes(); }
        return true;
    },
    async aiSummary(noteId, st = {}) {
        const sys = k => `Tu résumes un cours pour un étudiant, en français, en puces courtes (une idée par puce). Écris les titres de section en lignes commençant par "## " et chaque puce en ligne commençant par "- ". ${noteId ? '' : 'À la fin de chaque puce, indique la page source entre crochets, par exemple [p.12]. '}N'invente rien : uniquement ce qui est dans le texte. ${k === 'short' ? 'Résumé très court : 6 à 10 puces au total, lisible en 2 minutes.' : 'Résumé détaillé, organisé par sections.'}`;
        const opt = `<label class="field"><span class="label">Type de résumé</span><select class="select" data-v="k"><option value="short" ${(st.k || (this.pv && !noteId ? this.stLevelInfo(this.pv.p).summary : 'short')) === 'short' ? 'selected' : ''}>Court (2 minutes)</option><option value="full" ${(st.k || (this.pv && !noteId ? this.stLevelInfo(this.pv.p).summary : 'short')) === 'full' ? 'selected' : ''}>Détaillé</option></select></label>`;
        let text, label, pages = 0, k = 'short', p = null, target;
        if (noteId) {
            const n = this.note(noteId); if (!n) return;
            if (!this.aiReady()) { this.aiNeedKey(); return; }
            k = await new Promise(res => { let fin = false; const m = this.openModal({ title: `${ic('sparkle')} Résumé avec l'IA`, size: 'narrow', body: opt, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="aisu-go">Continuer</button>`, onClose: () => { if (!fin) { fin = true; res(null); } } }); $('#aisu-go', m).addEventListener('click', () => { const v = $('[data-v=k]', m).value; fin = true; this.closeModal(m); res(v); }); });
            if (!k) return;
            text = n.b.map(b => this.nbPlain(b.x)).filter(Boolean).join('\n'); label = `Note « ${n.title || 'Sans titre'} »`; target = n;
        } else {
            const r = await this.aiPdfRange({ title: 'Résumé avec l\'IA', all: true, range: st.range, extra: opt }); if (!r) return;
            text = r.text; pages = r.pages; k = r.vals.k; p = this.pv.p; label = `PDF « ${p.name} »`; target = this.pdfNoteOf(p);
        }
        const { chunks, cut, chars } = this.aiChunks(text);
        if (chars < 80) { this.toast('Pas assez de texte à résumer.', 'warning'); return; }
        const jobs = chunks.map(ch => ({ system: sys(k), prompt: `Résume ce texte :\n\n${ch}`, maxTokens: k === 'short' ? 900 : 2500 }));
        const out = await this.aiRun({ title: 'Résumé avec l\'IA', what: label, chars, pages, preview: chunks[0], jobs, note: cut ? `Le texte est très long : seuls les ${AI_MAX_CHARS.toLocaleString('fr-FR')} premiers caractères sont envoyés.` : '' });
        if (!out) return;
        if (this.aiSummaryInto(target, out.join('\n'), p, k)) this.toast('Résumé ajouté à la note', 'success');
    },
    /* ---------- chat with the course (PDF or note) ---------- */
    async aiChat(noteId) {
        if (!this.aiReady()) { this.aiNeedKey(); return; }
        let text, label, pages = 0, p = null;
        if (noteId) { const n = this.note(noteId); if (!n) return; text = n.b.map(b => this.nbPlain(b.x)).filter(Boolean).join('\n'); label = `Note « ${n.title || 'Sans titre'} »`; }
        else { const r = await this.aiPdfRange({ title: 'Discuter avec le cours', all: true, cta: 'Continuer' }); if (!r) return; text = r.text; pages = r.pages; p = this.pv.p; label = `PDF « ${p.name} »`; }
        const { chunks, cut, chars } = this.aiChunks(text), doc = chunks.join('\n\n').slice(0, AI_MAX_CHARS);
        if (chars < 40) { this.toast('Pas assez de texte dans ce document.', 'warning'); return; }
        const ok = await new Promise(res => {
            let fin = false; const c = this.aiCfg();
            const m = this.openModal({ title: `${ic('sparkle')} Discuter avec le cours`, size: 'narrow', body: `<p style="margin:0 0 10px">À chaque question, ce texte est envoyé à <b>${esc(c.name)}</b> (modèle ${esc(c.model)}) avec ta clé :</p><div class="info-grid"><div><span>${esc(label)}</span><b>${pages ? plural(pages, 'page') + ' · ' : ''}${plural(doc.length, 'caractère')}</b></div></div>${cut ? `<p class="small" style="color:var(--due);margin-top:10px">Texte très long : seuls les ${AI_MAX_CHARS.toLocaleString('fr-FR')} premiers caractères sont envoyés.</p>` : ''}<p class="help" style="margin-top:10px">Tu pourras activer la recherche internet question par question. Rien ne part avant ta première question.</p>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="aich-go">${ic('sparkle')}Commencer</button>`, onClose: () => { if (!fin) { fin = true; res(false); } } });
            $('#aich-go', m).addEventListener('click', () => { fin = true; this.closeModal(m); res(true); });
        });
        if (!ok) return;
        const cfg = this.aiCfg(), canWeb = cfg.provider !== 'openai', log = [];
        const system = `Tu es un tuteur qui répond à propos d'un document de cours. Réponds en français, de façon claire et courte. Règle 1 : base-toi UNIQUEMENT sur le document fourni; chaque affirmation tirée du document est suivie de sa page entre crochets, par exemple [p.12]${p ? '' : ' (si le document n\'a pas de pages, ne mets pas de numéro)'}. Règle 2 : si la réponse n'est pas dans le document, écris exactement « Non trouvé dans le document. » et n'invente aucune source. Règle 3 : si on t'autorise la recherche internet, ce qui vient du web doit être clairement séparé, dans un paragraphe qui commence par « [web] ».`;
        let ctl = null, busy = false, fin = false;
        const m = this.openModal({ title: `${ic('sparkle')} Discuter avec le cours`, size: 'wide',
            body: `<div id="aic-log" class="ai-chat"><p class="help" style="margin:0">Pose une question sur « ${esc(truncate(label, 60))} ». L'IA répond avec la page source${p ? ' (touche-la pour y aller)' : ''}.</p></div>
                <p class="help" id="aic-st" style="margin-top:8px"></p>
                <label class="check" style="margin:8px 0 ${canWeb ? '6px' : '0'}"><input type="checkbox" id="aic-web" ${canWeb ? '' : 'disabled'}> 🌐 Chercher aussi sur internet (cette question)</label>${canWeb ? '<p class="help" style="margin:0 0 8px">Ta question part alors aussi vers un moteur de recherche. Ce qui vient du web est séparé et marqué.</p>' : '<p class="help" style="margin:0 0 8px">La recherche internet n\'est pas disponible avec OpenAI ici : choisis Claude ou Gemini.</p>'}
                <div class="row-gap"><input class="input" id="aic-in" style="flex:1" placeholder="Ta question…" autocomplete="off" enterkeyhint="send"><button class="btn btn-primary" id="aic-go">${ic('sparkle')}Envoyer</button></div>`,
            foot: `<button class="btn btn-soft" data-close>Fermer</button>`, onClose: () => { fin = true; if (ctl) ctl.abort(); } });
        const logEl = $('#aic-log', m), st = $('#aic-st', m);
        const fmt = (a, web) => {
            let h = esc(a).replace(/\[p\.?\s*(\d+)(?:\s*[-–,]\s*p?\.?\s*\d+)*\]/gi, (mm, n) => p ? `<button class="ai-pg" data-p="${n}">p.${n}</button>` : '').replace(/\[web\]/gi, '<span class="ai-webtag">🌐 web</span>').replace(/\n/g, '<br>');
            return h;
        };
        const paint = () => {
            logEl.innerHTML = log.map(t => `<div class="ai-q">${esc(t.q)}${t.web ? ' <span class="ai-webtag">🌐 web</span>' : ''}</div><div class="ai-a">${t.err ? `<span style="color:var(--due)">${esc(t.err)}</span>` : fmt(t.a)}</div>${t.links && t.links.length ? `<div class="ai-links">🌐 <b>Vient du web :</b> ${t.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a>`).join(' · ')}</div>` : ''}${t.a ? '<div class="ai-tag">✨ Généré par IA, à vérifier</div>' : ''}`).join('');
            logEl.scrollTop = logEl.scrollHeight;
        };
        const ask = async () => {
            const inp = $('#aic-in', m), q = inp.value.trim(); if (!q || busy) return;
            const web = canWeb && $('#aic-web', m).checked; inp.value = ''; busy = true; ctl = new AbortController();
            const turn = { q, a: '', web, links: [] }; log.push(turn); st.style.color = ''; st.textContent = 'L\'IA réfléchit…'; paint();
            const hist = log.slice(-5, -1).filter(t => t.a).map(t => `Question : ${t.q}\nRéponse : ${t.a}`).join('\n\n');
            try {
                turn.a = (await this.aiCall({ system, prompt: `DOCUMENT :\n${doc}\n\n${hist ? 'ÉCHANGES PRÉCÉDENTS :\n' + hist + '\n\n' : ''}${web ? 'La recherche internet est autorisée pour cette question.' : 'La recherche internet est interdite pour cette question.'}\nQUESTION : ${q}`, maxTokens: 1200, signal: ctl.signal, web })).trim();
                turn.links = this.aiLinks || []; st.textContent = '';
            } catch (e) { if (fin) return; turn.err = e && e.ai ? e.message : 'Erreur inattendue.'; st.textContent = ''; }
            busy = false; paint();
        };
        $('#aic-go', m).addEventListener('click', ask);
        $('#aic-in', m).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ask(); } });
        logEl.addEventListener('click', e => { const b = e.target.closest('.ai-pg'); if (!b) return; const n = Number(b.dataset.p); this.closeModal(m); this.pdfGoto(n); });
        setTimeout(() => $('#aic-in', m).focus(), 50);
    },
    /* ---------- quiz (QCM outside the schedule) ---------- */
    async aiQuizFrom(text, { label, pages = 0, count = 10, deckId = '', hint = '', ch = '' }) {
        if (!this.aiReady()) { this.aiNeedKey(); return; }
        const { chunks, cut, chars } = this.aiChunks(text);
        if (chars < 80) { this.toast('Pas assez de texte pour un quiz.', 'warning'); return; }
        const per = Math.max(2, Math.ceil(count / chunks.length));
        const system = 'Tu crées des QCM de révision pour un étudiant, en français. Format strict, un QCM par bloc, blocs séparés par une ligne vide : la première ligne est la question, puis 4 réponses, une par ligne, au format "a) texte". Ajoute " *" à la fin de la ou des bonnes réponses. Puis une ligne "=> explication courte". Les mauvaises réponses doivent être plausibles. Base-toi uniquement sur le texte, sans rien inventer. Aucun titre ni commentaire. Si le texte ne permet pas de faire de QCM, réponds exactement NONE.';
        const jobs = chunks.map(chk => ({ system, prompt: `Crée ${per} QCM à partir de ce texte :${hint ? '\n(' + hint + ')' : ''}\n\n${chk}`, maxTokens: 3000 }));
        const out = await this.aiRun({ title: 'Quiz avec l\'IA', what: label, chars, pages, preview: chunks[0], jobs, note: cut ? `Le texte est très long : seuls les ${AI_MAX_CHARS.toLocaleString('fr-FR')} premiers caractères sont envoyés.` : '' });
        if (!out) return;
        const txt = out.map(o => o.replace(/```[a-z]*/gi, '').replace(/^NONE$/gm, '').trim()).filter(Boolean).join('\n\n');
        if (!parseQcmBlocks(txt).items.length) { this.toast('L\'IA n\'a pas pu faire de QCM avec ce texte.', 'warning'); return; }
        this.openQcmBulk(deckId, { text: txt, ai: true, ch });
    },
    async aiPdfQuiz(st = {}) {
        if (!this.pv) return;
        const lv = this.stLevelInfo(this.pv.p), dn = st.n || 10;
        const r = await this.aiPdfRange({ title: 'Quiz avec l\'IA', range: st.range, extra: `<label class="field"><span class="label">Nombre de questions</span><select class="select" data-v="n">${[5, 10, 20].map(v => `<option value="${v}" ${v === dn ? 'selected' : ''}>Environ ${v}</option>`).join('')}</select></label>` });
        if (!r) return;
        const p = this.pv.p; await this.aiQuizFrom(r.text, { label: `PDF « ${p.name} »`, pages: r.pages, count: Number(r.vals.n), deckId: p.pdeck || '', hint: lv.quizHint, ch: st.ch || '' });
    },
    async aiNoteQuiz(id) {
        const n = this.note(id); if (!n) return;
        await this.aiQuizFrom(n.b.map(b => this.nbPlain(b.x)).filter(Boolean).join('\n'), { label: `Note « ${n.title || 'Sans titre'} »`, count: 10, deckId: n.deckId || '' });
    },
    /* ---------- scanned PDF: read the pages with the AI (images → text, kept in the PDF) ---------- */
    async aiOcr() {
        const pv = this.pv; if (!pv) return;
        const c = this.aiCfg();
        const r = await this.aiPdfRange({ title: 'Lire ce PDF avec l\'IA', noText: true, cta: 'Continuer', extra: `<p class="help">Les pages sont envoyées <b>comme images</b> à ${esc(c.name)} pour en lire le texte (20 pages au maximum à la fois). Utile pour un PDF scanné. Le texte lu est gardé dans le PDF : recherche, résumé, cartes et chat marchent ensuite.</p>` });
        if (!r) return;
        const p = pv.p, nums = []; for (let i = r.a; i <= r.b && nums.length < 20; i++) if (!(p.ocr && p.ocr[i])) nums.push(i);
        if (!nums.length) { this.toast('Ces pages ont déjà été lues par l\'IA.', 'warning'); return; }
        const system = 'Tu fais de la reconnaissance de texte. Recopie fidèlement tout le texte visible sur l\'image de la page, dans l\'ordre de lecture, en gardant les paragraphes et les listes. Ne commente pas, ne traduis pas, n\'ajoute rien. Si la page n\'a aucun texte, réponds exactement NONE.';
        const render = async n => {
            const pg = await pv.doc.getPage(n), v0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(2, 1500 / v0.width) });
            const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
            await pg.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp }).promise;
            const u = cv.toDataURL('image/jpeg', 0.8); cv.width = cv.height = 0; return u;
        };
        const jobs = nums.map(n => ({ system, prompt: `Page ${n} du document. Recopie son texte.`, maxTokens: 2500, images: async () => [await render(n)] }));
        const out = await this.aiRun({ title: 'Lire ce PDF avec l\'IA', what: `PDF « ${p.name} »`, chars: 0, pages: nums.length, jobs, asImages: true, note: 'Chaque page est une requête avec une image : cela coûte plus cher qu\'un texte. La lecture peut contenir des erreurs.' });
        if (!out) return;
        p.ocr = p.ocr || {}; let got = 0;
        out.forEach((t, i) => { t = String(t).replace(/```[a-z]*/gi, '').trim(); if (t && t !== 'NONE') { p.ocr[nums[i]] = t.slice(0, 20000); pv.texts[nums[i]] = p.ocr[nums[i]]; got++; } });
        p.mod = Date.now(); this.save(false);
        if (got) this.toast(`${plural(got, 'page lue', 'pages lues')} par l'IA`, 'success'); else this.toast('L\'IA n\'a trouvé aucun texte sur ces pages.', 'warning');
    },
    async aiNoteCards(id) {
        const n = this.note(id); if (!n) return;
        const text = n.b.map(b => this.nbPlain(b.x)).filter(Boolean).join('\n');
        const lines = await this.aiCardsFrom(text, { label: `Note « ${n.title || 'Sans titre'} »`, deckId: n.deckId || '' });
        if (lines) this.openImportModal({ text: lines.join('\n'), ai: true, deckId: n.deckId || '' });
    },
    /* ---------- « Pourquoi ? » on a card ---------- */
    aiWhy(cardId) {
        const c = this.card(cardId); if (!c) return;
        if (!this.aiReady()) { this.aiNeedKey(); return; }
        const front = stripHtml(c.kind === 'cloze' && c.nf ? c.nf.text : c.front).replace(CLOZE_RE, '[…]'), back = c.kind === 'cloze' && c.nf ? stripHtml(c.nf.text).replace(CLOZE_RE, '$2') : stripHtml(c.back), deck = this.deck(c.deckId);
        const ctx = `Fiche de révision (paquet « ${deck ? deck.name : ''} ») :\nRecto : ${front}\nVerso : ${back}${c.detail ? `\nDétail : ${stripHtml(c.detail)}` : ''}`;
        const system = 'Tu es un tuteur patient. Explique en français simple pourquoi la réponse de la fiche est correcte, avec un moyen mnémotechnique ou un exemple si utile. Reste fidèle à la fiche : si tu n\'es pas sûr, dis-le. Pas de longue introduction.';
        const log = [];   // [question, answer]
        const m = this.openModal({ title: `${ic('sparkle')} Pourquoi ?`, size: 'narrow',
            body: `<div class="info-grid"><div><span>Envoyé à ${esc(this.aiCfg().name)}</span><b>${esc(truncate(front, 120))} → ${esc(truncate(back, 120))}</b></div></div>
                <div id="aiw-log" style="margin-top:12px"></div><p class="help" id="aiw-st" style="margin-top:8px"></p>
                <div class="field hidden" id="aiw-q"><label class="label" for="aiw-in">Une question sur cette fiche ?</label><div class="row-gap"><input class="input" id="aiw-in" style="flex:1" placeholder="Ex : Donne-moi un exemple" autocomplete="off"><button class="btn btn-soft" id="aiw-ask">Demander</button></div></div>`,
            foot: `<button class="btn btn-soft" data-close>Fermer</button><button class="btn btn-soft hidden" id="aiw-detail">Plus de détail</button><button class="btn btn-soft hidden" id="aiw-mnemo">Mnémotechnique</button><button class="btn btn-soft hidden" id="aiw-better">Améliorer la carte</button><button class="btn btn-soft hidden" id="aiw-save">${ic('plus')}Garder dans la carte</button><button class="btn btn-primary" id="aiw-go">${ic('sparkle')}Expliquer</button>` });
        const st = $('#aiw-st', m), logEl = $('#aiw-log', m);
        let ctl = null, busy = false;
        const paint = () => { logEl.innerHTML = log.map(([q, a]) => `${q ? `<div class="ai-q">${esc(q)}</div>` : ''}<div class="ai-a">${esc(a).replace(/\n/g, '<br>')}</div>`).join('') + (log.length ? '<div class="ai-tag">✨ Généré par IA, à vérifier</div>' : ''); };
        const ask = async (q, extra) => {
            if (busy) return; busy = true; st.style.color = ''; st.textContent = 'L\'IA réfléchit…'; $('#aiw-go', m).disabled = true; ctl = new AbortController();
            const history = log.map(([qq, a]) => `${qq ? `Question de l'étudiant : ${qq}\n` : ''}Réponse : ${a}`).join('\n\n');
            const prompt = `${ctx}\n\n${history ? history + '\n\n' : ''}${q ? `Question de l'étudiant : ${q}` : extra || 'Pourquoi cette réponse est-elle la bonne ?'}`;
            try {
                const a = await this.aiCall({ system, prompt, maxTokens: 900, signal: ctl.signal });
                log.push([q || '', a.trim()]); st.textContent = ''; paint();
                $('#aiw-go', m).classList.add('hidden'); ['#aiw-q', '#aiw-detail', '#aiw-save', '#aiw-mnemo', '#aiw-better'].forEach(s => $(s, m).classList.remove('hidden'));
            } catch (e) { st.style.color = 'var(--due)'; st.textContent = e && e.ai ? e.message : 'Erreur inattendue.'; }
            busy = false; $('#aiw-go', m).disabled = false;
        };
        $('#aiw-go', m).addEventListener('click', () => ask(''));
        $('#aiw-detail', m).addEventListener('click', () => ask('', 'Explique plus en détail, étape par étape.'));
        $('#aiw-mnemo', m).addEventListener('click', () => ask('', 'Propose une astuce mnémotechnique originale et facile à retenir pour cette carte (image mentale, acronyme ou phrase).'));
        $('#aiw-better', m).addEventListener('click', () => this.aiImproveCard(c.id, m));
        const free = () => { const i = $('#aiw-in', m), q = i.value.trim(); if (!q) return; i.value = ''; ask(q); };
        $('#aiw-ask', m).addEventListener('click', free);
        $('#aiw-in', m).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); free(); } });
        $('#aiw-save', m).addEventListener('click', () => {
            const last = log[log.length - 1]; if (!last) return;
            this.change('explication IA', [c.id], () => { const x = this.card(c.id); x.detail = ((x.detail ? x.detail + '<br><br>' : '') + `<i>✨ Généré par IA :</i> ` + esc(last[1]).replace(/\n/g, '<br>')); x.mod = Date.now(); });
            $('#aiw-save', m).disabled = true; st.style.color = 'var(--easy)'; st.textContent = 'Ajouté au détail de la carte.';
        });
    },
    aiAction(action, el) {
        if (action === 'ai-prov') { this.aiSaveFields(); const s = AiStore.get(); s.provider = el.dataset.v; AiStore.set(s); this.renderSettings(); setTimeout(() => { const p = document.getElementById('ai-panel'); if (p) p.scrollIntoView({ block: 'start' }); }, 50); }
        else if (action === 'ai-test') this.aiTest();
        else if (action === 'ai-clear') { const s = AiStore.get(); s.keys[s.provider] = ''; AiStore.set(s); this.renderSettings(); }
        else if (action === 'ai-why') { if (this.session && this.session.current) this.aiWhy(this.session.current); }
        else if (action === 'ai-pdf') this.aiPdfCards();
        else if (action === 'ai-grade') this.aiGradeAnswer();
        else if (action === 'ai-assist') this.aiAssistant();
        else if (action === 'ai-exam') this.aiMockExam();
        else if (action === 'ai-chat') this.aiChat();
    }
});
document.addEventListener('change', e => { if (e.target && (e.target.id === 'ai-key' || e.target.id === 'ai-model' || e.target.id === 'ai-url') && window.app && app.aiSaveFields) app.aiSaveFields(); });
