import React, { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import M3LinearProgress from '../../components/common/M3LinearProgress';
import {
    CORE_MODULE_MAP,
    type CoreModuleId,
    type OpermaqDomainMode,
    type GeolappDomainMode,
    type SupplyDomainMode,
} from './module-registry';

export interface M3ModuleHudFallbackProps {
    label?: string;
}

export const M3ModuleHudFallback: React.FC<M3ModuleHudFallbackProps> = ({
    label,
}) => {
    const { t } = useTranslation();
    const normalizedLabel = (label || t('core_shell.loading_module', 'CARGANDO MÓDULO')).toUpperCase();
    const isNativeMobile = Capacitor.isNativePlatform();

    if (isNativeMobile) {
        return (
            <div
                className="w-full h-full min-h-[180px] flex flex-col justify-start bg-[#FFFFFF] dark:bg-[#000000] rounded-none shadow-none select-none"
                role="status"
                aria-label={normalizedLabel}
                aria-live="polite"
            >
                <M3LinearProgress indeterminate ariaLabel={normalizedLabel} />
            </div>
        );
    }

    return (
        <div
            className="w-full h-full min-h-[180px] flex items-center justify-center p-fib-34 bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-none"
            role="status"
            aria-live="polite"
        >
            <div className="w-full max-w-md space-y-fib-13">
                <M3LinearProgress indeterminate ariaLabel={normalizedLabel} />
                <span className="block font-mono text-microcopy uppercase tracking-wider text-center text-[#475569] dark:text-[#8A93A6]">
                    {normalizedLabel}
                </span>
            </div>
        </div>
    );
};

interface ModuleErrorBoundaryProps {
    moduleName: string;
    resetKey: string;
    children: ReactNode;
}

interface ModuleErrorBoundaryState {
    hasError: boolean;
    errorMessage: string | null;
}

export class ModuleErrorBoundary extends Component<
    ModuleErrorBoundaryProps,
    ModuleErrorBoundaryState
> {
    public state: ModuleErrorBoundaryState = {
        hasError: false,
        errorMessage: null,
    };

    public static getDerivedStateFromError(error: Error): ModuleErrorBoundaryState {
        return {
            hasError: true,
            errorMessage: error?.message || i18n.t('core_shell.module_exec_error', 'Error de ejecución en módulo.'),
        };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(`[ModuleHost:${this.props.moduleName}] Error de renderizado:`, error, errorInfo);
    }

    public componentDidUpdate(prevProps: ModuleErrorBoundaryProps) {
        if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
            this.setState({ hasError: false, errorMessage: null });
        }
    }

    private handleRetry = () => {
        this.setState({ hasError: false, errorMessage: null });
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="w-full h-full min-h-[240px] flex items-center justify-center p-fib-34 bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none select-none">
                    <div className="w-full max-w-md bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 rounded-none shadow-none space-y-fib-13">
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-8">
                            <span className="text-microcopy font-mono font-bold uppercase text-red-600 dark:text-red-400">
                                [{i18n.t('core_shell.module_exception_prefix', 'EXCEPCIÓN EN MÓDULO')} · {this.props.moduleName}]
                            </span>
                            <span className="material-symbols-outlined text-[20px] text-red-600 dark:text-red-400">
                                warning
                            </span>
                        </div>
                        <p className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6] break-words select-text">
                            {this.state.errorMessage || i18n.t('core_common.undeclared_tech_value', '[Información técnica no declarada en ficha]')}
                        </p>
                        <button
                            type="button"
                            onClick={this.handleRetry}
                            className="w-full py-fib-13 px-fib-21 bg-[#C68346] hover:bg-[#B0743E] text-white font-mono font-bold text-microcopy uppercase tracking-wider rounded-none shadow-none border-0 cursor-pointer transition-colors"
                        >
                            {i18n.t('core_shell.retry_module_load', 'REINTENTAR CARGA DE MÓDULO')}
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export interface RequireModuleAccessProps {
    moduleKey: CoreModuleId;
    children: ReactNode;
}

export const RequireModuleAccess: React.FC<RequireModuleAccessProps> = ({
    moduleKey,
    children,
}) => {
    const { t } = useTranslation();
    const { isLoaded, hasModuleAccess } = useMinReportSession();
    const descriptor = CORE_MODULE_MAP[moduleKey];

    if (!isLoaded) {
        const localizedModuleName = descriptor
            ? t(descriptor.nameKey, descriptor.name)
            : moduleKey.toUpperCase();
        return (
            <M3ModuleHudFallback
                label={t('core_shell.validating_module_access', {
                    module: localizedModuleName,
                    defaultValue: `VALIDANDO ACCESO ${localizedModuleName}`,
                })}
            />
        );
    }

    if (!hasModuleAccess(moduleKey)) {
        return <Navigate to="/dashboard" replace />;
    }

    return <>{children}</>;
};

export interface ModuleHostProps {
    moduleId: CoreModuleId;
    embedded?: boolean;
    domainMode?: OpermaqDomainMode | GeolappDomainMode | SupplyDomainMode;
    hostScope?: 'CLIENT' | 'DEV_GATEWAY' | 'TEST_PILOT';
    enforceEntitlement?: boolean;
    onExitModule?: () => void;
    mobileConnectivitySlot?: React.ReactNode;
}

function resolveModuleFallbackLabel(
    t: (key: string, defaultValue: string) => string,
    moduleId: CoreModuleId,
    domainMode?: OpermaqDomainMode | GeolappDomainMode | SupplyDomainMode
): string {
    if (moduleId === 'opermaq') {
        if (domainMode === 'CATALOG') return t('core_shell.loading_opermaq_catalog', 'CARGANDO MÓDULO OPERMAQ · CATÁLOGO');
        if (domainMode === 'FLEET') return t('core_shell.loading_opermaq_fleet', 'CARGANDO MÓDULO OPERMAQ · FLOTA');
        if (domainMode === 'SYMBOLOGY') return t('core_shell.loading_opermaq_symbology', 'CARGANDO MÓDULO OPERMAQ · SIMBOLOGÍA');
        if (domainMode === 'MANUFACTURERS') return t('core_shell.loading_opermaq_manufacturers', 'CARGANDO MÓDULO OPERMAQ · FABRICANTES');
        if (domainMode === 'SUPPLIERS') return t('core_shell.loading_opermaq_suppliers', 'CARGANDO MÓDULO OPERMAQ · PROVEEDORES');
        return t('core_shell.loading_opermaq', 'CARGANDO MÓDULO OPERMAQ');
    }
    if (moduleId === 'supply') {
        if (domainMode === 'DEMAND') return t('core_shell.loading_supply_demand', 'CARGANDO MÓDULO ABASTECIMIENTO · DEMANDA');
        if (domainMode === 'PROCUREMENT') return t('core_shell.loading_supply_procurement', 'CARGANDO MÓDULO ABASTECIMIENTO · COMPRAS');
        if (domainMode === 'WAREHOUSE') return t('core_shell.loading_supply_warehouse', 'CARGANDO MÓDULO ABASTECIMIENTO · BODEGA');
        if (domainMode === 'SII_EXPENSES') return t('core_shell.loading_supply_sii', 'CARGANDO MÓDULO ABASTECIMIENTO · RENDICIONES SII');
        if (domainMode === 'FINANCE_RECON') return t('core_shell.loading_supply_recon', 'CARGANDO MÓDULO ABASTECIMIENTO · CONCILIACIÓN');
        if (domainMode === 'FORECAST') return t('core_shell.loading_supply_forecast', 'CARGANDO MÓDULO ABASTECIMIENTO · PROYECCIÓN');
        if (domainMode === 'WHATSAPP_CHANNELS') return t('core_shell.loading_supply_whatsapp', 'CARGANDO MÓDULO ABASTECIMIENTO · WHATSAPP');
        return t('core_shell.loading_supply', 'MINREPORT · ABASTECIMIENTO');
    }
    return t('core_shell.loading_geolapp_stockpile', 'MINREPORT · ACOPIOS');
}

export const ModuleHost: React.FC<ModuleHostProps> = ({
    moduleId,
    embedded = true,
    domainMode,
    hostScope,
    enforceEntitlement = true,
    onExitModule,
    mobileConnectivitySlot,
}) => {
    const { t } = useTranslation();
    const descriptor = CORE_MODULE_MAP[moduleId];
    const ModuleComponent = descriptor.component;
    const fallbackLabel = resolveModuleFallbackLabel(t, moduleId, domainMode);
    const localizedModuleName = t(descriptor.nameKey, descriptor.name);

    const moduleProps: Record<string, unknown> = {
        embedded,
    };
    if (descriptor.supportsDomainMode && domainMode) {
        moduleProps.domainMode = domainMode;
    }
    if (descriptor.supportsDomainMode && hostScope) {
        moduleProps.hostScope = hostScope;
    }
    if (onExitModule) {
        moduleProps.onExitModule = onExitModule;
    }
    if (mobileConnectivitySlot !== undefined) {
        moduleProps.mobileConnectivitySlot = mobileConnectivitySlot;
    }

    const hostNode = (
        <ModuleErrorBoundary
            moduleName={localizedModuleName}
            resetKey={`${moduleId}:${domainMode || 'DEFAULT'}:${hostScope || 'CLIENT'}`}
        >
            <Suspense fallback={<M3ModuleHudFallback label={fallbackLabel} />}>
                <ModuleComponent {...moduleProps} />
            </Suspense>
        </ModuleErrorBoundary>
    );

    if (enforceEntitlement) {
        return <RequireModuleAccess moduleKey={moduleId}>{hostNode}</RequireModuleAccess>;
    }

    return hostNode;
};

export default ModuleHost;
