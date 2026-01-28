import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ChevronDown, Check, Building2, LogOut } from 'lucide-react'; // Ensure PlusCircle is available or remove if not needed

const AccountSwitcher: React.FC = () => {
    const { profile, currentAccount, switchAccount, signOut } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    if (!profile || !currentAccount) return null;

    const otherMemberships = profile.memberships || [];

    return (
        <div className="relative mb-6" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700/50 group"
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-500/20 group-hover:text-indigo-300 transition-all">
                        <Building2 size={20} />
                    </div>
                    <div className="text-left truncate">
                        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Espacio de trabajo</p>
                        <p className="text-sm font-semibold text-white truncate">{currentAccount.name}</p>
                    </div>
                </div>
                <ChevronDown
                    size={16}
                    className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 w-full mt-2 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="py-2">
                        <div className="px-3 pb-2 mb-2 border-b border-slate-700/50">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tus Cuentas</span>
                        </div>

                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                            {otherMemberships.map((membership) => (
                                <button
                                    key={membership.accountId}
                                    onClick={() => {
                                        switchAccount(membership.accountId);
                                        setIsOpen(false);
                                    }}
                                    className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-700/50 transition-colors group"
                                >
                                    <span className={`text-sm ${currentAccount.id === membership.accountId ? 'text-white font-medium' : 'text-slate-300'}`}>
                                        {membership.companyName}
                                    </span>
                                    {currentAccount.id === membership.accountId && (
                                        <Check size={16} className="text-indigo-400" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="border-t border-slate-700/50 p-2 bg-slate-900/50">
                        <button
                            onClick={() => signOut()}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-lg transition-colors"
                        >
                            <LogOut size={16} />
                            <span>Cerrar Sesión</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AccountSwitcher;
