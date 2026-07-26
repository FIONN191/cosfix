/**
 * 开发期自检。image.ts 里依赖 canvas 的部分在 node 环境测不到，
 * 这里在浏览器里合成一张特征已知的图跑完整条管线，肉眼核对结果。
 * 只在 import.meta.env.DEV 下挂到界面上。
 */

import { ingest, sniffFormat, type IngestResult } from '../lib/image.ts'
import { computeLocalMetrics, deriveExif } from '../lib/metrics/index.ts'

export interface SelfTestRow {
  label: string
  value: string
  ok: boolean
  note?: string
}

/**
 * 合成一张 3000x2000 的测试图：
 *   - 左半正常中灰，右半推到接近纯白（制造高光裁切）
 *   - 整体叠一层暖色（红通道高于蓝通道）
 *   - 画一圈硬边方块，保证锐度不为 0
 */
async function makeSyntheticJpeg(): Promise<File> {
  const w = 3000
  const h = 2000
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('拿不到 2d 上下文')

  ctx.fillStyle = 'rgb(120, 105, 80)' // 中灰偏暖
  ctx.fillRect(0, 0, w / 2, h)

  ctx.fillStyle = 'rgb(253, 251, 246)' // 接近纯白，制造高光裁切
  ctx.fillRect(w / 2, 0, w / 2, h)

  // 硬边方块，给锐度检测一点高频信号
  ctx.fillStyle = 'rgb(20, 18, 14)'
  for (let i = 0; i < 12; i++) {
    ctx.fillRect(200 + i * 220, 800, 120, 120)
  }

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
  return new File([blob], 'synthetic.jpg', { type: 'image/jpeg' })
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export async function runSelfTest(): Promise<SelfTestRow[]> {
  const rows: SelfTestRow[] = []

  // 1. sniffFormat 对真实 JPEG 字节
  const file = await makeSyntheticJpeg()
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const format = sniffFormat(head)
  rows.push({
    label: 'sniffFormat 识别真实 JPEG',
    value: format,
    ok: format === 'jpeg',
  })

  let result: IngestResult
  try {
    result = await ingest(file)
  } catch (err) {
    rows.push({
      label: 'ingest()',
      value: err instanceof Error ? err.message : String(err),
      ok: false,
    })
    return rows
  }

  rows.push({
    label: '原图尺寸',
    value: `${result.width}×${result.height}`,
    ok: result.width === 3000 && result.height === 2000,
  })

  rows.push({
    label: '全局取样（6MP，未超 24MP 上限）',
    value: `${result.global.width}×${result.global.height}，降采样=${result.globalDownscaled}`,
    ok: !result.globalDownscaled && result.global.width === 3000,
    note: '6MP 低于上限，应保持原尺寸',
  })

  rows.push({
    label: '原始分辨率裁切（锐度用）',
    value: `${result.native.width}×${result.native.height}`,
    ok: result.native.width === 1024 && result.native.height === 1024,
    note: '必须是 1:1 原尺寸裁切，不能是缩放',
  })

  rows.push({
    label: '上传副本长边压到 1536',
    value: `${result.upload.width}×${result.upload.height}，${fmtBytes(result.upload.byteLength)}`,
    ok: Math.max(result.upload.width, result.upload.height) === 1536,
  })

  rows.push({
    label: '上传副本比原文件小',
    value: `${fmtBytes(result.upload.byteLength)} vs 原始 ${fmtBytes(result.fileSize)}`,
    ok: result.upload.byteLength < result.fileSize,
  })

  const b64ok = /^[A-Za-z0-9+/]+=*$/.test(result.upload.base64.slice(0, 200))
  rows.push({
    label: 'base64 编码合法',
    value: `${result.upload.base64.length} 字符，开头 ${result.upload.base64.slice(0, 12)}…`,
    ok: b64ok && result.upload.base64.length > 1000,
  })

  // 像素层面核对：右半应该明显亮于左半
  const { imageData } = result.global
  const sampleAt = (x: number, y: number) => {
    const i = (y * imageData.width + x) * 4
    return {
      r: imageData.data[i] ?? 0,
      g: imageData.data[i + 1] ?? 0,
      b: imageData.data[i + 2] ?? 0,
    }
  }
  const left = sampleAt(500, 400)
  const right = sampleAt(2500, 400)
  rows.push({
    label: '像素取样：右半（高光区）亮于左半',
    value: `左 rgb(${left.r},${left.g},${left.b}) → 右 rgb(${right.r},${right.g},${right.b})`,
    ok: right.r > left.r + 80,
  })

  rows.push({
    label: '像素取样：左半偏暖（R > B）',
    value: `R=${left.r} B=${left.b}`,
    ok: left.r > left.b + 20,
    note: 'Step 2 的白平衡检测应该判成 warm',
  })

  rows.push({
    label: 'EXIF（canvas 生成的图没有）',
    value: result.exif === null ? 'null（正确降级）' : JSON.stringify(result.exif),
    ok: result.exif === null,
  })

  // ---- Step 2：本地指标跑在真实尺寸的图上
  const t0 = performance.now()
  const m = computeLocalMetrics({
    global: result.global.imageData,
    native: result.native.imageData,
    originalWidth: result.width,
    originalHeight: result.height,
    globalDownscaled: result.globalDownscaled,
    exif: result.exif,
  })
  const elapsed = performance.now() - t0

  rows.push({
    label: '全部指标耗时（6MP）',
    value: `${elapsed.toFixed(0)} ms`,
    ok: elapsed < 8000,
    note: '超过几秒就得考虑挪进 worker',
  })

  rows.push({
    label: '尺寸与宽高比',
    value: `${m.dimensions.width}×${m.dimensions.height}，${m.dimensions.aspectRatio}，${m.dimensions.megapixels.toFixed(1)}MP`,
    ok: m.dimensions.aspectRatio === '3:2',
  })

  rows.push({
    label: '高光裁切（右半接近纯白）',
    value: `${(m.exposure.highlightClipPct * 100).toFixed(1)}%，均值亮度 ${m.exposure.meanLuma.toFixed(0)}`,
    ok: m.exposure.highlightClipPct > 0.3,
    note: '右半占画面一半，应该测到约 50%',
  })

  rows.push({
    label: '白平衡方向',
    value: `${m.whiteBalance.direction}，幅度 ${m.whiteBalance.magnitude.toFixed(2)}，R/B ${m.whiteBalance.rbRatio.toFixed(2)}`,
    ok: m.whiteBalance.direction === 'warm',
    note: '合成图左半 R>B，应判 warm',
  })

  rows.push({
    label: '肤色粗筛的已知误检',
    value: `覆盖 ${(m.skin.coveragePct * 100).toFixed(1)}%，判定 ${m.skin.verdict}`,
    ok: m.skin.coveragePct > 0.4 && m.skin.verdict !== 'insufficient-sample',
    note: '左半暖褐 rgb(121,105,80) 的 Cb=112.8 Cr=138.0 落在肤色框内，被当成肤色——这正是 YCbCr 粗筛的已知代价（木头、沙土、暖色布料都会中招），真正的把关交给视觉模型',
  })

  rows.push({
    label: '锐度（有硬边方块）',
    value: `方差 ${m.sharpness.laplacianVariance.toFixed(0)}，判定 ${m.sharpness.verdict}，原始分辨率=${m.sharpness.measuredAtNativeScale}`,
    ok: m.sharpness.measuredAtNativeScale,
  })

  rows.push({
    label: '噪点（JPEG 压缩会引入少量）',
    value: m.noise.estimate.toFixed(2),
    ok: m.noise.estimate < 8,
  })

  rows.push({
    label: '主色板',
    value: m.palette.map((p) => `${p.hex} ${(p.pct * 100).toFixed(0)}%`).join('  '),
    ok: m.palette.length > 0 && m.palette.reduce((a, p) => a + p.pct, 0) > 0.95,
  })

  rows.push({
    label: '亮度重心（右半更亮）',
    value: `x=${m.composition.brightnessCentroid.x.toFixed(3)} y=${m.composition.brightnessCentroid.y.toFixed(3)}`,
    ok: m.composition.brightnessCentroid.x > 0.55,
  })

  rows.push({
    label: '地平线倾斜（画面里没有水平线）',
    value: m.composition.horizonTiltDeg === null ? 'null（正确拒答）' : `${m.composition.horizonTiltDeg}°`,
    ok: true,
    note: '有值也可以——方块边缘本身就是水平的',
  })

  rows.push({
    label: 'EXIF 派生摘要',
    value: deriveExif(m.exif).summary,
    ok: deriveExif(m.exif).summary.includes('无拍摄参数'),
  })

  return rows
}
