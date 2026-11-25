import type { AnalysisResult, Calibration, Point, TrackObservation } from '../types';
import {
  clamp,
  createPixelCalibration,
  cross,
  dot,
  imageVectorToHorizontalAngle,
  median,
  rad2deg,
  type PixelCalibration,
} from './geometry';
import { blurLengthToSpeed, estimateShot, fuseSpeed, MPS_TO_MPH } from './shotPhysics';

interface Candidate {
  cx: number;
  cy: number;
  headX: number;
  headY: number;
  axisX: number;
  axisY: number;
  majorLength: number;
  minorLength: number;
  weight: number;
  count: number;
  faceAngleScreenRad: number | null;
  faceConfidence: number;
  bbox: TrackObservation['bbox'];
}

export interface TrackerOptions {
  maxFrames?: number;
  onProgress?: (processed: number, total?: number) => void;
}

function luminance(data: Uint8ClampedArray | Uint8Array, i: number): number {
  return 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function estimateFace(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  headX: number,
  headY: number,
  radius: number,
): { angleRad: number | null; confidence: number } {
  const x0 = Math.max(0, Math.floor(headX - radius));
  const x1 = Math.min(width, Math.ceil(headX + radius));
  const y0 = Math.max(0, Math.floor(headY - radius));
  const y1 = Math.min(height, Math.ceil(headY + radius));
  const pts: Array<{ x: number; y: number; w: number }> = [];

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - headX;
      const dy = y - headY;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = (y * width + x) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const bright = r > 176 && g > 188 && b > 198 && Math.max(r, g, b) - Math.min(r, g, b) < 42;
      if (!bright) continue;
      // Require a nearby dark club pixel so sky/grass highlights are rejected.
      let nearDark = false;
      for (let oy = -3; oy <= 3 && !nearDark; oy += 2) {
        for (let ox = -3; ox <= 3; ox += 2) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = (ny * width + nx) * 4;
          if (rgba[ni] + rgba[ni + 1] + rgba[ni + 2] < 250) nearDark = true;
        }
      }
      if (nearDark) pts.push({ x, y, w: 1 });
    }
  }

  if (pts.length < 7) return { angleRad: null, confidence: 0 };
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const eigenvalueGap = Math.hypot(sxx - syy, 2 * sxy);
  const total = sxx + syy + 1e-6;
  const confidence = Math.min(1, pts.length / 34) * Math.min(1, eigenvalueGap / total + 0.25);
  return { angleRad: angle, confidence };
}

export class SwingTracker {
  readonly pc: PixelCalibration;
  private gray: Uint8Array;
  private bg: Uint8Array;
  private prev: Uint8Array;
  private hasPrev = false;
  private velocity = { x: 0, y: 0 };
  private lastHead: { x: number; y: number };
  private lastCandidate: Candidate | null = null;
  readonly observations: TrackObservation[] = [];

  constructor(
    calibration: Calibration,
    public readonly width: number,
    public readonly height: number,
  ) {
    this.pc = createPixelCalibration(calibration, width, height);
    this.gray = new Uint8Array(width * height);
    this.bg = new Uint8Array(width * height);
    this.prev = new Uint8Array(width * height);
    this.lastHead = { ...this.pc.clubHead };
  }

