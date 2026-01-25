import React from 'react';
import { Settings, ShieldCheck, Mail, User } from 'lucide-react';
import { UserProfile } from '../../types/admin';
import clsx from 'clsx';

interface AdminUserTableProps {
    users: UserProfile[];
    loading: boolean;
    onManageUser: (user: UserProfile) => void;
}

import { UserDetailsModal } from './UserDetailsModal';
import { Eye } from 'lucide-react';

export const AdminUserTable: React.FC<AdminUserTableProps> = ({ users, loading, onManageUser }) => {
    const [viewUser, setViewUser] = React.useState<UserProfile | null>(null);

    // Helper: Obtener iniciales para el Avatar
    const getInitials = (name: string, email: string) => {
        const base = name || email;
        return base.substring(0, 2).toUpperCase();
    };

    // Helper: Formatear almacenamiento (MB o GB sugerido)
    const formatStorage = (bytes: number) => {
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };


    return (
        <div className="w-full overflow-hidden border border-antigravity-light-border dark:border-antigravity-dark-border rounded-xl bg-antigravity-light-surface dark:bg-antigravity-dark-surface shadow-sm">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse table-auto">
                    <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-antigravity-light-border dark:border-antigravity-dark-border">
                            <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-antigravity-light-muted dark:text-antigravity-dark-muted">Usuario</th>
                            <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-antigravity-light-muted dark:text-antigravity-dark-muted text-center">Estado</th>
                            <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-antigravity-light-muted dark:text-antigravity-dark-muted text-center">Rol</th>
                            <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-antigravity-light-muted dark:text-antigravity-dark-muted">Almacenamiento</th>
                            <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-antigravity-light-muted dark:text-antigravity-dark-muted text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-antigravity-light-border dark:divide-antigravity-dark-border">
                        {loading ? (
                            // Skeleton Rows (omitted for brevity, keep existing if possible or simplified)
                            Array.from({ length: 3 }).map((_, i) => (
                                <tr key={`skeleton-${i}`} className="animate-pulse">
                                    <td colSpan={5} className="px-4 py-4"><div className="h-8 bg-slate-100 dark:bg-slate-800 rounded"></div></td>
                                </tr>
                            ))
                        ) : users.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-10 text-center text-antigravity-light-muted dark:text-antigravity-dark-muted text-sm italic">
                                    No se encontraron usuarios disponibles.
                                </td>
                            </tr>
                        ) : users.map((user) => (
                            <tr key={user.uid} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group">
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        {/* Avatar initials */}
                                        <div className="w-10 h-10 rounded-full bg-antigravity-accent/10 flex items-center justify-center text-antigravity-accent font-bold text-sm border border-antigravity-accent/20">
                                            {getInitials(user.displayName, user.email)}
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-antigravity-light-text dark:text-antigravity-dark-text flex items-center gap-1.5">
                                                {user.displayName || 'Usuario'}
                                            </div>
                                            <div className="text-xs text-antigravity-light-muted dark:text-antigravity-dark-muted flex items-center gap-1">
                                                <Mail size={10} />
                                                {user.email}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <span className={clsx(
                                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border",
                                        user.status === 'ACTIVE' && "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800",
                                        user.status === 'SUSPENDED' && "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800",
                                        user.status === 'DELETED' && "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                                    )}>
                                        {user.status}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <User size={18} className="text-antigravity-light-muted dark:text-antigravity-dark-muted mx-auto" />
                                </td>
                                <td className="px-4 py-3 max-w-[150px]">
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between text-[10px] text-antigravity-light-muted dark:text-antigravity-dark-muted">
                                            <span>{formatStorage(user.stats.storageUsed)}</span>
                                            <span>{formatStorage(user.entitlements.storageLimit)}</span>
                                        </div>
                                        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div
                                                className={clsx(
                                                    "h-full rounded-full transition-all duration-500",
                                                    (user.stats.storageUsed / user.entitlements.storageLimit) > 0.9 ? "bg-rose-500" : "bg-antigravity-accent"
                                                )}
                                                style={{ width: `${Math.min((user.stats.storageUsed / user.entitlements.storageLimit) * 100, 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => setViewUser(user)}
                                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-antigravity-accent transition-colors"
                                            title="Ver Perfil"
                                        >
                                            <Eye size={18} />
                                        </button>
                                        <button
                                            onClick={() => onManageUser(user)}
                                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-950 dark:bg-white text-white dark:text-slate-950 hover:opacity-90 active:scale-95 transition-all shadow-sm"
                                        >
                                            <Settings size={14} />
                                            Gestionar
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <UserDetailsModal
                isOpen={!!viewUser}
                onClose={() => setViewUser(null)}
                user={viewUser}
            />
        </div>
    );
};
