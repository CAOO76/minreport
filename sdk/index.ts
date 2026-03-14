/**
 * MinReport SDK - Punto de Entrada Principal
 */

import { pluginRegistry } from './core/PluginRegistry';
import { eventBus } from './core/EventBus';
import { entityManager } from './data/EntityManager';
import * as UI from './ui';
import * as Types from './types';
import * as Schemas from './schemas/FinancialEvent';

/**
 * MinReport SDK Global Object
 * Agrupa la funcionalidad de Core, Datos, UI y Tipos para ser consumida de forma interna o por plugins avanzados.
 * 
 * ⚠️ ATENCIÓN DESARROLLADORES DE TERCEROS ⚠️
 * 1. UI Minimalista y Elegante: Obligatorio modo claro/oscuro.
 * 2. Tipografía: Usar exclusivamente 'Atkinson Hyperlegible' (font-atkinson).
 * 3. Iconos y Componentes: Restringido a Material Design 3 (M3). Prohibido usar inputs HTML nativos sin estilizar.
 * 4. Formularios: Siempre deshabilitar autocompletado por seguridad (autocomplete='off').
 * 5. Edge / Offline: Diseña siempre bajo el supuesto de pérdida de conectividad en mina (IndexedDB/Capacitor).
 */
export const MinReport = {
    /** Registro y gestión de ciclo de vida de plugins */
    Core: pluginRegistry,

    /** Motor de enrutamiento y Eventos Globales (Singleton) */
    EventBus: eventBus,

    /** Manipulación de datos segura (Shared Entity Pattern) */
    Data: entityManager,

    /** Kit de componentes visuales estandarizados (Tailwind + Atkinson) */
    UI: UI,

    /** Interfaces genéricas del ecosistema */
    Types: Types,

    /** Contratos Zod inmutables (Global Ledger, etc.) */
    Schemas: Schemas
};

// Re-exportación para facilitar el uso de componentes UI tipados
export * from './types';
export * from './ui';

// ============================================================================
// --- API PÚBLICA DEL GLOBAL LEDGER (CONTRATO STRICTO) ---
// ============================================================================
// Esta es la única puerta de acceso autorizada para interactuar financieramente.
export { eventBus } from './core/EventBus';
export {
    FinancialEventSchema,
    type FinancialEvent
} from './schemas/FinancialEvent';
