import { describe, expect, it } from 'vitest'
import { deriveExif, shutterLabel } from './exif.ts'
import type { ExifData } from './types.ts'

const base: ExifData = {
  make: 'SONY',
  model: 'ILCE-7M4',
  lensModel: 'FE 85mm F1.4 GM',
  iso: 200,
  fNumber: 1.8,
  exposureTime: 1 / 250,
  focalLength: 85,
  focalLength35mm: 85,
  dateTaken: '2026-05-01T10:00:00.000Z',
  orientation: 1,
}

describe('shutterLabel', () => {
  it('快门写成分数', () => {
    expect(shutterLabel(1 / 250)).toBe('1/250')
    expect(shutterLabel(0.008)).toBe('1/125')
  })

  it('长曝写成秒', () => {
    expect(shutterLabel(2)).toBe('2.0s')
  })

  it('缺失或非法返回 null', () => {
    expect(shutterLabel(null)).toBeNull()
    expect(shutterLabel(0)).toBeNull()
  })
})

describe('deriveExif', () => {
  it('EXIF 缺失时全部返回 null 并说明', () => {
    const d = deriveExif(null)
    expect(d.belowSafeShutter).toBeNull()
    expect(d.highIso).toBeNull()
    expect(d.wideAngleFaceRisk).toBeNull()
    expect(d.summary).toContain('无拍摄参数')
  })

  it('正常参数不触发任何警告', () => {
    const d = deriveExif(base)
    expect(d.belowSafeShutter).toBe(false)
    expect(d.highIso).toBe(false)
    expect(d.wideAngleFaceRisk).toBe(false)
    expect(d.summary).not.toContain('注意')
  })

  it('85mm 用 1/30 秒判为低于安全快门', () => {
    const d = deriveExif({ ...base, exposureTime: 1 / 30 })
    expect(d.belowSafeShutter).toBe(true)
    expect(d.summary).toContain('手抖')
  })

  it('ISO 6400 判为高感', () => {
    expect(deriveExif({ ...base, iso: 6400 }).highIso).toBe(true)
  })

  it('24mm 判为广角，提示脸部透视变形', () => {
    const d = deriveExif({ ...base, focalLength35mm: 24, focalLength: 24 })
    expect(d.wideAngleFaceRisk).toBe(true)
    expect(d.summary).toContain('透视变形')
  })

  it('没有等效焦距时退回用实际焦距判安全快门', () => {
    const d = deriveExif({ ...base, focalLength35mm: null, exposureTime: 1 / 30 })
    expect(d.belowSafeShutter).toBe(true)
  })

  it('参数不全时摘要不编造', () => {
    const d = deriveExif({
      ...base,
      model: null,
      iso: null,
      fNumber: null,
      exposureTime: null,
      focalLength: null,
      focalLength35mm: null,
    })
    expect(d.summary).toContain('拍摄参数不全')
    expect(d.belowSafeShutter).toBeNull()
  })
})
