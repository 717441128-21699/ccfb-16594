import type { ShotEstimate, ShotShape } from '../types';
import { clamp } from './geometry';

export const MPS_TO_MPH = 2.2369362920544;
export const MPS_TO_KMH = 3.6;

/**
 * Simple, explainable ball-flight model.
 * Angles are degrees relative to the target; positive = right for a
 * right-handed golfer. Face positive = open; path positive = in-to-out.
 */
export function estimateShot(faceDeg: number, pathDeg: number): ShotEstimate {
  const launchDeg = 0.82 * faceDeg + 0.18 * pathDeg;
  // Curvature is driven by face-relative-to-path. Positive face-path gives
  // fade/slice spin; negative gives draw/hook spin.
  const curvatureDeg = clamp(0.9 * (faceDeg - pathDeg), -18, 18);

  const launchAbs = Math.abs(launchDeg);
  const curveAbs = Math.abs(curvatureDeg);
  const curveThreshold = 1.6;
  const straightThreshold = 2.0;

  let shape: ShotShape;
  let label: string;
  if (curveAbs < curveThreshold && launchAbs < straightThreshold) {
    shape = 'straight';
    label = '直球';
  } else if (curvatureDeg >= curveThreshold) {
    if (launchDeg > 3.2) {
      shape = launchAbs > 7 || curveAbs > 7 ? 'push-fade' : 'push-fade';
      label = curveAbs > 7 ? '右推/右曲（切片风险）' : '小右曲（fade）';
    } else if (launchDeg < -2.5) {
      shape = 'pull-fade';
      label = '左拉后右曲';
    } else {
      shape = curveAbs > 7 ? 'fade' : 'fade';
      label = curveAbs > 7 ? '右曲 / slice' : '小右曲 fade';
    }
  } else if (curvatureDeg <= -curveThreshold) {
    if (launchDeg < -3.2) {
      shape = 'pull-draw';
      label = '左拉/左曲（hook 风险）';
    } else if (launchDeg > 2.5) {
      shape = 'push-draw';
      label = '右推后左曲';
    } else {
      shape = 'draw';
      label = curveAbs > 7 ? '左曲 / hook' : '小左曲 draw';
    }
  } else if (launchDeg > straightThreshold) {
    shape = 'push';
    label = '直推右';
  } else {
    shape = 'pull';
    label = '直拉左';
  }

  const explanation =
    `杆面 ${faceDeg >= 0 ? '开/朝右' : '关/朝左'} ${Math.abs(faceDeg).toFixed(1)}°，` +
    `路径 ${pathDeg >= 0 ? '由内向外' : '由外向内'} ${Math.abs(pathDeg).toFixed(1)}°。` +
    `初始方向约 ${launchDeg.toFixed(1)}°，弯曲项约 ${curvatureDeg.toFixed(1)}°。`;

  return { shape, launchAngleDeg: launchDeg, curvatureDeg, label, explanation };
}

export function blurLengthToSpeed(lengthPx: number, mmPerPx: number, exposureSec: number, headDiameterPx = 0): number {
  if (exposureSec <= 0) return 0;
  // The percentile-based major extent trims soft endpoints, while the head
  // correction removes the compact club-head diameter from that extent.
  const streakPx = Math.max(0, lengthPx - headDiameterPx * 0.86);
  const metres = (streakPx * mmPerPx) / 1000;
  return metres / exposureSec;
}

export function fuseSpeed(streakMps: number, trajectoryMps: number, streakConfidence: number): number {
  if (streakMps <= 0.1) return trajectoryMps;
  if (trajectoryMps <= 0.1) return streakMps;
  const wStreak = clamp(0.45 + 0.35 * streakConfidence, 0.45, 0.8);
  return streakMps * wStreak + trajectoryMps * (1 - wStreak);
}
