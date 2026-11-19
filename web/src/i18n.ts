import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { coreShellLocales } from './locales/coreShellLocales';
import { coreAccessB2bLocales } from './locales/coreAccessB2bLocales';
import { coreAdminLocales } from './locales/coreAdminLocales';
import { coreDevPilotLocales } from './locales/coreDevPilotLocales';

export type SupportedLang = 'es' | 'en' | 'pt';

export function resolveNormalizedLang(raw?: string | null): SupportedLang {
    const normalized = String(raw || 'es').trim().toLowerCase().slice(0, 2);
    if (normalized === 'en' || normalized === 'pt') {
        return normalized;
    }
    return 'es';
}

export function isNativeMobileRuntime(): boolean {
    if (typeof window !== 'undefined') {
        const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
            .Capacitor;
        if (typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform()) {
            return true;
        }
    }
    if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
        return navigator.userAgent.includes('MinReportAppId/');
    }
    return false;
}

export function resolveDeviceLang(): SupportedLang {
    const candidates: Array<string | undefined | null> = [];
    if (typeof window !== 'undefined') {
        candidates.push((window as unknown as { __MINREPORT_NATIVE_LOCALE__?: string }).__MINREPORT_NATIVE_LOCALE__);
    }
    if (typeof navigator !== 'undefined') {
        if (typeof navigator.userAgent === 'string') {
            const uaMatch = /MinReportLocale\/([a-zA-Z-]+)/.exec(navigator.userAgent);
            if (uaMatch?.[1]) {
                candidates.push(uaMatch[1]);
            }
        }
        if (Array.isArray(navigator.languages)) {
            candidates.push(...navigator.languages);
        }
        candidates.push(navigator.language);
    }

    for (const raw of candidates) {
        const code = String(raw || '').trim().toLowerCase().slice(0, 2);
        if (code === 'es' || code === 'en' || code === 'pt') {
            return code;
        }
    }
    return 'es';
}

const syncHtmlLangAttribute = (rawLang?: string | null) => {
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.lang = resolveNormalizedLang(rawLang);
    }
};

const isNativeEnv = isNativeMobileRuntime();
if (isNativeEnv && typeof window !== 'undefined' && window.localStorage) {
    try {
        window.localStorage.removeItem('i18nextLng');
    } catch {
        // Ignorar errores en almacenamiento restringido
    }
}

const storedDesktopLang =
    !isNativeEnv && typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem('i18nextLng')
        : null;
