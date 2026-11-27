import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Capacitor } from '@capacitor/core';
import {
    formatStockpileVolumeM3,
    normalizeNativeSpatialScan,
    type SpatialScanNativeResult,
} from '../core/services/spatialScannerService';
import * as SpatialScannerServiceMod from '../core/services/spatialScannerService';
import * as SpatialDeviceCapabilityMod from '../core/services/spatialDeviceCapability';
import {
    MobileScanner,
    buildRejectedDiagnosticTokens,
    extractRejectedDiagnostics,
} from '../components/MobileScanner';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (_key: string, fallback?: string) => fallback || _key,
        i18n: { language: 'es', resolvedLanguage: 'es' },
    }),
}));

vi.mock('../../../hooks/useNetworkStatus', () => ({
    useNetworkStatus: () => ({ isOnline: false }),
}));

vi.mock('../core/utils/fieldHaptics', () => ({
    triggerFieldImpact: vi.fn().mockResolvedValue(undefined),
    triggerFieldNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../core/hooks/useXCoverHardwareKey', () => ({
    useXCoverHardwareKey: vi.fn(),
    XCOVER_HARDWARE_KEY_CODES: {
        XCOVER_SIDE_KEY: 1015,
        XCOVER_TOP_KEY: 1016,
        F1: 131,
        CAMERA: 27,
    },
}));

