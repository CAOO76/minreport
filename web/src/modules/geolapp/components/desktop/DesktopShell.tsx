import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UNASSIGNED_FAENA_ID } from '../../core/services/stockpile-faena-metrics';
import type {
    MiningSiteProfile,
    StockpileAsset,
    StockpileMeasurement,
} from '../../core/types/GeolappTypes';
import { DesktopCalibrationAuditView } from './DesktopCalibrationAuditView';
import { DesktopClosureModal, type ClosureModalMode } from './DesktopClosureModal';
import { DesktopDeviceCompatibilityView } from './DesktopDeviceCompatibilityView';
import { DesktopDossierPanel } from './DesktopDossierPanel';
import { DesktopFaenaDirectory } from './DesktopFaenaDirectory';
import { DesktopFaenaMonitoring } from './DesktopFaenaMonitoring';
import { DesktopFaenaStockpiles } from './DesktopFaenaStockpiles';
import { DesktopStageWorkspace } from './DesktopStageWorkspace';

export interface DesktopShellProps {
    assets: StockpileAsset[];
    measurements: StockpileMeasurement[];
    sites?: MiningSiteProfile[];
    activeFaenaId?: string | 'ALL';
    onSelectFaena?: (faenaId: string | 'ALL') => void;
    canRegisterDevFaena?: boolean;
    onRegisterDevFaena?: (name: string) => Promise<MiningSiteProfile>;
    onSelectAsset?: (asset: StockpileAsset) => void;
    onBack?: () => void;
    embedded?: boolean;
}

type DesktopNavLevel =
    | 'FAENAS'
    | 'FAENA_STOCKPILES'
    | 'STOCKPILE_STAGE'
    | 'MONITORING'
    | 'CALIBRATIONS'
    | 'COMPATIBILITY';

