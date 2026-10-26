import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase/config';
import { doc, onSnapshot, query, collection, where, getDoc, updateDoc } from 'firebase/firestore';
import { authFetch } from '../utils/authFetch';
import { API_BASE_URL } from '../firebase/config';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { M3IconButton } from './M3IconButton';
import { M3Button } from './M3Button';
import { M3TextField } from './M3TextField';
import { ConversationalAssistant } from './ConversationalAssistant';
import ChecklistHistory from './ChecklistHistory';

interface AdminAssetDetailProps {
    catalogId: string;
    onBack: () => void;
    onOpenVault: (id: string, makeModel: string, category: string) => void;
}

interface AssetInfo extends Record<string, unknown> {
    id: string;
    make?: string;
    make_oficial?: string;
    model?: string;
    model_oficial?: string;
    categoria_equipo?: string;
    tipo_equipo?: string;
    ambiente_operativo?: string[];
    contexto_operativo?: string[];
    caracteristicas_principales?: string[];
    thumbnail_url?: string;
}

interface DeploymentNode extends Record<string, unknown> {
    id: string;
    tenant_id: string;
    original_jargon?: string;
    archived?: boolean;
    createdAt?: { toMillis: () => number; toDate: () => Date };
}

interface Pillar {
    pillar_id: string;
    status: string;
    content: string;
    make_model: string;
    generated_at: string;
    updated_at?: string;
    classified_sources: {
        fabricante: unknown[];
        externos: unknown[];
        youtube: unknown[];
    };
}

interface HitlCandidate {
    id: string;
    globalAssetId: string;
    status: string;
    pillar?: string;
    text?: string;
    content?: string;
    context?: string;
    createdAt?: { toMillis: () => number; toDate: () => Date };
    [key: string]: unknown;
}

  interface CatalogInfo extends AssetInfo {
    isSealed?: boolean;
    knowledge_vault?: Record<string, unknown>;
  }

