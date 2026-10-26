import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { doc, onSnapshot, query, collection, where } from 'firebase/firestore';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import { EdgeSyncQueue } from '../lib/EdgeSyncQueue';
import { M3TextField } from './M3TextField';
import { M3IconButton } from './M3IconButton';
import { M3Button } from './M3Button';
import { ConversationalAssistant } from './ConversationalAssistant';
import ChecklistHistory from './ChecklistHistory';
import { useTranslation } from 'react-i18next';
import { OperationalChipGrid } from './OperationalChipGrid';
import VoiceToVaultButton from './VoiceToVaultButton';
import { toast } from 'react-toastify';


interface AssetDetailProps {
    assetId: string; // tenant_catalog_id
    onBack: () => void;
    onOpenVault: () => void;
}

interface CatalogInfo extends Record<string, unknown> {
    id: string;
    original_jargon?: string;
    categoria_equipo?: string;
    make_oficial?: string;
    model_oficial?: string;
    make?: string;
    model?: string;
    tipo_equipo?: string;
    ambiente_operativo?: string[];
    contexto_operativo?: string[];
    thumbnail_url?: string;
    is_sealed?: boolean;
}

interface AssetInstance extends Record<string, unknown> {
    id: string;
    identifier_value?: string;
    dynamic_data?: Record<string, unknown>;
    createdAt?: { toMillis: () => number };
}

