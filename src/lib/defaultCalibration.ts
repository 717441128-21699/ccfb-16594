import type { Calibration, CameraView, Handedness } from '../types';

export function defaultCalibration(cameraView: CameraView = 'side', handedness: Handedness = 'right'): Calibration {
  if (cameraView === 'face-on') {
    return {
      cameraView,
      handedness,
      fps: 240,
      exposureSec: 1 / 1600,
      ballDiameterMm: 42.67,
      clubLengthMm: 1067,
      ballA: { x: 0.47, y: 0.72 },
      ballB: { x: 0.53, y: 0.70 },
      clubGrip: { x: 0.78, y: 0.16 },
      clubHead: { x: 0.51, y: 0.71 },
      targetFrom: { x: 0.39, y: 0.80 },
      targetTo: { x: 0.73, y: 0.45 },
      insidePoint: { x: 0.28, y: 0.63 },
      depthCompression: 0.92,
    };
  }
  return {
    cameraView,
    handedness,
    fps: 240,
    exposureSec: 1 / 1600,
    ballDiameterMm: 42.67,
    clubLengthMm: 1067,
    ballA: { x: 0.485, y: 0.694 },
    ballB: { x: 0.515, y: 0.694 },
    clubGrip: { x: 0.12, y: 0.14 },
    clubHead: { x: 0.505, y: 0.70 },
    targetFrom: { x: 0.14, y: 0.694 },
    targetTo: { x: 0.91, y: 0.694 },
    insidePoint: { x: 0.5, y: 0.9 },
    depthCompression: 0.82,
  };
}
