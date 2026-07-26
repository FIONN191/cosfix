import { describe, expect, it } from 'vitest'
import { computePalette } from './palette.ts'
import { halfSplit, solid } from './testUtils.ts'

describe('computePalette', () => {
  it('纯色图的色板全部指向同一个颜色', () => {
    const p = computePalette(solid(64, 64, 200, 100, 50))
    expect(p.length).toBeGreaterThan(0)
    expect(p[0]?.hex).toBe('#c86432')
    expect(p[0]?.pct).toBeCloseTo(1, 2)
  })

  it('双色图能分出两个主色，占比各半', () => {
    const p = computePalette(
      halfSplit(64, 64, [255, 0, 0], [0, 0, 255]),
    ).filter((e) => e.pct > 0.05)

    expect(p).toHaveLength(2)
    const hexes = p.map((e) => e.hex).sort()
    expect(hexes).toEqual(['#0000ff', '#ff0000'])
    for (const e of p) expect(e.pct).toBeCloseTo(0.5, 1)
  })

  it('按占比降序排列', () => {
    const p = computePalette(halfSplit(64, 64, [255, 0, 0], [0, 0, 255]))
    for (let i = 1; i < p.length; i++) {
      expect(p[i - 1]!.pct).toBeGreaterThanOrEqual(p[i]!.pct)
    }
  })

  it('确定性：同一张图跑两次色板完全一致', () => {
    const img = halfSplit(64, 64, [180, 40, 90], [30, 120, 200])
    expect(computePalette(img)).toEqual(computePalette(img))
  })

  it('占比之和约等于 1', () => {
    const total = computePalette(halfSplit(64, 64, [10, 20, 30], [200, 210, 220]))
      .reduce((a, e) => a + e.pct, 0)
    expect(total).toBeCloseTo(1, 5)
  })

  it('空图返回空数组', () => {
    expect(computePalette({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toEqual([])
  })
})
