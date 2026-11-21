import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../config/firebase';
import { AuditLedger } from '../../core/audit-ledger';
import { safeFetchExternal, type SafeFetchOptions } from '../../utils/ssrfGuard';

export const OFFICIAL_ARCORE_DEVICES_URL = 'https://developers.google.com/ar/devices';
export const GOOGLE_PLAY_DEVICE_CATALOG_URL = 'https://play.google.com/console/device-catalog';
export const SPATIAL_CATALOG_COLLECTION = 'system_config';
export const SPATIAL_CATALOG_DOC_ID = 'spatial_device_catalog';

const CACHE_TTL_MS = 5 * 60 * 1000;
export const CATALOG_AUTO_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CATALOG_AUTO_REFRESH_ERROR_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MIN_REMOTE_ARCORE_DEVICES = 100;
const MIN_CSV_DEVICE_ROWS = 10;

export type SpatialDeviceTier = 'OPTIMAL_SPATIAL' | 'COMPATIBLE_VIO' | 'INCOMPATIBLE';

export interface SpatialDeviceEntry {
    id: string;
    manufacturer: string;
    model: string;
    deviceCode?: string;
    platform: 'ANDROID' | 'IOS';
    arSupported: boolean;
    depthSupported: boolean;
    lidarSupported: boolean;
    rugged: boolean;
    ruggedRating?: string;
    tier: SpatialDeviceTier;
    notes?: string;
}

export interface SpatialDeviceCatalog {
    updatedAt: number;
    updatedAtIso: string;
    source: string;
    sourceUrl: string;
    sourceHash: string;
    totalCount: number;
    optimalCount: number;
    vioCount: number;
    ruggedCount: number;
    devices: SpatialDeviceEntry[];
}

export const SpatialDeviceTierSchema = z.enum([
    'OPTIMAL_SPATIAL',
    'COMPATIBLE_VIO',
    'INCOMPATIBLE',
]);

export const SpatialDeviceEntrySchema: z.ZodType<SpatialDeviceEntry> = z.object({
    id: z.string().trim().min(1).max(180),
    manufacturer: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(200),
    deviceCode: z.string().trim().min(1).max(120).optional(),
    platform: z.enum(['ANDROID', 'IOS']),
    arSupported: z.boolean(),
    depthSupported: z.boolean(),
    lidarSupported: z.boolean(),
    rugged: z.boolean(),
    ruggedRating: z.string().trim().min(1).max(120).optional(),
    tier: SpatialDeviceTierSchema,
    notes: z.string().trim().max(500).optional(),
});

export const SpatialDeviceCatalogSchema: z.ZodType<SpatialDeviceCatalog> = z.object({
    updatedAt: z.number().int().nonnegative(),
    updatedAtIso: z.string().trim().min(1).max(64),
    source: z.string().trim().min(1).max(160),
    sourceUrl: z.string().trim().min(1).max(512),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    totalCount: z.number().int().nonnegative(),
    optimalCount: z.number().int().nonnegative(),
    vioCount: z.number().int().nonnegative(),
    ruggedCount: z.number().int().nonnegative(),
    devices: z.array(SpatialDeviceEntrySchema),
});

export interface SpatialCatalogActor {
    uid: string;
    email?: string;
    tenantId?: string;
    ipAddress?: string;
}

export interface SpatialCatalogSyncResult {
    syncedFromRemote: boolean;
    fallbackUsed: boolean;
    warning?: string;
    catalog: SpatialDeviceCatalog;
}

export interface SpatialCatalogCsvImportResult {
    catalog: SpatialDeviceCatalog;
    importedCount: number;
}

export class SpatialCatalogValidationError extends Error {
    public readonly statusCode = 400;

    constructor(message: string) {
        super(message);
        this.name = 'SpatialCatalogValidationError';
    }
}

