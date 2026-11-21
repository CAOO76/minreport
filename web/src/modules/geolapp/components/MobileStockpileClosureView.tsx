import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    HitlConfirmModal,
    type HitlComparisonDiffItem,
} from '../../../components/common/HitlConfirmModal';
import { SecureImage } from '../../../components/common/SecureImage';
import { calculationEngine } from '../core/services/calculation-engine';
import { dataService, type FieldClosureMode } from '../core/services/DataService';
import { formatStockpileVolumeM3 } from '../core/services/spatialScannerService';
import { useResolvedStockpileImage } from '../core/services/StorageService';
import type { StockpileAsset, StockpileMeasurement } from '../core/types/GeolappTypes';
import { triggerFieldImpact, triggerFieldNotification } from '../core/utils/fieldHaptics';

export interface MobileStockpileClosureViewProps {
    asset: StockpileAsset;
    measurements: StockpileMeasurement[];
    onBackToDossier: () => void;
    onCloseToActiveList: () => void;
}

const GRANULOMETRY_DENSITY_TABLE: Record<'COLPAS' | 'GRANSA' | 'MIXTO' | 'FINOS', number> = {
    COLPAS: 1.55,
    GRANSA: 1.65,
    MIXTO: 1.75,
    FINOS: 1.9,
};

