import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        fallbackLng: 'es',
        lng: 'es', // Force Spanish as default
        interpolation: {
            escapeValue: false,
        },
        resources: {
            es: {
                translation: {
                    auth: {
                        title: "Crear Cuenta",
                        subtitle: "Únete al ecosistema",
                        set_password_title: "Configura tu Contraseña",
                        new_password: "Nueva Contraseña",
                        confirm_password: "Confirmar Contraseña",
                        activate_btn: "Activar Mi Cuenta",
                        verifying_link: "Verificando enlace...",
                        invalid_link: "Enlace de activación inválido o expirado.",
                        passwords_dont_match: "Las contraseñas no coinciden.",
                        password_too_short: "La contraseña debe tener al menos 8 caracteres.",
                        reset_failed: "No se pudo establecer la contraseña. Inténtalo de nuevo.",
                        success_title: "¡Cuenta Activada!",
                        success_msg: "Tu contraseña ha sido establecida correctamente. Serás redirigido al acceso en unos segundos.",
                        back_to_home: "Volver al inicio",
                        login_title: "Iniciar Sesión",
                        login_subtitle: "Accede a tu cuenta de MINREPORT",
                        login_btn: "Ingresar",
                        no_account: "¿No tienes cuenta?",
                        register_link: "Regístrate aquí",
                        login_error: "Error al iniciar sesión.",
                        invalid_credentials: "Email o contraseña incorrectos.",
                        network_error: "Error de red. Verifica tu conexión.",
                        already_have_account: "¿Ya tienes cuenta?",
                        login_link_reg: "Ingresar aquí"
                    },
                    tabs: {
                        enterprise: "Empresa",
                        educational: "Educacional",
                        personal: "Personal"
                    },
                    form: {
                        company_name: "Razón Social",
                        rut: "RUT",
                        applicant_name: "Nombre Solicitante",
                        industry: "Industria",
                        website: "Sitio Web",
                        submit: "Enviar Solicitud",
                        submitting: "Enviando...",
                        email: "Correo Electrónico",
                        password: "Contraseña",
                        institution_name: "Nombre Institución",
                        full_name: "Nombre Completo",
                        run: "RUN",
                        usage_profile: "Perfil de Uso",
                        country: "País",
                        tax_id: "ID Fiscal / Tributario",
                        institution_web: "Web Institucional",
                        program_name: "Carrera / Programa",
                        graduation_date: "Fecha de Graduación",
                        optional: "Opcional",
                        next: "Siguiente",
                        back: "Atrás",
                        sending: "Enviando...",
                        activating: "Activando...",
                        first_name: "Nombre",
                        last_name: "Apellido",
                        cargo: "Cargo / Posición",
                        phone: "Teléfono / Celular"
                    },
                    errors: {
                        public_email: "Por favor use un correo institucional académico."
                    },
                    dashboard: {
                        welcome: "¡Hola de nuevo!",
                        ecosystem: "Mi Ecosistema",
                        profile: "Perfil",
                        logout: "Cerrar Sesión",
                        placeholder: "Aquí aparecerá tu panel de indicadores..."
                    },
                    setup: {
                        identity_title: "Identidad",
                        identity_desc: "Cuéntanos un poco sobre ti.",
                        location_b2b: "Dirección Comercial",
                        location_edu: "Dirección Sede",
                        location_personal: "Dirección Domicilio",
                        location_desc: "Busca tu dirección para geolocalización.",
                        address_placeholder: "Escribe tu dirección...",
                        contact_title: "Contacto",
                        contact_desc: "Verificaremos tu número vía SMS/Email.",
                        verify_btn: "Verificar Ahora",
                        otp_title: "Código de Seguridad",
                        otp_desc: "Ingresa el código enviado a tu correo.",
                        activate_btn: "Activar Cuenta"
                    },

                }
            },
            en: {
                translation: {
                    auth: {
                        title: "Create Account",
                        subtitle: "Join the ecosystem",
                        set_password_title: "Set Your Password",
                        new_password: "New Password",
                        confirm_password: "Confirm Password",
                        activate_btn: "Activate My Account",
                        verifying_link: "Verifying link...",
                        invalid_link: "Invalid or expired activation link.",
                        passwords_dont_match: "Passwords do not match.",
                        password_too_short: "Password must be at least 8 characters.",
                        reset_failed: "Failed to set password. Please try again.",
                        success_title: "Account Activated!",
                        success_msg: "Your password has been successfully set. You will be redirected to login in a few seconds.",
                        back_to_home: "Back to home",
                        login_title: "Sign In",
                        login_subtitle: "Access your MINREPORT account",
                        login_btn: "Sign In",
                        no_account: "Don't have an account?",
                        register_link: "Register here",
                        login_error: "Failed to sign in.",
                        invalid_credentials: "Invalid email or password.",
                        network_error: "Network error. Please check your connection.",
                        already_have_account: "Already have an account?",
                        login_link_reg: "Sign in here"
                    },
                    tabs: {
                        enterprise: "Enterprise",
                        educational: "Educational",
                        personal: "Personal"
                    },
                    form: {
                        company_name: "Company Name",
                        rut: "RUT",
                        applicant_name: "Applicant Name",
                        industry: "Industry",
                        website: "Website",
                        submit: "Send Request",
                        submitting: "Sending...",
                        email: "Email Address",
                        password: "Password",
                        institution_name: "Institution Name",
                        full_name: "Full Name",
                        run: "RUN",
                        usage_profile: "Usage Profile",
                        country: "Country",
                        tax_id: "Tax ID",
                        institution_web: "Institution Website",
                        program_name: "Degree / Program",
                        graduation_date: "Graduation Date",
                        optional: "Optional",
                        next: "Next",
                        back: "Back",
                        sending: "Sending...",
                        activating: "Activating...",
                        first_name: "First Name",
                        last_name: "Last Name",
                        cargo: "Job Title",
                        phone: "Phone / Mobile"
                    },
                    errors: {
                        public_email: "Please use an institutional academic email address."
                    },
                    dashboard: {
                        welcome: "Welcome back!",
                        ecosystem: "My Ecosystem",
                        profile: "Profile",
                        logout: "Sign Out",
                        placeholder: "Your dashboard indicators will appear here..."
                    },
                    setup: {
                        identity_title: "Identity",
                        identity_desc: "Tell us a bit about yourself.",
                        location_b2b: "Business Address",
                        location_edu: "Campus Address",
                        location_personal: "Home Address",
                        location_desc: "Search for your address for geolocation.",
                        address_placeholder: "Type your address...",
                        contact_title: "Contact",
                        contact_desc: "We will verify your number via SMS/Email.",
                        verify_btn: "Verify Now",
                        otp_title: "Security Code",
                        otp_desc: "Enter the code sent to your email.",
                        activate_btn: "Activate Account"
                    },

                }
            },
            pt: {
                translation: {
                    auth: {
                        title: "Criar Conta",
                        subtitle: "Junte-se ao ecossistema",
                        set_password_title: "Configure sua Senha",
                        new_password: "Nova Senha",
                        confirm_password: "Confirmar Senha",
                        activate_btn: "Ativar Minha Conta",
                        verifying_link: "Verificando link...",
                        invalid_link: "Link de ativação inválido ou expirado.",
                        passwords_dont_match: "As senhas não coincidem.",
                        password_too_short: "A senha deve ter pelo menos 8 caracteres.",
                        reset_failed: "Não foi possível definir a senha. Tente novamente.",
                        success_title: "Conta Ativada!",
                        success_msg: "Sua senha foi definida com sucesso. Você será redirecionado em alguns segundos.",
                        back_to_home: "Volver ao início",
                        login_title: "Entrar",
                        login_subtitle: "Acesse sua conta MINREPORT",
                        login_btn: "Entrar",
                        no_account: "Não tem uma conta?",
                        register_link: "Registre-se aqui",
                        login_error: "Erro ao entrar.",
                        invalid_credentials: "E-mail ou senha incorretos.",
                        network_error: "Erro de rede. Verifique sua conexão.",
                        already_have_account: "Já tem uma conta?",
                        login_link_reg: "Entrar aqui",
                        logout: "Sair"
                    },
                    tabs: {
                        enterprise: "Empresa",
                        educational: "Educacional",
                        personal: "Pessoal"
                    },
                    form: {
                        company_name: "Razão Social",
                        rut: "CPF / CNPJ",
                        applicant_name: "Nome do Solicitante",
                        industry: "Indústria",
                        website: "Site",
                        submit: "Enviar Solicitação",
                        submitting: "Enviando...",
                        email: "E-mail",
                        password: "Senha",
                        institution_name: "Nome da Instituição",
                        full_name: "Nome Completo",
                        run: "CPF / CNPJ",
                        usage_profile: "Perfil de Uso",
                        country: "País",
                        tax_id: "ID Fiscal / Tributário",
                        institution_web: "Site da Instituição",
                        program_name: "Curso / Programa",
                        graduation_date: "Data de Graduação",
                        optional: "Opcional",
                        next: "Próximo",
                        back: "Voltar",
                        sending: "Enviando...",
                        activating: "Ativando...",
                        first_name: "Primeiro Nome",
                        last_name: "Sobrenome",
                        cargo: "Cargo",
                        phone: "Telefone / Celular"
                    },
                    errors: {
                        public_email: "Por favor, use um e-mail institucional acadêmico."
                    },
                    dashboard: {
                        welcome: "Bem-vindo de volta!",
                        ecosystem: "Meu Ecossistema",
                        profile: "Perfil",
                        logout: "Sair",
                        placeholder: "Seu painel aparecerá aqui..."
                    },
                    setup: {
                        identity_title: "Identidade",
                        identity_desc: "Conte-nos um pouco sobre você.",
                        location_b2b: "Endereço Comercial",
                        location_edu: "Endereço da Sede",
                        location_personal: "Endereço Residencial",
                        location_desc: "Procure seu endereço para geolocalização.",
                        address_placeholder: "Digite seu endereço...",
                        contact_title: "Contato",
                        contact_desc: "Verificaremos seu número via SMS/Email.",
                        verify_btn: "Verificar Agora",
                        otp_title: "Código de Segurança",
                        otp_desc: "Insira o código enviado para o seu e-mail.",
                        activate_btn: "Ativar Conta"
                    },

                }
            }
        }
    });

export default i18n;
