import {
    PluginManifest,
    PluginLifeCycle,
    MinReportContext
} from '../types';

/**
 * Interface interna para almacenar el plugin y su implementación.
 */
interface RegisteredPlugin {
    manifest: PluginManifest;
    instance: PluginLifeCycle;
    isActive: boolean;
}

/**
 * PluginRegistry - El Cerebro del SDK
 * Encargado de registrar, filtrar e inicializar los plugins.
 */
export class PluginRegistry {
    private static instance: PluginRegistry;
    private registry: Map<string, RegisteredPlugin> = new Map();

    private constructor() { }

    /**
     * Retorna la instancia única del registro (Singleton).
     */
    public static getInstance(): PluginRegistry {
        if (!PluginRegistry.instance) {
            PluginRegistry.instance = new PluginRegistry();
        }
        return PluginRegistry.instance;
    }

    /**
     * Registra un nuevo plugin en el sistema.
     * @param manifest Metadata del plugin.
     * @param implementation Clase o instancia que implementa PluginLifeCycle.
     */
    public register(manifest: PluginManifest, implementation: PluginLifeCycle): void {
        if (this.registry.has(manifest.id)) {
            console.warn(`[SDK] Plugin con ID "${manifest.id}" ya está registrado. Sobrescribiendo...`);
        }

        this.registry.set(manifest.id, {
            manifest,
            instance: implementation,
            isActive: false
        });

        console.log(`[SDK] Plugin registrado: ${manifest.name} (v${manifest.version})`);
    }

    /**
     * Inicializa los plugins permitidos según los permisos del usuario.
     * @param context Contexto de MinReport (proyecto, usuario, etc).
     * @param userEntitlements Array de IDs de plugins permitidos.
     */
    public async initializePlugins(context: MinReportContext, userEntitlements: string[]): Promise<void> {
        console.log(`[SDK] Inicializando plugins para el usuario ${context.userId}...`);

        for (const [id, plugin] of this.registry.entries()) {
            // Un plugin se activa si está en userEntitlements 
            // Podríamos añadir una marca de 'isCore' en el manifest en el futuro si fuera necesario.
            const hasPermission = userEntitlements.includes(id);

            if (hasPermission) {
                try {
                    console.log(`[SDK] Activando plugin: ${plugin.manifest.name}...`);
                    await plugin.instance.onInit(context);
                    plugin.isActive = true;
                } catch (error) {
                    console.error(`[SDK] Error al inicializar el plugin "${id}":`, error);
                }
            } else {
                console.warn(`[SDK] Acceso denegado o plugin no solicitado: ${id}`);
                plugin.isActive = false;
            }
        }
    }

    /**
     * Devuelve la lista de plugins que están actualmente activos y funcionales.
     */
    public getActivePlugins(): PluginManifest[] {
        return Array.from(this.registry.values())
            .filter(p => p.isActive)
            .map(p => p.manifest);
    }

    /**
     * Devuelve la instancia de implementación de un plugin activo.
     * Útil para que el Core llame a métodos específicos (ej. renderWidget).
     */
    public getPluginInstance(id: string): PluginLifeCycle | undefined {
        const plugin = this.registry.get(id);
        return plugin?.isActive ? plugin.instance : undefined;
    }
}

// Exportamos una instancia única para facilidad de uso en toda la aplicación.
export const pluginRegistry = PluginRegistry.getInstance();
