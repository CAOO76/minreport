import assert from 'node:assert/strict';
import type { NextFunction, Response } from 'express';
import { auth, db } from '../../config/firebase';
import { AuditLedger } from '../audit-ledger';
import {
    B2BMemberAllowedModulesSchema,
    B2BSeatRoleSchema,
    CreateEquipmentOnboardingRequestSchema,
    EquipmentOnboardingResourceKindSchema,
    EquipmentOnboardingResourceSchema,
    PublishEquipmentOnboardingSchema,
    RemoveB2BMemberPayloadSchema,
    ReviewEquipmentOnboardingSchema,
    UpdateB2BMemberPayloadSchema,
    UpsertB2BMemberPayloadSchema,
} from '../../contracts/session.contracts';
import staffRouter, {
    canActorMutateTargetSeat,
    normalizeSeatPermissionsForRole,
} from '../../api/staff.controller';
import equipmentOnboardingRouter, {
    buildCanonicalCatalogKey,
    resolvePublicCatalogPhotoUrl,
    validateEquipmentResourcesCasTelemetry,
} from '../../api/equipment-onboarding.controller';
import {
    resolveMinReportSessionScope,
    type ScopedRequest,
} from '../../middleware/sessionScope';

interface MockHttpCapture {
    statusCode: number;
    jsonBody: any;
    nextCalled: boolean;
    res: Response;
}

function createMockResponse(): MockHttpCapture {
    const capture: MockHttpCapture = {
        statusCode: 200,
        jsonBody: null,
        nextCalled: false,
        res: null as unknown as Response,
    };
    const resObj: any = {
        status(code: number) {
            capture.statusCode = code;
            return resObj;
        },
        json(payload: any) {
            capture.jsonBody = payload;
            return resObj;
        },
        setHeader() {
            return resObj;
        },
        end() {
            return resObj;
        },
    };
    capture.res = resObj as Response;
    return capture;
}

