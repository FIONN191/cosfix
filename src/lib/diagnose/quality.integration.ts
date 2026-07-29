import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { codexAdapter } from '../channels/cli/codex.ts'
import type { RunOutcome, VisionRequest } from '../channels/types.ts'
import { computeLocalMetrics } from '../metrics/index.ts'
import type { PixelSource } from '../metrics/types.ts'
import { buildSystemPrompt, buildUserText } from './framework.ts'
import { buildMetricsBrief } from './metricsBrief.ts'
import { normalizeDiagnosis, sortByPriority } from './run.ts'
import { DIAGNOSIS_SCHEMA } from './schema.ts'
import { DIMENSION_LABELS, FIXABILITY_LABELS, SEVERITY_LABELS } from './types.ts'

/**
 * 拿真实场照验诊断质量。**这是唯一能证明提示词有没有用的测试。**
 *
 * 图片放 test/fixtures/private/（已 gitignore，绝不进公开仓库）。
 * 文件不存在就跳过，别的机器上不会红。
 *
 * 界面还没做，本地指标又需要 canvas，所以这里用 ffmpeg 把图解码成裸
 * RGBA 来构造 PixelSource——跟浏览器里 getImageData 拿到的是一回事。
 *
 * npm run test:integration
 */

const require = createRequire(import.meta.url)
const { detectChannels, runPlan } = require('../../../electron/channels.cjs') as {
  detectChannels: () => Array<{ id: string; exe: string | null }>
  runPlan: (plan: unknown) => Promise<RunOutcome>
}

const FIXTURE_DIR = fileURLToPath(
  new URL('../../../test/fixtures/private/', import.meta.url),
)

/** 跟 image.ts 里的常量保持一致 */
const MAX_METRICS_PIXELS = 24_000_000
const NATIVE_CROP_EDGE = 1024
const UPLOAD_MAX_EDGE = 1536

function ffmpeg(args: string[]): Buffer {
  const candidates = [`${process.env.HOME}/.local/bin/ffmpeg`, 'ffmpeg']
  const exe = candidates.find((c) => c === 'ffmpeg' || existsSync(c)) ?? 'ffmpeg'
  return execFileSync(exe, args, { maxBuffer: 512 * 1024 * 1024 })
}

function probeSize(path: string): { width: number; height: number } {
  const exe = existsSync(`${process.env.HOME}/.local/bin/ffprobe`)
    ? `${process.env.HOME}/.local/bin/ffprobe`
    : 'ffprobe'
  const out = execFileSync(exe, [
    '-v', 'error',
    '-select_streams', 'v',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    path,
  ]).toString().trim()
  const [w, h] = out.split(',').map(Number)
  return { width: w ?? 0, height: h ?? 0 }
}

/** 解码成 RGBA，可选缩放/裁切，返回 metrics 能吃的 PixelSource */
function decodeToPixels(
  path: string,
  filter: string,
  width: number,
  height: number,
): PixelSource {
  const raw = ffmpeg([
    '-v', 'error',
    '-i', path,
    ...(filter ? ['-vf', filter] : []),
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-',
  ])
  return {
    data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength),
    width,
    height,
  }
}

function scaleToPixelBudget(w: number, h: number, budget: number) {
  if (w * h <= budget) return { width: w, height: h }
  const s = Math.sqrt(budget / (w * h))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

function scaleToLongEdge(w: number, h: number, maxEdge: number) {
  const longest = Math.max(w, h)
  if (longest <= maxEdge) return { width: w, height: h }
  const s = maxEdge / longest
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

describe('真实场照诊断质量', () => {
  const target = `${FIXTURE_DIR}promare-b.png`
  const hasFixture = existsSync(target)

  it.skipIf(!hasFixture)(
    '普罗米娅成品：走 retouched 口径跑完整诊断',
    async () => {
      const codex = detectChannels().find((c) => c.id === 'codex')
      if (!codex?.exe) {
        expect.unreachable('本机没有 codex')
        return
      }

      const { width, height } = probeSize(target)

      // 1. 全局取样
      const g = scaleToPixelBudget(width, height, MAX_METRICS_PIXELS)
      const globalDownscaled = g.width !== width || g.height !== height
      const global = decodeToPixels(
        target,
        globalDownscaled ? `scale=${g.width}:${g.height}` : '',
        g.width,
        g.height,
      )

      // 2. 原始分辨率中心裁切（锐度/噪点必须在这上面测）
      const cw = Math.min(width, NATIVE_CROP_EDGE)
      const ch = Math.min(height, NATIVE_CROP_EDGE)
      const native = decodeToPixels(
        target,
        `crop=${cw}:${ch}:${Math.floor((width - cw) / 2)}:${Math.floor((height - ch) / 2)}`,
        cw,
        ch,
      )

      const metrics = computeLocalMetrics({
        global,
        native,
        originalWidth: width,
        originalHeight: height,
        globalDownscaled,
        exif: null,
      })

      const brief = buildMetricsBrief(metrics)
      console.log('\n=== 本地指标 ===\n' + brief)

      // 3. 上传副本
      const u = scaleToLongEdge(width, height, UPLOAD_MAX_EDGE)
      const jpg = ffmpeg([
        '-v', 'error',
        '-i', target,
        '-vf', `scale=${u.width}:${u.height}`,
        '-q:v', '3',
        '-f', 'mjpeg',
        '-',
      ])

      const req: VisionRequest = {
        systemPrompt: buildSystemPrompt('retouched'),
        userText: buildUserText({
          metricsBrief: brief,
          note: '角色：普罗米娅（PROMARE）。展会场照，已完成后期。',
          state: 'retouched',
        }),
        images: [{ base64: jpg.toString('base64'), fileName: 'main.jpg' }],
        jsonSchema: DIAGNOSIS_SCHEMA,
        timeoutMs: 300_000,
      }

      const outcome = await runPlan(codexAdapter.plan(req, codex.exe))
      const report = normalizeDiagnosis(codexAdapter.parse(outcome).json)

      console.log(
        '\n=== 诊断结果 ===\n' +
          `总评：${report.overallImpression}\n\n` +
          `保护清单：${report.protectList.join('、') || '(空)'}\n\n` +
          sortByPriority(report.findings)
            .map(
              (f) =>
                `[${f.priority}] ${f.id} ${DIMENSION_LABELS[f.dimension]} · ` +
                `${SEVERITY_LABELS[f.severity]} · ${FIXABILITY_LABELS[f.fixability]}\n` +
                `    ${f.title}\n` +
                `    位置：${f.location}\n` +
                `    成因：${f.cause}`,
            )
            .join('\n\n'),
      )

      expect(report.findings.length).toBeGreaterThan(0)
      // 真人场照必须能提取出角色特征，提不出说明保护清单机制没生效
      expect(report.protectList.length).toBeGreaterThan(0)
    },
    360_000,
  )
})
