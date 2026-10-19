import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    envDir: '..',
    define: {
        __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },
    resolve: {
        preserveSymlinks: true,
        dedupe: ['firebase']
    },
    plugins: [react()],
    server: {
        port: 5174
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (id.includes('firebase')) {
                            return 'vendor-firebase';
                        }
                        if (id.includes('framer-motion')) {
                            return 'vendor-motion';
                        }
                        if (id.includes('lucide-react')) {
                            return 'vendor-icons';
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
