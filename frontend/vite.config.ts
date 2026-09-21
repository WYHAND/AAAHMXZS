import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
    watch: {
      // ⚠️ 必须忽略 dist / node_modules（Windows 上尤其重要）。
      //
      // 原因：Vite 默认**不忽略 dist**。如果 dev server 正在运行时执行 `npm run build`，
      // 监听器会去 watch 正在被写入的构建产物，文件被占用就抛
      // `EBUSY: resource busy or locked, watch`，**整个 dev server 直接退出**，
      // 浏览器表现为 ERR_CONNECTION_REFUSED。
      //
      // 这两类目录本来也不需要热更新（改的是 src/），忽略它是零代价的。
      ignored: ['**/dist/**', '**/node_modules/**', '**/.git/**', '**/*.tmp'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 图表库与 Radix 底座单独成块，避免首屏 JS 过大（rolldown 只接受函数形式）
        manualChunks(id: string) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'recharts'
          }
          if (id.includes('node_modules/radix-ui') || id.includes('node_modules/@radix-ui')) {
            return 'radix'
          }
          return undefined
        },
      },
    },
  },
})
