import fs from 'fs'
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
        dedupe: ['react', 'react-dom', 'firebase']
    },
    plugins: [
        {
            name: 'minreport-non-empty-tsx-guard',
            enforce: 'pre',
            async load(id) {
                const cleanId = id.split('?')[0];
                if (!cleanId.endsWith('.tsx') && !cleanId.endsWith('.ts')) return null;
                if (cleanId.includes('node_modules')) return null;
                try {
                    let content = await fs.promises.readFile(cleanId, 'utf-8');
                    let attempts = 0;
                    while (content.trim().length === 0 && attempts < 5) {
                        await new Promise((r) => setTimeout(r, 80));
                        content = await fs.promises.readFile(cleanId, 'utf-8');
                        attempts++;
                    }
                    return content;
                } catch {
                    return null;
                }
            }
        },
        react(),
        {
            name: 'minreport-dev-url-banner',
            configureServer(server) {
                server.httpServer?.once('listening', () => {
                    setTimeout(() => {
                        const port = server.config.server.port || 5173;
                        console.log(`\x1b[38;2;198;131;70m  [DEV] Gateway:\x1b[0m http://localhost:${port}/dev`);
                    }, 100);
                });
            }
        },
        VitePWA({
            registerType: 'autoUpdate',
            devOptions: {
                enabled: true
            },
            includeAssets: ['favicon.ico', 'favicon.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
            manifest: {
                id: '/',
                name: 'MINREPORT',
                short_name: 'MINREPORT',
                description: 'Plataforma de reporteria y analitica industrial minera',
                theme_color: '#C68346',
                background_color: '#000000',
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
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
                maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
                navigateFallback: 'index.html',
                navigateFallbackAllowlist: [/^(?!\/__).*/],
                navigateFallbackDenylist: [/^\/src/, /^\/node_modules/, /^\/@/],
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) =>
                            url.origin.includes('firebasestorage') ||
                            url.pathname.startsWith('/api/media/blob/'),
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'media-cas-immutable-cache',
                            expiration: {
                                maxEntries: 600,
                                maxAgeSeconds: 365 * 24 * 60 * 60,
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
            ignored: ['**/android/**', '**/dist/**'],
            awaitWriteFinish: {
                stabilityThreshold: 250,
                pollInterval: 40
            }
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
                        if (id.includes('@capacitor')) {
                            return 'vendor-capacitor';
                        }
                        if (id.includes('i18next') || id.includes('react-i18next')) {
                            return 'vendor-i18n';
                        }
                        if (id.includes('pdf-lib') || id.includes('pdfjs-dist') || id.includes('mediabunny')) {
                            return 'vendor-media-digestor';
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