describe('Web Diagnostics & Bridge 2.2.0 — normalizeNativeSpatialScan', () => {
    it('preserva campos Android 2.2.0 (visualHullViews, depthSamplesCount, slopeProfile, sigmaGroundM) y volumen 0.0462 m³', () => {
        const rawPayload220 = {
            scanId: 'scan_v220_small_01',
            scannerEngineVersion: '2.2.0-vio-mvs-hull',
            orientationMode: 'LANDSCAPE_4_3',
            depthMode: 'RAW_DEPTH_ONLY',
            deviceModel: 'Samsung SM-G556B',
            coveragePct: 75.0,
            sectorsCovered: 12,
            sectorsTotal: 16,
            loopClosed: true,
            slopeProfile: 'VERTICAL_STRUCTURE',
            sigmaGroundM: 0.0184,
            visualHullViews: 9,
            depthSamplesCount: 14280,
            inSituMetrology: {
                volumeM3: 0.0462,
                dimensionsM: { a: 0.4, b: 0.39, h: 0.4 },
                groundSlopeDeg: 0.8,
                uncertaintyPct: 8.5,
                coveragePct: 75.0,
                occludedVolumePct: 14.2,
                toeScore: 84,
                slopeProfile: 'VERTICAL_STRUCTURE',
                sigmaGroundM: 0.0184,
                visualHullViews: 9,
                depthSamplesCount: 14280,
                metrologyGrade: 'VALID_IN_SITU',
            },
        };

        const normalized = normalizeNativeSpatialScan(rawPayload220);

        expect(normalized.slopeProfile).toBe('VERTICAL_STRUCTURE');
        expect(normalized.sigmaGroundM).toBeCloseTo(0.0184, 4);
        expect(normalized.visualHullViews).toBe(9);
        expect(normalized.depthSamplesCount).toBe(14280);

        expect(normalized.inSituMetrology).not.toBeNull();
        expect(normalized.inSituMetrology!.volumeM3).toBeCloseTo(0.0462, 4);
        expect(normalized.inSituMetrology!.baseLengthM).toBeCloseTo(0.4, 2);
        expect(normalized.inSituMetrology!.heightMaxM).toBeCloseTo(0.4, 2);
        expect(normalized.inSituMetrology!.slopeProfile).toBe('VERTICAL_STRUCTURE');
        expect(normalized.inSituMetrology!.sigmaGroundM).toBeCloseTo(0.0184, 4);
        expect(normalized.inSituMetrology!.visualHullViews).toBe(9);
        expect(normalized.inSituMetrology!.depthSamplesCount).toBe(14280);
    });

    it('propaga campos 2.2.0 desde inSituMetrology hacia la raíz y mantiene 100% retrocompatibilidad si faltan o son null', () => {
        const fromNested = normalizeNativeSpatialScan({
            scanId: 'scan_v220_nested',
            inSituMetrology: {
                volumeM3: 12.4,
                dimensionsM: { a: 4.5, b: 4.2, h: 1.8 },
                groundSlopeDeg: 2.1,
                uncertaintyPct: 6.2,
                toeScore: 88,
                slopeProfile: 'STEEP_ALERT',
                sigmaGroundM: 0.025,
                visualHullViews: 6,
                depthSamplesCount: 4200,
                metrologyGrade: 'VALID_IN_SITU',
            },
        });
        expect(fromNested.slopeProfile).toBe('STEEP_ALERT');
        expect(fromNested.sigmaGroundM).toBe(0.025);
        expect(fromNested.visualHullViews).toBe(6);
        expect(fromNested.depthSamplesCount).toBe(4200);

        const legacyOrNull = normalizeNativeSpatialScan({
            scanId: 'scan_legacy_nulls',
            slopeProfile: null,
            sigmaGroundM: null,
            visualHullViews: null,
            depthSamplesCount: null,
            inSituMetrology: {
                volumeM3: 24.5,
                dimensionsM: { a: 5.5, b: 5.1, h: 2.2 },
                groundSlopeDeg: 1.0,
                uncertaintyPct: 5.4,
                toeScore: 91,
                occludedVolumePct: null,
                slopeProfile: null,
                sigmaGroundM: null,
                visualHullViews: null,
                depthSamplesCount: null,
                metrologyGrade: 'VALID_IN_SITU',
            },
        });
        expect(legacyOrNull.slopeProfile).toBeUndefined();
        expect(legacyOrNull.sigmaGroundM).toBeUndefined();
        expect(legacyOrNull.visualHullViews).toBeUndefined();
        expect(legacyOrNull.depthSamplesCount).toBeUndefined();
        expect(legacyOrNull.inSituMetrology).not.toBeNull();
        expect(legacyOrNull.inSituMetrology!.volumeM3).toBe(24.5);
        expect(legacyOrNull.inSituMetrology!.slopeProfile).toBeUndefined();
        expect(legacyOrNull.inSituMetrology!.sigmaGroundM).toBeUndefined();
        expect(legacyOrNull.inSituMetrology!.visualHullViews).toBeUndefined();
        expect(legacyOrNull.inSituMetrology!.depthSamplesCount).toBeUndefined();

        const naturalRepose = normalizeNativeSpatialScan({
            scanId: 'scan_natural_repose',
            slopeProfile: 'NATURAL_REPOSE',
        });
        expect(naturalRepose.slopeProfile).toBe('NATURAL_REPOSE');

        const invalidProfile = normalizeNativeSpatialScan({
            scanId: 'scan_invalid_profile',
            slopeProfile: 'UNKNOWN_ENUM',
            sigmaGroundM: -0.5,
            visualHullViews: Number.NaN,
            depthSamplesCount: -10,
        });
        expect(invalidProfile.slopeProfile).toBeUndefined();
        expect(invalidProfile.sigmaGroundM).toBeUndefined();
        expect(invalidProfile.visualHullViews).toBeUndefined();
        expect(invalidProfile.depthSamplesCount).toBeUndefined();
    });

    it('preserva inSituMetrology REJECTED incluso con volumeM3 === 0 para diagnóstico técnico', () => {
        const zeroRejected = normalizeNativeSpatialScan({
            scanId: 'scan_rejected_zero',
            coveragePct: 22,
            visualHullViews: 2,
            inSituMetrology: {
                volumeM3: 0,
                coveragePct: 22,
                occludedVolumePct: 65,
                toeScore: 28,
                uncertaintyPct: 44,
                metrologyGrade: 'REJECTED',
            },
        });

        expect(zeroRejected.inSituMetrology).not.toBeNull();
        expect(zeroRejected.inSituMetrology!.metrologyGrade).toBe('REJECTED');
        expect(zeroRejected.inSituMetrology!.volumeM3).toBe(0);
        expect(zeroRejected.inSituMetrology!.occludedVolumePct).toBe(65);
        expect(zeroRejected.inSituMetrology!.toeScore).toBe(28);
        expect(zeroRejected.inSituMetrology!.uncertaintyPct).toBe(44);
        expect(zeroRejected.inSituMetrology!.visualHullViews).toBe(2);
    });
});

