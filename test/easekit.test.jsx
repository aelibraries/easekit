//@include "harness.jsxinc"
$.evalFile(File($.fileName).parent.parent.fsName + '/easekit/host/host.jsx');
var EK = aelibsEasekit;

var comp = T.comp();
var L = comp.layers.addSolid([1, 1, 1], 'a', 400, 400, 1);
var tr = L.property('ADBE Transform Group');

function keys(p, pairs) {
  while (p.numKeys) p.removeKey(1);
  for (var i = 0; i < pairs.length; i++) p.setValueAtTime(pairs[i][0], pairs[i][1]);
}
function only(p, ks) { T.deselectAll(comp); T.select(p, ks); }
function checkCurve(label, p, v, t0, t1, a, b, get, tol) {
  var worst = 0;
  for (var i = 1; i < 10; i++) {
    var x = i / 10, t = t0 + (t1 - t0) * x, want = a + (b - a) * T.ease(v, x), got = get(p.valueAtTime(t, false));
    worst = Math.max(worst, Math.abs(got - want));
  }
  T.ok(label, worst <= tol, 'max error ' + worst);
}

// 1D
var op = tr.property('ADBE Opacity');
keys(op, [[0, 0], [2, 100]]);
only(op, [1, 2]);
var r = T.call(EK.count);
T.eq('count sees 2 keys', r.keys, 2);
var OUTEXPO = [.16, 1, .3, 1];
r = T.call(EK.apply, { v: OUTEXPO, side: 'both' });
T.eq('apply reports 2 keys', r.keys, 2);
checkCurve('opacity follows Out Expo', op, OUTEXPO, 0, 2, 0, 100, function (v) { return v; }, .35);

// Overshoot on rotation
var rot = tr.property('ADBE Rotate Z');
keys(rot, [[0, 0], [1, 360]]);
only(rot, [1, 2]);
var SETTLE = [.25, 1.35, .4, 1];
T.call(EK.apply, { v: SETTLE });
checkCurve('rotation overshoots like Settle', rot, SETTLE, 0, 1, 0, 360, function (v) { return v; }, 1.5);

// Spatial
var pos = tr.property('ADBE Position');
keys(pos, [[0, [100, 100]], [2, [700, 900]]]);
only(pos, [1, 2]);
var STRONG = [.7, 0, .2, 1];
T.call(EK.apply, { v: STRONG });
checkCurve('position progress follows In-out Strong', pos, STRONG, 0, 2, 0, 1000,
  function (v) { return Math.sqrt((v[0] - 100) * (v[0] - 100) + (v[1] - 100) * (v[1] - 100)); }, 4);

// Multi-dimensional, non-spatial
var sc = tr.property('ADBE Scale');
keys(sc, [[0, [100, 100]], [1, [200, 50]]]);
only(sc, [1, 2]);
T.call(EK.apply, { v: OUTEXPO });
checkCurve('scale x follows the curve', sc, OUTEXPO, 0, 1, 100, 200, function (v) { return v[0]; }, .5);
checkCurve('scale y follows the curve', sc, OUTEXPO, 0, 1, 100, 50, function (v) { return v[1]; }, .5);

// Color
var fill = L.property('ADBE Effect Parade').addProperty('ADBE Fill');
var col = fill.property('ADBE Fill-0002');
keys(col, [[0, [1, 0, 0, 1]], [2, [0, 0, 1, 1]]]);
only(col, [1, 2]);
T.call(EK.apply, { v: STRONG });
checkCurve('color follows the curve', col, STRONG, 0, 2, 1, 0, function (v) { return v[0]; }, .01);

// Mask path: no error, becomes bezier
var mask = L.property('ADBE Mask Parade').addProperty('ADBE Mask Atom').property('ADBE Mask Shape');
var s1 = new Shape(); s1.vertices = [[0, 0], [100, 0], [100, 100], [0, 100]]; s1.closed = true;
var s2 = new Shape(); s2.vertices = [[0, 0], [300, 0], [300, 300], [0, 300]]; s2.closed = true;
keys(mask, [[0, s1], [2, s2]]);
only(mask, [1, 2]);
r = T.call(EK.apply, { v: OUTEXPO });
T.ok('mask path eases without error', !r.error && r.keys === 2, r.error);
T.eq('mask key 1 out is bezier', mask.keyOutInterpolationType(1), KeyframeInterpolationType.BEZIER);
checkCurve('mask vertex follows the curve', mask, OUTEXPO, 0, 2, 100, 300, function (v) { return v.vertices[1][0]; }, 2);

