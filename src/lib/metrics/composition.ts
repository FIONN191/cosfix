import type { CompositionMetrics, PixelSource } from './types.ts'
import { luma } from './util.ts'

/**
 * 构图相关的两个客观量：
 *   - 亮度重心：画面「重量」偏在哪，配合三分线判断构图是否失衡
 *   - 地平线倾斜：找近水平的强边缘，取加权众数角度
 *
 * 倾斜检测只在存在足够多近水平强边缘时才给结论，否则返回 null——
 * 人像特写、无地平线的场景本来就没有这个量，硬给一个数是误导。
 *
 * 求梯度前先做一次均值模糊。栅格化的近水平线是阶梯状的（平走几像素再
 * 跳一格），逐像素 Sobel 会把大多数边缘读成正 0 度，真实倾角被淹掉。
 * 模糊把阶梯抹成斜坡，角度才出得来——Canny 先上高斯是同一个道理。
 */

/** 梯度幅值超过此值才算强边缘 */
export const EDGE_THRESHOLD = 40
/** 只统计与水平夹角在此范围内的边缘，度 */
export const TILT_SEARCH_DEG = 25
/** 强水平边缘少于总像素的这个比例就不下结论 */
export const MIN_EDGE_RATIO = 0.001
/** 求梯度前的均值模糊半径 */
export const BLUR_RADIUS = 2

function toGray(img: PixelSource): Float32Array {
  const { data, width, height } = img
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; p < width * height; i += 4, p++) {
    gray[p] = luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
  }
  return gray
}

/** 可分离均值模糊，先横后纵，O(n) */
function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius <= 0) return src

  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let sum = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k
        if (xx < 0 || xx >= width) continue
        sum += src[row + xx] ?? 0
        n++
      }
      tmp[row + x] = n === 0 ? 0 : sum / n
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k
        if (yy < 0 || yy >= height) continue
        sum += tmp[yy * width + x] ?? 0
        n++
      }
      out[y * width + x] = n === 0 ? 0 : sum / n
    }
  }

  return out
}

export function computeComposition(img: PixelSource): CompositionMetrics {
  const { width, height } = img
  const gray = toGray(img)

  // ---- 亮度重心
  let weightSum = 0
  let xSum = 0
  let ySum = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = gray[y * width + x] ?? 0
      weightSum += w
      xSum += w * x
      ySum += w * y
    }
  }

  const brightnessCentroid =
    weightSum === 0
      ? { x: 0.5, y: 0.5 }
      : {
          x: xSum / weightSum / Math.max(1, width - 1),
          y: ySum / weightSum / Math.max(1, height - 1),
        }

  // ---- 地平线倾斜
  const tiltBins = new Map<number, number>()
  let strongHorizontal = 0

  if (width >= 3 && height >= 3) {
    const g = boxBlur(gray, width, height, BLUR_RADIUS)
    const at = (x: number, y: number) => g[y * width + x] ?? 0

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx =
          at(x + 1, y - 1) +
          2 * at(x + 1, y) +
          at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
        const gy =
          at(x - 1, y + 1) +
          2 * at(x, y + 1) +
          at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))

        const mag = Math.hypot(gx, gy)
        if (mag < EDGE_THRESHOLD) continue

        // 边缘走向垂直于梯度方向
        const edgeAngle = (Math.atan2(gy, gx) * 180) / Math.PI + 90
        // 归一化到 -90..90，水平边缘落在 0 附近
        let a = ((edgeAngle + 90) % 180) - 90
        if (a <= -90) a += 180

        if (Math.abs(a) > TILT_SEARCH_DEG) continue

        const bin = Math.round(a)
        tiltBins.set(bin, (tiltBins.get(bin) ?? 0) + mag)
        strongHorizontal++
      }
    }
  }

  const totalPixels = width * height
  let horizonTiltDeg: number | null = null

  if (totalPixels > 0 && strongHorizontal / totalPixels >= MIN_EDGE_RATIO) {
    let bestBin: number | null = null
    let bestWeight = 0
    for (const [bin, weight] of tiltBins) {
      if (weight > bestWeight) {
        bestWeight = weight
        bestBin = bin
      }
    }
    horizonTiltDeg = bestBin
  }

  return { brightnessCentroid, horizonTiltDeg }
}
