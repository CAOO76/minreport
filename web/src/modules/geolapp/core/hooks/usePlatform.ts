import { Capacitor } from '@capacitor/core';
import { useState, useEffect } from 'react';

export type Platform = 'web' | 'android' | 'ios';

function resolveCapacitorPlatform(): { platform: Platform; isNative: boolean } {
    const p = Capacitor.getPlatform();
    const isNative = Capacitor.isNativePlatform();

    if (p === 'android') {
        return { platform: 'android', isNative };
    }
    if (p === 'ios') {
        return { platform: 'ios', isNative };
    }
    return { platform: 'web', isNative: false };
}

export function usePlatform() {
    const [platform, setPlatform] = useState<Platform>(() => resolveCapacitorPlatform().platform);
    const [isNative, setIsNative] = useState<boolean>(() => resolveCapacitorPlatform().isNative);

    useEffect(() => {
        const resolved = resolveCapacitorPlatform();
        setPlatform(resolved.platform);
        setIsNative(resolved.isNative);
    }, []);

    return {
        platform,
        isNative,
        isWeb: platform === 'web',
    };
}
