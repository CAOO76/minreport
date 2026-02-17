import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const ROOT_DIR = path.resolve(__dirname, '../');
const PLUGINS_JSON = path.join(ROOT_DIR, 'plugins.json');
const EXTERNAL_PLUGINS_DIR = path.join(ROOT_DIR, '_plugins');
const WEB_CORE_DIR = path.join(ROOT_DIR, 'web/src/core');
const ADMIN_CORE_DIR = path.join(ROOT_DIR, 'admin/src/core');

interface PluginEntry {
    id: string;
    name: string;
    gitUrl: string;
    icon?: string;
    description?: string;
}

function sync() {
    console.log("🤖 MINREPORT Cloud-Ready Sync");

    if (!fs.existsSync(PLUGINS_JSON)) {
        console.error("❌ El archivo plugins.json no existe.");
        return;
    }

    if (!fs.existsSync(EXTERNAL_PLUGINS_DIR)) {
        fs.mkdirSync(EXTERNAL_PLUGINS_DIR, { recursive: true });
    }

    const plugins: PluginEntry[] = JSON.parse(fs.readFileSync(PLUGINS_JSON, 'utf8'));
    console.log(`📋 Procesando ${plugins.length} plugins desde el manifiesto...`);

    const discovered: any[] = [];

    for (const plugin of plugins) {
        const pluginPath = path.join(EXTERNAL_PLUGINS_DIR, plugin.id);

        try {
            if (!fs.existsSync(pluginPath)) {
                console.log(`📥 Clonando ${plugin.id}...`);
                execSync(`git clone ${plugin.gitUrl} ${plugin.id}`, { cwd: EXTERNAL_PLUGINS_DIR, stdio: 'inherit' });
            } else {
                console.log(`🔄 Actualizando ${plugin.id}...`);
                execSync(`git pull`, { cwd: pluginPath, stdio: 'inherit' });
            }

            const pkgPath = path.join(pluginPath, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

            discovered.push({
                id: plugin.id,
                name: plugin.name,
                importPath: `@minreport/${plugin.id}`,
                version: pkg.version,
                localPath: pluginPath,
                icon: plugin.icon || 'extension',
                description: plugin.description || ''
            });
        } catch (error) {
            console.error(`❌ Error sincronizando ${plugin.id}:`, error);
        }
    }

    // 1. Generar archivo de descubrimiento
    const webContent = `
/** 
 * ARCHIVO GENERADO AUTOMÁTICAMENTE - NO EDITAR 
 * Generado por scripts/sync_plugins.ts
 */
import { PluginManifest, PluginLifeCycle } from '@minreport/sdk';
${discovered.map(p => `import ${p.id.replace(/-/g, '_')}Plugin from '${p.importPath}';`).join('\n')}

export const DISCOVERED_PLUGINS: { manifest: PluginManifest; instance: PluginLifeCycle }[] = [
    ${discovered.map(p => `{
        manifest: { 
            id: '${p.id}', 
            name: '${p.name}', 
            version: '${p.version}', 
            author: 'MINREPORT Team',
            icon: '${p.icon}',
            description: '${p.description}'
        },
        instance: ${p.id.replace(/-/g, '_')}Plugin
    }`).join(',\n    ')}
];
`;

    fs.writeFileSync(path.join(WEB_CORE_DIR, 'DiscoveredPlugins.ts'), webContent);
    fs.writeFileSync(path.join(ADMIN_CORE_DIR, 'DiscoveredPlugins.ts'), webContent);
    console.log("✅ Registros dinámicos generados (Web & Admin).");

    // 2. Generar alias para Vite
    const aliases: Record<string, string> = {};
    discovered.forEach(p => {
        // Usamos rutas relativas al directorio del script para el JSON de alias
        aliases[p.importPath] = path.join(EXTERNAL_PLUGINS_DIR, p.id, 'src/plugin.ts');
    });

    fs.writeFileSync(path.join(__dirname, 'plugin_aliases.json'), JSON.stringify(aliases, null, 2));
    console.log("✅ plugin_aliases.json actualizado con rutas portátiles.");
}

sync();
