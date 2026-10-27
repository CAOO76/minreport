import React, { createContext, useContext, useMemo } from 'react';
import { useAuth } from './AuthContext';
import type { AccountClassification, SystemRole } from '../contracts';

/**
 * CONTEXTO DE SESIÓN UNIFICADA WEB 3.0 (MINREPORT HOST & STANDALONE)
 * Implementa la Jerarquía Soberana de 5 Tipos de Cuenta:
 * 1º DEV (`DEV_ROOT` / `dev@minreport.com`)
 * 2º ADMIN (`SUPER_ADMIN` / `admin@minreport.com`)
 * 3º TEST-PILOT (`TEST_PILOT` / `PILOT_LEAD` - Expertos Co-Dev e IA)
 * 4º CLIENTES B2B (`OWNER`, `ADMIN`, `SUPERVISOR`, `OPERATOR`, `VIEWER`, `BILLING_ONLY`)
 * 5º EDU (`STUDENT` / `EDUCATIONAL`)
 */

export interface MinReportSession {
    uid: string;
    email: string;
    displayName: string;
    tenantId: string;
    tenantName: string;
    role: SystemRole;
    classification: AccountClassification;
    accountTier: 1 | 2 | 3 | 4 | 5;
    isDevRoot: boolean;
    isSuperAdmin: boolean;
    isTestPilot: boolean;
    isEduSandbox: boolean;
    activeModules: {
        opermaq: boolean;
        stockpile: boolean;
    };
    permissions: {
        opermaq: {
            canInspect: boolean;
            canManageFleet: boolean;
            canViewVaults: boolean;
            canCurateAI: boolean;
        };
        stockpile: {
            canScan: boolean;
            canCalculate: boolean;
            canExportReport: boolean;
            canTrainVisionAI: boolean;
        };
        pilot: {
            canCommentAndRequestChanges: boolean;
            canSimulateProjects: boolean;
            canTrainInternalAI: boolean;
        };
    };
}

interface MinReportSessionContextType {
    session: MinReportSession | null;
    isLoaded: boolean;
    hasModuleAccess: (moduleKey: 'opermaq' | 'stockpile') => boolean;
}

const MinReportSessionContext = createContext<MinReportSessionContextType>({
    session: null,
    isLoaded: false,
    hasModuleAccess: () => false
});

