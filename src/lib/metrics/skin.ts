import type { PixelSource, SkinMetrics, SkinVerdict } from './types.ts'
import { meanHue as circularMeanHue, rgbToHsv } from './util.ts'

/**
 * 肤色检测与偏色判断。
 *
 * 用 YCbCr 范围法粗筛肤色像素——不引入人脸检测库，包体积不值得为这个
 * 翻倍，剩下的交给视觉模型看。粗筛会把木头、沙土、部分暖色布料一起圈
 * 进来，所以覆盖率过低时直接返回 insufficient-sample，不硬给结论。
 */

export const CB_MIN = 77
export const CB_MAX = 127
export const CR_MIN = 133
export const CR_MAX = 173

/** 肤色像素占比低于这个值就不下结论 */
export const MIN_COVERAGE = 0.01

/** 正常肤色的色相区间（橙色带），单位度 */
export const SKIN_HUE_LOW = 10
export const SKIN_HUE_HIGH = 35

/** 判「惨白」的阈值：亮度很高但饱和度很低 */
export const PALE_VALUE = 0.82
export const PALE_SAT = 0.14

export function isSkinPixel(r: number, g: number, b: number): boolean {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  return cb >= CB_MIN && cb <= CB_MAX && cr >= CR_MIN && cr <= CR_MAX
}

function verdictFor(h: number, s: number, v: number): SkinVerdict {
  if (v >= PALE_VALUE && s <= PALE_SAT) return 'pale'
  if (h < SKIN_HUE_LOW) return 'reddish'
  if (h > SKIN_HUE_HIGH) return 'yellowish'
  return 'normal'
}

export function computeSkin(img: PixelSource): SkinMetrics {
  const { data } = img
  const totalPixels = data.length / 4

  const hues: number[] = []
  let sumS = 0
  let sumV = 0
  let count = 0

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    if (!isSkinPixel(r, g, b)) continue

    const { h, s, v } = rgbToHsv(r, g, b)
    hues.push(h)
    sumS += s
    sumV += v
    count++
  }

  const coveragePct = totalPixels === 0 ? 0 : count / totalPixels

  if (count === 0 || coveragePct < MIN_COVERAGE) {
    return {
      coveragePct,
      meanHue: null,
      meanSat: null,
      meanVal: null,
      verdict: 'insufficient-sample',
    }
  }

  const h = circularMeanHue(hues)
  const s = sumS / count
  const v = sumV / count

  if (h === null) {
    return {
      coveragePct,
      meanHue: null,
      meanSat: s,
      meanVal: v,
      verdict: 'insufficient-sample',
    }
  }

  return {
    coveragePct,
    meanHue: h,
    meanSat: s,
    meanVal: v,
    verdict: verdictFor(h, s, v),
  }
}
