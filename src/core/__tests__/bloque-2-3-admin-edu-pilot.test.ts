import assert from 'node:assert/strict';
import type { NextFunction, Response } from 'express';
import { auth, db } from '../../config/firebase';
import { AuditLedger } from '../audit-ledger';
import {
    AccountEntitlementsSchema,
    BasePackageTierSchema,
    CountryCodeSchema,
    EduInstitutionLogoSchema,
    EduInstitutionSchema,
    SystemRoleSchema,
    UpdateAccountEntitlementsPayloadSchema,
    UpsertEduInstitutionPayloadSchema,
    evaluatePilotExpiration,
    resolveEffectiveModuleAccess,
} from '../../contracts/session.contracts';
import {
    resolveMinReportSessionScope,
    type ScopedRequest,
} from '../../middleware/sessionScope';
import pilotRouter from '../../api/pilot.controller';
import {
    updateAccountEntitlements,
    updateTenantStatus,
} from '../../api/admin.controller';
import {
    createAdminEduInstitution,
    updateAdminEduInstitution,
} from '../../api/edu.controller';
import { EmailService } from '../../services/EmailService';

function createMockRes() {
    const res: any = {
        statusCode: 200,
        body: null,
        headers: {} as Record<string, string>,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: any) {
            this.body = payload;
            return this;
        },
        setHeader(k: string, v: string) {
            this.headers[k] = v;
        },
    };
    return res as Response & { statusCode: number; body: any };
}

function getPilotRouteHandler(method: 'get' | 'post' | 'patch', path: string) {
    const layer = (pilotRouter as any).stack.find(
        (l: any) => l?.route?.path === path && l?.route?.methods?.[method]
    );
    assert.ok(layer, `Debe existir ruta ${method.toUpperCase()} ${path} en pilotRouter`);
    const stack = layer.route.stack;
    return stack[stack.length - 1].handle as (req: any, res: any) => Promise<any>;
}

async function testContractsAndPureHelpers(): Promise<void> {
    assert.equal(SystemRoleSchema.safeParse('PILOT_LEAD').success, false, "'PILOT_LEAD' debe estar eliminado");
    assert.equal(SystemRoleSchema.safeParse('TEST_PILOT').success, true);

    assert.equal(CountryCodeSchema.parse('pe'), 'PE');
    assert.equal(BasePackageTierSchema.safeParse('FULL_SUITE').success, true);
    assert.equal(BasePackageTierSchema.safeParse('ACADEMIC_SANDBOX').success, true);

    const validLogo = {
        sha256: 'a'.repeat(64),
        downloadUrl: `/api/media/blob/symbology/${'a'.repeat(64)}.webp`,
        mimeType: 'image/webp',
        extension: 'webp',
        originalBytes: 120000,
        optimizedBytes: 14500,
        savingsPct: 87.9,
    };
    assert.equal(EduInstitutionLogoSchema.safeParse(validLogo).success, true);

    // Prohibido base64, data URI o CAS privado TENANT_PRIVATE
    assert.equal(
        EduInstitutionLogoSchema.safeParse({
            ...validLogo,
            downloadUrl: 'data:image/png;base64,iVBORw0KGgo=',
        }).success,
        false
    );
    assert.equal(
        EduInstitutionLogoSchema.safeParse({
            ...validLogo,
            downloadUrl: 'https://cdn.example.com/logo;base64,abc',
        }).success,
        false
    );
    assert.equal(
        EduInstitutionLogoSchema.safeParse({
            ...validLogo,
            downloadUrl: `/api/media/blob/tenant/acc-1/${'a'.repeat(64)}.webp`,
        }).success,
        false
    );

    const validUpsertEdu = UpsertEduInstitutionPayloadSchema.safeParse({
        name: 'Universidad Técnica Federico Santa María',
        countryCode: 'cl',
        domains: ['usm.cl', 'alumnos.usm.cl'],
        status: 'ACTIVE',
        defaultMaxProjects: 3,
        eduInstitutionLogo: validLogo,
        confirmationKeyword: 'ACTUALIZAR',
    });
    assert.equal(validUpsertEdu.success, true);

    assert.equal(
        UpsertEduInstitutionPayloadSchema.safeParse({
            name: 'USM',
            countryCode: 'CL',
            domains: ['usm.cl'],
            confirmationKeyword: 'CONFIRMAR',
        }).success,
        false,
        'Debe exigir confirmación exacta ACTUALIZAR'
    );

    assert.equal(
        EduInstitutionSchema.safeParse({
            id: 'inst-1',
            name: 'USM',
            domains: ['usm.cl'],
        }).success,
        true
    );

    assert.equal(
        AccountEntitlementsSchema.safeParse({
            basePackage: 'OPERMAQ_BASE',
            addonModules: { stockpile: { active: true, updatedAt: Date.now() } },
            maxProjects: 15,
        }).success,
        true
    );

    assert.equal(
        UpdateAccountEntitlementsPayloadSchema.safeParse({
            basePackage: 'CORE_BASE',
            addonModules: { opermaq: true, stockpile: false },
            maxProjects: 10,
            eduInstitutionId: null,
            confirmationKeyword: 'ACTUALIZAR',
        }).success,
        true
    );
    assert.equal(
        UpdateAccountEntitlementsPayloadSchema.safeParse({
            basePackage: 'CORE_BASE',
            addonModules: { opermaq: true, stockpile: false },
            maxProjects: 0,
            confirmationKeyword: 'ACTUALIZAR',
        }).success,
        false
    );
}

