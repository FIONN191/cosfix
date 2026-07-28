/**
 * 执行通道的统一抽象。见设计文档第 9 节。
 *
 * 职责划分：**智能在渲染层，执行在主进程**。
 * 渲染层（这些纯 TS 模块）负责把一次请求编译成一份 `CliPlan`——要跑哪个
 * 可执行文件、什么参数、要先写哪些临时文件、结果从哪读。主进程只当一个
 * 笨执行器：校验、写文件、spawn、超时、读结果、清理。
 *
 * 这样切的好处是整套 argv 拼装和输出解析都是纯函数，能在 node 里单测，
 * 不需要真的起子进程。代价是渲染层能指定 argv——所以主进程必须拿探测到
 * 的可执行文件白名单校验 `exe`，不能照单全收。
 */

export interface VisionImage {
  /** 图片字节的 base64，不含 data: 前缀 */
  base64: string
  /** 写进临时目录时用的文件名，扩展名要对 */
  fileName: string
}

export interface VisionRequest {
  /** 系统级指令。CLI 没有独立的 system 位，会拼进正文 */
  systemPrompt: string
  userText: string
  images: VisionImage[]
  /** 传了就让 CLI 强制输出符合此 schema 的 JSON */
  jsonSchema?: object
  timeoutMs: number
}

export interface PlanFile {
  /** 相对工作目录的文件名 */
  name: string
  content: string
  encoding: 'utf8' | 'base64'
}

export type PlanOutput = { kind: 'file'; name: string } | { kind: 'stdout' }

export interface CliPlan {
  /** 可执行文件绝对路径。主进程会对照白名单校验 */
  exe: string
  args: string[]
  /** 需要主进程预先写进工作目录的文件 */
  files: PlanFile[]
  readFrom: PlanOutput
  timeoutMs: number
}

/** 主进程执行完一份 plan 的原始结果 */
export interface RunOutcome {
  exitCode: number | null
  stdout: string
  stderr: string
  /** readFrom 指向文件时的内容；文件没生成为 null */
  outputFile: string | null
  timedOut: boolean
  elapsedMs: number
}

export type ChannelErrorKind =
  | 'not-authenticated'
  | 'timeout'
  | 'quota-exhausted'
  | 'bad-output'
  | 'exec-failed'

export class ChannelError extends Error {
  readonly kind: ChannelErrorKind
  readonly channelId: string
  /** CLI 自己说的话，原样带出来给用户看 */
  readonly detail: string

  constructor(
    kind: ChannelErrorKind,
    channelId: string,
    message: string,
    detail = '',
  ) {
    super(message)
    this.name = 'ChannelError'
    this.kind = kind
    this.channelId = channelId
    this.detail = detail
  }
}

export interface VisionResult {
  channelId: string
  /** 模型最终输出的原文 */
  text: string
  /** 请求了 schema 且解析成功时的对象，否则 null */
  json: unknown
  /** 拿得到就填，CLI 通道常常没有 */
  tokensUsed: number | null
  elapsedMs: number
}

export interface CliAdapter {
  id: string
  label: string
  /** 额度来源，显示在设置页 */
  quotaSource: string
  /**
   * 把请求编译成执行计划。`exe` 由主进程探测后下发——
   * 候选路径白名单是主进程独占的，见 electron/main.cjs 的 CHANNEL_CANDIDATES。
   * 渲染层不能自己指定跑什么可执行文件。
   */
  plan(req: VisionRequest, exe: string): CliPlan
  /** 解析执行结果；失败时抛 ChannelError */
  parse(outcome: RunOutcome): VisionResult
}

export interface DetectedChannel {
  id: string
  label: string
  quotaSource: string
  /** 探测到的可执行文件路径，没找到为 null */
  exe: string | null
  available: boolean
  /** 不可用的原因，直接显示给用户 */
  reason: string | null
}
