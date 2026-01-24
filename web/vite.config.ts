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
            strategies: 'generateSW',
            manifest: {
                name: 'MinReport Field',
                short_name: 'MinReport',
                description: 'MinReport Field Application',
                theme_color: '#1f1f1f',
                display: 'standalone',
                background_color: '#1f1f1f',
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
                globPatterns: ['**/*.{js,css,html,ico,png,svg}']
            }
        })
    ],
})
