import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { once } from 'node:events';
import { buildSampleManifest, SWING_CASES, SAMPLE_FRAMES, SAMPLE_FPS, SAMPLE_HEIGHT, SAMPLE_WIDTH } from '../src/samples/cases';
import { renderSampleFrame } from '../src/samples/renderer';
import type { SampleVideo } from '../src/types';

const outDir = resolve('public/samples');
mkdirSync(outDir, { recursive: true });

function ffmpegBin(): string {
  return process.env.FFMPEG_BIN || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

async function encodeSample(sample: SampleVideo, force: boolean): Promise<void> {
  const outputPath = resolve('public', sample.file);
  mkdirSync(dirname(outputPath), { recursive: true });
  if (!force && existsSync(outputPath)) {
    console.log(`skip existing ${sample.id}`);
    return;
  }

  const caseSpec = SWING_CASES.find((c) => sample.id.startsWith(c.id));
  if (!caseSpec) throw new Error(`Missing swing case for ${sample.id}`);
  const view = sample.cameraView;

  const args = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${SAMPLE_WIDTH}x${SAMPLE_HEIGHT}`,
    '-r', String(SAMPLE_FPS),
    '-i', '-',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '12',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ];

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const ff = spawn(ffmpegBin(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
    });
    ff.on('error', rejectPromise);
    ff.on('close', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`ffmpeg ${sample.id} exited ${code}\n${stderr.slice(-2000)}`));
    });

    (async () => {
      try {
        for (let frame = 0; frame < SAMPLE_FRAMES; frame++) {
          const rgba = renderSampleFrame(caseSpec, view, frame).data;
          // Copy into a fresh Buffer because the renderer owns/caches typed arrays
          // only for backgrounds; frame data itself is new, but Buffer.from keeps
          // typing explicit and avoids shared-pool surprises.
          const buffer = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
          if (!ff.stdin.write(buffer)) await once(ff.stdin, 'drain');
          if (frame % 240 === 0) console.log(`${sample.id}: frame ${frame}/${SAMPLE_FRAMES}`);
        }
        ff.stdin.end();
      } catch (error) {
        rejectPromise(error);
      }
    })();
  });
  console.log(`encoded ${sample.file}`);
}

async function main() {
  const force = process.argv.includes('--force');
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.split('=')[1];
  const manifest = buildSampleManifest().filter((s) => !only || s.id.includes(only));
  for (const sample of manifest) {
    await encodeSample(sample, force);
  }
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(buildSampleManifest(), null, 2));
  writeFileSync(resolve(outDir, 'truth.json'), JSON.stringify({
    fps: SAMPLE_FPS,
    width: SAMPLE_WIDTH,
    height: SAMPLE_HEIGHT,
    frameCount: SAMPLE_FRAMES,
    cases: SWING_CASES,
    videos: buildSampleManifest().map((s) => ({ id: s.id, file: s.file, cameraView: s.cameraView, truth: s.truth })),
  }, null, 2));
  console.log(`Wrote manifest and truth for ${manifest.length} selected samples.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
