export type CameraView = 'face-on' | 'side';
export type Handedness = 'right' | 'left';
export type ShotShape = 'straight' | 'draw' | 'fade' | 'push-draw' | 'push' | 'push-fade' | 'pull-draw' | 'pull' | 'pull-fade';
export type FaultKind =
  | 'ideal'
  | 'slice'
  | 'hook'
  | 'push'
  | 'pull'
  | 'over-the-top'
  | 'inside-out'
  | 'early-release'
  | 'steep-plane'
  | 'shallow-plane';

export interface Point {
  x: number;
  y: number;
}

/** All geometry points are normalized to intrinsic video dimensions. */
export interface Calibration {
  cameraView: CameraView;
  handedness: Handedness;
  fps: number;
  exposureSec: number;
  ballDiameterMm: number;
  clubLengthMm: number;
  ballA: Point;
  ballB: Point;
  clubGrip: Point;
  clubHead: Point;
  targetFrom: Point;
  targetTo: Point;
  /** Ground point toward the golfer / inside of target line. */
  insidePoint: Point;
  /** Optional user depth foreshortening multiplier for the optical axis. */
  depthCompression: number;
}

export interface TrackObservation {
  frame: number;
  timeSec: number;
  x: number;
  y: number;
  confidence: number;
  blurLengthPx: number;
  blurAngleRad: number;
  blurValid: boolean;
  faceAngleScreenRad: number | null;
  faceConfidence: number;
  score: number;
  headDiameterPx?: number;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface PlaneFit {
  start: Point;
  end: Point;
  angleRad: number;
  residualPx: number;
  points: Point[];
}

export interface AngleEstimate {
  degrees: number;
  confidence: number;
  samples: number;
}

export interface AnalysisResult {
  id: string;
  createdAt: string;
  durationMs: number;
  frameCount: number;
  processedFrames: number;
  impactFrame: number;
  impactTimeSec: number;
  clubHeadSpeedMps: number;
  clubHeadSpeedMph: number;
  streakSpeedMps: number;
  trajectorySpeedMps: number;
  faceAngleDeg: number;
  face: AngleEstimate;
  pathAngleDeg: number;
  path: AngleEstimate;
  attackAngleDeg: number;
  swingPlaneAngleDeg: number;
  plane: PlaneFit | null;
  track: TrackObservation[];
  shot: ShotEstimate;
  warnings: string[];
  calibration: Calibration;
  workerMs?: number;
}

export interface ShotEstimate {
  shape: ShotShape;
  /** Horizontal launch direction relative target, positive right. */
  launchAngleDeg: number;
  /** Curvature proxy; positive fades/slices right, negative draws/hooks left. */
  curvatureDeg: number;
  label: string;
  explanation: string;
}

export interface RadarReference {
  clubHeadSpeedMps?: number;
  faceAngleDeg?: number;
  pathAngleDeg?: number;
  landingDirectionDeg?: number;
}

export interface StudentRecord {
  id: string;
  studentId: string;
  date: string;
  videoName: string;
  sampleId?: string;
  result: AnalysisResult;
  radar?: RadarReference;
  notes?: string;
}

export interface Student {
  id: string;
  name: string;
  handedness: Handedness;
  createdAt: string;
  goal?: string;
}

export interface SampleTruth {
  clubHeadSpeedMps: number;
  faceAngleDeg: number;
  pathAngleDeg: number;
  /** Final horizontal direction in degrees relative target: + right, - left. */
  directionDeg: number;
  shot: ShotShape;
  impactFrame: number;
  fault: FaultKind;
  radarClubHeadSpeedMps?: number;
  radarFaceAngleDeg?: number;
}

export interface SampleVideo {
  id: string;
  title: string;
  file: string;
  poster?: string;
  cameraView: CameraView;
  fault: FaultKind;
  description: string;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  calibration: Calibration;
  truth: SampleTruth;
}
