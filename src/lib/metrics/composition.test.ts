import { describe, expect, it } from 'vitest'
import { computeComposition } from './composition.ts'
import { halfSplit, makeImage, solid } from './testUtils.ts'

describe('computeComposition', () => {
  it('均匀画面的亮度重心在正中', () => {
    const c = computeComposition(solid(64, 64, 128, 128, 128))
    expect(c.brightnessCentroid.x).toBeCloseTo(0.5, 2)
    expect(c.brightnessCentroid.y).toBeCloseTo(0.5, 2)
  })

  it('右半更亮时重心右移', () => {
    const c = computeComposition(halfSplit(64, 64, [20, 20, 20], [240, 240, 240]))
    expect(c.brightnessCentroid.x).toBeGreaterThan(0.6)
  })

  it('全黑画面重心退回中心而不是 NaN', () => {
    const c = computeComposition(solid(32, 32, 0, 0, 0))
    expect(c.brightnessCentroid.x).toBe(0.5)
    expect(c.brightnessCentroid.y).toBe(0.5)
  })

  it('没有水平边缘时倾斜返回 null，不硬给数字', () => {
    expect(computeComposition(solid(64, 64, 128, 128, 128)).horizonTiltDeg).toBeNull()
  })

  it('水平分界线判为 0 度', () => {
    const img = makeImage(64, 64, (_x, y) => (y < 32 ? [220, 220, 220] : [30, 30, 30]))
    expect(computeComposition(img).horizonTiltDeg).toBe(0)
  })

  it('倾斜的分界线测出非零角度且方向正确', () => {
    // y = 32 + 0.2x 的分界，约 11.3 度
    const img = makeImage(128, 128, (x, y) =>
      y < 32 + 0.2 * x ? [220, 220, 220] : [30, 30, 30],
    )
    const tilt = computeComposition(img).horizonTiltDeg
    expect(tilt).not.toBeNull()
    expect(Math.abs(tilt!)).toBeGreaterThan(5)
    expect(Math.abs(tilt!)).toBeLessThan(20)
  })
})
