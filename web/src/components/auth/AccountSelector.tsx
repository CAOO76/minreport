import React, { useState } from 'react';
import type { AccountReference } from '../../types/user_directory';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { SecureImage } from '../common/SecureImage';

interface AccountSelectorProps {
    accounts: AccountReference[];
    onSelectAccount: (account: AccountReference) => void;
    onCancel: () => void;
    loading?: boolean;
}

const AccountSelector: React.FC<AccountSelectorProps> = ({
    accounts,
    onSelectAccount,
    onCancel,
    loading = false,
}) => {
    const { t } = useTranslation();
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const handleSelect = (account: AccountReference) => {
        setSelectedId(account.accountId);
        onSelectAccount(account);
    };

    const renderIcon = (type?: string) => {
        if (!type) return 'account_circle';
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

    const getStatusLabel = (status?: string) => {
        if (!status) return t('status.active', 'ACTIVO');
        const s = status.toString().toUpperCase();
        switch (s) {
            case 'PENDING_APPROVAL': return t('status.pending_approval', 'EN REVISIÓN');
            case 'APPROVED': return t('status.approved', 'APROBADO');
            case 'ACTIVE': return t('status.active', 'ACTIVO');
            case 'REJECTED': return t('status.rejected', 'RECHAZADO');
            case 'SUSPENDED': return t('status.suspended', 'SUSPENDIDO');
            case 'PENDING': return t('status.pending', 'INVITACIÓN');
            default: return s;
        }
    };

    return (
        <div className="w-full relative z-10 select-none font-sans">
            <div className="text-center mb-fib-21">
                <p className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] mb-fib-8 uppercase">
                    [NODOS DE IDENTIDAD ASOCIADOS]
                </p>
                <h2 className="text-h1-header font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                    {t('auth.associated_accounts', 'Cuentas Asociadas')}
                </h2>
                <p className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] uppercase mt-fib-8">
                    {accounts?.length || 0} {t('auth.profiles', 'PERFILES')}
                </p>
            </div>

            <div className="space-y-fib-13 max-h-[380px] overflow-y-auto">
                {accounts?.map((account) => {
                    const isSelected = selectedId === account.accountId;
                    return (
                        <button
                            key={account.accountId}
                            type="button"
                            onClick={() => handleSelect(account)}
                            disabled={loading}
                            className={clsx(
                                'group relative flex items-center gap-fib-13 p-fib-21 rounded-none shadow-none border transition-colors text-left w-full disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
                                isSelected
                                    ? 'bg-[#F8FAFC] dark:bg-[#07090D] border-[#C68346]'
                                    : 'bg-[#FFFFFF] dark:bg-[#07090D] border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346]/60'
                            )}
                        >
                            {/* Avatar Blindado o Icono Plano */}
                            {account.avatar ? (
                                <SecureImage
                                    src={account.avatar}
                                    alt={account.accountName}
                                    className="w-10 h-10 object-cover shrink-0 border border-[#E2E8F0] dark:border-[#12151C]"
                                />
                            ) : (
                                <span
                                    className={clsx(
                                        'material-symbols-outlined text-[24px] shrink-0',
                                        isSelected ? 'text-[#C68346]' : 'text-[#475569] dark:text-[#8A93A6]'
                                    )}
                                >
                                    {renderIcon(account.type)}
                                </span>
                            )}

                            {/* Información de Cuenta */}
                            <div className="flex-1 min-w-0 space-y-fib-8">
                                <h3
                                    className={clsx(
                                        'text-data-dense font-bold uppercase truncate transition-colors',
                                        isSelected ? 'text-[#C68346]' : 'text-[#0F172A] dark:text-[#F3F4F6]'
                                    )}
                                >
                                    {account.accountName}
                                </h3>

                                <div className="flex flex-wrap items-center gap-fib-8">
                                    <span className="text-microcopy font-mono px-fib-8 py-0.5 rounded-none bg-[#F8FAFC] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] uppercase border border-[#E2E8F0] dark:border-[#12151C]">
                                        {account.type}
                                    </span>
                                    <span className="text-microcopy font-mono px-fib-8 py-0.5 rounded-none bg-[#F8FAFC] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] uppercase border border-[#E2E8F0] dark:border-[#12151C]">
                                        {account.role}
                                    </span>

                                    <span
                                        className={clsx(
                                            'inline-flex items-center gap-fib-8 px-fib-8 py-0.5 rounded-none shadow-none text-microcopy font-mono uppercase border',
                                            account.status === 'PENDING_APPROVAL' && 'bg-[#C68346]/10 text-[#C68346] border-[#C68346]/30',
                                            account.status === 'APPROVED' && 'bg-[#00AEEF]/10 text-[#00AEEF] border-[#00AEEF]/30',
                                            account.status === 'ACTIVE' && 'bg-[#00AEEF]/10 text-[#00AEEF] border-[#00AEEF]/30',
                                            account.status === 'REJECTED' && 'bg-red-500/10 text-red-500 border-red-500/30',
                                            (!account.status || account.status === 'SUSPENDED' || account.status === 'PENDING') &&
                                                'bg-[#F8FAFC] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C]'
                                        )}
                                    >
                                        {getStatusLabel(account.status)}
                                    </span>
                                </div>
                            </div>

                            {/* Indicador Selección */}
                            <div className="shrink-0">
                                {isSelected && loading ? (
                                    <span className="material-symbols-outlined text-[20px] text-[#C68346] animate-spin">
                                        progress_activity
                                    </span>
                                ) : (
                                    <span
                                        className={clsx(
                                            'material-symbols-outlined text-[20px]',
                                            isSelected ? 'text-[#C68346]' : 'text-[#94A3B8] dark:text-[#5A6072]'
                                        )}
                                    >
                                        {isSelected ? 'check_circle' : 'chevron_right'}
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="mt-fib-21 pt-fib-21 border-t border-[#E2E8F0] dark:border-[#12151C] text-center">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={loading}
                    className="px-fib-21 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-transparent hover:border-[#C68346] text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white transition-colors disabled:opacity-30 rounded-none shadow-none cursor-pointer"
                >
                    {t('auth.use_other_id', 'Usar otro documento de identidad')}
                </button>
            </div>
        </div>
    );
};

export default AccountSelector;
