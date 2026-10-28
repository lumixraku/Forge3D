import { fileURLToPath } from 'node:url'
import path from 'node:path'

const corePath = fileURLToPath(new URL('./packages/canvas-core/src/index.ts', import.meta.url))

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  define: { __FORGE3D_EMBED__: 'false', __FORGE3D_CSS__: '""' },
  resolve: { alias: { '@forge3d/canvas-core': corePath } },
  plugins: [tailwindcss(), react()],
  server: {
    port: 5175,
    watch: {
      ignored: ['**/server/data/**'],
    },
    proxy: {
      '/api': process.env.VITE_API_URL || 'http://127.0.0.1:8787',
    },
  },
})
