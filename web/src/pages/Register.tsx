import { useState, ChangeEvent, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, Building2, UserCheck, Scale, FileText, Check, AlertCircle, Loader2 } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { registerUser, RegisterTitularB2BData } from '../services/auth';
import { formatRut, validateRut } from '../utils/rut';

export const Register = () => {
    const navigate = useNavigate();

    // Estado del Formulario B2B
    const [formData, setFormData] = useState<RegisterTitularB2BData>({
        businessName: '',
        companyTaxId: '',
        legalAddress: '',
        commune: '',
        region: '',
        billingEmail: '',
        fullName: '',
        personalTaxId: '',
        jobTitle: '',
        email: '',
        password: '',
        acceptTermsAndPrivacy: false,
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [showTermsModal, setShowTermsModal] = useState(false);

    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        if (type === 'checkbox') {
            const checked = (e.target as HTMLInputElement).checked;
            setFormData(prev => ({ ...prev, [name]: checked }));
        } else if (name === 'companyTaxId' || name === 'personalTaxId') {
            setFormData(prev => ({ ...prev, [name]: formatRut(value) }));
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
        setError(null);
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);

        // 1. Validaciones Legales y de Formato
        if (!validateRut(formData.companyTaxId)) {
            setError('El RUT de la Empresa es inválido. Formato requerido: 12.345.678-9');
            return;
        }

        if (!validateRut(formData.personalTaxId)) {
            setError('El RUT del Mandatario es inválido. Formato requerido: 12.345.678-9');
            return;
        }

        if (!formData.acceptTermsAndPrivacy) {
            setError('Debe aceptar expresamente las condiciones legales y política de privacidad (Ley N° 19.628).');
            return;
        }

        if (!formData.password || formData.password.length < 8) {
            setError('La contraseña del titular debe tener al menos 8 caracteres.');
            return;
        }

        setLoading(true);

        try {
            const response = await registerUser(formData);
            console.log('[B2B-REGISTER] Success:', response);
            setSuccess(true);
            setTimeout(() => {
                navigate('/login', {
                    state: {
                        message: 'Cuenta Titular B2B creada y activada. Inicie sesión con sus credenciales de mandatario.'
                    }
                });
            }, 2500);
        } catch (err: any) {
            console.error('[B2B-REGISTER] Error:', err);
            setError(err.message || 'Error en el registro de la Cuenta Titular. Verifique los datos ingresados.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#030406] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-sans transition-colors selection:bg-[#FFCD00] selection:text-black">
            {/* Header Técnico */}
            <header className="w-full border-b border-black/5 dark:border-white/5 py-4 px-6 lg:px-12 flex justify-between items-center bg-white/70 dark:bg-[#07090D]/80 backdrop-blur-md sticky top-0 z-30">
                <div className="flex items-center gap-4">
                    <BrandLogo variant="imagotype" className="h-8 w-auto" />
                    <span className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-[0.25em] text-[#8A93A6] border-l border-black/10 dark:border-white/10 pl-4">
                        SISTEMA B2B • TITULARES
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <LanguageSwitch />
                    <ThemeSwitch />
                </div>
            </header>

            {/* Macro-Layout Paramétrico (Proporción Áurea 1:1.618) */}
            <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* Panel Hero Informativo (Área ~ 38.2% en Desktop) */}
                <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-24">
                    <div className="p-8 bg-white dark:bg-[#07090D] border border-black/5 dark:border-white/10 space-y-6 shadow-sm">
                        <div className="inline-flex items-center gap-2 text-[#C68346] dark:text-[#FFCD00] text-[11px] font-bold uppercase tracking-[0.2em]">
                            <Scale size={16} />
                            <span>CONTRATACIÓN B2B LEGAL</span>
                        </div>

                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A] dark:text-[#F3F4F6] uppercase">
                                Alta Legal de Cuenta Titular
                            </h1>
                            <p className="mt-2 text-xs leading-relaxed text-[#8A93A6]">
                                Registro exclusivo para personas jurídicas y mandantes del sector industrial y minero. Otorga administración soberana sobre espacios de trabajo, facturación y gestión autónoma de usuarios internos.
                            </p>
                        </div>

                        {/* Módulos Habilitados (Cobro por uso / Todos activos en dev) */}
                        <div className="border-t border-black/5 dark:border-white/10 pt-4 space-y-3">
                            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8A93A6]">
                                Módulos Industriales Incluidos:
                            </div>
                            <div className="grid grid-cols-1 gap-2 text-xs">
                                <div className="p-3 bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 flex items-center justify-between">
                                    <div>
                                        <p className="font-bold uppercase tracking-wider text-[11px]">OPERMAQ</p>
                                        <p className="text-[10px] text-[#8A93A6]">Flota, inspecciones y mantenimiento</p>
                                    </div>
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#00AEEF] bg-[#00AEEF]/10 px-2 py-0.5">ACTIVO (DEV)</span>
                                </div>
                                <div className="p-3 bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 flex items-center justify-between">
                                    <div>
                                        <p className="font-bold uppercase tracking-wider text-[11px]">STOCKPILE</p>
                                        <p className="text-[10px] text-[#8A93A6]">Cubicaciones, densidades y volumetría</p>
                                    </div>
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#00AEEF] bg-[#00AEEF]/10 px-2 py-0.5">ACTIVO (DEV)</span>
                                </div>
                                <div className="p-3 bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 flex items-center justify-between">
                                    <div>
                                        <p className="font-bold uppercase tracking-wider text-[11px]">MINING FLOW</p>
                                        <p className="text-[10px] text-[#8A93A6]">Planificación operativa y flujos de caja</p>
                                    </div>
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#00AEEF] bg-[#00AEEF]/10 px-2 py-0.5">ACTIVO (DEV)</span>
                                </div>
                            </div>
                        </div>

                        {/* Badges de Seguridad Bancaria */}
                        <div className="border-t border-black/5 dark:border-white/10 pt-4 flex flex-wrap gap-2">
                            <span className="text-[9px] font-mono font-bold tracking-wider text-[#8A93A6] bg-black/5 dark:bg-white/5 px-2 py-1">
                                ISO_27001_COMPLIANT
                            </span>
                            <span className="text-[9px] font-mono font-bold tracking-wider text-[#8A93A6] bg-black/5 dark:bg-white/5 px-2 py-1">
                                LEY_19628_CHILE
                            </span>
                            <span className="text-[9px] font-mono font-bold tracking-wider text-[#8A93A6] bg-black/5 dark:bg-white/5 px-2 py-1">
                                SOUTHAMERICA_WEST1
                            </span>
                        </div>
                    </div>
                </div>

                {/* Formulario Técnico Legal (Área ~ 61.8% en Desktop) */}
                <div className="lg:col-span-7 bg-white dark:bg-[#07090D] border border-black/5 dark:border-white/10 p-6 sm:p-10 shadow-sm">
                    {success ? (
                        <div className="py-16 text-center space-y-4">
                            <div className="w-14 h-14 bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 flex items-center justify-center mx-auto">
                                <Check size={28} />
                            </div>
                            <h2 className="text-xl font-bold tracking-tight uppercase">
                                Cuenta Titular B2B Registrada y Activada
                            </h2>
                            <p className="text-xs text-[#8A93A6] max-w-md mx-auto leading-relaxed">
                                Su espacio de trabajo ha sido aprovisionado. Redirigiendo al portal de inicio de sesión para acceder a su consola de administración...
                            </p>
                            <div className="pt-4">
                                <Loader2 className="animate-spin mx-auto text-[#FFCD00]" size={20} />
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-8" autoComplete="off">
                            
                            {error && (
                                <div className="p-4 bg-red-500/10 border-l-2 border-red-500 text-red-600 dark:text-red-400 text-xs flex items-start gap-3">
                                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                    <span>{error}</span>
                                </div>
                            )}

                            {/* SECCIÓN 1: IDENTIFICACIÓN DE LA PERSONA JURÍDICA */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/10 pb-2">
                                    <Building2 size={16} className="text-[#C68346] dark:text-[#FFCD00]" />
                                    <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-[#0F172A] dark:text-[#F3F4F6]">
                                        1. Datos de la Persona Jurídica (Empresa)
                                    </h2>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="sm:col-span-2">
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                            Razón Social Oficial *
                                        </label>
                                        <input
                                            type="text"
                                            name="businessName"
                                            value={formData.businessName}
                                            onChange={handleChange}
                                            placeholder="Ej. Minera Los Pelambres SpA"
                                            required
                                            className="w-full bg-transparent border border-black/10 dark:border-white/15 px-3 py-2.5 text-xs text-[#0F172A] dark:text-[#F3F4F6] placeholder-black/20 dark:placeholder-white/20 focus:outline-none focus:border-[#C68346] dark:focus:border-[#FFCD00] transition-colors rounded-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                            RUT de la Empresa *
                                        </label>
                                        <input
                                            type="text"
                                            name="companyTaxId"
                                            value={formData.companyTaxId}
                                            onChange={handleChange}
                                            placeholder="76.123.456-7"
                                            required
                                            className="w-full bg-transparent border border-black/10 dark:border-white/15 px-3 py-2.5 text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] placeholder-black/20 dark:placeholder-white/20 focus:outline-none focus:border-[#C68346] dark:focus:border-[#FFCD00] transition-colors rounded-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                            Email Facturación DTE *
                                        </label>
                                        <input
                                            type="email"
                                            name="billingEmail"
                                            value={formData.billingEmail}
                                            onChange={handleChange}
                                            placeholder="dte@empresa.cl"
                                            required
                                            className="w-full bg-transparent border border-black/10 dark:border-white/15 px-3 py-2.5 text-xs text-[#0F172A] dark:text-[#F3F4F6] placeholder-black/20 dark:placeholder-white/20 focus:outline-none focus:border-[#C68346] dark:focus:border-[#FFCD00] transition-colors rounded-none"
                                        />
                                    </div>

                                    <div className="sm:col-span-2">
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                            Dirección Legal Tributaria *
                                        </label>
                                        <input
                                            type="text"
                                            name="legalAddress"
                                            value={formData.legalAddress}
                                            onChange={handleChange}
                                            placeholder="Av. Andrés Bello 2711, Piso 18"
                                            required
                                            className="w-full bg-transparent border border-black/10 dark:border-white/15 px-3 py-2.5 text-xs text-[#0F172A] dark:text-[#F3F4F6] placeholder-black/20 dark:placeholder-white/20 focus:outline-none focus:border-[#C68346] dark:focus:border-[#FFCD00] transition-colors rounded-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                            Comuna *
                                        </label>
                                        <input
                                            type="text"
                                            name="commune"
                                            value={formData.commune}
                                            onChange={handleChange}
                                            placeholder="Las Condes"
                                            required
                                            className="w-full bg-transparent border border-black/10 dark:border-white/15 px-3 py-2.5 text-xs text-[#0F172A] dark:text-[#F3F4F6] placeholder-black/20 dark:placeholder-white/20 focus:outline-none focus:border-[#C68346] dark:focus:border-[#FFCD00] transition-colors rounded-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                            Región *
                                        </label>
                                        <input
                                            type="text"
                                            name="region"
                                            value={formData.region}
                                            onChange={handleChange}
                                            placeholder="Región Metropolitana"
                                            required
                                            className="w-full bg-transparent border border-black/10 dark:border-white/15 px-3 py-2.5 text-xs text-[#0F172A] dark:text-[#F3F4F6] placeholder-black/20 dark:placeholder-white/20 focus:outline-none focus:border-[#C68346] dark:focus:border-[#FFCD00] transition-colors rounded-none"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* SECCIÓN 2: IDENTIFICACIÓN DEL MANDATARIO TITULAR */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/10 pb-2">
                                    <UserCheck size={16} className="text-[#C68346] dark:text-[#FFCD00]" />
                                    <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-[#0F172A] dark:text-[#F3F4F6]">
                                        2. Mandatario y Administrador de Cuenta Titular
                                    </h2>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                            Nombre Completo del Mandatario *
                                        </label>
                                        <input
                                            type="text"
                                            name="fullName"
                                            value={formData.fullName}
                                            onChange={handleChange}
                                            placeholder="Nombre y Apellidos"
                                            required
                                            className="w-full bg-transparent border border-black/10 dark:border-white/15 px-3 py-2.5 text-xs text-[#0F172A] dark:text-[#F3F4F6] placeholder-black/20 dark:placeholder-white/20 focus:outline-none focus:border-[#C68346] dark:focus:border-[#FFCD00] transition-colors rounded-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                            RUT del Mandatario *
                                        </label>
                                        <input
                                            type="text"
                                            name="personalTaxId"
                                            value={formData.personalTaxId}
                                            onChange={handleChange}
                                            placeholder="12.345.678-9"
                                            required
                                            className="w-full bg-transparent border border-black/10 dark:border-white/15 px-3 py-2.5 text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] placeholder-black/20 dark:placeholder-white/20 focus:outline-none focus:border-[#C68346] dark:focus:border-[#FFCD00] transition-colors rounded-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                            Cargo en la Organización
                                        </label>
                                        <input
                                            type="text"
                                            name="jobTitle"
                                            value={formData.jobTitle}
                                            onChange={handleChange}
                                            placeholder="Ej. Gerente de Operaciones / Abastecimiento"
                                            className="w-full bg-transparent border border-black/10 dark:border-white/15 px-3 py-2.5 text-xs text-[#0F172A] dark:text-[#F3F4F6] placeholder-black/20 dark:placeholder-white/20 focus:outline-none focus:border-[#C68346] dark:focus:border-[#FFCD00] transition-colors rounded-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                            Correo Corporativo del Mandatario *
                                        </label>
                                        <input
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            placeholder="mandatario@empresa.cl"
                                            required
                                            className="w-full bg-transparent border border-black/10 dark:border-white/15 px-3 py-2.5 text-xs text-[#0F172A] dark:text-[#F3F4F6] placeholder-black/20 dark:placeholder-white/20 focus:outline-none focus:border-[#C68346] dark:focus:border-[#FFCD00] transition-colors rounded-none"
                                        />
                                    </div>

                                    <div className="sm:col-span-2">
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A93A6] mb-1.5">
                                            Contraseña de Acceso Titular * (Mínimo 8 caracteres)
                                        </label>
                                        <input
                                            type="password"
                                            name="password"
                                            value={formData.password}
                                            onChange={handleChange}
                                            placeholder="••••••••••••"
                                            required
                                            minLength={8}
                                            className="w-full bg-transparent border border-black/10 dark:border-white/15 px-3 py-2.5 text-xs font-mono text-[#0F172A] dark:text-[#F3F4F6] placeholder-black/20 dark:placeholder-white/20 focus:outline-none focus:border-[#C68346] dark:focus:border-[#FFCD00] transition-colors rounded-none"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* SECCIÓN 3: CONSENTIMIENTO LEGAL LEY 19.628 */}
                            <div className="border border-black/10 dark:border-white/10 p-4 bg-black/[0.01] dark:bg-white/[0.02] space-y-3">
                                <label className="flex items-start gap-3 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        name="acceptTermsAndPrivacy"
                                        checked={formData.acceptTermsAndPrivacy}
                                        onChange={handleChange}
                                        required
                                        className="mt-1 h-4 w-4 rounded-none border-black/20 dark:border-white/20 text-[#0F172A] dark:text-white focus:ring-0 cursor-pointer"
                                    />
                                    <span className="text-xs leading-relaxed text-[#0F172A] dark:text-[#F3F4F6]">
                                        Declaro bajo juramento que actúo en representación legal de la empresa indicada y otorgo mi consentimiento expreso e informado para el tratamiento de los datos conforme a la <strong>Ley N° 19.628 de Chile</strong> y los{' '}
                                        <button
                                            type="button"
                                            onClick={() => setShowTermsModal(true)}
                                            className="text-[#C68346] dark:text-[#FFCD00] underline font-bold hover:opacity-80 inline-block"
                                        >
                                            Términos de Servicio B2B
                                        </button>.
                                    </span>
                                </label>
                            </div>

                            {/* ACCIÓN DE ENVÍO */}
                            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
                                <Link
                                    to="/login"
                                    className="text-xs text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white transition-colors uppercase tracking-wider"
                                >
                                    ¿Ya tiene cuenta? Iniciar Sesión ➔
                                </Link>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full sm:w-auto px-8 py-3.5 bg-[#0F172A] hover:bg-black dark:bg-[#FFCD00] dark:hover:bg-[#E6B800] text-white dark:text-black font-bold uppercase tracking-[0.15em] text-xs transition-all flex items-center justify-center gap-3 disabled:opacity-50 cursor-pointer rounded-none"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            <span>REGISTRANDO CUENTA...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>CREAR CUENTA TITULAR B2B</span>
                                            <ArrowRight size={16} />
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </main>

            {/* Modal de Términos B2B y Ley 19.628 */}
            {showTermsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-[#07090D] border border-black/10 dark:border-white/10 max-w-2xl w-full p-6 sm:p-8 space-y-4 max-h-[85vh] overflow-y-auto rounded-none shadow-2xl">
                        <div className="flex justify-between items-center border-b border-black/5 dark:border-white/10 pb-3">
                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
                                <FileText size={16} className="text-[#C68346] dark:text-[#FFCD00]" />
                                <span>Términos B2B y Política de Privacidad (Ley 19.628)</span>
                            </div>
                            <button
                                onClick={() => setShowTermsModal(false)}
                                className="text-gray-400 hover:text-black dark:hover:text-white text-xs font-mono"
                            >
                                [CERRAR ✕]
                            </button>
                        </div>
                        <div className="text-xs leading-relaxed text-[#8A93A6] space-y-3 font-mono">
                            <p><strong>1. ÁMBITO DE APLICACIÓN:</strong> Este contrato regula la prestación de servicios de software como servicio (SaaS) industrial prestados por MINREPORT a la Persona Jurídica contratante.</p>
                            <p><strong>2. TRATAMIENTO DE DATOS PERSONALES (LEY 19.628):</strong> Los datos del mandatario y de los usuarios internos autorizados serán tratados con el exclusivo propósito de proveer acceso, soporte y trazabilidad a la plataforma minera.</p>
                            <p><strong>3. SOBERANÍA DEL ESPACIO DE TRABAJO:</strong> La Cuenta Titular es enteramente responsable de la creación, habilitación y revocación de permisos a sus usuarios internos. MINREPORT no interviene en la política interna de acceso de la empresa.</p>
                            <p><strong>4. MÓDULOS Y FACTURACIÓN:</strong> El acceso a los módulos operativos (OPERMAQ, STOCKPILE, MINING FLOW) se otorga con fines de desarrollo y evaluación técnica, quedando sujetos a cobro por uso conforme al contrato de suscripción comercial suscrito entre las partes.</p>
                        </div>
                        <div className="pt-3 border-t border-black/5 dark:border-white/10 flex justify-end">
                            <button
                                onClick={() => {
                                    setFormData(prev => ({ ...prev, acceptTermsAndPrivacy: true }));
                                    setShowTermsModal(false);
                                }}
                                className="px-6 py-2.5 bg-[#0F172A] dark:bg-white text-white dark:text-black text-xs font-bold uppercase tracking-wider rounded-none"
                            >
                                Entendido y Aceptar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Footer Técnico */}
            <footer className="w-full border-t border-black/5 dark:border-white/5 py-4 px-6 text-center text-[10px] text-[#8A93A6] uppercase tracking-[0.2em]">
                MINREPORT PLATAFORMA B2B • CLUSTER SOUTHAMERICA-WEST1 • SANTIAGO, CHILE
            </footer>
        </div>
    );
};

export default Register;
