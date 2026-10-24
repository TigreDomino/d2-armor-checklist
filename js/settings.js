(function () {
  const KEY = 'destiny2-layout-v2';
  const GRID = 5;
  const MIN = { header: { w: 480, h: 70 }, sidebar: { w: 100, h: 60 } };
  const DEF_PAD_TOP = 168, DEF_PAD_LEFT = 160;
  // The default arrangement is the flowing header defined in the CSS, so there are no built-in offsets.
  const DEFAULT_LAYOUT = {};
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const defaultLayout = () => clone(DEFAULT_LAYOUT);
  let L = null, editing = false, act = null;
  try { const raw = JSON.parse(localStorage.getItem(KEY) || '{}'); if (raw && typeof raw === 'object' && Object.keys(raw).length) L = raw; } catch (e) { L = null; }
  if (L === null) L = defaultLayout();

  const nodes = () => document.querySelectorAll('[data-mv],[data-mvblock]');
  const idOf = (el) => el.dataset.mv || el.dataset.mvblock;
  const num = (v) => typeof v === 'number' && isFinite(v);
  const valid = (p) => p && num(p.x) && num(p.y);
  function paint(el) {
    const p = L[idOf(el)];
    el.style.transform = valid(p) && (p.x || p.y) ? 'translate(' + p.x + 'px,' + p.y + 'px)' : '';
    if (el.dataset.mvblock) {
      el.style.width = p && num(p.w) ? p.w + 'px' : '';
      el.style.height = p && num(p.h) ? p.h + 'px' : '';
    }
  }
  function padding() {
    const sd = L.sidebar;
    const left = Math.max(DEF_PAD_LEFT, sd && num(sd.w) ? sd.w + 20 : 0);
    document.body.style.paddingLeft = left > DEF_PAD_LEFT ? left + 'px' : '';
  }
  function paintAll() { nodes().forEach(paint); padding(); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) {} }

  function setEditing(v) {
    editing = v;
    document.body.classList.toggle('layout-editing', v);
    document.getElementById('layout-toggle').textContent = v ? 'Done' : 'Edit layout';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (!v) save();
  }
  document.getElementById('layout-toggle').addEventListener('click', () => setEditing(!editing));
  (function () {
    const sel = document.getElementById('theme-select');
    sel.value = document.documentElement.getAttribute('data-theme') || 'arc';
    sel.addEventListener('change', () => {
      document.documentElement.setAttribute('data-theme', sel.value);
      try { localStorage.setItem('tgs-theme', sel.value); } catch (e) {}
    });
  })();
  document.getElementById('owner-switch').addEventListener('change', (e) => { if (window.TGSOwner) window.TGSOwner.set(e.target.checked); });
  if (window.TGSOwner) window.TGSOwner.onChange((on) => { if (!on && editing) setEditing(false); });

  document.addEventListener('click', (e) => {
    if (editing && !e.target.closest('#layout-panel')) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (editing && !e.target.closest('#layout-panel')) e.preventDefault();
  }, true);

  document.addEventListener('pointerdown', (e) => {
    if (!editing || e.target.closest('#layout-panel')) return;
    const handle = e.target.closest('.lay-rz');
    const el = handle ? handle.closest('[data-mvblock]') : (e.target.closest('[data-mv]') || e.target.closest('[data-mvblock]'));
    if (!el) return;
    e.preventDefault();
    const k = idOf(el), o = valid(L[k]) ? L[k] : { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    act = { el, k, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, block: !!el.dataset.mvblock, resize: !!handle,
            ow: r.width, oh: r.height, left: r.left, top: r.top };
    el.classList.add('lay-dragging');
    try { (handle || el).setPointerCapture(e.pointerId); } catch (err) {}
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!act) return;
    const snap = (v) => Math.round(v / GRID) * GRID;
    if (act.resize) {
      const m = MIN[act.k] || { w: 60, h: 40 };
      const w = Math.max(m.w, Math.min(snap(act.ow + e.clientX - act.sx), window.innerWidth - act.left));
      const h = Math.max(m.h, Math.min(snap(act.oh + e.clientY - act.sy), window.innerHeight - act.top));
      L[act.k] = { x: act.ox, y: act.oy, w: Math.round(w), h: Math.round(h) };
      paint(act.el); padding();
      return;
    }
    let x = snap(act.ox + e.clientX - act.sx), y = snap(act.oy + e.clientY - act.sy);
    const keep = L[act.k] || {};
    L[act.k] = Object.assign({}, keep, { x, y }); paint(act.el);
    const r = act.el.getBoundingClientRect();
    let b;
    if (act.block) b = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    else { const parent = act.el.closest('[data-mvblock]'); b = parent ? parent.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }; }
    if (r.left < b.left) x += b.left - r.left;
    if (r.right > b.right) x -= r.right - b.right;
    if (r.top < b.top) y += b.top - r.top;
    if (r.bottom > b.bottom) y -= r.bottom - b.bottom;
    L[act.k] = Object.assign({}, keep, { x: Math.round(x), y: Math.round(y) }); paint(act.el);
  });
  function end() { if (act) { act.el.classList.remove('lay-dragging'); act = null; save(); } }
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);

  document.getElementById('layout-reset').addEventListener('click', () => {
    if (!confirm('Reset the layout to the default positions and sizes?')) return;
    L = defaultLayout(); paintAll(); save();
  });

  document.getElementById('layout-export').addEventListener('click', () => {
    const out = { version: 3, positions: L };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'd2-checklist-layout.json';
    document.getElementById('layout-panel').appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  const fileInput = document.getElementById('layout-file');
  document.getElementById('layout-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const parsed = JSON.parse(rd.result);
        const pos = parsed && parsed.positions;
        if (!pos || typeof pos !== 'object') throw new Error('bad');
        if (!(parsed.version >= 3)) { alert('That layout file is from an older version of the page and no longer fits. Export a new one.'); fileInput.value = ''; return; }
        const known = new Set(Array.from(nodes()).map(idOf)), next = {};
        Object.keys(pos).forEach((k) => {
          if (!known.has(k) || !valid(pos[k])) return;
          const q = { x: Math.round(pos[k].x), y: Math.round(pos[k].y) };
          if ((k === 'header' || k === 'sidebar') && num(pos[k].w) && num(pos[k].h)) { q.w = Math.round(pos[k].w); q.h = Math.round(pos[k].h); }
          next[k] = q;
        });
        L = next; paintAll(); save();
      } catch (err) { alert('That layout file is not valid.'); }
      fileInput.value = '';
    };
    rd.readAsText(f);
  });

  paintAll();
  if (window.TGSOwner) window.TGSOwner.refresh();
})();
