export type MinReportReleaseStage = 'DEV_PRIVATE' | 'FULL';

export type DevStageModuleId = 'geolapp' | 'stockpile' | 'opermaq' | 'supply' | 'hr';

const VALID_DEV_STAGE_MODULES: ReadonlySet<string> = new Set<DevStageModuleId>([
    'geolapp',
    'stockpile',
    'opermaq',
    'supply',
    'hr',
]);

export function getReleaseStage(): MinReportReleaseStage {
    const raw = String(import.meta.env.VITE_RELEASE_STAGE || 'FULL')
        .trim()
        .toUpperCase();
    return raw === 'DEV_PRIVATE' ? 'DEV_PRIVATE' : 'FULL';
}

export function isDevPrivateReleaseStage(): boolean {
    return getReleaseStage() === 'DEV_PRIVATE';
}

export function parseDevModulesCsv(rawCsv?: string): DevStageModuleId[] {
    const raw = String(rawCsv ?? import.meta.env.VITE_DEV_MODULES ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return [];
    const unique = new Set<DevStageModuleId>();
    for (const part of raw.split(',')) {
        const token = part.trim();
        if (VALID_DEV_STAGE_MODULES.has(token)) {
            unique.add(token as DevStageModuleId);
        }
    }
    return Array.from(unique);
}

export function isDevModuleEnabled(moduleId: DevStageModuleId, rawCsv?: string): boolean {
    const modules = parseDevModulesCsv(rawCsv);
    if (modules.length === 0) {
        return moduleId !== 'hr';
    }
    if (moduleId === 'geolapp' || moduleId === 'stockpile') {
        return modules.includes('geolapp') || modules.includes('stockpile');
    }
    return modules.includes(moduleId);
}

export function isGeolappOnlyDevStage(rawCsv?: string): boolean {
    const modules = parseDevModulesCsv(rawCsv);
    return modules.length > 0 && modules.every((m) => m === 'geolapp' || m === 'stockpile');
}