async function testResolveEffectiveModuleAccess(): Promise<void> {
    // 1. Paquete CORE_BASE sin add-ons -> false para ambos
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'opermaq',
            globalModuleActive: true,
            entitlements: {
                basePackage: 'CORE_BASE',
                addonModules: { opermaq: { active: false }, stockpile: { active: false } },
            },
            memberRole: 'OWNER',
        }),
        false
    );

    // 2. CORE_BASE + add-on OPERMAQ activo -> opermaq true, stockpile false
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'opermaq',
            globalModuleActive: true,
            entitlements: {
                basePackage: 'CORE_BASE',
                addonModules: { opermaq: { active: true }, stockpile: { active: false } },
            },
            memberRole: 'OWNER',
        }),
        true
    );
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'stockpile',
            globalModuleActive: true,
            entitlements: {
                basePackage: 'CORE_BASE',
                addonModules: { opermaq: { active: true }, stockpile: { active: false } },
            },
            memberRole: 'OWNER',
        }),
        false
    );

    // 3. OPERMAQ_BASE / ACADEMIC_SANDBOX / FULL_SUITE
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'opermaq',
            globalModuleActive: true,
            entitlements: { basePackage: 'ACADEMIC_SANDBOX', addonModules: {} },
            memberRole: 'STUDENT',
        }),
        true
    );
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'stockpile',
            globalModuleActive: true,
            entitlements: { basePackage: 'OPERMAQ_BASE', addonModules: {} },
            memberRole: 'OWNER',
        }),
        false
    );
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'stockpile',
            globalModuleActive: true,
            entitlements: { basePackage: 'FULL_SUITE', addonModules: {} },
            memberRole: 'OPERATOR',
        }),
        true
    );

    // 4. Kill-switch global vs FullSuiteOverride
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'opermaq',
            globalModuleActive: false,
            entitlements: { basePackage: 'FULL_SUITE', addonModules: {} },
            memberRole: 'OWNER',
        }),
        false
    );
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'opermaq',
            globalModuleActive: false,
            hasFullSuiteOverride: true,
            entitlements: { basePackage: 'CORE_BASE' },
        }),
        true
    );

    // 5. Fallback legacy
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'opermaq',
            globalModuleActive: true,
            entitlements: null,
            legacyContractActiveModules: { opermaq: true },
            memberRole: 'ADMIN',
        }),
        true
    );
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'stockpile',
            globalModuleActive: true,
            entitlements: null,
            legacyEnabledPlugins: ['Stockpile'],
            memberRole: 'OPERATOR',
        }),
        true
    );

    // 6. Roles de miembro y allowedModules
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'opermaq',
            globalModuleActive: true,
            entitlements: { basePackage: 'FULL_SUITE' },
            memberRole: 'SUBSCRIPTION_ADMIN',
        }),
        false
    );
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'opermaq',
            globalModuleActive: true,
            entitlements: { basePackage: 'FULL_SUITE' },
            memberRole: 'BILLING_ONLY',
        }),
        false
    );
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'opermaq',
            globalModuleActive: true,
            entitlements: { basePackage: 'FULL_SUITE' },
            memberRole: 'OPERATOR',
            memberAllowedModules: { opermaq: false },
        }),
        false
    );
    assert.equal(
        resolveEffectiveModuleAccess({
            moduleKey: 'opermaq',
            globalModuleActive: true,
            entitlements: { basePackage: 'FULL_SUITE' },
            memberRole: 'OWNER',
            memberAllowedModules: { opermaq: false },
        }),
        true
    );
}

