/* aelibs updater for CEP panels (runs in the panel's Node context).
   Finds the newest GitHub release of the panel, downloads its .zxp (or .zip), checks it really is this
   extension, and swaps it in for the installed copy. Written for the Node that ships with CEP 9 (Node 8),
   so no fs.mkdirSync({recursive}), fs.rmSync or optional chaining. */
'use strict';

var https = require('https');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var UA = 'aelibs-updater';

/* Versions ---------------------------------------------------------------- */
// Semver compare that understands pre-release tags: 1.2.0-beta.2 < 1.2.0 < 1.2.1.
function parse(v) {
  var m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return { n: [+m[1], +(m[2] || 0), +(m[3] || 0)], pre: m[4] ? m[4].split('.') : [] };
}
function cmp(a, b) {
  var A = parse(a), B = parse(b), i;
  if (!A || !B) return A ? 1 : B ? -1 : 0;
  for (i = 0; i < 3; i++) if (A.n[i] !== B.n[i]) return A.n[i] > B.n[i] ? 1 : -1;
  if (!A.pre.length || !B.pre.length) return A.pre.length ? -1 : B.pre.length ? 1 : 0;
  for (i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    var x = A.pre[i], y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    var nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny && +x !== +y) return +x > +y ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/* HTTP -------------------------------------------------------------------- */
function get(url, accept, onProgress, hops) {
  hops = hops || 0;
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { headers: { 'User-Agent': UA, Accept: accept || '*/*' } }, function (res) {
      var code = res.statusCode;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (hops > 6) return reject(err('redirects', 'Too many redirects.'));
        return resolve(get(require('url').resolve(url, res.headers.location), accept, onProgress, hops + 1));
      }
      if (code !== 200) {
        res.resume();
        var limited = code === 403 && res.headers['x-ratelimit-remaining'] === '0';
        if (code === 404) return reject(err('notfound', 'No releases have been published yet.'));
        return reject(err(limited ? 'ratelimit' : 'http', limited
          ? 'GitHub’s hourly limit for update checks was reached. Try again later.'
          : 'GitHub answered with HTTP ' + code + '.'));
      }
      var total = +res.headers['content-length'] || 0, got = 0, chunks = [];
      res.on('data', function (c) { chunks.push(c); got += c.length; if (onProgress) onProgress(got, total); });
      res.on('end', function () { resolve(Buffer.concat(chunks)); });
      res.on('error', reject);
    });
    req.setTimeout(30000, function () { req.abort(); reject(err('timeout', 'The connection timed out.')); });
    req.on('error', function (e) { reject(err('offline', 'Couldn’t reach GitHub. Check your connection.', e)); });
  });
}
function err(code, message, cause) { var e = new Error(message); e.code = code; e.cause = cause; return e; }

/* Releases ---------------------------------------------------------------- */
// Returns the newest usable release: { version, name, notes, html, published, asset: { name, url, size } }.
function latest(repo, slug, opts) {
  opts = opts || {};
  var api = 'https://api.github.com/repos/' + repo + '/releases' + (opts.prerelease ? '?per_page=15' : '/latest');
  return get(api, 'application/vnd.github+json').then(function (buf) {
    var data = JSON.parse(buf.toString('utf8'));
    var list = Array.isArray(data) ? data : [data];
    var rel = list.filter(function (r) { return r && !r.draft && pickAsset(r, slug); })
      .sort(function (a, b) { return cmp(b.tag_name, a.tag_name); })[0];
    if (!rel) throw err('noasset', 'The latest release has no installable build yet.');
    var a = pickAsset(rel, slug);
    return {
      version: String(rel.tag_name).replace(/^v/i, ''), name: rel.name || rel.tag_name, notes: rel.body || '',
      html: rel.html_url, published: rel.published_at, prerelease: !!rel.prerelease,
      asset: { name: a.name, url: a.browser_download_url, size: a.size },
    };
  });
}
function pickAsset(rel, slug) {
  var as = rel.assets || [], re = new RegExp('^' + slug + '[^/]*\\.(zxp|zip)$', 'i');
  return as.filter(function (a) { return /\.zxp$/i.test(a.name) && re.test(a.name); })[0]
    || as.filter(function (a) { return re.test(a.name); })[0];
}

/* Zip --------------------------------------------------------------------- */
// Minimal reader: stored and deflated entries, which is everything ZXPSignCmd and our build produce.
function unzip(buf) {
  var eocd = -1, i;
  for (i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw err('badzip', 'The download isn’t a valid archive.');
  var count = buf.readUInt16LE(eocd + 10), off = buf.readUInt32LE(eocd + 16), out = [];
  for (i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw err('badzip', 'The archive is damaged.');
    var method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20), usize = buf.readUInt32LE(off + 24);
    var nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    var local = buf.readUInt32LE(off + 42), name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
    off += 46 + nlen + xlen + clen;
    name = name.replace(/\\/g, '/');
    // Refuse anything that would land outside the extension folder.
    if (/^\/|^[a-z]:/i.test(name) || name.split('/').indexOf('..') >= 0) throw err('badzip', 'The archive has an unsafe path: ' + name);
    if (/\/$/.test(name)) { out.push({ name: name, dir: true }); continue; }
    var start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    var raw = buf.slice(start, start + csize);
    var data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw err('badzip', 'The archive uses an unsupported compression method.');
    if (data.length !== usize) throw err('badzip', 'The archive is damaged.');
    out.push({ name: name, data: data });
  }
  return out;
}