export const AdminAssetDetail: React.FC<AdminAssetDetailProps> = ({ catalogId, onBack, onOpenVault }) => {
    const { t } = useTranslation();
    const [catalogInfo, setCatalogInfo] = useState<CatalogInfo | null>(null);
    const [deployments, setDeployments] = useState<DeploymentNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'info' | 'consultar' | 'inspecciones' | 'candidatos'>('info');
    const [hitlCandidates, setHitlCandidates] = useState<HitlCandidate[]>([]);
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [imageContext, setImageContext] = useState('');

    const fetchVisualSuggestion = useCallback(async () => {
        if (!catalogId) return;
        try {
            const response = await authFetch(`${API_BASE_URL}/assets/${catalogId}/suggest-visual-context`);
            const data = await response.json() as { suggestion?: string };
            if (data.suggestion) setImageContext(data.suggestion);
        } catch (err: unknown) {
            console.error('Error fetching visual context suggestion:', err);
        }
    }, [catalogId]);

    useEffect(() => {
        if (!catalogId) return;

        const q = query(
            collection(db, 'hitl_candidates'),
            where('globalAssetId', '==', catalogId),
            where('status', '==', 'PENDING')
        );

        const unsubCandidates = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as HitlCandidate));
            setHitlCandidates(data);
        });

        return () => unsubCandidates();
    }, [catalogId]);

    useEffect(() => {
        if (!catalogId) return;

        const unsubGlobal = onSnapshot(doc(db, 'global_asset_catalog', catalogId), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data() as CatalogInfo;
                setCatalogInfo({ ...data, id: snapshot.id });
            }
            setLoading(false);
        }, (err: unknown) => {
            console.error('Error reading global catalog:', err);
            setLoading(false);
        });

        const q = query(
            collection(db, 'tenant_assets'), 
            where('global_asset_id', '==', catalogId)
        );
        const unsubDeployments = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DeploymentNode));
            data.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
            setDeployments(data);
        });
        return () => {
            unsubGlobal();
            unsubDeployments();
        };
    }, [catalogId, t]);

    useEffect(() => {
        if (!catalogId || imageContext) return;
        if (!catalogInfo?.thumbnail_url) {
            fetchVisualSuggestion();
        }
    }, [catalogId, catalogInfo?.thumbnail_url, fetchVisualSuggestion, imageContext]);

    if (loading) return (
        <div className="h-screen w-screen bg-background flex items-center justify-center">
            <span className="animate-spin text-foreground material-symbols-outlined !text-[32px]">progress_activity</span>
        </div>
    );
 
    if (!catalogInfo) return null;
 
    const isGeneric = catalogInfo.make_oficial === 'GENÉRICO' || catalogInfo.make === 'GENÉRICO';
    const makeModelLabel = isGeneric
        ? (catalogInfo.model_oficial || catalogInfo.model || 'EQUIPO')
        : `${catalogInfo.make_oficial || catalogInfo.make || ''} ${catalogInfo.model_oficial || catalogInfo.model || ''}`.trim();

    const handleApproveCandidate = async (candidate: HitlCandidate) => {
        try {
            const catalogRef = doc(db, 'global_asset_catalog', catalogId);
            const catalogSnap = await getDoc(catalogRef);
            if (!catalogSnap.exists()) return;
            
            const catalogData = catalogSnap.data() as { knowledge_vault?: Record<string, Pillar> };
            const vault = (catalogData.knowledge_vault || {}) as Record<string, Pillar>;
            const pillarId = candidate.pillar || 'general';
            
            const currentPillar: Pillar = vault[pillarId] || {
                pillar_id: pillarId,
                status: 'COMPLETED',
                content: '',
                make_model: makeModelLabel || '',
                generated_at: new Date().toISOString(),
                classified_sources: { fabricante: [], externos: [], youtube: [] }
            };
            
            currentPillar.content = `${currentPillar.content}

### ${t('admin_catalog.field_contribution')} (${new Date().toLocaleDateString()})
${(candidate.content as string) || (candidate.text as string)}`;
            currentPillar.generated_at = new Date().toISOString();
            
            vault[pillarId] = currentPillar;
            
            await updateDoc(catalogRef, { knowledge_vault: vault });
            
            const candidateRef = doc(db, 'hitl_candidates', candidate.id);
            await updateDoc(candidateRef, { status: 'APPROVED' });
            
            toast.success('Candidato aprobado y movido a la bóveda');
        } catch (error: unknown) {
            console.error('Error approving candidate:', error);
            toast.error('Error al aprobar el candidato');
        }
    };

    const handleRejectCandidate = async (candidateId: string) => {
        try {
            const candidateRef = doc(db, 'hitl_candidates', candidateId);
            await updateDoc(candidateRef, { status: 'REJECTED' });
            toast.info('Candidato rechazado');
        } catch (error: unknown) {
            console.error('Error rejecting candidate:', error);
            toast.error('Error al rechazar el candidato');
        }
    };


    const handleGenerateImage = async () => {
        if (!catalogInfo) return;
        setIsGeneratingImage(true);
        const toastId = toast.loading(t('admin_catalog.toast_generating'));
        
        try {
            const response = await authFetch(`${API_BASE_URL}/assets/${catalogId}/generate-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    make: catalogInfo.make_oficial || catalogInfo.make,
                    model: catalogInfo.model_oficial || catalogInfo.model,
                    tipo_equipo: catalogInfo.tipo_equipo || catalogInfo.categoria_equipo,
                    custom_context: imageContext
                })
            });

            const result = await response.json() as { error?: string };

            if (response.ok) {
                toast.update(toastId, { 
                    render: t('admin_catalog.toast_image_success'), 
                    type: 'success', 
                    isLoading: false, 
                    autoClose: 3000 
                });
            } else {
                throw new Error(result.error || t('admin_catalog.error_image_gen'));
            }
        } catch (error: unknown) {
            console.error('Image Generation Error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            toast.update(toastId, { 
                render: `Error: ${errorMessage}`, 
                type: 'error', 
                isLoading: false, 
                autoClose: 5000 
            });
        } finally {
            setIsGeneratingImage(false);
        }
    };
 
    const fields = [
        { icon: 'settings', label: 'MAKE_MODEL', value: makeModelLabel },
        { icon: 'precision_manufacturing', label: 'TIPO_EQUIPO', value: catalogInfo.tipo_equipo || catalogInfo.categoria_equipo },
        { icon: 'terrain', label: 'AMBIENTE_OPERATIVO', value: catalogInfo.ambiente_operativo && catalogInfo.ambiente_operativo.length > 0 ? `[${catalogInfo.ambiente_operativo.length} DATOS DUROS]` : null },
        { icon: 'settings_applications', label: 'CONTEXTO_OPERATIVO', value: catalogInfo.contexto_operativo && catalogInfo.contexto_operativo.length > 0 ? `[${catalogInfo.contexto_operativo.length} DATOS DUROS]` : null },
        { icon: 'info', label: 'CARACTERISTICAS_PRINCIPALES', value: catalogInfo.caracteristicas_principales && catalogInfo.caracteristicas_principales.length > 0 ? `[${catalogInfo.caracteristicas_principales.length} DATOS DUROS]` : null },
    ].filter(f => f.value);
 
    return (
        <main className="h-screen w-screen bg-background flex flex-col font-atkinson text-foreground overflow-hidden">

            {/* Cabecera HUD Técnica Estandarizada */}
            <header className="pt-14 pb-4 px-6 border-b border-border-base bg-background flex items-center justify-between z-50">
                <div className="flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="w-1 h-3 bg-foreground"></span>
                        <span className="text-[10px] font-black tracking-widest text-foreground/40 uppercase">
                            {catalogInfo.categoria_equipo || t('admin_catalog.equipment_label', 'EQUIPO')}
                        </span>
                    </div>
                    <h2 className="text-xl font-black tracking-tight text-foreground uppercase">
                        {catalogInfo.model_oficial || catalogInfo.model}
                    </h2>
                </div>
                <div className="flex items-center gap-2">
                    <M3IconButton icon="arrow_back" onClick={onBack} variant="ghost" className="!text-foreground/30" />
                </div>
            </header>

            {/* NAV TABS Refined */}
            <nav className="flex border-b border-border-base px-4 bg-background sticky top-0 z-10">
                {([
                    { key: 'info',         icon: 'info',                 label: t('admin_catalog.tab_info') },
                    { key: 'consultar',    icon: 'forum',                label: t('admin_catalog.tab_consult') },
                    { key: 'inspecciones', icon: 'assignment_turned_in', label: t('admin_catalog.tab_inspections') },
                    { key: 'candidatos',   icon: 'record_voice_over',    label: t('admin_catalog.tab_candidates', 'Candidatos') },
                ] as const).map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`flex-1 flex items-center justify-center gap-2 py-4 text-[10px] font-black uppercase tracking-[0.2em] transition-colors ${
                            activeTab === tab.key
                                ? 'text-foreground border-b-2 border-foreground'
                                : 'text-foreground/30 hover:text-foreground/60 border-b-2 border-transparent'
                        }`}
                    >
                        <span className="material-symbols-outlined !text-[16px]">{tab.icon}</span>
                        <span className="hidden xs:inline">{tab.label}</span>
                    </button>
                ))}
            </nav>

            <section className="flex-1 overflow-y-auto hide-scrollbar">

                {/* TAB: INFO */}
                {activeTab === 'info' && (
                    <div className="p-6 space-y-8">

                        {/* PREVIEW DE IMAGEN (IA Generation) */}
                        <div className="relative aspect-video w-full bg-surface border border-border-base overflow-hidden group">
                            {catalogInfo.thumbnail_url ? (
                                <img 
                                    src={catalogInfo.thumbnail_url} 
                                    alt="Asset Preview" 
                                    className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700"
                                />
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center opacity-20">
                                    <span className="material-symbols-outlined !text-6xl mb-2">image_not_supported</span>
                                    <span className="text-[10px] font-black uppercase tracking-widest">{t('admin_catalog.no_media')}</span>
                                </div>
                            )}
                            
                            {/* Overlay de Control IA */}
                            <div className="absolute inset-0 bg-background/80 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-8 text-center">
                                <div className="w-full max-w-xs space-y-4">
                                    <span className="text-[10px] font-black tracking-widest text-foreground/40 uppercase mb-2 block">
                                        {t('admin_catalog.ai_image_title')}
                                    </span>
                                    <div className="relative w-full">
                                        <M3TextField
                                            label={t('admin_catalog.context_label')}
                                            placeholder={t('admin_catalog.context_placeholder')}
                                            value={imageContext}
                                            onChange={setImageContext}
                                            className="!my-0 scale-90"
                                        />
                                        <button 
                                            onClick={fetchVisualSuggestion}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground transition-colors p-2"
                                            title="Sugerir con IA"
                                        >
                                            <span className="material-symbols-outlined text-sm">refresh</span>
                                        </button>
                                    </div>
                                    <M3Button
                                        onClick={handleGenerateImage}
                                        loading={isGeneratingImage}
                                        icon="auto_awesome"
                                        className="!bg-foreground !text-background hover:!opacity-90 w-full"
                                    >
                                        {catalogInfo.thumbnail_url ? t('admin_catalog.regenerate_btn') : t('admin_catalog.generate_btn')}
                                    </M3Button>
                                </div>
                            </div>

                            {/* Badge de Estado */}
                            <div className="absolute top-4 right-4 bg-background/80 backdrop-blur px-3 py-1 border border-border-base">
                                <span className="text-[8px] font-black uppercase tracking-widest text-foreground/40">
                                    {catalogInfo.thumbnail_url ? t('admin_catalog.image_generated') : t('admin_catalog.no_media')}
                                </span>
                            </div>
                        </div>

                        {/* FICHA TÉCNICA MAESTRA (Glifos puros) */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-b border-border-base pb-2">
                                <span className="material-symbols-outlined text-foreground/20 !text-[18px]">badge</span>
                                <M3IconButton 
                                    icon="database" 
                                    variant="primary"
                                    onClick={() => onOpenVault && onOpenVault(
                                        catalogId, 
                                        makeModelLabel,
                                        catalogInfo.categoria_equipo || 'GENERAL'
                                    )}
                                    className="!w-8 !h-8"
                                />
                            </div>
                            <div className="divide-y divide-border-base">
                                {fields.map((f, idx) => (
                                    <div key={idx} className="py-2 flex items-baseline justify-between gap-4">
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="material-symbols-outlined text-foreground/20 !text-[14px]">{f.icon}</span>
                                            <span className="text-[9px] font-black uppercase tracking-widest text-foreground/40">{f.label}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-bold uppercase text-foreground/70 text-right truncate">{f.value}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* LISTADO DE NODOS (Trazabilidad Visual) */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 border-b border-border-base pb-2">
                                <span className="material-symbols-outlined text-foreground !text-[18px]">hub</span>
                                <span className="text-xs font-black text-foreground">{deployments.length}</span>
                            </div>

                            {deployments.length === 0 ? (
                                <div className="py-16 flex flex-col items-center justify-center border-dashed border border-border-base bg-surface">
                                    <span className="material-symbols-outlined text-foreground/10 !text-5xl mb-4">analytics</span>
                                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20">
                                        {t('admin_catalog.no_deployments')}
                                    </span>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-3">
                                    {deployments.map(node => (
                                        <div key={node.id} className="p-5 bg-surface border border-border-base flex flex-col gap-3 hover:border-foreground transition-colors group">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="material-symbols-outlined text-foreground !text-[16px]">precision_manufacturing</span>
                                                    <span className="text-[12px] font-black uppercase tracking-[0.1em] text-foreground/90">
                                                        {node.original_jargon || "---"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[8px] font-black uppercase tracking-widest text-foreground/50">
                                                        {node.archived ? t('common.archived', 'ARCHIVADO') : t('common.active', 'ACTIVO')}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border-base/30">
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] font-black text-foreground/20 uppercase tracking-widest mb-0.5">{t('admin_catalog.node_client', 'CLIENTE / NODO')}</span>
                                                    <div className="flex items-center gap-1">
                                                        <span className="material-symbols-outlined text-foreground/20 !text-[12px]">business</span>
                                                        <span className="text-[10px] font-bold text-foreground/70 uppercase truncate">{node.tenant_id}</span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[8px] font-black text-foreground/20 uppercase tracking-widest mb-0.5">{t('admin_catalog.node_date', 'REGISTRO')}</span>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-[10px] font-bold text-foreground/40 uppercase">
                                                            {node.createdAt?.toDate().toLocaleDateString() || '—'}
                                                        </span>
                                                        <span className="material-symbols-outlined text-foreground/20 !text-[12px]">event</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* TAB: CONSULTAR */}
                {activeTab === 'consultar' && (
                    <div className="h-full">
                        <ConversationalAssistant
                            globalAssetId={catalogId}
                            makeModel={makeModelLabel}
                        />
                    </div>
                )}

                {/* TAB: INSPECCIONES */}
                {activeTab === 'inspecciones' && (
                    <div className="p-4">
                        <ChecklistHistory globalAssetId={catalogId} />
                    </div>
                )}

                {/* TAB: CANDIDATOS */}
                {activeTab === 'candidatos' && (
                    <div className="p-6 space-y-6">
                        <div className="flex items-center gap-2 border-b border-border-base pb-2">
                            <span className="material-symbols-outlined text-foreground !text-[18px]">record_voice_over</span>
                            <span className="text-xs font-black uppercase tracking-widest text-foreground">
                                {hitlCandidates.length} {t('admin_catalog.pending_candidates')}
                            </span>
                        </div>

                        {hitlCandidates.length === 0 ? (
                            <div className="py-16 flex flex-col items-center justify-center border-dashed border border-border-base bg-surface">
                                <span className="material-symbols-outlined text-foreground/10 !text-5xl mb-4">analytics</span>
                                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/20">
                                    {t('admin_catalog.no_candidates')}
                                </span>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-4">
                                {hitlCandidates.map(candidate => (
                                    <div key={candidate.id} className="p-5 bg-surface border border-border-base flex flex-col gap-4 hover:border-foreground transition-colors">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className="material-symbols-outlined text-foreground !text-[16px]">folder</span>
                                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/90">
                                                    {candidate.pillar ? candidate.pillar.replace(/_/g, ' ') : 'GENERAL'}
                                                </span>
                                            </div>
                                            <span className="text-[8px] font-black uppercase tracking-widest text-foreground/40">
                                                {candidate.createdAt?.toDate ? candidate.createdAt.toDate().toLocaleDateString() : '—'}
                                            </span>
                                        </div>

                                        <div className="p-4 bg-background border border-border-base/50 rounded-none text-xs font-bold text-foreground/80 whitespace-pre-wrap font-atkinson">
                                            {candidate.text}
                                        </div>

                                        {candidate.context && (
                                            <div className="text-[9px] font-bold text-foreground/40 italic">
                                                {t('admin_catalog.context_label')}: {candidate.context}
                                            </div>
                                        )}

                                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-base/30">
                                            <M3Button
                                                onClick={() => handleRejectCandidate(candidate.id)}
                                                variant="ghost"
                                                icon="close"
                                                className="!text-error hover:!bg-error/10"
                                            >
                                                {t('common.reject', 'Reject')}
                                            </M3Button>
                                            <M3Button
                                                onClick={() => handleApproveCandidate(candidate)}
                                                variant="primary"
                                                icon="check"
                                                className="!bg-foreground !text-background"
                                            >
                                                {t('common.approve', 'Approve')}
                                            </M3Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

            </section>
        </main>
    );
};

export default AdminAssetDetail;