function testContractsAndZodSchemas(): void {
    // 1. B2BSeatRoleSchema y B2BMemberAllowedModulesSchema
    for (const r of ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']) {
        assert.equal(B2BSeatRoleSchema.safeParse(r).success, true);
    }
    assert.equal(B2BSeatRoleSchema.safeParse('BILLING_ONLY').success, false);
    assert.equal(B2BSeatRoleSchema.safeParse('SUPERVISOR').success, false);

    const defaultModules = B2BMemberAllowedModulesSchema.parse({});
    assert.deepEqual(defaultModules, { opermaq: true, stockpile: false });

    // 2. UpsertB2BMemberPayloadSchema
    const upsertValid = UpsertB2BMemberPayloadSchema.parse({
        accountId: 'acc-b2b-01',
        accountName: 'Minera Atacama SpA',
        email: '  operador@atacama.cl ',
        displayName: 'Carlos Vega',
        taxId: '',
        countryCode: 'pe',
    });
    assert.equal(upsertValid.email, 'operador@atacama.cl');
    assert.equal(upsertValid.countryCode, 'PE');
    assert.equal(upsertValid.role, 'OPERATOR');
    assert.equal(upsertValid.canViewBilling, false);
    assert.deepEqual(upsertValid.allowedModules, { opermaq: true, stockpile: false });

    assert.equal(
        UpsertB2BMemberPayloadSchema.safeParse({
            accountId: 'acc-b2b-01',
            accountName: 'Minera Atacama SpA',
            email: 'owner2@atacama.cl',
            displayName: 'Otro Titular',
            role: 'OWNER',
        }).success,
        false,
        'No debe permitir asignar rol OWNER en alta de integrante'
    );

    // 3. UpdateB2BMemberPayloadSchema & RemoveB2BMemberPayloadSchema
    assert.equal(
        UpdateB2BMemberPayloadSchema.safeParse({
            accountId: 'acc-b2b-01',
            confirmationKeyword: 'EDITAR',
            role: 'ADMIN',
        }).success,
        false,
        'UpdateB2BMemberPayloadSchema debe exigir literal ACTUALIZAR'
    );
    assert.equal(
        UpdateB2BMemberPayloadSchema.safeParse({
            accountId: 'acc-b2b-01',
            confirmationKeyword: 'ACTUALIZAR',
            role: 'VIEWER',
            canViewBilling: true,
            allowedModules: { opermaq: false, stockpile: true },
            status: 'SUSPENDED',
        }).success,
        true
    );
    assert.equal(
        RemoveB2BMemberPayloadSchema.safeParse({
            accountId: 'acc-b2b-01',
            confirmationKeyword: 'ACTUALIZAR',
        }).success,
        true
    );
    assert.equal(
        RemoveB2BMemberPayloadSchema.safeParse({
            accountId: 'acc-b2b-01',
            confirmationKeyword: 'actualizar',
        }).success,
        false
    );

    // 4. EquipmentOnboarding schemas
    for (const k of [
        'UNIT_PHOTO',
        'NAMEPLATE_PHOTO',
        'TECHNICAL_MANUAL_PDF',
        'DATASHEET_PDF',
        'DIAGRAM_IMAGE',
    ]) {
        assert.equal(EquipmentOnboardingResourceKindSchema.safeParse(k).success, true);
    }

    const validSha = 'a'.repeat(64);
    const validResource = EquipmentOnboardingResourceSchema.parse({
        sha256: validSha,
        kind: 'UNIT_PHOTO',
        mimeType: 'image/webp',
        extension: 'webp',
        originalFilename: 'camion-797f.jpg',
        downloadUrl: `/api/media/blob/tenant/acc-b2b-01/${validSha}.webp`,
        originalBytes: 4_000_000,
        optimizedBytes: 320_000,
        savingsPct: 92,
    });
    assert.equal(validResource.sha256, validSha);

    assert.equal(
        EquipmentOnboardingResourceSchema.safeParse({
            ...validResource,
            sha256: 'short',
        }).success,
        false
    );

    const createReq = CreateEquipmentOnboardingRequestSchema.parse({
        accountId: 'acc-b2b-01',
        manufacturerRef: 'Caterpillar',
        modelRef: '797F',
        equipmentCategory: 'CAMION EXTRACCION',
        resources: [validResource],
    });
    assert.equal(createReq.unitIdentifierType, 'CODIGO_INTERNO');
    assert.equal(createReq.ownershipType, 'PROPIO');
    assert.equal(createReq.horometer, 0);

    assert.equal(
        CreateEquipmentOnboardingRequestSchema.safeParse({
            accountId: 'acc-b2b-01',
            manufacturerRef: 'Caterpillar',
            modelRef: '797F',
            equipmentCategory: 'CAMION EXTRACCION',
            resources: [],
        }).success,
        false,
        'Debe exigir al menos 1 recurso CAS'
    );

    const publishReq = PublishEquipmentOnboardingSchema.parse({
        confirmationKeyword: 'ACTUALIZAR',
        makeOficial: 'CATERPILLAR',
        modelOficial: '797F',
        tipoEquipo: 'Camión de Extracción Minera Ultra-Class',
        categoriaEquipo: 'ACARREO MINERO',
        ambienteOperativo: ['Rajo Abierto'],
        contextoOperativo: ['Alta Cordillera'],
        caracteristicasPrincipales: ['Capacidad nominal 363 t'],
    });
    assert.equal(publishReq.version, 'ESTÁNDAR');
    assert.equal(publishReq.autoRegisterFleetUnit, true);

    assert.equal(
        ReviewEquipmentOnboardingSchema.safeParse({
            confirmationKeyword: 'ACTUALIZAR',
            status: 'NEEDS_INFO',
            reviewNotes: 'Adjuntar placa legible del fabricante.',
        }).success,
        true
    );
    assert.equal(
        ReviewEquipmentOnboardingSchema.safeParse({
            confirmationKeyword: 'ACTUALIZAR',
            status: 'PUBLISHED',
            reviewNotes: 'No permitido en /review',
        }).success,
        false
    );
}

