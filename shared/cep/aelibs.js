/* aelibs panel runtime. Shared by every CEP panel.
   - host bridge (evalScript as promises, JSON in and out)
   - theme: follows the After Effects panel color, or a fixed dark/light set, plus an accent color
   - settings stored per panel
   - header with the update pill and the settings sheet
   - updater UI on top of updater.js
   Targets CEF 61 (After Effects 2020): ES2017 at most, no optional chaining or nullish coalescing. */
(function (global) {
  'use strict';

  var cep = global.__adobe_cep__ || null;
  var nodeRequire = global.cep_node && global.cep_node.require ? global.cep_node.require : (typeof global.require === 'function' ? global.require : null);
  var doc = document, root = doc.documentElement;

  var AE = global.AE = { inHost: !!cep, mock: {} };
  var $ = AE.$ = function (s, el) { return (el || doc).querySelector(s); };
  var $$ = AE.$$ = function (s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); };
  var esc = AE.esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  /* Brand -------------------------------------------------------------- */
  AE.BRAND = [
    { id: 'stagger', name: 'Stagger', hex: '#ff6a4d' },
    { id: 'easekit', name: 'Easekit', hex: '#8b74ff' },
    { id: 'rename', name: 'Rename', hex: '#2bc3b0' },
    { id: 'loops', name: 'Loops', hex: '#f2c230' },
    { id: 'tune', name: 'Tune', hex: '#a6e22e' },
    { id: 'blue', name: 'Blue', hex: '#5468ff' },
  ];
  AE.ORG = 'aelibraries';

  /* Icons (16 × 16, stroke 1.5) ---------------------------------------- */
  var I = function (d, extra) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>'; };
  AE.icon = {
    gear: I('<circle cx="8" cy="8" r="2.1"/><path d="M8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6L3.5 3.5"/>'),
    close: I('<path d="M4 4l8 8M12 4l-8 8"/>'),
    back: I('<path d="M10 3.5L5.5 8l4.5 4.5"/>'),
    plus: I('<path d="M8 3v10M3 8h10"/>'),
    trash: I('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>'),
    copy: I('<rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5"/><path d="M10.5 3.5v-.5A1 1 0 009.5 2H4a1 1 0 00-1 1v5.5a1 1 0 001 1h.5"/>'),
    play: I('<path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none"/>'),
    pause: I('<path d="M5 3.5v9M11 3.5v9" stroke-width="2"/>'),
    dice: I('<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><circle cx="5.6" cy="5.6" r=".9" fill="currentColor" stroke="none"/><circle cx="10.4" cy="10.4" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none"/>'),
    arrowDown: I('<path d="M8 2.5v9M4 8l4 4 4-4M3 14h10"/>'),
    refresh: I('<path d="M13 8a5 5 0 11-1.5-3.6M13 2.5v3h-3"/>'),
    more: I('<circle cx="3.5" cy="8" r=".6" fill="currentColor"/><circle cx="8" cy="8" r=".6" fill="currentColor"/><circle cx="12.5" cy="8" r=".6" fill="currentColor"/>'),
    eyedrop: I('<path d="M10.5 2.8l2.7 2.7-1.4 1.4-2.7-2.7zM9.8 5.5l-6 6-.6 2.3 2.3-.6 6-6"/>'),
    swap: I('<path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13"/>'),
    check: I('<path d="M3.5 8.5l3 3 6-7"/>'),
    external: I('<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v3a1 1 0 01-1 1h-7a1 1 0 01-1-1v-7a1 1 0 011-1h3"/>'),
    import: I('<path d="M8 2.5v7.5M5 7l3 3 3-3M2.5 11v1.5a1 1 0 001 1h9a1 1 0 001-1V11"/>'),
    export: I('<path d="M8 10V2.5M5 5.5l3-3 3 3M2.5 11v1.5a1 1 0 001 1h9a1 1 0 001-1V11"/>'),
    grip: I('<circle cx="6" cy="4" r=".5" fill="currentColor"/><circle cx="10" cy="4" r=".5" fill="currentColor"/><circle cx="6" cy="8" r=".5" fill="currentColor"/><circle cx="10" cy="8" r=".5" fill="currentColor"/><circle cx="6" cy="12" r=".5" fill="currentColor"/><circle cx="10" cy="12" r=".5" fill="currentColor"/>'),
  };

  /* Color math ---------------------------------------------------------- */
  function hexToRgb(h) {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    var n = parseInt(h, 16);
    return isNaN(n) || h.length !== 6 ? null : [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgbToHex(c) { return '#' + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function mix(a, b, t) { return [0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * t; }); }
  function lum(c) {
    var l = c.map(function (v) { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
    return .2126 * l[0] + .7152 * l[1] + .0722 * l[2];
  }
  function rgba(c, a) { return 'rgba(' + c.map(Math.round).join(',') + ',' + a + ')'; }
  AE.color = { hexToRgb: hexToRgb, rgbToHex: rgbToHex, mix: mix, lum: lum };

  var W = [255, 255, 255], K = [0, 0, 0];
  // Builds the token set from a background color. Dark backgrounds get the site's dark palette tuned to
  // that exact gray; light ones get the light palette.
  function tokensFor(bg, accentHex) {
    var dark = lum(bg) < .3, a = hexToRgb(accentHex) || [139, 116, 255], t = {};
    if (dark) {
      t['--bg'] = rgbToHex(bg);
      t['--s1'] = rgbToHex(mix(bg, W, .055));
      t['--s2'] = rgbToHex(mix(bg, K, .28));
      t['--s3'] = rgbToHex(mix(bg, W, .11));
      t['--fg'] = '#f1f2f5';
      t['--fg-2'] = rgbToHex(mix(bg, [241, 242, 245], .68));
      t['--fg-3'] = rgbToHex(mix(bg, [241, 242, 245], .42));
      t['--line'] = 'rgba(255,255,255,.075)';
      t['--line-2'] = 'rgba(255,255,255,.16)';
      t['--shadow'] = '0 1px 2px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.06)';
      t['--pop'] = '0 24px 60px -20px rgba(0,0,0,.75),0 0 0 1px rgba(255,255,255,.09)';
      t['--c-soft'] = rgba(a, .16);
    } else {
      t['--bg'] = rgbToHex(bg);
      t['--s1'] = rgbToHex(mix(bg, W, .7));
      t['--s2'] = rgbToHex(mix(bg, [12, 16, 48], .045));
      t['--s3'] = rgbToHex(mix(bg, [12, 16, 48], .09));
      t['--fg'] = '#0a0a0c';
      t['--fg-2'] = rgbToHex(mix(bg, [10, 10, 12], .72));
      t['--fg-3'] = rgbToHex(mix(bg, [10, 10, 12], .48));
      t['--line'] = 'rgba(12,16,48,.09)';
      t['--line-2'] = 'rgba(12,16,48,.18)';
      t['--shadow'] = '0 1px 3px rgba(12,16,48,.12),0 0 0 1px rgba(12,16,48,.08)';
      t['--pop'] = '0 24px 60px -24px rgba(36,48,150,.35),0 0 0 1px rgba(12,16,48,.1)';
      t['--c-soft'] = rgba(a, .14);
    }
    t['--c'] = rgbToHex(a);
    t['--c-line'] = rgba(a, .55);
    t['--on-c'] = lum(a) > .28 ? '#0a0a0c' : '#ffffff';
    t['color-scheme'] = dark ? 'dark' : 'light';
    t.dark = dark;
    return t;
  }

  function hostBg() {
    try {
      var c = JSON.parse(cep.getHostEnvironment()).appSkinInfo.panelBackgroundColor.color;
      return [c.red, c.green, c.blue];
    } catch (e) { return [35, 35, 35]; }
  }

  // Outside After Effects (browser preview) ?theme=light|dark and ?bg=303030 stand in for the host.
  var preview = {};
  if (!cep) location.search.replace(/[?&](\w+)=([\w#]+)/g, function (_, k, v) { preview[k] = v; });

  function applyTheme() {
    var s = AE.settings, mode = preview.theme || s.get('theme'), bg;
    if (mode === 'light') bg = [255, 255, 255];
    else if (mode === 'dark') bg = [17, 19, 25];
    else bg = cep ? hostBg() : hexToRgb(preview.bg || '232323');
    var t = tokensFor(bg, s.get('accent'));
    Object.keys(t).forEach(function (k) { if (k.indexOf('--') === 0) root.style.setProperty(k, t[k]); });
    root.style.colorScheme = t['color-scheme'];
    root.setAttribute('data-scheme', t.dark ? 'dark' : 'light');
    root.setAttribute('data-density', s.get('density'));
    AE.dark = t.dark;
    emit('theme', t);
  }
  AE.applyTheme = applyTheme;

  /* Events -------------------------------------------------------------- */
  var handlers = {};
  AE.on = function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); };
  function emit(ev, data) { (handlers[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); }

  /* Storage ------------------------------------------------------------- */
  function load(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
  }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  AE.store = function (key, v) {
    var k = 'aelibs:' + AE.slug + ':' + key;
    if (arguments.length < 2) return load(k, undefined);
    save(k, v);
  };

  function Settings(slug, defaults) {
    var key = 'aelibs:' + slug + ':settings', data = load(key, {}) || {};
    this.defaults = defaults;
    this.get = function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : defaults[k]; };
    this.set = function (k, v) { data[k] = v; save(key, data); emit('setting', { key: k, value: v }); emit('setting:' + k, v); };
    this.reset = function () { data = {}; save(key, data); Object.keys(defaults).forEach(function (k) { emit('setting:' + k, defaults[k]); }); emit('setting', {}); };
  }

  /* Host bridge --------------------------------------------------------- */
  AE.eval = function (script) {
    return new Promise(function (resolve, reject) {
      if (!cep) return resolve('');
      cep.evalScript(script, function (r) {
        if (r === 'EvalScript error.') reject(new Error('After Effects couldn’t run the command.'));
        else resolve(r);
      });
    });
  };
  // Calls a host function with one JSON argument; the host answers with JSON. { error } becomes a rejection.
  AE.call = function (fn, arg) {
    if (!cep) {
      var m = AE.mock[fn];
      return new Promise(function (res, rej) { setTimeout(function () { try { res(m ? m(arg) : null); } catch (e) { rej(e); } }, 40); });
    }
    return AE.eval(fn + '(' + JSON.stringify(arg === undefined ? null : arg) + ')').then(function (r) {
      var o;
      try { o = JSON.parse(r); } catch (e) { throw new Error(r || 'No answer from After Effects.'); }
      if (o && o.error) { var er = new Error(o.error); er.soft = !!o.soft; throw er; }
      return o;
    });
  };

  AE.extPath = function () {
    if (!cep) return '';
    var p = decodeURI(cep.getSystemPath('extension'));
    return /^file:\/\/\/[a-z]:/i.test(p) ? p.slice(8) : p.replace(/^file:\/\//, '');
  };
  AE.openURL = function (url) {
    if (global.cep && global.cep.util && global.cep.util.openURLInDefaultBrowser) global.cep.util.openURLInDefaultBrowser(url);
    else global.open(url, '_blank');
  };
  AE.hostVersion = function () {
    try { return JSON.parse(cep.getHostEnvironment()).appVersion; } catch (e) { return ''; }
  };

  /* UI helpers ---------------------------------------------------------- */
  // A toast with an action ("Deleted Snap · Undo") is clickable and stays up a little longer.
  var toastEl, toastT, toastAction = null;
  AE.toast = function (msg, kind, action) {
    if (!toastEl) {
      toastEl = doc.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); doc.body.appendChild(toastEl);
      toastEl.addEventListener('click', function () { if (toastAction) { var a = toastAction; toastAction = null; toastEl.classList.remove('show'); a(); } });
    }
    toastEl.textContent = msg;
    toastAction = action || null;
    toastEl.className = 'toast' + (kind === 'error' ? ' err' : '') + (action ? ' act' : '');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); toastAction = null; }, action ? 5000 : kind === 'error' ? 4200 : 2200);
  };

  // Context menu: items = [{ label, kb, danger, run } | '-']
  var menuEl;
  AE.menu = function (x, y, items) {
    AE.closeMenu();
    menuEl = doc.createElement('div');
    menuEl.className = 'menu';
    items.forEach(function (it) {
      if (it === '-') { menuEl.appendChild(doc.createElement('hr')); return; }
      var b = doc.createElement('button');
      b.type = 'button';
      if (it.danger) b.className = 'danger';
      b.innerHTML = esc(it.label) + (it.kb ? '<span class="kb">' + esc(it.kb) + '</span>' : '');
      b.addEventListener('click', function () { AE.closeMenu(); it.run(); });
      menuEl.appendChild(b);
    });
    doc.body.appendChild(menuEl);
    var r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
    menuEl.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  };
  AE.closeMenu = function () { if (menuEl) { menuEl.remove(); menuEl = null; } };
  doc.addEventListener('mousedown', function (e) { if (menuEl && !menuEl.contains(e.target)) AE.closeMenu(); });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') { AE.closeMenu(); closeTopSheet(); } });
  global.addEventListener('blur', function () { AE.closeMenu(); });

  // A focused panel swallows keystrokes. Undo and redo mean After Effects' undo, so they're passed on.
  doc.addEventListener('keydown', function (e) {
    var t = e.target.tagName;
    if (!cep || !(e.ctrlKey || e.metaKey) || t === 'INPUT' || t === 'TEXTAREA') return;
    var k = e.key.toLowerCase(), redo = (k === 'z' && e.shiftKey) || (k === 'y' && !e.metaKey);
    if (k !== 'z' && !redo) return;
    e.preventDefault();
    AE.eval('app.executeCommand(' + (redo ? 2035 : 16) + ')');
  });
  // No browser context menu outside text fields; panels show their own where it makes sense.
  doc.addEventListener('contextmenu', function (e) {
    var t = e.target.tagName;
    if (t !== 'INPUT' && t !== 'TEXTAREA') e.preventDefault();
  });

  // Keyboard focus rings only when navigating with the keyboard.
  doc.addEventListener('keydown', function (e) { if (e.key === 'Tab') root.classList.add('kbd'); });
  doc.addEventListener('mousedown', function () { root.classList.remove('kbd'); });

  // Segmented control: <div class="seg" data-key="mode"><button data-v="a">…</button></div>
  AE.seg = function (el, value, onChange) {
    var set = function (v, fire) {
      $$('button', el).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === String(v))); });
      if (fire && onChange) onChange(v);
    };
    el.setAttribute('role', 'group');
    el.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b && el.contains(b)) set(b.getAttribute('data-v'), true); });
    set(value, false);
    return { set: function (v) { set(v, false); } };
  };

  // Number field with drag-to-scrub on its label, arrow keys, and clamping.
  AE.num = function (input, opts) {
    opts = opts || {};
    var min = opts.min === undefined ? -Infinity : opts.min, max = opts.max === undefined ? Infinity : opts.max;
    var step = opts.step || 1, dec = opts.decimals === undefined ? (step < 1 ? 2 : 0) : opts.decimals;
    var fmt = function (v) { return String(+(+v).toFixed(dec)); };
    var clamp = function (v) { return Math.max(min, Math.min(max, v)); };
    var get = function () { var v = parseFloat(input.value); return isNaN(v) ? (opts.value || 0) : v; };
    var set = function (v, fire) {
      v = clamp(+(+v).toFixed(dec));
      input.value = fmt(v);
      if (fire && opts.onChange) opts.onChange(v);
    };
    input.addEventListener('change', function () { set(get(), true); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        set(get() + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : e.altKey ? .1 : 1), true);
      } else if (e.key === 'Enter') input.blur();
    });
    input.addEventListener('focus', function () { setTimeout(function () { input.select(); }, 0); });
    if (opts.scrub) {
      var lbl = opts.scrub;
      lbl.classList.add('scrub');
      lbl.addEventListener('mousedown', function (e) {
        e.preventDefault();
        var x0 = e.clientX, v0 = get(), moved = false;
        var mv = function (ev) {
          var dx = ev.clientX - x0;
          if (Math.abs(dx) > 2) moved = true;
          if (moved) set(v0 + Math.round(dx / 3) * step * (ev.shiftKey ? 10 : ev.altKey ? .1 : 1), true);
        };
        var up = function () { doc.removeEventListener('mousemove', mv); doc.removeEventListener('mouseup', up); if (!moved) input.focus(); };
        doc.addEventListener('mousemove', mv);
        doc.addEventListener('mouseup', up);
      });
    }
    set(opts.value === undefined ? get() : opts.value, false);
    return { get: get, set: function (v) { set(v, false); } };
  };

  /* Sheets -------------------------------------------------------------- */
  var sheets = [];
  function sheet(title, onClose) {
    var el = doc.createElement('section');
    el.className = 'sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);
    el.innerHTML = '<header class="hd"><button class="iconbtn" type="button" data-close aria-label="Back">' + AE.icon.back + '</button>'
      + '<span class="hd__title">' + esc(title) + '</span><span class="hd__sp"></span></header><div class="body"></div>';
    doc.body.appendChild(el);
    var api = {
      el: el, body: $('.body', el),
      open: function () { void el.offsetWidth; el.classList.add('open'); if (sheets.indexOf(api) < 0) sheets.push(api); },
      close: function () { el.classList.remove('open'); sheets = sheets.filter(function (s) { return s !== api; }); if (onClose) onClose(); },
    };
    $('[data-close]', el).addEventListener('click', api.close);
    return api;
  }
  function closeTopSheet() { if (sheets.length) sheets[sheets.length - 1].close(); }
  AE.sheet = sheet;

  /* Header -------------------------------------------------------------- */
  function header() {
    var hd = $('#hd');
    hd.className = 'hd';
    hd.innerHTML = '<span class="hd__title"><i class="chip"></i>' + esc(AE.name) + '</span><span class="hd__sp"></span>'
      + '<button class="upd hidden" type="button" id="upd" title="A new version is ready"><i></i><span></span></button>'
      + '<span id="hd-tools"></span>'
      + '<button class="iconbtn" type="button" id="open-settings" title="Settings" aria-label="Settings">' + AE.icon.gear + '</button>';
    $('#open-settings').addEventListener('click', openSettings);
    $('#upd').addEventListener('click', function () { if (updateInfo) openUpdate(updateInfo); });
  }

  /* Settings sheet ------------------------------------------------------ */
  var settingsSheet;
  function openSettings() {
    if (!settingsSheet) settingsSheet = buildSettings();
    renderSettings();
    settingsSheet.open();
  }
  function buildSettings() {
    var sh = sheet('Settings');
    sh.body.innerHTML =
      (AE.opts.settings ? '<div class="sec" id="set-plugin"></div>' : '')
      + '<div class="sec"><div class="sec__hd"><span class="lbl">Appearance</span></div><div class="rows">'
      + '<span class="lbl">Theme</span><div class="seg" id="set-theme"><button type="button" data-v="host">After Effects</button><button type="button" data-v="dark">Dark</button><button type="button" data-v="light">Light</button></div>'
      + '<span class="lbl">Accent</span><div class="swatches" id="set-accent"></div>'
      + '<span class="lbl">Density</span><div class="seg" id="set-density"><button type="button" data-v="compact">Compact</button><button type="button" data-v="comfortable">Comfortable</button></div>'
      + '</div></div>'
      + '<div class="sec"><div class="sec__hd"><span class="lbl">Updates</span><span class="lbl" id="set-ver"></span></div>'
      + '<label class="check" style="margin-bottom:8px"><span class="switch"><input type="checkbox" id="set-auto"><span></span></span>Check for updates when the panel opens</label>'
      + '<label class="check" style="margin-bottom:12px"><span class="switch"><input type="checkbox" id="set-pre"><span></span></span>Include pre-releases</label>'
      + '<div class="inline"><button class="btn btn--sm" type="button" id="set-check">' + AE.icon.refresh + 'Check now</button><span class="status" id="set-upd-status"></span></div>'
      + '</div>'
      + '<div class="sec"><div class="sec__hd"><span class="lbl">About</span></div>'
      + '<p class="note" style="margin:0 0 10px">' + esc(AE.name) + ' is part of aelibs, free and open-source tools for After Effects, MIT-licensed.</p>'
      + '<div class="links"><a data-url="https://github.com/' + AE.ORG + '/' + AE.slug + '">Source</a><a data-url="https://github.com/' + AE.ORG + '/' + AE.slug + '/issues/new">Report a bug</a><a data-url="https://aelibs.com">aelibs.com</a></div>'
      + '<div style="margin-top:14px"><button class="btn btn--sm btn--ghost" type="button" id="set-reset">Reset all settings</button></div>'
      + '</div>';
    var s = AE.settings;
    AE.seg($('#set-theme', sh.el), s.get('theme'), function (v) { s.set('theme', v); applyTheme(); });
    AE.seg($('#set-density', sh.el), s.get('density'), function (v) { s.set('density', v); applyTheme(); });
    $('#set-auto', sh.el).addEventListener('change', function (e) { s.set('autoUpdate', e.target.checked); });
    $('#set-pre', sh.el).addEventListener('change', function (e) { s.set('prerelease', e.target.checked); save(cacheKey(), null); });
    $('#set-check', sh.el).addEventListener('click', function () { checkForUpdate(true); });
    $('#set-reset', sh.el).addEventListener('click', function () {
      s.reset(); applyTheme(); renderSettings(); emit('reset'); AE.toast('Settings reset');
    });
    sh.el.addEventListener('click', function (e) { var a = e.target.closest('[data-url]'); if (a) AE.openURL(a.getAttribute('data-url')); });
    if (AE.opts.settings) AE.opts.settings($('#set-plugin', sh.el), s);
    return sh;
  }
  function renderSettings() {
    var s = AE.settings, el = settingsSheet.el, cur = String(s.get('accent')).toLowerCase();
    $$('#set-theme button', el).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === s.get('theme'))); });
    $$('#set-density button', el).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === s.get('density'))); });
    var isBrand = AE.BRAND.some(function (b) { return b.hex === cur; });
    $('#set-accent', el).innerHTML = AE.BRAND.map(function (b) {
      return '<button class="swatch" type="button" style="--sw:' + b.hex + '" data-hex="' + b.hex + '" title="' + esc(b.name) + '" aria-pressed="' + (b.hex === cur) + '"></button>';
    }).join('') + '<label class="swatch swatch--custom" title="Custom color" aria-pressed="' + !isBrand + '"' + (isBrand ? '' : ' style="background:' + esc(cur) + '"') + '><input type="color" value="' + esc(cur) + '"></label>';
    $$('#set-accent [data-hex]', el).forEach(function (b) { b.addEventListener('click', function () { s.set('accent', b.getAttribute('data-hex')); applyTheme(); renderSettings(); }); });
    var ci = $('#set-accent input', el);
    ci.addEventListener('input', function () { s.set('accent', ci.value); applyTheme(); });
    ci.addEventListener('change', renderSettings);
    $('#set-auto', el).checked = !!s.get('autoUpdate');
    $('#set-pre', el).checked = !!s.get('prerelease');
    $('#set-ver', el).textContent = 'v' + AE.version;
    emit('settings-open', el);
  }

  /* Updates ------------------------------------------------------------- */
  var updateInfo = null, updater = null;
  function cacheKey() { return 'aelibs:' + AE.slug + ':update'; }
  function getUpdater() {
    if (updater !== null) return updater;
    try { updater = nodeRequire ? nodeRequire(AE.extPath() + '/shared/updater.js') : false; } catch (e) { updater = false; }
    return updater;
  }
  function setStatus(msg) { var el = settingsSheet && $('#set-upd-status', settingsSheet.el); if (el) el.innerHTML = msg; }

  function showPill(info) {
    updateInfo = info;
    var p = $('#upd');
    if (!p) return;
    $('span', p).textContent = 'Update ' + info.version;
    p.classList.remove('hidden');
  }

  function checkForUpdate(manual) {
    var u = getUpdater(), s = AE.settings;
    if (manual) setStatus('Checking…');
    var run = u ? u.latest(AE.ORG + '/' + AE.slug, AE.slug, { prerelease: s.get('prerelease') })
      : fetchLatestInBrowser();
    return run.then(function (info) {
      save(cacheKey(), { t: Date.now(), info: info });
      handleInfo(info, manual);
    }, function (e) {
      if (manual) setStatus('<span style="color:var(--hi)">' + esc(e.message) + '</span>');
    });
  }
  // Outside After Effects (the dev preview) there's no Node; fetch works for the check itself.
  function fetchLatestInBrowser() {
    return fetch('https://api.github.com/repos/' + AE.ORG + '/' + AE.slug + '/releases/latest').then(function (r) {
      if (!r.ok) throw new Error(r.status === 404 ? 'No releases published yet.' : 'GitHub answered with HTTP ' + r.status + '.');
      return r.json();
    }).then(function (r) { return { version: String(r.tag_name).replace(/^v/i, ''), name: r.name, notes: r.body || '', html: r.html_url, asset: null }; });
  }
  function newer(v) { var u = getUpdater(); return u ? u.cmp(v, AE.version) > 0 : String(v) !== AE.version; }
  function handleInfo(info, manual) {
    var skipped = AE.settings.get('skipVersion') === info.version;
    if (newer(info.version) && (manual || !skipped)) {
      showPill(info);
      if (manual) { setStatus(''); openUpdate(info); }
    } else if (manual) {
      setStatus('You have the latest version, <b>' + esc(AE.version) + '</b>.');
    }
  }

  var updSheet;
  function openUpdate(info) {
    if (!updSheet) updSheet = sheet('Update');
    var u = getUpdater();
    updSheet.body.innerHTML = '<div class="sec">'
      + '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px"><span style="font-weight:500;font-size:22px;letter-spacing:-.05em">' + esc(AE.name) + ' ' + esc(info.version) + '</span>'
      + '<span class="lbl">' + (info.prerelease ? 'Pre-release' : 'from v' + esc(AE.version)) + '</span></div>'
      + '<p class="note" style="margin:0 0 12px">Installs over the current version, keeping your settings and library.</p>'
      + '<div class="notes">' + (u ? u.notesToHtml(info.notes) : esc(info.notes || 'No release notes.')) + '</div>'
      + '<div class="progress hidden" id="upd-prog" style="margin-top:14px"><i></i></div><p class="note" id="upd-msg" style="margin:8px 0 0;min-height:16px"></p>'
      + '</div>'
      + '<div class="sec"><div class="inline"><button class="btn btn--accent" type="button" id="upd-go">' + AE.icon.arrowDown + 'Update now</button>'
      + '<button class="btn btn--ghost" type="button" id="upd-skip">Skip this version</button></div></div>';
    var go = $('#upd-go', updSheet.el), msg = $('#upd-msg', updSheet.el), prog = $('#upd-prog', updSheet.el);
    if (!u || !info.asset) {
      go.innerHTML = AE.icon.external + 'Open release page';
      go.onclick = function () { AE.openURL(info.html || 'https://github.com/' + AE.ORG + '/' + AE.slug + '/releases/latest'); };
    } else {
      go.onclick = function () { runUpdate(info, go, msg, prog); };
    }
    $('#upd-skip', updSheet.el).onclick = function () {
      AE.settings.set('skipVersion', info.version);
      $('#upd').classList.add('hidden');
      updSheet.close();
      AE.toast('You won’t be reminded about ' + info.version);
    };
    updSheet.open();
  }

  function runUpdate(info, go, msg, prog) {
    var u = getUpdater();
    go.disabled = true;
    prog.classList.remove('hidden');
    prog.classList.add('indet');
    msg.textContent = 'Downloading…';
    var bar = $('i', prog);
    u.get(info.asset.url, 'application/octet-stream', function (got, total) {
      total = total || info.asset.size;
      if (total) { prog.classList.remove('indet'); bar.style.width = Math.min(100, got / total * 100).toFixed(1) + '%'; }
      msg.textContent = 'Downloading… ' + (got / 1048576).toFixed(1) + ' MB';
    }).then(function (buf) {
      msg.textContent = 'Installing…';
      prog.classList.add('indet');
      var res = u.install(AE.extPath(), u.unzip(buf), AE.bundleId);
      prog.classList.remove('indet');
      bar.style.width = '100%';
      save(cacheKey(), null);
      AE.settings.set('skipVersion', null);
      if (res.restart) {
        msg.innerHTML = '<b>Installed.</b> Restart After Effects to finish updating to ' + esc(info.version) + '.';
        go.innerHTML = AE.icon.check + 'Done';
        go.disabled = false;
        go.onclick = function () { updSheet.close(); };
      } else {
        msg.innerHTML = '<b>Installed.</b> Reloading…';
        setTimeout(function () { location.reload(); }, 700);
      }
    }).catch(function (e) {
      prog.classList.add('hidden');
      go.disabled = false;
      var readonly = e && e.code === 'readonly';
      msg.innerHTML = '<span style="color:var(--hi)">' + esc(e && e.message || 'The update failed.') + '</span>'
        + (readonly ? ' Download it from the release page and install it the same way as before.' : '');
      go.innerHTML = AE.icon.external + 'Open release page';
      go.onclick = function () { AE.openURL(info.html); };
    });
  }

  function autoCheck() {
    var s = AE.settings, u = getUpdater();
    if (u && AE.extPath()) { try { u.sweep(AE.extPath()); } catch (e) {} }
    var c = load(cacheKey(), null);
    if (c && c.info && Date.now() - c.t < 6 * 36e5) { handleInfo(c.info, false); return; }
    if (!s.get('autoUpdate')) return;
    setTimeout(function () { checkForUpdate(false); }, 1500);
  }

  /* Boot ---------------------------------------------------------------- */
  // opts: { slug, name, version, bundleId, accent, defaults, settings(el, settings), mock }
  AE.init = function (opts) {
    AE.opts = opts;
    AE.slug = opts.slug; AE.name = opts.name; AE.version = opts.version; AE.bundleId = opts.bundleId;
    var defaults = { theme: 'host', accent: opts.accent, density: 'compact', autoUpdate: true, prerelease: false, skipVersion: null };
    Object.keys(opts.defaults || {}).forEach(function (k) { defaults[k] = opts.defaults[k]; });
    AE.settings = new Settings(opts.slug, defaults);
    applyTheme();
    if (cep) {
      cep.addEventListener('com.adobe.csxs.events.ThemeColorChanged', function () { if (AE.settings.get('theme') === 'host') applyTheme(); });
    }
    header();
    // Load the host script fresh every time, so an update takes effect without restarting After Effects.
    var ready = cep ? AE.eval('$.evalFile(' + JSON.stringify(AE.extPath() + '/host/host.jsx') + ')') : Promise.resolve();
    autoCheck();
    return ready;
  };
})(window);