  private updateGray(rgba: Uint8ClampedArray | Uint8Array) {
    for (let i = 0, p = 0; i < this.gray.length; i++, p += 4) {
      this.gray[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
    }
    if (!this.hasPrev) {
      this.bg.set(this.gray);
      this.prev.set(this.gray);
    }
  }

  private findCandidate(
    rgba: Uint8ClampedArray | Uint8Array,
    center: { x: number; y: number },
    radius: number,
    orientHint: { x: number; y: number } | null,
  ): Candidate | null {
    const { width, height } = this;
    const x0 = Math.max(1, Math.floor(center.x - radius));
    const x1 = Math.min(width - 1, Math.ceil(center.x + radius));
    const y0 = Math.max(1, Math.floor(center.y - radius));
    const y1 = Math.min(height - 1, Math.ceil(center.y + radius));
    const pts: Array<{ x: number; y: number; w: number }> = [];
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * width + x;
        const g = this.gray[i];
        const dark = Math.max(0, this.bg[i] - g - 7);
        const temporal = this.hasPrev ? Math.abs(g - this.prev[i]) : 0;
        const w = dark * 1.35 + temporal * 0.55;
        if (w < 30) continue;
        // Suppress a few isolated codec grains.
        if (w < 48 && temporal < 34) continue;
        pts.push({ x, y, w });
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (pts.length < 10) return null;

    // Weighted centre and covariance.
    let sw = 0;
    let mx = 0;
    let my = 0;
    for (const p of pts) {
      sw += p.w;
      mx += p.x * p.w;
      my += p.y * p.w;
    }
    if (sw <= 0) return null;
    mx /= sw;
    my /= sw;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      const dx = p.x - mx;
      const dy = p.y - my;
      sxx += dx * dx * p.w;
      syy += dy * dy * p.w;
      sxy += dx * dy * p.w;
    }
    sxx /= sw;
    syy /= sw;
    sxy /= sw;
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let axis = { x: Math.cos(theta), y: Math.sin(theta) };

    // Orient the streak using predicted motion; otherwise put the current
    // head endpoint toward the ball/calibration impact point.
    const hint = orientHint ?? { x: this.pc.ballCenter.x - mx, y: this.pc.ballCenter.y - my };
    if (axis.x * hint.x + axis.y * hint.y < 0) axis = { x: -axis.x, y: -axis.y };

    const along: number[] = [];
    const perp: number[] = [];
    for (const p of pts) {
      const dx = p.x - mx;
      const dy = p.y - my;
      along.push(dx * axis.x + dy * axis.y);
      perp.push(-dx * axis.y + dy * axis.x);
    }
    along.sort((a, b) => a - b);
    perp.sort((a, b) => a - b);
    const low = pct(along, 0.03);
    const high = pct(along, 0.97);
    const majorLength = Math.max(4, high - low);
    const minorLength = Math.max(3, pct(perp, 0.97) - pct(perp, 0.03));

    // Current head is the positive endpoint in direction of travel.
    const headProjection = high;
    const headX = mx + axis.x * headProjection;
    const headY = my + axis.y * headProjection;
    const headRadius = Math.max(9, minorLength * 0.75);
    const face = estimateFace(rgba, width, height, headX, headY, headRadius + 7);

    const areaWeight = Math.min(1, pts.length / 220);
    const elongation = majorLength / Math.max(4, minorLength);
    const streakScore = Math.min(1, Math.max(0.25, elongation / 3.2));
    const weight = areaWeight * (0.55 + 0.45 * streakScore) * Math.min(1, sw / 9000);

    return {
      cx: mx,
      cy: my,
      headX,
      headY,
      axisX: axis.x,
      axisY: axis.y,
      majorLength,
      minorLength,
      weight,
      count: pts.length,
      faceAngleScreenRad: face.angleRad,
      faceConfidence: face.confidence,
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    };
  }

