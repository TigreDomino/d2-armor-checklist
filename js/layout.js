(function () {
  const h = document.querySelector('.sticky-header'), m = document.querySelector('.side-menu');
  function sync() { m.style.top = h.offsetHeight + 'px'; document.body.style.paddingTop = (h.offsetHeight + 14) + 'px'; }
  sync(); window.addEventListener('resize', sync); window.addEventListener('load', sync);
  if (window.ResizeObserver) new ResizeObserver(sync).observe(h);
})();
