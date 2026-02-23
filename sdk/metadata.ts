/**
 * SDK_METADATA - Source of truth for the current SDK version details.
 * This metadata is used by the Auto-Discovery system to register new versions
 * automatically when they are deployed.
 */
export const SDK_METADATA = {
    version: '2.0.1',
    changelog: [
    "Automated maintenance release.",
    "Source Bump: v2.0.0 -> v2.0.1",
    "Trace ID: 1771872982212"
],
    author: 'MinReport Automation',
    releaseDate: new Date(),
    status: 'BETA' as const
};
