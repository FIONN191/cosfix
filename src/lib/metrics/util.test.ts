import { describe, expect, it } from 'vitest'
import { clamp, luma, mean, percentileFromHistogram } from './util.ts'

describe('clamp', () => {
  it('把值夹在区间内', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe('percentileFromHistogram', () => {
  it('空直方图返回 0', () => {
    expect(percentileFromHistogram(new Array(256).fill(0), 0.5)).toBe(0)
  })

  it('全部集中在一个 bin 时，任意百分位都落在该 bin', () => {
    const bins = new Array(256).fill(0)
    bins[128] = 1000
    expect(percentileFromHistogram(bins, 0.05)).toBe(128)
    expect(percentileFromHistogram(bins, 0.5)).toBe(128)
    expect(percentileFromHistogram(bins, 0.95)).toBe(128)
  })

  it('均匀分布时中位数落在中间', () => {
    const bins = new Array(256).fill(1)
    expect(percentileFromHistogram(bins, 0.5)).toBe(127)
  })

  it('p 超出 0..1 会被夹住，不抛错', () => {
    const bins = new Array(256).fill(1)
    expect(percentileFromHistogram(bins, -1)).toBe(0)
    expect(percentileFromHistogram(bins, 2)).toBe(255)
  })
})

describe('luma', () => {
  it('纯白 255，纯黑 0', () => {
    expect(luma(255, 255, 255)).toBeCloseTo(255, 5)
    expect(luma(0, 0, 0)).toBe(0)
  })

  it('绿色权重最高', () => {
    expect(luma(0, 255, 0)).toBeGreaterThan(luma(255, 0, 0))
    expect(luma(255, 0, 0)).toBeGreaterThan(luma(0, 0, 255))
  })
})

describe('mean', () => {
  it('空数组返回 0', () => {
    expect(mean([])).toBe(0)
  })

  it('算平均值', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
  })
})
