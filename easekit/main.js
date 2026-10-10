/* Easekit panel. */
(function () {
  'use strict';
  var $ = AE.$, $$ = AE.$$, esc = AE.esc, icon = AE.icon;

  var PRESETS = [
    ['Out Expo', [.16, 1, .3, 1]],
    ['In-out Strong', [.7, 0, .2, 1]],
    ['Settle', [.25, 1.35, .4, 1]],
    ['Snap', [.9, 0, .1, 1]],
    ['Drift', [.3, .1, .3, 1]],
    ['Out Quart', [.25, 1, .5, 1]],
    ['Out Cubic', [.33, 1, .68, 1]],
    ['In-out Cubic', [.65, 0, .35, 1]],
    ['In-out Expo', [.87, 0, .13, 1]],
    ['In Cubic', [.32, 0, .67, 0]],
    ['In Expo', [.7, 0, .84, 0]],
    ['Overshoot', [.34, 1.56, .64, 1]],
    ['Anticipate', [.36, 0, .66, -.56]],
    ['Standard', [.2, 0, 0, 1]],
    ['Decelerate', [.05, .7, .1, 1]],
    ['Easy Ease', [.333, 0, .667, 1]],
  ];

  /* Math --------------------------------------------------------------- */
  var bez = function (p1, p2, u) { return 3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u; };
  function easeAt(v, x) {
    var lo = 0, hi = 1, u = x;
    for (var i = 0; i < 22; i++) { u = (lo + hi) / 2; if (bez(v[0], v[2], u) < x) lo = u; else hi = u; }
    return bez(v[1], v[3], u);
  }
  var same = function (a, b) { return a && b && a.every(function (x, i) { return Math.abs(x - b[i]) < 1e-4; }); };
  function fmt(n) {
    var d = AE.settings.get('decimals');
    var s = String(+(+n).toFixed(d));
    return s.replace(/^(-?)0\./, '$1.');
  }
  var cssOf = function (v) { return 'cubic-bezier(' + v.map(fmt).join(', ') + ')'; };
  // Accepts "cubic-bezier(.16, 1, .3, 1)", "0.16 1 0.3 1", "[.16,1,.3,1]" and the like.
  function parseCurve(s) {
    var m = String(s).match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
    if (!m || m.length !== 4) return null;
    var v = m.map(Number);
    if (v.some(isNaN) || v[0] < 0 || v[0] > 1 || v[2] < 0 || v[2] > 1) return null;
    return v;
  }
  var miniPath = function (v, w, h, pad) {
    var lo = Math.min(0, v[1], v[3]), hi = Math.max(1, v[1], v[3]), X = function (x) { return (pad + x * (w - 2 * pad)).toFixed(1); };
    var Y = function (y) { return (h - pad - (y - lo) / (hi - lo) * (h - 2 * pad)).toFixed(1); };
    return 'M' + X(0) + ' ' + Y(0) + 'C' + X(v[0]) + ' ' + Y(v[1]) + ' ' + X(v[2]) + ' ' + Y(v[3]) + ' ' + X(1) + ' ' + Y(1);
  };

  /* State --------------------------------------------------------------- */
  var cur = [.16, 1, .3, 1], selId = null, lib = [], selCount = { keys: 0, comp: false };
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
  var defaultLib = function () { return PRESETS.map(function (p) { return { id: uid(), name: p[0], v: p[1].slice() }; }); };
  function saveLib() { AE.store('library', lib); }

  /* Graph --------------------------------------------------------------- */
  var svg = $('#g'), graph = $('#graph'), W = 0, H = 0, range = [-.15, 1.15], dragging = null;
  var PAD = { l: 18, r: 18, t: 18, b: 18 };
  var NS = 'http://www.w3.org/2000/svg';
  var X = function (x) { return PAD.l + x * (W - PAD.l - PAD.r); };
  var Y = function (y) { return H - PAD.b - (y - range[0]) / (range[1] - range[0]) * (H - PAD.t - PAD.b); };
  var invX = function (px) { return (px - PAD.l) / (W - PAD.l - PAD.r); };
  var invY = function (py) { return range[0] + (H - PAD.b - py) / (H - PAD.t - PAD.b) * (range[1] - range[0]); };
  function fitRange(v) {
    var lo = Math.min(0, v[1], v[3]), hi = Math.max(1, v[1], v[3]), pad = .14 * (hi - lo);
    range = [lo - pad, hi + pad];
  }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    (parent || svg).appendChild(e);
    return e;
  }

  var G = {};
  // The graph is a bit less tall than wide, but never takes more than ~40% of a short panel.
  function buildGraph() {
    var w = graph.clientWidth;
    graph.style.height = Math.round(Math.max(150, Math.min(w * .82, Math.max(150, window.innerHeight * .4)))) + 'px';
    var r = graph.getBoundingClientRect();
    W = Math.round(r.width); H = Math.round(r.height);
    if (!W || !H) return;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = '';
    G.grid = el('g', {});
    G.unit = el('rect', { 'class': 'g-unit' });
    G.diag = el('line', { 'class': 'g-diag' });
    G.arm1 = el('line', { 'class': 'g-arm' });
    G.arm2 = el('line', { 'class': 'g-arm' });
    G.curve = el('path', { 'class': 'g-curve' });
    G.e0 = el('rect', { 'class': 'g-end', width: 6, height: 6 });
    G.e1 = el('rect', { 'class': 'g-end', width: 6, height: 6 });
    G.dot = el('circle', { 'class': 'g-dot', r: 3.5, opacity: 0 });
    G.hit1 = el('circle', { 'class': 'g-hit', r: 14, 'data-h': '1' });
    G.k1 = el('circle', { 'class': 'g-knob', r: 5.5 });
    G.hit2 = el('circle', { 'class': 'g-hit', r: 14, 'data-h': '2' });
    G.k2 = el('circle', { 'class': 'g-knob', r: 5.5 });
    G.tip = el('g', { opacity: 0 });
    G.tipbg = el('rect', { 'class': 'g-tipbg', rx: 5, height: 18 }, G.tip);
    G.tipt = el('text', { 'class': 'g-tip', y: 12.5 }, G.tip);
    drawGraph();
  }
  function drawGrid() {
    var g = G.grid, html = '';
    for (var i = 1; i < 4; i++) {
      var x = X(i / 4).toFixed(1);
      html += '<line class="g-grid" x1="' + x + '" x2="' + x + '" y1="0" y2="' + H + '"/>';
    }
    var step = .25;
    for (var y = Math.ceil(range[0] / step) * step; y <= range[1] + 1e-9; y += step) {
      if (Math.abs(y) < 1e-9 || Math.abs(y - 1) < 1e-9) continue;
      var py = Y(y).toFixed(1);
      html += '<line class="g-grid" x1="0" x2="' + W + '" y1="' + py + '" y2="' + py + '"/>';
    }
    g.innerHTML = html;
    var u0 = Y(0), u1 = Y(1);
    G.unit.setAttribute('x', X(0)); G.unit.setAttribute('y', u1);
    G.unit.setAttribute('width', X(1) - X(0)); G.unit.setAttribute('height', u0 - u1);
  }
  function drawGraph() {
    if (!W) return;
    var v = cur;
    drawGrid();
    var x0 = X(0), y0 = Y(0), x1 = X(1), y1 = Y(1), a = X(v[0]), b = Y(v[1]), c = X(v[2]), d = Y(v[3]);
    G.diag.setAttribute('x1', x0); G.diag.setAttribute('y1', y0); G.diag.setAttribute('x2', x1); G.diag.setAttribute('y2', y1);
    G.curve.setAttribute('d', 'M' + x0 + ' ' + y0 + 'C' + a + ' ' + b + ' ' + c + ' ' + d + ' ' + x1 + ' ' + y1);
    G.arm1.setAttribute('x1', x0); G.arm1.setAttribute('y1', y0); G.arm1.setAttribute('x2', a); G.arm1.setAttribute('y2', b);
    G.arm2.setAttribute('x1', x1); G.arm2.setAttribute('y1', y1); G.arm2.setAttribute('x2', c); G.arm2.setAttribute('y2', d);
    G.e0.setAttribute('x', x0 - 3); G.e0.setAttribute('y', y0 - 3);
    G.e1.setAttribute('x', x1 - 3); G.e1.setAttribute('y', y1 - 3);
    [[G.k1, G.hit1, a, b], [G.k2, G.hit2, c, d]].forEach(function (k) {
      k[0].setAttribute('cx', k[2]); k[0].setAttribute('cy', k[3]); k[1].setAttribute('cx', k[2]); k[1].setAttribute('cy', k[3]);
    });
  }
  function showTip(h) {
    if (!h) { G.tip.setAttribute('opacity', 0); return; }
    var x = h === 1 ? cur[0] : cur[2], y = h === 1 ? cur[1] : cur[3];
    G.tipt.textContent = fmt(x) + ', ' + fmt(y);
    var w = G.tipt.getComputedTextLength() + 14, px = X(x), py = Y(y) - 30;
    px = Math.max(4, Math.min(W - w - 4, px - w / 2));
    if (py < 4) py = Y(y) + 14;
    G.tip.setAttribute('transform', 'translate(' + px.toFixed(1) + ' ' + py.toFixed(1) + ')');
    G.tipbg.setAttribute('width', w); G.tipt.setAttribute('x', 7);
    G.tip.setAttribute('opacity', 1);
  }

  svg.addEventListener('pointerdown', function (e) {
    var h = e.target.getAttribute && e.target.getAttribute('data-h');
    if (!h) {
      // Clicking empty graph space grabs the nearest handle.
      var r = svg.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      var d1 = Math.hypot(px - X(cur[0]), py - Y(cur[1])), d2 = Math.hypot(px - X(cur[2]), py - Y(cur[3]));
      h = d1 <= d2 ? '1' : '2';
    }
    dragging = +h;
    svg.setPointerCapture(e.pointerId);
    graph.classList.add('dragging');
    (dragging === 1 ? G.k1 : G.k2).classList.add('active');
    moveHandle(e);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', function (e) { if (dragging) moveHandle(e); });
  var endDrag = function () {
    if (!dragging) return;
    G.k1.classList.remove('active'); G.k2.classList.remove('active');
    dragging = null;
    graph.classList.remove('dragging');
    showTip(0);
    fitRange(cur); drawGraph();
    commit();
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('dblclick', function (e) {
    var h = e.target.getAttribute && e.target.getAttribute('data-h');
    if (!h) return;
    var v = cur.slice();
    if (h === '1') { v[0] = 1 / 3; v[1] = 1 / 3; } else { v[2] = 2 / 3; v[3] = 2 / 3; }
    setCurve(v, true);
  });

  function moveHandle(e) {
    var r = svg.getBoundingClientRect();
    var x = invX(e.clientX - r.left), y = invY(e.clientY - r.top);
    var step = +AE.settings.get('snap') || 0;
    if (e.shiftKey) step = step ? 0 : .05;
    if (step) { x = Math.round(x / step) * step; y = Math.round(y / step) * step; }
    x = Math.max(0, Math.min(1, x));
    if (!AE.settings.get('overshoot')) y = Math.max(0, Math.min(1, y));
    else y = Math.max(-2, Math.min(3, y));
    var i = dragging === 1 ? 0 : 2;
    cur[i] = +x.toFixed(3); cur[i + 1] = +y.toFixed(3);
    drawGraph(); showTip(dragging); syncReadout(); markSelection(); paintDots(); touched();
  }

  /* Readout + motion strip --------------------------------------------- */
  var css = $('#css'), cssField = $('#css-field');
  // The full cubic-bezier(…) when it fits, bare values in a narrow dock. Both parse back the same.
  function syncReadout() {
    if (document.activeElement === css) return;
    css.value = css.clientWidth >= 196 ? cssOf(cur) : cur.map(fmt).join(', ');
    cssField.classList.remove('bad');
  }
  css.addEventListener('input', function () {
    var v = parseCurve(css.value);
    cssField.classList.toggle('bad', !v);
    if (v) { cur = v; fitRange(cur); drawGraph(); markSelection(); paintDots(); touched(); }
  });
  css.addEventListener('blur', function () { syncReadout(); commit(); });
  css.addEventListener('keydown', function (e) { if (e.key === 'Enter') css.blur(); });

  function copyText(s) {
    var t = document.createElement('textarea');
    t.value = s; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    t.remove();
    AE.toast(ok ? 'Copied ' + s : 'Couldn’t copy', ok ? '' : 'error');
  }
  $('#copy').innerHTML = icon.copy;
  $('#copy').addEventListener('click', function (e) {
    var r = e.currentTarget.getBoundingClientRect();
    AE.menu(r.left - 110, r.bottom + 4, [
      { label: 'Copy as cubic-bezier', run: function () { copyText(cssOf(cur)); } },
      { label: 'Copy values', run: function () { copyText(cur.map(fmt).join(', ')); } },
      { label: 'Copy as JSON', run: function () { copyText(JSON.stringify(cur)); } },
    ]);
  });

  // Motion strip. Curves that overshoot travel past 1 (or before 0), so the strip spans the curve's whole
  // range; the two ticks mark where the move starts and ends.
  var box = $('#box'), dots = $('#dots'), span = $('#span'), tick0 = $('#tick0'), tick1 = $('#tick1');
  var railLo = 0, railHi = 1, animT0 = 0, raf = 0, hovering = false, lastChange = 0;
  var pos = function (v) { return Math.max(0, Math.min(100, (v - railLo) / (railHi - railLo) * 100)); };
  function paintDots() {
    railLo = 0; railHi = 1;
    for (var i = 1; i < 200; i++) { var y = easeAt(cur, i / 200); railLo = Math.min(railLo, y); railHi = Math.max(railHi, y); }
    var n = 13, html = '';
    for (i = 0; i < n; i++) html += '<i style="left:' + pos(easeAt(cur, i / (n - 1))).toFixed(2) + '%"></i>';
    dots.innerHTML = html;
    tick0.style.left = pos(0).toFixed(2) + '%';
    tick1.style.left = pos(1).toFixed(2) + '%';
    span.style.left = pos(0).toFixed(2) + '%';
    span.style.width = (pos(1) - pos(0)).toFixed(2) + '%';
    if (!raf) box.style.left = pos(1).toFixed(2) + '%';
  }
  // The box plays while the pointer is over the panel and for a few seconds after the curve changes,
  // then rests at the end, so an idle panel costs nothing.
  function tick(now) {
    raf = 0;
    var live = AE.settings.get('animate') && !document.hidden && (hovering || Date.now() - lastChange < 4000);
    if (!live) { animT0 = 0; box.style.left = pos(1).toFixed(2) + '%'; if (G.dot) G.dot.setAttribute('opacity', 0); return; }
    if (!animT0) animT0 = now;
    var T = 1100, P = 500, t = (now - animT0) % (2 * (T + P)), x;
    if (t < T) x = easeAt(cur, t / T);
    else if (t < T + P) x = 1;
    // The way back plays the same motion in reverse (not mirrored), so it covers exactly the range the
    // strip was sized for: a mirrored overshoot would undershoot the start and leave the strip.
    else if (t < 2 * T + P) x = easeAt(cur, 1 - (t - T - P) / T);
    else x = 0;
    box.style.left = pos(x).toFixed(2) + '%';
    var inGraph = t < T ? t / T : -1;
    if (inGraph >= 0 && G.dot) { G.dot.setAttribute('opacity', .9); G.dot.setAttribute('cx', X(inGraph)); G.dot.setAttribute('cy', Y(easeAt(cur, inGraph))); }
    else if (G.dot) G.dot.setAttribute('opacity', 0);
    raf = requestAnimationFrame(tick);
  }
  function startAnim() { if (!raf) raf = requestAnimationFrame(tick); }
  function touched() { lastChange = Date.now(); startAnim(); }
  document.addEventListener('visibilitychange', startAnim);

  /* Curve changes ------------------------------------------------------- */
  function setCurve(v, save) {
    cur = v.slice();
    fitRange(cur); drawGraph(); syncReadout(); markSelection(); paintDots(); touched();
    if (save) commit();
  }
  function commit() { AE.store('curve', cur); }
  function markSelection() {
    var hit = lib.filter(function (it) { return same(it.v, cur); })[0];
    selId = hit ? hit.id : null;
    $$('#lib .item').forEach(function (li) { var on = li.getAttribute('data-id') === selId; li.classList.toggle('sel', on); li.setAttribute('aria-selected', String(on)); });
  }

  $('#read').innerHTML = icon.eyedrop;
  $('#mirror').innerHTML = icon.swap;
  $('#reset').innerHTML = icon.refresh;
  $('#mirror').addEventListener('click', function () { setCurve([1 - cur[2], 1 - cur[3], 1 - cur[0], 1 - cur[1]].map(function (n) { return +n.toFixed(3); }), true); });
  $('#reset').addEventListener('click', function () { setCurve([1 / 3, 1 / 3, 2 / 3, 2 / 3].map(function (n) { return +n.toFixed(3); }), true); });
  $('#read').addEventListener('click', function () {
    AE.call('aelibsEasekit.read').then(function (r) {
      setCurve(r.v, true);
      AE.toast('Read from ' + r.prop);
    }, function (e) { AE.toast(e.message, 'error'); });
  });

  /* Library ------------------------------------------------------------- */
  var list = $('#lib'), filter = $('#filter');
  function renderLib() {
    var q = filter.value.trim().toLowerCase();
    $('#lib-n').textContent = lib.length;
    $('#filter-wrap').classList.toggle('hidden', lib.length < 10 && !q);
    var items = lib.filter(function (it) { return !q || it.name.toLowerCase().indexOf(q) >= 0; });
    list.innerHTML = items.length ? items.map(function (it) {
      return '<li class="item" draggable="true" role="option" data-id="' + it.id + '" title="' + esc(cssOf(it.v)) + '">'
        + '<svg class="mini" viewBox="0 0 30 22"><path d="' + miniPath(it.v, 30, 22, 4) + '"/></svg>'
        + '<span class="name">' + esc(it.name) + '</span>'
        + '<span class="meta">' + it.v.map(fmt).join(' ') + '</span>'
        + '<span class="acts"><button class="apply-one" type="button" data-act="apply">Apply</button>'
        + '<button class="iconbtn iconbtn--sm" type="button" data-act="more" aria-label="More">' + icon.more + '</button></span></li>';
    }).join('') : '<li class="empty">' + (q ? 'No curves match “' + esc(q) + '”.' : 'No saved curves. Shape one above and press +.') + '</li>';
    document.body.classList.toggle('hide-vals', !AE.settings.get('showValues'));
    markSelection();
  }
  var byId = function (id) { return lib.filter(function (it) { return it.id === id; })[0]; };

  list.addEventListener('click', function (e) {
    var li = e.target.closest('.item'); if (!li || li.querySelector('input.rename')) return;
    var it = byId(li.getAttribute('data-id')), act = e.target.closest('[data-act]');
    if (act && act.getAttribute('data-act') === 'apply') { setCurve(it.v, true); apply(); return; }
    if (act && act.getAttribute('data-act') === 'more') { var r = act.getBoundingClientRect(); itemMenu(it, r.left - 130, r.bottom + 2); return; }
    setCurve(it.v, true);
  });
  list.addEventListener('dblclick', function (e) {
    var li = e.target.closest('.item'); if (!li || e.target.closest('[data-act]') || li.querySelector('input.rename')) return;
    if (AE.settings.get('dblApply')) apply(); else startRename(byId(li.getAttribute('data-id')));
  });
  list.addEventListener('contextmenu', function (e) {
    var li = e.target.closest('.item'); if (!li) return;
    e.preventDefault();
    itemMenu(byId(li.getAttribute('data-id')), e.clientX, e.clientY);
  });
  function itemMenu(it, x, y) {
    AE.menu(x, y, [
      { label: 'Apply', kb: 'Both', run: function () { setCurve(it.v, true); apply('both'); } },
      { label: 'Apply to outgoing only', run: function () { setCurve(it.v, true); apply('out'); } },
      { label: 'Apply to incoming only', run: function () { setCurve(it.v, true); apply('in'); } },
      '-',
      { label: 'Rename', run: function () { startRename(it); } },
      { label: 'Replace with current curve', run: function () { it.v = cur.slice(); saveLib(); renderLib(); AE.toast('Updated ' + it.name); } },
      { label: 'Duplicate', run: function () { var c = { id: uid(), name: it.name + ' copy', v: it.v.slice() }; lib.splice(lib.indexOf(it) + 1, 0, c); saveLib(); renderLib(); } },
      { label: 'Copy as cubic-bezier', run: function () { copyText(cssOf(it.v)); } },
      '-',
      { label: 'Delete', danger: true, run: function () { remove(it); } },
    ]);
  }
  function remove(it) {
    var i = lib.indexOf(it);
    lib.splice(i, 1); saveLib(); renderLib();
    AE.toast('Deleted ' + it.name + ' · Undo', '', function () { lib.splice(i, 0, it); saveLib(); renderLib(); });
  }
  function startRename(it) {
    var li = list.querySelector('[data-id="' + it.id + '"]'); if (!li) return;
    var name = li.querySelector('.name'), input = document.createElement('input');
    input.className = 'rename'; input.value = it.name; input.spellcheck = false;
    name.replaceWith(input);
    li.draggable = false;
    input.focus(); input.select();
    var done = function (keep) {
      if (!input.parentNode) return;
      var v = input.value.trim();
      if (keep && v) { it.name = v; saveLib(); }
      renderLib();
    };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
    input.addEventListener('blur', function () { done(true); });
  }
  list.addEventListener('keydown', function (e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selId && e.target === list) remove(byId(selId));
  });

  // Drag to reorder.
  var dragId = null;
  list.addEventListener('dragstart', function (e) {
    var li = e.target.closest('.item'); if (!li) return;
    dragId = li.getAttribute('data-id'); li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch (er) {}
  });
  list.addEventListener('dragover', function (e) {
    if (!dragId) return;
    e.preventDefault();
    $$('.drag-over', list).forEach(function (x) { x.classList.remove('drag-over'); });
    var li = e.target.closest('.item'); if (li && li.getAttribute('data-id') !== dragId) li.classList.add('drag-over');
  });
  list.addEventListener('drop', function (e) {
    e.preventDefault();
    var li = e.target.closest('.item'); if (!li || !dragId) return;
    var from = lib.indexOf(byId(dragId)), it = lib.splice(from, 1)[0], to = lib.indexOf(byId(li.getAttribute('data-id')));
    lib.splice(to, 0, it); saveLib(); renderLib();
  });
  list.addEventListener('dragend', function () { dragId = null; renderLib(); });

  filter.addEventListener('input', renderLib);

  $('#save').innerHTML = icon.plus;
  $('#save').addEventListener('click', function () {
    var hit = lib.filter(function (it) { return same(it.v, cur); })[0];
    if (hit) { AE.toast('Already saved as ' + hit.name); return; }
    var n = 1;
    while (lib.some(function (it) { return it.name === 'Curve ' + n; })) n++;
    var it = { id: uid(), name: 'Curve ' + n, v: cur.slice() };
    lib.unshift(it); saveLib(); filter.value = ''; renderLib();
    var body = $('#body');
    body.scrollTop += $('.lib').getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    startRename(it);
  });

  $('#lib-more').innerHTML = icon.more;
  $('#lib-more').addEventListener('click', function (e) {
    var r = e.currentTarget.getBoundingClientRect();
    AE.menu(r.left - 150, r.bottom + 4, [
      { label: 'Import…', run: importLib },
      { label: 'Export…', run: exportLib },
      '-',
      { label: 'Sort by name', run: function () { lib.sort(function (a, b) { return a.name.localeCompare(b.name); }); saveLib(); renderLib(); } },
      { label: 'Restore built-in curves', run: function () {
        var added = 0;
        defaultLib().forEach(function (p) { if (!lib.some(function (it) { return same(it.v, p.v); })) { lib.push(p); added++; } });
        saveLib(); renderLib(); AE.toast(added ? 'Added ' + added + ' curves' : 'All built-in curves are already there');
      } },
      { label: 'Clear library', danger: true, run: function () {
        var old = lib.slice(); lib = []; saveLib(); renderLib();
        AE.toast('Library cleared · Undo', '', function () { lib = old; saveLib(); renderLib(); });
      } },
    ]);
  });

  /* Import / export ----------------------------------------------------- */
  var fs = null;
  try { fs = (window.cep_node && window.cep_node.require ? window.cep_node.require : window.require)('fs'); } catch (e) {}
  function libFile() { return JSON.stringify({ aelibs: 'easekit-library', version: 1, items: lib.map(function (it) { return { name: it.name, v: it.v }; }) }, null, 2); }
  function ingest(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { AE.toast('That file isn’t valid JSON', 'error'); return; }
    var items = Array.isArray(data) ? data : data && data.items;
    if (!Array.isArray(items)) { AE.toast('No curves found in that file', 'error'); return; }
    var added = 0;
    items.forEach(function (x) {
      var v = x && (Array.isArray(x.v) ? parseCurve(x.v.join(' ')) : parseCurve(x.bezier || x.value || x.curve || ''));
      if (!v) return;
      if (lib.some(function (it) { return same(it.v, v); })) return;
      lib.push({ id: uid(), name: String(x.name || 'Imported').slice(0, 60), v: v }); added++;
    });
    saveLib(); renderLib();
    AE.toast(added ? 'Imported ' + added + ' curve' + (added === 1 ? '' : 's') : 'Nothing new to import');
  }
  function importLib() {
    if (window.cep && window.cep.fs && fs) {
      var r = window.cep.fs.showOpenDialogEx(false, false, 'Import Easekit library', '', ['json']);
      if (r && r.data && r.data[0]) { try { ingest(fs.readFileSync(r.data[0], 'utf8')); } catch (e) { AE.toast('Couldn’t read that file', 'error'); } }
      return;
    }
    $('#file-in').click();
  }
  $('#file-in').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    var rd = new FileReader(); rd.onload = function () { ingest(rd.result); }; rd.readAsText(f);
    e.target.value = '';
  });
  function exportLib() {
    if (window.cep && window.cep.fs && fs) {
      var r = window.cep.fs.showSaveDialogEx('Export Easekit library', '', ['json'], 'easekit-library.json');
      if (r && r.data) {
        var p = /\.json$/i.test(r.data) ? r.data : r.data + '.json';
        try { fs.writeFileSync(p, libFile()); AE.toast('Exported ' + lib.length + ' curves'); } catch (e) { AE.toast('Couldn’t write that file', 'error'); }
      }
      return;
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([libFile()], { type: 'application/json' }));
    a.download = 'easekit-library.json'; a.click();
  }

  /* Apply --------------------------------------------------------------- */
  var applyBtn = $('#apply'), side = 'both', sideSeg;
  // Narrow docks only fit "Apply 4"; wider ones spell it out.
  function paintApply() {
    var n = selCount.keys, wide = applyBtn.clientWidth > 170;
    if (AE.inHost && !n) applyBtn.textContent = selCount.comp ? (wide ? 'Select keyframes' : 'Select keys') : (wide ? 'Open a composition' : 'Open a comp');
    else if (!n) applyBtn.textContent = 'Apply';
    else applyBtn.innerHTML = wide ? 'Apply to ' + n + ' keyframe' + (n === 1 ? '' : 's') : 'Apply<span class="count">' + n + '</span>';
    applyBtn.title = n ? 'Apply to ' + n + ' selected keyframe' + (n === 1 ? '' : 's') + ' (Enter)' : '';
    applyBtn.classList.toggle('is-disabled', AE.inHost && !n);
  }
  function apply(which) {
    var s = which || side;
    applyBtn.classList.add('is-disabled');
    AE.call('aelibsEasekit.apply', { v: cur, side: s }).then(function (r) {
      var msg = 'Eased ' + r.keys + ' keyframe' + (r.keys === 1 ? '' : 's') + (r.props > 1 ? ' on ' + r.props + ' properties' : '');
      if (r.clamped) msg += ' · overshoot below 0 isn’t possible on motion paths';
      AE.toast(msg);
    }, function (e) { AE.toast(e.message, 'error'); }).then(function () { applyBtn.classList.remove('is-disabled'); poll(); });
  }
  applyBtn.addEventListener('click', function () { apply(); });

  // Selection count, so the button can say what it will do. It's only asked for while the pointer is over
  // the panel, which is when you're about to press Apply: asking After Effects all the time, in the
  // background, could interrupt previews.
  var polling = false, ready = false;
  function poll() {
    if (polling || !ready || document.hidden || !AE.inHost) return;
    polling = true;
    AE.call('aelibsEasekit.count').then(function (r) { selCount = r || selCount; }, function () {}).then(function () { polling = false; paintApply(); });
  }
  document.addEventListener('mousemove', function () { if (!hovering) { hovering = true; poll(); startAnim(); } });
  document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) hovering = false; });
  window.addEventListener('focus', poll);
  setInterval(function () { if (hovering) poll(); }, 700);

  document.addEventListener('keydown', function (e) {
    // Inputs handle their own keys, and a focused button already turns Enter into a click.
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || document.querySelector('.sheet.open')) return;
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') copyText(cssOf(cur));
  });

  /* Settings ------------------------------------------------------------ */
  function pluginSettings(box, s) {
    box.innerHTML = '<div class="sec__hd"><span class="lbl">Easekit</span></div><div class="rows">'
      + '<span class="lbl">Snap</span><div class="seg" id="ek-snap"><button type="button" data-v="0">Off</button><button type="button" data-v="0.05">.05</button><button type="button" data-v="0.1">.1</button><button type="button" data-v="0.25">.25</button></div>'
      + '<span class="lbl">Decimals</span><div class="seg" id="ek-dec"><button type="button" data-v="2">2</button><button type="button" data-v="3">3</button></div>'
      + '<span class="lbl">Default side</span><div class="seg" id="ek-side"><button type="button" data-v="both">Both</button><button type="button" data-v="out">Out</button><button type="button" data-v="in">In</button></div>'
      + '</div><div style="margin-top:12px">'
      + '<label class="check" style="margin-bottom:8px"><span class="switch"><input type="checkbox" id="ek-over"><span></span></span>Allow overshoot above 1 and below 0</label>'
      + '<label class="check" style="margin-bottom:8px"><span class="switch"><input type="checkbox" id="ek-anim"><span></span></span>Animate the preview</label>'
      + '<label class="check" style="margin-bottom:8px"><span class="switch"><input type="checkbox" id="ek-vals"><span></span></span>Show values in the library</label>'
      + '<label class="check"><span class="switch"><input type="checkbox" id="ek-dbl"><span></span></span>Double-click a saved curve to apply it</label>'
      + '</div><p class="note" style="margin:12px 0 0">Hold <kbd>Shift</kbd> while dragging to flip snapping. Double-click a handle to reset it. <kbd>Enter</kbd> applies.</p>';
    var segs = {
      snap: AE.seg($('#ek-snap', box), String(s.get('snap')), function (v) { s.set('snap', +v); }),
      decimals: AE.seg($('#ek-dec', box), String(s.get('decimals')), function (v) { s.set('decimals', +v); syncReadout(); renderLib(); }),
      side: AE.seg($('#ek-side', box), s.get('side'), function (v) { s.set('side', v); side = v; sideSeg.set(v); }),
    };
    var bind = function (id, key, after) {
      var c = $(id, box);
      c.addEventListener('change', function () { s.set(key, c.checked); if (after) after(); });
      return function () { c.checked = !!s.get(key); };
    };
    var syncs = [
      bind('#ek-over', 'overshoot', function () { if (!s.get('overshoot')) setCurve(cur.map(function (n, i) { return i % 2 ? Math.max(0, Math.min(1, n)) : n; }), true); }),
      bind('#ek-anim', 'animate', touched),
      bind('#ek-vals', 'showValues', renderLib),
      bind('#ek-dbl', 'dblApply'),
    ];
    AE.on('settings-open', function () {
      syncs.forEach(function (f) { f(); });
      segs.snap.set(String(s.get('snap'))); segs.decimals.set(String(s.get('decimals'))); segs.side.set(s.get('side'));
    });
  }

  /* Boot ---------------------------------------------------------------- */
  AE.mock['aelibsEasekit.count'] = function () { return { comp: true, keys: 6, props: 2 }; };
  AE.mock['aelibsEasekit.apply'] = function () { return { keys: 6, props: 2, clamped: 0 }; };
  AE.mock['aelibsEasekit.read'] = function () { return { v: [.25, .1, .25, 1], prop: 'Position' }; };

  var booted = AE.init({
    slug: 'easekit', name: 'Easekit', version: '__VERSION__', bundleId: 'com.aelibs.easekit', accent: '#8b74ff',
    defaults: { snap: 0, decimals: 2, side: 'both', overshoot: true, animate: true, showValues: true, dblApply: true },
    settings: pluginSettings,
  });

  lib = AE.store('library');
  if (!Array.isArray(lib)) { lib = defaultLib(); saveLib(); }
  var saved = AE.store('curve');
  if (Array.isArray(saved) && saved.length === 4) cur = saved;
  side = AE.settings.get('side');
  sideSeg = AE.seg($('#side'), side, function (v) { side = v; });
  AE.on('reset', function () { side = AE.settings.get('side'); sideSeg.set(side); renderLib(); syncReadout(); });

  fitRange(cur);
  buildGraph();
  syncReadout(); paintDots(); renderLib(); paintApply(); touched();
  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { buildGraph(); syncReadout(); paintApply(); }, 30); });
  AE.on('theme', function () { if (W) drawGraph(); });
  booted.then(function () { ready = true; poll(); }, function () { ready = true; });
})();
