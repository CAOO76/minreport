import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import esLocale from '../i18n/locales/es.json';
import enLocale from '../i18n/locales/en.json';
import ptLocale from '../i18n/locales/pt.json';
import {
    CalibrationProfileSchema,
    DemGridV1Schema,
    MeasurementGroundTruthInputSchema,
    type CalibrationProfile,
    type GroundTruthRecord,
} from '../../../contracts/acopios.contracts';
import {
    computeAggregateDeviationSummary,
    computeClientDeviationMetrics,
} from '../core/services/groundTruthService';
import * as GroundTruthServiceMod from '../core/services/groundTruthService';
import * as SpatialScannerServiceMod from '../core/services/spatialScannerService';
import { MobileCalibrationView } from '../components/MobileCalibrationView';
import { DesktopCalibrationAuditView } from '../components/desktop/DesktopCalibrationAuditView';
import { DesktopShell } from '../components/desktop/DesktopShell';
import { MeasurementDetail } from '../components/MeasurementDetail';
import type { StockpileAsset, StockpileMeasurement } from '../core/types/GeolappTypes';

// Mock ResilientAIClient antes de importar el motor backend LOOCV
vi.mock('../../../../../src/core/resilient-ai-client', () => ({
    ResilientAIClient: {
        generate: vi.fn().mockRejectedValue(new Error('AI_OFFLINE_IN_UNIT_TEST')),
        extractJsonString: (s: string) => s,
    },
}));

import {
    CalibrationInsufficientSamplesError,
    computeDeviationMetrics,
    generateSovereignAiCalibrationDiagnosis,
    recomputeCalibrationProfileLOOCV,
} from '../../../../../src/modules/geolapp/calibration-learning.service';

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (_key: string, fallback?: string) => fallback || _key,
        i18n: { language: 'es', resolvedLanguage: 'es' },
    }),
}));

vi.mock('../core/services/StorageService', () => ({
    useResolvedStockpileImage: () => null,
    useResolvedStockpileImageState: () => ({ resolvedUrl: null, isLoading: false }),
    storageService: { setTenantId: vi.fn() },
}));

function makeGtRecord(params: {
    id: string;
    estV: number;
    realV: number;
    estH?: number;
    realH?: number;
    estL?: number;
    realL?: number;
    deviceModel?: string;
    isEduSandbox?: boolean;
}): GroundTruthRecord {
    const estimated = {
        volumeM3: params.estV,
        ...(params.estH !== undefined ? { heightM: params.estH } : {}),
        ...(params.estL !== undefined ? { baseLengthM: params.estL } : {}),
    };
    const real = {
        realVolumeM3: params.realV,
        ...(params.realH !== undefined ? { realHeightM: params.realH } : {}),
        ...(params.realL !== undefined ? { realBaseLengthM: params.realL } : {}),
    };
    const deviations = computeDeviationMetrics(estimated, real);
    return {
        id: params.id,
        tenantId: 'tenant-atacama-01',
        assetId: 'asset-01',
        assetName: 'AC-9723',
        measurementId: `meas-${params.id}`,
        deviceModel: params.deviceModel ?? 'Samsung SM-G556B',
        isEduSandbox: params.isEduSandbox ?? false,
        referenceMethod: 'TAPE_MEASURE',
        estimated,
        real,
        deviations,
        createdAt: Date.now(),
        region: 'southamerica-west1',
    };
}

const SAMPLE_ASSET: StockpileAsset = {
    id: 'asset-01',
    tenantId: 'tenant-atacama-01',
    name: 'AC-9723',
    status: 'ACTIVE',
    createdAt: 1700000000000,
    createdBy: 'uid-dev',
    last_volume_m3: 0.045,
    footprint_area_m2: 0.085,
    device_model: 'Samsung SM-G556B',
};