function testStaffPureHelpersAndRoutes(): void {
    // normalizeSeatPermissionsForRole
    assert.deepEqual(
        normalizeSeatPermissionsForRole('OWNER', { opermaq: false, stockpile: false }, false),
        {
            allowedModules: { opermaq: true, stockpile: true },
            canViewBilling: true,
        },
        'OWNER siempre fuerza todos los módulos y facturación habilitada'
    );

    assert.deepEqual(
        normalizeSeatPermissionsForRole('ADMIN', { opermaq: false, stockpile: false }, false),
        {
            allowedModules: { opermaq: true, stockpile: true },
            canViewBilling: true,
        },
        'ADMIN siempre fuerza todos los módulos y facturación habilitada'
    );

    assert.deepEqual(
        normalizeSeatPermissionsForRole('OPERATOR', { opermaq: true, stockpile: true }, true),
        {
            allowedModules: { opermaq: true, stockpile: true },
            canViewBilling: false,
        },
        'OPERATOR siempre fuerza canViewBilling=false aunque venga true'
    );

    assert.deepEqual(
        normalizeSeatPermissionsForRole('VIEWER', { opermaq: false, stockpile: true }, true),
        {
            allowedModules: { opermaq: false, stockpile: true },
            canViewBilling: true,
        },
        'VIEWER respeta canViewBilling y allowedModules'
    );

    assert.deepEqual(normalizeSeatPermissionsForRole('VIEWER'), {
        allowedModules: { opermaq: true, stockpile: false },
        canViewBilling: false,
    });

    // canActorMutateTargetSeat
    assert.equal(canActorMutateTargetSeat('DEV_ROOT', true, 'ADMIN'), false);
    assert.equal(canActorMutateTargetSeat('OWNER', false, 'OWNER'), false);
    assert.equal(canActorMutateTargetSeat('ADMIN', false, 'OWNER'), false);
    assert.equal(canActorMutateTargetSeat('SUPER_ADMIN', false, 'ADMIN'), true);
    assert.equal(canActorMutateTargetSeat('OWNER', false, 'ADMIN'), true);
    assert.equal(canActorMutateTargetSeat('ADMIN', false, 'OPERATOR'), true);
    assert.equal(canActorMutateTargetSeat('ADMIN', false, 'VIEWER'), true);
    assert.equal(canActorMutateTargetSeat('OPERATOR', false, 'VIEWER'), false);
    assert.equal(canActorMutateTargetSeat('VIEWER', false, 'OPERATOR'), false);
    assert.equal(canActorMutateTargetSeat('ADMIN', false, 'DEV_ROOT'), false);

    // Verificar eliminación completa de /designate-admin y existencia de rutas canonicas
    const staffStackPaths = staffRouter.stack
        .filter((layer: any) => Boolean(layer.route))
        .map((layer: any) => ({
            path: layer.route.path,
            methods: Object.keys(layer.route.methods || {}),
        }));
    assert.equal(
        staffStackPaths.some((r: any) => r.path === '/designate-admin'),
        false,
        'POST /designate-admin debe estar eliminado por completo'
    );
    assert.equal(
        staffStackPaths.some((r: any) => r.path === '/members' && r.methods.includes('get')),
        true
    );
    assert.equal(
        staffStackPaths.some((r: any) => r.path === '/members' && r.methods.includes('post')),
        true
    );
    assert.equal(
        staffStackPaths.some((r: any) => r.path === '/create-worker' && r.methods.includes('post')),
        true
    );
    assert.equal(
        staffStackPaths.some((r: any) => r.path === '/members/:memberUid' && r.methods.includes('patch')),
        true
    );
    assert.equal(
        staffStackPaths.some((r: any) => r.path === '/members/:memberUid' && r.methods.includes('delete')),
        true
    );
}

