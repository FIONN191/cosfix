import { describe, expect, it } from 'vitest'
import { computeSkin, isSkinPixel } from './skin.ts'
import { halfSplit, solid } from './testUtils.ts'

// 典型东亚肤色附近的取样
const SKIN: [number, number, number] = [222, 180, 155]

describe('isSkinPixel', () => {
  it('认得典型肤色', () => {
    expect(isSkinPixel(...SKIN)).toBe(true)
    expect(isSkinPixel(205, 165, 140)).toBe(true)
  })

  it('纯蓝、纯绿、中性灰都不算肤色', () => {
    expect(isSkinPixel(0, 0, 255)).toBe(false)
    expect(isSkinPixel(0, 255, 0)).toBe(false)
    expect(isSkinPixel(128, 128, 128)).toBe(false)
  })
})

describe('computeSkin', () => {
  it('整张肤色：覆盖率 1，给出结论', () => {
    const s = computeSkin(solid(20, 20, ...SKIN))
    expect(s.coveragePct).toBe(1)
    expect(s.verdict).not.toBe('insufficient-sample')
    expect(s.meanHue).not.toBeNull()
  })

  it('画面里没有肤色时返回 insufficient-sample，不硬给结论', () => {
    const s = computeSkin(solid(20, 20, 30, 60, 200))
    expect(s.coveragePct).toBe(0)
    expect(s.verdict).toBe('insufficient-sample')
    expect(s.meanHue).toBeNull()
    expect(s.meanSat).toBeNull()
  })

  it('肤色占比过低同样不下结论', () => {
    // 20x20 里只有一行是肤色 → 5%，仍高于 1% 阈值，所以造更小的比例
    const img = solid(100, 100, 30, 60, 200)
    // 手动改 50 个像素为肤色 = 0.5%，低于 MIN_COVERAGE
    for (let p = 0; p < 50; p++) {
      const i = p * 4
      img.data[i] = SKIN[0]
      img.data[i + 1] = SKIN[1]
      img.data[i + 2] = SKIN[2]
    }
    expect(computeSkin(img).verdict).toBe('insufficient-sample')
  })

  it('偏黄的肤色判为 yellowish', () => {
    // 色相推到 40° 附近（更黄）
    const s = computeSkin(solid(20, 20, 220, 195, 140))
    expect(s.verdict).toBe('yellowish')
  })

  it('偏红的肤色判为 reddish', () => {
    // 色相压到 10° 以下（更红）。注意 rgb(235,165,150) 算出来是 10.6°，
    // 正好压在阈值上方判 normal——这里要取明确偏红的值
    const s = computeSkin(solid(20, 20, 235, 160, 152))
    expect(s.verdict).toBe('reddish')
  })

  it('覆盖率按整图算，不是按肤色像素算', () => {
    const s = computeSkin(halfSplit(20, 20, SKIN, [30, 60, 200]))
    expect(s.coveragePct).toBeCloseTo(0.5, 2)
  })
})