async function testPilotExpirationAndAuthoritySeparation(): Promise<void> {
    const now = Date.now();
    assert.equal(evaluatePilotExpiration(now - 1000, now), true);
    assert.equal(evaluatePilotExpiration(now + 60000, now), false);
    assert.equal(evaluatePilotExpiration(null, now), false);
    assert.equal(evaluatePilotExpiration(undefined, now), false);
    assert.equal(evaluatePilotExpiration(0, now), false);
    assert.equal(evaluatePilotExpiration(NaN, now), false);

    const origVerifyIdToken = auth.verifyIdToken.bind(auth);
    const origCollection = db.collection.bind(db);
    const origAuditRecord = AuditLedger.record.bind(AuditLedger);

    const usersStore = new Map<string, Record<string, any>>([
        [
            'pilot-active-uid',
            {
                uid: 'pilot-active-uid',
                email: 'piloto1@minreport.com',
                role: 'TEST_PILOT',
                status: 'ACTIVE',
                pilotExpiresAt: now + 3600_000,
                primaryAccountId: 'pilot-acc-1',
            },
        ],
        [
            'pilot-expired-uid',
            {
                uid: 'pilot-expired-uid',
                email: 'piloto2@minreport.com',
                role: 'TEST_PILOT',
                status: 'ACTIVE',
                pilotExpiresAt: now - 5000,
                primaryAccountId: 'pilot-acc-2',
            },
        ],
        [
            'pilot-lead-legacy-uid',
            {
                uid: 'pilot-lead-legacy-uid',
                email: 'legacy@minreport.com',
                role: 'PILOT_LEAD',
                status: 'ACTIVE',
            },
        ],
    ]);

    const accountsStore = new Map<string, Record<string, any>>([
        [
            'acc-core-no-opermaq',
            {
                id: 'acc-core-no-opermaq',
                type: 'BUSINESS',
                status: 'ACTIVE',
                ownerId: 'b2b-owner-uid',
                entitlements: {
                    basePackage: 'CORE_BASE',
                    addonModules: { opermaq: { active: false }, stockpile: { active: false } },
                },
            },
        ],
        [
            'acc-full-suite-killswitch',
            {
                id: 'acc-full-suite-killswitch',
                type: 'BUSINESS',
                status: 'ACTIVE',
                ownerId: 'b2b-owner-uid',
                entitlements: {
                    basePackage: 'FULL_SUITE',
                    addonModules: { opermaq: { active: true }, stockpile: { active: true } },
                },
            },
        ],
    ]);
    const modulesStatusStore = new Map<string, Record<string, any>>();

    const feedbackStore = new Map<string, Record<string, any>>([
        [
            'fb-own',
            {
                id: 'fb-own',
                authorUid: 'pilot-active-uid',
                module: 'opermaq',
                status: 'OPEN',
                observation: 'Propia',
                createdAt: 200,
                tenantId: 'pilot-acc-1',
            },
        ],
        [
            'fb-other',
            {
                id: 'fb-other',
                authorUid: 'other-pilot-uid',
                module: 'opermaq',
                status: 'OPEN',
                observation: 'Ajena',
                createdAt: 300,
                tenantId: 'pilot-acc-x',
            },
        ],
    ]);

    (AuditLedger as any).record = async () => ({} as any);
    (db as any).collection = (name: string) => {
        if (name === 'users') {
            return {
                doc: (uid: string) => ({
                    async get() {
                        const data = usersStore.get(uid);
                        return { exists: Boolean(data), id: uid, data: () => data };
                    },
                }),
            };
        }
        if (name === 'accounts') {
            return {
                doc: (accId: string) => ({
                    async get() {
                        const data = accountsStore.get(accId);
                        return { exists: Boolean(data), id: accId, data: () => data };
                    },
                    collection: () => ({
                        doc: () => ({ async get() { return { exists: false, data: () => undefined }; } }),
                    }),
                }),
            };
        }
        if (name === 'modules_status') {
            return {
                doc: (modId: string) => ({
                    async get() {
                        const data = modulesStatusStore.get(modId);
                        return { exists: Boolean(data), id: modId, data: () => data };
                    },
                }),
            };
        }
        if (name === 'test_pilots') {
            return {
                where: () => ({
                    async get() {
                        return { empty: true, docs: [] };
                    },
                }),
            };
        }
        if (name === 'pilot_feedback') {
            return {
                orderBy: () => ({
                    limit: () => ({
                        async get() {
                            return {
                                docs: Array.from(feedbackStore.entries()).map(([id, data]) => ({
                                    id,
                                    data: () => data,
                                })),
                            };
                        },
                    }),
                }),
                where: (field: string, _op: string, value: any) => ({
                    limit: () => ({
                        async get() {
                            const matched = Array.from(feedbackStore.entries())
                                .filter(([, d]) => d[field] === value)
                                .map(([id, data]) => ({ id, data: () => data }));
                            return { docs: matched };
                        },
                    }),
                }),
                doc: (id?: string) => {
                    const docId = id || `fb-${Date.now()}`;
                    return {
                        id: docId,
                        async get() {
                            const data = feedbackStore.get(docId);
                            return { exists: Boolean(data), id: docId, data: () => data };
                        },
                        async set(payload: Record<string, any>) {
                            feedbackStore.set(docId, payload);
                        },
                        async update(patch: Record<string, any>) {
                            const prev = feedbackStore.get(docId) || {};
                            feedbackStore.set(docId, { ...prev, ...patch });
                        },
                    };
                },
            };
        }
        return origCollection(name);
    };

    try {
        // 1. Expirado -> 403 PILOT_ACCOUNT_EXPIRED en sessionScope
        (auth as any).verifyIdToken = async () => ({
            uid: 'pilot-expired-uid',
            email: 'piloto2@minreport.com',
            email_verified: true,
            role: 'TEST_PILOT',
            pilotExpiresAt: now - 5000,
        });
        const expiredReq = {
            headers: { authorization: 'Bearer tok' },
            baseUrl: '/api/opermaq',
            path: '/fleet',
            method: 'GET',
        } as unknown as ScopedRequest;
        const expiredRes = createMockRes();
        let nextCalled = false;
        await resolveMinReportSessionScope(expiredReq, expiredRes, (() => { nextCalled = true; }) as NextFunction);
        assert.equal(nextCalled, false);
        assert.equal(expiredRes.statusCode, 403);
        assert.equal(expiredRes.body?.code, 'PILOT_ACCOUNT_EXPIRED');

        // 2. TEST-PILOT activo en sessionScope -> canCurateAI: false (solo 1º DEV cura IA)
        (auth as any).verifyIdToken = async () => ({
            uid: 'pilot-active-uid',
            email: 'piloto1@minreport.com',
            email_verified: true,
            role: 'TEST_PILOT',
            pilotExpiresAt: now + 3600_000,
        });
        const activePilotReq = {
            headers: { authorization: 'Bearer tok' },
            baseUrl: '/api/opermaq',
            path: '/fleet',
            method: 'GET',
        } as unknown as ScopedRequest;
        const activePilotRes = createMockRes();
        nextCalled = false;
        await resolveMinReportSessionScope(activePilotReq, activePilotRes, (() => { nextCalled = true; }) as NextFunction);
        assert.equal(nextCalled, true);
        assert.equal(activePilotReq.opermaqContext?.accountTier, 3);
        assert.equal(activePilotReq.opermaqContext?.isTestPilot, true);
        assert.equal(activePilotReq.opermaqContext?.capabilities.canCurateAI, false, 'TEST-PILOT no debe tener canCurateAI');
        assert.equal(activePilotReq.opermaqContext?.capabilities.canViewMasterCatalog, false, 'TEST-PILOT no debe tener canViewMasterCatalog');

        // 3. DEV_ROOT en sessionScope -> accountTier: 1, canCurateAI: true
        (auth as any).verifyIdToken = async () => ({
            uid: 'dev-master-root-uid',
            email: 'dev@minreport.com',
            email_verified: true,
            role: 'DEV_ROOT',
            isMasterDev: true,
        });
        const devReq = {
            headers: { authorization: 'Bearer tok' },
            baseUrl: '/api/opermaq',
            path: '/vaults',
            method: 'GET',
        } as unknown as ScopedRequest;
        const devRes = createMockRes();
        nextCalled = false;
        await resolveMinReportSessionScope(devReq, devRes, (() => { nextCalled = true; }) as NextFunction);
        assert.equal(nextCalled, true);
        assert.equal(devReq.opermaqContext?.accountTier, 1);
        assert.equal(devReq.opermaqContext?.capabilities.canCurateAI, true);

        // 4. Legacy PILOT_LEAD rechazado sin membresía B2B
        (auth as any).verifyIdToken = async () => ({
            uid: 'pilot-lead-legacy-uid',
            email: 'legacy@minreport.com',
            email_verified: true,
            role: 'PILOT_LEAD',
        });
        const legacyPilotReq = {
            headers: { authorization: 'Bearer tok' },
            baseUrl: '/api/opermaq',
            path: '/fleet',
            method: 'GET',
        } as unknown as ScopedRequest;
        const legacyPilotRes = createMockRes();
        nextCalled = false;
        await resolveMinReportSessionScope(legacyPilotReq, legacyPilotRes, (() => { nextCalled = true; }) as NextFunction);
        assert.equal(nextCalled, false);
        assert.equal(legacyPilotRes.statusCode, 403);

        // 5. B2B OWNER con CORE_BASE sin add-on opermaq -> bloqueado en sessionScope
        (auth as any).verifyIdToken = async () => ({
            uid: 'b2b-owner-uid',
            email: 'owner@minera.cl',
            email_verified: true,
            role: 'OWNER',
            activeAccountId: 'acc-core-no-opermaq',
        });
        const b2bReq = {
            headers: { authorization: 'Bearer tok', 'x-active-account-id': 'acc-core-no-opermaq' },
            baseUrl: '/api/opermaq',
            path: '/fleet',
            method: 'GET',
        } as unknown as ScopedRequest;
        const b2bRes = createMockRes();
        nextCalled = false;
        await resolveMinReportSessionScope(b2bReq, b2bRes, (() => { nextCalled = true; }) as NextFunction);
        assert.equal(nextCalled, false);
        assert.equal(b2bRes.statusCode, 403);

        // 5b. Kill-Switch global modules_status/opermaq { id: 'opermaq', enabled: false } bloquea cuenta FULL_SUITE
        (auth as any).verifyIdToken = async () => ({
            uid: 'b2b-owner-uid',
            email: 'owner@minera.cl',
            email_verified: true,
            role: 'OWNER',
            activeAccountId: 'acc-full-suite-killswitch',
        });
        modulesStatusStore.set('opermaq', { id: 'opermaq', enabled: false });
        const killSwitchReq = {
            headers: { authorization: 'Bearer tok', 'x-active-account-id': 'acc-full-suite-killswitch' },
            baseUrl: '/api/opermaq',
            path: '/fleet',
            method: 'GET',
        } as unknown as ScopedRequest;
        const killSwitchRes = createMockRes();
        nextCalled = false;
        await resolveMinReportSessionScope(killSwitchReq, killSwitchRes, (() => { nextCalled = true; }) as NextFunction);
        assert.equal(nextCalled, false);
        assert.equal(killSwitchRes.statusCode, 403, 'Kill-switch global enabled:false debe bloquear en sessionScope');
        modulesStatusStore.clear();

        // 6. pilotRouter GET /feedback aislamiento + expirado + SUPER_ADMIN bloqueado en PATCH
        const getFeedback = getPilotRouteHandler('get', '/feedback');
        const postFeedback = getPilotRouteHandler('post', '/feedback');
        const patchFeedbackStatus = getPilotRouteHandler('patch', '/feedback/:id/status');

        const pilotGetRes = createMockRes();
        await getFeedback(
            {
                user: { uid: 'pilot-active-uid', email: 'piloto1@minreport.com', role: 'TEST_PILOT', pilotExpiresAt: now + 3600_000 },
                query: {},
                headers: {},
            },
            pilotGetRes
        );
        assert.equal(pilotGetRes.statusCode, 200);
        assert.equal(pilotGetRes.body?.items?.length, 1);
        assert.equal(pilotGetRes.body?.items?.[0]?.id, 'fb-own');

        const expiredPostRes = createMockRes();
        await postFeedback(
            {
                user: { uid: 'pilot-expired-uid', email: 'piloto2@minreport.com', role: 'TEST_PILOT', pilotExpiresAt: now - 5000 },
                body: { observation: 'Intento post expiración' },
                headers: {},
            },
            expiredPostRes
        );
        assert.equal(expiredPostRes.statusCode, 403);
        assert.equal(expiredPostRes.body?.code, 'PILOT_ACCOUNT_EXPIRED');

        const adminPatchRes = createMockRes();
        await patchFeedbackStatus(
            {
                params: { id: 'fb-own' },
                user: { uid: 'super-admin-uid', email: 'admin@minreport.com', role: 'SUPER_ADMIN', admin: true },
                body: { status: 'APPLIED_TO_AI', confirmationKeyword: 'ACTUALIZAR' },
                headers: {},
            },
            adminPatchRes
        );
        assert.equal(adminPatchRes.statusCode, 403, '2º ADMIN no puede curar feedback piloto');

        const devPatchBlockedRes = createMockRes();
        await patchFeedbackStatus(
            {
                params: { id: 'fb-own' },
                user: { uid: 'dev-master-root-uid', email: 'dev@minreport.com', role: 'DEV_ROOT', isMasterDev: true },
                body: { status: 'APPLIED_TO_AI', confirmationKeyword: 'ACTUALIZAR' },
                headers: {},
            },
            devPatchBlockedRes
        );
        assert.equal(devPatchBlockedRes.statusCode, 403, 'Aislamiento hermético: 1º DEV no debe operar en /api/pilot/*');
    } finally {
        (auth as any).verifyIdToken = origVerifyIdToken;
        (db as any).collection = origCollection;
        (AuditLedger as any).record = origAuditRecord;
    }
}

