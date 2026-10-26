import React, { Suspense, lazy } from 'react';
import { useMinReportSession } from '../../context/MinReportSessionContext';

const StockpileModuleView = lazy(() => import('./StockpileModuleView'));

export const StockpileModule: React.FC = () => {
    const { session } = useMinReportSession();

    const handleTelemetryEvent = (event: any) => {
        if (event?.type === 'CUBICATION_COMPLETED' || event?.type === 'STOCKPILE_REGISTERED') {
            console.log('[MINREPORT Core] Telemetría recibida desde STOCKPILE-CONTROL:', event);
        }
    };

    return (
        <div className="w-full h-full flex-1 flex flex-col bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] p-0 font-sans select-none">
            <Suspense
                fallback={
                    <div className="w-full h-96 flex flex-col items-center justify-center p-8 gap-3 font-mono text-[#8A93A6]">
                        <span className="material-symbols-outlined text-3xl text-[#C68346] animate-spin">
                            progress_activity
                        </span>
                        <div className="text-xs uppercase tracking-wider text-[#F3F4F6]">
                            Cargando Módulo de Cubicación STOCKPILE
                        </div>
                    </div>
                }
            >
                <StockpileModuleView
                    tenantContext={{
                        tenantId: session?.tenantId || 'faena-minreport',
                        userId: session?.uid || 'operador',
                    }}
                    embedded={true}
                    onTelemetryEvent={handleTelemetryEvent}
                />
            </Suspense>
        </div>
    );
};

export default StockpileModule;
