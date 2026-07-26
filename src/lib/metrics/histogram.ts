import type { ExposureMetrics, Histogram, PixelSource } from './types.ts'
import { luma, percentileFromHistogram } from './util.ts'

/** L > 这个值算高光裁切 */
export const HIGHLIGHT_CLIP_THRESHOLD = 250
/** L < 这个值算暗部裁切 */
export const SHADOW_CLIP_THRESHOLD = 5

export function computeHistogram(img: PixelSource): Histogram {
  const r = new Array<number>(256).fill(0)
  const g = new Array<number>(256).fill(0)
  const b = new Array<number>(256).fill(0)
  const l = new Array<number>(256).fill(0)

  const { data } = img
  for (let i = 0; i < data.length; i += 4) {
    const rv = data[i] ?? 0
    const gv = data[i + 1] ?? 0
    const bv = data[i + 2] ?? 0

    r[rv] = (r[rv] ?? 0) + 1
    g[gv] = (g[gv] ?? 0) + 1
    b[bv] = (b[bv] ?? 0) + 1

    const lv = Math.round(luma(rv, gv, bv))
    l[lv] = (l[lv] ?? 0) + 1
  }

  return { r, g, b, luma: l }
}

/**
 * 曝光指标全部从亮度直方图导出——均值和方差都能由直方图算出，
 * 不需要再过一遍像素。
 */
export function computeExposure(hist: Histogram): ExposureMetrics {
  const bins = hist.luma
  const total = bins.reduce((a, b) => a + b, 0)

  if (total === 0) {
    return {
      meanLuma: 0,
      rmsContrast: 0,
      highlightClipPct: 0,
      shadowClipPct: 0,
      p5: 0,
      p50: 0,
      p95: 0,
    }
  }

  let sum = 0
  for (let i = 0; i < bins.length; i++) sum += i * (bins[i] ?? 0)
  const meanLuma = sum / total

  let varSum = 0
  for (let i = 0; i < bins.length; i++) {
    const d = i - meanLuma
    varSum += d * d * (bins[i] ?? 0)
  }
  const rmsContrast = Math.sqrt(varSum / total)

  let highlightClipped = 0
  for (let i = HIGHLIGHT_CLIP_THRESHOLD + 1; i < bins.length; i++) {
    highlightClipped += bins[i] ?? 0
  }

  let shadowClipped = 0
  for (let i = 0; i < SHADOW_CLIP_THRESHOLD; i++) {
    shadowClipped += bins[i] ?? 0
  }

  return {
    meanLuma,
    rmsContrast,
    highlightClipPct: highlightClipped / total,
    shadowClipPct: shadowClipped / total,
    p5: percentileFromHistogram(bins, 0.05),
    p50: percentileFromHistogram(bins, 0.5),
    p95: percentileFromHistogram(bins, 0.95),
  }
}
