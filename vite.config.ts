import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // 相对路径，这样 Electron 里从 file:// 加载也能跑
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT) || 5178,
  },
  test: {
    environment: 'node',
    // 集成测试的文件名是 *.integration.ts，刻意不匹配这个 glob——
    // 它会真起子进程打 codex，耗时约 25s 且消耗订阅额度，不能进默认测试。
    // 单独跑：npm run test:integration
    include: ['src/**/*.test.ts'],
  },
})
