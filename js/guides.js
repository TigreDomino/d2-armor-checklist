(function () {
  const DB_NAME = 'tgs-guides', STORE = 'items';
  const $ = (id) => document.getElementById(id);
  const view = $('guides-view'), grid = $('guides-grid'), emptyEl = $('guides-empty'), statusEl = $('guides-status'),
        chipsEl = $('guides-chips'), searchEl = $('guides-search'), viewer = $('guides-viewer'),
        stage = $('gv-stage'), vimg = $('gv-img');
  let items = [], loaded = false, dbp = null, fCat = '', fQuery = '';
  let vList = [], vIdx = 0, z = { s: 1, x: 0, y: 0 }, drag = null, persistAsked = false;
  const urlCache = new Map();
  const PUB = 'guides/';
  let OWNER = !!(window.TGSOwner && window.TGSOwner.get());
  function applyOwnerUI() { document.querySelectorAll('.owner-only').forEach((el) => { el.hidden = !OWNER; }); }
  applyOwnerUI();

  /* ---------- storage (IndexedDB) ---------- */
  function db() {
    if (!dbp) dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB is not available'));
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  const dbAll = () => tx('readonly', (s) => s.getAll());
  const dbPut = (it) => tx('readwrite', (s) => s.put(it));
  const dbDel = (id) => tx('readwrite', (s) => s.delete(id));

  /* ---------- helpers ---------- */
  let stT;
  function say(msg, bad, el) {
    const t = el || statusEl;
    t.textContent = msg || ''; t.style.color = bad ? 'var(--danger)' : '';
    clearTimeout(stT); if (msg) stT = setTimeout(() => { t.textContent = ''; }, 5000);
  }
  const newId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const safeLink = (s) => { try { const u = new URL(String(s || '').trim()); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch (e) { return ''; } };
  function askPersist() { if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); } }

  /* ---------- images ---------- */
  const canvasBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));
  async function decode(blob) {
    if (window.createImageBitmap) { try { return await createImageBitmap(blob); } catch (e) {} }
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); res(im); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode')); };
      im.src = u;
    });
  }
  async function scaled(img, w, h, maxW, maxH, type, q) {
    const k = Math.min(1, maxW / w, maxH / h);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return canvasBlob(c, type, q);
  }
  async function buildImage(file, keepOriginal) {
    const out = { blob: file, thumb: file, w: 0, h: 0 };
    let img; try { img = await decode(file); } catch (e) { return out; }
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    out.w = w; out.h = h;
    try {
      if (!keepOriginal && !/gif|svg/.test(file.type) && (Math.max(w, h) > 3200 || file.size > 4 * 1024 * 1024)) {
        const b = await scaled(img, w, h, 3200, 3200, 'image/webp', 0.92);
        if (b && b.size < file.size) out.blob = b;
      }
      const t = await scaled(img, w, h, 520, 1200, 'image/webp', 0.82);
      if (t) out.thumb = t;
    } catch (e) {}
    if (img.close) img.close();
    return out;
  }
  function srcOf(it, full) {
    if (it.url) return it.url;
    if (it.file) return PUB + (full ? it.file : (it.thumb || it.file));
    const k = urlCache.get(it.id) || {}; urlCache.set(it.id, k);
    const key = full ? 'full' : 'thumb';
    if (!k[key]) k[key] = URL.createObjectURL(full ? it.blob : (it.thumb || it.blob));
    return k[key];
  }
  function forget(id) { const k = urlCache.get(id); if (k) { Object.values(k).forEach((u) => URL.revokeObjectURL(u)); urlCache.delete(id); } }

  /* ---------- item fields: links and keywords ---------- */
  const MAX_LINKS = 10, MAX_KW = 30;
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u); } };
  function cleanLinks(arr) {
    const out = [];
    (Array.isArray(arr) ? arr : []).forEach((l) => {
      const u = safeLink(l && l.url);
      if (u && out.length < MAX_LINKS && !out.some((x) => x.url === u)) out.push({ url: u, label: String((l && l.label) || '').trim().slice(0, 80) });
    });
    return out;
  }
  function cleanKw(v) {
    const raw = Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/), out = [];
    raw.forEach((k) => { const t = String(k).trim().slice(0, 40); if (t && out.length < MAX_KW && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t); });
    return out;
  }
  function parseLinkLines(text) {
    const links = [], bad = [];
    String(text || '').split(/\n+/).forEach((line) => {
      const l = line.trim(); if (!l) return;
      const m = l.match(/^(\S+)\s*(?:\|\s*(.*))?$/), u = m && safeLink(m[1]);
      if (!u) { bad.push(l); return; }
      links.push({ url: u, label: (m[2] || '').trim() });
    });
    return { links: cleanLinks(links), bad };
  }
  const linksToText = (links) => (links || []).map((l) => l.url + (l.label ? ' | ' + l.label : '')).join('\n');
  function fixItem(it) {
    if (!Array.isArray(it.links)) it.links = it.link ? cleanLinks([{ url: it.link, label: '' }]) : [];
    it.link = it.links[0] ? it.links[0].url : '';
    if (!Array.isArray(it.keywords)) it.keywords = [];
    it.icon = KINDS[it.icon] ? it.icon : '';
    return it;
  }
  const hasImage = (it) => !!(it.url || it.file || it.blob);

  /* ---------- YouTube links ---------- */
  const YT_ID = /^[A-Za-z0-9_-]{11}$/, YT_LIST = /^[A-Za-z0-9_-]{10,60}$/;
  function ytParse(u) {
    try {
      const x = new URL(u), h = x.hostname.replace(/^(www|m|music)\./, '');
      let id = '';
      if (h === 'youtu.be') id = x.pathname.split('/')[1] || '';
      else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
        const seg = x.pathname.split('/').filter(Boolean);
        if (seg[0] === 'watch') id = x.searchParams.get('v') || '';
        else if (['shorts', 'embed', 'live', 'v'].includes(seg[0])) id = seg[1] || '';
      } else return null;
      const list = x.searchParams.get('list') || '';
      let start = 0;
      const t = x.searchParams.get('t') || x.searchParams.get('start') || ((x.hash.match(/t=([^&]+)/) || [])[1]) || '';
      const m = String(t).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
      if (m && (m[1] || m[2] || m[3])) start = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
      if (YT_ID.test(id)) return { id, list: YT_LIST.test(list) ? list : '', start };
      if (YT_LIST.test(list)) return { id: '', list, start: 0 };
      return null;
    } catch (e) { return null; }
  }
  function ytEmbed(v, autoplay) {
    const q = new URLSearchParams();
    if (v.list) q.set('list', v.list);
    if (v.start) q.set('start', String(v.start));
    if (autoplay) q.set('autoplay', '1');
    q.set('rel', '0');
    return 'https://www.youtube-nocookie.com/embed/' + (v.id || 'videoseries') + '?' + q.toString();
  }
  /* ---------- placeholder graphics for entries without an image ---------- */
  const KINDS = {
    doc:    { label: 'Document',    open: 'document',    color: '#5b9cf0', svg: '<path d="M16 6h24l12 12v40H16z"/><path d="M40 6v12h12"/><path d="M24 30h24M24 38h24M24 46h16"/>' },
    sheet:  { label: 'Spreadsheet', open: 'spreadsheet', color: '#47b878', svg: '<rect x="12" y="10" width="40" height="44" rx="3"/><path d="M12 24h40M12 38h40M28 10v44"/>' },
    slides: { label: 'Slides',      open: 'slides',      color: '#e3ac45', svg: '<rect x="8" y="12" width="48" height="34" rx="3"/><path d="M32 46v10M22 56h20M20 38v-8M30 38V22M40 38v-12"/>' },
    video:  { label: 'Video',       open: 'video',       color: '#e5645b', svg: '<rect x="6" y="14" width="52" height="36" rx="8"/><path d="M27 24l14 8-14 8z" fill="currentColor"/>' },
    pdf:    { label: 'PDF',         open: 'PDF',         color: '#e0705a', svg: '<path d="M16 6h24l12 12v40H16z"/><path d="M40 6v12h12"/><text x="34" y="45" text-anchor="middle" font-size="13" font-weight="700" font-family="sans-serif" fill="currentColor" stroke="none">PDF</text>' },
    folder: { label: 'Folder',      open: 'folder',      color: '#cfa84e', svg: '<path d="M6 20a4 4 0 0 1 4-4h14l6 6h24a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z"/>' },
    link:   { label: 'Link',        open: 'link',        color: '#8d97a8', svg: '<circle cx="32" cy="32" r="22"/><ellipse cx="32" cy="32" rx="9" ry="22"/><path d="M10 32h44M14 20h36M14 44h36"/>' }
  };
  function kindOf(url) {
    try {
      const x = new URL(url), h = x.hostname.replace(/^www\./, ''), p = x.pathname.toLowerCase();
      if (ytParse(url)) return 'video';
      if (h === 'docs.google.com') return p.startsWith('/spreadsheets') ? 'sheet' : p.startsWith('/presentation') ? 'slides' : 'doc';
      if (h === 'drive.google.com') return p.includes('/folders') ? 'folder' : 'doc';
      if (/\.pdf$/.test(p)) return 'pdf';
      if (/(^|\.)(twitch\.tv|vimeo\.com|streamable\.com|dailymotion\.com)$/.test(h)) return 'video';
      if (h === 'notion.so' || h === 'notion.site' || h.endsWith('.notion.site')) return 'doc';
      return 'link';
    } catch (e) { return 'link'; }
  }
  const kindFor = (it) => (it.icon && KINDS[it.icon]) ? it.icon : ((it.links && it.links[0]) ? kindOf(it.links[0].url) : 'link');
  function makeIcon(kind, size) {
    const span = document.createElement('span'); span.className = 'kind-ico'; span.style.color = KINDS[kind].color;
    span.innerHTML = '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + KINDS[kind].svg + '</svg>';
    return span;
  }
  async function ytTitle(url) {
    try {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 4000);
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url), { signal: c.signal });
      clearTimeout(t); if (!r.ok) return '';
      const j = await r.json(); return String((j && j.title) || '').trim().slice(0, 200);
    } catch (e) { return ''; }
  }

  /* ---------- add ---------- */
  async function addFiles(files) {
    if (!OWNER) return;
    const imgs = Array.from(files).filter((f) => /^image\//.test(f.type));
    if (!imgs.length) { say('No image files found.', true); return; }
    say('Adding ' + imgs.length + (imgs.length > 1 ? ' images…' : ' image…'));
    askPersist(); let n = 0;
    for (const f of imgs) {
      try {
        const im = await buildImage(f, false);
        const it = { id: newId(), title: (f.name || '').replace(/\.[^.]+$/, '') || 'Untitled', category: '', notes: '', link: '', links: [], keywords: [], added: Date.now(), blob: im.blob, thumb: im.thumb, w: im.w, h: im.h };
        await dbPut(it); items.push(it); n++;
      } catch (e) { say('Could not save an image: ' + (e && e.message || e), true); }
    }
    fCat = ''; render();
    if (n) say('Added ' + n + (n > 1 ? ' images.' : ' image.'));
  }
  async function addUrl(raw) {
    if (!OWNER) return;
    const href = safeLink(raw);
    if (!href) { say('That does not look like a web link (http or https).', true); return; }
    let title = ''; try { const u = new URL(href); title = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname).replace(/\.[^.]+$/, ''); } catch (e) { title = 'Linked image'; }
    const it = { id: newId(), title: title || 'Linked image', category: '', notes: '', link: '', links: [], keywords: [], added: Date.now(), url: href };
    try { await dbPut(it); items.push(it); fCat = ''; render(); say('Added link.'); $('guides-url-input').value = ''; }
    catch (e) { say('Could not save: ' + (e && e.message || e), true); }
  }

  /* ---------- list ---------- */
  /* ---------- search: keywords + Destiny abbreviations ---------- */
  const infoEl = $('guides-info');
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const pad = (s) => ' ' + s + ' ';
  const natural = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
  // Each entry: display name + abbreviations people type. Typing any of them finds all of them.
  const GROUP_DEFS = [
    ['Last Wish', ['lw']], ['Garden of Salvation', ['gos', 'garden']], ['Deep Stone Crypt', ['dsc', 'crypt']],
    ['Vault of Glass', ['vog', 'vault']], ['Vow of the Disciple', ['vow']], ["King's Fall", ['kf']],
    ['Root of Nightmares', ['ron', 'root']], ["Crota's End", ['ce', 'crota']], ["Salvation's Edge", ['se']],
    ['The Desert Perpetual', ['dp']], ['Crown of Sorrow', ['cos']], ['Scourge of the Past', ['sotp', 'scourge']],
    ['Leviathan', ['lev']], ['Eater of Worlds', ['eow']], ['Spire of Stars', ['sos']],
    ['Shattered Throne', ['st']], ['Pit of Heresy', ['poh']], ['Grasp of Avarice', ['goa']],
    ['Spire of the Watcher', ['sotw']], ['Ghosts of the Deep', ['god']], ["Warlord's Ruin", ['wr']],
    ["Vesper's Host", ['vh']], ['Sundered Doctrine', ['sd']], ['Grandmaster Nightfall', ['gm', 'gms']],
    ['Nightfall', ['nf']], ['Trials of Osiris', ['trials']], ['Iron Banner', ['ib']]
  ];
  const GROUPS = GROUP_DEFS.map((g) => ({ name: g[0], terms: [norm(g[0])].concat(g[1].map(norm)) }));
  const TERMS = []; GROUPS.forEach((g, gi) => g.terms.forEach((t) => TERMS.push([t, gi]))); TERMS.sort((a, b) => b[0].length - a[0].length);
  const hasTerm = (hay, gi) => GROUPS[gi].terms.some((t) => hay.includes(pad(t)));
  const fcache = new Map();
  function fields(it) {
    let f = fcache.get(it.id);
    if (!f) {
      f = { t: pad(norm(it.title)), k: pad(norm((it.category || '') + ' ' + (it.keywords || []).join(' '))),
            r: pad(norm((it.notes || '') + ' ' + (it.links || []).map((l) => (l.label || '') + ' ' + l.url).join(' '))) };
      fcache.set(it.id, f);
    }
    return f;
  }
  const STOP = new Set(['of', 'the', 'a', 'an', 'and']);
  function parseQuery(raw) {
    const groups = [];
    // 1) full multi-word names typed out ("deep stone crypt", "kings fall")
    let q = pad(norm(raw));
    TERMS.forEach(([t, gi]) => { if (t.includes(' ') && !groups.includes(gi) && q.includes(pad(t))) { groups.push(gi); q = q.split(pad(t)).join(' '); } });
    const tokens = q.trim().split(/\s+/).filter(Boolean);
    // 2) part of a full name ("deep stone", "stone crypt")
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let len = tokens.length; len >= 2; len--) {
        for (let i = 0; i + len <= tokens.length; i++) {
          const win = tokens.slice(i, i + len);
          if (!win.some((w) => !STOP.has(w))) continue;
          const phrase = pad(win.join(' '));
          const gi = GROUPS.findIndex((g, k) => !groups.includes(k) && pad(g.terms[0]).includes(phrase));
          if (gi >= 0) { groups.push(gi); tokens.splice(i, len); changed = true; break outer; }
        }
      }
    }
    // 3) single-word abbreviations ("dsc", "vog", "crypt")
    const rest = tokens.filter((t) => {
      const hit = TERMS.find(([term]) => term === t);
      if (!hit) return true;
      if (!groups.includes(hit[1])) groups.push(hit[1]);
      return false;
    });
    return { groups, tokens: rest };
  }
  function scoreItem(it, q) {
    const f = fields(it); let s = 0;
    for (const gi of q.groups) { const w = hasTerm(f.t, gi) ? 5 : hasTerm(f.k, gi) ? 4 : hasTerm(f.r, gi) ? 1 : 0; if (!w) return 0; s += w; }
    for (const t of q.tokens) { const w = f.t.includes(t) ? 3 : f.k.includes(t) ? 2 : f.r.includes(t) ? 1 : 0; if (!w) return 0; s += w; }
    return s;
  }
  let lastQuery = null;
  function filtered() {
    const q = fQuery.trim() ? parseQuery(fQuery) : null;
    const searching = !!(q && (q.groups.length || q.tokens.length));
    lastQuery = searching ? q : null;
    let list = items.filter((it) => !fCat || catKey(it.category || '') === fCat);
    if (searching) return list.map((it) => ({ it, s: scoreItem(it, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || natural(a.it.title, b.it.title)).map((x) => x.it);
    return list.sort(fCat ? (a, b) => natural(a.title, b.title) : (a, b) => b.added - a.added);
  }
  // "DSC" and "Deep Stone Crypt" count as the same category
  function catKey(c) { const n = norm(c), hit = TERMS.find(([t]) => t === n); return hit ? 'g' + hit[1] : 'c' + n; }
  function categories() {
    const m = new Map();
    items.forEach((it) => {
      const c = (it.category || '').trim(); if (!c) return;
      const k = catKey(c);
      if (!m.has(k)) m.set(k, { key: k, name: k[0] === 'g' ? GROUPS[+k.slice(1)].name : c, n: 0 });
      m.get(k).n++;
    });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
  function renderChips() {
    const cats = categories(); chipsEl.textContent = '';
    if (!cats.length) { if (fCat) fCat = ''; return; }
    if (fCat && !cats.some((c) => c.key === fCat)) fCat = '';
    const mk = (label, key) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'g-chip' + (key === fCat ? ' on' : ''); b.textContent = label; b.dataset.cat = key; chipsEl.appendChild(b); };
    mk('All (' + items.length + ')', '');
    cats.forEach((c) => mk(c.name + ' (' + c.n + ')', c.key));
    const dl = $('guides-cats'); dl.textContent = '';
    cats.forEach((c) => { const o = document.createElement('option'); o.value = c.name; dl.appendChild(o); });
  }
  function placeholderInto(th, it) {
    th.classList.remove('yt'); th.classList.add('noimg'); th.textContent = '';
    const k = kindFor(it); th.dataset.kind = k; th.style.setProperty('--k', KINDS[k].color);
    const n = document.createElement('div'); n.className = 'g-noimg'; n.appendChild(makeIcon(k, 56));
    const lab = document.createElement('div'); lab.className = 'g-noimg-label'; lab.textContent = KINDS[k].label + ((it.links && it.links[0]) ? ' · ' + hostOf(it.links[0].url) : ''); n.appendChild(lab);
    th.appendChild(n);
  }
  function ytThumbInto(th, it, v) {
    th.classList.add('yt'); th.dataset.kind = 'video-thumb';
    const im = document.createElement('img'); im.loading = 'lazy'; im.alt = it.title || ''; im.src = 'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg';
    im.onerror = () => placeholderInto(th, it);
    const pb = document.createElement('span'); pb.className = 'g-ytplay'; pb.textContent = '▶';
    th.append(im, pb);
  }
  function render() {
    renderChips();
    const list = filtered(); grid.textContent = '';
    list.forEach((it) => {
      const card = document.createElement('div'); card.className = 'g-card'; card.tabIndex = 0; card.dataset.id = it.id;
      const th = document.createElement('div'); th.className = 'g-thumb';
      if (hasImage(it)) {
        const im = document.createElement('img'); im.loading = 'lazy'; im.alt = it.title || ''; im.src = srcOf(it, false);
        im.onerror = () => th.classList.add('broken'); th.appendChild(im);
      } else {
        const first = it.links && it.links[0], yv = (first && !it.icon) ? ytParse(first.url) : null;
        if (yv && yv.id) ytThumbInto(th, it, yv); else placeholderInto(th, it);
      }
      const meta = document.createElement('div'); meta.className = 'g-meta';
      const t = document.createElement('div'); t.className = 'g-title'; t.textContent = it.title || 'Untitled';
      const c = document.createElement('div'); c.className = 'g-cat'; c.textContent = it.category || '';
      meta.append(t, c);
      if (it.links && it.links.length) {
        const lw = document.createElement('div'); lw.className = 'g-links';
        it.links.slice(0, 3).forEach((l) => {
          const a = document.createElement('a'); a.className = 'g-link'; a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.textContent = l.label || hostOf(l.url); a.title = l.url; a.addEventListener('click', (e) => e.stopPropagation()); lw.appendChild(a);
        });
        if (it.links.length > 3) { const m = document.createElement('span'); m.className = 'g-more'; m.textContent = '+' + (it.links.length - 3); lw.appendChild(m); }
        meta.appendChild(lw);
      }
      card.append(th, meta); grid.appendChild(card);
    });
    if (lastQuery) {
      const nl = list.reduce((n, it) => n + (it.links ? it.links.length : 0), 0), names = lastQuery.groups.map((gi) => GROUPS[gi].name);
      infoEl.textContent = list.length + ' guide' + (list.length === 1 ? '' : 's') + (nl ? ', ' + nl + ' link' + (nl === 1 ? '' : 's') : '') + ' for “' + fQuery.trim() + '”' + (names.length ? ' (including ' + names.join(', ') + ')' : '');
    } else infoEl.textContent = '';
    emptyEl.style.display = list.length ? 'none' : 'block';
    emptyEl.textContent = items.length ? 'No guides match that search.' : (OWNER ? 'Nothing here yet — add an image sheet above.' : 'No guides have been published yet.');
  }
  grid.addEventListener('click', (e) => { const c = e.target.closest('.g-card'); if (c) openViewer(c.dataset.id); });
  grid.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const c = e.target.closest('.g-card'); if (c) openViewer(c.dataset.id); } });
  chipsEl.addEventListener('click', (e) => { const b = e.target.closest('.g-chip'); if (!b) return; fCat = b.dataset.cat || ''; render(); });
  searchEl.addEventListener('input', () => { fQuery = searchEl.value; render(); });

  /* ---------- viewer ---------- */
  const applyZ = () => { vimg.style.transform = 'translate(' + z.x + 'px,' + z.y + 'px) scale(' + z.s + ')'; };
  const resetZ = () => { z = { s: 1, x: 0, y: 0 }; applyZ(); };
  function zoomFitWidth() {
    const w = vimg.clientWidth, h = vimg.clientHeight; if (!w || !h) return;
    const s = stage.clientWidth / w; z.s = s; z.x = 0; z.y = Math.max(0, (h * s - stage.clientHeight) / 2); applyZ();
  }
  function zoomActual() { const w = vimg.clientWidth; if (!w || !vimg.naturalWidth) return; z = { s: vimg.naturalWidth / w, x: 0, y: 0 }; applyZ(); }
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect(), cx = e.clientX - (r.left + r.width / 2), cy = e.clientY - (r.top + r.height / 2);
    const ns = Math.min(10, Math.max(0.2, z.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    z.x = cx - (cx - z.x) * (ns / z.s); z.y = cy - (cy - z.y) * (ns / z.s); z.s = ns; applyZ();
  }, { passive: false });
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.gv-tools, .gv-nav, #gv-video')) return;
    drag = { x: e.clientX, y: e.clientY, ox: z.x, oy: z.y }; stage.setPointerCapture(e.pointerId); stage.classList.add('grab');
  });
  stage.addEventListener('pointermove', (e) => { if (!drag) return; z.x = drag.ox + e.clientX - drag.x; z.y = drag.oy + e.clientY - drag.y; applyZ(); });
  const endDrag = () => { drag = null; stage.classList.remove('grab'); };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', (e) => { if (!e.target.closest('.gv-tools, .gv-nav, #gv-video')) resetZ(); });
  $('gv-fit').addEventListener('click', resetZ); $('gv-fitw').addEventListener('click', zoomFitWidth); $('gv-actual').addEventListener('click', zoomActual);

  const isOpen = () => viewer.classList.contains('open');
  function renderSideLists(it) {
    const kc = $('gv-kwchips'); kc.textContent = ''; kc.hidden = OWNER || !(it.keywords || []).length;
    (it.keywords || []).forEach((k) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'gv-kwchip'; b.textContent = k; b.dataset.kw = k; kc.appendChild(b); });
    const ll = $('gv-linklist'); ll.textContent = ''; ll.hidden = !(it.links || []).length;
    (it.links || []).forEach((l) => {
      const row = document.createElement('div'); row.className = 'gv-linkrow';
      const yt = ytParse(l.url);
      if (yt) { const pb = document.createElement('button'); pb.type = 'button'; pb.className = 'pill gv-play'; pb.textContent = '▶ Play'; pb.addEventListener('click', () => showVideo(yt)); row.appendChild(pb); }
      const a = document.createElement('a'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = (l.label || hostOf(l.url)) + ' ↗'; a.title = l.url; row.appendChild(a);
      ll.appendChild(row);
    });
  }
  function showItem() {
    const it = vList[vIdx]; if (!it) { closeViewer(); return; }
    resetZ();
    const img = hasImage(it);
    if (img) vimg.src = srcOf(it, true); else vimg.removeAttribute('src');
    vimg.alt = it.title || ''; showImageMode();
    const firstYt = !img && (it.links || []).map((l) => ytParse(l.url)).find(Boolean); if (firstYt) showVideo(firstYt);
    $('gv-count').textContent = 'Guide ' + (vIdx + 1) + ' of ' + vList.length;
    $('gv-title').value = it.title || ''; $('gv-cat').value = it.category || ''; $('gv-notes').value = it.notes || '';
    $('gv-kw').value = (it.keywords || []).join(', '); $('gv-links').value = linksToText(it.links);
    ['gv-title', 'gv-cat', 'gv-notes'].forEach((id) => {
      const el = $(id); el.readOnly = !OWNER;
      el.style.display = (!OWNER && !el.value) ? 'none' : '';
    });
    const nb = $('gv-notes'); nb.style.height = 'auto'; if (!OWNER) nb.style.height = nb.scrollHeight + 'px'; else nb.style.height = '';
    renderSideLists(it);
    $('gv-iconrow').hidden = !(OWNER && !hasImage(it)); $('gv-icon').value = it.icon || '';
    $('gv-prev').style.display = $('gv-next').style.display = vList.length > 1 ? '' : 'none';
    $('gv-status').textContent = '';
  }
  function fillNoImg(it) {
    const box = $('gv-noimg'); box.textContent = '';
    const k = kindFor(it); box.appendChild(makeIcon(k, 96));
    const t = document.createElement('div'); t.className = 'gv-noimg-title'; t.textContent = it.title || 'Untitled'; box.appendChild(t);
    const l = it.links && it.links[0];
    if (l) { const a = document.createElement('a'); a.className = 'gv-noimg-open'; a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Open ' + KINDS[k].open + ' ↗'; box.appendChild(a); }
    else { const m = document.createElement('div'); m.textContent = 'No image or link yet.'; box.appendChild(m); }
  }
  function showImageMode() {
    const it = vList[vIdx], box = $('gv-video'); box.textContent = ''; box.hidden = true;
    const img = !!(it && hasImage(it)); if (!img && it) fillNoImg(it);
    vimg.style.display = img ? '' : 'none'; $('gv-noimg').hidden = img; $('gv-tools').style.display = img ? '' : 'none';
  }
  function showVideo(v) {
    const it = vList[vIdx], box = $('gv-video'); box.textContent = '';
    vimg.style.display = 'none'; $('gv-noimg').hidden = true; $('gv-tools').style.display = 'none'; box.hidden = false;
    const wrap = document.createElement('div'); wrap.className = 'gv-vframe';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'gv-vplay'; btn.setAttribute('aria-label', 'Play video');
    if (v.id) { const im = document.createElement('img'); im.alt = ''; im.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'; btn.appendChild(im); }
    const tri = document.createElement('span'); tri.className = 'gv-vtri'; tri.textContent = '▶'; btn.appendChild(tri);
    const cap = document.createElement('span'); cap.className = 'gv-vcap'; cap.textContent = 'Click to play. The video loads from YouTube.'; btn.appendChild(cap);
    btn.addEventListener('click', () => {
      const f = document.createElement('iframe'); f.src = ytEmbed(v, true); f.title = 'YouTube video'; f.allowFullscreen = true;
      f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen'; f.referrerPolicy = 'strict-origin-when-cross-origin';
      wrap.textContent = ''; wrap.appendChild(f);
    });
    wrap.appendChild(btn); box.appendChild(wrap);
    if (it && hasImage(it)) {
      const back = document.createElement('button'); back.type = 'button'; back.className = 'pill gv-vback'; back.textContent = '← Back to image'; back.addEventListener('click', showImageMode); box.appendChild(back);
    }
  }
  function openViewer(id) {
    vList = filtered(); vIdx = Math.max(0, vList.findIndex((x) => x.id === id));
    viewer.classList.add('open'); document.body.classList.add('viewer-open'); showItem();
  }
  function closeViewer() { viewer.classList.remove('open'); document.body.classList.remove('viewer-open'); vimg.removeAttribute('src'); $('gv-video').textContent = ''; }
  function step(d) { if (vList.length < 2) return; vIdx = (vIdx + d + vList.length) % vList.length; showItem(); }
  $('gv-prev').addEventListener('click', () => step(-1)); $('gv-next').addEventListener('click', () => step(1));
  $('gv-close').addEventListener('click', closeViewer);
  $('gv-kwchips').addEventListener('click', (e) => {
    const b = e.target.closest('.gv-kwchip'); if (!b) return;
    closeViewer(); searchEl.value = b.dataset.kw; fQuery = b.dataset.kw; fCat = ''; render();
  });
  $('gv-save').addEventListener('click', async () => {
    const it = vList[vIdx]; if (!it || !OWNER) return;
    const pl = parseLinkLines($('gv-links').value);
    if (pl.bad.length) { say('These links are not valid (they must start with http:// or https://): ' + pl.bad.slice(0, 2).join(' · '), true, $('gv-status')); return; }
    it.title = $('gv-title').value.trim().slice(0, 200) || 'Untitled'; it.category = $('gv-cat').value.trim().slice(0, 60);
    it.notes = $('gv-notes').value.slice(0, 5000); it.links = pl.links; it.link = pl.links[0] ? pl.links[0].url : ''; it.keywords = cleanKw($('gv-kw').value);
    it.icon = hasImage(it) ? '' : (KINDS[$('gv-icon').value] ? $('gv-icon').value : '');
    fcache.delete(it.id);
    try { await dbPut(it); render(); renderSideLists(it); if (!hasImage(it)) fillNoImg(it); say('Saved ✓', false, $('gv-status')); } catch (e) { say('Could not save: ' + (e && e.message || e), true, $('gv-status')); }
  });
  $('gv-del').addEventListener('click', async () => {
    const it = vList[vIdx]; if (!it || !OWNER || !confirm('Delete "' + (it.title || 'this image') + '"? This cannot be undone.')) return;
    try {
      await dbDel(it.id); forget(it.id); items = items.filter((x) => x.id !== it.id); vList.splice(vIdx, 1);
      if (vIdx >= vList.length) vIdx = 0; render(); showItem();
    } catch (e) { say('Could not delete: ' + (e && e.message || e), true, $('gv-status')); }
  });
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { closeViewer(); return; }
    if (/^(INPUT|TEXTAREA)$/.test((e.target.tagName || ''))) return;
    if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
  });

  /* ---------- toolbar, paste, drop ---------- */
  $('guides-add-btn').addEventListener('click', () => $('guides-file').click());
  $('guides-addlink-btn').addEventListener('click', async () => {
    if (!OWNER) return;
    const raw = prompt('Paste the link for this entry (http or https):'); if (!raw) return;
    const u = safeLink(raw); if (!u) { say('That does not look like a web link (http or https).', true); return; }
    const it = { id: newId(), title: hostOf(u), category: '', notes: '', link: u, links: [{ url: u, label: '' }], keywords: [], added: Date.now(), noimg: true };
    try { await dbPut(it); items.push(it); fCat = ''; fQuery = ''; searchEl.value = ''; render(); openViewer(it.id); }
    catch (e) { say('Could not save: ' + (e && e.message || e), true); return; }
    if (ytParse(u)) ytTitle(u).then(async (title) => {
      if (!title || it.title !== hostOf(u)) return;
      it.title = title; fcache.delete(it.id); try { await dbPut(it); } catch (e) {}
      render(); if (isOpen() && vList[vIdx] === it && $('gv-title').value === hostOf(u)) $('gv-title').value = title;
    });
  });
  $('guides-file').addEventListener('change', (e) => { const f = e.target.files; if (f && f.length) addFiles(f); e.target.value = ''; });
  $('guides-url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(e.target.value); } });
  const shown = () => view.style.display !== 'none';
  document.addEventListener('paste', (e) => {
    if (!OWNER || !shown() || isOpen()) return;
    if (/^(INPUT|TEXTAREA)$/.test((e.target.tagName || ''))) return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  const hasFiles = (e) => OWNER && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  view.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); view.classList.add('dragging'); } });
  view.addEventListener('dragleave', (e) => { if (!view.contains(e.relatedTarget)) view.classList.remove('dragging'); });
  view.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); view.classList.remove('dragging'); addFiles(e.dataTransfer.files); });

  /* ---------- backup ---------- */
  const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  $('guides-export-btn').addEventListener('click', async () => {
    if (!OWNER) return;
    if (!items.length) { say('Nothing to export yet.', true); return; }
    say('Preparing backup…');
    try {
      const out = [];
      for (const it of items) {
        const o = { id: it.id, title: it.title, category: it.category, notes: it.notes, link: it.link, links: it.links, keywords: it.keywords, added: it.added };
        if (it.url) o.url = it.url; else if (it.blob) o.image = await toDataUrl(it.blob); else o.noimg = true;
        if (it.icon) o.icon = it.icon;
        out.push(o);
      }
      const blob = new Blob([JSON.stringify({ app: 'tgs-guides', version: 1, items: out })], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tgs-guides-backup.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      say('Exported ' + out.length + ' item' + (out.length === 1 ? '' : 's') + '.');
    } catch (e) { say('Export failed: ' + (e && e.message || e), true); }
  });
  $('guides-import-btn').addEventListener('click', () => $('guides-import-file').click());
  $('guides-import-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file || !OWNER) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== 'tgs-guides' || !Array.isArray(data.items)) throw new Error('That is not a guides backup file.');
      say('Importing…'); askPersist(); let n = 0;
      for (const o of data.items) {
        if (!o || typeof o !== 'object') continue;
        const it = { id: String(o.id || newId()), title: String(o.title || 'Untitled').slice(0, 200), category: String(o.category || '').slice(0, 60),
                     notes: String(o.notes || '').slice(0, 5000), link: '', added: Number(o.added) || Date.now() };
        it.links = cleanLinks(Array.isArray(o.links) && o.links.length ? o.links : (o.link ? [{ url: o.link, label: '' }] : [])); it.link = it.links[0] ? it.links[0].url : ''; it.keywords = cleanKw(o.keywords); it.icon = KINDS[o.icon] ? o.icon : '';
        if (typeof o.url === 'string' && safeLink(o.url)) it.url = safeLink(o.url);
        else if (typeof o.image === 'string' && /^data:image\//.test(o.image)) {
          const blob = await (await fetch(o.image)).blob(); const im = await buildImage(blob, true);
          it.blob = im.blob; it.thumb = im.thumb; it.w = im.w; it.h = im.h;
        } else if (o.noimg === true && it.links.length) { it.noimg = true; } else continue;
        await dbPut(it); const i = items.findIndex((x) => x.id === it.id);
        if (i >= 0) { forget(it.id); items[i] = it; } else items.push(it); n++;
      }
      render(); say('Imported ' + n + ' item' + (n === 1 ? '' : 's') + '.');
    } catch (err) { say(err && err.message || 'Could not read that file.', true); }
  });

  /* ---------- published guides (read by everyone) ---------- */
  const okPath = (s) => typeof s === 'string' && /^images\/[A-Za-z0-9._-]+$/.test(s);
  async function fetchManifest() {
    const r = await fetch(PUB + 'guides.json', { cache: 'no-cache' });
    if (!r.ok) return [];
    const data = await r.json();
    if (!data || !Array.isArray(data.items)) return [];
    const out = [];
    data.items.forEach((o) => {
      if (!o || typeof o !== 'object') return;
      const it = { id: String(o.id || '').slice(0, 80), title: String(o.title || 'Untitled').slice(0, 200), category: String(o.category || '').slice(0, 60),
                   notes: String(o.notes || '').slice(0, 5000), link: '', added: Number(o.added) || 0 };
      if (!it.id) return;
      it.links = cleanLinks(Array.isArray(o.links) && o.links.length ? o.links : (o.link ? [{ url: o.link, label: '' }] : [])); it.link = it.links[0] ? it.links[0].url : ''; it.keywords = cleanKw(o.keywords); it.icon = KINDS[o.icon] ? o.icon : '';
      if (okPath(o.file)) { it.file = o.file; if (okPath(o.thumb)) it.thumb = o.thumb; }
      else if (safeLink(o.url)) it.url = safeLink(o.url);
      else if (o.noimg === true && it.links.length) it.noimg = true;
      else return;
      out.push(it);
    });
    return out;
  }
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp' };
  const TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' };
  const typeOfPath = (p) => TYPE[(String(p).split('.').pop() || '').toLowerCase()] || 'image/png';

  /* ---------- owner: package for publishing (zip, no compression) ---------- */
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(files) {
    const enc = new TextEncoder(), now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = []; let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    });
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }
  $('guides-pkg-btn').addEventListener('click', async () => {
    if (!OWNER) return;
    if (!items.length) { say('Nothing to export yet.', true); return; }
    say('Building the package…');
    try {
      const files = [], man = []; let skipped = 0, bytes = 0;
      for (const it of items) {
        const safe = String(it.id).replace(/[^A-Za-z0-9_-]/g, '_');
        const o = { id: it.id, title: it.title, category: it.category, notes: it.notes, link: it.link, links: it.links, keywords: it.keywords, added: it.added };
        if (it.icon) o.icon = it.icon;
        if (it.url) o.url = it.url;
        else if (!it.blob) o.noimg = true;
        else {
          const ext = EXT[it.blob && it.blob.type]; if (!ext) { skipped++; continue; }
          const f = 'images/' + safe + '.' + ext; o.file = f;
          files.push({ name: 'guides/' + f, data: new Uint8Array(await it.blob.arrayBuffer()) });
          if (it.thumb && it.thumb !== it.blob && EXT[it.thumb.type]) {
            const t = 'images/' + safe + '.thumb.' + EXT[it.thumb.type]; o.thumb = t;
            files.push({ name: 'guides/' + t, data: new Uint8Array(await it.thumb.arrayBuffer()) });
          }
        }
        man.push(o);
      }
      files.unshift({ name: 'guides/guides.json', data: new TextEncoder().encode(JSON.stringify({ version: 1, items: man }, null, 1)) });
      files.forEach((f) => { bytes += f.data.length; });
      const blob = makeZip(files);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tgs-guides-publish.zip';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      say('Package ready: ' + man.length + ' guide' + (man.length === 1 ? '' : 's') + ', ' + (bytes / 1048576).toFixed(1) + ' MB' + (skipped ? ' (' + skipped + ' skipped: unsupported image type)' : '') + '. Unzip it into your repo and commit.');
    } catch (e) { say('Could not build the package: ' + (e && e.message || e), true); }
  });

  /* ---------- owner: copy the published guides into the workspace ---------- */
  $('guides-load-btn').addEventListener('click', async () => {
    if (!OWNER) return;
    say('Loading the published guides…');
    try {
      const pub = await fetchManifest();
      if (!pub.length) { say('Nothing has been published yet.', true); return; }
      askPersist(); let n = 0, have = 0;
      for (const p of pub) {
        if (items.some((x) => x.id === p.id)) { have++; continue; }
        const it = { id: p.id, title: p.title, category: p.category, notes: p.notes, link: p.link, links: p.links, keywords: p.keywords, icon: KINDS[p.icon] ? p.icon : '', added: p.added || Date.now() };
        if (p.url) it.url = p.url;
        else if (p.noimg) it.noimg = true;
        else {
          const rb = await fetch(PUB + p.file); if (!rb.ok) continue;
          it.blob = new Blob([await rb.blob()], { type: typeOfPath(p.file) }); it.thumb = it.blob;
          if (p.thumb) { const rt = await fetch(PUB + p.thumb); if (rt.ok) it.thumb = new Blob([await rt.blob()], { type: typeOfPath(p.thumb) }); }
          else { const im = await buildImage(it.blob, true); it.thumb = im.thumb; it.w = im.w; it.h = im.h; }
        }
        await dbPut(it); items.push(it); n++;
      }
      render(); say('Loaded ' + n + ' guide' + (n === 1 ? '' : 's') + (have ? ' (' + have + ' already in your workspace)' : '') + '.');
    } catch (e) { say('Could not load the published guides: ' + (e && e.message || e), true); }
  });
  $('guides-owner-exit').addEventListener('click', (e) => { e.preventDefault(); if (window.TGSOwner) window.TGSOwner.set(false); });
  if (window.TGSOwner) window.TGSOwner.onChange((on) => {
    OWNER = on; applyOwnerUI(); closeViewer();
    Array.from(urlCache.keys()).forEach(forget); fcache.clear();
    items = []; loaded = false; fCat = ''; fQuery = ''; searchEl.value = ''; statusEl.textContent = ''; render();
    if (shown()) window.TGSGuides.show();
  });

  /* ---------- hook for the tab ---------- */
  window.TGSGuides = {
    show: async function () {
      if (!loaded) {
        try { items = (OWNER ? await dbAll() : await fetchManifest()).map(fixItem); loaded = true; fcache.clear(); }
        catch (e) { say(OWNER ? 'Saving images is not available in this browser (' + (e && e.message || e) + ').' : 'Could not load the guides right now. Please try again later.', true); }
      }
      render();
    }
  };
})();
