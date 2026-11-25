import { SWING_CASES, calibrationForView } from '../src/samples/cases';
import { renderSampleFrame } from '../src/samples/renderer';
import { SwingTracker, finalizeAnalysis } from '../src/lib/tracker';

const spec = SWING_CASES[0];
const view = process.argv[2] === 'face-on' ? 'face-on' : 'side';
const start = Number(process.argv[3] ?? 828);
const end = Number(process.argv[4] ?? 846);
const cal = calibrationForView(view);
const tracker = new SwingTracker(cal, 640, 360);
const t0 = performance.now();
for (let i = start; i <= end; i++) {
  const f = renderSampleFrame(spec, view, i);
  tracker.process(i, f.data);
}
const r = finalizeAnalysis(tracker.observations, cal, 640, 360, performance.now() - t0, end - start + 1);
console.log({ ms: Math.round(r.durationMs), impact: r.impactFrame, speed: r.clubHeadSpeedMps.toFixed(1), streak: r.streakSpeedMps.toFixed(1), traj: r.trajectorySpeedMps.toFixed(1), face: r.faceAngleDeg.toFixed(2), path: r.pathAngleDeg.toFixed(2), samples: r.face.samples });
console.table(tracker.observations.map((o) => ({
  i: o.frame, x: o.x.toFixed(1), y: o.y.toFixed(1), c: o.confidence.toFixed(2),
  L: o.blurLengthPx.toFixed(1), minor: o.bbox.h, fa: o.faceAngleScreenRad === null ? null : (o.faceAngleScreenRad * 180 / Math.PI).toFixed(1), fc: o.faceConfidence.toFixed(2),
})));
