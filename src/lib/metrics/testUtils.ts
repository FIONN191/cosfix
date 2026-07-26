import type { PixelSource } from './types.ts'

/** 单测用的合成图构造器。不依赖 DOM，纯像素数组。 */

export function makeImage(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number],
): PixelSource {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const [r, g, b] = fill(x, y)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

export function solid(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): PixelSource {
  return makeImage(width, height, () => [r, g, b])
}

/** 左右各一半颜色，用来验重心和裁切统计 */
export function halfSplit(
  width: number,
  height: number,
  left: [number, number, number],
  right: [number, number, number],
): PixelSource {
  return makeImage(width, height, (x) => (x < width / 2 ? left : right))
}

/** 棋盘格，制造高频信号验锐度 */
export function checker(
  width: number,
  height: number,
  cell: number,
): PixelSource {
  return makeImage(width, height, (x, y) => {
    const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0
    return on ? [235, 235, 235] : [20, 20, 20]
  })
}

/** mulberry32：确定性 PRNG，保证噪点图每次一样 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 在基色上叠确定性噪点 */
export function noisy(
  width: number,
  height: number,
  base: number,
  amplitude: number,
  seed = 42,
): PixelSource {
  const rand = mulberry32(seed)
  return makeImage(width, height, () => {
    const n = (rand() - 0.5) * 2 * amplitude
    const v = Math.round(base + n)
    return [v, v, v]
  })
}
