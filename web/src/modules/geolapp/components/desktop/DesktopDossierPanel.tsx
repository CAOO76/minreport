import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ReportBlockEditable,
    ReportFieldRow,
    UNDECLARED_TECH_VALUE,
} from '../../../../components/common/ReportBlockEditable';
import { calculationEngine } from '../../core/services/calculation-engine';
import { CopperGovernanceBanner } from '../../core/utils/captureHelpers';
import type { MiningSiteProfile, StockpileAsset } from '../../core/types/GeolappTypes';
import { ExternalSensorsPanel } from '../ExternalSensorsPanel';
import { computeAssetMetallurgySummary, resolveCanonicalFix } from './desktopHelpers';

export interface DesktopDossierPanelProps {
    asset: StockpileAsset | null;
    sites?: MiningSiteProfile[];
}

export const DesktopDossierPanel: React.FC<DesktopDossierPanelProps> = ({ asset }) => {
    const { t } = useTranslation();

    const [showSensorsDrawer, setShowSensorsDrawer] = useState(false);
    const [showMetallurgyBlock, setShowMetallurgyBlock] = useState(true);

    const canonicalFix = useMemo(() => resolveCanonicalFix(asset), [asset]);
    const governanceResult = useMemo(
        () =>
            calculationEngine.evaluateCopperGovernance({
                copperDomain: asset?.copper_domain,
                residenceDays: asset?.residence_days ?? null,
                moisturePct: asset?.moisture_pct ?? null,
                tmlLimitPct: asset?.tml_pct ?? null,
            }),
        [asset?.copper_domain, asset?.residence_days, asset?.moisture_pct, asset?.tml_pct]
    );

    if (!asset) {
        return null;
    }

    const summary = computeAssetMetallurgySummary(asset);
    const domainDisplay = asset.copper_domain
        ? t(`copper_domains.${asset.copper_domain}`, asset.copper_domain)
        : null;
    const isClosed = asset.status === 'CLOSED';
    const closureTypeDisplay =
        asset.closure_reason === 'SHIPPED'
            ? t('lifecycle.closure_shipped_label', 'DESPACHO')
            : asset.closure_reason === 'FIELD_REMOVED'
              ? t('lifecycle.closure_removed_label', 'ELIMINACIÓN EN TERRENO')
              : asset.closure_reason === 'ZERO_VOLUME'
                ? t('lifecycle.closure_zero_label', 'VOLUMEN 0 m³')
                : asset.closure_reason || null;

    return (
        <aside className="h-full min-h-0 flex flex-col border-l border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] overflow-hidden rounded-none shadow-none">
            <header className="shrink-0 px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-8">
                <span className="text-microcopy font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                    {t('hitl.report_mode', 'INFORME TÉCNICO')}
                </span>
                <span className="material-symbols-outlined text-[18px] text-[#475569] dark:text-[#8A93A6]" aria-hidden="true">
                    description
                </span>
            </header>

            <div className="flex-1 overflow-y-auto p-fib-21 space-y-fib-21">
                <CopperGovernanceBanner result={governanceResult} />

                <ReportBlockEditable
                    code="01"
                    title={t('dossier.block_identity', 'IDENTIFICACIÓN Y GEORREFERENCIA')}
                    isEditing={false}
                    canEdit={false}
                    onToggleEdit={() => {}}
                >
                    <div>
                        <ReportFieldRow
                            label={t('faenas.site_label', 'FAENA MINERA')}
                            value={asset.project_name}
                        />
                        <ReportFieldRow
                            label={t('registration.name_label', 'CÓDIGO')}
                            value={asset.name}
                            copyable
                        />
                        <ReportFieldRow
                            label={t('registration.location_ref_label', 'UBICACIÓN')}
                            value={asset.location_ref}
                        />
                        <ReportFieldRow
                            label={t('analytics.geospatial_utm_title', 'UTM WGS84')}
                            value={canonicalFix?.utm.formatted}
                            copyable={Boolean(canonicalFix)}
                        />
                        <ReportFieldRow
                            label={t('registration.description_label', 'DESCRIPCIÓN')}
                            value={asset.description}
                            mono={false}
                        />
                    </div>
                </ReportBlockEditable>

                <ReportBlockEditable
                    code="02"
                    title={t('dossier.block_material', 'MATERIAL Y DENSIDAD')}
                    isEditing={false}
                    canEdit={false}
                    onToggleEdit={() => {}}
                >
                    <div>
                        <ReportFieldRow
                            label={t('registration.copper_domain_label', 'DOMINIO Cu')}
                            value={domainDisplay}
                        />
                        <ReportFieldRow
                            label={t('manual_capture.fields.density_factor', 'DENSIDAD')}
                            value={
                                asset.density_factor != null
                                    ? `${asset.density_factor} t/m³`
                                    : null
                            }
                        />
                        <ReportFieldRow
                            label={t('scanner.granulometry_label', 'GRANULOMETRÍA')}
                            value={asset.tipo_granulometria}
                        />
                        <ReportFieldRow
                            label={t('rosin_rammler.p80_label', 'P80 (mm)')}
                            value={
                                typeof asset.p80_mm === 'number'
                                    ? `${asset.p80_mm.toFixed(1)} mm`
                                    : null
                            }
                        />
                    </div>
                </ReportBlockEditable>

                <ReportBlockEditable
                    code="03"
                    title={t('copper_governance.title', 'GEO-METALURGIA Cu E IMSBC')}
                    isEditing={false}
                    canEdit={false}
                    collapsed={!showMetallurgyBlock}
                    onToggleEdit={() => {}}
                    headerActions={
                        <button
                            type="button"
                            onClick={() => setShowMetallurgyBlock((prev) => !prev)}
                            aria-label={t('copper_governance.title', 'GEO-METALURGIA Cu E IMSBC')}
                            className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none"
                        >
                            <span className="material-symbols-outlined text-[18px]">
                                {showMetallurgyBlock ? 'expand_less' : 'expand_more'}
                            </span>
                        </button>
                    }
                >
                    <div>
                        <ReportFieldRow
                            label={t('copper_governance.moisture', 'HUMEDAD w%')}
                            value={
                                asset.moisture_pct != null ? `${asset.moisture_pct} %` : null
                            }
                        />
                        <ReportFieldRow
                            label="CuT / CuS"
                            value={
                                asset.cu_total_pct != null || asset.cu_soluble_pct != null
                                    ? `${asset.cu_total_pct ?? '--'}% / ${asset.cu_soluble_pct ?? '--'}%`
                                    : null
                            }
                        />
                        <ReportFieldRow
                            label={t('copper_governance.fine_cu', 'Cu FINO')}
                            value={summary.fineCuT != null ? `${summary.fineCuT} t` : null}
                        />
                        <ReportFieldRow
                            label={t('copper_governance.tml', 'TML IMSBC')}
                            value={asset.tml_pct != null ? `${asset.tml_pct} %` : null}
                        />
                        <ReportFieldRow
                            label={t('copper_governance.scale_weight', 'PESO ROMANA')}
                            value={
                                asset.peso_romana != null ? `${asset.peso_romana} t` : null
                            }
                        />
                    </div>
                </ReportBlockEditable>

                {isClosed && (
                    <ReportBlockEditable
                        code="04"
                        title={t('dossier.block_closure', 'CIERRE DE CICLO')}
                        isEditing={false}
                        canEdit={false}
                        onToggleEdit={() => {}}
                    >
                        <div>
                            <ReportFieldRow
                                label={t('lifecycle.closure_type_label', 'TIPO DE CIERRE')}
                                value={closureTypeDisplay}
                            />
                            {asset.closure_reason === 'SHIPPED' && asset.dispatch_transport && (
                                <ReportFieldRow
                                    label={t('lifecycle.dispatch_transport_label', 'TRANSPORTE')}
                                    value={asset.dispatch_transport}
                                    mono={false}
                                />
                            )}
                            {asset.closure_reason === 'SHIPPED' && asset.dispatch_destination && (
                                <ReportFieldRow
                                    label={t('lifecycle.dispatch_destination_label', 'DESTINO')}
                                    value={asset.dispatch_destination}
                                    mono={false}
                                />
                            )}
                            {asset.closure_reason === 'SHIPPED' &&
                                typeof asset.dispatch_timestamp === 'number' &&
                                Number.isFinite(asset.dispatch_timestamp) && (
                                    <ReportFieldRow
                                        label={t(
                                            'lifecycle.dispatch_timestamp_label',
                                            'FECHA/HORA DESPACHO'
                                        )}
                                        value={new Date(asset.dispatch_timestamp).toLocaleString()}
                                    />
                                )}
                            {asset.dispatch_reference && (
                                <ReportFieldRow
                                    label={t('lifecycle.dispatch_ref_label', 'GUÍA / LOTE')}
                                    value={asset.dispatch_reference}
                                    copyable
                                />
                            )}
                            {asset.closure_cause && (
                                <ReportFieldRow
                                    label={t('lifecycle.closure_cause_label', 'CAUSA EN TERRENO')}
                                    value={asset.closure_cause}
                                    mono={false}
                                />
                            )}
                            {typeof asset.shipped_weight_t === 'number' &&
                                Number.isFinite(asset.shipped_weight_t) && (
                                    <ReportFieldRow
                                        label={t(
                                            'lifecycle.deduced_tonnage_label',
                                            'TONELAJE DEDUCIDO'
                                        )}
                                        value={`${asset.shipped_weight_t.toFixed(1)} t`}
                                    />
                                )}
                            <ReportFieldRow
                                label={t('lifecycle.closed_at_label', 'FECHA CIERRE')}
                                value={
                                    typeof asset.closed_at === 'number'
                                        ? new Date(asset.closed_at).toLocaleString()
                                        : UNDECLARED_TECH_VALUE
                                }
                            />
                            <ReportFieldRow
                                label={t('lifecycle.closed_by_label', 'OPERADOR')}
                                value={asset.closed_by}
                            />
                            <ReportFieldRow
                                label={t('lifecycle.closure_origin_label', 'ORIGEN')}
                                value={asset.closure_origin}
                            />
                        </div>
                    </ReportBlockEditable>
                )}

                <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] rounded-none">
                    <button
                        type="button"
                        onClick={() => setShowSensorsDrawer((p) => !p)}
                        className="w-full px-fib-21 py-fib-13 flex items-center justify-between bg-[#F8FAFC] dark:bg-[#000000] border-0 cursor-pointer rounded-none"
                    >
                        <span className="text-microcopy font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                            {t('adapters.gnss_title', 'SENSORES EXTERNOS RTK / LiDAR / UAV')}
                        </span>
                        <span className="material-symbols-outlined text-[18px] text-[#475569] dark:text-[#8A93A6]">
                            {showSensorsDrawer ? 'expand_less' : 'expand_more'}
                        </span>
                    </button>
                    {showSensorsDrawer && (
                        <div className="p-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C]">
                            <ExternalSensorsPanel compact tenantId={asset.tenantId} />
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
};