describe('Web Diagnostics & Bridge 2.2.0 — Formato volumen y flags ISA-101', () => {
    it('formatea volúmenes < 1.0 m³ con 3 decimales y >= 1.0 m³ según escala industrial', () => {
        expect(formatStockpileVolumeM3(0.0462)).toBe('0.046');
        expect(formatStockpileVolumeM3(0.0024)).toBe('0.002');
        expect(formatStockpileVolumeM3(0.5)).toBe('0.500');
        expect(formatStockpileVolumeM3(0.9994)).toBe('0.999');
        expect(formatStockpileVolumeM3(0)).toBe('0.000');
        expect(formatStockpileVolumeM3(-1)).toBe('0.000');
        expect(formatStockpileVolumeM3(Number.NaN)).toBe('0.000');

        expect(formatStockpileVolumeM3(1.0)).toBe('1.00');
        expect(formatStockpileVolumeM3(4.356)).toBe('4.36');
        expect(formatStockpileVolumeM3(9.99)).toBe('9.99');
        expect(formatStockpileVolumeM3(10.0)).toBe('10.0');
        expect(formatStockpileVolumeM3(42.54)).toBe('42.5');
    });

    it('construye tokens de diagnóstico ISA-101 marcando Cobre SOLO cuando se viola umbral', () => {
        const tokens = buildRejectedDiagnosticTokens({
            volumeM3: 0.0462,
            dimAM: 0.4,
            dimHM: 0.4,
            coveragePct: 31,
            occludedVolumePct: 48,
            toeScore: 42,
            uncertaintyPct: 27,
            visualHullViews: 5,
        });

        expect(tokens).toEqual([
            { key: 'volume', label: 'V 0.046 m³', alert: false },
            { key: 'dimA', label: 'Ø 0.40 m', alert: false },
            { key: 'dimH', label: 'H 0.40 m', alert: false },
            { key: 'coverage', label: 'COB 31%', alert: false },
            { key: 'occluded', label: 'OCL 48%', alert: true },
            { key: 'toe', label: 'TOE 42', alert: true },
            { key: 'uncertainty', label: '±27%', alert: true },
            { key: 'visualHull', label: 'VH 5', alert: false },
        ]);

        // Fronteras exactas de umbral: V <= 0.003 es alerta; OCL === 40, TOE === 45, ± === 25 son nominales
        const boundaryTokens = buildRejectedDiagnosticTokens({
            volumeM3: 0.003,
            occludedVolumePct: 40,
            toeScore: 45,
            uncertaintyPct: 25,
        });
        expect(boundaryTokens).toEqual([
            { key: 'volume', label: 'V 0.003 m³', alert: true },
            { key: 'occluded', label: 'OCL 40%', alert: false },
            { key: 'toe', label: 'TOE 45', alert: false },
            { key: 'uncertainty', label: '±25%', alert: false },
        ]);

        // Nunca inventar datos si faltan campos
        expect(buildRejectedDiagnosticTokens({ volumeM3: 0.002 })).toEqual([
            { key: 'volume', label: 'V 0.002 m³', alert: true },
        ]);
        expect(buildRejectedDiagnosticTokens(null)).toEqual([]);
    });

    it('extractRejectedDiagnostics solo extrae snapshot numérico real en rechazos', () => {
        const validScan = normalizeNativeSpatialScan({
            scanId: 'scan_valid',
            inSituMetrology: {
                volumeM3: 15.0,
                dimensionsM: { a: 4.0, b: 4.0, h: 1.5 },
                groundSlopeDeg: 1.0,
                uncertaintyPct: 6.0,
                toeScore: 90,
                metrologyGrade: 'VALID_IN_SITU',
            },
        });
        expect(extractRejectedDiagnostics(validScan)).toBeNull();

        const rejectedScan = normalizeNativeSpatialScan({
            scanId: 'scan_rej_extract',
            visualHullViews: 4,
            inSituMetrology: {
                volumeM3: 0.0462,
                dimensionsM: { a: 0.4, b: 0.38, h: 0.4 },
                coveragePct: 31,
                occludedVolumePct: 48,
                toeScore: 42,
                uncertaintyPct: 27,
                metrologyGrade: 'REJECTED',
            },
        });
        expect(extractRejectedDiagnostics(rejectedScan)).toEqual({
            volumeM3: 0.0462,
            dimAM: 0.4,
            dimHM: 0.4,
            coveragePct: 31,
            occludedVolumePct: 48,
            toeScore: 42,
            uncertaintyPct: 27,
            visualHullViews: 4,
        });
    });
});

