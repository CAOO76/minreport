/**
 * MinReport SDK - Punto de Entrada Principal
 * "El Ensamblaje Final"
 */

import { pluginRegistry } from './core/PluginRegistry.ts';
import { entityManager } from './data/EntityManager.ts';
import * as UI from './ui/index.tsx';
import * as Types from './types.ts';

/**
 * MinReport SDK Global Object
 * Agrupa la funcionalidad del Core, Datos, UI y Tipos para ser consumida por plugins.
 */
export const MinReport = {
    /** Registro y gestión de ciclo de vida de plugins */
    Core: pluginRegistry,

    /** Manipulación de datos segura (Shared Entity Pattern) */
    Data: entityManager,

    /** Kit de componentes visuales estandarizados (Material Design Flat) */
    UI: UI,

    /** Interfaces y contratos del sistema */
    Types: Types
};

// Re-exportación de tipos para facilitar el uso de TypeScript en los plugins
export * from './types.ts';

/**
 * EJEMPLO DE USO (HIPOTÉTICO):
 * 
 * import { MinReport, PluginLifeCycle, MinReportContext } from '@minreport/sdk';
 * 
 * class PluginTopografia implements PluginLifeCycle {
 *     async onInit(context: MinReportContext) {
 *         console.log("Topografía inicializada en proyecto:", context.projectId);
 *     }
 * 
 *     async onEntityUpdate(entityId: string, data: any) {
 *         // Leer datos del Core y guardar extensión propia
 *         if (data.type === 'ACOPIO') {
 *             await MinReport.Data.extendEntity('acopios', entityId, 'topo', {
 *                 volumenCalculado: 1540,
 *                 metodo: 'DRONE_SCAN'
 *             });
 *         }
 *     }
 * 
 *     renderWidget() {
 *         return (
 *             <MinReport.UI.SDKCard title="Levantamiento Topográfico">
 *                 <MinReport.UI.SDKInput label="Cota Inicial" placeholder="0.00" />
 *                 <MinReport.UI.SDKButton variant="primary" fullWidth>
 *                     Calcular Volumen
 *                 </MinReport.UI.SDKButton>
 *             </MinReport.UI.SDKCard>
 *         );
 *     }
 * }
 * 
 * // Registro del plugin
 * MinReport.Core.register({
 *     id: 'topo',
 *     name: 'Topografía',
 *     version: '1.0.0',
 *     author: 'MinReport'
 * }, new PluginTopografia());
 */
