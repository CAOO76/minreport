import { Link } from 'react-router-dom';
import { Building2, GraduationCap, User, ArrowLeft } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';

/**
 * Página de Selección de Tipo de Cuenta
 * Permite al usuario elegir entre B2B, Educación o Personal
 */
export const RegisterSelection = () => {
    const accountTypes = [
        {
            id: 'b2b',
            title: 'Empresas',
            subtitle: 'Para operaciones mineras y gestión de equipos',
            icon: Building2,
            path: '/request-b2b',
            gradient: 'from-indigo-500 to-purple-600',
            bgHover: 'hover:bg-indigo-50 dark:hover:bg-indigo-950/20'
        },
        {
            id: 'edu',
            title: 'Educación',
            subtitle: 'Para estudiantes y académicos',
            icon: GraduationCap,
            path: '/request-edu',
            gradient: 'from-emerald-500 to-teal-600',
            bgHover: 'hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
        },
        {
            id: 'personal',
            title: 'Profesional',
            subtitle: 'Para consultores independientes',
            icon: User,
            path: '/request-personal',
            gradient: 'from-orange-500 to-rose-600',
            bgHover: 'hover:bg-orange-50 dark:hover:bg-orange-950/20'
        }
    ];

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#121212] transition-colors p-4 relative overflow-hidden">
            {/* Controles de Idioma y Tema */}
            <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            <div className="w-full max-w-4xl relative">
                {/* Logo Centrado */}
                <div className="mb-8 flex justify-center">
                    <div className="w-16 h-16 bg-white dark:bg-white/5 rounded-2xl flex items-center justify-center shadow-lg shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800">
                        <BrandLogo variant="isotype" className="w-8 h-8" />
                    </div>
                </div>

                {/* Contenedor Principal */}
                <div className="bg-white dark:bg-[#1E1E1E] rounded-3xl p-8 shadow-sm border border-gray-100 dark:border-gray-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Header */}
                    <div className="text-center mb-10">
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-3">
                            Elige tu tipo de cuenta
                        </h1>
                        <p className="text-gray-500 dark:text-gray-400 text-base">
                            Selecciona la opción que mejor se adapte a tus necesidades
                        </p>
                    </div>

                    {/* Tarjetas de Selección */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        {accountTypes.map((type) => {
                            const Icon = type.icon;
                            return (
                                <Link
                                    key={type.id}
                                    to={type.path}
                                    className={`group relative p-6 rounded-2xl border-2 border-gray-200 dark:border-gray-700 transition-all duration-300 ${type.bgHover} hover:border-transparent hover:shadow-xl hover:scale-105 active:scale-100`}
                                >
                                    {/* Gradient Border on Hover */}
                                    <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${type.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-10`}
                                        style={{ padding: '2px' }}>
                                        <div className="w-full h-full bg-white dark:bg-[#1E1E1E] rounded-2xl" />
                                    </div>

                                    {/* Icono */}
                                    <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${type.gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                                        <Icon className="w-7 h-7 text-white" strokeWidth={2.5} />
                                    </div>

                                    {/* Contenido */}
                                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                                        {type.title}
                                    </h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                                        {type.subtitle}
                                    </p>

                                    {/* Arrow Indicator */}
                                    <div className="mt-4 flex items-center text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                                        <span className="text-sm font-medium">Continuar</span>
                                        <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>

                    {/* Botón Volver */}
                    <div className="pt-6 border-t border-gray-100 dark:border-gray-800">
                        <Link
                            to="/login"
                            className="flex items-center justify-center gap-2 w-full py-3 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl font-medium transition-colors"
                        >
                            <ArrowLeft size={18} />
                            <span>Volver al Login</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};
