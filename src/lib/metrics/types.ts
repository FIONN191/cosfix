/** 本地图像指标的数据结构。见设计文档第 5 节。 */

/**
 * 像素输入。`ImageData` 结构上兼容这个接口，所以单测可以在 node 里
 * 直接构造字面量，不需要 DOM。
 */
export interface PixelSource {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface ExifData {
  make: string | null
  model: string | null
  lensModel: string | null
  iso: number | null
  fNumber: number | null
  /** 曝光时间，秒。1/125 存为 0.008 */
  exposureTime: number | null
  focalLength: number | null
  /** 等效 35mm 焦距，判断安全快门和透视畸变要用这个 */
  focalLength35mm: number | null
  dateTaken: string | null
  orientation: number | null
}

export interface ExposureMetrics {
  /** 0-255 */
  meanLuma: number
  rmsContrast: number
  /** L > 250 的像素占比，0-1 */
  highlightClipPct: number
  /** L < 5 的像素占比，0-1 */
  shadowClipPct: number
  p5: number
  p50: number
  p95: number
}

export type WhiteBalanceDirection = 'warm' | 'cool' | 'green' | 'magenta' | 'neutral'

export interface WhiteBalanceMetrics {
  direction: WhiteBalanceDirection
  /** 0-1，偏移幅度。不换算开尔文——单张图反推不出真实色温，报出来就是假精确 */
  magnitude: number
  rbRatio: number
}

export interface SaturationMetrics {
  /** HSV 的 S 平均值，0-1 */
  mean: number
  /** S > 0.7 的像素占比，0-1 */
  highSatPct: number
}

export type SkinVerdict =
  | 'yellowish'
  | 'pale'
  | 'reddish'
  | 'normal'
  | 'insufficient-sample'

export interface SkinMetrics {
  /** 肤色区域占全图比例，0-1 */
  coveragePct: number
  /** 色相角，0-360。采样不足时为 null */
  meanHue: number | null
  meanSat: number | null
  meanVal: number | null
  verdict: SkinVerdict
}

export type SharpnessVerdict = 'soft' | 'normal' | 'oversharpened'

export interface SharpnessMetrics {
  laplacianVariance: number
  verdict: SharpnessVerdict
  /** true 表示测量跑在原始分辨率裁切上（可信）；false 表示只能用降采样图（偏乐观） */
  measuredAtNativeScale: boolean
}

export interface NoiseMetrics {
  /** 平滑区域的标准差估计，0-255 尺度 */
  estimate: number
  measuredAtNativeScale: boolean
}

export interface PaletteEntry {
  hex: string
  /** 0-1 */
  pct: number
}

export interface CompositionMetrics {
  /** 亮度重心，归一化到 0-1 */
  brightnessCentroid: { x: number; y: number }
  /** 地平线倾斜角，度。检测不到为 null */
  horizonTiltDeg: number | null
}

export interface Histogram {
  r: number[]
  g: number[]
  b: number[]
  luma: number[]
}

export interface LocalMetrics {
  dimensions: {
    width: number
    height: number
    aspectRatio: string
    megapixels: number
  }
  /**
   * 全局指标是否跑在降采样图上。大图为控内存会先降到 MAX_METRICS_PIXELS，
   * 直方图/白平衡/肤色/主色板在统计上不受影响，但报告里要如实标注。
   */
  globalMetricsDownscaled: boolean
  histogram: Histogram
  exposure: ExposureMetrics
  whiteBalance: WhiteBalanceMetrics
  saturation: SaturationMetrics
  skin: SkinMetrics
  sharpness: SharpnessMetrics
  noise: NoiseMetrics
  palette: PaletteEntry[]
  composition: CompositionMetrics
  exif: ExifData | null
}
