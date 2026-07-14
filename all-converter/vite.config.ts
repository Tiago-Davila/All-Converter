import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { conversionAssetCacheName, heavyConversionAssetPattern, heavyPrecacheIgnores } from './src/lib/pwa-cache'

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'autoUpdate',
    manifest: { name: 'ConvertiTodo', short_name: 'ConvertiTodo', display: 'standalone' },
    workbox: {
      globPatterns: ['**/*.{js,css,html,webmanifest,woff2}'],
      globIgnores: heavyPrecacheIgnores,
      runtimeCaching: [{
        urlPattern: heavyConversionAssetPattern,
        handler: 'CacheFirst',
        options: {
          cacheName: conversionAssetCacheName,
          cacheableResponse: { statuses: [0, 200] },
          expiration: { maxEntries: 20, purgeOnQuotaError: true },
        },
      }],
    },
  })],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
})
