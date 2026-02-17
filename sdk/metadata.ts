/**
 * SDK_METADATA - Source of truth for the current SDK version details.
 * This metadata is used by the Auto-Discovery system to register new versions
 * automatically when they are deployed.
 */
export const SDK_METADATA = {
    changelog: [
<<<<<<< Updated upstream
    "## [2.0.0] - 2026-02-05",
    "emoved global `MinReport.Data` access. Plugins must now use injected `context.storage`.- R",
    "eContext](cci:2://file:///Volumes/CODE/MINREPORT%20iMac/minreport/_plugins/stockpile-control/src/lib/minreport-sdk-mock.ts:10:0-16:1).- Updated `PluginLifeCycle.onInit` signature to require [Secur",
    "Implemented [SecureContext](cci:2://file:///Volumes/CODE/MINREPORT%20iMac/minreport/_plugins/stockpile-control/src/lib/minreport-sdk-mock.ts:10:0-16:1) architecture for strict plugin isolation.-",
    "ed [SecureContextFactory](cci:2://file:///Volumes/CODE/MINREPORT%20iMac/minreport/web/src/core/SecureContextFactory.ts:17:0-113:1) to enforce scoped writes to `extensions.{pluginId}`.- Add",
    "ability-Based Access Control logic in the SDK.- Introduced Cap"
],
=======
        "Major SDK release with enhanced core functionality.",
        "Version Jump: v1.0.7 -> v2.0.0",
        "Trace ID: 1770334583101"
    ],
>>>>>>> Stashed changes
    author: 'MinReport Automation',
    releaseDate: new Date(),
    status: 'BETA' as const
};
