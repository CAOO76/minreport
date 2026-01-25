import { useState, ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { registerUser, RegisterData } from '../services/auth';
import { formatRut, validateRut } from '../utils/rut';
import { SUPPORTED_COUNTRIES } from '../../../src/core/constants';
import clsx from 'clsx';

// NO importamos librerías externas para evitar errores. 
// Los iconos están definidos abajo como componentes SVG nativos.

type AccountType = 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
type RoleIntent = 'OPERATIONAL' | 'BILLING';

export const Register = () => {
    const { t } = useTranslation();
    const [type, setType] = useState<AccountType>('ENTERPRISE');
    const [roleIntent, setRoleIntent] = useState<RoleIntent | null>(null);

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
        usage_profile: 'PROFESSIONAL'
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleTypeChange = (newType: AccountType) => {
        setType(newType);
        setError('');
        if (newType !== 'ENTERPRISE') setRoleIntent(null);
    };

    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        let finalValue = value;
        if ((name === 'rut' || name === 'run') && formData.country === 'CL') {
            finalValue = formatRut(value);
        }
        setFormData(prev => ({ ...prev, [name]: finalValue }));
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
                roleIntent: roleIntent,
            });
        } else if (type === 'EDUCATIONAL') {
            Object.assign(requiredFields, {
                applicant_name: formData.applicant_name,
                institution_name: formData.institution_name,
                institution_website: formData.institution_website,
                program_name: formData.program_name,
                graduation_date: formData.graduation_date,
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
        if (type !== 'EDUCATIONAL') { // ENTERPRISE or PERSONAL
            const idField = type === 'PERSONAL' ? 'run' : 'rut';
            const idValue = formData[idField];
            if (formData.country === 'CL' && !validateRut(idValue || '')) {
                setError(`Formato de ${type === 'PERSONAL' ? 'RUN' : 'RUT'} inválido`);
                return;
            }
        } else { // EDUCATIONAL
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
                roleIntent: type === 'ENTERPRISE' ? roleIntent : undefined,
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
            setFormData(prev => ({ ...prev, email: '' }));
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

    const renderInput = (label: string, name: string, type = 'text', placeholder = '', required = true) => (
        <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-antigravity-light-muted dark:text-antigravity-dark-muted uppercase tracking-wider">{label}</label>
            <input
                type={type}
                name={name}
                value={(formData as any)[name] || ''}
                onChange={handleChange}
                placeholder={placeholder}
                required={required}
                className={clsx(
                    "w-full px-4 py-2 rounded-md bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-slate-700",
                    "focus:outline-none focus:border-antigravity-accent focus:ring-1 focus:ring-antigravity-accent transition-all",
                    "text-antigravity-light-text dark:text-antigravity-dark-text placeholder-slate-400"
                )}
                autoComplete="off"
            />
        </div>
    );

    const renderSelect = (label: string, name: string, options: { value: string, label: string }[]) => (
        <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-antigravity-light-muted dark:text-antigravity-dark-muted uppercase tracking-wider">{label}</label>
            <select
                name={name}
                value={(formData as any)[name]}
                onChange={handleChange}
                className={clsx(
                    "w-full px-4 py-2 rounded-md bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-slate-700",
                    "focus:outline-none focus:border-antigravity-accent focus:ring-1 focus:ring-antigravity-accent transition-all",
                    "text-antigravity-light-text dark:text-antigravity-dark-text"
                )}
            >
                {options.map(opt => (
                    <option key={opt.value} value={opt.value} className="bg-white dark:bg-slate-900">{opt.label}</option>
                ))}
            </select>
        </div>
    );

    // --- ICONOS SVG ---
    const IconHardHat = ({ className }: { className?: string }) => (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2z" /><path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" /><path d="M4 15v-3a6 6 0 0 1 6-6h0" /><path d="M14 6h0a6 6 0 0 1 6 6v3" />
        </svg>
    );

    const IconCreditCard = ({ className }: { className?: string }) => (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" />
        </svg>
    );

    const IconCheck = ({ className }: { className?: string }) => (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
        </svg>
    );
    // ------------------

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-antigravity-light-bg dark:bg-antigravity-dark-bg transition-colors">
            <div className="absolute top-4 right-4 flex items-center gap-2">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            <Card className="w-full max-w-lg shadow-xl shadow-black/5 dark:shadow-none my-8 bg-antigravity-light-surface dark:bg-antigravity-dark-surface border border-antigravity-light-border dark:border-antigravity-dark-border">
                <div className="mb-8 text-center">
                    <h1 className="text-2xl font-bold text-antigravity-accent mb-2">{t('auth.title')}</h1>
                    <p className="text-antigravity-light-muted dark:text-antigravity-dark-muted text-sm">{t('auth.subtitle')}</p>
                </div>

                <div className="flex p-1 mb-8 bg-slate-100 dark:bg-white/5 rounded-lg">
                    {(['ENTERPRISE', 'EDUCATIONAL', 'PERSONAL'] as AccountType[]).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => handleTypeChange(tab)}
                            className={clsx(
                                "flex-1 py-2 text-xs font-bold rounded-md transition-all",
                                type === tab
                                    ? "bg-white dark:bg-slate-800 text-antigravity-accent shadow-sm"
                                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                            )}
                        >
                            {t(`tabs.${tab.toLowerCase()}`)}
                        </button>
                    ))}
                </div>

                {success ? (
                    <div className="text-center py-10">
                        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
                            <IconCheck className="w-8 h-8" />
                        </div>
                        <h3 className="text-xl font-bold text-antigravity-light-text dark:text-antigravity-dark-text mb-2">{t('form.submit_success_title', 'Solicitud Enviada')}</h3>
                        <p className="text-antigravity-light-muted dark:text-antigravity-dark-muted mb-6">{t('form.submit_success_msg', 'Te notificaremos por correo.')}</p>
                        <Button onClick={() => setSuccess(false)} variant="secondary">{t('form.back', 'Volver')}</Button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('form.country')}</label>
                            <select
                                name="country"
                                value={formData.country}
                                onChange={handleChange}
                                className={clsx(
                                    "w-full px-4 py-2 rounded-md bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 font-medium",
                                    "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all",
                                    "text-slate-900 dark:text-slate-100 placeholder-slate-400"
                                )}
                            >
                                {SUPPORTED_COUNTRIES.map(c => (
                                    <option key={c.code} value={c.code}>{c.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-4">
                            {renderInput(t('form.email'), 'email', 'email', 'name@company.com')}
                            {type === 'EDUCATIONAL' && (
                                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs rounded-md flex items-start gap-2 border border-blue-100 dark:border-blue-800">
                                    <span className="text-lg">ℹ️</span>
                                    <p>{t('errors.public_email')}</p>
                                </div>
                            )}
                        </div>

                        {type === 'ENTERPRISE' && (
                            <>
                                {renderInput(t('form.applicant_name'), 'applicant_name')}
                                {renderInput(t('form.company_name'), 'company_name')}

                                {/* === ZONA NUEVA: SELECTOR DE PERFIL B2B (SVG PREMIUM) === */}
                                <div className="space-y-2 pt-2 pb-2">
                                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Perfil de Usuario</label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div
                                            onClick={() => setRoleIntent('OPERATIONAL')}
                                            className={clsx(
                                                "cursor-pointer rounded-lg border p-3 flex flex-col items-center text-center transition-all relative group",
                                                roleIntent === 'OPERATIONAL'
                                                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                                                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                                            )}
                                        >
                                            <IconHardHat className={clsx("h-6 w-6 mb-2 transition-colors", roleIntent === 'OPERATIONAL' ? "text-primary" : "text-gray-400 group-hover:text-gray-500")} />
                                            <p className="text-xs font-bold text-slate-900 dark:text-white">Dueño / Operativo</p>
                                            <p className="text-[10px] text-slate-500 leading-tight mt-1">Gestión completa</p>
                                            {roleIntent === 'OPERATIONAL' && (
                                                <div className="absolute top-2 right-2 text-primary">
                                                    <IconCheck className="w-4 h-4" />
                                                </div>
                                            )}
                                        </div>

                                        <div
                                            onClick={() => setRoleIntent('BILLING')}
                                            className={clsx(
                                                "cursor-pointer rounded-lg border p-3 flex flex-col items-center text-center transition-all relative group",
                                                roleIntent === 'BILLING'
                                                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                                                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                                            )}
                                        >
                                            <IconCreditCard className={clsx("h-6 w-6 mb-2 transition-colors", roleIntent === 'BILLING' ? "text-primary" : "text-gray-400 group-hover:text-gray-500")} />
                                            <p className="text-xs font-bold text-slate-900 dark:text-white">Comprador</p>
                                            <p className="text-[10px] text-slate-500 leading-tight mt-1">Solo pagos</p>
                                            {roleIntent === 'BILLING' && (
                                                <div className="absolute top-2 right-2 text-primary">
                                                    <IconCheck className="w-4 h-4" />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {/* ============================================= */}

                                {renderInput(formData.country === 'CL' ? 'RUT' : activeCountry.taxLabel, 'rut', 'text', activeCountry.placeholder)}
                                {renderInput(t('form.industry'), 'industry')}
                                {renderInput(`${t('form.website')} (${t('form.optional')})`, 'website', 'text', 'www.company.com', false)}
                            </>
                        )}

                        {type === 'EDUCATIONAL' && (
                            <>
                                {renderInput(t('form.applicant_name'), 'applicant_name')}
                                {renderInput(t('form.institution_name'), 'institution_name')}
                                {renderInput(t('form.institution_web'), 'institution_website', 'text', 'www.edu.cl')}
                                {renderInput(t('form.program_name'), 'program_name')}
                                {renderInput(t('form.graduation_date'), 'graduation_date', 'date')}
                            </>
                        )}

                        {type === 'PERSONAL' && (
                            <>
                                {renderInput(t('form.full_name'), 'full_name')}
                                {renderInput(formData.country === 'CL' ? 'RUN' : activeCountry.taxLabel, 'run', 'text', activeCountry.placeholder)}
                                {renderSelect(t('form.usage_profile'), 'usage_profile', [
                                    { value: 'PROFESSIONAL', label: t('form.professional', 'Profesional') },
                                    { value: 'PERSONAL', label: t('form.personal', 'Proyecto Personal') }
                                ])}
                            </>
                        )}

                        {error && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-md flex items-center gap-2">
                                <span className="font-bold">!</span>
                                {error}
                            </div>
                        )}

                        <Button type="submit" className="w-full mt-4" disabled={loading}>
                            {loading ? t('form.submitting', 'Enviando...') : t('form.submit', 'Enviar Solicitud')}
                        </Button>
                    </form>
                )}

                <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50 text-center">
                    <p className="text-sm text-antigravity-light-muted dark:text-antigravity-dark-muted">
                        {t('auth.already_have_account', '¿Ya tienes cuenta?')}
                        <Link to="/login" className="ml-2 text-antigravity-accent font-bold hover:underline">
                            {t('auth.login_link_reg', 'Ingresar aquí')}
                        </Link>
                    </p>
                </div>
            </Card>
        </div>
    );
};
