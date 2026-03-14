/**
 * SDK_METADATA - Source of truth for the current SDK version details.
 * This metadata is used by the Auto-Discovery system to register new versions
 * automatically when they are deployed.
 */
export const SDK_METADATA = {
    version: '2.2.0',
    changelog: [
        "Global Ledger Contract: Nueva validación estricta Zod (FinancialEventSchema).",
        "GlobalEventBus: Implementación de Singleton con manejo de errores y desuscripción segura.",
        "Consolidación de API Pública: Exportación estructurada de core, schemas y tipos.",
        "Refactor Industrial: SDKSwitch mejorado con el estándar Material Design 3."
    ],
    author: 'MinReport Engineering',
    releaseDate: new Date(),
    status: 'PRODUCTION-READY' as const
};
