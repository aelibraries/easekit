#!/usr/bin/env node
// Runs the *.test.jsx files inside After Effects and prints the results.
//   node test/run.mjs                  all tests, newest After Effects found
//   node test/run.mjs easekit          tests whose name contains "easekit"
//   AE=path/to/AfterFX.exe node test/run.mjs
// Each test runs in a fresh, unsaved project. Close any work you care about first: the open project is
// discarded without saving.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';

function findAE() {
  if (process.env.AE) return process.env.AE;
  const roots = process.platform === 'win32' ? ['C:/Program Files/Adobe'] : ['/Applications'];
  const found = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r)) {
      const m = d.match(/^Adobe After Effects (\d{4})$/);
      if (!m) continue;
      const exe = process.platform === 'win32' ? path.join(r, d, 'Support Files', 'AfterFX.exe') : path.join(r, d, d + '.app');
      if (fs.existsSync(exe)) found.push([+m[1], exe]);
    }
  }
  found.sort((a, b) => b[0] - a[0]);
  if (!found.length) throw new Error('After Effects not found. Set AE=path/to/AfterFX.exe');
  return found[0][1];
}

// Pre-flight: a syntax error inside After Effects becomes a modal dialog that stalls the run, and
// ExtendScript may read files in the system code page, so every script must parse and be pure ASCII.
function preflight(dir) {
  const bad = [];
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    if (!/\.(jsx|jsxinc)$/.test(f) || /^(dist|node_modules)[\\/]/.test(f)) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const i = src.search(/[^\x00-\x7f]/);
    if (i >= 0) bad.push(`${f}:${src.slice(0, i).split('\n').length}: non-ASCII character`);
    try { new Function(src); } catch (e) { bad.push(`${f}: ${e.message}`); }
  }
  return bad;
}
const problems = preflight(path.dirname(HERE));
if (problems.length) { console.log('Not running: fix these first\n  ' + problems.join('\n  ')); process.exit(1); }

const ae = findAE();
const tests = fs.readdirSync(HERE).filter(f => f.endsWith('.test.jsx') && f.includes(filter)).sort();
const js = s => JSON.stringify(s.split(path.sep).join('/'));
let failed = 0;

for (const t of tests) {
  const out = path.join(os.tmpdir(), `aelibs-test-${process.pid}.txt`);
  fs.rmSync(out, { force: true });
  const wrapper = path.join(os.tmpdir(), `aelibs-run-${process.pid}.jsx`);
  const progress = path.join(os.tmpdir(), `aelibs-progress-${process.pid}.txt`);
  fs.rmSync(progress, { force: true });
  fs.writeFileSync(wrapper, `
(function () {
  app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  app.newProject();
  app.beginSuppressDialogs();
  var res = '', NL = String.fromCharCode(10);
  // Turning some After Effects errors into text with + throws an uncatchable error, so read fields instead.
  var text = function (e) {
    var m = '', l = '';
    try { m = typeof e.message === 'string' ? e.message : ''; } catch (x) {}
    try { if (typeof e.line === 'number') l = ' (line ' + e.line + ')'; } catch (x2) {}
    return (m || 'error') + l;
  };
  $.global.T_PROGRESS = ${js(progress)};
  try { $.evalFile(${js(path.join(HERE, t))}); res = T.out.join(NL) + NL + (T.fails ? T.fails + ' failed' : 'all passed'); }
  catch (e) { res = (typeof T !== 'undefined' ? T.out.join(NL) + NL : '') + 'CRASH ' + text(e); }
  app.endSuppressDialogs(false);
  app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  var f = new File(${js(out)}); f.encoding = 'UTF-8'; f.open('w'); f.write(res); f.close();
})();`);
  const t0 = Date.now();
  spawn(ae, ['-r', wrapper], { detached: true, stdio: 'ignore' }).unref();
  while (!fs.existsSync(out)) {
    if (Date.now() - t0 > 180000) {
      const last = fs.existsSync(progress) ? fs.readFileSync(progress, 'utf8').trim().split('\n').slice(-3).join('\n  ') : '(nothing logged)';
      console.log(`${t}: timed out (a dialog may be open in After Effects). Last steps:\n  ${last}`);
      process.exit(2);
    }
    await new Promise(r => setTimeout(r, 400));
  }
  await new Promise(r => setTimeout(r, 200));
  const res = fs.readFileSync(out, 'utf8');
  console.log(`\n▸ ${t}  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n${res}`);
  if (!/all passed\s*$/.test(res)) failed++;
  fs.rmSync(out, { force: true });
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nAll test files passed');
process.exit(failed ? 1 : 0);
