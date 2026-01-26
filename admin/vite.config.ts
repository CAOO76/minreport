import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    envDir: '..',
    define: {
        __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },
    resolve: {
        dedupe: ['firebase']
    },
    plugins: [react()],
    server: {
        port: 5174 // Different port from client client app (5173)
    }
})