const SAMPLE_MEASUREMENT: StockpileMeasurement = {
    id: 'meas-01',
    assetId: 'asset-01',
    tenantId: 'tenant-atacama-01',
    timestamp: 1700000001000,
    volumen_m3: 0.045,
    peso_t: 0,
    photo_url: '',
    method: 'digital',
    geometry: {
        type: 'CONO_ELIPTICO',
        dimensions: { a: 0.33, b: 0.33, h: 0.54 },
    },
    detected_slope_angle_deg: 88,
    footprint_area_m2: 0.085,
    device_model: 'Samsung SM-G556B',
};

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    const out: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
        const next = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            out.push(...flattenKeys(v as Record<string, unknown>, next));
        } else {
            out.push(next);
        }
    }
    return out.sort();
}

describe('Sprint 3 — Contratos Zod, Desviaciones Δ%, LOOCV & IA Soberana', () => {
    it('acepta dem_grid_v2 con rgbB64 y valida MeasurementGroundTruthInputSchema (ACTUALIZAR + >=1 medida)', () => {
        const demV2 = DemGridV1Schema.parse({
            format: 'dem_grid_v2',
            nx: 2,
            nz: 2,
            cellSizeM: 0.1,
            heightsM: [0.2, 0.3, 0.4, 0.5],
            rgbB64: 'AQIDBAUGBwgJCgsM',
        });
        expect(demV2.format).toBe('dem_grid_v2');
        expect(demV2.rgbB64).toBe('AQIDBAUGBwgJCgsM');

        const rejectedNoHitl = MeasurementGroundTruthInputSchema.safeParse({
            hitlConfirmation: 'GUARDAR',
            realVolumeM3: 0.0462,
            referenceMethod: 'KNOWN_GEOMETRY',
        });
        expect(rejectedNoHitl.success).toBe(false);

        const rejectedNoMeasure = MeasurementGroundTruthInputSchema.safeParse({
            hitlConfirmation: 'ACTUALIZAR',
            referenceMethod: 'TAPE_MEASURE',
        });
        expect(rejectedNoMeasure.success).toBe(false);

        const valid = MeasurementGroundTruthInputSchema.parse({
            hitlConfirmation: 'ACTUALIZAR',
            realHeightM: 0.54,
            realDiameterM: 0.33,
            realVolumeM3: 0.0462,
            referenceMethod: 'KNOWN_GEOMETRY',
        });
        expect(valid.hitlConfirmation).toBe('ACTUALIZAR');
    });

    it('calcula Δ% exacto (APP vs REAL) y clasifica OPTIMAL (<= 8%) vs ALERT (> 8%)', () => {
        const alertDev = computeDeviationMetrics(
            { heightM: 0.37, diameterM: 0.24, volumeM3: 0.021 },
            { realHeightM: 0.54, realDiameterM: 0.33, realVolumeM3: 0.04619 }
        );
        expect(alertDev.deltaVolumePct).toBeCloseTo(-54.54, 1);
        expect(alertDev.deltaHeightPct).toBeCloseTo(-31.48, 1);
        expect(alertDev.maxAbsDeltaPct).toBeCloseTo(54.54, 1);
        expect(alertDev.statusBand).toBe('ALERT');

        const optimalDev = computeClientDeviationMetrics(
            { heightM: 0.53, baseLengthM: 0.34, baseWidthM: 0.32, volumeM3: 0.045 },
            { realHeightM: 0.54, realDiameterM: 0.33, realVolumeM3: 0.04619 }
        );
        expect(optimalDev.deltaVolumePct).toBeCloseTo(-2.58, 1);
        expect(optimalDev.statusBand).toBe('OPTIMAL');
    });

    it('LOOCV: excluye isEduSandbox, descarta outliers z_MAD > 3.5, exige N >= 3 y crea perfil DRAFT acotado con mejora verificada', () => {
        // 4 muestras con sesgo sistemático ~-10% (real/est ~ 1.11) + 1 outlier extremo (ratio 4.5) + 2 registros EDU
        const records: GroundTruthRecord[] = [
            makeGtRecord({ id: '1', estV: 9.0, realV: 10.0, estH: 1.82, realH: 2.0, estL: 3.8, realL: 4.0 }),
            makeGtRecord({ id: '2', estV: 18.1, realV: 20.0, estH: 2.71, realH: 3.0, estL: 4.75, realL: 5.0 }),
            makeGtRecord({ id: '3', estV: 26.8, realV: 30.0, estH: 3.62, realH: 4.0, estL: 5.7, realL: 6.0 }),
            makeGtRecord({ id: '4', estV: 45.2, realV: 50.0, estH: 4.55, realH: 5.0, estL: 7.6, realL: 8.0 }),
            makeGtRecord({ id: 'outlier', estV: 10.0, realV: 45.0 }),
            makeGtRecord({ id: 'edu-1', estV: 5.0, realV: 25.0, isEduSandbox: true }),
            makeGtRecord({ id: 'edu-2', estV: 8.0, realV: 32.0, isEduSandbox: true }),
        ];

        const profile = recomputeCalibrationProfileLOOCV(records, {
            tenantId: 'tenant-atacama-01',
            deviceModel: 'Samsung SM-G556B',
        });

        expect(CalibrationProfileSchema.safeParse(profile).success).toBe(true);
        expect(profile.status).toBe('DRAFT');
        expect(profile.sampleCount).toBe(4);
        expect(profile.outliersExcluded).toBe(1);
        expect(profile.volumeScaleFactor).toBeGreaterThanOrEqual(0.75);
        expect(profile.volumeScaleFactor).toBeLessThanOrEqual(1.25);
        expect(profile.volumeScaleFactor).toBeCloseTo(1.11, 1);
        expect(profile.heightScaleFactor).toBeGreaterThanOrEqual(0.8);
        expect(profile.heightScaleFactor).toBeLessThanOrEqual(1.2);
        expect(profile.loocvMetrics.improved).toBe(true);
        expect(profile.loocvMetrics.calibratedMapePct).toBeLessThan(profile.loocvMetrics.rawMapePct);
    });

    it('LOOCV: exige N >= 3 registros válidos (excluyendo EDU) y activa guardrail improved=false si no mejora', () => {
        const tooFew = [
            makeGtRecord({ id: 'a', estV: 10, realV: 11 }),
            makeGtRecord({ id: 'b', estV: 20, realV: 22 }),
            makeGtRecord({ id: 'edu', estV: 10, realV: 11, isEduSandbox: true }),
        ];
        expect(() =>
            recomputeCalibrationProfileLOOCV(tooFew, { tenantId: 'tenant-atacama-01' })
        ).toThrow(CalibrationInsufficientSamplesError);

        // Muestras sin sesgo sistemático (errores alternados +5% / -5% / +5%): calibración escalar NO reduce MAPE out-of-sample
        const alternatingNoise = [
            makeGtRecord({ id: 'n1', estV: 10.5, realV: 10.0 }),
            makeGtRecord({ id: 'n2', estV: 9.5, realV: 10.0 }),
            makeGtRecord({ id: 'n3', estV: 10.5, realV: 10.0 }),
            makeGtRecord({ id: 'n4', estV: 9.5, realV: 10.0 }),
        ];
        const noImprove = recomputeCalibrationProfileLOOCV(alternatingNoise, {
            tenantId: 'tenant-atacama-01',
        });
        expect(noImprove.status).toBe('DRAFT');
        expect(noImprove.loocvMetrics.improved).toBe(false);
    });

    it('diagnóstico IA soberano degrada determinísticamente sin PII cuando el enjambre no está disponible', async () => {
        const diag = await generateSovereignAiCalibrationDiagnosis({
            tenantId: 'tenant-atacama-01',
            deviceModel: 'Samsung SM-G556B',
            sampleCount: 4,
            outliersExcluded: 1,
            volumeScaleFactor: 1.11,
            heightScaleFactor: 1.09,
            baseScaleFactor: 1.05,
            rawMapePct: 9.8,
            calibratedMapePct: 1.2,
            rmsePct: 1.4,
            biasPct: -0.2,
            improved: true,
        });
        expect(diag.deterministicFallback).toBe(true);
        expect(diag.recommendedAction).toBe('ACTIVATE_PROFILE');
        expect(diag.rootCauses.length).toBeGreaterThan(0);
    });

    it('verifica paridad 100% de llaves i18n es/en/pt en geolapp/i18n/locales', () => {
        const esKeys = flattenKeys(esLocale as unknown as Record<string, unknown>);
        const enKeys = flattenKeys(enLocale as unknown as Record<string, unknown>);
        const ptKeys = flattenKeys(ptLocale as unknown as Record<string, unknown>);
        expect(enKeys).toEqual(esKeys);
        expect(ptKeys).toEqual(esKeys);
    });
});

