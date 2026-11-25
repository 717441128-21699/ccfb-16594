import type { CameraView, Point } from '../types';
import {
  createPixelCalibration,
  deg2rad,
  horizontalAngleToImageVector,
  length,
  normalize,
  sub,
  type PixelCalibration,
} from '../lib/geometry';
import {
  SAMPLE_FPS,
  SAMPLE_FRAMES,
  SAMPLE_IMPACT_FRAME,
  calibrationForView,
  type SwingCaseSpec,
} from './cases';

export interface RenderedFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface SwingFrameState {
  head: Point;
  grip: Point;
  velocityDir: Point;
  speedPxPerFrame: number;
  faceEdgeDir: Point;
  faceNormalDir: Point;
  blurPx: number;
  visible: boolean;
}

const rgba = (r: number, g: number, b: number, a = 255): [number, number, number, number] => [r, g, b, a];

class CanvasBuffer {
  data: Uint8ClampedArray;
  constructor(public width: number, public height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  pixel(x: number, y: number, c: [number, number, number], alpha = 255) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
    const idx = (iy * this.width + ix) * 4;
    const a = alpha / 255;
    this.data[idx] = this.data[idx] * (1 - a) + c[0] * a;
    this.data[idx + 1] = this.data[idx + 1] * (1 - a) + c[1] * a;
    this.data[idx + 2] = this.data[idx + 2] * (1 - a) + c[2] * a;
    this.data[idx + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, c: [number, number, number], alpha = 255) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) this.pixel(xx, yy, c, alpha);
    }
  }

  circle(cx: number, cy: number, radius: number, c: [number, number, number], alpha = 255) {
    const r2 = radius * radius;
    for (let y = -Math.ceil(radius); y <= Math.ceil(radius); y++) {
      for (let x = -Math.ceil(radius); x <= Math.ceil(radius); x++) {
        if (x * x + y * y <= r2) this.pixel(cx + x, cy + y, c, alpha);
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, c: [number, number, number], alpha = 255) {
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const bound = Math.ceil(Math.max(rx, ry) + 2);
    for (let y = -bound; y <= bound; y++) {
      for (let x = -bound; x <= bound; x++) {
        const xr = x * cr + y * sr;
        const yr = -x * sr + y * cr;
        if ((xr * xr) / (rx * rx) + (yr * yr) / (ry * ry) <= 1) this.pixel(cx + x, cy + y, c, alpha);
      }
    }
  }

  line(a: Point, b: Point, widthPx: number, c: [number, number, number], alpha = 255) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 1.4));
    const r = widthPx / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(a.x + dx * t, a.y + dy * t, r, c, alpha);
    }
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

const stateCache = new Map<string, SwingFrameState[]>();
const backgroundCache = new Map<CameraView, Uint8ClampedArray>();

