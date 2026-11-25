import { useMemo, useRef, useState } from 'react';
import type { Calibration, Point } from '../types';
import { createPixelCalibration } from '../lib/geometry';
import type { MediaSelection } from './ImportPage';

interface CalibrationPageProps {
  media: MediaSelection;
  calibration: Calibration;
  onChange: (c: Calibration) => void;
  onBack: () => void;
  onAnalyze: () => void;
}

type HandleKey = 'ballA' | 'ballB' | 'clubGrip' | 'clubHead' | 'targetFrom' | 'targetTo' | 'insidePoint';

const HANDLE_LABELS: Record<HandleKey, string> = {
  ballA: '球直径左端',
  ballB: '球直径右端',
  clubGrip: '球杆握把',
  clubHead: '杆头',
  targetFrom: '目标线起点',
  targetTo: '目标线终点',
  insidePoint: '内侧/学员方向',
};

export function CalibrationPage({ media, calibration, onChange, onBack, onAnalyze }: CalibrationPageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<HandleKey | null>(null);
  const [duration, setDuration] = useState(media.sample?.durationSec ?? 5);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoSize, setVideoSize] = useState({ w: media.sample?.width ?? 640, h: media.sample?.height ?? 360 });

  const pc = useMemo(
    () => createPixelCalibration(calibration, videoSize.w, videoSize.h),
    [calibration, videoSize],
  );

  const updatePoint = (key: HandleKey, p: Point) => {
    onChange({ ...calibration, [key]: { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) } });
  };

  const pointFromEvent = (e: React.PointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(t, duration - 0.01));
    setCurrentTime(t);
  };

  const handles: Array<{ key: HandleKey; color: string; strong?: boolean }> = [
    { key: 'ballA', color: '#22d3ee' },
    { key: 'ballB', color: '#22d3ee' },
    { key: 'clubGrip', color: '#f59e0b' },
    { key: 'clubHead', color: '#f59e0b' },
    { key: 'targetFrom', color: '#34d399' },
    { key: 'targetTo', color: '#34d399', strong: true },
    { key: 'insidePoint', color: '#c084fc' },
  ];

  return (
    <div className="page calibration-page">
      <div className="page-head">
        <button className="btn ghost" onClick={onBack}>← 返回导入</button>
        <div>
          <h1>尺度与目标标定</h1>
          <p>拖动彩色圆点。球直径和完整球杆长度会融合成击球平面的 mm/px 尺度。</p>
        </div>
        <button className="btn primary large" onClick={onAnalyze}>开始 Worker 分析 →</button>
      </div>

      <div className="calibration-layout">
        <div className="card stage-card">
          <div className="video-stage" style={{ aspectRatio: `${videoSize.w} / ${videoSize.h}` }}>
            <video
              ref={videoRef}
              src={media.url}
              playsInline
              muted
              preload="auto"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setVideoSize({ w: v.videoWidth || 640, h: v.videoHeight || 360 });
                setDuration(v.duration || media.sample?.durationSec || 5);
              }}
              onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
            />
            <svg
              ref={svgRef}
              className="calibration-svg"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              onPointerMove={(e) => {
                if (active) updatePoint(active, pointFromEvent(e));
              }}
              onPointerUp={() => setActive(null)}
              onPointerLeave={() => setActive(null)}
            >
              <line x1={calibration.targetFrom.x * 100} y1={calibration.targetFrom.y * 100} x2={calibration.targetTo.x * 100} y2={calibration.targetTo.y * 100} stroke="#34d399" strokeWidth="0.55" vectorEffect="non-scaling-stroke" strokeDasharray="5 4" />
              <line x1={calibration.ballA.x * 100} y1={calibration.ballA.y * 100} x2={calibration.ballB.x * 100} y2={calibration.ballB.y * 100} stroke="#22d3ee" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
              <line x1={calibration.clubGrip.x * 100} y1={calibration.clubGrip.y * 100} x2={calibration.clubHead.x * 100} y2={calibration.clubHead.y * 100} stroke="#f59e0b" strokeWidth="0.75" vectorEffect="non-scaling-stroke" />
              <line x1={calibration.ballA.x * 100} y1={((calibration.ballA.y + calibration.ballB.y) / 2) * 100} x2={calibration.insidePoint.x * 100} y2={calibration.insidePoint.y * 100} stroke="#c084fc" strokeWidth="0.55" vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />
              {handles.map(({ key, color }) => {
                const p = calibration[key] as Point;
                return (
                  <g
                    key={key}
                    transform={`translate(${p.x * 100} ${p.y * 100})`}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setActive(key);
                    }}
                    className="handle"
                  >
                    <circle r="2.2" fill={color} opacity="0.22" />
                    <circle r="1.05" fill={color} stroke="#07111f" strokeWidth="0.35" vectorEffect="non-scaling-stroke" />
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="seek-row">
            <button className="btn secondary" onClick={() => seek(currentTime - 1 / calibration.fps)}>−1 帧</button>
            <input
              type="range"
              min={0}
              max={duration}
              step={1 / calibration.fps}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
            />
            <button className="btn secondary" onClick={() => seek(currentTime + 1 / calibration.fps)}>+1 帧</button>
            <span className="timecode">{currentTime.toFixed(3)}s</span>
          </div>
        </div>

        <aside className="card calibration-form">
          <h2>参数</h2>
          <label>
            机位
            <select value={calibration.cameraView} onChange={(e) => onChange({ ...calibration, cameraView: e.target.value as Calibration['cameraView'] })}>
              <option value="side">侧对学员 / 目标线横向</option>
              <option value="face-on">正对学员 / 透视目标线</option>
            </select>
          </label>
          <label>
            惯用手
            <select value={calibration.handedness} onChange={(e) => onChange({ ...calibration, handedness: e.target.value as Calibration['handedness'] })}>
              <option value="right">右手球员</option>
              <option value="left">左手球员（档案惯用手；角度仍按目标线左右）</option>
            </select>
          </label>
          <div className="two-col">
            <label>
              帧率 fps
              <input type="number" min={60} max={480} step={1} value={calibration.fps} onChange={(e) => onChange({ ...calibration, fps: Number(e.target.value) })} />
            </label>
            <label>
              曝光秒
              <input type="number" min={1 / 10000} max={1 / 30} step={1 / 10000} value={calibration.exposureSec} onChange={(e) => onChange({ ...calibration, exposureSec: Number(e.target.value) })} />
            </label>
          </div>
          <div className="two-col">
            <label>
              球直径 mm
              <input type="number" value={calibration.ballDiameterMm} onChange={(e) => onChange({ ...calibration, ballDiameterMm: Number(e.target.value) })} />
            </label>
            <label>
              球杆长度 mm
              <input type="number" value={calibration.clubLengthMm} onChange={(e) => onChange({ ...calibration, clubLengthMm: Number(e.target.value) })} />
            </label>
          </div>
          <label>
            纵深压缩系数 {calibration.depthCompression.toFixed(2)}
            <input type="range" min={0.35} max={1.1} step={0.01} value={calibration.depthCompression} onChange={(e) => onChange({ ...calibration, depthCompression: Number(e.target.value) })} />
          </label>

          <div className="scale-readout">
            <div><span>球尺度</span><b>{pc.ballMmPerPx.toFixed(3)} mm/px</b></div>
            <div><span>球杆尺度</span><b>{pc.clubMmPerPx.toFixed(3)} mm/px</b></div>
            <div className="primary"><span>融合尺度</span><b>{pc.mmPerPx.toFixed(3)} mm/px</b></div>
          </div>

          <h3>拖动手柄</h3>
          <ul className="handle-help">
            {handles.map((h) => (
              <li key={h.key}><i style={{ background: h.color }} />{HANDLE_LABELS[h.key]}</li>
            ))}
          </ul>
          {media.sample && (
            <div className="truth-note">
              样例真值：{media.sample.truth.clubHeadSpeedMps.toFixed(1)} m/s，
              杆面 {media.sample.truth.faceAngleDeg.toFixed(1)}°。分析页会显示偏差。
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
