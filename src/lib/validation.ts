import type { AnalysisResult, SampleTruth } from '../types';

export type DirectionClass = 'left' | 'straight' | 'right';

export function directionClass(deg: number, threshold = 2.5): DirectionClass {
  if (deg > threshold) return 'right';
  if (deg < -threshold) return 'left';
  return 'straight';
}

export function predictedDirectionClass(result: AnalysisResult): DirectionClass {
  const shape = result.shot.shape;
  if (shape.includes('draw')) return 'left';
  if (shape.includes('fade')) return 'right';
  if (shape === 'push') return 'right';
  if (shape === 'pull') return 'left';
  return directionClass(result.shot.launchAngleDeg, 2);
}

export function directionCorrect(result: AnalysisResult, truth: Pick<SampleTruth, 'directionDeg'>): boolean {
  return predictedDirectionClass(result) === directionClass(truth.directionDeg);
}

export interface AccuracyReport {
  speedErrorPct: number | null;
  faceErrorDeg: number | null;
  directionCorrect: boolean | null;
  speedPass: boolean;
  facePass: boolean;
  directionPass: boolean | null;
}

export function evaluateAccuracy(
  result: AnalysisResult,
  reference: { clubHeadSpeedMps?: number; faceAngleDeg?: number; directionDeg?: number | null },
): AccuracyReport {
  const speedErrorPct = reference.clubHeadSpeedMps
    ? ((result.clubHeadSpeedMps - reference.clubHeadSpeedMps) / reference.clubHeadSpeedMps) * 100
    : null;
  const faceErrorDeg = reference.faceAngleDeg !== undefined && Number.isFinite(reference.faceAngleDeg)
    ? result.faceAngleDeg - reference.faceAngleDeg
    : null;
  const hasDirection = reference.directionDeg !== undefined && reference.directionDeg !== null;
  const directionPass = hasDirection
    ? predictedDirectionClass(result) === directionClass(reference.directionDeg as number)
    : null;

  return {
    speedErrorPct,
    faceErrorDeg,
    directionCorrect: directionPass,
    speedPass: speedErrorPct === null ? false : Math.abs(speedErrorPct) <= 5,
    facePass: faceErrorDeg === null ? false : Math.abs(faceErrorDeg) <= 2,
    directionPass,
  };
}

export function summarizeBallTests(reports: AccuracyReport[]): {
  count: number;
  speedWithin5: number;
  faceWithin2: number;
  directionCorrect: number;
  directionEligible: number;
  speedPassRate: number;
  facePassRate: number;
  directionRate: number;
} {
  const count = reports.length;
  const speedWithin5 = reports.filter((r) => r.speedPass).length;
  const faceWithin2 = reports.filter((r) => r.facePass).length;
  const directionCorrect = reports.filter((r) => r.directionPass === true).length;
  const directionEligible = reports.filter((r) => r.directionPass !== null).length;
  return {
    count,
    speedWithin5,
    faceWithin2,
    directionCorrect,
    directionEligible,
    speedPassRate: count ? speedWithin5 / count : 0,
    facePassRate: count ? faceWithin2 / count : 0,
    directionRate: directionEligible ? directionCorrect / directionEligible : 0,
  };
}