/* File system helpers ----------------------------------------------------- */
function mkdirp(dir) {
  if (fs.existsSync(dir)) return;
  mkdirp(path.dirname(dir));
  fs.mkdirSync(dir);
}
function rmrf(p) {
  var st;
  try { st = fs.lstatSync(p); } catch (e) { return; }
  if (st.isDirectory()) {
    fs.readdirSync(p).forEach(function (f) { rmrf(path.join(p, f)); });
    fs.rmdirSync(p);
  } else fs.unlinkSync(p);
}
function writable(dir) {
  var probe = path.join(dir, '.aelibs-write-test-' + process.pid);
  try { fs.writeFileSync(probe, ''); fs.unlinkSync(probe); return true; } catch (e) { return false; }
}
function stripVersions(xml) {
  return String(xml).replace(/(ExtensionBundleVersion|Version)="[^"]*"/g, '').replace(/\s+/g, ' ');
}

/* Install ----------------------------------------------------------------- */
// Writes the new build next to the installed one, then swaps folders. If the swap can't happen (a file
// is locked on Windows), it falls back to replacing the files in place. Returns { restart } — true when
// the manifest changed in a way only an After Effects restart picks up.
function install(extDir, entries, bundleId) {
  var manifest = entries.filter(function (e) { return e.name === 'CSXS/manifest.xml'; })[0];
  if (!manifest) throw err('badbuild', 'The download isn’t a CEP extension.');
  if (String(manifest.data).indexOf('ExtensionBundleId="' + bundleId + '"') < 0) throw err('badbuild', 'The download is a different extension.');
  var parent = path.dirname(extDir);
  if (!writable(parent) || !writable(extDir)) throw err('readonly', 'The panel is installed in a folder After Effects can’t write to.');

  var oldManifest = '';
  try { oldManifest = fs.readFileSync(path.join(extDir, 'CSXS', 'manifest.xml'), 'utf8'); } catch (e) {}
  var restart = stripVersions(oldManifest) !== stripVersions(manifest.data);

  var stamp = Date.now().toString(36);
  var staging = extDir + '.aelibs-new-' + stamp, backup = extDir + '.aelibs-old-' + stamp;
  rmrf(staging);
  entries.forEach(function (e) {
    var dest = path.join(staging, e.name);
    if (e.dir) return mkdirp(dest);
    mkdirp(path.dirname(dest));
    fs.writeFileSync(dest, e.data);
  });
  // CEP loads every folder with a manifest, so a staging copy must never look like an extension.
  fs.renameSync(path.join(staging, 'CSXS', 'manifest.xml'), path.join(staging, 'CSXS', 'manifest.xml.pending'));

  var swapped = false;
  try {
    fs.renameSync(extDir, backup);
    try { fs.renameSync(staging, extDir); swapped = true; }
    catch (e) { fs.renameSync(backup, extDir); throw e; }
  } catch (e) {
    // Fallback: overwrite in place, then remove files the new build no longer has.
    var keep = {};
    entries.forEach(function (x) { if (!x.dir) keep[path.normalize(x.name)] = true; });
    copyInto(staging, extDir);
    prune(extDir, extDir, keep);
    rmrf(staging);
  }
  var live = path.join(extDir, 'CSXS', 'manifest.xml');
  fs.renameSync(live + '.pending', live);
  if (swapped) cleanup(backup);
  return { restart: restart };
}
function copyInto(src, dst) {
  fs.readdirSync(src).forEach(function (f) {
    var s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) { mkdirp(d); copyInto(s, d); } else fs.writeFileSync(d, fs.readFileSync(s));
  });
}
function prune(root, dir, keep) {
  fs.readdirSync(dir).forEach(function (f) {
    var p = path.join(dir, f), rel = path.normalize(path.relative(root, p));
    if (fs.statSync(p).isDirectory()) {
      prune(root, p, keep);
      try { if (!fs.readdirSync(p).length) fs.rmdirSync(p); } catch (e) {}
    } else if (!keep[rel] && rel !== path.normalize('CSXS/manifest.xml.pending')) {
      try { fs.unlinkSync(p); } catch (e) {}
    }
  });
}
// The old copy is deleted; if Windows still holds a file, its manifest is disabled so CEP skips it,
// and the next launch finishes the job (see sweep).
function cleanup(dir) {
  try { rmrf(dir); } catch (e) {
    try { fs.renameSync(path.join(dir, 'CSXS', 'manifest.xml'), path.join(dir, 'CSXS', 'manifest.xml.old')); } catch (e2) {}
  }
}
// Removes leftovers from an earlier update of this extension.
function sweep(extDir) {
  var parent = path.dirname(extDir), base = path.basename(extDir);
  try {
    fs.readdirSync(parent).forEach(function (f) {
      if (f.indexOf(base + '.aelibs-') === 0) { try { rmrf(path.join(parent, f)); } catch (e) {} }
    });
  } catch (e) {}
}

/* Release notes ----------------------------------------------------------- */
// GitHub markdown to a small, safe subset of HTML: headings, bullets, paragraphs, inline code, bold.
function notesToHtml(md) {
  var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var inline = function (s) {
    return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  };
  var out = [], list = false;
  String(md || '').replace(/\r/g, '').split('\n').forEach(function (line) {
    var t = line.trim(), m;
    if ((m = t.match(/^[-*]\s+(.*)/))) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
    if (list) { out.push('</ul>'); list = false; }
    if (!t) return;
    if ((m = t.match(/^#{1,6}\s+(.*)/))) out.push('<h4>' + inline(m[1]) + '</h4>');
    else out.push('<p>' + inline(t) + '</p>');
  });
  if (list) out.push('</ul>');
  return out.join('') || '<p>No release notes.</p>';
}

module.exports = { cmp: cmp, latest: latest, get: get, unzip: unzip, install: install, sweep: sweep, notesToHtml: notesToHtml };