export function getSwingStates(spec: SwingCaseSpec, view: CameraView): SwingFrameState[] {
  const key = `${spec.id}:${view}`;
  const cached = stateCache.get(key);
  if (cached) return cached;

  const cal = calibrationForView(view);
  const pc = createPixelCalibration(cal, 640, 360);
  const impact = { ...pc.ballCenter, x: pc.ballCenter.x - 2, y: pc.ballCenter.y - 1 };
  const pathDir = horizontalAngleToImageVector(deg2rad(spec.pathAngleDeg), pc);
  const attackRad = deg2rad(spec.attackAngleDeg);
  const velocityDir = normalize({ x: pathDir.x, y: pathDir.y + Math.sin(attackRad) * 0.42 });
  const speedPxPerSec = (spec.clubHeadSpeedMps * 1000) / pc.mmPerPx;
  const speedPxPerFrame = speedPxPerSec / SAMPLE_FPS;
  const shaftVector = sub(pc.clubGrip, pc.clubHead);
  const shaftLength = length(shaftVector);
  const impactGrip = { x: impact.x + shaftVector.x, y: impact.y + shaftVector.y };

  const states: SwingFrameState[] = new Array(SAMPLE_FRAMES);
  const downStart = 690;
  const topFrame = 650;
  const addressEnd = 350;
  const backEnd = 620;

  // Backward integration guarantees the exact impact tangent and peak length.
  const heads: Point[] = new Array(SAMPLE_FRAMES);
  heads[SAMPLE_IMPACT_FRAME] = impact;
  for (let i = SAMPLE_IMPACT_FRAME; i > downStart; i--) {
    const beforeSec = (SAMPLE_IMPACT_FRAME - i) / SAMPLE_FPS;
    const speedFactor =
      beforeSec < 0.035 ? 0.985 : beforeSec < 0.18 ? 0.22 + 0.78 * easeOut(1 - beforeSec / 0.18) : 0.18;
    const phase = clamp01((SAMPLE_IMPACT_FRAME - i) / (SAMPLE_IMPACT_FRAME - downStart));
    const rotate = (1 - easeOut(1 - phase)) * deg2rad(spec.pathAngleDeg >= 0 ? 18 : -18);
    const cos = Math.cos(rotate);
    const sin = Math.sin(rotate);
    const dir = { x: velocityDir.x * cos - velocityDir.y * sin, y: velocityDir.x * sin + velocityDir.y * cos };
    const step = speedPxPerFrame * speedFactor;
    heads[i - 1] = { x: heads[i].x - dir.x * step, y: heads[i].y - dir.y * step };
  }

  const topHead = heads[downStart] ?? { x: impact.x - 180, y: impact.y - 150 };
  const addressHead = { ...pc.clubHead };
  for (let i = 0; i <= downStart; i++) {
    if (i <= addressEnd) {
      const waggle = Math.sin(i / 24) * 1.4;
      heads[i] = { x: addressHead.x + waggle, y: addressHead.y - Math.abs(waggle) * 0.25 };
    } else if (i <= backEnd) {
      const t = easeInOut((i - addressEnd) / (backEnd - addressEnd));
      // Backswing travels up and around, not through the downswing path.
      const backTop = { x: view === 'side' ? 238 : 392, y: 58 };
      heads[i] = {
        x: addressHead.x + (backTop.x - addressHead.x) * t + Math.sin(t * Math.PI) * (view === 'side' ? -34 : 38),
        y: addressHead.y + (backTop.y - addressHead.y) * t - Math.sin(t * Math.PI) * 42,
      };
    } else {
      const t = easeInOut((i - backEnd) / (downStart - backEnd));
      const transitionHead = { x: view === 'side' ? 270 : 360, y: 72 };
      const from = i < (backEnd + downStart) / 2 ? heads[backEnd] ?? transitionHead : transitionHead;
      const to = i < (backEnd + downStart) / 2 ? transitionHead : topHead;
      const localT = i < (backEnd + downStart) / 2
        ? easeInOut((i - backEnd) / ((downStart - backEnd) / 2))
        : easeInOut((i - (backEnd + downStart) / 2) / ((downStart - backEnd) / 2));
      heads[i] = { x: from.x + (to.x - from.x) * localT, y: from.y + (to.y - from.y) * localT };
      void t;
    }
  }

  // Forward follow-through.
  for (let i = SAMPLE_IMPACT_FRAME + 1; i < SAMPLE_FRAMES; i++) {
    const afterSec = (i - SAMPLE_IMPACT_FRAME) / SAMPLE_FPS;
    const factor = Math.max(0.12, 1 - afterSec / 1.1);
    const rotate = afterSec * deg2rad(spec.pathAngleDeg >= 0 ? 22 : -22);
    const cos = Math.cos(rotate);
    const sin = Math.sin(rotate);
    const dir = { x: velocityDir.x * cos - velocityDir.y * sin, y: velocityDir.x * sin + velocityDir.y * cos };
    const prev = heads[i - 1] ?? impact;
    heads[i] = { x: prev.x + dir.x * speedPxPerFrame * factor, y: prev.y + dir.y * speedPxPerFrame * factor };
  }

  for (let i = 0; i < SAMPLE_FRAMES; i++) {
    const head = heads[i] ?? impact;
    const prev = heads[Math.max(0, i - 1)] ?? head;
    const next = heads[Math.min(SAMPLE_FRAMES - 1, i + 1)] ?? head;
    const instantaneous = sub(next, prev);
    const instLen = length(instantaneous);
    const velocity = instLen > 0.001 ? normalize(instantaneous) : velocityDir;
    const framesFromImpact = i - SAMPLE_IMPACT_FRAME;
    const nearImpact = Math.abs(framesFromImpact) <= 10;
    const faceDeg = spec.faceAngleDeg + (nearImpact ? framesFromImpact * 0.015 : Math.sin(i / 31) * 8);
    const faceNormal = horizontalAngleToImageVector(deg2rad(faceDeg), pc);
    const faceEdge = horizontalAngleToImageVector(deg2rad(faceDeg + 90), pc);
    const blurPx = ((spec.clubHeadSpeedMps * cal.exposureSec * 1000) / pc.mmPerPx) *
      (i >= downStart && i <= 980 ? 1 : 0.25);

    let grip: Point;
    if (Math.abs(framesFromImpact) < 24) {
      const gripTarget = { x: head.x + shaftVector.x, y: head.y + shaftVector.y };
      const k = 1 - Math.min(1, Math.abs(framesFromImpact) / 24) * 0.35;
      grip = {
        x: head.x + shaftVector.x * k + (gripTarget.x - head.x - shaftVector.x * k),
        y: head.y + shaftVector.y * k,
      };
      // The expression above is intentionally just the impact shaft near contact.
      grip = { x: head.x + shaftVector.x, y: head.y + shaftVector.y };
    } else if (i < downStart) {
      const t = clamp01(i / downStart);
      grip = {
        x: pc.clubGrip.x + (view === 'side' ? 205 : -118) * easeInOut(t),
        y: pc.clubGrip.y - 12 * Math.sin(t * Math.PI),
      };
    } else {
      const t = clamp01((i - SAMPLE_IMPACT_FRAME) / 180);
      grip = {
        x: impactGrip.x + (view === 'side' ? 120 : -80) * easeOut(t),
        y: impactGrip.y - 70 * easeOut(t),
      };
    }

    states[i] = {
      head,
      grip,
      velocityDir: velocity,
      speedPxPerFrame: instLen / 2,
      faceEdgeDir: faceEdge,
      faceNormalDir: faceNormal,
      blurPx,
      visible: i > 120 && i < 1080,
    };
  }

  stateCache.set(key, states);
  return states;
}

