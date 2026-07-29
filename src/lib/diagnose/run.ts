import type { IngestResult } from '../image.ts'
import type { LocalMetrics } from '../metrics/types.ts'
import { ChannelError, type VisionRequest } from '../channels/types.ts'
import { callVision } from '../transport.ts'
import { buildSystemPrompt, buildUserText } from './framework.ts'
import { buildMetricsBrief } from './metricsBrief.ts'
import { DIAGNOSIS_SCHEMA } from './schema.ts'
import {
  type DiagnosisReport,
  type Finding,
  type ImageState,
  type ModelDiagnosis,
} from './types.ts'

/** 诊断类调用给足时间：codex 实测单次约 25-40s */
export const DIAGNOSE_TIMEOUT_MS = 180_000

export interface DiagnoseOptions {
  channelId: string
  exe: string
  ingest: IngestResult
  metrics: LocalMetrics
  state: ImageState
  note: string
}

export class DiagnosisParseError extends Error {
  readonly raw: string
  constructor(message: string, raw: string) {
    super(message)
    this.name = 'DiagnosisParseError'
    this.raw = raw
  }
}

export async function diagnose(
  opts: DiagnoseOptions,
): Promise<DiagnosisReport> {
  const { channelId, exe, ingest, metrics, state, note } = opts

  const req: VisionRequest = {
    systemPrompt: buildSystemPrompt(state),
    userText: buildUserText({
      metricsBrief: buildMetricsBrief(metrics),
      note,
      state,
    }),
    images: [
      { base64: ingest.upload.base64, fileName: 'main.jpg' },
    ],
    jsonSchema: DIAGNOSIS_SCHEMA,
    timeoutMs: DIAGNOSE_TIMEOUT_MS,
  }

  const result = await callVision(channelId, exe, req)

  let model: ModelDiagnosis
  try {
    model = normalizeDiagnosis(result.json ?? result.text)
  } catch (first) {
    // 非法 JSON 时把解析错误回喂给模型重试一次。仍失败就把原文抛出去，
    // 不静默丢弃——用户至少还能看到模型说了什么。
    const retry = await callVision(channelId, exe, {
      ...req,
      userText:
        `${req.userText}\n\n---\n\n` +
        `上一次的输出无法解析：${first instanceof Error ? first.message : String(first)}\n` +
        `请严格按 schema 重新输出，只要 JSON 本身。`,
    })

    try {
      model = normalizeDiagnosis(retry.json ?? retry.text)
    } catch (second) {
      throw new DiagnosisParseError(
        `模型两次都没能给出可解析的诊断结果：${
          second instanceof Error ? second.message : String(second)
        }`,
        retry.text,
      )
    }
  }

  return {
    imageState: state,
    overallImpression: model.overallImpression,
    findings: sortByPriority(model.findings),
    protectList: model.protectList,
    metrics,
  }
}

const DIMENSIONS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
const SEVERITIES = new Set(['critical', 'major', 'minor', 'good'])
const FIXABILITIES = new Set(['post-fixable', 'ai-generative', 'reshoot-only'])

/**
 * 校验并归一化模型输出。
 *
 * schema 是由 CLI 强制的，但不能假设它一定生效——换个通道、换个模型，
 * 约束力就变了。这里做二次校验，字段不对就明确报错，不要让脏数据流进界面。
 */
export function normalizeDiagnosis(input: unknown): ModelDiagnosis {
  const raw = typeof input === 'string' ? safeParse(input) : input

  if (!raw || typeof raw !== 'object') {
    throw new Error('输出不是 JSON 对象')
  }

  const obj = raw as Record<string, unknown>

  if (typeof obj.overallImpression !== 'string') {
    throw new Error('缺少 overallImpression')
  }
  if (!Array.isArray(obj.findings)) {
    throw new Error('缺少 findings 数组')
  }

  const findings: Finding[] = obj.findings.map((f, i) => {
    if (!f || typeof f !== 'object') {
      throw new Error(`findings[${i}] 不是对象`)
    }
    const o = f as Record<string, unknown>

    const dimension = String(o.dimension ?? '').toUpperCase()
    if (!DIMENSIONS.has(dimension)) {
      throw new Error(`findings[${i}].dimension 非法：${String(o.dimension)}`)
    }
    const severity = String(o.severity ?? '')
    if (!SEVERITIES.has(severity)) {
      throw new Error(`findings[${i}].severity 非法：${String(o.severity)}`)
    }
    const fixability = String(o.fixability ?? '')
    if (!FIXABILITIES.has(fixability)) {
      throw new Error(`findings[${i}].fixability 非法：${String(o.fixability)}`)
    }

    const priority = Number(o.priority)

    return {
      id: typeof o.id === 'string' && o.id ? o.id : `${dimension}-${i + 1}`,
      dimension: dimension as Finding['dimension'],
      title: String(o.title ?? '').trim() || '(无标题)',
      severity: severity as Finding['severity'],
      location: String(o.location ?? '').trim(),
      cause: String(o.cause ?? '').trim(),
      fixability: fixability as Finding['fixability'],
      priority: Number.isFinite(priority) && priority > 0 ? priority : i + 1,
    }
  })

  const protectList = Array.isArray(obj.protectList)
    ? obj.protectList.filter((x): x is string => typeof x === 'string')
    : []

  return { overallImpression: obj.overallImpression, findings, protectList }
}

/** priority 升序；同优先级按严重度兜底排 */
export function sortByPriority(findings: Finding[]): Finding[] {
  const rank: Record<string, number> = {
    critical: 0,
    major: 1,
    minor: 2,
    good: 3,
  }
  return [...findings].sort(
    (a, b) =>
      a.priority - b.priority ||
      (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9),
  )
}

function safeParse(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed)
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1])
      } catch {
        throw new Error('输出不是合法 JSON')
      }
    }
    throw new Error('输出不是合法 JSON')
  }
}

export { ChannelError }
