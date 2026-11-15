import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import M3CircularProgress from '../../../components/common/M3CircularProgress';
import SecureImage from '../../../components/common/SecureImage';
import { calculationEngine } from '../core/services/calculation-engine';
import { dataService } from '../core/services/DataService';
import { storageService } from '../core/services/StorageService';
import { useImuClinometer } from '../core/hooks/useImuClinometer';
import type {
    CopperGovernanceResult,
    CopperMineralDomain,
    GeolappGeometryType,
} from '../core/types/GeolappTypes';

export type CopperDomainCode = CopperMineralDomain;

export const COPPER_DOMAIN_OPTIONS: Array<{
    value: CopperDomainCode;
    labelKey: string;
    fallbackLabel: string;
    legacyClase: 'mineral' | 'baja_ley' | 'esteril';
}> = [
    { value: 'OXIDO_CU', labelKey: 'copper_domains.OXIDO_CU', fallbackLabel: 'Óxido Cu', legacyClase: 'mineral' },
    { value: 'MIXTO_CU', labelKey: 'copper_domains.MIXTO_CU', fallbackLabel: 'Mixto Cu', legacyClase: 'mineral' },
    { value: 'SULFURO_SECUNDARIO_CU', labelKey: 'copper_domains.SULFURO_SECUNDARIO_CU', fallbackLabel: 'Sulfuro Sec.', legacyClase: 'mineral' },
    { value: 'SULFURO_PRIMARIO_CU', labelKey: 'copper_domains.SULFURO_PRIMARIO_CU', fallbackLabel: 'Sulfuro Prim.', legacyClase: 'mineral' },
    { value: 'CONCENTRADO_CU', labelKey: 'copper_domains.CONCENTRADO_CU', fallbackLabel: 'Concentrado Cu', legacyClase: 'mineral' },
    { value: 'BAJA_LEY_CU', labelKey: 'copper_domains.BAJA_LEY_CU', fallbackLabel: 'Baja Ley Cu', legacyClase: 'baja_ley' },
    { value: 'ESTERIL_RIPIOS', labelKey: 'copper_domains.ESTERIL_RIPIOS', fallbackLabel: 'Estéril / Ripios', legacyClase: 'esteril' },
];

export function mapCopperDomainToClase(domain?: CopperDomainCode | null): 'mineral' | 'baja_ley' | 'esteril' {
    const match = COPPER_DOMAIN_OPTIONS.find((opt) => opt.value === domain);
    return match ? match.legacyClase : 'mineral';
}

export function getCopperDomainLabel(domain?: string | null): string | null {
    const match = COPPER_DOMAIN_OPTIONS.find((opt) => opt.value === domain);
    return match ? match.fallbackLabel : null;
}

export interface CasTelemetryMetrics {
    originalBytes: number;
    optimizedBytes: number;
    savingsPct: number;
    confirmed: boolean;
}

