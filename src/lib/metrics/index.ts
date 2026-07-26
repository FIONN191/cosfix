import { computeComposition } from './composition.ts'
import { computeExposure, computeHistogram } from './histogram.ts'
import { computeNoise } from './noise.ts'
import { computePalette } from './palette.ts'
import { computeSaturation } from './saturation.ts'
import { computeSharpness } from './sharpness.ts'
import { computeSkin } from './skin.ts'
import type { ExifData, LocalMetrics, PixelSource } from './types.ts'
import { computeWhiteBalance } from './whiteBalance.ts'

export * from './types.ts'
export { deriveExif, shutterLabel, type ExifDerived } from './exif.ts'

export interface MetricsInput {
  /** 全局指标用的取样（可能已降采样） */
  global: PixelSource
  /** 原始分辨率裁切，锐度与噪点用 */
  native: PixelSource
  /** 原图尺寸，不是取样尺寸 */
  originalWidth: number
  originalHeight: number
  globalDownscaled: boolean
  exif: ExifData | null
}

function aspectRatioLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(width, height) || 1
  const w = width / d
  const h = height / d
  if (w > 40 || h > 40) return `${(width / height).toFixed(2)}:1`
  return `${w}:${h}`
}

/**
 * 汇总全部本地指标。
 *
 * 注意取样来源的分工：全局统计量走 `global`，锐度和噪点走 `native`
 * ——后两者对尺度敏感，用降采样图会得到偏乐观的结论。
 */
export function computeLocalMetrics(input: MetricsInput): LocalMetrics {
  const { global, native, originalWidth, originalHeight, globalDownscaled, exif } =
    input

  const histogram = computeHistogram(global)

  return {
    dimensions: {
      width: originalWidth,
      height: originalHeight,
      aspectRatio: aspectRatioLabel(originalWidth, originalHeight),
      megapixels: (originalWidth * originalHeight) / 1_000_000,
    },
    globalMetricsDownscaled: globalDownscaled,
    histogram,
    exposure: computeExposure(histogram),
    whiteBalance: computeWhiteBalance(global),
    saturation: computeSaturation(global),
    skin: computeSkin(global),
    sharpness: computeSharpness({ img: native, nativeScale: true }),
    noise: computeNoise({ img: native, nativeScale: true }),
    palette: computePalette(global),
    composition: computeComposition(global),
    exif,
  }
}
