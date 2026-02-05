/**
 * SDK_METADATA - Source of truth for the current SDK version details.
 * This metadata is used by the Auto-Discovery system to register new versions
 * automatically when they are deployed.
 */
export const SDK_METADATA = {
    changelog: [
    "Plugins tests"
],
    author: 'MinReport Automation',
    releaseDate: new Date(),
    status: 'BETA' as const
};