  private detectFaceAnchor(
    rgba: Uint8ClampedArray | Uint8Array,
    searchRadius = 0,
  ): Candidate | null {
    const { width, height, pc } = this;
    let x0 = 1;
    let x1 = width - 1;
    let y0 = 1;
    let y1 = height - 1;
    if (searchRadius > 0) {
      x0 = Math.max(1, Math.floor(this.lastHead.x - searchRadius));
      x1 = Math.min(width - 1, Math.ceil(this.lastHead.x + searchRadius));
      y0 = Math.max(1, Math.floor(this.lastHead.y - searchRadius));
      y1 = Math.min(height - 1, Math.ceil(this.lastHead.y + searchRadius));
    } else {
      // Only search the ball/target corridor. This rejects sky/tree edges and
      // keeps the worker fast enough for 1200-frame clips.
      const t = pc.targetVector;
      const n = { x: -t.y, y: t.x };
      const corners: Point[] = [];
      for (const a of [-350, 350]) {
        for (const b of [-62, 62]) {
          corners.push({ x: pc.ballCenter.x + t.x * a + n.x * b, y: pc.ballCenter.y + t.y * a + n.y * b });
        }
      }
      x0 = Math.max(1, Math.floor(Math.min(...corners.map((p) => p.x))));
      x1 = Math.min(width - 1, Math.ceil(Math.max(...corners.map((p) => p.x))));
      y0 = Math.max(1, Math.floor(Math.min(...corners.map((p) => p.y))));
      y1 = Math.min(height - 1, Math.ceil(Math.max(...corners.map((p) => p.y))));
    }
    const mask = new Uint8Array((x1 - x0) * (y1 - y0));
    const mw = x1 - x0;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        const bright = r > 174 && g > 187 && b > 198 && Math.max(r, g, b) - Math.min(r, g, b) < 48;
        if (!bright) continue;
        let nearDark = false;
        const rowBytes = width * 4;
        const offsets = [
          -4 * rowBytes,
          4 * rowBytes,
          -4,
          4,
          -2 * rowBytes - 8,
          -2 * rowBytes + 8,
          2 * rowBytes - 8,
          2 * rowBytes + 8,
        ];
        for (const off of offsets) {
          const j = i + off;
          if (j < 0 || j + 2 >= rgba.length) continue;
          if (rgba[j] + rgba[j + 1] + rgba[j + 2] < 260) {
            nearDark = true;
            break;
          }
        }
        if (nearDark) mask[(y - y0) * mw + (x - x0)] = 1;
      }
    }

    // Connected components with a compact stack-based flood fill.
    const visited = new Uint8Array(mask.length);
    let best: Candidate | null = null;
    for (let idx = 0; idx < mask.length; idx++) {
      if (!mask[idx] || visited[idx]) continue;
      const stack = [idx];
      visited[idx] = 1;
      const pts: Array<{ x: number; y: number }> = [];
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      while (stack.length) {
        const cur = stack.pop() as number;
        const cx = x0 + (cur % mw);
        const cy = y0 + Math.floor(cur / mw);
        pts.push({ x: cx, y: cy });
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const nb of [cur - 1, cur + 1, cur - mw, cur + mw]) {
          if (nb < 0 || nb >= mask.length || visited[nb] || !mask[nb]) continue;
          // Prevent row wrapping.
          const ax = x0 + (nb % mw);
          if (Math.abs(ax - cx) > 1) continue;
          visited[nb] = 1;
          stack.push(nb);
        }
      }
      if (pts.length < 7 || pts.length > 110) continue;
      let mx = 0;
      let my = 0;
      for (const p of pts) {
        mx += p.x;
        my += p.y;
      }
      mx /= pts.length;
      my /= pts.length;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const p of pts) {
        const dx = p.x - mx;
        const dy = p.y - my;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
      }
      const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const axis = { x: Math.cos(angle), y: Math.sin(angle) };
      const along = pts.map((p) => (p.x - mx) * axis.x + (p.y - my) * axis.y).sort((a, b) => a - b);
      const perpAxis = { x: -axis.y, y: axis.x };
      const perp = pts.map((p) => (p.x - mx) * perpAxis.x + (p.y - my) * perpAxis.y).sort((a, b) => a - b);
      const major = pct(along, 0.98) - pct(along, 0.02);
      const minor = pct(perp, 0.95) - pct(perp, 0.05);
      if (major < 8 || major > 34 || minor > 9) continue;
      const rel = { x: mx - pc.ballCenter.x, y: my - pc.ballCenter.y };
      const alongTarget = dot(rel, pc.targetVector);
      const normalTarget = Math.abs(cross(pc.targetVector, rel));
      if (Math.abs(alongTarget) > 350 || normalTarget > 66) continue;

      // Score prefers a line close to the ball corridor/predicted head and
      // with a dark club blob immediately around it.
      const ballDistance = Math.hypot(mx - pc.ballCenter.x, my - pc.ballCenter.y);
      const lastDistance = Math.hypot(mx - this.lastHead.x, my - this.lastHead.y);
      const proximity = Math.max(0, 1 - ballDistance / (Math.max(width, height) * 0.75));
      const continuity = Math.max(0, 1 - lastDistance / 220);
      const score = Math.min(1, pts.length / 38) * Math.min(1, major / 15) *
        (0.18 + proximity * 0.67 + continuity * 0.15);
      if (!best || score > best.weight) {
        best = {
          cx: mx,
          cy: my,
          headX: mx,
          headY: my,
          axisX: axis.x,
          axisY: axis.y,
          majorLength: major + 12,
          minorLength: Math.max(7, minor + 8),
          weight: score,
          count: pts.length,
          faceAngleScreenRad: angle,
          faceConfidence: Math.min(1, score + 0.25),
          bbox: { x: minX - 8, y: minY - 8, w: maxX - minX + 17, h: maxY - minY + 17 },
        };
      }
    }
    return best;
  }

  private measureStreak(
    center: Point,
    directionHint: Point,
  ): { extentPx: number; angleRad: number; confidence: number } {
    const dir0 = Math.hypot(directionHint.x, directionHint.y) > 0.1
      ? directionHint
      : this.pc.targetVector;
    let best = { extentPx: 0, angleRad: Math.atan2(dir0.y, dir0.x), confidence: 0 };

    for (const deltaDeg of [-18, -9, 0, 9, 18]) {
      const a = Math.atan2(dir0.y, dir0.x) + (deltaDeg * Math.PI) / 180;
      const fwd = { x: Math.cos(a), y: Math.sin(a) };
      const back = { x: -fwd.x, y: -fwd.y };
      const perp = { x: -back.y, y: back.x };
      const scores: number[] = [];
      for (let d = 0; d <= 38; d++) {
        let sum = 0;
        let n = 0;
        for (let w = -2; w <= 2; w++) {
          const x = Math.round(center.x + back.x * d + perp.x * w);
          const y = Math.round(center.y + back.y * d + perp.y * w);
          if (x < 1 || y < 1 || x >= this.width - 1 || y >= this.height - 1) continue;
          const idx = y * this.width + x;
          sum += Math.max(0, this.bg[idx] - this.gray[idx] - 5);
          n++;
        }
        scores.push(n ? sum / n : 0);
      }
      const tail = scores.slice(28);
      const baseline = tail.reduce((s, v) => s + v, 0) / Math.max(1, tail.length);
      let extent = 0;
      let misses = 0;
      for (let d = 2; d < scores.length; d++) {
        const strong = scores[d] > baseline + 11 && scores[d] > 15;
        if (strong) {
          extent = d;
          misses = 0;
        } else {
          misses++;
          if (misses >= 3) break;
        }
      }
      const energy = scores.slice(0, Math.max(4, extent)).reduce((s, v) => s + v, 0);
      const confidence = Math.min(1, energy / 900) * Math.min(1, extent / 14);
      if (extent > best.extentPx + 1 || (extent === best.extentPx && confidence > best.confidence)) {
        best = { extentPx: extent, angleRad: a, confidence };
      }
    }
    return best;
  }

  process(frame: number, rgba: Uint8ClampedArray | Uint8Array): TrackObservation {
    this.updateGray(rgba);

    const predicted = {
      x: this.lastHead.x + this.velocity.x * 1.35,
      y: this.lastHead.y + this.velocity.y * 1.35,
    };
    const speedGuess = Math.hypot(this.velocity.x, this.velocity.y);
    const radii = [
      Math.max(42, Math.min(92, 34 + speedGuess * 1.15)),
      Math.max(90, Math.min(170, 70 + speedGuess * 1.8)),
      Math.max(180, Math.round(Math.min(this.width, this.height) * 0.72)),
    ];

    let candidate: Candidate | null = null;

    // The bright leading edge is the most stable club-head anchor through the
    // fastest frames. Search it globally first; motion/streak PCA then measures
    // blur length around that anchor instead of latching onto arms or torso.
    // During the long static address/backswing section a global edge can
    // otherwise acquire the tracker. Keep the face-line search local until the
    // downswing, then open the target corridor for the high-speed crossing.
    const faceSearchRadius = frame < 660 ? 86 : 0;
    const faceAnchor = this.detectFaceAnchor(rgba, faceSearchRadius);
    if (faceAnchor && faceAnchor.weight > 0.34) {
      const streak = this.measureStreak(
        { x: faceAnchor.headX, y: faceAnchor.headY },
        speedGuess > 4 ? this.velocity : this.pc.targetVector,
      );
      candidate = {
        ...faceAnchor,
        axisX: Math.cos(streak.angleRad),
        axisY: Math.sin(streak.angleRad),
        // Raw dark extent includes roughly one head radius. finalizeAnalysis
        // subtracts the compact bbox diameter to recover exposure displacement.
        majorLength: Math.max(13, streak.extentPx + 7),
        minorLength: 10,
        weight: Math.max(faceAnchor.weight, 0.35 + streak.confidence * 0.5),
        bbox: { ...faceAnchor.bbox, h: 14, w: 18 },
      };
    }

    if (!candidate || candidate.weight < 0.22) {
      const radii = [
        Math.max(42, Math.min(92, 34 + speedGuess * 1.15)),
        Math.max(90, Math.min(170, 70 + speedGuess * 1.8)),
      ];
      for (let r = 0; r < radii.length && (!candidate || candidate.weight < 0.18); r++) {
        const radius = radii[r];
        const centers = r === 0
          ? [predicted, this.lastHead, this.pc.ballCenter]
          : [predicted, this.lastHead, this.pc.ballCenter, { x: this.width / 2, y: this.height * 0.62 }];
        for (const c of centers) {
          const found = this.findCandidate(rgba, c, radius, speedGuess > 2 ? this.velocity : null);
          if (!found) continue;
          const headDistance = Math.hypot(found.headX - this.lastHead.x, found.headY - this.lastHead.y);
          const gate = radius * 1.35 + 30;
          const proximity = Math.max(0.25, 1 - headDistance / Math.max(120, gate * 2.2));
          found.weight *= proximity;
          if (!candidate || found.weight > candidate.weight) candidate = found;
        }
      }
    }

    // Background adapts quickly to newly revealed static pixels.
    for (let i = 0; i < this.bg.length; i++) {
      const g = this.gray[i];
      if (g > this.bg[i]) this.bg[i] = g;
      else this.bg[i] = this.bg[i] * 0.985 + g * 0.015;
    }

    if (!candidate) {
      candidate = {
        cx: this.lastHead.x,
        cy: this.lastHead.y,
        headX: this.lastHead.x,
        headY: this.lastHead.y,
        axisX: this.velocity.x || 1,
        axisY: this.velocity.y || 0,
        majorLength: 0,
        minorLength: 0,
        weight: 0,
        count: 0,
        faceAngleScreenRad: null,
        faceConfidence: 0,
        bbox: { x: this.lastHead.x - 8, y: this.lastHead.y - 8, w: 16, h: 16 },
      };
    }

    const dtFrames = 1;
    const newVelocity = { x: candidate.headX - this.lastHead.x, y: candidate.headY - this.lastHead.y };
    if (candidate.weight > 0.12 && Math.hypot(newVelocity.x, newVelocity.y) < this.width * 0.75) {
      const alpha = 0.55;
      this.velocity = {
        x: this.velocity.x * (1 - alpha) + newVelocity.x / dtFrames * alpha,
        y: this.velocity.y * (1 - alpha) + newVelocity.y / dtFrames * alpha,
      };
      this.lastHead = { x: candidate.headX, y: candidate.headY };
      this.lastCandidate = candidate;
    }

    const speedPx = Math.hypot(this.velocity.x, this.velocity.y);
    const blurValid = candidate.majorLength > candidate.minorLength * 1.35 && candidate.majorLength >= 10;
    const obs: TrackObservation = {
      frame,
      timeSec: frame / 240,
      x: candidate.headX,
      y: candidate.headY,
      confidence: candidate.weight,
      blurLengthPx: candidate.majorLength,
      blurAngleRad: Math.atan2(candidate.axisY, candidate.axisX),
      blurValid,
      faceAngleScreenRad: candidate.faceAngleScreenRad,
      faceConfidence: candidate.faceConfidence * candidate.weight,
      score: candidate.weight * Math.min(2, candidate.majorLength / 18),
      headDiameterPx: candidate.minorLength ? Math.max(10, candidate.minorLength * 1.35) : 14,
      bbox: candidate.bbox,
    };
    this.observations.push(obs);
    this.prev.set(this.gray);
    this.hasPrev = true;
    return obs;
  }
}

