import type { PixelSource, SharpnessMetrics, SharpnessVerdict } from './types.ts'
import { luma } from './util.ts'

/**
 * 锐度：拉普拉斯响应的方差。
 *
 * **必须跑在原始分辨率的图上**（image.ts 的 native 裁切）。缩图会把高频
 * 抹掉又把边缘挤密，糊照片会测出偏高的锐度——尺度一变结论就不可信。
 *
 * 「锐化过度」不是方差高就能判的：高方差也可能只是画面细节多。真正的
 * 过锐特征是边缘出现过冲振铃（亮边更亮、暗边更暗的白边），所以单独用
 * overshootRatio 判，不看方差。
 */

/** 方差低于此值判为糊 */
export const SOFT_VARIANCE = 80
/** |拉普拉斯| 超过此值算一次过冲 */
export const OVERSHOOT_MAGNITUDE = 60
/** 过冲像素占比超过此值判为锐化过度 */
export const OVERSHOOT_RATIO = 0.02

export interface SharpnessInput {
  img: PixelSource
  /** 传 false 表示只能用降采样图，结论偏乐观，会如实标注 */
  nativeScale: boolean
}

function toGray(img: PixelSource): Float32Array {
  const { data, width, height } = img
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
  }
  return gray
}

export function computeSharpness({
  img,
  nativeScale,
}: SharpnessInput): SharpnessMetrics {
  const { width, height } = img

  // 3x3 拉普拉斯需要一圈边界，太小的图直接放弃
  if (width < 3 || height < 3) {
    return {
      laplacianVariance: 0,
      verdict: 'soft',
      measuredAtNativeScale: nativeScale,
    }
  }

  const gray = toGray(img)
  const responses: number[] = []
  let overshoot = 0

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      // 四邻域拉普拉斯 [0,1,0; 1,-4,1; 0,1,0]
      const v =
        (gray[i - width] ?? 0) +
        (gray[i + width] ?? 0) +
        (gray[i - 1] ?? 0) +
        (gray[i + 1] ?? 0) -
        4 * (gray[i] ?? 0)
      responses.push(v)
      if (Math.abs(v) > OVERSHOOT_MAGNITUDE) overshoot++
    }
  }

  if (responses.length === 0) {
    return {
      laplacianVariance: 0,
      verdict: 'soft',
      measuredAtNativeScale: nativeScale,
    }
  }

  let sum = 0
  for (const v of responses) sum += v
  const m = sum / responses.length

  let varSum = 0
  for (const v of responses) {
    const d = v - m
    varSum += d * d
  }
  const laplacianVariance = varSum / responses.length
  const overshootRatio = overshoot / responses.length

  let verdict: SharpnessVerdict
  if (overshootRatio > OVERSHOOT_RATIO) verdict = 'oversharpened'
  else if (laplacianVariance < SOFT_VARIANCE) verdict = 'soft'
  else verdict = 'normal'

  return { laplacianVariance, verdict, measuredAtNativeScale: nativeScale }
}
