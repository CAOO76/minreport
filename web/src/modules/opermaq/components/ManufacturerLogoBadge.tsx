import React, { useEffect, useMemo, useState } from 'react';
import type { BrandSvgAssetDescriptor, ManufacturerRecord } from '../../../contracts/manufacturers.contracts';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';

export interface ManufacturerLogoBadgeProps {
    make?: string | null;
    variant?: 'primary' | 'compact' | 'frameless';
    size?: 'sm' | 'md' | 'lg';
    className?: string;
    onClick?: () => void;
    recordOverride?: ManufacturerRecord | null;
    showMonogramFallback?: boolean;
}

const CACHE_TTL_MS = 120_000;
let cachedIndex = new Map<string, ManufacturerRecord>();
let cachedAt = 0;
let inflightRequest: Promise<Map<string, ManufacturerRecord>> | null = null;
const cacheListeners = new Set<() => void>();

function normalizeLookupKey(raw: string): string {
    return raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120);
}

function indexRecords(rows: ManufacturerRecord[]): Map<string, ManufacturerRecord> {
    const next = new Map<string, ManufacturerRecord>();
    for (const rec of rows) {
        if (!rec?.manufacturerKey) continue;
        next.set(normalizeLookupKey(rec.manufacturerKey), rec);
        if (rec.officialName) next.set(normalizeLookupKey(rec.officialName), rec);
        for (const alias of rec.aliases || []) {
            if (alias) next.set(normalizeLookupKey(alias), rec);
        }
    }
    return next;
}

async function fetchManufacturersIndex(): Promise<Map<string, ManufacturerRecord>> {
    if (cachedAt > 0 && Date.now() - cachedAt < CACHE_TTL_MS) {
        return cachedIndex;
    }
    if (inflightRequest) return inflightRequest;

    inflightRequest = (async () => {
        try {
            const res = await authFetch('/api/manufacturers');
            if (!res.ok) return cachedIndex;
            const payload = (await res.json()) as { manufacturers?: ManufacturerRecord[] };
            cachedIndex = indexRecords(Array.isArray(payload.manufacturers) ? payload.manufacturers : []);
            cachedAt = Date.now();
            return cachedIndex;
        } catch {
            return cachedIndex;
        } finally {
            inflightRequest = null;
        }
    })();

    return inflightRequest;
}

/**
 * Invalida caché local de isotipos OEM tras una curaduría o carga manual.
 */
export function invalidateManufacturerLogoCache(keyOrMake?: string): void {
    if (!keyOrMake) {
        cachedIndex.clear();
    } else {
        cachedIndex.delete(normalizeLookupKey(keyOrMake));
    }
    cachedAt = 0;
    inflightRequest = null;
    for (const notify of cacheListeners) notify();
}

export function buildManufacturerMonogram(raw?: string | null): string {
    const clean = (raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9 ]+/g, ' ')
        .trim()
        .toUpperCase();
    if (!clean) return '--';
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
        return `${words[0][0]}${words[1][0]}`.slice(0, 3);
    }
    return words[0].slice(0, 3);
}

function resolveLogoDescriptor(record: ManufacturerRecord | null | undefined): BrandSvgAssetDescriptor | null {
    if (!record) return null;
    if (record.logoSvg) return record.logoSvg;
    const legacy = record as unknown as {
        brandAssets?: { primarySvg?: BrandSvgAssetDescriptor | null; compactIsotypeSvg?: BrandSvgAssetDescriptor | null };
    };
    return legacy.brandAssets?.primarySvg ?? legacy.brandAssets?.compactIsotypeSvg ?? null;
}

function isSafeSvgUrl(url?: string | null): url is string {
    if (!url) return false;
    return (
        !url.includes(';base64,') &&
        (url.startsWith('/api/media/blob/global_oem/') || url.startsWith('https://'))
    );
}

export function resolvePublicLogoHref(rawUrl: string): string {
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('blob:')) {
        return rawUrl;
    }
    if (rawUrl.startsWith('/api/')) {
        const cleanRoot = API_BASE_URL.replace(/\/api\/?$/, '');
        return `${cleanRoot}${rawUrl}`;
    }
    return rawUrl;
}

const SIZE_BOX_CLASSES: Record<'sm' | 'md' | 'lg', { compact: string; primary: string; text: string }> = {
    sm: { compact: 'w-7 h-7 p-[3px]', primary: 'h-8 min-w-[52px] max-w-[100px] px-2 py-1', text: 'text-microcopy' },
    md: { compact: 'w-9 h-9 p-1', primary: 'h-12 min-w-[76px] max-w-[144px] px-2.5 py-1.5', text: 'text-microcopy' },
    lg: { compact: 'w-14 h-14 p-1.5', primary: 'h-16 min-w-[110px] max-w-[200px] px-3 py-2', text: 'text-data-dense' },
};

const FRAMELESS_IMG_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
    sm: 'h-[26px] w-auto max-w-[104px]',
    md: 'h-[34px] w-auto max-w-[136px] sm:max-w-[152px]',
    lg: 'h-[44px] w-auto max-w-[184px]',
};

/**
 * Resuelve el nombre oficial OEM de una marca desde el índice cacheado de `global_manufacturers`.
 */
