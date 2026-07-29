# CosFix 场照诊断 — 设计文档

日期：2026-07-27
状态：已确认，待实现

---

## 1. 这是什么

一个 cos 场照修图方向建议器。上传一张 cos 场照（未修原片或已修成品），它诊断出问题与改进方向，并生成可直接粘贴到 AI 修图工具的提示词。可选上传参考图，得到「你这张离目标还差什么」的逐项分析和靠拢路线图。

同时提供 Mac/Win 桌面版和网页版。

## 2. 非目标

明确不做，避免范围蔓延：

- **不出 Lightroom/PS 参数**。用户明确只要 AI 修图提示词。
- **主线不生成修好的图**。默认只出提示词。生图/改图是可选外接通道（见 9.3），因为目前没有干净的免费路径——接不接、接哪个由用户决定。
- **不出重拍教程**。诊断会把「拍摄决定·修不回来」标出来，但不展开讲下次怎么拍。
- **不做批量队列**。v1 单图。
- **不引入人脸检测库**。肤色用 YCbCr 粗筛，其余交给视觉模型。
- **不做账号系统或云同步**。数据全部本地。

## 3. 架构

单个 Vite + React 工程，`vite build` 产出的同一份 `dist` 被两个壳复用：

- **桌面壳**：Electron 加载 `dist`，AI 调用经 IPC 交给主进程 `fetch`
- **网页壳**：`dist` 部署到 Vercel，AI 调用打到 `/api/vision` Serverless Function 转发

两边的差异全部收敛在 `src/lib/transport.ts` 一个文件里。**硬规矩：渲染层不得直接 `fetch` 外部 API**，一律走 transport。

浏览器直连 Anthropic/Gemini 会被 CORS 拦截，这是必须有转发层的原因；Electron 主进程没有这个限制。

### 目录结构

```
apps/cosfix/
├── src/
│   ├── lib/
│   │   ├── metrics/          纯函数，本地图像指标
│   │   │   histogram.ts  whiteBalance.ts  skin.ts  sharpness.ts
│   │   │   noise.ts  palette.ts  composition.ts  exif.ts  index.ts
│   │   ├── diagnose/         framework.ts  schema.ts  run.ts
│   │   ├── compare/          delta.ts  run.ts
│   │   ├── prompts/          gemini.ts  jimeng.ts  fluxKontext.ts  chatgpt.ts  run.ts
│   │   ├── channels/         统一的执行通道抽象
│   │   │   ├── cli/          codex.ts  qwen.ts  geminiCli.ts  detect.ts
│   │   │   ├── http/         anthropic.ts  openai.ts  gemini.ts  doubao.ts
│   │   │   │                 zhipu.ts  qwen.ts  openrouter.ts
│   │   │   └── index.ts      注册表 + 可用性探测
│   │   ├── transport.ts      环境判断 + 统一调用入口
│   │   ├── image.ts          解码 / 缩放 / HEIC 转码
│   │   └── storage.ts        历史档案读写
│   ├── components/
│   ├── views/
│   └── main.tsx
├── electron/                 main.ts  preload.ts
├── api/vision.ts             Vercel Function
└── docs/superpowers/specs/
```

`metrics/`、`compare/delta.ts`、`prompts/*.ts` 全是纯函数，不碰 DOM 也不碰网络，可独立单测。

---

## 4. 输入模型

| 输入 | 必填 | 作用 |
|---|---|---|
| 主图 | ✅ | 拖入或选本地文件 |
| 状态开关：原片 / 已修成品 | ✅ | 切换诊断口径 |
| 参考图（0–3 张） | ✗ | 开启对比模式 |
| 备注（角色名·作品·想要的感觉） | ✗ | 供 AI 判断还原度 |

状态开关决定两种截然不同的诊断口径：

- **原片** → 「这张能修成什么样」。找潜力和天花板：宽容度还剩多少、哪些问题后期救得回来。
- **成品** → 「哪里修过头、哪里还没到位」。重点抓**做多了**的毛病：磨皮塑料感、液化变形、HDR 味、色调断层、AI 味。

---

## 5. 本地图像指标

上传后在本地 canvas 算完，数值随图一起喂给视觉模型。这是相对「直接把图丢给 ChatGPT」的核心增量——诊断有数据支撑。

