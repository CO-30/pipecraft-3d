/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => ({
  // GitHub Pages のサブパス（/pipecraft-3d/）でもそのまま動くよう相対パス
  base: './',
  plugins: [
    react(),
    VitePWA({
      // E2E ビルドでは Service Worker を無効にする（テストの再読み込みでキャッシュが残らないように）
      disable: mode === 'e2e',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'PipeCraft 3D',
        short_name: 'PipeCraft',
        description: '建物と配管・配線を指で描いて数量を集計する積算支援アプリ',
        lang: 'ja',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        background_color: '#ffffff',
        theme_color: '#1e3a8a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,webmanifest,ttf,xlsx,pdf,wasm}'],
        maximumFileSizeToCacheInBytes: 5_000_000,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: { include: ['src/**/*.test.{ts,tsx}'] },
}))
