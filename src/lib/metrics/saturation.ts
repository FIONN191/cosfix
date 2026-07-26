import type { PixelSource, SaturationMetrics } from './types.ts'
import { rgbToHsv } from './util.ts'

/** S 超过这个值算高饱和，用来发现滤镜拉过头 */
export const HIGH_SAT_THRESHOLD = 0.7

export function computeSaturation(img: PixelSource): SaturationMetrics {
  const { data } = img
  const totalPixels = data.length / 4
  if (totalPixels === 0) return { mean: 0, highSatPct: 0 }

  let sum = 0
  let high = 0

  for (let i = 0; i < data.length; i += 4) {
    const { s } = rgbToHsv(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
    sum += s
    if (s > HIGH_SAT_THRESHOLD) high++
  }

  return { mean: sum / totalPixels, highSatPct: high / totalPixels }
}
