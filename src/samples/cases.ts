import type { Calibration, CameraView, FaultKind, SampleVideo, ShotShape } from '../types';

export const SAMPLE_WIDTH = 640;
export const SAMPLE_HEIGHT = 360;
export const SAMPLE_FPS = 240;
export const SAMPLE_FRAMES = 1200;
export const SAMPLE_DURATION = 5;
export const SAMPLE_IMPACT_FRAME = 840;
export const SAMPLE_EXPOSURE_SEC = 1 / 1600;

export interface SwingCaseSpec {
  id: string;
  title: string;
  fault: FaultKind;
  description: string;
  clubHeadSpeedMps: number;
  faceAngleDeg: number;
  pathAngleDeg: number;
  directionDeg: number;
  shot: ShotShape;
  planeSteepnessDeg: number;
  attackAngleDeg: number;
  radarSpeedErrorPct?: number;
  radarFaceErrorDeg?: number;
}

/**
 * Ten paired "radar" balls. Angles use positive = right/open/out-to-in for a
 * right-handed golfer. directionDeg is the final observed ball direction.
 */
export const SWING_CASES: SwingCaseSpec[] = [
  {
    id: 'b01-straight',
    title: '基准直球',
    fault: 'ideal',
    description: '方正杆面与中性路径，用于验证尺度和速度基线。',
    clubHeadSpeedMps: 46.0,
    faceAngleDeg: 0.4,
    pathAngleDeg: 0.2,
    directionDeg: 0.5,
    shot: 'straight',
    planeSteepnessDeg: 58,
    attackAngleDeg: -1.5,
  },
  {
    id: 'b02-draw',
    title: '标准小左曲',
    fault: 'inside-out',
    description: '由内向外 4.4°，杆面相对路径关闭，弹道先略右后左转。',
    clubHeadSpeedMps: 47.2,
    faceAngleDeg: 1.1,
    pathAngleDeg: 4.4,
    directionDeg: -4.8,
    shot: 'draw',
    planeSteepnessDeg: 55,
    attackAngleDeg: 0.5,
  },
  {
    id: 'b03-fade',
    title: '标准小右曲',
    fault: 'over-the-top',
    description: '轻微由外向内，杆面相对路径打开，弹道先略左后右转。',
    clubHeadSpeedMps: 46.8,
    faceAngleDeg: 1.8,
    pathAngleDeg: -2.8,
    directionDeg: 5.4,
    shot: 'fade',
    planeSteepnessDeg: 61,
    attackAngleDeg: -2.5,
  },
  {
    id: 'b04-slice',
    title: '严重右曲 / slice',
    fault: 'slice',
    description: 'over-the-top 且杆面明显打开，典型右曲毛病。',
    clubHeadSpeedMps: 45.1,
    faceAngleDeg: 5.6,
    pathAngleDeg: -6.2,
    directionDeg: 18.5,
    shot: 'fade',
    planeSteepnessDeg: 64,
    attackAngleDeg: -4.0,
  },
  {
    id: 'b05-hook',
    title: '严重左曲 / hook',
    fault: 'hook',
    description: '深度由内向外且杆面关闭，典型左曲毛病。',
    clubHeadSpeedMps: 47.8,
    faceAngleDeg: -3.8,
    pathAngleDeg: 6.4,
    directionDeg: -16.5,
    shot: 'draw',
    planeSteepnessDeg: 52,
    attackAngleDeg: 1.5,
  },
  {
    id: 'b06-push',
    title: '直推右',
    fault: 'push',
    description: '路径和杆面都指向目标右侧，但二者接近，弯曲小。',
    clubHeadSpeedMps: 45.6,
    faceAngleDeg: 3.8,
    pathAngleDeg: 3.4,
    directionDeg: 4.1,
    shot: 'push',
    planeSteepnessDeg: 57,
    attackAngleDeg: -1.0,
  },
  {
    id: 'b07-pull',
    title: '直拉左',
    fault: 'pull',
    description: '路径和杆面都指向目标左侧，但二者接近，弯曲小。',
    clubHeadSpeedMps: 44.9,
    faceAngleDeg: -3.7,
    pathAngleDeg: -3.3,
    directionDeg: -4.0,
    shot: 'pull',
    planeSteepnessDeg: 59,
    attackAngleDeg: -2.0,
  },
  {
    id: 'b08-over-top',
    title: 'over-the-top 陡下杆',
    fault: 'over-the-top',
    description: '陡直、由外向内的下杆平面，容易造成右曲。',
    clubHeadSpeedMps: 46.4,
    faceAngleDeg: 0.8,
    pathAngleDeg: -5.4,
    directionDeg: 6.8,
    shot: 'fade',
    planeSteepnessDeg: 68,
    attackAngleDeg: -5.0,
  },
  {
    id: 'b09-early-release',
    title: '提前释放 / cast',
    fault: 'early-release',
    description: '手腕提前释放，击球角度变陡，杆头速度峰值略低。',
    clubHeadSpeedMps: 39.7,
    faceAngleDeg: 2.4,
    pathAngleDeg: 0.9,
    directionDeg: 3.2,
    shot: 'push-fade',
    planeSteepnessDeg: 63,
    attackAngleDeg: -6.5,
  },
  {
    id: 'b10-shallow',
    title: '过平挥杆平面',
    fault: 'shallow-plane',
    description: '平面过浅且明显由内向外，伴随关闭杆面。',
    clubHeadSpeedMps: 48.3,
    faceAngleDeg: -1.6,
    pathAngleDeg: 5.8,
    directionDeg: -7.5,
    shot: 'draw',
    planeSteepnessDeg: 46,
    attackAngleDeg: 2.8,
  },
];

