import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative URLs, so the site works from any path (GitHub Pages serves it
  // from /<repository>/).
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Doc Scanner',
        short_name: 'Doc Scanner',
        description: 'Scan paper into a searchable personal archive.',
        display: 'standalone',
        start_url: '.',
        background_color: '#f7f8fc',
        theme_color: '#1f6feb',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // The scanner and OCR engines are large and come in several builds
        // of which a browser needs one, so they are not downloaded up front.
        // Each is cached the first time it is used; after one scan the app
        // works offline.
        globIgnores: ['vendor/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/vendor/'),
            handler: 'CacheFirst',
            options: { cacheName: 'engines', cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  build: {
    // The app bundles its PDF writer and OCR client; one ~200 kB (gzipped)
    // script is fine for an app that is cached after the first visit.
    chunkSizeWarningLimit: 1024,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
