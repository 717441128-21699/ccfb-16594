import { describe, expect, it } from 'vitest';
import { estimateShot } from './shotPhysics';
import { calibrationForView } from '../samples/cases';
import { createPixelCalibration, deg2rad, horizontalAngleToImageVector, imageVectorToHorizontalAngle } from './geometry';

describe('shot flight inference', () => {
  it('classifies square face and path as straight', () => {
    const shot = estimateShot(0.2, 0.1);
    expect(shot.shape).toBe('straight');
  });

  it('classifies open face with out-to-in path as fade/slice', () => {
    const shot = estimateShot(5.5, -6);
    expect(shot.curvatureDeg).toBeGreaterThan(3);
    expect(['fade', 'push-fade']).toContain(shot.shape);
  });

  it('classifies closed face relative to in-to-out path as draw/hook', () => {
    const shot = estimateShot(-3.5, 6);
    expect(shot.curvatureDeg).toBeLessThan(-3);
    expect(['draw', 'push-draw']).toContain(shot.shape);
  });
});

describe('camera angle basis', () => {
  it.each(['side', 'face-on'] as const)('round-trips path angle for %s', (view) => {
    const cal = calibrationForView(view);
    const pc = createPixelCalibration(cal, 640, 360);
    for (const angle of [-6, -3, 0, 3, 6]) {
      const imageVector = horizontalAngleToImageVector(deg2rad(angle), pc);
      const recovered = imageVectorToHorizontalAngle(imageVector, pc) * 180 / Math.PI;
      expect(recovered).toBeCloseTo(angle, 6);
    }
  });
});
