import React, { useState } from 'react';
import type { AccountReference } from '../../types/user_directory';
import clsx from 'clsx';
import { ShieldCheck, ArrowRight } from 'lucide-react';

interface AccountSelectorProps {
    accounts: AccountReference[];
    onSelectAccount: (account: AccountReference) => void;
    onCancel: () => void;
    loading?: boolean;
}

/**
 * Selector de Cuentas - Arquitectura "Pasillo de Puertas Blindadas"
 * 
 * Muestra las cuentas disponibles para un RUN y permite seleccionar
 * la cuenta específica para autenticación.
 * 
 * Diseño: STITCH ELITE INDUSTRIAL
 */
const AccountSelector: React.FC<AccountSelectorProps> = ({
    accounts,
    onSelectAccount,
    onCancel,
    loading = false
}) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const handleSelect = (account: AccountReference) => {
        setSelectedId(account.accountId);
        onSelectAccount(account);
    };

    const renderIcon = (type: string) => {
        switch (type.toUpperCase()) {
            case 'BUSINESS':
            case 'ENTERPRISE':
                return 'business';
            case 'EDUCATIONAL':
                return 'school';
            case 'PERSONAL':
                return 'person';
            default:
                return 'account_circle';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status.toUpperCase()) {
            case 'PENDING_APPROVAL': return 'EN REVISIÓN';
            case 'APPROVED': return 'APROBADO';
            case 'ACTIVE': return 'ACTIVO';
            case 'REJECTED': return 'RECHAZADO';
            case 'SUSPENDED': return 'SUSPENDIDO';
            default: return status;
        }
    };

    return (
        <div className="animate-in fade-in slide-in-from-right-12 duration-1000 w-full relative z-10">
            <div className="text-center mb-10">
                <p className="hud-label text-black/40 dark:text-white/40 mb-2">
                    [DETECTED_IDENTITY_NODES]
                </p>
                <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight leading-none mb-1">
                    Cuentas Asociadas
                </h2>
                <p className="text-[9px] font-mono text-black/20 dark:text-white/20 uppercase tracking-[0.3em]">
                    SECURITY_ISOLATION_ZONE: {accounts?.length || 0} PERFILES
                </p>
            </div>

            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {accounts?.map((account) => (
                    <button
                        key={account.accountId}
                        onClick={() => handleSelect(account)}
                        disabled={loading}
                        className={clsx(
                            "group relative flex items-center p-6 rounded-none border transition-all duration-500 text-left w-full disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden",
                            selectedId === account.accountId
                                ? "bg-antigravity-accent/5 border-antigravity-accent shadow-lg"
                                : "bg-white/5 dark:bg-black/20 border-black/5 dark:border-white/5 hover:bg-white/10 dark:hover:bg-white/5 hover:border-black/20 dark:hover:border-white/20 shadow-sm"
                        )}
                    >
                        {/* Grid de fondo decorativo selectivo */}
                        <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none"></div>

                        {/* Avatar o Icono */}
                        <div className={clsx(
                            "w-12 h-12 rounded-none flex items-center justify-center mr-6 transition-all duration-500 overflow-hidden shadow-2xl relative",
                            selectedId === account.accountId ? "bg-antigravity-accent text-white" : "bg-black/5 dark:bg-white/10 text-black/40 dark:text-white/40"
                        )}>
                            <div className="absolute inset-0 technical-grid opacity-20"></div>
                            {account.avatar ? (
                                <img
                                    src={account.avatar}
                                    alt={account.accountName}
                                    className="w-full h-full object-cover relative z-10"
                                />
                            ) : (
                                <span className="material-symbols-rounded text-[28px] relative z-10">
                                    {renderIcon(account.type)}
                                </span>
                            )}
                        </div>

                        {/* Info Cuenta */}
                        <div className="flex-1 space-y-1.5 relative z-10">
                            <h3 className={clsx(
                                "text-sm font-black uppercase tracking-tight transition-colors duration-500",
                                selectedId === account.accountId ? "text-antigravity-accent" : "text-black dark:text-white group-hover:text-black dark:group-hover:text-white"
                            )}>
                                {account.accountName}
                            </h3>

                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-none bg-black/5 dark:bg-white/5 text-black/40 dark:text-white/30 uppercase tracking-[0.1em] border border-black/5 dark:border-white/5">
                                    {account.type}
                                </span>
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-none bg-black/5 dark:bg-white/5 text-black/40 dark:text-white/30 uppercase tracking-[0.1em] border border-black/5 dark:border-white/5">
                                    {account.role}
                                </span>

                                {/* Status Pip Badge */}
                                <div className={clsx(
                                    "inline-flex items-center gap-2 px-2 py-0.5 rounded-none text-[8px] font-black uppercase tracking-[0.15em] border shadow-sm transition-all duration-700",
                                    account.status === 'PENDING_APPROVAL' && "bg-amber-500/10 text-amber-600 border-amber-500/20",
                                    account.status === 'APPROVED' && "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
                                    account.status === 'ACTIVE' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                                    account.status === 'REJECTED' && "bg-rose-500/10 text-rose-600 border-rose-500/20",
                                    account.status === 'SUSPENDED' && "bg-black/5 text-black/40 border-black/10 dark:bg-white/5 dark:text-white/30 dark:border-white/10"
                                )}>
                                    <div className={clsx("w-1 h-1 rounded-none",
                                        account.status === 'PENDING_APPROVAL' ? "bg-amber-500" :
                                            account.status === 'APPROVED' ? "bg-cyan-500" :
                                                account.status === 'ACTIVE' ? "bg-emerald-500" :
                                                    account.status === 'REJECTED' ? "bg-rose-500" : "bg-black/30 dark:bg-white/20"
                                    )}></div>
                                    {getStatusLabel(account.status)}
                                </div>
                            </div>
                        </div>

                        {/* Indicador Selección */}
                        <div className={clsx(
                            "transition-all duration-500",
                            selectedId === account.accountId ? "text-antigravity-accent translate-x-1" : "text-black/10 dark:text-white/10 group-hover:text-black/40 dark:group-hover:text-white/40 group-hover:translate-x-1"
                        )}>
                            {selectedId === account.accountId && loading ? (
                                <div className="w-5 h-5 border-2 border-antigravity-accent border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <span className="material-symbols-rounded text-[24px]">
                                    {selectedId === account.accountId ? 'check_circle' : 'chevron_right'}
                                </span>
                            )}
                        </div>
                    </button>
                ))}
            </div>

            <div className="mt-12 pt-8 border-t border-black/5 dark:border-white/5 text-center">
                <button
                    onClick={onCancel}
                    disabled={loading}
                    className="group flex flex-col items-center gap-3 mx-auto transition-all duration-500 disabled:opacity-30"
                >
                    <div className="w-10 h-10 border border-black/10 dark:border-white/10 flex items-center justify-center group-hover:border-antigravity-accent transition-colors">
                        <span className="material-symbols-rounded text-[20px] text-black/40 dark:text-white/40 group-hover:text-antigravity-accent">undo</span>
                    </div>
                    <span className="text-[9px] font-black text-black/30 dark:text-white/30 uppercase tracking-[0.3em] group-hover:text-black dark:group-hover:text-white transition-colors">
                        Usar otro documento de identidad
                    </span>
                </button>
            </div>
        </div>
    );
};

export default AccountSelector;