async function testAdminEntitlementsAndEduControllers(): Promise<void> {
    const origCollection = db.collection.bind(db);
    const origAuditRecord = AuditLedger.record.bind(AuditLedger);
    const origSendEmail = EmailService.sendEmail.bind(EmailService);
    const origGetUser = auth.getUser.bind(auth);
    const origSetCustomUserClaims = auth.setCustomUserClaims.bind(auth);

    const eduInstStore = new Map<string, Record<string, any>>();
    const accountsStore = new Map<string, Record<string, any>>([
        [
            'acc-edu-1',
            {
                id: 'acc-edu-1',
                name: 'Universidad de Chile',
                type: 'EDUCATIONAL',
                classification: 'edu',
                isEduSandbox: true,
                countryCode: 'CL',
                academicRole: 'PROFESSOR',
                ownerId: 'edu-owner-uid',
                hasInitialPassword: true,
                status: 'PENDING_APPROVAL',
                entitlements: {
                    basePackage: 'ACADEMIC_SANDBOX',
                    addonModules: { opermaq: { active: true }, stockpile: { active: false } },
                    maxProjects: 3,
                },
                mandatario: { email: 'docente@uchile.cl', jobTitle: 'PROFESSOR' },
            },
        ],
    ]);
    const tenantsStore = new Map<string, Record<string, any>>([
        [
            'acc-edu-1',
            {
                id: 'acc-edu-1',
                type: 'EDUCATIONAL',
                classification: 'edu',
                isEduSandbox: true,
                countryCode: 'CL',
                academicRole: 'PROFESSOR',
                ownerId: 'edu-owner-uid',
                hasInitialPassword: true,
                institution_name: 'Universidad de Chile',
                email: 'docente@uchile.cl',
                status: 'PENDING_APPROVAL',
            },
        ],
    ]);
    const usersStore = new Map<string, Record<string, any>>([
        [
            'edu-owner-uid',
            {
                uid: 'edu-owner-uid',
                email: 'docente@uchile.cl',
                role: 'PROFESSOR',
                status: 'PENDING_APPROVAL',
                memberships: [{ accountId: 'acc-edu-1', role: 'PROFESSOR', status: 'PENDING_APPROVAL' }],
            },
        ],
    ]);
    const setupTokensStore = new Map<string, Record<string, any>>();

    (AuditLedger as any).record = async () => ({} as any);
    (EmailService as any).sendEmail = async () => {};
    (auth as any).getUser = async (uid: string) => ({
        uid,
        email: 'docente@uchile.cl',
        disabled: false,
        customClaims: {},
    });
    (auth as any).setCustomUserClaims = async () => {};

    const applyPatch = (base: Record<string, any>, patch: Record<string, any>) => {
        const next = { ...base };
        for (const [k, v] of Object.entries(patch)) {
            if (k.includes('.')) {
                const [p, c] = k.split('.');
                next[p] = { ...(next[p] || {}), [c]: v };
            } else {
                next[k] = v;
            }
        }
        return next;
    };

    (db as any).collection = (name: string) => {
        if (name === 'edu_institutions') {
            return {
                doc: (id?: string) => {
                    const docId = id || 'inst-uchile';
                    return {
                        id: docId,
                        async get() {
                            const d = eduInstStore.get(docId);
                            return { exists: Boolean(d), id: docId, data: () => d };
                        },
                        async set(payload: Record<string, any>, opts?: { merge?: boolean }) {
                            const prev = opts?.merge ? (eduInstStore.get(docId) || {}) : {};
                            eduInstStore.set(docId, { ...prev, ...payload });
                        },
                    };
                },
            };
        }
        if (name === 'accounts') {
            return {
                where: (field: string, _op: string, value: any) => ({
                    async get() {
                        const docs = Array.from(accountsStore.entries())
                            .filter(([, d]) => d[field] === value)
                            .map(([id, d]) => ({
                                id,
                                data: () => d,
                                ref: {
                                    async update(patch: Record<string, any>) {
                                        accountsStore.set(id, applyPatch(accountsStore.get(id) || {}, patch));
                                    },
                                },
                            }));
                        return { size: docs.length, docs };
                    },
                }),
                doc: (id: string) => ({
                    async get() {
                        const d = accountsStore.get(id);
                        return { exists: Boolean(d), id, data: () => d };
                    },
                    async update(patch: Record<string, any>) {
                        accountsStore.set(id, applyPatch(accountsStore.get(id) || {}, patch));
                    },
                    collection: (sub: string) => {
                        if (sub === 'members') {
                            return {
                                doc: () => ({
                                    async get() { return { exists: false, data: () => undefined }; },
                                    async set() {},
                                    async update() {},
                                }),
                            };
                        }
                        return origCollection(name).doc(id).collection(sub);
                    },
                }),
            };
        }
        if (name === 'tenants') {
            return {
                where: (field: string, _op: string, value: any) => ({
                    async get() {
                        const docs = Array.from(tenantsStore.entries())
                            .filter(([, d]) => d[field] === value)
                            .map(([id, d]) => ({
                                id,
                                data: () => d,
                                ref: {
                                    async update(patch: Record<string, any>) {
                                        tenantsStore.set(id, applyPatch(tenantsStore.get(id) || {}, patch));
                                    },
                                },
                            }));
                        return { size: docs.length, docs };
                    },
                }),
                doc: (id: string) => ({
                    async get() {
                        const d = tenantsStore.get(id);
                        return { exists: Boolean(d), id, data: () => d };
                    },
                    async set(payload: Record<string, any>, opts?: { merge?: boolean }) {
                        const prev = opts?.merge ? (tenantsStore.get(id) || {}) : {};
                        tenantsStore.set(id, { ...prev, ...payload });
                    },
                    async update(patch: Record<string, any>) {
                        tenantsStore.set(id, applyPatch(tenantsStore.get(id) || {}, patch));
                    },
                }),
            };
        }
        if (name === 'users') {
            return {
                doc: (uid: string) => ({
                    async get() {
                        const d = usersStore.get(uid);
                        return {
                            exists: Boolean(d),
                            id: uid,
                            data: () => d,
                            ref: {
                                async update(patch: Record<string, any>) {
                                    usersStore.set(uid, applyPatch(usersStore.get(uid) || {}, patch));
                                },
                            },
                        };
                    },
                    async update(patch: Record<string, any>) {
                        usersStore.set(uid, applyPatch(usersStore.get(uid) || {}, patch));
                    },
                }),
            };
        }
        if (name === 'user_auth_credentials') {
            return {
                doc: () => ({ async get() { return { exists: false, data: () => undefined }; } }),
            };
        }
        if (name === 'setup_tokens') {
            return {
                doc: (tok: string) => ({
                    async set(payload: Record<string, any>) {
                        setupTokensStore.set(tok, payload);
                    },
                }),
            };
        }
        return origCollection(name);
    };

    try {
        // 1. Crear institución EDU con dominio @uchile.cl normalizado + logo CAS
        const logo1 = {
            sha256: 'b'.repeat(64),
            downloadUrl: `/api/media/blob/symbology/${'b'.repeat(64)}.webp`,
            mimeType: 'image/webp',
            extension: 'webp',
            originalBytes: 50000,
            optimizedBytes: 8000,
            savingsPct: 84,
        };
        const createInstRes = createMockRes();
        await createAdminEduInstitution(
            {
                user: { uid: 'super-admin-uid', email: 'admin@minreport.com', role: 'SUPER_ADMIN', admin: true },
                body: {
                    name: 'Universidad de Chile',
                    countryCode: 'cl',
                    domains: ['@UChile.cl', 'ing.uchile.cl'],
                    status: 'ACTIVE',
                    defaultMaxProjects: 5,
                    eduInstitutionLogo: logo1,
                    confirmationWord: 'ACTUALIZAR',
                },
                headers: {},
            } as any,
            createInstRes
        );
        assert.equal(createInstRes.statusCode, 201);
        assert.deepEqual(createInstRes.body?.institution?.domains, ['uchile.cl', 'ing.uchile.cl']);

        // 2. Actualizar entitlements vinculando institución EDU + propagar nuevo logo
        const entRes = createMockRes();
        await updateAccountEntitlements(
            {
                params: { accountId: 'acc-edu-1' },
                body: {
                    basePackage: 'ACADEMIC_SANDBOX',
                    addonModules: { opermaq: true, stockpile: false },
                    eduInstitutionId: 'inst-uchile',
                    confirmationKeyword: 'ACTUALIZAR',
                },
                user: { uid: 'super-admin-uid', email: 'admin@minreport.com' },
                headers: {},
            } as any,
            entRes
        );
        assert.equal(entRes.statusCode, 200);
        assert.equal(accountsStore.get('acc-edu-1')?.eduInstitutionLogo?.sha256, logo1.sha256);
        assert.equal(accountsStore.get('acc-edu-1')?.entitlements?.maxProjects, 5);

        const logo2 = {
            sha256: 'c'.repeat(64),
            downloadUrl: `/api/media/blob/symbology/${'c'.repeat(64)}.webp`,
            mimeType: 'image/webp',
            extension: 'webp',
            originalBytes: 60000,
            optimizedBytes: 9000,
            savingsPct: 85,
        };
        const patchInstRes = createMockRes();
        await updateAdminEduInstitution(
            {
                params: { id: 'inst-uchile' },
                user: { uid: 'super-admin-uid', email: 'admin@minreport.com', role: 'SUPER_ADMIN', admin: true },
                body: {
                    name: 'Universidad de Chile FCFM',
                    countryCode: 'CL',
                    domains: ['uchile.cl'],
                    status: 'ACTIVE',
                    defaultMaxProjects: 5,
                    eduInstitutionLogo: logo2,
                    confirmationKeyword: 'ACTUALIZAR',
                },
                headers: {},
            } as any,
            patchInstRes
        );
        assert.equal(patchInstRes.statusCode, 200);
        assert.equal(accountsStore.get('acc-edu-1')?.eduInstitutionName, 'Universidad de Chile FCFM');
        assert.equal(accountsStore.get('acc-edu-1')?.eduInstitutionLogo?.sha256, logo2.sha256);

        // 3. Aprobar EDU sin RUT y con hasInitialPassword: true -> no setup_tokens, conserva PROFESSOR
        const approveEduRes = createMockRes();
        await updateTenantStatus(
            {
                params: { uid: 'acc-edu-1' },
                body: { status: 'ACTIVE', confirmationWord: 'ACTUALIZAR' },
                user: { uid: 'super-admin-uid', email: 'admin@minreport.com' },
                headers: {},
            } as any,
            approveEduRes
        );
        assert.equal(approveEduRes.statusCode, 200);
        assert.equal(tenantsStore.get('acc-edu-1')?.status, 'ACTIVE');
        assert.equal(usersStore.get('edu-owner-uid')?.role, 'PROFESSOR');
        assert.equal(setupTokensStore.size, 0, 'No debe emitir setup_tokens cuando ya hay contraseña inicial en /access');
    } finally {
        (db as any).collection = origCollection;
        (AuditLedger as any).record = origAuditRecord;
        (EmailService as any).sendEmail = origSendEmail;
        (auth as any).getUser = origGetUser;
        (auth as any).setCustomUserClaims = origSetCustomUserClaims;
    }
}

async function run(): Promise<void> {
    await testContractsAndPureHelpers();
    await testResolveEffectiveModuleAccess();
    await testPilotExpirationAndAuthoritySeparation();
    await testAdminEntitlementsAndEduControllers();
    console.log('✅ bloque-2-3-admin-edu-pilot.test.ts: TODAS LAS PRUEBAS PASARON.');
}

run()
    .then(() => {
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ Falla en bloque-2-3-admin-edu-pilot.test.ts:', err);
        process.exit(1);
    });
