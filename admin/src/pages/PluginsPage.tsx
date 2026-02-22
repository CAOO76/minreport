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
    User,
    ShieldCheck,
    Cpu,
    ArrowUpRight,
    Zap
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
        <div className="space-y-12 animate-in fade-in duration-1000 pb-24">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-10">
                <div className="space-y-3">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-[2px] bg-antigravity-accent"></div>
                        <span className="hud-label !text-antigravity-accent italic">SYSTEM_MODULE_CATALOG</span>
                    </div>
                    <h1 className="text-5xl font-black text-black dark:text-white tracking-tighter m-0 uppercase italic flex items-center gap-4">
                        Core_Plugins
                    </h1>
                    <p className="text-black/50 dark:text-white/40 font-medium text-base max-w-xl leading-relaxed">
                        Control de despliegue de módulos periféricos y estados de validación QA.
                    </p>
                </div>

                <div className="flex gap-4">
                    <div className="p-4 glass-card flex items-center gap-4 border-black/5 dark:border-white/5">
                        <div className="w-10 h-10 bg-black/5 dark:bg-white/10 rounded-none flex items-center justify-center text-antigravity-accent">
                            <Cpu size={20} />
                        </div>
                        <div>
                            <div className="text-[9px] font-black text-black/30 dark:text-white/20 uppercase tracking-widest">Active_Molecules</div>
                            <div className="text-xl font-black text-black dark:text-white font-mono">{plugins.filter(p => p.status === 'OPERATIONAL').length}</div>
                        </div>
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {loading ? (
                    <div className="col-span-full py-24 text-center">
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-10 h-10 border-2 border-antigravity-accent border-t-transparent rounded-none animate-spin"></div>
                            <span className="hud-label animate-pulse italic">Scanning_Molecules...</span>
                        </div>
                    </div>
                ) : plugins.map((plugin) => (
                    <div
                        key={plugin.key}
                        className={clsx(
                            "group relative elite-tech-surface !rounded-none border transition-all duration-700 flex flex-col overflow-hidden",
                            plugin.status === 'OPERATIONAL'
                                ? "border-black/5 dark:border-white/5 shadow-2xl hover:shadow-antigravity-accent/10"
                                : "border-amber-500/20 bg-amber-500/[0.02] shadow-xl"
                        )}
                    >
                        <div className="absolute inset-0 technical-grid pointer-events-none opacity-10"></div>

                        {/* Status Glow */}
                        <div className={clsx(
                            "absolute top-0 left-0 w-full h-1 opacity-50",
                            plugin.status === 'OPERATIONAL' ? "bg-emerald-500" : "bg-amber-500"
                        )} />

                        <div className="p-10 flex-1 flex flex-col relative z-10">
                            <div className="flex justify-between items-start mb-8">
                                <div className="relative group/icon">
                                    <div className="absolute -inset-2 bg-antigravity-accent opacity-0 group-hover/icon:opacity-20 blur-md transition-opacity"></div>
                                    <div className="w-14 h-14 rounded-none bg-black dark:bg-white text-white dark:text-black flex items-center justify-center shadow-premium relative">
                                        <span className="material-symbols-rounded text-3xl">{plugin.icon}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-3">
                                    <div className={clsx(
                                        "px-4 py-1.5 rounded-none text-[9px] font-black uppercase tracking-[0.2em] border flex items-center gap-2 shadow-sm transition-all duration-500",
                                        plugin.status === 'OPERATIONAL'
                                            ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                            : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                    )}>
                                        <div className={clsx("w-1 h-1 rounded-none", plugin.status === 'OPERATIONAL' ? "bg-emerald-500" : "bg-amber-500")}></div>
                                        {plugin.status === 'OPERATIONAL' ? 'Operational' : 'Testing_Phase'}
                                    </div>
                                    <M3Switch
                                        checked={plugin.status === 'OPERATIONAL'}
                                        onChange={() => toggleStatus(plugin.key, plugin.status)}
                                    />
                                </div>
                            </div>

                            <div className="space-y-4 flex-1">
                                <h3 className="text-2xl font-black text-black dark:text-white uppercase tracking-tighter m-0 italic group-hover:text-antigravity-accent transition-colors">
                                    {plugin.label}
                                </h3>
                                <p className="text-[11px] font-bold text-black/50 dark:text-white/40 leading-relaxed uppercase tracking-widest leading-loose">
                                    {plugin.description}
                                </p>
                            </div>

                            <div className="mt-8 pt-8 border-t border-black/5 dark:border-white/5 space-y-6">
                                <div className="flex justify-between items-center px-1">
                                    <span className="hud-label !text-[10px] !text-black/30 dark:!text-white/20 flex items-center gap-2">
                                        <MessageSquarePlus size={12} />
                                        QA_Observations
                                    </span>
                                    <button
                                        onClick={() => setActiveObsPlugin(activeObsPlugin === plugin.key ? null : plugin.key)}
                                        className="w-8 h-8 rounded-none bg-black/5 dark:bg-white/5 hover:bg-antigravity-accent hover:text-white flex items-center justify-center text-black/40 dark:text-white/40 transition-all active:scale-90"
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    <AnimatePresence>
                                        {activeObsPlugin === plugin.key && (
                                            <motion.div
                                                initial={{ opacity: 0, y: -10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -10 }}
                                                className="flex gap-3"
                                            >
                                                <input
                                                    type="text"
                                                    value={newObservation}
                                                    onChange={(e) => setNewObservation(e.target.value)}
                                                    placeholder="Inject insight..."
                                                    autoComplete="off"
                                                    className="flex-1 bg-black/5 dark:bg-white/5 border border-transparent focus:border-antigravity-accent/50 rounded-none px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest outline-none transition-all placeholder:opacity-20"
                                                    onKeyDown={(e) => e.key === 'Enter' && addObservation(plugin.key)}
                                                />
                                                <button
                                                    onClick={() => addObservation(plugin.key)}
                                                    disabled={!newObservation.trim()}
                                                    className="bg-black dark:bg-white text-white dark:text-black px-4 rounded-none text-[10px] font-black uppercase tracking-widest disabled:opacity-30 shadow-lg active:scale-95 transition-all"
                                                >
                                                    Add
                                                </button>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    <div className="space-y-3 max-h-48 overflow-y-auto pr-3 custom-scrollbar">
                                        {plugin.observations && plugin.observations.length > 0 ? (
                                            plugin.observations.map((obs: any, idx: number) => (
                                                <div key={idx} className="p-4 rounded-none bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-2 group/obs transition-all hover:bg-antigravity-accent/[0.02]">
                                                    <p className="text-[10px] font-black text-black/60 dark:text-white/40 uppercase tracking-widest m-0 leading-relaxed italic">{obs.text}</p>
                                                    <div className="flex justify-between items-center text-[8px] font-black text-black/30 dark:text-white/20 uppercase font-mono italic">
                                                        <span className="flex items-center gap-1.5"><User size={10} className="text-antigravity-accent" /> {obs.author.split('@')[0]}</span>
                                                        <span className="flex items-center gap-1.5"><Calendar size={10} /> {obs.date?.seconds ? new Date(obs.date.seconds * 1000).toLocaleDateString() : new Date().toLocaleDateString()}</span>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="flex flex-col items-center py-6 opacity-10">
                                                <ShieldCheck size={24} />
                                                <span className="text-[8px] font-black uppercase tracking-[0.4em] mt-2">Zero_Incidents</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => (window.location.href = `/plugins/${plugin.key}`)}
                                className="mt-10 w-full py-4 rounded-none bg-antigravity-accent text-white font-black text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-3 shadow-premium hover:scale-105 active:scale-95 transition-all relative overflow-hidden italic"
                            >
                                <Zap size={14} className="fill-current" />
                                Invoke_Module
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <footer className="pt-12 border-t border-black/5 dark:border-white/5 flex flex-col md:flex-row justify-between gap-6 hud-label !text-[10px] !text-black/20 dark:!text-white/20">
                <div className="flex items-center gap-4">
                    <ShieldCheck className="text-emerald-500" size={14} />
                    MODULE_INTEGRITY_INDEX_STABLE_v8.4
                </div>
                <div className="italic tracking-widest uppercase">Encryption_Level: AES-256-INDUSTRIAL_CORE</div>
            </footer>
        </div>
    );
};
