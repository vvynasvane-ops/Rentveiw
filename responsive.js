/* ═══════════════════════════════════════════════════════════════
   Rentveiw · responsive.js  (classic script — no dependencies)
   1. Labels every table cell from its column heading, so responsive.css can
      turn rows into readable cards on narrow screens (no renderer changes).
   2. Bottom tab bar for phones (drives the existing sidebar links).
   3. Drawer backdrop, Esc-to-close and edge-swipe gestures.
   Everything is defensive: if anything is missing it quietly does nothing.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* 1 ── table labels */
  function labelTables() {
    document.querySelectorAll('table:not(.slip-table)').forEach(function (t) {
      var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
      if (!heads.length) return;
      t.classList.add('rt');
      t.classList.toggle('rt-roomfirst', heads.indexOf('Room') > 0 && /^(Month|Date)$/.test(heads[0]));
      t.querySelectorAll('tbody tr').forEach(function (tr) {
        var cells = tr.children;
        if (cells.length === 1 && cells[0].colSpan > 1) { cells[0].classList.add('rt-empty'); return; }
        Array.prototype.forEach.call(cells, function (td, i) {
          if (td.tagName !== 'TD') return;
          td.setAttribute('data-label', heads[i] || '');
          if (!heads[i]) td.setAttribute('data-actions', ''); else td.removeAttribute('data-actions');
        });
      });
    });
  }
  var queued = false;
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; try { labelTables(); } catch (e) { console.warn('labelTables', e); } }); }

  /* 2 ── bottom tab bar */
  var ITEMS = [['dashboard', '📊', 'Home'], ['rooms', '🚪', 'Rooms'], ['billing', '🧾', 'Billing'], ['readings', '🔢', 'Readings']];
  function buildNav(shell) {
    if ($('#mnav')) return;
    var nav = document.createElement('nav'); nav.id = 'mnav'; nav.setAttribute('aria-label', 'Main navigation');
    nav.innerHTML = ITEMS.map(function (i) { return '<button type="button" data-go="' + i[0] + '"><span>' + i[1] + '</span>' + i[2] + '</button>'; }).join('') +
      '<button type="button" data-more aria-label="More pages"><span>☰</span>More</button>';
    shell.appendChild(nav);
    nav.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-more')) { toggleDrawer(); return; }
      var link = $('#sidebar [data-nav="' + b.getAttribute('data-go') + '"]');
      if (link) { link.click(); window.scrollTo(0, 0); }
    });
  }
  function currentPage() {
    var p = Array.prototype.find.call(document.querySelectorAll('.page'), function (el) { return el.style.display === 'block'; });
    return p ? p.id.replace('page-', '') : 'dashboard';
  }
  function syncNav() {
    var nav = $('#mnav'); if (!nav) return;
    var pg = currentPage(); if (pg === 'room-detail') pg = 'rooms';
    var known = ITEMS.some(function (i) { return i[0] === pg; });
    nav.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.hasAttribute('data-more') ? !known : b.getAttribute('data-go') === pg);
    });
  }

  /* 3 ── drawer */
  function drawer() { return $('#sidebar'); }
  function toggleDrawer(force) { var d = drawer(); if (d) d.classList.toggle('open', typeof force === 'boolean' ? force : !d.classList.contains('open')); }
  function buildBackdrop(shell) {
    if ($('#sb-backdrop')) return;
    var b = document.createElement('div'); b.id = 'sb-backdrop'; shell.appendChild(b);
    b.addEventListener('click', function () { toggleDrawer(false); });
    var d = drawer();
    if (d) new MutationObserver(function () { b.classList.toggle('show', d.classList.contains('open')); }).observe(d, { attributes: true, attributeFilter: ['class'] });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') toggleDrawer(false); });
  var sx = null, sy = null;
  document.addEventListener('touchstart', function (e) { var t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (sx === null || window.innerWidth > 768) return;
    var t = e.changedTouches[0], dx = t.clientX - sx, dy = Math.abs(t.clientY - sy), d = drawer(); if (!d) return;
    if (dy < 60) { if (sx < 24 && dx > 70) toggleDrawer(true); else if (d.classList.contains('open') && dx < -70) toggleDrawer(false); }
    sx = sy = null;
  }, { passive: true });

  function boot() {
    var shell = document.getElementById('appShell'); if (!shell) return;
    buildNav(shell); buildBackdrop(shell); labelTables(); syncNav();
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) for (var j = 0; j < list[i].addedNodes.length; j++) if (list[i].addedNodes[j].nodeType === 1) { schedule(); return; }
    }).observe(shell, { childList: true, subtree: true });
    var pc = $('.page-content');
    if (pc) new MutationObserver(syncNav).observe(pc, { attributes: true, subtree: true, attributeFilter: ['style'] });
    var nl = $('#sidebar .nav-list');
    if (nl) new MutationObserver(syncNav).observe(nl, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
