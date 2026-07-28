import { describe, expect, it } from 'vitest'
import { ChannelError, type RunOutcome, type VisionRequest } from '../types.ts'
import { codexAdapter, extractTokens, tryParseJson } from './codex.ts'

const EXE = '/Applications/ChatGPT.app/Contents/Resources/codex'

function req(over: Partial<VisionRequest> = {}): VisionRequest {
  return {
    systemPrompt: '你是修图诊断助手',
    userText: '看这张图',
    images: [{ base64: 'AAAA', fileName: 'main.jpg' }],
    timeoutMs: 120_000,
    ...over,
  }
}

function outcome(over: Partial<RunOutcome> = {}): RunOutcome {
  return {
    exitCode: 0,
    stdout: '',
    stderr: '',
    outputFile: '{"ok":true}',
    timedOut: false,
    elapsedMs: 1000,
    ...over,
  }
}

describe('codexAdapter.plan', () => {
  it('提示词排在 -i 之前——否则会被当成图片路径吞掉', () => {
    const { args } = codexAdapter.plan(req(), EXE)
    const promptIdx = args.findIndex((a) => a.includes('看这张图'))
    const imageFlagIdx = args.indexOf('-i')
    expect(promptIdx).toBeGreaterThanOrEqual(0)
    expect(imageFlagIdx).toBeGreaterThan(promptIdx)
  })

  it('带上那几个非加不可的开关', () => {
    const { args } = codexAdapter.plan(req(), EXE)
    expect(args[0]).toBe('exec')
    expect(args).toContain('--skip-git-repo-check')
    expect(args).toContain('--ignore-user-config')
    expect(args).toContain('--ephemeral')
    expect(args).toEqual(expect.arrayContaining(['-s', 'read-only']))
    expect(args).toEqual(expect.arrayContaining(['--color', 'never']))
  })

  it('图片写成临时文件，argv 里用相对文件名', () => {
    const plan = codexAdapter.plan(
      req({
        images: [
          { base64: 'AAAA', fileName: 'main.jpg' },
          { base64: 'BBBB', fileName: 'ref-0.jpg' },
        ],
      }),
      EXE,
    )
    expect(plan.files).toEqual(
      expect.arrayContaining([
        { name: 'main.jpg', content: 'AAAA', encoding: 'base64' },
        { name: 'ref-0.jpg', content: 'BBBB', encoding: 'base64' },
      ]),
    )
    const i = plan.args.indexOf('-i')
    expect(plan.args.slice(i + 1)).toEqual(['main.jpg', 'ref-0.jpg'])
  })

  it('给了 schema 就写 schema 文件并挂 --output-schema', () => {
    const plan = codexAdapter.plan(
      req({ jsonSchema: { type: 'object' } }),
      EXE,
    )
    expect(plan.args).toContain('--output-schema')
    expect(plan.files.some((f) => f.name.endsWith('schema.json'))).toBe(true)
  })

  it('没有 schema 时不加那个参数', () => {
    expect(codexAdapter.plan(req(), EXE).args).not.toContain('--output-schema')
  })

  it('结果从输出文件读，不从 stdout 捞', () => {
    expect(codexAdapter.plan(req(), EXE).readFrom).toEqual({
      kind: 'file',
      name: 'cosfix-out.json',
    })
  })

  it('systemPrompt 拼进正文——CLI 没有独立的 system 位', () => {
    const { args } = codexAdapter.plan(req(), EXE)
    const prompt = args.find((a) => a.includes('看这张图'))
    expect(prompt).toContain('你是修图诊断助手')
  })

  it('没有图片时不加 -i', () => {
    expect(codexAdapter.plan(req({ images: [] }), EXE).args).not.toContain('-i')
  })
})

describe('codexAdapter.parse', () => {
  it('正常时解析输出文件里的 JSON', () => {
    const r = codexAdapter.parse(outcome({ outputFile: '{"score":7}' }))
    expect(r.json).toEqual({ score: 7 })
    expect(r.channelId).toBe('codex')
  })

  it('剥掉模型多套的 markdown 围栏', () => {
    const r = codexAdapter.parse(
      outcome({ outputFile: '```json\n{"a":1}\n```' }),
    )
    expect(r.json).toEqual({ a: 1 })
  })

  it('不是 JSON 时保留原文，json 为 null，不抛错', () => {
    const r = codexAdapter.parse(outcome({ outputFile: '就是一段大白话' }))
    expect(r.json).toBeNull()
    expect(r.text).toBe('就是一段大白话')
  })

  it('超时抛 timeout', () => {
    expect(() => codexAdapter.parse(outcome({ timedOut: true }))).toThrow(
      ChannelError,
    )
    try {
      codexAdapter.parse(outcome({ timedOut: true }))
    } catch (e) {
      expect((e as ChannelError).kind).toBe('timeout')
    }
  })

  it('未登录时给出可执行的下一步', () => {
    try {
      codexAdapter.parse(outcome({ exitCode: 1, stderr: 'Error: not logged in' }))
      expect.unreachable()
    } catch (e) {
      expect((e as ChannelError).kind).toBe('not-authenticated')
      expect((e as ChannelError).message).toContain('codex')
    }
  })

  it('额度耗尽单独识别', () => {
    try {
      codexAdapter.parse(outcome({ exitCode: 1, stderr: 'usage limit reached' }))
      expect.unreachable()
    } catch (e) {
      expect((e as ChannelError).kind).toBe('quota-exhausted')
    }
  })

  it('退出码非零抛 exec-failed 并带上 stderr', () => {
    try {
      codexAdapter.parse(outcome({ exitCode: 2, stderr: '炸了' }))
      expect.unreachable()
    } catch (e) {
      expect((e as ChannelError).kind).toBe('exec-failed')
      expect((e as ChannelError).detail).toContain('炸了')
    }
  })

  it('正常退出但没写出文件时报错，不返回空结果', () => {
    try {
      codexAdapter.parse(outcome({ outputFile: null }))
      expect.unreachable()
    } catch (e) {
      expect((e as ChannelError).kind).toBe('bad-output')
    }
  })
})

describe('extractTokens', () => {
  it('从 stdout 捞 token 用量', () => {
    expect(extractTokens('tokens used\n24,403\n')).toBe(24403)
  })

  it('捞不到返回 null', () => {
    expect(extractTokens('什么都没有')).toBeNull()
  })
})

describe('tryParseJson', () => {
  it('非法 JSON 返回 null 而不是抛错', () => {
    expect(tryParseJson('{ 坏掉的')).toBeNull()
  })
})
