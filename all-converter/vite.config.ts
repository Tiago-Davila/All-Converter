import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({ registerType: 'autoUpdate', manifest: { name: 'ConvertiTodo', short_name: 'ConvertiTodo', display: 'standalone' }, workbox: { globPatterns: ['**/*.{js,css,html,wasm}'], maximumFileSizeToCacheInBytes: 40 * 1024 * 1024 } })],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
})
