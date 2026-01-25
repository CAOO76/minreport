
import React, { useEffect, useState } from 'react';
import {
    collection,
    getDocs,
    doc,
    updateDoc,
    arrayUnion,
    serverTimestamp,
    query,
    orderBy
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { Plugin } from '../types/admin';
import { M3Switch } from '../components/ui/M3Switch';
import {
    Puzzle,
    AlertTriangle,
    CheckCircle2,
    MessageSquarePlus,
    Plus,
    Trash2,
    Calendar,
    User
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

export const PluginsPage = () => {
    const { t } = useTranslation();
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeObsPlugin, setActiveObsPlugin] = useState<string | null>(null);
    const [newObservation, setNewObservation] = useState('');

    const fetchPlugins = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'plugins'), orderBy('label'));
            const snapshot = await getDocs(q);
            const list = snapshot.docs.map(d => ({ key: d.id, ...d.data() } as Plugin));
            setPlugins(list);
        } catch (error) {
            console.error("Error fetching plugins:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPlugins();
    }, []);

    const toggleStatus = async (key: string, currentStatus: 'OPERATIONAL' | 'TESTING') => {
        const newStatus = currentStatus === 'OPERATIONAL' ? 'TESTING' : 'OPERATIONAL';
        try {
            await updateDoc(doc(db, 'plugins', key), {
                status: newStatus,
                updatedAt: serverTimestamp()
            });
            setPlugins(prev => prev.map(p => p.key === key ? { ...p, status: newStatus } : p));
        } catch (error) {
            console.error("Error updating status:", error);
            alert("Error al actualizar estado");
        }
    };

    const addObservation = async (key: string) => {
        if (!newObservation.trim()) return;
        try {
            const obs = {
                id: crypto.randomUUID(),
                text: newObservation,
                date: new Date(),
                author: auth.currentUser?.email || 'Admin'
            };

            await updateDoc(doc(db, 'plugins', key), {
                observations: arrayUnion(obs)
            });

            setPlugins(prev => prev.map(p =>
                p.key === key
                    ? { ...p, observations: [...(p.observations || []), obs] }
                    : p
            ));
            setNewObservation('');
            setActiveObsPlugin(null);
        } catch (error) {
            console.error("Error adding observation:", error);
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto font-atkinson space-y-8">
            <header>
                <div className="flex items-center gap-2 text-antigravity-accent mb-2">
                    <Puzzle size={20} />
                    <span className="text-xs font-black uppercase tracking-widest">Sistema</span>
                </div>
                <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                    Gestión de Plugins
                </h1>
                <p className="text-slate-500 mt-1 max-w-2xl">
                    Administra el catálogo de módulos del ecosistema. Los plugins en estado
                    <span className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded text-xs font-bold mx-1 uppercase tracking-tigher">Testing</span>
                    no serán visibles para asignación de usuarios finales.
                </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    <div className="col-span-full py-20 text-center text-slate-400">Cargando módulos...</div>
                ) : plugins.map((plugin) => (
                    <div
                        key={plugin.key}
                        className={clsx(
                            "relative bg-white dark:bg-slate-900 border rounded-3xl overflow-hidden transition-all duration-300 flex flex-col",
                            plugin.status === 'OPERATIONAL'
                                ? "border-slate-200 dark:border-slate-800 shadow-sm"
                                : "border-amber-200 dark:border-amber-900/50 bg-amber-50/30 dark:bg-amber-900/5"
                        )}
                    >
                        {/* Status Strip */}
                        <div className={clsx(
                            "h-1.5 w-full",
                            plugin.status === 'OPERATIONAL' ? "bg-emerald-500" : "bg-amber-500"
                        )} />

                        <div className="p-6 flex-1 flex flex-col">
                            <div className="flex justify-between items-start mb-4">
                                <div className="w-12 h-12 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 flex items-center justify-center text-slate-600 dark:text-slate-300">
                                    <span className="material-symbols-rounded text-2xl">{plugin.icon}</span>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <span className={clsx(
                                        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border flex items-center gap-1",
                                        plugin.status === 'OPERATIONAL'
                                            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                            : "bg-amber-50 border-amber-200 text-amber-700"
                                    )}>
                                        {plugin.status === 'OPERATIONAL' ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                                        {plugin.status === 'OPERATIONAL' ? 'Operativo' : 'Pruebas'}
                                    </span>
                                    <M3Switch
                                        checked={plugin.status === 'OPERATIONAL'}
                                        onChange={() => toggleStatus(plugin.key, plugin.status)}
                                    />
                                </div>
                            </div>

                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{plugin.label}</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6 flex-1">
                                {plugin.description}
                            </p>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
                                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5">
                                        <MessageSquarePlus size={12} />
                                        Observaciones de QA
                                    </span>
                                    <button
                                        onClick={() => setActiveObsPlugin(activeObsPlugin === plugin.key ? null : plugin.key)}
                                        className="w-6 h-6 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 flex items-center justify-center text-slate-400 transition-colors"
                                    >
                                        <Plus size={14} />
                                    </button>
                                </div>

                                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                    {activeObsPlugin === plugin.key && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            className="flex gap-2 mb-3"
                                        >
                                            <input
                                                type="text"
                                                value={newObservation}
                                                onChange={(e) => setNewObservation(e.target.value)}
                                                placeholder="Agregar nota..."
                                                className="flex-1 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-antigravity-accent"
                                                onKeyDown={(e) => e.key === 'Enter' && addObservation(plugin.key)}
                                            />
                                            <button
                                                onClick={() => addObservation(plugin.key)}
                                                disabled={!newObservation.trim()}
                                                className="bg-antigravity-accent text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
                                            >
                                                Ok
                                            </button>
                                        </motion.div>
                                    )}

                                    {plugin.observations && plugin.observations.length > 0 ? (
                                        plugin.observations.map((obs: any, idx: number) => (
                                            <div key={idx} className="bg-slate-50 dark:bg-white/5 p-2 rounded-lg border border-slate-100 dark:border-white/5 text-xs">
                                                <p className="text-slate-700 dark:text-slate-300 font-medium">{obs.text}</p>
                                                <div className="flex justify-between mt-1.5 text-[9px] text-slate-400">
                                                    <span className="flex items-center gap-1"><User size={8} /> {obs.author.split('@')[0]}</span>
                                                    <span className="flex items-center gap-1"><Calendar size={8} /> {obs.date?.seconds ? new Date(obs.date.seconds * 1000).toLocaleDateString() : new Date().toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-4 relative">
                                            <div className="absolute inset-x-0 top-1/2 h-px bg-slate-100 dark:bg-white/5" />
                                            <span className="relative bg-white dark:bg-slate-900 px-2 text-[10px] text-slate-300 font-medium">Sin registros</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
