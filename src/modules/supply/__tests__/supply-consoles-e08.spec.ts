/**
 * Suite E08 Consolas 2º ADMIN, 4º B2B, Auto-Enrolamiento OWNER, DEV/Access & SessionContext
 *
 * Verifica determinísticamente (sin red externa, Node v20.19.5):
 * 1. `POST /api/staff/members` y `PATCH /api/staff/members/:uid` preservan `allowedModules.supply: true`
 *    en `OPERATOR` y `VIEWER` (cero revocación silenciosa!) y fuerzan Doble Opt-In Ley N° 21.719
 *    (`whatsappOptInStatus: 'PENDING_DOUBLE_OPT_IN'`, `whatsappOptInAt: null`) en alta/cambio por tercero.
 * 2. `PATCH /api/staff/me/supply-channel` permite auto-enrolamiento del propio `OWNER` con `ACTUALIZAR`
 *    (`200`, `whatsappOptInAt` poblado, `whatsappOptInStatus: 'ACTIVE'`, `AuditLedger` `SUPPLY_MEMBER_SELF_ENROLLMENT`),
 *    rechaza sin `ACTUALIZAR` (`400`), rechaza E.164 inválido (`400`) y bloquea escalación de privilegios (`403`).
 * 3. `dev.controller.ts` (`createTestPilot`) aprovisiona sandboxes `pilot-*` con `supply: true` en
 *    `contract.activeModules`, `entitlements`, `enabledPlugins` y `members.allowedModules`.
 * 4. Auditoría estática de paridad HMI y soberanía MINREPORT en `SuperAdminConsole.tsx`, `EquipoPage.tsx`,
 *    `MinReportSessionContext.tsx`, `DevVaultGateway.tsx` y `access.controller.ts` (0 emojis, 0 marcas prohibidas, 0 `AdminSwitch`).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Duplex } from 'node:stream';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.MOCK_EMAILS = 'true';
process.env.MOCK_WHATSAPP = 'true';
process.env.MINREPORT_RELEASE_STAGE = 'FULL';
process.env.GCP_PROJECT_ID = 'minreport-supply-e08-test';
process.env.FIREBASE_PROJECT_ID = 'minreport-supply-e08-test';
process.env.FIREBASE_STORAGE_BUCKET = 'minreport-supply-e08-test.firebasestorage.app';

// ---------------------------------------------------------------------------
// 1. Stubs deterministas en memoria para Firebase Admin (Firestore + Auth)
// ---------------------------------------------------------------------------

const dbCollections = new Map<string, Map<string, Record<string, any>>>();
const authUsersByEmail = new Map<string, { uid: string; email: string; displayName: string }>();
const customClaimsByUid = new Map<string, Record<string, any>>();
let nextAuthUidSeq = 1;

function getCollectionMap(colPath: string): Map<string, Record<string, any>> {
    let col = dbCollections.get(colPath);
    if (!col) {
        col = new Map();
        dbCollections.set(colPath, col);
    }
    return col;
}

function createDocRef(colPath: string, docId: string): any {
    const ref: any = {
        id: docId,
        path: `${colPath}/${docId}`,
        collection(subName: string) {
            return createCollectionRef(`${colPath}/${docId}/${subName}`);
        },
        async get() {
            const data = getCollectionMap(colPath).get(docId);
            return {
                id: docId,
                ref,
                exists: Boolean(data),
                data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
            };
        },
        async set(payload: Record<string, any>, options?: { merge?: boolean }) {
            const col = getCollectionMap(colPath);
            const prev = options?.merge && col.has(docId) ? col.get(docId)! : {};
            col.set(docId, { ...prev, ...JSON.parse(JSON.stringify(payload)) });
        },
        async update(patch: Record<string, any>) {
            const col = getCollectionMap(colPath);
            const prev = col.get(docId) || {};
            col.set(docId, { ...prev, ...JSON.parse(JSON.stringify(patch)) });
        },
        async delete() {
            getCollectionMap(colPath).delete(docId);
        },
    };
    return ref;
}

function createCollectionRef(colPath: string): any {
    let autoSeq = 1;
    return {
        doc(docId?: string) {
            const id = docId || `auto_${colPath.replace(/\//g, '_')}_${Date.now()}_${autoSeq++}`;
            return createDocRef(colPath, id);
        },
        count() {
            return {
                async get() {
                    return { data: () => ({ count: getCollectionMap(colPath).size }) };
                },
            };
        },
        where(field: string, op: string, value: unknown) {
            return {
                async get() {
                    const docs: any[] = [];
                    for (const [id, data] of getCollectionMap(colPath).entries()) {
                        if (op === '==' ? data[field] === value : true) {
                            docs.push({
                                id,
                                ref: createDocRef(colPath, id),
                                exists: true,
                                data: () => JSON.parse(JSON.stringify(data)),
                            });
                        }
                    }
                    return { empty: docs.length === 0, size: docs.length, docs };
                },
            };
        },
        async get() {
            const docs: any[] = [];
            for (const [id, data] of getCollectionMap(colPath).entries()) {
                docs.push({
                    id,
                    ref: createDocRef(colPath, id),
                    exists: true,
                    data: () => JSON.parse(JSON.stringify(data)),
                });
            }
            return { empty: docs.length === 0, size: docs.length, docs };
        },
    };
}

const mockDb: any = {
    collection(colPath: string) {
        return createCollectionRef(colPath);
    },
    batch() {
        const ops: Array<() => Promise<void>> = [];
        return {
            set(ref: any, data: any, opts?: any) {
                ops.push(() => ref.set(data, opts));
            },
            update(ref: any, patch: any) {
                ops.push(() => ref.update(patch));
            },
            delete(ref: any) {
                ops.push(() => ref.delete());
            },
            async commit() {
                for (const op of ops) {
                    await op();
                }
            },
        };
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        const ops: Array<() => Promise<void>> = [];
        const tx = {
            get: async (ref: any) => ref.get(),
            set: (ref: any, data: any, opts?: any) => {
                ops.push(() => ref.set(data, opts));
            },
            update: (ref: any, patch: any) => {
                ops.push(() => ref.update(patch));
            },
            delete: (ref: any) => {
                ops.push(() => ref.delete());
            },
        };
        const result = await fn(tx);
        for (const op of ops) {
            await op();
        }
        return result;
    },
};

const mockTokens = new Map<string, Record<string, any>>();

const mockAuth: any = {
    async verifyIdToken(token: string) {
        const decoded = mockTokens.get(token);
        if (!decoded) {
            const err: any = new Error('Invalid token');
            err.code = 'auth/invalid-id-token';
            throw err;
        }
        return decoded;
    },
    async getUserByEmail(email: string) {
        const found = authUsersByEmail.get(email.toLowerCase());
        if (!found) {
            const err: any = new Error('User not found');
            err.code = 'auth/user-not-found';
            throw err;
        }
        return found;
    },
    async createUser(params: { email: string; displayName?: string }) {
        const uid = `uid_created_${nextAuthUidSeq++}`;
        const rec = {
            uid,
            email: params.email.toLowerCase(),
            displayName: params.displayName || 'User',
        };
        authUsersByEmail.set(rec.email, rec);
        return rec;
    },
    async setCustomUserClaims(uid: string, claims: Record<string, any>) {
        customClaimsByUid.set(uid, claims);
    },
};

const firebaseModulePath = require.resolve('../../../config/firebase');
require.cache[firebaseModulePath] = {
    id: firebaseModulePath,
    filename: firebaseModulePath,
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            firestore: {
                FieldValue: {
                    serverTimestamp: () => new Date().toISOString(),
                },
                Timestamp: {
                    fromMillis: (ms: number) => ({
                        toMillis: () => ms,
                        toDate: () => new Date(ms),
                        _seconds: Math.floor(ms / 1000),
                    }),
                },
            },
        },
        db: mockDb,
        auth: mockAuth,
        storage: { bucket: () => ({ name: 'mock-bucket' }) },
    },
} as any;

// ---------------------------------------------------------------------------
// 2. Imports del SUT
// ---------------------------------------------------------------------------

import staffRouter from '../../../api/staff.controller';
import { createTestPilotAccount } from '../../../api/dev.controller';

// ---------------------------------------------------------------------------
// 3. Dispatcher HTTP in-process (sin puertos TCP)
// ---------------------------------------------------------------------------

class MemorySocket extends Duplex {
    public remoteAddress = '127.0.0.1';
    public destroyed = false;
    public writable = true;
    public readable = true;
    _read(): void {}
    _write(_chunk: any, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
        cb();
    }
    setTimeout(): this {
        return this;
    }
    setNoDelay(): this {
        return this;
    }
    setKeepAlive(): this {
        return this;
    }
    cork(): void {}
    uncork(): void {}
}

function createInProcessDispatcher(app: express.Express) {
    return async function dispatch(
        urlPath: string,
        init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
    ): Promise<{ status: number; json: any; text: string }> {
        const socket = new MemorySocket();
        const req = new http.IncomingMessage(socket as any);
        req.method = (init.method || 'GET').toUpperCase();
        req.url = urlPath;
        req.headers = {};
        for (const [k, v] of Object.entries(init.headers || {})) {
            req.headers[k.toLowerCase()] = v;
        }
        const rawBody =
            init.body !== undefined
                ? typeof init.body === 'string'
                    ? init.body
                    : JSON.stringify(init.body)
                : '';
        const bodyBuf = Buffer.from(rawBody, 'utf8');
        if (bodyBuf.length > 0 && !req.headers['content-length']) {
            req.headers['content-length'] = String(bodyBuf.length);
        }
        if (bodyBuf.length > 0 && !req.headers['content-type']) {
            req.headers['content-type'] = 'application/json';
        }

        const res = new http.ServerResponse(req);
        res.assignSocket(socket as any);
        const chunks: Buffer[] = [];
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);

        return new Promise((resolve, reject) => {
            res.write = ((chunk: any, ...rest: any[]) => {
                if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
                return origWrite(chunk, ...rest);
            }) as any;
            res.end = ((chunk?: any, ...rest: any[]) => {
                if (chunk && typeof chunk !== 'function') {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
                }
                const r = origEnd(chunk, ...rest);
                const text = Buffer.concat(chunks).toString('utf8');
                let json: any = null;
                try {
                    json = text ? JSON.parse(text) : null;
                } catch {
                    json = null;
                }
                resolve({ status: res.statusCode, json, text });
                return r;
            }) as any;

            (app as any).handle(req, res, (err: any) => {
                if (err) reject(err);
            });
            if (bodyBuf.length > 0) req.push(bodyBuf);
            req.push(null);
        });
    };
}

async function seedB2BAccount(): Promise<void> {
    dbCollections.clear();
    authUsersByEmail.clear();
    customClaimsByUid.clear();
    mockTokens.clear();

    await mockDb.collection('accounts').doc('acc-minera-e08').set({
        id: 'acc-minera-e08',
        name: 'Minera Norte E08 SpA',
        type: 'BUSINESS',
        classification: 'b2b',
        countryCode: 'CL',
        status: 'ACTIVE',
        ownerId: 'uid-owner-e08',
        licensing: { maxUsers: 25, allowInternalUsers: true },
        entitlements: {
            basePackage: 'CORE_BASE',
            addonModules: {
                opermaq: { active: true },
                stockpile: { active: true },
                supply: { active: true },
            },
        },
        mandatario: {
            fullName: 'Gerente Titular E08',
            email: 'owner@minera-e08.cl',
        },
    });

    await mockDb.collection('users').doc('uid-owner-e08').set({
        uid: 'uid-owner-e08',
        email: 'owner@minera-e08.cl',
        fullName: 'Gerente Titular E08',
        role: 'OWNER',
        status: 'ACTIVE',
        primaryAccountId: 'acc-minera-e08',
        memberships: [
            {
                accountId: 'acc-minera-e08',
                role: 'OWNER',
                status: 'ACTIVE',
                allowedModules: { opermaq: true, stockpile: true, supply: true },
            },
        ],
    });

    mockTokens.set('tok-owner-e08', {
        uid: 'uid-owner-e08',
        email: 'owner@minera-e08.cl',
        email_verified: true,
        role: 'OWNER',
        activeAccountId: 'acc-minera-e08',
    });
}

async function runTests(): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
        const authHdr = String(req.headers.authorization || '');
        if (authHdr.startsWith('Bearer ')) {
            const decoded = mockTokens.get(authHdr.slice(7).trim());
            if (decoded) req.user = decoded;
        }
        next();
    });
    app.use('/api/staff', staffRouter);
    const dispatch = createInProcessDispatcher(app);

    // =========================================================================
    // TEST 1: POST/PATCH /api/staff/members preservan allowedModules.supply + Doble Opt-In Ley 21.719
    // =========================================================================
    {
        await seedB2BAccount();

        // 1a. Crear OPERATOR con allowedModules.supply: true y teléfono (aun enviando whatsappOptInAt -> debe forzarse PENDING_DOUBLE_OPT_IN + null!)
        const createOp = await dispatch('/api/staff/members', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-owner-e08' },
            body: {
                accountId: 'acc-minera-e08',
                accountName: 'Minera Norte E08 SpA',
                email: 'camp@minera-e08.cl',
                displayName: 'Jefe Campamento E08',
                countryCode: 'CL',
                role: 'OPERATOR',
                allowedModules: { opermaq: true, stockpile: false, supply: true },
                phoneE164: '+56900001234',
                whatsappOptInAt: '2026-11-21T00:00:00Z', // Intento unilateral por tercero -> debe ignorarse!
                supplyProfile: {
                    role: 'CAMP_MANAGER',
                    canRecordDirectPurchase: false,
                    allowCapex: false,
                },
            },
        });
        assert.equal(createOp.status, 201);
        const opUid = createOp.json.uid;
        assert.ok(opUid);

        const opMemberDoc = getCollectionMap('accounts/acc-minera-e08/members').get(opUid);
        assert.equal(opMemberDoc?.allowedModules?.supply, true, 'OPERATOR debe conservar allowedModules.supply=true');
        assert.equal(opMemberDoc?.phoneE164, '+56900001234');
        assert.equal(
            opMemberDoc?.whatsappOptInStatus,
            'PENDING_DOUBLE_OPT_IN',
            'Alta de teléfono por tercero debe quedar PENDING_DOUBLE_OPT_IN'
        );
        assert.equal(
            opMemberDoc?.whatsappOptInAt,
            null,
            'Alta por tercero jamás debe otorgar whatsappOptInAt unilateral (Ley 21.719)'
        );

        // 1b. Crear VIEWER con allowedModules.supply: true
        const createViewer = await dispatch('/api/staff/members', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok-owner-e08' },
            body: {
                accountId: 'acc-minera-e08',
                accountName: 'Minera Norte E08 SpA',
                email: 'auditor@minera-e08.cl',
                displayName: 'Auditor E08',
                countryCode: 'CL',
                role: 'VIEWER',
                allowedModules: { opermaq: true, stockpile: true, supply: true },
                canViewBilling: true,
            },
        });
        assert.equal(createViewer.status, 201);
        const viewerUid = createViewer.json.uid;
        const viewerDoc = getCollectionMap('accounts/acc-minera-e08/members').get(viewerUid);
        assert.equal(viewerDoc?.allowedModules?.supply, true, 'VIEWER debe conservar allowedModules.supply=true');

        // 1c. PATCH /members/:uid omitiendo `supply` en `allowedModules` NO debe revocar silenciosamente `supply: true`
        const patchOp = await dispatch(`/api/staff/members/${opUid}`, {
            method: 'PATCH',
            headers: { Authorization: 'Bearer tok-owner-e08' },
            body: {
                accountId: 'acc-minera-e08',
                confirmationKeyword: 'ACTUALIZAR',
                jobTitle: 'Jefe Campamento Senior',
                allowedModules: { opermaq: true, stockpile: true }, // omite supply -> debe preservar true!
            },
        });
        assert.equal(patchOp.status, 200);
        const opAfterPatch = getCollectionMap('accounts/acc-minera-e08/members').get(opUid);
        assert.equal(
            opAfterPatch?.allowedModules?.supply,
            true,
            'PATCH sin clave supply no debe revocar silenciosamente allowedModules.supply=true'
        );
        assert.equal(opAfterPatch?.whatsappOptInStatus, 'PENDING_DOUBLE_OPT_IN');
        assert.equal(opAfterPatch?.whatsappOptInAt, null);

        console.log('PASS [1/4] POST/PATCH /api/staff/members preservan allowedModules.supply y Doble Opt-In Ley 21.719');
    }

    // =========================================================================
    // TEST 2: PATCH /api/staff/me/supply-channel (Auto-enrolamiento OWNER sin 403 + HITL + guardas)
    // =========================================================================
    {
        await seedB2BAccount();

        // 2a. Sin palabra clave ACTUALIZAR -> 400
        const noHitl = await dispatch('/api/staff/me/supply-channel', {
            method: 'PATCH',
            headers: { Authorization: 'Bearer tok-owner-e08' },
            body: {
                accountId: 'acc-minera-e08',
                confirmationKeyword: 'GUARDAR',
                phoneE164: '+56900005678',
                whatsappOptInAccepted: true,
            },
        });
        assert.equal(noHitl.status, 400);

        // 2b. Teléfono E.164 inválido -> 400
        const badPhone = await dispatch('/api/staff/me/supply-channel', {
            method: 'PATCH',
            headers: { Authorization: 'Bearer tok-owner-e08' },
            body: {
                accountId: 'acc-minera-e08',
                confirmationKeyword: 'ACTUALIZAR',
                phoneE164: '+569123',
                whatsappOptInAccepted: true,
            },
        });
        assert.equal(badPhone.status, 400);

        // 2c. Intento de alterar role/status/isOwner -> 403 FORBIDDEN_SELF_PRIVILEGE_MUTATION
        const privEsc = await dispatch('/api/staff/me/supply-channel', {
            method: 'PATCH',
            headers: { Authorization: 'Bearer tok-owner-e08' },
            body: {
                accountId: 'acc-minera-e08',
                confirmationKeyword: 'ACTUALIZAR',
                role: 'SUPER_ADMIN',
                isOwner: true,
                phoneE164: '+56900005678',
            },
        });
        assert.equal(privEsc.status, 403);
        assert.equal(privEsc.json.code, 'FORBIDDEN_SELF_PRIVILEGE_MUTATION');

        // 2d. Auto-enrolamiento legítimo del propio OWNER con ACTUALIZAR -> 200 + opt-in + AuditLedger
        const okOwner = await dispatch('/api/staff/me/supply-channel', {
            method: 'PATCH',
            headers: { Authorization: 'Bearer tok-owner-e08' },
            body: {
                accountId: 'acc-minera-e08',
                confirmationKeyword: 'ACTUALIZAR',
                phoneE164: '+56900005678',
                whatsappOptInAccepted: true,
                supplyProfile: {
                    role: 'OWNER_EXEC',
                    canRecordDirectPurchase: true,
                    autoApproveDirectPurchase: true,
                    allowCapex: true,
                },
                notificationPreferences: {
                    emailEnabled: true,
                    whatsappEnabled: true,
                },
            },
        });
        assert.equal(okOwner.status, 200);
        assert.equal(okOwner.json.success, true);
        assert.equal(okOwner.json.phoneE164, '+56900005678');
        assert.equal(okOwner.json.whatsappOptInStatus, 'ACTIVE');
        assert.ok(okOwner.json.whatsappOptInAt, 'whatsappOptInAt debe quedar poblado tras auto-enrolamiento OWNER');

        const persistedOwnerMember = getCollectionMap('accounts/acc-minera-e08/members').get('uid-owner-e08');
        assert.equal(persistedOwnerMember?.phoneE164, '+56900005678');
        assert.equal(persistedOwnerMember?.whatsappOptInStatus, 'ACTIVE');
        assert.equal(persistedOwnerMember?.supplyProfile?.role, 'OWNER_EXEC');

        const ledgerRows = Array.from(getCollectionMap('audit_ledger').values());
        assert.ok(
            ledgerRows.some(
                (entry) =>
                    entry.action === 'SUPPLY_MEMBER_SELF_ENROLLMENT' &&
                    entry.module === 'supply' &&
                    entry.actorUid === 'uid-owner-e08'
            ),
            'AuditLedger debe registrar SUPPLY_MEMBER_SELF_ENROLLMENT'
        );

        // 2e. Revocación propia (`whatsappOptInAccepted: false`) -> REVOKED + whatsappOptInAt null
        const revokeOwner = await dispatch('/api/staff/me/supply-channel', {
            method: 'PATCH',
            headers: { Authorization: 'Bearer tok-owner-e08' },
            body: {
                accountId: 'acc-minera-e08',
                confirmationKeyword: 'ACTUALIZAR',
                whatsappOptInAccepted: false,
            },
        });
        assert.equal(revokeOwner.status, 200);
        assert.equal(revokeOwner.json.whatsappOptInAt, null);
        assert.equal(revokeOwner.json.whatsappOptInStatus, 'REVOKED');

        console.log('PASS [2/4] PATCH /api/staff/me/supply-channel (OWNER self-enrollment 200, HITL 400, E.164 400, priv-esc 403)');
    }

    // =========================================================================
    // TEST 3: dev.controller.ts aprovisiona TEST-PILOT (`pilot-*`) con supply: true
    // =========================================================================
    {
        await seedB2BAccount();
        let capturedStatus = 0;
        let capturedJson: any = null;
        const mockReq: any = {
            user: { uid: 'dev-master-root-uid', email: 'dev@minreport.com', isMasterDev: true },
            body: {
                collaboratorName: 'Piloto E08',
                collaboratorEmail: 'piloto@e08.minreport.cl',
                organization: 'Faena Piloto E08',
                expiresDays: 30,
                purpose: 'Validación integral módulo Abastecimiento',
            },
        };
        const mockRes: any = {
            status(code: number) {
                capturedStatus = code;
                return this;
            },
            json(payload: any) {
                capturedJson = payload;
                return this;
            },
        };

        await createTestPilotAccount(mockReq, mockRes);
        assert.equal(capturedStatus, 201);
        const pilotAccountId = String(
            capturedJson?.pilot?.accountId || capturedJson?.accountId || ''
        );
        const pilotUserId = String(
            capturedJson?.pilot?.userId || capturedJson?.userId || ''
        );
        assert.ok(pilotAccountId.startsWith('pilot-'));

        const pilotAccountDoc = getCollectionMap('accounts').get(pilotAccountId);
        assert.equal(pilotAccountDoc?.contract?.activeModules?.supply, true);
        assert.equal(pilotAccountDoc?.entitlements?.baseModules?.supply, true);
        assert.equal(pilotAccountDoc?.entitlements?.addonModules?.supply?.active, true);
        assert.ok(Array.isArray(pilotAccountDoc?.enabledPlugins) && pilotAccountDoc.enabledPlugins.includes('supply'));

        const pilotMemberDoc = getCollectionMap(`accounts/${pilotAccountId}/members`).get(pilotUserId);
        assert.equal(pilotMemberDoc?.allowedModules?.supply, true);

        console.log('PASS [3/4] dev.controller.ts aprovisiona sandbox TEST-PILOT (pilot-*) con supply: true');
    }

    // =========================================================================
    // TEST 4: Paridad estática HMI & Soberanía MINREPORT (SuperAdminConsole, EquipoPage, SessionContext, DevVaultGateway, access)
    // =========================================================================
    {
        const repoRoot = path.resolve(__dirname, '../../../..');
        const superAdminSrc = fs.readFileSync(
            path.join(repoRoot, 'web/src/pages/admin/SuperAdminConsole.tsx'),
            'utf8'
        );
        const equipoSrc = fs.readFileSync(
            path.join(repoRoot, 'web/src/pages/b2b/EquipoPage.tsx'),
            'utf8'
        );
        const sessionCtxSrc = fs.readFileSync(
            path.join(repoRoot, 'web/src/context/MinReportSessionContext.tsx'),
            'utf8'
        );
        const devVaultSrc = fs.readFileSync(
            path.join(repoRoot, 'web/src/pages/dev/DevVaultGateway.tsx'),
            'utf8'
        );
        const accessCtrlSrc = fs.readFileSync(
            path.join(repoRoot, 'src/api/access.controller.ts'),
            'utf8'
        );

        // SuperAdminConsole.tsx
        assert.ok(superAdminSrc.includes("id: 'opermaq' | 'stockpile' | 'supply'"));
        assert.ok(superAdminSrc.includes("id: 'supply'"));
        assert.ok(superAdminSrc.includes('supply: entAddonSupply'));
        assert.ok(superAdminSrc.includes('<M3Switch'));
        assert.ok(!superAdminSrc.includes('AdminSwitch'), 'Prohibido AdminSwitch en SuperAdminConsole');

        // EquipoPage.tsx
        assert.ok(equipoSrc.includes('supply: modSupply'));
        assert.ok(equipoSrc.includes('supply: editModSupply'));
        assert.ok(equipoSrc.includes('StaffService.updateSelfSupplyChannel'));
        assert.ok(equipoSrc.includes('PENDING_DOUBLE_OPT_IN'));
        assert.ok(equipoSrc.includes('autoComplete="off"'));
        assert.ok(equipoSrc.includes('spellCheck={false}'));
        assert.ok(equipoSrc.includes('<M3Switch'));
        assert.ok(!equipoSrc.includes('AdminSwitch'), 'Prohibido AdminSwitch en EquipoPage');

        // MinReportSessionContext.tsx
        assert.ok(sessionCtxSrc.includes("moduleKey: 'supply'"));
        assert.ok(sessionCtxSrc.includes('canRecordDirectPurchase'));
        assert.ok(sessionCtxSrc.includes('canApproveExpenseReports'));
        assert.ok(sessionCtxSrc.includes('canManageCapex'));
        assert.ok(sessionCtxSrc.includes('canMutate: canMutateSupply'));
        assert.ok(sessionCtxSrc.includes("role === 'VIEWER'") && sessionCtxSrc.includes("BILLING_ONLY"));

        // DevVaultGateway.tsx & access.controller.ts
        assert.ok(devVaultSrc.includes('MODULE_SUPPLY'));
        assert.ok(devVaultSrc.includes('mod_supply'));
        assert.ok(accessCtrlSrc.includes('supply: false'));

        // Cero marcas/colores/fuentes prohibidas ni emojis en todos los archivos inspeccionados
        const forbiddenTokens = [
            ['CABI', 'SEG'].join(''),
            ['#FF', 'CD00'].join(''),
            ['Google', ' Sans'].join(''),
            ['7609', '4302'].join(''),
        ];
        const forbiddenRegex = new RegExp(`${forbiddenTokens.join('|')}|[\\u{1F300}-\\u{1FAFF}]`, 'u');
        for (const [name, src] of [
            ['SuperAdminConsole.tsx', superAdminSrc],
            ['EquipoPage.tsx', equipoSrc],
            ['MinReportSessionContext.tsx', sessionCtxSrc],
            ['DevVaultGateway.tsx', devVaultSrc],
            ['access.controller.ts', accessCtrlSrc],
        ]) {
            assert.ok(!forbiddenRegex.test(src), `Contenido prohibido o emoji detectado en ${name}`);
        }

        console.log('PASS [4/4] Paridad estática HMI, permissions.supply, 0 AdminSwitch, 0 emojis y 0 marcas prohibidas');
    }

    console.log('\nALL E08 CONSOLES, SELF-ENROLLMENT & SESSION CONTEXT TESTS PASSED (4/4)');
}

runTests().catch((err) => {
    console.error('E08 TEST SUITE FAILED:', err);
    process.exit(1);
});
