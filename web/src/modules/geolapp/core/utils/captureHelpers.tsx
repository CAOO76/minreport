import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
    CopperGovernanceResult,
    CopperMineralDomain,
} from '../types/GeolappTypes';

export type CopperDomainCode = CopperMineralDomain;

export const COPPER_DOMAIN_OPTIONS: Array<{
    value: CopperDomainCode;
    labelKey: string;
    fallbackLabel: string;
    legacyClase: 'mineral' | 'baja_ley' | 'esteril';
}> = [
    {
        value: 'OXIDO_CU',
        labelKey: 'copper_domains.OXIDO_CU',
        fallbackLabel: 'Óxido de Cobre (Cu)',
        legacyClase: 'mineral',
    },
    {
        value: 'MIXTO_CU',
        labelKey: 'copper_domains.MIXTO_CU',
        fallbackLabel: 'Mineral Mixto (Cu)',
        legacyClase: 'mineral',
    },
    {
        value: 'SULFURO_SECUNDARIO_CU',
        labelKey: 'copper_domains.SULFURO_SECUNDARIO_CU',
        fallbackLabel: 'Sulfuro Secundario (Cu)',
        legacyClase: 'mineral',
    },
    {
        value: 'SULFURO_PRIMARIO_CU',
        labelKey: 'copper_domains.SULFURO_PRIMARIO_CU',
        fallbackLabel: 'Sulfuro Primario (Cu)',
        legacyClase: 'mineral',
    },
    {
        value: 'CONCENTRADO_CU',
        labelKey: 'copper_domains.CONCENTRADO_CU',
        fallbackLabel: 'Concentrado de Cobre (Cu)',
        legacyClase: 'mineral',
    },
    {
        value: 'BAJA_LEY_CU',
        labelKey: 'copper_domains.BAJA_LEY_CU',
        fallbackLabel: 'Baja Ley (Cu)',
        legacyClase: 'baja_ley',
    },
    {
        value: 'ESTERIL_RIPIOS',
        labelKey: 'copper_domains.ESTERIL_RIPIOS',
        fallbackLabel: 'Estéril / Ripios',
        legacyClase: 'esteril',
    },
];

export function mapCopperDomainToClase(
    domain?: CopperDomainCode | null
): 'mineral' | 'baja_ley' | 'esteril' {
    const match = COPPER_DOMAIN_OPTIONS.find((opt) => opt.value === domain);
    return match ? match.legacyClase : 'mineral';
}

export function getCopperDomainOption(domain?: string | null) {
    return COPPER_DOMAIN_OPTIONS.find((opt) => opt.value === domain) ?? null;
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

export interface InlineStatusMessage {
    severity: 'error' | 'warning' | 'info';
    text: string;
}

export const InlineStatusBanner: React.FC<{
    message: InlineStatusMessage | null;
    onDismiss?: () => void;
}> = ({ message, onDismiss }) => {
    const { t } = useTranslation();
    if (!message) return null;
    const palette =
        message.severity === 'error'
            ? 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400'
            : message.severity === 'warning'
              ? 'border-[#C68346] bg-[#C68346]/10 text-[#0F172A] dark:text-[#F3F4F6]'
              : 'border-[#00AEEF] bg-[#00AEEF]/10 text-[#0F172A] dark:text-[#F3F4F6]';
    const iconName =
        message.severity === 'error'
            ? 'error'
            : message.severity === 'warning'
              ? 'warning'
              : 'info';

    return (
        <div
            role="status"
            className={`px-fib-13 py-fib-8 border rounded-none shadow-none flex items-center justify-between gap-fib-8 ${palette}`}
        >
            <div className="flex items-center gap-fib-8 min-w-0">
                <span className="material-symbols-outlined text-[16px] shrink-0">{iconName}</span>
                <span className="text-microcopy font-mono font-semibold break-words">
                    {message.text}
                </span>
            </div>
            {onDismiss && (
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label={t('common.close_alert', 'Cerrar aviso')}
                    className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer shrink-0 rounded-none"
                >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
            )}
        </div>
    );
};

export const CasTelemetryBadge: React.FC<{
    metrics: CasTelemetryMetrics | null;
    origBytesFallback?: number;
}> = ({ metrics, origBytesFallback }) => {
    const { t } = useTranslation();
    if (!metrics && (!origBytesFallback || origBytesFallback <= 0)) return null;

    if (!metrics && origBytesFallback && origBytesFallback > 0) {
        return (
            <div className="mt-fib-8 px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex items-center justify-between gap-fib-8">
                <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                    {t('manual_capture.cas_label', 'CAS')}
                </span>
                <span className="text-microcopy font-mono font-bold tabular-nums text-[#00AEEF]">
                    {formatCasSize(origBytesFallback)} ({t('manual_capture.cas_pending', 'PENDIENTE')})
                </span>
            </div>
        );
    }

    if (!metrics) return null;

    return (
        <div className="mt-fib-8 px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none flex items-center justify-between gap-fib-8">
            <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                {t('manual_capture.cas_label', 'CAS')}
            </span>
            <span className="text-microcopy font-mono font-bold tabular-nums text-[#00AEEF]">
                {formatCasSize(metrics.originalBytes)} ➔ {formatCasSize(metrics.optimizedBytes)} (-
                {metrics.savingsPct.toFixed(0)}%)
            </span>
        </div>
    );
};

export const CopperGovernanceBanner: React.FC<{
    result: CopperGovernanceResult;
}> = ({ result }) => {
    const { t } = useTranslation();
    if (!result.alerts.length) return null;

    return (
        <div className="space-y-fib-8">
            {result.alerts.map((alert) => {
                const isCriticalOrBlock =
                    alert.severity === 'BLOCK' || alert.severity === 'CRITICAL';
                const borderClass = isCriticalOrBlock
                    ? 'border-[#C68346] bg-[#C68346]/10'
                    : 'border-[#00AEEF] bg-[#00AEEF]/10';
                const translatedMessage =
                    alert.code === 'CONCENTRATE_TML_EXCEEDED'
                        ? t('copper_governance.concentrate_tml_block', alert.message)
                        : alert.code === 'SULFIDE_AGING_CRITICAL'
                          ? t('copper_governance.sulfide_critical_30d', alert.message)
                          : t('copper_governance.sulfide_warning_14d', alert.message);

                return (
                    <div
                        key={alert.code}
                        role="alert"
                        className={`p-fib-13 border ${borderClass} rounded-none shadow-none flex items-start gap-fib-8`}
                    >
                        <span
                            className={`material-symbols-outlined text-[18px] shrink-0 ${
                                isCriticalOrBlock ? 'text-[#C68346]' : 'text-[#00AEEF]'
                            }`}
                        >
                            {alert.severity === 'BLOCK' ? 'block' : 'warning'}
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-fib-8">
                                <span
                                    className={`text-microcopy font-mono font-bold uppercase tracking-wider ${
                                        isCriticalOrBlock ? 'text-[#C68346]' : 'text-[#00AEEF]'
                                    }`}
                                >
                                    {t(`copper_governance.code_${alert.code}`, alert.code)}
                                </span>
                                <span className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t(`copper_governance.severity_${alert.severity}`, alert.severity)}
                                </span>
                            </div>
                            <p className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6] leading-snug">
                                {translatedMessage}
                            </p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
