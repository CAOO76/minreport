import React from 'react';
import { Eye, Download, Trash2 } from 'lucide-react';
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
 * Features a minimalist design with Material Design principles.
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
        <div className="w-full overflow-hidden border border-[#E5E7EB] rounded-lg bg-white shadow-sm font-['Atkinson_Hyperlegible']">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse table-auto text-sm">
                    <thead>
                        <tr className="bg-slate-50 border-b border-[#E5E7EB]">
                            <th className="px-4 py-2.5 font-bold text-slate-600">Versión</th>
                            <th className="px-4 py-2.5 font-bold text-slate-600">Estado</th>
                            <th className="px-4 py-2.5 font-bold text-slate-600">Fecha</th>
                            <th className="px-4 py-2.5 font-bold text-slate-600">Changelog</th>
                            <th className="px-4 py-2.5 font-bold text-slate-600 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                        {isLoading ? (
                            // Skeleton Rows
                            Array.from({ length: 3 }).map((_, i) => (
                                <tr key={`skeleton-${i}`} className="animate-pulse">
                                    <td colSpan={5} className="px-4 py-4">
                                        <div className="h-6 bg-slate-100 rounded"></div>
                                    </td>
                                </tr>
                            ))
                        ) : versions.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-10 text-center text-slate-400 italic">
                                    No se encontraron versiones del SDK.
                                </td>
                            </tr>
                        ) : versions.map((version) => (
                            <tr key={version.id} className={clsx(
                                "hover:bg-slate-50/50 transition-colors group",
                                version.status === 'STABLE' && "bg-emerald-50/30"
                            )}>
                                <td className="px-4 py-3 font-bold text-slate-900 flex items-center gap-2">
                                    v{version.versionNumber}
                                    {version.status === 'STABLE' && (
                                        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Recommended</span>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    <span className={clsx(
                                        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide",
                                        version.status === 'STABLE' && "bg-emerald-600 text-white",
                                        version.status === 'BETA' && "bg-yellow-400 text-black",
                                        version.status === 'DEPRECATED' && "bg-slate-400 text-white"
                                    )}>
                                        {version.status}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                    {formatDate(version.releaseDate)}
                                </td>
                                <td className="px-4 py-3 text-slate-500 max-w-[200px]">
                                    {truncateText(version.changelog, 50)}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="flex justify-end gap-1">
                                        <button
                                            onClick={() => onViewDetails(version)}
                                            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                                            title="Ver detalles"
                                        >
                                            <Eye size={18} />
                                        </button>
                                        <button
                                            onClick={() => onDownload(version)}
                                            disabled={version.status === 'DEPRECATED'}
                                            className={clsx(
                                                "p-1.5 rounded-md transition-colors",
                                                version.status === 'DEPRECATED'
                                                    ? "text-slate-200 cursor-not-allowed"
                                                    : "text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                                            )}
                                            title={version.status === 'DEPRECATED' ? "Descarga deshabilitada" : "Descargar"}
                                        >
                                            <Download size={18} />
                                        </button>
                                        {onDelete && (
                                            <button
                                                onClick={() => onDelete(version.id)}
                                                className="p-1.5 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                                title="Eliminar (Duplicado/Error)"
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
