import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Building2, User, ChevronRight } from 'lucide-react';

const AccountSelector: React.FC = () => {
    const { profile, switchAccount, signOut } = useAuth();
    const [loadingId, setLoadingId] = useState<string | null>(null);

    if (!profile) return null;

    const handleSelect = async (accountId: string) => {
        setLoadingId(accountId);
        try {
            await switchAccount(accountId);
        } catch (error) {
            console.error("Failed to switch account", error);
            setLoadingId(null);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in duration-300">
                <div className="p-8 text-center bg-slate-900 text-white">
                    <h1 className="text-2xl font-bold tracking-tight">Selecciona tu Cuenta</h1>
                    <p className="text-slate-400 mt-2 text-sm">
                        Tienes acceso a {profile.memberships?.length || 0} cuenta{profile.memberships?.length !== 1 ? 's' : ''}
                    </p>
                </div>

                <div className="p-6 space-y-3">
                    {profile.memberships?.map((membership) => (
                        <button
                            key={membership.accountId}
                            onClick={() => handleSelect(membership.accountId)}
                            disabled={loadingId !== null}
                            className="w-full group relative flex items-center p-4 rounded-xl border border-gray-100 bg-white hover:border-blue-500 hover:shadow-md transition-all duration-200 text-left disabled:opacity-50"
                        >
                            <div className={`p-3 rounded-lg mr-4 ${membership.role === 'OWNER' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-600'} group-hover:scale-110 transition-transform`}>
                                {membership.role === 'OWNER' ? <Building2 size={24} /> : <User size={24} />}
                            </div>

                            <div className="flex-1">
                                <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                                    {membership.companyName}
                                </h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">
                                        {membership.role}
                                    </span>
                                </div>
                            </div>

                            <div className="text-gray-300 group-hover:text-blue-500 transform group-hover:translate-x-1 transition-all">
                                {loadingId === membership.accountId ? (
                                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <ChevronRight size={20} />
                                )}
                            </div>
                        </button>
                    ))}
                </div>

                <div className="p-4 bg-gray-50 border-t border-gray-100 text-center">
                    <button
                        onClick={() => signOut()}
                        className="text-sm text-gray-500 hover:text-red-500 font-medium transition-colors"
                    >
                        Cerrar Sesión
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AccountSelector;
