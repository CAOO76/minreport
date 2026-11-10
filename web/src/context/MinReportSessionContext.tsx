import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';
import type { AccountClassification, SystemRole } from '../contracts';

/**
 * CONTEXTO DE SESION UNIFICADA WEB 3.0 (MINREPORT CORE & MODULOS INTEGRADOS)
 * Jerarquia Soberana de 5 Tipos de Cuenta:
 * 1º DEV (`DEV_ROOT` / `dev@minreport.com`)
 * 2º ADMIN (`SUPER_ADMIN` / `admin@minreport.com`)
 * 3º TEST-PILOT (`TEST_PILOT` / `PILOT_LEAD`)
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
    const [tokenClaims, setTokenClaims] = useState<Record<string, unknown>>({});
    const [claimsLoaded, setClaimsLoaded] = useState<boolean>(false);
    const [globalModuleStatus, setGlobalModuleStatus] = useState<{ opermaq: boolean; stockpile: boolean }>({
        opermaq: true,
        stockpile: true,
    });

    // 1. Verificacion de Custom Claims reales desde Firebase ID Token
    useEffect(() => {
        let active = true;
        if (!user) {
            setTokenClaims({});
            setClaimsLoaded(true);
            return;
        }
        setClaimsLoaded(false);
        user.getIdTokenResult()
            .then((result) => {
                if (active) {
                    setTokenClaims(result.claims || {});
                    setClaimsLoaded(true);
                }
            })
            .catch(() => {
                if (active) {
                    setTokenClaims({});
                    setClaimsLoaded(true);
                }
            });
        return () => {
            active = false;
        };
    }, [user]);

    // 2. Disponibilidad global de modulos (coleccion publica de lectura modules_status)
    useEffect(() => {
        if (!user) return;

        const unsubCol = onSnapshot(
            collection(db, 'modules_status'),
            (snap) => {
                const next: Partial<{ opermaq: boolean; stockpile: boolean }> = {};
                snap.forEach((docSnap) => {
                    const data = docSnap.data();
                    if (docSnap.id === 'opermaq' && typeof data?.enabled === 'boolean') {
                        next.opermaq = data.enabled;
                    }
                    if (docSnap.id === 'stockpile' && typeof data?.enabled === 'boolean') {
                        next.stockpile = data.enabled;
                    }
                });
                setGlobalModuleStatus({
                    opermaq: next.opermaq ?? true,
                    stockpile: next.stockpile ?? true,
                });
            },
            () => {
                // Mantener disponibilidad por defecto si ocurre desconexion offline inicial
            }
        );

        return () => {
            unsubCol();
        };
    }, [user]);

    const session = useMemo<MinReportSession | null>(() => {
        if (!user) return null;

        const emailLower = (user.email || '').toLowerCase();
        const claimRole = typeof tokenClaims.role === 'string' ? tokenClaims.role : undefined;
        const claimClassification = typeof tokenClaims.classification === 'string' ? tokenClaims.classification.toLowerCase() : undefined;
        const claimIsMasterDev = Boolean(tokenClaims.isMasterDev);

        const profileRole = (profile as any)?.role as string | undefined;
        const profileClassification = ((profile as any)?.classification as string | undefined)?.toLowerCase();

        const accountType = currentAccount?.type?.toUpperCase();
        const accountClass = ((currentAccount as any)?.classification || '').toLowerCase();

        // 1º DEV (DEV_ROOT)
        const isDevRoot =
            claimIsMasterDev ||
            claimRole === 'DEV_ROOT' ||
            emailLower === 'dev@minreport.com' ||
            user.uid === 'dev-master-root-uid' ||
            user.uid === 'minreport-dev-root-superadmin-2026' ||
            profileRole === 'DEV_ROOT' ||
            currentAccount?.id === 'dev-master-sandbox';

        // 2º ADMIN (SUPER_ADMIN)
        const isSuperAdmin =
            !isDevRoot && (
                claimRole === 'SUPER_ADMIN' ||
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
                claimRole === 'TEST_PILOT' ||
                claimRole === 'PILOT_LEAD' ||
                profileRole === 'TEST_PILOT' ||
                profileRole === 'PILOT_LEAD' ||
                membershipRole === 'PILOT_LEAD' ||
                membershipRole === 'TEST_PILOT' ||
                claimClassification === 'test-pilot' ||
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
                claimRole === 'STUDENT' ||
                claimClassification === 'edu' ||
                accountType === 'EDUCATIONAL' ||
                accountClass === 'edu' ||
                profileClassification === 'edu' ||
                Boolean((currentAccount as any)?.isEduSandbox)
            );

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

        let role: SystemRole = 'OPERATOR';
        if (isDevRoot) {
            role = 'DEV_ROOT';
        } else if (isSuperAdmin) {
            role = 'SUPER_ADMIN';
        } else if (isTestPilot) {
            role = (claimRole === 'PILOT_LEAD' || membershipRole === 'PILOT_LEAD' || profileRole === 'PILOT_LEAD')
                ? 'PILOT_LEAD'
                : 'TEST_PILOT';
        } else if (membershipRole) {
            role = membershipRole === 'SUBSCRIPTION_ADMIN' ? 'ADMIN' : (membershipRole as SystemRole);
        } else if (claimRole && ['OWNER', 'ADMIN', 'SUPERVISOR', 'OPERATOR', 'VIEWER', 'STUDENT', 'BILLING_ONLY'].includes(claimRole)) {
            role = claimRole as SystemRole;
        } else if (currentAccount && currentAccount.ownerId === user.uid) {
            role = 'OWNER';
        } else if (isEdu) {
            role = 'STUDENT';
        }

        // Gobernanza estricta de modulos:
        // Cuentas privilegiadas (DEV, ADMIN, TEST-PILOT) habilitan ambos modulos;
        // Cuentas B2B y EDU respetan estrictamente enabledPlugins/contract y modules_status global.
        const hasFullSuiteOverride = isDevRoot || isSuperAdmin || isTestPilot;
        const contract = (currentAccount as any)?.contract;
        const rawActive = contract?.activeModules;
        const explicitArray: string[] | null = Array.isArray((currentAccount as any)?.enabledPlugins)
            ? (currentAccount as any).enabledPlugins
            : Array.isArray((currentAccount as any)?.enabledModules)
                ? (currentAccount as any).enabledModules
                : Array.isArray(contract?.modules)
                    ? contract.modules
                    : null;

        const resolveTenantModule = (key: 'opermaq' | 'stockpile'): boolean => {
            if (typeof rawActive?.[key] === 'boolean') {
                return rawActive[key];
            }
            if (explicitArray !== null) {
                return explicitArray.includes(key);
            }
            return false;
        };

        const activeModules = hasFullSuiteOverride
            ? { opermaq: true, stockpile: true }
            : {
                opermaq: resolveTenantModule('opermaq') && globalModuleStatus.opermaq,
                stockpile: resolveTenantModule('stockpile') && globalModuleStatus.stockpile,
            };

        const isAdminOrOwner = hasFullSuiteOverride || role === 'OWNER' || role === 'ADMIN';
        const resolvedTenantId =
            currentAccount?.id ||
            (typeof tokenClaims.activeAccountId === 'string' ? tokenClaims.activeAccountId : '') ||
            (isDevRoot ? 'dev-master-sandbox' : isSuperAdmin ? 'admin-master-console' : '');

        return {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || (profile as any)?.fullName || user.email?.split('@')[0] || 'Usuario MINREPORT',
            tenantId: resolvedTenantId,
            tenantName: currentAccount?.name || (isDevRoot ? 'DEV Master Sandbox' : isSuperAdmin ? 'Consola Comercial MINREPORT' : '[Organizacion no seleccionada]'),
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
                    canManageFleet: isAdminOrOwner || role === 'SUPERVISOR' || isEdu,
                    canViewVaults: true,
                    canCurateAI: isDevRoot || isTestPilot
                },
                stockpile: {
                    canScan: hasFullSuiteOverride || !isEdu,
                    canCalculate: true,
                    canExportReport: isAdminOrOwner || role === 'SUPERVISOR',
                    canTrainVisionAI: isDevRoot || isTestPilot
                },
                pilot: {
                    canCommentAndRequestChanges: isDevRoot || isTestPilot || isSuperAdmin,
                    canSimulateProjects: isDevRoot || isTestPilot,
                    canTrainInternalAI: isDevRoot || isTestPilot
                }
            }
        };
    }, [user, profile, currentAccount, tokenClaims, globalModuleStatus]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (session?.tenantId) {
            localStorage.setItem('minreport_active_account_id', session.tenantId);
        }
    }, [session?.tenantId]);

    const hasModuleAccess = (moduleKey: 'opermaq' | 'stockpile'): boolean => {
        if (!session) return false;
        if (session.isDevRoot || session.isSuperAdmin || session.isTestPilot) return true;
        return Boolean(session.activeModules[moduleKey]);
    };

    return (
        <MinReportSessionContext.Provider value={{ session, isLoaded: !loading && claimsLoaded, hasModuleAccess }}>
            {children}
        </MinReportSessionContext.Provider>
    );
};

export const useMinReportSession = () => useContext(MinReportSessionContext);
