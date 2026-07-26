import { describe, expect, it } from 'vitest'
import { computeExposure, computeHistogram } from './histogram.ts'
import { halfSplit, solid } from './testUtils.ts'

describe('computeHistogram', () => {
  it('纯色图全部落在单个 bin', () => {
    const h = computeHistogram(solid(20, 20, 128, 64, 32))
    expect(h.r[128]).toBe(400)
    expect(h.g[64]).toBe(400)
    expect(h.b[32]).toBe(400)
    expect(h.r.reduce((a, b) => a + b, 0)).toBe(400)
  })

  it('亮度通道用 Rec.709 加权', () => {
    // 纯绿的亮度应该落在 0.7152*255 ≈ 182
    const h = computeHistogram(solid(10, 10, 0, 255, 0))
    expect(h.luma[182]).toBe(100)
  })
})

describe('computeExposure', () => {
  it('纯中灰：均值等于该值，对比度为 0', () => {
    const e = computeExposure(computeHistogram(solid(20, 20, 128, 128, 128)))
    expect(e.meanLuma).toBeCloseTo(128, 0)
    expect(e.rmsContrast).toBeCloseTo(0, 5)
    expect(e.p5).toBe(e.p95)
  })

  it('数出高光裁切', () => {
    // 右半纯白，应该有约一半像素超过 250
    const e = computeExposure(
      computeHistogram(halfSplit(20, 20, [100, 100, 100], [255, 255, 255])),
    )
    expect(e.highlightClipPct).toBeCloseTo(0.5, 2)
    expect(e.shadowClipPct).toBe(0)
  })

  it('数出暗部裁切', () => {
    const e = computeExposure(
      computeHistogram(halfSplit(20, 20, [0, 0, 0], [128, 128, 128])),
    )
    expect(e.shadowClipPct).toBeCloseTo(0.5, 2)
    expect(e.highlightClipPct).toBe(0)
  })

  it('黑白各半时对比度显著', () => {
    const e = computeExposure(
      computeHistogram(halfSplit(20, 20, [0, 0, 0], [255, 255, 255])),
    )
    expect(e.rmsContrast).toBeGreaterThan(100)
  })

  it('空直方图不炸', () => {
    const empty = { r: [], g: [], b: [], luma: new Array(256).fill(0) }
    const e = computeExposure(empty)
    expect(e.meanLuma).toBe(0)
    expect(e.rmsContrast).toBe(0)
  })
})
