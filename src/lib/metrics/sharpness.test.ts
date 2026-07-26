import { describe, expect, it } from 'vitest'
import { computeSharpness } from './sharpness.ts'
import { checker, makeImage, solid } from './testUtils.ts'

describe('computeSharpness', () => {
  it('纯色图没有高频，判为 soft', () => {
    const s = computeSharpness({ img: solid(64, 64, 128, 128, 128), nativeScale: true })
    expect(s.laplacianVariance).toBeCloseTo(0, 5)
    expect(s.verdict).toBe('soft')
  })

  it('棋盘格高频拉满，方差远高于纯色', () => {
    const sharp = computeSharpness({ img: checker(64, 64, 4), nativeScale: true })
    const flat = computeSharpness({ img: solid(64, 64, 128, 128, 128), nativeScale: true })
    expect(sharp.laplacianVariance).toBeGreaterThan(flat.laplacianVariance)
    expect(sharp.laplacianVariance).toBeGreaterThan(1000)
  })

  it('硬边棋盘格的过冲比例高，判为 oversharpened', () => {
    expect(computeSharpness({ img: checker(64, 64, 2), nativeScale: true }).verdict).toBe(
      'oversharpened',
    )
  })

  it('平缓渐变既不糊也不过锐', () => {
    // 每列亮度 +1，拉普拉斯响应恒为 0 之外的小量
    const grad = makeImage(64, 64, (x) => {
      const v = 60 + x
      return [v, v, v]
    })
    const s = computeSharpness({ img: grad, nativeScale: true })
    expect(s.verdict).not.toBe('oversharpened')
  })

  it('如实标注是否跑在原始分辨率上', () => {
    expect(
      computeSharpness({ img: solid(32, 32, 100, 100, 100), nativeScale: false })
        .measuredAtNativeScale,
    ).toBe(false)
  })

  it('小于 3x3 的图不崩', () => {
    const s = computeSharpness({ img: solid(2, 2, 100, 100, 100), nativeScale: true })
    expect(s.laplacianVariance).toBe(0)
  })
})
