import React, { useCallback, useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { StaffService } from '../../services/StaffService';
import { StaffManager } from '../../components/b2b/StaffManager';
import { formatRut } from '../../utils/rut';
import CopyButton from '../../components/common/CopyButton';

interface MemberRecord {
    id: string;
    userId?: string;
    fullName?: string;
    name?: string;
    lastName?: string;
    run?: string;
    email?: string;
    role?: string;
    status?: string;
}

const MISSING_INFO = '[Información técnica no declarada en ficha]';

export const GeneralAdminDashboard: React.FC = () => {
    const { currentAccount } = useAuth();

    const [staff, setStaff] = useState<MemberRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        lastName: '',
        run: '',
        email: '',
        role: 'OPERATOR'
    });

    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [hitlPrompt, setHitlPrompt] = useState<{
        action: 'CREATE' | 'TOGGLE' | 'REVOKE';
        member?: MemberRecord;
    } | null>(null);
    const [confirmKeyword, setConfirmKeyword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const loadMembers = useCallback(async () => {
        if (!currentAccount?.id) return;
        setLoading(true);
        setErrorMsg(null);
        try {
            const list = await StaffService.getAccountMembers(currentAccount.id);
            setStaff(list);
        } catch (err: any) {
            setErrorMsg(err?.message || 'Error consultando miembros de la cuenta.');
        } finally {
            setLoading(false);
        }
    }, [currentAccount?.id]);

    useEffect(() => {
        loadMembers();
    }, [loadMembers]);

    const handleRequestCreate = (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);
        setStatusMsg(null);
        setConfirmKeyword('');
        setHitlPrompt({ action: 'CREATE' });
    };

    const executeConfirmedMutation = async () => {
        if (!currentAccount || !hitlPrompt || confirmKeyword.trim() !== 'ACTUALIZAR') return;
        setSubmitting(true);
        setErrorMsg(null);
        setStatusMsg(null);

        try {
            if (hitlPrompt.action === 'CREATE') {
                const fullName = `${formData.name.trim()} ${formData.lastName.trim()}`.trim();
                const res = await StaffService.recruitWorker(
                    currentAccount.id,
                    {
                        run: formData.run,
                        fullName,
                        email: formData.email,
                        jobProfileId: formData.role,
                    },
                    currentAccount.name || 'Organizacion B2B'
                );
                if (!res.success) {
                    throw new Error(res.error || 'No se pudo acreditar al colaborador.');
                }
                setFormData({ name: '', lastName: '', run: '', email: '', role: 'OPERATOR' });
                setStatusMsg('Colaborador vinculado correctamente en el padron de la empresa.');
            } else if (hitlPrompt.action === 'TOGGLE' && hitlPrompt.member) {
                const nextStatus = hitlPrompt.member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
                await updateDoc(doc(db, 'accounts', currentAccount.id, 'members', hitlPrompt.member.id), {
                    status: nextStatus,
                    updatedAt: Date.now(),
                });
                setStatusMsg(`Estado de colaborador actualizado a ${nextStatus}.`);
            } else if (hitlPrompt.action === 'REVOKE' && hitlPrompt.member) {
                const ok = await StaffService.removeMember(currentAccount.id, hitlPrompt.member.id);
                if (!ok) {
                    throw new Error('No se pudo revocar el miembro seleccionado.');
                }
                if (selectedUserId === hitlPrompt.member.id) {
                    setSelectedUserId(null);
                }
                setStatusMsg('Acceso de colaborador revocado.');
            }
            setHitlPrompt(null);
            setConfirmKeyword('');
            await loadMembers();
        } catch (err: any) {
            setErrorMsg(err?.message || 'Error ejecutando operacion sobre personal.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!currentAccount) return null;

    const selectedMember = staff.find((s) => s.id === selectedUserId);

    return (
        <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] p-fib-34 font-sans select-none">
            <div className="mb-fib-34 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21 flex justify-between items-end">
                <div>
                    <h1 className="text-h1-header uppercase">Padron de Personal Operativo</h1>
                    <p className="text-xs text-[#475569] dark:text-[#8A93A6] font-mono mt-1">
                        {currentAccount.name}
                    </p>
                </div>
                <div className="text-right">
                    <span className="text-microcopy uppercase text-[#C68346] font-mono block">Personal Activo</span>
                    <p className="text-kpi-display font-mono tabular-nums mt-1">
                        {staff.filter(s => s.status === 'ACTIVE').length}
                    </p>
                </div>
            </div>

            {errorMsg && (
                <div className="mb-fib-21 p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono rounded-none">
                    {errorMsg}
                </div>
            )}
            {statusMsg && (
                <div className="mb-fib-21 p-fib-13 bg-[#00AEEF]/10 border border-[#00AEEF]/30 text-[#00AEEF] text-xs font-mono rounded-none">
                    {statusMsg}
                </div>
            )}

            {/* Formulario de Alta */}
            <div className="border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] mb-fib-34 shadow-none">
                <h2 className="text-microcopy font-mono uppercase text-[#C68346] mb-fib-21">Acreditar Nuevo Personal</h2>

                <form onSubmit={handleRequestCreate} autoComplete="off" spellCheck={false} className="flex flex-col lg:flex-row gap-fib-13 items-end">
                    <div className="flex-1 w-full">
                        <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-1">Nombre</label>
                        <input
                            required
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-3 py-2 text-xs font-sans focus:outline-none focus:border-[#C68346] rounded-none"
                        />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-1">Apellidos</label>
                        <input
                            required
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={formData.lastName}
                            onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                            className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-3 py-2 text-xs font-sans focus:outline-none focus:border-[#C68346] rounded-none"
                        />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-1">RUN</label>
                        <input
                            required
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            value={formData.run}
                            onChange={e => setFormData({ ...formData, run: formatRut(e.target.value) })}
                            className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-3 py-2 text-xs font-mono tabular-nums focus:outline-none focus:border-[#C68346] rounded-none select-text"
                        />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-1">Correo Corporativo</label>
                        <input
                            required
                            type="email"
                            autoComplete="off"
                            spellCheck={false}
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#C68346] rounded-none select-text"
                        />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-1">Rol Operativo</label>
                        <select
                            required
                            value={formData.role}
                            onChange={e => setFormData({ ...formData, role: e.target.value })}
                            className="w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#C68346] rounded-none cursor-pointer"
                        >
                            <option value="OPERATOR">OPERATOR</option>
                            <option value="SUPERVISOR">SUPERVISOR</option>
                            <option value="VIEWER">VIEWER</option>
                        </select>
                    </div>
                    <button
                        type="submit"
                        className="w-full lg:w-auto bg-[#C68346] hover:bg-[#B0743E] text-white font-mono font-bold uppercase tracking-wider text-xs py-2.5 px-fib-21 transition-colors rounded-none border-0 cursor-pointer"
                    >
                        Acreditar
                    </button>
                </form>
            </div>

            {/* Macro-Layout Proporcion Aurea (61.8% / 38.2%) */}
            <div className="flex flex-col lg:flex-row gap-fib-21">
                <div className="w-full lg:w-[61.8%]">
                    <div className="flex items-center justify-between mb-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] pb-2">
                        <h2 className="text-h2-section uppercase">Nomina Registrada en Firestore</h2>
                        <button
                            type="button"
                            onClick={loadMembers}
                            title="Recargar nomina"
                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                        >
                            <span className="material-symbols-outlined text-[18px]">refresh</span>
                        </button>
                    </div>

                    <div className="border border-[#E2E8F0] dark:border-[#12151C] rounded-none overflow-x-auto bg-[#F8FAFC] dark:bg-[#07090D]">
                        <table className="w-full text-left border-collapse font-mono text-data-dense tabular-nums">
                            <thead>
                                <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-microcopy uppercase text-[#475569] dark:text-[#8A93A6]">
                                    <th className="py-3 px-4">RUN</th>
                                    <th className="py-3 px-4">Colaborador</th>
                                    <th className="py-3 px-4">Rol</th>
                                    <th className="py-3 px-4">Estado</th>
                                    <th className="py-3 px-4 text-right">Accion</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#12151C]">
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                            Consultando accounts/{currentAccount.id}/members...
                                        </td>
                                    </tr>
                                ) : staff.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="py-fib-34 text-center text-[#94A3B8] dark:text-[#5A6072]">
                                            [Sin trabajadores registrados en esta cuenta]
                                        </td>
                                    </tr>
                                ) : (
                                    staff.map((member) => {
                                        const displayName = member.fullName || `${member.name || ''} ${member.lastName || ''}`.trim() || MISSING_INFO;
                                        return (
                                            <tr
                                                key={member.id}
                                                onClick={() => setSelectedUserId(member.id)}
                                                className={`cursor-pointer transition-colors ${
                                                    selectedUserId === member.id
                                                        ? 'bg-[#C68346]/10'
                                                        : 'hover:bg-[#FFFFFF] dark:hover:bg-[#000000]'
                                                }`}
                                            >
                                                <td className="py-3 px-4">
                                                    {member.run ? (
                                                        <span className="inline-flex items-center gap-1 select-text">
                                                            <span>{member.run}</span>
                                                            <CopyButton value={member.run} title="Copiar RUN" />
                                                        </span>
                                                    ) : (
                                                        <span className="text-[#94A3B8] dark:text-[#5A6072]">{MISSING_INFO}</span>
                                                    )}
                                                </td>
                                                <td className="py-3 px-4">
                                                    <p className="font-sans font-semibold text-xs text-[#0F172A] dark:text-[#F3F4F6]">{displayName}</p>
                                                    <span className="inline-flex items-center gap-1 text-[11px] text-[#475569] dark:text-[#8A93A6] select-text">
                                                        <span>{member.email || MISSING_INFO}</span>
                                                        {member.email && <CopyButton value={member.email} title="Copiar correo" />}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 text-xs uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {member.role || 'OPERATOR'}
                                                </td>
                                                <td className="py-3 px-4">
                                                    <span className="text-microcopy uppercase text-[#00AEEF]">
                                                        {member.status || 'PENDING'}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 text-right space-x-3">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setConfirmKeyword('');
                                                            setHitlPrompt({ action: 'TOGGLE', member });
                                                        }}
                                                        className="bg-transparent border-0 text-xs font-mono uppercase text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] cursor-pointer"
                                                    >
                                                        {member.status === 'ACTIVE' ? 'Suspender' : 'Activar'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setConfirmKeyword('');
                                                            setHitlPrompt({ action: 'REVOKE', member });
                                                        }}
                                                        className="bg-transparent border-0 text-xs font-mono uppercase text-red-500 hover:text-red-600 cursor-pointer"
                                                    >
                                                        Revocar
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Area Menor (38.2%) */}
                <div className="w-full lg:w-[38.2%]">
                    {selectedUserId && selectedMember ? (
                        <StaffManager
                            userId={selectedUserId}
                            userName={selectedMember.fullName || selectedMember.email || selectedUserId}
                            accountId={currentAccount.id}
                        />
                    ) : (
                        <div className="border border-[#E2E8F0] dark:border-[#12151C] h-full min-h-[320px] flex flex-col items-center justify-center p-fib-34 text-center bg-[#F8FAFC] dark:bg-[#07090D] rounded-none">
                            <span className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-2">
                                Gobernanza de Acceso Modular
                            </span>
                            <p className="text-xs text-[#94A3B8] dark:text-[#5A6072]">
                                Seleccione un colaborador en la tabla principal (61.8%) para inspeccionar y modificar sus permisos por modulo.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {hitlPrompt && (
                <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-fib-21">
                    <div className="w-full max-w-md bg-[#FFFFFF] dark:bg-[#07090D] border border-[#C68346] p-fib-21 space-y-fib-13 rounded-none shadow-none">
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-2">
                            <span className="text-microcopy font-mono uppercase text-[#C68346]">
                                CONFIRMACION HITL OBLIGATORIA
                            </span>
                            <button
                                type="button"
                                onClick={() => setHitlPrompt(null)}
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>
                        <p className="text-xs font-mono text-[#475569] dark:text-[#8A93A6]">
                            Escriba obligatoriamente <strong className="text-[#C68346]">ACTUALIZAR</strong> para ejecutar la modificacion sobre el padron de personal:
                        </p>
                        <input
                            type="text"
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                            value={confirmKeyword}
                            onChange={(e) => setConfirmKeyword(e.target.value.toUpperCase())}
                            placeholder="ACTUALIZAR"
                            className="w-full px-3 py-2 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-xs font-mono tracking-widest text-center rounded-none outline-none"
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setHitlPrompt(null)}
                                className="px-4 py-2 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-xs font-mono uppercase rounded-none cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={confirmKeyword.trim() !== 'ACTUALIZAR' || submitting}
                                onClick={executeConfirmedMutation}
                                className="px-5 py-2 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase rounded-none border-0 cursor-pointer disabled:opacity-40"
                            >
                                {submitting ? 'EJECUTANDO...' : 'CONFIRMAR'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
