(function () {
  const KEY = 'tgs-owner', subs = [];
  let on = false, toastEl = null, toastT = null, clicks = [];
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('owner')) {
      localStorage.setItem(KEY, q.get('owner') === '0' ? '0' : '1');
      q.delete('owner');
      try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash); } catch (e) {}
    }
    on = localStorage.getItem(KEY) === '1';
  } catch (e) {}

  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'tgs-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }
  function refresh() {
    document.body.classList.toggle('owner-on', on);
    const panel = document.getElementById('layout-panel'); if (panel) panel.hidden = !on;
    const sw = document.getElementById('owner-switch'); if (sw) sw.checked = on;
  }
  function set(v, quiet) {
    v = !!v; if (v === on) { refresh(); return; }
    on = v; try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    refresh(); subs.forEach((f) => { try { f(on); } catch (e) {} });
    if (!quiet) toast(on ? 'Owner mode on' : 'Owner mode off');
  }
  window.TGSOwner = { get: () => on, set, refresh, onChange: (f) => subs.push(f) };

  // Hidden trigger: five quick clicks on the logo toggle owner mode.
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('.brand')) return;
    const now = Date.now(); clicks = clicks.filter((t) => now - t < 2500); clicks.push(now);
    if (clicks.length >= 5) { clicks = []; set(!on); }
  });
})();