function slugifyToken(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function buildDeviceId(
    platform: 'ANDROID' | 'IOS',
    manufacturer: string,
    model: string
): string {
    const mfgSlug = slugifyToken(manufacturer) || 'oem';
    const modelSlug = slugifyToken(model) || 'device';
    return `${platform.toLowerCase()}-${mfgSlug}-${modelSlug}`.slice(0, 180);
}

function canonicalCompactKey(
    platform: 'ANDROID' | 'IOS',
    manufacturer: string,
    model: string
): string {
    const mfg = slugifyToken(manufacturer).replace(/-/g, '');
    let mdl = slugifyToken(model).replace(/-/g, '');
    if (mfg && mdl.startsWith(mfg) && mdl.length > mfg.length) {
        mdl = mdl.slice(mfg.length);
    }
    return `${platform}:${mfg}:${mdl}`;
}

function createBaselineEntry(
    entry: Omit<SpatialDeviceEntry, 'id'> & { id?: string }
): SpatialDeviceEntry {
    const clean: SpatialDeviceEntry = {
        id: entry.id || buildDeviceId(entry.platform, entry.manufacturer, entry.model),
        manufacturer: entry.manufacturer,
        model: entry.model,
        platform: entry.platform,
        arSupported: entry.arSupported,
        depthSupported: entry.depthSupported,
        lidarSupported: entry.lidarSupported,
        rugged: entry.rugged,
        tier: entry.tier,
    };
    if (entry.deviceCode) clean.deviceCode = entry.deviceCode;
    if (entry.ruggedRating) clean.ruggedRating = entry.ruggedRating;
    if (entry.notes) clean.notes = entry.notes;
    return clean;
}

/**
 * Catálogo base verificado de equipos industriales/rugerizados, flagships ARCore Depth,
 * gama Apple LiDAR (iPhone 12 Pro..16 Pro Max) y referencias incompatibles sin giroscopio/ARCore.
 */
export const CURATED_RUGGED_BASELINE: SpatialDeviceEntry[] = [
    createBaselineEntry({
        manufacturer: 'Samsung',
        model: 'Galaxy XCover 7',
        deviceCode: 'SM-G556B',
        platform: 'ANDROID',
        arSupported: true,
        depthSupported: true,
        lidarSupported: false,
        rugged: true,
        ruggedRating: 'IP68 · MIL-STD-810H',
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Equipo rugerizado de faena verificado con Google ARCore y Depth API.',
    }),
    createBaselineEntry({
        manufacturer: 'Samsung',
        model: 'Galaxy XCover 6 Pro',
        deviceCode: 'SM-G736B',
        platform: 'ANDROID',
        arSupported: true,
        depthSupported: true,
        lidarSupported: false,
        rugged: true,
        ruggedRating: 'IP68 · MIL-STD-810H',
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Equipo rugerizado verificado con Google ARCore y Depth API.',
    }),
    createBaselineEntry({
        manufacturer: 'Samsung',
        model: 'Galaxy Tab Active 5',
        deviceCode: 'SM-X306B',
        platform: 'ANDROID',
        arSupported: true,
        depthSupported: true,
        lidarSupported: false,
        rugged: true,
        ruggedRating: 'IP68 · MIL-STD-810H',
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Tablet rugerizada de faena con Google ARCore y Depth API.',
    }),
    createBaselineEntry({
        manufacturer: 'Samsung',
        model: 'Galaxy XCover Pro',
        deviceCode: 'SM-G715F',
        platform: 'ANDROID',
        arSupported: true,
        depthSupported: false,
        lidarSupported: false,
        rugged: true,
        ruggedRating: 'IP68 · MIL-STD-810G',
        tier: 'COMPATIBLE_VIO',
        notes: 'Equipo rugerizado con ARCore VIO sin soporte Depth API.',
    }),
    createBaselineEntry({
        manufacturer: 'CAT',
        model: 'CAT S75',
        deviceCode: 'S75',
        platform: 'ANDROID',
        arSupported: true,
        depthSupported: true,
        lidarSupported: false,
        rugged: true,
        ruggedRating: 'IP68 · IP69K · MIL-STD-810H',
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Smartphone rugerizado de mineria compatible con ARCore Depth API.',
    }),
    createBaselineEntry({
        manufacturer: 'CAT',
        model: 'CAT S62 Pro',
        deviceCode: 'S62 Pro',
        platform: 'ANDROID',
        arSupported: true,
        depthSupported: false,
        lidarSupported: false,
        rugged: true,
        ruggedRating: 'IP68 · MIL-STD-810H',
        tier: 'COMPATIBLE_VIO',
        notes: 'Equipo rugerizado compatible con ARCore VIO.',
    }),
    createBaselineEntry({
        manufacturer: 'Samsung',
        model: 'Galaxy S24 Ultra',
        deviceCode: 'SM-S928B',
        platform: 'ANDROID',
        arSupported: true,
        depthSupported: true,
        lidarSupported: false,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Supports Depth API.',
    }),
    createBaselineEntry({
        manufacturer: 'Samsung',
        model: 'Galaxy S25 Ultra',
        deviceCode: 'SM-S938B',
        platform: 'ANDROID',
        arSupported: true,
        depthSupported: true,
        lidarSupported: false,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Supports Depth API.',
    }),
    createBaselineEntry({
        manufacturer: 'Google',
        model: 'Pixel 8 Pro',
        deviceCode: 'husky',
        platform: 'ANDROID',
        arSupported: true,
        depthSupported: true,
        lidarSupported: false,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Supports Depth API.',
    }),
    createBaselineEntry({
        manufacturer: 'Google',
        model: 'Pixel 9 Pro',
        deviceCode: 'caiman',
        platform: 'ANDROID',
        arSupported: true,
        depthSupported: true,
        lidarSupported: false,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Supports Depth API.',
    }),
    createBaselineEntry({
        manufacturer: 'Apple',
        model: 'iPhone 12 Pro',
        deviceCode: 'iPhone13,3',
        platform: 'IOS',
        arSupported: true,
        depthSupported: true,
        lidarSupported: true,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Apple ARKit + escaner LiDAR hardware.',
    }),
    createBaselineEntry({
        manufacturer: 'Apple',
        model: 'iPhone 12 Pro Max',
        deviceCode: 'iPhone13,4',
        platform: 'IOS',
        arSupported: true,
        depthSupported: true,
        lidarSupported: true,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Apple ARKit + escaner LiDAR hardware.',
    }),
    createBaselineEntry({
        manufacturer: 'Apple',
        model: 'iPhone 13 Pro',
        deviceCode: 'iPhone14,2',
        platform: 'IOS',
        arSupported: true,
        depthSupported: true,
        lidarSupported: true,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Apple ARKit + escaner LiDAR hardware.',
    }),
    createBaselineEntry({
        manufacturer: 'Apple',
        model: 'iPhone 13 Pro Max',
        deviceCode: 'iPhone14,3',
        platform: 'IOS',
        arSupported: true,
        depthSupported: true,
        lidarSupported: true,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Apple ARKit + escaner LiDAR hardware.',
    }),
    createBaselineEntry({
        manufacturer: 'Apple',
        model: 'iPhone 14 Pro',
        deviceCode: 'iPhone15,2',
        platform: 'IOS',
        arSupported: true,
        depthSupported: true,
        lidarSupported: true,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Apple ARKit + escaner LiDAR hardware.',
    }),
    createBaselineEntry({
        manufacturer: 'Apple',
        model: 'iPhone 14 Pro Max',
        deviceCode: 'iPhone15,3',
        platform: 'IOS',
        arSupported: true,
        depthSupported: true,
        lidarSupported: true,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Apple ARKit + escaner LiDAR hardware.',
    }),
    createBaselineEntry({
        manufacturer: 'Apple',
        model: 'iPhone 15 Pro',
        deviceCode: 'iPhone16,1',
        platform: 'IOS',
        arSupported: true,
        depthSupported: true,
        lidarSupported: true,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Apple ARKit + escaner LiDAR hardware.',
    }),
    createBaselineEntry({
        manufacturer: 'Apple',
        model: 'iPhone 15 Pro Max',
        deviceCode: 'iPhone16,2',
        platform: 'IOS',
        arSupported: true,
        depthSupported: true,
        lidarSupported: true,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Apple ARKit + escaner LiDAR hardware.',
    }),
    createBaselineEntry({
        manufacturer: 'Apple',
        model: 'iPhone 16 Pro',
        deviceCode: 'iPhone17,1',
        platform: 'IOS',
        arSupported: true,
        depthSupported: true,
        lidarSupported: true,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Apple ARKit + escaner LiDAR hardware.',
    }),
    createBaselineEntry({
        manufacturer: 'Apple',
        model: 'iPhone 16 Pro Max',
        deviceCode: 'iPhone17,2',
        platform: 'IOS',
        arSupported: true,
        depthSupported: true,
        lidarSupported: true,
        rugged: false,
        tier: 'OPTIMAL_SPATIAL',
        notes: 'Apple ARKit + escaner LiDAR hardware.',
    }),
    createBaselineEntry({
        manufacturer: 'Apple',
        model: 'iPhone 15',
        deviceCode: 'iPhone15,4',
        platform: 'IOS',
        arSupported: true,
        depthSupported: false,
        lidarSupported: false,
        rugged: false,
        tier: 'COMPATIBLE_VIO',
        notes: 'Apple ARKit VIO sin sensor LiDAR dedicado.',
    }),
    createBaselineEntry({
        manufacturer: 'Samsung',
        model: 'Galaxy A04e',
        deviceCode: 'SM-A042M',
        platform: 'ANDROID',
        arSupported: false,
        depthSupported: false,
        lidarSupported: false,
        rugged: false,
        tier: 'INCOMPATIBLE',
        notes: 'Referencia gama baja sin giroscopio hardware ni certificacion Google ARCore.',
    }),
    createBaselineEntry({
        manufacturer: 'Xiaomi',
        model: 'Redmi A2',
        deviceCode: '23028RN4DG',
        platform: 'ANDROID',
        arSupported: false,
        depthSupported: false,
        lidarSupported: false,
        rugged: false,
        tier: 'INCOMPATIBLE',
        notes: 'Referencia gama baja sin giroscopio hardware ni soporte ARCore.',
    }),
    createBaselineEntry({
        manufacturer: 'Motorola',
        model: 'Moto E13',
        deviceCode: 'XT2345-3',
        platform: 'ANDROID',
        arSupported: false,
        depthSupported: false,
        lidarSupported: false,
        rugged: false,
        tier: 'INCOMPATIBLE',
        notes: 'Referencia gama baja sin giroscopio ni soporte Google ARCore.',
    }),
];

const BASELINE_BY_CANONICAL_KEY = new Map<string, SpatialDeviceEntry>();
const BASELINE_BY_CODE = new Map<string, SpatialDeviceEntry>();

for (const item of CURATED_RUGGED_BASELINE) {
    BASELINE_BY_CANONICAL_KEY.set(
        canonicalCompactKey(item.platform, item.manufacturer, item.model),
        item
    );
    if (item.deviceCode) {
        BASELINE_BY_CODE.set(item.deviceCode.trim().toUpperCase(), item);
    }
}

function findBaselineMatch(
    platform: 'ANDROID' | 'IOS',
    manufacturer: string,
    model: string,
    deviceCode?: string
): SpatialDeviceEntry | undefined {
    const key = canonicalCompactKey(platform, manufacturer, model);
    const byKey = BASELINE_BY_CANONICAL_KEY.get(key);
    if (byKey) return byKey;

    if (deviceCode) {
        for (const token of deviceCode.split(/[,;/\s]+/)) {
            const cleaned = token.trim().toUpperCase();
            if (!cleaned) continue;
            const byCode = BASELINE_BY_CODE.get(cleaned);
            if (byCode) return byCode;
        }
    }
    return undefined;
}

function detectRuggedClassification(
    manufacturer: string,
    model: string,
    notes?: string
): { rugged: boolean; ruggedRating?: string } {
    const mfg = manufacturer.trim();
    const mdl = model.trim();
    const combined = `${mfg} ${mdl} ${notes || ''}`;

    const ratingMatch = combined.match(/\b(IP6[89]K?(?:\s*[·•/]\s*MIL-STD-810[GH])?|MIL-STD-810[GH])\b/i);
    const explicitRating = ratingMatch ? ratingMatch[1].toUpperCase().replace(/\s+/g, ' ') : undefined;

    if (/xcover/i.test(mdl) || /tab\s*active/i.test(mdl)) {
        return { rugged: true, ruggedRating: explicitRating || 'IP68 · MIL-STD-810H' };
    }
    if (
        /^(?:cat|caterpillar)$/i.test(mfg) ||
        /\bcat\s*s\d{2}\b/i.test(mdl) ||
        /\bs(?:42|52|53|61|62|75)\b/i.test(mdl) && /cat|caterpillar/i.test(combined)
    ) {
        return {
            rugged: true,
            ruggedRating: explicitRating || (/s75/i.test(mdl) ? 'IP68 · IP69K · MIL-STD-810H' : 'IP68 · MIL-STD-810H'),
        };
    }
    if (
        (/^doogee$/i.test(mfg) && /\b[vs]\d+/i.test(mdl)) ||
        /\bdoogee\s*[vs]\d+/i.test(combined)
    ) {
        return { rugged: true, ruggedRating: explicitRating || 'IP68 · IP69K · MIL-STD-810H' };
    }
    if (
        /^ulefone$/i.test(mfg) ||
        /\barmor\s*(?:x?\d+|mini|pad)/i.test(mdl) ||
        /\bulefone\s+armor\b/i.test(combined)
    ) {
        return { rugged: true, ruggedRating: explicitRating || 'IP68 · IP69K · MIL-STD-810H' };
    }
    if (
        (/^oukitel$/i.test(mfg) && /\bwp\d+/i.test(mdl)) ||
        /\boukitel\s*wp\d+/i.test(combined)
    ) {
        return { rugged: true, ruggedRating: explicitRating || 'IP68 · IP69K · MIL-STD-810H' };
    }
    if (
        (/^kyocera$/i.test(mfg) && /dura/i.test(mdl)) ||
        /\bkyocera\s+dura/i.test(combined)
    ) {
        return { rugged: true, ruggedRating: explicitRating || 'IP68 · MIL-STD-810H' };
    }
    if (
        (/^sonim$/i.test(mfg) && /\bxp\d+/i.test(mdl)) ||
        /\bsonim\s*xp\d+/i.test(combined)
    ) {
        return { rugged: true, ruggedRating: explicitRating || 'IP68 · IP69 · MIL-STD-810H' };
    }
    if (
        /\bnokia\s*xr\d+/i.test(combined) ||
        (/^(?:nokia|hmd)$/i.test(mfg) && /\bxr\d+/i.test(mdl)) ||
        /^(?:crosscall|zebra|honeywell|agm|fossibot|hotwav)$/i.test(mfg) ||
        (/\bblackview$/i.test(mfg) && /\b(?:bv|bl)\d+/i.test(mdl)) ||
        /\bkingkong\b/i.test(mdl) ||
        /\bunihertz\s*tank\b/i.test(combined) ||
        /\b(?:rugged|mil-std-810[gh]?|ip6[89]k?)\b/i.test(combined)
    ) {
        return { rugged: true, ruggedRating: explicitRating || 'IP68 · MIL-STD-810H' };
    }

    return { rugged: false };
}

function decodeHtmlEntities(raw: string): string {
    const named: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&nbsp;': ' ',
        '&ndash;': '-',
        '&mdash;': '-',
        '&middot;': '·',
    };
    return raw
        .replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash|middot|#39);/gi, (m) => named[m.toLowerCase()] || m)
        .replace(/&#(\d+);/g, (_, dec) => {
            const code = Number.parseInt(dec, 10);
            return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
        })
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
            const code = Number.parseInt(hex, 16);
            return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
        });
}

