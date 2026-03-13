/**
 * SDK_METADATA - Source of truth for the current SDK version details.
 * This metadata is used by the Auto-Discovery system to register new versions
 * automatically when they are deployed.
 */
export const SDK_METADATA = {
    version: '2.1.0',
    changelog: [
    "Elite Industrial Minimalism UI Refresh.",
    "Added SDKSwitch, SDKBadge, SDKMetric, and SDKIcon.",
    "Extended manifest for Marketplace and Third-party support.",
    "Enforced Atkinson Hyperlegible and rounded-none geometry."
],
    author: 'MinReport Engineering',
    releaseDate: new Date(),
    status: 'PRODUCTION-READY' as const
};
