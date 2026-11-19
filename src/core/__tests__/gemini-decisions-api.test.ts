/**
 * Suite Determinista — Gemini Decisions API (`gemini-decision-1`, Capa 4 MINREPORT)
 * Ejecución directa: `./node_modules/.bin/ts-node src/core/__tests__/gemini-decisions-api.test.ts`
 *
 * Verifica:
 * 1. Validación estricta Zod (`AIDecisionRequestSchema`).
 * 2. Transporte wire REST, modalidades (`text`, `image`, `document`, `audio`) y purga pre-vuelo Ley N° 21.719.
 * 3. Caché determinista L1 RAM + L2 Firestore (`dec_*`, `0` output tokens).
 * 4. Bloqueo `HTTP 400` de seguridad en modo Fail-Closed (`DecisionSafetyBlockedError`, sin fallback).
 * 5. Fallback resiliente `SWARM_ANCHOR_FALLBACK` ante `503` y ante `USE_VERTEX_AI=true` + `TENANT_PRIVATE`.
 * 6. Integración piloto en `SourceClassifierService` y `EduGatekeeper`.
 */
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.GCP_PROJECT_ID ||= 'minreport-decisions-test';
process.env.GEMINI_API_KEY = 'test-key-decisions-local-only';

// Stub ligero en memoria para Firestore/Firebase Admin antes de cargar módulos de negocio
const dbCollections = new Map<string, Map<string, Record<string, any>>>();

function getCol(name: string): Map<string, Record<string, any>> {
    let col = dbCollections.get(name);
    if (!col) {
        col = new Map();
        dbCollections.set(name, col);
    }
    return col;
}

const mockFieldValue = {
    delete: () => Symbol('delete'),
    serverTimestamp: () => Date.now(),
    increment: (n: number) => ({ __inc: n }),
    arrayUnion: (...els: unknown[]) => ({ __union: els }),
};

const mockTimestamp = {
    now: () => ({ toMillis: () => Date.now(), toDate: () => new Date() }),
    fromMillis: (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }),
    fromDate: (d: Date) => ({ toMillis: () => d.getTime(), toDate: () => d }),
};

const mockDb: any = {
    collection(colName: string) {
        return {
            doc(docId: string) {
                return {
                    async get() {
                        const data = getCol(colName).get(docId);
                        return {
                            exists: Boolean(data),
                            id: docId,
                            data: () => (data ? { ...data } : undefined),
                        };
                    },
                    async set(payload: Record<string, any>, opts?: { merge?: boolean }) {
                        const col = getCol(colName);
                        const prev = opts?.merge ? col.get(docId) || {} : {};
                        col.set(docId, { ...prev, ...payload });
                    },
                };
            },
            where() {
                return {
                    limit() {
                        return {
                            async get() {
                                return { empty: true, docs: [] };
                            },
                        };
                    },
                };
            },
        };
    },
    batch() {
        const ops: Array<() => Promise<void>> = [];
        return {
            set(ref: any, data: any, opts?: any) {
                ops.push(() => ref.set(data, opts));
            },
            async commit() {
                await Promise.all(ops.map((fn) => fn()));
            },
        };
    },
};

function installStub(resolvedPath: string, exportsObj: any): void {
    require.cache[resolvedPath] = {
        id: resolvedPath,
        filename: resolvedPath,
        loaded: true,
        exports: exportsObj,
    } as any;
}

const mockAdmin = {
    apps: [{ name: '[DEFAULT]' }],
    firestore: Object.assign(() => mockDb, {
        FieldValue: mockFieldValue,
        Timestamp: mockTimestamp,
    }),
    auth: () => ({}),
    storage: () => ({}),
    messaging: () => ({}),
};

installStub(require.resolve('../../config/firebase'), {
    __esModule: true,
    default: mockAdmin,
    db: mockDb,
    auth: {},
    storage: {},
    messaging: {},
});

installStub(require.resolve('firebase-admin/firestore'), {
    __esModule: true,
    FieldValue: mockFieldValue,
    Timestamp: mockTimestamp,
});

