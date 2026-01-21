import { useState, ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ThemeSwitch } from '../components/ThemeSwitch';
export { ThemeSwitch };
import { LanguageSwitch } from '../components/LanguageSwitch';
import { registerUser, RegisterData } from '../services/auth';
import { formatRut, validateRut } from '../utils/rut';
import { SUPPORTED_COUNTRIES } from '../../../src/core/constants';
import clsx from 'clsx';

type AccountType = 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';

export const Register = () => {
    const { t } = useTranslation();
    const [type, setType] = useState<AccountType>('ENTERPRISE');
    const [formData, setFormData] = useState<Partial<RegisterData>>({
        email: '',
        country: 'CL',
        applicant_name: '',
        company_name: '',
        industry: '',
        rut: '',
        website: '',
        institution_name: '',
        institution_type: 'UNIVERSITY',
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
        setFormData(prev => ({ ...prev, email: prev.email })); // Keep common fields
    };

    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;

        let finalValue = value;

        // Auto-format RUT/RUN
        if (name === 'rut' || name === 'run') {
            finalValue = formatRut(value);
        }

        setFormData(prev => ({ ...prev, [name]: finalValue }));
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess(false);

        // Basic Frontend Validation
        const idField = type === 'PERSONAL' ? 'run' : 'rut';
        const idValue = formData[idField];

        if (!validateRut(idValue || '')) {
            setError(`Invalid ${type === 'PERSONAL' ? 'RUN' : 'RUT'} format`);
            return;
        }

        setLoading(true);

        try {
            // Prepare payload based on type
            const payload: any = {
                email: formData.email,
                country: formData.country,
                type,
                // Common/Specific mappings
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
                    institution_type: formData.institution_type,
                    rut: formData.rut
                }),
                ...(type === 'PERSONAL' && {
                    full_name: formData.full_name,
                    run: formData.run,
                    usage_profile: formData.usage_profile
                })
            };

            await registerUser(payload);
            setSuccess(true);
            setFormData(prev => ({ ...prev, email: '' })); // Reset email field
        } catch (err: any) {
            setError(err.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    const activeCountry = SUPPORTED_COUNTRIES.find(c => c.code === formData.country) || SUPPORTED_COUNTRIES[0];

    const renderInput = (label: string, name: string, type = 'text', placeholder = '', required = true) => (
        <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
            <input
                type={type}
                name={name}
                value={(formData as any)[name] || ''}
                onChange={handleChange}
                placeholder={placeholder}
                required={required}
                className={clsx(
                    "w-full px-4 py-2 rounded-md bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700",
                    "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all",
                    "text-slate-900 dark:text-slate-100 placeholder-slate-400"
                )}
                autoComplete="off"
            />
        </div>
    );

    const renderSelect = (label: string, name: string, options: { value: string, label: string }[]) => (
        <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
            <select
                name={name}
                value={(formData as any)[name]}
                onChange={handleChange}
                className={clsx(
                    "w-full px-4 py-2 rounded-md bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700",
                    "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all",
                    "text-slate-900 dark:text-slate-100"
                )}
            >
                {options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>
    );

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-surface-light dark:bg-surface-dark transition-colors">
            <div className="absolute top-4 right-4 flex items-center gap-2">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            <Card className="w-full max-w-lg shadow-xl shadow-black/5 dark:shadow-none">
                <div className="mb-8 text-center">
                    <h1 className="text-2xl font-bold text-primary mb-2">{t('auth.title')}</h1>
                    <p className="text-slate-500 text-sm">{t('auth.subtitle')}</p>
                </div>

                {/* Account Type Tabs */}
                <div className="flex p-1 mb-8 bg-gray-100 dark:bg-white/5 rounded-lg">
                    {(['ENTERPRISE', 'EDUCATIONAL', 'PERSONAL'] as AccountType[]).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => handleTypeChange(tab)}
                            className={clsx(
                                "flex-1 py-2 text-xs font-bold rounded-md transition-all",
                                type === tab
                                    ? "bg-white dark:bg-surface-card-dark text-primary shadow-sm"
                                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                            )}
                        >
                            {t(`tabs.${tab.toLowerCase()}`)}
                        </button>
                    ))}
                </div>

                {success ? (
                    <div className="text-center py-10">
                        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="material-symbols-rounded text-3xl">check</span>
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{t('form.submit_success_title', 'Solicitud Enviada')}</h3>
                        <p className="text-slate-500 mb-6">{t('form.submit_success_msg', 'Tu cuenta está pendiente de aprobación. Te notificaremos por correo.')}</p>
                        <Button onClick={() => setSuccess(false)} variant="secondary">{t('form.back', 'Volver al formulario')}</Button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* Country Selector */}
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

                        {/* Common Fields */}
                        {renderInput(t('form.email'), 'email', 'email', 'name@company.com')}

                        {/* Enterprise Fields */}
                        {type === 'ENTERPRISE' && (
                            <>
                                {renderInput(t('form.applicant_name'), 'applicant_name')}
                                {renderInput(t('form.company_name'), 'company_name')}
                                {renderInput(activeCountry.taxLabel, 'rut', 'text', activeCountry.placeholder)}
                                {renderInput(t('form.industry'), 'industry')}
                                {renderInput(`${t('form.website')} (${t('form.optional', 'Opcional')})`, 'website', 'url', 'https://', false)}
                            </>
                        )}

                        {/* Educational Fields */}
                        {type === 'EDUCATIONAL' && (
                            <>
                                {renderInput(t('form.applicant_name'), 'applicant_name')}
                                {renderInput(t('form.institution_name'), 'institution_name')}
                                {renderSelect(t('form.type', 'Tipo'), 'institution_type', [
                                    { value: 'UNIVERSITY', label: t('form.university', 'Universidad') },
                                    { value: 'INSTITUTE', label: t('form.institute', 'Instituto') },
                                    { value: 'SCHOOL', label: t('form.school', 'Colegio') }
                                ])}
                                {renderInput(activeCountry.taxLabel, 'rut', 'text', activeCountry.placeholder)}
                            </>
                        )}

                        {/* Personal Fields */}
                        {type === 'PERSONAL' && (
                            <>
                                {renderInput(t('form.full_name'), 'full_name')}
                                {renderInput(activeCountry.taxLabel, 'run', 'text', activeCountry.placeholder)}
                                {renderSelect(t('form.usage_profile'), 'usage_profile', [
                                    { value: 'PROFESSIONAL', label: t('form.professional', 'Profesional') },
                                    { value: 'PERSONAL', label: t('form.personal', 'Proyecto Personal') }
                                ])}
                            </>
                        )}

                        {error && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-md flex items-center gap-2">
                                <span className="material-symbols-rounded text-lg">error</span>
                                {error}
                            </div>
                        )}

                        <Button type="submit" className="w-full mt-4" disabled={loading}>
                            {loading ? t('form.submitting') : t('form.submit')}
                        </Button>
                    </form>
                )}

                <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50 text-center">
                    <p className="text-sm text-slate-500">
                        {t('auth.already_have_account', '¿Ya tienes cuenta?')}
                        <Link to="/login" className="ml-2 text-primary font-bold hover:underline">
                            {t('auth.login_link_reg', 'Ingresar aquí')}
                        </Link>
                    </p>
                </div>
            </Card>
        </div>
    );
};
