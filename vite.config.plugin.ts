import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Build for the DSH plugin: the same app, served under `/forge3d/` by
// `dsh-plugin/lib/index.js`. Kept separate from vite.config.ts so the
// Cloudflare deployment keeps its own (root-based) output.
export default defineConfig({
  base: '/forge3d/',
  plugins: [tailwindcss(), vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'model-viewer' } } })],
  build: {
    outDir: 'dsh-plugin/dist',
    emptyOutDir: true,
  },
})
