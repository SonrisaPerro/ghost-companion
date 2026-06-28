import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite builds three separate bundles: main, preload, and renderer.
// `externalizeDepsPlugin` keeps node/native deps (better-sqlite3, electron-store,
// node-fetch) out of the bundle so they load from node_modules at runtime — this
// is REQUIRED for native modules like better-sqlite3.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.js') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.js') }
      }
    }
  },
  renderer: {
    // The renderer is a normal Vite + React app rooted at src/renderer.
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
