import type { PaletteEntry, PixelSource } from './types.ts'

/**
 * 主色板：k-means (k=5)。
 *
 * 初始质心用「按亮度排序后等距取样」而不是随机播种——同一张图每次跑出来
 * 必须是同一个色板，否则快照测试没法写，界面上色块也会跳。
 */

export const K = 5
export const MAX_SAMPLES = 20_000
export const ITERATIONS = 12

interface Rgb {
  r: number
  g: number
  b: number
}

function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function sqDist(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return dr * dr + dg * dg + db * db
}

function sample(img: PixelSource): Rgb[] {
  const { data } = img
  const totalPixels = data.length / 4
  const stride = Math.max(1, Math.floor(totalPixels / MAX_SAMPLES))

  const out: Rgb[] = []
  for (let p = 0; p < totalPixels; p += stride) {
    const i = p * 4
    out.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 })
  }
  return out
}

export function computePalette(img: PixelSource): PaletteEntry[] {
  const samples = sample(img)
  if (samples.length === 0) return []

  // 确定性播种：按亮度排序后等距取 K 个
  const sorted = [...samples].sort(
    (a, b) => a.r + a.g + a.b - (b.r + b.g + b.b),
  )
  const centroids: Rgb[] = []
  for (let i = 0; i < K; i++) {
    const idx = Math.floor(((i + 0.5) / K) * sorted.length)
    const c = sorted[Math.min(idx, sorted.length - 1)]
    if (c) centroids.push({ ...c })
  }
  if (centroids.length === 0) return []

  const assignment = new Array<number>(samples.length).fill(0)

  for (let iter = 0; iter < ITERATIONS; iter++) {
    let moved = false

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      if (!s) continue
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < centroids.length; c++) {
        const cen = centroids[c]
        if (!cen) continue
        const d = sqDist(s, cen)
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (assignment[i] !== best) {
        assignment[i] = best
        moved = true
      }
    }

    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, n: 0 }))
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      const acc = sums[assignment[i] ?? 0]
      if (!s || !acc) continue
      acc.r += s.r
      acc.g += s.g
      acc.b += s.b
      acc.n++
    }

    for (let c = 0; c < centroids.length; c++) {
      const acc = sums[c]
      if (!acc || acc.n === 0) continue
      centroids[c] = { r: acc.r / acc.n, g: acc.g / acc.n, b: acc.b / acc.n }
    }

    if (!moved) break
  }

  const counts = centroids.map(() => 0)
  for (const a of assignment) counts[a] = (counts[a] ?? 0) + 1

  return centroids
    .map((c, i) => ({ hex: toHex(c), pct: (counts[i] ?? 0) / samples.length }))
    .filter((e) => e.pct > 0)
    .sort((a, b) => b.pct - a.pct)
}
