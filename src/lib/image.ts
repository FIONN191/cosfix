/**
 * 图片管线：解码 → 取样 → EXIF → 生成上传副本。
 *
 * 三路取样，各有各的理由：
 *   - global   全局指标（直方图/白平衡/肤色/主色板）。大图先降到 MAX_METRICS_PIXELS
 *              控内存，这些指标是统计量，降采样不影响结论。
 *   - native   锐度与噪点。**必须原始分辨率**——缩图会让糊的照片看起来是锐的，
 *              所以这里取一块原尺寸中心裁切，而不是整张缩小。
 *   - upload   传给模型的副本，长边 UPLOAD_MAX_EDGE。
 *
 * 纯函数（sniffFormat / computeTargetSize / computeCenterCrop）单独导出，
 * 便于在 node 环境下单测；带 canvas 的部分只能在渲染层跑。
 */

import exifr from 'exifr'
import type { ExifData } from './metrics/types.ts'

/** 上传副本的长边上限。够诊断用，又不至于把几十 MB 原片怼上去 */
export const UPLOAD_MAX_EDGE = 1536
export const UPLOAD_QUALITY = 0.9

/** 全局指标的像素上限，24MP。再大就先降采样，否则 ImageData 能吃掉几百 MB */
export const MAX_METRICS_PIXELS = 24_000_000

/** 原始分辨率裁切的边长，用于锐度/噪点 */
export const NATIVE_CROP_EDGE = 1024

export type ImageFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'heic'
  | 'avif'
  | 'unknown'

export type IngestErrorKind =
  | 'unsupported-format'
  | 'decode-failed'
  | 'empty-file'

export class IngestError extends Error {
  readonly kind: IngestErrorKind

  constructor(kind: IngestErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'IngestError'
    this.kind = kind
  }
}

export interface SampledImage {
  imageData: ImageData
  width: number
  height: number
}

export interface UploadCopy {
  /** base64，不含 data: 前缀 */
  base64: string
  mediaType: 'image/jpeg'
  width: number
  height: number
  byteLength: number
}

export interface IngestResult {
  fileName: string
  fileSize: number
  format: ImageFormat
  /** 原图尺寸 */
  width: number
  height: number
  /** 全局指标用的取样 */
  global: SampledImage
  /** 原始分辨率中心裁切，锐度/噪点用。图本身够小时就是整张原图 */
  native: SampledImage
  /** global 是否经过降采样 */
  globalDownscaled: boolean
  upload: UploadCopy
  exif: ExifData | null
}

// ---------------------------------------------------------------- 纯函数

/** 读文件头判断真实格式，不信任扩展名和 MIME */
export function sniffFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length < 12) return 'unknown'

  const at = (i: number) => bytes[i] ?? 0

  // JPEG: FF D8 FF
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg'

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return 'png'
  }

  // GIF: "GIF8"
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) {
    return 'gif'
  }

  const ascii = (start: number, len: number) =>
    String.fromCharCode(...Array.from({ length: len }, (_, i) => at(start + i)))

  // RIFF....WEBP
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp'

  // ISO-BMFF 家族：....ftyp<brand>
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4)
    if (brand === 'avif' || brand === 'avis') return 'avif'
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) {
      return 'heic'
    }
  }

  return 'unknown'
}

/** 等比缩放到长边不超过 maxEdge。本来就小于则原样返回，不放大 */
export function computeTargetSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }

  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** 按总像素数上限等比缩放。用于全局指标的降采样 */
export function computeTargetSizeByPixels(
  width: number,
  height: number,
  maxPixels: number,
): { width: number; height: number } {
  const pixels = width * height
  if (pixels <= maxPixels) return { width, height }

  const scale = Math.sqrt(maxPixels / pixels)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** 居中裁一块边长 edge 的方形区域；图比 edge 小就取整张 */
export function computeCenterCrop(
  width: number,
  height: number,
  edge: number,
): { x: number; y: number; width: number; height: number } {
  const w = Math.min(width, edge)
  const h = Math.min(height, edge)
  return {
    x: Math.floor((width - w) / 2),
    y: Math.floor((height - h) / 2),
    width: w,
    height: h,
  }
}

export function aspectRatioLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(width, height) || 1
  const w = width / d
  const h = height / d
  // 约不出好看的整数比就退回小数
  if (w > 40 || h > 40) return `${(width / height).toFixed(2)}:1`
  return `${w}:${h}`
}

