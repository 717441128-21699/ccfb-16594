import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SWING_CASES, calibrationForView, type SwingCaseSpec } from '../src/samples/cases';
import { renderSampleFrame } from '../src/samples/renderer';
import { SwingTracker, finalizeAnalysis } from '../src/lib/tracker';
import { directionCorrect, predictedDirectionClass } from '../src/lib/validation';
import type { CameraView } from '../src/types';

export interface SampleValidationRow {
  id: string;
  caseId: string;
  view: CameraView;
  fault: string;
  impactFrame: number;
  impactErrorFrames: number;
  truthSpeed: number;
  estimatedSpeed: number;
  speedErrorPct: number;
  speedPass: boolean;
  truthFace: number;
  estimatedFace: number;
  faceErrorDeg: number;
  facePass: boolean;
  truthPath: number;
  estimatedPath: number;
  pathErrorDeg: number;
  truthDirection: number;
  predictedDirection: 'left' | 'straight' | 'right';
  truthDirectionClass: 'left' | 'straight' | 'right';
  directionPass: boolean;
  shot: string;
  trackerMs: number;
  renderMs: number;
  totalMs: number;
}

function truthDirectionClass(d: number): 'left' | 'straight' | 'right' {
  return d > 2.5 ? 'right' : d < -2.5 ? 'left' : 'straight';
}

export function validateCaseView(spec: SwingCaseSpec, view: CameraView): SampleValidationRow {
  const calibration = calibrationForView(view);
  const tracker = new SwingTracker(calibration, 640, 360);
  let trackerMs = 0;
  let renderMs = 0;
  const totalStart = performance.now();

  for (let frame = 0; frame < 1200; frame++) {
    const renderStart = performance.now();
    const rendered = renderSampleFrame(spec, view, frame);
    renderMs += performance.now() - renderStart;

    const trackerStart = performance.now();
    tracker.process(frame, rendered.data);
    trackerMs += performance.now() - trackerStart;
  }

  const result = finalizeAnalysis(tracker.observations, calibration, 640, 360, trackerMs, 1200);
  const speedErrorPct = ((result.clubHeadSpeedMps - spec.clubHeadSpeedMps) / spec.clubHeadSpeedMps) * 100;
  const faceErrorDeg = result.faceAngleDeg - spec.faceAngleDeg;
  const pathErrorDeg = result.pathAngleDeg - spec.pathAngleDeg;
  const pseudoTruth = { directionDeg: spec.directionDeg };
  const directionPass = directionCorrect(result, pseudoTruth);

  return {
    id: `${spec.id}-${view}`,
    caseId: spec.id,
    view,
    fault: spec.fault,
    impactFrame: result.impactFrame,
    impactErrorFrames: Math.abs(result.impactFrame - 840),
    truthSpeed: spec.clubHeadSpeedMps,
    estimatedSpeed: result.clubHeadSpeedMps,
    speedErrorPct,
    speedPass: Math.abs(speedErrorPct) <= 5,
    truthFace: spec.faceAngleDeg,
    estimatedFace: result.faceAngleDeg,
    faceErrorDeg,
    facePass: Math.abs(faceErrorDeg) <= 2,
    truthPath: spec.pathAngleDeg,
    estimatedPath: result.pathAngleDeg,
    pathErrorDeg,
    truthDirection: spec.directionDeg,
    predictedDirection: predictedDirectionClass(result),
    truthDirectionClass: truthDirectionClass(spec.directionDeg),
    directionPass,
    shot: result.shot.shape,
    trackerMs: Math.round(trackerMs),
    renderMs: Math.round(renderMs),
    totalMs: Math.round(performance.now() - totalStart),
  };
}

