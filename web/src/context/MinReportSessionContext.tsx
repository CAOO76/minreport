import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';
import {
    loadOfflineSessionSnapshot,
    saveOfflineSessionSnapshot,
} from '../core/offline/OfflineSessionVault';
import {
    evaluatePilotExpiration,
    resolveEffectiveModuleAccess,
    type AccountClassification,
    type SystemRole,
} from '../contracts';
import type { CoreModuleId } from '../core/modules/module-registry';
export { resolveSessionHomePath } from '../contracts';

/**
 * CONTEXTO DE SESION UNIFICADA WEB 3.0 (MINREPORT CORE & MODULOS INTEGRADOS)
 * Jerarquia Soberana de 5 Tipos de Cuenta:
 * 1º DEV (`DEV_ROOT` / `dev@minreport.com`)
 * 2º ADMIN (`SUPER_ADMIN` / `admin@minreport.com`)
 * 3º TEST-PILOT (`TEST_PILOT`)
 * 4º CLIENTES B2B (`OWNER`, `ADMIN`, `OPERATOR`, `VIEWER`)
 * 5º EDU (`PROFESSOR`, `STUDENT`)
 */

export interface MinReportSession {
    uid: string;
    email: string;
    displayName: string;
    tenantId: string;
    tenantName: string;
    countryCode?: string;
    role: SystemRole;
    classification: AccountClassification;
    accountTier: 1 | 2 | 3 | 4 | 5;
    isDevRoot: boolean;
    isSuperAdmin: boolean;
    isTestPilot: boolean;
    pilotExpired?: boolean;
    isEduSandbox: boolean;
    isMfaVerified?: boolean;
    coBrandingLogoUrl?: string | null;
    coBrandingName?: string | null;
    maxProjects?: number | null;
    activeModules: {
        opermaq: boolean;
        stockpile: boolean;
        supply?: boolean;
    };
    permissions: {
        opermaq: {
            canInspect: boolean;
            canManageFleet: boolean;
            canViewVaults: boolean;
            canViewMasterCatalog?: boolean;
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
    hasModuleAccess: (moduleKey: CoreModuleId) => boolean;
}

const MinReportSessionContext = createContext<MinReportSessionContextType>({
    session: null,
    isLoaded: false,
    hasModuleAccess: () => false,
});

function normalizeCanonicalSystemRole(rawRole?: string): SystemRole | null {
    const upper = String(rawRole || '').trim().toUpperCase();
    switch (upper) {
        case 'DEV_ROOT':
        case 'SUPER_ADMIN':
        case 'TEST_PILOT':
        case 'OWNER':
        case 'ADMIN':
        case 'OPERATOR':
        case 'VIEWER':
        case 'PROFESSOR':
        case 'STUDENT':
            return upper;
        case 'SUBSCRIPTION_ADMIN':
        case 'BILLING_ONLY':
        case 'GENERAL_ADMIN':
            return 'ADMIN';
        case 'SUPERVISOR':
        case 'INTERNAL_USER':
            return 'OPERATOR';
        default:
            return null;
    }
}

export const MinReportSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, profile, currentAccount, loading, isMfaVerified } = useAuth();
    const [tokenClaims, setTokenClaims] = useState<Record<string, unknown>>({});
    const [claimsLoaded, setClaimsLoaded] = useState<boolean>(false);
    const [offlineSnapshot, setOfflineSnapshot] = useState<MinReportSession | null>(null);
    const [snapshotLoaded, setSnapshotLoaded] = useState<boolean>(false);
    const [globalModuleStatus, setGlobalModuleStatus] = useState<{
        opermaq: boolean;
        stockpile: boolean;
        supply: boolean;
    }>({
        opermaq: true,
        stockpile: true,
        supply: true,
    });

    // 0. Hidratación instantánea offline-first desde bóveda local persistente
    useEffect(() => {
        let active = true;
        loadOfflineSessionSnapshot()
            .then((snap) => {
                if (active) {
                    setOfflineSnapshot(snap);
                    setSnapshotLoaded(true);
                }
            })
            .catch(() => {
                if (active) {
                    setSnapshotLoaded(true);
                }
            });
        return () => {
            active = false;
        };
    }, []);

