import React, { useState, useEffect, useMemo } from 'react';
import { db, API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { M3IconButton } from './M3IconButton';
import { M3TextField } from './M3TextField';

interface AdminAssetListProps {
    onSelectAsset: (assetId: string) => void;
    onNewCatalog?: () => void;
}

interface AdminStats {
    total_global_assets: number;
    total_fleet_deployments: number;
    reuse_ratio: string;
    active_deployments: number;
    discarded_deployments: number;
    sealedCount?: number;
    globalAssetsCount?: number;
}

interface GlobalAsset extends Record<string, unknown> {
    id: string;
    make_model: string;
    categoria_equipo: string;
    deployments_count?: number;
    updatedAt?: unknown;
    tipo_equipo?: string;
    ambiente_operativo?: string[];
    contexto_operativo?: string[];
    make_oficial?: string;
    model_oficial?: string;
    thumbnail_url?: string;
    foto_url?: string;
}

export const AdminAssetList: React.FC<AdminAssetListProps> = ({ onSelectAsset, onNewCatalog }) => {
    const { t } = useTranslation();
    const [assets, setAssets] = useState<GlobalAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [stats, setStats] = useState<AdminStats | null>(null);

    useEffect(() => {
        const qGlobals = query(collection(db, 'global_asset_catalog'));
        const unsub = onSnapshot(qGlobals, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as GlobalAsset[];
            setAssets(data);
            setLoading(false);
        }, (err) => {
            console.error('Admin Catalog Read Error', err);
            setLoading(false);
        });

        authFetch(`${API_BASE_URL}/admin/catalog-stats`)
            .then(res => res.json())
            .then(setStats)
            .catch(console.error);

        return () => unsub();
    }, []);

    const filteredAssets = useMemo(() => {
        // Ordenar en memoria por updatedAt (fallback a 0 si no existe)
        const sorted = [...assets].sort((a, b) => {
            const timeA = typeof a.updatedAt === 'number' ? a.updatedAt : 0;
            const timeB = typeof b.updatedAt === 'number' ? b.updatedAt : 0;
            return timeB - timeA;
        });

        return sorted.filter(a => {
            const match = (a.make_model || '') + ' ' + (a.categoria_equipo || '') + ' ' + (a.tipo_equipo || '');
            return match.toLowerCase().includes(searchQuery.toLowerCase());
        });
    }, [assets, searchQuery]);

    return (
        <main className="h-full w-full flex-1 bg-background text-foreground flex flex-col font-sans overflow-hidden select-none transition-colors duration-300">
            {/* Cabecera Técnica — Web Mode */}
            <header className="py-4 px-8 border-b border-border-base bg-background flex items-center justify-between z-20">
                <div className="flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="w-1 h-3 bg-copper"></span>
                        <span className="text-[10px] font-black tracking-widest text-muted uppercase">
                            {t('admin_catalog.management_label', 'ADMINISTRACIÓN')}
                        </span>
                    </div>
                    <h2 className="text-2xl font-black tracking-tighter text-foreground uppercase">
                        {t('admin_catalog.title', 'CATÁLOGO DE ACTIVOS')}
                    </h2>
                </div>
                <div className="flex items-center gap-4">
                    <div className="w-64">
                        <M3TextField
                            label={t('admin_catalog.search_placeholder')}
                            value={searchQuery}
                            onChange={setSearchQuery}
                            className="!my-0 scale-90 origin-right"
                        />
                    </div>
                    <M3IconButton 
                        icon="add_box" 
                        variant="ghost" 
                        onClick={onNewCatalog} 
                        className="!text-copper"
                    />
                </div>
            </header>

            {/* HUD Técnico Web — Minimalismo Industrial */}
            <div className="px-8 py-4 grid grid-cols-4 gap-8 bg-surface border-b border-border-base">
                {[
                    { label: t('admin_catalog.stats_total'), value: assets.length, icon: 'inventory_2' },
                    { label: t('admin_catalog.stats_active'), value: stats?.active_deployments || 0, icon: 'hub' },
                    { label: t('admin_catalog.stats_reuse'), value: `${stats?.reuse_ratio || '0.00'}x`, icon: 'repeat' },
                    { label: t('admin_catalog.stats_health'), value: `${stats?.sealedCount ?? 0}/${assets.length}`, icon: 'verified' }
                ].map((stat, i) => (
                    <div key={i} className="flex flex-col">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="material-symbols-outlined text-foreground/40 !text-[14px]">{stat.icon}</span>
                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted">{stat.label}</span>
                        </div>
                        <span className="text-xl font-black text-foreground tabular-nums font-mono">{stat.value}</span>
                    </div>
                ))}
            </div>

            {/* Listado Maestro — Web Grid Display */}
            <div className="flex-1 overflow-y-auto hide-scrollbar bg-background p-8">
                {loading ? (
                    <div className="h-full flex items-center justify-center">
                        <span className="animate-spin text-foreground/20 material-symbols-outlined !text-[32px]">progress_activity</span>
                    </div>
                ) : filteredAssets.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center p-12 text-center">
                        <span className="material-symbols-outlined !text-4xl text-foreground/20 mb-4">search_off</span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted">{t('admin_catalog.no_results')}</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredAssets.map((asset) => (
                            <div 
                                key={asset.id} 
                                className="group bg-surface border border-border-base p-6 hover:border-foreground/30 transition-all cursor-pointer flex flex-col justify-between"
                                onClick={() => onSelectAsset(asset.id)}
                            >
                                <div>
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="w-12 h-12 rounded-none bg-black/[0.02] dark:bg-white/[0.02] overflow-hidden shrink-0 flex items-center justify-center">
                                                {asset.foto_url ? (
                                                    <img 
                                                        src={asset.foto_url as string} 
                                                        alt={asset.make_model} 
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <span className="material-symbols-outlined text-black/20 dark:text-white/20 !text-[20px]">photo_camera</span>
                                                )}
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[9px] text-muted uppercase font-black tracking-widest mb-1 truncate">
                                                    {asset.tipo_equipo || asset.categoria_equipo}
                                                </span>
                                                <h3 className="text-sm font-black tracking-tight uppercase text-foreground truncate">
                                                    {asset.make_model}
                                                </h3>
                                            </div>
                                        </div>
                                        {asset.make_oficial && (
                                            <span className="material-symbols-outlined text-[14px] text-foreground/30 shrink-0" title={t('admin_catalog.label_official_oem')}>verified</span>
                                        )}
                                    </div>

                                    {/* Data Insights */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-6">
                                            <div className="flex flex-col">
                                                <span className="text-[8px] text-muted font-black uppercase tracking-widest">{t('admin_catalog.label_deployments')}</span>
                                                <span className="text-xs font-black text-foreground">{asset.deployments_count || 0}</span>
                                            </div>
                                            <div className="w-px h-6 bg-border-base" />
                                            <div className="flex flex-col">
                                                <span className="text-[8px] text-muted font-black uppercase tracking-widest">{t('admin_catalog.label_hard_data')}</span>
                                                <span className="text-xs font-black text-foreground">
                                                    {(asset.ambiente_operativo?.length || 0) + (asset.contexto_operativo?.length || 0)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-6 pt-4 border-t border-border-base flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-[9px] font-black uppercase tracking-widest text-muted">{t('admin_catalog.label_view_vault')}</span>
                                    <span className="material-symbols-outlined text-muted !text-[16px]">arrow_forward</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
};

export default AdminAssetList;

