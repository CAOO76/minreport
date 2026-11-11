import React, { Suspense, lazy } from 'react';
import './locales/i18n';
import './index.css';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import type { OpermaqDomainMode } from './components/AssetList';
import { M3CircularProgress } from './components/M3ProgressIndicator';
import type { OpermaqHostScope } from './hooks/useOpermaqContext';

const OpermaqApp = lazy(() => import('./App'));

export interface OpermaqModuleProps {
    domainMode?: OpermaqDomainMode;
    hostScope?: OpermaqHostScope;
    resetKey?: number;
}

export const OpermaqModule: React.FC<OpermaqModuleProps> = ({
    domainMode = 'FLEET',
    hostScope = 'CLIENT',
    resetKey,
}) => {
    const { session } = useMinReportSession();

    const handleTelemetryEvent = (event: unknown) => {
        if (
            typeof event === 'object' &&
            event !== null &&
            'type' in event &&
            ((event as { type?: string }).type === 'EQUIPMENT_REGISTERED' ||
                (event as { type?: string }).type === 'INSPECTION_COMPLETED')
        ) {
            console.log('[MINREPORT Core] Telemetría funcional recibida desde OPERMAQ:', event);
        }
    };

    const resolvedTenantId =
        hostScope === 'DEV_GATEWAY'
            ? session?.isDevRoot && session.tenantId
                ? session.tenantId
                : 'dev-master-sandbox'
            : session?.tenantId || '';

    const resolvedUserId =
        hostScope === 'DEV_GATEWAY'
            ? session?.isDevRoot && session.uid
                ? session.uid
                : 'dev-master-root-uid'
            : session?.uid || '';

    return (
        <div className="w-full h-full min-h-0 overflow-hidden flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] p-0 font-sans select-none">
            <Suspense
                fallback={
                    <div className="w-full h-96 flex flex-col items-center justify-center p-[34px] gap-[13px] font-mono text-[#475569] dark:text-[#8A93A6]">
                        <M3CircularProgress size={28} strokeWidth={3} tone="copper" />
                        <div className="text-[11px] uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                            {domainMode === 'CATALOG'
                                ? 'CATÁLOGO'
                                : domainMode === 'SYMBOLOGY'
                                ? 'SIMBOLOGÍA'
                                : 'FLOTA'}
                        </div>
                    </div>
                }
            >
                <OpermaqApp
                    domainMode={domainMode}
                    hostScope={hostScope}
                    tenantId={resolvedTenantId}
                    userId={resolvedUserId}
                    resetKey={resetKey}
                    embedded={true}
                    onTelemetryEvent={handleTelemetryEvent}
                />
            </Suspense>
        </div>
    );
};

export default OpermaqModule;
