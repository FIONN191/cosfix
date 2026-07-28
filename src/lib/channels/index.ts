import { codexAdapter } from './cli/codex.ts'
import { qwenAdapter } from './cli/qwen.ts'
import type { CliAdapter } from './types.ts'

export * from './types.ts'
export { codexAdapter } from './cli/codex.ts'
export { qwenAdapter } from './cli/qwen.ts'

/** 注册表。顺序即设置页里的优先级 */
export const CLI_ADAPTERS: CliAdapter[] = [codexAdapter, qwenAdapter]

export function getAdapter(id: string): CliAdapter | undefined {
  return CLI_ADAPTERS.find((a) => a.id === id)
}
