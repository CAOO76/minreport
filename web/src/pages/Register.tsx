import { useState, ChangeEvent, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { registerUser, RegisterTitularB2BData } from '../services/auth';
import { formatRut, validateRut } from '../utils/rut';

const labelClass = 'block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8';
const inputClass = 'w-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] px-fib-13 py-fib-8 text-data-dense text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] focus:outline-none focus:border-[#C68346] transition-colors rounded-none shadow-none';

export const Register = () => {
    const navigate = useNavigate();

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
            await registerUser(formData);
            setSuccess(true);
            setTimeout(() => {
                navigate('/login', {
                    state: {
                        message: 'Cuenta Titular B2B registrada. Inicie sesión con sus credenciales de mandatario.'
                    }
                });
            }, 2500);
        } catch (err: any) {
            setError(err.message || 'Error en el registro de la Cuenta Titular. Verifique los datos ingresados.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex flex-col font-sans select-none transition-colors">
            {/* Header Técnico */}
            <header className="w-full border-b border-[#E2E8F0] dark:border-[#12151C] py-fib-13 px-fib-21 lg:px-fib-55 flex justify-between items-center bg-[#F8FAFC] dark:bg-[#07090D] sticky top-0 z-30">
                <div className="flex items-center gap-fib-13">
                    <BrandLogo variant="imagotype" className="h-8 w-auto" />
                    <span className="hidden sm:inline-block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] border-l border-[#E2E8F0] dark:border-[#12151C] pl-fib-13">
                        REGISTRO B2B // CUENTA TITULAR
                    </span>
                </div>
                <div className="flex items-center gap-fib-13">
                    <LanguageSwitch />
                    <ThemeSwitch />
                </div>
            </header>

            {/* Macro-Layout Paramétrico (Proporción Áurea 38.2% / 61.8%) */}
            <main className="flex-1 max-w-7xl w-full mx-auto p-fib-21 lg:p-fib-55 grid grid-cols-1 lg:grid-cols-[38.2fr_61.8fr] gap-fib-34 items-start">
                {/* Panel Técnico Informativo (38.2%) */}
                <aside className="space-y-fib-21 lg:sticky lg:top-24">
                    <div className="p-fib-34 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none space-y-fib-21">
                        <div className="flex items-center gap-fib-8 text-[#C68346] text-microcopy font-mono uppercase">
                            <span className="material-symbols-outlined text-[18px]">balance</span>
                            <span>CONTRATACIÓN CORPORATIVA B2B</span>
                        </div>

                        <div>
                            <h1 className="text-h1-header font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                Alta Legal de Cuenta Titular
                            </h1>
                            <p className="mt-fib-8 text-data-dense leading-relaxed text-[#475569] dark:text-[#8A93A6]">
                                Registro para personas jurídicas y mandantes mineros. Habilita aislamiento multi-tenant por cuenta, designación de administradores y gestión interna de perfiles operativos.
                            </p>
                        </div>

                        {/* Módulos Nativos Integrados */}
                        <div className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-fib-21 space-y-fib-13">
                            <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                Módulos Nativos Integrados:
                            </p>
                            <div className="space-y-fib-8">
                                <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                    <p className="text-microcopy font-mono font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        OPERMAQ
                                    </p>
                                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-0.5">
                                        Control operativo de maquinaria pesada, inspecciones y flota.
                                    </p>
                                </div>
                                <div className="p-fib-13 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C]">
                                    <p className="text-microcopy font-mono font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        STOCKPILE CONTROL
                                    </p>
                                    <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-0.5">
                                        Cubicación topográfica, densidades y volumetría de acopios.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Formulario Técnico Legal (61.8%) */}
                <section className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 sm:p-fib-34 rounded-none shadow-none">
                    {success ? (
                        <div className="py-fib-55 text-center space-y-fib-13">
                            <span className="material-symbols-outlined text-[32px] text-[#00AEEF] block">
                                check_circle
                            </span>
                            <h2 className="text-h2-section font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                Cuenta Titular B2B Registrada
                            </h2>
                            <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] max-w-md mx-auto leading-relaxed">
                                Espacio de trabajo aprovisionado. Redirigiendo al inicio de sesión...
                            </p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-fib-34" autoComplete="off" spellCheck={false}>
                            {error && (
                                <div className="p-fib-13 bg-red-500/5 border border-red-500/30 text-red-600 dark:text-red-400 text-data-dense font-mono">
                                    {error}
                                </div>
                            )}

                            {/* SECCIÓN 1: IDENTIFICACIÓN DE LA PERSONA JURÍDICA */}
                            <div className="space-y-fib-13">
                                <div className="flex items-center gap-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                    <span className="material-symbols-outlined text-[18px] text-[#C68346]">domain</span>
                                    <h2 className="text-microcopy font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        1. Datos de la Persona Jurídica (Empresa)
                                    </h2>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                    <div className="sm:col-span-2">
                                        <label className={labelClass}>Razón Social Oficial *</label>
                                        <input
                                            type="text"
                                            name="businessName"
                                            value={formData.businessName}
                                            onChange={handleChange}
                                            placeholder="Razón social legal"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={inputClass}
                                        />
                                    </div>

                                    <div>
                                        <label className={labelClass}>RUT de la Empresa *</label>
                                        <input
                                            type="text"
                                            name="companyTaxId"
                                            value={formData.companyTaxId}
                                            onChange={handleChange}
                                            placeholder="76.123.456-7"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={`${inputClass} font-mono tabular-nums select-text`}
                                        />
                                    </div>

                                    <div>
                                        <label className={labelClass}>Email Facturación DTE *</label>
                                        <input
                                            type="email"
                                            name="billingEmail"
                                            value={formData.billingEmail}
                                            onChange={handleChange}
                                            placeholder="dte@empresa.cl"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={`${inputClass} font-mono select-text`}
                                        />
                                    </div>

                                    <div className="sm:col-span-2">
                                        <label className={labelClass}>Dirección Legal Tributaria *</label>
                                        <input
                                            type="text"
                                            name="legalAddress"
                                            value={formData.legalAddress}
                                            onChange={handleChange}
                                            placeholder="Dirección tributaria registrada"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={inputClass}
                                        />
                                    </div>

                                    <div>
                                        <label className={labelClass}>Comuna *</label>
                                        <input
                                            type="text"
                                            name="commune"
                                            value={formData.commune}
                                            onChange={handleChange}
                                            placeholder="Comuna"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={inputClass}
                                        />
                                    </div>

                                    <div>
                                        <label className={labelClass}>Región *</label>
                                        <input
                                            type="text"
                                            name="region"
                                            value={formData.region}
                                            onChange={handleChange}
                                            placeholder="Región"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* SECCIÓN 2: IDENTIFICACIÓN DEL MANDATARIO TITULAR */}
                            <div className="space-y-fib-13">
                                <div className="flex items-center gap-fib-8 border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                                    <span className="material-symbols-outlined text-[18px] text-[#C68346]">person_check</span>
                                    <h2 className="text-microcopy font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                        2. Mandatario y Administrador Titular
                                    </h2>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                    <div>
                                        <label className={labelClass}>Nombre Completo del Mandatario *</label>
                                        <input
                                            type="text"
                                            name="fullName"
                                            value={formData.fullName}
                                            onChange={handleChange}
                                            placeholder="Nombres y apellidos"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={inputClass}
                                        />
                                    </div>

                                    <div>
                                        <label className={labelClass}>RUT del Mandatario *</label>
                                        <input
                                            type="text"
                                            name="personalTaxId"
                                            value={formData.personalTaxId}
                                            onChange={handleChange}
                                            placeholder="12.345.678-9"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={`${inputClass} font-mono tabular-nums select-text`}
                                        />
                                    </div>

                                    <div>
                                        <label className={labelClass}>Cargo en la Organización</label>
                                        <input
                                            type="text"
                                            name="jobTitle"
                                            value={formData.jobTitle}
                                            onChange={handleChange}
                                            placeholder="Cargo directivo u operacional"
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={inputClass}
                                        />
                                    </div>

                                    <div>
                                        <label className={labelClass}>Correo Corporativo del Mandatario *</label>
                                        <input
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            placeholder="mandatario@empresa.cl"
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={`${inputClass} font-mono select-text`}
                                        />
                                    </div>

                                    <div className="sm:col-span-2">
                                        <label className={labelClass}>Contraseña de Acceso Titular * (Mínimo 8 caracteres)</label>
                                        <input
                                            type="password"
                                            name="password"
                                            value={formData.password}
                                            onChange={handleChange}
                                            placeholder="••••••••••••"
                                            required
                                            minLength={8}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className={`${inputClass} font-mono`}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* SECCIÓN 3: CONSENTIMIENTO LEGAL LEY 19.628 */}
                            <div className="border border-[#E2E8F0] dark:border-[#12151C] p-fib-13 bg-[#FFFFFF] dark:bg-[#000000]">
                                <label className="flex items-start gap-fib-13 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        name="acceptTermsAndPrivacy"
                                        checked={formData.acceptTermsAndPrivacy}
                                        onChange={handleChange}
                                        required
                                        autoComplete="off"
                                        spellCheck={false}
                                        className="mt-1 h-4 w-4 rounded-none border-[#E2E8F0] dark:border-[#12151C] text-[#C68346] focus:ring-0 cursor-pointer"
                                    />
                                    <span className="text-data-dense leading-relaxed text-[#0F172A] dark:text-[#F3F4F6]">
                                        Declaro bajo juramento que actúo en representación legal de la persona jurídica indicada y otorgo consentimiento informado para el tratamiento de datos conforme a la <strong>Ley N° 19.628 de Chile</strong> y los{' '}
                                        <button
                                            type="button"
                                            onClick={() => setShowTermsModal(true)}
                                            className="text-[#C68346] underline font-bold hover:opacity-80 inline-block bg-transparent border-0 p-0 cursor-pointer"
                                        >
                                            Términos de Servicio B2B
                                        </button>.
                                    </span>
                                </label>
                            </div>

                            {/* ACCIÓN DE ENVÍO */}
                            <div className="pt-fib-8 flex flex-col sm:flex-row items-center justify-between gap-fib-13">
                                <Link
                                    to="/login"
                                    className="inline-flex items-center gap-fib-8 text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white transition-colors"
                                >
                                    <span>¿Ya tiene cuenta? Iniciar sesión</span>
                                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                                </Link>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full sm:w-auto px-fib-34 py-fib-13 bg-[#C68346] hover:bg-[#B0743E] text-white font-mono font-bold uppercase text-microcopy transition-colors disabled:opacity-50 cursor-pointer rounded-none shadow-none"
                                >
                                    {loading ? 'REGISTRANDO CUENTA...' : 'CREAR CUENTA TITULAR B2B'}
                                </button>
                            </div>
                        </form>
                    )}
                </section>
            </main>

            {/* Modal de Términos B2B y Ley 19.628 */}
            {showTermsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-fib-21 bg-black/70">
                    <div className="bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] max-w-2xl w-full p-fib-21 sm:p-fib-34 space-y-fib-21 max-h-[85vh] overflow-y-auto rounded-none shadow-none">
                        <div className="flex justify-between items-center border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                            <span className="text-microcopy font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                Términos B2B y Política de Privacidad (Ley 19.628)
                            </span>
                            <button
                                type="button"
                                onClick={() => setShowTermsModal(false)}
                                title="Cerrar"
                                aria-label="Cerrar"
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>
                        <div className="text-data-dense leading-relaxed text-[#475569] dark:text-[#8A93A6] space-y-fib-13 font-mono">
                            <p><strong>1. ÁMBITO DE APLICACIÓN:</strong> Este instrumento regula la provisión de servicios de software industrial MINREPORT a la Persona Jurídica contratante.</p>
                            <p><strong>2. TRATAMIENTO DE DATOS PERSONALES (LEY 19.628):</strong> Los datos del mandatario y usuarios autorizados serán tratados con el exclusivo propósito de proveer control de acceso, soporte operacional y trazabilidad de auditoría.</p>
                            <p><strong>3. SOBERANÍA DEL ESPACIO DE TRABAJO:</strong> La Cuenta Titular administra la alta, asignación de perfiles y revocación de permisos de sus colaboradores internos.</p>
                            <p><strong>4. MÓDULOS Y FACTURACIÓN:</strong> El acceso a los módulos nativos integrados (OPERMAQ y STOCKPILE CONTROL) se rige por las condiciones contractuales vigentes de la cuenta y la disponibilidad operativa declarada.</p>
                        </div>
                        <div className="pt-fib-13 border-t border-[#E2E8F0] dark:border-[#12151C] flex justify-end">
                            <button
                                type="button"
                                onClick={() => {
                                    setFormData(prev => ({ ...prev, acceptTermsAndPrivacy: true }));
                                    setShowTermsModal(false);
                                }}
                                className="px-fib-21 py-fib-8 bg-[#C68346] hover:bg-[#B0743E] text-white text-microcopy font-mono font-bold uppercase rounded-none shadow-none cursor-pointer"
                            >
                                ACEPTAR CONDICIONES
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <footer className="w-full border-t border-[#E2E8F0] dark:border-[#12151C] py-fib-13 px-fib-21 text-center text-microcopy font-mono text-[#475569] dark:text-[#8A93A6] uppercase">
                MINREPORT // REGIÓN SOUTHAMERICA-WEST1 (SANTIAGO, CHILE)
            </footer>
        </div>
    );
};

export default Register;
