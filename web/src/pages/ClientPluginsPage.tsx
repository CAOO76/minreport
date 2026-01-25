import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { Plugin } from '../../../admin/src/types/admin'; // Importing common type if possible, or redefine locally
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

// Re-defining interface locally to avoid monorepo path complexities if not set up
interface ClientPlugin {
    key: string;
    label: string;
    icon: string;
    description: string;
}

export const ClientPluginsPage = () => {
    const { t } = useTranslation();
    const [plugins, setPlugins] = useState<ClientPlugin[]>([]);
    const [loading, setLoading] = useState(true);
    const [activePlugin, setActivePlugin] = useState<ClientPlugin | null>(null);

    useEffect(() => {
        const fetchPlugins = async () => {
            if (!auth.currentUser) return;

            try {
                // 1. Get User Entitlements
                const userRef = doc(db, 'users', auth.currentUser.uid);
                const userSnap = await getDoc(userRef);

                if (userSnap.exists()) {
                    const userData = userSnap.data();
                    const enabledKeys: string[] = userData.entitlements?.pluginsEnabled || [];

                    if (enabledKeys.length > 0) {
                        // 2. Fetch Plugin Details (only enabled ones)
                        // In a real app we might cache this or fetch all active and filter
                        const pluginsInfo: ClientPlugin[] = [];

                        // Optimize: Fetch all operational plugins and filter in memory since 'in' query is limited to 10
                        const q = query(collection(db, 'plugins'), where('status', '==', 'OPERATIONAL'));
                        const querySnapshot = await getDocs(q);

                        querySnapshot.forEach((doc) => {
                            if (enabledKeys.includes(doc.id)) {
                                pluginsInfo.push({ key: doc.id, ...doc.data() } as ClientPlugin);
                            }
                        });

                        setPlugins(pluginsInfo);
                    }
                }
            } catch (error) {
                console.error("Error loading plugins:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchPlugins();
    }, []);

    // Full Screen / Immersive Mode
    if (activePlugin) {
        return (
            <div className="flex flex-col h-full bg-antigravity-light-surface dark:bg-antigravity-dark-surface rounded-3xl overflow-hidden shadow-2xl border border-antigravity-light-border dark:border-antigravity-dark-border">
                {/* Immersive Header */}
                <div className="h-16 px-6 border-b border-antigravity-light-border dark:border-antigravity-dark-border flex items-center justify-between bg-white dark:bg-black/20">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setActivePlugin(null)}
                            className="p-2 hover:bg-antigravity-light-bg dark:hover:bg-antigravity-dark-bg rounded-xl transition-colors text-antigravity-light-muted dark:text-antigravity-dark-muted"
                        >
                            <span className="material-symbols-rounded">arrow_back</span>
                        </button>
                        <div className="flex items-center gap-3 pr-4 border-r border-antigravity-light-border dark:border-antigravity-dark-border">
                            <span className="material-symbols-rounded text-antigravity-accent">{activePlugin.icon}</span>
                            <h2 className="text-lg font-bold text-antigravity-light-text dark:text-antigravity-dark-text">{activePlugin.label}</h2>
                        </div>
                        <span className="text-xs font-medium text-antigravity-light-muted dark:text-antigravity-dark-muted hidden sm:block">
                            {activePlugin.description}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Mock Toolbar Actions */}
                        <button className="p-2 text-antigravity-light-muted hover:text-antigravity-light-text transition-colors">
                            <span className="material-symbols-rounded">settings</span>
                        </button>
                    </div>
                </div>

                {/* Immersive Content Area */}
                <div className="flex-1 p-8 overflow-y-auto bg-slate-50 dark:bg-antigravity-dark-bg/50 flex flex-col items-center justify-center text-center">
                    <div className="w-24 h-24 rounded-3xl bg-antigravity-accent/10 flex items-center justify-center text-antigravity-accent mb-6">
                        <span className="material-symbols-rounded text-5xl">{activePlugin.icon}</span>
                    </div>
                    <h1 className="text-3xl font-black text-antigravity-light-text dark:text-antigravity-dark-text mb-2">
                        Bienvenido a {activePlugin.label}
                    </h1>
                    <p className="text-antigravity-light-muted dark:text-antigravity-dark-muted max-w-lg mb-8">
                        Este espacio de trabajo está dedicado exclusivamente a las funciones de {activePlugin.label.toLowerCase()}. Aquí se cargarían los dashboards y herramientas específicas.
                    </p>
                    <button className="px-6 py-3 rounded-xl bg-antigravity-accent text-white font-bold shadow-lg shadow-antigravity-accent/20 hover:scale-105 transition-transform">
                        Iniciar Operación
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 font-atkinson">
            <header>
                <h1 className="text-3xl font-black text-antigravity-light-text dark:text-antigravity-dark-text tracking-tight mb-2">
                    Mis Aplicaciones
                </h1>
                <p className="text-antigravity-light-muted dark:text-antigravity-dark-muted">
                    Accede a tus módulos y herramientas habilitadas.
                </p>
            </header>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-48 rounded-3xl bg-antigravity-light-border dark:bg-antigravity-dark-border animate-pulse opacity-10" />
                    ))}
                </div>
            ) : plugins.length === 0 ? (
                <div className="py-20 text-center rounded-3xl border-2 border-dashed border-antigravity-light-border dark:border-antigravity-dark-border opacity-50">
                    <span className="material-symbols-rounded text-4xl mb-4 text-antigravity-light-muted">apps_off</span>
                    <p className="font-bold text-antigravity-light-text dark:text-antigravity-dark-text">No tienes aplicaciones activas</p>
                    <p className="text-sm text-antigravity-light-muted">Contacta a tu administrador para habilitar acceso.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {plugins.map((plugin) => (
                        <motion.div
                            key={plugin.key}
                            whileHover={{ y: -5 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setActivePlugin(plugin)}
                            className="group cursor-pointer p-6 rounded-3xl bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-antigravity-light-border dark:border-antigravity-dark-border hover:border-antigravity-accent/30 hover:shadow-xl hover:shadow-antigravity-accent/5 transition-all flex flex-col justify-between h-56"
                        >
                            <div className="flex justify-between items-start">
                                <div className="w-14 h-14 rounded-2xl bg-antigravity-light-bg dark:bg-white/5 flex items-center justify-center text-antigravity-accent text-3xl group-hover:bg-antigravity-accent group-hover:text-white transition-colors">
                                    <span className="material-symbols-rounded">{plugin.icon}</span>
                                </div>
                                <div className="w-8 h-8 rounded-full border border-antigravity-light-border dark:border-antigravity-dark-border flex items-center justify-center text-antigravity-light-muted group-hover:border-antigravity-accent group-hover:text-antigravity-accent transition-colors">
                                    <span className="material-symbols-rounded text-sm">arrow_outward</span>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-lg font-bold text-antigravity-light-text dark:text-antigravity-dark-text mb-1 group-hover:text-antigravity-accent transition-colors">
                                    {plugin.label}
                                </h3>
                                <p className="text-xs text-antigravity-light-muted dark:text-antigravity-dark-muted line-clamp-2 leading-relaxed">
                                    {plugin.description}
                                </p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}
        </div>
    );
};
