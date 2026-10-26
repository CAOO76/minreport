import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase/config';
import { collection, onSnapshot, query, limit } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';

interface AssetListProps {
    onSelectAsset: (globalAssetId: string) => void;
    onNew: () => void;
}

interface CatalogEntry {
    id: string;
    make_oficial?: string;
    model_oficial?: string;
    make_model?: string;
    tipo_equipo?: string;
    categoria_equipo?: string;
    thumbnail_url?: string;
    foto_url?: string;
    createdAt?: { seconds?: number };
}

// Agrupa catálogos por marca, orden alfabético. Dentro de cada marca, ordena por modelo.
function groupByMake(entries: CatalogEntry[]): Map<string, CatalogEntry[]> {
    const map = new Map<string, CatalogEntry[]>();
    const sorted = [...entries].sort((a, b) => {
        const makeA = (a.make_oficial || 'ZZZZ').toUpperCase();
        const makeB = (b.make_oficial || 'ZZZZ').toUpperCase();
        if (makeA !== makeB) return makeA.localeCompare(makeB);
        const modelA = (a.model_oficial || '').toUpperCase();
        const modelB = (b.model_oficial || '').toUpperCase();
        return modelA.localeCompare(modelB, undefined, { numeric: true });
    });
    for (const entry of sorted) {
        const key = (entry.make_oficial || 'SIN MARCA').toUpperCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(entry);
    }
    return map;
}

export const AssetList: React.FC<AssetListProps> = ({ onSelectAsset, onNew }) => {
    const { t } = useTranslation();
    const [catalogs, setCatalogs] = useState<CatalogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        const q = query(collection(db, 'global_asset_catalog'), limit(60));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as CatalogEntry[];
            setCatalogs(data);
            setLoading(false);
        }, (error) => {
            console.error('Error fetching global_asset_catalog:', error);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const filteredCatalogs = useMemo(() => {
        return catalogs.filter(c => {
            const match = `${c.make_oficial || ''} ${c.model_oficial || ''} ${c.make_model || ''} ${c.tipo_equipo || ''} ${c.categoria_equipo || ''}`;
            return match.toLowerCase().includes(searchQuery.toLowerCase());
        });
    }, [catalogs, searchQuery]);

    const groupedCatalogs = useMemo(() => groupByMake(filteredCatalogs), [filteredCatalogs]);

    const uniqueBrands = useMemo(() => new Set(filteredCatalogs.map(c => c.make_oficial)).size, [filteredCatalogs]);

    return (
        <div className="h-full w-full bg-background flex flex-col font-atkinson text-foreground select-none overflow-hidden">
            {/* Header */}
            <header className="px-6 py-4 border-b border-black/5 dark:border-white/5 flex items-center justify-between bg-surface/30 backdrop-blur-md z-10">
                <div className="flex items-center gap-6">
                    {/* Counter */}
                    <div className="flex flex-col">
                        <span className="text-[16px] font-black font-mono tabular-nums text-foreground/60">{filteredCatalogs.length}</span>
                        <span className="text-[8px] font-black text-black/20 dark:text-white/20 uppercase tracking-widest">{t('list.catalogs', 'CATÁLOGOS')}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[16px] font-black font-mono tabular-nums text-foreground/40">{uniqueBrands}</span>
                        <span className="text-[8px] font-black text-black/20 dark:text-white/20 uppercase tracking-widest">{t('list.brands', 'MARCAS')}</span>
                    </div>

                    <div className="h-8 w-[1px] bg-black/5 dark:bg-white/5" />

                    {/* Búsqueda */}
                    <div className="relative w-72">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 !text-[18px] text-black/20 dark:text-white/20 z-10">search</span>
                        <input
                            type="text"
                            placeholder={t('list.search_placeholder', 'Buscar marca o modelo...').toUpperCase()}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full h-10 pl-10 pr-4 bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 text-[11px] font-black uppercase tracking-widest focus:outline-none focus:border-copper/30 transition-colors"
                        />
                    </div>
                </div>

                {/* Botón Acción Primaria Industrial: Registrar Equipo */}
                <button
                    type="button"
                    onClick={onNew}
                    className="h-10 px-4 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-xs uppercase tracking-wider transition-colors rounded-none shadow-none flex items-center gap-2 cursor-pointer border-0 outline-none select-none"
                    title="Registrar nuevo equipo en catálogo"
                >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                    <span className="hidden sm:inline">REGISTRAR EQUIPO</span>
                </button>
            </header>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                {loading ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-20">
                        <span className="material-symbols-outlined animate-spin !text-4xl mb-4">progress_activity</span>
                        <span className="text-[10px] font-black uppercase tracking-[0.5em]">{t('fleet.syncing', 'Syncing Archive')}</span>
                    </div>
                ) : filteredCatalogs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-20 grayscale">
                        <span className="material-symbols-outlined !text-6xl mb-4">folder_open</span>
                        <span className="text-[11px] font-black uppercase tracking-[0.5em]">{t('list.no_catalogs', 'SIN CATÁLOGOS REGISTRADOS')}</span>
                    </div>
                ) : (
                    <div className="flex flex-col gap-8">
                        {Array.from(groupedCatalogs.entries()).map(([make, makeEntries]) => (
                            <div key={make}>
                                {/* Cabecera de grupo (marca) */}
                                <div className="flex items-center gap-3 mb-3">
                                    <span className="text-[9px] font-black uppercase tracking-[0.4em] text-foreground/30">
                                        {make}
                                    </span>
                                    <div className="flex-1 h-[1px] bg-black/5 dark:bg-white/5" />
                                    <span className="text-[9px] font-black text-foreground/20 tabular-nums">
                                        {makeEntries.length}
                                    </span>
                                </div>

                                {/* Filas */}
                                <div className="flex flex-col gap-1">
                                    {makeEntries.map((entry) => (
                                        <div
                                            key={entry.id}
                                            onClick={() => onSelectAsset(entry.id)}
                                            className="group relative bg-surface border border-black/[0.04] dark:border-white/[0.04] hover:border-copper/40 transition-all cursor-pointer flex items-center p-4"
                                        >
                                            <div className="absolute top-0 left-0 w-0.5 h-0 group-hover:h-full bg-copper transition-all duration-300" />

                                            <div className="flex flex-row items-center gap-6 w-full">
                                                <div className="w-12 h-12 rounded-none bg-black/[0.02] dark:bg-white/[0.02] overflow-hidden shrink-0 flex items-center justify-center">
                                                    {entry.foto_url ? (
                                                        <img 
                                                            src={entry.foto_url} 
                                                            alt={entry.model_oficial} 
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <span className="material-symbols-outlined text-black/20 dark:text-white/20 !text-[20px]">photo_camera</span>
                                                    )}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <h3 className="text-[18px] font-black text-foreground uppercase tracking-tight leading-none truncate">
                                                        {entry.model_oficial || 'MODELO DESCONOCIDO'}
                                                    </h3>
                                                    {entry.tipo_equipo && (
                                                        <span className="text-[9px] font-black px-1.5 py-0.5 bg-black/5 dark:bg-white/5 text-foreground/40 uppercase tracking-tighter mt-1 inline-block">
                                                            {entry.tipo_equipo}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-3 shrink-0">
                                                    <span className="text-[9px] font-black text-foreground/20 uppercase tracking-widest">
                                                        {entry.categoria_equipo || ''}
                                                    </span>
                                                    <span className="material-symbols-outlined text-foreground/10 group-hover:text-copper/40 transition-colors !text-[18px]">chevron_right</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AssetList;
