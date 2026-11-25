import type { Calibration, Point } from '../types';

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const deg2rad = (d: number) => (d * Math.PI) / 180;
export const rad2deg = (r: number) => (r * 180) / Math.PI;

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}
export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}
export function mul(a: Point, k: number): Point {
  return { x: a.x * k, y: a.y * k };
}
export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}
export function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}
export function length(a: Point): number {
  return Math.hypot(a.x, a.y);
}
export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function normalize(a: Point): Point {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
}
export function angleOf(a: Point): number {
  return Math.atan2(a.y, a.x);
}
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
export function robustMedian(values: number[]): { value: number; spread: number } {
  if (!values.length) return { value: 0, spread: 0 };
  const m = median(values);
  const spread = median(values.map((v) => Math.abs(v - m))) * 1.4826;
  return { value: m, spread };
}

export interface PixelCalibration {
  width: number;
  height: number;
  ballA: Point;
  ballB: Point;
  clubGrip: Point;
  clubHead: Point;
  targetFrom: Point;
  targetTo: Point;
  insidePoint: Point;
  ballCenter: Point;
  ballRadiusPx: number;
  /** Millimetres per pixel at the ball/impact plane. */
  mmPerPx: number;
  ballMmPerPx: number;
  clubMmPerPx: number;
  targetVector: Point;
  targetAngle: number;
  insideVector: Point;
  insideScale: number;
  cameraView: Calibration['cameraView'];
  depthCompression: number;
}

export function toPixel(p: Point, width: number, height: number): Point {
  return { x: p.x * width, y: p.y * height };
}

export function createPixelCalibration(cal: Calibration, width: number, height: number): PixelCalibration {
  const ballA = toPixel(cal.ballA, width, height);
  const ballB = toPixel(cal.ballB, width, height);
  const clubGrip = toPixel(cal.clubGrip, width, height);
  const clubHead = toPixel(cal.clubHead, width, height);
  const targetFrom = toPixel(cal.targetFrom, width, height);
  const targetTo = toPixel(cal.targetTo, width, height);
  const insidePoint = toPixel(cal.insidePoint, width, height);

  const ballPx = Math.max(1, dist(ballA, ballB));
  const clubPx = Math.max(1, dist(clubGrip, clubHead));
  const ballMmPerPx = cal.ballDiameterMm / ballPx;
  // A driver shaft is foreshortened slightly in most phone views. The marked
  // endpoints are treated as the visible projected length; the robust blend
  // keeps the known club ruler from being discarded.
  const clubMmPerPx = cal.clubLengthMm / clubPx;
  const mmPerPx = ballMmPerPx * 0.72 + clubMmPerPx * 0.28;
  const ballCenter = mul(add(ballA, ballB), 0.5);
  const targetVector = normalize(sub(targetTo, targetFrom));
  // The inside marker is a ground-plane direction. Do not orthogonalize it:
  // perspective can make the projected target and inside axes non-orthogonal.
  const insideRaw = sub(insidePoint, ballCenter);
  const insideVector = length(insideRaw) < 1 ? { x: -targetVector.y, y: targetVector.x } : normalize(insideRaw);

  return {
    width,
    height,
    ballA,
    ballB,
    clubGrip,
    clubHead,
    targetFrom,
    targetTo,
    insidePoint,
    ballCenter,
    ballRadiusPx: ballPx / 2,
    mmPerPx,
    ballMmPerPx,
    clubMmPerPx,
    targetVector,
    targetAngle: angleOf(targetVector),
    insideVector,
    insideScale: cal.depthCompression,
    cameraView: cal.cameraView,
    depthCompression: cal.depthCompression,
  };
}

function solveBasis(v: Point, a: Point, b: Point): Point {
  const det = a.x * b.y - a.y * b.x;
  if (Math.abs(det) < 1e-6) {
    // Fall back to orthogonal projection for degenerate calibration.
    return { x: dot(v, a), y: dot(v, b) };
  }
  return {
    x: (v.x * b.y - v.y * b.x) / det,
    y: (a.x * v.y - a.y * v.x) / det,
  };
}

/**
 * Convert an image-plane direction to a horizontal angle relative to target.
 * Positive is right/open/out-to-in convention used throughout the app.
 *
 * The phone is monocular, so this is a camera-model estimate rather than a
 * full 3D reconstruction. The user's target line and inside marker constrain
 * the otherwise ambiguous lateral axis.
 */
export function imageVectorToHorizontalAngle(v: Point, pc: PixelCalibration): number {
  const d = normalize(v);
  // Image vector = c * targetAxis + s * depthCompression * insideAxis.
  const q = solveBasis(d, pc.targetVector, pc.insideVector);
  const lateral = q.y / Math.max(0.2, pc.depthCompression);
  return Math.atan2(lateral, q.x);
}

export function horizontalAngleToImageVector(angleRad: number, pc: PixelCalibration): Point {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad) * pc.depthCompression;
  return normalize(add(mul(pc.targetVector, c), mul(pc.insideVector, s)));
}

/** Total-least-squares line fit. Returns a point and unit direction. */
export function fitLine(points: Point[]): { point: Point; direction: Point; angle: number; residual: number } | null {
  if (points.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // Principal component of covariance.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const direction = { x: Math.cos(theta), y: Math.sin(theta) };
  let residual = 0;
  for (const p of points) {
    residual += Math.abs(cross(direction, sub(p, { x: mx, y: my })));
  }
  residual /= points.length;
  return { point: { x: mx, y: my }, direction, angle: theta, residual };
}