export function useResolvedManufacturerName(make?: string | null): string {
    const normalizedKey = useMemo(() => (make ? normalizeLookupKey(make) : ''), [make]);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        const listener = () => setRevision((v) => v + 1);
        cacheListeners.add(listener);
        return () => {
            cacheListeners.delete(listener);
        };
    }, []);

    useEffect(() => {
        if (!normalizedKey) return;
        if (cachedAt > 0 && Date.now() - cachedAt < CACHE_TTL_MS) return;
        let active = true;
        void fetchManufacturersIndex().then(() => {
            if (active) setRevision((v) => v + 1);
        });
        return () => {
            active = false;
        };
    }, [normalizedKey, revision]);

    return useMemo(() => {
        const rec = normalizedKey ? cachedIndex.get(normalizedKey) : undefined;
        if (rec?.officialName?.trim()) {
            return rec.officialName.trim().toUpperCase();
        }
        return (make || '').trim().toUpperCase();
    }, [normalizedKey, make, revision]);
}

export const ManufacturerLogoBadge: React.FC<ManufacturerLogoBadgeProps> = ({
    make,
    variant = 'compact',
    size = 'md',
    className = '',
    onClick,
    recordOverride,
    showMonogramFallback = false,
}) => {
    const normalizedKey = useMemo(() => (make ? normalizeLookupKey(make) : ''), [make]);
    const [revision, setRevision] = useState(0);
    const [imgFailed, setImgFailed] = useState(false);

    useEffect(() => {
        const listener = () => setRevision((v) => v + 1);
        cacheListeners.add(listener);
        return () => {
            cacheListeners.delete(listener);
        };
    }, []);

    useEffect(() => {
        if (recordOverride || !normalizedKey) return;
        if (cachedAt > 0 && Date.now() - cachedAt < CACHE_TTL_MS) return;
        let active = true;
        void fetchManufacturersIndex().then(() => {
            if (active) setRevision((v) => v + 1);
        });
        return () => {
            active = false;
        };
    }, [normalizedKey, recordOverride, revision]);

    const resolvedRecord = useMemo(() => {
        if (recordOverride) return recordOverride;
        return normalizedKey ? cachedIndex.get(normalizedKey) ?? null : null;
    }, [recordOverride, normalizedKey, revision]);

    const descriptor = useMemo(() => resolveLogoDescriptor(resolvedRecord), [resolvedRecord]);
    const logoUrl =
        descriptor && isSafeSvgUrl(descriptor.downloadUrl)
            ? resolvePublicLogoHref(descriptor.downloadUrl)
            : null;

    useEffect(() => {
        setImgFailed(false);
    }, [logoUrl]);

    const boxSpec = SIZE_BOX_CLASSES[size];
    const baseBox = variant === 'primary' ? boxSpec.primary : boxSpec.compact;
    const monogram = buildManufacturerMonogram(resolvedRecord?.officialName || make);
    const label = resolvedRecord?.officialName || make || 'OEM';
    const hasLogo = Boolean(logoUrl && !imgFailed);

    if (variant === 'frameless') {
        if (!hasLogo) {
            if (!showMonogramFallback) return null;
            return (
                <span
                    title={label}
                    className={`inline-flex items-center shrink-0 font-mono text-microcopy font-bold uppercase tracking-[0.08em] text-[#94A3B8] dark:text-[#5A6072] select-none ${className}`}
                >
                    {monogram}
                </span>
            );
        }

        const framelessClasses = [
            'inline-flex items-center shrink-0 bg-transparent border-0 p-0 outline-none rounded-none shadow-none select-none',
            onClick ? 'cursor-pointer' : '',
            className,
        ]
            .filter(Boolean)
            .join(' ');

        const framelessImg = (
            <img
                src={logoUrl!}
                alt={label}
                draggable={false}
                style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                onContextMenu={(e) => e.preventDefault()}
                onError={() => setImgFailed(true)}
                className={`${FRAMELESS_IMG_CLASSES[size]} object-contain object-left select-none pointer-events-none ${descriptor?.invertInDark ? 'dark:invert' : ''
                    }`}
            />
        );

        if (onClick) {
            return (
                <button type="button" onClick={onClick} title={label} aria-label={label} className={framelessClasses}>
                    {framelessImg}
                </button>
            );
        }

        return (
            <span title={label} className={framelessClasses}>
                {framelessImg}
            </span>
        );
    }

    const frameClasses = [
        'inline-flex items-center justify-center shrink-0 overflow-hidden rounded-none shadow-none select-none',
        'bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C]',
        hasLogo ? '' : 'border-l-2 border-l-[#C68346]',
        onClick ? 'cursor-pointer hover:border-[#C68346] transition-colors' : '',
        baseBox,
        className,
    ]
        .filter(Boolean)
        .join(' ');

    const content = hasLogo ? (
        <img
            src={logoUrl!}
            alt={label}
            draggable={false}
            style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
            onContextMenu={(e) => e.preventDefault()}
            onError={() => setImgFailed(true)}
            className={`w-full h-full object-contain select-none pointer-events-none ${descriptor?.invertInDark ? 'dark:invert' : ''
                }`}
        />
    ) : (
        <span
            className={`font-mono tabular-nums font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] ${boxSpec.text}`}
        >
            {monogram}
        </span>
    );

    if (onClick) {
        return (
            <button type="button" onClick={onClick} title={label} aria-label={label} className={frameClasses}>
                {content}
            </button>
        );
    }

    return (
        <span title={label} className={frameClasses}>
            {content}
        </span>
    );
};

export default ManufacturerLogoBadge;