// ------------------------------------------------------- 需要 canvas 的部分

function drawToImageData(
  source: ImageBitmap,
  targetWidth: number,
  targetHeight: number,
  crop?: { x: number; y: number; width: number; height: number },
): ImageData {
  const canvas = new OffscreenCanvas(targetWidth, targetHeight)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new IngestError('decode-failed', '拿不到 2d 绘图上下文')

  if (crop) {
    ctx.drawImage(
      source,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      targetWidth,
      targetHeight,
    )
  } else {
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight)
  }

  return ctx.getImageData(0, 0, targetWidth, targetHeight)
}

async function encodeJpegBase64(
  source: ImageBitmap,
  width: number,
  height: number,
): Promise<{ base64: string; byteLength: number }> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new IngestError('decode-failed', '拿不到 2d 绘图上下文')
  ctx.drawImage(source, 0, 0, width, height)

  const blob = await canvas.convertToBlob({
    type: 'image/jpeg',
    quality: UPLOAD_QUALITY,
  })
  const buffer = await blob.arrayBuffer()

  // 分块转 base64，避免 String.fromCharCode 参数过多爆栈
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }

  return { base64: btoa(binary), byteLength: bytes.length }
}

async function readExif(file: File): Promise<ExifData | null> {
  try {
    const raw = await exifr.parse(file, {
      tiff: true,
      exif: true,
      pick: [
        'Make',
        'Model',
        'LensModel',
        'ISO',
        'FNumber',
        'ExposureTime',
        'FocalLength',
        'FocalLengthIn35mmFormat',
        'DateTimeOriginal',
        'Orientation',
      ],
    })
    if (!raw) return null

    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null
    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() !== '' ? v.trim() : null

    return {
      make: str(raw.Make),
      model: str(raw.Model),
      lensModel: str(raw.LensModel),
      iso: num(raw.ISO),
      fNumber: num(raw.FNumber),
      exposureTime: num(raw.ExposureTime),
      focalLength: num(raw.FocalLength),
      focalLength35mm: num(raw.FocalLengthIn35mmFormat),
      dateTaken:
        raw.DateTimeOriginal instanceof Date
          ? raw.DateTimeOriginal.toISOString()
          : null,
      orientation: num(raw.Orientation),
    }
  } catch {
    // EXIF 读不到不是错误，很多修过的图会被剥干净。降级即可
    return null
  }
}

/**
 * 完整摄取一张图。只能在渲染层调用（依赖 OffscreenCanvas / createImageBitmap）。
 */
export async function ingest(file: File): Promise<IngestResult> {
  if (file.size === 0) {
    throw new IngestError('empty-file', '文件是空的')
  }

  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const format = sniffFormat(head)

  if (format === 'heic') {
    throw new IngestError(
      'unsupported-format',
      'Chromium 不能解码 HEIC。请先导出成 JPEG 或 PNG 再上传。',
    )
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch (cause) {
    throw new IngestError(
      'decode-failed',
      `图片解码失败${format === 'unknown' ? '（无法识别的格式）' : `（${format}）`}`,
      { cause },
    )
  }

  try {
    const { width, height } = bitmap

    const globalSize = computeTargetSizeByPixels(width, height, MAX_METRICS_PIXELS)
    const globalDownscaled =
      globalSize.width !== width || globalSize.height !== height
    const global: SampledImage = {
      imageData: drawToImageData(bitmap, globalSize.width, globalSize.height),
      ...globalSize,
    }

    // 原始分辨率裁切：1:1 绘制，不缩放，锐度测量才可信
    const crop = computeCenterCrop(width, height, NATIVE_CROP_EDGE)
    const native: SampledImage = {
      imageData: drawToImageData(bitmap, crop.width, crop.height, crop),
      width: crop.width,
      height: crop.height,
    }

    const uploadSize = computeTargetSize(width, height, UPLOAD_MAX_EDGE)
    const encoded = await encodeJpegBase64(
      bitmap,
      uploadSize.width,
      uploadSize.height,
    )

    return {
      fileName: file.name,
      fileSize: file.size,
      format,
      width,
      height,
      global,
      native,
      globalDownscaled,
      upload: {
        base64: encoded.base64,
        mediaType: 'image/jpeg',
        width: uploadSize.width,
        height: uploadSize.height,
        byteLength: encoded.byteLength,
      },
      exif: await readExif(file),
    }
  } finally {
    bitmap.close()
  }
}
