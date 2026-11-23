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

interface ResourceStageCard {
    key: 'POTABLE_WATER' | 'IND_WATER' | 'CAMP_FUEL' | 'FLEET_FUEL' | 'GAS_CYLINDERS';
    classes: SupplyWarehouseClass[];
    icon: string;
    primaryMetric: string;
    secondaryMetric: string;
    pct: number;
    alert: boolean;
    verified: boolean;
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

    const resourceCards = useMemo<ResourceStageCard[]>(() => {
        const potable = sumClassBalance(['POTABLE_WATER_TANK']);
        const potableStoredL =
            kpis?.camp.potableWaterWarehouseL ??
            (potable.count > 0 ? potable.onHand : forecast?.waterStoredL ?? activeSite?.waterStorageCapacityL ?? 0);
        const potableTargetL = forecast?.waterRequiredLeadL || potable.capacity || 0;
        const potablePct =
            potableTargetL > 0
                ? Math.min(100, Math.round((potableStoredL / potableTargetL) * 100))
                : kpis?.camp.ds594CompliancePct ?? 100;
        const potableAlert =
            (kpis ? kpis.camp.ds594CompliancePct < 100 : forecast ? !forecast.waterCompliantDs594 : false);

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

        return [
            {
                key: 'POTABLE_WATER',
                classes: ['POTABLE_WATER_TANK'],
                icon: 'water_drop',
                primaryMetric: `${potableStoredL.toLocaleString('es-CL')} L`,
                secondaryMetric: `${kpis?.camp.potableWaterLPerPaxDay ?? 0} L/PAX/d · DS 594 ${kpis?.camp.ds594CompliancePct ?? (forecast?.waterCompliantDs594 ? 100 : 0)}%`,
                pct: potablePct,
                alert: potableAlert,
                verified: !potableAlert && potableStoredL > 0,
            },
            {
                key: 'IND_WATER',
                classes: ['INDUSTRIAL_WATER_POND'],
                icon: 'local_shipping',
                primaryMetric: `${indWaterM3.toLocaleString('es-CL')} m3`,
                secondaryMetric: `${kpis?.mineAndPlant.industrialWaterM3PerTon ?? 0} m3/t`,
                pct: indPct,
                alert: false,
                verified: indWaterM3 > 0,
            },
            {
                key: 'CAMP_FUEL',
                classes: ['FUEL_TANK_CAMP'],
                icon: 'local_gas_station',
                primaryMetric: `${campFuel.onHand.toLocaleString('es-CL')} L`,
                secondaryMetric: `${kpis?.camp.campDieselLPerDay ?? 0} L/d · SEC DS 160`,
                pct: campFuelPct,
                alert: false,
                verified: campFuel.onHand > 0,
            },
            {
                key: 'FLEET_FUEL',
                classes: ['FUEL_TANK_FLEET'],
                icon: 'precision_manufacturing',
                primaryMetric: `${(kpis?.fleetAndWorkshop.fleetFuelDispensed30dL ?? fleetFuel.onHand).toLocaleString('es-CL')} L`,
                secondaryMetric: `${kpis?.fleetAndWorkshop.fleetAvgLitersPerHour ?? 0} L/hr · Δ ${fleetVariance.toFixed(1)}%`,
                pct: fleetPct,
                alert: fleetAlert,
                verified: !fleetAlert && (kpis?.fleetAndWorkshop.fleetFuelDispensed30dL ?? fleetFuel.onHand) > 0,
            },
            {
                key: 'GAS_CYLINDERS',
                classes: ['GLP_CAGE', 'INDUSTRIAL_GAS_CAGE'],
                icon: 'propane_tank',
                primaryMetric: `${fullCyl} / ${totalCyl} un`,
                secondaryMetric: `GLP ${kpis?.camp.glpKgPerPaxDay ?? 0} kg/PAX/d · DS 108/43`,
                pct: gasPct,
                alert: false,
                verified: totalCyl > 0,
            },
        ];
    }, [activeSite, balances, forecast, kpis, warehouses]);

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

        if (kpis && (kpis.fleetAndWorkshop.tankCycleCountVariancePctMax > 2.5 || kpis.fleetAndWorkshop.tankAnomalyCount > 0)) {
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
                metric: `${kpis.mineAndPlant.stockoutCount} / ROP ${kpis.ropSummary.criticalReorderCount}`,
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
            {/* Left 61.8%: 5 Separated Tanks / Resources + 4 Business Unit KPI Panels */}
            <div className="min-h-0 overflow-y-auto p-fib-21 space-y-fib-21 border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C]">
                <div className="flex flex-wrap items-center justify-between gap-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                    <h2 className="font-mono text-microcopy uppercase font-bold tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('supply.control.title')}
                    </h2>
                    <span className="font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        {t('supply.control.kpi_sites_active')}: {sitesCount} ·{' '}
                        {t('supply.control.kpi_open_reqs')}: {openRequisitionsCount} ·{' '}
                        {t('supply.control.kpi_in_transit')}: {inTransitCount}
                    </span>
                </div>