function drawBackground(buf: CanvasBuffer, view: CameraView, frame: number) {
  const { width, height } = buf;
  const horizon = view === 'side' ? 166 : 178;
  for (let y = 0; y < height; y++) {
    let c: [number, number, number];
    if (y < horizon) {
      const t = y / horizon;
      c = [Math.round(143 + 70 * t), Math.round(190 + 35 * t), Math.round(224 + 18 * t)];
    } else {
      const t = (y - horizon) / (height - horizon);
      const stripe = Math.floor((y - horizon) / 18) % 2 === 0;
      c = stripe
        ? [Math.round(67 - 12 * t), Math.round(132 - 28 * t), Math.round(58 - 12 * t)]
        : [Math.round(58 - 10 * t), Math.round(119 - 24 * t), Math.round(52 - 10 * t)];
    }
    for (let x = 0; x < width; x++) buf.data.set([c[0], c[1], c[2], 255], (y * width + x) * 4);
  }

  // Distant fence / tree blocks give the tracker static texture.
  for (let i = 0; i < 18; i++) {
    const x = (i * 47 + 23) % width;
    const h = 18 + ((i * 13) % 26);
    buf.rect(x, horizon - h, 22 + (i % 3) * 10, h, [38, 91, 48], 180);
  }
  buf.rect(0, horizon - 4, width, 4, [225, 230, 220], 160);

  // Mowing perspective lines.
  for (let i = -4; i <= 5; i++) {
    const x0 = width / 2 + i * 28;
    buf.line({ x: x0, y: horizon + 2 }, { x: width / 2 + i * 150, y: height }, 2, [210, 230, 190], 42);
  }

  // Mild moving sensor grain, deterministic and cheap.
  for (let idx = 0; idx < buf.data.length; idx += 4) {
    const n = Math.sin(idx * 12.9898 + frame * 78.233) * 43758.5453;
    const g = (n - Math.floor(n) - 0.5) * 9;
    buf.data[idx] = Math.max(0, Math.min(255, buf.data[idx] + g));
    buf.data[idx + 1] = Math.max(0, Math.min(255, buf.data[idx + 1] + g));
    buf.data[idx + 2] = Math.max(0, Math.min(255, buf.data[idx + 2] + g));
  }
}

function drawGolfer(buf: CanvasBuffer, view: CameraView, state: SwingFrameState, frame: number) {
  const feet = view === 'side' ? { x: 286, y: 318 } : { x: 330, y: 320 };
  buf.ellipse(feet.x, feet.y + 5, 54, 10, 0, [20, 35, 24], 90);

  const bodyTop = { x: feet.x + (view === 'side' ? -10 : 4), y: 178 };
  const sway = Math.sin(frame / 90) * 2;
  const torsoTop = { x: bodyTop.x + sway, y: 174 };
  buf.line({ x: feet.x - 18, y: feet.y }, { x: bodyTop.x - 8, y: 238 }, 13, [31, 42, 58], 255);
  buf.line({ x: feet.x + 18, y: feet.y }, { x: bodyTop.x + 8, y: 238 }, 13, [31, 42, 58], 255);
  buf.line({ x: bodyTop.x, y: 238 }, torsoTop, 22, [214, 88, 42], 255);
  buf.circle(torsoTop.x, torsoTop.y - 20, 15, [224, 178, 132], 255);
  buf.ellipse(torsoTop.x, torsoTop.y - 31, 17, 7, 0, [235, 238, 242], 255);

  // Arms connect torso to grip.
  const shoulder = { x: torsoTop.x + (view === 'side' ? -4 : 5), y: torsoTop.y + 14 };
  buf.line(shoulder, state.grip, 9, [224, 178, 132], 230);
  buf.line({ x: shoulder.x + 12, y: shoulder.y + 2 }, state.grip, 8, [210, 164, 120], 220);
}

