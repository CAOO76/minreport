import React from 'react';
import { M3IconButton } from './M3IconButton';
import { M3Button } from './M3Button';

export interface ClassifiedSource {
    type: 'OEM' | 'EXT' | 'YT';
    description: string;
    url?: string;
}

export interface SourceMetadata {
    file_name: string;
    uploaded_by: string;
    upload_date: string;
    extraction_engine: string;
}

export interface ExtractedItem {
    componente: string;
    zona: string;
    origen: string;
    evidencia_oem?: string;
    [key: string]: unknown;
}


export interface ClassifiedSources {
    oem: ClassifiedSource[];
    terceros: ClassifiedSource[];
    youtube: ClassifiedSource[];
}

interface M3SourceAuditModalProps {
    indexName: string;
    label: string;
    sourceMetadata?: SourceMetadata;
    classifiedSources?: ClassifiedSources;
    extractedData?: ExtractedItem[];
    onClose: () => void;
}

export const M3SourceAuditModal: React.FC<M3SourceAuditModalProps> = ({
    indexName,
    label,
    sourceMetadata,
    classifiedSources,
    extractedData,
    onClose
}) => {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            {/* Backdrop */}
            <div 
                className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in fade-in duration-300"
                onClick={onClose}
            />

            {/* Modal Container */}
            <div 
                className="relative w-full max-w-4xl bg-background shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-border-base animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
            >
                {/* Header */}
                <header className="p-6 border-b border-black/5 dark:border-white/5 flex items-center justify-between">
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="material-symbols-outlined text-copper !text-[16px]">verified_user</span>
                            <span className="text-[10px] font-black tracking-widest text-copper uppercase">
                                AUDITORÍA DE TRAZABILIDAD INDUSTRIAL
                            </span>
                        </div>
                        <h2 className="text-xl font-black tracking-tight text-foreground uppercase">
                            {label || indexName}
                        </h2>
                    </div>
                    <M3IconButton icon="close" onClick={onClose} variant="ghost" />
                </header>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8 hide-scrollbar">
                    
                    {/* 1. METADATA DE INGESTA */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-2">
                            <span className="w-1 h-3 bg-black/20 dark:bg-white/20"></span>
                            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-black/60 dark:text-white/40">Origen de Ingesta</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-surface p-4 border border-border-base">
                                <p className="text-[9px] font-bold text-muted uppercase mb-1">Archivo / Método</p>
                                <p className="text-sm font-medium text-foreground">{sourceMetadata?.file_name || 'Búsqueda Web'}</p>
                            </div>
                            <div className="bg-surface p-4 border border-border-base">
                                <p className="text-[9px] font-bold text-muted uppercase mb-1">Motor de Extracción</p>
                                <p className="text-sm font-medium text-foreground">{sourceMetadata?.extraction_engine || 'Especialista AI v5.0'}</p>
                            </div>
                        </div>
                    </section>

                    {/* 2. FUENTES CLASIFICADAS */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-2">
                            <span className="w-1 h-3 bg-copper"></span>
                            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-copper">Fuentes Documentales (OEM/EXT)</h3>
                        </div>
                        <div className="space-y-3">
                            {/* OEM SOURCES */}
                            {classifiedSources?.oem && classifiedSources.oem.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-2 py-0.5">OEM CERTIFIED</span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        {classifiedSources.oem.map((src, i) => (
                                            <a key={i} href={src.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-3 p-4 bg-surface border border-border-base hover:border-emerald-500/30 transition-all">
                                                <span className="material-symbols-outlined text-emerald-500 mt-0.5">description</span>
                                                <div className="flex-1">
                                                    <p className="text-xs font-bold text-foreground group-hover:text-emerald-500 transition-colors">{src.description}</p>
                                                    {src.url && <p className="text-[10px] text-muted truncate mt-1">{src.url}</p>}
                                                </div>
                                                <span className="material-symbols-outlined text-muted group-hover:text-emerald-500">open_in_new</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* TERCEROS SOURCES */}
                            {classifiedSources?.terceros && classifiedSources.terceros.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5">TERCEROS / EXT</span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        {classifiedSources.terceros.map((src, i) => (
                                            <a key={i} href={src.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-3 p-4 bg-blue-500/[0.03] border border-blue-500/10 hover:border-blue-500/30 transition-all">
                                                <span className="material-symbols-outlined text-blue-500 mt-0.5">public</span>
                                                <div className="flex-1">
                                                    <p className="text-xs font-bold text-black/80 dark:text-white/90 group-hover:text-blue-500 transition-colors">{src.description}</p>
                                                    {src.url && <p className="text-[10px] text-black/30 dark:text-white/30 truncate mt-1">{src.url}</p>}
                                                </div>
                                                <span className="material-symbols-outlined text-black/10 dark:text-white/10 group-hover:text-blue-500">open_in_new</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>

                    {/* 3. EVIDENCIA POR DATO */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-2">
                            <span className="w-1 h-3 bg-black/20 dark:bg-white/20"></span>
                            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-black/60 dark:text-white/40">Evidencia Atómica</h3>
                        </div>
                        <div className="border border-black/5 dark:border-white/5 divide-y divide-black/5 dark:divide-white/5">
                            {extractedData && extractedData.length > 0 ? (
                                extractedData.map((item, i) => (
                                    <div key={i} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black uppercase tracking-tight text-black/80 dark:text-white/90">
                                                {item.componente}
                                            </span>
                                            <span className="text-[9px] opacity-40 uppercase tracking-widest">{item.zona}</span>
                                        </div>
                                        <div className="flex-1 flex flex-col sm:items-end">
                                            {item.evidencia_oem ? (
                                                <div className="flex items-center gap-2 text-emerald-500">
                                                    <span className="material-symbols-outlined !text-[14px]">verified</span>
                                                    <span className="text-[11px] font-bold italic">{item.evidencia_oem}</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 text-black/20 dark:text-white/20">
                                                    <span className="material-symbols-outlined !text-[14px]">help_outline</span>
                                                    <span className="text-[10px] italic">Sin evidencia OEM explícita</span>
                                                </div>
                                            )}
                                            <span className="text-[9px] font-black text-black/40 dark:text-white/30 uppercase mt-1">
                                                ORIGEN: {item.origen}
                                            </span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="p-8 text-center opacity-20 italic text-sm">
                                    No hay datos extraídos para auditar.
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* Footer */}
                <footer className="p-6 border-t border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] flex justify-end">
                    <M3Button variant="secondary" onClick={onClose}>CERRAR AUDITORÍA</M3Button>
                </footer>
            </div>
        </div>
    );
};