export function formatCasSize(bytes: number): string {
    const safeBytes = Math.max(0, Math.round(bytes));
    if (safeBytes < 1024) {
        return `${safeBytes} B`;
    }
    const kb = safeBytes / 1024;
    return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1).replace(/\.0$/, '')} KB`;
}

export function computeCasMetrics(
    originalBytes: number,
    optimizedBytes: number,
    explicitSavingsPct?: number,
    confirmed: boolean = false
): CasTelemetryMetrics {
    const safeOrig = Math.max(0, Math.round(originalBytes));
    const safeOpt = Math.max(0, Math.round(optimizedBytes));
    const savingsPct =
        typeof explicitSavingsPct === 'number' && Number.isFinite(explicitSavingsPct)
            ? Math.max(0, Math.min(100, Number(explicitSavingsPct.toFixed(1))))
            : safeOrig > 0
            ? Math.max(0, Math.round((1 - safeOpt / safeOrig) * 1000) / 10)
            : 0;
    return {
        originalBytes: safeOrig,
        optimizedBytes: safeOpt,
        savingsPct,
        confirmed,
    };
}

export function dataUrlToBlob(dataUrl: string): Blob {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) {
        throw new Error('DataURL inválido');
    }
    const header = dataUrl.slice(0, commaIdx);
    const body = dataUrl.slice(commaIdx + 1);
    const mimeMatch = header.match(/data:([^;]+)/i);
    const mimeType = mimeMatch?.[1] || 'image/jpeg';

    if (/;base64/i.test(header)) {
        const binary = atob(body);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mimeType });
    }
    return new Blob([decodeURIComponent(body)], { type: mimeType });
}

export function sanitizeDecimalText(raw: string, allowNegative: boolean = false): string {
    const signPrefix = allowNegative && raw.trimStart().startsWith('-') ? '-' : '';
    const normalized = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const firstDot = normalized.indexOf('.');
    const unsigned =
        firstDot === -1
            ? normalized
            : normalized.slice(0, firstDot + 1) + normalized.slice(firstDot + 1).replace(/\./g, '');
    return signPrefix + unsigned;
}

export function parseOptionalNonNegative(raw: string, maxValue?: number): number | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const num = Number.parseFloat(trimmed);
    if (!Number.isFinite(num) || num < 0) return undefined;
    if (typeof maxValue === 'number' && num > maxValue) return undefined;
    return num;
}

export interface CopperMetallurgyResult {
    wetWeightThm?: number;
    dryWeightTms?: number;
    fineCuT?: number;
    moisturePct?: number;
    tmlLimitPct?: number;
    residenceDays?: number;
    cuTotalPct?: number;
    cuSolublePct?: number;
}

export function computeCopperMetallurgy(params: {
    volumeM3: number;
    densityFactor?: number;
    moistureRaw: string;
    cuTotalRaw: string;
    cuSolubleRaw: string;
    tmlLimitRaw?: string;
    residenceDaysRaw?: string;
}): CopperMetallurgyResult {
    const rawMoisture = parseOptionalNonNegative(params.moistureRaw);
    const moisturePct =
        typeof rawMoisture === 'number' && rawMoisture >= 0 && rawMoisture < 100
            ? rawMoisture
            : undefined;
    const rawTml = params.tmlLimitRaw ? parseOptionalNonNegative(params.tmlLimitRaw) : undefined;
    const tmlLimitPct =
        typeof rawTml === 'number' && rawTml >= 0 && rawTml < 100 ? rawTml : undefined;
    const residenceDays = params.residenceDaysRaw
        ? parseOptionalNonNegative(params.residenceDaysRaw)
        : undefined;
    const cuTotalPct = parseOptionalNonNegative(params.cuTotalRaw, 100);
    const cuSolublePct = parseOptionalNonNegative(params.cuSolubleRaw, 100);

    const hasMassInputs =
        Number.isFinite(params.volumeM3) &&
        params.volumeM3 > 0 &&
        typeof params.densityFactor === 'number' &&
        Number.isFinite(params.densityFactor) &&
        params.densityFactor > 0;

    const wetWeightThm = hasMassInputs
        ? Number((params.volumeM3 * (params.densityFactor as number)).toFixed(3))
        : undefined;

    const dryWeightTms =
        typeof wetWeightThm === 'number' && typeof moisturePct === 'number'
            ? Number((wetWeightThm * (1 - moisturePct / 100)).toFixed(3))
            : undefined;

    const fineCuT =
        typeof dryWeightTms === 'number' && typeof cuTotalPct === 'number'
            ? Number(((dryWeightTms * cuTotalPct) / 100).toFixed(4))
            : undefined;

    return {
        wetWeightThm,
        dryWeightTms,
        fineCuT,
        moisturePct,
        tmlLimitPct,
        residenceDays,
        cuTotalPct,
        cuSolublePct,
    };
}

export function validateCopperAssayInputs(
    moistureRaw: string,
    cuTotalRaw: string,
    cuSolubleRaw: string,
    tmlLimitRaw: string = '',
    residenceDaysRaw: string = ''
): string | null {
    const m = parseOptionalNonNegative(moistureRaw);
    if (moistureRaw.trim() !== '' && (m === undefined || m >= 100)) {
        return 'Humedad w% debe ser un valor numérico menor a 100%.';
    }
    const tml = parseOptionalNonNegative(tmlLimitRaw);
    if (tmlLimitRaw.trim() !== '' && (tml === undefined || tml >= 100)) {
        return 'TML % debe ser un valor numérico menor a 100%.';
    }
    const resDays = parseOptionalNonNegative(residenceDaysRaw);
    if (residenceDaysRaw.trim() !== '' && resDays === undefined) {
        return 'Días de residencia debe ser un valor numérico no negativo.';
    }
    const cuT = parseOptionalNonNegative(cuTotalRaw);
    if (cuTotalRaw.trim() !== '' && (cuT === undefined || cuT > 100)) {
        return 'CuT % debe estar entre 0 y 100%.';
    }
    const cuS = parseOptionalNonNegative(cuSolubleRaw);
    if (cuSolubleRaw.trim() !== '' && (cuS === undefined || cuS > 100)) {
        return 'CuS % debe estar entre 0 y 100%.';
    }
    return null;
}

export interface InlineStatusMessage {
    severity: 'warning' | 'error' | 'info';
    text: string;
}

export const InlineStatusBanner: React.FC<{
    status: InlineStatusMessage | null;
    onDismiss: () => void;
}> = ({ status, onDismiss }) => {
    const { t } = useTranslation();
    if (!status) return null;

    const palette =
        status.severity === 'error'
            ? 'bg-red-50 dark:bg-red-950/30 border-red-600 dark:border-red-500 text-red-700 dark:text-red-300'
            : status.severity === 'info'
            ? 'bg-[#00AEEF]/10 border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6]'
            : 'bg-[#C68346]/10 border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]';

    const icon =
        status.severity === 'error' ? 'error' : status.severity === 'info' ? 'info' : 'warning';

    return (
        <div
            role="alert"
            aria-live="polite"
            className={`border rounded-none shadow-none px-fib-13 py-fib-13 flex items-center justify-between gap-fib-13 ${palette}`}
        >
            <div className="flex items-start gap-fib-8 min-w-0">
                <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">{icon}</span>
                <span className="text-data-dense font-mono leading-snug select-text">{status.text}</span>
            </div>
            <button
                type="button"
                onClick={onDismiss}
                aria-label={t('common.close_button', 'Cerrar')}
                title={t('common.close_button', 'Cerrar')}
                className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer shrink-0"
            >
                <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
        </div>
    );
};

export const CasTelemetryBadge: React.FC<{
    metrics: CasTelemetryMetrics | null;
    origBytesFallback?: number;
}> = ({ metrics, origBytesFallback }) => {
    const { t } = useTranslation();
    if (!metrics && !(origBytesFallback && origBytesFallback > 0)) return null;
    return (
        <div className="px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex items-center justify-between gap-fib-8">
            <span className="text-microcopy font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                {t('capture.cas_trace_label', 'TRAZABILIDAD CAS')}
            </span>
            <span className="text-data-dense font-mono tabular-nums font-bold text-[#00AEEF] select-text">
                {metrics
                    ? `ORIG ${formatCasSize(metrics.originalBytes)} -> CAS ${formatCasSize(metrics.optimizedBytes)} (-${metrics.savingsPct.toFixed(1)}%)`
                    : `ORIG ${formatCasSize(origBytesFallback || 0)} -> CAS ${t('common.pending_record', '[Pendiente de registro]')}`}
            </span>
        </div>
    );
};

export const CopperDomainSelector: React.FC<{
    value?: CopperDomainCode;
    onChange: (domain: CopperDomainCode | undefined) => void;
}> = ({ value, onChange }) => {
    const { t } = useTranslation();
    const activeClase = value ? mapCopperDomainToClase(value) : null;
    return (
        <div className="space-y-fib-8">
            <div className="flex items-center justify-between gap-fib-8">
                <span className="text-microcopy font-bold uppercase tracking-[0.2em] text-[#475569] dark:text-[#8A93A6]">
                    {t('registration.copper_domain_label', 'DOMINIO MINERAL Cu')}
                </span>
                <span className="text-microcopy font-mono font-bold uppercase text-[#00AEEF]">
                    {activeClase
                        ? `${t('manual_capture.legacy_class_prefix', 'CLASE')}: ${t(`material_type.${activeClase}`)}`
                        : t('common.pending_record', '[Pendiente de registro]')}
                </span>
            </div>
            <div className="grid grid-cols-2 gap-fib-8">
                {COPPER_DOMAIN_OPTIONS.map((opt) => {
                    const selected = value === opt.value;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => onChange(selected ? undefined : opt.value)}
                            className={`min-h-[55px] px-fib-13 py-fib-8 rounded-none shadow-none border text-left flex flex-col justify-center transition-colors cursor-pointer ${
                                selected
                                    ? 'bg-[#C68346] text-[#FFFFFF] border-[#C68346]'
                                    : 'bg-[#F8FAFC] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346]'
                            }`}
                        >
                            <span className="text-data-dense font-bold uppercase leading-tight">
                                {t(opt.labelKey, opt.fallbackLabel)}
                            </span>
                            <span
                                className={`text-microcopy font-mono uppercase tracking-wider leading-tight ${
                                    selected ? 'text-[#FFFFFF]/80' : 'text-[#475569] dark:text-[#8A93A6]'
                                }`}
                            >
                                {opt.value}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export const CopperGovernanceBanner: React.FC<{
    result: CopperGovernanceResult;
}> = ({ result }) => {
    const { t } = useTranslation();
    if (!result.alerts || result.alerts.length === 0) return null;

    return (
        <div className="space-y-fib-8" role="alert" aria-live="polite">
            {result.alerts.map((alert) => {
                const isSevere = alert.severity === 'BLOCK' || alert.severity === 'CRITICAL';
                const cardClass = isSevere
                    ? 'bg-red-50 dark:bg-red-950/30 border-red-600 dark:border-red-500 text-red-700 dark:text-red-300'
                    : 'bg-[#C68346]/10 border-[#C68346] text-[#0F172A] dark:text-[#F3F4F6]';
                const iconName =
                    alert.severity === 'BLOCK'
                        ? 'gpp_bad'
                        : alert.severity === 'CRITICAL'
                        ? 'error'
                        : 'warning';

                const localizedAlertMessage =
                    alert.code === 'SULFIDE_AGING_WARNING'
                        ? t('copper_governance.sulfide_warning_14d', alert.message)
                        : alert.code === 'SULFIDE_AGING_CRITICAL'
                        ? t('copper_governance.sulfide_critical_30d', alert.message)
                        : alert.code === 'CONCENTRATE_TML_EXCEEDED'
                        ? t('copper_governance.concentrate_tml_block', alert.message)
                        : alert.message;

                return (
                    <div
                        key={alert.code}
                        className={`p-fib-13 border rounded-none shadow-none space-y-fib-8 ${cardClass}`}
                    >
                        <div className="flex items-center justify-between gap-fib-8">
                            <div className="flex items-center gap-fib-8">
                                <span className="material-symbols-outlined text-[18px]">{iconName}</span>
                                <span className="text-microcopy font-mono font-bold uppercase tracking-wider">
                                    {alert.code}
                                </span>
                            </div>
                            <span className="text-microcopy font-mono font-bold uppercase">
                                {alert.severity}
                            </span>
                        </div>
                        <p className="text-data-dense font-mono leading-snug select-text">
                            {localizedAlertMessage}
                        </p>
                    </div>
                );
            })}
            {!result.isValidForDispatch && (
                <div className="px-fib-13 py-fib-8 bg-red-600 text-[#FFFFFF] rounded-none shadow-none text-microcopy font-mono font-bold uppercase tracking-wider">
                    {t(
                        'copper_governance.dispatch_blocked',
                        'BLOQUEO OPERATIVO IMSBC: DESPACHO NO AUTORIZADO (w% >= TML%)'
                    )}
                </div>
            )}
        </div>
    );
};

export const CopperAssayInputs: React.FC<{
    idPrefix: string;
    moisturePct: string;
    cuTotalPct: string;
    cuSolublePct: string;
    onMoistureChange: (v: string) => void;
    onCuTotalChange: (v: string) => void;
    onCuSolubleChange: (v: string) => void;
    tmlLimitPct?: string;
    residenceDays?: string;
    onTmlLimitChange?: (v: string) => void;
    onResidenceDaysChange?: (v: string) => void;
    copperDomain?: CopperDomainCode;
    metallurgy?: CopperMetallurgyResult;
    showMassBreakdown?: boolean;
}> = ({
    idPrefix,
    moisturePct,
    cuTotalPct,
    cuSolublePct,
    onMoistureChange,
    onCuTotalChange,
    onCuSolubleChange,
    tmlLimitPct = '',
    residenceDays = '',
    onTmlLimitChange,
    onResidenceDaysChange,
    copperDomain,
    metallurgy,
    showMassBreakdown = true,
}) => {
    const { t } = useTranslation();
    const undeclaredLabel = t(
        'core_common.undeclared_tech_value',
        '[Información técnica no declarada en ficha]'
    );

    const rawMoisture = parseOptionalNonNegative(moisturePct);
    const rawTml = parseOptionalNonNegative(tmlLimitPct);
    const rawCuT = parseOptionalNonNegative(cuTotalPct);
    const rawCuS = parseOptionalNonNegative(cuSolublePct);
    const moistureInvalid = typeof rawMoisture === 'number' && rawMoisture >= 100;
    const tmlInvalid = typeof rawTml === 'number' && rawTml >= 100;
    const cuTInvalid = typeof rawCuT === 'number' && rawCuT > 100;
    const cuSInvalid = typeof rawCuS === 'number' && rawCuS > 100;
    const cuSExceedsCuT =
        typeof rawCuT === 'number' &&
        typeof rawCuS === 'number' &&
        rawCuT <= 100 &&
        rawCuS <= 100 &&
        rawCuS > rawCuT;

    const showGovernanceRow = Boolean(onTmlLimitChange || onResidenceDaysChange);
    const isConcentrate = copperDomain === 'CONCENTRADO_CU';
    const isSulfide =
        copperDomain === 'SULFURO_SECUNDARIO_CU' || copperDomain === 'SULFURO_PRIMARIO_CU';

    return (
        <div className="space-y-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none p-fib-13">
            <div className="flex items-center justify-between gap-fib-8">
                <span className="text-microcopy font-bold uppercase tracking-[0.2em] text-[#475569] dark:text-[#8A93A6]">
                    {t('manual_capture.metallurgy_title', 'PARÁMETROS METALÚRGICOS Cu (OPCIONAL)')}
                </span>
            </div>

            <div className="grid grid-cols-3 gap-fib-8">
                <div className="flex flex-col gap-fib-8">
                    <label
                        htmlFor={`${idPrefix}-moisture`}
                        className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] uppercase"
                    >
                        {t('manual_capture.fields.moisture_pct', 'HUMEDAD w%')}
                    </label>
                    <input
                        id={`${idPrefix}-moisture`}
                        type="text"
                        inputMode="decimal"
                        value={moisturePct}
                        onChange={(e) => onMoistureChange(sanitizeDecimalText(e.target.value))}
                        placeholder="0.0"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full min-h-[55px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-body-main font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                    />
                </div>
                <div className="flex flex-col gap-fib-8">
                    <label
                        htmlFor={`${idPrefix}-cut`}
                        className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] uppercase"
                    >
                        {t('manual_capture.fields.cu_total_pct', 'CuT %')}
                    </label>
                    <input
                        id={`${idPrefix}-cut`}
                        type="text"
                        inputMode="decimal"
                        value={cuTotalPct}
                        onChange={(e) => onCuTotalChange(sanitizeDecimalText(e.target.value))}
                        placeholder="0.00"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full min-h-[55px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-body-main font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                    />
                </div>
                <div className="flex flex-col gap-fib-8">
                    <label
                        htmlFor={`${idPrefix}-cus`}
                        className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] uppercase"
                    >
                        {t('manual_capture.fields.cu_soluble_pct', 'CuS %')}
                    </label>
                    <input
                        id={`${idPrefix}-cus`}
                        type="text"
                        inputMode="decimal"
                        value={cuSolublePct}
                        onChange={(e) => onCuSolubleChange(sanitizeDecimalText(e.target.value))}
                        placeholder="0.00"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full min-h-[55px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-body-main font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                    />
                </div>
            </div>

            {showGovernanceRow && (
                <div className="grid grid-cols-2 gap-fib-8 pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
                    {onTmlLimitChange && (
                        <div className="flex flex-col gap-fib-8">
                            <label
                                htmlFor={`${idPrefix}-tml`}
                                className={`text-microcopy font-bold uppercase ${
                                    isConcentrate ? 'text-[#C68346]' : 'text-[#475569] dark:text-[#8A93A6]'
                                }`}
                            >
                                {t('manual_capture.fields.tml_pct', 'TML (%)')}
                            </label>
                            <input
                                id={`${idPrefix}-tml`}
                                type="text"
                                inputMode="decimal"
                                value={tmlLimitPct}
                                onChange={(e) => onTmlLimitChange(sanitizeDecimalText(e.target.value))}
                                placeholder="0.0"
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full min-h-[55px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-body-main font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                            />
                        </div>
                    )}
                    {onResidenceDaysChange && (
                        <div className="flex flex-col gap-fib-8">
                            <label
                                htmlFor={`${idPrefix}-residence`}
                                className={`text-microcopy font-bold uppercase ${
                                    isSulfide ? 'text-[#C68346]' : 'text-[#475569] dark:text-[#8A93A6]'
                                }`}
                            >
                                {t('manual_capture.fields.residence_days', 'DÍAS RESIDENCIA')}
                            </label>
                            <input
                                id={`${idPrefix}-residence`}
                                type="text"
                                inputMode="decimal"
                                value={residenceDays}
                                onChange={(e) => onResidenceDaysChange(sanitizeDecimalText(e.target.value))}
                                placeholder="0"
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full min-h-[55px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-body-main font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                            />
                        </div>
                    )}
                </div>
            )}

            {(moistureInvalid || tmlInvalid || cuTInvalid || cuSInvalid || cuSExceedsCuT) && (
                <div className="space-y-1 text-microcopy font-mono text-[#C68346]">
                    {moistureInvalid && (
                        <p>{t('manual_capture.err_moisture_max', 'Humedad w% debe ser menor a 100%.')}</p>
                    )}
                    {tmlInvalid && (
                        <p>{t('copper_governance.err_tml_max', 'TML % debe ser menor a 100%.')}</p>
                    )}
                    {cuTInvalid && <p>{t('manual_capture.err_cut_max', 'CuT % no puede superar 100%.')}</p>}
                    {cuSInvalid && <p>{t('manual_capture.err_cus_max', 'CuS % no puede superar 100%.')}</p>}
                    {cuSExceedsCuT && (
                        <p>{t('manual_capture.warn_cus_gt_cut', 'Aviso técnico: CuS % declarado supera CuT %.')}</p>
                    )}
                </div>
            )}

            {showMassBreakdown && metallurgy && (
                <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-fib-8">
                    <div className="flex items-baseline justify-between gap-fib-13">
                        <span className="text-microcopy font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('copper_governance.thm', 'THM [t]')}
                        </span>
                        <span className="text-data-dense font-mono tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6] text-right">
                            {typeof metallurgy.wetWeightThm === 'number'
                                ? `${metallurgy.wetWeightThm.toFixed(2)} t`
                                : undeclaredLabel}
                        </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-fib-13">
                        <span className="text-microcopy font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('copper_governance.tms', 'TMS [t]')}
                        </span>
                        <span className="text-data-dense font-mono tabular-nums font-bold text-[#00AEEF] text-right">
                            {typeof metallurgy.dryWeightTms === 'number'
                                ? `${metallurgy.dryWeightTms.toFixed(2)} t`
                                : undeclaredLabel}
                        </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-fib-13">
                        <span className="text-microcopy font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('copper_governance.fine_cu', 'Cu FINO [t]')}
                        </span>
                        <span className="text-data-dense font-mono tabular-nums font-bold text-[#C68346] text-right">
                            {typeof metallurgy.fineCuT === 'number'
                                ? `${metallurgy.fineCuT.toFixed(3)} t`
                                : undeclaredLabel}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

interface AppliedImuTelemetry {
    imu_pitch_deg: number;
    imu_height_m: number;
    imu_distance_m: number;
    imu_eye_height_m: number;
}

interface ManualCaptureProps {
    assetId: string;
    initialGeometry: GeolappGeometryType;
    onSuccess: (measurementId: string) => void;
    onBack: () => void;
    hidePhoto?: boolean;
    initialPhotoUrl?: string;
}

const EYE_HEIGHT_PRESETS = ['1.55', '1.65', '1.75', '0.00'] as const;

export const ManualCapture: React.FC<ManualCaptureProps> = ({
    assetId,
    initialGeometry,
    onSuccess,
    onBack,
    hidePhoto = false,
    initialPhotoUrl,
}) => {
    const { t } = useTranslation();
    const [geometria] = useState<GeolappGeometryType>(initialGeometry);
    const [dimensions, setDimensions] = useState({
        a: '',
        b: '',
        h: '',
        ap: '',
        bp: '',
        p: '',
        pp: '',
        baseLengthM: '',
        baseWidthM: '',
        crestLengthM: '',
        crestWidthM: '',
        wallLengthM: '',
        wallWidthM: '',
        wallAngleDeg: '',
    });
    const [density, setDensity] = useState('');
    const [copperDomain, setCopperDomain] = useState<CopperDomainCode | undefined>(undefined);
    const [moisturePct, setMoisturePct] = useState('');
    const [tmlLimitPct, setTmlLimitPct] = useState('');
    const [residenceDays, setResidenceDays] = useState('');
    const [cuTotalPct, setCuTotalPct] = useState('');
    const [cuSolublePct, setCuSolublePct] = useState('');

    // Clinómetro IMU Offline
    const clinometer = useImuClinometer();
    const [operatorEyeHeightM, setOperatorEyeHeightM] = useState('');
    const [horizontalDistanceM, setHorizontalDistanceM] = useState('');
    const [appliedImu, setAppliedImu] = useState<AppliedImuTelemetry | null>(null);

    const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [casMetrics, setCasMetrics] = useState<CasTelemetryMetrics | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [statusMessage, setStatusMessage] = useState<InlineStatusMessage | null>(null);
    const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const objectUrlsRef = useRef<Set<string>>(new Set());
    const captureTokenRef = useRef(0);

    const createTrackedObjectUrl = useCallback((blob: Blob) => {
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.add(url);
        return url;
    }, []);

    const revokeTrackedObjectUrl = useCallback((url?: string | null) => {
        if (url && url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
            objectUrlsRef.current.delete(url);
        }
    }, []);

    useEffect(() => {
        const initGps = async () => {
            try {
                const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 5000 });
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
                    setGps({ lat, lng, acc: pos.coords.accuracy });
                }
            } catch (err) {
                console.warn('[ManualCapture] GPS Error:', err);
            }
        };
        void initGps();
    }, []);

    useEffect(() => {
        let active = true;
        dataService
            .getAsset(assetId)
            .then((asset) => {
                if (!active || !asset) return;
                if (asset.copper_domain) {
                    setCopperDomain((prev) => prev ?? asset.copper_domain);
                }
                if (typeof asset.moisture_pct === 'number' && Number.isFinite(asset.moisture_pct)) {
                    setMoisturePct((prev) => (prev === '' ? String(asset.moisture_pct) : prev));
                }
                if (typeof asset.tml_pct === 'number' && Number.isFinite(asset.tml_pct)) {
                    setTmlLimitPct((prev) => (prev === '' ? String(asset.tml_pct) : prev));
                }
                if (typeof asset.residence_days === 'number' && Number.isFinite(asset.residence_days)) {
                    setResidenceDays((prev) => (prev === '' ? String(asset.residence_days) : prev));
                }
                if (typeof asset.cu_total_pct === 'number' && Number.isFinite(asset.cu_total_pct)) {
                    setCuTotalPct((prev) => (prev === '' ? String(asset.cu_total_pct) : prev));
                }
                if (typeof asset.cu_soluble_pct === 'number' && Number.isFinite(asset.cu_soluble_pct)) {
                    setCuSolublePct((prev) => (prev === '' ? String(asset.cu_soluble_pct) : prev));
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [assetId]);

    useEffect(() => {
        const activeUrls = objectUrlsRef.current;
        return () => {
            activeUrls.forEach((url) => URL.revokeObjectURL(url));
            activeUrls.clear();
        };
    }, []);

    const applyRawPhoto = async (rawFileOrBlob: Blob) => {
        const token = ++captureTokenRef.current;
        const nextPreview = createTrackedObjectUrl(rawFileOrBlob);
        setPhotoBlob(rawFileOrBlob);
        setCasMetrics(null);
        setPhotoPreview((prev) => {
            revokeTrackedObjectUrl(prev);
            return nextPreview;
        });

        try {
            const digested = await mediaDigestorClient.digestFile(rawFileOrBlob, 'IMAGE_FIELD_EVIDENCE');
            if (captureTokenRef.current === token) {
                setCasMetrics(computeCasMetrics(digested.originalBytes, digested.optimizedBytes, undefined, false));
            }
        } catch {
            // Vista previa CAS diferida hasta la subida definitiva
        }
    };

    const takePhoto = async () => {
        try {
            const image = await Camera.getPhoto({
                quality: 85,
                allowEditing: false,
                resultType: CameraResultType.DataUrl,
                source: CameraSource.Camera,
                correctOrientation: true,
                saveToGallery: false,
            });
            if (image.dataUrl) {
                await applyRawPhoto(dataUrlToBlob(image.dataUrl));
            }
        } catch (err: any) {
            if (!/cancel/i.test(String(err?.message || ''))) {
                fileInputRef.current?.click();
            }
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            await applyRawPhoto(file);
        } catch (err: any) {
            setStatusMessage({
                severity: 'error',
                text: `${t('manual_capture.photo_process_error', 'Error al procesar foto')}: ${err?.message || 'Formato inválido'}`,
            });
        } finally {
            e.target.value = '';
        }
    };

    const activePitchDeg = clinometer.frozenPitchDeg ?? (clinometer.isListening ? clinometer.pitchDeg : null);

    const clinometerPreviewHeight = useMemo(() => {
        if (activePitchDeg === null || !Number.isFinite(activePitchDeg)) return null;
        const dist = parseOptionalNonNegative(horizontalDistanceM);
        const eyeH = parseOptionalNonNegative(operatorEyeHeightM);
        if (typeof dist !== 'number' || dist <= 0 || typeof eyeH !== 'number') {
            return null;
        }
        return calculationEngine.computeHeightFromClinometer(activePitchDeg, dist, eyeH);
    }, [activePitchDeg, horizontalDistanceM, operatorEyeHeightM]);

    const handleApplyClinometerHeight = () => {
        if (activePitchDeg === null || clinometerPreviewHeight === null) {
            setStatusMessage({
                severity: 'warning',
                text: t(
                    'clinometer.incomplete_inputs',
                    'Declare ángulo IMU, distancia horizontal y altura ocular del operador antes de aplicar altura.'
                ),
            });
            return;
        }
        const dist = parseOptionalNonNegative(horizontalDistanceM);
        const eyeH = parseOptionalNonNegative(operatorEyeHeightM);
        if (typeof dist !== 'number' || dist <= 0 || typeof eyeH !== 'number') return;

        setDimensions((prev) => ({ ...prev, h: clinometerPreviewHeight.toFixed(2) }));
        setAppliedImu({
            imu_pitch_deg: Number(activePitchDeg.toFixed(2)),
            imu_height_m: clinometerPreviewHeight,
            imu_distance_m: dist,
            imu_eye_height_m: eyeH,
        });
        setStatusMessage({
            severity: 'info',
            text: `${t('clinometer.applied_notice', 'Altura IMU aplicada')}: ${clinometerPreviewHeight.toFixed(2)} m (${activePitchDeg.toFixed(1)}°)`,
        });
    };

    const handleHeightManualChange = (nextH: string) => {
        setDimensions((prev) => ({ ...prev, h: nextH }));
        setAppliedImu(null);
    };

    const wallAngleParsed = useMemo(() => {
        if (dimensions.wallAngleDeg.trim() === '') return undefined;
        const num = Number.parseFloat(dimensions.wallAngleDeg.trim());
        if (!Number.isFinite(num) || num <= 0 || num > 90) return null;
        return num;
    }, [dimensions.wallAngleDeg]);

    const liveEstimation = useMemo(() => {
        const a = parseFloat(dimensions.a) || 0;
        const b = parseFloat(dimensions.b) || 0;
        const h = parseFloat(dimensions.h) || 0;
        const ap = parseFloat(dimensions.ap) || 0;
        const bp = parseFloat(dimensions.bp) || 0;
        const p = parseFloat(dimensions.p) || 0;
        const pp = parseFloat(dimensions.pp) || 0;

        if (geometria === 'CONO_ELIPTICO') {
            return calculationEngine.calculateEllipticCone(a, b, h);
        }
        if (geometria === 'CONO_ELIPTICO_TRUNCADO') {
            return calculationEngine.calculateTruncatedEllipticCone(a, b, ap, bp, h);
        }
        if (geometria === 'CONO_TRUNCADO_PERIMETRO') {
            return calculationEngine.calculatePerimeterTruncatedCone(p, pp, h);
        }
        if (geometria === 'PILA_LONGITUDINAL_WINDROW') {
            const baseL = parseOptionalNonNegative(dimensions.baseLengthM) || 0;
            const baseW = parseOptionalNonNegative(dimensions.baseWidthM) || 0;
            const crestL = parseOptionalNonNegative(dimensions.crestLengthM);
            const crestW = parseOptionalNonNegative(dimensions.crestWidthM);
            return calculationEngine.calculateWindrowVolume(baseL, baseW, h, crestL, crestW);
        }
        if (geometria === 'ACOPIO_CONTRA_MURO') {
            if (wallAngleParsed === null) return 0;
            const wallL = parseOptionalNonNegative(dimensions.wallLengthM) || 0;
            const wallW = parseOptionalNonNegative(dimensions.wallWidthM) || 0;
            return calculationEngine.calculateToeWallStockpileVolume(wallL, wallW, h, wallAngleParsed);
        }
        return 0;
    }, [dimensions, geometria, wallAngleParsed]);

    const copperMetallurgy = useMemo(() => {
        const parsedDensity = parseOptionalNonNegative(density);
        return computeCopperMetallurgy({
            volumeM3: liveEstimation,
            densityFactor: parsedDensity && parsedDensity > 0 ? parsedDensity : undefined,
            moistureRaw: moisturePct,
            cuTotalRaw: cuTotalPct,
            cuSolubleRaw: cuSolublePct,
            tmlLimitRaw: tmlLimitPct,
            residenceDaysRaw: residenceDays,
        });
    }, [liveEstimation, density, moisturePct, cuTotalPct, cuSolublePct, tmlLimitPct, residenceDays]);

    const governanceResult = useMemo(() => {
        return calculationEngine.evaluateCopperGovernance({
            copperDomain,
            residenceDays: copperMetallurgy.residenceDays ?? null,
            moisturePct: copperMetallurgy.moisturePct ?? null,
            tmlLimitPct: copperMetallurgy.tmlLimitPct ?? null,
        });
    }, [
        copperDomain,
        copperMetallurgy.residenceDays,
        copperMetallurgy.moisturePct,
        copperMetallurgy.tmlLimitPct,
    ]);

    const handleSave = async () => {
        if (isSaving || liveEstimation <= 0) return;
        if (!hidePhoto && !photoBlob) {
            setStatusMessage({
                severity: 'warning',
                text: t('manual_capture.required_photo_alert'),
            });
            return;
        }
        if (geometria === 'ACOPIO_CONTRA_MURO' && wallAngleParsed === null) {
            setStatusMessage({
                severity: 'warning',
                text: t('manual_capture.err_wall_angle_range', 'El ángulo de muro debe estar entre 1° y 90°.'),
            });
            return;
        }
        const assayError = validateCopperAssayInputs(
            moisturePct,
            cuTotalPct,
            cuSolublePct,
            tmlLimitPct,
            residenceDays
        );
        if (assayError) {
            setStatusMessage({ severity: 'warning', text: assayError });
            return;
        }

        setIsSaving(true);
        setStatusMessage(null);
        try {
            let photoUrl = initialPhotoUrl || '';
            let resolvedCas: CasTelemetryMetrics | null = null;

            if (photoBlob && !hidePhoto) {
                const uploadResult = await storageService.uploadStockpileImage(photoBlob, assetId);
                photoUrl = uploadResult.url;
                resolvedCas = computeCasMetrics(
                    uploadResult.originalBytes ?? photoBlob.size,
                    uploadResult.optimizedBytes ?? uploadResult.size,
                    uploadResult.savingsPct,
                    true
                );
                setCasMetrics(resolvedCas);
            }

            const densityNum = parseFloat(density) || 0;
            const weight = densityNum > 0 ? calculationEngine.computeTotalMass(liveEstimation, densityNum) : 0;

            const crestLengthOpt = parseOptionalNonNegative(dimensions.crestLengthM);
            const crestWidthOpt = parseOptionalNonNegative(dimensions.crestWidthM);

            const geometryDimensions: Record<string, number> =
                geometria === 'PILA_LONGITUDINAL_WINDROW'
                    ? {
                          base_length_m: parseOptionalNonNegative(dimensions.baseLengthM) || 0,
                          base_width_m: parseOptionalNonNegative(dimensions.baseWidthM) || 0,
                          h: parseFloat(dimensions.h) || 0,
                          ...(crestLengthOpt !== undefined ? { crest_length_m: crestLengthOpt } : {}),
                          ...(crestWidthOpt !== undefined ? { crest_width_m: crestWidthOpt } : {}),
                      }
                    : geometria === 'ACOPIO_CONTRA_MURO'
                    ? {
                          length_m: parseOptionalNonNegative(dimensions.wallLengthM) || 0,
                          width_from_wall_m: parseOptionalNonNegative(dimensions.wallWidthM) || 0,
                          h: parseFloat(dimensions.h) || 0,
                          ...(typeof wallAngleParsed === 'number' ? { wall_angle_deg: wallAngleParsed } : {}),
                      }
                    : {
                          a: parseFloat(dimensions.a) || 0,
                          b: parseFloat(dimensions.b) || 0,
                          h: parseFloat(dimensions.h) || 0,
                          ap: parseFloat(dimensions.ap) || 0,
                          bp: parseFloat(dimensions.bp) || 0,
                          p: parseFloat(dimensions.p) || 0,
                          pp: parseFloat(dimensions.pp) || 0,
                      };

            const measurementId = await dataService.addMeasurement({
                assetId,
                timestamp: Date.now(),
                volumen_m3: liveEstimation,
                peso_t: weight,
                density_factor: densityNum > 0 ? densityNum : undefined,
                method: 'manual',
                photo_url: photoUrl,
                copper_domain: copperDomain,
                moisture_pct: copperMetallurgy.moisturePct,
                tml_pct: copperMetallurgy.tmlLimitPct,
                residence_days: copperMetallurgy.residenceDays,
                wet_weight_thm: copperMetallurgy.wetWeightThm,
                dry_weight_tms: copperMetallurgy.dryWeightTms,
                cu_total_pct: copperMetallurgy.cuTotalPct,
                cu_soluble_pct: copperMetallurgy.cuSolublePct,
                fine_cu_t: copperMetallurgy.fineCuT,
                crest_length_m: geometria === 'PILA_LONGITUDINAL_WINDROW' ? crestLengthOpt : undefined,
                crest_width_m: geometria === 'PILA_LONGITUDINAL_WINDROW' ? crestWidthOpt : undefined,
                wall_angle_deg:
                    geometria === 'ACOPIO_CONTRA_MURO' && typeof wallAngleParsed === 'number'
                        ? wallAngleParsed
                        : undefined,
                ...(appliedImu
                    ? {
                          imu_pitch_deg: appliedImu.imu_pitch_deg,
                          imu_height_m: appliedImu.imu_height_m,
                          imu_distance_m: appliedImu.imu_distance_m,
                          imu_eye_height_m: appliedImu.imu_eye_height_m,
                      }
                    : {}),
                ...(governanceResult.alerts.length > 0
                    ? { copper_governance_alerts: governanceResult.alerts }
                    : {}),
                cas_original_bytes: resolvedCas?.originalBytes,
                cas_optimized_bytes: resolvedCas?.optimizedBytes,
                cas_savings_pct: resolvedCas?.savingsPct,
                geometry: {
                    type: geometria,
                    dimensions: geometryDimensions,
                },
                location_metadata: gps
                    ? {
                          lat: gps.lat,
                          lng: gps.lng,
                          accuracy: gps.acc,
                      }
                    : undefined,
            });

            if (
                copperDomain ||
                copperMetallurgy.moisturePct !== undefined ||
                copperMetallurgy.tmlLimitPct !== undefined ||
                copperMetallurgy.residenceDays !== undefined ||
                copperMetallurgy.wetWeightThm !== undefined ||
                copperMetallurgy.dryWeightTms !== undefined ||
                copperMetallurgy.cuTotalPct !== undefined ||
                copperMetallurgy.cuSolublePct !== undefined ||
                copperMetallurgy.fineCuT !== undefined ||
                resolvedCas
            ) {
                await dataService.saveStockpileData(
                    {
                        ...(copperDomain
                            ? {
                                  copper_domain: copperDomain,
                                  clase: mapCopperDomainToClase(copperDomain),
                              }
                            : {}),
                        ...(copperMetallurgy.moisturePct !== undefined
                            ? { moisture_pct: copperMetallurgy.moisturePct }
                            : {}),
                        ...(copperMetallurgy.tmlLimitPct !== undefined
                            ? { tml_pct: copperMetallurgy.tmlLimitPct }
                            : {}),
                        ...(copperMetallurgy.residenceDays !== undefined
                            ? { residence_days: copperMetallurgy.residenceDays }
                            : {}),
                        ...(copperMetallurgy.wetWeightThm !== undefined
                            ? { wet_weight_thm: copperMetallurgy.wetWeightThm }
                            : {}),
                        ...(copperMetallurgy.dryWeightTms !== undefined
                            ? { dry_weight_tms: copperMetallurgy.dryWeightTms }
                            : {}),
                        ...(copperMetallurgy.cuTotalPct !== undefined
                            ? { cu_total_pct: copperMetallurgy.cuTotalPct }
                            : {}),
                        ...(copperMetallurgy.cuSolublePct !== undefined
                            ? { cu_soluble_pct: copperMetallurgy.cuSolublePct }
                            : {}),
                        ...(copperMetallurgy.fineCuT !== undefined
                            ? { fine_cu_t: copperMetallurgy.fineCuT }
                            : {}),
                        ...(resolvedCas
                            ? {
                                  cas_original_bytes: resolvedCas.originalBytes,
                                  cas_optimized_bytes: resolvedCas.optimizedBytes,
                                  cas_savings_pct: resolvedCas.savingsPct,
                              }
                            : {}),
                    },
                    assetId
                );
            }

            onSuccess(measurementId);
        } catch (error: any) {
            console.error('[ManualCapture] Error:', error);
            setStatusMessage({
                severity: 'error',
                text: `${t('manual_capture.save_error')}: ${error?.message || 'Falla de conexión'}`,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const getGeometryHeading = () => {
        if (geometria === 'PILA_LONGITUDINAL_WINDROW') {
            return t('geometries.windrow', 'PILA LONGITUDINAL (WINDROW)');
        }
        if (geometria === 'ACOPIO_CONTRA_MURO') {
            return t('geometries.toe_wall', 'ACOPIO CONTRA MURO');
        }
        return t(`geometries.${geometria}`);
    };

    const undeclaredLabel = t(
        'core_common.undeclared_tech_value',
        '[Información técnica no declarada en ficha]'
    );

    return (
        <div className="h-full w-full flex-1 min-h-[600px] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden relative transition-colors duration-200 rounded-none shadow-none select-none">
            <header className="flex-none pt-fib-34 pb-fib-13 px-fib-21 flex items-center justify-between bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C] z-50">
                <div className="flex items-center gap-fib-13 min-w-0">
                    <button
                        type="button"
                        onClick={onBack}
                        className="min-w-[55px] min-h-[55px] flex items-center justify-center bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shadow-none shrink-0"
                        title={t('common.back_button')}
                        aria-label={t('common.back_button')}
                    >
                        <span className="material-symbols-outlined text-2xl text-[#C68346]">arrow_back</span>
                    </button>
                    <div className="flex flex-col min-w-0">
                        <span className="text-microcopy font-mono font-bold tracking-[0.2em] uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('manual_capture.measurement_label')}
                        </span>
                        <h1 className="text-h1-header font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6] uppercase truncate">
                            {getGeometryHeading()}
                        </h1>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-fib-21 py-fib-34 relative">
                <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleFileUpload}
                    autoComplete="off"
                    spellCheck={false}
                    className="hidden"
                />

                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        void handleSave();
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    className="max-w-sm mx-auto space-y-fib-21 relative z-10"
                >
                    <InlineStatusBanner status={statusMessage} onDismiss={() => setStatusMessage(null)} />

                    {!hidePhoto && (
                        <div className="space-y-fib-13">
                            <span className="text-microcopy font-bold tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] uppercase">
                                {t('manual_capture.evidence_title')}
                            </span>
                            <div
                                onClick={takePhoto}
                                className={`relative w-full aspect-video rounded-none border-2 border-dashed transition-colors overflow-hidden flex flex-col items-center justify-center cursor-pointer ${
                                    photoPreview
                                        ? 'border-[#C68346]/60 bg-[#000000]'
                                        : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]'
                                }`}
                            >
                                {photoPreview ? (
                                    <>
                                        <SecureImage
                                            src={photoPreview}
                                            className="w-full h-full object-cover"
                                            alt={t('manual_capture.evidence_title')}
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                                        <div className="absolute bottom-4 left-4 flex items-center gap-fib-8">
                                            <span className="text-microcopy font-bold uppercase tracking-widest text-[#FFFFFF] bg-[#C68346] px-fib-8 py-0.5">
                                                {t('manual_capture.success_message')}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                captureTokenRef.current += 1;
                                                revokeTrackedObjectUrl(photoPreview);
                                                setPhotoBlob(null);
                                                setPhotoPreview(null);
                                                setCasMetrics(null);
                                            }}
                                            className="absolute top-2 right-2 min-w-[55px] min-h-[55px] flex items-center justify-center bg-transparent border-0 outline-none p-2 text-white/80 hover:text-white transition-colors cursor-pointer"
                                            title={t('common.delete_button', 'ELIMINAR')}
                                            aria-label={t('common.delete_button', 'ELIMINAR')}
                                        >
                                            <span className="material-symbols-outlined">delete</span>
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <span className="material-symbols-outlined text-5xl text-[#94A3B8] dark:text-[#5A6072] mb-2">
                                            add_a_photo
                                        </span>
                                        <span className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-[0.2em]">
                                            {t('manual_capture.tap_to_capture')}
                                        </span>
                                    </>
                                )}
                            </div>
                            <CasTelemetryBadge metrics={casMetrics} origBytesFallback={photoBlob?.size} />
                        </div>
                    )}

                    {/* Cotas geométricas según modelo */}
                    <div className="grid grid-cols-1 gap-fib-21">
                        {geometria === 'CONO_ELIPTICO' && (
                            <>
                                <Field
                                    label={t('manual_capture.fields.major_axis_base')}
                                    value={dimensions.a}
                                    onChange={(v) => setDimensions({ ...dimensions, a: v })}
                                />
                                <Field
                                    label={t('manual_capture.fields.minor_axis_base')}
                                    value={dimensions.b}
                                    onChange={(v) => setDimensions({ ...dimensions, b: v })}
                                />
                            </>
                        )}

                        {geometria === 'CONO_ELIPTICO_TRUNCADO' && (
                            <>
                                <Field
                                    label={t('manual_capture.fields.major_axis_base')}
                                    value={dimensions.a}
                                    onChange={(v) => setDimensions({ ...dimensions, a: v })}
                                />
                                <Field
                                    label={t('manual_capture.fields.minor_axis_base')}
                                    value={dimensions.b}
                                    onChange={(v) => setDimensions({ ...dimensions, b: v })}
                                />
                                <Field
                                    label={t('manual_capture.fields.major_axis_top')}
                                    value={dimensions.ap}
                                    onChange={(v) => setDimensions({ ...dimensions, ap: v })}
                                />
                                <Field
                                    label={t('manual_capture.fields.minor_axis_top')}
                                    value={dimensions.bp}
                                    onChange={(v) => setDimensions({ ...dimensions, bp: v })}
                                />
                            </>
                        )}

                        {geometria === 'CONO_TRUNCADO_PERIMETRO' && (
                            <>
                                <Field
                                    label={t('manual_capture.fields.perimeter_base')}
                                    value={dimensions.p}
                                    onChange={(v) => setDimensions({ ...dimensions, p: v })}
                                />
                                <Field
                                    label={t('manual_capture.fields.perimeter_top')}
                                    value={dimensions.pp}
                                    onChange={(v) => setDimensions({ ...dimensions, pp: v })}
                                />
                            </>
                        )}

                        {geometria === 'PILA_LONGITUDINAL_WINDROW' && (
                            <>
                                <Field
                                    label={t('manual_capture.fields.base_length', 'LARGO BASE (m)')}
                                    value={dimensions.baseLengthM}
                                    onChange={(v) => setDimensions({ ...dimensions, baseLengthM: v })}
                                />
                                <Field
                                    label={t('manual_capture.fields.base_width', 'ANCHO BASE (m)')}
                                    value={dimensions.baseWidthM}
                                    onChange={(v) => setDimensions({ ...dimensions, baseWidthM: v })}
                                />
                                <Field
                                    label={t(
                                        'manual_capture.fields.crest_length',
                                        'LARGO CRESTA (m)'
                                    )}
                                    value={dimensions.crestLengthM}
                                    onChange={(v) => setDimensions({ ...dimensions, crestLengthM: v })}
                                />
                                <Field
                                    label={t(
                                        'manual_capture.fields.crest_width',
                                        'ANCHO CRESTA (m)'
                                    )}
                                    value={dimensions.crestWidthM}
                                    onChange={(v) => setDimensions({ ...dimensions, crestWidthM: v })}
                                />
                            </>
                        )}

                        {geometria === 'ACOPIO_CONTRA_MURO' && (
                            <>
                                <Field
                                    label={t('manual_capture.fields.wall_length', 'LARGO MURO (m)')}
                                    value={dimensions.wallLengthM}
                                    onChange={(v) => setDimensions({ ...dimensions, wallLengthM: v })}
                                />
                                <Field
                                    label={t('manual_capture.fields.width_from_wall', 'EXTENSIÓN DESDE MURO (m)')}
                                    value={dimensions.wallWidthM}
                                    onChange={(v) => setDimensions({ ...dimensions, wallWidthM: v })}
                                />
                                <Field
                                    label={t(
                                        'manual_capture.fields.wall_angle_deg',
                                        'ÁNGULO DEL MURO (°)'
                                    )}
                                    value={dimensions.wallAngleDeg}
                                    onChange={(v) => setDimensions({ ...dimensions, wallAngleDeg: v })}
                                    placeholder="90"
                                />
                                {wallAngleParsed === null && (
                                    <p className="text-microcopy font-mono text-[#C68346]">
                                        {t(
                                            'manual_capture.err_wall_angle_range',
                                            'El ángulo de muro debe estar entre 1° y 90°.'
                                        )}
                                    </p>
                                )}
                            </>
                        )}

                        <Field
                            label={
                                geometria === 'ACOPIO_CONTRA_MURO'
                                    ? t('manual_capture.fields.height_at_wall', 'ALTURA EN MURO (m)')
                                    : t('manual_capture.fields.total_height')
                            }
                            value={dimensions.h}
                            onChange={handleHeightManualChange}
                        />
                    </div>

                    {/* Clinómetro IMU Offline para cálculo trigonométrico de Altura */}
                    <section className="p-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none space-y-fib-13">
                        <div className="flex items-center justify-between gap-fib-8">
                            <div className="flex flex-col">
                                <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#C68346]">
                                    {t('clinometer.title', 'CLINÓMETRO IMU')}
                                </span>
                                <span className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                                    H = h_ocular + D · tan(α)
                                </span>
                            </div>
                            <span className="text-h2-section font-mono tabular-nums font-bold text-[#00AEEF]">
                                {activePitchDeg !== null ? `${activePitchDeg.toFixed(1)}°` : '--.-°'}
                            </span>
                        </div>

                        {!clinometer.isSupported && (
                            <p className="text-microcopy font-mono text-[#C68346]">
                                {t(
                                    'clinometer.sensor_unsupported',
                                    'Sensor IMU no disponible en este terminal. Ingrese la altura directamente.'
                                )}
                            </p>
                        )}
                        {clinometer.error && (
                            <p className="text-microcopy font-mono text-red-600 dark:text-red-400">
                                {clinometer.error}
                            </p>
                        )}

                        <div className="grid grid-cols-2 gap-fib-8">
                            <button
                                type="button"
                                onClick={() => {
                                    if (clinometer.isListening) {
                                        clinometer.stopListening();
                                    } else {
                                        void clinometer.startListening();
                                    }
                                }}
                                disabled={!clinometer.isSupported}
                                className={`min-h-[55px] px-fib-13 rounded-none shadow-none border text-microcopy font-mono font-bold uppercase tracking-wider cursor-pointer transition-colors disabled:opacity-40 ${
                                    clinometer.isListening
                                        ? 'bg-[#00AEEF] text-[#000000] border-[#00AEEF]'
                                        : 'bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346]'
                                }`}
                            >
                                {clinometer.isListening
                                    ? t('clinometer.stop_sensor', 'DETENER IMU')
                                    : t('clinometer.start_sensor', 'INICIAR IMU')}
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    if (clinometer.frozenPitchDeg !== null) {
                                        clinometer.resetFrozen();
                                    } else {
                                        clinometer.freezeReading();
                                    }
                                }}
                                disabled={
                                    clinometer.frozenPitchDeg === null &&
                                    (!clinometer.isListening || clinometer.pitchDeg === null)
                                }
                                className={`min-h-[55px] px-fib-13 rounded-none shadow-none border text-microcopy font-mono font-bold uppercase tracking-wider cursor-pointer transition-colors disabled:opacity-40 ${
                                    clinometer.frozenPitchDeg !== null
                                        ? 'bg-[#C68346] text-[#FFFFFF] border-[#C68346]'
                                        : 'bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346]'
                                }`}
                            >
                                {clinometer.frozenPitchDeg !== null
                                    ? t('clinometer.unfreeze_angle', 'LIBERAR ÁNGULO')
                                    : t('clinometer.freeze_angle', 'CONGELAR ÁNGULO')}
                            </button>
                        </div>

                        <div className="grid grid-cols-2 gap-fib-8">
                            <div className="flex flex-col gap-fib-8">
                                <label
                                    htmlFor="imu-eye-height"
                                    className="text-microcopy font-bold uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('clinometer.eye_height', 'ALTURA OCULAR DEL OPERADOR (m)')}
                                </label>
                                <input
                                    id="imu-eye-height"
                                    type="text"
                                    inputMode="decimal"
                                    value={operatorEyeHeightM}
                                    onChange={(e) => setOperatorEyeHeightM(sanitizeDecimalText(e.target.value))}
                                    placeholder="1.65"
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full min-h-[55px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-body-main font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                                />
                            </div>
                            <div className="flex flex-col gap-fib-8">
                                <label
                                    htmlFor="imu-horizontal-distance"
                                    className="text-microcopy font-bold uppercase text-[#475569] dark:text-[#8A93A6]"
                                >
                                    {t('clinometer.horizontal_distance', 'DISTANCIA HORIZONTAL AL PIE (m)')}
                                </label>
                                <input
                                    id="imu-horizontal-distance"
                                    type="text"
                                    inputMode="decimal"
                                    value={horizontalDistanceM}
                                    onChange={(e) => setHorizontalDistanceM(sanitizeDecimalText(e.target.value))}
                                    placeholder="0.0"
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="w-full min-h-[55px] px-fib-8 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] rounded-none shadow-none text-center text-body-main font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-fib-8">
                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('clinometer.eye_height_presets', 'PRESET OCULAR')}
                            </span>
                            <div className="flex items-center gap-fib-8">
                                {EYE_HEIGHT_PRESETS.map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => setOperatorEyeHeightM(preset)}
                                        className={`min-h-[40px] px-fib-8 border rounded-none shadow-none text-microcopy font-mono tabular-nums cursor-pointer ${
                                            operatorEyeHeightM === preset
                                                ? 'bg-[#C68346] text-[#FFFFFF] border-[#C68346]'
                                                : 'bg-[#FFFFFF] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C]'
                                        }`}
                                    >
                                        {preset}m
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-8">
                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t('clinometer.calculated_height', 'ALTURA CALCULADA IMU (m)')}
                            </span>
                            <span className="text-data-dense font-mono tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                {clinometerPreviewHeight !== null
                                    ? `${clinometerPreviewHeight.toFixed(2)} m`
                                    : undeclaredLabel}
                            </span>
                        </div>

                        <button
                            type="button"
                            onClick={handleApplyClinometerHeight}
                            disabled={clinometerPreviewHeight === null}
                            className="w-full min-h-[55px] px-fib-13 bg-[#00AEEF] text-[#000000] font-bold text-microcopy font-mono uppercase tracking-wider rounded-none shadow-none disabled:opacity-30 cursor-pointer"
                        >
                            {t('clinometer.use_calculated_height', 'USAR ALTURA CALCULADA')}
                        </button>
                    </section>

                    <Field
                        label={t('manual_capture.fields.density_factor')}
                        value={density}
                        onChange={setDensity}
                    />

                    {/* Especialización Cobre (Cu) y Gobernanza */}
                    <div className="space-y-fib-21">
                        <CopperDomainSelector value={copperDomain} onChange={setCopperDomain} />
                        <CopperAssayInputs
                            idPrefix="manual-cu"
                            moisturePct={moisturePct}
                            cuTotalPct={cuTotalPct}
                            cuSolublePct={cuSolublePct}
                            onMoistureChange={setMoisturePct}
                            onCuTotalChange={setCuTotalPct}
                            onCuSolubleChange={setCuSolublePct}
                            tmlLimitPct={tmlLimitPct}
                            residenceDays={residenceDays}
                            onTmlLimitChange={setTmlLimitPct}
                            onResidenceDaysChange={setResidenceDays}
                            copperDomain={copperDomain}
                            metallurgy={copperMetallurgy}
                            showMassBreakdown={true}
                        />
                        <CopperGovernanceBanner result={governanceResult} />
                    </div>

                    {/* Resultados en vivo */}
                    <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none p-fib-21 flex flex-col items-center gap-fib-8 transition-colors">
                        <span className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] tracking-[0.2em] uppercase">
                            {t('manual_capture.estimated_volume')}
                        </span>
                        <div className="flex items-baseline gap-fib-8 font-mono tabular-nums">
                            <span className="text-4xl font-bold text-[#C68346] tracking-tight">
                                {liveEstimation.toFixed(2)}
                            </span>
                            <span className="text-base font-bold text-[#475569] dark:text-[#8A93A6] uppercase">
                                m³
                            </span>
                        </div>
                    </div>

                    {/* Botón de Guardado */}
                    <div className="pt-fib-13 pb-fib-55 flex justify-center">
                        <button
                            type="submit"
                            disabled={isSaving || liveEstimation <= 0}
                            className={`w-full min-h-[56px] h-14 rounded-none shadow-none flex items-center justify-center transition-colors cursor-pointer ${
                                isSaving || liveEstimation <= 0
                                    ? 'bg-[#F8FAFC] dark:bg-[#07090D] text-[#94A3B8] dark:text-[#5A6072] border border-[#E2E8F0] dark:border-[#12151C] cursor-not-allowed'
                                    : 'bg-[#C68346] text-[#FFFFFF] font-bold'
                            }`}
                        >
                            {isSaving ? (
                                <M3CircularProgress
                                    size={24}
                                    strokeWidth={3}
                                    indeterminate
                                    ariaLabel={t('manual_capture.saving_measurement', 'Guardando medición')}
                                />
                            ) : (
                                <span className="text-microcopy tracking-widest uppercase">
                                    {t('manual_capture.save_measurement')}
                                </span>
                            )}
                        </button>
                    </div>
                </form>
            </main>
        </div>
    );
};

const Field: React.FC<{
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}> = ({ label, value, onChange, placeholder = '0.0' }) => (
    <div className="flex flex-col gap-fib-8 group">
        <label className="text-microcopy font-bold text-[#475569] dark:text-[#8A93A6] tracking-widest uppercase group-focus-within:text-[#C68346] transition-colors">
            {label}
        </label>
        <div className="relative">
            <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => onChange(sanitizeDecimalText(e.target.value))}
                className="w-full bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none min-h-[55px] h-14 px-fib-21 text-2xl font-bold font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6] outline-none focus:border-[#C68346] transition-colors text-center tracking-tight"
                placeholder={placeholder}
                autoComplete="off"
                spellCheck={false}
            />
        </div>
    </div>
);