**关键细节：指标在原图上算（保证准确），传给 API 的是长边压到 1536px 的副本（省 token，诊断精度足够）。** 原片动辄几十 MB，不能直接怼上去。

```ts
interface LocalMetrics {
  dimensions: { width: number; height: number; aspectRatio: string };
  histogram: { r: number[]; g: number[]; b: number[]; luma: number[] };  // 各 256 bin
  exposure: {
    meanLuma: number;           // 0-255
    rmsContrast: number;
    highlightClipPct: number;   // L > 250 占比
    shadowClipPct: number;      // L < 5 占比
    p5: number; p50: number; p95: number;
  };
  whiteBalance: {
    direction: 'warm' | 'cool' | 'green' | 'magenta' | 'neutral';
    magnitude: number;          // 0-1
    rbRatio: number;
  };
  saturation: { mean: number; highSatPct: number };
  skin: {
    coveragePct: number;
    meanHue: number; meanSat: number; meanVal: number;
    verdict: 'yellowish' | 'pale' | 'reddish' | 'normal' | 'insufficient-sample';
  };
  sharpness: { laplacianVariance: number; verdict: 'soft' | 'normal' | 'oversharpened' };
  noise: { estimate: number };
  palette: Array<{ hex: string; pct: number }>;   // k-means, k=5
  composition: {
    brightnessCentroid: { x: number; y: number };  // 归一化 0-1
    horizonTiltDeg: number | null;
  };
  exif: ExifData | null;
}
```

**白平衡用灰世界法估计，只报方向和幅度，不假装报开尔文值。** 单张图无法反推真实色温，报出来就是假精确。

**肤色用 YCbCr 粗筛**（Cb 77–127, Cr 133–173），取区域平均 HSV 判蜡黄/惨白/发红。采样面积不足时 verdict 返回 `insufficient-sample`，不硬给结论。

**EXIF 价值很高**：读到 ISO / 快门 / 光圈 / 焦距 / 机型，就能把「糊」拆成安全快门不够、高 ISO 涂抹、还是脱焦；把脸部透视变形归因到焦段太广。读不到时降级，报告里标注「无拍摄参数」。

---

## 6. 诊断框架

八个维度，cos 专属项是 G：

| | 维度 | 看什么 |
|---|---|---|
| A | 影调曝光 | 欠曝过曝、死黑死白、宽容度浪费 |
| B | 色彩白平衡 | 偏色、全图色调统一度、色彩断层 |
| C | 肤色 | 蜡黄/惨白/发红、磨皮塑料感、肤色与环境光脱节 |
| D | 光影 | 光位、脸部阴影、立体感、主体光与环境光不匹配的「贴图感」 |
| E | 构图裁切 | 重心、地平线、留白、道具被切、视线方向 |
| F | 质感细节 | 锐度噪点、假发毛躁、布料纹理丢失、金属道具无高光 |
| G | **cos 专属** | 假发边缘与发际线、美瞳反光死板、妆面还原、服装材质廉价感与穿帮、道具塑料感、背景现代元素穿帮（垃圾桶/路人/指示牌/电线）、角色氛围契合度 |
| H | 后期痕迹 | 液化变形、过度磨皮、HDR 味、滤镜过重、AI 味 |

```ts
type Severity   = 'critical' | 'major' | 'minor' | 'good';
type Fixability = 'post-fixable' | 'ai-generative' | 'reshoot-only';

interface Finding {
  id: string;                       // "D-2"
  dimension: 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H';
  title: string;
  severity: Severity;
  location: string;                 // "人物脸部右侧" / "裙摆下方"
  cause: string;
  fixability: Fixability;
  priority: number;                 // 1 起，按 严重度 × 投入产出比 排序
}

interface DiagnosisReport {
  imageState: 'raw' | 'retouched';
  overallImpression: string;
  findings: Finding[];
  protectList: string[];            // 角色标志性元素
  metrics: LocalMetrics;
}
```

`fixability` 是最要紧的字段，直接决定哪些问题能转成提示词、哪些只能明说「这张救不了」。避免生成一堆修不动的假建议。

结果**按 priority 排序展示，不按维度字母顺序排**。

`protectList` 由模型从图中提取角色标志性元素（发色发型、瞳色、服装纹样、特定道具、纹身或印记），后续自动插进每条提示词。

