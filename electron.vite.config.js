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
    // Bake the Bungie credentials into the main bundle at BUILD time. In dev these
    // env vars are usually empty (the app reads .env at runtime via dotenv, which
    // wins), so they resolve to ''. In CI/release builds we set BUNGIE_API_KEY and
    // BUNGIE_CLIENT_ID in the environment (from a GitHub Actions secret), so the
    // packaged binary ships with a working PUBLIC OAuth client — no .env required
    // on the user's machine, and no client secret anywhere in the bundle.
    define: {
      __BUNGIE_API_KEY__: JSON.stringify(process.env.BUNGIE_API_KEY || ''),
      __BUNGIE_CLIENT_ID__: JSON.stringify(process.env.BUNGIE_CLIENT_ID || '')
    },
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
