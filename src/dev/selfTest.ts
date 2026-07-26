/**
 * 开发期自检。image.ts 里依赖 canvas 的部分在 node 环境测不到，
 * 这里在浏览器里合成一张特征已知的图跑完整条管线，肉眼核对结果。
 * 只在 import.meta.env.DEV 下挂到界面上。
 */

import { ingest, sniffFormat, type IngestResult } from '../lib/image.ts'

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

  return rows
}
