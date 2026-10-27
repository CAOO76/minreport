import React, { useState, useEffect, useCallback } from 'react';
import { M3TextField } from './M3TextField';
import { AgentBadge } from './AgentBadge';
import { M3Button } from './M3Button';
import { M3IconButton } from './M3IconButton';
import { useTranslation } from 'react-i18next';
import { eventBus } from '../lib/core-sdk-shield';
import { toast } from 'react-toastify';
import { IndustrialDiffViewer } from './IndustrialDiffViewer';
import { auth } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import { useCurrentUser } from '../hooks/useCurrentUser';

export interface VaultConflict {
    id: string; // proposal_id
    pillarId: string;
    itemId: string;
    fieldLabel: string;
    sourceReference: {
        file: string;
        page: number;
    };
    originalValue: string;
    proposedValue: string;
    status: 'pending' | 'approved' | 'rejected' | 'modified';
    history: {
        timestamp: string;
        actor: 'ai' | 'human' | 'system';
        action: string;
        note?: string;
    }[];
    rawProposal: Record<string, unknown>; // Objeto original de Firestore
}

interface TestPilotDashboardProps {
    globalAssetId: string;
    pdfUrl?: string; // URL de Firebase Storage
}

interface SpeechRecognitionEvent {
    results: {
        [index: number]: {
            [index: number]: {
                transcript: string;
            };
        };
    };
}

