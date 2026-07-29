import type { LocalMetrics } from '../metrics/types.ts'

/** 主图状态。两种口径的诊断重点完全不同 */
export type ImageState = 'raw' | 'retouched'

export type Dimension = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'

export type Severity = 'critical' | 'major' | 'minor' | 'good'

/**
 * 可解决性。**这是全套诊断里最要紧的字段**——它决定一条问题能不能
 * 转成提示词，还是只能明说「这张救不了」。
 */
export type Fixability =
  /** 调色、曝光、裁切、局部明暗、降噪锐化——不改变画面内容结构 */
  | 'post-fixable'
  /** 需要生成新像素：换背景、去穿帮物、重打光、补细节、扩图 */
  | 'ai-generative'
  /** 拍摄决定，AI 也补不回来或补了必然失真 */
  | 'reshoot-only'

export interface Finding {
  /** 形如 "D-2"，维度字母加序号 */
  id: string
  dimension: Dimension
  title: string
  severity: Severity
  /** 指到画面上的具体位置，不接受「整体」这种空话 */
  location: string
  cause: string
  fixability: Fixability
  /** 1 起，按 严重度 × 投入产出比 排 */
  priority: number
}

export interface DiagnosisReport {
  imageState: ImageState
  overallImpression: string
  findings: Finding[]
  /** 角色标志性元素，后续自动插进每条提示词防止 AI 改掉 */
  protectList: string[]
  metrics: LocalMetrics
}

/** 模型实际返回的部分，metrics 和 imageState 由本地补齐 */
export interface ModelDiagnosis {
  overallImpression: string
  findings: Finding[]
  protectList: string[]
}

export const DIMENSION_LABELS: Record<Dimension, string> = {
  A: '影调曝光',
  B: '色彩白平衡',
  C: '肤色',
  D: '光影',
  E: '构图裁切',
  F: '质感细节',
  G: 'cos 专属',
  H: '后期痕迹',
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: '致命',
  major: '明显',
  minor: '轻微',
  good: '良好',
}

export const FIXABILITY_LABELS: Record<Fixability, string> = {
  'post-fixable': '后期可修',
  'ai-generative': '需 AI 生成',
  'reshoot-only': '拍摄决定·修不回来',
}
