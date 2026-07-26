import { describe, expect, it } from 'vitest'
import {
  aspectRatioLabel,
  computeCenterCrop,
  computeTargetSize,
  computeTargetSizeByPixels,
  sniffFormat,
} from './image.ts'

/** 拼一个带 ISO-BMFF ftyp 头的字节串 */
function ftypHeader(brand: string): Uint8Array {
  const bytes = new Uint8Array(16)
  bytes.set([0, 0, 0, 0x20], 0) // box size
  bytes.set([...'ftyp'].map((c) => c.charCodeAt(0)), 4)
  bytes.set([...brand].map((c) => c.charCodeAt(0)), 8)
  return bytes
}

describe('sniffFormat', () => {
  it('认得 JPEG', () => {
    expect(sniffFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(12).fill(0)]))).toBe('jpeg')
  })

  it('认得 PNG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(8).fill(0)])
    expect(sniffFormat(png)).toBe('png')
  })

  it('认得 GIF', () => {
    const gif = new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)).concat(new Array(10).fill(0)))
    expect(sniffFormat(gif)).toBe('gif')
  })

  it('认得 WebP', () => {
    const webp = new Uint8Array(16)
    webp.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
    webp.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8)
    expect(sniffFormat(webp)).toBe('webp')
  })

  it('认得 HEIC 的各种 brand', () => {
    for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']) {
      expect(sniffFormat(ftypHeader(brand))).toBe('heic')
    }
  })

  it('AVIF 不会被误判成 HEIC', () => {
    expect(sniffFormat(ftypHeader('avif'))).toBe('avif')
  })

  it('太短或认不出的返回 unknown', () => {
    expect(sniffFormat(new Uint8Array([0xff, 0xd8]))).toBe('unknown')
    expect(sniffFormat(new Uint8Array(16))).toBe('unknown')
  })
})

describe('computeTargetSize', () => {
  it('长边超限时等比缩放', () => {
    expect(computeTargetSize(6000, 4000, 1536)).toEqual({ width: 1536, height: 1024 })
  })

  it('竖图按高度算长边', () => {
    expect(computeTargetSize(4000, 6000, 1536)).toEqual({ width: 1024, height: 1536 })
  })

  it('本来就小于上限时不放大', () => {
    expect(computeTargetSize(800, 600, 1536)).toEqual({ width: 800, height: 600 })
  })

  it('极端窄图不会缩成 0', () => {
    const r = computeTargetSize(10000, 3, 1536)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })
})

describe('computeTargetSizeByPixels', () => {
  it('总像素超限时按面积等比缩放', () => {
    const r = computeTargetSizeByPixels(9000, 6000, 24_000_000) // 54MP → 24MP
    expect(r.width * r.height).toBeLessThanOrEqual(24_000_000 * 1.01)
    expect(r.width / r.height).toBeCloseTo(1.5, 2)
  })

  it('不超限时原样返回', () => {
    expect(computeTargetSizeByPixels(4000, 3000, 24_000_000)).toEqual({
      width: 4000,
      height: 3000,
    })
  })
})

describe('computeCenterCrop', () => {
  it('大图取居中方块', () => {
    expect(computeCenterCrop(4000, 3000, 1024)).toEqual({
      x: 1488,
      y: 988,
      width: 1024,
      height: 1024,
    })
  })

  it('图比裁切边长小时取整张', () => {
    expect(computeCenterCrop(800, 600, 1024)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    })
  })
})

describe('aspectRatioLabel', () => {
  it('常见比例约成整数比', () => {
    expect(aspectRatioLabel(6000, 4000)).toBe('3:2')
    expect(aspectRatioLabel(1920, 1080)).toBe('16:9')
    expect(aspectRatioLabel(1080, 1920)).toBe('9:16')
    expect(aspectRatioLabel(1000, 1000)).toBe('1:1')
  })

  it('约不出好看比例时退回小数', () => {
    expect(aspectRatioLabel(1001, 733)).toMatch(/^\d+\.\d{2}:1$/)
  })
})
