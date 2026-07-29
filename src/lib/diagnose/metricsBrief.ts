import { deriveExif } from '../metrics/exif.ts'
import type { LocalMetrics } from '../metrics/types.ts'

/**
 * 把本地指标压成给模型看的一段文字。
 *
 * **不能把直方图原样塞进去**——四个通道各 256 个 bin 就是 1024 个数字，
 * 既烧 token 又没人（包括模型）能从裸数组里读出东西。这里只给分位数、
 * 裁切率这些已经归纳过的量。
 */

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

const WB_LABELS: Record<string, string> = {
  warm: '偏暖',
  cool: '偏冷',
  green: '偏绿',
  magenta: '偏品红',
  neutral: '中性',
}

const SKIN_LABELS: Record<string, string> = {
  yellowish: '偏黄（蜡黄倾向）',
  pale: '偏白（惨白倾向）',
  reddish: '偏红',
  normal: '正常范围',
  'insufficient-sample': '采样不足，不下结论',
}

const SHARPNESS_LABELS: Record<string, string> = {
  soft: '偏软/发糊',
  normal: '正常',
  oversharpened: '锐化过度（边缘有过冲）',
}

export function buildMetricsBrief(m: LocalMetrics): string {
  const lines: string[] = []

  lines.push(
    `- 尺寸：${m.dimensions.width}×${m.dimensions.height}，` +
      `${m.dimensions.aspectRatio}，${m.dimensions.megapixels.toFixed(1)}MP`,
  )

  lines.push(
    `- 曝光：平均亮度 ${m.exposure.meanLuma.toFixed(0)}/255，` +
      `对比度(RMS) ${m.exposure.rmsContrast.toFixed(1)}，` +
      `亮度分位 p5=${m.exposure.p5} p50=${m.exposure.p50} p95=${m.exposure.p95}`,
  )

  lines.push(
    `- 裁切：高光死白 ${pct(m.exposure.highlightClipPct)}，` +
      `暗部死黑 ${pct(m.exposure.shadowClipPct)}`,
  )

  const wb = m.whiteBalance
  lines.push(
    `- 白平衡：${WB_LABELS[wb.direction] ?? wb.direction}` +
      (wb.direction === 'neutral'
        ? ''
        : `，偏移幅度 ${wb.magnitude.toFixed(2)}（0-1）`) +
      `，R/B 比 ${wb.rbRatio.toFixed(2)}` +
      `　※ 这是灰世界法估计的偏移方向，不是真实色温`,
  )

  lines.push(
    `- 饱和度：平均 ${m.saturation.mean.toFixed(2)}（0-1），` +
      `高饱和像素占比 ${pct(m.saturation.highSatPct)}`,
  )

  const skin = m.skin
  if (skin.verdict === 'insufficient-sample') {
    lines.push(
      `- 肤色：肤色区域仅占 ${pct(skin.coveragePct)}，采样不足，程序不下结论——请你直接看图判断`,
    )
  } else {
    lines.push(
      `- 肤色：区域占比 ${pct(skin.coveragePct)}，` +
        `色相 ${skin.meanHue?.toFixed(0)}°，` +
        `饱和 ${skin.meanSat?.toFixed(2)}，明度 ${skin.meanVal?.toFixed(2)} → ` +
        `${SKIN_LABELS[skin.verdict] ?? skin.verdict}` +
        `　※ 用的是 YCbCr 粗筛，木头沙土暖色布料可能被误算进来，看图核对`,
    )
  }

  lines.push(
    `- 锐度：拉普拉斯方差 ${m.sharpness.laplacianVariance.toFixed(0)} → ` +
      `${SHARPNESS_LABELS[m.sharpness.verdict] ?? m.sharpness.verdict}` +
      (m.sharpness.measuredAtNativeScale
        ? '（在原始分辨率裁切上测的，可信）'
        : '（只能在降采样图上测，结论偏乐观）') +
      (m.sharpness.verdict === 'oversharpened'
        ? '　※ 这条判定尚未标定，画面中若本来就有高对比硬边（深色皮衣、' +
          '黑白交界、金属道具）会被误判成锐化过度。**请看图核对边缘有没有' +
          '真正的白边振铃再决定要不要采信**'
        : ''),
  )

  lines.push(`- 噪点：平坦区标准差估计 ${m.noise.estimate.toFixed(2)}（0-255 尺度）`)

  lines.push(
    `- 主色板：${m.palette.map((p) => `${p.hex} ${pct(p.pct)}`).join('，')}`,
  )

  const c = m.composition
  lines.push(
    `- 亮度重心：x=${c.brightnessCentroid.x.toFixed(2)} ` +
      `y=${c.brightnessCentroid.y.toFixed(2)}（0-1，0.5 为正中）` +
      (c.horizonTiltDeg === null
        ? '；未检测到明显水平线，倾斜度无法判断'
        : `；检测到水平边缘倾斜 ${c.horizonTiltDeg}°`),
  )

  lines.push(`- 拍摄参数：${deriveExif(m.exif).summary}`)

  if (m.globalMetricsDownscaled) {
    lines.push(
      '- ※ 原图过大，上述全局统计跑在降采样图上（统计量不受影响；' +
        '锐度和噪点仍是原始分辨率测的）',
    )
  }

  return lines.join('\n')
}
