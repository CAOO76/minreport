import React, { useState, useEffect } from 'react';
import { Plus, Cpu, ShieldCheck, Zap, ArrowUpRight } from 'lucide-react';
import { useAdminSDK } from '../hooks/useAdminSDK';
import { useSDKAutoSync } from '../hooks/useSDKAutoSync';
import { SDKVersion } from '../types/sdk-admin';
import { SDKVersionsTable } from '../components/admin/SDKVersionsTable';
import { SDKManagementDrawer } from '../components/admin/SDKManagementDrawer';
import { SDK_METADATA } from '../sdk-bundle/metadata';

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
        <div className="space-y-8 pb-24">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-[1px] bg-[#C68346]"></div>
                        <span className="text-[10px] font-bold text-[#C68346] uppercase tracking-widest">DISTRIBUCIÓN_SDK</span>
                    </div>
                    <h1 className="text-4xl font-bold text-black dark:text-white tracking-tighter m-0 uppercase">
                        SDK_Manager
                    </h1>
                    <p className="text-black/60 dark:text-white/40 font-medium text-sm max-w-xl leading-relaxed">
                        Sistema técnico de control de versiones y trazabilidad para el núcleo industrial MINREPORT.
                    </p>
                </div>
            </header>

            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-2 text-black/40 dark:text-white/30">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest m-0">HISTORIAL_MANIFESTOS_REPOSITORIO</h3>
                    </div>
                </div>

                <SDKVersionsTable
                    versions={versions}
                    isLoading={loading}
                    onViewDetails={handleViewDetails}
                    onDownload={handleDownload}
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

            <footer className="pt-8 border-t border-black/5 dark:border-white/5 flex flex-col md:flex-row justify-between gap-4 text-[10px] font-bold text-black/30 dark:text-white/20 uppercase tracking-widest">
                <div className="flex items-center gap-3">
                    <ShieldCheck className="text-emerald-600/50" size={14} />
                    INTEGRIDAD_CORE_VERIFICADA v{SDK_METADATA.version}
                </div>
                <div className="tracking-widest flex items-center gap-2 font-mono">
                    ACCESO_RESTRINGIDO_AUTORIZADO
                </div>
            </footer>
        </div>
    );
};
