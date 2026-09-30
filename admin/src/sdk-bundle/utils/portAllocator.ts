/**
 * Utilidad de Desarrollo para Plugins Tiers
 * Garantiza que cada plugin de terceros utilice un puerto de red único y constante
 * en entornos de desarrollo (localhost), evitando choques con Admin (5174) y Core (5173).
 */

export const DevTools = {
    /**
     * Genera un puerto consistente y determinista basado en el identificador del plugin.
     * Rango de asignación seguro: 5200 - 5999
     * 
     * @param pluginId El string del id del plugin (e.g., "my-plugin-v1")
     * @returns Un puerto en formato number.
     * 
     * @example
     * // En vite.config.ts de tu plugin:
     * import { MinReport } from '@minreport/sdk';
     * export default defineConfig({
     *   server: {
     *     port: MinReport.DevTools.getDeterministicDevPort("nombre-del-plugin"),
     *     strictPort: true
     *   }
     * })
     */
    getDeterministicDevPort: (pluginId: string): number => {
        let hash = 0;
        for (let i = 0; i < pluginId.length; i++) {
            hash = pluginId.charCodeAt(i) + ((hash << 5) - hash);
        }
        
        // Retornamos un puerto seguro: Offset 5200 + Hash Modulo 800 (hasta 5999)
        const port = 5200 + (Math.abs(hash) % 800);
        return port;
    }
};
