import React, { Suspense, lazy } from 'react';
import { useMinReportSession } from '../../context/MinReportSessionContext';

const OpermaqModuleView = lazy(() => import('./OpermaqModuleView'));

export const OpermaqModule: React.FC = () => {
    const { session } = useMinReportSession();

    const handleTelemetryEvent = (event: any) => {
        if (event?.type === 'EQUIPMENT_REGISTERED' || event?.type === 'INSPECTION_COMPLETED') {
            console.log('[MINREPORT Core] Telemetría recibida desde OPERMAQ:', event);
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
                            Cargando Módulo de Maquinaria OPERMAQ
                        </div>
                    </div>
                }
            >
                <OpermaqModuleView
                    tenantId={session?.tenantId || 'faena-minreport'}
                    userId={session?.uid || 'operador'}
                    role={session?.role as any}
                    embedded={true}
                    onTelemetryEvent={handleTelemetryEvent}
                />
            </Suspense>
        </div>
    );
};

export default OpermaqModule;
