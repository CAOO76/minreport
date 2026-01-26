/**
 * SDK_METADATA - Source of truth for the current SDK version details.
 * This metadata is used by the Auto-Discovery system to register new versions
 * automatically when they are deployed.
 */
export const SDK_METADATA = {
    changelog: [
        "Implementación del ciclo de vida del SDK (BETA/STABLE/DEPRECATED).",
        "Control de distribución basado en el estado de la versión.",
        "Soporte para promoción manual de versiones en el panel admin.",
        "Mejoras de seguridad en la descarga de paquetes."
    ],
    author: 'MinReport Dev Team',
    releaseDate: new Date(),
    status: 'BETA' as const
};
