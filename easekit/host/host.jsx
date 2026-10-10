// Easekit host: turns a cubic-bezier into After Effects keyframe eases and back.
//
// The mapping is the one After Effects' own graph editor uses. For a segment from key A to key B whose
// average speed is S (value change per second, per ease dimension):
//   A outgoing: influence = x1 * 100, speed = (y1 / x1) * S
//   B incoming: influence = (1 - x2) * 100, speed = ((1 - y2) / (1 - x2)) * S
// S comes from After Effects itself: with both sides of a segment set to linear, the keyframes report the
// segment's average speed for every property type (1D, spatial path length, color, mask and shape paths).
// We switch the sides to linear, read S, and put everything back before writing the new eases.
//@include "../../shared/jsx/host.jsxinc"

(function () {
  var EK = $.global.aelibsEasekit = {};
  var KIT = KeyframeInterpolationType, PVT = PropertyValueType;
  var MIN_INF = 0.1, MAX_INF = 100; // After Effects rejects anything outside this, and the error can't be caught.

  function easable(p) {
    if (!p || p.propertyType !== PropertyType.PROPERTY || !p.canVaryOverTime || p.numKeys < 2) return false;
    var t = p.propertyValueType;
    return t !== PVT.NO_VALUE && t !== PVT.CUSTOM_VALUE && t !== PVT.MARKER && t !== PVT.LAYER_INDEX && t !== PVT.MASK_INDEX;
  }
  function spatial(p) { return p.propertyValueType === PVT.TwoD_SPATIAL || p.propertyValueType === PVT.ThreeD_SPATIAL; }

  function selectedProps(comp) {
    var all = comp.selectedProperties, out = [], seen = {};
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (!easable(p)) continue;
      var keys = p.selectedKeys;
      if (!keys || !keys.length) continue;
      out.push({ p: p, keys: keys.slice(0).sort(function (a, b) { return a - b; }) });
    }
    return out;
  }

  function snap(p, k) {
    return {
      inT: p.keyInInterpolationType(k), outT: p.keyOutInterpolationType(k),
      inE: p.keyInTemporalEase(k), outE: p.keyOutTemporalEase(k),
      cont: p.keyTemporalContinuous(k), auto: p.keyTemporalAutoBezier(k),
    };
  }
  // Puts a keyframe back exactly as snap() found it. Order matters: turning auto-bezier on converts a
  // linear key to bezier, so the flags are only restored on bezier keys, and the types are checked last.
  function restore(p, k, s) {
    p.setInterpolationTypeAtKey(k, s.inT, s.outT);
    if (s.inT === KIT.BEZIER || s.outT === KIT.BEZIER) {
      p.setTemporalEaseAtKey(k, s.inE, s.outE);
      p.setTemporalContinuousAtKey(k, s.cont);
      if (s.auto) p.setTemporalAutoBezierAtKey(k, true);
    }
    settle(p, k, s.inT, s.outT);
  }
  function settle(p, k, inT, outT) {
    if (p.keyInInterpolationType(k) !== inT || p.keyOutInterpolationType(k) !== outT) p.setInterpolationTypeAtKey(k, inT, outT);
  }
  function speeds(e) { var r = []; for (var i = 0; i < e.length; i++) r.push(e[i].speed); return r; }

  // Average speed of segment a -> a+1, one number per ease dimension.
  function measure(p, a, snaps) {
    var b = a + 1, sa = snaps[a] || (snaps[a] = snap(p, a)), sb = snaps[b] || (snaps[b] = snap(p, b));
    p.setTemporalContinuousAtKey(a, false); p.setTemporalAutoBezierAtKey(a, false);
    p.setTemporalContinuousAtKey(b, false); p.setTemporalAutoBezierAtKey(b, false);
    p.setInterpolationTypeAtKey(a, sa.inT, KIT.LINEAR);
    p.setInterpolationTypeAtKey(b, KIT.LINEAR, sb.outT);
    var s = speeds(p.keyOutTemporalEase(a));
    restore(p, a, sa); restore(p, b, sb);
    return s;
  }

  // Average speed of segment a -> a+1 computed from values and times, in the units After Effects reports:
  // value per second for numbers, path length per second for motion paths, and distance in 0-255 RGBA
  // space for colors. Returns null for types whose units aren't known (mask and shape paths).
  function direct(p, a) {
    var t = p.propertyValueType, dt = p.keyTime(a + 1) - p.keyTime(a), va = p.keyValue(a), vb = p.keyValue(a + 1), s = [], i, d;
    if (!(dt > 0)) return null;
    if (t === PVT.OneD) return [(vb - va) / dt];
    if (t === PVT.TwoD || t === PVT.ThreeD) { for (i = 0; i < va.length; i++) s.push((vb[i] - va[i]) / dt); return s; }
    if (t === PVT.COLOR) { d = 0; for (i = 0; i < va.length; i++) d += Math.pow((vb[i] - va[i]) * 255, 2); return [Math.sqrt(d) / dt]; }
    if (t === PVT.TwoD_SPATIAL || t === PVT.ThreeD_SPATIAL) {
      var o = p.keyOutSpatialTangent(a), n = p.keyInSpatialTangent(a + 1), len = 0, prev = va, N = 96;
      for (var k = 1; k <= N; k++) {
        var u = k / N, w0 = (1 - u) * (1 - u) * (1 - u), w1 = 3 * (1 - u) * (1 - u) * u, w2 = 3 * (1 - u) * u * u, w3 = u * u * u, pt = [];
        for (i = 0; i < va.length; i++) pt.push(w0 * va[i] + w1 * (va[i] + o[i]) + w2 * (vb[i] + n[i]) + w3 * vb[i]);
        d = 0; for (i = 0; i < pt.length; i++) d += (pt[i] - prev[i]) * (pt[i] - prev[i]);
        len += Math.sqrt(d); prev = pt;
      }
      return [len / dt];
    }
    return null;
  }

  function inf(v) { v = v * 100; return v < MIN_INF ? MIN_INF : v > MAX_INF ? MAX_INF : v; }
  function num(v, d) { return isFinite(v) ? v : d; }

  // v = [x1, y1, x2, y2]; side = 'both' | 'out' | 'in'
  function apply(arg) {
    var v = arg.v, side = arg.side || 'both';
    if (!(v instanceof Array) || v.length !== 4) throw new Error('Bad curve.');
    var x1 = Math.max(0, Math.min(1, +v[0])), y1 = +v[1], x2 = Math.max(0, Math.min(1, +v[2])), y2 = +v[3];
    var comp = aelibsComp(), props = selectedProps(comp);
    if (!props.length) throw aelibsSoft('Select keyframes in the timeline first.');

    var stats = { keys: 0, props: 0, clamped: 0 };
    for (var i = 0; i < props.length; i++) {
      var p = props[i].p, sel = props[i].keys, n = p.numKeys, isSel = {}, plan = [], j, k;
      for (j = 0; j < sel.length; j++) isSel[sel[j]] = true;
      // A segment between two selected keys gets the whole curve. A selected key with no selected
      // neighbour gets the curve on both of its sides.
      for (j = 0; j < sel.length; j++) {
        k = sel[j];
        var lone = !isSel[k - 1] && !isSel[k + 1];
        var doOut = side !== 'in' && k < n && (isSel[k + 1] || lone);
        var doIn = side !== 'out' && k > 1 && (isSel[k - 1] || lone);
        if (doOut || doIn) plan.push({ k: k, out: doOut, inn: doIn });
      }
      if (!plan.length) continue;

      var snaps = {}, seg = {};
      for (j = 0; j < plan.length; j++) {
        k = plan[j].k;
        if (plan[j].out && !seg[k]) seg[k] = measure(p, k, snaps);
        if (plan[j].inn && !seg[k - 1]) seg[k - 1] = measure(p, k - 1, snaps);
      }

      var isSpatial = spatial(p);
      for (j = 0; j < plan.length; j++) {
        var it = plan[j], s = snaps[it.k] || snap(p, it.k), inE = s.inE, outE = s.outE, d, sp;
        k = it.k;
        if (it.out) {
          outE = [];
          for (d = 0; d < seg[k].length; d++) {
            sp = num(x1 > 0 ? y1 / x1 : (y1 === 0 ? 0 : y1 * 1000), 0) * seg[k][d];
            if (isSpatial && sp < 0) { sp = 0; stats.clamped++; }
            outE.push(new KeyframeEase(sp, inf(x1)));
          }
        }
        if (it.inn) {
          inE = [];
          for (d = 0; d < seg[k - 1].length; d++) {
            sp = num(x2 < 1 ? (1 - y2) / (1 - x2) : (y2 === 1 ? 0 : (1 - y2) * 1000), 0) * seg[k - 1][d];
            if (isSpatial && sp < 0) { sp = 0; stats.clamped++; }
            inE.push(new KeyframeEase(sp, inf(1 - x2)));
          }
        }
        var inT = it.inn ? KIT.BEZIER : s.inT, outT = it.out ? KIT.BEZIER : s.outT;
        p.setTemporalContinuousAtKey(k, false);
        p.setTemporalAutoBezierAtKey(k, false);
        p.setInterpolationTypeAtKey(k, inT, outT);
        p.setTemporalEaseAtKey(k, inE, outE);
        settle(p, k, inT, outT);
        stats.keys++;
      }
      stats.props++;
    }
    if (!stats.keys) throw aelibsSoft('Select at least two neighbouring keyframes, or one with a keyframe beside it.');
    return stats;
  }

  // Reads the curve of the first selected segment back into [x1, y1, x2, y2].
  function read() {
    var comp = aelibsComp(), props = selectedProps(comp);
    if (!props.length) throw aelibsSoft('Select a keyframe to read its ease.');
    var p = props[0].p, sel = props[0].keys, a, isSel = {};
    for (var j = 0; j < sel.length; j++) isSel[sel[j]] = true;
    a = sel[0];
    if (!isSel[a + 1] && sel.length > 1) { for (j = 0; j < sel.length; j++) if (isSel[sel[j] + 1]) { a = sel[j]; break; } }
    if (a >= p.numKeys) a = p.numKeys - 1;
    if (p.keyOutInterpolationType(a) === KIT.HOLD) throw aelibsSoft('That keyframe is a hold keyframe, so it has no ease.');

    var outE = p.keyOutTemporalEase(a), inE = p.keyInTemporalEase(a + 1), S;
    // Reading shouldn't leave anything in the undo history, so the speed is computed directly when the
    // property's units are known. Only the rare rest (mask and shape paths) is measured the touching way.
    S = direct(p, a);
    if (!S) {
      app.beginUndoGroup('Easekit: Read ease');
      try { S = measure(p, a, {}); } finally { app.endUndoGroup(); }
    }
    // Use the dimension that moves the most; the others share the same timing in a cubic-bezier.
    var d = 0;
    for (var i = 1; i < S.length; i++) if (Math.abs(S[i]) > Math.abs(S[d])) d = i;
    var x1 = outE[d].influence / 100, x2 = 1 - inE[d].influence / 100, y1, y2;
    if (p.keyOutInterpolationType(a) === KIT.LINEAR) { x1 = 1 / 3; y1 = 1 / 3; } else y1 = Math.abs(S[d]) > 1e-9 ? outE[d].speed * x1 / S[d] : 0;
    if (p.keyInInterpolationType(a + 1) === KIT.LINEAR) { x2 = 2 / 3; y2 = 2 / 3; } else y2 = Math.abs(S[d]) > 1e-9 ? 1 - inE[d].speed * (1 - x2) / S[d] : 1;
    var r = function (n) { return Math.round(n * 1000) / 1000; };
    return { v: [r(x1), r(y1), r(x2), r(y2)], prop: p.name };
  }

  // Cheap: called on a timer so the Apply button can say how many keyframes it will touch.
  function count() {
    var c = aelibsComp(true);
    if (!c) return { comp: false, keys: 0, props: 0 };
    var all = c.selectedProperties, keys = 0, props = 0;
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (p.propertyType !== PropertyType.PROPERTY || !p.numKeys) continue;
      var s = p.selectedKeys;
      if (s && s.length) { keys += s.length; props++; }
    }
    return { comp: true, keys: keys, props: props };
  }

  aelibsExpose(EK, 'apply', apply, 'Easekit: Apply ease');
  aelibsExpose(EK, 'read', read);
  aelibsExpose(EK, 'count', count);
})();
