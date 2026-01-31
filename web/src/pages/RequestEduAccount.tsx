import { Link } from 'react-router-dom';
import { ArrowLeft, GraduationCap } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';

/**
 * Placeholder: Solicitud de Cuenta Educativa
 * TODO: Implementar formulario específico para instituciones educativas
 */
export const RequestEduAccount = () => {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#121212] transition-colors p-4 relative overflow-hidden">
            {/* Controles de Idioma y Tema */}
            <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            <div className="w-full max-w-md relative">
                {/* Logo Centrado */}
                <div className="mb-8 flex justify-center">
                    <div className="w-16 h-16 bg-white dark:bg-white/5 rounded-2xl flex items-center justify-center shadow-lg shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800">
                        <BrandLogo variant="isotype" className="w-8 h-8" />
                    </div>
                </div>

                <div className="bg-white dark:bg-[#1E1E1E] rounded-3xl p-8 shadow-sm border border-gray-100 dark:border-gray-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="text-center">
                        {/* Icono */}
                        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                            <GraduationCap className="w-10 h-10 text-white" strokeWidth={2.5} />
                        </div>

                        {/* Título */}
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-3">
                            Cuenta Educativa
                        </h1>
                        <p className="text-gray-500 dark:text-gray-400 mb-8">
                            Formulario en desarrollo
                        </p>

                        {/* Mensaje */}
                        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 mb-8">
                            <p className="text-sm text-emerald-700 dark:text-emerald-300">
                                Esta funcionalidad estará disponible próximamente.
                            </p>
                        </div>

                        {/* Botón Volver */}
                        <Link
                            to="/register-selection"
                            className="flex items-center justify-center gap-2 w-full py-3 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl font-medium transition-colors"
                        >
                            <ArrowLeft size={18} />
                            <span>Volver a selección</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};