---

## 7. 参考图对比

三步。

**第一步：先独立拆参考图**，不看主图，避免先入为主。

```ts
interface StyleDNA {
  colorTone: string;                       // 冷暖倾向、分离色调
  palette: Array<{ hex: string; pct: number }>;
  tonalCurve: string;                      // 高调/低调、黑位是否抬升
  lighting: {
    position: string;                      // 顺/侧/逆/顶
    ratio: string;                         // 光比
    quality: string;                       // 软/硬
    temperature: string;
    rimLight: boolean;
  };
  texture: string;                         // 颗粒/柔焦/锐利/通透
  moodKeywords: string[];                  // 3-5 个
  compositionParadigm: string;             // 景别、机位高度、留白
  postStyle: string;                       // 日系/欧美电影感/国风/赛博/胶片
}
```

**第二步：量化差集**，纯本地指标相减，不花 AI，出的是硬数字。

```ts
interface MetricDelta {
  label: string;              // "亮度"
  yours: number;
  reference: number;
  humanReadable: string;      // "你比参考暗 0.8 档"
}
```

覆盖：亮度差（换算成档）、白平衡方向差、饱和差、对比差、黑位差、锐度差、主色板 Lab 距离。

**⚠️ 已实测确认的边界：量化差集对局部差异是瞎的。** 拿同一张场照的两个修图版本测过，两版只改了胸口一小块（不到全图 1%），全部全局指标的差都在噪声级别，主色板完全相同。这不是 bug，是全局统计量的固有性质。

结论：**delta 只对整体色调与影调的差异有效**——而这恰好是「向参考图靠拢」的主要诉求，所以设计成立。但局部差异（某个部位的修饰、局部提亮、单个元素的处理）必须靠视觉模型看图发现，界面上不能让用户误以为 delta 覆盖了全部差距。

**第三步：差距归因 + 靠拢路线图。**

```ts
interface GapItem {
  aspect: string;
  gap: string;
  fixability: Fixability;
  note: string;               // 代价说明
}

interface ComparisonReport {
  referenceDNA: StyleDNA;
  deltas: MetricDelta[];
  gaps: GapItem[];
  roadmap: string[];          // 有序步骤
}
```

**`reshoot-only` 这一档是本功能的诚信底线。** 参考图是侧逆光加反光板、主图是正午顶光，后期变不出来；服装做工、布料垂坠感、道具质感同样补不了。可以给「用 AI 重打光」的方案，但必须同时讲清代价（可能改脸）。不能让用户以为任何图都能修成参考图的样子。

---

## 8. 提示词生成

四个目标工具各一个 tab。每条提示词是一张卡片：

```ts
type TargetTool = 'gemini' | 'jimeng' | 'flux-kontext' | 'chatgpt';
type Intensity  = 'light' | 'medium' | 'heavy';

interface PromptCard {
  targetFindingIds: string[];   // 对应哪几条诊断
  tool: TargetTool;
  intensity: Intensity;
  prompt: string;               // 正文，一键复制
  steps?: string[];             // flux-kontext 专用分步序列
  protectList: string[];
  expectedEffect: string;
  risk: string;                 // "可能改脸" / "可能丢服装纹样"
}
```

**强度三档**，同一问题给三种解法：

- `light` 只动色调光影，不改像素结构，脸绝对安全
- `medium` 换背景、补光、去穿帮元素
- `heavy` 重绘背景＋重打光，效果最强但可能改脸

**写法按工具适配：**

| 工具 | 写法 |
|---|---|
| Gemini / Nano Banana | 英文编辑指令句式，开头压一段强 preserve 声明 |
| 即梦 / Seedream / 可灵 | 中文描述式，风格词堆叠 |
| Flux Kontext | 短句，一次只改一处，给分步序列（多改动挤一起会崩） |
| ChatGPT / Sora | 自然语言长句，允许多步骤 |

**保护清单自动插入**：`DiagnosisReport.protectList` 自动注入每条提示词。cos 场照最怕 AI 顺手改掉角色特征，这是刚需。

---

## 9. 执行通道：CLI 与 HTTP API 两条路

诊断需要一个能读图的多模态模型。有两条路拿到它，**默认走 CLI**。