export function runValidation(): { rows: SampleValidationRow[]; markdown: string } {
  const rows: SampleValidationRow[] = [];
  for (const spec of SWING_CASES) {
    for (const view of ['side', 'face-on'] as CameraView[]) {
      process.stdout.write(`validating ${spec.id} ${view} ... `);
      const row = validateCaseView(spec, view);
      rows.push(row);
      process.stdout.write(
        `speed ${row.speedErrorPct.toFixed(2)}% face ${row.faceErrorDeg.toFixed(2)}° dir ${row.directionPass ? 'OK' : 'MISS'}\n`,
      );
    }
  }

  const passSpeed = rows.filter((r) => r.speedPass).length;
  const passFace = rows.filter((r) => r.facePass).length;
  const passDirection = rows.filter((r) => r.directionPass).length;
  const perCase = SWING_CASES.map((c) => {
    const caseRows = rows.filter((r) => r.caseId === c.id);
    return {
      id: c.id,
      directionPass: caseRows.every((r) => r.directionPass),
      speedPass: caseRows.every((r) => r.speedPass),
      facePass: caseRows.every((r) => r.facePass),
    };
  });
  const caseDirection = perCase.filter((r) => r.directionPass).length;
  const caseSpeed = perCase.filter((r) => r.speedPass).length;
  const caseFace = perCase.filter((r) => r.facePass).length;
  const avgTrackerMs = rows.reduce((s, r) => s + r.trackerMs, 0) / rows.length;

  const markdown = [
    '# 合成样例精度验证',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '该报告验证“合成真值 → RGBA 帧 → Web Worker 同款跟踪/角度算法”的数值链路。它不能替代真实雷达同步实测；真实 paired radar 应对标数据请在分析页输入并保存到学员档案。',
    '',
    '## 汇总',
    '',
    `- 机位样本：${rows.length}（10 组球 × 正对/侧对）`,
    `- 速度 ≤5%：${passSpeed}/${rows.length} 机位；按球双机位均通过 ${caseSpeed}/10`,
    `- 杆面角 ≤2°：${passFace}/${rows.length} 机位；按球双机位均通过 ${caseFace}/10`,
    `- 方向判对：${passDirection}/${rows.length} 机位；按球双机位均判对 ${caseDirection}/10`,
    `- Node 中纯跟踪平均耗时：${(avgTrackerMs / 1000).toFixed(2)}s / 1200 帧（不含视频 seek/decode；生产使用 480px 宽并在 Worker 中运行）`,
    '',
    '| 样例 | 机位 | 击球帧误差 | 速度真值 | 速度估计 | 误差% | 杆面真值 | 杆面估计 | 误差° | 路径误差° | 方向 | 球路 | Tracker ms |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|',
    ...rows.map((r) =>
      `| ${r.caseId} | ${r.view} | ${r.impactErrorFrames} | ${r.truthSpeed.toFixed(1)} | ${r.estimatedSpeed.toFixed(1)} | ${r.speedErrorPct.toFixed(2)} ${r.speedPass ? '✅' : '❌'} | ${r.truthFace.toFixed(1)} | ${r.estimatedFace.toFixed(2)} | ${r.faceErrorDeg.toFixed(2)} ${r.facePass ? '✅' : '❌'} | ${r.pathErrorDeg.toFixed(2)} | ${r.directionPass ? '✅' : '❌'} ${r.predictedDirection}/${r.truthDirectionClass} | ${r.shot} | ${r.trackerMs} |`,
    ),
    '',
  ].join('\n');

  return { rows, markdown };
}

{
  const { rows, markdown } = runValidation();
  const jsonPath = resolve('public/samples/validation-report.json');
  const mdPath = resolve('VALIDATION.md');
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
  writeFileSync(mdPath, markdown);
  const failed = rows.filter((r) => !r.speedPass || !r.facePass || !r.directionPass);
  console.log(`\nWrote ${jsonPath} and ${mdPath}`);
  console.log(`Failed rows: ${failed.length}/${rows.length}`);
  if (failed.length) {
    for (const r of failed) console.log(r.id, { speed: r.speedErrorPct, face: r.faceErrorDeg, dir: r.directionPass });
    process.exitCode = 1;
  }
}
