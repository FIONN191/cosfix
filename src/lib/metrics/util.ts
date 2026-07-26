/** metrics/ 各模块共用的数值工具。纯函数，不碰 DOM。 */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 从一个 256-bin 的直方图里取百分位对应的亮度值。
 * `p` 取 0..1，返回 0..255。空直方图返回 0。
 */
export function percentileFromHistogram(bins: number[], p: number): number {
  const total = bins.reduce((a, b) => a + b, 0)
  if (total === 0) return 0

  const target = clamp(p, 0, 1) * total
  let acc = 0
  for (let i = 0; i < bins.length; i++) {
    acc += bins[i] ?? 0
    if (acc >= target) return i
  }
  return bins.length - 1
}

/** Rec.709 亮度，输入输出都是 0..255。 */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