function testEquipmentOnboardingPureHelpersAndRoutes(): void {
    // buildCanonicalCatalogKey
    assert.equal(buildCanonicalCatalogKey('Caterpillar', '320D L'), 'CATERPILLAR_320D_L');
    assert.equal(buildCanonicalCatalogKey('  Komátsu ', 'PC200-8'), 'KOMATSU_PC200_8');
    assert.equal(buildCanonicalCatalogKey('Citroën', 'Berlingo'), 'CITROEN_BERLINGO');
    assert.equal(buildCanonicalCatalogKey('', ''), 'GENERICO_EQUIPO');

    // validateEquipmentResourcesCasTelemetry
    const sha1 = '1'.repeat(64);
    const sha2 = '2'.repeat(64);
    const validCas = validateEquipmentResourcesCasTelemetry([
        {
            sha256: sha1,
            downloadUrl: `/api/media/blob/tenant/acc-1/${sha1}.webp`,
            originalBytes: 2_000_000,
            optimizedBytes: 200_000,
        },
        {
            sha256: sha2,
            downloadUrl: `/api/media/blob/tenant/acc-1/${sha2}.pdf`,
            originalBytes: 8_000_000,
            optimizedBytes: 1_800_000,
        },
    ]);
    assert.equal(validCas.valid, true);
    assert.equal(validCas.totalOriginalBytes, 10_000_000);
    assert.equal(validCas.totalOptimizedBytes, 2_000_000);
    assert.equal(validCas.totalSavingsPct, 80);

    const rejectDataUrl = validateEquipmentResourcesCasTelemetry([
        {
            sha256: sha1,
            downloadUrl: 'data:image/png;base64,iVBORw0KGgo=',
            originalBytes: 1000,
            optimizedBytes: 500,
        },
    ]);
    assert.equal(rejectDataUrl.valid, false);

    const rejectBase64Snippet = validateEquipmentResourcesCasTelemetry([
        {
            sha256: sha1,
            downloadUrl: 'https://example.com/file;base64,AAAA',
            originalBytes: 1000,
            optimizedBytes: 500,
        },
    ]);
    assert.equal(rejectBase64Snippet.valid, false);

    const rejectBadSha = validateEquipmentResourcesCasTelemetry([
        {
            sha256: 'abc123',
            downloadUrl: `/api/media/blob/tenant/acc-1/${sha1}.webp`,
            originalBytes: 1000,
            optimizedBytes: 500,
        },
    ]);
    assert.equal(rejectBadSha.valid, false);

    const rejectZeroBytes = validateEquipmentResourcesCasTelemetry([
        {
            sha256: sha1,
            downloadUrl: `/api/media/blob/tenant/acc-1/${sha1}.webp`,
            originalBytes: 1000,
            optimizedBytes: 0,
        },
    ]);
    assert.equal(rejectZeroBytes.valid, false);

    // 3b. Verificación de aislamiento multi-tenant para global_asset_catalog.foto_url
    assert.equal(
        resolvePublicCatalogPhotoUrl([
            {
                kind: 'UNIT_PHOTO',
                mimeType: 'image/webp',
                downloadUrl: `/api/media/blob/tenant/faena-a/${sha1}.webp`,
            },
        ]),
        '',
    );
    assert.equal(
        resolvePublicCatalogPhotoUrl([
            {
                kind: 'NAMEPLATE_PHOTO',
                mimeType: 'image/webp',
                downloadUrl: `/api/media/blob/global_oem/${sha1}.webp`,
            },
        ]),
        '',
    );
    assert.equal(
        resolvePublicCatalogPhotoUrl([
            {
                kind: 'UNIT_PHOTO',
                mimeType: 'image/webp',
                downloadUrl: `/api/media/blob/tenant/faena-a/${sha1}.webp`,
            },
            {
                kind: 'NAMEPLATE_PHOTO',
                mimeType: 'image/webp',
                downloadUrl: `/api/media/blob/global_oem/${sha1}.webp`,
            },
            {
                kind: 'DIAGRAM_IMAGE',
                mimeType: 'image/svg+xml',
                downloadUrl: `/api/media/blob/symbology/${sha1}.svg`,
            },
        ]),
        `/api/media/blob/symbology/${sha1}.svg`,
    );
    assert.equal(
        resolvePublicCatalogPhotoUrl([
            {
                kind: 'UNIT_PHOTO',
                mimeType: 'image/webp',
                downloadUrl: `/api/media/blob/global_oem/${sha1}.webp`,
            },
        ]),
        `/api/media/blob/global_oem/${sha1}.webp`,
    );

    // Verificar rutas montadas en equipmentOnboardingRouter
    const onboardPaths = equipmentOnboardingRouter.stack
        .filter((layer: any) => Boolean(layer.route))
        .map((layer: any) => ({
            path: layer.route.path,
            methods: Object.keys(layer.route.methods || {}),
        }));
    assert.equal(onboardPaths.some((r: any) => r.path === '/' && r.methods.includes('get')), true);
    assert.equal(onboardPaths.some((r: any) => r.path === '/' && r.methods.includes('post')), true);
    assert.equal(onboardPaths.some((r: any) => r.path === '/:requestId/publish' && r.methods.includes('post')), true);
    assert.equal(onboardPaths.some((r: any) => r.path === '/:requestId/review' && r.methods.includes('post')), true);
}

