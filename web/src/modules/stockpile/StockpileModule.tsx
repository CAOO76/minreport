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
        <div className="w-full h-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] p-0 font-sans select-none">
            <Suspense
                fallback={
                    <div className="w-full h-96 flex flex-col items-center justify-center p-[34px] gap-[13px] font-mono bg-[#FFFFFF] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6]">
                        <span className="material-symbols-outlined text-3xl text-[#C68346] animate-spin">
                            progress_activity
                        </span>
                        <div className="text-[11px] uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                            Cargando Módulo de Cubicación STOCKPILE
                        </div>
                    </div>
                }
            >
                <StockpileModuleView
                    tenantContext={{
                        tenantId: session?.tenantId || '',
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
