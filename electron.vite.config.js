import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// scripts/dev.js 会先探测空闲端口再通过 DEV_PORT 传进来
const devPort = Number(process.env.DEV_PORT) || 5173

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    server: {
      port: devPort,
      strictPort: Boolean(process.env.DEV_PORT)
    },
    plugins: [vue()],
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler'
        }
      }
    }
  }
})
