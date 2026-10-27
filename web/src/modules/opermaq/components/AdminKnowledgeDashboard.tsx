import React, { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import { doc, onSnapshot } from 'firebase/firestore';
import { M3IconButton } from './M3IconButton';
import { VaultManagerPanel } from './VaultManagerPanel'; // Importar el panel de gestión de bóvedas

// ─── Tipos ──────────────────────────────────────────────────────────────────
interface VaultIndex {
    content: string;
    synthesis: string;
    extracted_data: unknown[];
    visual_format: string;
    estado_aprobacion: 'PENDIENTE' | 'REQUIERE_CAMBIOS' | 'APROBADO_HUMANO';
    review_notes?: string;
    approved_by?: string;
    approved_at?: string;
    pending_conflicts: unknown[];
    authorized_delta_buffer: unknown[];
    pending_narrative_proposal?: string;
    needs_redaction_refresh: boolean;
}

interface VaultDimension {
    initialized: boolean;
    indices: Record<string, VaultIndex>;
    last_update?: unknown;
}

interface CatalogInfo { 
    id: string; 
    makeModel?: string;
    category?: string;
    make?: string;
    make_oficial?: string;
    model?: string;
    model_oficial?: string;
    categoria_equipo?: string;
    knowledge_vault?: Record<string, VaultDimension>; 
    isSealed?: boolean;
}

interface AdminKnowledgeDashboardProps { 
    globalAssetId: string; 
    makeModel?: string; 
    category?: string; 
    onBack: () => void; 
}

// ─── Dashboard ─────────────────────────────────────────────────────────────
export const AdminKnowledgeDashboard: React.FC<AdminKnowledgeDashboardProps> = ({
    globalAssetId,
    makeModel,
    category,
    onBack
}) => {
    const [catalogInfo, setCatalogInfo] = useState<CatalogInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [showVaultManager, setShowVaultManager] = useState(false);

    useEffect(() => {
        if (!globalAssetId) return;

        const unsub = onSnapshot(doc(db, 'global_asset_catalog', globalAssetId), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                setCatalogInfo({ 
                    id: snapshot.id, 
                    makeModel: makeModel || data.make_model || `${data.make || ''} ${data.model || ''}`.trim(),
                    category: category || data.categoria_equipo,
                    isSealed: data.isSealed || false,
                    ...data 
                } as CatalogInfo); // Cast to CatalogInfo
            }
            setLoading(false);
        }, (err) => {
            console.error('Error fetching catalog info:', err);
            setLoading(false);
        });

        return () => unsub();
    }, [globalAssetId, makeModel, category]);

    if (loading) return (
        <div className="h-screen w-screen bg-background flex items-center justify-center">
            <span className="animate-spin text-foreground material-symbols-outlined !text-4xl">progress_activity</span>
        </div>
    );

    if (!catalogInfo) return (
        <div className="h-screen w-screen bg-background flex flex-col items-center justify-center gap-4">
            <span className="material-symbols-outlined !text-5xl text-foreground/20">error</span>
            <p className="text-[13px] text-foreground/40">No se pudo cargar la información del catálogo.</p>
            <M3IconButton icon="arrow_back" onClick={onBack} variant="secondary" />
        </div>
    );

    return (
        <>
        <main className="h-screen w-screen bg-background flex flex-col font-atkinson text-foreground overflow-hidden">
            {/* Header */}
            <header className="pt-14 pb-4 px-6 border-b border-border-base bg-background flex items-center justify-between z-50">
                <div className="flex flex-col">
                    <h2 className="text-xl font-black tracking-tight text-foreground uppercase">{catalogInfo.makeModel}</h2>
                    <span className="text-[9px] font-bold text-copper tracking-[0.25em] uppercase opacity-70">Catálogo de Conocimiento</span>
                </div>
                <div className="flex items-center gap-2">
                    {catalogInfo.isSealed && (
                        <span className="px-2 py-0.5 bg-black dark:bg-white text-white dark:text-black flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[0.2em]">
                            <span className="material-symbols-outlined !text-[10px]">lock</span>SELLADO
                        </span>
                    )}
                    <M3IconButton icon="database" onClick={() => setShowVaultManager(true)} variant="secondary" />
                    <M3IconButton icon="arrow_back" onClick={onBack} variant="ghost" className="!text-foreground/30" />
                </div>
            </header>

            {/* Contenido principal */}
            <section className="flex-1 overflow-y-auto hide-scrollbar p-6">
                {/* Aquí iría el contenido del KnowledgeVaultDashboard si no estuviera segregado */}
                <div className="text-center py-20 text-foreground/40">
                    <span className="material-symbols-outlined !text-6xl mb-4">psychology</span>
                    <h3 className="text-xl font-black uppercase tracking-tight">Knowledge Dashboard</h3>
                    <p className="text-[10px] uppercase tracking-widest">Acceso a la bóveda de conocimiento IA.</p>
                </div>
            </section>
        </main>

        {/* Panel de Gestión de Bóveda (Modal o Aside) */}
            {showVaultManager && (
                <>
                    <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowVaultManager(false)}></div>
                    <aside className="fixed right-0 top-0 h-full w-full max-w-lg bg-surface z-50 shadow-none border-l border-border-base animate-in slide-in-from-right duration-300">
                        <VaultManagerPanel 
                            globalAssetId={globalAssetId} 
                            isSealed={catalogInfo?.isSealed || false} 
                            onClose={() => setShowVaultManager(false)} 
                        />
                    </aside>
                </>
            )}
        </>
    );
};

export default AdminKnowledgeDashboard;
