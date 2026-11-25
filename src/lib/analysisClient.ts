import type { AnalysisResult, Calibration } from '../types';
import type { WorkerOutMessage } from '../workers/tracker.worker';
import TrackerWorker from '../workers/tracker.worker?worker';

export interface AnalysisProgress {
  stage: 'seek' | 'worker' | 'finalize';
  extracted: number;
  frameCount: number;
  workerProcessed: number;
}

export interface RunAnalysisOptions {
  video: HTMLVideoElement;
  calibration: Calibration;
  frameCount?: number;
  analysisWidth?: number;
  signal?: AbortSignal;
  onProgress?: (p: AnalysisProgress) => void;
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 1 / 1000) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let done = false;
    const onSeeked = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('视频定位失败，可能是编码格式不受浏览器支持。'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = Math.max(0, Math.min(time, (video.duration || time + 0.01) - 0.001));
  });
}

export async function runVideoAnalysis(options: RunAnalysisOptions): Promise<AnalysisResult> {
  const { video, calibration, signal, onProgress } = options;
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('视频还没有可解码画面，请先在导入页等待预览加载。');
  }

  const sourceDuration = Number.isFinite(video.duration) ? video.duration : 5;
  const frameCount = options.frameCount ?? Math.max(1, Math.round(sourceDuration * calibration.fps));
  const analysisWidth = options.analysisWidth ?? 640;
  const analysisHeight = Math.round((video.videoHeight / video.videoWidth) * analysisWidth / 2) * 2;

  const canvas = document.createElement('canvas');
  canvas.width = analysisWidth;
  canvas.height = analysisHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 2D 解码画布。');

  const worker = new TrackerWorker();
  let settled = false;
  let workerProcessed = 0;
  const inFlight = new Set<number>();
  let resolveResult: (r: AnalysisResult) => void = () => {};
  let rejectResult: (e: Error) => void = () => {};
  const resultPromise = new Promise<AnalysisResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const onAbort = () => {
    worker.terminate();
    rejectResult(new DOMException('Analysis aborted', 'AbortError'));
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
    const msg = event.data;
    if (msg.type === 'frame-done') {
      inFlight.delete(msg.frame);
      workerProcessed++;
    } else if (msg.type === 'progress') {
      workerProcessed = msg.processed;
      onProgress?.({ stage: 'worker', extracted: frameCount, frameCount, workerProcessed });
    } else if (msg.type === 'result') {
      settled = true;
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
      resolveResult(msg.result);
    } else if (msg.type === 'error') {
      settled = true;
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
      rejectResult(new Error(msg.message));
    }
  };
  worker.onerror = (event) => {
    rejectResult(new Error(event.message || 'Web Worker 分析失败'));
    worker.terminate();
  };

  worker.postMessage({
    type: 'start',
    calibration,
    width: analysisWidth,
    height: analysisHeight,
    frameCount,
  });

  const wasPaused = video.paused;
  const previousTime = video.currentTime;
  const previousMuted = video.muted;
  video.pause();
  video.muted = true;

  try {
    const maxInFlight = 10;
    for (let frame = 0; frame < frameCount; frame++) {
      if (signal?.aborted) throw new DOMException('Analysis aborted', 'AbortError');
      const time = Math.min(frame / calibration.fps, sourceDuration - 0.001);
      await seekTo(video, time);
      ctx.drawImage(video, 0, 0, analysisWidth, analysisHeight);
      const imageData = ctx.getImageData(0, 0, analysisWidth, analysisHeight);

      while (inFlight.size >= maxInFlight) {
        // The set is deleted by worker.onmessage; yield to let messages run.
        await new Promise((r) => setTimeout(r, 0));
      }
      inFlight.add(frame);
      worker.postMessage({ type: 'frame', frame, buffer: imageData.data.buffer }, [imageData.data.buffer]);
      onProgress?.({ stage: 'seek', extracted: frame + 1, frameCount, workerProcessed });
    }

    onProgress?.({ stage: 'finalize', extracted: frameCount, frameCount, workerProcessed });
    worker.postMessage({ type: 'finalize' });
    const result = await resultPromise;
    return result;
  } finally {
    if (!settled) worker.terminate();
    signal?.removeEventListener('abort', onAbort);
    video.muted = previousMuted;
    if (wasPaused) video.pause();
    try {
      video.currentTime = previousTime;
    } catch {
      /* restore is best-effort */
    }
  }
}
