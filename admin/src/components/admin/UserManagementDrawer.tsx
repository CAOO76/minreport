
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    collection,
    addDoc,
    serverTimestamp,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    Timestamp
} from 'firebase/firestore';
import { db, auth } from '../../config/firebase';
import { UserProfile, UserStatus } from '../../types/admin';
import { SYSTEM_MODULES, SystemModuleInfo } from '../../constants/modules';
import { M3Switch } from '../M3Switch';
import clsx from 'clsx';
import { ConfirmDeleteDialog } from '../common/ConfirmDeleteDialog';
import { deleteTenant } from '../../services/api';

interface UserManagementDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    user: UserProfile | null;
    toggleUserPlugin: (uid: string, pluginKey: string) => Promise<void>;
    updateUserStatus: (uid: string, newStatus: UserStatus) => Promise<void>;
}

export const UserManagementDrawer: React.FC<UserManagementDrawerProps> = ({
    isOpen,
    onClose,
    user,
    toggleUserPlugin,
    updateUserStatus
}) => {
    const [activeTab, setActiveTab] = useState<'general' | 'messages' | 'audit'>('general');
    const [copied, setCopied] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Módulos del Sistema — Fuente de verdad nativa (SYSTEM_MODULES)
    // No se consulta Firestore: los módulos son integrados al código MINREPORT, no plugins externos.
    const availableModules = SYSTEM_MODULES;


    // States for Messaging
    const [msgBody, setMsgBody] = useState('');
    const [msgType, setMsgType] = useState<'info' | 'warning' | 'urgent'>('info');

    // States for Audit
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    const [auditLoading, setAuditLoading] = useState(false);

    // State for Confirmation Modal
    const [pendingAction, setPendingAction] = useState<{ key: string; label: string; action: 'ACTIVATE' | 'DEACTIVATE' } | null>(null);

    // State for Delete Confirmation
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleCopyId = () => {
        if (!user) return;
        navigator.clipboard.writeText(user.uid);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleStatusUpdate = async (newStatus: UserStatus) => {
        if (!user) return;
        setActionLoading(newStatus);
        try {
            await updateUserStatus(user.uid, newStatus);
        } catch (err) {
            console.error(err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleDeleteUser = async () => {
        if (!user) return;
        setActionLoading('DELETING');
        try {
            // Call cascade delete endpoint
            await deleteTenant(user.uid);
            setShowDeleteConfirm(false);
            onClose(); // Close drawer after successful deletion
        } catch (err) {
            console.error('[DRAWER] Error deleting user:', err);
            alert('Error al eliminar usuario');
        } finally {
            setActionLoading(null);
        }
    };

    const handlePluginClick = (mod: SystemModuleInfo) => {
        if (!user) return;
        const isEnabled = user.entitlements.pluginsEnabled?.includes(mod.key);
        setPendingAction({
            key: mod.key,
            label: mod.label,
            action: isEnabled ? 'DEACTIVATE' : 'ACTIVATE'
        });
    };

    const confirmPluginAction = async () => {
        if (!pendingAction || !user) return;

        setActionLoading(pendingAction.key);
        // optimistically close modal
        setPendingAction(null);

        try {
            await toggleUserPlugin(user.uid, pendingAction.key);
        } catch (err) {
            console.error(err);
            alert("Error al actualizar plugin");
        } finally {
            setActionLoading(null);
        }
    };

    /**
     * handleSendMessage:
     * Envía un mensaje a la subcolección 'inbox' del usuario.
     */
    const handleSendMessage = async () => {
        if (!user || !msgBody.trim()) return;
        setActionLoading('sending_msg');
        try {
            const adminId = auth.currentUser?.uid || 'unknown_admin';
            await addDoc(collection(db, `users/${user.uid}/inbox`), {
                title: 'Mensaje Administrativo',
                body: msgBody,
                type: msgType,
                read: false,
                adminId: adminId,
                timestamp: serverTimestamp()
            });
            setMsgBody('');
            alert('Mensaje enviado con éxito');
        } catch (err) {
            console.error('[DRAWER] Error sending message:', err);
            alert('Error al enviar mensaje');
        } finally {
            setActionLoading(null);
        }
    };

    /**
     * fetchAuditLogs:
     * Carga los logs de auditoría filtrados por el targetUid del usuario seleccionado.
     */
    const fetchAuditLogs = async () => {
        if (!user) return;
        setAuditLoading(true);
        try {
            const q = query(
                collection(db, 'admin_audit_logs'),
                where('targetUid', '==', user.uid),
                orderBy('timestamp', 'desc'),
                limit(10)
            );
            const snapshot = await getDocs(q);
            const logs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setAuditLogs(logs);
        } catch (err) {
            console.error('[DRAWER] Error fetching audit logs:', err);
        } finally {
            setAuditLoading(false);
        }
    };

    // Cargar auditoría cuando se cambia a esa pestaña
    useEffect(() => {
        if (activeTab === 'audit' && user) {
            fetchAuditLogs();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, user?.uid]);

    const getInitials = (name: string, email: string) => {
        const base = name || email;
        return base.substring(0, 2).toUpperCase();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
                    />

                    {/* Drawer */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed right-0 top-0 h-screen w-full max-w-md bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-l border-antigravity-light-border dark:border-antigravity-dark-border z-50 flex flex-col shadow-none"
                    >
                        {/* Header */}
                        <div className="p-6 border-b border-antigravity-light-border dark:border-antigravity-dark-border flex justify-between items-center">
                            <h2 className="text-lg font-bold text-antigravity-light-text dark:text-antigravity-dark-text tracking-tight uppercase">Gestión de Usuario</h2>
                            <button 
                                onClick={onClose} 
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center rounded-none"
                                title="Cerrar"
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        {user ? (
                            <div className="flex-1 flex flex-col min-h-0 font-atkinson">
                                {/* Top Identity Card */}
                                <div className="p-6 bg-slate-50 dark:bg-white/5 border-b border-antigravity-light-border dark:border-antigravity-dark-border">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 rounded-none bg-antigravity-accent/10 border border-antigravity-accent/20 flex items-center justify-center text-antigravity-accent text-lg font-mono font-bold">
                                            {getInitials(user.displayName, user.email)}
                                        </div>
                                        <div className="overflow-hidden">
                                            <h3 className="text-sm font-bold uppercase tracking-tight text-antigravity-light-text dark:text-antigravity-dark-text truncate">
                                                {user.displayName || 'Sin nombre'}
                                            </h3>
                                            <p className="text-xs text-antigravity-light-muted dark:text-antigravity-dark-muted truncate flex items-center gap-1 font-mono">
                                                <span className="material-symbols-outlined text-[13px]">mail</span>
                                                {user.email.toLowerCase()}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <code className="bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded-none text-[9px] text-slate-500 font-mono tracking-tighter">
                                                    ID: {user.uid.substring(0, 8)}...
                                                </code>
                                                <button onClick={handleCopyId} className="text-antigravity-accent hover:opacity-70 transition-colors bg-transparent border-0 cursor-pointer flex items-center">
                                                    {copied ? <span className="material-symbols-outlined text-[13px]">check</span> : <span className="material-symbols-outlined text-[13px]">content_copy</span>}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Tabs Navigation */}
                                <div className="flex border-b border-antigravity-light-border dark:border-antigravity-dark-border px-4 bg-white dark:bg-antigravity-dark-surface sticky top-0 z-10">
                                    {[
                                        { id: 'general', label: 'General', icon: 'settings' },
                                        { id: 'messages', label: 'Mensajes', icon: 'chat' },
                                        { id: 'audit', label: 'Auditoría', icon: 'history' }
                                    ].map((tab) => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id as any)}
                                            className={clsx(
                                                "flex items-center gap-2 px-4 py-4 text-xs font-bold uppercase tracking-widest transition-all relative rounded-none cursor-pointer border-0 bg-transparent",
                                                activeTab === tab.id
                                                    ? "text-antigravity-accent"
                                                    : "text-antigravity-light-muted dark:text-antigravity-dark-muted hover:text-antigravity-light-text dark:hover:text-antigravity-dark-text"
                                            )}
                                        >
                                            <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                                            {tab.label}
                                            {activeTab === tab.id && (
                                                <motion.div
                                                    layoutId="activeTabUnderline"
                                                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-antigravity-accent rounded-none"
                                                />
                                            )}
                                        </button>
                                    ))}
                                </div>

                                {/* Tab Content */}
                                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                                    {activeTab === 'general' && (
                                        <>
                                            {/* Modules Section */}
                                            {/* Modules Section */}
                                            <section className="space-y-4">
                                                <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-antigravity-light-muted dark:text-antigravity-dark-muted font-mono">
                                                    <span className="material-symbols-outlined text-[15px]">monitoring</span>
                                                    Módulos del Sistema
                                                </h4>
                                                <div className="grid gap-3">
                                                    {availableModules.map((mod) => (
                                                        <div
                                                            key={mod.key}
                                                            className="flex items-center justify-between p-4 rounded-none border border-antigravity-light-border dark:border-antigravity-dark-border bg-slate-50/50 dark:bg-white/5 transition-all hover:border-antigravity-accent/30 shadow-none"
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <span className="material-symbols-outlined text-antigravity-accent bg-antigravity-accent/10 p-2 rounded-none text-lg">
                                                                    {mod.icon}
                                                                </span>
                                                                <div>
                                                                    <p className="text-xs font-bold uppercase tracking-tight text-antigravity-light-text dark:text-antigravity-dark-text">{mod.label}</p>
                                                                    <p className="text-[10px] text-antigravity-light-muted dark:text-antigravity-dark-muted leading-tight font-mono">{mod.scope}</p>
                                                                </div>
                                                            </div>
                                                            <M3Switch
                                                                checked={user.entitlements.pluginsEnabled?.includes(mod.key) || false}
                                                                onChange={() => handlePluginClick(mod)}
                                                                disabled={actionLoading === mod.key}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            </section>

                                            {/* Danger Zone */}
                                            <section className="space-y-4 pt-4 border-t border-antigravity-light-border dark:border-antigravity-dark-border">
                                                <h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-rose-500 font-mono">
                                                    <span className="material-symbols-outlined text-[15px]">shield</span>
                                                    Zona de Peligro
                                                </h4>
                                                <div className="p-4 rounded-none border border-rose-200 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-900/5 space-y-4 shadow-none">
                                                    <div className="flex items-center justify-between gap-4">
                                                        <div className="flex-1">
                                                            <p className="text-xs font-bold uppercase tracking-tight text-antigravity-light-text dark:text-antigravity-dark-text">
                                                                {user.status === 'SUSPENDED' ? 'Reactivar Cuenta' : 'Suspender Cuenta'}
                                                            </p>
                                                            <p className="text-[10px] text-antigravity-light-muted dark:text-antigravity-dark-muted leading-tight mt-0.5 font-mono">
                                                                {user.status === 'SUSPENDED'
                                                                    ? 'El usuario volverá a tener acceso inmediato.'
                                                                    : 'El usuario perderá acceso al sistema hasta ser reactivado.'}
                                                            </p>
                                                        </div>
                                                        <button
                                                            onClick={() => handleStatusUpdate(user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED')}
                                                            disabled={actionLoading !== null}
                                                            className={clsx(
                                                                "px-3 py-1.5 rounded-none text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-none border-0 cursor-pointer",
                                                                user.status === 'SUSPENDED'
                                                                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                                                    : "bg-amber-600 text-white hover:bg-amber-700"
                                                            )}
                                                        >
                                                            {actionLoading === 'SUSPENDED' || actionLoading === 'ACTIVE' ? (
                                                                <span className="material-symbols-outlined text-[13px] animate-spin">refresh</span>
                                                            ) : user.status === 'SUSPENDED' ? (
                                                                'Reactivar'
                                                            ) : (
                                                                'Suspender'
                                                            )}
                                                        </button>
                                                    </div>

                                                    <div className="h-px bg-rose-200 dark:bg-rose-900/50" />

                                                    <div className="flex items-center justify-between gap-4">
                                                        <div className="flex-1">
                                                            <p className="text-xs font-bold uppercase tracking-tight text-rose-600">Eliminar Cuenta</p>
                                                            <p className="text-[10px] text-antigravity-light-muted dark:text-antigravity-dark-muted leading-tight mt-0.5 font-mono">
                                                                Desactivación permanente. El registro se conserva por auditoría.
                                                            </p>
                                                        </div>
                                                        <button
                                                            onClick={() => setShowDeleteConfirm(true)}
                                                            disabled={actionLoading !== null}
                                                            className="px-3 py-1.5 rounded-none text-[10px] font-bold uppercase tracking-wider bg-rose-600 text-white hover:bg-rose-700 transition-colors flex items-center gap-1.5 shadow-none disabled:opacity-50 disabled:cursor-not-allowed border-0 cursor-pointer"
                                                        >
                                                            {actionLoading === 'DELETING' ? (
                                                                <span className="material-symbols-outlined text-[13px] animate-spin">refresh</span>
                                                            ) : (
                                                                <>
                                                                    <span className="material-symbols-outlined text-[13px]">delete</span>
                                                                    Eliminar
                                                                </>
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            </section>
                                        </>
                                    )}

                                    {activeTab === 'messages' && (
                                        <section className="space-y-6">
                                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-antigravity-light-muted dark:text-antigravity-dark-muted font-mono">
                                                <span className="material-symbols-outlined text-[15px]">chat</span>
                                                Comunicación Directa
                                            </div>

                                            <div className="space-y-5">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-bold text-antigravity-light-muted dark:text-antigravity-dark-muted uppercase tracking-widest block font-mono">
                                                        Severidad
                                                    </label>
                                                    <div className="flex gap-2">
                                                        {(['info', 'warning', 'urgent'] as const).map((type) => (
                                                            <button
                                                                key={type}
                                                                onClick={() => setMsgType(type)}
                                                                className={clsx(
                                                                    "flex-1 py-2.5 px-3 rounded-none border text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 shadow-none cursor-pointer",
                                                                    msgType === type
                                                                        ? (type === 'info' ? "bg-antigravity-accent text-white border-transparent" :
                                                                            type === 'warning' ? "bg-amber-500 text-white border-transparent" :
                                                                                "bg-rose-600 text-white border-transparent")
                                                                        : "bg-transparent border-antigravity-light-border dark:border-antigravity-dark-border text-antigravity-light-muted dark:text-antigravity-dark-muted hover:border-slate-300"
                                                                )}
                                                            >
                                                                <span className="material-symbols-outlined text-[12px]">notifications</span>
                                                                {type}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-bold text-antigravity-light-muted dark:text-antigravity-dark-muted uppercase tracking-widest block font-mono">
                                                        Cuerpo del Mensaje
                                                    </label>
                                                    <textarea
                                                        value={msgBody}
                                                        onChange={(e) => setMsgBody(e.target.value)}
                                                        placeholder="Escribe el mensaje que aparecerá en el buzón del usuario..."
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        className="w-full h-36 p-4 rounded-none bg-slate-50 dark:bg-white/5 border border-antigravity-light-border dark:border-antigravity-dark-border text-xs outline-none focus:border-antigravity-accent transition-colors resize-none font-sans leading-relaxed"
                                                    />
                                                </div>

                                                <button
                                                    onClick={handleSendMessage}
                                                    disabled={!msgBody.trim() || actionLoading === 'sending_msg'}
                                                    className="w-full py-3 rounded-none bg-antigravity-accent text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-none hover:opacity-90 active:scale-[0.99] disabled:opacity-50 disabled:grayscale transition-opacity cursor-pointer border-0"
                                                >
                                                    {actionLoading === 'sending_msg' ? (
                                                        <span className="material-symbols-outlined text-[15px] animate-spin">refresh</span>
                                                    ) : (
                                                        <>
                                                            <span className="material-symbols-outlined text-[15px]">send</span>
                                                            Enviar Notificación
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </section>
                                    )}

                                    {activeTab === 'audit' && (
                                        <section className="space-y-6">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-antigravity-light-muted dark:text-antigravity-dark-muted font-mono">
                                                    <span className="material-symbols-outlined text-[15px]">history</span>
                                                    Historial de Auditoría
                                                </div>
                                                <button
                                                    onClick={fetchAuditLogs}
                                                    className="p-1 hover:bg-slate-100 dark:hover:bg-white/5 rounded-none text-antigravity-accent transition-colors bg-transparent border-0 cursor-pointer"
                                                    title="Refrescar"
                                                >
                                                    <span className={`material-symbols-outlined text-[15px] ${auditLoading ? "animate-spin" : ""}`}>refresh</span>
                                                </button>
                                            </div>

                                            <div className="relative space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-antigravity-light-border dark:before:bg-antigravity-dark-border">
                                                {auditLoading ? (
                                                    Array.from({ length: 4 }).map((_, i) => (
                                                        <div key={i} className="flex gap-4 animate-pulse ml-1">
                                                            <div className="w-4 h-4 rounded-none bg-slate-200 dark:bg-slate-800 z-10" />
                                                            <div className="flex-1 space-y-2">
                                                                <div className="h-4 w-3/4 bg-slate-100 dark:bg-white/5 rounded-none" />
                                                                <div className="h-2 w-1/4 bg-slate-100 dark:bg-white/5 rounded-none" />
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : auditLogs.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
                                                        <span className="material-symbols-outlined text-[28px] text-slate-300 dark:text-slate-800">warning</span>
                                                        <p className="text-xs text-antigravity-light-muted dark:text-antigravity-dark-muted font-mono">Sin registros de auditoría.</p>
                                                    </div>
                                                ) : auditLogs.map((log) => (
                                                    <div key={log.id} className="relative flex gap-4 ml-1">
                                                        <div className="w-4 h-4 rounded-none bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-antigravity-accent flex items-center justify-center z-10 shadow-none">
                                                            <div className="w-1.5 h-1.5 rounded-none bg-antigravity-accent" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <p className="text-[11px] font-bold text-antigravity-light-text dark:text-antigravity-dark-text uppercase tracking-tight">
                                                                    {log.action.replace(/_/g, ' ')}
                                                                </p>
                                                                <span className="text-[9px] font-mono text-antigravity-light-muted dark:text-antigravity-dark-muted flex items-center gap-1 bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 rounded-none">
                                                                    <span className="material-symbols-outlined text-[10px]">schedule</span>
                                                                    {log.timestamp instanceof Timestamp ? log.timestamp.toDate().toLocaleDateString() : 'Reciente'}
                                                                </span>
                                                            </div>
                                                            <p className="text-[10px] text-antigravity-light-muted dark:text-antigravity-dark-muted font-mono mt-0.5">
                                                                Admin: {log.adminUid.substring(0, 8)}...
                                                            </p>
                                                            {log.details && (
                                                                <div className="mt-2 p-2.5 rounded-none bg-slate-100/50 dark:bg-white/5 border border-antigravity-light-border dark:border-antigravity-dark-border">
                                                                    <p className="text-[11px] text-antigravity-light-text dark:text-antigravity-dark-text leading-snug font-mono">
                                                                        {log.details}
                                                                    </p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12 text-center">
                                <span className="material-symbols-outlined text-[28px] animate-spin mb-4 opacity-20">refresh</span>
                                <p className="text-xs font-bold uppercase tracking-widest opacity-40 font-mono">Cargando credenciales...</p>
                            </div>
                        )}
                    </motion.div>

                    {/* Confirmation Modal - Rendered outside or on top */}
                    {pendingAction && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm font-atkinson"
                        >
                            <motion.div
                                initial={{ scale: 0.98, y: 10 }}
                                animate={{ scale: 1, y: 0 }}
                                className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-none shadow-none p-6 border border-slate-200 dark:border-slate-800"
                            >
                                <div className="flex flex-col items-center text-center space-y-4">
                                    <div className={clsx(
                                        "w-12 h-12 rounded-none flex items-center justify-center text-2xl mb-1 border",
                                        pendingAction.action === 'ACTIVATE'
                                            ? "bg-emerald-100 text-emerald-600 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800"
                                            : "bg-rose-100 text-rose-600 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800"
                                    )}>
                                        <span className="material-symbols-outlined text-[24px]">
                                            {pendingAction.action === 'ACTIVATE' ? 'add_moderator' : 'remove_moderator'}
                                        </span>
                                    </div>

                                    <div>
                                        <h3 className="text-sm font-bold uppercase tracking-tight text-slate-900 dark:text-white leading-tight">
                                            ¿{pendingAction.action === 'ACTIVATE' ? 'Habilitar' : 'Deshabilitar'} {pendingAction.label}?
                                        </h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed font-mono">
                                            Estás a punto de <strong className={pendingAction.action === 'ACTIVATE' ? "text-emerald-600" : "text-rose-500"}>
                                                {pendingAction.action === 'ACTIVATE' ? 'dar acceso' : 'revocar acceso'}
                                            </strong> al módulo de {pendingAction.label}. Esta acción se registrará en la auditoría.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 w-full pt-2">
                                        <button
                                            onClick={() => setPendingAction(null)}
                                            className="py-2.5 px-3 rounded-none font-bold text-xs uppercase tracking-wider text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors border border-slate-200 dark:border-slate-700 bg-transparent cursor-pointer"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={confirmPluginAction}
                                            className={clsx(
                                                "py-2.5 px-3 rounded-none font-bold text-xs uppercase tracking-wider text-white shadow-none transition-colors border-0 cursor-pointer",
                                                pendingAction.action === 'ACTIVATE' ? "bg-emerald-600 hover:bg-emerald-500" : "bg-rose-600 hover:bg-rose-500"
                                            )}
                                        >
                                            Confirmar
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}

                    {/* Delete Confirmation Dialog */}
                    <ConfirmDeleteDialog
                        isOpen={showDeleteConfirm}
                        onClose={() => setShowDeleteConfirm(false)}
                        onConfirm={handleDeleteUser}
                        title="Eliminar Usuario Permanentemente"
                        itemName={user?.displayName || user?.email || ''}
                        description="Esta acción eliminará permanentemente todos los datos asociados: usuario, cuenta, autenticación y solicitudes. Esta acción NO se puede deshacer."
                    />
                </>
            )}
        </AnimatePresence>
    );
};
