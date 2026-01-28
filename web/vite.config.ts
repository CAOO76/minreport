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
            '@minreport/sdk': path.resolve(__dirname, '../sdk/index.ts'),
            '@minreport/sdk/types': path.resolve(__dirname, '../sdk/types.ts'),
            '@minreport/sdk/ui': path.resolve(__dirname, '../sdk/ui/index.tsx'),
            '@minreport/sdk/data': path.resolve(__dirname, '../sdk/data/EntityManager.ts'),
            '@minreport/sdk/core': path.resolve(__dirname, '../sdk/core/PluginRegistry.ts')
        },
        extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']
    },
    plugins: [
        // Custom plugin to resolve SDK internal imports
        {
            name: 'resolve-sdk-imports',
            resolveId(source, importer) {
                if (!importer) return null;

                // Only handle imports from SDK files
                if (!importer.includes('/sdk/')) return null;

                const sdkRoot = path.resolve(__dirname, '../sdk');

                // Map relative imports to absolute paths
                if (source.startsWith('./')) {
                    const importerDir = path.dirname(importer);
                    const resolved = path.resolve(importerDir, source);

                    // Try different extensions
                    const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
                    for (const ext of extensions) {
                        const fullPath = resolved + ext;
                        try {
                            if (require('fs').existsSync(fullPath)) {
                                return fullPath;
                            }
                        } catch (e) {
                            // Continue to next extension
                        }
                    }
                }

                return null;
            }
        },
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
