/**
 * SDK_METADATA - Source of truth for the current SDK version details.
 * This metadata is used by the Auto-Discovery system to register new versions
 * automatically when they are deployed.
 */
export const SDK_METADATA = {
    changelog: [
        "Automated maintenance release.",
        "Source Bump: v1.0.3 -> v1.0.4",
        "Trace ID: 1738785581000"
    ],
    author: 'MinReport Automation',
    releaseDate: new Date("2026-02-05T20:00:00Z"),
    status: 'BETA' as const
};
