import {
  ChannelError,
  type CliAdapter,
  type CliPlan,
  type PlanFile,
  type RunOutcome,
  type VisionRequest,
  type VisionResult,
} from '../types.ts'

/**
 * Codex CLI 适配器。走 ChatGPT 订阅额度，不消耗 API key。
 *
 * 每个开关都是踩出来的，别随手删：
 *
 *   提示词必须在 -i 前面    `-i` 是 `--image <FILE>...` 可变参数，放后面
 *                          会把提示词当成图片路径吞掉
 *   --skip-git-repo-check  非 git 目录直接拒跑，临时目录当然不是 git 仓库
 *   --ignore-user-config   绕开用户的 MCP 插件和推理档配置。实测耗时从
 *                          32s 降到 24s，日志噪音大幅下降；auth 仍然生效
 *   --ephemeral            不往磁盘留会话文件
 *   -s read-only           只为看一张图就启动一个全盘写权限的 agent 没道理
 *   --output-schema        让 codex 自己强制 JSON 结构，比在提示词里求它可靠
 *   -o <file>              最终消息单独写文件，不用从满屏 WARN 日志里捞
 *   --color never          免得 ANSI 转义混进输出
 *
 * 另外主进程必须把 stdin 关掉，否则它会卡在 "Reading additional input
 * from stdin..." 直到超时。
 */

const OUTPUT_FILE = 'cosfix-out.json'
const SCHEMA_FILE = 'cosfix-schema.json'

export const codexAdapter: CliAdapter = {
  id: 'codex',
  label: 'Codex CLI',
  quotaSource: 'ChatGPT 订阅额度',

  plan(req: VisionRequest, exe: string): CliPlan {
    const files: PlanFile[] = req.images.map((img) => ({
      name: img.fileName,
      content: img.base64,
      encoding: 'base64' as const,
    }))

    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ephemeral',
      '--color',
      'never',
      '-s',
      'read-only',
    ]

    if (req.jsonSchema) {
      files.push({
        name: SCHEMA_FILE,
        content: JSON.stringify(req.jsonSchema, null, 2),
        encoding: 'utf8',
      })
      args.push('--output-schema', SCHEMA_FILE)
    }

    args.push('-o', OUTPUT_FILE)

    // CLI 没有独立的 system 位，拼进正文
    const prompt = req.systemPrompt
      ? `${req.systemPrompt}\n\n---\n\n${req.userText}`
      : req.userText

    // 提示词必须在 -i 之前
    args.push(prompt)

    if (req.images.length > 0) {
      args.push('-i', ...req.images.map((img) => img.fileName))
    }

    return {
      exe,
      args,
      files,
      readFrom: { kind: 'file', name: OUTPUT_FILE },
      timeoutMs: req.timeoutMs,
    }
  },

  parse(outcome: RunOutcome): VisionResult {
    if (outcome.timedOut) {
      throw new ChannelError(
        'timeout',
        'codex',
        `Codex 超时（${Math.round(outcome.elapsedMs / 1000)}s）`,
        tailLines(outcome.stderr, 5),
      )
    }

    const combined = `${outcome.stdout}\n${outcome.stderr}`

    if (looksUnauthenticated(combined)) {
      throw new ChannelError(
        'not-authenticated',
        'codex',
        'Codex 未登录。在终端跑一次 `codex` 完成登录后重试。',
        tailLines(combined, 5),
      )
    }

    if (looksQuotaExhausted(combined)) {
      throw new ChannelError(
        'quota-exhausted',
        'codex',
        'ChatGPT 订阅额度已用尽，换一条通道或稍后再试。',
        tailLines(combined, 5),
      )
    }

    if (outcome.exitCode !== 0) {
      throw new ChannelError(
        'exec-failed',
        'codex',
        `Codex 退出码 ${outcome.exitCode}`,
        tailLines(combined, 10),
      )
    }

    const text = (outcome.outputFile ?? '').trim()
    if (!text) {
      throw new ChannelError(
        'bad-output',
        'codex',
        'Codex 正常退出但没有写出结果文件',
        tailLines(combined, 10),
      )
    }

    return {
      channelId: 'codex',
      text,
      json: tryParseJson(text),
      tokensUsed: extractTokens(outcome.stdout),
      elapsedMs: outcome.elapsedMs,
    }
  },
}

// ------------------------------------------------------------------ 工具

export function tryParseJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // 模型有时仍会套一层 markdown 围栏，剥掉再试一次
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed)
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1])
      } catch {
        return null
      }
    }
    return null
  }
}

export function looksUnauthenticated(text: string): boolean {
  return /not logged in|please (?:run )?login|no auth|unauthorized|401|authentication required/i.test(
    text,
  )
}

export function looksQuotaExhausted(text: string): boolean {
  return /quota|rate limit|429|usage limit|out of credits/i.test(text)
}

/** codex 会在 stdout 打一行 "tokens used" 后跟数字 */
export function extractTokens(stdout: string): number | null {
  const m = /tokens used[\s\S]{0,40}?([\d,]+)/i.exec(stdout)
  if (!m?.[1]) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function tailLines(text: string, n: number): string {
  return text.trim().split('\n').slice(-n).join('\n')
}