    // 1. Verificación de Custom Claims reales desde Firebase ID Token
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

    // 2. Disponibilidad global de módulos (`modules_status`)
    useEffect(() => {
        if (!user) return;

        const unsubCol = onSnapshot(
            collection(db, 'modules_status'),
            (snap) => {
                const next: Partial<{ opermaq: boolean; stockpile: boolean; supply: boolean }> = {};
                snap.forEach((docSnap) => {
                    const data = docSnap.data();
                    const resolvedFlag =
                        data?.enabled === false || data?.active === false
                            ? false
                            : typeof data?.enabled === 'boolean'
                              ? data.enabled
                              : typeof data?.active === 'boolean'
                                ? data.active
                                : undefined;
                    if (docSnap.id === 'opermaq' && typeof resolvedFlag === 'boolean') {
                        next.opermaq = resolvedFlag;
                    }
                    if (docSnap.id === 'stockpile' && typeof resolvedFlag === 'boolean') {
                        next.stockpile = resolvedFlag;
                    }
                    if (docSnap.id === 'supply' && typeof resolvedFlag === 'boolean') {
                        next.supply = resolvedFlag;
                    }
                });
                setGlobalModuleStatus({
                    opermaq: next.opermaq ?? true,
                    stockpile: next.stockpile ?? true,
                    supply: next.supply ?? true,
                });
            },
            () => {
                // Mantener disponibilidad por defecto si ocurre desconexión offline inicial
            }
        );

        return () => {
            unsubCol();
        };
    }, [user]);

