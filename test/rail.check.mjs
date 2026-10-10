// Drives the panel's real motion-strip code (pulled out of dist/easekit/main.js) through a whole
// forward-and-back cycle for many curves, and fails if the box ever leaves the strip (0..100%).
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../dist/easekit/main.js', import.meta.url), 'utf8');
const grab = (start, end) => { const a = src.indexOf(start), b = src.indexOf(end, a); if (a < 0 || b < 0) throw new Error('not found: ' + start); return src.slice(a, b); };
const code = [
  grab('var bez = function', 'var same ='),
  grab('var box = $(', 'function startAnim()'),
].join('\n');

const curves = [[.16, 1, .3, 1], [.7, 0, .2, 1], [.25, 1.35, .4, 1], [.9, 0, .1, 1], [.34, 1.56, .64, 1],
  [.36, 0, .66, -.56], [.68, -.6, .32, 1.6], [.5, -.8, .5, 1.8], [0, 2, 1, -1], [1, 0, 0, 1], [0, 0, 1, 1]];
let bad = 0;
for (const cur of curves) {
  const el = () => ({ style: {}, innerHTML: '', setAttribute() {} });
  const box = el();
  const ctx = {
    cur, $: id => (id === '#box' ? box : el()), G: { dot: el() }, X: x => x, Y: y => y,
    AE: { settings: { get: () => true } }, document: { hidden: false }, Date: { now: () => 0 },
    requestAnimationFrame: () => 1, Math, parseFloat,
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\nhovering = true; paintDots();', ctx);
  let lo = Infinity, hi = -Infinity;
  for (let now = 1; now <= 3300; now += 4) {
    vm.runInContext(`raf = 0; tick(${now});`, ctx);
    const v = parseFloat(box.style.left);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const ok = lo >= -1e-6 && hi <= 100 + 1e-6;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'OUT'} cubic-bezier(${cur.join(', ')})  box ${lo.toFixed(2)}% .. ${hi.toFixed(2)}%`);
}
console.log(bad ? `${bad} curve(s) leave the strip` : 'The box stays inside the strip for every curve');
process.exit(bad ? 1 : 0);
