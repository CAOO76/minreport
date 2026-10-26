
import { Capacitor } from '@capacitor/core';
import { useState, useEffect } from 'react';

export type Platform = 'web' | 'android' | 'ios';

export function usePlatform() {
    const [platform, setPlatform] = useState<Platform>('web');
    const [isNative, setIsNative] = useState(false);

    useEffect(() => {
        const p = Capacitor.getPlatform();
        let currentPlatform: Platform = 'web';

        if (p === 'android') currentPlatform = 'android';
        else if (p === 'ios') currentPlatform = 'ios';
        else if (window.innerWidth < 768) currentPlatform = 'android'; // Simulate mobile on small screens

        setPlatform(currentPlatform);
        setIsNative(currentPlatform === 'android' || currentPlatform === 'ios');
    }, []);

    return {
        platform,
        isNative,
        isWeb: platform === 'web'
    };
}
