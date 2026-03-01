export const MetricasPage = () => {
    const cards = [
        { label: 'Usuarios Activos', value: '—', sub: 'de — licencias', accent: false },
        { label: 'Reportes Generados', value: '—', sub: 'este mes', accent: false },
        { label: 'Almacenamiento', value: '—', sub: 'de — GB disponibles', accent: true },
        { label: 'Módulos Activos', value: '—', sub: 'habilitados', accent: false },
    ];

    return (
        <div className="max-w-5xl mx-auto py-8 px-6 space-y-8" style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}>

            <div className="border-b border-gray-200 dark:border-gray-800 pb-6">
                <h1 className="text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-white">Métricas de Uso</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Resumen del consumo de la plataforma durante el período activo.</p>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map((c, i) => (
                    <div key={i} className="border border-gray-200 dark:border-gray-800 p-5 bg-gray-50 dark:bg-[#1a2233]">
                        <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${c.accent ? 'text-[#C68346]' : 'text-gray-500 dark:text-gray-400'}`}>{c.label}</p>
                        <p className="text-3xl font-mono text-gray-900 dark:text-white">{c.value}</p>
                        <p className="text-xs text-gray-400 mt-1">{c.sub}</p>
                    </div>
                ))}
            </div>

            {/* Actividad por módulo */}
            <div className="border border-gray-200 dark:border-gray-800">
                <div className="bg-gray-100 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Actividad por Módulo</p>
                </div>
                <div className="flex items-center justify-center h-40 text-sm text-gray-400">
                    Disponible cuando los módulos comiencen a utilizarse.
                </div>
            </div>

            {/* Actividad de usuarios */}
            <div className="border border-gray-200 dark:border-gray-800">
                <div className="bg-gray-100 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Últimas Actividades</p>
                </div>
                <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                    Sin actividad registrada en el período.
                </div>
            </div>
        </div>
    );
};
