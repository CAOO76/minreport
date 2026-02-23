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
                className="w-full flex items-center justify-between p-4 rounded-none bg-black/40 hover:bg-black/60 transition-all border border-white/5 group relative overflow-hidden"
            >
                <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none"></div>
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 rounded-none bg-white/5 flex items-center justify-center text-white/40 group-hover:bg-antigravity-accent group-hover:text-white transition-all border border-white/5">
                        <Building2 size={20} />
                    </div>
                    <div className="text-left truncate">
                        <p className="hud-label text-white/20 text-[9px]">WORKSPACE_SELECT</p>
                        <p className="text-sm font-black text-white/90 truncate uppercase tracking-tight">{currentAccount.name}</p>
                    </div>
                </div>
                <ChevronDown
                    size={16}
                    className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 w-full mt-1 bg-[#1A1A1A] rounded-none border border-white/10 shadow-3xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="py-2">
                        <div className="px-4 pb-2 mb-2 border-b border-white/5">
                            <span className="hud-label text-white/40 text-[9px]">AVAILABLE_ACCOUNTS</span>
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
                                    <span className={`text-[11px] font-bold uppercase tracking-widest ${currentAccount.id === membership.accountId ? 'text-white' : 'text-white/40'}`}>
                                        {membership.companyName}
                                    </span>
                                    {currentAccount.id === membership.accountId && (
                                        <Check size={14} className="text-antigravity-accent" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="border-t border-white/5 p-2 bg-black/20">
                        <button
                            onClick={() => signOut()}
                            className="w-full flex items-center justify-center gap-3 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-red-500 hover:bg-red-500/10 rounded-none transition-all"
                        >
                            <LogOut size={16} />
                            <span>LOGOUT_SESSION</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AccountSwitcher;