describe('Web Diagnostics & Bridge 2.2.0 — MobileScanner UI (REJECTED y < 1.0 m³)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function mockSpatialDeviceCapable() {
        vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
        const cap: SpatialDeviceCapabilityMod.SpatialDeviceCapabilityReport = {
            platform: 'android',
            manufacturer: 'Samsung',
            model: 'SM-G556B',
            device: 'xcover7',
            sdkInt: 34,
            arCoreAvailability: 'SUPPORTED_INSTALLED',
            arCoreSupported: true,
            depthApiSupported: true,
            rawDepthSupported: true,
            hasGyroscope: true,
            hasAccelerometer: true,
            camera2Level: 'FULL',
            tier: 'OPTIMAL_SPATIAL',
            reasons: [],
        };
        vi.spyOn(SpatialDeviceCapabilityMod, 'getCachedSpatialDeviceCapability').mockReturnValue(
            cap
        );
        vi.spyOn(SpatialDeviceCapabilityMod, 'useSpatialDeviceCapability').mockReturnValue({
            capability: cap,
            loading: false,
            refresh: vi.fn(),
            requestInstall: vi.fn(),
        });
    }

    it('renderiza mensaje scanner.insitu_rejected y franja diagnóstica ISA-101 en stage REJECTED', async () => {
        mockSpatialDeviceCapable();
        const rejectedScan: SpatialScanNativeResult = normalizeNativeSpatialScan({
            scanId: 'scan_ui_rejected_01',
            scannerEngineVersion: '2.2.0-vio-mvs-hull',
            visualHullViews: 3,
            inSituMetrology: {
                volumeM3: 0.0462,
                dimensionsM: { a: 0.4, b: 0.39, h: 0.4 },
                coveragePct: 31,
                occludedVolumePct: 48,
                toeScore: 42,
                uncertaintyPct: 27,
                metrologyGrade: 'REJECTED',
            },
        });
        vi.spyOn(SpatialScannerServiceMod, 'startNativeSpatialScan').mockResolvedValue({
            scan: rejectedScan,
            photoBlobs: [],
            pairedKeyframes: [],
        });

        render(
            React.createElement(MobileScanner, {
                assetId: 'asset_v220_01',
                assetName: 'AC-5102',
                autoStartScan: true,
                onSuccess: vi.fn(),
                onBack: vi.fn(),
            })
        );

        await waitFor(() => {
            expect(
                screen.getByText('COBERTURA O VOLUMEN INSUFICIENTE. RODEAR EL ACOPIO Y REINTENTAR.')
            ).toBeInTheDocument();
        });

        const strip = screen.getByTestId('rejected-diagnostics-strip');
        expect(strip.className).toContain('font-mono');
        expect(strip.className).toContain('tabular-nums');
        expect(strip.className).toContain('rounded-none');
        expect(strip.textContent).toContain('V 0.046 m³');
        expect(strip.textContent).toContain('Ø 0.40 m');
        expect(strip.textContent).toContain('H 0.40 m');
        expect(strip.textContent).toContain('COB 31%');
        expect(strip.textContent).toContain('OCL 48%');
        expect(strip.textContent).toContain('TOE 42');
        expect(strip.textContent).toContain('±27%');
        expect(strip.textContent).toContain('VH 3');

        const oclEl = strip.querySelector('[data-diagnostic-key="occluded"]');
        const toeEl = strip.querySelector('[data-diagnostic-key="toe"]');
        const uncEl = strip.querySelector('[data-diagnostic-key="uncertainty"]');
        const volEl = strip.querySelector('[data-diagnostic-key="volume"]');
        expect(oclEl?.getAttribute('data-diagnostic-alert')).toBe('true');
        expect(oclEl?.className).toContain('text-[#C68346]');
        expect(toeEl?.getAttribute('data-diagnostic-alert')).toBe('true');
        expect(toeEl?.className).toContain('text-[#C68346]');
        expect(uncEl?.getAttribute('data-diagnostic-alert')).toBe('true');
        expect(uncEl?.className).toContain('text-[#C68346]');
        expect(volEl?.getAttribute('data-diagnostic-alert')).toBe('false');
        expect(volEl?.className).not.toContain('text-[#C68346]');
    });

    it('formatea volumen in-situ < 1.0 m³ con 3 decimales en stage RESULT (0.046 m³)', async () => {
        mockSpatialDeviceCapable();
        const smallValidScan: SpatialScanNativeResult = normalizeNativeSpatialScan({
            scanId: 'scan_ui_small_valid_01',
            scannerEngineVersion: '2.2.0-vio-mvs-hull',
            visualHullViews: 8,
            inSituMetrology: {
                volumeM3: 0.0462,
                dimensionsM: { a: 0.4, b: 0.4, h: 0.37 },
                coveragePct: 88,
                occludedVolumePct: 12,
                toeScore: 86,
                uncertaintyPct: 7.4,
                metrologyGrade: 'VALID_IN_SITU',
            },
        });
        vi.spyOn(SpatialScannerServiceMod, 'startNativeSpatialScan').mockResolvedValue({
            scan: smallValidScan,
            photoBlobs: [],
            pairedKeyframes: [],
        });

        render(
            React.createElement(MobileScanner, {
                assetId: 'asset_v220_02',
                assetName: 'AC-5102',
                autoStartScan: true,
                onSuccess: vi.fn(),
                onBack: vi.fn(),
            })
        );

        await waitFor(() => {
            expect(screen.getByText('0.046 m³')).toBeInTheDocument();
        });
    });
});