export const MinReportSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, profile, currentAccount, loading } = useAuth();

    const session = useMemo<MinReportSession | null>(() => {
        if (!user) return null;

        const emailLower = (user.email || '').toLowerCase();
        const profileRole = (profile as any)?.role as string | undefined;
        const profileClassification = (profile as any)?.classification as string | undefined;

        const accountType = currentAccount?.type?.toUpperCase();
        const accountClass = ((currentAccount as any)?.classification || '').toLowerCase();

        // 1º DEV (DEV_ROOT)
        const isDevRoot =
            emailLower === 'dev@minreport.com' ||
            user.uid === 'dev-master-root-uid' ||
            profileRole === 'DEV_ROOT' ||
            currentAccount?.id === 'dev-master-sandbox';

        // 2º ADMIN (SUPER_ADMIN)
        const isSuperAdmin =
            !isDevRoot && (
                emailLower === 'admin@minreport.com' ||
                user.uid === 'super-admin-uid' ||
                profileRole === 'SUPER_ADMIN'
            );

        const userMembership = profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id);
        const membershipRole = userMembership?.role as string | undefined;

        // 3º TEST-PILOT
        const isTestPilot =
            !isDevRoot &&
            !isSuperAdmin && (
                profileRole === 'TEST_PILOT' ||
                profileRole === 'PILOT_LEAD' ||
                membershipRole === 'PILOT_LEAD' ||
                membershipRole === 'TEST_PILOT' ||
                profileClassification === 'test-pilot' ||
                accountClass === 'test-pilot' ||
                accountType === 'TEST_PILOT' ||
                (currentAccount?.id || '').startsWith('pilot-')
            );

        // 5º EDU
        const isEdu =
            !isDevRoot &&
            !isSuperAdmin &&
            !isTestPilot && (
                accountType === 'EDUCATIONAL' ||
                accountClass === 'edu' ||
                profileClassification === 'edu'
            );

        // Determinar Tier (1 a 5) y Clasificación Canónica
        let accountTier: 1 | 2 | 3 | 4 | 5 = 4;
        let classification: AccountClassification = 'b2b';

        if (isDevRoot) {
            accountTier = 1;
            classification = 'dev';
        } else if (isSuperAdmin) {
            accountTier = 2;
            classification = 'admin';
        } else if (isTestPilot) {
            accountTier = 3;
            classification = 'test-pilot';
        } else if (isEdu) {
            accountTier = 5;
            classification = 'edu';
        } else {
            accountTier = 4;
            classification = 'b2b';
        }

        // Determinar Rol Canónico
        let role: SystemRole = 'OPERATOR';
        if (isDevRoot) {
            role = 'DEV_ROOT';
        } else if (isSuperAdmin) {
            role = 'SUPER_ADMIN';
        } else if (isTestPilot) {
            role = membershipRole === 'PILOT_LEAD' ? 'PILOT_LEAD' : 'TEST_PILOT';
        } else if (membershipRole) {
            role = membershipRole as SystemRole;
        } else if (currentAccount && currentAccount.ownerId === user.uid) {
            role = 'OWNER';
        } else if (isEdu) {
            role = 'STUDENT';
        }

        // Gobernanza modular: DEV, ADMIN y TEST-PILOT tienen acceso irrestricto a todos los módulos
        const contract = (currentAccount as any)?.contract;
        const rawActive = contract?.activeModules || {};
        const enabledList: string[] = (currentAccount as any)?.enabledModules || (currentAccount as any)?.enabledPlugins || [];
        const hasFullSuiteOverride = isDevRoot || isSuperAdmin || isTestPilot;

        const activeModules = {
            opermaq: hasFullSuiteOverride ? true : (rawActive.opermaq ?? (enabledList.length > 0 ? enabledList.includes('opermaq') : true)),
            stockpile: hasFullSuiteOverride ? true : (rawActive.stockpile ?? (enabledList.length > 0 ? enabledList.includes('stockpile') : true))
        };

        const isAdminOrOwner = hasFullSuiteOverride || role === 'OWNER' || role === 'ADMIN';

        return {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || (profile as any)?.fullName || user.email?.split('@')[0] || 'Operador Faena',
            tenantId: currentAccount?.id || (isDevRoot ? 'dev-master-sandbox' : 'faena-minreport'),
            tenantName: currentAccount?.name || (isDevRoot ? 'DEV Master Sandbox' : 'Faena Principal'),
            role,
            classification,
            accountTier,
            isDevRoot,
            isSuperAdmin,
            isTestPilot,
            isEduSandbox: isEdu,
            activeModules,
            permissions: {
                opermaq: {
                    canInspect: true,
                    canManageFleet: isAdminOrOwner || role === 'SUPERVISOR',
                    canViewVaults: true,
                    canCurateAI: hasFullSuiteOverride
                },
                stockpile: {
                    canScan: hasFullSuiteOverride || !isEdu,
                    canCalculate: true,
                    canExportReport: isAdminOrOwner || role === 'SUPERVISOR',
                    canTrainVisionAI: hasFullSuiteOverride
                },
                pilot: {
                    canCommentAndRequestChanges: isDevRoot || isTestPilot || isSuperAdmin,
                    canSimulateProjects: isDevRoot || isTestPilot,
                    canTrainInternalAI: isDevRoot || isTestPilot
                }
            }
        };
    }, [user, profile, currentAccount]);

    const hasModuleAccess = (moduleKey: 'opermaq' | 'stockpile'): boolean => {
        if (!session) return false;
        if (session.isDevRoot || session.isSuperAdmin || session.isTestPilot) return true;
        return session.activeModules[moduleKey] ?? true;
    };

    return (
        <MinReportSessionContext.Provider value={{ session, isLoaded: !loading, hasModuleAccess }}>
            {children}
        </MinReportSessionContext.Provider>
    );
};

export const useMinReportSession = () => useContext(MinReportSessionContext);
