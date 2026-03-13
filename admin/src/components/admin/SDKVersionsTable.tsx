import React from 'react';
import { Eye, Download, Trash2, Cpu, ShieldCheck, Zap } from 'lucide-react';
import { SDKVersion } from '../../types/sdk-admin';
import clsx from 'clsx';

interface SDKVersionsTableProps {
    versions: SDKVersion[];
    isLoading: boolean;
    onViewDetails: (version: SDKVersion) => void;
    onDownload: (version: SDKVersion) => void;
}

/**
 * SDKVersionsTable component for displaying a list of SDK versions.
 * Refactored to Elite Industrial style with glassmorphism and technical grids.
 */
export const SDKVersionsTable: React.FC<SDKVersionsTableProps> = ({
    versions,
    isLoading,
    onViewDetails,
    onDownload
}) => {

    // Helper to format date
    const formatDate = (timestamp: any) => {
        if (!timestamp) return '---';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString('es-CL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Helper to truncate text
    const truncateText = (text: string, limit: number) => {
        if (text.length <= limit) return text;
        return text.substring(0, limit) + '...';
    };

    return (
        <div className="bg-white dark:bg-zinc-950 rounded-none overflow-hidden border border-black/5 dark:border-white/5">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 dark:bg-zinc-900/50 border-b border-black/5 dark:border-white/5">
                            <th className="px-8 py-4 text-[10px] font-bold text-black/40 dark:text-white/30 tracking-widest uppercase">VERSIÓN_SDK</th>
                            <th className="px-8 py-4 text-[10px] font-bold text-black/40 dark:text-white/30 tracking-widest uppercase">PROTOCOLO_ESTADO</th>
                            <th className="px-8 py-4 text-[10px] font-bold text-black/40 dark:text-white/30 tracking-widest uppercase text-center">FECHA_DESPLIEGUE</th>
                            <th className="px-8 py-4 text-[10px] font-bold text-black/40 dark:text-white/30 tracking-widest uppercase text-right">ACCIONES</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/5">
                        {isLoading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <tr key={`skeleton-${i}`}>
                                    <td colSpan={4} className="px-8 py-6">
                                        <div className="h-4 bg-black/5 dark:bg-white/5 rounded-none w-1/2"></div>
                                    </td>
                                </tr>
                            ))
                        ) : versions.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-8 py-16 text-center">
                                    <span className="text-[10px] font-bold text-black/20 dark:text-white/10 uppercase tracking-[0.4em]">SIN_DATOS_EN_REPOSITORIO</span>
                                </td>
                            </tr>
                        ) : versions.map((version) => (
                            <tr key={version.id} className="hover:bg-slate-50 dark:hover:bg-zinc-900/40 transition-colors">
                                <td className="px-8 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center justify-center">
                                            <span className="text-[11px] font-bold text-black dark:text-white">v{version.versionNumber}</span>
                                        </div>
                                        <span className="text-[12px] font-bold text-black dark:text-white tracking-widest uppercase">Runtime_Core</span>
                                    </div>
                                </td>
                                <td className="px-8 py-4">
                                    <span className={clsx(
                                        "inline-flex items-center px-0 py-1 text-[9px] font-bold uppercase tracking-widest",
                                        version.status === 'STABLE' && "text-emerald-600",
                                        version.status === 'BETA' && "text-amber-600",
                                        version.status === 'DEPRECATED' && "text-rose-600"
                                    )}>
                                        {version.status}
                                    </span>
                                </td>
                                <td className="px-8 py-4 text-center">
                                    <span className="text-[11px] font-medium text-black/40 dark:text-white/30 font-mono">
                                        {formatDate(version.releaseDate)}
                                    </span>
                                </td>
                                <td className="px-8 py-4 text-right">
                                    <div className="flex justify-end gap-6 text-black/40 dark:text-white/40">
                                        <button
                                            onClick={() => onViewDetails(version)}
                                            className="hover:text-black dark:hover:text-white transition-colors"
                                        >
                                            <Eye size={18} />
                                        </button>
                                        <button
                                            onClick={() => onDownload(version)}
                                            disabled={version.status === 'DEPRECATED'}
                                            className={clsx(
                                                "transition-colors",
                                                version.status === 'DEPRECATED'
                                                    ? "opacity-10 cursor-not-allowed"
                                                    : "text-[#C68346] hover:text-[#b3733a]"
                                            )}
                                        >
                                            <Download size={18} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
