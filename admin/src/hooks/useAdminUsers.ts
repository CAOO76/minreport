import { useState, useEffect } from 'react';
import {
    collection,
    doc,
    getDocs,
    updateDoc,
    addDoc,
    query,
    where,
    serverTimestamp,
    DocumentData
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { UserProfile, UserStatus } from '../types/admin';

export const useAdminUsers = () => {
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    /**
     * Helper logAuditAction:
     * Registra acciones administrativas en la colección admin_audit_logs.
     */
    const logAuditAction = async (action: string, targetUid: string, details: string) => {
        try {
            const adminId = auth.currentUser?.uid || 'unknown_admin';
            await addDoc(collection(db, 'admin_audit_logs'), {
                adminUid: adminId,
                targetUid: targetUid,
                action: action,
                details: details,
                timestamp: serverTimestamp()
            });
        } catch (err) {
            console.error('[AUDIT] Failed to log action:', err);
        }
    };

    /**
     * fetchUsers:
     * Trae todos los usuarios de la colección 'users'.
     * Filtra los eliminados en el cliente para transparencia.
     */
    const fetchUsers = async () => {
        setLoading(true);
        setError(null);
        try {
            // Nota: Podríamos filtrar por status != 'DELETED' en la query, 
            // pero el usuario sugirió manejarlo en la UI o query.
            const q = query(collection(db, 'users'), where('status', '!=', 'DELETED'));
            const querySnapshot = await getDocs(q);
            const userList: UserProfile[] = [];

            querySnapshot.forEach((doc) => {
                const userData = doc.data();
                if (userData.role !== 'SUPER_ADMIN') {
                    userList.push({ uid: doc.id, ...userData } as UserProfile);
                }
            });

            setUsers(userList);
        } catch (err: any) {
            console.error('[ADMIN] Error fetching users:', err);
            setError(err.message || 'Error al cargar usuarios');
        } finally {
            setLoading(false);
        }
    };

    /**
     * toggleUserPlugin:
     * Activa o desactiva un plugin específico para un usuario.
     */
    const toggleUserPlugin = async (uid: string, pluginKey: string) => {
        try {
            const user = users.find(u => u.uid === uid);
            if (!user) throw new Error('Usuario no encontrado');

            const currentPlugins = user.entitlements.pluginsEnabled || [];
            let newPlugins: string[];
            let actionText: string;

            if (currentPlugins.includes(pluginKey)) {
                newPlugins = currentPlugins.filter(p => p !== pluginKey);
                actionText = `REMOVED_PLUGIN_${pluginKey}`;
            } else {
                newPlugins = [...currentPlugins, pluginKey];
                actionText = `ADDED_PLUGIN_${pluginKey}`;
            }

            const userRef = doc(db, 'users', uid);
            await updateDoc(userRef, {
                'entitlements.pluginsEnabled': newPlugins,
                updatedAt: serverTimestamp()
            });

            // Actualizar estado local
            setUsers(prev => prev.map(u =>
                u.uid === uid
                    ? { ...u, entitlements: { ...u.entitlements, pluginsEnabled: newPlugins } }
                    : u
            ));

            // Log de auditoría
            await logAuditAction(actionText, uid, `Plugin list updated: ${newPlugins.join(', ')}`);

        } catch (err: any) {
            console.error('[ADMIN] Error toggling plugin:', err);
            throw err;
        }
    };

    /**
     * updateUserStatus:
     * Cambia el estado (ACTIVE, SUSPENDED, DELETED).
     */
    const updateUserStatus = async (uid: string, newStatus: UserStatus) => {
        try {
            const userRef = doc(db, 'users', uid);
            await updateDoc(userRef, {
                status: newStatus,
                updatedAt: serverTimestamp()
            });

            // Actualizar estado local (si es DELETED, removemos de la lista visible)
            if (newStatus === 'DELETED') {
                setUsers(prev => prev.filter(u => u.uid !== uid));
            } else {
                setUsers(prev => prev.map(u => u.uid === uid ? { ...u, status: newStatus } : u));
            }

            // Log de auditoría
            await logAuditAction('UPDATE_STATUS', uid, `Status changed to ${newStatus}`);

        } catch (err: any) {
            console.error('[ADMIN] Error updating status:', err);
            throw err;
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    return {
        users,
        loading,
        error,
        fetchUsers,
        toggleUserPlugin,
        updateUserStatus
    };
};
