import { SWING_CASES, SAMPLE_IMPACT_FRAME } from '../src/samples/cases';
import { renderSampleFrame, getSwingStates } from '../src/samples/renderer';
import { SwingTracker, finalizeAnalysis } from '../src/lib/tracker';

const caseIndex = Number(process.argv[3] ?? 0);
const spec = SWING_CASES[Number.isFinite(caseIndex) ? caseIndex : 0];
const view = process.argv[2] === 'face-on' ? 'face-on' : 'side';
const cal = (await import('../src/samples/cases')).calibrationForView(view);
const tracker = new SwingTracker(cal, 640, 360);
const t0 = performance.now();
for (let i = 0; i < 1200; i++) {
  const f = renderSampleFrame(spec, view, i);
  tracker.process(i, f.data);
}
const r = finalizeAnalysis(tracker.observations, cal, 640, 360, performance.now() - t0, 1200);
console.log({
  view,
  ms: Math.round(r.durationMs),
  impact: r.impactFrame,
  truthImpact: 840,
  speed: r.clubHeadSpeedMps.toFixed(2),
  truthSpeed: spec.clubHeadSpeedMps,
  streak: r.streakSpeedMps.toFixed(2),
  traj: r.trajectorySpeedMps.toFixed(2),
  face: r.faceAngleDeg.toFixed(2),
  truthFace: spec.faceAngleDeg,
  path: r.pathAngleDeg.toFixed(2),
  truthPath: spec.pathAngleDeg,
  faceSamples: r.face.samples,
  conf: r.face.confidence.toFixed(2),
  shot: r.shot.shape,
  warnings: r.warnings,
});
const top = tracker.observations.map((o, i) => {
  const prev = tracker.observations[Math.max(0, i - 2)];
  const next = tracker.observations[Math.min(tracker.observations.length - 1, i + 2)];
  const dt = Math.max(1, (next.frame - prev.frame) / 2);
  const anchorSpeed = Math.hypot(next.x - prev.x, next.y - prev.y) / dt;
  const streakScore = o.blurValid ? Math.min(1, Math.max(0, (o.blurLengthPx - 12) / 12)) : 0;
  const ballDist = Math.hypot(o.x - (320), o.y - 255);
  const proximity = Math.max(0, 1 - ballDist / 68.6);
  const score = Math.min(1.4, anchorSpeed / 42) * 1.25 + proximity * .9 + streakScore * .35 + o.faceConfidence * .2;
  return { i, frame: o.frame, x: o.x.toFixed(1), y: o.y.toFixed(1), c: o.confidence.toFixed(2), L: o.blurLengthPx.toFixed(1), fc: o.faceConfidence.toFixed(2), speed: anchorSpeed.toFixed(1), score: score.toFixed(2), ball: ballDist.toFixed(0) };
}).sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 12);
console.table(top);
const sparse = tracker.observations.filter((o) => o.frame % 60 === 0 || [350, 650, 690, 760, 800, 820, 830].includes(o.frame)).map((o) => ({
  i: o.frame,
  x: o.x.toFixed(1),
  y: o.y.toFixed(1),
  c: o.confidence.toFixed(2),
  L: o.blurLengthPx.toFixed(1),
}));
console.table(sparse);
const truth = getSwingStates(spec, view).slice(836, 845).map((s, idx) => ({
  i: 836 + idx,
  x: s.head.x.toFixed(1),
  y: s.head.y.toFixed(1),
  vx: s.velocityDir.x.toFixed(2),
  vy: s.velocityDir.y.toFixed(2),
  spf: s.speedPxPerFrame.toFixed(1),
  blur: s.blurPx.toFixed(1),
}));
console.table(truth);
const around = tracker.observations.slice(836, 845).map((o) => ({
  i: o.frame,
  x: o.x.toFixed(1),
  y: o.y.toFixed(1),
  c: o.confidence.toFixed(2),
  L: o.blurLengthPx.toFixed(1),
  a: (o.blurAngleRad * 180 / Math.PI).toFixed(1),
  fc: o.faceConfidence.toFixed(2),
  fa: o.faceAngleScreenRad === null ? null : (o.faceAngleScreenRad * 180 / Math.PI).toFixed(1),
}));
console.table(around);
