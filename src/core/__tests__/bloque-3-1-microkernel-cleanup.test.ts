import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { auth, db } from '../../config/firebase';
import {
    CORE_MODULE_IDS,
    CORE_MODULE_REGISTRY,
    isCoreModuleId,
} from '../modules/module-registry';
import {
    resolveMinReportSessionScope,
    resolveModuleSessionScope,
    type ScopedRequest,
} from '../../middleware/sessionScope';
import {
    M2mAssetIdParamSchema,
    M2mOntologyTypeKeyParamSchema,
    registerM2mOpermaqAdapterRoutes,
} from '../../api/m2m-opermaq.adapter';
import {
    FleetUnitRegistrationBodySchema,
    FleetUnitRegistrationSchema,
    KnowledgeContributionStatusSchema,
    TenantPrivatePhotoSchema,
} from '../../contracts/opermaq.contracts';
import { evaluatePilotExpiration } from '../../contracts/session.contracts';

interface MockResState {
    statusCode: number;
    body: any;
}

function makeMockRes() {
    const state: MockResState = { statusCode: 200, body: undefined };
    const res: any = {
        status(code: number) {
            state.statusCode = code;
            return this;
        },
        json(payload: any) {
            state.body = payload;
            return this;
        },
    };
    return { res, state };
}

interface MockDbSeed {
    users?: Record<string, Record<string, any>>;
    accounts?: Record<string, Record<string, any>>;
    members?: Record<string, Record<string, Record<string, any>>>;
    modulesStatus?: Record<string, Record<string, any>>;
    testPilots?: Array<Record<string, any>>;
}

function makeMockFirestore(seed: MockDbSeed) {
    return (collectionName: string) => {
        if (collectionName === 'users') {
            return {
                doc(uid: string) {
                    return {
                        async get() {
                            const data = seed.users?.[uid];
                            return { exists: Boolean(data), data: () => data };
                        },
                    };
                },
            };
        }

        if (collectionName === 'accounts') {
            return {
                doc(tenantId: string) {
                    return {
                        async get() {
                            const data = seed.accounts?.[tenantId];
                            return { exists: Boolean(data), data: () => data };
                        },
                        collection(subName: string) {
                            if (subName === 'members') {
                                return {
                                    doc(uid: string) {
                                        return {
                                            async get() {
                                                const data = seed.members?.[tenantId]?.[uid];
                                                return { exists: Boolean(data), data: () => data };
                                            },
                                        };
                                    },
                                };
                            }
                            throw new Error(`Unexpected accounts subcollection: ${subName}`);
                        },
                    };
                },
            };
        }

        if (collectionName === 'modules_status') {
            return {
                doc(moduleId: string) {
                    return {
                        async get() {
                            const data = seed.modulesStatus?.[moduleId];
                            return { exists: Boolean(data), data: () => data };
                        },
                    };
                },
            };
        }

        if (collectionName === 'test_pilots') {
            return {
                where(field: string, _op: string, value: any) {
                    return {
                        async get() {
                            const matches = (seed.testPilots || []).filter((p) => p[field] === value);
                            return {
                                empty: matches.length === 0,
                                docs: matches.map((d) => ({ data: () => d })),
                            };
                        },
                    };
                },
            };
        }

        throw new Error(`Unexpected top-level collection queried in test: ${collectionName}`);
    };
}

async function withMockedFirebase(
    decodedToken: Record<string, any>,
    seed: MockDbSeed,
    fn: () => Promise<void>
) {
    const origVerifyIdToken = (auth as any).verifyIdToken;
    const origCollection = (db as any).collection;

    (auth as any).verifyIdToken = async (_token: string) => decodedToken;
    (db as any).collection = makeMockFirestore(seed);

    try {
        await fn();
    } finally {
        (auth as any).verifyIdToken = origVerifyIdToken;
        (db as any).collection = origCollection;
    }
}