// Side: out only leaves the next key's incoming side alone
keys(op, [[0, 0], [1, 100], [2, 0]]);
op.setInterpolationTypeAtKey(2, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
var inBefore = op.keyInTemporalEase(2)[0];
only(op, [1, 2]);
T.call(EK.apply, { v: [.9, 0, .1, 1], side: 'out' });
T.eq('out only: key 1 out is bezier', op.keyOutInterpolationType(1), KeyframeInterpolationType.BEZIER);
T.near('out only: key 1 out influence', op.keyOutTemporalEase(1)[0].influence, 90, .01);
T.eq('out only: key 2 in stays linear', op.keyInInterpolationType(2), KeyframeInterpolationType.LINEAR);
T.near('out only: key 2 in speed unchanged', op.keyInTemporalEase(2)[0].speed, inBefore.speed, 1e-6);

// Side: in only
keys(op, [[0, 0], [1, 100], [2, 0]]);
only(op, [1, 2]);
T.call(EK.apply, { v: [.9, 0, .1, 1], side: 'in' });
T.eq('in only: key 1 out untouched', op.keyOutInterpolationType(1), KeyframeInterpolationType.LINEAR);
T.near('in only: key 2 in influence', op.keyInTemporalEase(2)[0].influence, 90, .01);

// One selected key: both of its sides, neighbours untouched
keys(op, [[0, 0], [1, 100], [2, 0]]);
only(op, [2]);
T.eq('lone key: count sees 1 key', T.call(EK.count).keys, 1);
r = T.call(EK.apply, { v: OUTEXPO });
T.eq('lone key: one key changed', r.keys, 1);
T.eq('lone key: in is bezier', op.keyInInterpolationType(2), KeyframeInterpolationType.BEZIER);
T.eq('lone key: out is bezier', op.keyOutInterpolationType(2), KeyframeInterpolationType.BEZIER);
T.eq('lone key: key 1 untouched', op.keyOutInterpolationType(1), KeyframeInterpolationType.LINEAR);
T.eq('lone key: key 3 untouched', op.keyInInterpolationType(3), KeyframeInterpolationType.LINEAR);

// An auto-bezier neighbour comes back as auto-bezier, with its value at a sample time unchanged
keys(op, [[0, 0], [1, 100], [2, 30]]);
op.setInterpolationTypeAtKey(2, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
op.setTemporalAutoBezierAtKey(2, true);
var before = op.valueAtTime(1.5, false);
only(op, [1, 2]);
T.call(EK.apply, { v: OUTEXPO, side: 'out' });
T.ok('auto-bezier neighbour keeps its flag', op.keyTemporalAutoBezier(2));
T.near('auto-bezier neighbour keeps its next segment', op.valueAtTime(1.5, false), before, .01);

// Hold keys get converted, not skipped
keys(op, [[0, 0], [1, 100]]);
op.setInterpolationTypeAtKey(1, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
only(op, [1, 2]);
T.call(EK.apply, { v: OUTEXPO });
checkCurve('hold segment becomes the curve', op, OUTEXPO, 0, 1, 0, 100, function (v) { return v; }, .35);

// Read round trip
keys(op, [[0, 0], [2, 100]]);
only(op, [1, 2]);
T.call(EK.apply, { v: STRONG });
r = T.call(EK.read);
T.near('read x1', r.v[0], STRONG[0], .01); T.near('read y1', r.v[1], STRONG[1], .01);
T.near('read x2', r.v[2], STRONG[2], .01); T.near('read y2', r.v[3], STRONG[3], .01);
keys(rot, [[0, 0], [1, 360]]);
only(rot, [1, 2]);
T.call(EK.apply, { v: SETTLE });
r = T.call(EK.read);
T.near('read overshoot y1', r.v[1], SETTLE[1], .01);
keys(op, [[0, 0], [2, 100]]);
only(op, [1, 2]);
r = T.call(EK.read);
T.near('read linear y1 = x1', r.v[1], r.v[0], .01);

// Reading computes speeds directly (no undo step); these must agree with what After Effects measures.
function roundTrip(label, p, pairs, v, setup) {
  T.step('read back ' + label, function () {
    keys(p, pairs);
    if (setup) setup(p);
    only(p, [1, 2]);
    var a = T.call(EK.apply, { v: v });
    if (a.error) { T.ok('read back ' + label, false, 'apply: ' + a.error); return; }
    var got = T.call(EK.read);
    if (got.error) { T.ok('read back ' + label, false, 'read: ' + got.error); return; }
    var worst = 0;
    for (var i = 0; i < 4; i++) worst = Math.max(worst, Math.abs(got.v[i] - v[i]));
    T.ok('read back ' + label, worst <= .01, 'got ' + got.v.join(', ') + ' want ' + v.join(', '));
  });
}
roundTrip('position, straight path', pos, [[0, [100, 100]], [2, [700, 900]]], STRONG);
roundTrip('position, curved path', pos, [[0, [100, 100]], [2, [700, 900]]], OUTEXPO, function (p) {
  p.setSpatialTangentsAtKey(1, [0, 0, 0], [400, -300, 0]);
  p.setSpatialTangentsAtKey(2, [-200, 300, 0], [0, 0, 0]);
});
L.threeDLayer = true;
roundTrip('3D position', pos, [[0, [0, 0, 0]], [1, [300, 400, 1200]]], SETTLE);
L.threeDLayer = false;
roundTrip('scale', sc, [[0, [100, 100]], [1, [200, 50]]], STRONG);
roundTrip('color', col, [[0, [1, 0, 0, 1]], [2, [0, .5, 1, 1]]], OUTEXPO);
roundTrip('mask path', mask, [[0, s1], [2, s2]], STRONG);

// Spatial overshoot below zero is clamped and reported, not an error
keys(pos, [[0, [100, 100]], [2, [700, 900]]]);
only(pos, [1, 2]);
r = T.call(EK.apply, { v: [.36, -.5, .66, 1] });
T.ok('spatial undershoot clamps', !r.error && r.clamped > 0, JSON.stringify(r));

// Extreme handles don't trip After Effects' influence limits
keys(op, [[0, 0], [2, 100]]);
only(op, [1, 2]);
r = T.call(EK.apply, { v: [0, 1, 1, 0] });
T.ok('x1 = 0 and x2 = 1 are accepted', !r.error, r.error);

// Nothing selected
T.deselectAll(comp);
r = T.call(EK.apply, { v: OUTEXPO });
T.ok('no selection gives a soft error', r.error && r.soft, JSON.stringify(r));
