import { useCallback, useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';

export type SpatialCapabilityTier =
    | 'OPTIMAL_SPATIAL'
    | 'COMPATIBLE_VIO'
    | 'NEEDS_UPDATE'
    | 'INCOMPATIBLE';

export interface SpatialDeviceCapabilityReport {
    platform: 'android' | 'ios' | 'web';
    manufacturer: string;
    model: string;
    device: string;
    sdkInt: number;
    arCoreAvailability: string;
    arCoreSupported: boolean;
    depthApiSupported: boolean;
    rawDepthSupported: boolean;
    hasGyroscope: boolean;
    hasAccelerometer: boolean;
    camera2Level: string;
    tier: SpatialCapabilityTier;
    reasons: string[];
}

interface MinreportDeviceCapabilityNative {
    getCapabilities(): Promise<Partial<SpatialDeviceCapabilityReport>>;
    requestArCoreInstall(): Promise<{ status: string; message?: string }>;
}

const MinreportDeviceCapability = registerPlugin<MinreportDeviceCapabilityNative>(
    'MinreportDeviceCapability'
);

const VALID_TIERS: ReadonlySet<SpatialCapabilityTier> = new Set([
    'OPTIMAL_SPATIAL',
    'COMPATIBLE_VIO',
    'NEEDS_UPDATE',
    'INCOMPATIBLE',
]);

function normalizeTier(raw: unknown): SpatialCapabilityTier {
    if (typeof raw === 'string' && VALID_TIERS.has(raw as SpatialCapabilityTier)) {
        return raw as SpatialCapabilityTier;
    }
    return 'INCOMPATIBLE';
}

function buildWebBrowserReport(): SpatialDeviceCapabilityReport {
    return {
        platform: 'web',
        manufacturer: 'WEB',
        model: typeof navigator !== 'undefined' ? navigator.platform || 'BROWSER' : 'BROWSER',
        device: 'web',
        sdkInt: 0,
        arCoreAvailability: 'UNSUPPORTED_WEB_BROWSER',
        arCoreSupported: false,
        depthApiSupported: false,
        rawDepthSupported: false,
        hasGyroscope: false,
        hasAccelerometer: false,
        camera2Level: 'NONE',
        tier: 'INCOMPATIBLE',
        reasons: ['WEB_BROWSER_NO_ARCORE'],
    };
}

export async function probeSpatialDeviceCapability(): Promise<SpatialDeviceCapabilityReport> {
    if (!Capacitor.isNativePlatform()) {
        return buildWebBrowserReport();
    }

    const nativePlatform: 'android' | 'ios' =
        Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';

    try {
        const raw = await MinreportDeviceCapability.getCapabilities();
        const reasons = Array.isArray(raw?.reasons)
            ? raw.reasons.filter((item): item is string => typeof item === 'string' && item.length > 0)
            : [];
        return {
            platform:
                raw?.platform === 'ios' || raw?.platform === 'android'
                    ? raw.platform
                    : nativePlatform,
            manufacturer: typeof raw?.manufacturer === 'string' ? raw.manufacturer : '',
            model: typeof raw?.model === 'string' ? raw.model : '',
            device: typeof raw?.device === 'string' ? raw.device : '',
            sdkInt: typeof raw?.sdkInt === 'number' && Number.isFinite(raw.sdkInt) ? raw.sdkInt : 0,
            arCoreAvailability:
                typeof raw?.arCoreAvailability === 'string' ? raw.arCoreAvailability : 'UNKNOWN',
            arCoreSupported: Boolean(raw?.arCoreSupported),
            depthApiSupported: Boolean(raw?.depthApiSupported),
            rawDepthSupported: Boolean(raw?.rawDepthSupported),
            hasGyroscope: Boolean(raw?.hasGyroscope),
            hasAccelerometer: Boolean(raw?.hasAccelerometer),
            camera2Level: typeof raw?.camera2Level === 'string' ? raw.camera2Level : 'UNKNOWN',
            tier: normalizeTier(raw?.tier),
            reasons,
        };
    } catch {
        return {
            platform: nativePlatform,
            manufacturer: '',
            model: '',
            device: '',
            sdkInt: 0,
            arCoreAvailability: 'PLUGIN_UNAVAILABLE',
            arCoreSupported: false,
            depthApiSupported: false,
            rawDepthSupported: false,
            hasGyroscope: false,
            hasAccelerometer: false,
            camera2Level: 'UNKNOWN',
            tier: 'INCOMPATIBLE',
            reasons: ['PLUGIN_PROBE_UNAVAILABLE'],
        };
    }
}

export async function requestArCoreInstall(): Promise<{ status: string; message?: string }> {
    if (!Capacitor.isNativePlatform()) {
        return { status: 'UNSUPPORTED_PLATFORM', message: 'WEB_BROWSER_NO_ARCORE' };
    }

    try {
        const res = await MinreportDeviceCapability.requestArCoreInstall();
        return {
            status: typeof res?.status === 'string' ? res.status : 'UNKNOWN',
            ...(typeof res?.message === 'string' && res.message ? { message: res.message } : {}),
        };
    } catch (err: unknown) {
        return {
            status: 'ERROR',
            message: err instanceof Error ? err.message : 'ARCORE_INSTALL_FAILED',
        };
    }
}

export function useSpatialDeviceCapability() {
    const [capability, setCapability] = useState<SpatialDeviceCapabilityReport | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        const report = await probeSpatialDeviceCapability();
        setCapability(report);
        setLoading(false);
        return report;
    }, []);

    useEffect(() => {
        let active = true;
        setLoading(true);
        void probeSpatialDeviceCapability().then((report) => {
            if (!active) return;
            setCapability(report);
            setLoading(false);
        });
        return () => {
            active = false;
        };
    }, []);

    const handleRequestInstall = useCallback(async () => {
        const res = await requestArCoreInstall();
        await refresh();
        return res;
    }, [refresh]);

    return {
        capability,
        loading,
        refresh,
        requestInstall: handleRequestInstall,
    };
}