    const session = useMemo<MinReportSession | null>(() => {
        if (!user) return null;

        const emailLower = (user.email || '').toLowerCase();
        const claimRole = typeof tokenClaims.role === 'string' ? tokenClaims.role.toUpperCase() : undefined;
        const claimClassification =
            typeof tokenClaims.classification === 'string' ? tokenClaims.classification.toLowerCase() : undefined;
        const claimIsMasterDev = Boolean(tokenClaims.isMasterDev);

        const profileRole = (profile as any)?.role ? String((profile as any).role).toUpperCase() : undefined;
        const profileClassification = ((profile as any)?.classification as string | undefined)?.toLowerCase();

        const accountType = currentAccount?.type?.toUpperCase();
        const accountClass = ((currentAccount as any)?.classification || '').toLowerCase();

        // 1º DEV (DEV_ROOT)
        const isDevRoot =
            claimIsMasterDev ||
            claimRole === 'DEV_ROOT' ||
            emailLower === 'dev@minreport.com' ||
            user.uid === 'dev-master-root-uid' ||
            profileRole === 'DEV_ROOT' ||
            currentAccount?.id === 'dev-master-sandbox';

        // 2º ADMIN (SUPER_ADMIN)
        const isSuperAdmin =
            !isDevRoot &&
            (claimRole === 'SUPER_ADMIN' ||
                emailLower === 'admin@minreport.com' ||
                user.uid === 'super-admin-uid' ||
                profileRole === 'SUPER_ADMIN');

        const userMembership = profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id);
        const membershipRoleRaw = userMembership?.role ? String(userMembership.role).toUpperCase() : undefined;

        // 3º TEST-PILOT (Rol único TEST_PILOT)
        const rawIsTestPilot =
            !isDevRoot &&
            !isSuperAdmin &&
            (claimRole === 'TEST_PILOT' ||
                profileRole === 'TEST_PILOT' ||
                membershipRoleRaw === 'TEST_PILOT' ||
                claimClassification === 'test-pilot' ||
                profileClassification === 'test-pilot' ||
                accountClass === 'test-pilot' ||
                accountType === 'TEST_PILOT' ||
                (currentAccount?.id || '').startsWith('pilot-'));

        // 5º EDU
        const isEdu =
            !isDevRoot &&
            !isSuperAdmin &&
            !rawIsTestPilot &&
            (claimRole === 'STUDENT' ||
                claimRole === 'PROFESSOR' ||
                profileRole === 'PROFESSOR' ||
                claimClassification === 'edu' ||
                accountType === 'EDUCATIONAL' ||
                accountClass === 'edu' ||
                profileClassification === 'edu' ||
                Boolean((currentAccount as any)?.isEduSandbox));

        let accountTier: 1 | 2 | 3 | 4 | 5 = 4;
        let classification: AccountClassification = 'b2b';

        if (isDevRoot) {
            accountTier = 1;
            classification = 'dev';
        } else if (isSuperAdmin) {
            accountTier = 2;
            classification = 'admin';
        } else if (rawIsTestPilot) {
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
        } else if (rawIsTestPilot) {
            role = 'TEST_PILOT';
        } else {
            const normalizedMembership = normalizeCanonicalSystemRole(membershipRoleRaw);
            const normalizedClaim = normalizeCanonicalSystemRole(claimRole);
            const normalizedProfile = normalizeCanonicalSystemRole(profileRole);

            if (normalizedMembership) {
                role = normalizedMembership;
            } else if (normalizedClaim) {
                role = normalizedClaim;
            } else if (currentAccount && currentAccount.ownerId === user.uid) {
                role = isEdu ? 'STUDENT' : 'OWNER';
            } else if (normalizedProfile) {
                role = normalizedProfile;
            } else if (isEdu) {
                role = 'STUDENT';
            }
        }

        const rawPilotExpiresAt =
            (tokenClaims as any)?.pilotExpiresAt ??
            (profile as any)?.pilotExpiresAt ??
            (currentAccount as any)?.pilotExpiresAt;
        const pilotExpired = role === 'TEST_PILOT' && evaluatePilotExpiration(rawPilotExpiresAt);
        const isTestPilot = rawIsTestPilot && !pilotExpired;

        const hasFullSuiteAccess = isDevRoot || isSuperAdmin || isTestPilot;
        const accountStatus = String((currentAccount as any)?.status || 'ACTIVE').toUpperCase();
        const isTenantBlocked =
            !hasFullSuiteAccess &&
            (accountStatus === 'PENDING_APPROVAL' || accountStatus === 'REJECTED' || accountStatus === 'SUSPENDED');

        const rawEntitlements = (currentAccount as any)?.entitlements ?? null;
        const contract = (currentAccount as any)?.contract;
        const rawAllowedModules = (userMembership as any)?.allowedModules ?? null;
        const rawAssignedModules: unknown[] | null = Array.isArray((userMembership as any)?.assignedModules)
            ? (userMembership as any).assignedModules
            : null;

        const resolveMemberAllowedForModule = (
            moduleKey: CoreModuleId
        ): Record<string, boolean> | null => {
            if (!rawAssignedModules) return rawAllowedModules;
            const assignedSet = new Set(
                rawAssignedModules.map((m) => String(m || '').trim().toLowerCase())
            );
            const merged: Record<string, boolean> = {
                ...(rawAllowedModules || {}),
            };
            if (merged[moduleKey] === undefined) {
                merged[moduleKey] = assignedSet.has(moduleKey);
            }
            return merged;
        };

        const hasStructuredEntitlements = Boolean(
            rawEntitlements &&
                (rawEntitlements.basePackage !== undefined ||
                    rawEntitlements.baseModules !== undefined ||
                    rawEntitlements.addonModules !== undefined)
        );
        const entitlementModulesMap =
            rawEntitlements?.modules && typeof rawEntitlements.modules === 'object'
                ? (rawEntitlements.modules as Record<string, boolean>)
                : null;
        const legacyAccountModulesMap =
            (currentAccount as any)?.modules && typeof (currentAccount as any).modules === 'object'
                ? ((currentAccount as any).modules as Record<string, boolean>)
                : null;

        const resolveEntitlementsForModule = (
            moduleKey: CoreModuleId
        ): Record<string, any> | null => {
            if (!hasStructuredEntitlements) return null;
            if (
                entitlementModulesMap &&
                typeof entitlementModulesMap[moduleKey] === 'boolean' &&
                rawEntitlements?.addonModules?.[moduleKey] === undefined &&
                rawEntitlements?.baseModules?.[moduleKey] === undefined
            ) {
                return {
                    ...rawEntitlements,
                    addonModules: {
                        ...(rawEntitlements.addonModules || {}),
                        [moduleKey]: { active: entitlementModulesMap[moduleKey] },
                    },
                };
            }
            return rawEntitlements;
        };

        const mergedLegacyActiveModules = {
            ...(legacyAccountModulesMap || {}),
            ...(contract?.activeModules || {}),
            ...(entitlementModulesMap || {}),
        };

        const activeModules =
            pilotExpired || isTenantBlocked
                ? { opermaq: false, stockpile: false, supply: false }
                : {
                      opermaq: resolveEffectiveModuleAccess({
                          moduleKey: 'opermaq',
                          globalModuleActive: globalModuleStatus.opermaq !== false,
                          hasFullSuiteOverride: hasFullSuiteAccess,
                          entitlements: resolveEntitlementsForModule('opermaq'),
                          legacyContractActiveModules: mergedLegacyActiveModules,
                          legacyEnabledPlugins: (currentAccount as any)?.enabledPlugins,
                          memberRole: userMembership?.role,
                          memberAllowedModules: resolveMemberAllowedForModule('opermaq'),
                      }),
                      stockpile: resolveEffectiveModuleAccess({
                          moduleKey: 'stockpile',
                          globalModuleActive: globalModuleStatus.stockpile !== false,
                          hasFullSuiteOverride: hasFullSuiteAccess,
                          entitlements: resolveEntitlementsForModule('stockpile'),
                          legacyContractActiveModules: mergedLegacyActiveModules,
                          legacyEnabledPlugins: (currentAccount as any)?.enabledPlugins,
                          memberRole: userMembership?.role,
                          memberAllowedModules: resolveMemberAllowedForModule('stockpile'),
                      }),
                      supply: resolveEffectiveModuleAccess({
                          moduleKey: 'supply',
                          globalModuleActive: globalModuleStatus.supply !== false,
                          hasFullSuiteOverride: hasFullSuiteAccess,
                          entitlements: resolveEntitlementsForModule('supply'),
                          legacyContractActiveModules: mergedLegacyActiveModules,
                          legacyEnabledPlugins: (currentAccount as any)?.enabledPlugins,
                          memberRole: userMembership?.role,
                          memberAllowedModules: resolveMemberAllowedForModule('supply'),
                      }),
                  };

        const isAdminOrOwner = hasFullSuiteAccess || role === 'OWNER' || role === 'ADMIN';
        const resolvedTenantId =
            currentAccount?.id ||
            (typeof tokenClaims.activeAccountId === 'string' ? tokenClaims.activeAccountId : '') ||
            (isDevRoot ? 'dev-master-sandbox' : isSuperAdmin ? 'admin-master-console' : '');

        const countryCode = String(
            (currentAccount as any)?.countryCode ||
            (currentAccount as any)?.country ||
            (profile as any)?.countryCode ||
            'CL'
        ).toUpperCase();

        const eduLogoUrl =
            typeof (currentAccount as any)?.eduInstitutionLogo?.downloadUrl === 'string'
                ? (currentAccount as any).eduInstitutionLogo.downloadUrl.trim()
                : '';
        const corpLogoUrl =
            typeof (currentAccount as any)?.corporateLogo?.downloadUrl === 'string'
                ? (currentAccount as any).corporateLogo.downloadUrl.trim()
                : typeof (currentAccount as any)?.corporateLogo === 'string'
                  ? (currentAccount as any).corporateLogo.trim()
                  : typeof (currentAccount as any)?.coBrandingLogoUrl === 'string'
                    ? (currentAccount as any).coBrandingLogoUrl.trim()
                    : '';
        const coBrandingLogoUrl = eduLogoUrl || corpLogoUrl || null;
        const coBrandingName =
            (typeof (currentAccount as any)?.eduInstitutionName === 'string' &&
                (currentAccount as any).eduInstitutionName.trim()) ||
            (coBrandingLogoUrl && currentAccount?.name ? currentAccount.name : null);
        const rawMaxProjects =
            (currentAccount as any)?.entitlements?.maxProjects ?? (currentAccount as any)?.maxProjects;
        const maxProjects: number | null =
            typeof rawMaxProjects === 'number' && Number.isFinite(rawMaxProjects)
                ? rawMaxProjects
                : isEdu
                  ? 3
                  : null;

        return {
            uid: user.uid,
            email: user.email || '',
            displayName:
                user.displayName ||
                (profile as any)?.fullName ||
                user.email?.split('@')[0] ||
                'Usuario MINREPORT',
            tenantId: resolvedTenantId,
            tenantName:
                currentAccount?.name ||
                (isDevRoot
                    ? 'DEV Master Sandbox'
                    : isSuperAdmin
                        ? 'Consola Comercial MINREPORT'
                        : '[Organización no seleccionada]'),
            countryCode,
            role,
            classification,
            accountTier,
            isDevRoot,
            isSuperAdmin,
            isTestPilot,
            pilotExpired,
            isEduSandbox: isEdu,
            isMfaVerified,
            coBrandingLogoUrl,
            coBrandingName,
            maxProjects,
            activeModules,
            permissions: {
                opermaq: {
                    canInspect: !pilotExpired && role !== 'VIEWER',
                    canManageFleet: !pilotExpired && (isAdminOrOwner || isEdu),
                    canViewVaults: !pilotExpired,
                    canViewMasterCatalog: isDevRoot || isSuperAdmin,
                    canCurateAI: isDevRoot,
                },
                stockpile: {
                    canScan: !pilotExpired && (hasFullSuiteAccess || !isEdu) && role !== 'VIEWER',
                    canCalculate: !pilotExpired,
                    canExportReport: !pilotExpired && (isAdminOrOwner || role === 'VIEWER'),
                    canTrainVisionAI: isDevRoot,
                },
                pilot: {
                    canCommentAndRequestChanges: isTestPilot,
                    canSimulateProjects: isTestPilot,
                    canTrainInternalAI: false,
                },
            },
        };
    }, [user, profile, currentAccount, tokenClaims, globalModuleStatus, isMfaVerified]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onUpdated = (evt: Event) => {
            const detail = (evt as CustomEvent<{ session?: MinReportSession }>).detail;
            if (detail?.session) {
                setOfflineSnapshot(detail.session);
            }
        };
        const onCleared = () => {
            setOfflineSnapshot(null);
        };
        window.addEventListener('minreport:offline-session-updated', onUpdated);
        window.addEventListener('minreport:offline-session-cleared', onCleared);
        return () => {
            window.removeEventListener('minreport:offline-session-updated', onUpdated);
            window.removeEventListener('minreport:offline-session-cleared', onCleared);
        };
    }, []);

    useEffect(() => {
        if (!session) return;
        setOfflineSnapshot(session);
        void saveOfflineSessionSnapshot(session);
    }, [session]);

    const useOfflineFallback =
        !session &&
        Boolean(offlineSnapshot) &&
        (Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && !navigator.onLine));

    const effectiveSession = session || (useOfflineFallback ? offlineSnapshot : null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (effectiveSession?.tenantId) {
            localStorage.setItem('minreport_active_account_id', effectiveSession.tenantId);
        }
    }, [effectiveSession?.tenantId]);

    const hasModuleAccess = (moduleKey: CoreModuleId): boolean => {
        if (!effectiveSession || effectiveSession.pilotExpired) return false;
        if (effectiveSession.isDevRoot || effectiveSession.isSuperAdmin || effectiveSession.isTestPilot) {
            return true;
        }
        return Boolean(effectiveSession.activeModules[moduleKey]);
    };

    const effectiveLoaded =
        (!loading && claimsLoaded) ||
        (snapshotLoaded && Boolean(offlineSnapshot) && !user && Capacitor.isNativePlatform());

    return (
        <MinReportSessionContext.Provider
            value={{
                session: effectiveSession,
                isLoaded: effectiveLoaded,
                hasModuleAccess,
            }}
        >
            {children}
        </MinReportSessionContext.Provider>
    );
};

export const useMinReportSession = () => useContext(MinReportSessionContext);
