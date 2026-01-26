import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
    envDir: '..',
    resolve: {
        dedupe: ['firebase']
    },
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            devOptions: {
                enabled: true
            },
            strategies: 'generateSW',
            manifest: {
                name: 'MinReport',
                short_name: 'MinReport',
                description: 'MinReport Field Application',
                theme_color: '#ffffff',
                display: 'standalone',
                background_color: '#ffffff',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png'
                    }
                ]
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB
                runtimeCaching: [
                    {
                        urlPattern: ({ request }) => request.destination === 'image' || request.destination === 'video',
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'media-cache',
                            expiration: {
                                maxEntries: 200,
                                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
                            },
                        },
                    },
                    {
                        urlPattern: /^https:\/\/firestore\.googleapis\.com/,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'api-cache',
                            expiration: {
                                maxEntries: 500,
                                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 Days
                            },
                            networkTimeoutSeconds: 10,
                        },
                    }
                ]
            }
        })
    ],
})
