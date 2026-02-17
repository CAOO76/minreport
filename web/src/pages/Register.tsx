import { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LogIn, ArrowLeft, ArrowRight, ShieldCheck, UserPlus, Building, GraduationCap, User } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { registerUser, RegisterData } from '../services/auth';
import { formatRut, validateRut } from '../utils/rut';
import { SUPPORTED_COUNTRIES } from '../../../src/core/constants';
import clsx from 'clsx';

type AccountType = 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
type EducationalProfile = 'ALUMNO' | 'ACADEMICO' | 'DOCENTE' | 'OTRO';

export const Register = () => {
    const { t } = useTranslation();
    const [step, setStep] = useState(1);
    const [type, setType] = useState<AccountType>('ENTERPRISE');
    const [eduProfile, setEduProfile] = useState<EducationalProfile | null>(null);

    const [formData, setFormData] = useState<Partial<RegisterData>>({
        email: '',
        country: 'CL',
        applicant_name: '',
        company_name: '',
        industry: '',
        rut: '',
        website: '',
        institution_name: '',
        institution_website: '',
        program_name: '',
        graduation_date: '',
        full_name: '',
        run: '',
        usage_profile: 'PROFESSIONAL',
        profile: ''
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    // Zero Memory Policy
    useEffect(() => {
        return () => {
            setFormData({
                email: '',
                country: 'CL',
                applicant_name: '',
                company_name: '',
                industry: '',
                rut: '',
                website: '',
                institution_name: '',
                institution_website: '',
                program_name: '',
                graduation_date: '',
                full_name: '',
                run: '',
                usage_profile: 'PROFESSIONAL',
                profile: ''
            });
            setError('');
            setSuccess(false);
        };
    }, []);

    const handleTypeChange = (newType: AccountType) => {
        setType(newType);
        setError('');
        setEduProfile(null);
    };

    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        let finalValue = value;
        if ((name === 'rut' || name === 'run') && formData.country === 'CL') {
            finalValue = formatRut(value);
        }
        setFormData((prev: any) => ({ ...prev, [name]: finalValue }));
    };

    const isPublicEmail = (email: string) => {
        const domain = email.split('@')[1]?.toLowerCase();
        return domain && ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'].includes(domain);
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess(false);

        // Rule 1: All fields are required
        const requiredFields: Record<string, any> = {
            email: formData.email,
        };

        if (type === 'ENTERPRISE') {
            Object.assign(requiredFields, {
                applicant_name: formData.applicant_name,
                company_name: formData.company_name,
                industry: formData.industry,
                rut: formData.rut,
            });
        } else if (type === 'EDUCATIONAL') {
            Object.assign(requiredFields, {
                applicant_name: formData.applicant_name,
                institution_name: formData.institution_name,
                run: formData.run, // Mandatory ID
                profile: eduProfile, // Mandatory Profile
            });
        } else if (type === 'PERSONAL') {
            Object.assign(requiredFields, {
                full_name: formData.full_name,
                run: formData.run,
                usage_profile: formData.usage_profile,
            });
        }

        if (Object.values(requiredFields).some(val => !val)) {
            setError('Todos los campos son obligatorios');
            return;
        }

        // Specific validations based on type
        const idField = (type === 'ENTERPRISE') ? 'rut' : 'run';
        const idValue = (formData as any)[idField];

        if (formData.country === 'CL' && !validateRut(idValue || '')) {
            setError(`Formato de ${idField.toUpperCase()} inválido`);
            return;
        }

        if (type === 'EDUCATIONAL') {
            if (isPublicEmail(formData.email || '')) {
                setError(t('errors.public_email'));
                return;
            }
        }

        setLoading(true);

        try {
            const payload: any = {
                email: formData.email,
                country: formData.country,
                type,
                ...(type === 'ENTERPRISE' && {
                    applicant_name: formData.applicant_name,
                    company_name: formData.company_name,
                    industry: formData.industry,
                    rut: formData.rut,
                    website: formData.website
                }),
                ...(type === 'EDUCATIONAL' && {
                    applicant_name: formData.applicant_name,
                    institution_name: formData.institution_name,
                    run: formData.run,
                    profile: eduProfile,
                    institution_website: formData.institution_website,
                    program_name: formData.program_name,
                    graduation_date: formData.graduation_date
                }),
                ...(type === 'PERSONAL' && {
                    full_name: formData.full_name,
                    run: formData.run,
                    usage_profile: formData.usage_profile
                })
            };

            await registerUser(payload);
            setSuccess(true);
            setFormData((prev: any) => ({ ...prev, email: '' }));
        } catch (err: any) {
            const errorMessage = (err.message || '').toLowerCase();
            // Proxy for 409 Conflict. Check for keywords indicating a duplicate entry.
            if (errorMessage.includes('ya registrado') || errorMessage.includes('duplicate') || errorMessage.includes('ya existe')) {
                setError('Error: Solicitud duplicada (revise RUT o Email)');
            } else {
                setError(err.message || 'Error al enviar solicitud');
            }
        } finally {
            setLoading(false);
        }
    };

    const activeCountry = SUPPORTED_COUNTRIES.find(c => c.code === formData.country) || SUPPORTED_COUNTRIES[0];

    const renderInput = (label: string, name: string, icon: string, index: string, type = 'text', placeholder = '', required = true) => (
        <div className="space-y-3">
            <div className="flex justify-between items-end px-1">
                <span className="material-symbols-rounded text-black/40 dark:text-white/40 mb-1">{icon}</span>
                <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[{index}]</span>
            </div>
            <input
                type={type}
                name={name}
                value={(formData as any)[name] || ''}
                onChange={handleChange}
                placeholder={placeholder}
                required={required}
                className="premium-input"
                autoComplete="off"
                spellCheck="false"
                data-lpignore="true"
            />
        </div>
    );

    const renderSelect = (label: string, name: string, icon: string, index: string, options: { value: string, label: string }[]) => (
        <div className="space-y-3">
            <div className="flex justify-between items-end px-1">
                <span className="material-symbols-rounded text-black/40 dark:text-white/40 mb-1">{icon}</span>
                <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[{index}]</span>
            </div>
            <select
                name={name}
                value={(formData as any)[name]}
                onChange={handleChange}
                className="premium-input"
            >
                {options.map(opt => (
                    <option key={opt.value} value={opt.value} className="bg-white dark:bg-black">{opt.label}</option>
                ))}
            </select>
        </div>
    );

    // --- ICONOS SVG ---
    const IconCheck = ({ className }: { className?: string }) => (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
        </svg>
    );
    // ------------------

    return (
        <div className="min-h-screen flex items-center justify-center p-6 transition-colors relative overflow-hidden industrial-mineral-gradient">
            <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            <div className="w-full max-w-lg relative z-10 transition-all duration-700 text-black dark:text-white">

                {/* Logo Flotante perfectamente alineado */}
                <div className="mb-6 px-10 flex justify-center">
                    <BrandLogo variant="isotype" className="w-1/4 h-auto relative z-10" />
                </div>

                <div className="flex items-center justify-center gap-4 mb-6 animate-in fade-in slide-in-from-top-4 duration-1000 delay-200">
                    <div className="h-[1px] w-8" style={{ backgroundColor: 'rgb(198, 131, 70)' }}></div>
                    <p className="hud-label" style={{ color: 'rgb(198, 131, 70)' }}>MINREPORT®</p>
                    <div className="h-[1px] w-8" style={{ backgroundColor: 'rgb(198, 131, 70)' }}></div>
                </div>

                <div className="elite-tech-surface py-8 px-10 shadow-3xl relative animate-in fade-in zoom-in-95 duration-700 delay-100">
                    <div className="absolute inset-0 technical-grid opacity-20 pointer-events-none"></div>

                    {/* Tabs Standardized */}
                    <div className="flex p-1.5 mb-10 bg-black/5 dark:bg-white/5 rounded-none relative z-10 border border-black/5 dark:border-white/5">
                        {(['ENTERPRISE', 'EDUCATIONAL', 'PERSONAL'] as AccountType[]).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => handleTypeChange(tab)}
                                className={clsx(
                                    "flex-1 py-4 text-[10px] font-black tracking-[0.2em] uppercase transition-all duration-500",
                                    type === tab
                                        ? "bg-black dark:bg-white text-white dark:text-black shadow-xl"
                                        : "text-black/30 dark:text-white/20 hover:text-black/60 dark:hover:text-white/40"
                                )}
                            >
                                {t(`tabs.${tab.toLowerCase()}`)}
                            </button>
                        ))}
                    </div>

                    {success ? (
                        <div className="text-center py-10 relative z-10 space-y-8 animate-in fade-in slide-in-from-bottom-4">
                            <div className="w-20 h-20 bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-600/20 flex items-center justify-center mx-auto shadow-2xl">
                                <IconCheck className="w-10 h-10" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-2xl font-black uppercase tracking-tight">{t('form.submit_success_title', 'Solicitud Enviada')}</h3>
                                <p className="hud-label opacity-60 text-center">{t('form.submit_success_msg', 'Te notificaremos por correo.')}</p>
                            </div>
                            <button
                                onClick={() => setSuccess(false)}
                                className="w-full py-6 bg-black dark:bg-white text-white dark:text-black font-black uppercase tracking-[0.3em] text-[12px] shadow-3xl active:scale-[0.98] transition-all"
                            >
                                {t('form.back', 'Volver')}
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-8 relative z-10" autoComplete="off">
                            {renderSelect(t('form.country'), 'country', 'public', '00', SUPPORTED_COUNTRIES.map(c => ({ value: c.code, label: c.name })))}

                            <div className="space-y-4">
                                {renderInput(t('form.email'), 'email', 'alternate_email', '01', 'email', 'NAME@COMPANY.COM')}
                                {type === 'EDUCATIONAL' && (
                                    <div className="p-4 bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60 text-[10px] uppercase font-bold tracking-tight flex items-start gap-4 border border-black/5 dark:border-white/5">
                                        <span className="material-symbols-rounded text-base text-blue-500">info</span>
                                        <p>{t('errors.public_email')}</p>
                                    </div>
                                )}
                            </div>

                            {type === 'ENTERPRISE' && (
                                <div className="space-y-8">
                                    {renderInput(t('form.applicant_name'), 'applicant_name', 'person', '02')}
                                    {renderInput(t('form.company_name'), 'company_name', 'business', '03')}
                                    {renderInput(formData.country === 'CL' ? 'RUT de la Empresa' : activeCountry.taxLabel, 'rut', 'id_card', '04', 'text', activeCountry.placeholder)}
                                    {renderInput(t('form.industry'), 'industry', 'settings_input_composite', '05')}
                                    {renderInput(`${t('form.website')}`, 'website', 'language', '06', 'text', 'WWW.COMPANY.COM', false)}
                                </div>
                            )}

                            {type === 'EDUCATIONAL' && (
                                <div className="space-y-8">
                                    {renderInput(t('form.applicant_name'), 'applicant_name', 'person', '02')}
                                    {renderInput(formData.country === 'CL' ? 'RUN / Cédula Identidad' : activeCountry.taxLabel, 'run', 'id_card', '03', 'text', activeCountry.placeholder)}

                                    <div className="space-y-4">
                                        <div className="flex justify-between items-end px-1">
                                            <span className="material-symbols-rounded text-black/40 dark:text-white/40 mb-1">school</span>
                                            <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[04]</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {(['ALUMNO', 'ACADEMICO', 'DOCENTE', 'OTRO'] as EducationalProfile[]).map(p => (
                                                <button
                                                    key={p}
                                                    type="button"
                                                    onClick={() => setEduProfile(p)}
                                                    className={clsx(
                                                        "py-4 px-4 border text-[10px] font-black uppercase tracking-widest transition-all duration-300",
                                                        eduProfile === p
                                                            ? "bg-black dark:bg-white border-black dark:border-white text-white dark:text-black shadow-lg"
                                                            : "bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 text-black/30 dark:text-white/20"
                                                    )}
                                                >
                                                    {p}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {renderInput(t('form.institution_name'), 'institution_name', 'apartment', '05')}
                                    {renderInput(`${t('form.institution_web')}`, 'institution_website', 'language', '06', 'text', 'WWW.EDU.CL', false)}
                                    {renderInput(t('form.program_name'), 'program_name', 'history_edu', '07')}
                                    {renderInput(t('form.graduation_date'), 'graduation_date', 'event', '08', 'date')}
                                </div>
                            )}

                            {type === 'PERSONAL' && (
                                <div className="space-y-8">
                                    {renderInput(t('form.full_name'), 'full_name', 'person', '02')}
                                    {renderInput(formData.country === 'CL' ? 'RUN / Cédula Identidad' : activeCountry.taxLabel, 'run', 'id_card', '03', 'text', activeCountry.placeholder)}
                                    {renderSelect(t('form.usage_profile'), 'usage_profile', 'account_circle', '04', [
                                        { value: 'PROFESSIONAL', label: t('form.professional', 'Profesional Independiente') },
                                        { value: 'PERSONAL', label: t('form.personal', 'Proyecto Personal / Hobby') }
                                    ])}
                                </div>
                            )}

                            {error && (
                                <div className="p-4 bg-rose-500/10 text-rose-400 text-[10px] font-mono font-bold flex items-center gap-3 border border-rose-500/30 animate-in fade-in slide-in-from-bottom-2">
                                    <span className="material-symbols-rounded text-base">error</span>
                                    <span className="uppercase tracking-tight">{error}</span>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-6 bg-black dark:bg-white text-white dark:text-black font-black uppercase tracking-[0.3em] text-[12px] transition-all shadow-3xl active:scale-[0.98] disabled:opacity-30 flex items-center justify-center gap-4"
                            >
                                {loading ? (
                                    <div className="w-6 h-6 border-2 border-white/20 dark:border-black/20 border-t-white dark:border-t-black rounded-full animate-spin" />
                                ) : (
                                    <>
                                        <span>SOLICITAR_ENTORNO</span>
                                        <ArrowRight size={20} />
                                    </>
                                )}
                            </button>
                        </form>
                    )}

                    <div className="mt-10 pt-8 border-t border-black/5 dark:border-white/5 text-center relative z-10">
                        <Link to="/login" className="hud-label text-black/30 dark:text-white/20 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 py-3 px-6 transition-all inline-flex items-center gap-3">
                            <ArrowLeft size={14} />
                            <span>[BACK_TO_LOGIN]</span>
                        </Link>
                    </div>
                </div>

                <footer className="mt-8 text-center space-y-4 opacity-40 hover:opacity-100 transition-opacity duration-500">
                    <div className="flex justify-center">
                        <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <p className="text-[10px] text-black/60 dark:text-white uppercase tracking-[0.3em] font-black">
                        © {new Date().getFullYear()} MINREPORT. TODOS LOS DERECHOS RESERVADOS.
                    </p>
                </footer>
            </div>
        </div>
    );
};
