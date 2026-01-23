import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    envDir: '..',
    resolve: {
        dedupe: ['firebase']
    },
    plugins: [react()],
    server: {
        port: 5174 // Different port from client client app (5173)
    }
})
