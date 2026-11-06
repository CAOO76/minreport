import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMinReportSession, type MinReportSession } from '../../../context/MinReportSessionContext';
import { useOptionalTheme } from '../../../context/ThemeContext';
import { useBranding } from '../../../context/BrandingContext';
import { setOpermaqActiveAccountId } from '../firebase/config';

export type OpermaqHostScope = 'DEV_GATEWAY' | 'TEST_PILOT' | 'CLIENT';

export interface OpermaqCapabilities {
    canInspect: boolean;
    canManageFleet: boolean;
    canViewVaults: boolean;
    canCurateAI: boolean;
}

export interface OpermaqFunctionalContextValue {
    isLoaded: boolean;
    isAuthenticated: boolean;
    hostScope: OpermaqHostScope;
    tenantId: string;
    tenantName: string;
    actorId: string;
    actorEmail: string;
    actorName: string;
    dataScope: 'PRODUCTION' | 'SANDBOX';
    capabilities: OpermaqCapabilities;
    isDark: boolean;
    theme: 'light' | 'dark';
    language: string;
    brandIsotypeUrl: string;
    brandSiteName: string;
}

export interface OpermaqContextOverrides {
    tenantId?: string;
    userId?: string;
    hostScope?: OpermaqHostScope;
}

/**
 * Resuelve de forma determinista las capacidades operativas de OPERMAQ según el alcance del contenedor
 * y la sesión verificada de MINREPORT.
 * - En `DEV_GATEWAY` (cabina `/dev` autenticada por desafío Out-of-Band), habilita `canCurateAI: true`
 *   para administrar el `CATÁLOGO` maestro único y su propia `FLOTA` sandbox (`dev-master-sandbox`).
 * - En `CLIENT` (`4º B2B` y `5º EDU`), depende exclusivamente de `session.permissions.opermaq` (`canCurateAI: false`).
 */
export function resolveOpermaqCapabilities(params: {
    hostScope?: OpermaqHostScope;
    session: MinReportSession | null;
    hasDevGatewayToken: boolean;
    overrideUserId?: string;
}): OpermaqCapabilities {
    const { hostScope = 'CLIENT', session, hasDevGatewayToken, overrideUserId } = params;

    if (hostScope === 'DEV_GATEWAY' && (session?.isDevRoot || hasDevGatewayToken)) {
        return {
            canInspect: true,
            canManageFleet: true,
            canViewVaults: true,
            canCurateAI: true,
        };
    }

    if (session?.permissions?.opermaq) {
        return session.permissions.opermaq;
    }

    return {
        canInspect: true,
        canManageFleet: Boolean(overrideUserId),
        canViewVaults: true,
        canCurateAI: false,
    };
}

export type OpermaqDomainMode = 'CATALOG' | 'FLEET' | 'SYMBOLOGY';

/**
 * Proyecta el dominio efectivo de OPERMAQ (`CATALOG`, `FLEET` o `SYMBOLOGY` transversal).
 * Solo cuentas con `canCurateAI === true` (`1º DEV`, `2º ADMIN`, `3º TEST-PILOT`) pueden abrir `CATALOG`.
 * `SYMBOLOGY` es una sección transversal de OPERMAQ (curaduría en `DEV`/`PILOT`, consulta consolidada en `CLIENT`).
 */
export function resolveEffectiveOpermaqDomain(
    requestedDomain: OpermaqDomainMode,
    capabilities: OpermaqCapabilities
): OpermaqDomainMode {
    if (requestedDomain === 'SYMBOLOGY') {
        return 'SYMBOLOGY';
    }
    return requestedDomain === 'CATALOG' && capabilities.canCurateAI ? 'CATALOG' : 'FLEET';
}

const OpermaqReactContext = createContext<OpermaqFunctionalContextValue | null>(null);

export const OpermaqContextProvider: React.FC<{
    value: OpermaqFunctionalContextValue;
    children: React.ReactNode;
}> = ({ value, children }) => {
    return React.createElement(OpermaqReactContext.Provider, { value }, children);
};

/**
 * Construye el contexto funcional de OPERMAQ en la raíz del módulo (`App.tsx`).
 */
