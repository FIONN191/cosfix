import type { NoiseMetrics, PixelSource } from './types.ts'
import { luma } from './util.ts'

/**
 * 噪点估计：把图切成小块，各自算标准差，取偏低分位数作为噪声底。
 *
 * 思路是「最平的那些块里还剩多少起伏」——平坦区域本该没有信号，量到的
 * 起伏就是噪点。直接算全图标准差会把画面内容当成噪点。
 *
 * 和锐度一样，需要原始分辨率才准：缩放会平均掉噪点。
 */

export const BLOCK_SIZE = 16
/** 取块标准差的这个分位数当噪声底 */
export const NOISE_PERCENTILE = 0.1

export interface NoiseInput {
  img: PixelSource
  nativeScale: boolean
}

export function computeNoise({ img, nativeScale }: NoiseInput): NoiseMetrics {
  const { data, width, height } = img
  const blockStds: number[] = []

  for (let by = 0; by + BLOCK_SIZE <= height; by += BLOCK_SIZE) {
    for (let bx = 0; bx + BLOCK_SIZE <= width; bx += BLOCK_SIZE) {
      let sum = 0
      let sumSq = 0
      let n = 0

      for (let y = by; y < by + BLOCK_SIZE; y++) {
        for (let x = bx; x < bx + BLOCK_SIZE; x++) {
          const i = (y * width + x) * 4
          const l = luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
          sum += l
          sumSq += l * l
          n++
        }
      }

      if (n === 0) continue
      const m = sum / n
      const variance = Math.max(0, sumSq / n - m * m)
      blockStds.push(Math.sqrt(variance))
    }
  }

  if (blockStds.length === 0) {
    return { estimate: 0, measuredAtNativeScale: nativeScale }
  }

  blockStds.sort((a, b) => a - b)
  const idx = Math.min(
    blockStds.length - 1,
    Math.floor(blockStds.length * NOISE_PERCENTILE),
  )

  return {
    estimate: blockStds[idx] ?? 0,
    measuredAtNativeScale: nativeScale,
  }
}
