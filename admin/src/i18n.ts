import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        fallbackLng: 'es',
        interpolation: {
            escapeValue: false,
        },
        resources: {
            es: {
                translation: {
                    admin: {
                        title: "Portal de Operaciones",
                        invalid_credentials: "Credenciales inválidas",
                        subtitle: "Gestión del Ecosistema MINREPORT",
                        inbox_title: "Admin Inbox",
                        inbox_subtitle: "Gestiona las solicitudes de acceso al ecosistema.",
                        logout: "Cerrar Sesión",
                        login_btn: "Entrar al Sistema",
                        verifying: "Verificando...",
                        restricted: "Acceso restringido a operadores",
                        master_pass: "Clave Maestra",
                        secure_layer: "MINREPORT Secure Operational Layer",
                        active_systems: "Sistemas Operativos Activos",
                        no_pending: "No hay solicitudes pendientes.",
                        loading: "Cargando solicitudes...",
                        table: {
                            type: "Tipo",
                            name: "Nombre / Entidad",
                            rut: "RUT / RUN",
                            email: "Email",
                            status: "Estado",
                            actions: "Acciones"
                        },
                        status: {
                            pending: "PENDIENTE",
                            active: "ACTIVO",
                            rejected: "RECHAZADO"
                        }
                    }
                }
            },
            en: {
                translation: {
                    admin: {
                        title: "Operations Portal",
                        subtitle: "MINREPORT Ecosystem Management",
                        inbox_title: "Admin Inbox",
                        inbox_subtitle: "Manage access requests to the ecosystem.",
                        logout: "Logout",
                        login_btn: "Enter System",
                        verifying: "Verifying...",
                        restricted: "Restricted access to operators",
                        master_pass: "Master Password",
                        secure_layer: "MINREPORT Secure Operational Layer",
                        active_systems: "Active Operational Systems",
                        no_pending: "No pending requests.",
                        loading: "Loading requests...",
                        table: {
                            type: "Type",
                            name: "Name / Entity",
                            rut: "RUT / RUN",
                            email: "Email",
                            status: "Status",
                            actions: "Actions"
                        },
                        status: {
                            pending: "PENDING",
                            active: "ACTIVE",
                            rejected: "REJECTED"
                        }
                    }
                }
            }
        }
    });

export default i18n;
