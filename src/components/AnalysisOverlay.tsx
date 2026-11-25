import { useEffect, useRef } from 'react';
import type { AnalysisResult } from '../types';
import { createPixelCalibration, deg2rad, horizontalAngleToImageVector } from '../lib/geometry';

interface AnalysisOverlayProps {
  result: AnalysisResult | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  width: number;
  height: number;
}

export function AnalysisOverlay({ result, videoRef, width, height }: AnalysisOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (result) {
        const pc = createPixelCalibration(result.calibration, width, height);
        const impact = result.track.find((t) => t.frame === result.impactFrame) ?? {
          x: 0.5,
          y: 0.7,
          frame: result.impactFrame,
        };
        const ix = impact.x * width;
        const iy = impact.y * height;

        // Swing plane translucent slab and principal line.
        if (result.plane) {
          const p = result.plane;
          ctx.save();
          ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.95)';
          ctx.lineWidth = 4;
          ctx.shadowColor = 'rgba(52,211,153,.55)';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(p.start.x * width, p.start.y * height);
          ctx.lineTo(p.end.x * width, p.end.y * height);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(52,211,153,0.16)';
          ctx.lineWidth = 34;
          ctx.beginPath();
          ctx.moveTo(p.start.x * width, p.start.y * height);
          ctx.lineTo(p.end.x * width, p.end.y * height);
          ctx.stroke();
          ctx.restore();
        }

        // Club-head trajectory polyline.
        if (result.track.length > 1) {
          ctx.save();
          ctx.strokeStyle = 'rgba(34, 211, 238, .82)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          let started = false;
          for (const p of result.track) {
            if (p.confidence < 0.18) continue;
            const x = p.x * width;
            const y = p.y * height;
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.restore();
        }

        // Face and path vectors.
        const pathVec = horizontalAngleToImageVector(deg2rad(result.pathAngleDeg), pc);
        const faceNormal = horizontalAngleToImageVector(deg2rad(result.faceAngleDeg), pc);
        const arrow = (v: { x: number; y: number }, color: string, label: string, len = 78) => {
          ctx.save();
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(ix, iy);
          ctx.lineTo(ix + v.x * len, iy + v.y * len);
          ctx.stroke();
          const a = Math.atan2(v.y, v.x);
          ctx.beginPath();
          ctx.moveTo(ix + v.x * len, iy + v.y * len);
          ctx.lineTo(ix + v.x * (len - 14) + Math.cos(a + 2.5) * 10, iy + v.y * (len - 14) + Math.sin(a + 2.5) * 10);
          ctx.lineTo(ix + v.x * (len - 14) + Math.cos(a - 2.5) * 10, iy + v.y * (len - 14) + Math.sin(a - 2.5) * 10);
          ctx.closePath();
          ctx.fill();
          ctx.font = '700 18px system-ui, sans-serif';
          ctx.fillText(label, ix + v.x * (len + 12) - 10, iy + v.y * (len + 12) + 6);
          ctx.restore();
        };
        arrow(pathVec, '#22d3ee', `路径 ${result.pathAngleDeg.toFixed(1)}°`);
        arrow(faceNormal, '#fbbf24', `杆面 ${result.faceAngleDeg.toFixed(1)}°`, 58);

        // Impact marker.
        ctx.save();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(ix, iy, 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(251,191,36,.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ix, iy, 27, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '800 16px system-ui, sans-serif';
        ctx.fillText('IMPACT', ix + 32, iy - 24);
        ctx.restore();

        // Current scrubber position marker.
        const video = videoRef.current;
        if (video && Number.isFinite(video.currentTime)) {
          const frame = Math.round(video.currentTime * result.calibration.fps);
          const current = result.track.reduce((best, p) =>
            Math.abs(p.frame - frame) < Math.abs(best.frame - frame) ? p : best, result.track[0]);
          if (current && current.confidence > 0.1) {
            ctx.fillStyle = '#a7f3d0';
            ctx.beginPath();
            ctx.arc(current.x * width, current.y * height, 7, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [result, width, height, videoRef]);

  return <canvas ref={canvasRef} width={width} height={height} className="analysis-canvas" />;
}