const initialLang: SupportedLang = storedDesktopLang
    ? resolveNormalizedLang(storedDesktopLang)
    : resolveDeviceLang();

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        lng: initialLang,
        fallbackLng: 'es',
        supportedLngs: ['es', 'en', 'pt'],
        load: 'languageOnly',
        detection: {
            order: ['localStorage'],
            lookupLocalStorage: 'i18nextLng',
            caches: ['localStorage'],
        },
        react: {
            bindI18n: 'languageChanged loaded',
            bindI18nStore: 'added removed',
        },
        interpolation: {
            escapeValue: false,
        },
        resources: {
            es: {
                translation: {
                    ...coreShellLocales.es,
                    ...coreAccessB2bLocales.es,
                    ...coreAdminLocales.es,
                    ...coreDevPilotLocales.es,
                    auth: {
                        title: 'Crear Cuenta',
                        subtitle: 'Registro corporativo MINREPORT',
                        set_password_title: 'Configura tu Contraseña',
                        new_password: 'Nueva Contraseña',
                        confirm_password: 'Confirmar Contraseña',
                        activate_btn: 'Activar Mi Cuenta',
                        verifying_link: 'Verificando enlace...',
                        invalid_link: 'Enlace de activación inválido o expirado.',
                        passwords_dont_match: 'Las contraseñas no coinciden.',
                        password_too_short: 'La contraseña debe tener al menos 8 caracteres.',
                        reset_failed: 'No se pudo establecer la contraseña. Inténtalo de nuevo.',
                        success_title: 'Cuenta Activada',
                        success_msg: 'Contraseña establecida correctamente. Redirigiendo al inicio de sesión.',
                        back_to_home: 'Volver al inicio',
                        login_title: 'Iniciar Sesión',
                        login_subtitle: 'Accede a tu cuenta de MINREPORT',
                        login_btn: 'Ingresar',
                        passkey_login: 'Ingresar con Passkey Biométrica',
                        passkey_enroll: 'Vincular Passkey FIDO2',
                        no_account: '¿No tienes cuenta?',
                        register_link: 'Regístrate aquí',
                        login_error: 'Error al iniciar sesión.',
                        invalid_credentials: 'Email o contraseña incorrectos.',
                        network_error: 'Error de red. Verifica tu conexión.',
                        already_have_account: '¿Ya tienes cuenta?',
                        login_link_reg: 'Ingresar aquí',
                        logout: 'Cerrar Sesión',
                        associated_accounts: 'Cuentas Asociadas',
                        profiles: 'PERFILES',
                        use_other_id: 'Usar otro documento de identidad',
                    },
                    status: {
                        active: 'ACTIVO',
                        approved: 'APROBADO',
                        pending_approval: 'EN REVISIÓN',
                        pending: 'INVITACIÓN',
                        rejected: 'RECHAZADO',
                        suspended: 'SUSPENDIDO',
                    },
                    pwa: {
                        install_title: 'Instalar MINREPORT',
                        install_desc: 'Instale la aplicación para habilitar operación offline en faena.',
                        install_button: 'Instalar Aplicación',
                        dismiss: 'Descartar',
                    },
                    pilot: {
                        hud_title: 'TEST-PILOT // RETROALIMENTACIÓN EN TERRENO',
                        workspace_title: 'Espacio de Trabajo TEST-PILOT',
                        submit_feedback: 'Registrar Observación',
                        curate_ai: 'Bandeja de Curación HITL IA',
                        simulate_modules: 'Simulación Integrada de Módulos',
                        history: 'Historial de Observaciones',
                    },
                    admin_console: {
                        title: 'Consola Comercial y Gobernanza MINREPORT',
                        tab_b2b: 'Clientes B2B',
                        tab_edu: 'Acreditaciones EDU',
                        tab_modules: 'Disponibilidad de Módulos',
                        tab_audit: 'Auditoría Ledger & Telemetría IA',
                        verify_ledger: 'Verificar Cadena SHA-256',
                        confirm_keyword_label: 'Escriba ACTUALIZAR para confirmar',
                    },
                    tabs: {
                        enterprise: 'Empresa',
                        educational: 'Educacional',
                        personal: 'Personal',
                    },
                    form: {
                        company_name: 'Razón Social',
                        rut: 'RUT',
                        applicant_name: 'Nombre Solicitante',
                        industry: 'Industria',
                        website: 'Sitio Web',
                        submit: 'Enviar Solicitud',
                        submitting: 'Enviando...',
                        email: 'Correo Electrónico',
                        password: 'Contraseña',
                        institution_name: 'Nombre Institución',
                        full_name: 'Nombre Completo',
                        run: 'RUN',
                        usage_profile: 'Perfil de Uso',
                        country: 'País',
                        tax_id: 'ID Fiscal / Tributario',
                        institution_web: 'Web Institucional',
                        program_name: 'Carrera / Programa',
                        graduation_date: 'Fecha de Graduación',
                        optional: 'Opcional',
                    },
                    errors: {
                        public_email: 'Utilice un correo institucional académico.',
                    },
                    dashboard: {
                        welcome: 'Panel Operacional',
                        ecosystem: 'Módulos Operativos',
                        profile: 'Perfil',
                        logout: 'Cerrar Sesión',
                        placeholder: 'Indicadores operacionales de cuenta.',
                    },
                },
            },
            en: {
                translation: {
                    ...coreShellLocales.en,
                    ...coreAccessB2bLocales.en,
                    ...coreAdminLocales.en,
                    ...coreDevPilotLocales.en,
                    auth: {
                        title: 'Create Account',
                        subtitle: 'MINREPORT Corporate Registration',
                        set_password_title: 'Set Your Password',
                        new_password: 'New Password',
                        confirm_password: 'Confirm Password',
                        activate_btn: 'Activate My Account',
                        verifying_link: 'Verifying link...',
                        invalid_link: 'Invalid or expired activation link.',
                        passwords_dont_match: 'Passwords do not match.',
                        password_too_short: 'Password must be at least 8 characters.',
                        reset_failed: 'Failed to set password. Please try again.',
                        success_title: 'Account Activated',
                        success_msg: 'Password configured. Redirecting to sign in.',
                        back_to_home: 'Back to home',
                        login_title: 'Sign In',
                        login_subtitle: 'Access your MINREPORT account',
                        login_btn: 'Sign In',
                        passkey_login: 'Sign in with Biometric Passkey',
                        passkey_enroll: 'Enroll FIDO2 Passkey',
                        no_account: "Don't have an account?",
                        register_link: 'Register here',
                        login_error: 'Failed to sign in.',
                        invalid_credentials: 'Invalid email or password.',
                        network_error: 'Network error. Check your connection.',
                        already_have_account: 'Already have an account?',
                        login_link_reg: 'Sign in here',
                        logout: 'Sign Out',
                        associated_accounts: 'Associated Accounts',
                        profiles: 'PROFILES',
                        use_other_id: 'Use another identity document',
                    },
                    status: {
                        active: 'ACTIVE',
                        approved: 'APPROVED',
                        pending_approval: 'UNDER REVIEW',
                        pending: 'INVITATION',
                        rejected: 'REJECTED',
                        suspended: 'SUSPENDED',
                    },
                    pwa: {
                        install_title: 'Install MINREPORT',
                        install_desc: 'Install the application to enable offline field operation.',
                        install_button: 'Install Application',
                        dismiss: 'Dismiss',
                    },
                    pilot: {
                        hud_title: 'TEST-PILOT // FIELD FEEDBACK',
                        workspace_title: 'TEST-PILOT Workspace',
                        submit_feedback: 'Submit Observation',
                        curate_ai: 'AI HITL Curation Inbox',
                        simulate_modules: 'Integrated Module Simulation',
                        history: 'Observation History',
                    },
                    admin_console: {
                        title: 'MINREPORT Commercial & Governance Console',
                        tab_b2b: 'B2B Tenants',
                        tab_edu: 'EDU Accreditations',
                        tab_modules: 'Module Availability',
                        tab_audit: 'Ledger Audit & AI Telemetry',
                        verify_ledger: 'Verify SHA-256 Chain',
                        confirm_keyword_label: 'Type ACTUALIZAR to confirm',
                    },
                    tabs: {
                        enterprise: 'Enterprise',
                        educational: 'Educational',
                        personal: 'Personal',
                    },
                    form: {
                        company_name: 'Company Name',
                        rut: 'RUT',
                        applicant_name: 'Applicant Name',
                        industry: 'Industry',
                        website: 'Website',
                        submit: 'Send Request',
                        submitting: 'Sending...',
                        email: 'Email Address',
                        password: 'Password',
                        institution_name: 'Institution Name',
                        full_name: 'Full Name',
                        run: 'RUN',
                        usage_profile: 'Usage Profile',
                        country: 'Country',
                        tax_id: 'Tax ID',
                        institution_web: 'Institution Website',
                        program_name: 'Degree / Program',
                        graduation_date: 'Graduation Date',
                        optional: 'Optional',
                    },
                    errors: {
                        public_email: 'Please use an institutional academic email address.',
                    },
                    dashboard: {
                        welcome: 'Operational Dashboard',
                        ecosystem: 'Operational Modules',
                        profile: 'Profile',
                        logout: 'Sign Out',
                        placeholder: 'Account operational indicators.',
                    },
                },
            },
            pt: {
                translation: {
                    ...coreShellLocales.pt,
                    ...coreAccessB2bLocales.pt,
                    ...coreAdminLocales.pt,
                    ...coreDevPilotLocales.pt,
                    auth: {
                        title: 'Criar Conta',
                        subtitle: 'Registro corporativo MINREPORT',
                        set_password_title: 'Configure sua Senha',
                        new_password: 'Nova Senha',
                        confirm_password: 'Confirmar Senha',
                        activate_btn: 'Ativar Minha Conta',
                        verifying_link: 'Verificando link...',
                        invalid_link: 'Link de ativação inválido ou expirado.',
                        passwords_dont_match: 'As senhas não coincidem.',
                        password_too_short: 'A senha deve ter pelo menos 8 caracteres.',
                        reset_failed: 'Não foi possível definir a senha. Tente novamente.',
                        success_title: 'Conta Ativada',
                        success_msg: 'Senha configurada com sucesso. Redirecionando para o acesso.',
                        back_to_home: 'Voltar ao início',
                        login_title: 'Entrar',
                        login_subtitle: 'Acesse sua conta MINREPORT',
                        login_btn: 'Entrar',
                        passkey_login: 'Entrar com Passkey Biométrica',
                        passkey_enroll: 'Vincular Passkey FIDO2',
                        no_account: 'Não tem uma conta?',
                        register_link: 'Registre-se aqui',
                        login_error: 'Erro ao entrar.',
                        invalid_credentials: 'E-mail ou senha incorretos.',
                        network_error: 'Erro de rede. Verifique sua conexão.',
                        already_have_account: 'Já tem uma conta?',
                        login_link_reg: 'Entrar aqui',
                        logout: 'Sair',
                        associated_accounts: 'Contas Associadas',
                        profiles: 'PERFIS',
                        use_other_id: 'Usar outro documento de identidade',
                    },
                    status: {
                        active: 'ATIVO',
                        approved: 'APROVADO',
                        pending_approval: 'EM ANÁLISE',
                        pending: 'CONVITE',
                        rejected: 'REJEITADO',
                        suspended: 'SUSPENSO',
                    },
                    pwa: {
                        install_title: 'Instalar MINREPORT',
                        install_desc: 'Instale o aplicativo para habilitar operação offline em campo.',
                        install_button: 'Instalar Aplicativo',
                        dismiss: 'Dispensar',
                    },
                    pilot: {
                        hud_title: 'TEST-PILOT // FEEDBACK DE CAMPO',
                        workspace_title: 'Espaço de Trabalho TEST-PILOT',
                        submit_feedback: 'Registrar Observação',
                        curate_ai: 'Caixa de Curadoria HITL IA',
                        simulate_modules: 'Simulação Integrada de Módulos',
                        history: 'Histórico de Observações',
                    },
                    admin_console: {
                        title: 'Console Comercial e Governança MINREPORT',
                        tab_b2b: 'Clientes B2B',
                        tab_edu: 'Acreditações EDU',
                        tab_modules: 'Disponibilidade de Módulos',
                        tab_audit: 'Auditoria Ledger & Telemetria IA',
                        verify_ledger: 'Verificar Cadeia SHA-256',
                        confirm_keyword_label: 'Digite ACTUALIZAR para confirmar',
                    },
                    tabs: {
                        enterprise: 'Empresa',
                        educational: 'Educacional',
                        personal: 'Pessoal',
                    },
                    form: {
                        company_name: 'Razão Social',
                        rut: 'CPF / CNPJ',
                        applicant_name: 'Nome do Solicitante',
                        industry: 'Indústria',
                        website: 'Site',
                        submit: 'Enviar Solicitação',
                        submitting: 'Enviando...',
                        email: 'E-mail',
                        password: 'Senha',
                        institution_name: 'Nome da Instituição',
                        full_name: 'Nome Completo',
                        run: 'CPF / CNPJ',
                        usage_profile: 'Perfil de Uso',
                        country: 'País',
                        tax_id: 'ID Fiscal / Tributário',
                        institution_web: 'Site da Instituição',
                        program_name: 'Curso / Programa',
                        graduation_date: 'Data de Graduação',
                        optional: 'Opcional',
                    },
                    errors: {
                        public_email: 'Utilize um e-mail institucional acadêmico.',
                    },
                    dashboard: {
                        welcome: 'Painel Operacional',
                        ecosystem: 'Módulos Operativos',
                        profile: 'Perfil',
                        logout: 'Sair',
                        placeholder: 'Indicadores operacionais da conta.',
                    },
                },
            },
        },
    });

syncHtmlLangAttribute(i18n.resolvedLanguage || i18n.language);
i18n.on('languageChanged', (lng) => {
    syncHtmlLangAttribute(lng);
});

if (typeof window !== 'undefined' && isNativeMobileRuntime() && typeof window.addEventListener === 'function') {
    const syncNativeLocale = () => {
        try {
            window.localStorage?.removeItem('i18nextLng');
        } catch {
            // Ignorar errores en almacenamiento restringido
        }
        const nextLang = resolveDeviceLang();
        if (resolveNormalizedLang(i18n.resolvedLanguage || i18n.language) !== nextLang) {
            void i18n.changeLanguage(nextLang);
        } else {
            syncHtmlLangAttribute(nextLang);
        }
    };
    window.addEventListener('languagechange', syncNativeLocale);
    window.addEventListener('minreport:os-config-change', syncNativeLocale);
}

export default i18n;
