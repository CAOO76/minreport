import { Request, Response, NextFunction } from 'express';
import { auth, db } from '../config/firebase';
import { env, isDevPrivateReleaseStage } from '../config/env';
import { evaluatePilotExpiration, resolveEffectiveModuleAccess } from '../contracts/session.contracts';
import { CoreModuleId, isCoreModuleId } from '../core/modules/module-registry';
import { logThrottledAuthFailure } from './auth';

const lastModulesStatusTimeoutByModule = new Map<CoreModuleId, number>();

async function readWithFailOpenTimeout<T>(promiseFn: () => Promise<T>, fallback: T, timeoutMs = 600): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
        return await Promise.race([
            promiseFn(),
            new Promise<T>((resolve) => {
                timer = setTimeout(() => resolve(fallback), timeoutMs);
                if (typeof timer.unref === 'function') timer.unref();
            }),
        ]);
    } catch {
        return fallback;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * MIDDLEWARE CENTRAL DEL HOST MINREPORT (Capa 3 — Gobierno Soberano Multi-Módulo)
 *
 * Resuelve la identidad verificada criptográficamente, el aislamiento multi-tenant
 * y las capacidades funcionales del usuario en el núcleo de MINREPORT e inyecta
 * el contexto funcional pasivo (`moduleContext` y alias `opermaqContext`) hacia los módulos integrados.
 */

export interface OpermaqFunctionalContext {
    tenantId: string;
    actorId: string;
    actorEmail: string;
    accountTier: 1 | 2 | 3 | 4 | 5;
    isEduSandbox: boolean;
    isTestPilot: boolean;
    dataScope: 'PRODUCTION' | 'SANDBOX';
    countryCode?: string;
    coBrandingLogoUrl?: string | null;
    capabilities: {
        canInspect: boolean;
        canManageFleet: boolean;
        canViewVaults: boolean;
        canViewMasterCatalog: boolean;
        canCurateAI: boolean;
    };
}

export type OpermaqSessionContext = OpermaqFunctionalContext;

export interface ModuleSessionContext extends OpermaqSessionContext {
    moduleId: CoreModuleId;
}

declare global {
    namespace Express {
        interface Request {
            opermaqContext?: OpermaqSessionContext;
            moduleContext?: ModuleSessionContext;
        }
    }
}

export interface ScopedRequest extends Request {
    user?: any;
    opermaqContext?: OpermaqSessionContext;
    moduleContext?: ModuleSessionContext;
}

export function resolveModuleSessionScope(moduleId: CoreModuleId = 'opermaq') {
    return async (req: ScopedRequest, res: Response, next: NextFunction) => {
        if (!isCoreModuleId(moduleId)) {
            return res.status(403).json({
                error: 'MODULO_NO_REGISTRADO: El módulo solicitado no está registrado en MINREPORT Core.',
                moduleDisabled: true,
                moduleId,
            });
        }

        try {
            const authHeader = req.headers.authorization;
            if (!authHeader?.startsWith('Bearer ')) {
                return res.status(401).json({ error: 'No autorizado: Token de sesión MINREPORT requerido.' });
            }

            const token = authHeader.slice(7).trim();
            if (!token) {
                return res.status(401).json({ error: 'No autorizado: Token de sesión vacío.' });
            }

            // Validación criptográfica obligatoria vía Firebase Admin Auth (sin fallback Base64 sin firma)
            let decoded: Awaited<ReturnType<typeof auth.verifyIdToken>>;
            try {
                decoded = await auth.verifyIdToken(token);
            } catch (authErr) {
                logThrottledAuthFailure('MINREPORT-SESSION-SCOPE', req, authErr);
                return res.status(401).json({ error: 'No autorizado: Fallo al verificar sesión MINREPORT.' });
            }
            req.user = decoded;

            const uid: string = decoded.uid;
            const emailLower: string = String(decoded.email || '').toLowerCase();
            const emailVerifiedOk = decoded.email_verified !== false;

            const requestedHeaderTenantId = (
                (req.headers['x-active-account-id'] as string) ||
                (req.headers['x-tenant-id'] as string) ||
                ''
            ).trim();

            // Resolver perfil desde colección central `/users/{uid}`
            let profileData: Record<string, any> | null = null;
            try {
                const userSnap = await db.collection('users').doc(uid).get();
                if (userSnap.exists) {
                    profileData = userSnap.data() || null;
                }
            } catch {
                profileData = null;
            }

            const tokenRole = String(decoded.role || '').toUpperCase();
            const serverUserRole = String(profileData?.role || '').toUpperCase();
            const claimRole = tokenRole || serverUserRole;
            const claimClass = String(decoded.classification || profileData?.classification || '').toLowerCase();

            const isDevRoot =
                decoded.isMasterDev === true ||
                tokenRole === 'DEV_ROOT' ||
                uid === 'dev-master-root-uid' ||
                (emailVerifiedOk && emailLower === 'dev@minreport.com');

            if (isDevPrivateReleaseStage() && !isDevRoot) {
                return res.status(403).json({
                    error: 'RELEASE_STAGE_DEV_ONLY: Acceso restringido exclusivamente a 1º DEV.',
                    code: 'RELEASE_STAGE_DEV_ONLY',
                });
            }

            const isSuperAdmin =
                !isDevRoot &&
                (decoded.admin === true ||
                    tokenRole === 'SUPER_ADMIN' ||
                    uid === 'super-admin-uid' ||
                    (emailVerifiedOk &&
                        (emailLower === env.SUPER_ADMIN_EMAIL.toLowerCase() ||
                            emailLower === 'admin@minreport.com')));

            // Cierre de escalamiento TEST-PILOT: únicamente rol verificado del token o asignado por servidor en /users/{uid}
            const userAccountDisabled =
                String(profileData?.status || '').toUpperCase() === 'SUSPENDED' ||
                String(profileData?.status || '').toUpperCase() === 'REVOKED';

            const isTestPilot =
                !isDevRoot &&
                !isSuperAdmin &&
                !userAccountDisabled &&
                (tokenRole === 'TEST_PILOT' || serverUserRole === 'TEST_PILOT');

            if (isTestPilot) {
                const candidateExpiry = decoded.pilotExpiresAt ?? profileData?.pilotExpiresAt;
                let isExpiredPilot = evaluatePilotExpiration(candidateExpiry);
                if (!isExpiredPilot) {
                    const pilotsSnap = await readWithFailOpenTimeout<any>(
                        () => db.collection('test_pilots').where('userId', '==', uid).get(),
                        null,
                        600
                    );
                    if (pilotsSnap && !pilotsSnap.empty) {
                        const docs = pilotsSnap.docs.map((d: any) => d.data() || {});
                        const activeDocs = docs.filter((p: any) => String(p.status || '').toUpperCase() === 'ACTIVE');
                        if (activeDocs.length > 0 && activeDocs.every((p: any) => evaluatePilotExpiration(p.expiresAt))) {
                            isExpiredPilot = true;
                        }
                    }
                }
                if (isExpiredPilot) {
                    return res.status(403).json({
                        error: 'Cuenta 3º TEST-PILOT expirada.',
                        code: 'PILOT_ACCOUNT_EXPIRED',
                    });
                }
            }

            const hasFullSuiteOverride = isDevRoot || isSuperAdmin || isTestPilot;

            const baseUrl = String(req.baseUrl || '');
            const reqPath = String(req.path || '');
            const isGlobalCatalogLookup =
                baseUrl.endsWith('/api/assets') &&
                ((req.method === 'POST' && reqPath === '/resolve') ||
                    (req.method === 'GET' && reqPath.startsWith('/catalog')));

            const sanitizedHeaderTenantId =
                requestedHeaderTenantId === 'faena-minreport' ? '' : requestedHeaderTenantId;

            const resolvedTenantId =
                sanitizedHeaderTenantId ||
                String(decoded.activeAccountId || '').trim() ||
                String(profileData?.lastActiveAccountId || '').trim() ||
                String(profileData?.primaryAccountId || '').trim() ||
                String(profileData?.memberships?.[0]?.accountId || '').trim() ||
                (hasFullSuiteOverride ? 'dev-master-sandbox' : '');

            if (!resolvedTenantId && !isGlobalCatalogLookup) {
                return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
            }

            let accountData: Record<string, any> | null = null;
            if (resolvedTenantId && resolvedTenantId !== 'dev-master-sandbox') {
                try {
                    const accSnap = await db.collection('accounts').doc(resolvedTenantId).get();
                    if (accSnap.exists) {
                        accountData = accSnap.data() || null;
                    }
                } catch {
                    accountData = null;
                }
            }

            const membership = Array.isArray(profileData?.memberships)
                ? profileData!.memberships.find((m: any) => {
                      if (m?.accountId !== resolvedTenantId) return false;
                      const st = String(m?.status || 'ACTIVE').toUpperCase();
                      return st !== 'SUSPENDED' && st !== 'REVOKED' && st !== 'INACTIVE' && st !== 'DELETED';
                  })
                : undefined;

            let memberDocRole = '';
            let hasActiveMemberDoc = false;
            let memberData: Record<string, any> | null = null;

            if (
                resolvedTenantId &&
                resolvedTenantId !== 'dev-master-sandbox' &&
                !hasFullSuiteOverride &&
                accountData?.ownerId !== uid &&
                (!membership ||
                    (membership?.allowedModules === undefined && !Array.isArray(membership?.assignedModules)))
            ) {
                try {
                    const memberSnap = await db
                        .collection('accounts')
                        .doc(resolvedTenantId)
                        .collection('members')
                        .doc(uid)
                        .get();
                    if (memberSnap.exists) {
                        const rawMemberData = memberSnap.data() || {};
                        const memberStatus = String(rawMemberData.status || 'ACTIVE').toUpperCase();
                        if (
                            memberStatus !== 'SUSPENDED' &&
                            memberStatus !== 'REVOKED' &&
                            memberStatus !== 'INACTIVE' &&
                            memberStatus !== 'DELETED'
                        ) {
                            hasActiveMemberDoc = true;
                            memberDocRole = String(rawMemberData.role || '').toUpperCase();
                            memberData = rawMemberData;
                        }
                    }
                } catch {
                    hasActiveMemberDoc = false;
                }
            }

            const isAccountOwner = Boolean(accountData?.ownerId && accountData.ownerId === uid);
            const isVerifiedTenantMember = Boolean(membership) || hasActiveMemberDoc || isAccountOwner;

            // Bloqueo estricto Cross-Tenant: sin privilegio global, debe pertenecer al tenant solicitado/resuelto
            if (!hasFullSuiteOverride && !isVerifiedTenantMember && (!isGlobalCatalogLookup || Boolean(sanitizedHeaderTenantId))) {
                console.warn(
                    `[MINREPORT-SESSION-SCOPE] Acceso cross-tenant bloqueado: uid=${uid} solicitó tenant=${resolvedTenantId}`
                );
                return res.status(403).json({ error: 'TENANT_ACCESS_DENIED' });
            }

            const membershipRole = String(membership?.role || '').toUpperCase();
            const accountType = String(accountData?.type || '').toUpperCase();
            const accountClass = String(accountData?.classification || '').toLowerCase();

            const isEduSandbox =
                !hasFullSuiteOverride &&
                (accountType === 'EDUCATIONAL' ||
                    accountClass === 'edu' ||
                    claimClass === 'edu' ||
                    claimRole === 'STUDENT' ||
                    claimRole === 'PROFESSOR' ||
                    Boolean(accountData?.isEduSandbox));

            const accountStatus = String(accountData?.status || 'ACTIVE').toUpperCase();
            if (
                !hasFullSuiteOverride &&
                (accountStatus === 'PENDING_APPROVAL' || accountStatus === 'REJECTED' || accountStatus === 'SUSPENDED')
            ) {
                return res.status(403).json({
                    error: `CUENTA_${accountStatus}: La cuenta organizacional no se encuentra habilitada para operación modular.`,
                });
            }

            const lastModulesStatusTimeoutAt = lastModulesStatusTimeoutByModule.get(moduleId) || 0;
            let globalModuleActive = true;
            if (!hasFullSuiteOverride && Date.now() - lastModulesStatusTimeoutAt > 5000) {
                const modResult = await readWithFailOpenTimeout<boolean | 'TIMEOUT'>(
                    async () => {
                        const modSnap = await db.collection('modules_status').doc(moduleId).get();
                        const modData = modSnap.data();
                        return modSnap.exists && (modData?.enabled === false || modData?.active === false)
                            ? false
                            : true;
                    },
                    'TIMEOUT',
                    600
                );
                if (modResult === 'TIMEOUT') {
                    lastModulesStatusTimeoutByModule.set(moduleId, Date.now());
                    globalModuleActive = true;
                } else {
                    globalModuleActive = modResult;
                }
            }

            const moduleLabel = moduleId.toUpperCase();
            if (!hasFullSuiteOverride && !globalModuleActive) {
                return res.status(403).json({
                    error: `El módulo ${moduleLabel} se encuentra temporalmente deshabilitado por administración global.`,
                    moduleDisabled: true,
                    moduleId,
                });
            }

            const normalizedRawRole =
                (membershipRole ||
                    memberDocRole ||
                    (isAccountOwner ? 'OWNER' : '') ||
                    (hasFullSuiteOverride ? claimRole : '') ||
                    (isEduSandbox ? 'STUDENT' : 'OPERATOR'))
                    .toUpperCase();

            const rawAllowedModules = membership?.allowedModules ?? memberData?.allowedModules ?? null;
            const rawAssignedModules: unknown[] | null = Array.isArray(membership?.assignedModules)
                ? membership.assignedModules
                : Array.isArray(memberData?.assignedModules)
                  ? memberData.assignedModules
                  : null;

            let effectiveMemberAllowedModules: Record<string, boolean> | null = rawAllowedModules;
            if (rawAssignedModules) {
                const assignedSet = new Set(
                    rawAssignedModules.map((m) => String(m || '').trim().toLowerCase())
                );
                const mergedAllowed: Record<string, boolean> = {
                    ...(rawAllowedModules || {}),
                };
                if (mergedAllowed[moduleId] === undefined) {
                    mergedAllowed[moduleId] = assignedSet.has(moduleId);
                }
                effectiveMemberAllowedModules = mergedAllowed;
            }

            const rawEntitlements = accountData?.entitlements ?? null;
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
                accountData?.modules && typeof accountData.modules === 'object'
                    ? (accountData.modules as Record<string, boolean>)
                    : null;

            const hasAccountModuleConfig = Boolean(
                hasStructuredEntitlements ||
                    entitlementModulesMap ||
                    accountData?.contract?.activeModules ||
                    legacyAccountModulesMap ||
                    Array.isArray(accountData?.enabledPlugins)
            );

            const effectiveEntitlements =
                hasStructuredEntitlements &&
                entitlementModulesMap &&
                typeof entitlementModulesMap[moduleId] === 'boolean' &&
                rawEntitlements?.addonModules?.[moduleId] === undefined &&
                rawEntitlements?.baseModules?.[moduleId] === undefined
                    ? {
                          ...rawEntitlements,
                          addonModules: {
                              ...(rawEntitlements.addonModules || {}),
                              [moduleId]: { active: entitlementModulesMap[moduleId] },
                          },
                      }
                    : hasStructuredEntitlements
                      ? rawEntitlements
                      : null;

            const mergedLegacyActiveModules = hasAccountModuleConfig
                ? {
                      ...(legacyAccountModulesMap || {}),
                      ...(accountData?.contract?.activeModules || {}),
                      ...(entitlementModulesMap || {}),
                  }
                : { opermaq: true, stockpile: true };

            const moduleEnabledForTenant = resolveEffectiveModuleAccess({
                moduleKey: moduleId,
                globalModuleActive,
                hasFullSuiteOverride,
                entitlements: effectiveEntitlements,
                legacyContractActiveModules: mergedLegacyActiveModules,
                legacyEnabledPlugins: Array.isArray(accountData?.enabledPlugins) ? accountData.enabledPlugins : null,
                memberRole: normalizedRawRole,
                memberAllowedModules: effectiveMemberAllowedModules,
            });

            if (!hasFullSuiteOverride && !moduleEnabledForTenant) {
                const isSeatBlocked =
                    normalizedRawRole === 'SUBSCRIPTION_ADMIN' ||
                    normalizedRawRole === 'BILLING_ONLY' ||
                    effectiveMemberAllowedModules?.[moduleId] === false;
                return res.status(403).json({
                    error: isSeatBlocked
                        ? `MODULO_NO_AUTORIZADO_ASIENTO: El usuario no tiene acceso asignado al módulo ${moduleLabel}.`
                        : `El módulo ${moduleLabel} no está habilitado en la cuenta activa de MINREPORT.`,
                    moduleId,
                });
            }

            const effectiveB2BRole =
                normalizedRawRole === 'SUBSCRIPTION_ADMIN' || normalizedRawRole === 'BILLING_ONLY'
                    ? 'ADMIN'
                    : normalizedRawRole;

            const accountTier: 1 | 2 | 3 | 4 | 5 = isDevRoot
                ? 1
                : isSuperAdmin
                    ? 2
                    : isTestPilot
                        ? 3
                        : isEduSandbox
                            ? 5
                            : 4;

            const resolvedCountryCode =
                String(
                    accountData?.countryCode || accountData?.country || profileData?.countryCode || 'CL'
                )
                    .trim()
                    .toUpperCase() || 'CL';

            const coBrandingCandidates = [
                accountData?.eduInstitutionLogo?.downloadUrl,
                typeof accountData?.eduInstitutionLogo === 'string' ? accountData.eduInstitutionLogo : null,
                accountData?.corporateLogo?.downloadUrl,
                typeof accountData?.corporateLogo === 'string' ? accountData.corporateLogo : null,
                accountData?.coBrandingLogoUrl,
            ];
            const resolvedCoBrandingLogoUrl =
                coBrandingCandidates
                    .find((c): c is string => typeof c === 'string' && c.trim().length > 0)
                    ?.trim() ?? null;

            // Segregación estricta GEMINI.md §1.1:
            // - Únicamente 1º DEV cura ingeniería OEM / IA (`canCurateAI`).
            // - Únicamente 1º DEV y 2º ADMIN acceden al Catálogo Maestro (`canViewMasterCatalog`).
            // - 3º TEST-PILOT simula flujos sobre su propio sandbox en modo B2B cliente sin acceso a `CATALOG`.
            // - 5º EDU practica gestión de flota exclusivamente en su jaula aislada `edu_sandbox_fleet`.
            const canCurateEngineering = isDevRoot;
            const canManageFleet =
                hasFullSuiteOverride ||
                isEduSandbox ||
                effectiveB2BRole === 'OWNER' ||
                effectiveB2BRole === 'ADMIN';

            const resolvedCtx: OpermaqSessionContext = {
                tenantId: resolvedTenantId,
                actorId: uid,
                actorEmail: emailLower || 'operador@minreport.local',
                accountTier,
                isEduSandbox,
                isTestPilot,
                dataScope: isEduSandbox ? 'SANDBOX' : 'PRODUCTION',
                countryCode: resolvedCountryCode,
                coBrandingLogoUrl: resolvedCoBrandingLogoUrl,
                capabilities: {
                    canInspect: effectiveB2BRole !== 'VIEWER',
                    canManageFleet,
                    canViewVaults: true,
                    canViewMasterCatalog: isDevRoot || isSuperAdmin,
                    canCurateAI: canCurateEngineering,
                },
            };

            req.opermaqContext = resolvedCtx;
            req.moduleContext = {
                ...resolvedCtx,
                moduleId,
            };

            return next();
        } catch (error) {
            console.error('[MINREPORT-SESSION-SCOPE] Error resolviendo contexto funcional:', error);
            return res.status(401).json({ error: 'No autorizado: Fallo al verificar sesión MINREPORT.' });
        }
    };
}

export const resolveMinReportSessionScope = resolveModuleSessionScope('opermaq');
