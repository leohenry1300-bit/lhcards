/* ============================================================
   Notes : vidéos (YouTube, Vimeo, lien .mp4), fichiers joints (Word, PowerPoint, Excel, audio, vidéo, tout fichier)
   et import d'un document en note (.docx .pptx .xlsx .txt .md .csv → titres, listes, tableaux, images).
   Les fichiers restent SUR L'APPAREIL (IndexedDB, comme les PDF) : ni synchro, ni export JSON ; la note garde seulement leur nom.
   ============================================================ */
const MEDIA_MAX = 150 * 1024 * 1024;
const FILE_ICONS = { doc: 'file', docx: 'file', odt: 'file', rtf: 'file', ppt: 'layers', pptx: 'layers', odp: 'layers', xls: 'table', xlsx: 'table', csv: 'table', ods: 'table', zip: 'folder', txt: 'file', md: 'file' };
const fileExt = n => (/\.([a-z0-9]{1,5})$/i.exec(n || '') || [, ''])[1].toLowerCase();
const convertible = n => ['docx', 'pptx', 'xlsx', 'txt', 'md', 'csv'].includes(fileExt(n));
/* a video link → { kind, id, embed, thumb, url, start } */
function parseVideoUrl(raw) {
    let u; try { u = new URL(String(raw || '').trim()); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const h = u.hostname.replace(/^www\.|^m\./, ''), t = u.searchParams.get('t') || u.searchParams.get('start') || '';
    const secs = v => { const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(v || ''); return m && v ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0; };
    let id = '';
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (/(^|\.)youtube(-nocookie)?\.com$/.test(h)) id = u.searchParams.get('v') || (/^\/(shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname) || [])[2] || '';
    if (/^[\w-]{6,20}$/.test(id)) return { kind: 'yt', id, url: `https://www.youtube.com/watch?v=${id}`, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, start: secs(t) };
    const vm = h === 'vimeo.com' ? /^\/(?:video\/)?(\d{5,})/.exec(u.pathname) : null;
    if (vm) return { kind: 'vimeo', id: vm[1], url: `https://vimeo.com/${vm[1]}`, thumb: '', start: secs(t) };
    if (/\.(mp4|webm|ogv|m4v)(\?|$)/i.test(u.pathname)) return { kind: 'file', id: '', url: u.href, thumb: '', start: 0 };
    return null;
}
const fmtClock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(r).padStart(2, '0')}`; };
const parseClock = c => c.split(':').reduce((a, v) => a * 60 + Number(v), 0);

Object.assign(SuperAnki.prototype, {
    /* ---------- blocks ---------- */
    nbVideoHtml(b) {
        const v = parseVideoUrl(b.u); if (!v) return `<div class="nb-video bad">Lien vidéo illisible : ${esc(b.u)}</div>`;
        const x = `<button class="icon-btn icon-btn-sm nb-img-x" data-nbk="vidx" aria-label="Retirer la vidéo">${ic('x')}</button>`;
        if (v.kind === 'file') return `<figure class="nb-video"><video controls preload="metadata" playsinline src="${esc(v.url)}"></video>${x}</figure>`;
        return `<figure class="nb-video"><div class="nb-vid-box" data-nbk="vplay" data-k="${v.kind}" data-id="${esc(v.id)}" data-s="${b.s || v.start || 0}" role="button" tabindex="0" aria-label="Lire la vidéo">${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy">` : '<span class="nb-vid-ph"></span>'}<span class="nb-vid-play">${ic('play')}</span></div>
            <figcaption>${ic('link')}<a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">${v.kind === 'yt' ? 'YouTube' : 'Vimeo'}${(b.s || v.start) ? ` · à ${fmtClock(b.s || v.start)}` : ''}</a></figcaption>${x}</figure>`;
    },
    nbVideoPlay(box, secs) {
        const k = box.dataset.k, id = box.dataset.id, s = Number(secs != null ? secs : box.dataset.s) || 0;
        const src = k === 'yt' ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1${s ? `&start=${s}` : ''}` : `https://player.vimeo.com/video/${encodeURIComponent(id)}?autoplay=1${s ? `#t=${s}s` : ''}`;
        box.innerHTML = `<iframe src="${src}" title="Vidéo" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        box.classList.add('playing'); box.removeAttribute('data-nbk');
    },
    nbFileHtml(b) {
        const ext = fileExt(b.name), icon = FILE_ICONS[ext] || (/^audio\//.test(b.mime) ? 'volume' : /^video\//.test(b.mime) ? 'play' : 'file'), media = /^(audio|video)\//.test(b.mime || '');
        return `<div class="nb-file" data-fid="${esc(b.fid)}"><span class="nb-file-ico">${ic(icon)}</span><span class="nb-file-t"><b>${esc(b.name)}</b><small>${esc(fmtBytes(b.size || 0))} · ${esc(ext.toUpperCase() || 'fichier')} · sur cet appareil</small></span>
            <span class="nb-file-act">${media ? `<button class="btn btn-soft btn-sm" data-nbk="fplay">${ic('play')}Lire</button>` : ''}${convertible(b.name) ? `<button class="btn btn-soft btn-sm" data-nbk="fconv">${ic('note')}En note</button>` : ''}<button class="btn btn-soft btn-sm" data-nbk="fopen">${ic('export')}Ouvrir</button><button class="icon-btn icon-btn-sm" data-nbk="vidx" aria-label="Retirer le fichier">${ic('x')}</button></span></div>`;
    },
    async nbFileBlob(b) { const buf = await PdfStore.get(b.fid); return buf ? new Blob([buf], { type: b.mime || 'application/octet-stream' }) : null; },
    async nbFileOpen(b) {
        const blob = await this.nbFileBlob(b);
        if (!blob) { this.toast('Ce fichier n\'est pas sur cet appareil (les fichiers joints ne sont ni synchronisés ni sauvegardés). Rajoute-le ici.', 'warning'); return; }
        const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = b.name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    async nbFilePlay(row, b) {
        const blob = await this.nbFileBlob(b); if (!blob) { this.toast('Ce fichier n\'est pas sur cet appareil.', 'warning'); return; }
        const url = URL.createObjectURL(blob), tag = /^video\//.test(b.mime) ? 'video' : 'audio', old = row.querySelector('.nb-file-player'); if (old) { old.remove(); return; }
        row.insertAdjacentHTML('beforeend', `<${tag} class="nb-file-player" controls autoplay playsinline src="${url}"></${tag}>`);
    },
    /* ---------- adding ---------- */
    nbVideoPrompt(i) {
        const m = this.openModal({ title: `${ic('play')} Insérer une vidéo`, size: 'narrow', body: `<div class="field"><label class="label" for="vid-u">Lien YouTube, Vimeo ou fichier .mp4</label><input class="input" id="vid-u" placeholder="https://www.youtube.com/watch?v=…" inputmode="url" autocomplete="off"></div><div id="vid-prev" class="help">Colle l'adresse de la vidéo. Un temps comme « t=90 » est gardé.</div>`, foot: `<button class="btn btn-soft" data-close>Annuler</button><button class="btn btn-primary" id="vid-ok" disabled>${ic('check')}Insérer</button>` });
        const inp = $('#vid-u', m), ok = $('#vid-ok', m), prev = $('#vid-prev', m);
        const upd = () => { const v = parseVideoUrl(inp.value); ok.disabled = !v; prev.innerHTML = v ? `${v.thumb ? `<img class="vid-th" src="${esc(v.thumb)}" alt="">` : ''}<b>${v.kind === 'yt' ? 'YouTube' : v.kind === 'vimeo' ? 'Vimeo' : 'Fichier vidéo'}</b>${v.start ? ` · départ à ${fmtClock(v.start)}` : ''}` : (inp.value.trim() ? 'Lien non reconnu : utilise une adresse YouTube, Vimeo ou un fichier .mp4.' : 'Colle l\'adresse de la vidéo.'); };
        inp.addEventListener('input', upd);
        const go = () => { const v = parseVideoUrl(inp.value); if (!v) return; this.closeModal(m); this.nbInsertAfter(Math.min(i, this.note(this.ui.note).b.length - 1), [{ t: 'video', u: String(inp.value).trim().slice(0, 500), s: v.start || 0 }, { t: 'p', x: '' }]); };
        ok.addEventListener('click', go); inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        setTimeout(() => inp.focus(), 60);
    },
    nbFilePick(i, convertOnly = false) {
        const input = $('#hidden-file'); input.accept = convertOnly ? '.docx,.pptx,.xlsx,.txt,.md,.csv,text/plain' : ''; input.value = '';
        input.onchange = async () => { const f = input.files[0]; if (f) await this.nbFileAdd(i, f, convertOnly); };
        input.click();
    },
    async nbFileAdd(i, f, convertOnly = false) {
        if (f.size > MEDIA_MAX) { this.toast(`Ce fichier est trop gros (${fmtBytes(f.size)}) : 150 Mo au maximum.`, 'warning'); return; }
        const buf = await f.arrayBuffer(), fid = await pdfHashOf(buf), mime = f.type || ({ docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', md: 'text/markdown', csv: 'text/csv' }[fileExt(f.name)] || 'application/octet-stream');
        await PdfStore.put(fid, buf);
        const blk = { t: 'file', fid, name: f.name.slice(0, 200), size: f.size, mime: mime.slice(0, 100) };
        if (convertible(f.name)) {
            const choice = convertOnly ? 'conv' : await new Promise(res => { let fin = false; const m = this.openModal({ title: `${ic('note')} ${esc(truncate(f.name, 40))}`, size: 'narrow', body: '<p style="margin:0">Ce document peut devenir une <b>note modifiable</b> (titres, listes, tableaux, images). L\'original reste joint.</p>', foot: `<button class="btn btn-soft" id="fa-only">Joindre seulement</button><button class="btn btn-primary" id="fa-conv">${ic('note')}Convertir en note</button>`, onClose: () => { if (!fin) { fin = true; res('only'); } } }); $('#fa-only', m).addEventListener('click', () => { fin = true; this.closeModal(m); res('only'); }); $('#fa-conv', m).addEventListener('click', () => { fin = true; this.closeModal(m); res('conv'); }); });
            if (choice === 'conv') { await this.nbConvertFile(f, blk, buf); return; }
        }
        const n = this.note(this.ui.note); if (!n) return;
        this.nbInsertAfter(Math.min(i, n.b.length - 1), [blk, { t: 'p', x: '' }]);
    },
    /* a document becomes a new note (the original stays attached at the top) */
    async nbConvertFile(f, blk, buf) {
        let res; this.toast('Lecture du document…', 'warning');
        try { res = await this.docToBlocks(f.name, buf); } catch (e) { this.toast(`Impossible de lire ce document : ${e && e.message ? e.message : 'format non reconnu'}`, 'error'); return; }
        const title = (res.title || f.name.replace(/\.[a-z0-9]+$/i, '')).slice(0, 120);
        const note = this.noteNew(title, { b: [blk, ...res.blocks, { t: 'p', x: '', d: 0 }] });
        this.go('notes'); this.noteOpen(note.id);
    },
    async docToBlocks(name, buf) {
        const ext = fileExt(name);
        if (ext === 'txt' || ext === 'md' || ext === 'csv') {
            const txt = new TextDecoder().decode(new Uint8Array(buf)), lines = txt.replace(/\r/g, '').split('\n');
            if (ext === 'csv') { const sep = lines[0] && lines[0].split(';').length > lines[0].split(',').length ? ';' : lines[0] && lines[0].includes('\t') ? '\t' : ','; const rows = lines.filter(l => l.trim()).slice(0, 60).map(l => l.split(sep).slice(0, 8).map(c => c.trim().replace(/^"|"$/g, ''))); return { title: '', blocks: rows.length ? [{ t: 'table', id: uid('b'), hdr: true, rows }] : [] }; }
            const blocks = []; lines.forEach(l => { if (!l.trim()) return; const h = /^(#{1,3})\s+(.*)$/.exec(l), li = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l); if (h) blocks.push({ t: 'h' + h[1].length, x: h[2].slice(0, 300), d: 0 }); else if (li) blocks.push({ t: 'p', x: li[2].slice(0, 1000), d: Math.min(3, Math.floor(li[1].replace(/\t/g, '  ').length / 2)) }); else blocks.push({ t: 'p', x: l.trim().slice(0, 1000), d: 0 }); });
            return { title: (blocks.find(b => b.t === 'h1') || {}).x || '', blocks: blocks.slice(0, 1500) };
        }
        if (typeof DecompressionStream === 'undefined') throw new Error('navigateur trop ancien');
        const zip = await Zip.open(buf), dec = new TextDecoder(), xml = async p => { const r = await zip.read(p); return r ? new DOMParser().parseFromString(dec.decode(r), 'application/xml') : null; };
        const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
        const kids = (el, ns, ln) => [...el.getElementsByTagNameNS(ns, ln)];
        if (ext === 'docx') {
            const doc = await xml('word/document.xml'); if (!doc) throw new Error('document vide');
            const rels = await xml('word/_rels/document.xml.rels'), relMap = {}; if (rels) [...rels.getElementsByTagName('Relationship')].forEach(r => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
            const body = doc.getElementsByTagNameNS(W, 'body')[0], blocks = []; let imgs = 0;
            const para = async p => {
                const st = (kids(p, W, 'pStyle')[0] || { getAttributeNS: () => '' }).getAttributeNS(W, 'val') || '', hm = /^(?:heading|titre)\s*([1-3])$/i.exec(st) || (/^title$|^titre$/i.test(st) ? [0, '1'] : null);
                let txt = '', pending = '';
                for (const r of kids(p, W, 'r')) {
                    const t = kids(r, W, 't').map(x => x.textContent).join('') + (kids(r, W, 'tab').length ? ' ' : '') + (kids(r, W, 'br').length ? ' ' : '');
                    if (t) { const rp = kids(r, W, 'rPr')[0], on = ln => { const e = rp && kids(rp, W, ln)[0]; return e && e.getAttributeNS(W, 'val') !== '0' && e.getAttributeNS(W, 'val') !== 'false'; }; let s = t; if (t.trim() && !hm) { if (on('b')) s = `**${t.trim()}** `; else if (on('i')) s = `*${t.trim()}* `; else if (on('u')) s = `__${t.trim()}__ `; } txt += s; }
                    for (const bl of kids(r, A, 'blip')) { const id = bl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed'), tg = relMap[id]; if (tg && imgs < 25) { const data = await zip.read('word/' + tg.replace(/^\//, '').replace(/^word\//, '')); if (data) { const ext2 = fileExt(tg), mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext2]; if (mime) { try { pending = this.addMedia(await this.compressImage(new File([data], 'i', { type: mime }))); imgs++; } catch { /* skip */ } } } } }
                }
                txt = txt.replace(/\s+/g, ' ').replace(/\*\* \*\*/g, ' ').trim();
                const lvl = kids(p, W, 'ilvl')[0], isList = !!kids(p, W, 'numPr')[0];
                if (txt) blocks.push(hm ? { t: 'h' + hm[1], x: txt.slice(0, 300), d: 0 } : { t: 'p', x: txt.slice(0, 2000), d: isList ? Math.min(3, Number(lvl ? lvl.getAttributeNS(W, 'val') : 0) + 0) : 0 });
                if (pending) blocks.push({ t: 'img', src: pending });
            };
            for (const el of [...body.children]) {
                if (el.localName === 'p') await para(el);
                else if (el.localName === 'tbl') { const rows = kids(el, W, 'tr').slice(0, 40).map(tr => kids(tr, W, 'tc').slice(0, 8).map(tc => kids(tc, W, 'p').map(pp => kids(pp, W, 't').map(t => t.textContent).join('')).join(' ').trim())); if (rows.length) blocks.push({ t: 'table', id: uid('b'), hdr: true, rows }); }
            }
            return { title: (blocks.find(b => b.t === 'h1') || {}).x || '', blocks: blocks.slice(0, 3000) };
        }
        if (ext === 'pptx') {
            const names = zip.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml/.exec(a)[1]) - Number(/(\d+)\.xml/.exec(b)[1])), blocks = []; let first = '';
            for (let k = 0; k < Math.min(names.length, 200); k++) {
                const d = await xml(names[k]); if (!d) continue; const paras = kids(d, A, 'p').map(p => ({ t: kids(p, A, 't').map(x => x.textContent).join('').trim(), l: Number((kids(p, A, 'pPr')[0] || { getAttribute: () => 0 }).getAttribute('lvl') || 0) })).filter(p => p.t);
                if (!paras.length) { blocks.push({ t: 'h2', x: `Diapositive ${k + 1}`, d: 0 }); continue; }
                if (!first) first = paras[0].t; blocks.push({ t: 'h2', x: `${k + 1}. ${paras[0].t}`.slice(0, 200), d: 0 }); paras.slice(1).forEach(p => blocks.push({ t: 'p', x: p.t.slice(0, 1000), d: Math.min(3, p.l) }));
            }
            return { title: first, blocks };
        }
        if (ext === 'xlsx') {
            const ss = await xml('xl/sharedStrings.xml'), strings = ss ? kids(ss, 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'si').map(si => kids(si, 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 't').map(t => t.textContent).join('')) : [];
            const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', names = zip.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(), wb = await xml('xl/workbook.xml'), sheetNames = wb ? [...wb.getElementsByTagNameNS(S, 'sheet')].map(s => s.getAttribute('name')) : [], blocks = [];
            for (let k = 0; k < Math.min(names.length, 12); k++) {
                const d = await xml(names[k]); if (!d) continue; const grid = [];
                kids(d, S, 'c').forEach(c => { const m = /^([A-Z]+)(\d+)$/.exec(c.getAttribute('r') || ''); if (!m) return; const col = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, row = Number(m[2]) - 1; if (row >= 60 || col >= 8) return; const v = (kids(c, S, 'v')[0] || {}).textContent || '', t = c.getAttribute('t'); const val = t === 's' ? strings[Number(v)] || '' : t === 'inlineStr' ? kids(c, S, 't').map(x => x.textContent).join('') : v; (grid[row] = grid[row] || [])[col] = String(val).slice(0, 300); });
                const rows = grid.filter(Boolean); if (!rows.length) continue; const w = Math.max(...rows.map(r => r.length)); rows.forEach(r => { for (let c = 0; c < w; c++) if (r[c] == null) r[c] = ''; });
                blocks.push({ t: 'h2', x: sheetNames[k] || `Feuille ${k + 1}`, d: 0 }, { t: 'table', id: uid('b'), hdr: true, rows });
            }
            return { title: '', blocks };
        }
        throw new Error('format non pris en charge (.docx, .pptx, .xlsx, .txt, .md, .csv)');
    }
});
