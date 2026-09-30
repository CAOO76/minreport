/**
 * MINREPORT - ACTIVACIÓN DE ACCESO Y CONFIGURACIÓN DE CLAVE (Capa 2 / Capa 3)
 * Cumple con el estándar de Minimalismo Industrial Puro (CABISEG).
 * Tipografía Google Sans. Proporción Áurea (1:1.618). Acentos #FFCD00 y #00AEEF.
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2, ArrowRight, Shield, Check, Building2 } from 'lucide-react';
import { formatRut } from '../utils/rut';
import { useAuth } from '../context/AuthContext';
import { getApiUrl } from '../utils/network';

export const SetupAccess: React.FC = () => {
    const navigate = useNavigate();
    const { signOut } = useAuth();
    const [searchParams] = useSearchParams();

    // Parámetros context-aware desde URL
    const accountId = searchParams.get('accountId');
    const token = searchParams.get('token');
    const urlTaxId = searchParams.get('taxId');
    const name = searchParams.get('name') || '';
    const accountName = searchParams.get('accountName') || '';

    // Estados
    const [taxId, setTaxId] = useState(urlTaxId ? formatRut(urlTaxId) : '');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (!accountId || !token) {
            setError('Enlace de activación inválido o expirado. Verifique el enlace completo enviado a su correo.');
        }
    }, [accountId, token]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!taxId || taxId.trim().length < 8) {
            setError('Ingrese un RUT/RUN válido para verificar su identidad.');
            return;
        }

        if (password !== confirmPassword) {
            setError('Las contraseñas no coinciden.');
            return;
        }

        if (password.length < 8) {
            setError('La contraseña debe tener al menos 8 caracteres.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const response = await fetch(getApiUrl('/api/auth/tunnel/setup-password'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taxId: taxId.replace(/[^0-9Kk]/g, '').toUpperCase(),
                    accountId,
                    token,
                    password
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Fallo al establecer credenciales');
            }

            setSuccess(true);
            setTimeout(async () => {
                await signOut();
                navigate('/login', { replace: true });
            }, 2500);

        } catch (err: any) {
            console.error('[SETUP] Fallo en configuración:', err);
            setError(err.message || 'Error de conexión con el servidor de seguridad.');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen bg-[#000000] text-[#F3F4F6] flex items-center justify-center p-4 font-sans select-none">
                <div className="w-full max-w-md p-8 bg-[#07090D] border border-emerald-500/30 text-center space-y-6 shadow-2xl">
                    <div className="w-16 h-16 mx-auto bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <Check size={32} className="text-emerald-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold uppercase tracking-tight text-[#F3F4F6]">
                            Credenciales Establecidas
                        </h2>
                        <p className="text-xs text-[#8A93A6] mt-2 leading-relaxed">
                            Su acceso seguro ha sido configurado exitosamente. Redirigiendo a la pantalla de ingreso...
                        </p>
                    </div>
                    <div className="flex justify-center pt-2">
                        <Loader2 className="w-5 h-5 animate-spin text-[#00AEEF]" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#000000] text-[#F3F4F6] flex flex-col md:flex-row antialiased font-sans select-none">
            
            {/* PANEL PRINCIPAL: Hero Técnico en Proporción Áurea (61.8%) */}
            <div className="hidden md:flex md:w-[61.8%] flex-col justify-between p-12 lg:p-16 border-r border-[#12151C] bg-[#030406] relative overflow-hidden">
                <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#FFCD00]/5 rounded-full blur-[140px] pointer-events-none" />
                <div className="absolute -bottom-40 right-0 w-96 h-96 bg-[#00AEEF]/5 rounded-full blur-[140px] pointer-events-none" />

                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#FFCD00] text-black flex items-center justify-center font-bold text-sm tracking-tighter">
                        MR
                    </div>
                    <div>
                        <span className="text-sm font-bold tracking-[0.2em] uppercase text-white">MINREPORT</span>
                        <span className="text-[10px] text-[#8A93A6] block font-mono">SEGURIDAD Y CONTROL DE IDENTIDAD</span>
                    </div>
                </div>

                <div className="space-y-6 max-w-xl z-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 text-[10px] uppercase font-bold tracking-[0.2em] text-[#00AEEF]">
                        <Shield size={12} />
                        <span>ACTIVACIÓN DE ENTORNO OPERATIVO</span>
                    </div>

                    <h1 className="text-4xl lg:text-5xl font-bold tracking-tight uppercase leading-[0.95] text-[#F3F4F6]">
                        Configuración de Acceso Corporativo.
                    </h1>

                    <p className="text-sm text-[#8A93A6] leading-relaxed">
                        Ha recibido una invitación oficial para operar dentro de la infraestructura de MINREPORT. 
                        Valide su RUN de mandatario o trabajador y fije su contraseña exclusiva de faena.
                    </p>

                    {accountName && (
                        <div className="p-4 bg-white/[0.02] border border-white/10 flex items-center gap-3">
                            <Building2 size={18} className="text-[#FFCD00] shrink-0" />
                            <div>
                                <span className="text-[10px] text-[#8A93A6] uppercase tracking-wider block font-bold">Empresa Asignada</span>
                                <span className="text-sm font-bold text-[#F3F4F6] uppercase">{decodeURIComponent(accountName)}</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#5A6072] font-mono border-t border-white/5 pt-4">
                    <span>DS 132 REGLAMENTO DE SEGURIDAD MINERA</span>
                    <span>SHA-256 ISOLATED PASSKEY TUNNEL</span>
                </div>
            </div>

            {/* PANEL SECUNDARIO: Formulario de Activación (38.2%) */}
            <div className="w-full md:w-[38.2%] flex flex-col justify-between p-8 lg:p-12 bg-[#07090D]">
                <div className="flex items-center justify-between md:hidden pb-6 border-b border-[#12151C]">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-[#FFCD00] text-black flex items-center justify-center font-bold text-xs">MR</div>
                        <span className="text-xs font-bold tracking-[0.2em] uppercase">MINREPORT</span>
                    </div>
                    <span className="text-[10px] font-mono text-[#8A93A6]">ACTIVACIÓN</span>
                </div>

                <div className="max-w-sm w-full mx-auto my-auto space-y-6">
                    <div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#00AEEF]">
                            PASO ÚNICO DE REGISTRO
                        </span>
                        <h2 className="text-2xl font-bold tracking-tight uppercase text-[#F3F4F6] mt-1">
                            {name ? decodeURIComponent(name) : 'Establecer Contraseña'}
                        </h2>
                        <p className="text-xs text-[#8A93A6] mt-1">
                            Confirme su identidad y defina su clave de acceso para este entorno.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                RUN / RUT del Usuario
                            </label>
                            <input
                                type="text"
                                required
                                value={taxId}
                                onChange={(e) => setTaxId(formatRut(e.target.value))}
                                placeholder="12.345.678-9"
                                className="w-full px-3.5 py-2.5 bg-black/40 border border-[#12151C] focus:border-[#00AEEF] text-sm text-[#F3F4F6] font-mono outline-none transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                Nueva Contraseña Operativa (min 8 caracteres)
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    required
                                    minLength={8}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••••••"
                                    className="w-full px-3.5 py-2.5 bg-black/40 border border-[#12151C] focus:border-[#00AEEF] text-sm text-[#F3F4F6] outline-none transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A93A6] hover:text-white text-xs font-mono"
                                >
                                    {showPassword ? 'OCULTAR' : 'VER'}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                Confirmar Contraseña
                            </label>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                required
                                minLength={8}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="••••••••••••"
                                className="w-full px-3.5 py-2.5 bg-black/40 border border-[#12151C] focus:border-[#00AEEF] text-sm text-[#F3F4F6] outline-none transition-colors"
                            />
                        </div>

                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !token || !accountId}
                            className="w-full py-3 bg-[#FFCD00] hover:bg-[#FFCD00]/90 text-black text-xs font-bold uppercase tracking-[0.15em] flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 mt-2"
                        >
                            {loading ? (
                                <Loader2 size={16} className="animate-spin text-black" />
                            ) : (
                                <>
                                    <span>Activar y Confirmar Clave</span>
                                    <ArrowRight size={14} />
                                </>
                            )}
                        </button>
                    </form>
                </div>

                <div className="border-t border-[#12151C] pt-4 text-center">
                    <p className="text-[10px] text-[#5A6072] font-mono uppercase tracking-wider">
                        MINREPORT SECURE TUNNEL · CHILE
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SetupAccess;
