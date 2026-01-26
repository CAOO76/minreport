import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { useAdminSDK } from '../hooks/useAdminSDK';
import { useSDKAutoSync } from '../hooks/useSDKAutoSync';
import { SDKVersion } from '../types/sdk-admin';
import { SDKVersionsTable } from '../components/admin/SDKVersionsTable';
import { SDKManagementDrawer } from '../components/admin/SDKManagementDrawer';

// Injected by Vite via define in vite.config.ts
declare const __APP_VERSION__: string;

/**
 * SDKPage - Final assembly for SDK version management.
 * Integrates the versions table and the management drawer with Auto-Discovery.
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
        <div className="p-8 max-w-6xl mx-auto space-y-8 font-['Atkinson_Hyperlegible']">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">
                            Gestión del SDK
                        </h1>
                        <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full border border-slate-200">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">System:</span>
                            <span className="text-xs font-bold text-antigravity-accent italic">v{__APP_VERSION__}</span>
                        </div>
                        {isSyncing && (
                            <div className="flex items-center gap-1.5 ml-2">
                                <div className="w-1.5 h-1.5 bg-antigravity-accent rounded-full animate-pulse" />
                                <span className="text-[10px] font-bold text-slate-400 italic">Sincronizando...</span>
                            </div>
                        )}
                    </div>
                    <p className="text-slate-500 mt-1">
                        Control de versiones, trazabilidad y distribución automática del núcleo MinReport.
                    </p>
                </div>
            </div>

            {/* Versions Table */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                        Historial de Lanzamientos
                    </h3>
                </div>

                <SDKVersionsTable
                    versions={versions}
                    isLoading={loading}
                    onViewDetails={handleViewDetails}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                />
            </div>

            {/* Management Drawer */}
            <SDKManagementDrawer
                isOpen={isDrawerOpen}
                onClose={handleCloseDrawer}
                selectedVersion={selectedVersion}
                updateVersionStatus={updateVersionStatus}
                onDownload={handleDownload}
                isLoading={loading}
            />
        </div>
    );
};