                {/* 5 Separated Resources / Tanks */}
                <section className="space-y-fib-13" data-testid="control-separated-resources">
                    <h3 className="font-mono text-microcopy uppercase font-bold tracking-wider text-[#475569] dark:text-[#8A93A6]">
                        {t('supply.control.resources_title')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-fib-13 font-mono tabular-nums">
                        {resourceCards.map((card) => (
                            <div
                                key={card.key}
                                data-testid={`control-resource-${card.key}`}
                                className={cn(
                                    'border border-[#E2E8F0] dark:border-[#12151C] border-l-[3px] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 space-y-fib-8 rounded-none shadow-none',
                                    card.alert
                                        ? 'border-l-[#C68346]'
                                        : card.verified
                                          ? 'border-l-[#00AEEF]'
                                          : 'border-l-transparent'
                                )}
                            >
                                <div className="flex items-center justify-between gap-fib-8">
                                    <span className="text-microcopy uppercase font-bold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                        {t(`supply.control.res_${card.key}`)}
                                    </span>
                                    <span
                                        className={cn(
                                            'material-symbols-outlined text-[18px]',
                                            card.alert
                                                ? 'text-[#C68346]'
                                                : card.verified
                                                  ? 'text-[#00AEEF]'
                                                  : 'text-[#475569] dark:text-[#8A93A6]'
                                        )}
                                    >
                                        {card.icon}
                                    </span>
                                </div>
                                <div className="text-h1-header font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                    {card.primaryMetric}
                                </div>
                                <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                    {card.secondaryMetric}
                                </div>
                                {!loading && (
                                    <M3LinearProgress
                                        value={card.pct}
                                        ariaLabel={t(`supply.control.res_${card.key}`)}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </section>

                {/* 4 Business Unit KPI Panels */}
                <section className="space-y-fib-13" data-testid="control-bu-kpis">
                    <h3 className="font-mono text-microcopy uppercase font-bold tracking-wider text-[#475569] dark:text-[#8A93A6]">
                        {t('supply.control.bu_kpis_title')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13 font-mono tabular-nums">
                        {/* Campamento */}
                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 space-y-fib-8">
                            <div className="text-microcopy uppercase font-bold text-[#C68346]">
                                {t('supply.control.bu_camp')}
                            </div>
                            <div className="grid grid-cols-2 gap-fib-8 text-data-dense">
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_food_pax_day')}
                                    </div>
                                    <div className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? formatClp(kpis.camp.foodOpexPerPaxDayClp) : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_water_pax_day')}
                                    </div>
                                    <div className="font-bold text-[#00AEEF]">
                                        {kpis ? `${kpis.camp.potableWaterLPerPaxDay} L` : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_glp_pax_day')}
                                    </div>
                                    <div className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? `${kpis.camp.glpKgPerPaxDay} kg` : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_camp_diesel_day')}
                                    </div>
                                    <div className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? `${kpis.camp.campDieselLPerDay} L` : '—'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Flota & Taller */}
                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 space-y-fib-8">
                            <div className="text-microcopy uppercase font-bold text-[#0369A1] dark:text-[#00AEEF]">
                                {t('supply.control.bu_fleet')}
                            </div>
                            <div className="grid grid-cols-2 gap-fib-8 text-data-dense">
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_fleet_lph')}
                                    </div>
                                    <div className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? `${kpis.fleetAndWorkshop.fleetAvgLitersPerHour} L/hr` : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_tank_variance')}
                                    </div>
                                    <div
                                        className={cn(
                                            'font-bold',
                                            (kpis?.fleetAndWorkshop.tankCycleCountVariancePctMax ?? 0) > 2.5
                                                ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                : 'text-[#0369A1] dark:text-[#00AEEF]'
                                        )}
                                    >
                                        {kpis
                                            ? `${kpis.fleetAndWorkshop.tankCycleCountVariancePctMax.toFixed(1)}%`
                                            : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_cylinder_stay')}
                                    </div>
                                    <div className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis
                                            ? `${kpis.fleetAndWorkshop.cylinderStayDaysAvg.toFixed(1)} ${t('supply.common.days_short')}`
                                            : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_active_fleet')}
                                    </div>
                                    <div className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? kpis.fleetAndWorkshop.activeMachineryCount : '—'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Mina & Planta */}
                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 space-y-fib-8">
                            <div className="text-microcopy uppercase font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('supply.control.bu_mine')}
                            </div>
                            <div className="grid grid-cols-3 gap-fib-8 text-data-dense">
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_ind_water_t')}
                                    </div>
                                    <div className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                        {kpis ? `${kpis.mineAndPlant.industrialWaterM3PerTon} m3/t` : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_stockouts')}
                                    </div>
                                    <div
                                        className={cn(
                                            'font-bold',
                                            (kpis?.mineAndPlant.stockoutCount ?? 0) > 0
                                                ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                        )}
                                    >
                                        {kpis ? kpis.mineAndPlant.stockoutCount : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        OTIF
                                    </div>
                                    <div className="font-bold text-[#0369A1] dark:text-[#00AEEF]">
                                        {kpis ? `${kpis.mineAndPlant.otifPct}%` : '—'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Finanzas SII */}
                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-13 space-y-fib-8">
                            <div className="text-microcopy uppercase font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                {t('supply.control.bu_finance')}
                            </div>
                            <div className="grid grid-cols-3 gap-fib-8 text-data-dense">
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_vat_recovered')}
                                    </div>
                                    <div className="font-bold text-[#0369A1] dark:text-[#00AEEF]">
                                        {kpis ? `${kpis.financeSii.vatRecoveryRatePct}%` : '—'}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_rcv_urgent')}
                                    </div>
                                    <div
                                        className={cn(
                                            'font-bold',
                                            (kpis?.financeSii.rcvUrgentUnder48hCount ?? rcvUrgentCount) > 0
                                                ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                        )}
                                    >
                                        {kpis?.financeSii.rcvUrgentUnder48hCount ?? rcvUrgentCount}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-microcopy text-[#475569] dark:text-[#8A93A6]">
                                        {t('supply.control.kpi_capex_leakage')}
                                    </div>
                                    <div
                                        className={cn(
                                            'font-bold',
                                            (kpis?.financeSii.capexLeakagePct ?? 0) > 0
                                                ? 'text-[#7C3F0E] dark:text-[#C68346]'
                                                : 'text-[#0369A1] dark:text-[#00AEEF]'
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

            {/* Right 38.2%: ISA-101 Exceptions Panel (Color by Exception) */}
            <aside className="min-h-0 overflow-y-auto p-fib-21 space-y-fib-21 bg-[#F8FAFC] dark:bg-[#07090D]">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                    <h3 className="font-mono text-microcopy uppercase font-bold tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('supply.control.exceptions_title')}
                    </h3>
                    <span
                        className={cn(
                            'font-mono text-microcopy uppercase font-bold',
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
                    <div className="border-l-[3px] border-l-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] p-fib-13 font-mono text-data-dense text-[#0369A1] dark:text-[#00AEEF] flex items-center gap-fib-8">
                        <span className="material-symbols-outlined text-[18px]">check_circle</span>
                        <span>{t('supply.control.no_exceptions')}</span>
                    </div>
                ) : (
                    <div className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                        {exceptions.map((exc) => (
                            <button
                                key={exc.id}
                                type="button"
                                onClick={() => onNavigateTab?.(exc.targetTab)}
                                data-testid={`control-exc-${exc.id}`}
                                className="w-full text-left p-fib-13 min-h-[48px] border-0 border-l-[3px] border-l-[#C68346] flex items-center justify-between gap-fib-8 hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] cursor-pointer rounded-none shadow-none font-mono tabular-nums"
                            >
                                <span className="text-data-dense font-bold text-[#7C3F0E] dark:text-[#C68346]">
                                    {exc.label}
                                </span>
                                <span className="text-microcopy font-bold text-[#0F172A] dark:text-[#F3F4F6] shrink-0">
                                    {exc.metric}
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {kpis && (
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] p-fib-13 space-y-fib-8 font-mono text-microcopy tabular-nums">
                        <div className="uppercase font-bold text-[#475569] dark:text-[#8A93A6]">
                            {t('supply.control.rop_drivers_title')}
                        </div>
                        <div className="flex items-center justify-between">
                            <span>PER_PAX</span>
                            <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                {kpis.ropSummary.byDriver.PER_PAX}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>PER_ASSET_HOUR</span>
                            <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                {kpis.ropSummary.byDriver.PER_ASSET_HOUR}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>DAILY_SITE_OR_MINMAX</span>
                            <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                {kpis.ropSummary.byDriver.DAILY_SITE_OR_MINMAX}
                            </span>
                        </div>
                    </div>
                )}
            </aside>
        </div>
    );
};

export default SupplyControlDashboardView;
