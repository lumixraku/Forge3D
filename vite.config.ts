import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'model-viewer' } } })],
  server: {
    port: 5175,
    strictPort: true,
    watch: {
      ignored: ['**/server/data/**'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