declare global {
  interface Window {
    webkitSpeechRecognition?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    SpeechRecognition?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

/**
 * OPERMAQ-DEV | Test Pilot Dashboard (v4.3 - INDUSTRIAL POLISH)
 * Dashboard para la validación humana de bóvedas de conocimiento generadas por IA.
 */
export const TestPilotDashboard: React.FC<TestPilotDashboardProps> = ({
    globalAssetId,
    pdfUrl 
}) => {
    const { t, i18n } = useTranslation();
    const [approvalText, setApprovalText] = useState('');
    const [activeListeningId, setActiveListeningId] = useState<string | null>(null);
    const [conflictNotes, setConflictNotes] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [conflicts, setConflicts] = useState<VaultConflict[]>([]);
    const [isSealed, setIsSealed] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [unsealText, setUnsealText] = useState('');
    const [assetPdfUrl, setAssetPdfUrl] = useState<string | null>(pdfUrl || null);
    const { isSystemAdmin } = useCurrentUser();

    const finalPdfUrl = pdfUrl || assetPdfUrl;

    const fetchConflicts = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch asset document from Firestore via backend
            const response = await authFetch(`/api/vault/asset/${globalAssetId}`);
            if (response.status === 404) {
                setConflicts([]);
                setIsSealed(false);
                return;
            }
            if (!response.ok) throw new Error('Error al obtener datos del activo');
            
            const assetData = await response.json();
            if (assetData?.exists === false) {
                setConflicts([]);
                setIsSealed(false);
                return;
            }
            if (assetData?.manual_url || assetData?.pdfUrl) {
                setAssetPdfUrl(String(assetData.manual_url || assetData.pdfUrl));
            }
            const vault = assetData?.knowledge_vault || {};
            setIsSealed(assetData?.isSealed || false);
            const allConflicts: VaultConflict[] = [];

            // Iteramos todos los pilares para recolectar conflictos
            const pillars = ['ficha_tecnica', 'manual_operaciones', 'pauta_mantencion', 'matriz_riesgos', 'checklist_pre_op'];
            
            pillars.forEach(pId => {
                const items = vault[pId]?.items || [];
                items.forEach((item: Record<string, unknown>) => {
                    const pending = (item.pending_conflicts as Record<string, unknown>[]) || [];
                    pending.forEach((proposal: Record<string, unknown>) => {
                        allConflicts.push({
                            id: (proposal.proposal_id as string) || `proposal-${Math.random()}`,
                            pillarId: pId,
                            itemId: item.item_id as string,
                            fieldLabel: (proposal.componente as string) || (item.title as string),
                            sourceReference: { 
                                file: (proposal.source as Record<string, unknown>)?.file as string || 'N/A', 
                                page: (proposal.source as Record<string, unknown>)?.page as number || 0 
                            },
                            originalValue: (item.content as string) || '(Sin contenido previo)',
                            proposedValue: (proposal.valor_nuevo as string) || (proposal.finalContent as string) || '',
                            status: 'pending',
                            history: (item.historial_cambios as Record<string, unknown>[])?.map((h) => ({
                                timestamp: h.fecha as string,
                                actor: h.actor === 'IA' ? 'ai' : 'human',
                                action: (h.detalle || h.accion) as string
                            })) || [],
                            rawProposal: proposal
                        });
                    });
                });
            });

            setConflicts(allConflicts);
        } catch (error) {
            console.error('[TestPilotDashboard] Error fetching conflicts:', error);
            toast.error(t('testPilot.error_fetching') || 'Error al cargar conflictos.');
        } finally {
            setLoading(false);
        }
    }, [globalAssetId, t]);

    useEffect(() => {
        fetchConflicts();
    }, [fetchConflicts]);

    const startSpeechRecognition = (conflictId: string) => {
        const win = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const SpeechRecognition = win.webkitSpeechRecognition || win.SpeechRecognition;

        if (!SpeechRecognition) {
            toast.error(t('testPilot.voice_not_supported') || 'Speech recognition not supported in this browser.');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = i18n.language === 'es' ? 'es-ES' : i18n.language === 'pt' ? 'pt-PT' : 'en-US';
        
        recognition.onstart = () => {
            setActiveListeningId(conflictId);
            eventBus.emit('TEST_PILOT_VOICE_RECOGNITION_START', {
                event_type: 'TEST_PILOT_VOICE_RECOGNITION_START',
                source_skill: 'TestPilotDashboard',
                payload: { globalAssetId, conflictId },
                timestamp: new Date().toISOString()
            });
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            const transcript = event.results[0][0].transcript;
            setConflictNotes(prev => ({
                ...prev,
                [conflictId]: prev[conflictId] ? `${prev[conflictId]} ${transcript}` : transcript
            }));
            setActiveListeningId(null);
            eventBus.emit('TEST_PILOT_VOICE_RECOGNITION_RESULT', {
                event_type: 'TEST_PILOT_VOICE_RECOGNITION_RESULT',
                source_skill: 'TestPilotDashboard',
                payload: { globalAssetId, conflictId, transcript },
                timestamp: new Date().toISOString()
            });
        };

        recognition.onerror = (err: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            setActiveListeningId(null);
            let errorMessage = 'Speech recognition error occurred.';
            if (err instanceof Error) {
                errorMessage = err.message;
            } else if (err && typeof err === 'object' && 'error' in err) {
                errorMessage = String(err.error);
            }
            
            console.error('[TestPilotDashboard] Speech error:', err);
            
            eventBus.emit('TEST_PILOT_VOICE_RECOGNITION_ERROR', {
                event_type: 'TEST_PILOT_VOICE_RECOGNITION_ERROR',
                source_skill: 'TestPilotDashboard',
                payload: { error: errorMessage },
                timestamp: new Date().toISOString()
            });
        };

        recognition.onend = () => setActiveListeningId(null);
        recognition.start();
    };
    

    const handleResolveConflict = async (conflict: VaultConflict, action: 'ACCEPT' | 'REJECT') => {
        setIsSaving(true);
        try {
            const response = await authFetch('/api/vault/resolve-item-conflict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId,
                    pillarId: conflict.pillarId,
                    itemId: conflict.itemId,
                    action,
                    proposal: conflict.rawProposal,
                    reviewerId: auth.currentUser?.email || 'TEST_PILOT'
                })
            });

            if (!response.ok) throw new Error('Error al resolver conflicto');

            toast.success(action === 'ACCEPT' ? t('testPilot.accepted') : t('testPilot.rejected'));
            
            // Refrescar lista
            await fetchConflicts();
            
            eventBus.emit('TEST_PILOT_CONFLICT_RESOLVED', {
                event_type: 'TEST_PILOT_CONFLICT_RESOLVED',
                source_skill: 'TestPilotDashboard',
                payload: { globalAssetId, conflictId: conflict.id, action },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[TestPilotDashboard] Error resolving conflict:', error);
            toast.error(t('testPilot.error_resolving') || 'Error al resolver el conflicto.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleAiAssist = async (conflict: VaultConflict) => {
        const note = conflictNotes[conflict.id];
        if (!note) {
            toast.info(t('testPilot.provide_note') || 'Por favor proporcione una nota o dicte una corrección.');
            return;
        }

        setIsSaving(true);
        try {
            const response = await authFetch('/api/vault/ai-assist-rejection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId,
                    pillarId: conflict.pillarId,
                    itemId: conflict.itemId,
                    rejectionNote: note
                })
            });

            if (!response.ok) throw new Error('Error en asistente IA');

            const result = await response.json();
            
            // Actualizamos el conflicto localmente con la propuesta de la IA
            setConflicts(prev => prev.map(c => 
                c.id === conflict.id 
                    ? { 
                        ...c, 
                        proposedValue: result.finalContent,
                        history: [
                            ...c.history,
                            { 
                                timestamp: new Date().toISOString(), 
                                actor: 'ai', 
                                action: `Corrección IA: ${result.clarification}` 
                            }
                        ],
                        // Actualizamos el rawProposal para que si se acepta, se envíe el contenido corregido
                        rawProposal: { ...c.rawProposal, finalContent: result.finalContent, valor_nuevo: result.finalContent }
                    } 
                    : c
            ));

            toast.success(t('testPilot.ai_correction_ready') || 'Corrección de IA generada.');
            
            eventBus.emit('TEST_PILOT_AI_ASSIST_SUCCESS', {
                event_type: 'TEST_PILOT_AI_ASSIST_SUCCESS',
                source_skill: 'TestPilotDashboard',
                payload: { globalAssetId, conflictId: conflict.id },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[TestPilotDashboard] Error in AI Assist:', error);
            toast.error(t('testPilot.error_ai_assist') || 'Error al solicitar asistencia de IA.');
        } finally {
            setIsSaving(false);
        }
    };

    const isHardConfirmed = approvalText.toLowerCase() === t('registration.word_register').toLowerCase() || 
                            approvalText.toLowerCase() === t('testPilot.approved_word').toLowerCase() || 
                            approvalText.toLowerCase() === t('testPilot.approved_placeholder')?.replace(/'/g, '').toLowerCase();

    const handleSealVault = async () => {
        if (!isHardConfirmed) return;
        
        setIsSaving(true);
        try {
            // Real backend call to seal the vault
            const response = await authFetch(`/api/vault/seal/${globalAssetId}`, {
                method: 'POST'
            });

            if (!response.ok) throw new Error('Error al sellar la bóveda');

            // Log event for audit trail
            eventBus.emit('TEST_PILOT_APPROVAL_SUCCESS', {
                event_type: 'TEST_PILOT_APPROVAL_SUCCESS',
                source_skill: 'TestPilotDashboard',
                payload: { globalAssetId, notes: conflictNotes, conflictsApproved: conflicts.length },
                timestamp: new Date().toISOString()
            });
            
            setIsSealed(true);
            toast.success(t('testPilot.approval_confirmed') || 'Vault sealed and authorized.');
        } catch (error) {
            console.error('[TestPilotDashboard] Error sealing vault:', error);
            toast.error(t('testPilot.error_sealing') || 'Error al sellar la bóveda.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleUnsealVault = async () => {
        const confirmWord = t('testPilot.unseal_placeholder') || 'UNSEAL';
        if (unsealText.toUpperCase() !== confirmWord.toUpperCase()) return;

        setIsSaving(true);
        try {
            const response = await authFetch(`/api/vault/unseal/${globalAssetId}`, {
                method: 'POST'
            });

            if (!response.ok) throw new Error('Error al des-sellar la bóveda');

            toast.success(t('testPilot.unseal_success') || 'Bóveda des-sellada.');
            setIsSealed(false);
            setUnsealText('');
            setApprovalText('');
            await fetchConflicts();

            eventBus.emit('TEST_PILOT_UNSEAL_SUCCESS', {
                event_type: 'TEST_PILOT_UNSEAL_SUCCESS',
                source_skill: 'TestPilotDashboard',
                payload: { globalAssetId },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[TestPilotDashboard] Error unsealing vault:', error);
            toast.error(t('testPilot.unseal_error') || 'Error al des-sellar la bóveda.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full min-h-[calc(100vh-64px)] bg-background text-foreground font-atkinson overflow-hidden transition-colors duration-500">
            {/* HEADER LOCALIZADO */}
            <header className="h-14 border-b border-border-base flex items-center justify-between px-6 bg-background/80 backdrop-blur-md z-50">
                <div className="flex items-center gap-4">
                    <span className="material-symbols-outlined text-foreground animate-pulse">terminal</span>
                    <h1 className="text-[10px] font-black uppercase tracking-[0.4em]">{t('testPilot.hud_title')}</h1>
                </div>
                <div className="flex items-center gap-6">
                    <AgentBadge pillarId="orchestrator" />
                    <div className={`px-4 py-1 text-[10px] font-black rounded-none transition-all duration-700 ${isHardConfirmed ? 'bg-foreground text-background' : 'bg-foreground/5 text-foreground/30'}`}>
                        {isHardConfirmed ? t('testPilot.authorized') : t('testPilot.blocked')}
                    </div>
                </div>
            </header>

            {/* PANEL PRINCIPAL — PROPORCIÓN ÁUREA (61.8% / 38.2%) */}
            <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                {/* PANEL IZQUIERDO (Φ ≈ 61.8%): VISOR PDF TÉCNICO */}
                <section className="w-full lg:w-[61.8%] p-4 bg-foreground/[0.03] border-b lg:border-b-0 lg:border-r border-border-base/30">
                    <div className="w-full h-full border border-border-base bg-surface overflow-hidden shadow-none relative group flex items-center justify-center">
                        {finalPdfUrl ? (
                            <>
                                <iframe 
                                    src={finalPdfUrl} 
                                    className="w-full h-full industrial-viewer opacity-90 group-hover:opacity-100 transition-opacity duration-500 grayscale-[0.5] group-hover:grayscale-0"
                                    title={t('testPilot.tech_viewer')}
                                />
                                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                                    <div className="bg-black/80 text-white text-[9px] px-2 py-1 font-black uppercase tracking-widest backdrop-blur-sm border border-white/10">
                                        {t('testPilot.source_validated')}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center p-12 text-center select-none">
                                <span className="material-symbols-outlined !text-[36px] text-foreground/20 mb-4">description</span>
                                <p className="text-[11px] font-mono uppercase tracking-widest text-foreground/40">
                                    [Información técnica no declarada en ficha — Sin documento PDF vinculado para {globalAssetId}]
                                </p>
                            </div>
                        )}
                        
                        {/* Overlay industrial */}
                        <div className="absolute inset-0 pointer-events-none border-[20px] border-transparent group-hover:border-foreground/[0.02] transition-all duration-700"></div>
                    </div>
                </section>

                {/* PANEL DERECHO (1 - Φ ≈ 38.2%): EDITOR DE BÓVEDA */}
                <section className="w-full lg:w-[38.2%] overflow-y-auto custom-scrollbar bg-background relative">
                    
                    {loading ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-12 space-y-6">
                            <div className="w-12 h-12 border-2 border-foreground/10 border-t-foreground animate-spin rounded-none"></div>
                            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-foreground/40 animate-pulse">
                                {t('vault.loading') || 'Sincronizando...'}
                            </p>
                        </div>
                    ) : isSealed ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center animate-in zoom-in duration-1000">
                            <span className="material-symbols-outlined !text-[64px] text-foreground mb-6">verified</span>
                            <h2 className="text-2xl font-black uppercase tracking-tighter mb-2">{t('testPilot.authorized')}</h2>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 max-w-xs">
                                {t('testPilot.vault_sealed_desc') || 'La integridad de la bóveda ha sido confirmada por el piloto de pruebas.'}
                            </p>
                            <div className="mt-12 space-y-6">
                                <M3Button 
                                    variant="secondary" 
                                    icon="arrow_back"
                                    onClick={() => window.history.back()}
                                >{t('common.back_to_fleet')}</M3Button>

                                {isSystemAdmin && (
                                    <div className="pt-12 border-t border-border-base mt-12 animate-in fade-in duration-1000">
                                        <div className="bg-surface p-8 border border-border-base space-y-6 max-w-sm mx-auto">
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40">
                                                {t('testPilot.unseal_desc')}
                                            </p>
                                            <M3TextField 
                                                label={t('testPilot.unseal_confirm')}
                                                placeholder={t('testPilot.unseal_placeholder')}
                                                value={unsealText}
                                                onChange={setUnsealText}
                                                autoComplete="off"
                                            />
                                            <M3Button
                                                variant="secondary"
                                                icon="lock_open"
                                                className="w-full !text-red-500 hover:!bg-red-500/10 transition-all"
                                                disabled={unsealText.toUpperCase() !== (t('testPilot.unseal_placeholder') || 'UNSEAL').toUpperCase() || isSaving}
                                                loading={isSaving}
                                                onClick={handleUnsealVault}
                                            >{t('testPilot.unseal_vault')}</M3Button>                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="p-12 max-w-2xl mx-auto space-y-16">
                            
                            {/* SECCIÓN: CUARENTENA */}
                            <div className="animate-in fade-in slide-in-from-bottom-8 duration-1000">
                                <div className="flex items-center justify-between mb-8">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-foreground/10">
                                            <span className="material-symbols-outlined text-foreground !text-[20px]">warning</span>
                                        </div>
                                        <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground">{t('testPilot.quarantine')}</h2>
                                    </div>
                                    <div className="text-[9px] font-black text-foreground/30 uppercase tracking-widest">
                                        {conflicts.length} {t('benchmark.pendings')}
                                    </div>
                                </div>
                                
                                {conflicts.length === 0 ? (
                                    <div className="bg-foreground/[0.02] border border-dashed border-border-base p-12 text-center">
                                        <span className="material-symbols-outlined !text-[32px] text-foreground/10 mb-4">check_circle</span>
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/30">
                                            {t('admin.no_pending') || 'No hay conflictos pendientes.'}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        {conflicts.map((conflict) => (
                                            <div key={conflict.id} className="bg-surface border border-border-base p-8 rounded-none space-y-6 shadow-none hover:border-foreground/20 transition-all duration-500 relative overflow-hidden group">
                                                <div className="absolute top-0 left-0 w-[2px] h-0 bg-foreground group-hover:h-full transition-all duration-700"></div>
                                                
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <h3 className="text-base font-black uppercase tracking-tight leading-none mb-2 text-foreground">{conflict.fieldLabel}</h3>
                                                        <p className="text-[10px] text-foreground/40 uppercase font-black tracking-widest flex items-center gap-2">
                                                            <span className="material-symbols-outlined !text-[12px]">menu_book</span>
                                                            {t('testPilot.source', { file: conflict.sourceReference.file, page: conflict.sourceReference.page })}
                                                        </p>
                                                    </div>
                                                    <span className="text-[9px] bg-foreground text-background px-3 py-1 font-black tracking-[0.1em]">{t('testPilot.conflict')}</span>
                                                </div>

                                                {/* Componente Diff Industrial */}
                                                <div className="py-2">
                                                    <p className="text-[9px] font-black uppercase text-foreground/40 mb-3 tracking-widest">{t('testPilot.comparative_view') || 'Comparativa de Modificaciones'}</p>
                                                    <IndustrialDiffViewer 
                                                        originalText={conflict.originalValue} 
                                                        proposedText={conflict.proposedValue} 
                                                    />
                                                </div>

                                                {/* Timeline Historial */}
                                                {conflict.history.length > 0 && (
                                                    <div className="border-t border-border-base pt-6 mt-4">
                                                        <p className="text-[9px] font-black uppercase text-foreground/40 mb-4 tracking-widest">{t('testPilot.history') || 'Historial de Bóveda'}</p>
                                                        <div className="space-y-3">
                                                            {conflict.history.map((event, idx) => (
                                                                <div key={idx} className="flex items-start gap-3 text-[11px] font-atkinson">
                                                                    <span className={`material-symbols-outlined !text-[14px] ${event.actor === 'ai' ? 'text-blue-500' : 'text-foreground/50'}`}>
                                                                        {event.actor === 'ai' ? 'smart_toy' : 'person'}
                                                                    </span>
                                                                    <div>
                                                                        <span className="text-foreground/40 mr-2">[{new Date(event.timestamp).toLocaleTimeString()}]</span>
                                                                        <span className="text-foreground/80">{event.action}</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Micro-Chat con Voz por Conflicto */}
                                                <div className="pt-6 border-t border-border-base">
                                                    <div className="flex items-center gap-4">
                                                        <div className="flex gap-2 relative">
                                                            <M3IconButton 
                                                                icon={activeListeningId === conflict.id ? 'graphic_eq' : 'mic'}
                                                                onClick={() => startSpeechRecognition(conflict.id)}
                                                                className={activeListeningId === conflict.id ? 'bg-foreground !text-background animate-pulse shadow-none' : 'bg-foreground/5'}
                                                            />
                                                            <M3IconButton 
                                                                icon="auto_fix"
                                                                onClick={() => handleAiAssist(conflict)}
                                                                className="bg-foreground/5 hover:!bg-blue-500/20 hover:!text-blue-500 transition-all"
                                                                title={t('testPilot.ai_assist') || 'Asistencia IA'}
                                                            />
                                                            {activeListeningId === conflict.id && <span className="absolute -top-1 left-8 w-2 h-2 bg-red-500 animate-ping"></span>}
                                                        </div>
                                                        <div className="flex-1">
                                                            <M3TextField 
                                                                label={t('testPilot.notes_dictation')}
                                                                value={conflictNotes[conflict.id] || ''}
                                                                onChange={(val) => setConflictNotes(prev => ({...prev, [conflict.id]: val}))}
                                                                placeholder="..."
                                                                className="my-0"
                                                                autoComplete="off"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex gap-3 justify-end pt-2">
                                                    <M3Button 
                                                        variant="ghost" 
                                                        icon="close" 
                                                        onClick={() => handleResolveConflict(conflict, 'REJECT')} 
                                                        className="text-foreground/20 hover:!text-red-500 transition-colors" 
                                                        disabled={isSaving}
                                                    />

                                                    <M3Button 
                                                        variant="secondary" 
                                                        icon="check" 
                                                        onClick={() => handleResolveConflict(conflict, 'ACCEPT')} 
                                                        disabled={isSaving}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* SECCIÓN: EDITOR DE BÓVEDA (SELLADO) */}
                            <div className="pt-16 border-t border-border-base animate-in fade-in slide-in-from-bottom-12 duration-1000">
                                <div className="flex items-center gap-3 mb-8 opacity-40">
                                    <span className="material-symbols-outlined !text-[18px]">verified_user</span>
                                    <h2 className="text-[10px] font-black uppercase tracking-[0.4em]">{t('testPilot.seal_authority')}</h2>
                                </div>
                                
                                <div className="space-y-8">
                                    <div className={`bg-surface p-10 border border-border-base relative overflow-hidden group transition-all duration-1000 ${conflicts.length > 0 ? 'opacity-40 pointer-events-none' : ''}`}>
                                        <div className={`absolute inset-0 bg-foreground/5 transition-opacity duration-1000 ${isHardConfirmed ? 'opacity-100' : 'opacity-0'}`}></div>
                                        
                                        <div className="relative z-10">
                                            {conflicts.length > 0 && (
                                                <p className="text-[10px] font-black uppercase text-red-500/60 mb-6 tracking-widest text-center">
                                                    {t('testPilot.resolve_pending_first') || 'Resuelva todos los conflictos antes de sellar.'}
                                                </p>
                                            )}
                                            
                                            <M3TextField 
                                                label={t('testPilot.security')}
                                                placeholder={t('testPilot.approved_placeholder')}
                                                value={approvalText}
                                                onChange={setApprovalText}
                                                autoComplete="off"
                                                disabled={conflicts.length > 0}
                                            />

                                            <div className="mt-10">
                                                <M3Button 
                                                    disabled={!isHardConfirmed || isSaving || conflicts.length > 0}
                                                    loading={isSaving}
                                                    variant={isHardConfirmed ? "primary" : "secondary"}
                                                    icon={isHardConfirmed ? "verified" : "shield_lock"}
                                                    className={`w-full !py-8 transition-all duration-700 ${isHardConfirmed && !isSaving ? 'shadow-none' : 'opacity-50'}`}
                                                    onClick={handleSealVault}
                                                >{t('testPilot.seal_authority')}</M3Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>
                    )}
                </section>
            </main>

        </div>
    );
};