/**
 * MinReport SDK - Punto de Entrada Principal
 */

import { pluginRegistry } from './core/PluginRegistry';
import { entityManager } from './data/EntityManager';
import * as UI from './ui';
import * as Types from './types';

/**
 * MinReport SDK Global Object
 * Agrupa la funcionalidad de Core, Datos, UI y Tipos para ser consumida por plugins.
 */
export const MinReport = {
    /** Registro y gestión de ciclo de vida de plugins */
    Core: pluginRegistry,

    /** Manipulación de datos segura (Shared Entity Pattern) */
    Data: entityManager,

    /** Kit de componentes visuales estandarizados (Tailwind + Atkinson) */
    UI: UI,

    /** Interfaces y contratos del sistema */
    Types: Types
};

// Re-exportación para facilitar el uso directo
export * from './types';
export * from './ui';
