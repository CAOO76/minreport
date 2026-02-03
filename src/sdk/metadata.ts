/**
 * SDK_METADATA - Source of truth for the current SDK version details.
 * This metadata is used by the Auto-Discovery system to register new versions
 * automatically when they are deployed.
 */
export const SDK_METADATA = {
    changelog: [
    "Automated maintenance release.",
    "Source Bump: v1.0.0 -> v1.0.1",
    "Trace ID: 1770143450292"
],
    author: 'MinReport Automation',
    releaseDate: new Date(),
    status: 'BETA' as const
};
