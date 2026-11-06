import React, { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { M3Switch } from '../common/M3Switch';
import { SYSTEM_MODULES } from '../../constants/modules';
import CopyButton from '../common/CopyButton';

interface StaffManagerProps {
    userId: string;
    userName: string;
    accountId?: string;
}

export const StaffManager: React.FC<StaffManagerProps> = ({ userId, userName, accountId }) => {
    const { currentAccount } = useAuth();
    const resolvedAccountId = accountId || currentAccount?.id || '';

    const [permissions, setPermissions] = useState<Record<string, boolean>>({
        opermaq: false,
        stockpile: false,
    });
    const [loading, setLoading] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [confirmKeyword, setConfirmKeyword] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        const loadMemberModules = async () => {
            if (!resolvedAccountId || !userId) return;
            setLoading(true);
            setDirty(false);
            setConfirmKeyword('');
            setMessage(null);
            setError(null);
            try {
                const snap = await getDoc(doc(db, 'accounts', resolvedAccountId, 'members', userId));
                if (!active) return;
                if (snap.exists()) {
                    const data = snap.data();
                    const map = data?.modulePermissions || {};
                    const list: string[] = Array.isArray(data?.allowedModules) ? data.allowedModules : [];
                    setPermissions({
                        opermaq: typeof map.opermaq === 'boolean' ? map.opermaq : list.includes('opermaq'),
                        stockpile: typeof map.stockpile === 'boolean' ? map.stockpile : list.includes('stockpile'),
                    });
                }
            } catch (err: any) {
                if (active) setError(err?.message || 'Error consultando permisos del colaborador.');
            } finally {
                if (active) setLoading(false);
            }
        };
        loadMemberModules();
        return () => {
            active = false;
        };
    }, [resolvedAccountId, userId]);

    const togglePermission = (moduleId: string) => {
        setPermissions(prev => ({
            ...prev,
            [moduleId]: !prev[moduleId]
        }));
        setDirty(true);
        setMessage(null);
    };

    const handlePersistPermissions = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!resolvedAccountId || !userId || confirmKeyword.trim() !== 'ACTUALIZAR') return;
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            const allowedModules = Object.entries(permissions)
                .filter(([, enabled]) => enabled)
                .map(([key]) => key);
            await updateDoc(doc(db, 'accounts', resolvedAccountId, 'members', userId), {
                modulePermissions: permissions,
                allowedModules,
                updatedAt: Date.now(),
            });
            setDirty(false);
            setConfirmKeyword('');
            setMessage('Permisos modulares guardados en Firestore.');
        } catch (err: any) {
            setError(err?.message || 'No se pudieron actualizar los permisos.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border border-[#E2E8F0] dark:border-[#12151C] rounded-none bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col h-full font-sans shadow-none">
            <div className="p-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                <h3 className="text-microcopy font-mono uppercase text-[#C68346] mb-1">Permisos por Modulo Nativo</h3>
                <p className="text-h2-section text-[#0F172A] dark:text-[#F3F4F6]">{userName || '[Colaborador seleccionado]'}</p>
                <div className="text-xs text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums mt-1 inline-flex items-center gap-1 select-text">
                    <span>ID: {userId}</span>
                    <CopyButton value={userId} title="Copiar ID colaborador" />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="p-fib-21 text-xs font-mono text-[#94A3B8] dark:text-[#5A6072]">
                        Consultando ficha de permisos...
                    </div>
                ) : (
                    <ul className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                        {SYSTEM_MODULES.map((mod) => (
                            <li key={mod.id} className="p-fib-21 flex items-start justify-between gap-fib-13">
                                <div>
                                    <h4 className="text-xs font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-wider mb-1">
                                        {mod.name}
                                    </h4>
                                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                                        {mod.description}
                                    </p>
                                </div>
                                <div className="pt-1 shrink-0">
                                    <M3Switch
                                        checked={Boolean(permissions[mod.id])}
                                        onChange={() => togglePermission(mod.id)}
                                    />
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {(error || message) && (
                <div className="px-fib-21 py-fib-8">
                    {error && (
                        <p className="text-xs font-mono text-red-600 dark:text-red-400">{error}</p>
                    )}
                    {message && (
                        <p className="text-xs font-mono text-[#00AEEF]">{message}</p>
                    )}
                </div>
            )}

            {dirty && (
                <form
                    onSubmit={handlePersistPermissions}
                    autoComplete="off"
                    spellCheck={false}
                    className="p-fib-21 border-t border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] space-y-fib-13"
                >
                    <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                        Escriba ACTUALIZAR para guardar permisos
                    </label>
                    <input
                        type="text"
                        required
                        autoComplete="off"
                        spellCheck={false}
                        value={confirmKeyword}
                        onChange={(e) => setConfirmKeyword(e.target.value.toUpperCase())}
                        placeholder="ACTUALIZAR"
                        className="w-full px-fib-13 py-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs font-mono tracking-widest text-center text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                    />
                    <button
                        type="submit"
                        disabled={confirmKeyword.trim() !== 'ACTUALIZAR' || saving}
                        className="w-full py-2 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-wider rounded-none border-0 cursor-pointer disabled:opacity-40"
                    >
                        {saving ? 'GUARDANDO...' : 'CONSOLIDAR PERMISOS'}
                    </button>
                </form>
            )}
        </div>
    );
};
