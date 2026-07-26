import { describe, expect, it } from 'vitest'
import { solid } from './testUtils.ts'
import { computeWhiteBalance } from './whiteBalance.ts'

describe('computeWhiteBalance', () => {
  it('中性灰判为 neutral，幅度为 0', () => {
    const wb = computeWhiteBalance(solid(20, 20, 128, 128, 128))
    expect(wb.direction).toBe('neutral')
    expect(wb.magnitude).toBe(0)
    expect(wb.rbRatio).toBeCloseTo(1, 5)
  })

  it('R 高于 B 判为 warm', () => {
    const wb = computeWhiteBalance(solid(20, 20, 160, 130, 100))
    expect(wb.direction).toBe('warm')
    expect(wb.magnitude).toBeGreaterThan(0)
    expect(wb.rbRatio).toBeGreaterThan(1)
  })

  it('B 高于 R 判为 cool', () => {
    const wb = computeWhiteBalance(solid(20, 20, 100, 130, 160))
    expect(wb.direction).toBe('cool')
    expect(wb.rbRatio).toBeLessThan(1)
  })

  it('G 高于 R/B 均值判为 green', () => {
    const wb = computeWhiteBalance(solid(20, 20, 120, 170, 120))
    expect(wb.direction).toBe('green')
  })

  it('G 低于 R/B 均值判为 magenta', () => {
    const wb = computeWhiteBalance(solid(20, 20, 170, 110, 170))
    expect(wb.direction).toBe('magenta')
  })

  it('偏得越狠幅度越大', () => {
    const mild = computeWhiteBalance(solid(20, 20, 135, 128, 121))
    const strong = computeWhiteBalance(solid(20, 20, 200, 128, 60))
    expect(strong.magnitude).toBeGreaterThan(mild.magnitude)
    expect(strong.magnitude).toBeLessThanOrEqual(1)
  })

  it('全黑或全白（都被剔除）时返回 neutral 而不是崩', () => {
    expect(computeWhiteBalance(solid(10, 10, 0, 0, 0)).direction).toBe('neutral')
    expect(computeWhiteBalance(solid(10, 10, 255, 255, 255)).direction).toBe(
      'neutral',
    )
  })
})