export const AssetDetail: React.FC<AssetDetailProps> = ({ assetId, onBack, onOpenVault }) => {
    const { t } = useTranslation();
    const { userId } = useCurrentUser();
    const [catalogInfo, setCatalogInfo] = useState<CatalogInfo | null>(null);
    const [instances, setInstances] = useState<AssetInstance[]>([]);
    const [loading, setLoading] = useState(true);

    const [isAdding, setIsAdding] = useState(false);
    const [dynamicFields, setDynamicFields] = useState<string[]>([]);
    const [dynamicData, setDynamicData] = useState<Record<string, string>>({});
    const [isGeneratingFields, setIsGeneratingFields] = useState(false);
    const [isRegistering, setIsRegistering] = useState(false);
    const [isGeneratingDiagram, setIsGeneratingDiagram] = useState(false);
    const [activeTab, setActiveTab] = useState<'dossier' | 'assistant' | 'history'>('dossier');

    useEffect(() => {
        if (!assetId) return;
        let unsubGlobal: (() => void) | null = null;
        let unsubInstances: (() => void) | null = null;
        
        const unsubTenantCatalog = onSnapshot(doc(db, 'tenant_assets', assetId), (snapshot) => {
            if (snapshot.exists()) {
                const tenantData = snapshot.data();
                const globalId = tenantData.global_asset_id;

                if (unsubGlobal) unsubGlobal();
                unsubGlobal = onSnapshot(doc(db, 'global_asset_catalog', globalId), (globalSnap) => {
                    if (globalSnap.exists()) {
                        setCatalogInfo({ 
                            id: globalSnap.id, 
                            original_jargon: tenantData.original_jargon,
                            thumbnail_url: tenantData.thumbnail_url || globalSnap.data().thumbnail_url,
                            is_sealed: globalSnap.data().is_sealed,
                            ...globalSnap.data() 
                        } as CatalogInfo);
                    }
                });

                if (unsubInstances) unsubInstances();
                const q = query(
                    collection(db, 'tenant_assets'), 
                    where('global_asset_id', '==', globalId)
                );
                unsubInstances = onSnapshot(q, (instSnap) => {
                    const instData = instSnap.docs.map(d => ({id: d.id, ...d.data()})) as AssetInstance[];
                    instData.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
                    setInstances(instData);
                    setLoading(false);
                });
            } else {
                setLoading(false);
            }
        }, () => setLoading(false));

        return () => {
            unsubTenantCatalog();
            if (unsubGlobal) unsubGlobal();
            if (unsubInstances) unsubInstances();
        };
    }, [assetId]);

    const handleAddUnit = async () => {
        if (!catalogInfo) return;
        setIsAdding(true);
        setIsGeneratingFields(true);
        try {
            const res = await authFetch(`${API_BASE_URL}/assets/generate-fields`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    categoria_equipo: catalogInfo.categoria_equipo,
                    make_model: (catalogInfo.make_oficial === 'GENÉRICO' ? catalogInfo.model_oficial : `${catalogInfo.make_oficial} ${catalogInfo.model_oficial}`)
                })
            });
            const data = await res.json();
            setDynamicFields(data.fields || []);
            setDynamicData({});
        } catch (e) {
            console.error(e);
            setDynamicFields(["PATENTE", "ID_INTERNO"]);
            setDynamicData({});
        } finally {
            setIsGeneratingFields(false);
        }
    };

    const handleRegisterUnit = async () => {
        if (!catalogInfo) return;
        if (dynamicFields.some(f => !dynamicData[f]?.trim())) return;

        setIsRegistering(true);
        const payload = {
            global_asset_id: catalogInfo.id,
            make_oficial: catalogInfo.make || catalogInfo.make_oficial,
            model_oficial: catalogInfo.model || catalogInfo.model_oficial,
            categoria_equipo: catalogInfo.categoria_equipo,
            ownership_type: 'PROPIO',
            identifier_value: Object.values(dynamicData)[0] || `AUTO-${Date.now()}`,
            original_jargon: catalogInfo.original_jargon,
            userId: userId || 'anonymous',
            dynamic_data: dynamicData
        };

        try {
            if (EdgeSyncQueue.isOnline) {
                const res = await authFetch(`${API_BASE_URL}/assets/register-instance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    setIsAdding(false);
                    return;
                }
            }
            await EdgeSyncQueue.pushTransaction('API', `${API_BASE_URL}/assets/register-instance`, payload, 'INSTANCE_REGISTRATION');
            setIsAdding(false);
        } catch (_e) {
            await EdgeSyncQueue.pushTransaction('API', `${API_BASE_URL}/assets/register-instance`, payload, 'INSTANCE_REGISTRATION');
            setIsAdding(false);
        } finally {
            setIsRegistering(false);
        }
    };

    const handleGenerateDiagram = async () => {
        if (!catalogInfo) return;
        setIsGeneratingDiagram(true);
        try {
            const res = await authFetch(`${API_BASE_URL}/assets/${assetId}/generate-diagram`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    make: catalogInfo.make_oficial,
                    model: catalogInfo.model_oficial,
                    tipo: catalogInfo.tipo_equipo,
                    contexto: catalogInfo.contexto_operativo?.join(', ') || ''
                })
            });

            if (!res.ok) throw new Error('Failed to generate diagram');
            
            const data = await res.json();
            if (data.thumbnail_url) {
                // El backend ya debería haber actualizado Firestore, pero por si acaso o para feedback inmediato
                setCatalogInfo(prev => prev ? { ...prev, thumbnail_url: data.thumbnail_url } : null);
                toast.success(t('detail.diagram_generated'));
            }
        } catch (e) {
            console.error(e);
            toast.error(t('detail.error_generate_diagram'));
        } finally {
            setIsGeneratingDiagram(false);
        }
    };

    if (loading) return (
        <div className="h-screen w-screen bg-background flex items-center justify-center">
            <span className="material-symbols-outlined animate-spin text-foreground !text-4xl">progress_activity</span>
        </div>
    );

    if (!catalogInfo) return (
        <div className="h-screen w-screen bg-background flex flex-col items-center justify-center gap-4 font-atkinson">
            <span className="material-symbols-outlined text-foreground/5 !text-8xl">error</span>
            <span className="text-[10px] font-black uppercase tracking-[0.5em] text-foreground/20">{t('detail.catalog_not_found')}</span>
            <M3Button onClick={onBack} variant="ghost" className="mt-4">{t('common.back')}</M3Button>
        </div>
    );

    const isGeneric = catalogInfo.make_oficial === 'GENÉRICO' || catalogInfo.make === 'GENÉRICO';
    const makeValue = isGeneric ? 'GENÉRICO' : (catalogInfo.make_oficial || catalogInfo.make || '');
    const modelValue = catalogInfo.model_oficial || catalogInfo.model || '';

    return (
        <main className="h-screen w-screen bg-background flex font-atkinson text-foreground overflow-hidden relative">
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.02] pointer-events-none" />
            
            {/* Sidebar de Navegación Técnica — ESTILO BÓVEDA */}
            <aside className="hidden lg:flex w-[320px] bg-surface flex-col shrink-0 border-r border-black/5 dark:border-white/5 relative z-10">
                <div className="p-10 pb-6 space-y-12">
                    <div className="flex items-center gap-4">
                        <M3IconButton 
                            icon="arrow_back" 
                            onClick={onBack} 
                            variant="ghost" 
                            className="!text-foreground/20 hover:!text-foreground"
                        />
                        <span className="text-[9px] font-black uppercase tracking-[0.4em] text-foreground/40 leading-none">{t('detail.catalog_detail')}</span>
                    </div>
                    
                    <div className="space-y-1 border-l-2 border-copper pl-6">
                        <span className="text-[10px] font-black text-black/30 dark:text-white/30 uppercase tracking-[0.5em]">{makeValue}</span>
                        <h2 className="text-[32px] font-black tracking-tighter text-foreground uppercase leading-[0.9]">
                            {modelValue}
                        </h2>
                    </div>
                </div>

                <nav className="flex-1 px-4 py-8 space-y-2">
                    {[
                        { id: 'dossier', icon: 'description', roman: '0', label: t('detail.dossier'), sub: t('detail.specs') },
                        { id: 'assistant', icon: 'smart_toy', roman: 'I', label: t('detail.ai_assistant'), sub: t('detail.tech_consultation') },
                        { id: 'history', icon: 'history', roman: 'II', label: t('detail.history'), sub: t('detail.events_logs') },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as 'dossier' | 'assistant' | 'history')}
                            className={`w-full p-6 flex items-center gap-6 transition-all group relative overflow-hidden ${
                                activeTab === tab.id 
                                    ? 'bg-black/5 dark:bg-white/5 text-foreground' 
                                    : 'text-foreground/30 hover:text-foreground/60 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'
                            }`}
                        >
                            <span className={`text-[12px] font-black w-6 text-center ${activeTab === tab.id ? 'text-copper' : 'text-foreground/10'}`}>
                                {tab.roman}
                            </span>
                            <div className="flex flex-col items-start flex-1">
                                <span className="text-[11px] font-black uppercase tracking-[0.2em]">{tab.label}</span>
                                <span className="text-[8px] font-black opacity-40 uppercase tracking-[0.3em]">{tab.sub}</span>
                            </div>
                            <span className={`material-symbols-outlined !text-[18px] ${activeTab === tab.id ? 'text-foreground/40' : 'opacity-0 group-hover:opacity-10'}`}>
                                chevron_right
                            </span>
                        </button>
                    ))}
                </nav>

                <div className="p-8 space-y-4">
                    <M3Button 
                        onClick={onOpenVault} 
                        variant="primary" 
                        icon="database"
                        fullWidth
                        className="!h-16 bg-foreground text-background hover:bg-foreground/90 transition-colors shadow-none"
                    >
                        <span className="text-[11px] font-black uppercase tracking-[0.4em]">{t('detail.open_vault')}</span>
                    </M3Button>
                    <VoiceToVaultButton 
                        globalAssetId={catalogInfo.id} 
                        makeModel={isGeneric ? catalogInfo.model_oficial! : `${catalogInfo.make_oficial} ${catalogInfo.model_oficial}`}
                    />
                </div>
            </aside>

            {/* Mobile Header */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-0">
                <header className="lg:hidden p-6 pt-14 bg-surface border-b border-black/5 dark:border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <M3IconButton icon="arrow_back" onClick={onBack} variant="ghost" />
                        <div className="flex flex-col">
                            <span className="text-[9px] font-black uppercase tracking-widest text-foreground/40">{makeValue}</span>
                            <h2 className="text-[16px] font-black text-foreground uppercase truncate max-w-[150px]">{modelValue}</h2>
                        </div>
                    </div>
                    <M3IconButton icon="database" onClick={onOpenVault} variant="ghost" />
                </header>

                {/* Viewport Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-12 lg:p-16">
                    {activeTab === 'dossier' && (
                        <div className="max-w-7xl mx-auto space-y-24 animate-in fade-in slide-in-from-bottom-8 duration-700">
                            
                            {/* Industrial Hero Section */}
                            <section className="flex flex-col lg:flex-row gap-16 items-start">
                                <div className="flex-1 space-y-10">
                                    <div className="flex items-center gap-6">
                                        <div className="px-4 py-1.5 bg-black text-white dark:bg-white dark:text-black">
                                            <span className="text-[10px] font-black uppercase tracking-[0.3em]">{t('detail.master_asset')}</span>
                                        </div>
                                        <div className="h-[1px] w-12 bg-copper/40" />
                                        <span className="text-[10px] font-black text-foreground/30 uppercase tracking-[0.5em]">{t('detail.uid')} {catalogInfo.id.toUpperCase()}</span>
                                    </div>
                                    
                                    <div className="space-y-4">
                                        <h1 className="text-[64px] md:text-[110px] font-black tracking-tighter text-foreground uppercase leading-[0.8] transition-all">
                                            {modelValue}
                                        </h1>
                                        <div className="flex items-center gap-4">
                                            <span className="text-[14px] font-black text-copper uppercase tracking-[0.6em]">
                                                {catalogInfo.tipo_equipo || t('detail.industrial_unit')}
                                            </span>
                                            <div className="h-4 w-[1px] bg-foreground/10" />
                                            <span className="text-[10px] font-black text-foreground/40 uppercase tracking-[0.4em]">
                                                {catalogInfo.categoria_equipo}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Asset Image / Diagram */}
                                <div className="w-full lg:w-[400px] aspect-square bg-surface border border-black/5 dark:border-white/5 relative group overflow-hidden">
                                    {catalogInfo.thumbnail_url ? (
                                        <img 
                                            src={catalogInfo.thumbnail_url} 
                                            alt={modelValue} 
                                            className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center gap-6">
                                            <span className="material-symbols-outlined !text-[80px] text-foreground/5">precision_manufacturing</span>
                                            <M3Button 
                                                onClick={handleGenerateDiagram} 
                                                variant="ghost" 
                                                loading={isGeneratingDiagram}
                                                className="!border-black/10 dark:!border-white/10"
                                            >
                                                <span className="text-[9px] font-black uppercase tracking-[0.3em]">{t('detail.generate_oem_diagram')}</span>
                                            </M3Button>
                                        </div>
                                    )}
                                    <div className="absolute inset-0 bg-gradient-to-t from-background/20 to-transparent pointer-events-none" />
                                </div>
                            </section>

                            <div className="grid grid-cols-1 xl:grid-cols-12 gap-20">
                                {/* Technical Parameters */}
                                <div className="xl:col-span-8 space-y-16">
                                    <div className="space-y-8">
                                        <div className="flex items-center gap-4">
                                            <span className="text-[12px] font-black uppercase tracking-[0.5em] text-foreground/40">{t('detail.tech_specs')}</span>
                                            <div className="h-[1px] flex-1 bg-black/5 dark:bg-white/5" />
                                        </div>
                                        
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-12">
                                            {[
                                                { label: t('detail.manufacturer'), value: makeValue },
                                                { label: t('detail.type'), value: catalogInfo.tipo_equipo || '---' },
                                                { label: t('detail.category'), value: catalogInfo.categoria_equipo || '---' },
                                                { label: t('detail.original_jargon'), value: catalogInfo.original_jargon || '---' },
                                            ].map((spec, i) => (
                                                <div key={i} className="space-y-2 group">
                                                    <span className="text-[9px] font-black text-black/30 dark:text-white/30 uppercase tracking-[0.4em] block group-hover:text-copper transition-colors">{spec.label}</span>
                                                    <p className="text-[16px] font-bold text-foreground uppercase tracking-tight">{spec.value}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 pt-8">
                                        <OperationalChipGrid 
                                            title={t('detail.op_environment')} 
                                            items={catalogInfo.ambiente_operativo || []} 
                                        />
                                        <OperationalChipGrid 
                                            title={t('detail.op_context')} 
                                            items={catalogInfo.contexto_operativo || []} 
                                        />
                                    </div>
                                </div>

                                {/* Fleet Inventory */}
                                <div className="xl:col-span-4 space-y-10">
                                    <div className="bg-surface border border-black/5 dark:border-white/5 p-10 space-y-10 relative">
                                        <div className="flex items-center justify-between border-b border-black/5 dark:border-white/5 pb-8">
                                            <div className="flex flex-col">
                                                <h3 className="text-[12px] font-black uppercase tracking-[0.5em] text-foreground/60">{t('detail.units')}</h3>
                                                <span className="text-[10px] font-black text-copper uppercase tracking-widest">{instances.length} {t('detail.assets')}</span>
                                            </div>
                                            {!isAdding && (
                                                <M3IconButton 
                                                    icon={catalogInfo?.is_sealed ? "lock" : "add"} 
                                                    onClick={catalogInfo?.is_sealed ? undefined : handleAddUnit} 
                                                    variant="ghost" 
                                                    className={`!bg-black/5 dark:!bg-white/5 ${catalogInfo?.is_sealed ? 'opacity-30 cursor-not-allowed' : ''}`} 
                                                />
                                            )}
                                        </div>

                                        {isAdding && (
                                            <div className="bg-background p-8 border-l-2 border-copper space-y-8 animate-in slide-in-from-top-4">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[9px] font-black tracking-[0.4em] text-foreground/40 uppercase">{t('detail.unit_registration')}</span>
                                                    <M3IconButton icon="close" onClick={() => setIsAdding(false)} variant="ghost" className="!p-0" />
                                                </div>
                                                
                                                {isGeneratingFields ? (
                                                    <div className="py-12 flex flex-col items-center gap-4">
                                                        <span className="material-symbols-outlined animate-spin text-copper !text-2xl">progress_activity</span>
                                                        <span className="text-[9px] font-black text-foreground/20 uppercase tracking-[0.5em]">{t('detail.configuring_protocol')}</span>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-6">
                                                        {dynamicFields.map((field, idx) => (
                                                            <M3TextField 
                                                                key={idx}
                                                                label={field.toUpperCase()}
                                                                value={dynamicData[field] || ''}
                                                                onChange={(val) => setDynamicData({ ...dynamicData, [field]: val })}
                                                                autoComplete="off"
                                                                className="!bg-transparent border-black/10 dark:border-white/10"
                                                            />
                                                        ))}
                                                        <M3Button 
                                                            onClick={handleRegisterUnit}
                                                            variant="primary"
                                                            fullWidth
                                                            className="bg-foreground text-background !h-14"
                                                            disabled={isRegistering || catalogInfo?.is_sealed || dynamicFields.some(f => !dynamicData[f]?.trim())}
                                                        >
                                                            {isRegistering ? t('detail.registering') : (catalogInfo?.is_sealed ? t('detail.sealed_catalog') : t('detail.confirm_registration'))}
                                                        </M3Button>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">
                                            {instances.length === 0 && !isAdding ? (
                                                <div className="py-24 text-center border border-dashed border-black/5 dark:border-white/5 flex flex-col items-center gap-4">
                                                    <span className="material-symbols-outlined !text-4xl text-foreground/5">inventory_2</span>
                                                    <span className="text-[9px] font-black uppercase tracking-[0.5em] text-foreground/10">{t('detail.empty_catalog')}</span>
                                                </div>
                                            ) : (
                                                instances.map((inst) => (
                                                    <div key={inst.id} className="p-6 bg-background border border-black/5 dark:border-white/5 hover:border-copper/20 transition-all group">
                                                        <div className="flex items-center justify-between mb-6">
                                                            <div className="flex flex-col">
                                                                <span className="text-[8px] font-black text-black/30 dark:text-white/30 uppercase tracking-widest mb-1">{t('detail.identifier')}</span>
                                                                <span className="text-[15px] font-black text-foreground uppercase tracking-tight">{inst.identifier_value}</span>
                                                            </div>
                                                            <div className="w-2 h-2 bg-copper/40" />
                                                        </div>
                                                        
                                                        <div className="grid grid-cols-2 gap-4">
                                                            {inst.dynamic_data && Object.entries(inst.dynamic_data).map(([key, value]) => (
                                                                <div key={key} className="space-y-0.5">
                                                                    <span className="text-[8px] font-black text-black/20 dark:text-white/20 uppercase tracking-wider">{key}</span>
                                                                    <p className="text-[10px] font-bold text-foreground/60 uppercase truncate">{String(value)}</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'assistant' && (
                        <div className="h-full max-w-5xl mx-auto animate-in fade-in duration-500">
                            <ConversationalAssistant
                                globalAssetId={catalogInfo.id}
                                makeModel={isGeneric ? catalogInfo.model_oficial! : `${catalogInfo.make_oficial} ${catalogInfo.model_oficial}`}
                            />
                        </div>
                    )}

                    {activeTab === 'history' && (
                        <div className="max-w-5xl mx-auto animate-in fade-in duration-500">
                            <ChecklistHistory globalAssetId={catalogInfo.id} />
                        </div>
                    )}
                </div>
            </div>
            
        </main>
    );
};

export default AssetDetail;
