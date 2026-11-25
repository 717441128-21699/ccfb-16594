import { useMemo, useRef, useState } from 'react';
import type { CameraView, SampleVideo } from '../types';
import { SWING_CASES, buildSampleManifest } from '../samples/cases';

export interface MediaSelection {
  url: string;
  name: string;
  file?: File;
  sample?: SampleVideo;
}

interface ImportPageProps {
  onContinue: (media: MediaSelection, cameraView: CameraView) => void;
}

const faultLabels: Record<string, string> = {
  ideal: '标准',
  slice: '右曲',
  hook: '左曲',
  push: '推右',
  pull: '拉左',
  'over-the-top': 'Over-the-top',
  'inside-out': '内向外',
  'early-release': '提前释放',
  'steep-plane': '陡平面',
  'shallow-plane': '浅平面',
};

export function ImportPage({ onContinue }: ImportPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [cameraView, setCameraView] = useState<CameraView>('side');
  const [error, setError] = useState('');
  const samples = useMemo(() => buildSampleManifest(), []);
  const caseById = useMemo(() => new Map(SWING_CASES.map((c) => [c.id, c])), []);

  const handleFile = (file?: File | null) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
      setError('请选择 MP4、MOV 或 WebM 视频。');
      return;
    }
    const url = URL.createObjectURL(file);
    onContinue({ url, name: file.name, file }, cameraView);
  };

  return (
    <div className="page import-page">
      <section className="hero card">
        <div>
          <p className="eyebrow">Phone-first launch monitor</p>
          <h1>从 240fps 拖影里反推杆头速度与杆面角</h1>
          <p className="lead">
            导入慢动作视频，用球直径和球杆长度完成尺度标定；Web Worker 搜索杆头与拖影，
            Canvas 叠加挥杆平面、轨迹和击球角度。
          </p>
          <div className="hero-actions">
            <button className="btn primary large" onClick={() => inputRef.current?.click()}>
              导入学员挥杆视频
            </button>
            <button className="btn secondary large" onClick={() => document.getElementById('sample-library')?.scrollIntoView({ behavior: 'smooth' })}>
              使用毛病样例
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="video/*,.mp4,.mov,.webm,.m4v"
            hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {error && <p className="error-text">{error}</p>}
        </div>
        <div
          className={`upload-zone ${dragOver ? 'drag' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="upload-icon">⬆</div>
          <strong>拖拽视频到这里</strong>
          <span>建议 5 秒、240fps、击球前后完整入镜</span>
          <div className="camera-switch" onClick={(e) => e.stopPropagation()}>
            <button className={cameraView === 'side' ? 'active' : ''} onClick={() => setCameraView('side')}>
              侧对学员
            </button>
            <button className={cameraView === 'face-on' ? 'active' : ''} onClick={() => setCameraView('face-on')}>
              正对学员
            </button>
          </div>
        </div>
      </section>

      <section className="requirements-grid">
        <div className="card mini">
          <b>1. 稳定机位</b>
          <span>尽量固定手机，背景避免大面积白色快速移动物体。</span>
        </div>
        <div className="card mini">
          <b>2. 球与杆都入镜</b>
          <span>标定帧需看清球直径，以及球杆握把到杆头的完整长度。</span>
        </div>
        <div className="card mini">
          <b>3. 知道快门时间</b>
          <span>拖影测速依赖曝光时长；样例使用 1/1600s，可在标定页修改。</span>
        </div>
      </section>

      <section id="sample-library" className="sample-section">
        <div className="section-heading">
          <div>
            <h2>典型挥杆毛病样例</h2>
            <p>共 {SWING_CASES.length} 组球、每组提供侧对与正对机位；附杆头速度、杆面、路径和方向真值。</p>
          </div>
          <span className="badge ok">真值 JSON 随视频生成</span>
        </div>
        <div className="sample-grid">
          {samples.map((sample) => {
            const caseId = sample.id.replace(/-(side|face-on)$/, '');
            const c = caseById.get(caseId);
            return (
              <button
                key={sample.id}
                className="card sample-card"
                onClick={() => onContinue({
                  url: `${import.meta.env.BASE_URL}${sample.file}`,
                  name: `${sample.id}.mp4`,
                  sample,
                }, sample.cameraView)}
              >
                <div className="sample-thumb">
                  <video muted playsInline preload="metadata" src={`${import.meta.env.BASE_URL}${sample.file}#t=3.5`} />
                  <span className={`badge camera ${sample.cameraView}`}>
                    {sample.cameraView === 'side' ? '侧对' : '正对'}
                  </span>
                </div>
                <div className="sample-body">
                  <div className="sample-title-row">
                    <strong>{c?.title ?? sample.title}</strong>
                    <span className="fault-tag">{faultLabels[sample.fault] ?? sample.fault}</span>
                  </div>
                  <p>{sample.description}</p>
                  <div className="truth-grid">
                    <span><b>{sample.truth.clubHeadSpeedMps.toFixed(1)}</b> m/s</span>
                    <span><b>{sample.truth.faceAngleDeg > 0 ? '+' : ''}{sample.truth.faceAngleDeg.toFixed(1)}°</b> 杆面</span>
                    <span><b>{sample.truth.pathAngleDeg > 0 ? '+' : ''}{sample.truth.pathAngleDeg.toFixed(1)}°</b> 路径</span>
                    <span><b>{sample.truth.directionDeg > 0 ? '+' : ''}{sample.truth.directionDeg.toFixed(1)}°</b> 方向</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
