/**
 * 渲染层调用通道的唯一入口。
 *
 * 硬规矩：**渲染层不得直接 fetch 外部 API，也不得 spawn**，一律走这里。
 * 现在只有 Electron 的 CLI 分支；M4 加 HTTP 通道、M5 加网页壳时，
 * 分叉都收在这个文件里，上层代码不用改。
 */

import {
  ChannelError,
  type DetectedChannel,
  type RunOutcome,
  type VisionRequest,
  type VisionResult,
} from './channels/types.ts'
import { getAdapter } from './channels/index.ts'

interface CosfixBridge {
  isDesktop: boolean
  platform: string
  detectChannels(): Promise<DetectedChannel[]>
  runPlan(plan: unknown): Promise<
    { ok: true; outcome: RunOutcome } | { ok: false; error: string }
  >
}

declare global {
  interface Window {
    cosfix?: CosfixBridge
  }
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.cosfix?.isDesktop === true
}

/** 探测本机可用的通道。非桌面环境返回空列表 */
export async function detectChannels(): Promise<DetectedChannel[]> {
  if (!isDesktop()) return []
  return window.cosfix!.detectChannels()
}

/**
 * 跑一次视觉调用。
 *
 * 流程：适配器把请求编译成 plan → 主进程执行 → 适配器解析结果。
 * 智能全在适配器（纯函数、可单测），主进程只负责跑。
 */
export async function callVision(
  channelId: string,
  exe: string,
  req: VisionRequest,
): Promise<VisionResult> {
  if (!isDesktop()) {
    throw new ChannelError(
      'exec-failed',
      channelId,
      'CLI 通道仅桌面版可用。网页版请配置 HTTP API 通道。',
    )
  }

  const adapter = getAdapter(channelId)
  if (!adapter) {
    throw new ChannelError('exec-failed', channelId, `没有这个通道：${channelId}`)
  }

  const plan = adapter.plan(req, exe)
  const res = await window.cosfix!.runPlan(plan)

  if (!res.ok) {
    throw new ChannelError('exec-failed', channelId, res.error)
  }

  // 解析失败会抛 ChannelError，原样往上传
  return adapter.parse(res.outcome)
}