export function calibrationForView(view: CameraView): Calibration {
  const common = {
    handedness: 'right' as const,
    fps: SAMPLE_FPS,
    exposureSec: SAMPLE_EXPOSURE_SEC,
    ballDiameterMm: 42.67,
    // 42 in / 1067 mm playing length for the synthetic driver.
    clubLengthMm: 1067,
  };

  if (view === 'side') {
    // Ball centre (330,250), diameter 14 px => 3.048 mm/px.
    // Club endpoints are 350 px apart at the same scale.
    return {
      ...common,
      cameraView: 'side',
      ballA: { x: 323 / SAMPLE_WIDTH, y: 250 / SAMPLE_HEIGHT },
      ballB: { x: 337 / SAMPLE_WIDTH, y: 250 / SAMPLE_HEIGHT },
      clubGrip: { x: 48 / SAMPLE_WIDTH, y: 43 / SAMPLE_HEIGHT },
      clubHead: { x: 326 / SAMPLE_WIDTH, y: 252 / SAMPLE_HEIGHT },
      targetFrom: { x: 82 / SAMPLE_WIDTH, y: 250 / SAMPLE_HEIGHT },
      targetTo: { x: 585 / SAMPLE_WIDTH, y: 250 / SAMPLE_HEIGHT },
      insidePoint: { x: 330 / SAMPLE_WIDTH, y: 326 / SAMPLE_HEIGHT },
      depthCompression: 0.82,
    };
  }

  // Face-on camera: target axis recedes to the upper-right while the
  // golfer's inside/outside axis runs mostly across the image.
  return {
    ...common,
    cameraView: 'face-on',
    ballA: { x: 313 / SAMPLE_WIDTH, y: 258 / SAMPLE_HEIGHT },
    ballB: { x: 327 / SAMPLE_WIDTH, y: 252 / SAMPLE_HEIGHT },
    clubGrip: { x: 515 / SAMPLE_WIDTH, y: 55 / SAMPLE_HEIGHT },
    clubHead: { x: 324 / SAMPLE_WIDTH, y: 254 / SAMPLE_HEIGHT },
    targetFrom: { x: 250 / SAMPLE_WIDTH, y: 286 / SAMPLE_HEIGHT },
    targetTo: { x: 470 / SAMPLE_WIDTH, y: 158 / SAMPLE_HEIGHT },
    insidePoint: { x: 178 / SAMPLE_WIDTH, y: 226 / SAMPLE_HEIGHT },
    depthCompression: 0.92,
  };
}

export function buildSampleManifest(): SampleVideo[] {
  const views: CameraView[] = ['side', 'face-on'];
  return SWING_CASES.flatMap((c) =>
    views.map((cameraView) => {
      const id = `${c.id}-${cameraView}`;
      return {
        id,
        title: `${c.title} · ${cameraView === 'side' ? '侧对机位' : '正对机位'}`,
        file: `samples/${id}.mp4`,
        cameraView,
        fault: c.fault,
        description: c.description,
        durationSec: SAMPLE_DURATION,
        fps: SAMPLE_FPS,
        width: SAMPLE_WIDTH,
        height: SAMPLE_HEIGHT,
        calibration: calibrationForView(cameraView),
        truth: {
          clubHeadSpeedMps: c.clubHeadSpeedMps,
          faceAngleDeg: c.faceAngleDeg,
          pathAngleDeg: c.pathAngleDeg,
          directionDeg: c.directionDeg,
          shot: c.shot,
          impactFrame: SAMPLE_IMPACT_FRAME,
          fault: c.fault,
          radarClubHeadSpeedMps: c.clubHeadSpeedMps * (1 + (c.radarSpeedErrorPct ?? 0.004)),
          radarFaceAngleDeg: c.faceAngleDeg + (c.radarFaceErrorDeg ?? 0.2),
        },
      } satisfies SampleVideo;
    }),
  );
}