export const DesktopShell: React.FC<DesktopShellProps> = ({
    assets,
    measurements,
    sites = [],
    activeFaenaId = 'ALL',
    onSelectFaena,
    canRegisterDevFaena = false,
    onRegisterDevFaena,
    onSelectAsset,
}) => {
    const { t } = useTranslation();

    const [navLevel, setNavLevel] = useState<DesktopNavLevel>('FAENAS');
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);

    const [closureMode, setClosureMode] = useState<ClosureModalMode>(null);

    const faenaScopedAssets = useMemo(() => {
        return assets
            .filter((a) => {
                if (activeFaenaId === 'ALL') return true;
                const pid = (a.project_id || '').trim();
                if (activeFaenaId === UNASSIGNED_FAENA_ID) return !pid;
                return pid === activeFaenaId;
            })
            .sort(
                (a, b) =>
                    (b.last_measured_at || b.createdAt || 0) -
                    (a.last_measured_at || a.createdAt || 0)
            );
    }, [assets, activeFaenaId]);

    const activeFaenaLabel = useMemo(() => {
        if (activeFaenaId === 'ALL') return null;
        if (activeFaenaId === UNASSIGNED_FAENA_ID) {
            return t('faenas.unassigned', 'SIN FAENA ASIGNADA');
        }
        const site = sites.find((s) => s.id === activeFaenaId);
        const fallback = faenaScopedAssets.find((a) => a.project_name)?.project_name;
        return site?.name || fallback || activeFaenaId;
    }, [activeFaenaId, sites, faenaScopedAssets, t]);

    const activeAsset = useMemo(
        () => (selectedAssetId ? assets.find((a) => a.id === selectedAssetId) ?? null : null),
        [assets, selectedAssetId]
    );

    useEffect(() => {
        if (navLevel === 'STOCKPILE_STAGE' && !activeAsset) {
            setNavLevel(activeFaenaId !== 'ALL' ? 'FAENA_STOCKPILES' : 'FAENAS');
        }
    }, [navLevel, activeAsset, activeFaenaId]);

    const activeAssetMeasurements = useMemo(
        () => (activeAsset ? measurements.filter((m) => m.assetId === activeAsset.id) : []),
        [measurements, activeAsset]
    );

    const currentAssetIndex = activeAsset
        ? faenaScopedAssets.findIndex((a) => a.id === activeAsset.id)
        : -1;
    const prevAsset = currentAssetIndex > 0 ? faenaScopedAssets[currentAssetIndex - 1] : null;
    const nextAsset =
        currentAssetIndex >= 0 && currentAssetIndex < faenaScopedAssets.length - 1
            ? faenaScopedAssets[currentAssetIndex + 1]
            : null;

    const handleGoRootFaenas = () => {
        onSelectFaena?.('ALL');
        setSelectedAssetId(null);
        setSelectedMeasurementId(null);
        setNavLevel('FAENAS');
    };

    const handleOpenFaena = (faenaId: string) => {
        onSelectFaena?.(faenaId);
        setSelectedAssetId(null);
        setSelectedMeasurementId(null);
        setNavLevel('FAENA_STOCKPILES');
    };

    const handleOpenFaenaMonitoring = (faenaId: string) => {
        onSelectFaena?.(faenaId);
        setSelectedAssetId(null);
        setSelectedMeasurementId(null);
        setNavLevel('MONITORING');
    };

    const handleOpenStockpile = (asset: StockpileAsset) => {
        const resolvedFaena = (asset.project_id || '').trim() || UNASSIGNED_FAENA_ID;
        onSelectFaena?.(resolvedFaena);
        setSelectedAssetId(asset.id);
        setSelectedMeasurementId(null);
        setNavLevel('STOCKPILE_STAGE');
        onSelectAsset?.(asset);
    };

    const handleBackStep = () => {
        if (navLevel === 'MONITORING' || navLevel === 'COMPATIBILITY') {
            setNavLevel(activeFaenaId !== 'ALL' ? 'FAENA_STOCKPILES' : 'FAENAS');
            return;
        }
        if (navLevel === 'STOCKPILE_STAGE') {
            setSelectedAssetId(null);
            setSelectedMeasurementId(null);
            setNavLevel(activeFaenaId !== 'ALL' ? 'FAENA_STOCKPILES' : 'FAENAS');
            return;
        }
        if (navLevel === 'FAENA_STOCKPILES') {
            handleGoRootFaenas();
        }
    };

    const isDirectoryFlow = navLevel !== 'MONITORING' && navLevel !== 'COMPATIBILITY';

    return (
        <div className="h-full w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden rounded-none shadow-none select-none">
            <header className="h-[52px] shrink-0 px-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] flex items-center justify-between gap-fib-13">
                <nav
                    aria-label="Breadcrumb"
                    className="flex items-center gap-fib-8 min-w-0 font-mono text-microcopy uppercase"
                >
                    {navLevel !== 'FAENAS' && (
                        <button
                            type="button"
                            onClick={handleBackStep}
                            aria-label={t('desktop.back_label', 'Volver')}
                            title={t('desktop.back_label', 'Volver')}
                            className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors cursor-pointer rounded-none shrink-0"
                        >
                            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={handleGoRootFaenas}
                        className={`bg-transparent border-0 outline-none px-1 py-1 font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none shrink-0 transition-colors ${
                            navLevel === 'FAENAS'
                                ? 'text-[#C68346]'
                                : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        }`}
                    >
                        {t('desktop.breadcrumb_faenas', 'FAENAS')}
                    </button>

                    {activeFaenaLabel && navLevel !== 'COMPATIBILITY' && (
                        <>
                            <span className="text-[#94A3B8] dark:text-[#5A6072] shrink-0">/</span>
                            <button
                                type="button"
                                onClick={() => handleOpenFaena(activeFaenaId)}
                                className={`bg-transparent border-0 outline-none px-1 py-1 font-mono text-microcopy font-bold uppercase cursor-pointer rounded-none truncate max-w-[220px] transition-colors ${
                                    navLevel === 'FAENA_STOCKPILES'
                                        ? 'text-[#C68346]'
                                        : 'text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                                }`}
                            >
                                {activeFaenaLabel}
                            </button>
                        </>
                    )}

                    {navLevel === 'STOCKPILE_STAGE' && activeAsset && (
                        <>
                            <span className="text-[#94A3B8] dark:text-[#5A6072] shrink-0">/</span>
                            <span className="font-bold text-[#C68346] truncate max-w-[220px]">
                                {activeAsset.name}
                            </span>
                            {faenaScopedAssets.length > 1 && (
                                <div className="flex items-center gap-0.5 ml-fib-8 shrink-0">
                                    <button
                                        type="button"
                                        disabled={!prevAsset}
                                        onClick={() => prevAsset && handleOpenStockpile(prevAsset)}
                                        aria-label={t('desktop.prev_stockpile', 'Acopio anterior')}
                                        title={t('desktop.prev_stockpile', 'Acopio anterior')}
                                        className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] disabled:opacity-30 cursor-pointer disabled:cursor-default rounded-none transition-colors"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">
                                            chevron_left
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!nextAsset}
                                        onClick={() => nextAsset && handleOpenStockpile(nextAsset)}
                                        aria-label={t('desktop.next_stockpile', 'Acopio siguiente')}
                                        title={t('desktop.next_stockpile', 'Acopio siguiente')}
                                        className="bg-transparent border-0 outline-none p-1 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] disabled:opacity-30 cursor-pointer disabled:cursor-default rounded-none transition-colors"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">
                                            chevron_right
                                        </span>
                                    </button>
                                </div>
                            )}
                        </>
                    )}

                    {navLevel === 'MONITORING' && (
                        <>
                            <span className="text-[#94A3B8] dark:text-[#5A6072] shrink-0">/</span>
                            <span className="font-bold text-[#C68346] shrink-0">MONITORING</span>
                        </>
                    )}

                    {navLevel === 'COMPATIBILITY' && (
                        <>
                            <span className="text-[#94A3B8] dark:text-[#5A6072] shrink-0">/</span>
                            <span className="font-bold text-[#C68346] shrink-0">
                                {t('compatibility.breadcrumb_hardware', 'HARDWARE')}
                            </span>
                        </>
                    )}
                </nav>

                <div className="flex items-center gap-fib-13 shrink-0">
                    <button
                        type="button"
                        onClick={() => {
                            if (navLevel === 'MONITORING' || navLevel === 'COMPATIBILITY') {
                                setNavLevel(
                                    activeFaenaId !== 'ALL' ? 'FAENA_STOCKPILES' : 'FAENAS'
                                );
                            }
                        }}
                        title={t('desktop.nav_directory_aria', 'Faenas y acopios')}
                        aria-label={t('desktop.nav_directory_aria', 'Faenas y acopios')}
                        aria-pressed={isDirectoryFlow}
                        className={`relative h-[52px] px-2 bg-transparent border-0 border-b-2 outline-none cursor-pointer flex items-center justify-center rounded-none transition-colors ${
                            isDirectoryFlow
                                ? 'border-[#C68346] text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[24px]">landscape</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setNavLevel('MONITORING')}
                        title={t('monitoring.title', 'ESTADÍSTICAS POR FAENA')}
                        aria-label={t('monitoring.title', 'ESTADÍSTICAS POR FAENA')}
                        aria-pressed={navLevel === 'MONITORING'}
                        className={`relative h-[52px] px-2 bg-transparent border-0 border-b-2 outline-none cursor-pointer flex items-center justify-center rounded-none transition-colors ${
                            navLevel === 'MONITORING'
                                ? 'border-[#C68346] text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[24px]">monitoring</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setNavLevel('CALIBRATIONS')}
                        title={t('calibration.desktop_title', 'AUDITORÍA DE CALIBRACIONES DE CAMPO')}
                        aria-label={t(
                            'calibration.desktop_title',
                            'AUDITORÍA DE CALIBRACIONES DE CAMPO'
                        )}
                        aria-pressed={navLevel === 'CALIBRATIONS'}
                        className={`relative h-[52px] px-2 bg-transparent border-0 border-b-2 outline-none cursor-pointer flex items-center justify-center rounded-none transition-colors ${
                            navLevel === 'CALIBRATIONS'
                                ? 'border-[#C68346] text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[24px]">
                            compass_calibration
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setNavLevel('COMPATIBILITY')}
                        title={t('compatibility.nav_tooltip', 'COMPATIBILIDAD HARDWARE')}
                        aria-label={t('compatibility.nav_tooltip', 'COMPATIBILIDAD HARDWARE')}
                        aria-pressed={navLevel === 'COMPATIBILITY'}
                        className={`relative h-[52px] px-2 bg-transparent border-0 border-b-2 outline-none cursor-pointer flex items-center justify-center rounded-none transition-colors ${
                            navLevel === 'COMPATIBILITY'
                                ? 'border-[#C68346] text-[#C68346]'
                                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[24px]">devices</span>
                    </button>
                </div>
            </header>

            <div className="flex-1 min-h-0 relative flex overflow-hidden">
                {navLevel === 'FAENAS' && (
                    <DesktopFaenaDirectory
                        assets={assets}
                        measurements={measurements}
                        sites={sites}
                        canRegisterDevFaena={canRegisterDevFaena}
                        onRegisterDevFaena={onRegisterDevFaena}
                        onOpenFaena={handleOpenFaena}
                        onOpenMonitoring={handleOpenFaenaMonitoring}
                    />
                )}

                {navLevel === 'FAENA_STOCKPILES' && (
                    <DesktopFaenaStockpiles
                        faenaId={activeFaenaId}
                        faenaName={activeFaenaLabel || ''}
                        assets={assets}
                        onSelectAsset={handleOpenStockpile}
                    />
                )}

                {navLevel === 'MONITORING' && (
                    <DesktopFaenaMonitoring
                        assets={assets}
                        measurements={measurements}
                        sites={sites}
                        activeFaenaId={activeFaenaId}
                        onSelectFaena={(faenaId) => onSelectFaena?.(faenaId)}
                        onSelectAsset={handleOpenStockpile}
                    />
                )}

                {navLevel === 'CALIBRATIONS' && <DesktopCalibrationAuditView />}

                {navLevel === 'COMPATIBILITY' && <DesktopDeviceCompatibilityView />}

                {navLevel === 'STOCKPILE_STAGE' && activeAsset && (
                    <div className="flex-1 min-w-0 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)] overflow-hidden">
                        <DesktopStageWorkspace
                            asset={activeAsset}
                            measurements={activeAssetMeasurements}
                            selectedMeasurementId={selectedMeasurementId}
                            onSelectMeasurement={(m) => setSelectedMeasurementId(m.id)}
                            onRequestClosure={() => setClosureMode('CLOSE_SHIPMENT')}
                            onRequestReopen={() => setClosureMode('REOPEN_CYCLE')}
                            onRequestDelete={() => setClosureMode('DELETE_ASSET')}
                        />
                        <DesktopDossierPanel asset={activeAsset} sites={sites} />
                    </div>
                )}
            </div>

            <DesktopClosureModal
                mode={closureMode}
                asset={activeAsset}
                onClose={() => setClosureMode(null)}
                onCompleted={(deletedId) => {
                    if (deletedId && deletedId === selectedAssetId) {
                        setSelectedAssetId(null);
                        setSelectedMeasurementId(null);
                        setNavLevel(activeFaenaId !== 'ALL' ? 'FAENA_STOCKPILES' : 'FAENAS');
                    }
                }}
            />
        </div>
    );
};
