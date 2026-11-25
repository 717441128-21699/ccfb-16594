import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisResult, RadarReference, Student } from '../types';
import { runVideoAnalysis, type AnalysisProgress } from '../lib/analysisClient';
import { MPS_TO_MPH } from '../lib/shotPhysics';
import { evaluateAccuracy } from '../lib/validation';
import { AnalysisOverlay } from './AnalysisOverlay';
import type { MediaSelection } from './ImportPage';

interface AnalysisPageProps {
  media: MediaSelection;
  calibration: AnalysisResult['calibration'];
  student?: Student;
  onBackCalibration: () => void;
  onSaveRecord: (result: AnalysisResult, radar: RadarReference | undefined, notes: string) => void;
}

export function AnalysisPage({ media, calibration, student, onBackCalibration, onSaveRecord }: AnalysisPageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState('');
  const [wallMs, setWallMs] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [notes, setNotes] = useState('');
  const [videoSize, setVideoSize] = useState({ w: media.sample?.width ?? 640, h: media.sample?.height ?? 360 });
  const [radarSpeed, setRadarSpeed] = useState('');
  const [radarFace, setRadarFace] = useState('');
  const [radarDirection, setRadarDirection] = useState('');

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    setResult(null);
    setError('');
    setSaved(false);
    if (media.sample) {
      setRadarSpeed(String(media.sample.truth.radarClubHeadSpeedMps ?? media.sample.truth.clubHeadSpeedMps));
      setRadarFace(String(media.sample.truth.radarFaceAngleDeg ?? media.sample.truth.faceAngleDeg));
      setRadarDirection(String(media.sample.truth.directionDeg));
    } else {
      setRadarSpeed('');
      setRadarFace('');
      setRadarDirection('');
    }
  }, [media]);

  const radar: RadarReference | undefined = useMemo(() => {
    const s = Number(radarSpeed);
    const f = Number(radarFace);
    if (!Number.isFinite(s) && !Number.isFinite(f)) return undefined;
    return {
      clubHeadSpeedMps: radarSpeed ? s : undefined,
      faceAngleDeg: radarFace ? f : undefined,
      landingDirectionDeg: radarDirection ? Number(radarDirection) : undefined,
    };
  }, [radarSpeed, radarFace, radarDirection]);

  const accuracy = useMemo(() => {
    if (!result) return null;
    return evaluateAccuracy(result, {
      clubHeadSpeedMps: radar?.clubHeadSpeedMps,
      faceAngleDeg: radar?.faceAngleDeg,
      directionDeg: radar?.landingDirectionDeg ?? media.sample?.truth.directionDeg ?? null,
    });
  }, [result, radar, media.sample]);

  const start = async () => {
    const video = videoRef.current;
    if (!video) return;
    setRunning(true);
    setError('');
    setResult(null);
    setSaved(false);
    const controller = new AbortController();
    abortRef.current = controller;
    const started = performance.now();
    try {
      const analysis = await runVideoAnalysis({
        video,
        calibration,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setWallMs(performance.now() - started);
      setResult(analysis);
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.currentTime = analysis.impactTimeSec;
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const progressPct = progress
    ? Math.round(((progress.stage === 'worker' ? progress.workerProcessed : progress.extracted) / progress.frameCount) * 100)
    : 0;

  return (
    <div className="page analysis-page">
      <div className="page-head">
        <button className="btn ghost" onClick={onBackCalibration}>← 调整标定</button>
        <div>
          <h1>挥杆分析 {student ? <span className="muted">· {student.name}</span> : null}</h1>
          <p>杆头搜索运行在 Web Worker；绿色为挥杆平面，青色轨迹与黄色箭头为击球估计。</p>
        </div>
        <div className="head-actions">
          {!running ? <button className="btn primary large" onClick={start}>{result ? '重新分析' : '开始分析'}</button> : <button className="btn danger large" onClick={cancel}>取消</button>}
        </div>
      </div>

      {running && (
        <div className="progress-card card">
          <div className="progress-row">
            <strong>{progress?.stage === 'seek' ? '逐帧解码并送入 Worker' : progress?.stage === 'finalize' ? '拟合平面与角度' : 'Worker 正在搜索拖影/杆面'}</strong>
            <span>{progressPct}%</span>
          </div>
          <div className="progress-track"><i style={{ width: `${progressPct}%` }} /></div>
          <small>已取帧 {progress?.extracted ?? 0}/{progress?.frameCount ?? '…'}，Worker 完成 {progress?.workerProcessed ?? 0}</small>
        </div>
      )}
      {error && <div className="card error-banner">{error}</div>}

      <div className="analysis-layout">
        <section className="card video-analysis-card">
          <div className="video-stage analysis-stage" style={{ aspectRatio: `${videoSize.w} / ${videoSize.h}` }}>
            <video
              ref={videoRef}
              src={media.url}
              playsInline
              muted
              controls={!running}
              preload="auto"
              onLoadedMetadata={(e) => setVideoSize({ w: e.currentTarget.videoWidth || 640, h: e.currentTarget.videoHeight || 360 })}
            />
            <AnalysisOverlay result={result} videoRef={videoRef} width={videoSize.w} height={videoSize.h} />
            {!result && !running && <div className="analysis-empty">点击“开始分析”；分析时会后台逐帧 seek，不会卡住页面。</div>}
          </div>

          {result && (
            <div className="scrub-row">
              <input
                type="range"
                min={0}
                max={Math.max(0.01, (media.sample?.durationSec ?? videoRef.current?.duration ?? 5) - 0.001)}
                step={1 / calibration.fps}
                defaultValue={result.impactTimeSec}
                onChange={(e) => {
                  if (videoRef.current) videoRef.current.currentTime = Number(e.target.value);
                }}
              />
              <button className="btn secondary" onClick={() => videoRef.current && (videoRef.current.currentTime = result.impactTimeSec)}>
                回到击球帧 {result.impactFrame}
              </button>
            </div>
          )}

          {result?.warnings.length ? (
            <div className="warnings">
              {result.warnings.map((w) => <span key={w} className="warning-chip">⚠ {w}</span>)}
            </div>
          ) : null}
        </section>

        <aside className="analysis-side">
          <div className="card shot-card">
            <p className="eyebrow">推断球路</p>
            <h2>{result?.shot.label ?? '等待分析'}</h2>
            <p className="muted">{result?.shot.explanation ?? '杆面角与路径角会按球的起飞方向和弯曲差推出左曲、右曲或直球。'}</p>
            {result && (
              <div className="angle-pair">
                <div><span>杆面</span><b className={result.faceAngleDeg > 2 ? 'warn' : result.faceAngleDeg < -2 ? 'cool' : ''}>{result.faceAngleDeg > 0 ? '开 +' : ''}{result.faceAngleDeg.toFixed(1)}°</b></div>
                <div><span>路径</span><b className={result.pathAngleDeg > 2 ? 'cool' : result.pathAngleDeg < -2 ? 'warn' : ''}>{result.pathAngleDeg > 0 ? '内→外 +' : result.pathAngleDeg < 0 ? '外→内 ' : ''}{result.pathAngleDeg.toFixed(1)}°</b></div>
              </div>
            )}
          </div>

          <div className="metrics-grid">
            <div className="card metric">
              <span>杆头速度</span>
              <strong>{result ? result.clubHeadSpeedMps.toFixed(1) : '—'}<em>m/s</em></strong>
              <small>{result ? `${result.clubHeadSpeedMph.toFixed(1)} mph` : '目标偏差 ≤5%'}</small>
            </div>
            <div className="card metric">
              <span>拖影测速</span>
              <strong>{result ? result.streakSpeedMps.toFixed(1) : '—'}<em>m/s</em></strong>
              <small>{result ? `轨迹 ${result.trajectorySpeedMps.toFixed(1)} m/s` : '长度 ÷ 曝光时间'}</small>
            </div>
            <div className="card metric">
              <span>挥杆平面</span>
              <strong>{result ? `${Math.abs(result.swingPlaneAngleDeg).toFixed(1)}°` : '—'}</strong>
              <small>{result?.plane ? `残差 ${result.plane.residualPx.toFixed(1)} px` : '下杆 PCA 拟合'}</small>
            </div>
            <div className="card metric">
              <span>分析耗时</span>
              <strong>{wallMs ? (wallMs / 1000).toFixed(1) : '—'}<em>s</em></strong>
              <small>{result?.workerMs ? `Worker ${(result.workerMs / 1000).toFixed(1)}s` : '目标 ≤10s'}</small>
            </div>
          </div>

          <div className="card radar-card">
            <div className="section-heading compact">
              <h3>雷达同步真值 / 对标</h3>
              {media.sample && <span className="badge ok">样例真值已预填</span>}
            </div>
            <div className="radar-inputs">
              <label>速度 m/s<input value={radarSpeed} onChange={(e) => setRadarSpeed(e.target.value)} inputMode="decimal" /></label>
              <label>杆面 °<input value={radarFace} onChange={(e) => setRadarFace(e.target.value)} inputMode="decimal" /></label>
              <label>球方向 °<input value={radarDirection} onChange={(e) => setRadarDirection(e.target.value)} inputMode="decimal" /></label>
            </div>
            {accuracy && result && (
              <div className="accuracy-list">
                <AccuracyRow label="速度偏差" value={accuracy.speedErrorPct === null ? '—' : `${accuracy.speedErrorPct >= 0 ? '+' : ''}${accuracy.speedErrorPct.toFixed(1)}%`} pass={accuracy.speedPass} target="≤5%" />
                <AccuracyRow label="杆面偏差" value={accuracy.faceErrorDeg === null ? '—' : `${accuracy.faceErrorDeg >= 0 ? '+' : ''}${accuracy.faceErrorDeg.toFixed(2)}°`} pass={accuracy.facePass} target="≤2°" />
                <AccuracyRow label="球路方向" value={accuracy.directionPass === null ? '待雷达方向' : accuracy.directionPass ? '判对' : '判错'} pass={accuracy.directionPass} target="10 中 9" />
              </div>
            )}
            <textarea placeholder="教练备注：例如第一杆 over-the-top，注意右肘..." value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button
              className="btn primary full"
              disabled={!result || saved}
              onClick={() => {
                if (!result) return;
                onSaveRecord(result, radar, notes);
                setSaved(true);
              }}
            >
              {saved ? '已存入学员档案 ✓' : '保存本次分析到学员档案'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function AccuracyRow({ label, value, pass, target }: { label: string; value: string; pass: boolean | null; target: string }) {
  const stateClass = pass === null ? 'unknown' : pass ? 'pass' : 'fail';
  return (
    <div className={`accuracy-row ${stateClass}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{target}</small>
      <i>{pass === null ? '–' : pass ? '✓' : '!'}</i>
    </div>
  );
}
