
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
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 flex flex-col items-center">

            {/* Header */}
            <div className="w-full max-w-3xl mb-8 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Gestión Comercial
                    </h1>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                        {currentAccount.name}
                    </p>
                </div>
                <div className="px-3 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full text-xs font-bold uppercase tracking-wide flex items-center gap-2">
                    <CheckCircle size={14} />
                    Suscripción Activa
                </div>
            </div>

            {hasOperator && !success ? (
                // VIEW MODE: Operador ya asignado
                <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                            <Smartphone size={20} className="text-indigo-500" />
                            Usuario Operativo Final
                        </h2>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${currentAccount.primaryOperator?.status === 'ACTIVE'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                            }`}>
                            {currentAccount.primaryOperator?.status === 'ACTIVE' ? 'Activo' : 'Invitación Enviada'}
                        </span>
                    </div>

                    <div className="p-6 space-y-4">
                        <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xl">
                                {currentAccount.primaryOperator?.name.charAt(0)}
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                                    {currentAccount.primaryOperator?.name}
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                                    {currentAccount.primaryOperator?.jobTitle}
                                </p>
                                <div className="flex items-center gap-2 mt-2 text-sm text-gray-600 dark:text-gray-300">
                                    <Mail size={14} />
                                    {currentAccount.primaryOperator?.email}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                // EDIT MODE: Formulario de Asignación
                <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-3xl shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-700 p-8">
                    <div className="text-center mb-8">
                        <div className="w-14 h-14 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <UserPlus size={28} />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Asignar Operador</h2>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mt-2 leading-relaxed">
                            Defina quién será el usuario final responsable de operar la plataforma técnica (Mapas, Reportes, Plugins).
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
                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest pl-1">Nombre Completo</label>
                                <input
                                    required
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                    placeholder="Ej. Juan Pérez"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest pl-1">Cargo / Puesto</label>
                                <div className="relative">
                                    <input
                                        required
                                        type="text"
                                        value={formData.jobTitle}
                                        onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                        placeholder="Ej. Jefe de Operaciones"
                                    />
                                    <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest pl-1">Email Corporativo</label>
                                <div className="relative">
                                    <input
                                        required
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                        placeholder="juan@empresa.com"
                                    />
                                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
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
