import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import M3LinearProgress from '../../../components/common/M3LinearProgress';
import { cn } from '../../../utils/cn';
import type { SupplyPrimaryTab } from '../SupplyWorkspace';
import {
    formatClp,
    type DemandForecastSummary,
    type SupplyAssetRecord,
    type SupplyBusinessUnitKpis,
    type SupplySite,
    type SupplyWarehouse,
    type SupplyWarehouseBalance,
    type SupplyWarehouseClass,
} from '../types';

export interface SupplyControlDashboardViewProps {
    kpis: SupplyBusinessUnitKpis | null;
    warehouses: SupplyWarehouse[];
    balances: SupplyWarehouseBalance[];
    forecast: DemandForecastSummary | null;
    activeSite?: SupplySite | null;
    loading?: boolean;
    openRequisitionsCount: number;
    inTransitCount: number;
    rcvUrgentCount: number;
    assets: SupplyAssetRecord[];
    sitesCount: number;
    onNavigateTab?: (tab: SupplyPrimaryTab) => void;
}

interface ResourceRow {
    key: 'POTABLE_WATER' | 'IND_WATER' | 'CAMP_FUEL' | 'FLEET_FUEL' | 'GAS_CYLINDERS';
    icon: string;
    primaryMetric: string;
    secondaryMetric: string;
    pct: number;
    alert: boolean;
}

