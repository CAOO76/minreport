import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { M3TextField } from './M3TextField';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { API_BASE_URL, db } from '../firebase/config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { authFetch } from '../utils/authFetch';

interface ResolvedAsset {
    global_asset_id?: string;
    make_oficial: string;
    model_oficial: string;
    categoria_equipo: string;
    tipo_equipo?: string;
    ambiente_operativo?: string[];
    contexto_operativo?: string[];
    chassis_versions?: string[];
    official_url?: string;
    isNew: boolean;
    requires_clarification?: boolean;
    clarification_message?: string;
    suggested_fields?: string[];
    is_pertinent?: boolean;
    rejection_reason?: string;
    caracteristicas_principales?: string[];
}

interface AssetRegistrationProps {
    onSuccess: (catalogId: string) => void;
    onCancel: () => void;
    isGlobalOnly?: boolean;
}

export const AssetRegistration: React.FC<AssetRegistrationProps> = ({ onSuccess, onCancel, isGlobalOnly }) => {
    const { t } = useTranslation();
    const { userId } = useCurrentUser();

    const [mode, setMode] = useState<'select' | 'generic' | 'brand'>('select');
    const [jerga, setJerga] = useState('');
    const [candidates, setCandidates] = useState<ResolvedAsset[]>([]);
    const [isResolving, setIsResolving] = useState(false);
    const [isRegistering, setIsRegistering] = useState(false);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [selectedCandidate, setSelectedCandidate] = useState<ResolvedAsset | null>(null);
    const [confirmText, setConfirmText] = useState('');
    const [showConfirmInput, setShowConfirmInput] = useState(false);
    const [selectedVersion, setSelectedVersion] = useState<string>('ESTÁNDAR');

    const abortRef = useRef<AbortController | null>(null);

    const handleSearch = async (overrideJerga?: string) => {
        const searchInput = overrideJerga || jerga;
        if (searchInput.trim().length < 2) return;

        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setCandidates([]);
        setIsResolving(true);

        try {
            const res = await authFetch(`${API_BASE_URL}/assets/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    tipo: mode === 'generic' ? 'GENÉRICO' : 'maquinaria',
                    marca: '',
                    modelo: searchInput,
                    isGeneric: mode === 'generic'
                })
            });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    setCandidates(data);
                    if (overrideJerga) setJerga(overrideJerga);
                    return;
                }
            }
        } catch (_e: unknown) {
            console.warn('[AssetRegistration] Endpoint AI resolve no disponible, generando candidato técnico');
        } finally {
            if (!controller.signal.aborted) setIsResolving(false);
        }

        // Candidato directo para registro manual cuando el backend está offline
        const cleanJerga = searchInput.trim().toUpperCase();
        const parts = cleanJerga.split(' ');
        const makeCandidate = parts.length > 1 ? parts[0] : (mode === 'generic' ? 'GENÉRICO' : 'EQUIPO');
        const modelCandidate = parts.length > 1 ? parts.slice(1).join(' ') : cleanJerga;
        setCandidates([{
            make_oficial: makeCandidate,
            model_oficial: modelCandidate,
            categoria_equipo: mode === 'generic' ? 'GENÉRICO' : 'MAQUINARIA_PESADA',
            tipo_equipo: 'EQUIPO_OPERATIVO',
            ambiente_operativo: ['SUPERFICIE', 'SUBTERRÁNEO'],
            contexto_operativo: ['PRODUCCIÓN_CONTINUA'],
            caracteristicas_principales: ['EQUIPO REGISTRADO EN FAENA'],
            isNew: true
        }]);
    };

    const handleRegisterCatalog = async (c: ResolvedAsset) => {
        setIsRegistering(true);
        setErrorMsg(null);
        const payload = {
            global_asset_id: c.global_asset_id,
            make_oficial: c.make_oficial || 'GENÉRICO',
            model_oficial: c.model_oficial || jerga,
            categoria_equipo: c.categoria_equipo,
            tipo_equipo: c.tipo_equipo || '',
            ambiente_operativo: c.ambiente_operativo || [],
            contexto_operativo: c.contexto_operativo || [],
            caracteristicas_principales: c.caracteristicas_principales || [],
            version: selectedVersion,
            official_url: c.official_url || '',
            original_jargon: jerga,
            userId: userId || 'anonymous',
            isGlobalOnly
        };

        // 1. Intento por backend si está disponible
        try {
            const res = await authFetch(`${API_BASE_URL}/assets/add-tenant-catalog`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            let data: Record<string, unknown> = {};
            try { data = await res.json(); } catch (_) { /* empty body */ }

            if (res.ok) {
                onSuccess((isGlobalOnly ? data.global_asset_id : (data.tenant_asset_id || data.global_asset_id)) as string);
                return;
            }
        } catch (_networkErr) {
            console.warn('[AssetRegistration] Endpoint offline, persistiendo directamente en Firestore');
        }

        // 2. Persistencia directa en Firestore (Capa 5 nativa)
        try {
            const make = (c.make_oficial || 'GENÉRICO').toUpperCase();
            const model = (c.model_oficial || jerga).toUpperCase();
            const docRef = await addDoc(collection(db, 'global_asset_catalog'), {
                make_oficial: make,
                model_oficial: model,
                make_model: `${make} ${model}`,
                categoria_equipo: c.categoria_equipo || 'MAQUINARIA',
                tipo_equipo: c.tipo_equipo || 'EQUIPO_PESADO',
                ambiente_operativo: c.ambiente_operativo || ['SUPERFICIE'],
                contexto_operativo: c.contexto_operativo || ['FAENA'],
                caracteristicas_principales: c.caracteristicas_principales || [],
                version: selectedVersion || 'ESTÁNDAR',
                official_url: c.official_url || '',
                original_jargon: jerga,
                createdBy: userId || 'operador',
                createdAt: serverTimestamp(),
            });
            onSuccess(docRef.id);
            return;
        } catch (dbErr: any) {
            console.error('[AssetRegistration] Error al guardar en Firestore:', dbErr);
            setErrorMsg(`Error al registrar en base de datos: ${dbErr?.message || 'Error de conexión'}`);
        } finally {
            setIsRegistering(false);
        }
    };
    const handleClose = () => {
        if (mode === 'select' || (jerga.trim().length === 0 && candidates.length === 0)) {
            onCancel();
        } else {
            setShowCancelConfirm(true);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-xs p-4">
            <div className="bg-surface border border-border-base w-full max-w-md flex flex-col font-atkinson overflow-hidden shadow-2xl relative rounded-none animate-in zoom-in-95 duration-200">
                
                {/* Header */}
                <header className="px-6 py-4 flex items-center justify-between border-b border-border-base bg-surface/80 relative">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-copper !text-[20px]">terminal</span>
                        <span className="text-[11px] font-black tracking-[0.2em] text-foreground uppercase">
                            {mode === 'select' 
                                ? t('common.new_catalog', 'NUEVO CATÁLOGO') 
                                : mode === 'generic' 
                                    ? t('registration.generic', 'GENÉRICO') 
                                    : t('registration.by_brand', 'POR MARCA')}
                        </span>
                    </div>
                    <button onClick={handleClose} className="text-muted hover:text-foreground transition-colors cursor-pointer p-1">
                        <span className="material-symbols-outlined !text-[20px]">close</span>
                    </button>
                </header>

                {/* Main Content */}
                <div className="flex-1">
                    {mode === 'select' && (
                        <div className="p-6 flex flex-col gap-6 items-center justify-center min-h-[200px] animate-in fade-in zoom-in-95 duration-300">
                            <div className="grid grid-cols-2 gap-4 w-full">
                                <button 
                                    onClick={() => setMode('brand')}
                                    className="group p-6 bg-surface border border-border-base hover:border-copper/40 transition-all flex flex-col items-center justify-center text-center gap-3 rounded-none relative"
                                >
                                    <span className="material-symbols-outlined !text-3xl text-muted group-hover:text-copper transition-all">precision_manufacturing</span>
                                    <div className="space-y-1">
                                        <span className="block text-[11px] font-black text-foreground uppercase tracking-widest">{t('registration.by_brand', 'POR MARCA')}</span>
                                        <p className="text-[8px] text-muted uppercase tracking-wider leading-tight">{t('registration.by_brand_desc', 'Con fabricante')}</p>
                                    </div>
                                </button>

                                <button 
                                    onClick={() => setMode('generic')}
                                    className="group p-6 bg-surface border border-border-base hover:border-copper/40 transition-all flex flex-col items-center justify-center text-center gap-3 rounded-none relative"
                                >
                                    <span className="material-symbols-outlined !text-3xl text-muted group-hover:text-copper transition-all">category</span>
                                    <div className="space-y-1">
                                        <span className="block text-[11px] font-black text-foreground uppercase tracking-widest">{t('registration.generic', 'GENÉRICO')}</span>
                                        <p className="text-[8px] text-muted uppercase tracking-wider leading-tight">{t('registration.generic_desc', 'Herramientas')}</p>
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}

                    {(mode === 'generic' || mode === 'brand') && (
                        <div className="p-6 flex flex-col gap-4 animate-in slide-in-from-right-4 duration-300">
                            <form 
                                onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
                                className="relative group w-full"
                            >
                                <M3TextField 
                                    label={mode === 'generic' ? t('registration.generic_input_label') : t('registration.jargon_input_label')}
                                    value={jerga}
                                    onChange={setJerga}
                                    placeholder={mode === 'generic' ? t('registration.generic_input_placeholder') : t('registration.jargon_input_placeholder')}
                                    className="bg-surface border-border-base !my-0"
                                    autoComplete="off"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center">
                                    {isResolving ? (
                                        <span className="material-symbols-outlined animate-spin text-copper !text-[20px]">progress_activity</span>
                                    ) : (
                                        <button 
                                            type="submit"
                                            disabled={jerga.trim().length < 3} 
                                            className="text-copper disabled:text-muted hover:opacity-80 transition-opacity p-1 cursor-pointer"
                                        >
                                            <span className="material-symbols-outlined !text-[22px]">arrow_forward</span>
                                        </button>
                                    )}
                                </div>
                            </form>

                            {/* Banner de error */}
                            {errorMsg && (
                                <div className="flex items-start gap-3 p-3 bg-red-500/5 border border-red-500/20 animate-in slide-in-from-top-2">
                                    <span className="material-symbols-outlined text-red-500 !text-[18px] shrink-0 mt-0.5">error</span>
                                    <div className="flex-1 min-w-0">
                                        <span className="block text-[8px] font-black text-red-500 uppercase tracking-wider mb-0.5">ERROR</span>
                                        <p className="text-[10px] font-bold text-red-400 uppercase leading-relaxed truncate">{errorMsg}</p>
                                    </div>
                                    <button onClick={() => setErrorMsg(null)} className="text-muted hover:text-red-500 transition-colors p-0.5">
                                        <span className="material-symbols-outlined !text-[14px]">close</span>
                                    </button>
                                </div>
                            )}

                            {/* Cargador en línea */}
                            {isResolving && (
                                <div className="py-6 flex flex-col items-center justify-center gap-2 opacity-60">
                                    <span className="material-symbols-outlined animate-spin text-copper !text-[24px]">progress_activity</span>
                                    <span className="text-[9px] font-black uppercase tracking-widest text-foreground">{t('registration.analyzing', 'Analizando...')}</span>
                                </div>
                            )}

                            {/* Resultados */}
                            {candidates.length > 0 && !isResolving && (
                                <div className="space-y-3 animate-in fade-in duration-300">
                                    {candidates[0].is_pertinent === false ? (
                                        <div className="p-4 border border-red-500/20 bg-red-500/5 flex items-start gap-3">
                                            <span className="material-symbols-outlined text-red-500 !text-2xl shrink-0">security_update_warning</span>
                                            <div className="space-y-1">
                                                <span className="block text-[9px] font-black uppercase text-red-500 tracking-wider">RECHAZO DE SEGURIDAD</span>
                                                <p className="text-[11px] text-red-400 font-bold uppercase leading-relaxed">{candidates[0].rejection_reason}</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between border-b border-border-base pb-1">
                                                <span className="text-[9px] font-black text-muted uppercase tracking-wider">{t('admin_catalog.tab_candidates', 'CANDIDATOS')}</span>
                                                <span className="text-[9px] font-bold text-copper uppercase tracking-wider">{candidates.length} COINCIDENCIAS</span>
                                            </div>
                                            <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto custom-scrollbar relative">
                                                {isRegistering && (
                                                    <div className="absolute inset-0 z-20 bg-surface/90 flex flex-col items-center justify-center gap-2 backdrop-blur-xs animate-in fade-in">
                                                        <span className="material-symbols-outlined animate-spin text-copper !text-[24px]">progress_activity</span>
                                                        <span className="text-[9px] font-black tracking-widest text-copper uppercase">INDEXANDO PERFIL...</span>
                                                    </div>
                                                )}
                                                {candidates.map((c, idx) => (
                                                    <div 
                                                        key={idx} 
                                                        className={`group w-full flex flex-col p-3 bg-surface border border-border-base hover:border-copper/40 transition-all cursor-pointer relative overflow-hidden shrink-0 ${isRegistering ? 'opacity-20' : ''}`}
                                                        onClick={() => {
                                                            setSelectedCandidate(c);
                                                            setConfirmText('');
                                                            setShowConfirmInput(false);
                                                            setSelectedVersion(c.chassis_versions && c.chassis_versions.length > 0 ? c.chassis_versions[0] : 'ESTÁNDAR');
                                                        }}
                                                    >
                                                        <div className="absolute top-0 left-0 w-0.5 h-0 group-hover:h-full bg-copper transition-all duration-300" />
                                                        
                                                        {/* Header row: make + badges + action */}
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center gap-1.5 mb-0.5">
                                                                    <span className="text-[9px] font-black text-copper uppercase tracking-wider">{c.make_oficial}</span>
                                                                    {c.isNew && <span className="text-[8px] font-black px-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 uppercase tracking-widest">NUEVO</span>}
                                                                    {!c.isNew && <span className="text-[8px] font-black px-1 bg-green-500/10 text-green-500 border border-green-500/20 uppercase tracking-widest">EN CATÁLOGO</span>}
                                                                </div>
                                                                {/* Model name — main identifier */}
                                                                <h4 className="text-[16px] font-black uppercase tracking-tight text-foreground group-hover:text-copper transition-colors leading-tight">
                                                                    {c.model_oficial}
                                                                </h4>
                                                                {/* tipo_equipo — what it IS */}
                                                                {c.tipo_equipo && (
                                                                    <p className="text-[10px] font-bold text-foreground/70 uppercase tracking-wide mt-0.5">
                                                                        {c.tipo_equipo}
                                                                    </p>
                                                                )}
                                                                {c.caracteristicas_principales && c.caracteristicas_principales.length > 0 && (
                                                                    <p className="text-[9px] font-semibold text-foreground/50 uppercase tracking-wide mt-1 leading-relaxed">
                                                                        {c.caracteristicas_principales.join(' · ')}
                                                                    </p>
                                                                )}
                                                                {/* categoria_equipo — family */}
                                                                {c.categoria_equipo && c.categoria_equipo !== c.make_oficial && (
                                                                    <p className="text-[8px] font-bold text-muted uppercase tracking-wider mt-0.5 opacity-60">
                                                                        {c.categoria_equipo}
                                                                    </p>
                                                                )}
                                                            </div>
                                                            <span className="material-symbols-outlined text-muted group-hover:text-copper transition-colors !text-[20px] shrink-0 mt-1">
                                                                {c.isNew ? 'add_box' : 'verified'}
                                                            </span>
                                                        </div>

                                                        {/* Contexto chips */}
                                                        {c.contexto_operativo && c.contexto_operativo.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-border-base/40">
                                                                {c.contexto_operativo.slice(0, 3).map((ctx, i) => (
                                                                    <span key={i} className="text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-copper/5 text-copper/70 border border-copper/10">
                                                                        {ctx.length > 30 ? ctx.substring(0, 28) + '…' : ctx}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}

                                            </div>
                                        </div>
                                    )}
                                </div>
                             )}
                        </div>
                    )}
                </div>

                {/* Footer Brand Logo */}
                <footer className="px-6 py-4 border-t border-border-base bg-surface/40 flex items-center justify-center">
                    <span className="text-[9px] font-black tracking-[0.4em] text-foreground/20 dark:text-foreground/10 uppercase">OPERMAQ</span>
                </footer>

                {/* Simple Cancel Alert overlay within the card context */}
                {showCancelConfirm && (
                    <div className="absolute inset-0 z-50 bg-surface/98 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
                        <div className="space-y-6 max-w-xs">
                            <div className="space-y-2">
                                <span className="material-symbols-outlined text-copper !text-[40px]">warning</span>
                                <p className="text-[12px] font-black uppercase tracking-widest text-foreground">{t('registration.cancel_title', '¿CANCELAR REGISTRO?')}</p>
                                <p className="text-[10px] text-muted uppercase tracking-wider leading-relaxed">{t('registration.cancel_desc', 'SE PERDERÁ EL PROGRESO ACTUAL DE INDEXACIÓN.')}</p>
                            </div>
                            <div className="flex gap-3 justify-center">
                                <button
                                    onClick={onCancel}
                                    className="px-4 py-2 border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer"
                                >
                                    {t('registration.yes_cancel', 'SÍ, CANCELAR')}
                                </button>
                                <button
                                    onClick={() => setShowCancelConfirm(false)}
                                    className="px-4 py-2 border border-border-base bg-surface text-foreground hover:border-copper hover:text-copper text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer"
                                >
                                    {t('registration.no_continue', 'NO, CONTINUAR')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Confirm Registration Overlay */}
                {selectedCandidate && (
                    <div className="absolute inset-0 z-50 bg-surface/98 flex flex-col justify-between p-6 animate-in fade-in duration-200">
                        {/* Header of confirmation */}
                        <div className="flex items-center gap-2 border-b border-border-base pb-3">
                            <span className="material-symbols-outlined text-copper !text-[20px]">
                                {showConfirmInput ? 'security' : 'verified_user'}
                            </span>
                            <span className="text-[11px] font-black tracking-[0.2em] text-foreground uppercase">
                                {showConfirmInput 
                                    ? t('registration.validation_step', 'VERIFICACIÓN DE SEGURIDAD') 
                                    : t('registration.confirm_title', 'CONFIRMAR DETALLES DEL EQUIPO')}
                            </span>
                        </div>

                        {/* Content Scrollable */}
                        <div className="flex-1 my-4 overflow-y-auto custom-scrollbar pr-1">
                            {!showConfirmInput ? (
                                <div className="space-y-4">
                                    {/* Cabecera Principal del Candidato */}
                                    <div className="p-4 border border-border-base bg-surface/50 relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-copper" />
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-[9px] font-black text-copper uppercase tracking-wider">
                                                {selectedCandidate.make_oficial}
                                            </span>
                                            {selectedCandidate.isNew && (
                                                <span className="text-[8px] font-black px-1.5 py-0.5 bg-blue-500/10 text-blue-500 border border-blue-500/20 uppercase tracking-widest">
                                                    NUEVO CATÁLOGO
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="text-[16px] font-black uppercase tracking-tight text-foreground leading-tight mb-1">
                                            {selectedCandidate.model_oficial}
                                        </h3>
                                        <p className="text-[10px] font-bold text-muted uppercase tracking-wider">
                                            {selectedCandidate.tipo_equipo || selectedCandidate.categoria_equipo}
                                        </p>
                                    </div>

                                    {/* Perfil Técnico Completo */}
                                    <div className="space-y-3">
                                        {/* Características Principales */}
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-black text-muted uppercase tracking-widest">CARACTERÍSTICAS PRINCIPALES</span>
                                            {selectedCandidate.caracteristicas_principales && selectedCandidate.caracteristicas_principales.length > 0 ? (
                                                <ul className="space-y-1.5 p-2 bg-surface/30 border border-border-base/50">
                                                    {selectedCandidate.caracteristicas_principales.map((char, i) => (
                                                        <li key={i} className="text-[10px] font-bold text-foreground uppercase flex items-start gap-1.5 leading-relaxed">
                                                            <span className="text-copper shrink-0 select-none">•</span>
                                                            <span>{char}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-[10px] text-muted italic p-2 bg-surface/30 border border-border-base/50 uppercase">NO ESPECIFICADAS</p>
                                            )}
                                        </div>

                                        {/* Denominación OEM */}
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-black text-muted uppercase tracking-widest">DENOMINACIÓN TÉCNICA OEM</span>
                                            <p className="text-[11px] font-bold text-foreground uppercase bg-surface/30 p-2 border border-border-base/50">
                                                {selectedCandidate.tipo_equipo || 'NO ESPECIFICADA'}
                                            </p>
                                        </div>

                                        {/* Versión / Diferenciador */}
                                        {selectedCandidate.chassis_versions && selectedCandidate.chassis_versions.length > 0 && (
                                            <div className="space-y-1">
                                                <span className="text-[9px] font-black text-muted uppercase tracking-widest">VERSIÓN / CONFIGURACIÓN DE DISEÑO</span>
                                                <div className="flex flex-wrap gap-1.5 mt-1">
                                                    {selectedCandidate.chassis_versions.map((ver) => (
                                                        <button
                                                            key={ver}
                                                            type="button"
                                                            onClick={() => setSelectedVersion(ver)}
                                                            className={`px-3 py-1.5 border text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                                                                selectedVersion === ver
                                                                    ? 'border-copper bg-copper/10 text-copper font-black'
                                                                    : 'border-border-base bg-surface text-foreground hover:border-copper/40'
                                                            }`}
                                                        >
                                                            {ver}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Ambiente Operativo */}
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-black text-muted uppercase tracking-widest">AMBIENTE Y TERRENO DE OPERACIÓN</span>
                                            {selectedCandidate.ambiente_operativo && selectedCandidate.ambiente_operativo.length > 0 ? (
                                                <ul className="space-y-1.5 p-2 bg-surface/30 border border-border-base/50">
                                                    {selectedCandidate.ambiente_operativo.map((env, i) => (
                                                        <li key={i} className="text-[10px] font-bold text-foreground uppercase flex items-start gap-1.5 leading-relaxed">
                                                            <span className="text-copper shrink-0 select-none">•</span>
                                                            <span>{env}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-[10px] text-muted italic p-2 bg-surface/30 border border-border-base/50 uppercase">CONDICIONES DE DISEÑO ESTÁNDAR</p>
                                            )}
                                        </div>

                                        {/* Contexto Operativo */}
                                        <div className="space-y-1">
                                            <span className="text-[9px] font-black text-muted uppercase tracking-widest">CONTEXTO Y TRABAJO DISEÑADO</span>
                                            {selectedCandidate.contexto_operativo && selectedCandidate.contexto_operativo.length > 0 ? (
                                                <ul className="space-y-1.5 p-2 bg-surface/30 border border-border-base/50">
                                                    {selectedCandidate.contexto_operativo.map((ctx, i) => (
                                                        <li key={i} className="text-[10px] font-bold text-foreground uppercase flex items-start gap-1.5 leading-relaxed">
                                                            <span className="text-copper shrink-0 select-none">•</span>
                                                            <span>{ctx}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-[10px] text-muted italic p-2 bg-surface/30 border border-border-base/50 uppercase">USO INDUSTRIAL GENERAL</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4 flex flex-col justify-center min-h-[180px] text-center">
                                    <div className="space-y-2 max-w-xs mx-auto">
                                        <span className="material-symbols-outlined text-copper !text-[44px] animate-pulse">lock_open</span>
                                        <p className="text-[12px] font-black uppercase tracking-widest text-foreground">
                                            ¿CONFIRMAR ESCALA Y PERFIL?
                                        </p>
                                        <p className="text-[10px] text-muted uppercase tracking-wider leading-relaxed">
                                            Para autorizar la indexación técnica de <strong className="text-foreground">{selectedCandidate.make_oficial} {selectedCandidate.model_oficial}</strong> en la base de datos maestro, por favor escriba la palabra clave a continuación:
                                        </p>
                                    </div>

                                    <div className="w-full max-w-xs mx-auto pt-2">
                                        <M3TextField
                                            label=""
                                            value={confirmText}
                                            onChange={setConfirmText}
                                            placeholder="Escriba registrar..."
                                            className="bg-surface border-border-base text-center !my-0"
                                            autoComplete="off"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Buttons Footer inside overlay */}
                        <div className="border-t border-border-base pt-4">
                            {!showConfirmInput ? (
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { setSelectedCandidate(null); setConfirmText(""); }}
                                        className="flex-1 px-4 py-2.5 border border-border-base bg-surface text-foreground hover:border-copper hover:text-copper text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
                                    >
                                        {t('common.cancel', 'CANCELAR')}
                                    </button>
                                    <button
                                        onClick={() => setShowConfirmInput(true)}
                                        className="flex-1 px-4 py-2.5 border border-copper bg-copper/10 text-copper hover:bg-copper/20 text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
                                    >
                                        {t('common.confirm', 'CONFIRMAR')}
                                    </button>
                                </div>
                            ) : (
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { setShowConfirmInput(false); setConfirmText(""); }}
                                        className="flex-1 px-4 py-2.5 border border-border-base bg-surface text-foreground hover:border-copper hover:text-copper text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
                                    >
                                        {t('common.back', 'VOLVER')}
                                    </button>
                                    <button
                                        onClick={async () => {
                                            if (confirmText.toLowerCase() === 'registrar') {
                                                const candidate = selectedCandidate;
                                                setSelectedCandidate(null);
                                                setConfirmText("");
                                                setShowConfirmInput(false);
                                                await handleRegisterCatalog(candidate);
                                            }
                                        }}
                                        disabled={confirmText.toLowerCase() !== 'registrar'}
                                        className="flex-1 px-4 py-2.5 border border-copper bg-copper/10 text-copper hover:bg-copper/20 disabled:border-border-base disabled:bg-surface/50 disabled:text-muted text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
                                    >
                                        {t('common.register_action', 'REGISTRAR')}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
