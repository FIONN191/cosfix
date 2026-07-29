import { describe, expect, it } from 'vitest'
import { normalizeDiagnosis, sortByPriority } from './run.ts'
import type { Finding } from './types.ts'

const validFinding = {
  id: 'D-1',
  dimension: 'D',
  title: '顶光导致脸部立体感缺失',
  severity: 'major',
  location: '人物面部',
  cause: '正午顶光',
  fixability: 'ai-generative',
  priority: 1,
}

const valid = {
  overallImpression: '整体可用，主要问题在光位',
  findings: [validFinding],
  protectList: ['银白色双马尾'],
}

describe('normalizeDiagnosis', () => {
  it('接受合法输出', () => {
    const r = normalizeDiagnosis(valid)
    expect(r.findings).toHaveLength(1)
    expect(r.protectList).toEqual(['银白色双马尾'])
  })

  it('接受 JSON 字符串', () => {
    expect(normalizeDiagnosis(JSON.stringify(valid)).findings).toHaveLength(1)
  })

  it('剥掉 markdown 围栏', () => {
    const fenced = '```json\n' + JSON.stringify(valid) + '\n```'
    expect(normalizeDiagnosis(fenced).findings).toHaveLength(1)
  })

  it('维度小写也接受，归一化成大写', () => {
    const r = normalizeDiagnosis({
      ...valid,
      findings: [{ ...validFinding, dimension: 'd' }],
    })
    expect(r.findings[0]?.dimension).toBe('D')
  })

  it('非法维度直接报错，不放脏数据进界面', () => {
    expect(() =>
      normalizeDiagnosis({
        ...valid,
        findings: [{ ...validFinding, dimension: 'Z' }],
      }),
    ).toThrow(/dimension/)
  })

  it('非法 severity 报错', () => {
    expect(() =>
      normalizeDiagnosis({
        ...valid,
        findings: [{ ...validFinding, severity: '很严重' }],
      }),
    ).toThrow(/severity/)
  })

  it('非法 fixability 报错——这个字段判错代价最大', () => {
    expect(() =>
      normalizeDiagnosis({
        ...valid,
        findings: [{ ...validFinding, fixability: 'maybe' }],
      }),
    ).toThrow(/fixability/)
  })

  it('缺 overallImpression 报错', () => {
    expect(() => normalizeDiagnosis({ findings: [] })).toThrow(
      /overallImpression/,
    )
  })

  it('缺 findings 报错', () => {
    expect(() => normalizeDiagnosis({ overallImpression: 'x' })).toThrow(
      /findings/,
    )
  })

  it('不是 JSON 报错', () => {
    expect(() => normalizeDiagnosis('这不是 JSON')).toThrow(/JSON/)
  })

  it('id 缺失时按维度补一个', () => {
    const r = normalizeDiagnosis({
      ...valid,
      findings: [{ ...validFinding, id: undefined }],
    })
    expect(r.findings[0]?.id).toBe('D-1')
  })

  it('priority 非法时退回数组下标，不炸', () => {
    const r = normalizeDiagnosis({
      ...valid,
      findings: [{ ...validFinding, priority: 'high' }],
    })
    expect(r.findings[0]?.priority).toBe(1)
  })

  it('protectList 缺失时给空数组', () => {
    const r = normalizeDiagnosis({ ...valid, protectList: undefined })
    expect(r.protectList).toEqual([])
  })

  it('protectList 里的非字符串会被剔掉', () => {
    const r = normalizeDiagnosis({ ...valid, protectList: ['发色', 42, null] })
    expect(r.protectList).toEqual(['发色'])
  })
})

describe('sortByPriority', () => {
  const mk = (priority: number, severity: Finding['severity']): Finding => ({
    ...(validFinding as Finding),
    priority,
    severity,
  })

  it('按 priority 升序，不按维度字母序', () => {
    const sorted = sortByPriority([mk(3, 'minor'), mk(1, 'major'), mk(2, 'critical')])
    expect(sorted.map((f) => f.priority)).toEqual([1, 2, 3])
  })

  it('同优先级时严重的排前面', () => {
    const sorted = sortByPriority([mk(1, 'minor'), mk(1, 'critical')])
    expect(sorted[0]?.severity).toBe('critical')
  })

  it('不改原数组', () => {
    const input = [mk(2, 'minor'), mk(1, 'major')]
    sortByPriority(input)
    expect(input[0]?.priority).toBe(2)
  })
})
