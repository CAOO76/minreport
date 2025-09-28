import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5178,
        strictPort: true, // Force Vite to use this port or fail
        fs: {
            allow: [
                path.resolve(__dirname, '../../'), // Allow serving files from the project root
            ],
            deny: [path.resolve(__dirname, '../../__mocks__')], // Deny access to the __mocks__ directory
        },
    },
    optimizeDeps: {
        exclude: ['../../__mocks__'], // Exclude the __mocks__ directory using a direct string path
    }, resolve: {
        alias: {
            '@minreport/sdk': path.resolve(__dirname, '../../packages/sdk/src'), // Map alias to sdk package src
        },
    },
});
