import { useAuth } from '../../context/AuthContext';

export const SuscripcionPage = () => {
    const { currentAccount } = useAuth();
    const account = currentAccount as any;

    const rows = [
        { label: 'Plan', value: account?.subscriptionPlan || 'Enterprise Pro' },
        { label: 'Estado del Contrato', value: 'Vigente' },
        { label: 'Inicio del Contrato', value: '—' },
        { label: 'Próximo Vencimiento', value: '—' },
        { label: 'Ciclo de Facturación', value: 'Mensual' },
        { label: 'Moneda', value: 'CLP' },
    ];

    return (
        <div className="max-w-5xl mx-auto py-8 px-6 space-y-8" style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}>

            <div className="border-b border-gray-200 dark:border-gray-800 pb-6">
                <h1 className="text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-white">Suscripción MINREPORT</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Condiciones contractuales del servicio para esta cuenta.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Condiciones del contrato */}
                <div className="border border-gray-200 dark:border-gray-800">
                    <div className="bg-gray-100 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Condiciones del Contrato</p>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {rows.map((r, i) => (
                            <div key={i} className="flex justify-between items-center px-4 py-3">
                                <span className="text-xs text-gray-500 dark:text-gray-400">{r.label}</span>
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">{r.value}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Historial de facturación */}
                <div className="border border-gray-200 dark:border-gray-800">
                    <div className="bg-gray-100 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Historial de Facturación</p>
                    </div>
                    <div className="px-4 py-10 text-center">
                        <p className="text-sm text-gray-400">Sin facturas registradas en el período.</p>
                    </div>
                </div>
            </div>

            {/* Aviso */}
            <div className="border border-yellow-500/30 bg-yellow-500/5 dark:bg-yellow-500/10 px-4 py-3">
                <p className="text-xs text-yellow-800 dark:text-yellow-300">
                    Para modificar las condiciones del contrato, solicitar cambio de plan o gestionar la terminación del servicio,
                    contacta a tu ejecutivo de cuentas MINREPORT.
                </p>
            </div>
        </div>
    );
};
