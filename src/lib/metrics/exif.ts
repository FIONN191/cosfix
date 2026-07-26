import type { ExifData } from './types.ts'

/**
 * 从 EXIF 派生诊断用得上的结论。
 *
 * 这些派生项价值很高：一张「糊」的照片，看参数就能定性是安全快门不够、
 * 高 ISO 涂抹、还是脱焦——不用靠猜。脸部透视变形同理，看等效焦距就知道
 * 是不是焦段太广造成的。
 */

export interface ExifDerived {
  /** "1/125" 这样的可读快门 */
  shutterLabel: string | null
  /**
   * 是否低于安全快门（1/等效焦距）。缺参数返回 null。
   * 注意：机身/镜头防抖能突破这条经验法则，所以这只是「可疑」不是「确诊」。
   */
  belowSafeShutter: boolean | null
  /** ISO 是否高到该预期噪点与涂抹 */
  highIso: boolean | null
  /** 等效焦距是否广到会让近距离人脸透视变形 */
  wideAngleFaceRisk: boolean | null
  /** 给模型看的一句话摘要 */
  summary: string
}

export const HIGH_ISO = 3200
export const WIDE_ANGLE_35MM = 28

export function shutterLabel(exposureTime: number | null): string | null {
  if (exposureTime === null || exposureTime <= 0) return null
  if (exposureTime >= 1) return `${exposureTime.toFixed(1)}s`
  return `1/${Math.round(1 / exposureTime)}`
}

export function deriveExif(exif: ExifData | null): ExifDerived {
  if (!exif) {
    return {
      shutterLabel: null,
      belowSafeShutter: null,
      highIso: null,
      wideAngleFaceRisk: null,
      summary: '无拍摄参数（EXIF 缺失或已被剥除）',
    }
  }

  const label = shutterLabel(exif.exposureTime)

  // 安全快门经验法则：快门时间 > 1/等效焦距 就容易手抖糊
  const focal = exif.focalLength35mm ?? exif.focalLength
  const belowSafeShutter =
    exif.exposureTime !== null && focal !== null && focal > 0
      ? exif.exposureTime > 1 / focal
      : null

  const highIso = exif.iso !== null ? exif.iso >= HIGH_ISO : null

  const wideAngleFaceRisk =
    exif.focalLength35mm !== null
      ? exif.focalLength35mm <= WIDE_ANGLE_35MM
      : null

  const parts: string[] = []
  if (exif.model) parts.push(exif.model)
  if (exif.focalLength35mm !== null) parts.push(`等效 ${exif.focalLength35mm}mm`)
  else if (exif.focalLength !== null) parts.push(`${exif.focalLength}mm`)
  if (exif.fNumber !== null) parts.push(`f/${exif.fNumber}`)
  if (label) parts.push(label)
  if (exif.iso !== null) parts.push(`ISO ${exif.iso}`)

  const flags: string[] = []
  if (belowSafeShutter) flags.push('低于安全快门，糊可能来自手抖')
  if (highIso) flags.push('高 ISO，预期有噪点或涂抹')
  if (wideAngleFaceRisk) flags.push('广角，近距离拍脸会有透视变形')

  const summary =
    (parts.length > 0 ? parts.join('，') : '拍摄参数不全') +
    (flags.length > 0 ? `。注意：${flags.join('；')}` : '')

  return { shutterLabel: label, belowSafeShutter, highIso, wideAngleFaceRisk, summary }
}
