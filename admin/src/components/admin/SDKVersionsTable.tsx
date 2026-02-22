import React from 'react';
import { Eye, Download, Trash2, Cpu, ShieldCheck, Zap } from 'lucide-react';
import { SDKVersion } from '../../types/sdk-admin';
import clsx from 'clsx';

interface SDKVersionsTableProps {
    versions: SDKVersion[];
    isLoading: boolean;
    onViewDetails: (version: SDKVersion) => void;
    onDownload: (version: SDKVersion) => void;
    onDelete?: (id: string) => void;
}

/**
 * SDKVersionsTable component for displaying a list of SDK versions.
 * Refactored to Elite Industrial style with glassmorphism and technical grids.
 */
export const SDKVersionsTable: React.FC<SDKVersionsTableProps> = ({
    versions,
    isLoading,
    onViewDetails,
    onDownload,
    onDelete
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
        <div className="elite-tech-surface rounded-none shadow-3xl overflow-hidden border-black/5 dark:border-white/5 relative">
            <div className="absolute inset-0 technical-grid pointer-events-none opacity-20"></div>

            <div className="overflow-x-auto relative z-10">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-black/5 dark:bg-white/5 border-b border-black/10 dark:border-white/10">
                            <th className="px-10 py-6 hud-label">Build_Fingerprint</th>
                            <th className="px-10 py-6 hud-label">Status_Protocol</th>
                            <th className="px-10 py-6 hud-label text-center">Deployment_Date</th>
                            <th className="px-10 py-6 hud-label max-w-[200px]">Validation_Logs</th>
                            <th className="px-10 py-6 hud-label text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/5">
                        {isLoading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <tr key={`skeleton-${i}`} className="animate-pulse">
                                    <td colSpan={5} className="px-10 py-8">
                                        <div className="h-6 bg-black/5 dark:bg-white/5 rounded-none w-3/4"></div>
                                    </td>
                                </tr>
                            ))
                        ) : versions.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-10 py-20 text-center">
                                    <div className="flex flex-col items-center gap-4 opacity-20">
                                        <Cpu size={40} />
                                        <span className="hud-label italic tracking-[0.3em]">EMPTY_REPOSITORY_DATA</span>
                                    </div>
                                </td>
                            </tr>
                        ) : versions.map((version) => (
                            <tr key={version.id} className={clsx(
                                "hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group",
                                version.status === 'STABLE' && "bg-antigravity-accent/[0.02]"
                            )}>
                                <td className="px-10 py-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-none bg-black dark:bg-white text-white dark:text-black flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                            <span className="text-[12px] font-black italic">v{version.versionNumber}</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[13px] font-black text-black dark:text-white uppercase tracking-tighter">SDK_CORE_RUNTIME</span>
                                            {version.status === 'STABLE' && (
                                                <span className="text-[9px] font-black text-antigravity-accent uppercase tracking-[0.2em] italic">GOLDEN_BUILD</span>
                                            )}
                                        </div>
                                    </div>
                                </td>
                                <td className="px-10 py-6">
                                    <span className={clsx(
                                        "inline-flex items-center px-4 py-1.5 rounded-none text-[9px] font-black uppercase tracking-[0.15em] border shadow-sm transition-all duration-500",
                                        version.status === 'STABLE' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                                        version.status === 'BETA' && "bg-amber-500/10 text-amber-600 border-amber-500/20",
                                        version.status === 'DEPRECATED' && "bg-rose-500/10 text-rose-600 border-rose-500/20"
                                    )}>
                                        <div className={clsx("w-1 h-1 rounded-none mr-2",
                                            version.status === 'STABLE' ? "bg-emerald-500" :
                                                version.status === 'BETA' ? "bg-amber-500" : "bg-rose-500"
                                        )}></div>
                                        {version.status}
                                    </span>
                                </td>
                                <td className="px-10 py-6 text-center">
                                    <span className="text-[11px] font-black text-black/40 dark:text-white/30 uppercase font-mono tracking-tight grayscale group-hover:grayscale-0 transition-all">
                                        {formatDate(version.releaseDate)}
                                    </span>
                                </td>
                                <td className="px-10 py-6 max-w-[200px]">
                                    <p className="text-[11px] font-bold text-black/50 dark:text-white/40 leading-relaxed uppercase tracking-tighter italic">
                                        {truncateText(version.changelog, 60)}
                                    </p>
                                </td>
                                <td className="px-10 py-6 text-right">
                                    <div className="flex justify-end gap-3">
                                        <button
                                            onClick={() => onViewDetails(version)}
                                            className="w-10 h-10 rounded-none bg-black/5 dark:bg-white/5 hover:bg-black dark:hover:bg-white text-black/40 dark:text-white/40 hover:text-white dark:hover:text-black flex items-center justify-center transition-all active:scale-90"
                                        >
                                            <Eye size={18} />
                                        </button>
                                        <button
                                            onClick={() => onDownload(version)}
                                            disabled={version.status === 'DEPRECATED'}
                                            className={clsx(
                                                "w-10 h-10 rounded-none flex items-center justify-center transition-all active:scale-90",
                                                version.status === 'DEPRECATED'
                                                    ? "bg-rose-500/5 text-rose-500/20 cursor-not-allowed border border-rose-500/10"
                                                    : "bg-antigravity-accent text-white shadow-premium hover:scale-110"
                                            )}
                                        >
                                            <Download size={18} />
                                        </button>
                                        {onDelete && (
                                            <button
                                                onClick={() => onDelete(version.id)}
                                                className="w-10 h-10 rounded-none bg-black/5 dark:bg-white/5 hover:bg-rose-500 hover:text-white text-rose-500/40 flex items-center justify-center transition-all active:scale-90"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        )}
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
