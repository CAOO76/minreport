/**
 * SDK_METADATA - Source of truth for the current SDK version details.
 * This metadata is used by the Auto-Discovery system to register new versions
 * automatically when they are deployed.
 */
export const SDK_METADATA = {
    version: '2.2.1',
    changelog: [
    "Sincronización Monorepo: Versión unificada v2.2.1 para todo el ecosistema MINREPORT.",
    "Mantenimiento: Optimización de tipos y cumplimiento estricto de seguridad autocomplete='off'."
],
    author: 'MinReport Automation',
    releaseDate: new Date(),
    status: 'BETA' as const
};
