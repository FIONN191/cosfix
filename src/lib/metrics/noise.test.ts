import { describe, expect, it } from 'vitest'
import { computeNoise } from './noise.ts'
import { checker, noisy, solid } from './testUtils.ts'

describe('computeNoise', () => {
  it('纯色图噪点为 0', () => {
    const n = computeNoise({ img: solid(64, 64, 120, 120, 120), nativeScale: true })
    expect(n.estimate).toBeCloseTo(0, 5)
  })

  it('噪点越强估计值越大', () => {
    const light = computeNoise({ img: noisy(64, 64, 120, 3), nativeScale: true })
    const heavy = computeNoise({ img: noisy(64, 64, 120, 20), nativeScale: true })
    expect(light.estimate).toBeGreaterThan(0)
    expect(heavy.estimate).toBeGreaterThan(light.estimate)
  })

  it('取低分位数，所以画面内容不会被当成噪点', () => {
    // 棋盘格块内起伏极大，但它是「内容」不是噪点。
    // 取 10% 分位后应该明显低于块标准差的平均水平。
    const n = computeNoise({ img: checker(64, 64, 32), nativeScale: true })
    expect(n.estimate).toBeLessThan(20)
  })

  it('确定性：同一张图跑两次结果一致', () => {
    const img = noisy(64, 64, 120, 10, 7)
    const a = computeNoise({ img, nativeScale: true })
    const b = computeNoise({ img, nativeScale: true })
    expect(a.estimate).toBe(b.estimate)
  })

  it('比一个块还小的图不崩', () => {
    const n = computeNoise({ img: solid(8, 8, 100, 100, 100), nativeScale: true })
    expect(n.estimate).toBe(0)
  })
})
