import React, { useState } from 'react';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { M3IconButton } from './M3IconButton';
import { M3Button } from './M3Button';
import { M3TextField } from './M3TextField';
import { EdgeSyncQueue } from '../lib/EdgeSyncQueue';

interface ResolvedAsset {
    global_asset_id?: string;
    make_oficial: string;
    model_oficial: string;
    categoria_equipo: string;
    tipo_equipo?: string;
    isNew: boolean;
    requires_clarification?: boolean;
    clarification_message?: string;
}

interface AdminAssetRegistrationProps {
    onSuccess: (globalId: string) => void;
    onCancel: () => void;
}

/**
 * AdminAssetRegistration: Proactive Global Inscription
 * Permite al admin "sembrar" equipos en el catálogo sin asociarlos a un tenant.
 */
export const AdminAssetRegistration: React.FC<AdminAssetRegistrationProps> = ({ onSuccess, onCancel }) => {
    const { t } = useTranslation();
    const [jerga, setJerga] = useState('');
    const [candidates, setCandidates] = useState<ResolvedAsset[]>([]);
    const [isResolving, setIsResolving] = useState(false);
    const [isRegistering, setIsRegistering] = useState(false);

    const handleSearch = async (overrideJerga?: string) => {
        const searchInput = overrideJerga || jerga;
        if (searchInput.trim().length < 2) return;

        setCandidates([]);
        setIsResolving(true);

        try {
            const res = await authFetch(`${API_BASE_URL}/assets/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tipo: 'maquinaria_industrial',
                    marca: '', 
                    modelo: searchInput,
                    isGeneric: false
                })
            });
            const data = await res.json();
            if (Array.isArray(data)) {
                setCandidates(data);
                if (overrideJerga) setJerga(overrideJerga);
            }
        } catch (e) {
            console.error('Error Admin Resolver:', e);
        } finally {
            setIsResolving(false);
        }
    };

    const handleRegister = async (c: ResolvedAsset) => {
        setIsRegistering(true);
        const payload = {
            tipo: 'maquinaria',
            marca: c.make_oficial,
            modelo: c.model_oficial,
            isGeneric: c.make_oficial === 'GENÉRICO'
        };

        try {
            const res = await authFetch(`${API_BASE_URL}/admin/register-global`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (res.ok) {
                setCandidates(prev => prev.map(item =>
                    item.model_oficial === c.model_oficial ? { ...item, isNew: false } : item
                ));
                toast.success(`${c.make_oficial} ${c.model_oficial} → ${t('admin_catalog.registered')}`);
                setTimeout(() => onSuccess(data.global_asset_id), 800);
            } else {
                toast.error(`${t('admin_catalog.error_register')}: ${data.error || ''}`);
            }
        } catch (e) {
            // ── Fallback offline: encolar para sincronización posterior ──
            console.warn('[AdminAssetRegistration] Sin red — encolando en EdgeSyncQueue', e);
            await EdgeSyncQueue.pushTransaction(
                'API', 
                `${API_BASE_URL}/admin/register-global`, 
                payload, 
                'CATALOG_REGISTER'
            );
            toast.warn(t('admin_catalog.queued_offline'));
        } finally {
            setIsRegistering(false);
        }
    };

    return (
        <div className="bg-background max-w-lg w-full border border-border-base flex flex-col font-atkinson overflow-hidden shadow-none relative rounded-none">
            <header className="p-4 flex items-center justify-between bg-surface border-b border-border-base">
                <div className="flex items-center gap-2">
                    <span className="w-1 h-3 bg-foreground"></span>
                    <span className="text-[10px] font-black tracking-[0.2em] text-foreground/50 uppercase">
                        {t('admin_catalog.new_inscription')}
                    </span>
                </div>
                <M3IconButton icon="close" onClick={onCancel} variant="ghost" className="!text-foreground/30 hover:!text-foreground transition-colors" />
            </header>

            <div className="p-6 space-y-6">
                <div className="relative">
                    <M3TextField 
                        label={t('admin_catalog.field_equipment')}
                        value={jerga}
                        onChange={setJerga}
                        placeholder={t('admin_catalog.field_equipment_placeholder')}
                        autoComplete="off"
                    />
                    <M3IconButton
                        icon={isResolving ? "progress_activity" : "search"}
                        onClick={() => handleSearch()}
                        disabled={isResolving || jerga.trim().length < 2}
                        variant="ghost"
                        className={`absolute right-0 bottom-3 !text-foreground ${isResolving ? 'animate-spin' : ''}`}
                    />
                </div>

                {/* ── Variantes del Taxónomo — siempre en lista, usuario elige ── */}
                {candidates.length > 0 && !isResolving && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="flex items-center gap-3">
                            <p className="text-[10px] uppercase tracking-[0.3em] font-black text-foreground/60">
                                {t('admin_catalog.results', { count: candidates.length })}
                            </p>
                            <span className="h-[1px] flex-1 bg-foreground/10"></span>
                            <span className="text-[9px] uppercase tracking-widest font-black text-foreground/20">
                                {t('admin_catalog.select_variant')}
                            </span>
                        </div>
                        <div className="flex flex-col gap-3">
                            {candidates.map((c, idx) => (
                                <M3Button
                                    variant="ghost"
                                    key={`${c.make_oficial}-${c.model_oficial}-${idx}`}
                                    onClick={() => handleRegister(c)}
                                    disabled={isRegistering}
                                    className="h-auto w-full text-left p-5 bg-surface border border-border-base hover:border-foreground transition-all duration-300 flex justify-between items-center group relative overflow-hidden"
                                >
                                    <div className="relative z-10 flex flex-col items-start justify-start text-left w-full">
                                        <h4 className="text-lg font-black uppercase tracking-tight text-foreground group-hover:text-foreground transition-colors">
                                            {c.make_oficial} {c.model_oficial}
                                        </h4>
                                        <p className="text-[10px] text-foreground/30 uppercase font-black tracking-widest mt-1">
                                            {c.tipo_equipo || c.categoria_equipo}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3 relative z-10">
                                        {!c.isNew ? (
                                            <span className="text-[10px] bg-foreground/10 text-foreground border border-foreground/20 px-2 py-1 font-black tracking-widest">
                                                {t('admin_catalog.exists')}
                                            </span>
                                        ) : (
                                            <span className="text-[10px] bg-foreground/10 text-foreground border border-foreground/20 px-2 py-1 font-black tracking-widest">
                                                {t('admin_catalog.new')}
                                            </span>
                                        )}
                                        <span className="material-symbols-outlined text-foreground/10 group-hover:text-foreground transition-colors !text-[20px]">
                                            {isRegistering ? 'progress_activity' : 'add_circle'}
                                        </span>
                                    </div>
                                </M3Button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <footer className="p-4 bg-surface border-t border-border-base text-center">
                <p className="text-[10px] text-foreground/10 uppercase tracking-[0.4em] font-black">
                    {t('admin_catalog.global_node')}
                </p>
            </footer>
        </div>
    );
};