installStub(require.resolve('firebase-admin'), {
    __esModule: true,
    default: mockAdmin,
    apps: mockAdmin.apps,
    firestore: mockAdmin.firestore,
    auth: () => ({}),
    storage: () => ({}),
});

const {
    AIDecisionRequestSchema,
    DecisionSafetyBlockedError,
    ResilientAIClient,
} = require('../resilient-ai-client') as typeof import('../resilient-ai-client');
const { classifySourcesByAuthorship } =
    require('../../modules/opermaq/services/SourceClassifierService') as typeof import('../../modules/opermaq/services/SourceClassifierService');
const { EduGatekeeper } =
    require('../../services/edu_gatekeeper') as typeof import('../../services/edu_gatekeeper');

function testZodRequestValidation(): void {
    const valid = AIDecisionRequestSchema.safeParse({
        module: 'opermaq',
        dataClassification: 'GLOBAL_OEM',
        inputText: 'Evaluación técnica de cargador frontal',
        questions: {
            is_valid: { type: 'noul', instructions: '¿Es válido?' },
            category: {
                type: 'choice',
                instructions: 'Elige categoría',
                criteria: { OEM: 'Fabricante', EXTERNO: 'Tercero' },
            },
            quality_score: {
                type: 'score',
                instructions: 'Puntaje',
                criteria: ['Bajo', 'Medio', 'Alto'],
            },
        },
    });
    assert.equal(valid.success, true, 'Solicitud válida con noul/choice/score debe aprobar');

    // Clave de pregunta inválida
    assert.equal(
        AIDecisionRequestSchema.safeParse({
            module: 'core',
            inputText: 'Test',
            questions: {
                'clave con espacio': { type: 'noul', instructions: 'Check' },
            },
        }).success,
        false,
        'Debe rechazar claves de pregunta con espacios'
    );

    // Choice con menos de 2 opciones
    assert.equal(
        AIDecisionRequestSchema.safeParse({
            module: 'core',
            inputText: 'Test',
            questions: {
                c1: { type: 'choice', instructions: 'Pick', criteria: { ONLY_ONE: 'Única' } },
            },
        }).success,
        false,
        'Choice con menos de 2 opciones debe fallar'
    );

    // URI gs:// prohibida
    assert.equal(
        AIDecisionRequestSchema.safeParse({
            module: 'opermaq',
            media: [{ mimeType: 'application/pdf', uri: 'gs://minreport-bucket/manual.pdf' }],
            questions: { q1: { type: 'noul', instructions: 'Check PDF' } },
        }).success,
        false,
        'URI gs:// debe ser rechazada'
    );

    // URI YouTube prohibida
    assert.equal(
        AIDecisionRequestSchema.safeParse({
            module: 'opermaq',
            media: [{ mimeType: 'video/mp4', uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
            questions: { q1: { type: 'noul', instructions: 'Check video' } },
        }).success,
        false,
        'URL de YouTube debe ser rechazada'
    );

    // application/octet-stream prohibido
    assert.equal(
        AIDecisionRequestSchema.safeParse({
            module: 'opermaq',
            media: [{ mimeType: 'application/octet-stream', dataBase64: 'AAAA' }],
            questions: { q1: { type: 'noul', instructions: 'Check blob' } },
        }).success,
        false,
        'application/octet-stream debe ser rechazado'
    );
}

async function testRestTransportWireAndLey21719Scrubbing(): Promise<void> {
    dbCollections.clear();
    ResilientAIClient.clearDecisionCacheForTesting();

    const origTransport = ResilientAIClient.invokeDecisionsRestTransport;
    const captured: {
        value: { endpointUrl: string; apiKey: string; payload: Record<string, any> } | null;
    } = { value: null };

    ResilientAIClient.invokeDecisionsRestTransport = async (params) => {
        captured.value = params;
        return {
            status: 200,
            body: {
                answers: {
                    is_oem: { type: 'noul', noul: 0.96, confidence: 0.96 },
                    domain_kind: {
                        type: 'choice',
                        choice: 'OEM',
                        probabilities: { OEM: 0.92, EXTERNO: 0.08 },
                        confidence: 0.92,
                    },
                    quality: {
                        type: 'score',
                        score: 1.85,
                        legend: { '0': 'Baja', '1': 'Media', '2': 'Alta' },
                        probabilities: { '0': 0.02, '1': 0.11, '2': 0.87 },
                        confidence: 0.87,
                    },
                },
                usage: { total_input_tokens: 412, total_output_tokens: 0, total_tokens: 412 },
            },
        };
    };

    try {
        const res = await ResilientAIClient.decide({
            module: 'opermaq',
            dataClassification: 'GLOBAL_OEM',
            countryCode: 'CL',
            inputText:
                'Operador RUT 12.345.678-5 tel +56 9 8765 4321 email juan.perez@faena.cl en -22.3105, -68.9022 reporta equipo CAT 793F.',
            media: [
                { mimeType: 'image/jpeg', dataBase64: 'aW1hZ2UtYnl0ZXM=', resolution: 'high' },
                { mimeType: 'application/pdf', dataBase64: 'cGRmLWJ5dGVz', resolution: 'low' },
                { mimeType: 'audio/wav', dataBase64: 'YXVkaW8tYnl0ZXM=', resolution: 'low' },
            ],
            questions: {
                is_oem: {
                    type: 'noul',
                    instructions: 'Verifica si el contacto operador@faena.cl corresponde a ficha OEM.',
                },
                domain_kind: {
                    type: 'choice',
                    instructions: 'Clasifica fuente',
                    criteria: {
                        OEM: 'Fabricante oficial sin RUT 12.345.678-5',
                        EXTERNO: 'Tercero',
                    },
                },
                quality: {
                    type: 'score',
                    instructions: 'Calidad técnica',
                    criteria: ['Baja', 'Media', 'Alta'],
                },
            },
        });

        assert.ok(captured.value, 'Debe invocar transporte REST');
        const sent = captured.value!;
        assert.ok(
            sent.endpointUrl.endsWith('/' + 'v1beta' + '/decisions'),
            'Endpoint debe apuntar a API v1beta decisions'
        );
        assert.equal(sent.payload.model, 'gemini-decision-1');

        const blocks: any[] = sent.payload.input;
        assert.equal(blocks.length, 4);
        assert.deepEqual(blocks[0], {
            type: 'image',
            data: 'aW1hZ2UtYnl0ZXM=',
            mime_type: 'image/jpeg',
            resolution: 'high',
        });
        assert.deepEqual(blocks[1], {
            type: 'document',
            data: 'cGRmLWJ5dGVz',
            mime_type: 'application/pdf',
        });
        assert.equal('resolution' in blocks[1], false, 'PDF no debe incluir resolution');
        assert.deepEqual(blocks[2], {
            type: 'audio',
            data: 'YXVkaW8tYnl0ZXM=',
            mime_type: 'audio/wav',
        });
        assert.equal('resolution' in blocks[2], false, 'Audio no debe incluir resolution');

        const sentText: string = blocks[3].text;
        assert.equal(sentText.includes('12.345.678-5'), false, 'RUT debe ser purgado antes de salir');
        assert.equal(sentText.includes('juan.perez@faena.cl'), false, 'Email debe ser purgado');
        assert.equal(sentText.includes('-22.3105'), false, 'GPS debe ser purgado');
        assert.ok(sentText.includes('[RUT_RESERVADO]'));
        assert.ok(sentText.includes('[TEL_RESERVADO]'));
        assert.ok(sentText.includes('[EMAIL_RESERVADO]'));
        assert.ok(sentText.includes('[COORD_FAENA_RESERVADA]'));
        assert.equal(
            sent.payload.questions.is_oem.instructions.includes('operador@faena.cl'),
            false,
            'PII en instructions debe ser purgada'
        );
        assert.equal(
            sent.payload.questions.domain_kind.criteria.OEM.includes('12.345.678-5'),
            false,
            'PII en criteria debe ser purgada'
        );

        assert.equal(res.engineUsed, 'DECISIONS_API_V1BETA');
        assert.equal(res.cached, false);
        assert.equal(res.usage.totalOutputTokens, 0);
        assert.equal(res.usage.totalInputTokens, 412);
        assert.equal(res.answers.is_oem.type, 'noul');
        assert.equal(res.answers.domain_kind.type, 'choice');
        assert.equal(res.answers.quality.type, 'score');
    } finally {
        ResilientAIClient.invokeDecisionsRestTransport = origTransport;
    }
}

async function testDeterministicL1AndL2Caching(): Promise<void> {
    dbCollections.clear();
    ResilientAIClient.clearDecisionCacheForTesting();

    const origTransport = ResilientAIClient.invokeDecisionsRestTransport;
    let transportCalls = 0;

    ResilientAIClient.invokeDecisionsRestTransport = async () => {
        transportCalls += 1;
        return {
            status: 200,
            body: {
                answers: { ok: { type: 'noul', noul: 0.88, confidence: 0.88 } },
                usage: { total_input_tokens: 90, total_output_tokens: 0, total_tokens: 90 },
            },
        };
    };

    try {
        const req = {
            module: 'opermaq' as const,
            dataClassification: 'GLOBAL_OEM' as const,
            inputText: 'Especificación OEM constante de prueba',
            questions: { ok: { type: 'noul' as const, instructions: '¿Es válido?' } },
        };

        const r1 = await ResilientAIClient.decide(req);
        assert.equal(r1.cached, false);
        assert.equal(transportCalls, 1);

        // Hit L1 RAM
        const r2 = await ResilientAIClient.decide(req);
        assert.equal(r2.cached, true);
        assert.equal(transportCalls, 1, 'Segunda llamada idéntica debe resolverse en L1 RAM');

        // Verificar que Firestore L2 no almacenó base64 ni contenido crudo sensible, y responde al limpiar L1
        ResilientAIClient.clearDecisionCacheForTesting();
        const r3 = await ResilientAIClient.decide(req);
        assert.equal(r3.cached, true);
        assert.equal(transportCalls, 1, 'Tercera llamada tras limpiar L1 debe resolver en L2 Firestore');
    } finally {
        ResilientAIClient.invokeDecisionsRestTransport = origTransport;
    }
}

async function testSafetyBlockFailClosed(): Promise<void> {
    dbCollections.clear();
    ResilientAIClient.clearDecisionCacheForTesting();

    const origTransport = ResilientAIClient.invokeDecisionsRestTransport;
    const origGenerate = ResilientAIClient.generate;
    let fallbackCalled = false;

    ResilientAIClient.invokeDecisionsRestTransport = async () => ({
        status: 400,
        body: {
            error: {
                code: 'safety',
                message: 'Request blocked due to safety violations.',
            },
        },
    });
    ResilientAIClient.generate = async () => {
        fallbackCalled = true;
        throw new Error('No debe ejecutarse fallback en bloqueo de seguridad');
    };

    try {
        await assert.rejects(
            () =>
                ResilientAIClient.decide({
                    module: 'core',
                    bypassCache: true,
                    inputText: 'Contenido bloqueado por seguridad',
                    questions: { check: { type: 'noul', instructions: '¿Aprobado?' } },
                }),
            (err: any) => err instanceof DecisionSafetyBlockedError && err.code === 'safety'
        );
        assert.equal(fallbackCalled, false, 'Bloqueo safety HTTP 400 jamás debe saltar a fallback');
    } finally {
        ResilientAIClient.invokeDecisionsRestTransport = origTransport;
        ResilientAIClient.generate = origGenerate;
    }
}

async function testResilientFallbackOn503AndVertexTenantPrivate(): Promise<void> {
    dbCollections.clear();
    ResilientAIClient.clearDecisionCacheForTesting();

    const origTransport = ResilientAIClient.invokeDecisionsRestTransport;
    const origGenerate = ResilientAIClient.generate;
    const origBackoff = ResilientAIClient.computeBackoffMs;
    const prevUseVertex = process.env.USE_VERTEX_AI;

    let transportCalls = 0;
    let generateCalls = 0;

    ResilientAIClient.computeBackoffMs = () => 5;
    ResilientAIClient.invokeDecisionsRestTransport = async () => {
        transportCalls += 1;
        return { status: 503, body: { error: { message: 'Service Unavailable' } } };
    };
    ResilientAIClient.generate = async (req) => {
        generateCalls += 1;
        assert.equal(req.preferredTier, 'ANCHOR_HA');
        return {
            text: JSON.stringify({
                is_ok: { noul: 0.91 },
                route: { choice: 'B', confidence: 0.85 },
                sev: { level_index: 2, confidence: 0.8 },
            }),
            model: 'gemini-3.1-flash-lite-preview',
            tierUsed: 'ANCHOR_HA',
            latencyMs: 42,
            requiresHumanApproval: false,
            groundingSources: [],
            webSearchQueries: [],
        };
    };

    try {
        // Caso A: Error 503 en Decisions API -> retry + fallback a SWARM_ANCHOR_FALLBACK
        const res503 = await ResilientAIClient.decide({
            module: 'opermaq',
            bypassCache: true,
            inputText: 'Texto de prueba para fallback 503',
            questions: {
                is_ok: { type: 'noul', instructions: '¿OK?' },
                route: {
                    type: 'choice',
                    instructions: 'Ruta',
                    criteria: { A: 'Opción A', B: 'Opción B' },
                },
                sev: {
                    type: 'score',
                    instructions: 'Severidad',
                    criteria: ['Baja', 'Media', 'Alta'],
                },
            },
        });
        assert.equal(transportCalls, 2, 'Debe intentar 1 vez + 1 reintento antes de fallback');
        assert.equal(generateCalls, 1);
        assert.equal(res503.engineUsed, 'SWARM_ANCHOR_FALLBACK');
        assert.equal(res503.answers.is_ok.type, 'noul');
        assert.equal(res503.answers.route.type, 'choice');
        if (res503.answers.route.type === 'choice') {
            assert.equal(res503.answers.route.choice, 'B');
        }
        assert.equal(res503.answers.sev.type, 'score');
        if (res503.answers.sev.type === 'score') {
            assert.equal(res503.answers.sev.score, 2);
        }

        // Caso B: USE_VERTEX_AI=true + TENANT_PRIVATE -> omite v1beta externo y va directo a Vertex ANCHOR_HA
        process.env.USE_VERTEX_AI = 'true';
        const prevTransportCalls = transportCalls;
        const resVertex = await ResilientAIClient.decide({
            module: 'core',
            tenantId: 'faena-escondida-01',
            dataClassification: 'TENANT_PRIVATE',
            bypassCache: true,
            inputText: 'Documento confidencial de faena privada',
            media: [{ mimeType: 'application/pdf', dataBase64: 'cGRm' }],
            questions: {
                is_ok: { type: 'noul', instructions: '¿OK?' },
                route: {
                    type: 'choice',
                    instructions: 'Ruta',
                    criteria: { A: 'Opción A', B: 'Opción B' },
                },
                sev: {
                    type: 'score',
                    instructions: 'Severidad',
                    criteria: ['Baja', 'Media', 'Alta'],
                },
            },
        });
        assert.equal(
            transportCalls,
            prevTransportCalls,
            'Con USE_VERTEX_AI=true y TENANT_PRIVATE no debe llamar a v1beta externo'
        );
        assert.equal(generateCalls, 2);
        assert.equal(resVertex.engineUsed, 'SWARM_ANCHOR_FALLBACK');
    } finally {
        ResilientAIClient.invokeDecisionsRestTransport = origTransport;
        ResilientAIClient.generate = origGenerate;
        ResilientAIClient.computeBackoffMs = origBackoff;
        if (prevUseVertex === undefined) delete process.env.USE_VERTEX_AI;
        else process.env.USE_VERTEX_AI = prevUseVertex;
    }
}

async function testPilotIntegrationsSourceClassifierAndEduGatekeeper(): Promise<void> {
    dbCollections.clear();
    ResilientAIClient.clearDecisionCacheForTesting();

    const origDecide = ResilientAIClient.decide;

    try {
        // 1. SourceClassifierService
        ResilientAIClient.decide = async () => ({
            answers: {
                src_0: {
                    type: 'choice',
                    choice: 'OEM',
                    probabilities: { OEM: 0.94, EXTERNO: 0.05, YOUTUBE: 0.01 },
                    confidence: 0.94,
                },
            },
            model: 'gemini-decision-1',
            engineUsed: 'DECISIONS_API_V1BETA',
            latencyMs: 120,
            cached: false,
            usage: { totalInputTokens: 150, totalOutputTokens: 0, totalTokens: 150 },
        });

        const classified = await classifySourcesByAuthorship(
            [{ uri: 'https://portal-tecnico-desconocido.org/doc-793f', title: 'Manual' }],
            'Caterpillar',
            '793F'
        );
        assert.equal(classified.length, 1);
        assert.equal(classified[0].type, 'OEM');
        assert.equal(classified[0].url, 'https://portal-tecnico-desconocido.org/doc-793f');

        // 2. EduGatekeeper — Caso aprobado (>= 0.70)
        ResilientAIClient.decide = async () => ({
            answers: {
                is_valid_academic_certificate: { type: 'noul', noul: 0.91, confidence: 0.91 },
                matches_expected_institution: { type: 'noul', noul: 0.86, confidence: 0.86 },
            },
            model: 'gemini-decision-1',
            engineUsed: 'DECISIONS_API_V1BETA',
            latencyMs: 95,
            cached: false,
            usage: { totalInputTokens: 210, totalOutputTokens: 0, totalTokens: 210 },
        });

        const eduOk = await EduGatekeeper.verifyDocumentWithAI({
            documentText: 'Certificado de Alumno Regular 2026 - Universidad Técnica Federico Santa María',
            expectedInstitution: 'Universidad Técnica Federico Santa María',
        });
        assert.equal(eduOk.verified, true);
        assert.equal(eduOk.confidence, 0.86);

        // 3. EduGatekeeper — Caso rechazado Fail-Closed (< 0.70)
        ResilientAIClient.decide = async () => ({
            answers: {
                is_valid_academic_certificate: { type: 'noul', noul: 0.89, confidence: 0.89 },
                matches_expected_institution: { type: 'noul', noul: 0.32, confidence: 0.68 },
            },
            model: 'gemini-decision-1',
            engineUsed: 'DECISIONS_API_V1BETA',
            latencyMs: 90,
            cached: false,
            usage: { totalInputTokens: 200, totalOutputTokens: 0, totalTokens: 200 },
        });

        const eduFail = await EduGatekeeper.verifyDocumentWithAI({
            documentText: 'Certificado emitido por otra entidad',
            expectedInstitution: 'Universidad de Chile',
        });
        assert.equal(eduFail.verified, false);
        assert.ok(eduFail.confidence <= 0.49);
    } finally {
        ResilientAIClient.decide = origDecide;
    }
}

async function main(): Promise<void> {
    testZodRequestValidation();
    console.log('✓ [1/6] Contratos Zod AIDecisionRequestSchema OK');

    await testRestTransportWireAndLey21719Scrubbing();
    console.log('✓ [2/6] Transporte REST v1beta + Purga Pre-Vuelo Ley 21.719 OK');

    await testDeterministicL1AndL2Caching();
    console.log('✓ [3/6] Caché determinista L1 RAM + L2 Firestore (`dec_*`) OK');

    await testSafetyBlockFailClosed();
    console.log('✓ [4/6] Bloqueo HTTP 400 safety en modo Fail-Closed (sin fallback) OK');

    await testResilientFallbackOn503AndVertexTenantPrivate();
    console.log('✓ [5/6] Fallback ANCHOR_HA ante 503 y compuerta USE_VERTEX_AI + TENANT_PRIVATE OK');

    await testPilotIntegrationsSourceClassifierAndEduGatekeeper();
    console.log('✓ [6/6] Integraciones piloto SourceClassifierService y EduGatekeeper OK');

    console.log('✅ SUITE GEMINI DECISIONS API: TODAS LAS ASERCIONES APROBADAS');
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ FALLO EN SUITE GEMINI DECISIONS API:', err);
        process.exit(1);
    });
