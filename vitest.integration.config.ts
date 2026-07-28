import { defineConfig } from 'vitest/config'

/**
 * 集成测试专用配置。这些测试会真起子进程调用本机 CLI，
 * 耗时以十秒计并消耗订阅额度，所以跟单测彻底分开跑。
 *
 *   npm run test:integration
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.ts'],
    testTimeout: 240_000,
    hookTimeout: 60_000,
  },
})
