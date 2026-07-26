import type { PixelSource, WhiteBalanceMetrics } from './types.ts'
import { clamp } from './util.ts'

/**
 * 灰世界法估计白平衡偏移。
 *
 * 只报方向和幅度，**不换算开尔文**：单张图反推不出真实色温（画面本身
 * 就可能是暖色调的场景），报个数字出来是假精确。
 *
 * 两条轴分开算，取偏离更大的那条：
 *   temp  (R - B) 冷暖轴
 *   tint  G 相对 R/B 均值 的绿品红轴
 */

/** 归一化偏移小于这个值算中性 */
export const NEUTRAL_THRESHOLD = 0.02
/** 偏移映射到 0-1 幅度的缩放系数：0.25 的归一化偏移即视为满偏 */
const MAGNITUDE_SCALE = 4

export function computeWhiteBalance(img: PixelSource): WhiteBalanceMetrics {
  const { data } = img
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let n = 0

  // 极暗和纯白像素对灰世界估计是噪声，剔掉
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    const maxc = Math.max(r, g, b)
    if (maxc < 12 || maxc > 250) continue
    sumR += r
    sumG += g
    sumB += b
    n++
  }

  if (n === 0) {
    return { direction: 'neutral', magnitude: 0, rbRatio: 1 }
  }

  const meanR = sumR / n
  const meanG = sumG / n
  const meanB = sumB / n

  const tempAxis = (meanR - meanB) / (meanR + meanB || 1)
  const rbMean = (meanR + meanB) / 2
  const tintAxis = (meanG - rbMean) / (meanG + rbMean || 1)

  const useTemp = Math.abs(tempAxis) >= Math.abs(tintAxis)
  const value = useTemp ? tempAxis : tintAxis
  const abs = Math.abs(value)

  const rbRatio = meanB === 0 ? 1 : meanR / meanB

  if (abs < NEUTRAL_THRESHOLD) {
    return { direction: 'neutral', magnitude: 0, rbRatio }
  }

  const direction = useTemp
    ? value > 0
      ? 'warm'
      : 'cool'
    : value > 0
      ? 'green'
      : 'magenta'

  return {
    direction,
    magnitude: clamp(abs * MAGNITUDE_SCALE, 0, 1),
    rbRatio,
  }
}
