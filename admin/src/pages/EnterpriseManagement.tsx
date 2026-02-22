import { useEffect, useState } from 'react';
import { getAccounts } from '../services/api';
import { useTranslation } from 'react-i18next';
import { Building, Users, AlertTriangle, ArrowRight, Activity, ShieldCheck, Globe, Database } from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';

interface Account {
    id: string;
    name: string;
    type: string;
    rut?: string;
    status?: string;
    ownerId: string;
    createdAt: string;
}

export const EnterpriseManagement = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadAccounts();
    }, []);

    const loadAccounts = async () => {
        try {
            const { data } = await getAccounts('ENTERPRISE');
            setAccounts(data);
        } catch (error) {
            console.error('Error loading enterprise accounts:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-12 animate-in fade-in duration-1000">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div className="space-y-3">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-[2px] bg-antigravity-accent"></div>
                        <span className="hud-label !text-antigravity-accent italic">B2B_OPERATIONS_CONTROL</span>
                    </div>
                    <h1 className="text-5xl font-black text-black dark:text-white tracking-tighter m-0 uppercase italic flex items-center gap-4">
                        Enterprise_Nodes
                    </h1>
                    <p className="text-black/50 dark:text-white/40 font-medium text-base max-w-xl leading-relaxed">
                        Administración de infraestructuras corporativas y protocolos de membresía B2B.
                    </p>
                </div>

                <div className="flex gap-4">
                    <div className="p-4 glass-card flex items-center gap-4 border-black/5 dark:border-white/5">
                        <div className="w-10 h-10 bg-black/5 dark:bg-white/10 rounded-none flex items-center justify-center text-antigravity-accent">
                            <Building size={20} />
                        </div>
                        <div>
                            <div className="text-[9px] font-black text-black/30 dark:text-white/20 uppercase tracking-widest">Active_Nodes</div>
                            <div className="text-xl font-black text-black dark:text-white font-mono">{accounts.length}</div>
                        </div>
                    </div>
                </div>
            </header>

            <div className="elite-tech-surface rounded-none shadow-3xl overflow-hidden border-black/5 dark:border-white/5 relative">
                <div className="absolute inset-0 technical-grid pointer-events-none opacity-20"></div>

                <table className="w-full text-left border-collapse relative z-10">
                    <thead>
                        <tr className="bg-black/5 dark:bg-white/5 border-b border-black/10 dark:border-white/10">
                            <th className="px-10 py-6 hud-label">Tax_Identifier</th>
                            <th className="px-10 py-6 hud-label">Corporate_Legacy_Name</th>
                            <th className="px-10 py-6 hud-label">Status_Protocol</th>
                            <th className="px-10 py-6 hud-label">Deployment_Date</th>
                            <th className="px-10 py-6 hud-label text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/5">
                        {loading ? (
                            <tr>
                                <td colSpan={5} className="px-10 py-24 text-center">
                                    <div className="flex flex-col items-center gap-4">
                                        <div className="w-8 h-8 border-2 border-antigravity-accent border-t-transparent rounded-none animate-spin"></div>
                                        <span className="hud-label animate-pulse">Scanning_Nodes...</span>
                                    </div>
                                </td>
                            </tr>
                        ) : accounts.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-10 py-24 text-center">
                                    <div className="flex flex-col items-center gap-4 opacity-30">
                                        <Database size={48} />
                                        <span className="hud-label">NULL_INVENTORY_DETECTED</span>
                                    </div>
                                </td>
                            </tr>
                        ) : accounts.map((account) => (
                            <tr key={account.id} className="group hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                                <td className="px-10 py-6">
                                    <div className="text-sm font-black text-black/40 dark:text-white/30 font-mono tracking-widest">
                                        {account.rut || 'UNDEFINED_RUT'}
                                    </div>
                                </td>
                                <td className="px-10 py-6">
                                    <div className="flex flex-col">
                                        <span className="text-base font-black text-black dark:text-white uppercase tracking-tight group-hover:text-antigravity-accent transition-colors italic">
                                            {account.name}
                                        </span>
                                        <span className="text-[10px] font-black text-black/20 dark:text-white/10 italic">NODEID_{account.id.slice(0, 8).toUpperCase()}</span>
                                    </div>
                                </td>
                                <td className="px-10 py-6">
                                    <div className={clsx(
                                        "inline-flex items-center gap-2 px-4 py-1.5 rounded-none text-[10px] font-black uppercase tracking-[0.2em] border shadow-premium transition-all duration-500",
                                        (!account.status || account.status === 'ACTIVE') && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                                        account.status === 'SUSPENDED' && "bg-amber-500/10 text-amber-600 border-amber-500/20",
                                        account.status === 'LOCKED' && "bg-rose-500/10 text-rose-600 border-rose-500/20"
                                    )}>
                                        <div className={clsx(
                                            "w-1.5 h-1.5 rounded-none animate-pulse",
                                            (!account.status || account.status === 'ACTIVE') ? "bg-emerald-500" : account.status === 'SUSPENDED' ? "bg-amber-500" : "bg-rose-500"
                                        )}></div>
                                        {account.status || 'ACTIVE_LINK'}
                                    </div>
                                </td>
                                <td className="px-10 py-6">
                                    <div className="flex items-center gap-3 text-sm font-bold text-black/40 dark:text-white/40 italic">
                                        <Globe size={14} className="opacity-30" />
                                        {new Date(account.createdAt).toLocaleDateString()}
                                    </div>
                                </td>
                                <td className="px-10 py-6 text-right">
                                    <button
                                        onClick={() => navigate(`/enterprises/${account.id}`)}
                                        className="h-10 px-6 rounded-none bg-black dark:bg-white text-white dark:text-black font-black text-[10px] uppercase tracking-widest hover:scale-110 active:scale-90 transition-all shadow-lg hover:shadow-antigravity-accent/20 flex items-center gap-2 ml-auto"
                                    >
                                        Execute_Control
                                        <ArrowRight size={14} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <footer className="pt-12 border-t border-black/5 dark:border-white/5 flex flex-col md:flex-row justify-between gap-6 hud-label !text-[10px] !text-black/20 dark:!text-white/20">
                <div className="flex items-center gap-4">
                    <ShieldCheck className="text-emerald-500" size={14} />
                    ENTERPRISE_NODE_SYNCHRONIZATION_STABLE
                </div>
                <div className="italic tracking-widest uppercase">Encryption_Level: AES-256-INDUSTRIAL</div>
            </footer>
        </div>
    );
};