function cleanHtmlCellText(cellHtml: string): string {
    const withLineBreaks = cellHtml.replace(/<br\s*\/?>/gi, ' ');
    const stripped = withLineBreaks.replace(/<[^>]+>/g, ' ');
    return decodeHtmlEntities(stripped).replace(/\s+/g, ' ').trim();
}

function extractModelAndCode(rawModel: string, comments: string): {
    model: string;
    deviceCode?: string;
} {
    let model = rawModel.trim();
    let deviceCode: string | undefined;

    // Captura códigos entre paréntesis al final o embebidos (ej. "Galaxy XCover 7 (SM-G556B)")
    const parenMatches = [...model.matchAll(/\(([^()]{2,80})\)/g)];
    for (let i = parenMatches.length - 1; i >= 0; i--) {
        const match = parenMatches[i];
        const inner = match[1].trim();
        const isYearOnly = /^\d{4}$/.test(inner);
        const looksLikeCode =
            !isYearOnly &&
            (/\d/.test(inner) || /^[A-Z0-9][A-Z0-9_/-]{1,20}(?:\s*[,;/]\s*[A-Z0-9][A-Z0-9_/-]{1,20})*$/i.test(inner)) &&
            !/\b(edition|model|models|only|china|global|except|excluding|version|series|gen)\b/i.test(inner);

        if (looksLikeCode) {
            if (!deviceCode) {
                deviceCode = inner.slice(0, 120);
            }
            const before = model.slice(0, match.index).trim();
            const after = model.slice((match.index || 0) + match[0].length).trim();
            const remaining = [before, after].filter(Boolean).join(' ').trim();
            if (remaining.length > 0) {
                model = remaining;
            }
        }
    }

    if (!deviceCode && comments) {
        const noteCodeMatch = comments.match(
            /\b((?:SM-[A-Z0-9]{4,8}|XT\d{4}(?:-\d+)?|CPH\d{4}|XQ-[A-Z0-9]{4,6}|SCG\d{2}|SC-\d{2}[A-Z]|2\d{3}[A-Z0-9]{4,8}|iPhone\d{2},\d))\b/
        );
        if (noteCodeMatch) {
            deviceCode = noteCodeMatch[1];
        }
    }

    return {
        model: model.replace(/\s+/g, ' ').trim(),
        deviceCode,
    };
}

