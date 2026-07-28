import { describe, expect, it } from 'vitest'
import { ChannelError, type RunOutcome, type VisionRequest } from '../types.ts'
import { parseEventStream, qwenAdapter } from './qwen.ts'

const EXE = '/Users/x/.npm-global/bin/qwen'

function req(over: Partial<VisionRequest> = {}): VisionRequest {
  return {
    systemPrompt: '系统指令',
    userText: '看图',
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
    outputFile: null,
    timedOut: false,
    elapsedMs: 1000,
    ...over,
  }
}

describe('qwenAdapter.plan', () => {
  it('图片用 @文件名 引用写进提示词，不是独立参数', () => {
    const plan = qwenAdapter.plan(req(), EXE)
    const prompt = plan.args[plan.args.indexOf('-p') + 1] ?? ''
    expect(prompt).toContain('@main.jpg')
    expect(plan.args).not.toContain('-i')
  })

  it('要 json 输出格式', () => {
    expect(qwenAdapter.plan(req(), EXE).args).toEqual(
      expect.arrayContaining(['-o', 'json']),
    )
  })

  it('结果从 stdout 读', () => {
    expect(qwenAdapter.plan(req(), EXE).readFrom).toEqual({ kind: 'stdout' })
  })

  it('多张图全部引用上', () => {
    const plan = qwenAdapter.plan(
      req({
        images: [
          { base64: 'A', fileName: 'main.jpg' },
          { base64: 'B', fileName: 'ref.jpg' },
        ],
      }),
      EXE,
    )
    const prompt = plan.args[plan.args.indexOf('-p') + 1] ?? ''
    expect(prompt).toContain('@main.jpg')
    expect(prompt).toContain('@ref.jpg')
  })
})

describe('parseEventStream', () => {
  it('接 JSON 数组', () => {
    expect(parseEventStream('[{"type":"result"}]')).toHaveLength(1)
  })

  it('接逐行 JSON', () => {
    expect(
      parseEventStream('{"type":"a"}\n{"type":"result"}'),
    ).toHaveLength(2)
  })

  it('空输出返回空数组', () => {
    expect(parseEventStream('   ')).toEqual([])
  })
})

describe('qwenAdapter.parse', () => {
  // 这条是照实测输出写的：本机 qwen 装了没登录就是这个响应
  const REAL_AUTH_ERROR =
    '[{"type":"result","subtype":"error_during_execution","is_error":true,"duration_ms":0,"usage":{"input_tokens":0,"output_tokens":0},"error":{"message":"No auth type is selected. Please configure an auth type (e.g. via settings or `--auth-type`) before running in non-interactive mode."}}]'

  it('识别出未登录并给出可执行的下一步', () => {
    try {
      qwenAdapter.parse(outcome({ stdout: REAL_AUTH_ERROR }))
      expect.unreachable()
    } catch (e) {
      expect((e as ChannelError).kind).toBe('not-authenticated')
      expect((e as ChannelError).message).toContain('qwen')
    }
  })

  it('成功事件取 result 正文与 token 用量', () => {
    const r = qwenAdapter.parse(
      outcome({
        stdout:
          '[{"type":"result","subtype":"success","is_error":false,"result":"{\\"score\\":8}","usage":{"input_tokens":100,"output_tokens":50}}]',
      }),
    )
    expect(r.text).toBe('{"score":8}')
    expect(r.json).toEqual({ score: 8 })
    expect(r.tokensUsed).toBe(150)
  })

  it('没有 result 事件时明确报错', () => {
    try {
      qwenAdapter.parse(outcome({ stdout: '[{"type":"assistant"}]' }))
      expect.unreachable()
    } catch (e) {
      expect((e as ChannelError).kind).toBe('bad-output')
    }
  })

  it('成功但正文为空时报错，不静默返回空——字段名可能与预期不符', () => {
    try {
      qwenAdapter.parse(
        outcome({ stdout: '[{"type":"result","is_error":false}]' }),
      )
      expect.unreachable()
    } catch (e) {
      expect((e as ChannelError).kind).toBe('bad-output')
      expect((e as ChannelError).message).toContain('字段名')
    }
  })

  it('超时抛 timeout', () => {
    try {
      qwenAdapter.parse(outcome({ timedOut: true }))
      expect.unreachable()
    } catch (e) {
      expect((e as ChannelError).kind).toBe('timeout')
    }
  })
})
