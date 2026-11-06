import { Request, Response, NextFunction } from 'express';
import { auth, db } from '../config/firebase';
import { env } from '../config/env';

/**
 * MIDDLEWARE CENTRAL DEL HOST MINREPORT (Capa 3 — Gobierno Soberano)
 *
 * Resuelve la identidad verificada criptográficamente, el aislamiento multi-tenant
 * y las capacidades funcionales del usuario en el núcleo de MINREPORT e inyecta
 * únicamente un contexto funcional pasivo (`OpermaqFunctionalContext`) hacia los módulos integrados.
 */

export interface OpermaqFunctionalContext {
    tenantId: string;
    actorId: string;
    actorEmail: string;
    dataScope: 'PRODUCTION' | 'SANDBOX';
    capabilities: {
        canInspect: boolean;
        canManageFleet: boolean;
        canViewVaults: boolean;
        canCurateAI: boolean;
    };
}

export interface ScopedRequest extends Request {
    user?: any;
    opermaqContext?: OpermaqFunctionalContext;
}

export const resolveMinReportSessionScope = async (
    req: ScopedRequest,
    res: Response,
    next: NextFunction
) => {
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
        const decoded = await auth.verifyIdToken(token);
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
            (tokenRole === 'TEST_PILOT' ||
                tokenRole === 'PILOT_LEAD' ||
                serverUserRole === 'TEST_PILOT' ||
                serverUserRole === 'PILOT_LEAD');

        const hasFullSuiteOverride = isDevRoot || isSuperAdmin || isTestPilot;

        const isGlobalCatalogLookup =
            req.baseUrl.endsWith('/api/assets') &&
            ((req.method === 'POST' && req.path === '/resolve') ||
                (req.method === 'GET' && req.path.startsWith('/catalog')));

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

        if (resolvedTenantId && !hasFullSuiteOverride && !membership && accountData?.ownerId !== uid) {
            try {
                const memberSnap = await db
                    .collection('accounts')
                    .doc(resolvedTenantId)
                    .collection('members')
                    .doc(uid)
                    .get();
                if (memberSnap.exists) {
                    const memberData = memberSnap.data() || {};
                    const memberStatus = String(memberData.status || 'ACTIVE').toUpperCase();
                    if (
                        memberStatus !== 'SUSPENDED' &&
                        memberStatus !== 'REVOKED' &&
                        memberStatus !== 'INACTIVE' &&
                        memberStatus !== 'DELETED'
                    ) {
                        hasActiveMemberDoc = true;
                        memberDocRole = String(memberData.role || '').toUpperCase();
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
            (accountType === 'EDUCATIONAL' || accountClass === 'edu' || claimClass === 'edu');

        if (!hasFullSuiteOverride && accountData?.contract?.activeModules?.opermaq === false) {
            return res.status(403).json({
                error: 'El módulo OPERMAQ no está habilitado en la cuenta activa de MINREPORT.',
            });
        }

        const effectiveB2BRole =
            membershipRole ||
            memberDocRole ||
            (isAccountOwner ? 'OWNER' : '') ||
            (hasFullSuiteOverride ? claimRole : '') ||
            'OPERATOR';

        const canManageFleet =
            hasFullSuiteOverride ||
            effectiveB2BRole === 'OWNER' ||
            effectiveB2BRole === 'ADMIN' ||
            effectiveB2BRole === 'SUPERVISOR';

        req.opermaqContext = {
            tenantId: resolvedTenantId,
            actorId: uid,
            actorEmail: emailLower || 'operador@minreport.local',
            dataScope: isEduSandbox ? 'SANDBOX' : 'PRODUCTION',
            capabilities: {
                canInspect: true,
                canManageFleet,
                canViewVaults: true,
                canCurateAI: hasFullSuiteOverride,
            },
        };

        return next();
    } catch (error) {
        console.error('[MINREPORT-SESSION-SCOPE] Error resolviendo contexto funcional:', error);
        return res.status(401).json({ error: 'No autorizado: Fallo al verificar sesión MINREPORT.' });
    }
};
