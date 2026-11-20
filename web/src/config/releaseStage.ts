export type MinReportReleaseStage = 'DEV_PRIVATE' | 'FULL';

export function getReleaseStage(): MinReportReleaseStage {
    const raw = String(import.meta.env.VITE_RELEASE_STAGE || 'FULL')
        .trim()
        .toUpperCase();
    return raw === 'DEV_PRIVATE' ? 'DEV_PRIVATE' : 'FULL';
}

export function isDevPrivateReleaseStage(): boolean {
    return getReleaseStage() === 'DEV_PRIVATE';
}

export function isGeolappOnlyDevStage(): boolean {
    const raw = String(import.meta.env.VITE_DEV_MODULES || '')
        .trim()
        .toLowerCase();
    return raw === 'geolapp' || raw === 'stockpile';
}