export const SupplyControlDashboardView: React.FC<SupplyControlDashboardViewProps> = ({
    kpis,
    warehouses,
    balances,
    forecast,
    activeSite,
    loading = false,
    openRequisitionsCount,
    inTransitCount,
    rcvUrgentCount,
    assets,
    sitesCount,
    onNavigateTab,
}) => {
    const { t } = useTranslation();

    const assetsWithoutInvoice = useMemo(
        () =>
            assets.filter(
                (a) => a.missingInvoiceAlert || (a.invoiceDteType !== 33 && a.invoiceDteType !== 34)
            ).length,
        [assets]
    );

    const sumClassBalance = (classes: SupplyWarehouseClass[]) => {
        const set = new Set(classes);
        const matchingWarehouses = warehouses.filter((w) => set.has(w.warehouseClass));
        const capacity = matchingWarehouses.reduce((acc, w) => acc + (w.maxCapacitySi || 0), 0);
        const onHand = balances
            .filter((b) => set.has(b.warehouseClass))
            .reduce((acc, b) => acc + (b.qtyOnHand || 0), 0);
        return { capacity, onHand, count: matchingWarehouses.length };
    };

    const resourceRows = useMemo<ResourceRow[]>(() => {
        const potable = sumClassBalance(['POTABLE_WATER_TANK']);
        const potableStoredL =
            kpis?.camp.potableWaterWarehouseL ??
            (potable.count > 0
                ? potable.onHand
                : forecast?.waterStoredL ?? activeSite?.waterStorageCapacityL ?? 0);
        const potableTargetL = forecast?.waterRequiredLeadL || potable.capacity || 0;
        const potablePct =
            potableTargetL > 0
                ? Math.min(100, Math.round((potableStoredL / potableTargetL) * 100))
                : kpis?.camp.ds594CompliancePct ?? 100;
        const potableAlert = kpis
            ? kpis.camp.ds594CompliancePct < 100
            : forecast
              ? !forecast.waterCompliantDs594
              : false;

        const indWater = sumClassBalance(['INDUSTRIAL_WATER_POND']);
        const indWaterM3 = kpis?.mineAndPlant.industrialWaterStockM3 ?? indWater.onHand;
        const indPct =
            indWater.capacity > 0
                ? Math.min(100, Math.round((indWater.onHand / indWater.capacity) * 100))
                : indWaterM3 > 0
                  ? 65
                  : 0;

        const campFuel = sumClassBalance(['FUEL_TANK_CAMP']);
        const campFuelPct =
            campFuel.capacity > 0
                ? Math.min(100, Math.round((campFuel.onHand / campFuel.capacity) * 100))
                : campFuel.onHand > 0
                  ? 55
                  : 0;

        const fleetFuel = sumClassBalance(['FUEL_TANK_FLEET']);
        const fleetPct =
            fleetFuel.capacity > 0
                ? Math.min(100, Math.round((fleetFuel.onHand / fleetFuel.capacity) * 100))
                : fleetFuel.onHand > 0
                  ? 60
                  : 0;
        const fleetVariance = kpis?.fleetAndWorkshop.tankCycleCountVariancePctMax ?? 0;
        const fleetAlert = fleetVariance > 2.5 || (kpis?.fleetAndWorkshop.tankAnomalyCount ?? 0) > 0;

        const gasCages = sumClassBalance(['GLP_CAGE', 'INDUSTRIAL_GAS_CAGE']);
        const fullCyl = kpis?.fleetAndWorkshop.cylinderFullCount ?? 0;
        const emptyCyl = kpis?.fleetAndWorkshop.cylinderEmptyCount ?? 0;
        const totalCyl = fullCyl + emptyCyl;
        const gasPct =
            totalCyl > 0
                ? Math.round((fullCyl / totalCyl) * 100)
                : gasCages.capacity > 0
                  ? Math.min(100, Math.round((gasCages.onHand / gasCages.capacity) * 100))
                  : 0;

        const waterCoverageDays = forecast?.waterCoverageDays;

        return [
            {
                key: 'POTABLE_WATER',
                icon: 'water_drop',
                primaryMetric: `${potableStoredL.toLocaleString('es-CL')} L`,
                secondaryMetric: `${waterCoverageDays !== undefined ? `${waterCoverageDays} ${t('supply.common.days_short')} · ` : ''}${kpis?.camp.potableWaterLPerPaxDay ?? 0} L/persona/día`,
                pct: potablePct,
                alert: potableAlert,
            },
            {
                key: 'IND_WATER',
                icon: 'local_shipping',
                primaryMetric: `${indWaterM3.toLocaleString('es-CL')} m³`,
                secondaryMetric: `${kpis?.mineAndPlant.industrialWaterM3PerTon ?? 0} m³/tonelada`,
                pct: indPct,
                alert: false,
            },
            {
                key: 'CAMP_FUEL',
                icon: 'local_gas_station',
                primaryMetric: `${campFuel.onHand.toLocaleString('es-CL')} L`,
                secondaryMetric: `${kpis?.camp.campDieselLPerDay ?? 0} L diarios`,
                pct: campFuelPct,
                alert: false,
            },
            {
                key: 'FLEET_FUEL',
                icon: 'precision_manufacturing',
                primaryMetric: `${(kpis?.fleetAndWorkshop.fleetFuelDispensed30dL ?? fleetFuel.onHand).toLocaleString('es-CL')} L`,
                secondaryMetric: `${kpis?.fleetAndWorkshop.fleetAvgLitersPerHour ?? 0} L/hr · diferencia ${fleetVariance.toFixed(1)}%`,
                pct: fleetPct,
                alert: fleetAlert,
            },
            {
                key: 'GAS_CYLINDERS',
                icon: 'propane_tank',
                primaryMetric: `${fullCyl} / ${totalCyl}`,
                secondaryMetric: `${kpis?.camp.glpKgPerPaxDay ?? 0} kg/persona/día`,
                pct: gasPct,
                alert: false,
            },
        ];
    }, [activeSite, balances, forecast, kpis, t, warehouses]);

    const exceptions = useMemo(() => {
        const list: Array<{
            id: string;
            label: string;
            metric: string;
            targetTab: SupplyPrimaryTab;
        }> = [];

        if (kpis && kpis.camp.ds594CompliancePct < 100) {
            list.push({
                id: 'EXC_DS594',
                label: t('supply.control.exc_ds594'),
                metric: `${kpis.camp.ds594CompliancePct}%`,
                targetTab: 'WAREHOUSE',
            });
        } else if (forecast && !forecast.waterCompliantDs594) {
            list.push({
                id: 'EXC_DS594_FC',
                label: t('supply.control.exc_ds594'),
                metric: `${forecast.waterCoverageDays} ${t('supply.common.days_short')}`,
                targetTab: 'WAREHOUSE',
            });
        }

        if (
            kpis &&
            (kpis.fleetAndWorkshop.tankCycleCountVariancePctMax > 2.5 ||
                kpis.fleetAndWorkshop.tankAnomalyCount > 0)
        ) {
            list.push({
                id: 'EXC_TANK_VAR',
                label: t('supply.control.exc_tank_variance'),
                metric: `${kpis.fleetAndWorkshop.tankCycleCountVariancePctMax.toFixed(1)}%`,
                targetTab: 'WAREHOUSE',
            });
        }

        if (kpis && (kpis.mineAndPlant.stockoutCount > 0 || kpis.ropSummary.criticalReorderCount > 0)) {
            list.push({
                id: 'EXC_STOCKOUT',
                label: t('supply.control.exc_stockout'),
                metric: `${kpis.mineAndPlant.stockoutCount + kpis.ropSummary.criticalReorderCount}`,
                targetTab: 'PROCUREMENT',
            });
        }

        const effectiveRcvUrgent = kpis?.financeSii.rcvUrgentUnder48hCount ?? rcvUrgentCount;
        if (effectiveRcvUrgent > 0) {
            list.push({
                id: 'EXC_RCV_48H',
                label: t('supply.control.exc_rcv_urgent'),
                metric: `${effectiveRcvUrgent}`,
                targetTab: 'FINANCE_SII',
            });
        }

        if (kpis && kpis.financeSii.openDiscrepanciesCount > 0) {
            list.push({
                id: 'EXC_DISCREPANCY',
                label: t('supply.control.exc_discrepancies'),
                metric: `${kpis.financeSii.openDiscrepanciesCount}`,
                targetTab: 'WAREHOUSE',
            });
        }

        const capexMissing = (kpis?.financeSii.capexInOpexCount ?? 0) + assetsWithoutInvoice;
        if (capexMissing > 0) {
            list.push({
                id: 'EXC_CAPEX',
                label: t('supply.control.exc_capex_leakage'),
                metric: `${capexMissing}`,
                targetTab: 'FINANCE_SII',
            });
        }

        return list;
    }, [assetsWithoutInvoice, forecast, kpis, rcvUrgentCount, t]);

    return (
        <div
            data-testid="supply-control-summary"
            className="w-full h-full min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,61.8fr)_minmax(0,38.2fr)] bg-[#FFFFFF] dark:bg-[#000000] select-none"
        >
            {/* Izquierda 61.8%: Lienzo Plano — Recursos críticos + Resumen por área */}
            <div className="min-h-0 overflow-y-auto p-fib-21 sm:p-fib-34 space-y-fib-34 border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C]">
                <header className="flex flex-wrap items-baseline justify-between gap-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                    <h2 className="text-[22px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('supply.control.title')}
                    </h2>
                    <span className="text-[15px] tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        {sitesCount} {t('supply.control.kpi_sites_active')} · {openRequisitionsCount}{' '}
                        {t('supply.control.kpi_open_reqs')} · {inTransitCount}{' '}
                        {t('supply.control.kpi_in_transit')}
                    </span>
                </header>

                {/* 5 Recursos Críticos en Filas Planas (cero cajas anidadas) */}
                <section className="space-y-fib-13" data-testid="control-separated-resources">
                    <h3 className="text-[17px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('supply.control.resources_title')}
                    </h3>
                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {resourceRows.map((row) => (
                            <div
                                key={row.key}
                                data-testid={`control-resource-${row.key}`}
                                className={cn(
                                    'py-fib-13 border-l-[3px] pl-fib-13 space-y-fib-8',
                                    row.alert ? 'border-l-[#C68346]' : 'border-l-transparent'
                                )}
                            >
                                <div className="flex flex-wrap items-center justify-between gap-fib-13">
                                    <div className="flex items-center gap-fib-13 min-w-0">
                                        <span
                                            className={cn(
                                                'material-symbols-outlined text-[22px]',
                                                row.alert
                                                    ? 'text-[#C68346]'
                                                    : 'text-[#475569] dark:text-[#8A93A6]'
                                            )}
                                        >
                                            {row.icon}
                                        </span>
                                        <div>
                                            <div className="text-[17px] font-medium text-[#0F172A] dark:text-[#F3F4F6]">
                                                {t(`supply.control.res_${row.key}`)}
                                            </div>
                                            <div className="text-[14px] text-[#475569] dark:text-[#8A93A6] tabular-nums">
                                                {row.secondaryMetric}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="font-mono text-[24px] font-bold tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                                        {row.primaryMetric}
                                    </div>
                                </div>
                                {!loading && (
                                    <M3LinearProgress
                                        value={row.pct}
                                        ariaLabel={t(`supply.control.res_${row.key}`)}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </section>

                {/* Resumen por Área (Lienzo Plano sin cajas ni encabezados decorativos) */}
                <section className="space-y-fib-21" data-testid="control-bu-kpis">
                    <h3 className="text-[17px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('supply.control.bu_kpis_title')}
                    </h3>

                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {/* Campamento */}
                        <div className="py-fib-21 space-y-fib-13">
                            <div className="text-[16px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('supply.control.bu_camp')}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-fib-21 tabular-nums">
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_food_pax_day')}
                                    </div>
                                    <div className="font-mono text-[20px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? formatClp(kpis.camp.foodOpexPerPaxDayClp) : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_water_pax_day')}
                                    </div>
                                    <div className="font-mono text-[20px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? `${kpis.camp.potableWaterLPerPaxDay} L` : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_glp_pax_day')}
                                    </div>
                                    <div className="font-mono text-[20px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? `${kpis.camp.glpKgPerPaxDay} kg` : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_camp_diesel_day')}
                                    </div>
                                    <div className="font-mono text-[20px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? `${kpis.camp.campDieselLPerDay} L` : '—'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Maquinaria y Taller */}
                        <div className="py-fib-21 space-y-fib-13">
                            <div className="text-[16px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('supply.control.bu_fleet')}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-fib-21 tabular-nums">
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_fleet_lph')}
                                    </div>
                                    <div className="font-mono text-[20px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? `${kpis.fleetAndWorkshop.fleetAvgLitersPerHour} L/hr` : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_tank_variance')}
                                    </div>
                                    <div
                                        className={cn(
                                            'font-mono text-[20px] font-bold',
                                            (kpis?.fleetAndWorkshop.tankCycleCountVariancePctMax ?? 0) > 2.5
                                                ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                        )}
                                    >
                                        {kpis
                                            ? `${kpis.fleetAndWorkshop.tankCycleCountVariancePctMax.toFixed(1)}%`
                                            : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_cylinder_stay')}
                                    </div>
                                    <div className="font-mono text-[20px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis
                                            ? `${kpis.fleetAndWorkshop.cylinderStayDaysAvg.toFixed(1)} ${t('supply.common.days_short')}`
                                            : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_active_fleet')}
                                    </div>
                                    <div className="font-mono text-[20px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? kpis.fleetAndWorkshop.activeMachineryCount : '—'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Mina y Planta */}
                        <div className="py-fib-21 space-y-fib-13">
                            <div className="text-[16px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('supply.control.bu_mine')}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-fib-21 tabular-nums">
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_ind_water_t')}
                                    </div>
                                    <div className="font-mono text-[20px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? `${kpis.mineAndPlant.industrialWaterM3PerTon} m³/t` : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_stockouts')}
                                    </div>
                                    <div
                                        className={cn(
                                            'font-mono text-[20px] font-bold',
                                            (kpis?.mineAndPlant.stockoutCount ?? 0) > 0
                                                ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                        )}
                                    >
                                        {kpis ? kpis.mineAndPlant.stockoutCount : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_otif')}
                                    </div>
                                    <div className="font-mono text-[20px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? `${kpis.mineAndPlant.otifPct}%` : '—'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Finanzas e Impuestos */}
                        <div className="py-fib-21 space-y-fib-13">
                            <div className="text-[16px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('supply.control.bu_finance')}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-fib-21 tabular-nums">
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_vat_recovered')}
                                    </div>
                                    <div className="font-mono text-[20px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? `${kpis.financeSii.vatRecoveryRatePct}%` : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_rcv_urgent')}
                                    </div>
                                    <div
                                        className={cn(
                                            'font-mono text-[20px] font-bold',
                                            (kpis?.financeSii.rcvUrgentUnder48hCount ?? rcvUrgentCount) > 0
                                                ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                        )}
                                    >
                                        {kpis?.financeSii.rcvUrgentUnder48hCount ?? rcvUrgentCount}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[14px] text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_capex_leakage')}
                                    </div>
                                    <div
                                        className={cn(
                                            'font-mono text-[20px] font-bold',
                                            (kpis?.financeSii.capexLeakagePct ?? 0) > 0
                                                ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                        )}
                                    >
                                        {kpis ? `${kpis.financeSii.capexLeakagePct}%` : '0%'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            {/* Derecha 38.2%: Atención Requerida Hoy (ANSI/ISA-101 Color por Excepción) */}
            <aside className="min-h-0 overflow-y-auto p-fib-21 sm:p-fib-34 space-y-fib-21 bg-[#FFFFFF] dark:bg-[#000000]">
                <div className="flex items-baseline justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                    <h3 className="text-[18px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('supply.control.exceptions_title')}
                    </h3>
                    <span
                        className={cn(
                            'text-[14px] font-semibold',
                            exceptions.length > 0
                                ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                : 'text-[#0369A1] dark:text-[#00AEEF]'
                        )}
                    >
                        {exceptions.length > 0
                            ? `${exceptions.length} ${t('supply.control.status_alert')}`
                            : t('supply.control.status_nominal')}
                    </span>
                </div>

                {exceptions.length === 0 ? (
                    <div className="border-l-[3px] border-l-[#00AEEF] pl-fib-13 py-fib-13 text-[16px] text-[#0369A1] dark:text-[#00AEEF] flex items-center gap-fib-8">
                        <span className="material-symbols-outlined text-[20px]">check_circle</span>
                        <span>{t('supply.control.no_exceptions')}</span>
                    </div>
                ) : (
                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {exceptions.map((exc) => (
                            <button
                                key={exc.id}
                                type="button"
                                onClick={() => onNavigateTab?.(exc.targetTab)}
                                data-testid={`control-exc-${exc.id}`}
                                className="w-full text-left py-fib-13 pl-fib-13 pr-fib-8 min-h-[52px] border-0 border-l-[3px] border-l-[#C68346] flex items-center justify-between gap-fib-13 hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] cursor-pointer rounded-none shadow-none tabular-nums"
                            >
                                <span className="text-[16px] font-semibold text-[#7C3F0E] dark:text-[#C68346]">
                                    {exc.label}
                                </span>
                                <span className="font-mono text-[18px] font-bold text-[#0F172A] dark:text-[#F3F4F6] shrink-0">
                                    {exc.metric}
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {kpis && (
                    <details
                        data-testid="control-rop-details"
                        className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-21"
                    >
                        <summary className="min-h-[48px] flex items-center justify-between cursor-pointer text-[15px] font-medium text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]">
                            <span>{t('supply.control.rop_drivers_title')}</span>
                            <span className="material-symbols-outlined text-[18px]">expand_more</span>
                        </summary>
                        <div className="pt-fib-13 space-y-fib-8 text-[15px] tabular-nums">
                            <div className="flex items-center justify-between gap-fib-8">
                                <span className="text-[#475569] dark:text-[#8A93A6]">
                                    {t('supply.control.rop_driver_per_pax')}
                                </span>
                                <span className="font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                    {kpis.ropSummary.byDriver.PER_PAX}
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-fib-8">
                                <span className="text-[#475569] dark:text-[#8A93A6]">
                                    {t('supply.control.rop_driver_per_asset')}
                                </span>
                                <span className="font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                    {kpis.ropSummary.byDriver.PER_ASSET_HOUR}
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-fib-8">
                                <span className="text-[#475569] dark:text-[#8A93A6]">
                                    {t('supply.control.rop_driver_daily')}
                                </span>
                                <span className="font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                    {kpis.ropSummary.byDriver.DAILY_SITE_OR_MINMAX}
                                </span>
                            </div>
                        </div>
                    </details>
                )}
            </aside>
        </div>
    );
};

export default SupplyControlDashboardView;
