import { SWING_CASES, calibrationForView } from '../src/samples/cases';
import { renderSampleFrame } from '../src/samples/renderer';
import { SwingTracker } from '../src/lib/tracker';

const view = (process.argv[2] ?? 'face-on') as 'face-on' | 'side';
const frame = Number(process.argv[3] ?? 840);
const cal = calibrationForView(view);
const t = new SwingTracker(cal, 640, 360) as any;
const f = renderSampleFrame(SWING_CASES[0], view, frame);
t.updateGray(f.data);
const a = t.detectFaceAnchor(f.data, 0);
console.log('anchor', a);
const c = t.findCandidate(f.data, { x: 318, y: 254 }, 70, t.pc.targetVector);
console.log('near', c && { x: c.headX, y: c.headY, major: c.majorLength, minor: c.minorLength, face: c.faceAngleScreenRad, fc: c.faceConfidence, count: c.count, bbox: c.bbox });
