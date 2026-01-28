
import { MinReport } from '@minreport/sdk';
import { useAuth } from '../context/AuthContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useNavigate } from 'react-router-dom';

export const OperationalDashboard = () => {
    const { currentAccount } = useAuth();
    const { isOnline } = useNetworkStatus();
    const navigate = useNavigate();

    // Fallback de seguridad
    if (!currentAccount) return null;

    const APP_VERSION = '__APP_VERSION__' in window ? (window as any).__APP_VERSION__ : 'v1.0.0';

    return (
        <div className="max-w-4xl mx-auto py-8 px-4 space-y-8 animate-in fade-in duration-500">
            {/* Encabezado */}
            <header>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    Panel de Control - <span className="text-indigo-600 dark:text-indigo-400">{currentAccount.name}</span>
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                    Bienvenido al centro de operaciones.
                </p>
            </header>

            {/* Tarjeta de Diagnóstico */}
            <MinReport.UI.SDKCard title="Estado del Núcleo Operativo">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Tenant ID</p>
                        <p className="font-mono text-xs text-gray-600 dark:text-gray-300 break-all select-all">
                            {currentAccount.id}
                        </p>
                    </div>

                    <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Versión del Sistema</p>
                        <p className="font-semibold text-gray-800 dark:text-gray-200">
                            {APP_VERSION}
                        </p>
                    </div>

                    <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Conexión</p>
                        <div className="flex items-center gap-2">
                            <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-red-500'}`} />
                            <span className={`font-medium ${isOnline ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                                {isOnline ? 'Online' : 'Offline'}
                            </span>
                        </div>
                    </div>
                </div>
            </MinReport.UI.SDKCard>

            {/* Tarjeta de Bienvenida / Empty State */}
            <MinReport.UI.SDKCard>
                <div className="text-center py-8">
                    <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <span className="material-symbols-rounded text-3xl">extension</span>
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                        Sistema Operativo Listo
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-8 leading-relaxed">
                        El sistema está operativo y conectado a su cuenta <strong>{currentAccount.name}</strong>.
                        Actualmente no hay plugins habilitados en su espacio de trabajo.
                    </p>

                    <div className="flex justify-center">
                        <MinReport.UI.SDKButton
                            variant="primary"
                            onClick={() => navigate('/plugins')}
                        >
                            Ver Catálogo de Plugins
                        </MinReport.UI.SDKButton>
                    </div>
                </div>
            </MinReport.UI.SDKCard>
        </div>
    );
};