function wrapFaceDeg(deg: number): number {
  return ((((deg + 90) % 180) + 180) % 180) - 90;
}

export function finalizeAnalysis(
  observations: TrackObservation[],
  calibration: Calibration,
  width: number,
  height: number,
  elapsedMs: number,
  frameCount: number,
): AnalysisResult {
  const pc = createPixelCalibration(calibration, width, height);
  const warnings: string[] = [];
  if (observations.length < 30) warnings.push('有效跟踪帧较少，建议提高反差或重新标定。');

  // Impact is the high-speed crossing closest to the ball. Raw component size
  // is not enough because the shaft/arms form long components, so score the
  // local frame-to-frame anchor velocity and compact streak estimate.
  let impactIndex = 0;
  const impactGatePx = Math.max(58, pc.ballRadiusPx * 9);

  let bestImpactScore = -Infinity;
  for (let i = 4; i < observations.length - 4; i++) {
    const center = observations[i];
    const ballDist = Math.hypot(center.x - pc.ballCenter.x, center.y - pc.ballCenter.y);
    if (ballDist > impactGatePx * 1.5) continue;

    const vectors: Point[] = [];
    for (let j = i - 5; j < i + 5; j++) {
      const a = observations[j];
      const b = observations[j + 1];
      if (!a || !b || b.frame - a.frame > 2 || a.confidence < 0.48 || b.confidence < 0.48) continue;
      const gap = b.frame - a.frame;
      vectors.push({ x: (b.x - a.x) / gap, y: (b.y - a.y) / gap });
    }
    if (vectors.length < 4) continue;
    const mvx = median(vectors.map((v) => v.x));
    const mvy = median(vectors.map((v) => v.y));
    const speed = Math.hypot(mvx, mvy);
    if (speed < 26) continue;
    const residual = median(vectors.map((v) => Math.hypot(v.x - mvx, v.y - mvy)));
    const consistency = clamp(1 - residual / Math.max(18, speed), 0, 1);
    if (consistency < 0.45) continue;
    const proximity = Math.max(0, 1 - ballDist / impactGatePx);
    const score = Math.min(1.3, speed / 58) + consistency * 1.1 +
      Math.min(1, vectors.length / 8) * 0.45 + proximity * 0.7 + center.faceConfidence * 0.2;
    if (score > bestImpactScore) {
      bestImpactScore = score;
      impactIndex = i;
    }
  }

  if (!Number.isFinite(bestImpactScore) || bestImpactScore < 0) {
    let impactScore = -Infinity;
    for (let i = 0; i < observations.length; i++) {
      const o = observations[i];
      const ballDist = Math.hypot(o.x - pc.ballCenter.x, o.y - pc.ballCenter.y);
      if (ballDist > impactGatePx * 1.8) continue;
      const prev = observations[Math.max(0, i - 2)];
      const next = observations[Math.min(observations.length - 1, i + 2)];
      const dt = Math.max(1, next.frame - prev.frame);
      const anchorSpeed = Math.hypot(next.x - prev.x, next.y - prev.y) / dt;
      const speedScore = Math.min(1.4, anchorSpeed / 42);
      const streakScore = o.blurValid ? Math.min(1, Math.max(0, (o.blurLengthPx - 12) / 12)) : 0;
      const score = speedScore * 1.25 + Math.max(0, 1 - ballDist / impactGatePx) * 0.9 +
        streakScore * 0.35 + o.faceConfidence * 0.2;
      if (score > impactScore) {
        impactScore = score;
        impactIndex = i;
      }
    }
  }
  const impact = observations[impactIndex] ?? {
    frame: 0,
    timeSec: 0,
    x: pc.ballCenter.x,
    y: pc.ballCenter.y,
    confidence: 0,
    blurLengthPx: 0,
    blurAngleRad: 0,
    blurValid: false,
    faceAngleScreenRad: null,
    faceConfidence: 0,
    score: 0,
    bbox: { x: 0, y: 0, w: 0, h: 0 },
  };

  // Local linear trajectory fit around impact.
  const radius = 7;
  const local = observations
    .filter((o) => Math.abs(o.frame - impact.frame) <= radius &&
      (o.confidence > 0.34 || o.faceConfidence > 0.24))
    .sort((a, b) => a.frame - b.frame);
  let vxFrame = 0;
  let vyFrame = 0;
  const pairVx: number[] = [];
  const pairVy: number[] = [];
  for (let i = 1; i < local.length; i++) {
    const a = local[i - 1];
    const b = local[i];
    const gap = b.frame - a.frame;
    if (gap < 1 || gap > 2) continue;
    // Reject impossible jumps and pairs that disagree strongly with the streak.
    const dx = (b.x - a.x) / gap;
    const dy = (b.y - a.y) / gap;
    const sp = Math.hypot(dx, dy);
    if (sp < 8 || sp > pc.width * 0.22) continue;
    pairVx.push(dx);
    pairVy.push(dy);
  }
  if (pairVx.length >= 3) {
    vxFrame = median(pairVx);
    vyFrame = median(pairVy);
  } else if (local.length >= 4) {
    const mf = local.reduce((s, o) => s + o.frame, 0) / local.length;
    const mx = local.reduce((s, o) => s + o.x, 0) / local.length;
    const my = local.reduce((s, o) => s + o.y, 0) / local.length;
    let dff = 0;
    let dfx = 0;
    let dfy = 0;
    for (const o of local) {
      const df = o.frame - mf;
      dff += df * df;
      dfx += df * (o.x - mx);
      dfy += df * (o.y - my);
    }
    vxFrame = dff ? dfx / dff : 0;
    vyFrame = dff ? dfy / dff : 0;
  } else {
    vxFrame = Math.cos(impact.blurAngleRad) * 55;
    vyFrame = Math.sin(impact.blurAngleRad) * 55;
  }

  const trajectoryDir = Math.hypot(vxFrame, vyFrame) > 1
    ? { x: vxFrame, y: vyFrame }
    : { x: Math.cos(impact.blurAngleRad), y: Math.sin(impact.blurAngleRad) };
  const pathRad = imageVectorToHorizontalAngle(trajectoryDir, pc);
  const pathAngleDeg = rad2deg(pathRad);
  const trajectoryMps = (Math.hypot(vxFrame, vyFrame) * calibration.fps * pc.mmPerPx) / 1000;

  // Streak speed from the clearest five frames around impact.
  const streakFrames = observations
    .filter((o) => Math.abs(o.frame - impact.frame) <= 4 && o.blurValid)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  const streakValues = streakFrames.map((o) => {
    const headPx = o.headDiameterPx ?? Math.max(pc.ballRadiusPx * 1.1, o.bbox.h * 0.55, 11);
    return blurLengthToSpeed(o.blurLengthPx, pc.mmPerPx, calibration.exposureSec, headPx);
  });
  const streakSpeedMps = streakValues.length
    ? streakValues.sort((a, b) => a - b)[Math.floor(streakValues.length / 2)]
    : blurLengthToSpeed(impact.blurLengthPx, pc.mmPerPx, calibration.exposureSec, pc.ballRadiusPx * 1.2);
  const streakConfidence = streakFrames.reduce((s, o) => s + o.confidence, 0) / Math.max(1, streakFrames.length);
  const trajectoryConfidence = Math.min(1, pairVx.length / 5);
  // At a true 240 fps capture the inter-frame anchors are usually the most
  // accurate speed signal; exposure blur remains essential when frames merge.
  // Fuse conservatively rather than letting a one-pixel endpoint error dominate.
  const speedMps = pairVx.length >= 3
    ? trajectoryMps * (0.68 + 0.2 * trajectoryConfidence) +
      streakSpeedMps * (0.32 - 0.2 * trajectoryConfidence)
    : fuseSpeed(streakSpeedMps, trajectoryMps, streakConfidence || impact.confidence);

  // Face angle median from bright leading-edge estimates near impact.
  const faceSamples = observations
    .filter((o) => Math.abs(o.frame - impact.frame) <= 4 && o.faceAngleScreenRad !== null && o.faceConfidence > 0.16);
  let faceAngleDeg = 0;
  let faceConfidence = 0;
  if (faceSamples.length) {
    const entries = faceSamples.map((o) => {
      const edgeWorld = rad2deg(imageVectorToHorizontalAngle({
        x: Math.cos(o.faceAngleScreenRad as number),
        y: Math.sin(o.faceAngleScreenRad as number),
      }, pc));
      return { value: wrapFaceDeg(edgeWorld - 90), confidence: o.faceConfidence };
    });
    const sortedEntries = [...entries].sort((a, b) => a.value - b.value);
    const clusters: typeof entries[] = [];
    for (const entry of sortedEntries) {
      const cluster = clusters[clusters.length - 1];
      if (cluster && Math.abs(entry.value - cluster[cluster.length - 1].value) < 4) cluster.push(entry);
      else clusters.push([entry]);
    }
    const bestCluster = clusters
      .map((cluster) => ({
        cluster,
        weight: cluster.reduce((s, v) => s + v.confidence, 0),
      }))
      .sort((a, b) => b.weight - a.weight)[0]?.cluster ?? entries;
    const weightSum = bestCluster.reduce((s, v) => s + v.confidence, 0);
    faceAngleDeg = bestCluster.reduce((s, v) => s + v.value * v.confidence, 0) / Math.max(1e-6, weightSum);
    faceConfidence = Math.min(1, bestCluster.length / 5) *
      (bestCluster.reduce((s, v) => s + v.confidence, 0) / bestCluster.length);
  } else {
    warnings.push('击球前后未稳定识别杆面亮边，杆面角置信度低。');
  }

  // Swing plane line from downswing observations.
  const planeSource = observations.filter(
    (o) => o.frame >= impact.frame - 170 && o.frame <= impact.frame + 10 && o.confidence > 0.08,
  );
  let plane: AnalysisResult['plane'] = null;
  if (planeSource.length >= 8) {
    let mx = 0;
    let my = 0;
    for (const p of planeSource) {
      mx += p.x;
      my += p.y;
    }
    mx /= planeSource.length;
    my /= planeSource.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of planeSource) {
      const dx = p.x - mx;
      const dy = p.y - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    let residual = 0;
    for (const p of planeSource) residual += Math.abs(-dir.y * (p.x - mx) + dir.x * (p.y - my));
    residual /= planeSource.length;
    const extent = Math.max(pc.width, pc.height);
    plane = {
      start: { x: mx - dir.x * extent, y: my - dir.y * extent },
      end: { x: mx + dir.x * extent, y: my + dir.y * extent },
      angleRad: angle,
      residualPx: residual,
      points: planeSource.map((o) => ({ x: o.x / width, y: o.y / height })),
    };
    plane.start.x /= width;
    plane.start.y /= height;
    plane.end.x /= width;
    plane.end.y /= height;
  }

  const shot = estimateShot(faceAngleDeg, pathAngleDeg);
  if (speedMps < 20) warnings.push('杆头速度偏低，可能是搜索丢失或曝光时间设置不正确。');
  if (Math.abs(faceAngleDeg) > 9) warnings.push('杆面角较大，单目估计受机位透视影响，请结合雷达标定。');

  return {
    id: `analysis-${Date.now?.() ?? 0}-${impact.frame}`,
    createdAt: new Date().toISOString(),
    durationMs: elapsedMs,
    frameCount,
    processedFrames: observations.length,
    impactFrame: impact.frame,
    impactTimeSec: impact.timeSec,
    clubHeadSpeedMps: speedMps,
    clubHeadSpeedMph: speedMps * MPS_TO_MPH,
    streakSpeedMps,
    trajectorySpeedMps: trajectoryMps,
    faceAngleDeg,
    face: { degrees: faceAngleDeg, confidence: faceConfidence, samples: faceSamples.length },
    pathAngleDeg,
    path: { degrees: pathAngleDeg, confidence: Math.min(1, local.length / 8), samples: local.length },
    attackAngleDeg: 0,
    swingPlaneAngleDeg: plane ? rad2deg(plane.angleRad) : 0,
    plane,
    track: observations.map((o) => ({ ...o, x: o.x / width, y: o.y / height })),
    shot,
    warnings,
    calibration,
  };
}
