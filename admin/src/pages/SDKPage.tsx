import React, { useState, useEffect } from 'react';
import { Plus, Cpu, ShieldCheck, Zap, ArrowUpRight } from 'lucide-react';
import { useAdminSDK } from '../hooks/useAdminSDK';
import { useSDKAutoSync } from '../hooks/useSDKAutoSync';
import { SDKVersion } from '../types/sdk-admin';
import { SDKVersionsTable } from '../components/admin/SDKVersionsTable';
import { SDKManagementDrawer } from '../components/admin/SDKManagementDrawer';

// Injected by Vite via define in vite.config.ts
declare const __APP_VERSION__: string;

/**
 * SDKPage - Final assembly for SDK version management.
 * Refactored to Elite Industrial style with glassmorphism and technical grids.
 */
export const SDKPage: React.FC = () => {
    const { versions, loading, fetchVersions, deleteVersion, updateVersionStatus } = useAdminSDK();
    const { isSyncing } = useSDKAutoSync();
    const [selectedVersion, setSelectedVersion] = useState<SDKVersion | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    // Initial fetch of versions
    useEffect(() => {
        fetchVersions();
    }, [fetchVersions]);

    const handleViewDetails = (version: SDKVersion) => {
        setSelectedVersion(version);
        setIsDrawerOpen(true);
    };

    const handleCloseDrawer = () => {
        setIsDrawerOpen(false);
        setSelectedVersion(null);
    };

    const handleDownload = (version: SDKVersion) => {
        if (!version) return;

        // Security check
        if (version.status === 'DEPRECATED') {
            alert('Esta versión está OBSOLETA. No se recomienda su distribución para nuevos desarrollos.');
            return;
        }

        // Create JSON object from version data
        const dataStr = JSON.stringify(version, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);

        // Force download
        const link = document.createElement('a');
        link.href = url;
        link.download = `minreport-sdk-${version.versionNumber}.json`;
        document.body.appendChild(link);
        link.click();

        // Cleanup
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleDelete = async (id: string) => {
        if (window.confirm('¿Estás seguro de que deseas eliminar esta versión? Esta acción no se puede deshacer.')) {
            try {
                await deleteVersion(id);
            } catch (err) {
                alert('Error al eliminar la versión');
            }
        }
    };

    return (
        <div className="space-y-12 animate-in fade-in duration-1000 pb-24">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-10">
                <div className="space-y-3">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-[2px] bg-antigravity-accent"></div>
                        <span className="hud-label !text-antigravity-accent italic">SYSTEM_CORE_DISTRIBUTION</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <h1 className="text-5xl font-black text-black dark:text-white tracking-tighter m-0 uppercase italic">
                            SDK_Manager
                        </h1>
                        <div className="flex items-center gap-3 px-4 py-2 elite-tech-surface rounded-none border-white/5 shadow-xl">
                            <span className="text-[9px] font-black text-black/30 dark:text-white/20 uppercase tracking-widest">Compiler_v</span>
                            <span className="text-sm font-black text-antigravity-accent font-mono italic">{__APP_VERSION__}</span>
                        </div>
                    </div>
                    <p className="text-black/50 dark:text-white/40 font-medium text-base max-w-xl leading-relaxed">
                        Control de versiones de bajo nivel, trazabilidad de despliegue y distribución automática del núcleo industrial MinReport.
                    </p>
                </div>

                <div className="flex gap-4">
                    <div className="p-4 glass-card flex items-center gap-4 border-black/5 dark:border-white/5">
                        <div className="w-10 h-10 bg-black/5 dark:bg-white/10 rounded-none flex items-center justify-center text-antigravity-accent">
                            <Cpu size={20} className={isSyncing ? "animate-pulse" : ""} />
                        </div>
                        <div>
                            <div className="text-[9px] font-black text-black/30 dark:text-white/20 uppercase tracking-widest">Network_Sync</div>
                            <div className="text-xl font-black text-black dark:text-white font-mono flex items-center gap-2">
                                {isSyncing ? 'LINK_ESTABLISHED' : 'STANDBY'}
                                {isSyncing && <div className="w-1.5 h-1.5 bg-antigravity-accent rounded-none animate-ping" />}
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <div className="space-y-6">
                <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                        <Zap size={14} className="text-antigravity-accent" />
                        <h3 className="hud-label m-0">Repository_Manifest_History</h3>
                    </div>
                    <button
                        onClick={() => setIsDrawerOpen(true)}
                        className="p-3 bg-black dark:bg-white text-white dark:text-black rounded-none hover:scale-110 active:scale-95 transition-all shadow-premium group"
                    >
                        <Plus size={20} className="group-hover:rotate-90 transition-transform" />
                    </button>
                </div>

                <SDKVersionsTable
                    versions={versions}
                    isLoading={loading}
                    onViewDetails={handleViewDetails}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                />
            </div>

            <SDKManagementDrawer
                isOpen={isDrawerOpen}
                onClose={handleCloseDrawer}
                selectedVersion={selectedVersion}
                updateVersionStatus={updateVersionStatus}
                onDownload={handleDownload}
                isLoading={loading}
            />

            <footer className="pt-12 border-t border-black/5 dark:border-white/5 flex flex-col md:flex-row justify-between gap-6 hud-label !text-[10px] !text-black/20 dark:!text-white/20">
                <div className="flex items-center gap-4">
                    <ShieldCheck className="text-emerald-500" size={14} />
                    CORE_INTEGRITY_INDEX_v2.0.42
                </div>
                <div className="italic tracking-widest uppercase flex items-center gap-2">
                    Authorized_Access_Only
                    <ArrowUpRight size={12} />
                </div>
            </footer>
        </div>
    );
};
