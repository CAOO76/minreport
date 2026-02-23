
import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { db, auth } from '../../config/firebase';
import { collection, query, where, getDocs, doc, updateDoc, limit } from 'firebase/firestore';
import { MinReport } from '@minreport/sdk';
import { UserPlus, CheckCircle, Smartphone, Mail, Briefcase } from 'lucide-react';

export const BillingManagementDashboard = () => {
    const { currentAccount } = useAuth();
    const [loading, setLoading] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        jobTitle: ''
    });

    // Feedback State
    const [success, setSuccess] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Si no hay cuenta, no mostrar nada (manejado por auth guard normalmente)
    if (!currentAccount) return null;

    const hasOperator = !!currentAccount.primaryOperator;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            // 1. Buscar si el usuario ya existe
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', formData.email), limit(1)); // [FIX] Add limit(1) per firestore rules
            const querySnapshot = await getDocs(q);

            let targetUid = null;
            // Always PENDING initially. InvitationHandler completes the link.
            const status: 'PENDING' = 'PENDING';

            if (!querySnapshot.empty) {
                // User exists
                const userDoc = querySnapshot.docs[0];
                targetUid = userDoc.id;
                console.log(`[B2B] Usuario existente ${targetUid} encontrado. Asignando como pendiente.`);
            } else {
                // User does not exist
                console.log(`[B2B] Usuario no encontrado. Invitación enviada a ${formData.email}.`);
            }

            // [CHANGE] Call backend to send real invitation email
            try {
                if (auth.currentUser) {
                    const token = await auth.currentUser.getIdToken();
                    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8085';

                    await fetch(`${apiUrl}/api/auth/invite`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            email: formData.email,
                            accountId: currentAccount.id,
                            companyName: currentAccount.name
                        })
                    });
                    console.log(`[B2B] Email de invitación enviado a ${formData.email}`);
                }
            } catch (inviteError) {
                console.error('[B2B] Error enviando email de invitación:', inviteError);
                // Non-blocking error
            }

            // 2. Actualizar la cuenta con el Operador Principal
            await updateDoc(doc(db, 'accounts', currentAccount.id), {
                primaryOperator: {
                    name: formData.name,
                    email: formData.email,
                    jobTitle: formData.jobTitle,
                    uid: targetUid || null, // [FIX] Use null instead of undefined for Firestore
                    status: status
                }
            });

            setSuccess('Solicitud de operador enviada. El usuario deberá ingresar para aceptar.');

            // Forzar recarga de página para ver cambios (o confiar en live updates de AuthContext si estuviera suscrito a account)
            // AuthContext escucha 'profile', pero 'primaryOperator' está en 'account'. 
            // Para simplicidad en este paso, mostraremos el estado de éxito.

        } catch (err) {
            console.error(err);
            setError('Error al procesar la solicitud. Intente nuevamente.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen industrial-mineral-gradient p-8 flex flex-col items-center relative overflow-hidden">
            <div className="absolute inset-0 technical-grid pointer-events-none opacity-10"></div>

            {/* Header */}
            <div className="w-full max-w-4xl mb-10 flex justify-between items-end border-b border-black/5 dark:border-white/5 pb-8 relative z-10">
                <div>
                    <h1 className="text-3xl font-black text-black dark:text-white uppercase tracking-tighter">
                        COMMERCIAL_CONTROL
                    </h1>
                    <p className="hud-label text-[10px] text-antigravity-accent mt-2">
                        {currentAccount.name}
                    </p>
                </div>
                <div className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-none hud-label text-[9px] border border-transparent flex items-center gap-3">
                    <CheckCircle size={14} />
                    SUBSCRIPTION_ACTIVE
                </div>
            </div>

            {hasOperator && !success ? (
                // VIEW MODE: Operador ya asignado
                <div className="w-full max-w-3xl bg-black/5 dark:bg-white/5 rounded-none border border-black/10 dark:border-white/10 overflow-hidden relative z-10 group">
                    <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity"></div>
                    <div className="p-6 border-b border-black/5 dark:border-white/5 flex justify-between items-center bg-black/5">
                        <h2 className="hud-label text-[10px] text-black/60 dark:text-white/60 flex items-center gap-3">
                            <Smartphone size={20} className="text-antigravity-accent" />
                            FINAL_OPERATIONAL_USER
                        </h2>
                        <span className={`px-3 py-1.5 rounded-none text-[9px] font-black uppercase tracking-widest border ${currentAccount.primaryOperator?.status === 'ACTIVE'
                            ? 'bg-black dark:bg-white text-white dark:text-black border-transparent'
                            : 'bg-transparent text-black/40 dark:text-white/30 border-black/10'
                            }`}>
                            {currentAccount.primaryOperator?.status === 'ACTIVE' ? 'STATUS: ACTIVE' : 'STATUS: PENDING_SYNC'}
                        </span>
                    </div>

                    <div className="p-8 space-y-4 relative z-10">
                        <div className="flex items-start gap-6">
                            <div className="w-14 h-14 rounded-none bg-black/5 dark:bg-white/10 flex items-center justify-center text-black/40 dark:text-white/40 font-black text-xl border border-black/5">
                                {currentAccount.primaryOperator?.name.charAt(0)}
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-black text-black dark:text-white uppercase tracking-tighter">
                                    {currentAccount.primaryOperator?.name}
                                </h3>
                                <p className="hud-label text-[10px] text-antigravity-accent mt-1">
                                    {currentAccount.primaryOperator?.jobTitle}
                                </p>
                                <div className="flex items-center gap-3 mt-4 text-[11px] font-bold text-black/40 dark:text-white/30 uppercase tracking-tight">
                                    <Mail size={14} />
                                    {currentAccount.primaryOperator?.email}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                // EDIT MODE: Formulario de Asignación
                <div className="w-full max-w-xl bg-black/5 dark:bg-white/5 rounded-none border border-black/10 dark:border-white/10 p-10 relative z-10 overflow-hidden group">
                    <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity"></div>
                    <div className="text-center mb-10 relative z-10">
                        <div className="w-16 h-16 bg-black dark:bg-white text-white dark:text-black rounded-none flex items-center justify-center mx-auto mb-6 border border-transparent">
                            <UserPlus size={32} />
                        </div>
                        <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tighter">DELEGATE_OPERATOR</h2>
                        <p className="hud-label text-[10px] text-black/40 dark:text-white/40 mt-3 leading-relaxed max-w-sm mx-auto">
                            AUTHORIZE_IDENTITY: RESPONSABLE DE LA OPERACIÓN PLATAFORMA (MAPS / REPORTS / SDK_PLUGINS).
                        </p>
                    </div>

                    {success ? (
                        <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-emerald-700 dark:text-emerald-300 text-center mb-6 border border-emerald-100 dark:border-emerald-800/50">
                            <CheckCircle className="mx-auto mb-2" />
                            <p className="font-semibold">{success}</p>
                            <button
                                onClick={() => window.location.reload()}
                                className="mt-4 text-xs font-bold underline hover:no-underline"
                            >
                                Actualizar vista
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-6 relative z-10" autoComplete="off">
                            <div className="space-y-2">
                                <label className="hud-label text-[9px] text-black/40 dark:text-white/40 ml-1">FULL_IDENTITY_NAME</label>
                                <input
                                    required
                                    type="text"
                                    autoComplete="off"
                                    spellCheck="false"
                                    data-lpignore="true"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-5 py-4 rounded-none bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-black dark:text-white placeholder:opacity-20 outline-none transition-all focus:border-black dark:focus:border-white"
                                    placeholder="IDENTITY_KEY"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="hud-label text-[9px] text-black/40 dark:text-white/40 ml-1">DELEGATED_POSITION</label>
                                <div className="relative">
                                    <input
                                        required
                                        type="text"
                                        autoComplete="off"
                                        spellCheck="false"
                                        data-lpignore="true"
                                        value={formData.jobTitle}
                                        onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                                        className="w-full px-5 py-4 rounded-none bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-black dark:text-white placeholder:opacity-20 outline-none transition-all focus:border-black dark:focus:border-white"
                                        placeholder="OPERATIONAL_ROLE"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="hud-label text-[9px] text-black/40 dark:text-white/40 ml-1">COMM_EMAIL_NODE</label>
                                <div className="relative">
                                    <input
                                        required
                                        type="email"
                                        autoComplete="off"
                                        spellCheck="false"
                                        data-lpignore="true"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full px-5 py-4 rounded-none bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-black dark:text-white placeholder:opacity-20 outline-none transition-all focus:border-black dark:focus:border-white"
                                        placeholder="NODE@SYSTEM.COM"
                                    />
                                </div>
                            </div>

                            {error && (
                                <p className="text-xs text-red-500 font-medium text-center">{error}</p>
                            )}

                            <MinReport.UI.SDKButton
                                type="submit"
                                variant="primary"
                                isLoading={loading}
                                className="w-full justify-center py-4 text-base"
                            >
                                Habilitar Acceso Operativo
                            </MinReport.UI.SDKButton>
                        </form>
                    )}
                </div>
            )}
        </div>
    );
};