### 9.1 CLI 通道（默认，无需 API key）

各家官方发布的 agentic CLI 用**账号 OAuth 登录**，消耗的是订阅额度而非按 token 计费的 API 额度。桌面版直接 `spawn` 子进程即可，不花钱。

| CLI | 调用方式 | 额度来源 | 本机状态 |
|---|---|---|---|
| Codex | `codex exec -i <图> "<提示词>"` | ChatGPT 订阅 | ✅ 已装 `/Applications/ChatGPT.app/Contents/Resources/codex` |
| Qwen Code | `qwen -p "<提示词>" -o json` | 通义免费额度 | ✅ 已装 `~/.npm-global/bin/qwen` |
| Gemini CLI | `gemini -p "<提示词>" --output-format json` | Google OAuth，60 次/分、1000 次/天 | 未装，可选 |

Codex 的 `-i` 直接附加图片文件；Qwen 与 Gemini CLI 都支持 `--output-format json`，正好对上诊断需要的结构化输出。

**限制要写清楚**：这些是编码 agent，**能读图但不能生图**。它们只覆盖诊断和提示词生成，覆盖不到出图。

**约束**：CLI 通道只在桌面版可用（需要 `spawn` 子进程）。网页版只能走 HTTP API 通道。

### 9.2 HTTP API 通道（可选，需 key）

给没装 CLI 的人和网页版用。支持 Claude、OpenAI、Gemini、豆包、智谱、通义、OpenRouter。每家一个适配器，接口统一：

```ts
interface VisionRequest {
  model: string;
  systemPrompt: string;
  userText: string;
  images: Array<{ base64: string; mediaType: string; label: string }>;
  maxTokens: number;
  jsonSchema?: object;
}

interface VisionProvider {
  id: string;
  label: string;
  models: string[];
  buildRequest(req: VisionRequest): HttpRequestSpec;   // 纯函数
  parseResponse(raw: unknown): VisionResult;           // 纯函数，含 usage
}
```

`buildRequest` / `parseResponse` 是纯函数，用录制的 fixture 单测，不打真网络。

**Key 存储**：桌面版用 Electron `safeStorage` 加密存盘；网页版存 `localStorage` 并在设置页明确提示风险。网页版也支持由服务端环境变量提供 key（部署者自付费模式）。

**成本显示**：每次调用后显示 token 用量和估算费用。CLI 通道不计费，显示「走订阅额度」。

### 9.3 统一抽象

两条通道对上层是同一个接口，`diagnose/run.ts` 不需要知道自己跑在 CLI 还是 HTTP 上：

```ts
type ChannelKind = 'cli' | 'http';

interface Channel {
  id: string;
  kind: ChannelKind;
  label: string;
  available(): Promise<boolean>;      // CLI 探测可执行文件，HTTP 检查 key
  call(req: VisionRequest): Promise<VisionResult>;
}
```

CLI 实现在 Electron 主进程 `spawn` 子进程，把 1536px 副本写到临时文件、路径传给 CLI、读 stdout、解析 JSON、清理临时文件。渲染层通过 `transport.ts` 拿到同样的 `VisionResult`。

启动时探测一遍本机有哪些 CLI 可用，设置页把可用的排在前面，不可用的灰掉并说明原因。

### 9.4 生图外接通道（可选，默认关闭）

CosFix 主线只出提示词。想让它直接出图的话，这里留一个可选钩子——但**目前没有干净的免费路径**，三个选项各有代价，默认全部关闭，由用户自己开：

| 选项 | 成本 | 风险 |
|---|---|---|
| Gemini API（nanobanana 扩展或直连） | 生图**零免费额度**，从第一张就计费 | 无，官方渠道 |
| 复用 Antigravity OAuth 凭据的第三方 skill | 免费 | **拿官方凭据打非官方通道，有封号风险，不推荐** |
| 即梦 CLI | 会员积分 | 工具来源未查证，若为逆向私有接口则有封号风险 |

实现上就是 `Channel` 接口再加一个 `generate(prompt, inputImage?)` 方法，第一版可以只做 Gemini API 直连这一条官方路径。**不在 CosFix 里内置任何绕过官方计费的方案。**

---

## 10. 调用流水线