function inferPlatform(manufacturer: string, model: string): 'ANDROID' | 'IOS' {
    if (
        /^apple$/i.test(manufacturer.trim()) ||
        /^(?:iphone|ipad)\b/i.test(model.trim())
    ) {
        return 'IOS';
    }
    return 'ANDROID';
}

function enrichEntryWithBaselineAndRugged(entry: SpatialDeviceEntry): SpatialDeviceEntry {
    const baseline = findBaselineMatch(
        entry.platform,
        entry.manufacturer,
        entry.model,
        entry.deviceCode
    );
    const ruggedInfo = detectRuggedClassification(
        entry.manufacturer,
        entry.model,
        entry.notes
    );

    const rugged = entry.rugged || Boolean(baseline?.rugged) || ruggedInfo.rugged;
    const ruggedRating =
        entry.ruggedRating || baseline?.ruggedRating || (rugged ? ruggedInfo.ruggedRating : undefined);
    const deviceCode = entry.deviceCode || baseline?.deviceCode;
    const depthSupported = entry.depthSupported || Boolean(baseline?.depthSupported);
    const lidarSupported = entry.lidarSupported || Boolean(baseline?.lidarSupported);
    const arSupported = entry.arSupported;

    const tier: SpatialDeviceTier = !arSupported
        ? 'INCOMPATIBLE'
        : depthSupported || lidarSupported
          ? 'OPTIMAL_SPATIAL'
          : 'COMPATIBLE_VIO';

    const out: SpatialDeviceEntry = {
        id: buildDeviceId(entry.platform, entry.manufacturer, entry.model),
        manufacturer: entry.manufacturer,
        model: entry.model,
        platform: entry.platform,
        arSupported,
        depthSupported,
        lidarSupported,
        rugged,
        tier,
    };
    if (deviceCode) out.deviceCode = deviceCode;
    if (ruggedRating) out.ruggedRating = ruggedRating;
    if (entry.notes || baseline?.notes) {
        out.notes = (entry.notes || baseline?.notes || '').slice(0, 500);
    }
    return out;
}

/**
 * Parser puro y determinista de las tablas HTML oficiales de Google ARCore
 * (`https://developers.google.com/ar/devices`), con soporte para `rowspan`,
 * detección de `"Supports Depth API"` (`OPTIMAL_SPATIAL` vs `COMPATIBLE_VIO`),
 * extracción de códigos entre paréntesis/notas y enriquecimiento de familia rugged.
 */