function drawBall(buf: CanvasBuffer, pc: PixelCalibration, frame: number) {
  const { ballCenter: c, ballRadiusPx: r } = pc;
  buf.circle(c.x + 2, c.y + 3, r + 1, [20, 35, 24], 80);
  buf.circle(c.x, c.y, r, [246, 248, 245], 255);
  buf.circle(c.x - r * 0.32, c.y - r * 0.35, r * 0.32, [255, 255, 255], 220);
  // Dimples.
  for (let i = 0; i < 7; i++) {
    const a = i * 2.399 + frame * 0.002;
    const rr = r * (0.25 + 0.45 * ((i % 3) / 3));
    buf.pixel(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, [180, 188, 184], 180);
  }
}

function drawClub(buf: CanvasBuffer, state: SwingFrameState) {
  const { head, grip, velocityDir, blurPx, faceEdgeDir } = state;

  // Motion-blur streak: several exposed head stamps plus a soft capsule.
  if (blurPx > 2 && state.speedPxPerFrame > 3) {
    const tail = { x: head.x - velocityDir.x * blurPx, y: head.y - velocityDir.y * blurPx };
    buf.line(tail, head, 11, [24, 29, 36], 42);
    buf.line(
      { x: head.x - velocityDir.x * blurPx * 0.72, y: head.y - velocityDir.y * blurPx * 0.72 },
      head,
      7,
      [35, 42, 52],
      70,
    );
    for (let k = 1; k <= 5; k++) {
      const t = k / 6;
      const p = { x: head.x - velocityDir.x * blurPx * t, y: head.y - velocityDir.y * blurPx * t };
      buf.ellipse(p.x, p.y, 8 - k * 0.5, 4.5, Math.atan2(velocityDir.y, velocityDir.x), [28, 34, 42], 34);
    }
  }

  // Shaft and grip.
  buf.line(grip, head, 4, [18, 22, 28], 245);
  const gripEnd = {
    x: grip.x + normalize(sub(grip, head)).x * 24,
    y: grip.y + normalize(sub(grip, head)).y * 24,
  };
  buf.line(gripEnd, grip, 8, [18, 20, 24], 255);

  // Club head, rotated to face-edge direction.
  const faceRot = Math.atan2(faceEdgeDir.y, faceEdgeDir.x);
  buf.ellipse(head.x, head.y, 11, 7, faceRot, [28, 33, 42], 255);
  buf.ellipse(head.x - 1, head.y - 1, 8, 4.5, faceRot, [54, 63, 76], 180);

  // Bright leading edge / face insert used by the angle estimator.
  const half = 8.5;
  const a = { x: head.x - faceEdgeDir.x * half, y: head.y - faceEdgeDir.y * half };
  const b = { x: head.x + faceEdgeDir.x * half, y: head.y + faceEdgeDir.y * half };
  buf.line(a, b, 3.2, [226, 238, 248], 255);
  buf.line(a, b, 1.2, [255, 255, 255], 230);
}

export function renderSampleFrame(spec: SwingCaseSpec, view: CameraView, frameIndex: number): RenderedFrame {
  const width = 640;
  const height = 360;
  const buf = new CanvasBuffer(width, height);
  let background = backgroundCache.get(view);
  if (!background) {
    const bgBuf = new CanvasBuffer(width, height);
    drawBackground(bgBuf, view, 0);
    background = bgBuf.data.slice();
    backgroundCache.set(view, background);
  }
  buf.data.set(background);
  const cal = calibrationForView(view);
  const pc = createPixelCalibration(cal, width, height);
  const states = getSwingStates(spec, view);
  const frame = Math.max(0, Math.min(SAMPLE_FRAMES - 1, Math.round(frameIndex)));
  const state = states[frame];

  // Calibration target ribbon is subtle and part of the scene.
  buf.line(pc.targetFrom, pc.targetTo, 2, [255, 255, 255], 70);

  drawGolfer(buf, view, state, frame);
  drawBall(buf, pc, frame);
  if (state.visible) drawClub(buf, state);

  return { width, height, data: buf.data };
}

export function renderSampleRgba(spec: SwingCaseSpec, view: CameraView, frameIndex: number): Uint8ClampedArray {
  return renderSampleFrame(spec, view, frameIndex).data;
}
