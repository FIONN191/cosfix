import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computeLocalMetrics } from './index.ts'
import type { LocalMetrics, PixelSource } from './types.ts'
import { buildMetricsBrief } from '../diagnose/metricsBrief.ts'

/**
 * 拿真实场照验指标层。**不消耗任何额度**，纯本地计算。
 *
 * 验两件事：
 *   1. 指标跑在真实 24MP 照片上不炸、耗时可接受
 *   2. 同一张图的两个修图版本能被指标区分出来——这是 M3 参考图对比
 *      的地基，如果指标对真实差异不敏感，那套差集分析就是空的
 *
 * 图片放 test/fixtures/private/（已 gitignore）。文件不在就跳过。
 */

const FIXTURE_DIR = fileURLToPath(
  new URL('../../../test/fixtures/private/', import.meta.url),
)

const MAX_METRICS_PIXELS = 24_000_000
const NATIVE_CROP_EDGE = 1024

function bin(name: string): string {
  const local = `${process.env.HOME}/.local/bin/${name}`
  return existsSync(local) ? local : name
}

function probeSize(path: string): { width: number; height: number } {
  const out = execFileSync(bin('ffprobe'), [
    '-v', 'error',
    '-select_streams', 'v',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    path,
  ]).toString().trim()
  const [w, h] = out.split(',').map(Number)
  return { width: w ?? 0, height: h ?? 0 }
}

function decode(
  path: string,
  filter: string,
  width: number,
  height: number,
): PixelSource {
  const raw = execFileSync(
    bin('ffmpeg'),
    [
      '-v', 'error',
      '-i', path,
      ...(filter ? ['-vf', filter] : []),
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-',
    ],
    { maxBuffer: 512 * 1024 * 1024 },
  )
  return {
    data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength),
    width,
    height,
  }
}

function analyze(path: string): { metrics: LocalMetrics; ms: number } {
  const { width, height } = probeSize(path)

  const budget = Math.sqrt(MAX_METRICS_PIXELS / (width * height))
  const down = width * height > MAX_METRICS_PIXELS
  const gw = down ? Math.round(width * budget) : width
  const gh = down ? Math.round(height * budget) : height

  const global = decode(path, down ? `scale=${gw}:${gh}` : '', gw, gh)

  const cw = Math.min(width, NATIVE_CROP_EDGE)
  const ch = Math.min(height, NATIVE_CROP_EDGE)
  const native = decode(
    path,
    `crop=${cw}:${ch}:${Math.floor((width - cw) / 2)}:${Math.floor((height - ch) / 2)}`,
    cw,
    ch,
  )

  const t0 = Date.now()
  const metrics = computeLocalMetrics({
    global,
    native,
    originalWidth: width,
    originalHeight: height,
    globalDownscaled: down,
    exif: null,
  })
  return { metrics, ms: Date.now() - t0 }
}

describe('真实场照指标', () => {
  const a = `${FIXTURE_DIR}promare-a.png`
  const b = `${FIXTURE_DIR}promare-b.png`
  const ready = existsSync(a) && existsSync(b)

  it.skipIf(!ready)('24MP 真实照片跑得动，耗时可接受', () => {
    const { metrics, ms } = analyze(b)
    console.log(`\n[B 版] 指标耗时 ${ms}ms\n${buildMetricsBrief(metrics)}`)

    expect(metrics.dimensions.megapixels).toBeGreaterThan(20)
    expect(metrics.palette.length).toBeGreaterThan(0)
    // 24MP 上如果超过 15s，就该把指标挪进 worker，别卡住界面
    expect(ms).toBeLessThan(15_000)
  }, 300_000)

  it.skipIf(!ready)('能分辨同一张图的两个修图版本', () => {
    const A = analyze(a).metrics
    const B = analyze(b).metrics

    const diff = {
      meanLuma: B.exposure.meanLuma - A.exposure.meanLuma,
      rmsContrast: B.exposure.rmsContrast - A.exposure.rmsContrast,
      highlightClip: B.exposure.highlightClipPct - A.exposure.highlightClipPct,
      shadowClip: B.exposure.shadowClipPct - A.exposure.shadowClipPct,
      saturation: B.saturation.mean - A.saturation.mean,
      sharpness: B.sharpness.laplacianVariance - A.sharpness.laplacianVariance,
      noise: B.noise.estimate - A.noise.estimate,
      skinCoverage: B.skin.coveragePct - A.skin.coveragePct,
      skinHue: (B.skin.meanHue ?? 0) - (A.skin.meanHue ?? 0),
    }

    console.log(
      '\n=== A → B 的指标差 ===\n' +
        Object.entries(diff)
          .map(([k, v]) => `  ${k.padEnd(14)} ${v >= 0 ? '+' : ''}${v.toFixed(4)}`)
          .join('\n') +
        `\n  主色板 A: ${A.palette.map((p) => p.hex).join(' ')}` +
        `\n  主色板 B: ${B.palette.map((p) => p.hex).join(' ')}`,
    )

    // 两个版本确实不同，至少有一项指标要动起来。全都一样说明指标太钝，
    // M3 的差集分析会建在沙子上。
    const moved = Object.values(diff).some((v) => Math.abs(v) > 1e-6)
    expect(moved).toBe(true)
  }, 300_000)
})
