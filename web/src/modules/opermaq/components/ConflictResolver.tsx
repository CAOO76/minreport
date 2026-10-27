import React, { useState } from 'react';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import { agentConfig } from './AgentBadgeConfig';
import { M3IconButton } from './M3IconButton';

export interface ConflictProposal {
    proposal_id: string;
    componente: unknown;
    valor_actual: unknown;
    valor_nuevo: unknown;
    zona?: string;
    estado_fusion: 'NUEVO' | 'CONFLICTO' | 'ELIMINAR';
    detected_at: string;
}

interface ConflictResolverProps {
    globalAssetId: string;
    activeTab: string;
    targetIndex: string;
    conflicts: ConflictProposal[];
    authorizedCount: number;
    onResolved: () => void;
    onRegenerate: () => void;
    isRegenerating: boolean;
}

const ConflictResolver: React.FC<ConflictResolverProps> = ({
    globalAssetId,
    activeTab,
    targetIndex,
    conflicts,
    authorizedCount,
    onResolved,
    onRegenerate,
    isRegenerating
}) => {
    const [loading, setLoading] = useState<string | null>(null);

    const normalizedId = (activeTab || '').toLowerCase().replace('_', '');
    const agentInfo = agentConfig[normalizedId] || agentConfig.default;
    const buttonColor = agentInfo.buttonColor;
    const safeStr = (v: unknown): string => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'string') return v;
        return JSON.stringify(v, null, 2);
    };

    const handleResolve = async (proposal: ConflictProposal, action: 'ACCEPT' | 'REJECT') => {
        setLoading(`${proposal.proposal_id}-${action}`);
        try {
            const response = await authFetch(`${API_BASE_URL}/vault/resolve-conflict`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalAssetId,
                    activeTab,
                    targetIndex,
                    action,
                    proposal
                })
            });

            if (response.ok) {
                onResolved();
            } else {
                console.error('Error resolving conflict');
            }
        } catch (error) {
            console.error('Network error resolving conflict:', error);
        } finally {
            setLoading(null);
        }
    };

    const proposalStyle = {
        NUEVO: {
            border: 'border-emerald-500/30',
            bg: 'bg-emerald-500/5',
            badge: 'text-emerald-600 bg-emerald-500/10',
            icon: 'add_circle',
            label: 'NUEVO',
        },
        CONFLICTO: {
            border: 'border-amber-500/30',
            bg: 'bg-amber-500/5',
            badge: 'text-amber-600 bg-amber-500/10',
            icon: 'change_circle',
            label: 'CONFLICTO',
        },
        ELIMINAR: {
            border: 'border-red-500/40',
            bg: 'bg-red-500/5',
            badge: 'text-red-600 bg-red-500/10',
            icon: 'remove_circle',
            label: 'ELIMINAR',
        },
    } as const;

    if (conflicts.length === 0 && authorizedCount === 0) return null;

    return (
        <div className="mt-4 border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-4 rounded-none animate-in fade-in slide-in-from-top-2">
            
            {/* ACCIÓN DE CIERRE: REGENERACIÓN */}
            {authorizedCount > 0 && (
                <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-none flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-emerald-600 !text-lg">verified</span>
                        <span className="text-xl font-black text-emerald-600">{authorizedCount}</span>
                    </div>
                    <M3IconButton 
                        icon={isRegenerating ? "progress_activity" : agentInfo.icon} 
                        onClick={onRegenerate}
                        disabled={isRegenerating}
                        variant="primary"
                        className={isRegenerating ? "animate-spin" : buttonColor}
                    />
                </div>
            )}

            {conflicts.length > 0 && (
                <>
                    <div className="flex items-center gap-3 mb-4">
                        <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 !text-[18px]">rule</span>
                        <span className="text-xs font-black text-amber-600">{conflicts.length}</span>
                    </div>

                    <div className="space-y-4">
                        {conflicts.map((proposal, idx) => {
                            const style = proposalStyle[proposal.estado_fusion] || proposalStyle.CONFLICTO;
                            return (
                                <div key={idx} className={`border ${style.border} ${style.bg} p-3 space-y-3 shadow-none rounded-none`}>
                                    <div className="flex justify-between items-start">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 ${style.badge}`}>
                                                    {style.label}
                                                </span>
                                                <span className="text-[10px] font-bold text-black/40 uppercase tracking-widest">
                                                    {proposal.zona || 'GENERAL'}
                                                </span>
                                            </div>
                                            <span className="text-[11px] font-black text-black dark:text-white uppercase tracking-tight">
                                                {safeStr(proposal.componente)}
                                            </span>
                                        </div>
                                        <span className={`material-symbols-outlined !text-[18px] ${
                                            proposal.estado_fusion === 'NUEVO' ? 'text-emerald-500' :
                                            proposal.estado_fusion === 'ELIMINAR' ? 'text-red-500' :
                                            'text-amber-500'
                                        }`}>
                                            {style.icon}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 py-2 border-y border-black/5 dark:border-white/5">
                                        <div className="space-y-1">
                                            <span className="material-symbols-outlined text-black/20 !text-[12px]">history</span>
                                            <div className="text-[10px] leading-relaxed text-black/40 break-words line-clamp-3">
                                                {safeStr(proposal.valor_actual) || "---"}
                                            </div>
                                        </div>
                                        <div className="space-y-1 border-l border-black/5 dark:border-white/5 pl-3">
                                            <span className={`material-symbols-outlined !text-[12px] ${
                                                proposal.estado_fusion === 'ELIMINAR' ? 'text-red-500' : 'text-amber-600'
                                            }`}>
                                                {proposal.estado_fusion === 'ELIMINAR' ? 'delete_forever' : 'auto_fix_high'}
                                            </span>
                                            <div className="text-[10px] font-bold leading-relaxed text-black dark:text-white break-words line-clamp-3">
                                                {proposal.estado_fusion === 'ELIMINAR' 
                                                    ? 'Propuesta de eliminación por incoherencia técnica' 
                                                    : safeStr(proposal.valor_nuevo)}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex gap-2 pt-1">
                                        <M3IconButton 
                                            icon={loading === `${proposal.proposal_id}-REJECT` ? "progress_activity" : "close"}
                                            onClick={() => handleResolve(proposal, 'REJECT')}
                                            disabled={!!loading}
                                            className={loading === `${proposal.proposal_id}-REJECT` ? "animate-spin" : ""}
                                            variant="secondary"
                                        />
                                        <M3IconButton 
                                            icon={loading === `${proposal.proposal_id}-ACCEPT` ? "progress_activity" : "check_circle"}
                                            onClick={() => handleResolve(proposal, 'ACCEPT')}
                                            disabled={!!loading}
                                            className={loading === `${proposal.proposal_id}-ACCEPT` ? "animate-spin" : "flex-1 !w-auto"}
                                            variant="primary"
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
};

export default ConflictResolver;

