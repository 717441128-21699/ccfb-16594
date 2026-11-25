import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { calibrationForView, SWING_CASES } from '../src/samples/cases';
import { SwingTracker, finalizeAnalysis } from '../src/lib/tracker';

const idPart = process.argv[2] ?? 'b01-straight-side';
const caseSpec = SWING_CASES.find((c) => idPart.startsWith(c.id));
if (!caseSpec) throw new Error(`Unknown case: ${idPart}`);
const view = idPart.endsWith('face-on') ? 'face-on' : 'side';
const file = resolve('public/samples', `${caseSpec.id}-${view}.mp4`);
const width = Number(process.argv[3] ?? 480);
const height = Number(process.argv[4] ?? Math.round(width * 9 / 16 / 2) * 2);
const frameBytes = width * height * 4;
const tracker = new SwingTracker(calibrationForView(view), width, height);

const ff = spawn(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-i', file,
  '-vf', `scale=${width}:${height}`,
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
]);

let pending = Buffer.alloc(0);
let frame = 0;
const started = performance.now();

ff.stdout.on('data', (chunk: Buffer) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= frameBytes) {
    const raw = pending.subarray(0, frameBytes);
    const rgba = new Uint8ClampedArray(raw.buffer, raw.byteOffset, frameBytes);
    tracker.process(frame, rgba);
    frame++;
    pending = pending.subarray(frameBytes);
  }
});

ff.stderr.on('data', (chunk) => process.stderr.write(chunk));
ff.on('close', (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const result = finalizeAnalysis(tracker.observations, calibrationForView(view), width, height, performance.now() - started, frame);
  const speedError = ((result.clubHeadSpeedMps - caseSpec.clubHeadSpeedMps) / caseSpec.clubHeadSpeedMps) * 100;
  const faceError = result.faceAngleDeg - caseSpec.faceAngleDeg;
  console.log({
    file,
    decodedFrames: frame,
    impact: result.impactFrame,
    speed: result.clubHeadSpeedMps.toFixed(2),
    truthSpeed: caseSpec.clubHeadSpeedMps,
    speedErrorPct: speedError.toFixed(2),
    face: result.faceAngleDeg.toFixed(2),
    truthFace: caseSpec.faceAngleDeg,
    faceErrorDeg: faceError.toFixed(2),
    path: result.pathAngleDeg.toFixed(2),
    truthPath: caseSpec.pathAngleDeg,
    shot: result.shot.shape,
    ms: Math.round(performance.now() - started),
  });
});
