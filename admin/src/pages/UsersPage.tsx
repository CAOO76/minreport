import React, { useState } from 'react';
import { AdminUserTable } from '../components/admin/AdminUserTable';
import { UserManagementDrawer } from '../components/admin/UserManagementDrawer';
import { useAdminUsers } from '../hooks/useAdminUsers';
import { UserProfile } from '../types/admin';
import { Users, Filter, Plus } from 'lucide-react';

export const UsersPage: React.FC = () => {
    const { users, loading, toggleUserPlugin, updateUserStatus } = useAdminUsers();
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    // Derive the selected user from the live list to ensure updates reflect immediately
    const selectedUser = users.find(u => u.uid === selectedUserId) || null;

    const handleManageUser = (user: UserProfile) => {
        setSelectedUserId(user.uid);
        setIsDrawerOpen(true);
    };

    const handleCloseDrawer = () => {
        setIsDrawerOpen(false);
        // Delay clearing user to let animation finish
        setTimeout(() => setSelectedUserId(null), 300);
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 font-atkinson">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-antigravity-accent mb-2">
                        <Users size={20} />
                        <span className="text-xs font-black uppercase tracking-widest">Administración</span>
                    </div>
                    <h1 className="text-3xl font-black text-antigravity-light-text dark:text-antigravity-dark-text tracking-tight">
                        Gestión de Usuarios
                    </h1>
                    <p className="text-antigravity-light-muted dark:text-antigravity-dark-muted mt-1 max-w-lg">
                        Controla el acceso, configura permisos y gestiona los límites de almacenamiento de todos los usuarios del ecosistema.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border border-antigravity-light-border dark:border-antigravity-dark-border text-sm font-bold text-antigravity-light-text dark:text-antigravity-dark-text hover:bg-slate-200 dark:hover:bg-white/10 transition-all active:scale-95">
                        <Filter size={16} />
                        Filtrar
                    </button>
                </div>
            </header>

            <AdminUserTable
                users={users}
                loading={loading}
                onManageUser={handleManageUser}
            />

            <UserManagementDrawer
                isOpen={isDrawerOpen}
                onClose={handleCloseDrawer}
                user={selectedUser}
                toggleUserPlugin={toggleUserPlugin}
                updateUserStatus={updateUserStatus}
            />
        </div>
    );
};