```
1. ingest      解码 + 读 EXIF + 生成 1536px 副本
2. metrics     在原图上算全部指标
3. call #1     视觉调用：主图 + 可选参考图 + 两组指标 + delta
               → DiagnosisReport (+ ComparisonReport)
4. call #2     纯文本调用：输入诊断 JSON，无图
               → PromptCard[]
```

两次调用都经 `Channel` 抽象，CLI 与 HTTP 通道走同一条流水线。走 CLI 时 1536px 副本落成临时文件传路径，走 HTTP 时转 base64 进请求体——差异收在 Channel 实现里，流水线本身不分叉。

**call #2 不带图**，因此便宜得多，而且切换目标工具时可以单独重跑，不必重新诊断。

有参考图时，DNA 解析和差距归因合并进 call #1 完成——两张图已经在上下文里，拆成两次调用是浪费。

---

## 11. 错误处理

| 情况 | 处理 |
|---|---|
| 没有任何可用通道 | 引导到设置页，列出探测结果：装了哪些 CLI、缺哪些 key |
| CLI 未登录 / 登录过期 | 原样透出 CLI 的提示，附上该 CLI 的登录命令 |
| CLI 子进程超时或非零退出 | 展示 stderr 前若干行，不吞错；标注是哪个 CLI |
| CLI 订阅额度耗尽 | 提示切换到另一条通道，列出当前可用的 |
| 网页版选了 CLI 通道 | 界面上直接灰掉并说明「CLI 通道仅桌面版可用」 |
| 未配置 API key | 引导到设置页，不报错弹窗 |
| 网络超时 | 自动重试一次，仍失败则展示具体错误和 provider 名 |
| 模型返回非法 JSON | 把解析错误回喂给模型重试一次；仍失败则展示原始文本，不静默丢弃 |
| 图片格式不支持（HEIC 等） | 本地转码；转不了则明确提示 |
| 图片过大 | 缩放后上传；原图超出解码能力时提示 |
| EXIF 缺失 | 降级，报告标注「无拍摄参数」 |
| 肤色采样不足 | verdict = `insufficient-sample`，不给结论 |
| 网页版服务端无 key | 提示用户在设置页自带 key |

---

## 12. 存储与导出

- **历史档案**：每次诊断存一条（缩略图 + 报告 + 提示词 + 时间 + 所用模型），可回看可搜。桌面版写用户数据目录，网页版写 IndexedDB。两边共用 `storage.ts` 接口，实现分支。
- **导出**：Markdown 报告 / 一键复制单条提示词 / 导出 JSON。

---

## 13. 测试策略

- **纯函数单测（Vitest）**：`metrics/*`、`compare/delta.ts`、`prompts/*` 的模板渲染。准备 6–8 张固定测试图（过曝、欠曝、偏黄、偏冷、糊、噪点重、正常、无 EXIF），存进 `test/fixtures/`，对指标输出做快照。测试图由用户提供自己的场照，或用程序生成的合成图兜底——M1 开始前需要确认来源。
- **Provider 适配器单测**：用录制的请求/响应 fixture 验证 `buildRequest` / `parseResponse`，不打网络。
- **端到端**：每家 provider 一次真实调用的手动冒烟，不进 CI。

---

## 14. 分期交付

| 阶段 | 内容 |
|---|---|
| M1 | 输入界面 + 本地指标 + 单图诊断 + **CLI 通道（codex）** + Electron 壳，跑通主链路，零成本 |
| M2 | 提示词生成四家 tab + 强度三档 + 保护清单自动注入 |
| M3 | 参考图对比（DNA 解析 + delta + 归因 + 路线图） |
| M4 | 历史档案 + 导出 + 通道设置页（CLI 探测 + HTTP key 配置）+ 成本显示 |
| M5 | 网页壳 + Vercel Function + 部署（网页版只有 HTTP 通道） |
| M6 | 可选：生图外接通道（仅官方计费路径） |

M1 结束时应该已经能用；后续每个阶段都是独立可交付的增量。

---

## 15. 打包

桌面版沿用 Prompt Vault Pro 的模式：Electron + electron-builder 出 DMG / NSIS EXE，未签名（macOS 首次右键打开，Windows SmartScreen 选「仍要运行」）。完成后在 `CLAUDE.md` 补一条 CosFix 的自动打包规则。

网页版部署到 Vercel。