async function testSessionScopeAllowedModulesAndViewerCapabilities(): Promise<void> {
    const origVerifyIdToken = auth.verifyIdToken.bind(auth);
    const origCollection = db.collection.bind(db);

    const accountsStore = new Map<string, Record<string, any>>([
        [
            'acc-b2b-test',
            {
                id: 'acc-b2b-test',
                name: 'Minera Norte',
                type: 'BUSINESS',
                classification: 'b2b',
                status: 'ACTIVE',
                ownerId: 'owner-uid-1',
            },
        ],
    ]);

    const usersStore = new Map<string, Record<string, any>>();
    const membersStore = new Map<string, Record<string, any>>();

    (db as any).collection = (name: string) => {
        if (name === 'accounts') {
            return {
                doc: (accId: string) => ({
                    async get() {
                        const data = accountsStore.get(accId);
                        return { exists: Boolean(data), id: accId, data: () => data };
                    },
                    collection: (sub: string) => {
                        if (sub === 'members') {
                            return {
                                doc: (memberUid: string) => ({
                                    async get() {
                                        const data = membersStore.get(`${accId}:${memberUid}`);
                                        return { exists: Boolean(data), id: memberUid, data: () => data };
                                    },
                                }),
                            };
                        }
                        return origCollection(name).doc(accId).collection(sub);
                    },
                }),
            };
        }
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
        return origCollection(name);
    };

    try {
        // Caso 1: OPERATOR con allowedModules.opermaq === false en membership -> 403
        usersStore.set('op-blocked', {
            uid: 'op-blocked',
            email: 'op.blocked@minera.cl',
            memberships: [
                {
                    accountId: 'acc-b2b-test',
                    role: 'OPERATOR',
                    status: 'ACTIVE',
                    allowedModules: { opermaq: false, stockpile: true },
                },
            ],
        });
        (auth as any).verifyIdToken = async () => ({
            uid: 'op-blocked',
            email: 'op.blocked@minera.cl',
            email_verified: true,
        });

        const cap1 = createMockResponse();
        const req1 = {
            headers: {
                authorization: 'Bearer token-op-blocked',
                'x-active-account-id': 'acc-b2b-test',
            },
            baseUrl: '/api/assets',
            path: '/fleet',
            method: 'GET',
        } as unknown as ScopedRequest;
        await resolveMinReportSessionScope(req1, cap1.res, (() => {
            cap1.nextCalled = true;
        }) as NextFunction);
        assert.equal(cap1.nextCalled, false);
        assert.equal(cap1.statusCode, 403);
        assert.equal(
            cap1.jsonBody?.error,
            'MODULO_NO_AUTORIZADO_ASIENTO: El usuario no tiene acceso asignado al módulo OPERMAQ.'
        );

        // Caso 2: VIEWER sin allowedModules en membership pero con allowedModules.opermaq === false en memberData -> 403
        usersStore.set('viewer-blocked', {
            uid: 'viewer-blocked',
            email: 'viewer.blocked@minera.cl',
            memberships: [
                {
                    accountId: 'acc-b2b-test',
                    role: 'VIEWER',
                    status: 'ACTIVE',
                },
            ],
        });
        membersStore.set('acc-b2b-test:viewer-blocked', {
            uid: 'viewer-blocked',
            role: 'VIEWER',
            status: 'ACTIVE',
            allowedModules: { opermaq: false, stockpile: true },
        });
        (auth as any).verifyIdToken = async () => ({
            uid: 'viewer-blocked',
            email: 'viewer.blocked@minera.cl',
            email_verified: true,
        });

        const cap2 = createMockResponse();
        const req2 = {
            headers: {
                authorization: 'Bearer token-viewer-blocked',
                'x-active-account-id': 'acc-b2b-test',
            },
            baseUrl: '/api/assets',
            path: '/fleet',
            method: 'GET',
        } as unknown as ScopedRequest;
        await resolveMinReportSessionScope(req2, cap2.res, (() => {
            cap2.nextCalled = true;
        }) as NextFunction);
        assert.equal(cap2.nextCalled, false);
        assert.equal(cap2.statusCode, 403);

        // Caso 3: VIEWER con opermaq=true -> next(), canInspect=false, canManageFleet=false
        usersStore.set('viewer-ok', {
            uid: 'viewer-ok',
            email: 'viewer.ok@minera.cl',
            memberships: [
                {
                    accountId: 'acc-b2b-test',
                    role: 'VIEWER',
                    status: 'ACTIVE',
                    allowedModules: { opermaq: true, stockpile: false },
                },
            ],
        });
        (auth as any).verifyIdToken = async () => ({
            uid: 'viewer-ok',
            email: 'viewer.ok@minera.cl',
            email_verified: true,
        });

        const cap3 = createMockResponse();
        const req3 = {
            headers: {
                authorization: 'Bearer token-viewer-ok',
                'x-active-account-id': 'acc-b2b-test',
            },
            baseUrl: '/api/assets',
            path: '/fleet',
            method: 'GET',
        } as unknown as ScopedRequest;
        await resolveMinReportSessionScope(req3, cap3.res, (() => {
            cap3.nextCalled = true;
        }) as NextFunction);
        assert.equal(cap3.nextCalled, true);
        assert.equal(req3.opermaqContext?.capabilities.canInspect, false, 'VIEWER no debe tener canInspect=true');
        assert.equal(req3.opermaqContext?.capabilities.canManageFleet, false);

        // Caso 4: OPERATOR con opermaq=true -> next(), canInspect=true, canManageFleet=false
        usersStore.set('op-ok', {
            uid: 'op-ok',
            email: 'op.ok@minera.cl',
            memberships: [
                {
                    accountId: 'acc-b2b-test',
                    role: 'OPERATOR',
                    status: 'ACTIVE',
                    allowedModules: { opermaq: true, stockpile: false },
                },
            ],
        });
        (auth as any).verifyIdToken = async () => ({
            uid: 'op-ok',
            email: 'op.ok@minera.cl',
            email_verified: true,
        });

        const cap4 = createMockResponse();
        const req4 = {
            headers: {
                authorization: 'Bearer token-op-ok',
                'x-active-account-id': 'acc-b2b-test',
            },
            baseUrl: '/api/assets',
            path: '/fleet',
            method: 'GET',
        } as unknown as ScopedRequest;
        await resolveMinReportSessionScope(req4, cap4.res, (() => {
            cap4.nextCalled = true;
        }) as NextFunction);
        assert.equal(cap4.nextCalled, true);
        assert.equal(req4.opermaqContext?.capabilities.canInspect, true);
        assert.equal(req4.opermaqContext?.capabilities.canManageFleet, false);

        // Caso 5: ADMIN siempre tiene acceso aunque allowedModules en doc viniera en false
        usersStore.set('admin-ok', {
            uid: 'admin-ok',
            email: 'admin.ok@minera.cl',
            memberships: [
                {
                    accountId: 'acc-b2b-test',
                    role: 'ADMIN',
                    status: 'ACTIVE',
                    allowedModules: { opermaq: false, stockpile: false },
                },
            ],
        });
        (auth as any).verifyIdToken = async () => ({
            uid: 'admin-ok',
            email: 'admin.ok@minera.cl',
            email_verified: true,
        });

        const cap5 = createMockResponse();
        const req5 = {
            headers: {
                authorization: 'Bearer token-admin-ok',
                'x-active-account-id': 'acc-b2b-test',
            },
            baseUrl: '/api/assets',
            path: '/fleet',
            method: 'GET',
        } as unknown as ScopedRequest;
        await resolveMinReportSessionScope(req5, cap5.res, (() => {
            cap5.nextCalled = true;
        }) as NextFunction);
        assert.equal(cap5.nextCalled, true);
        assert.equal(req5.opermaqContext?.capabilities.canInspect, true);
        assert.equal(req5.opermaqContext?.capabilities.canManageFleet, true);
    } finally {
        (auth as any).verifyIdToken = origVerifyIdToken;
        (db as any).collection = origCollection;
    }
}

async function runTests(): Promise<void> {
    // Evitar escritura accidental si algún helper futuro invocara AuditLedger en tests unitarios
    const origAuditRecord = AuditLedger.record;
    try {
        testContractsAndZodSchemas();
        testStaffPureHelpersAndRoutes();
        testEquipmentOnboardingPureHelpersAndRoutes();
        await testSessionScopeAllowedModulesAndViewerCapabilities();
        console.log(
            '[OK] Bloque 2.2: todas las aserciones de contratos B2B, permisos por asiento, onboarding CAS y sessionScope pasaron.'
        );
    } finally {
        AuditLedger.record = origAuditRecord;
    }
}

void runTests()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[FAIL] Bloque 2.2:', err);
        process.exit(1);
    });
