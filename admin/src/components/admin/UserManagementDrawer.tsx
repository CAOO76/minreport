
import React, { useState, useEffect } from 'react';
import {
    X,
    Copy,
    Check,
    AlertTriangle,
    User,
    ShieldAlert,
    Trash2,
    RefreshCw,
    Activity,
    Mail,
    History,
    MessageSquare,
    Send,
    Bell,
    Clock,
    Settings
} from 'lucide-react';
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
import { UserProfile, UserStatus, Plugin } from '../../types/admin';
import { M3Switch } from '../ui/M3Switch';
import clsx from 'clsx';

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

    // Dynamic Plugins State
    const [availablePlugins, setAvailablePlugins] = useState<Plugin[]>([]);

    useEffect(() => {
        const fetchAvailablePlugins = async () => {
            try {
                // Fetch only OPERATIONAL plugins for assignment
                const q = query(collection(db, 'plugins'), where('status', '==', 'OPERATIONAL'));
                const snapshot = await getDocs(q);
                const list = snapshot.docs.map(doc => ({ key: doc.id, ...doc.data() } as Plugin));
                setAvailablePlugins(list);
            } catch (error) {
                console.error("Error fetching plugins:", error);
            }
        };

        if (isOpen) {
            fetchAvailablePlugins();
        }
    }, [isOpen]);

    // States for Messaging
    const [msgBody, setMsgBody] = useState('');
    const [msgType, setMsgType] = useState<'info' | 'warning' | 'urgent'>('info');

    // States for Audit
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    const [auditLoading, setAuditLoading] = useState(false);

    // State for Confirmation Modal
    const [pendingAction, setPendingAction] = useState<{ key: string; label: string; action: 'ACTIVATE' | 'DEACTIVATE' } | null>(null);

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

    const handlePluginClick = (plugin: Plugin) => {
        if (!user) return;
        const isEnabled = user.entitlements.pluginsEnabled?.includes(plugin.key);
        setPendingAction({
            key: plugin.key,
            label: plugin.label,
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
                        className="fixed right-0 top-0 h-screen w-full max-w-md bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-l border-antigravity-light-border dark:border-antigravity-dark-border z-50 flex flex-col shadow-2xl"
                    >
                        {/* Header */}
                        <div className="p-6 border-b border-antigravity-light-border dark:border-antigravity-dark-border flex justify-between items-center">
                            <h2 className="text-lg font-bold text-antigravity-light-text dark:text-antigravity-dark-text tracking-tight">Gestión de Usuario</h2>
                            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {user ? (
                            <div className="flex-1 flex flex-col min-h-0 font-atkinson">
                                {/* Top Identity Card */}
                                <div className="p-6 bg-slate-50 dark:bg-white/5 border-b border-antigravity-light-border dark:border-antigravity-dark-border">
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-full bg-antigravity-accent/10 border border-antigravity-accent/20 flex items-center justify-center text-antigravity-accent text-xl font-black">
                                            {getInitials(user.displayName, user.email)}
                                        </div>
                                        <div className="overflow-hidden">
                                            <h3 className="text-lg font-bold text-antigravity-light-text dark:text-antigravity-dark-text truncate">
                                                {user.displayName || 'Sin nombre'}
                                            </h3>
                                            <p className="text-xs text-antigravity-light-muted dark:text-antigravity-dark-muted truncate flex items-center gap-1">
                                                <Mail size={12} />
                                                {user.email}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <code className="bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[9px] text-slate-500 font-mono tracking-tighter">
                                                    ID: {user.uid.substring(0, 8)}...
                                                </code>
                                                <button onClick={handleCopyId} className="text-antigravity-accent hover:opacity-70 transition-colors">
                                                    {copied ? <Check size={12} /> : <Copy size={12} />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Tabs Navigation */}
                                <div className="flex border-b border-antigravity-light-border dark:border-antigravity-dark-border px-4 bg-white dark:bg-antigravity-dark-surface sticky top-0 z-10">
                                    {[
                                        { id: 'general', label: 'General', icon: Settings },
                                        { id: 'messages', label: 'Mensajes', icon: MessageSquare },
                                        { id: 'audit', label: 'Auditoría', icon: History }
                                    ].map((tab) => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id as any)}
                                            className={clsx(
                                                "flex items-center gap-2 px-4 py-4 text-xs font-black uppercase tracking-widest transition-all relative",
                                                activeTab === tab.id
                                                    ? "text-antigravity-accent"
                                                    : "text-antigravity-light-muted dark:text-antigravity-dark-muted hover:text-antigravity-light-text dark:hover:text-antigravity-dark-text"
                                            )}
                                        >
                                            <tab.icon size={14} />
                                            {tab.label}
                                            {activeTab === tab.id && (
                                                <motion.div
                                                    layoutId="activeTabUnderline"
                                                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-antigravity-accent rounded-full"
                                                />
                                            )}
                                        </button>
                                    ))}
                                </div>

                                {/* Tab Content */}
                                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                                    {activeTab === 'general' && (
                                        <>
                                            {/* Plugins Section */}
                                            <section className="space-y-4">
                                                <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-antigravity-light-muted dark:text-antigravity-dark-muted">
                                                    <Activity size={14} />
                                                    Plataforma & Plugins
                                                </h4>
                                                <div className="grid gap-3">
                                                    {availablePlugins.map((plugin) => (
                                                        <div
                                                            key={plugin.key}
                                                            className="flex items-center justify-between p-4 rounded-2xl border border-antigravity-light-border dark:border-antigravity-dark-border bg-slate-50/50 dark:bg-white/5 transition-all hover:border-antigravity-accent/30"
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <span className="material-symbols-rounded text-antigravity-accent bg-antigravity-accent/10 p-2.5 rounded-xl text-xl">
                                                                    {plugin.icon}
                                                                </span>
                                                                <div>
                                                                    <p className="text-sm font-bold text-antigravity-light-text dark:text-antigravity-dark-text">{plugin.label}</p>
                                                                    <p className="text-[10px] text-antigravity-light-muted dark:text-antigravity-dark-muted leading-tight">Módulo de {plugin.label.toLowerCase()} activo.</p>
                                                                </div>
                                                            </div>
                                                            <M3Switch
                                                                checked={user.entitlements.pluginsEnabled?.includes(plugin.key) || false}
                                                                onChange={() => handlePluginClick(plugin)}
                                                                disabled={actionLoading === plugin.key}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            </section>

                                            {/* Danger Zone */}
                                            <section className="space-y-4 pt-4 border-t border-antigravity-light-border dark:border-antigravity-dark-border">
                                                <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-rose-500">
                                                    <ShieldAlert size={14} />
                                                    Zona de Peligro
                                                </h4>
                                                <div className="p-5 rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-900/5 space-y-5">
                                                    <div className="flex items-center justify-between gap-4">
                                                        <div className="flex-1">
                                                            <p className="text-sm font-bold text-antigravity-light-text dark:text-antigravity-dark-text">
                                                                {user.status === 'SUSPENDED' ? 'Reactivar Cuenta' : 'Suspender Cuenta'}
                                                            </p>
                                                            <p className="text-[10px] text-antigravity-light-muted dark:text-antigravity-dark-muted leading-tight mt-1">
                                                                {user.status === 'SUSPENDED'
                                                                    ? 'El usuario volverá a tener acceso inmediato.'
                                                                    : 'El usuario perderá acceso al sistema hasta ser reactivado.'}
                                                            </p>
                                                        </div>
                                                        <button
                                                            onClick={() => handleStatusUpdate(user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED')}
                                                            disabled={actionLoading !== null}
                                                            className={clsx(
                                                                "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center gap-2 shadow-sm",
                                                                user.status === 'SUSPENDED'
                                                                    ? "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95"
                                                                    : "bg-amber-500 text-white hover:bg-amber-600 active:scale-95"
                                                            )}
                                                        >
                                                            {actionLoading === 'SUSPENDED' || actionLoading === 'ACTIVE' ? (
                                                                <RefreshCw size={12} className="animate-spin" />
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
                                                            <p className="text-sm font-bold text-rose-600">Eliminar Cuenta</p>
                                                            <p className="text-[10px] text-antigravity-light-muted dark:text-antigravity-dark-muted leading-tight mt-1">
                                                                Desactivación permanente. El registro se conserva por auditoría.
                                                            </p>
                                                        </div>
                                                        <button
                                                            onClick={() => handleStatusUpdate('DELETED')}
                                                            disabled={actionLoading !== null}
                                                            className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white hover:bg-rose-700 active:scale-95 transition-all flex items-center gap-2 shadow-sm"
                                                        >
                                                            {actionLoading === 'DELETED' ? (
                                                                <RefreshCw size={12} className="animate-spin" />
                                                            ) : (
                                                                <>
                                                                    <Trash2 size={12} />
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
                                            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-antigravity-light-muted dark:text-antigravity-dark-muted">
                                                <MessageSquare size={14} />
                                                Comunicación Directa
                                            </div>

                                            <div className="space-y-6">
                                                <div className="space-y-3">
                                                    <label className="text-[10px] font-black text-antigravity-light-muted dark:text-antigravity-dark-muted uppercase tracking-widest ml-1">
                                                        Severidad
                                                    </label>
                                                    <div className="flex gap-2">
                                                        {(['info', 'warning', 'urgent'] as const).map((type) => (
                                                            <button
                                                                key={type}
                                                                onClick={() => setMsgType(type)}
                                                                className={clsx(
                                                                    "flex-1 py-3 px-3 rounded-2xl border text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm",
                                                                    msgType === type
                                                                        ? (type === 'info' ? "bg-antigravity-accent text-white border-transparent" :
                                                                            type === 'warning' ? "bg-amber-500 text-white border-transparent" :
                                                                                "bg-rose-600 text-white border-transparent")
                                                                        : "bg-transparent border-antigravity-light-border dark:border-antigravity-dark-border text-antigravity-light-muted dark:text-antigravity-dark-muted hover:border-slate-300"
                                                                )}
                                                            >
                                                                <Bell size={10} />
                                                                {type}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div className="space-y-3">
                                                    <label className="text-[10px] font-black text-antigravity-light-muted dark:text-antigravity-dark-muted uppercase tracking-widest ml-1">
                                                        Cuerpo del Mensaje
                                                    </label>
                                                    <textarea
                                                        value={msgBody}
                                                        onChange={(e) => setMsgBody(e.target.value)}
                                                        placeholder="Escribe el mensaje que aparecerá en el buzón del usuario..."
                                                        className="w-full h-40 p-5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-antigravity-light-border dark:border-antigravity-dark-border text-sm outline-none focus:border-antigravity-accent focus:ring-4 focus:ring-antigravity-accent/5 transition-all resize-none font-medium leading-relaxed"
                                                    />
                                                </div>

                                                <button
                                                    onClick={handleSendMessage}
                                                    disabled={!msgBody.trim() || actionLoading === 'sending_msg'}
                                                    className="w-full py-4 rounded-2xl bg-antigravity-accent text-white font-black text-sm flex items-center justify-center gap-2 shadow-[0_8px_30px_rgb(0,127,212,0.2)] hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:grayscale transition-all"
                                                >
                                                    {actionLoading === 'sending_msg' ? (
                                                        <RefreshCw size={18} className="animate-spin" />
                                                    ) : (
                                                        <>
                                                            <Send size={18} />
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
                                                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-antigravity-light-muted dark:text-antigravity-dark-muted">
                                                    <History size={14} />
                                                    Historial de Auditoría
                                                </div>
                                                <button
                                                    onClick={fetchAuditLogs}
                                                    className="p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl text-antigravity-accent transition-colors"
                                                    title="Refrescar"
                                                >
                                                    <RefreshCw size={14} className={auditLoading ? "animate-spin" : ""} />
                                                </button>
                                            </div>

                                            <div className="relative space-y-8 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-antigravity-light-border dark:before:bg-antigravity-dark-border">
                                                {auditLoading ? (
                                                    Array.from({ length: 4 }).map((_, i) => (
                                                        <div key={i} className="flex gap-4 animate-pulse ml-1">
                                                            <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 z-10" />
                                                            <div className="flex-1 space-y-2">
                                                                <div className="h-4 w-3/4 bg-slate-100 dark:bg-white/5 rounded" />
                                                                <div className="h-2 w-1/4 bg-slate-100 dark:bg-white/5 rounded" />
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : auditLogs.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
                                                        <AlertTriangle size={32} className="text-slate-300 dark:text-slate-800" />
                                                        <p className="text-xs text-antigravity-light-muted dark:text-antigravity-dark-muted italic">Sin registros de auditoría.</p>
                                                    </div>
                                                ) : auditLogs.map((log) => (
                                                    <div key={log.id} className="relative flex gap-5 ml-1">
                                                        <div className="w-5 h-5 rounded-full bg-antigravity-light-surface dark:bg-antigravity-dark-surface border-2 border-antigravity-accent flex items-center justify-center z-10 shadow-sm">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-antigravity-accent" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <p className="text-[11px] font-black text-antigravity-light-text dark:text-antigravity-dark-text uppercase tracking-tight">
                                                                    {log.action.replace(/_/g, ' ')}
                                                                </p>
                                                                <span className="text-[9px] font-bold text-antigravity-light-muted dark:text-antigravity-dark-muted flex items-center gap-1 bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
                                                                    <Clock size={8} />
                                                                    {log.timestamp instanceof Timestamp ? log.timestamp.toDate().toLocaleDateString() : 'Reciente'}
                                                                </span>
                                                            </div>
                                                            <p className="text-[10px] text-antigravity-light-muted dark:text-antigravity-dark-muted italic mt-0.5">
                                                                Admin: {log.adminUid.substring(0, 8)}...
                                                            </p>
                                                            {log.details && (
                                                                <div className="mt-2 p-3 rounded-xl bg-slate-100/50 dark:bg-white/5 border border-antigravity-light-border dark:border-antigravity-dark-border">
                                                                    <p className="text-[11px] text-antigravity-light-text dark:text-antigravity-dark-text leading-snug font-medium">
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
                                <RefreshCw size={32} className="animate-spin mb-4 opacity-20" />
                                <p className="text-xs font-bold uppercase tracking-widest opacity-40">Cargando credenciales...</p>
                            </div>
                        )}
                    </motion.div>

                    {/* Confirmation Modal - Rendered outside or on top */}
                    {pendingAction && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm font-atkinson"
                        >
                            <motion.div
                                initial={{ scale: 0.95, y: 10 }}
                                animate={{ scale: 1, y: 0 }}
                                className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-2xl p-6 border border-slate-200 dark:border-slate-800"
                            >
                                <div className="flex flex-col items-center text-center space-y-4">
                                    <div className={clsx(
                                        "w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-2",
                                        pendingAction.action === 'ACTIVATE'
                                            ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                                            : "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
                                    )}>
                                        <span className="material-symbols-rounded">
                                            {pendingAction.action === 'ACTIVATE' ? 'add_moderator' : 'remove_moderator'}
                                        </span>
                                    </div>

                                    <div>
                                        <h3 className="text-lg font-black text-slate-900 dark:text-white leading-tight">
                                            ¿{pendingAction.action === 'ACTIVATE' ? 'Habilitar' : 'Deshabilitar'} {pendingAction.label}?
                                        </h3>
                                        <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                                            Estás a punto de <strong className={pendingAction.action === 'ACTIVATE' ? "text-emerald-600" : "text-rose-500"}>
                                                {pendingAction.action === 'ACTIVATE' ? 'dar acceso' : 'revocar acceso'}
                                            </strong> al módulo de {pendingAction.label}. Esta acción se registrará en la auditoría.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 w-full pt-2">
                                        <button
                                            onClick={() => setPendingAction(null)}
                                            className="py-3 px-4 rounded-xl font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={confirmPluginAction}
                                            className={clsx(
                                                "py-3 px-4 rounded-xl font-bold text-white shadow-lg shadow-antigravity-accent/20 transition-transform active:scale-95",
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
                </>
            )}
        </AnimatePresence>
    );
};
