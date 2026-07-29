import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { codexAdapter } from '../channels/cli/codex.ts'
import type { RunOutcome, VisionRequest } from '../channels/types.ts'
import { buildSystemPrompt, buildUserText } from './framework.ts'
import { normalizeDiagnosis } from './run.ts'
import { DIAGNOSIS_SCHEMA } from './schema.ts'

/**
 * 验一件具体的事：**完整的 DIAGNOSIS_SCHEMA 能不能被 codex 的
 * --output-schema 吃下去。**
 *
 * 它比之前那个玩具 schema 复杂得多——嵌套对象数组、三个 enum、
 * 每层都要求 additionalProperties:false 且 required 全列。这是整条
 * 链路上最容易出问题的地方，得单独证明。
 *
 * 用的是合成渐变图，所以**这个测试不证明诊断质量**，只证明格式跑得通。
 * 提示词写得好不好，只有拿真实场照跑才知道。
 *
 * npm run test:integration
 */

const require = createRequire(import.meta.url)
const { detectChannels, runPlan } = require('../../../electron/channels.cjs') as {
  detectChannels: () => Array<{ id: string; exe: string | null }>
  runPlan: (plan: unknown) => Promise<RunOutcome>
}

const FIXTURE = new URL(
  '../../../test/fixtures/synthetic/gradient-portrait.jpg',
  import.meta.url,
)

/** 合成图没有真实指标，这里给一份能读通的假数据 */
const METRICS_BRIEF = `
- 尺寸：1024×1536，2:3，1.6MP
- 曝光：平均亮度 128/255，对比度(RMS) 42.0，亮度分位 p5=40 p50=126 p95=214
- 裁切：高光死白 0.0%，暗部死黑 0.0%
- 白平衡：偏暖，偏移幅度 0.35（0-1），R/B 比 1.28
- 饱和度：平均 0.41（0-1），高饱和像素占比 2.0%
- 肤色：肤色区域仅占 0.3%，采样不足，程序不下结论——请你直接看图判断
- 锐度：拉普拉斯方差 12 → 偏软/发糊（在原始分辨率裁切上测的，可信）
- 噪点：平坦区标准差估计 0.80（0-255 尺度）
- 主色板：#24304a 41.0%，#7a6a63 32.0%，#e0a878 27.0%
- 亮度重心：x=0.50 y=0.52（0-1，0.5 为正中）；未检测到明显水平线
- 拍摄参数：无拍摄参数（EXIF 缺失或已被剥除）
`.trim()

describe('诊断 schema 端到端', () => {
  it(
    '完整 DIAGNOSIS_SCHEMA 能被 codex 强制执行，输出通过本地校验',
    async () => {
      const codex = detectChannels().find((c) => c.id === 'codex')
      if (!codex?.exe) {
        expect.unreachable('本机没有 codex')
        return
      }

      const base64 = readFileSync(FIXTURE).toString('base64')

      const req: VisionRequest = {
        systemPrompt: buildSystemPrompt('raw'),
        userText: buildUserText({
          metricsBrief: METRICS_BRIEF,
          note: '这是一张用于测试的合成渐变图，不是真实照片。请照常按框架诊断。',
          state: 'raw',
        }),
        images: [{ base64, fileName: 'main.jpg' }],
        jsonSchema: DIAGNOSIS_SCHEMA,
        timeoutMs: 180_000,
      }

      const outcome = await runPlan(codexAdapter.plan(req, codex.exe))
      const result = codexAdapter.parse(outcome)

      // 关键：schema 生效，拿到的直接就是对象而不是要靠正则捞的文本
      expect(result.json).not.toBeNull()

      const report = normalizeDiagnosis(result.json)

      expect(report.overallImpression.length).toBeGreaterThan(10)
      expect(report.findings.length).toBeGreaterThan(0)

      for (const f of report.findings) {
        expect(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']).toContain(f.dimension)
        expect(['critical', 'major', 'minor', 'good']).toContain(f.severity)
        expect(['post-fixable', 'ai-generative', 'reshoot-only']).toContain(
          f.fixability,
        )
        // location 不能是空的——铁律就是每条都要指到具体位置
        expect(f.location.trim().length).toBeGreaterThan(0)
      }

      console.log(
        '\n=== 诊断结果 ===\n' +
          `总评：${report.overallImpression}\n` +
          `保护清单：${report.protectList.join('、') || '(空)'}\n` +
          report.findings
            .map(
              (f) =>
                `  [${f.priority}] ${f.id} ${f.severity}/${f.fixability}\n` +
                `      ${f.title}\n      位置：${f.location}\n      成因：${f.cause}`,
            )
            .join('\n'),
      )
    },
    240_000,
  )
})
