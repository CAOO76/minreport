import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

const aliasesJsonPath = path.resolve(__dirname, '../scripts/plugin_aliases.json');
const pluginAliases = fs.existsSync(aliasesJsonPath)
    ? JSON.parse(fs.readFileSync(aliasesJsonPath, 'utf8'))
    : {};

// https://vitejs.dev/config/
export default defineConfig({
    envDir: '..',
    define: {
        __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },
    resolve: {
        preserveSymlinks: true,
        dedupe: ['firebase'],
        alias: {
            ...pluginAliases
        }
    },
    plugins: [react()],
    server: {
        port: 5174 // Different port from client client app (5173)
    }
})