export function parseOfficialArCoreDevicesHtml(html: string): SpatialDeviceEntry[] {
    if (!html || typeof html !== 'string') return [];

    const sanitizedHtml = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

    const tables = sanitizedHtml.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
    const results = new Map<string, SpatialDeviceEntry>();

    for (const tableHtml of tables) {
        const rows = tableHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
        if (rows.length === 0) continue;

        let manufacturerCol = 0;
        let modelCol = 1;
        let commentsCol = 2;
        let headerDetected = false;
        let lastManufacturer = '';
        const pendingRowSpans: Array<{ text: string; remaining: number } | null> = [];

        for (const rowHtml of rows) {
            const cellMatches = [
                ...rowHtml.matchAll(/<(t[hd])\b([^>]*)>([\s\S]*?)<\/\1>/gi),
            ];
            if (cellMatches.length === 0) continue;

            const isHeaderRow =
                cellMatches.every((m) => m[1].toLowerCase() === 'th') ||
                (cellMatches.some((m) => m[1].toLowerCase() === 'th') && !headerDetected);

            if (isHeaderRow) {
                const headers = cellMatches.map((m) => cleanHtmlCellText(m[3]).toLowerCase());
                const mIdx = headers.findIndex((h) =>
                    /\b(manufacturer|brand|oem|vendor|fabricante)\b/.test(h)
                );
                const dIdx = headers.findIndex((h) =>
                    /\b(device\s*model|model|device|modelo)\b/.test(h)
                );
                const cIdx = headers.findIndex((h) =>
                    /\b(comments?|notes?|features?|support|observaciones|notas)\b/.test(h)
                );

                if (mIdx === -1 && dIdx === -1) {
                    // Tabla no corresponde a dispositivos (ej. tabla informativa)
                    manufacturerCol = -1;
                    modelCol = -1;
                    continue;
                }

                manufacturerCol = mIdx >= 0 ? mIdx : 0;
                modelCol = dIdx >= 0 ? dIdx : mIdx === 0 ? 1 : 0;
                commentsCol = cIdx >= 0 ? cIdx : Math.max(manufacturerCol, modelCol) + 1;
                headerDetected = true;
                pendingRowSpans.length = 0;
                continue;
            }

            if (manufacturerCol < 0 || modelCol < 0) continue;

            // Resolver columnas visuales considerando rowspan de filas previas
            const rowValues: string[] = [];
            let cellCursor = 0;
            let visualCol = 0;

            while (cellCursor < cellMatches.length || visualCol < pendingRowSpans.length) {
                const activeSpan = pendingRowSpans[visualCol];
                if (activeSpan && activeSpan.remaining > 0) {
                    rowValues[visualCol] = activeSpan.text;
                    activeSpan.remaining -= 1;
                    if (activeSpan.remaining <= 0) {
                        pendingRowSpans[visualCol] = null;
                    }
                    visualCol += 1;
                    continue;
                }

                if (cellCursor >= cellMatches.length) {
                    visualCol += 1;
                    continue;
                }

                const cell = cellMatches[cellCursor++];
                const attrs = cell[2] || '';
                const text = cleanHtmlCellText(cell[3]);
                const rowspanMatch = attrs.match(/\browspan\s*=\s*["']?(\d+)/i);
                const colspanMatch = attrs.match(/\bcolspan\s*=\s*["']?(\d+)/i);
                const rowspan = rowspanMatch ? Math.max(1, Number.parseInt(rowspanMatch[1], 10)) : 1;
                const colspan = colspanMatch ? Math.max(1, Number.parseInt(colspanMatch[1], 10)) : 1;

                for (let spanIdx = 0; spanIdx < colspan; spanIdx++) {
                    rowValues[visualCol] = spanIdx === 0 ? text : '';
                    if (rowspan > 1) {
                        pendingRowSpans[visualCol] = {
                            text: rowValues[visualCol],
                            remaining: rowspan - 1,
                        };
                    }
                    visualCol += 1;
                }
            }

            if (rowValues.length < 2) continue;

            let rawManufacturer = (rowValues[manufacturerCol] || '').trim();
            let rawModel = (rowValues[modelCol] || '').trim();
            let comments = (rowValues[commentsCol] || '').trim();

            // Si omiten columna Manufacturer sin rowspan explícito (2 celdas cuando hay 3 columnas)
            if (rowValues.length === 2 && lastManufacturer && commentsCol >= 2) {
                rawManufacturer = lastManufacturer;
                rawModel = (rowValues[0] || '').trim();
                comments = (rowValues[1] || '').trim();
            } else if (!rawManufacturer && lastManufacturer) {
                rawManufacturer = lastManufacturer;
            }

            if (rawManufacturer) {
                lastManufacturer = rawManufacturer;
            }

            if (!rawManufacturer || !rawModel) continue;

            const { model, deviceCode } = extractModelAndCode(rawModel, comments);
            if (!model) continue;

            const platform = inferPlatform(rawManufacturer, model);
            const lidarSupported = platform === 'IOS' && /\blidar\b/i.test(comments);
            const depthNegated =
                /\b(?:does\s+not\s+support|not\s+support(?:ed)?|without|no\s+support)\b[^.]{0,40}\bdepth\b|\bdepth\s+api\s+(?:not\s+supported|unsupported|unavailable)\b/i.test(
                    comments
                );
            const depthSupported =
                !depthNegated &&
                (/\bsupports?\s+depth\s+api\b/i.test(comments) ||
                    /\braw\s+depth\b/i.test(comments) ||
                    lidarSupported);
            const arNegated =
                /\b(?:arcore\s+(?:not\s+supported|unsupported)|incompatible\s+with\s+arcore|not\s+supported\s+by\s+arcore)\b/i.test(
                    comments
                );
            const arSupported = !arNegated;

            const entry = enrichEntryWithBaselineAndRugged({
                id: buildDeviceId(platform, rawManufacturer, model),
                manufacturer: rawManufacturer,
                model,
                deviceCode,
                platform,
                arSupported,
                depthSupported,
                lidarSupported,
                rugged: false,
                tier: !arSupported
                    ? 'INCOMPATIBLE'
                    : depthSupported || lidarSupported
                      ? 'OPTIMAL_SPATIAL'
                      : 'COMPATIBLE_VIO',
                notes: comments ? comments.slice(0, 500) : undefined,
            });

            const key = canonicalCompactKey(entry.platform, entry.manufacturer, entry.model);
            const existing = results.get(key);
            if (!existing) {
                results.set(key, entry);
            } else {
                results.set(key, mergeDeviceEntries(existing, entry));
            }
        }
    }

    return Array.from(results.values());
}

function parseCsvMatrix(csvText: string): string[][] {
    const normalized = csvText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        const next = normalized[i + 1];

        if (inQuotes) {
            if (ch === '"' && next === '"') {
                currentCell += '"';
                i += 1;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                currentCell += ch;
            }
            continue;
        }

        if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            currentRow.push(currentCell.trim());
            currentCell = '';
        } else if (ch === '\n') {
            currentRow.push(currentCell.trim());
            if (currentRow.some((cell) => cell.length > 0)) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += ch;
        }
    }

    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
    }

    return rows;
}

/**
 * Parsea CSV oficial de Google Play Console Device Catalog
 * (`Retail Branding`, `Marketing Name`, `Device`, `Model Name`).
 */
export function parseGooglePlayDeviceCatalogCsv(csvText: string): SpatialDeviceEntry[] {
    if (!csvText || typeof csvText !== 'string') return [];

    const matrix = parseCsvMatrix(csvText);
    if (matrix.length < 2) return [];

    const headers = matrix[0].map((h) => h.trim().toLowerCase());
    const idxBrand = headers.findIndex((h) =>
        /^(retail\s*branding|manufacturer|brand|oem)$/.test(h)
    );
    const idxMarketing = headers.findIndex((h) =>
        /^(marketing\s*name|device\s*model|model)$/.test(h)
    );
    const idxDevice = headers.findIndex((h) => /^(device|codename)$/.test(h));
    const idxModelCode = headers.findIndex((h) =>
        /^(model\s*name|model\s*code|device\s*code)$/.test(h)
    );
    const idxFormFactor = headers.findIndex((h) => /^form\s*factor$/.test(h));

    if (idxBrand === -1 || (idxMarketing === -1 && idxModelCode === -1 && idxDevice === -1)) {
        return [];
    }

    const dedup = new Map<string, SpatialDeviceEntry>();

    for (let r = 1; r < matrix.length; r++) {
        const row = matrix[r];
        const manufacturer = (row[idxBrand] || '').trim();
        const marketingName = idxMarketing >= 0 ? (row[idxMarketing] || '').trim() : '';
        const codename = idxDevice >= 0 ? (row[idxDevice] || '').trim() : '';
        const modelCode = idxModelCode >= 0 ? (row[idxModelCode] || '').trim() : '';
        const formFactor = idxFormFactor >= 0 ? (row[idxFormFactor] || '').trim() : '';

        if (!manufacturer) continue;

        const rawModel = marketingName || modelCode || codename;
        if (!rawModel) continue;

        const { model, deviceCode: extractedCode } = extractModelAndCode(rawModel, '');
        const resolvedCode = modelCode || extractedCode || codename || undefined;
        const platform = inferPlatform(manufacturer, model);
        const baseline = findBaselineMatch(platform, manufacturer, model, resolvedCode);
        const ruggedInfo = detectRuggedClassification(manufacturer, model, formFactor);

        const isNonHandheld = /\b(tv|wear|automotive|chromebook|watch)\b/i.test(formFactor);
        const arSupported = isNonHandheld ? false : (baseline?.arSupported ?? false);
        const depthSupported = isNonHandheld ? false : (baseline?.depthSupported ?? false);
        const lidarSupported = isNonHandheld ? false : (baseline?.lidarSupported ?? false);
        const rugged = Boolean(baseline?.rugged || ruggedInfo.rugged);
        const ruggedRating = baseline?.ruggedRating || (rugged ? ruggedInfo.ruggedRating : undefined);
        const tier: SpatialDeviceTier = !arSupported
            ? 'INCOMPATIBLE'
            : depthSupported || lidarSupported
              ? 'OPTIMAL_SPATIAL'
              : 'COMPATIBLE_VIO';

        const notesParts: string[] = [];
        if (codename && codename !== resolvedCode) {
            notesParts.push(`codename:${codename}`);
        }
        if (formFactor) {
            notesParts.push(`formFactor:${formFactor}`);
        }
        if (baseline?.notes) {
            notesParts.push(baseline.notes);
        } else if (!arSupported) {
            notesParts.push('Catalogo Google Play Console (sin certificacion ARCore verificada).');
        }

        const entry: SpatialDeviceEntry = {
            id: buildDeviceId(platform, manufacturer, model),
            manufacturer,
            model,
            ...(resolvedCode ? { deviceCode: resolvedCode } : {}),
            platform,
            arSupported,
            depthSupported,
            lidarSupported,
            rugged,
            ...(ruggedRating ? { ruggedRating } : {}),
            tier,
            notes: notesParts.join(' · ').slice(0, 500) || undefined,
        };

        const key = canonicalCompactKey(entry.platform, entry.manufacturer, entry.model);
        const existing = dedup.get(key);
        dedup.set(key, existing ? mergeDeviceEntries(existing, entry) : entry);
    }

    return Array.from(dedup.values());
}

function mergeDeviceEntries(
    base: SpatialDeviceEntry,
    incoming: SpatialDeviceEntry
): SpatialDeviceEntry {
    const arSupported = base.arSupported || incoming.arSupported;
    const depthSupported = base.depthSupported || incoming.depthSupported;
    const lidarSupported = base.lidarSupported || incoming.lidarSupported;
    const rugged = base.rugged || incoming.rugged;
    const tier: SpatialDeviceTier = !arSupported
        ? 'INCOMPATIBLE'
        : depthSupported || lidarSupported
          ? 'OPTIMAL_SPATIAL'
          : 'COMPATIBLE_VIO';

    const deviceCode =
        incoming.deviceCode && base.deviceCode && incoming.deviceCode !== base.deviceCode
            ? base.deviceCode.includes(incoming.deviceCode)
                ? base.deviceCode
                : `${base.deviceCode}, ${incoming.deviceCode}`.slice(0, 120)
            : incoming.deviceCode || base.deviceCode;

    const ruggedRating = base.ruggedRating || incoming.ruggedRating;
    const notes = incoming.notes || base.notes;

    const merged: SpatialDeviceEntry = {
        id: base.id || incoming.id,
        manufacturer: base.manufacturer || incoming.manufacturer,
        model: base.model || incoming.model,
        platform: base.platform,
        arSupported,
        depthSupported,
        lidarSupported,
        rugged,
        tier,
    };
    if (deviceCode) merged.deviceCode = deviceCode;
    if (ruggedRating) merged.ruggedRating = ruggedRating;
    if (notes) merged.notes = notes.slice(0, 500);
    return merged;
}

const TIER_SORT_ORDER: Record<SpatialDeviceTier, number> = {
    OPTIMAL_SPATIAL: 0,
    COMPATIBLE_VIO: 1,
    INCOMPATIBLE: 2,
};

function sortSpatialDevices(devices: SpatialDeviceEntry[]): SpatialDeviceEntry[] {
    return [...devices].sort((a, b) => {
        const tierDiff = TIER_SORT_ORDER[a.tier] - TIER_SORT_ORDER[b.tier];
        if (tierDiff !== 0) return tierDiff;
        if (a.rugged !== b.rugged) return a.rugged ? -1 : 1;
        const mfgDiff = a.manufacturer.localeCompare(b.manufacturer);
        if (mfgDiff !== 0) return mfgDiff;
        return a.model.localeCompare(b.model);
    });
}

function computeCatalogHash(devices: SpatialDeviceEntry[]): string {
    const canonical = devices.map((d) => ({
        id: d.id,
        manufacturer: d.manufacturer,
        model: d.model,
        deviceCode: d.deviceCode || null,
        platform: d.platform,
        arSupported: d.arSupported,
        depthSupported: d.depthSupported,
        lidarSupported: d.lidarSupported,
        rugged: d.rugged,
        tier: d.tier,
    }));
    return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function assembleValidatedCatalog(params: {
    devices: SpatialDeviceEntry[];
    source: string;
    sourceUrl: string;
    updatedAt?: number;
}): SpatialDeviceCatalog {
    const sorted = sortSpatialDevices(params.devices);
    const updatedAt = params.updatedAt ?? Date.now();
    const optimalCount = sorted.filter((d) => d.tier === 'OPTIMAL_SPATIAL').length;
    const vioCount = sorted.filter((d) => d.tier === 'COMPATIBLE_VIO').length;
    const ruggedCount = sorted.filter((d) => d.rugged).length;

    const candidate: SpatialDeviceCatalog = {
        updatedAt,
        updatedAtIso: new Date(updatedAt).toISOString(),
        source: params.source,
        sourceUrl: params.sourceUrl,
        sourceHash: computeCatalogHash(sorted),
        totalCount: sorted.length,
        optimalCount,
        vioCount,
        ruggedCount,
        devices: sorted,
    };

    return SpatialDeviceCatalogSchema.parse(candidate);
}

export function buildBaselineSpatialDeviceCatalog(updatedAt?: number): SpatialDeviceCatalog {
    return assembleValidatedCatalog({
        devices: CURATED_RUGGED_BASELINE.map((d) => ({ ...d })),
        source: 'CURATED_RUGGED_AND_ARKIT_BASELINE',
        sourceUrl: OFFICIAL_ARCORE_DEVICES_URL,
        updatedAt,
    });
}

let inMemoryCatalogCache: {
    catalog: SpatialDeviceCatalog;
    cachedAt: number;
    fromFirestore: boolean;
} | null = null;
let backgroundSyncPromise: Promise<void> | null = null;
let lastAutoRefreshFailureAt = 0;

export function clearSpatialDeviceCatalogCache(): void {
    inMemoryCatalogCache = null;
    backgroundSyncPromise = null;
    lastAutoRefreshFailureAt = 0;
}

export function getPendingCatalogAutoRefresh(): Promise<void> | null {
    return backgroundSyncPromise;
}

async function readValidCatalogFromFirestore(): Promise<SpatialDeviceCatalog | null> {
    try {
        const snap = await db
            .collection(SPATIAL_CATALOG_COLLECTION)
            .doc(SPATIAL_CATALOG_DOC_ID)
            .get();
        if (!snap.exists) return null;
        const parsed = SpatialDeviceCatalogSchema.safeParse(snap.data());
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

function maybeTriggerBackgroundAutoRefresh(params: {
    fromDb: SpatialDeviceCatalog | null;
    allowAutoRefresh?: boolean;
    fetcher?: SpatialCatalogFetcher;
}): void {
    const shouldAutoRefresh = params.allowAutoRefresh ?? process.env.NODE_ENV !== 'test';
    if (!shouldAutoRefresh) return;

    const now = Date.now();
    const isStaleOrMissing =
        !params.fromDb || now - params.fromDb.updatedAt > CATALOG_AUTO_REFRESH_TTL_MS;
    const cooldownElapsed =
        lastAutoRefreshFailureAt === 0 ||
        now - lastAutoRefreshFailureAt >= CATALOG_AUTO_REFRESH_ERROR_COOLDOWN_MS;

    if (!isStaleOrMissing || backgroundSyncPromise || !cooldownElapsed) {
        return;
    }

    backgroundSyncPromise = (async () => {
        try {
            const syncRes = await syncSpatialDeviceCatalogFromOfficialSources(
                {
                    uid: 'system-auto-sync',
                    email: 'system@minreport.com',
                    tenantId: 'global',
                },
                params.fetcher ? { fetcher: params.fetcher } : undefined
            );
            if (syncRes.fallbackUsed) {
                lastAutoRefreshFailureAt = Date.now();
            } else {
                lastAutoRefreshFailureAt = 0;
            }
        } catch {
            lastAutoRefreshFailureAt = Date.now();
        } finally {
            backgroundSyncPromise = null;
        }
    })();
}

/**
 * Obtiene el catálogo vivo de compatibilidad hardware (caché RAM 5 min -> Firestore -> baseline curado),
 * con Stale-While-Revalidate no bloqueante cada 7 días (`CATALOG_AUTO_REFRESH_TTL_MS`).
 */
export async function getSpatialDeviceCatalog(options?: {
    allowAutoRefresh?: boolean;
    fetcher?: SpatialCatalogFetcher;
}): Promise<SpatialDeviceCatalog> {
    const now = Date.now();
    if (inMemoryCatalogCache && now - inMemoryCatalogCache.cachedAt < CACHE_TTL_MS) {
        maybeTriggerBackgroundAutoRefresh({
            fromDb: inMemoryCatalogCache.fromFirestore ? inMemoryCatalogCache.catalog : null,
            allowAutoRefresh: options?.allowAutoRefresh,
            fetcher: options?.fetcher,
        });
        return inMemoryCatalogCache.catalog;
    }

    const fromDb = await readValidCatalogFromFirestore();

    // Si otra petición concurrente completó el refresco mientras leíamos Firestore, devolver caché fresca
    if (inMemoryCatalogCache && Date.now() - inMemoryCatalogCache.cachedAt < CACHE_TTL_MS) {
        return inMemoryCatalogCache.catalog;
    }

    maybeTriggerBackgroundAutoRefresh({
        fromDb,
        allowAutoRefresh: options?.allowAutoRefresh,
        fetcher: options?.fetcher,
    });

    if (fromDb) {
        inMemoryCatalogCache = { catalog: fromDb, cachedAt: Date.now(), fromFirestore: true };
        return fromDb;
    }

    const baseline = buildBaselineSpatialDeviceCatalog(Date.now());
    inMemoryCatalogCache = { catalog: baseline, cachedAt: Date.now(), fromFirestore: false };
    return baseline;
}

export type SpatialCatalogFetcher = (
    url: string,
    options?: SafeFetchOptions
) => Promise<Response>;

/**
 * Sincroniza el catálogo oficial desde `https://developers.google.com/ar/devices` vía `safeFetchExternal`,
 * aplica Guardrail Fail-Closed (< 100 dispositivos o error remoto no sobrescribe Firestore),
 * fusiona Apple ARKit/LiDAR + etiquetas rugged, valida con Zod, persiste en `system_config/spatial_device_catalog`
 * (`southamerica-west1`) y registra en `AuditLedger`.
 */
export async function syncSpatialDeviceCatalogFromOfficialSources(
    actor: SpatialCatalogActor,
    options?: { fetcher?: SpatialCatalogFetcher }
): Promise<SpatialCatalogSyncResult> {
    const fetcher = options?.fetcher ?? safeFetchExternal;
    let parsedRemoteDevices: SpatialDeviceEntry[] = [];
    let remoteFailureReason: string | null = null;

    try {
        const response = await fetcher(OFFICIAL_ARCORE_DEVICES_URL, {
            method: 'GET',
            timeoutMs: 15_000,
            maxBytes: 8 * 1024 * 1024,
            headers: {
                Accept: 'text/html,application/xhtml+xml',
                'User-Agent': 'MINREPORT-SpatialCatalogSync/1.0 (southamerica-west1)',
            },
        });

        if (!response.ok) {
            remoteFailureReason = `Descarga oficial ARCore respondio HTTP ${response.status}.`;
        } else {
            const html = await response.text();
            parsedRemoteDevices = parseOfficialArCoreDevicesHtml(html);
            if (parsedRemoteDevices.length < MIN_REMOTE_ARCORE_DEVICES) {
                remoteFailureReason = `Parser HTML obtuvo ${parsedRemoteDevices.length} dispositivos (< ${MIN_REMOTE_ARCORE_DEVICES} requeridos por guardrail Fail-Closed).`;
            }
        }
    } catch (error: any) {
        remoteFailureReason =
            error?.message || 'Error de red o SSRF descargando catalogo oficial ARCore.';
    }

    if (remoteFailureReason) {
        const existingDbCatalog = await readValidCatalogFromFirestore();
        if (existingDbCatalog) {
            inMemoryCatalogCache = {
                catalog: existingDbCatalog,
                cachedAt: Date.now(),
                fromFirestore: true,
            };
            return {
                syncedFromRemote: false,
                fallbackUsed: true,
                warning: `${remoteFailureReason} Se preserva documento valido existente en Firestore sin sobrescribir.`,
                catalog: existingDbCatalog,
            };
        }

        const baseline = buildBaselineSpatialDeviceCatalog();
        inMemoryCatalogCache = {
            catalog: baseline,
            cachedAt: Date.now(),
            fromFirestore: false,
        };
        return {
            syncedFromRemote: false,
            fallbackUsed: true,
            warning: `${remoteFailureReason} Sin documento previo en Firestore; usando catalogo base curado.`,
            catalog: baseline,
        };
    }

    const mergedMap = new Map<string, SpatialDeviceEntry>();
    for (const remoteEntry of parsedRemoteDevices) {
        const key = canonicalCompactKey(
            remoteEntry.platform,
            remoteEntry.manufacturer,
            remoteEntry.model
        );
        mergedMap.set(key, remoteEntry);
    }

    for (const baselineEntry of CURATED_RUGGED_BASELINE) {
        const key = canonicalCompactKey(
            baselineEntry.platform,
            baselineEntry.manufacturer,
            baselineEntry.model
        );
        const existing = mergedMap.get(key);
        if (existing) {
            mergedMap.set(key, mergeDeviceEntries(baselineEntry, existing));
        } else {
            mergedMap.set(key, { ...baselineEntry });
        }
    }

    const catalog = assembleValidatedCatalog({
        devices: Array.from(mergedMap.values()),
        source: 'GOOGLE_ARCORE_OFFICIAL + APPLE_ARKIT_CURATED',
        sourceUrl: OFFICIAL_ARCORE_DEVICES_URL,
    });

    await db
        .collection(SPATIAL_CATALOG_COLLECTION)
        .doc(SPATIAL_CATALOG_DOC_ID)
        .set(catalog);

    inMemoryCatalogCache = { catalog, cachedAt: Date.now(), fromFirestore: true };

    await AuditLedger.record({
        tenantId: actor.tenantId || 'global',
        actorUid: actor.uid,
        actorEmail: actor.email || actor.uid,
        action: 'SPATIAL_DEVICE_CATALOG_SYNC',
        module: 'stockpile',
        targetEntity: `${SPATIAL_CATALOG_COLLECTION}/${SPATIAL_CATALOG_DOC_ID}`,
        details: {
            source: catalog.source,
            sourceUrl: catalog.sourceUrl,
            sourceHash: catalog.sourceHash,
            totalCount: catalog.totalCount,
            optimalCount: catalog.optimalCount,
            vioCount: catalog.vioCount,
            ruggedCount: catalog.ruggedCount,
            remoteParsedCount: parsedRemoteDevices.length,
        },
        ipAddress: actor.ipAddress,
    });

    return {
        syncedFromRemote: true,
        fallbackUsed: false,
        catalog,
    };
}

/**
 * Importa un CSV oficial de Google Play Console Device Catalog (>= 10 filas válidas),
 * fusiona con el catálogo activo/baseline preservando certificaciones ARCore/LiDAR,
 * persiste en `system_config/spatial_device_catalog` y audita en `AuditLedger`.
 */
export async function importGooglePlayDeviceCatalogCsv(params: {
    csvText: string;
    actor: SpatialCatalogActor;
}): Promise<SpatialCatalogCsvImportResult> {
    const parsedRows = parseGooglePlayDeviceCatalogCsv(params.csvText);
    if (parsedRows.length < MIN_CSV_DEVICE_ROWS) {
        throw new SpatialCatalogValidationError(
            `CSV invalido o insuficiente: se requieren al menos ${MIN_CSV_DEVICE_ROWS} filas validas (obtenidas ${parsedRows.length}).`
        );
    }

    const currentCatalog =
        (await readValidCatalogFromFirestore()) || buildBaselineSpatialDeviceCatalog();

    const mergedMap = new Map<string, SpatialDeviceEntry>();
    for (const entry of currentCatalog.devices) {
        mergedMap.set(
            canonicalCompactKey(entry.platform, entry.manufacturer, entry.model),
            { ...entry }
        );
    }
    for (const csvEntry of parsedRows) {
        const key = canonicalCompactKey(
            csvEntry.platform,
            csvEntry.manufacturer,
            csvEntry.model
        );
        const existing = mergedMap.get(key);
        if (existing) {
            mergedMap.set(key, mergeDeviceEntries(existing, csvEntry));
        } else {
            mergedMap.set(key, csvEntry);
        }
    }

    const catalog = assembleValidatedCatalog({
        devices: Array.from(mergedMap.values()),
        source: 'GOOGLE_PLAY_CONSOLE_CSV + CURATED_BASELINE',
        sourceUrl: GOOGLE_PLAY_DEVICE_CATALOG_URL,
    });

    await db
        .collection(SPATIAL_CATALOG_COLLECTION)
        .doc(SPATIAL_CATALOG_DOC_ID)
        .set(catalog);

    inMemoryCatalogCache = { catalog, cachedAt: Date.now(), fromFirestore: true };

    await AuditLedger.record({
        tenantId: params.actor.tenantId || 'global',
        actorUid: params.actor.uid,
        actorEmail: params.actor.email || params.actor.uid,
        action: 'SPATIAL_DEVICE_CATALOG_CSV_IMPORT',
        module: 'stockpile',
        targetEntity: `${SPATIAL_CATALOG_COLLECTION}/${SPATIAL_CATALOG_DOC_ID}`,
        details: {
            source: catalog.source,
            sourceHash: catalog.sourceHash,
            importedCount: parsedRows.length,
            totalCount: catalog.totalCount,
            optimalCount: catalog.optimalCount,
            vioCount: catalog.vioCount,
            ruggedCount: catalog.ruggedCount,
        },
        ipAddress: params.actor.ipAddress,
    });

    return {
        catalog,
        importedCount: parsedRows.length,
    };
}
