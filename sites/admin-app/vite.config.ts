import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path' // Importa el módulo 'path'

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 5174,
  },
  plugins: [react()],
  // AÑADE ESTA SECCIÓN COMPLETA
  resolve: {
    alias: {
      '@minreport/core': path.resolve(__dirname, '../../packages/core/src'),
    },
  },
  optimizeDeps: {
    include: [
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/functions' 
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})