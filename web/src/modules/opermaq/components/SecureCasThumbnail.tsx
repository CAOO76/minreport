import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';

interface SecureCasThumbnailProps {
    src?: string | null;
    alt: string;
    tenantId?: string;
    fallbackIcon?: string;
    className?: string;
    imgClassName?: string;
}

const privateBlobUrlCache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 120;

function resolvePublicHref(rawUrl: string): string {
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
        return rawUrl;
    }
    if (rawUrl.startsWith('/api/')) {
        const cleanRoot = API_BASE_URL.replace(/\/api\/?$/, '');
        return `${cleanRoot}${rawUrl}`;
    }
    return rawUrl;
}

export const SecureCasThumbnail: React.FC<SecureCasThumbnailProps> = ({
    src,
    alt,
    tenantId,
    fallbackIcon = 'front_loader',
    className = 'w-12 h-12',
    imgClassName = 'w-full h-full object-cover',
}) => {
    const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState<boolean>(false);

    useEffect(() => {
        setFailed(false);
        if (!src || !src.trim()) {
            setResolvedUrl(null);
            return;
        }

        const cleanSrc = src.trim();
        const isTenantPrivate = cleanSrc.includes('/api/media/blob/tenant/');

        if (!isTenantPrivate) {
            setResolvedUrl(resolvePublicHref(cleanSrc));
            return;
        }

        const cached = privateBlobUrlCache.get(cleanSrc);
        if (cached) {
            setResolvedUrl(cached);
            return;
        }

        let active = true;
        const fullEndpoint = resolvePublicHref(cleanSrc);

        authFetch(fullEndpoint, {
            method: 'GET',
            headers: tenantId ? { 'X-Active-Account-Id': tenantId } : undefined,
        })
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                const objectUrl = URL.createObjectURL(blob);

                if (privateBlobUrlCache.size >= MAX_CACHE_ENTRIES) {
                    const oldestKey = privateBlobUrlCache.keys().next().value;
                    if (oldestKey) {
                        const oldObj = privateBlobUrlCache.get(oldestKey);
                        if (oldObj) URL.revokeObjectURL(oldObj);
                        privateBlobUrlCache.delete(oldestKey);
                    }
                }
                privateBlobUrlCache.set(cleanSrc, objectUrl);

                if (active) {
                    setResolvedUrl(objectUrl);
                }
            })
            .catch(() => {
                if (active) {
                    setFailed(true);
                    setResolvedUrl(null);
                }
            });

        return () => {
            active = false;
        };
    }, [src, tenantId]);

    return (
        <div
            className={`bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-center overflow-hidden shrink-0 rounded-none shadow-none select-none ${className}`}
        >
            {resolvedUrl && !failed ? (
                <img
                    src={resolvedUrl}
                    alt={alt}
                    draggable={false}
                    onError={() => setFailed(true)}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                    className={`select-none pointer-events-none ${imgClassName}`}
                />
            ) : (
                <span className="material-symbols-outlined text-[20px] text-[#94A3B8] dark:text-[#5A6072] select-none pointer-events-none">
                    {fallbackIcon}
                </span>
            )}
        </div>
    );
};

export default SecureCasThumbnail;

