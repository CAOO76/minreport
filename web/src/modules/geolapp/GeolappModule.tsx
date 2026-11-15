import React from 'react';
import './index.css';
import './i18n/config';
import { useTranslation } from 'react-i18next';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { M3LinearProgress } from '../../components/common/M3LinearProgress';
import type { GeolappDomainMode } from './core/types/GeolappTypes';
import { GeolappApp } from './GeolappApp';

export interface GeolappModuleProps {
    domainMode?: GeolappDomainMode;
    hostScope?: 'CLIENT' | 'DEV_GATEWAY' | 'TEST_PILOT';
    embedded?: boolean;
}

/**
 * GeolappModule - Punto de entrada federado del módulo nativo GEOLAPP® dentro de MINREPORT.
 * Cumple aislamiento multi-tenant, Dual Light/Dark, Minimalismo Industrial Puro (GEMINI.md §1-§4)
 * y contención fluida para embedding en /dev, /pilot y /stockpile.
 */
export const GeolappModule: React.FC<GeolappModuleProps> = ({
    domainMode = 'STOCKPILE',
    hostScope = 'CLIENT',
    embedded = false,
}) => {
    const { t } = useTranslation();
    const { isLoaded, hasModuleAccess } = useMinReportSession();

    const frameClass = embedded
        ? 'geolapp-scope h-full w-full min-h-0 flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden rounded-none shadow-none'
        : 'geolapp-scope min-h-[100dvh] w-full flex-1 flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] overflow-hidden rounded-none shadow-none';

    if (!isLoaded) {
        return (
            <div className={frameClass}>
                <M3LinearProgress
                    indeterminate
                    ariaLabel={t('common.loading', 'CARGANDO...')}
                />
            </div>
        );
    }

    if (!hasModuleAccess('stockpile')) {
        return (
            <div className={`${frameClass} items-center justify-center p-fib-34`}>
                <div className="max-w-md w-full p-fib-21 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none flex flex-col items-center gap-fib-13 text-center">
                    <span className="material-symbols-outlined text-[36px] text-[#C68346]">
                        lock
                    </span>
                    <p className="text-data-dense font-mono uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        {t('common.module_title', 'GEOLAPP® · CONTROL DE STOCKPILES')}
                    </p>
                    <p className="text-microcopy font-mono text-[#475569] dark:text-[#8A93A6]">
                        [403] {t('copper_governance.dispatch_blocked', 'ACCESO RESTRINGIDO')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={frameClass}>
            <GeolappApp
                domainMode={domainMode}
                hostScope={hostScope}
                embedded={embedded}
            />
        </div>
    );
};

export default GeolappModule;
