
import * as fs from 'fs';
import * as path from 'path';

const PLUGINS_DIR = '/Volumes/CODE/MINREPORT iMac/PLUGINS';
const WEB_CORE_DIR = path.resolve(__dirname, '../web/src/core');
const ADMIN_CORE_DIR = path.resolve(__dirname, '../admin/src/core');

function sync() {
    console.log("🔍 Escaneando carpeta de plugins:", PLUGINS_DIR);

    if (!fs.existsSync(PLUGINS_DIR)) {
        console.error("❌ La carpeta de plugins no existe.");
        return;
    }

    const pluginFolders = fs.readdirSync(PLUGINS_DIR).filter(f => {
        return fs.statSync(path.join(PLUGINS_DIR, f)).isDirectory() &&
            fs.existsSync(path.join(PLUGINS_DIR, f, 'package.json'));
    });

    console.log(`📦 Encontrados ${pluginFolders.length} plugins.`);

    const discovered = pluginFolders.map(folder => {
        const pkgPath = path.join(PLUGINS_DIR, folder, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const id = folder.toLowerCase();
        const name = pkg.pluginConfig?.name || pkg.description || folder;

        return {
            id,
            name,
            importPath: `@minreport/${id}`,
            version: pkg.version
        };
    });

    // 1. Generar archivo de descubrimiento para WEB
    const webContent = `
/** 
 * ARCHIVO GENERADO AUTOMÁTICAMENTE - NO EDITAR 
 * Generado por scripts/sync_plugins.ts
 */
${discovered.map(p => `import ${p.id.replace(/-/g, '_')}Plugin from '${p.importPath}';`).join('\n')}

export const DISCOVERED_PLUGINS = [
    ${discovered.map(p => `{
        manifest: { id: '${p.id}', name: '${p.name}', version: '${p.version}' },
        instance: ${p.id.replace(/-/g, '_')}Plugin
    }`).join(',\n    ')}
];
`;

    fs.writeFileSync(path.join(WEB_CORE_DIR, 'DiscoveredPlugins.ts'), webContent);
    console.log("✅ DiscoveredPlugins.ts generado en WEB Core.");

    // 2. Generar archivo de descubrimiento para ADMIN
    fs.writeFileSync(path.join(ADMIN_CORE_DIR, 'DiscoveredPlugins.ts'), webContent);
    console.log("✅ DiscoveredPlugins.ts generado en ADMIN Core.");

    // 3. Generar alias para Vite (JSON para ser consumido por vite.config.ts)
    const aliases: Record<string, string> = {};
    discovered.forEach(p => {
        aliases[p.importPath] = path.join(PLUGINS_DIR, p.id.toUpperCase(), 'src/plugin.ts');
    });
    fs.writeFileSync(path.join(__dirname, 'plugin_aliases.json'), JSON.stringify(aliases, null, 2));
    console.log("✅ plugin_aliases.json generado.");
}

sync();
