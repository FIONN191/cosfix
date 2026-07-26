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

/** RGB(0-255) → HSV。h 是 0-360，s/v 是 0-1。灰色的 h 返回 0 */
export function rgbToHsv(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; v: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min

  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }

  return { h, s: max === 0 ? 0 : d / max, v: max }
}

/**
 * 色相是环形的，算平均要走单位向量求和，不能直接算术平均——
 * 否则 350° 和 10° 会平均出 180°（正好是反方向）。
 */
export function meanHue(hues: number[]): number | null {
  if (hues.length === 0) return null
  let x = 0
  let y = 0
  for (const h of hues) {
    const rad = (h * Math.PI) / 180
    x += Math.cos(rad)
    y += Math.sin(rad)
  }
  if (x === 0 && y === 0) return null
  const deg = (Math.atan2(y, x) * 180) / Math.PI
  return deg < 0 ? deg + 360 : deg
}
