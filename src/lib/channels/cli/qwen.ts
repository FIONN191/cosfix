import {
  ChannelError,
  type CliAdapter,
  type CliPlan,
  type RunOutcome,
  type VisionRequest,
  type VisionResult,
} from '../types.ts'
import { tryParseJson } from './codex.ts'

/**
 * Qwen Code CLI 适配器（备用通道）。
 *
 * 图片走 Gemini-CLI 系的 `@文件名` 引用语法写进提示词，不是独立参数。
 *
 * ⚠️ 只有失败路径经过实测：本机 qwen 装了但没配 auth，非交互模式会返回
 * `{"is_error":true,"error":{"message":"No auth type is selected..."}}`。
 * 成功路径的字段名（`result`）是按事件流格式推断的，等有登录环境再校正。
 * 正因为这个不确定，parse 里对拿不到 result 的情况给的是明确报错而不是
 * 猜一个字段——宁可报错也不要静默返回错的东西。
 */

export const qwenAdapter: CliAdapter = {
  id: 'qwen',
  label: 'Qwen Code CLI',
  quotaSource: '通义账号额度',

  plan(req: VisionRequest, exe: string): CliPlan {
    const refs = req.images.map((img) => `@${img.fileName}`).join(' ')
    const body = req.systemPrompt
      ? `${req.systemPrompt}\n\n---\n\n${req.userText}`
      : req.userText

    const prompt = refs ? `${refs}\n\n${body}` : body

    return {
      exe,
      args: ['-p', prompt, '-o', 'json'],
      files: req.images.map((img) => ({
        name: img.fileName,
        content: img.base64,
        encoding: 'base64' as const,
      })),
      readFrom: { kind: 'stdout' },
      timeoutMs: req.timeoutMs,
    }
  },

  parse(outcome: RunOutcome): VisionResult {
    if (outcome.timedOut) {
      throw new ChannelError(
        'timeout',
        'qwen',
        `Qwen 超时（${Math.round(outcome.elapsedMs / 1000)}s）`,
        outcome.stderr.trim().split('\n').slice(-5).join('\n'),
      )
    }

    const events = parseEventStream(outcome.stdout)
    const result = events.findLast((e) => e.type === 'result')

    if (!result) {
      throw new ChannelError(
        'bad-output',
        'qwen',
        'Qwen 的输出里没有 result 事件',
        `${outcome.stdout}\n${outcome.stderr}`.trim().slice(-800),
      )
    }

    if (result.is_error) {
      const msg = result.error?.message ?? '未知错误'
      if (/no auth type|not authenticated|login/i.test(msg)) {
        throw new ChannelError(
          'not-authenticated',
          'qwen',
          'Qwen 未配置认证。在终端跑一次 `qwen` 交互式登录后重试。',
          msg,
        )
      }
      if (/quota|rate limit|429/i.test(msg)) {
        throw new ChannelError('quota-exhausted', 'qwen', 'Qwen 额度用尽', msg)
      }
      throw new ChannelError('exec-failed', 'qwen', `Qwen 执行失败：${msg}`, msg)
    }

    const text = typeof result.result === 'string' ? result.result.trim() : ''
    if (!text) {
      throw new ChannelError(
        'bad-output',
        'qwen',
        'Qwen 返回了成功事件但没有正文（result 字段名可能与预期不符）',
        JSON.stringify(result).slice(0, 800),
      )
    }

    const tokens =
      (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0)

    return {
      channelId: 'qwen',
      text,
      json: tryParseJson(text),
      tokensUsed: tokens > 0 ? tokens : null,
      elapsedMs: outcome.elapsedMs,
    }
  },
}

interface QwenEvent {
  type?: string
  subtype?: string
  is_error?: boolean
  result?: unknown
  error?: { message?: string }
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** stdout 可能是一个 JSON 数组，也可能是逐行 JSON，两种都接 */
export function parseEventStream(stdout: string): QwenEvent[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []

  const whole = tryParseJson(trimmed)
  if (Array.isArray(whole)) return whole as QwenEvent[]
  if (whole && typeof whole === 'object') return [whole as QwenEvent]

  const events: QwenEvent[] = []
  for (const line of trimmed.split('\n')) {
    const parsed = tryParseJson(line)
    if (parsed && typeof parsed === 'object') events.push(parsed as QwenEvent)
  }
  return events
}
