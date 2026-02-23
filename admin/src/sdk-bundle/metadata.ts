/**
 * SDK_METADATA - Source of truth for the current SDK version details.
 * This metadata is used by the Auto-Discovery system to register new versions
 * automatically when they are deployed.
 */
export const SDK_METADATA = {
    version: '2.0.0',
    changelog: [
        "## [2.0.0] - 2026-02-05",
        "Major SDK release with enhanced core functionality.",
        "Removed global `MinReport.Data` access. Plugins must now use injected `context.storage`.",
        "Updated `PluginLifeCycle.onInit` signature to require SecureContext.",
        "Implemented SecureContext architecture for strict plugin isolation.",
        "Introduced Capability-Based Access Control logic in the SDK.",
        "Trace ID: 1770334583101"
    ],
    author: 'MinReport Automation',
    releaseDate: new Date(),
    status: 'BETA' as const
};

