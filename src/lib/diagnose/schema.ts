/**
 * 诊断输出的 JSON Schema，交给 CLI 的 --output-schema 强制。
 *
 * 按 OpenAI structured outputs 的约束写：每个 object 都要
 * `additionalProperties: false`，且所有属性都必须列进 `required`。
 * 少一样就会被拒。
 */
export const DIAGNOSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overallImpression', 'findings', 'protectList'],
  properties: {
    overallImpression: {
      type: 'string',
      description: '两三句话说清这张照片当前的整体水平和最要紧的问题',
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'dimension',
          'title',
          'severity',
          'location',
          'cause',
          'fixability',
          'priority',
        ],
        properties: {
          id: { type: 'string', description: '形如 D-2' },
          dimension: {
            type: 'string',
            enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
          },
          title: { type: 'string', description: '一句话说清是什么问题' },
          severity: {
            type: 'string',
            enum: ['critical', 'major', 'minor', 'good'],
          },
          location: {
            type: 'string',
            description:
              '画面上的具体位置，例如「人物脸部右侧」「画面左上角背景」「裙摆下方」。不接受「整体」「全图」这种空话，除非问题确实是全局性的色调问题',
          },
          cause: { type: 'string', description: '为什么会这样' },
          fixability: {
            type: 'string',
            enum: ['post-fixable', 'ai-generative', 'reshoot-only'],
          },
          priority: {
            type: 'integer',
            description: '1 起，按 严重度 × 投入产出比 排序，1 是最该先修的',
          },
        },
      },
    },
    protectList: {
      type: 'array',
      items: { type: 'string' },
      description:
        '这张图里必须保持不变的角色标志性元素，例如「银白色双马尾」「左眼下的泪痣」「肩甲上的金色纹章」',
    },
  },
} as const