function toLocalDatetimeInputValue(epochMs: number): string {
    const d = new Date(epochMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDatetimeLocalInput(raw: string): number | null {
    const cleaned = raw.trim();
    if (!cleaned) return null;
    const parsed = new Date(cleaned).getTime();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const MobileStockpileClosureView: React.FC<MobileStockpileClosureViewProps> = ({
    asset,
    measurements,
    onBackToDossier,
    onCloseToActiveList,
}) => {
    const { t } = useTranslation();

    const [mode, setMode] = useState<FieldClosureMode>('SHIPPED');
    const [dispatchTransport, setDispatchTransport] = useState<string>('');
    const [dispatchDestination, setDispatchDestination] = useState<string>('');
    const [dispatchTimestampInput, setDispatchTimestampInput] = useState<string>(() =>
        toLocalDatetimeInputValue(Date.now())
    );
    const [dispatchReference, setDispatchReference] = useState<string>(
        asset.dispatch_reference || ''
    );
    const [closureCause, setClosureCause] = useState<string>('');
    const [errorText, setErrorText] = useState<string | null>(null);
    const [pendingDiffs, setPendingDiffs] = useState<HitlComparisonDiffItem[] | null>(null);
    const [isSaving, setIsSaving] = useState<boolean>(false);

    const validMeasurements = useMemo(
        () => measurements.filter((m) => !m.ignored && !m.is_closure_measurement),
        [measurements]
    );

    const latestMeas = validMeasurements[0] ?? null;
    const coverRaw =
        latestMeas?.photo_url ||
        asset.last_photo_url ||
        asset.initial_photo_url ||
        asset.thumbnail_url;
    const resolvedCover = useResolvedStockpileImage(coverRaw);

    const latestVolumeM3 =
        asset.last_volume_m3 ??
        asset.volumen ??
        asset.volume_m3 ??
        latestMeas?.volumen_m3 ??
        0;

    const effectiveDensity = useMemo(() => {
        if (
            typeof asset.density_factor === 'number' &&
            Number.isFinite(asset.density_factor) &&
            asset.density_factor > 0
        ) {
            return asset.density_factor;
        }
        if (asset.tipo_granulometria && GRANULOMETRY_DENSITY_TABLE[asset.tipo_granulometria]) {
            return GRANULOMETRY_DENSITY_TABLE[asset.tipo_granulometria];
        }
        return null;
    }, [asset.density_factor, asset.tipo_granulometria]);

    const deducedTonnageT = useMemo(() => {
        if (latestVolumeM3 > 0 && effectiveDensity && effectiveDensity > 0) {
            return Number((latestVolumeM3 * effectiveDensity).toFixed(2));
        }
        const stored = asset.last_weight_t ?? asset.peso_final_toneladas ?? latestMeas?.peso_t ?? 0;
        return typeof stored === 'number' && Number.isFinite(stored) && stored > 0
            ? Number(stored.toFixed(2))
            : null;
    }, [
        asset.last_weight_t,
        asset.peso_final_toneladas,
        effectiveDensity,
        latestMeas?.peso_t,
        latestVolumeM3,
    ]);

    const lastMeasuredTs =
        latestMeas?.timestamp ?? asset.last_measured_at ?? asset.captured_at ?? asset.createdAt;
    const lastMeasuredStr =
        typeof lastMeasuredTs === 'number' && Number.isFinite(lastMeasuredTs)
            ? new Date(lastMeasuredTs).toLocaleString([], {
                  dateStyle: 'short',
                  timeStyle: 'short',
              })
            : '--';

    const governanceResult = useMemo(
        () =>
            calculationEngine.evaluateCopperGovernance({
                copperDomain: asset.copper_domain,
                residenceDays: asset.residence_days ?? null,
                moisturePct: asset.moisture_pct ?? null,
                tmlLimitPct: asset.tml_pct ?? null,
            }),
        [asset.copper_domain, asset.residence_days, asset.moisture_pct, asset.tml_pct]
    );

    const handleRequestConfirm = () => {
        setErrorText(null);

        if (asset.status === 'CLOSED') {
            setErrorText(t('lifecycle.already_closed', 'El acopio ya se encuentra cerrado.'));
            return;
        }

        if (mode === 'SHIPPED') {
            if (governanceResult.hasCriticalBlock) {
                setErrorText(
                    t('copper_governance.dispatch_blocked', 'DESPACHO BLOQUEADO (IMSBC)')
                );
                void triggerFieldNotification('ERROR');
                return;
            }
            const cleanTransport = dispatchTransport.trim();
            const cleanDestination = dispatchDestination.trim();
            const parsedTs = parseDatetimeLocalInput(dispatchTimestampInput);
            const cleanRef = dispatchReference.trim();

            if (cleanTransport.length < 2) {
                setErrorText(
                    t(
                        'lifecycle.dispatch_transport_required',
                        'Debe indicar el transporte para despachar.'
                    )
                );
                void triggerFieldNotification('ERROR');
                return;
            }
            if (cleanDestination.length < 2) {
                setErrorText(
                    t(
                        'lifecycle.dispatch_destination_required',
                        'Debe indicar el destino para despachar.'
                    )
                );
                void triggerFieldNotification('ERROR');
                return;
            }
            if (!parsedTs) {
                setErrorText(
                    t(
                        'lifecycle.dispatch_timestamp_required',
                        'Debe indicar fecha y hora válidas de despacho.'
                    )
                );
                void triggerFieldNotification('ERROR');
                return;
            }

            setPendingDiffs([
                {
                    field: t('lifecycle.closure_type_label', 'TIPO DE CIERRE'),
                    current: String(asset.status || 'ACTIVE'),
                    suggested: t('lifecycle.closure_shipped_label', 'DESPACHO'),
                },
                {
                    field: t('lifecycle.dispatch_transport_label', 'TRANSPORTE'),
                    current: '--',
                    suggested: cleanTransport,
                },
                {
                    field: t('lifecycle.dispatch_destination_label', 'DESTINO'),
                    current: '--',
                    suggested: cleanDestination,
                },
                {
                    field: t('lifecycle.dispatch_timestamp_label', 'FECHA / HORA'),
                    current: '--',
                    suggested: new Date(parsedTs).toLocaleString(),
                },
                ...(cleanRef
                    ? [
                          {
                              field: t('lifecycle.dispatch_ref_label', 'GUÍA / LOTE'),
                              current: '--',
                              suggested: cleanRef,
                          },
                      ]
                    : []),
                ...(deducedTonnageT !== null
                    ? [
                          {
                              field: t('lifecycle.deduced_tonnage_label', 'TONELAJE DEDUCIDO'),
                              current: `${latestVolumeM3.toFixed(1)} m³`,
                              suggested: `~ ${deducedTonnageT.toFixed(1)} t`,
                          },
                      ]
                    : []),
            ]);
            return;
        }

        const cleanCause = closureCause.trim();
        if (cleanCause.length < 3) {
            setErrorText(
                t(
                    'lifecycle.closure_cause_required',
                    'Indique la causa en terreno (mínimo 3 caracteres).'
                )
            );
            void triggerFieldNotification('ERROR');
            return;
        }

        setPendingDiffs([
            {
                field: t('lifecycle.closure_type_label', 'TIPO DE CIERRE'),
                current: String(asset.status || 'ACTIVE'),
                suggested: t('lifecycle.closure_removed_label', 'ELIMINACIÓN EN TERRENO'),
            },
            {
                field: t('lifecycle.closure_cause_label', 'CAUSA EN TERRENO'),
                current: '--',
                suggested: cleanCause,
            },
        ]);
    };

    const executeClosure = async () => {
        if (!pendingDiffs || isSaving) return;
        setIsSaving(true);
        setErrorText(null);
        try {
            if (mode === 'SHIPPED') {
                const parsedTs = parseDatetimeLocalInput(dispatchTimestampInput) || Date.now();
                await dataService.closeAssetInField(asset.id, {
                    mode: 'SHIPPED',
                    dispatchTransport: dispatchTransport.trim(),
                    dispatchDestination: dispatchDestination.trim(),
                    dispatchTimestamp: parsedTs,
                    dispatchReference: dispatchReference.trim() || undefined,
                    shippedWeightT: deducedTonnageT,
                    photoUrl: coverRaw,
                    confirmationKeyword: 'ACTUALIZAR',
                });
            } else {
                await dataService.closeAssetInField(asset.id, {
                    mode: 'FIELD_REMOVED',
                    cause: closureCause.trim(),
                    photoUrl: coverRaw,
                    confirmationKeyword: 'ACTUALIZAR',
                });
            }
            void triggerFieldNotification('SUCCESS');
            setPendingDiffs(null);
            onCloseToActiveList();
        } catch (err: unknown) {
            setErrorText(
                err instanceof Error
                    ? err.message
                    : t('hitl.save_error', 'Error al registrar cierre.')
            );
            setPendingDiffs(null);
            void triggerFieldNotification('ERROR');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="h-full w-full flex-1 bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden rounded-none shadow-none select-none">
            <header className="shrink-0 min-h-[56px] pt-[env(safe-area-inset-top)] px-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-8">
                <button
                    type="button"
                    onClick={() => {
                        void triggerFieldImpact('LIGHT');
                        onBackToDossier();
                    }}
                    aria-label={t('common.back_button', 'VOLVER')}
                    title={t('common.back_button', 'VOLVER')}
                    className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer rounded-none shrink-0"
                >
                    <span className="material-symbols-outlined text-[24px]">arrow_back</span>
                </button>

                <h1 className="flex-1 min-w-0 text-[18px] font-mono font-bold uppercase truncate text-center">
                    {asset.name}
                </h1>

                <button
                    type="button"
                    onClick={() => {
                        void triggerFieldImpact('LIGHT');
                        onCloseToActiveList();
                    }}
                    aria-label={t('common.close_button', 'CERRAR')}
                    title={t('common.close_button', 'CERRAR')}
                    className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer rounded-none shrink-0"
                >
                    <span className="material-symbols-outlined text-[24px]">close</span>
                </button>
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto">
                {/* Bloque superior consolidado de solo lectura sobre lienzo plano */}
                <section className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-13">
                    <div className="w-14 h-14 shrink-0 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] overflow-hidden flex items-center justify-center rounded-none">
                        {resolvedCover ? (
                            <SecureImage
                                src={resolvedCover}
                                alt={asset.name}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <span className="material-symbols-outlined text-[26px] text-[#475569] dark:text-[#8A93A6]">
                                landscape
                            </span>
                        )}
                    </div>

                    <div className="flex-1 min-w-0 font-mono space-y-1">
                        <div className="flex items-center justify-between gap-fib-8 text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] tabular-nums">
                            <span className="truncate">
                                {asset.project_name || asset.underground_sector || asset.location_ref || '--'}
                            </span>
                            <span className="shrink-0">
                                #{validMeasurements.length} · {lastMeasuredStr}
                            </span>
                        </div>

                        <div className="flex items-baseline flex-wrap gap-x-fib-13 gap-y-0.5 tabular-nums">
                            <span className="text-[24px] font-bold text-[#C68346]">
                                {formatStockpileVolumeM3(latestVolumeM3)} m³
                            </span>
                            {deducedTonnageT !== null && (
                                <span className="text-[18px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                    ~ {deducedTonnageT.toFixed(1)} t
                                </span>
                            )}
                            {asset.tipo_granulometria && (
                                <span className="text-microcopy font-bold uppercase text-[#00AEEF]">
                                    {asset.tipo_granulometria}
                                </span>
                            )}
                        </div>

                        {asset.copper_domain && (
                            <span className="block text-microcopy font-bold uppercase text-[#475569] dark:text-[#8A93A6] truncate">
                                {t(`copper_domains.${asset.copper_domain}`, asset.copper_domain)}
                            </span>
                        )}
                    </div>
                </section>

                {/* Selector de tipo de cierre exclusivamente por iconos */}
                <section
                    role="radiogroup"
                    aria-label={t('lifecycle.closure_type_label', 'TIPO DE CIERRE')}
                    className="grid grid-cols-2 border-b border-[#E2E8F0] dark:border-[#12151C] divide-x divide-[#E2E8F0] dark:divide-[#12151C]"
                >
                    <button
                        type="button"
                        role="radio"
                        aria-checked={mode === 'SHIPPED'}
                        aria-label={t('lifecycle.mode_shipped', 'DESPACHO')}
                        title={t('lifecycle.mode_shipped', 'DESPACHO')}
                        onClick={() => {
                            void triggerFieldImpact('LIGHT');
                            setMode('SHIPPED');
                            setErrorText(null);
                        }}
                        className={`min-h-[88px] bg-transparent border-0 border-b-2 flex items-center justify-center cursor-pointer rounded-none transition-colors ${
                            mode === 'SHIPPED'
                                ? 'border-b-[#C68346] text-[#C68346]'
                                : 'border-b-transparent text-[#475569] dark:text-[#8A93A6]'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[40px]">
                            delivery_truck_speed
                        </span>
                    </button>

                    <button
                        type="button"
                        role="radio"
                        aria-checked={mode === 'FIELD_REMOVED'}
                        aria-label={t('lifecycle.mode_removed', 'ELIMINACIÓN')}
                        title={t('lifecycle.mode_removed', 'ELIMINACIÓN')}
                        onClick={() => {
                            void triggerFieldImpact('LIGHT');
                            setMode('FIELD_REMOVED');
                            setErrorText(null);
                        }}
                        className={`min-h-[88px] bg-transparent border-0 border-b-2 flex items-center justify-center cursor-pointer rounded-none transition-colors ${
                            mode === 'FIELD_REMOVED'
                                ? 'border-b-[#C68346] text-[#C68346]'
                                : 'border-b-transparent text-[#475569] dark:text-[#8A93A6]'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[40px]">delete_sweep</span>
                    </button>
                </section>

                {errorText && (
                    <div
                        role="alert"
                        className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[4px] border-l-[#C68346] font-mono text-[15px] font-bold text-[#C68346]"
                    >
                        {errorText}
                    </div>
                )}

                {mode === 'SHIPPED' && governanceResult.hasCriticalBlock && (
                    <div
                        role="alert"
                        className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] border-l-[4px] border-l-[#C68346] font-mono text-[15px] font-bold text-[#C68346]"
                    >
                        {t('copper_governance.dispatch_blocked', 'DESPACHO BLOQUEADO (IMSBC)')}
                    </div>
                )}

                <form
                    autoComplete="off"
                    spellCheck={false}
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleRequestConfirm();
                    }}
                    className="px-fib-21 py-fib-21 space-y-fib-21"
                >
                    {mode === 'SHIPPED' ? (
                        <>
                            <div className="space-y-1">
                                <label className="block font-mono text-microcopy font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                    {t('lifecycle.dispatch_transport_label', 'TRANSPORTE')}
                                </label>
                                <input
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={dispatchTransport}
                                    onChange={(e) => setDispatchTransport(e.target.value)}
                                    placeholder={t(
                                        'lifecycle.dispatch_transport_placeholder',
                                        'CAMIÓN / PATENTE / FLOTA'
                                    )}
                                    className="w-full h-12 px-0 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[16px] uppercase text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] rounded-none"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="block font-mono text-microcopy font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                    {t('lifecycle.dispatch_destination_label', 'DESTINO')}
                                </label>
                                <input
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={dispatchDestination}
                                    onChange={(e) => setDispatchDestination(e.target.value)}
                                    placeholder={t(
                                        'lifecycle.dispatch_destination_placeholder',
                                        'PLANTA / CHANCADO / PUERTO'
                                    )}
                                    className="w-full h-12 px-0 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[16px] uppercase text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] rounded-none"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="block font-mono text-microcopy font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                    {t('lifecycle.dispatch_timestamp_label', 'FECHA Y HORA')}
                                </label>
                                <input
                                    type="datetime-local"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={dispatchTimestampInput}
                                    onChange={(e) => setDispatchTimestampInput(e.target.value)}
                                    className="w-full h-12 px-0 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono tabular-nums text-[16px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="block font-mono text-microcopy font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                    {t('lifecycle.dispatch_ref_optional_label', 'GUÍA / LOTE (OPCIONAL)')}
                                </label>
                                <input
                                    type="text"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={dispatchReference}
                                    onChange={(e) => setDispatchReference(e.target.value)}
                                    placeholder={t('lifecycle.dispatch_ref_label', 'GUÍA / LOTE')}
                                    className="w-full h-12 px-0 bg-transparent border-0 border-b border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[16px] uppercase text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] rounded-none"
                                />
                            </div>

                            <div className="pt-fib-8 border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-8 font-mono">
                                <span className="text-microcopy font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                                    {t('lifecycle.deduced_tonnage_label', 'TONELAJE DEDUCIDO')}
                                </span>
                                <span className="text-[16px] font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                    {deducedTonnageT !== null ? `~ ${deducedTonnageT.toFixed(1)} t` : '--'}
                                </span>
                            </div>
                            <span className="block font-mono text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                {t(
                                    'lifecycle.weighbridge_destination_note',
                                    'ROMANA DE DESTINO DETERMINA PESO FINAL'
                                )}
                            </span>
                        </>
                    ) : (
                        <div className="space-y-fib-8">
                            <label className="block font-mono text-microcopy font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                {t('lifecycle.closure_cause_label', 'CAUSA EN TERRENO')}
                            </label>
                            <textarea
                                autoComplete="off"
                                spellCheck={false}
                                rows={4}
                                value={closureCause}
                                onChange={(e) => setClosureCause(e.target.value)}
                                placeholder={t(
                                    'lifecycle.closure_cause_placeholder',
                                    'CAUSA DEL CIERRE EN TERRENO'
                                )}
                                className="w-full px-fib-13 py-fib-13 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-[16px] text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] rounded-none resize-none"
                            />
                        </div>
                    )}
                </form>
            </div>

            <nav className="shrink-0 h-[64px] border-t border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] px-fib-21 pb-[env(safe-area-inset-bottom)] flex items-center justify-around">
                <button
                    type="button"
                    onClick={() => {
                        void triggerFieldImpact('LIGHT');
                        onCloseToActiveList();
                    }}
                    disabled={isSaving}
                    aria-label={t('common.close_button', 'CERRAR')}
                    title={t('common.close_button', 'CERRAR')}
                    className="min-w-[64px] min-h-[56px] bg-transparent border-0 outline-none text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] flex items-center justify-center cursor-pointer disabled:opacity-40 rounded-none"
                >
                    <span className="material-symbols-outlined text-[28px]">close</span>
                </button>

                <button
                    type="button"
                    onClick={handleRequestConfirm}
                    disabled={isSaving || (mode === 'SHIPPED' && governanceResult.hasCriticalBlock)}
                    aria-label={t('lifecycle.confirm_closure_aria', 'Confirmar cierre en terreno')}
                    title={t('lifecycle.confirm_closure_aria', 'Confirmar cierre en terreno')}
                    className="min-w-[64px] min-h-[56px] bg-transparent border-0 outline-none text-[#00AEEF] flex items-center justify-center cursor-pointer disabled:opacity-35 rounded-none"
                >
                    <span className="material-symbols-outlined text-[32px]">check</span>
                </button>
            </nav>

            <HitlConfirmModal
                open={Boolean(pendingDiffs)}
                title={t('hitl.modal_title', 'CONFIRMACIÓN HITL')}
                description={t(
                    'hitl.modal_description',
                    'Escriba ACTUALIZAR para confirmar el registro oficial.'
                )}
                keyword="ACTUALIZAR"
                comparisonDiff={pendingDiffs ?? undefined}
                loading={isSaving}
                onConfirm={() => void executeClosure()}
                onCancel={() => setPendingDiffs(null)}
            />
        </div>
    );
};
