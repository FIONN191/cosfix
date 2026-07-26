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
    include: ['src/**/*.test.ts'],
  },
})
