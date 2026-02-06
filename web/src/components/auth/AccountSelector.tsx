import React, { useState } from 'react';
import type { AccountReference } from '../../types/user_directory';

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
 * Diseño: Material Design 3 + Atkinson Hyperlegible
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
        switch (type) {
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

    return (
        <div className="animate-in fade-in slide-in-from-right-8 duration-500 w-full">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    Selecciona una cuenta
                </h2>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                    Hemos encontrado {accounts.length} {accounts.length === 1 ? 'perfil asociado' : 'perfiles asociados'}
                </p>
            </div>

            <div className="grid gap-4">
                {accounts.map((account) => (
                    <button
                        key={account.accountId}
                        onClick={() => handleSelect(account)}
                        disabled={loading}
                        className="group relative flex items-center p-4 bg-white dark:bg-[#1E1E1E] rounded-2xl border border-gray-100 dark:border-gray-800 hover:border-indigo-500 dark:hover:border-indigo-500 shadow-sm hover:shadow-md transition-all duration-200 text-left w-full disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {/* Avatar o Icono */}
                        <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mr-4 group-hover:scale-105 transition-transform overflow-hidden">
                            {account.avatar ? (
                                <img
                                    src={account.avatar}
                                    alt={account.accountName}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <span className="material-symbols-rounded text-[28px]">
                                    {renderIcon(account.type)}
                                </span>
                            )}
                        </div>

                        {/* Info Cuenta */}
                        <div className="flex-1">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {account.accountName}
                            </h3>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                                    {account.role}
                                </span>
                            </div>
                        </div>

                        {/* Indicador Selección */}
                        <div className="text-gray-300 dark:text-gray-600 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all">
                            {selectedId === account.accountId && loading ? (
                                <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <span className="material-symbols-rounded">arrow_forward_ios</span>
                            )}
                        </div>
                    </button>
                ))}
            </div>

            <div className="mt-8 text-center">
                <button
                    onClick={onCancel}
                    disabled={loading}
                    className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors font-medium disabled:opacity-50"
                >
                    Usar otro documento de identidad
                </button>
            </div>
        </div>
    );
};

export default AccountSelector;
