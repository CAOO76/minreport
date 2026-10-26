import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
    envDir: '..',
    resolve: {
        alias: {
            '@opermaq': path.resolve(__dirname, './src/modules/opermaq'),
            '@stockpile': path.resolve(__dirname, './src/modules/stockpile'),
        },
        preserveSymlinks: true,
        dedupe: ['react', 'react-dom', 'firebase', 'framer-motion']
    },
    plugins: [
        react(),
        {
            name: 'minreport-dev-url-banner',
            configureServer(server) {
                server.httpServer?.once('listening', () => {
                    setTimeout(() => {
                        const port = server.config.server.port || 5173;
                        console.log(`\x1b[38;2;198;131;70m  ➜  DEV Gateway:\x1b[0m http://localhost:${port}/dev`);
                    }, 100);
                });
            }
        },
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
                theme_color: '#121212',
                background_color: '#121212',
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
                navigateFallbackAllowlist: [/^(?!\/__).*/],
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
        proxy: {
            '/api': {
                target: 'http://localhost:8080',
                changeOrigin: true
            }
        },
        fs: {
            allow: [
                '..'
            ]
        },
        watch: {
            ignored: ['**/android/**', '**/dist/**']
        }
    },
    build: {
        target: 'esnext',
        modulePreload: false,
        rollupOptions: {
            external: [],
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('@firebase/firestore') || id.includes('firebase/firestore')) {
                            return 'vendor-firestore';
                        }
                        if (id.includes('firebase')) {
                            return 'vendor-firebase';
                        }
                        if (id.includes('framer-motion')) {
                            return 'vendor-motion';
                        }
                        if (id.includes('@capacitor')) {
                            return 'vendor-capacitor';
                        }
                        if (id.includes('i18next') || id.includes('react-i18next')) {
                            return 'vendor-i18n';
                        }
                        if (id.includes('react-dom') || id.includes('react-router-dom') || id.includes('/react/')) {
                            return 'vendor-react';
                        }
                    }
                }
            }
        }
    }
})
