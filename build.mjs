#!/usr/bin/env node
// Builds every plugin into dist/.
//
//   node build.mjs                 build all
//   node build.mjs easekit rename  build some
//   node build.mjs --install       also install the CEP panels for the current user (for testing)
//
// CEP panels → dist/<slug>/ (unpacked), dist/<slug>.zip, and dist/<slug>.zxp when ZXPSignCmd is available
// (set ZXPSIGNCMD, or put it in tools/). ScriptUI panels → dist/<slug>.jsx, one self-contained file. Release assets keep these exact names: the in-panel updaters look for them.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const SHARED = path.join(ROOT, 'shared');
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const only = args.filter(a => !a.startsWith('--'));

const plugins = fs.readdirSync(ROOT)
  .filter(d => fs.existsSync(path.join(ROOT, d, 'plugin.json')))
  .map(d => ({ dir: path.join(ROOT, d), ...JSON.parse(fs.readFileSync(path.join(ROOT, d, 'plugin.json'), 'utf8')) }))
  .filter(p => !only.length || only.includes(p.slug));

fs.mkdirSync(DIST, { recursive: true });

/* Helpers ---------------------------------------------------------------- */
const TEXT = /\.(html|css|js|jsx|jsxinc|xml|json|md|txt)$/i;
const stamp = (s, p) => s.replaceAll('__VERSION__', p.version);
// ExtendScript may read files in the system code page: generated scripts must be pure ASCII.
function ascii(file, src) {
  const i = src.search(/[^\x00-\x7f]/);
  if (i >= 0) throw new Error(`${file}:${src.slice(0, i).split('\n').length}: non-ASCII character in ExtendScript output`);
  return src;
}

// Resolves ExtendScript //@include "file" (and #include) recursively, each file once.
function inline(file, seen = new Set()) {
  const abs = path.resolve(file);
  if (seen.has(abs)) return '';
  seen.add(abs);
  return fs.readFileSync(abs, 'utf8').replace(/^[ \t]*(?:\/\/@|#)include\s+"([^"]+)"\s*;?[ \t]*$/gm, (_, rel) =>
    `// ---- ${path.basename(rel)} ----\n` + inline(path.join(path.dirname(abs), rel), seen).trimEnd());
}

function copyDir(src, dst, filter = () => true, p) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (!filter(s)) continue;
    if (fs.statSync(s).isDirectory()) copyDir(s, d, filter, p);
    else if (p && TEXT.test(f)) fs.writeFileSync(d, stamp(fs.readFileSync(s, 'utf8'), p));
    else fs.copyFileSync(s, d);
  }
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir).flatMap(f => {
    const p = path.join(dir, f);
    return fs.statSync(p).isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  }).sort();
}

// Plain zip writer (deflate), enough for CEP and for the updater's reader.
function zip(dir, out) {
  const files = listFiles(dir), parts = [], central = [];
  let off = 0;
  const dosTime = 0x6000, dosDate = 0x5b4a; // fixed timestamp: identical input gives identical zips
  for (const name of files) {
    const data = fs.readFileSync(path.join(dir, name)), comp = zlib.deflateRawSync(data, { level: 9 });
    const useStore = comp.length >= data.length, body = useStore ? data : comp, crc = zlib.crc32(data);
    const nb = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useStore ? 0 : 8, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useStore ? 0 : 8, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, body);
    central.push(ch, nb);
    off += 30 + nb.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  fs.writeFileSync(out, Buffer.concat([...parts, cd, end]));
}

// The panel icon in Window → Extensions: the brand diamond in the plugin's color, drawn with 4× supersampling.
function iconPng(hex, size) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const raw = Buffer.alloc((size * 4 + 1) * size), S = 4, c = size / 2, half = size * .34, rad = size * .07;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const px = x + (sx + .5) / S - c, py = y + (sy + .5) / S - c;
        // Rotate 45° and test a rounded square.
        const u = Math.abs((px + py) / Math.SQRT2), v = Math.abs((px - py) / Math.SQRT2);
        const dx = Math.max(u - (half - rad), 0), dy = Math.max(v - (half - rad), 0);
        if (u <= half && v <= half && dx * dx + dy * dy <= rad * rad) hit++;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = Math.round(hit / (S * S) * 255);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function findZxpSign() {
  const c = [process.env.ZXPSIGNCMD, path.join(ROOT, 'tools', 'ZXPSignCmd.exe'), path.join(ROOT, 'tools', 'ZXPSignCmd'), path.join(ROOT, 'tools', 'ZXPSignCmd-64bit.exe')];
  return c.find(p => p && fs.existsSync(p));
}

/* Build ------------------------------------------------------------------ */
function buildCep(p) {
  const out = path.join(DIST, p.slug);
  fs.rmSync(out, { recursive: true, force: true });
  const skip = new Set(['plugin.json', 'README.md', 'CHANGELOG.md', 'test', 'host']);
  copyDir(p.dir, out, s => !(path.dirname(s) === p.dir && skip.has(path.basename(s))), p);
  // Shared runtime: CSS, JS, updater and fonts.
  copyDir(path.join(SHARED, 'cep'), path.join(out, 'shared'), () => true, p);
  // Host script with its includes resolved.
  fs.mkdirSync(path.join(out, 'host'), { recursive: true });
  fs.writeFileSync(path.join(out, 'host', 'host.jsx'), ascii(p.slug + ' host', stamp(inline(path.join(p.dir, 'host', 'host.jsx')), p)));
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(out, 'icons', 'icon.png'), iconPng(p.accent, 23));
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(out, 'LICENSE'));

  const zipOut = path.join(DIST, `${p.slug}.zip`);
  zip(out, zipOut);
  const sign = findZxpSign();
  if (sign) {
    const cert = path.join(ROOT, 'tools', 'aelibs.p12'), pass = process.env.ZXP_PASSWORD || 'aelibs';
    if (!fs.existsSync(cert)) execFileSync(sign, ['-selfSignedCert', 'US', 'NA', 'aelibs', 'aelibs', pass, cert], { stdio: 'inherit' });
    const zxp = path.join(DIST, `${p.slug}.zxp`);
    fs.rmSync(zxp, { force: true });
    execFileSync(sign, ['-sign', out, zxp, cert, pass, '-tsa', 'http://timestamp.digicert.com'], { stdio: 'inherit' });
    console.log(`  ${p.slug}.zxp signed`);
  }
  if (flags.has('--install')) installCep(p, out);
  return out;
}

function installCep(p, out) {
  const base = process.platform === 'win32'
    ? path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions')
    : path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
  const dest = path.join(base, p.bundleId);
  fs.rmSync(dest, { recursive: true, force: true });
  copyDir(out, dest);
  console.log(`  installed → ${dest}`);
}

function buildJsx(p) {
  const out = path.join(DIST, `${p.slug}.jsx`);
  fs.writeFileSync(out, ascii(p.slug, stamp(inline(path.join(p.dir, `${p.slug}.jsx`)), p)));
  return out;
}

for (const p of plugins) {
  const out = p.kind === 'cep' ? buildCep(p) : buildJsx(p);
  console.log(`${p.name} ${p.version} → ${path.relative(ROOT, out)}`);
}