export function useBuildOpermaqContext(
    overrides?: OpermaqContextOverrides
): OpermaqFunctionalContextValue {
    const { session, isLoaded } = useMinReportSession();
    const themeCtx = useOptionalTheme();
    const { branding } = useBranding();
    const { i18n } = useTranslation();

    const hostScope: OpermaqHostScope = overrides?.hostScope || 'CLIENT';

    const hasDevGatewayToken =
        typeof window !== 'undefined' &&
        Boolean(localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token'));

    const isDevGatewayAuthorized =
        hostScope === 'DEV_GATEWAY' && Boolean(session?.isDevRoot || hasDevGatewayToken);

    const theme: 'light' | 'dark' = useMemo(() => {
        if (themeCtx?.theme) return themeCtx.theme;
        if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
            return 'dark';
        }
        return 'light';
    }, [themeCtx?.theme]);

    const isDark = theme === 'dark';

    const tenantId = useMemo(() => {
        if (overrides?.tenantId) return overrides.tenantId;
        if (isDevGatewayAuthorized) {
            return session?.isDevRoot && session.tenantId ? session.tenantId : 'dev-master-sandbox';
        }
        return session?.tenantId || '';
    }, [overrides?.tenantId, isDevGatewayAuthorized, session?.isDevRoot, session?.tenantId]);

    useEffect(() => {
        setOpermaqActiveAccountId(tenantId || null);
    }, [tenantId]);

    return useMemo<OpermaqFunctionalContextValue>(() => {
        const actorId =
            overrides?.userId ||
            (isDevGatewayAuthorized
                ? (session?.isDevRoot && session.uid ? session.uid : 'dev-master-root-uid')
                : session?.uid || '');

        const actorEmail = isDevGatewayAuthorized
            ? (session?.isDevRoot && session.email ? session.email : 'dev@minreport.com')
            : session?.email || '';

        const actorName = isDevGatewayAuthorized
            ? (session?.isDevRoot && session.displayName ? session.displayName : 'MINREPORT DEV')
            : session?.displayName || 'Operador';

        const tenantName = isDevGatewayAuthorized
            ? (session?.isDevRoot && session.tenantName ? session.tenantName : 'DEV Master Sandbox')
            : session?.tenantName || 'Faena Activa';

        const dataScope: 'PRODUCTION' | 'SANDBOX' =
            isDevGatewayAuthorized || session?.isDevRoot || session?.isTestPilot || session?.isEduSandbox
                ? 'SANDBOX'
                : 'PRODUCTION';

        const capabilities = resolveOpermaqCapabilities({
            hostScope,
            session,
            hasDevGatewayToken,
            overrideUserId: overrides?.userId,
        });

        const logoSet = isDark ? branding?.dark : branding?.light;
        const brandIsotypeUrl = logoSet?.isotype || branding?.light?.isotype || '';

        return {
            isLoaded: isDevGatewayAuthorized ? true : isLoaded,
            isAuthenticated: Boolean(actorId),
            hostScope,
            tenantId,
            tenantName,
            actorId,
            actorEmail,
            actorName,
            dataScope,
            capabilities,
            isDark,
            theme,
            language: i18n.language || 'es',
            brandIsotypeUrl,
            brandSiteName: branding?.siteName || 'MINREPORT',
        };
    }, [
        overrides?.userId,
        isDevGatewayAuthorized,
        hostScope,
        session,
        hasDevGatewayToken,
        isLoaded,
        tenantId,
        isDark,
        theme,
        branding,
        i18n.language,
    ]);
}

/**
 * Hook funcional pasivo subordinado 100% al Host Core MINREPORT.
 * Consume prioritariamente el `OpermaqContextProvider` montado por la raíz del módulo
 * para garantizar coherencia total entre `App`, `AssetList` y `KnowledgeVaultDashboard`.
 */
export function useOpermaqContext(
    overrides?: OpermaqContextOverrides
): OpermaqFunctionalContextValue {
    const provided = useContext(OpermaqReactContext);
    const fallback = useBuildOpermaqContext(overrides);

    if (provided && !overrides) {
        return provided;
    }
    return fallback;
}
