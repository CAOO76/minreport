import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';

/**
 * Hook reactivo multi-capa de conectividad (Web + Capacitor Native Network).
 * En minería a cielo abierto y subterránea detecta transiciones de celda/Wi-Fi reales.
 */
export const useNetworkStatus = () => {
    const [isOnline, setIsOnline] = useState(
        typeof navigator !== 'undefined' ? navigator.onLine : true
    );

    useEffect(() => {
        let active = true;
        const handleOnline = () => {
            if (active) setIsOnline(true);
        };
        const handleOffline = () => {
            if (active) setIsOnline(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        let removeCapListener: (() => Promise<void>) | undefined;
        if (Capacitor.isNativePlatform()) {
            Network.getStatus()
                .then((status) => {
                    if (active) setIsOnline(Boolean(status.connected));
                })
                .catch(() => {});

            Network.addListener('networkStatusChange', (status) => {
                if (active) setIsOnline(Boolean(status.connected));
            })
                .then((handle) => {
                    if (!active) {
                        void handle.remove();
                    } else {
                        removeCapListener = () => handle.remove();
                    }
                })
                .catch(() => {});
        }

        return () => {
            active = false;
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            if (removeCapListener) {
                void removeCapListener();
            }
        };
    }, []);

    return { isOnline };
};
