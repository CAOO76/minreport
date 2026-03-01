import { useState, useEffect, ChangeEvent, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { registerUser, checkAccountsById, RegisterData } from '../services/auth';
import { formatRut, validateRut } from '../utils/rut';
import { SUPPORTED_COUNTRIES } from '../../../src/core/constants';
import clsx from 'clsx';
import siiActivities from '../data/sii_activities.json';
import { useGooglePlaces } from '../hooks/useGooglePlaces';

type AccountType = 'ENTERPRISE' | 'EDUCATIONAL' | 'PERSONAL';
type EducationalProfile = 'ALUMNO' | 'ACADEMICO' | 'DOCENTE' | 'OTRO';

export const Register = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    // Wizard State
    const [step, setStep] = useState(1);

    const [type, setType] = useState<AccountType>('ENTERPRISE');
    const totalSteps = type === 'ENTERPRISE' ? 5 : 4;
    const [eduProfile, setEduProfile] = useState<EducationalProfile | null>(null);

    const [formData, setFormData] = useState<Partial<RegisterData>>({
        email: '',
        country: 'CL',
        applicant_name: '',
        job_title: '',
        company_name: '',
        industry: '',
        rut: '',
        website: '',
        address: '',
        postal_code: '',
        city: '',
        commune: '',
        region: '',
        billing_email: '',
        email_domain: '',
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
    const [isCheckingId, setIsCheckingId] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    // GIRO SII & EMAIL UI States
    const [searchTerm, setSearchTerm] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // GOOGLE MAPS ADDRESS UI States
    const [addressSearchTerm, setAddressSearchTerm] = useState('');
    const [showAddressDropdown, setShowAddressDropdown] = useState(false);
    const [addressPredictions, setAddressPredictions] = useState<any[]>([]);
    const addressDropdownRef = useRef<HTMLDivElement>(null);

    const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    const { isLoaded: isGoogleLoaded, loadError: googleLoadError, getPredictions, getPlaceDetails } = useGooglePlaces(googleApiKey);

    // Click outside dropdowns
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
            if (addressDropdownRef.current && !addressDropdownRef.current.contains(event.target as Node)) {
                setShowAddressDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Debounced search for places
    useEffect(() => {
        if (!addressSearchTerm || !showAddressDropdown) {
            setAddressPredictions([]);
            return;
        }
        const timer = setTimeout(async () => {
            const results = await getPredictions(addressSearchTerm);
            setAddressPredictions(results);
        }, 300);
        return () => clearTimeout(timer);
    }, [addressSearchTerm, getPredictions, showAddressDropdown]);

    const handleSelectAddress = async (placeId: string, description: string) => {
        setFormData((prev: any) => ({ ...prev, address: description }));
        setAddressSearchTerm(description);
        setShowAddressDropdown(false);

        const details = await getPlaceDetails(placeId);
        if (!details || !details.address_components) return;

        let streetNumber = '';
        let route = '';
        let locality = '';
        let sublocality = '';
        let adminArea1 = '';
        let postalCode = '';

        for (const component of details.address_components) {
            const types = component.types;
            if (types.includes('street_number')) streetNumber = component.long_name;
            if (types.includes('route')) route = component.long_name;
            if (types.includes('locality')) locality = component.long_name;
            if (types.includes('administrative_area_level_3') || types.includes('sublocality')) {
                sublocality = component.long_name;
            }
            if (types.includes('administrative_area_level_1')) adminArea1 = component.long_name;
            if (types.includes('postal_code')) postalCode = component.long_name;
        }

        if (!sublocality) sublocality = locality;

        const formattedAddress = `${route} ${streetNumber}`.trim() || description;

        // Auto-fill form fields
        setFormData((prev: any) => ({
            ...prev,
            address: formattedAddress,
            city: locality || prev.city,
            commune: sublocality || prev.commune,
            region: adminArea1 || prev.region,
            postal_code: postalCode || prev.postal_code,
        }));
    };

    const filteredActivities = useMemo(() => {
        const list = Array.isArray(siiActivities) ? siiActivities : (siiActivities as any).default || [];
        if (!searchTerm) return list.slice(0, 10);
        const term = searchTerm.toLowerCase();
        return (list as any[]).filter(a =>
            a.label.toLowerCase().includes(term) || a.code.includes(term)
        ).slice(0, 15);
    }, [searchTerm]);

    // Zero Memory Policy
    useEffect(() => {
        return () => {
            setFormData({
                email: '', country: 'CL', applicant_name: '', company_name: '', industry: '',
                rut: '', website: '', address: '', postal_code: '', billing_email: '', email_domain: '',
                institution_name: '', institution_website: '', program_name: '',
                graduation_date: '', full_name: '', run: '', usage_profile: 'PROFESSIONAL', profile: ''
            });
            setError('');
            setSuccess(false);
            setStep(1);
        };
    }, []);

    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        let finalValue = value;
        if ((name === 'rut' || name === 'run') && formData.country === 'CL') {
            finalValue = formatRut(value);
        }
        setFormData((prev: any) => ({ ...prev, [name]: finalValue }));
        setError('');
    };

    const isPublicEmail = (email: string) => {
        const domain = email.split('@')[1]?.toLowerCase();
        return domain && ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'].includes(domain);
    };

    const verifyIdentityAndAdvance = async () => {
        const taxIdField = type === 'ENTERPRISE' ? 'rut' : 'run';
        const rawId = (formData as any)[taxIdField];

        if (!rawId) {
            setError(`Debe ingresar su ${(formData.country === 'CL' ? taxIdField.toUpperCase() : 'Identificador')}`);
            return;
        }

        if (formData.country === 'CL' && !validateRut(rawId)) {
            setError(`Formato de ${taxIdField.toUpperCase()} inválido`);
            return;
        }

        setIsCheckingId(true);
        setError('');

        try {
            const { accounts } = await checkAccountsById(rawId);

            // Regla de Integridad de Cuentas:
            if (accounts && accounts.length > 0) {
                if (type === 'PERSONAL') {
                    const hasPersonal = accounts.some(acc => acc.type === 'PERSONAL');
                    if (hasPersonal) {
                        const isPending = accounts.find(acc => acc.type === 'PERSONAL')?.status === 'PENDING_APPROVAL';
                        setError(isPending
                            ? 'SOLICITUD EN PROCESO: Ya tienes una petición de Cuenta Personal pendiente de aprobación.'
                            : 'RESTRICCIÓN: Ya existe una CA-Personal activa asociada a este RUN.');
                        setIsCheckingId(false);
                        return;
                    }
                }

                if (type === 'EDUCATIONAL') {
                    const hasEducational = accounts.some(acc => acc.type === 'EDUCATIONAL');
                    if (hasEducational) {
                        const isPending = accounts.find(acc => acc.type === 'EDUCATIONAL')?.status === 'PENDING_APPROVAL';
                        setError(isPending
                            ? 'SOLICITUD EN PROCESO: Ya tienes una petición de Cuenta Educacional pendiente de aprobación.'
                            : 'RESTRICCIÓN: Ya existe una CA-Educacional activa asociada a este RUN.');
                        setIsCheckingId(false);
                        return;
                    }
                }

                if (type === 'ENTERPRISE') {
                    const hasEnterprise = accounts.some(acc => acc.type === 'ENTERPRISE' || acc.type === 'BUSINESS');
                    if (hasEnterprise) {
                        const isPending = accounts.find(acc => acc.type === 'ENTERPRISE' || acc.type === 'BUSINESS')?.status === 'PENDING_APPROVAL';
                        setError(isPending
                            ? 'SOLICITUD EN PROCESO: Esta empresa ya tiene una petición de registro pendiente de validación.'
                            : 'ENTIDAD REGISTRADA: Esta empresa ya posee un entorno activo en MINREPORT.');
                        setIsCheckingId(false);
                        return;
                    }
                }
            }

            // Validación Pasada (No existe cuenta conflictiva)
            setStep(3);
        } catch (err: any) {
            setError('Fallo de conexión al Directorio de Identidades. Intente nuevamente.');
            console.error(err);
        } finally {
            setIsCheckingId(false);
        }
    };

    const handleNextStep = () => {
        setError('');

        if (step === 2) {
            verifyIdentityAndAdvance();
            return;
        }

        if (step === 3) {
            if (type === 'ENTERPRISE') {
                if (!formData.company_name || !formData.industry || !formData.address || !formData.billing_email) {
                    setError('Complete todos los campos obligatorios de la empresa');
                    return;
                }
                setStep(4);
                return;
            }

            if (type === 'EDUCATIONAL') {
                if (!formData.email || !formData.applicant_name || !formData.institution_name || !eduProfile) {
                    setError('Todos los campos base y perfil son obligatorios');
                    return;
                }
                if (isPublicEmail(formData.email)) {
                    setError(t('errors.public_email'));
                    return;
                }
            }

            if (type === 'PERSONAL') {
                if (!formData.email || !formData.full_name || !formData.usage_profile) {
                    setError('Todos los campos son obligatorios');
                    return;
                }
            }

            setStep(4);
            return;
        }

        if (step === 4 && type === 'ENTERPRISE') {
            if (!formData.applicant_name || !formData.job_title || !formData.email) {
                setError('Complete todos los datos del solicitante');
                return;
            }
            setStep(5);
            return;
        }

        setStep(s => Math.min(s + 1, totalSteps));
    };

    const handlePrevStep = () => {
        setError('');
        setStep(s => Math.max(s - 1, 1));
    };

    const handleTypeSelect = (selectedType: AccountType) => {
        setType(selectedType);
        setError('');
        setEduProfile(null);
        setStep(2);
    };

    const handleCancel = () => {
        navigate('/');
    };

    const handleFinalSubmit = async () => {
        setLoading(true);
        setError('');

        try {
            const payload: any = {
                email: formData.email,
                country: formData.country,
                type,
                ...(type === 'ENTERPRISE' && {
                    applicant_name: formData.applicant_name,
                    job_title: formData.job_title,
                    company_name: formData.company_name,
                    industry: formData.industry,
                    rut: formData.rut,
                    website: formData.website,
                    address: formData.address,
                    postal_code: formData.postal_code,
                    city: formData.city,
                    commune: formData.commune,
                    region: formData.region,
                    billing_email: formData.billing_email,
                    email_domain: formData.email_domain
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
        } catch (err: any) {
            const errorMessage = (err.message || '').toLowerCase();
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

    const renderInput = (name: string, icon: string, index: string, inputType = 'text', placeholder = '', required = true) => (
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex justify-between items-end px-1">
                <span className="material-symbols-rounded text-black/40 dark:text-white/40 mb-1">{icon}</span>
                <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[{index}]</span>
            </div>
            <input
                type={inputType}
                name={name}
                value={(formData as any)[name] || ''}
                onChange={handleChange}
                placeholder={placeholder}
                required={required}
                className="premium-input rounded-none"
                autoComplete="off"
                spellCheck="false"
                data-lpignore="true"
            />
        </div>
    );

    const renderSelect = (name: string, icon: string, index: string, options: { value: string, label: string }[]) => (
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex justify-between items-end px-1">
                <span className="material-symbols-rounded text-black/40 dark:text-white/40 mb-1">{icon}</span>
                <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[{index}]</span>
            </div>
            <select
                name={name}
                value={(formData as any)[name]}
                onChange={handleChange}
                className="premium-input rounded-none"
            >
                {options.map(opt => (
                    <option key={opt.value} value={opt.value} className="bg-white dark:bg-black">{opt.label}</option>
                ))}
            </select>
        </div>
    );

    const renderPreviewRow = (label: string, value: string) => (
        <div className="flex justify-between items-start py-4 border-b border-black/5 dark:border-white/5 last:border-0 group gap-8">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-black/40 dark:text-white/30 shrink-0 pt-0.5">{label}</span>
            <span className="text-[12px] font-bold tracking-tight text-right text-black dark:text-white leading-relaxed">{value || '---'}</span>
        </div>
    );

    const renderSectionHeader = (title: string) => (
        <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-antigravity-accent border-b border-antigravity-accent/20 pb-2 mb-4 bg-antigravity-accent/5 px-2 py-1">
            {title}
        </h3>
    );

    const IconCheck = ({ className }: { className?: string }) => (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
        </svg>
    );

    return (
        <div className="min-h-screen flex items-center justify-center p-6 transition-colors relative overflow-hidden industrial-mineral-gradient font-atkinson">
            <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            <div className={clsx(
                "w-full relative z-10 transition-all duration-700 text-black dark:text-white",
                step === totalSteps ? "max-w-2xl" : "max-w-lg"
            )}>

                {/* Logo Flotante perfectamente alineado */}
                <div className="mb-6 px-10 flex justify-center">
                    <BrandLogo variant="isotype" className="w-1/4 h-auto relative z-10" />
                </div>

                <div className="flex items-center justify-center gap-4 mb-6 animate-in fade-in slide-in-from-top-4 duration-1000 delay-200">
                    <div className="h-[1px] w-8 bg-antigravity-accent"></div>
                    <p className="hud-label text-antigravity-accent tracking-[0.4em]">MINREPORT®</p>
                    <div className="h-[1px] w-8 bg-antigravity-accent"></div>
                </div>

                <div className="elite-tech-surface shadow-3xl relative animate-in fade-in zoom-in-95 duration-700 delay-100 overflow-hidden rounded-none border-black/10 dark:border-white/10">
                    <div className="absolute inset-0 technical-grid opacity-20 pointer-events-none"></div>

                    {/* Barra de Progreso Superior */}
                    {!success && (
                        <div className="absolute top-0 left-0 w-full h-[3px] bg-black/5 dark:bg-white/5 z-20">
                            <div
                                className="h-full bg-antigravity-accent transition-all duration-700 ease-out"
                                style={{ width: `${((step - 1) / (totalSteps - 1)) * 100}%` }}
                            />
                        </div>
                    )}

                    {/* Cabecera / Acciones Globales */}
                    <div className="relative z-20 px-8 pt-8 flex justify-between items-center mb-6">
                        {step > 1 && !success ? (
                            <button
                                onClick={handlePrevStep}
                                className="text-[10px] font-black uppercase tracking-[0.2em] text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors flex items-center gap-2"
                            >
                                <span className="material-symbols-rounded text-base">arrow_back</span>
                            </button>
                        ) : (
                            <div /> /* Espaciador */
                        )}

                        {!success && (
                            <button
                                onClick={handleCancel}
                                className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-500/60 hover:text-rose-500 hover:bg-rose-500/10 py-2 px-3 transition-colors flex items-center gap-2 rounded-none"
                                title="Cancelar y volver al Inicio"
                            >
                                <span className="material-symbols-rounded text-base">close</span>
                            </button>
                        )}
                    </div>

                    <div className="px-10 pb-10 relative z-10">
                        {success ? (
                            <div className="text-center py-6 space-y-8 animate-in fade-in slide-in-from-bottom-4">
                                <div className="w-20 h-20 bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-600/20 flex items-center justify-center mx-auto shadow-2xl rounded-none">
                                    <IconCheck className="w-10 h-10" />
                                </div>
                                <div className="space-y-2">
                                    <h3 className="text-2xl font-black uppercase tracking-tight">{t('form.submit_success_title', 'Solicitud Enviada')}</h3>
                                    <p className="hud-label opacity-60 text-center">{t('form.submit_success_msg', 'Te notificaremos por correo.')}</p>
                                </div>
                                <button
                                    onClick={() => navigate('/')}
                                    className="w-full py-6 bg-black dark:bg-white text-white dark:text-black font-black uppercase tracking-[0.3em] text-[12px] shadow-3xl active:scale-[0.98] transition-all rounded-none"
                                >
                                    VOLVER AL INICIO
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-8">
                                {/* HEADER TEXT PER STEP */}
                                <div className="space-y-2 mb-8 animate-in fade-in duration-500">
                                    <div className="flex justify-between items-start mb-2">
                                        <h2 className="text-2xl font-black uppercase tracking-tighter">
                                            {step === 1 && "Tipo de Entorno"}
                                            {step === 2 && "Identificación"}
                                            {step === 3 && type === 'ENTERPRISE' && "Datos Corporativos"}
                                            {step === 3 && type === 'EDUCATIONAL' && "Datos Institucionales"}
                                            {step === 3 && type === 'PERSONAL' && "Datos Biográficos"}
                                            {step === 4 && type !== 'ENTERPRISE' && "Revisión Final"}
                                            {step === 4 && type === 'ENTERPRISE' && "Datos Solicitante"}
                                            {step === 5 && type === 'ENTERPRISE' && "Revisión Final"}
                                        </h2>
                                        {step > 1 && (
                                            <div className="flex items-center gap-2 text-[9px] text-antigravity-accent uppercase font-black tracking-[0.2em] px-3 py-1.5 bg-antigravity-accent/10 border border-antigravity-accent/20 rounded-none">
                                                {type === 'ENTERPRISE' && <span className="material-symbols-rounded text-[12px]">domain</span>}
                                                {type === 'EDUCATIONAL' && <span className="material-symbols-rounded text-[12px]">school</span>}
                                                {type === 'PERSONAL' && <span className="material-symbols-rounded text-[12px]">person</span>}
                                                <span>{t(`tabs.${type.toLowerCase()}`)}</span>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-[10px] opacity-40 uppercase tracking-widest font-black">
                                        Paso {step} de {totalSteps}
                                    </p>
                                </div>

                                {step === 1 && (
                                    <div className="space-y-4">
                                        <button onClick={() => handleTypeSelect('ENTERPRISE')} className="w-full p-6 border border-black/10 dark:border-white/10 hover:border-antigravity-accent hover:bg-antigravity-accent/5 transition-all text-left flex items-start gap-4 group bg-black/5 dark:bg-white/5 rounded-none">
                                            <span className="material-symbols-rounded text-2xl text-black/40 dark:text-white/40 group-hover:text-antigravity-accent transition-colors shrink-0">domain</span>
                                            <div>
                                                <h3 className="font-black uppercase tracking-widest text-sm mb-1 group-hover:text-antigravity-accent transition-colors">{t('tabs.enterprise')}</h3>
                                                <p className="text-[11px] text-black/60 dark:text-white/60 leading-relaxed font-medium">Diseñado para operaciones mineras, contratistas y corporaciones. Acceso completo a módulos industriales.</p>
                                            </div>
                                        </button>
                                        <button onClick={() => handleTypeSelect('EDUCATIONAL')} className="w-full p-6 border border-black/10 dark:border-white/10 hover:border-antigravity-accent hover:bg-antigravity-accent/5 transition-all text-left flex items-start gap-4 group bg-black/5 dark:bg-white/5 rounded-none">
                                            <span className="material-symbols-rounded text-2xl text-black/40 dark:text-white/40 group-hover:text-antigravity-accent transition-colors shrink-0">school</span>
                                            <div>
                                                <h3 className="font-black uppercase tracking-widest text-sm mb-1 group-hover:text-antigravity-accent transition-colors">{t('tabs.educational')}</h3>
                                                <p className="text-[11px] text-black/60 dark:text-white/60 leading-relaxed font-medium">Entorno de aprendizaje para universidades, docentes y alumnos orientados a la industria minera.</p>
                                            </div>
                                        </button>
                                        <button onClick={() => handleTypeSelect('PERSONAL')} className="w-full p-6 border border-black/10 dark:border-white/10 hover:border-antigravity-accent hover:bg-antigravity-accent/5 transition-all text-left flex items-start gap-4 group bg-black/5 dark:bg-white/5 rounded-none">
                                            <span className="material-symbols-rounded text-2xl text-black/40 dark:text-white/40 group-hover:text-antigravity-accent transition-colors shrink-0">person</span>
                                            <div>
                                                <h3 className="font-black uppercase tracking-widest text-sm mb-1 group-hover:text-antigravity-accent transition-colors">{t('tabs.personal')}</h3>
                                                <p className="text-[11px] text-black/60 dark:text-white/60 leading-relaxed font-medium">Para profesionales independientes o proyectos personales con funcionalidades reducidas.</p>
                                            </div>
                                        </button>
                                    </div>
                                )}

                                {step === 2 && (
                                    <div className="space-y-8">
                                        <div className="p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-none">
                                            <p className="text-[11px] text-black/60 dark:text-white/60 font-medium leading-relaxed">
                                                Para garantizar la integridad y aplicar políticas de gobernanza, necesitamos verificar si ya posee un entorno asignado.
                                            </p>
                                        </div>
                                        {renderSelect('country', 'public', '00', SUPPORTED_COUNTRIES.map(c => ({ value: c.code, label: c.name })))}
                                        {type === 'ENTERPRISE' && renderInput('rut', 'id_card', '01', 'text', activeCountry.placeholder)}
                                        {(type === 'EDUCATIONAL' || type === 'PERSONAL') && renderInput('run', 'id_card', '01', 'text', activeCountry.placeholder)}
                                        <button
                                            onClick={handleNextStep}
                                            disabled={isCheckingId}
                                            className="w-full py-6 bg-black dark:bg-white text-white dark:text-black font-black transition-all shadow-3xl active:scale-[0.98] disabled:opacity-30 flex justify-center items-center rounded-none"
                                        >
                                            {isCheckingId ? (
                                                <div className="w-5 h-5 border-2 border-white/20 dark:border-black/20 border-t-white dark:border-t-black rounded-full animate-spin" />
                                            ) : (
                                                <span className="material-symbols-rounded text-2xl">arrow_forward</span>
                                            )}
                                        </button>
                                    </div>
                                )}

                                {step === 3 && (
                                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                                        {/* Common fields for Non-Enterprise Step 3 */}
                                        {type !== 'ENTERPRISE' && (
                                            <>
                                                {renderInput('email', 'alternate_email', '02', 'email', 'NAME@DOMAIN.COM')}
                                                {type === 'EDUCATIONAL' && (
                                                    <div className="p-4 bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60 text-[10px] uppercase font-bold tracking-tight flex items-start gap-4 border border-black/5 dark:border-white/5 mt-4 rounded-none">
                                                        <span className="material-symbols-rounded text-base text-blue-500">info</span>
                                                        <p>{t('errors.public_email')}</p>
                                                    </div>
                                                )}
                                                <div className="h-[1px] bg-black/5 dark:bg-white/5 w-full my-6"></div>
                                            </>
                                        )}

                                        {/* Enterprise Step 3: Corporate Data */}
                                        {type === 'ENTERPRISE' && (
                                            <div className="space-y-6">
                                                <h3 className="text-[10px] font-bold uppercase tracking-widest text-black/40 dark:text-white/40 border-b border-black/10 dark:border-white/10 pb-2">Información de la Entidad</h3>
                                                {renderInput('company_name', 'apartment', '01', 'text', 'RAZÓN SOCIAL')}

                                                {/* Giro Comercial */}
                                                <div className="space-y-3">
                                                    <div className="flex justify-between items-end px-1">
                                                        <span className="material-symbols-rounded text-black/40 dark:text-white/40 mb-1">work</span>
                                                        <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[03]</span>
                                                    </div>
                                                    {formData.country === 'CL' ? (
                                                        <div className="relative" ref={dropdownRef}>
                                                            <input
                                                                type="text" autoComplete="off"
                                                                placeholder="BUSCAR GIRO COMERCIAL SII..."
                                                                value={searchTerm || formData.industry}
                                                                onFocus={() => setShowDropdown(true)}
                                                                onChange={e => {
                                                                    setSearchTerm(e.target.value);
                                                                    setShowDropdown(true);
                                                                    if (!e.target.value) setFormData(prev => ({ ...prev, industry: '' }));
                                                                }}
                                                                className="premium-input rounded-none"
                                                                spellCheck="false"
                                                            />
                                                            {showDropdown && (
                                                                <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 shadow-2xl max-h-48 overflow-y-auto rounded-none">
                                                                    {filteredActivities.length > 0 ? (
                                                                        filteredActivities.map((act: any) => (
                                                                            <button key={act.code} type="button"
                                                                                onClick={() => {
                                                                                    setFormData(prev => ({ ...prev, industry: act.label }));
                                                                                    setSearchTerm(act.label);
                                                                                    setShowDropdown(false);
                                                                                }}
                                                                                className="w-full text-left px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5 border-b border-black/5 dark:border-white/5 last:border-0 transition-colors"
                                                                            >
                                                                                <p className="text-[9px] font-mono font-bold text-copper-500">{act.code}</p>
                                                                                <p className="text-[10px] font-bold uppercase truncate">{act.label}</p>
                                                                            </button>
                                                                        ))
                                                                    ) : (
                                                                        <div className="px-4 py-4 text-[10px] uppercase opacity-40">Sin resultados</div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <input
                                                            type="text" name="industry" placeholder="GIRO / INDUSTRIA"
                                                            value={formData.industry} onChange={handleChange} className="premium-input rounded-none"
                                                            autoComplete="off" spellCheck="false"
                                                        />
                                                    )}
                                                </div>

                                                {/* Dirección */}
                                                <div className="space-y-3">
                                                    <div className="flex justify-between items-end px-1">
                                                        <span className="material-symbols-rounded text-black/40 dark:text-white/40 mb-1">location_on</span>
                                                        <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[04]</span>
                                                    </div>
                                                    <div className="relative" ref={addressDropdownRef}>
                                                        <input
                                                            type="text" autoComplete="off"
                                                            placeholder="DIRECCIÓN COMERCIAL (SEDE PRINCIPAL)..."
                                                            value={showAddressDropdown ? addressSearchTerm : formData.address}
                                                            onFocus={() => setShowAddressDropdown(true)}
                                                            onChange={e => {
                                                                setAddressSearchTerm(e.target.value);
                                                                setFormData(prev => ({ ...prev, address: e.target.value }));
                                                                setShowAddressDropdown(true);
                                                            }}
                                                            className="premium-input rounded-none"
                                                            spellCheck="false"
                                                        />
                                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                                            {isGoogleLoaded ? <span className="material-symbols-rounded text-base opacity-20">search</span> : <div className="w-3 h-3 border border-black/20 dark:border-white/20 border-t-antigravity-accent animate-spin rounded-full" />}
                                                        </div>
                                                        {showAddressDropdown && addressPredictions.length > 0 && (
                                                            <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 shadow-2xl max-h-48 overflow-y-auto rounded-none">
                                                                {addressPredictions.map((pred) => (
                                                                    <button key={pred.place_id} type="button"
                                                                        onClick={() => handleSelectAddress(pred.place_id, pred.description)}
                                                                        className="w-full text-left px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5 border-b border-black/5 dark:border-white/5 last:border-0 transition-colors"
                                                                    >
                                                                        <p className="text-[10px] font-bold uppercase truncate">{pred.structured_formatting.main_text}</p>
                                                                        <p className="text-[9px] opacity-40 truncate uppercase">{pred.structured_formatting.secondary_text}</p>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {googleLoadError && (
                                                        <div className="p-3 bg-rose-500/5 border border-rose-500/20 space-y-1 rounded-none">
                                                            <p className="text-[9px] text-rose-500 uppercase font-black tracking-tighter flex items-center gap-2">
                                                                <span className="material-symbols-rounded text-sm">warning</span>
                                                                Error de Configuración Google Maps
                                                            </p>
                                                            <p className="text-[8px] text-rose-500/60 uppercase font-bold leading-tight">
                                                                {googleLoadError.includes('API_KEY_DENIED')
                                                                    ? 'La API Key no tiene habilitado "Places API" (Legacy) en Google Cloud Console. Debe activarlo para búsqueda automática.'
                                                                    : googleLoadError}
                                                            </p>
                                                            <p className="text-[8px] opacity-40 uppercase font-black tracking-widest pt-1">Continuar con ingreso manual:</p>
                                                        </div>
                                                    )}
                                                </div>

                                                {renderInput('billing_email', 'mail', '05', 'email', 'EMAIL DE FACTURACIÓN')}
                                                {renderInput('website', 'language', '06', 'text', 'SITIO WEB', false)}
                                            </div>
                                        )}

                                        {/* Profiles for Non-Enterprise Step 3 */}
                                        {type === 'EDUCATIONAL' && (
                                            <>
                                                {renderInput('applicant_name', 'person', '03')}
                                                <div className="space-y-4">
                                                    <div className="flex justify-between items-end px-1">
                                                        <span className="material-symbols-rounded text-black/40 dark:text-white/40 mb-1">school</span>
                                                        <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[04]</span>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {(['ALUMNO', 'ACADEMICO', 'DOCENTE', 'OTRO'] as EducationalProfile[]).map(p => (
                                                            <button key={p} type="button" onClick={() => { setEduProfile(p); setError(''); }} className={clsx("py-4 border text-[10px] font-black uppercase tracking-widest transition-all rounded-none", eduProfile === p ? "bg-black dark:bg-white text-white dark:text-black shadow-lg" : "bg-black/5 dark:bg-white/5 text-black/30 dark:text-white/20")}>{p}</button>
                                                        ))}
                                                    </div>
                                                </div>
                                                {renderInput('institution_name', 'apartment', '05')}
                                                {renderInput('institution_website', 'language', '06', 'text', 'WWW.EDU.CL', false)}
                                                {renderInput('program_name', 'history_edu', '07', 'text', '', false)}
                                                {renderInput('graduation_date', 'event', '08', 'date', '', false)}
                                            </>
                                        )}

                                        {type === 'PERSONAL' && (
                                            <>
                                                {renderInput('full_name', 'person', '03')}
                                                {renderSelect('usage_profile', 'account_circle', '04', [
                                                    { value: 'PROFESSIONAL', label: t('form.professional') },
                                                    { value: 'PERSONAL', label: t('form.personal') }
                                                ])}
                                            </>
                                        )}

                                        <button onClick={handleNextStep} className="w-full py-6 bg-black dark:bg-white text-white dark:text-black font-black transition-all shadow-3xl active:scale-[0.98] flex justify-center items-center mt-8 rounded-none">
                                            <ArrowRight size={22} />
                                        </button>
                                    </div>
                                )}

                                {step === 4 && type === 'ENTERPRISE' && (
                                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                                        <div className="space-y-4">
                                            <h3 className="text-[10px] font-bold uppercase tracking-widest text-black/40 dark:text-white/40 border-b border-black/10 dark:border-white/10 pb-2">Datos del Solicitante / Administrador</h3>
                                            {renderInput('applicant_name', 'person', '01', 'text', 'NOMBRE DEL SOLICITANTE')}
                                            {renderInput('job_title', 'badge', '02', 'text', 'CARGO EN LA EMPRESA')}
                                            {renderInput('email', 'alternate_email', '03', 'email', 'EMAIL DE ACCESO')}
                                        </div>
                                        <button onClick={handleNextStep} className="w-full py-6 bg-black dark:bg-white text-white dark:text-black font-black transition-all shadow-3xl active:scale-[0.98] flex justify-center items-center mt-8 rounded-none">
                                            <ArrowRight size={22} />
                                        </button>
                                    </div>
                                )}

                                {step === totalSteps && (
                                    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
                                        <div className="elite-tech-surface bg-black/5 dark:bg-white/5 p-8 border border-black/10 dark:border-white/10 space-y-8 rounded-none h-auto">

                                            {/* Sección 1: Entidad e Identificación */}
                                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both">
                                                {renderSectionHeader("ENTIDAD")}
                                                {renderPreviewRow(t('form.country'), activeCountry.name)}
                                                {renderPreviewRow(
                                                    formData.country === 'CL'
                                                        ? (type === 'ENTERPRISE' ? 'RUT EMPRESA' : 'RUN TITULAR')
                                                        : 'TAX ID / IDENTIFICADOR',
                                                    (type === 'ENTERPRISE' ? formData.rut : formData.run) || ''
                                                )}
                                            </div>

                                            {/* Sección 2: Datos Específicos según Tipo */}
                                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150 fill-mode-both border-t border-black/5 dark:border-white/5 pt-4">
                                                {type === 'ENTERPRISE' && (
                                                    <>
                                                        {renderSectionHeader("DATOS CORPORATIVOS")}
                                                        {renderPreviewRow("RAZÓN SOCIAL", formData.company_name || '')}
                                                        {renderPreviewRow("GIRO COMERCIAL", formData.industry || '')}
                                                        {renderPreviewRow("EMAIL FACTURACIÓN", formData.billing_email || '')}
                                                        {renderPreviewRow("SITIO WEB", formData.website || '')}
                                                    </>
                                                )}

                                                {type === 'EDUCATIONAL' && (
                                                    <>
                                                        {renderSectionHeader("DATOS INSTITUCIONALES")}
                                                        {renderPreviewRow("INSTITUCIÓN", formData.institution_name || '')}
                                                        {renderPreviewRow("PERFIL", eduProfile || '')}
                                                        {renderPreviewRow("PROGRAMA / CARRERA", formData.program_name || '')}
                                                        {renderPreviewRow("FECHA TITULACIÓN", formData.graduation_date || '')}
                                                        {renderPreviewRow("SITIO WEB", formData.institution_website || '')}
                                                    </>
                                                )}

                                                {type === 'PERSONAL' && (
                                                    <>
                                                        {renderSectionHeader("PERFIL PROFESIONAL")}
                                                        {renderPreviewRow("TIPO DE USO", formData.usage_profile === 'PROFESSIONAL' ? t('form.professional') : t('form.personal'))}
                                                    </>
                                                )}
                                            </div>

                                            {/* Sección 3: Ubicación (Explícita) */}
                                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300 fill-mode-both border-t border-black/5 dark:border-white/5 pt-4">
                                                {renderSectionHeader("UBICACIÓN")}
                                                {renderPreviewRow("DIRECCIÓN SEDE", formData.address || '')}
                                                {renderPreviewRow("COMUNA / CIUDAD", formData.commune || formData.city || '')}
                                                {renderPreviewRow("REGIÓN / ESTADO", formData.region || '')}
                                                {renderPreviewRow("CÓDIGO POSTAL", formData.postal_code || '')}
                                            </div>

                                            {/* Sección 4: Contacto / Administrador */}
                                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-450 fill-mode-both border-t border-black/5 dark:border-white/5 pt-4">
                                                {renderSectionHeader(type === 'ENTERPRISE' ? "ADMINISTRADOR" : "TITULAR")}
                                                {renderPreviewRow(
                                                    type === 'PERSONAL' ? "NOMBRE COMPLETO" : "NOMBRE SOLICITANTE",
                                                    (type === 'PERSONAL' ? formData.full_name : formData.applicant_name) || ''
                                                )}
                                                {type === 'ENTERPRISE' && renderPreviewRow("CARGO", formData.job_title || '')}
                                                {renderPreviewRow("EMAIL DE ACCESO", formData.email || '')}
                                            </div>
                                        </div>

                                        <button
                                            type="button" onClick={handleFinalSubmit} disabled={loading}
                                            className="w-full py-6 bg-black dark:bg-white text-white dark:text-black font-black transition-all shadow-3xl disabled:opacity-30 flex items-center justify-center rounded-none active:scale-[0.98] group"
                                        >
                                            {loading ? (
                                                <div className="w-5 h-5 border-2 border-white/20 dark:border-black/20 border-t-white dark:border-t-black rounded-full animate-spin" />
                                            ) : (
                                                <div className="flex items-center gap-3">
                                                    <span className="tracking-[0.3em] text-[12px]">CONFIRMAR REGISTRO</span>
                                                    <span className="material-symbols-rounded text-xl group-hover:translate-x-1 transition-transform">send</span>
                                                </div>
                                            )}
                                        </button>
                                    </div>
                                )}

                                {error && (
                                    <div className="p-4 bg-rose-500/10 text-rose-500 dark:text-rose-400 text-[10px] font-mono font-bold flex items-center gap-3 border border-rose-500/30 rounded-none animate-in shake duration-500">
                                        <span className="material-symbols-rounded text-base shrink-0">warning</span>
                                        <span className="uppercase tracking-tight">{error}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <footer className="mt-8 text-center space-y-4 opacity-40 hover:opacity-100 transition-opacity duration-500">
                    <div className="flex justify-center text-antigravity-accent">
                        <span className="material-symbols-rounded text-xl">verified_user</span>
                    </div>
                    <p className="text-[10px] text-black/60 dark:text-white uppercase tracking-[0.3em] font-black">
                        © {new Date().getFullYear()} MINREPORT. TODOS LOS DERECHOS RESERVADOS.
                    </p>
                </footer>
            </div>
        </div>
    );
};
