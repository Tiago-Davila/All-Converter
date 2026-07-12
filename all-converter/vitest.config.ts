import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // mammoth se resuelve a su build de navegador (API { arrayBuffer }), igual que en Vite.
  resolve: { alias: { mammoth: 'mammoth/mammoth.browser.js' } },
  test: { environment: 'node', setupFiles: ['./src/test/setup.ts'] },
})
