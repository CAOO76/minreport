import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    envDir: '..',
    resolve: {
        dedupe: ['firebase'],
        alias: {
            '@minreport/sdk': path.resolve(__dirname, '../sdk')
        }
    },
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            devOptions: {
                enabled: true
            },
            includeAssets: ['favicon.ico', 'pwa-192x192.png', 'pwa-512x512.png'],
            manifest: {
                id: '/',
                name: 'MinReport',
                short_name: 'MinReport',
                description: 'MinReport Field Application',
                theme_color: '#ffffff',
                background_color: '#ffffff',
                display: 'standalone',
                orientation: 'portrait',
                start_url: '/',
                scope: '/',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'any'
                    },
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'maskable'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'any'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable'
                    }
                ]
            },
            workbox: {
                cleanupOutdatedCaches: true,
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
                navigateFallback: 'index.html',
                navigateFallbackDenylist: [/^\/src/, /^\/node_modules/, /^\/@/],
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) => url.origin.includes('firebasestorage'),
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'media-cache',
                            expiration: {
                                maxEntries: 200,
                                maxAgeSeconds: 30 * 24 * 60 * 60,
                            },
                        },
                    },
                    {
                        urlPattern: ({ url }) => url.hostname.includes('firestore') || url.pathname.includes('api'),
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'api-cache',
                            expiration: {
                                maxEntries: 500,
                                maxAgeSeconds: 7 * 24 * 60 * 60,
                            },
                            networkTimeoutSeconds: 10,
                        },
                    }
                ]
            }
        })
    ],
    server: {
        host: true,
        fs: {
            allow: ['..']
        }
    }
})
