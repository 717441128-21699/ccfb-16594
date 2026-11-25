/// <reference lib="webworker" />
import { SwingTracker, finalizeAnalysis } from '../lib/tracker';
import type { AnalysisResult, Calibration } from '../types';

export interface WorkerStartMessage {
  type: 'start';
  calibration: Calibration;
  width: number;
  height: number;
  frameCount: number;
}
export interface WorkerFrameMessage {
  type: 'frame';
  frame: number;
  buffer: ArrayBuffer;
}
export interface WorkerFinalizeMessage {
  type: 'finalize';
}
export type WorkerInMessage = WorkerStartMessage | WorkerFrameMessage | WorkerFinalizeMessage;

export type WorkerOutMessage =
  | { type: 'ready' }
  | { type: 'progress'; processed: number; frameCount: number; impactHint?: number }
  | { type: 'frame-done'; frame: number }
  | { type: 'result'; result: AnalysisResult }
  | { type: 'error'; message: string };

let tracker: SwingTracker | null = null;
let calibration: Calibration | null = null;
let width = 0;
let height = 0;
let frameCount = 0;
let startedAt = 0;
let processed = 0;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  try {
    if (msg.type === 'start') {
      calibration = msg.calibration;
      width = msg.width;
      height = msg.height;
      frameCount = msg.frameCount;
      processed = 0;
      startedAt = performance.now();
      tracker = new SwingTracker(calibration, width, height);
      ctx.postMessage({ type: 'ready' } satisfies WorkerOutMessage);
      return;
    }

    if (msg.type === 'frame') {
      if (!tracker) throw new Error('Tracker not started');
      const data = new Uint8ClampedArray(msg.buffer);
      tracker.process(msg.frame, data);
      processed++;
      ctx.postMessage({ type: 'frame-done', frame: msg.frame } satisfies WorkerOutMessage);
      if (processed % 8 === 0 || processed === frameCount) {
        ctx.postMessage({ type: 'progress', processed, frameCount } satisfies WorkerOutMessage);
      }
      return;
    }

    if (msg.type === 'finalize') {
      if (!tracker || !calibration) throw new Error('Tracker not started');
      const result = finalizeAnalysis(
        tracker.observations,
        calibration,
        width,
        height,
        performance.now() - startedAt,
        frameCount || processed,
      );
      // Worker search time is separate from video decode/seek time.
      result.workerMs = Math.round(performance.now() - startedAt);
      ctx.postMessage({ type: 'result', result } satisfies WorkerOutMessage);
      tracker = null;
    }
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies WorkerOutMessage);
  }
};

ctx.postMessage({ type: 'ready' } satisfies WorkerOutMessage);