describe('Sprint 3 — UI Móvil, Escritorio Solo Lectura, Navegación DesktopShell y HITL "ACTUALIZAR"', () => {
    const sampleProfile: CalibrationProfile = {
        profileId: 'calprof_test_01',
        tenantId: 'tenant-atacama-01',
        deviceModel: 'Samsung SM-G556B',
        status: 'DRAFT',
        sampleCount: 4,
        outliersExcluded: 0,
        volumeScaleFactor: 1.105,
        heightScaleFactor: 1.04,
        baseScaleFactor: 1.02,
        loocvMetrics: {
            rawMapePct: 9.6,
            calibratedMapePct: 1.8,
            rmsePct: 2.1,
            biasPct: -0.3,
            improved: true,
        },
        aiDiagnosis: {
            summary: 'LOOCV mejora MAPE de 9.6% a 1.8%.',
            rootCauses: ['Subestimación sistemática de volumen (factor ×1.1050).'],
            recommendedAction: 'ACTIVATE_PROFILE',
            modelUsed: 'DETERMINISTIC_LOOCV_ENGINE',
            generatedAt: 1700000005000,
            deterministicFallback: true,
        },
        createdAt: 1700000005000,
        region: 'southamerica-west1',
    };

    const sampleGt = makeGtRecord({ id: 'gt-1', estV: 0.045, realV: 0.0462, estH: 0.54, realH: 0.54 });

    beforeEach(() => {
        vi.spyOn(SpatialScannerServiceMod, 'fetchDeviceCalibrationHistory').mockResolvedValue([]);
        vi.spyOn(GroundTruthServiceMod, 'fetchGroundTruthRecords').mockResolvedValue({
            records: [sampleGt],
            summary: computeAggregateDeviationSummary([sampleGt]),
        });
        vi.spyOn(GroundTruthServiceMod, 'fetchCalibrationProfiles').mockResolvedValue([sampleProfile]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('MobileCalibrationView: renderiza 3 tabs Icon-First (compass_calibration, straighten, psychology) y exige HITL "ACTUALIZAR" al activar perfil', async () => {
        const activateSpy = vi
            .spyOn(GroundTruthServiceMod, 'activateCalibrationProfileHitl')
            .mockResolvedValue({ ...sampleProfile, status: 'ACTIVE' });

        render(
            React.createElement(MobileCalibrationView, {
                tenantId: 'tenant-atacama-01',
                assets: [SAMPLE_ASSET],
                measurements: [SAMPLE_MEASUREMENT],
            })
        );

        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(3);

        // Cambiar a tab straighten (Medidas reales & desviaciones)
        fireEvent.click(tabs[1]);
        await waitFor(() => {
            expect(screen.getByText(/AC-9723/)).toBeTruthy();
        });

        // Cambiar a tab psychology (LOOCV + IA)
        fireEvent.click(tabs[2]);
        await waitFor(() => {
            expect(screen.getByText(/LOOCV mejora MAPE/)).toBeTruthy();
        });

        // Abrir compuerta HITL para activar perfil DRAFT -> ACTIVE
        fireEvent.click(screen.getByRole('button', { name: /ACTIVAR PERFIL/i }));
        const keywordInput = await screen.findByPlaceholderText('ACTUALIZAR');
        const confirmBtn = screen.getByRole('button', { name: /CONFIRMAR/i });
        expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

        fireEvent.change(keywordInput, { target: { value: 'ACTUALIZAR' } });
        expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(activateSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    profileId: 'calprof_test_01',
                    hitlConfirmation: 'ACTUALIZAR',
                })
            );
        });
    });

    it('DesktopCalibrationAuditView: renderiza tabs straighten/psychology en modo 100% SOLO LECTURA (sin botones de mutación)', async () => {
        render(
            React.createElement(DesktopCalibrationAuditView, {
                assets: [SAMPLE_ASSET],
                measurements: [SAMPLE_MEASUREMENT],
            })
        );

        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(3);

        fireEvent.click(tabs[1]);
        await waitFor(() => {
            expect(screen.getByText('AC-9723')).toBeTruthy();
        });
        expect(screen.queryByText(/CONFIRMAR CONTRASTE/i)).toBeNull();

        fireEvent.click(tabs[2]);
        await waitFor(() => {
            expect(screen.getByText(/LOOCV mejora MAPE/)).toBeTruthy();
        });
        expect(screen.queryByText(/RECOMPUTAR LOOCV/i)).toBeNull();
        expect(screen.queryByText(/ACTIVAR PERFIL \(HITL\)/i)).toBeNull();
    });

    it('DesktopShell: corrige los 4 bugs de navegación de CALIBRATIONS (breadcrumb, aria-pressed y retorno vía landscape/arrow_back)', async () => {
        render(
            React.createElement(DesktopShell, {
                assets: [SAMPLE_ASSET],
                measurements: [SAMPLE_MEASUREMENT],
            })
        );

        const calBtn = screen.getByRole('button', { name: /AUDITORÍA DE CALIBRACIONES DE CAMPO/i });
        const dirBtn = screen.getByRole('button', { name: /Faenas y acopios/i });

        fireEvent.click(calBtn);
        expect(calBtn.getAttribute('aria-pressed')).toBe('true');
        expect(dirBtn.getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByText('CALIBRACIÓN')).toBeTruthy();

        // Salir usando botón landscape (antes dejaba atrapado al usuario)
        fireEvent.click(dirBtn);
        expect(dirBtn.getAttribute('aria-pressed')).toBe('true');
        expect(calBtn.getAttribute('aria-pressed')).toBe('false');

        // Re-entrar y salir usando arrow_back
        fireEvent.click(calBtn);
        const backBtn = screen.getByRole('button', { name: /Volver/i });
        fireEvent.click(backBtn);
        expect(dirBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('MeasurementDetail móvil: abre contraste real (straighten) en Modo Informe -> Edición Quirúrgica y exige "ACTUALIZAR"', async () => {
        const submitSpy = vi
            .spyOn(GroundTruthServiceMod, 'submitMeasurementGroundTruth')
            .mockResolvedValue({ record: sampleGt, queuedOffline: false });

        render(
            React.createElement(MeasurementDetail, {
                measurement: SAMPLE_MEASUREMENT,
                asset: SAMPLE_ASSET,
                isMobileField: true,
                onBack: vi.fn(),
            })
        );

        fireEvent.click(screen.getByRole('button', { name: /Contraste con medidas reales/i }));
        await waitFor(() => {
            expect(screen.getByText(/INFORME DE CONTRASTE/i)).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: /EDITAR BLOQUE/i }));
        const volInput = screen.getByLabelText(/VOLUMEN V/i);
        fireEvent.change(volInput, { target: { value: '0.0462' } });

        fireEvent.click(screen.getByRole('button', { name: /CONFIRMAR CONTRASTE/i }));
        const keywordInput = await screen.findByPlaceholderText('ACTUALIZAR');
        fireEvent.change(keywordInput, { target: { value: 'ACTUALIZAR' } });
        const dialog = screen.getByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /^CONFIRMAR$/i }));

        await waitFor(() => {
            expect(submitSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    assetId: 'asset-01',
                    measurementId: 'meas-01',
                    input: expect.objectContaining({
                        hitlConfirmation: 'ACTUALIZAR',
                        realVolumeM3: 0.0462,
                    }),
                })
            );
        });
    });
});
