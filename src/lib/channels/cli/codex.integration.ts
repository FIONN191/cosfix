import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import type { RunOutcome, VisionRequest } from '../types.ts'
import { codexAdapter } from './codex.ts'

/**
 * 真打 codex 的集成测试。文件名刻意不是 *.test.ts，所以默认 npm test
 * 不会捞到它——它会起子进程、耗时约 25s、消耗 ChatGPT 订阅额度。
 *
 * 单独跑：npm run test:integration
 *
 * 它把 TS 适配器和主进程执行器串在一起验，是「无需 API key」这条路线
 * 唯一的端到端证明。
 */

const require = createRequire(import.meta.url)
const { detectChannels, runPlan } = require('../../../../electron/channels.cjs') as {
  detectChannels: () => Array<{ id: string; exe: string | null; available: boolean }>
  runPlan: (plan: unknown) => Promise<RunOutcome>
}

/** 4x4 纯红 PNG 的 base64 */
const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHElEQVQIW2P8z8Dwn4EIwDiqkL4h' +
  'RQAAAP//AwDMjQXbnxKzeQAAAABJRU5ErkJggg=='

describe('codex 通道端到端', () => {
  it('探测得到 codex，并且不是靠 PATH 找到的', () => {
    const found = detectChannels().find((c) => c.id === 'codex')
    expect(found?.available).toBe(true)
    expect(found?.exe).toContain('codex')
  })

  it(
    '真跑一次：附图 + schema，拿回结构化 JSON',
    async () => {
      const codex = detectChannels().find((c) => c.id === 'codex')
      if (!codex?.exe) {
        expect.unreachable('本机没有 codex，跳过')
        return
      }

      const req: VisionRequest = {
        systemPrompt: '你只输出 JSON，不要任何解释。',
        userText:
          '看附件图片，判断它的主色调。dominant_color 用英文颜色单词填写。',
        images: [{ base64: RED_PNG, fileName: 'probe.png' }],
        jsonSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['dominant_color'],
          properties: { dominant_color: { type: 'string' } },
        },
        timeoutMs: 180_000,
      }

      const plan = codexAdapter.plan(req, codex.exe)
      const outcome = await runPlan(plan)
      const result = codexAdapter.parse(outcome)

      expect(result.channelId).toBe('codex')
      expect(result.json).toMatchObject({
        dominant_color: expect.stringMatching(/red/i),
      })
      expect(result.elapsedMs).toBeGreaterThan(0)
    },
    240_000,
  )
})