async function invokeScopeMiddleware(
    middleware: ReturnType<typeof resolveModuleSessionScope>,
    headers: Record<string, string> = { authorization: 'Bearer test-token' }
) {
    const req = {
        headers,
        baseUrl: '/api/stockpile',
        path: '/status',
        method: 'GET',
    } as unknown as ScopedRequest;
    const { res, state } = makeMockRes();
    let nextCalled = false;

    await middleware(req, res, () => {
        nextCalled = true;
    });

    return { req, state, nextCalled };
}

async function run() {
    let passed = 0;
    let failed = 0;

    async function runCase(name: string, fn: () => Promise<void> | void) {
        try {
            await fn();
            console.log(`PASS: ${name}`);
            passed++;
        } catch (err: any) {
            console.error(`FAIL: ${name}`);
            console.error(err?.stack || err);
            failed++;
        }
    }

    // 1. Registro Canónico Backend
    await runCase('1. CORE_MODULE_REGISTRY e isCoreModuleId validan opermaq y stockpile', () => {
        assert.deepEqual(CORE_MODULE_IDS, ['opermaq', 'stockpile']);
        assert.equal(isCoreModuleId('opermaq'), true);
        assert.equal(isCoreModuleId('stockpile'), true);
        assert.equal(isCoreModuleId('mining-swarm'), false);
        assert.equal(isCoreModuleId(''), false);
        assert.equal(isCoreModuleId(null), false);
        assert.equal(isCoreModuleId(undefined), false);
        assert.equal(isCoreModuleId(42), false);

        assert.equal(CORE_MODULE_REGISTRY.opermaq.id, 'opermaq');
        assert.equal(CORE_MODULE_REGISTRY.opermaq.basePath, '/api/opermaq');
        assert.deepEqual(CORE_MODULE_REGISTRY.opermaq.domainModes, [
            'CATALOG',
            'FLEET',
            'SYMBOLOGY',
            'MANUFACTURERS',
            'SUPPLIERS',
        ]);
        assert.equal(CORE_MODULE_REGISTRY.opermaq.defaultEnabled, true);

        assert.equal(CORE_MODULE_REGISTRY.stockpile.id, 'stockpile');
        assert.equal(CORE_MODULE_REGISTRY.stockpile.basePath, '/api/stockpile');
        assert.deepEqual(CORE_MODULE_REGISTRY.stockpile.domainModes, [
            'STOCKPILE',
        ]);
        assert.equal(CORE_MODULE_REGISTRY.stockpile.defaultEnabled, true);
    });

    // 2. Middleware Genérico Multi-Módulo (sessionScope)
    await runCase('2a. resolveModuleSessionScope falla cerrado (HTTP 403) con moduleId no registrado', async () => {
        const mw = resolveModuleSessionScope('mining-swarm' as any);
        const { state, nextCalled } = await invokeScopeMiddleware(mw, {});
        assert.equal(nextCalled, false);
        assert.equal(state.statusCode, 403);
        assert.equal(state.body?.moduleDisabled, true);
        assert.equal(state.body?.moduleId, 'mining-swarm');
    });

    await runCase('2b. Kill-switch global en modules_status/stockpile (enabled: false) bloquea con 403 y permite opermaq', async () => {
        const tenantId = 'tenant-b2b-killswitch';
        const uid = 'user-b2b-1';
        await withMockedFirebase(
            { uid, email: 'op@minera.cl', email_verified: true, activeAccountId: tenantId },
            {
                users: {
                    [uid]: {
                        primaryAccountId: tenantId,
                        countryCode: 'CL',
                        memberships: [{ accountId: tenantId, role: 'OPERATOR', status: 'ACTIVE', assignedModules: ['opermaq', 'stockpile'] }],
                    },
                },
                accounts: {
                    [tenantId]: {
                        type: 'B2B',
                        status: 'ACTIVE',
                        countryCode: 'CL',
                        entitlements: { modules: { opermaq: true, stockpile: true } },
                    },
                },
                modulesStatus: {
                    stockpile: { enabled: false },
                    opermaq: { enabled: true },
                },
            },
            async () => {
                const blockedStockpile = await invokeScopeMiddleware(resolveModuleSessionScope('stockpile'));
                assert.equal(blockedStockpile.nextCalled, false);
                assert.equal(blockedStockpile.state.statusCode, 403);
                assert.equal(blockedStockpile.state.body?.moduleDisabled, true);
                assert.equal(blockedStockpile.state.body?.moduleId, 'stockpile');

                const allowedOpermaq = await invokeScopeMiddleware(resolveModuleSessionScope('opermaq'));
                assert.equal(allowedOpermaq.nextCalled, true);
                assert.equal(allowedOpermaq.req.moduleContext?.moduleId, 'opermaq');
                assert.equal(allowedOpermaq.req.opermaqContext?.tenantId, tenantId);
            }
        );
    });

    await runCase('2c. B2B con opermaq: true y stockpile: false bloquea stockpile con 403 (entitlements.modules y fallback legacy)', async () => {
        const uid = 'user-b2b-2';
        await withMockedFirebase(
            { uid, email: 'jefe@faena.cl', email_verified: true },
            {
                users: {
                    [uid]: {
                        primaryAccountId: 'tenant-entitlements',
                        memberships: [
                            { accountId: 'tenant-entitlements', role: 'ADMIN', status: 'ACTIVE' },
                            { accountId: 'tenant-legacy', role: 'ADMIN', status: 'ACTIVE' },
                        ],
                    },
                },
                accounts: {
                    'tenant-entitlements': {
                        type: 'B2B',
                        status: 'ACTIVE',
                        entitlements: { modules: { opermaq: true, stockpile: false } },
                    },
                    'tenant-legacy': {
                        type: 'B2B',
                        status: 'ACTIVE',
                        modules: { opermaq: true, stockpile: false },
                    },
                },
                modulesStatus: {
                    opermaq: { enabled: true },
                    stockpile: { enabled: true },
                },
            },
            async () => {
                const entBlocked = await invokeScopeMiddleware(resolveModuleSessionScope('stockpile'), {
                    authorization: 'Bearer t1',
                    'x-active-account-id': 'tenant-entitlements',
                });
                assert.equal(entBlocked.nextCalled, false);
                assert.equal(entBlocked.state.statusCode, 403);
                assert.equal(entBlocked.state.body?.moduleId, 'stockpile');

                const entAllowed = await invokeScopeMiddleware(resolveModuleSessionScope('opermaq'), {
                    authorization: 'Bearer t1',
                    'x-active-account-id': 'tenant-entitlements',
                });
                assert.equal(entAllowed.nextCalled, true);
                assert.equal(entAllowed.req.moduleContext?.moduleId, 'opermaq');

                const legacyBlocked = await invokeScopeMiddleware(resolveModuleSessionScope('stockpile'), {
                    authorization: 'Bearer t1',
                    'x-active-account-id': 'tenant-legacy',
                });
                assert.equal(legacyBlocked.nextCalled, false);
                assert.equal(legacyBlocked.state.statusCode, 403);
            }
        );
    });

    await runCase('2d. Miembro B2B valida assignedModules, inyecta moduleContext + alias opermaqContext + countryCode + coBrandingLogoUrl', async () => {
        const tenantId = 'tenant-b2b-full';
        const uidOnlyOpermaq = 'member-opermaq-only';
        const uidWithStockpile = 'member-both';
        const uidBilling = 'member-billing';

        const commonAccounts = {
            [tenantId]: {
                type: 'B2B',
                status: 'ACTIVE',
                countryCode: 'PE',
                coBrandingLogoUrl: 'https://cdn.minreport.local/faena-pe.png',
                entitlements: { modules: { opermaq: true, stockpile: true } },
            },
        };
        const commonModules = {
            opermaq: { enabled: true },
            stockpile: { enabled: true },
        };

        // Miembro con asiento solo en opermaq -> bloqueado en stockpile
        await withMockedFirebase(
            { uid: uidOnlyOpermaq, email: 'm1@faena.pe', email_verified: true, activeAccountId: tenantId },
            {
                users: { [uidOnlyOpermaq]: { primaryAccountId: tenantId } },
                accounts: commonAccounts,
                members: {
                    [tenantId]: {
                        [uidOnlyOpermaq]: { role: 'OPERATOR', status: 'ACTIVE', assignedModules: ['opermaq'] },
                    },
                },
                modulesStatus: commonModules,
            },
            async () => {
                const resStockpile = await invokeScopeMiddleware(resolveModuleSessionScope('stockpile'));
                assert.equal(resStockpile.nextCalled, false);
                assert.equal(resStockpile.state.statusCode, 403);
                assert.ok(String(resStockpile.state.body?.error).includes('MODULO_NO_AUTORIZADO_ASIENTO'));

                const resOpermaq = await invokeScopeMiddleware(resolveModuleSessionScope('opermaq'));
                assert.equal(resOpermaq.nextCalled, true);
            }
        );

        // Miembro con entitlement + assignedModules incluyendo 'stockpile' -> pasa e inyecta ambos contextos
        await withMockedFirebase(
            { uid: uidWithStockpile, email: 'm2@faena.pe', email_verified: true, activeAccountId: tenantId },
            {
                users: { [uidWithStockpile]: { primaryAccountId: tenantId } },
                accounts: commonAccounts,
                members: {
                    [tenantId]: {
                        [uidWithStockpile]: { role: 'ADMIN', status: 'ACTIVE', assignedModules: ['opermaq', 'stockpile'] },
                    },
                },
                modulesStatus: commonModules,
            },
            async () => {
                const resStockpile = await invokeScopeMiddleware(resolveModuleSessionScope('stockpile'));
                assert.equal(resStockpile.nextCalled, true);
                assert.equal(resStockpile.req.moduleContext?.moduleId, 'stockpile');
                assert.equal(resStockpile.req.moduleContext?.tenantId, tenantId);
                assert.equal(resStockpile.req.moduleContext?.accountTier, 4);
                assert.equal(resStockpile.req.moduleContext?.countryCode, 'PE');
                assert.equal(resStockpile.req.moduleContext?.coBrandingLogoUrl, 'https://cdn.minreport.local/faena-pe.png');
                assert.equal(resStockpile.req.moduleContext?.capabilities.canManageFleet, true);

                assert.ok(resStockpile.req.opermaqContext);
                assert.equal(resStockpile.req.opermaqContext?.tenantId, resStockpile.req.moduleContext?.tenantId);
                assert.equal(resStockpile.req.opermaqContext?.countryCode, 'PE');
                assert.equal(resStockpile.req.opermaqContext?.coBrandingLogoUrl, 'https://cdn.minreport.local/faena-pe.png');
            }
        );

        // SUBSCRIPTION_ADMIN / BILLING_ONLY bloqueados operacionalmente
        await withMockedFirebase(
            { uid: uidBilling, email: 'billing@faena.pe', email_verified: true, activeAccountId: tenantId },
            {
                users: { [uidBilling]: { primaryAccountId: tenantId } },
                accounts: commonAccounts,
                members: {
                    [tenantId]: {
                        [uidBilling]: { role: 'BILLING_ONLY', status: 'ACTIVE', assignedModules: ['opermaq', 'stockpile'] },
                    },
                },
                modulesStatus: commonModules,
            },
            async () => {
                const resBilling = await invokeScopeMiddleware(resolveModuleSessionScope('stockpile'));
                assert.equal(resBilling.nextCalled, false);
                assert.equal(resBilling.state.statusCode, 403);
            }
        );
    });

    await runCase('2e. EDU Sandbox, TEST_PILOT expirado/activo y alias resolveMinReportSessionScope', async () => {
        const eduTenant = 'edu-uni-1';
        const eduUid = 'student-1';

        await withMockedFirebase(
            { uid: eduUid, email: 'est@uni.cl', email_verified: true, activeAccountId: eduTenant, role: 'STUDENT' },
            {
                users: {
                    [eduUid]: {
                        primaryAccountId: eduTenant,
                        memberships: [{ accountId: eduTenant, role: 'STUDENT', status: 'ACTIVE', assignedModules: ['stockpile'] }],
                    },
                },
                accounts: {
                    [eduTenant]: {
                        type: 'EDUCATIONAL',
                        isEduSandbox: true,
                        status: 'ACTIVE',
                        entitlements: { modules: { opermaq: false, stockpile: true } },
                    },
                },
                modulesStatus: { stockpile: { enabled: true } },
            },
            async () => {
                const eduRes = await invokeScopeMiddleware(resolveModuleSessionScope('stockpile'));
                assert.equal(eduRes.nextCalled, true);
                assert.equal(eduRes.req.moduleContext?.accountTier, 5);
                assert.equal(eduRes.req.moduleContext?.isEduSandbox, true);
                assert.equal(eduRes.req.moduleContext?.dataScope, 'SANDBOX');
                assert.equal(eduRes.req.moduleContext?.moduleId, 'stockpile');
            }
        );

        // Normalización de expiración TEST_PILOT (ISO, string numérico, Date, Timestamp.toMillis)
        const nowRef = 1_700_000_000_000;
        assert.equal(evaluatePilotExpiration('2020-01-01T00:00:00.000Z', nowRef), true);
        assert.equal(evaluatePilotExpiration('2099-01-01T00:00:00.000Z', nowRef), false);
        assert.equal(evaluatePilotExpiration(String(nowRef - 1000), nowRef), true);
        assert.equal(evaluatePilotExpiration(String(nowRef + 1000), nowRef), false);
        assert.equal(evaluatePilotExpiration(new Date(nowRef - 1000), nowRef), true);
        assert.equal(evaluatePilotExpiration({ toMillis: () => nowRef - 500 }, nowRef), true);
        assert.equal(evaluatePilotExpiration({ toMillis: () => nowRef + 500 }, nowRef), false);
        assert.equal(evaluatePilotExpiration('', nowRef), false);
        assert.equal(evaluatePilotExpiration('0', nowRef), false);
        assert.equal(evaluatePilotExpiration(null, nowRef), false);
        assert.equal(evaluatePilotExpiration(undefined, nowRef), false);
        assert.equal(evaluatePilotExpiration(0, nowRef), false);
        assert.equal(evaluatePilotExpiration(NaN, nowRef), false);

        // TEST_PILOT expirado -> fail closed 403
        await withMockedFirebase(
            {
                uid: 'pilot-exp',
                email: 'pilot@ext.cl',
                email_verified: true,
                role: 'TEST_PILOT',
                pilotExpiresAt: '2020-01-01T00:00:00.000Z',
            },
            { users: { 'pilot-exp': { role: 'TEST_PILOT', status: 'ACTIVE' } } },
            async () => {
                const resExp = await invokeScopeMiddleware(resolveModuleSessionScope('stockpile'));
                assert.equal(resExp.nextCalled, false);
                assert.equal(resExp.state.statusCode, 403);
                assert.equal(resExp.state.body?.code, 'PILOT_ACCOUNT_EXPIRED');
            }
        );

        // TEST_PILOT activo + resolveMinReportSessionScope alias ('opermaq')
        const futureIso = new Date(Date.now() + 86_400_000).toISOString();
        await withMockedFirebase(
            {
                uid: 'pilot-ok',
                email: 'pilot-ok@ext.cl',
                email_verified: true,
                role: 'TEST_PILOT',
                pilotExpiresAt: futureIso,
            },
            {
                users: { 'pilot-ok': { role: 'TEST_PILOT', status: 'ACTIVE' } },
                testPilots: [{ userId: 'pilot-ok', status: 'ACTIVE', expiresAt: futureIso }],
            },
            async () => {
                const resAlias = await invokeScopeMiddleware(resolveMinReportSessionScope);
                assert.equal(resAlias.nextCalled, true);
                assert.equal(resAlias.req.moduleContext?.moduleId, 'opermaq');
                assert.equal(resAlias.req.moduleContext?.accountTier, 3);
                assert.equal(resAlias.req.moduleContext?.isTestPilot, true);
                assert.equal(resAlias.req.moduleContext?.capabilities.canCurateAI, false);
                assert.equal(resAlias.req.opermaqContext?.actorId, 'pilot-ok');
            }
        );
    });

    // 3. Adaptador M2M Desacoplado
    await runCase('3. M2mAssetIdParamSchema y registerM2mOpermaqAdapterRoutes registran y endurecen las 4 rutas M2M', async () => {
        assert.equal(M2mAssetIdParamSchema.safeParse({ assetId: 'cat-797f' }).success, true);
        assert.equal(M2mAssetIdParamSchema.safeParse({ assetId: '   ' }).success, false);
        assert.equal(M2mAssetIdParamSchema.safeParse({}).success, false);

        assert.equal(M2mOntologyTypeKeyParamSchema.safeParse({ typeKey: 'camion_extraccion' }).success, true);
        assert.equal(M2mOntologyTypeKeyParamSchema.safeParse({ typeKey: 'x' }).success, false);

        const registered: Array<{ path: string; handlers: Function[] }> = [];
        const fakeApp = {
            get(routePath: string, ...handlers: Function[]) {
                registered.push({ path: routePath, handlers });
            },
        } as any;

        registerM2mOpermaqAdapterRoutes(fakeApp);

        assert.deepEqual(
            registered.map((r) => r.path),
            [
                '/api/m2m/opermaq/vault-blueprint/:assetId',
                '/api/m2m/opermaq/vault/:assetId/specs',
                '/api/m2m/opermaq/vault/:assetId/cost-matrix',
                '/api/m2m/opermaq/ontology/:typeKey',
            ]
        );

        // Verificar que vault-blueprint/:assetId valida req.params con M2mAssetIdParamSchema -> HTTP 400
        const blueprintRoute = registered[0];
        assert.equal(blueprintRoute.handlers.length, 2);
        const routeHandler = blueprintRoute.handlers[1];
        const { res, state } = makeMockRes();
        await routeHandler({ params: { assetId: '   ' }, x402Context: { mode: 'VERIFIED' } }, res);
        assert.equal(state.statusCode, 400);
    });

    // 4. Paridad Zod en opermaq.contracts.ts
    await runCase('4. Paridad FleetUnitRegistrationBodySchema vs FleetUnitRegistrationSchema y nuevos contratos', () => {
        const basePayload = {
            make_oficial: 'Komatsu',
            model_oficial: '930E-5',
            identifier_value: 'KM-930E-001',
        };

        assert.equal(
            FleetUnitRegistrationBodySchema.safeParse({ ...basePayload, confirm_word: 'EDITAR' }).success,
            true
        );
        assert.equal(
            FleetUnitRegistrationSchema.safeParse({ ...basePayload, confirm_word: 'EDITAR' }).success,
            false
        );
        assert.equal(
            FleetUnitRegistrationSchema.safeParse({ ...basePayload, confirm_word: 'ACTUALIZAR' }).success,
            true
        );

        assert.equal(
            TenantPrivatePhotoSchema.safeParse({
                sha256: 'a'.repeat(64),
                url: 'https://storage.example/photo.webp',
                caption: 'Placa chasis',
                width: 1200,
                height: 800,
                uploadedAt: '2026-11-13T00:00:00.000Z',
                uploadedBy: 'uid-1',
            }).success,
            true
        );
        assert.equal(
            TenantPrivatePhotoSchema.safeParse({
                sha256: 'bad-hash',
                url: '',
                uploadedAt: '2026-11-13T00:00:00.000Z',
            }).success,
            false
        );

        assert.equal(KnowledgeContributionStatusSchema.safeParse('PENDING_HUMAN_REVIEW').success, true);
        assert.equal(KnowledgeContributionStatusSchema.safeParse('AUTO_DEDUPLICATED_NO_DELTA').success, true);
        assert.equal(KnowledgeContributionStatusSchema.safeParse('APPROVED').success, true);
        assert.equal(KnowledgeContributionStatusSchema.safeParse('REJECTED').success, true);
        assert.equal(KnowledgeContributionStatusSchema.safeParse('DRAFT').success, false);
    });

    // 5. Purga de código muerto, límites del kernel en index.ts y manifiestos raíz
    await runCase('5. Verificación estática de purga de archivos legacy, index.ts, auth.ts, user_directory.ts y manifiestos', () => {
        const rootDir = path.resolve(__dirname, '../../..');

        assert.equal(fs.existsSync(path.join(rootDir, 'src/api/auth.controller.ts')), false);
        assert.equal(fs.existsSync(path.join(rootDir, 'src/core/schemas.ts')), false);

        const indexSrc = fs.readFileSync(path.join(rootDir, 'src/index.ts'), 'utf8');
        assert.equal(indexSrc.includes('./api/auth.controller'), false);
        assert.equal(indexSrc.includes('/api/auth/register'), false);
        assert.equal(indexSrc.includes('/api/auth/invite'), false);
        assert.equal(indexSrc.includes('mining-swarm'), false);
        assert.equal(indexSrc.includes('registerM2mOpermaqAdapterRoutes(app)'), true);
        assert.equal(indexSrc.includes('registerM2mGeolappAdapterRoutes(app)'), true);

        const opermaqImportMatches = indexSrc.match(/modules\/opermaq[^\s'"]*/g) || [];
        for (const match of opermaqImportMatches) {
            assert.ok(
                match === 'modules/opermaq' ||
                    match === 'modules/opermaq/services/TaskQueueService' ||
                    match === 'modules/opermaq/services/SupplierChannelResolverService',
                `Import interno de opermaq no permitido en src/index.ts: ${match}`
            );
        }

        const authTypesSrc = fs.readFileSync(path.join(rootDir, 'src/types/auth.ts'), 'utf8');
        assert.equal(authTypesSrc.includes('miningFlow'), false);

        const userDirSrc = fs.readFileSync(path.join(rootDir, 'src/types/user_directory.ts'), 'utf8');
        assert.equal(userDirSrc.includes('status?: string'), true);
        assert.equal(userDirSrc.includes('jobProfileId?: string'), true);
        assert.equal(userDirSrc.includes('accountId?: string'), true);

        const tsconfigBase = JSON.parse(fs.readFileSync(path.join(rootDir, 'tsconfig.base.json'), 'utf8'));
        assert.equal('paths' in (tsconfigBase.compilerOptions || {}), false);

        const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
        assert.equal(rootPkg.dependencies?.zod, '^3.25.76');
        const allDeps = { ...(rootPkg.dependencies || {}), ...(rootPkg.devDependencies || {}) };
        for (const purged of ['@ai-sdk/google', 'ai', '@iso-safety-signs/assets', 'mammoth', 'xlsx']) {
            assert.equal(purged in allDeps, false, `Dependencia ${purged} debió ser eliminada`);
        }
        for (const preserved of ['mupdf', 'svgo', '@visioncortex/vtracer', '@google-cloud/tasks', '@iso-safety-signs/core']) {
            assert.equal(preserved in allDeps, true, `Dependencia ${preserved} debe mantenerse intacta`);
        }
    });

    console.log(`\nResumen Bloque 3.1: ${passed} passed, ${failed} failed.`);
    if (failed > 0) {
        process.exit(1);
    }
}

run().catch((err) => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
