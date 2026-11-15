import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { ResilientAIClient } from '../resilient-ai-client';
import {
    SIX_YEARS_MIN_MS,
    THIRTY_DAYS_MS,
    computeShortTtlTimestamp,
    computeSixYearRetentionTimestamp,
    computeThirtyDayTtlTimestamp,
    toEpochMillis,
} from '../retention-policy';
import { ConfidentialityAirlockService } from '../privacy/ConfidentialityAirlockService';
import { TenantMetricsService } from '../../services/tenant-metrics.service';
import {
    normalizeTaxId,
    validateE164Phone,
    validateTaxId,
} from '../../utils/taxIdValidator';

/**
 * BLOQUE ATÓMICO 1.2 — SUITE DE VERIFICACIÓN DETERMINISTA
 * Ejecución directa: `npx ts-node src/core/__tests__/bloque-1-2-finops-multicountry.test.ts`
 *
 * Cubre:
 * 1) `ResilientAIClient.resolveEffectiveTier` (Flash en chat sin schema, Pro en crítico/forzado, Flash-Lite en EDU).
 * 2) `taxIdValidator` (`CL` RUT, `PE` RUC, `BR` CNPJ/CPF, `AR` CUIT, `US` internacional + `E.164`).
 * 3) `ConfidentialityAirlockService.scrubDeterministicPii` multi-país + `UTM` global + `WGS84` + preservación OEM.
 * 4) `retention-policy` (6 años vs 30 días TTL `Timestamp`) + `TenantMetricsService` (`B2B` vs `EDU` atómico).
 */

function testResolveEffectiveTierFinOps(): void {
    // 1a) Chat conversacional simple sin responseSchema -> SECONDARY (Flash)
    assert.equal(
        ResilientAIClient.resolveEffectiveTier({
            prompt: '¿Cuál es el intervalo de cambio de aceite hidráulico?',
            module: 'opermaq',
            tenantId: 'faena-b2b-01',
        }),
        'SECONDARY',
        'Consultas conversacionales sin responseSchema deben usar SECONDARY (Flash) por defecto'
    );

    // 1b) Chat conversacional donde se fuerza explícitamente PRIMARY -> PRIMARY (Pro)
    assert.equal(
        ResilientAIClient.resolveEffectiveTier({
            prompt: 'Analiza causa raíz de cavitación en bomba principal',
            module: 'opermaq',
            preferredTier: 'PRIMARY',
            tenantId: 'faena-b2b-01',
        }),
        'PRIMARY',
        'Forzado explícito preferredTier=PRIMARY en B2B debe mantenerse en PRIMARY'
    );

    // 1c) Operación crítica con requireHITL: true -> PRIMARY (Pro)
    assert.equal(
        ResilientAIClient.resolveEffectiveTier({
            prompt: 'Propón actualización de catálogo maestro',
            module: 'opermaq',
            requireHITL: true,
        }),
        'PRIMARY'
    );

    // 1d) Extracción estructurada compleja (responseSchema + temperatura estándar 0.2) -> PRIMARY (Pro)
    assert.equal(
        ResilientAIClient.resolveEffectiveTier({
            prompt: 'Extrae matriz técnica OEM',
            module: 'opermaq',
            responseSchema: { type: 'OBJECT', properties: { make: { type: 'STRING' } } },
            temperature: 0.2,
        }),
        'PRIMARY'
    );

    // 1e) Extracción estructurada determinista (responseSchema + temp <= 0.1 sin tools/media/HITL) -> SECONDARY (Flash)
    assert.equal(
        ResilientAIClient.resolveEffectiveTier({
            prompt: 'Clasifica tipo de documento',
            module: 'opermaq',
            responseSchema: { type: 'OBJECT', properties: { kind: { type: 'STRING' } } },
            temperature: 0.05,
        }),
        'SECONDARY'
    );

    // 1f) Sandbox académico EDU (isEduSandbox === true): SIEMPRE fuerza ANCHOR_HA (Flash-Lite), incluso si se pide PRIMARY o schema
    assert.equal(
        ResilientAIClient.resolveEffectiveTier({
            prompt: 'Simulación universitaria de perforación',
            module: 'opermaq',
            tenantId: 'edu-usach-minas',
            isEduSandbox: true,
            preferredTier: 'PRIMARY',
            responseSchema: { type: 'OBJECT', properties: { rpm: { type: 'NUMBER' } } },
        }),
        'ANCHOR_HA',
        'isEduSandbox === true debe forzar siempre ANCHOR_HA (Flash-Lite)'
    );
}

function testMultiCountryTaxIdAndE164Validator(): void {
    // Chile (CL) — RUT Módulo-11
    const clValid = validateTaxId('12.345.678-5', 'CL');
    assert.equal(clValid.valid, true);
    assert.equal(clValid.scheme, 'CL_RUT');
    assert.equal(clValid.normalized, '12345678-5');
    assert.equal(clValid.formatted, '12.345.678-5');
    assert.equal(validateTaxId('12.345.678-9', 'CL').valid, false, 'RUT chileno con DV erróneo debe fallar');
    assert.equal(validateTaxId('11.111.111-1', 'CL').valid, false, 'RUT repetido trivial debe fallar');

    // Perú (PE) — RUC 11 dígitos SUNAT
    const peValid = validateTaxId('20100070970', 'PE');
    assert.equal(peValid.valid, true);
    assert.equal(peValid.scheme, 'PE_RUC');
    assert.equal(peValid.normalized, '20100070970');
    assert.equal(validateTaxId('20100047218', 'PE').valid, true);
    assert.equal(validateTaxId('20100070979', 'PE').valid, false, 'RUC peruano con DV inválido debe fallar');
    assert.equal(validateTaxId('99100070970', 'PE').valid, false, 'RUC peruano con prefijo no SUNAT debe fallar');

    // Brasil (BR) — CNPJ 14 dígitos y CPF 11 dígitos
    const brCnpj = validateTaxId('11.222.333/0001-81', 'BR');
    assert.equal(brCnpj.valid, true);
    assert.equal(brCnpj.scheme, 'BR_CNPJ');
    assert.equal(brCnpj.normalized, '11222333000181');
    assert.equal(brCnpj.formatted, '11.222.333/0001-81');
    assert.equal(validateTaxId('11.222.333/0001-82', 'BR').valid, false);
    assert.equal(validateTaxId('00.000.000/0000-00', 'BR').valid, false);

    const brCpf = validateTaxId('529.982.247-25', 'BR');
    assert.equal(brCpf.valid, true);
    assert.equal(brCpf.scheme, 'BR_CPF');
    assert.equal(brCpf.normalized, '52998224725');
    assert.equal(validateTaxId('529.982.247-20', 'BR').valid, false);

    // Argentina (AR) — CUIT 11 dígitos Módulo-11 AFIP
    const arValid = validateTaxId('30-71031609-7', 'AR');
    assert.equal(arValid.valid, true);
    assert.equal(arValid.scheme, 'AR_CUIT');
    assert.equal(arValid.formatted, '30-71031609-7');
    assert.equal(validateTaxId('20-12345678-6', 'AR').valid, true);
    assert.equal(validateTaxId('30-71031609-0', 'AR').valid, false);

    // Internacional (US / AU / CA / EU)
    const usValid = validateTaxId('12-3456789', 'US');
    assert.equal(usValid.valid, true);
    assert.equal(usValid.scheme, 'INTL_TAX_ID');
    assert.equal(normalizeTaxId('abn-51824753556', 'AU'), 'ABN-51824753556');
    assert.equal(validateTaxId('AB$12', 'US').valid, false);
    assert.equal(validateTaxId('123', 'EU').valid, false);

    // Teléfonos ITU-T E.164
    assert.deepEqual(validateE164Phone('+56987654321'), { valid: true, normalized: '+56987654321' });
    assert.deepEqual(validateE164Phone('+51 987 654 321'), { valid: true, normalized: '+51987654321' });
    assert.deepEqual(validateE164Phone('+55 (11) 98765-4321'), { valid: true, normalized: '+5511987654321' });
    assert.deepEqual(validateE164Phone('+1-415-555-2671'), { valid: true, normalized: '+14155552671' });
    assert.equal(validateE164Phone('56987654321').valid, false, 'E.164 sin signo + debe rechazarse');
    assert.equal(validateE164Phone('+012345678').valid, false, 'E.164 no admite código de país iniciado en 0');
}

function testConfidentialityAirlockMultiCountryAndUtm(): void {
    const rawReport = [
        'Operador CL RUT 12.345.678-5, Contratista PE RUC 20100070970,',
        'Proveedor BR CNPJ 11.222.333/0001-81, Inspector AR CUIT 30-71031609-7.',
        'Contactos de emergencia: +51987654321, +5511987654321, +5491123456789 y soporte@minera-andina.pe.',
        'Frente carguío Perú UTM 17M 784510 9845230 / Brasil Zona 23K 331450 mE 7394120 mN / WGS84 -12.0464, -77.0428.',
        'Equipos evaluados: Excavadora PC200-8, Cargador WA380-6, Camión CAT 797F bajo norma ISO 7000.',
    ].join(' ');

    const { scrubbed, redactedCategories } = ConfidentialityAirlockService.scrubDeterministicPii(rawReport, {
        countryCode: 'PE',
    });

    // Ningún identificador PII o coordenada exacta debe sobrevivir
    assert.ok(!scrubbed.includes('12.345.678-5'), 'RUT chileno debe ser redactado');
    assert.ok(!scrubbed.includes('20100070970'), 'RUC peruano debe ser redactado');
    assert.ok(!scrubbed.includes('11.222.333/0001-81'), 'CNPJ brasileño debe ser redactado');
    assert.ok(!scrubbed.includes('30-71031609-7'), 'CUIT argentino debe ser redactado');
    assert.ok(!scrubbed.includes('+51987654321'), 'Teléfono E.164 PE debe ser redactado');
    assert.ok(!scrubbed.includes('+5511987654321'), 'Teléfono E.164 BR debe ser redactado');
    assert.ok(!scrubbed.includes('+5491123456789'), 'Teléfono E.164 AR debe ser redactado');
    assert.ok(!scrubbed.includes('soporte@minera-andina.pe'), 'Email debe ser redactado');
    assert.ok(!scrubbed.includes('784510'), 'Coordenada UTM huso 17M debe ser redactada');
    assert.ok(!scrubbed.includes('7394120'), 'Coordenada UTM huso 23K debe ser redactada');
    assert.ok(!scrubbed.includes('-12.0464'), 'Coordenada WGS84 debe ser redactada');

    // Códigos técnicos universales OEM / ISO deben permanecer intactos (0 falsos positivos)
    assert.ok(scrubbed.includes('PC200-8'), 'Modelo OEM PC200-8 debe preservarse');
    assert.ok(scrubbed.includes('WA380-6'), 'Modelo OEM WA380-6 debe preservarse');
    assert.ok(scrubbed.includes('CAT 797F'), 'Modelo OEM CAT 797F debe preservarse');
    assert.ok(scrubbed.includes('ISO 7000'), 'Norma ISO 7000 debe preservarse');

    assert.ok(redactedCategories.includes('RUT_IDENTIFICADOR'));
    assert.ok(redactedCategories.includes('RUC_IDENTIFICADOR'));
    assert.ok(redactedCategories.includes('CNPJ_IDENTIFICADOR'));
    assert.ok(redactedCategories.includes('CUIT_IDENTIFICADOR'));
    assert.ok(redactedCategories.includes('TELEFONO'));
    assert.ok(redactedCategories.includes('UTM_FAENA'));
    assert.ok(redactedCategories.includes('GPS_FAENA'));

    // Modo contextual BR sin puntuación (14 dígitos crudos válidos)
    const brRaw = ConfidentialityAirlockService.scrubDeterministicPii(
        'Fatura emitida para 11222333000181 em Minas Gerais',
        'BR'
    );
    assert.ok(!brRaw.scrubbed.includes('11222333000181'), 'CNPJ crudo en contexto BR debe ser redactado');
}

function createInMemoryMetricsFirestore() {
    const docs = new Map<string, Record<string, any>>();

    const applyPayload = (path: string, payload: Record<string, any>, merge?: boolean) => {
        const prev = merge ? { ...(docs.get(path) || {}) } : {};
        for (const [k, v] of Object.entries(payload)) {
            if (v && typeof v === 'object' && typeof (v as any).operand === 'number') {
                prev[k] = Number(prev[k] || 0) + Number((v as any).operand);
            } else {
                prev[k] = v;
            }
        }
        docs.set(path, prev);
    };

    const makeDocRef = (path: string): any => {
        const segments = path.split('/');
        const id = segments[segments.length - 1];
        return {
            id,
            path,
            async get() {
                const found = docs.get(path);
                return {
                    id,
                    exists: Boolean(found),
                    data: () => (found ? { ...found } : undefined),
                };
            },
            async set(payload: Record<string, any>, opts?: { merge?: boolean }) {
                applyPayload(path, payload, opts?.merge);
            },
            collection(subName: string) {
                return makeColRef(`${path}/${subName}`);
            },
        };
    };

    const makeColRef = (colPath: string): any => ({
        doc(docId: string) {
            return makeDocRef(`${colPath}/${docId}`);
        },
        where(field: string, op: string, value: any) {
            return {
                limit(max: number) {
                    return {
                        async get() {
                            const matched: any[] = [];
                            for (const [p, d] of docs.entries()) {
                                const parts = p.split('/');
                                if (parts.slice(0, -1).join('/') !== colPath) continue;
                                const fieldVal = d[field];
                                const ok =
                                    op === '=='
                                        ? fieldVal === value
                                        : op === 'in' && Array.isArray(value)
                                        ? value.includes(fieldVal)
                                        : false;
                                if (ok) {
                                    matched.push({
                                        id: parts[parts.length - 1],
                                        exists: true,
                                        data: () => ({ ...d }),
                                    });
                                    if (matched.length >= max) break;
                                }
                            }
                            return { empty: matched.length === 0, docs: matched };
                        },
                    };
                },
            };
        },
    });

    const mockDb: any = {
        docs,
        collection(name: string) {
            return makeColRef(name);
        },
        batch() {
            const ops: Array<() => void> = [];
            return {
                set(ref: any, payload: Record<string, any>, opts?: { merge?: boolean }) {
                    ops.push(() => applyPayload(ref.path, payload, opts?.merge));
                },
                async commit() {
                    for (const op of ops) op();
                },
            };
        },
        async getAll(...refs: any[]) {
            if (refs.length === 0) {
                throw new Error('db.getAll no debe invocarse con 0 referencias');
            }
            return Promise.all(refs.map((r) => r.get()));
        },
    };

    return mockDb;
}

async function testRetentionPolicyAndSeparatedTenantMetrics(): Promise<void> {
    // 4a) Políticas deterministas de retención legal (6 años) vs purga TTL (30 días)
    const fixedAnchorMs = Date.UTC(2026, 10, 12, 12, 0, 0); // 2026-11-12T12:00:00Z
    const sixYrTs = computeSixYearRetentionTimestamp(fixedAnchorMs);
    const thirtyDayTs = computeThirtyDayTtlTimestamp(fixedAnchorMs);
    const shortTtlTs = computeShortTtlTimestamp(180_000, fixedAnchorMs);

    assert.ok(sixYrTs instanceof Timestamp, 'computeSixYearRetentionTimestamp debe retornar Firestore Timestamp');
    assert.ok(thirtyDayTs instanceof Timestamp, 'computeThirtyDayTtlTimestamp debe retornar Firestore Timestamp');
    assert.ok(shortTtlTs instanceof Timestamp, 'computeShortTtlTimestamp debe retornar Firestore Timestamp');

    assert.equal(sixYrTs.toMillis(), Date.UTC(2032, 10, 12, 12, 0, 0));
    assert.ok(sixYrTs.toMillis() - fixedAnchorMs >= SIX_YEARS_MIN_MS);
    assert.equal(thirtyDayTs.toMillis(), fixedAnchorMs + THIRTY_DAYS_MS);
    assert.equal(shortTtlTs.toMillis(), fixedAnchorMs + 180_000);
    assert.equal(toEpochMillis(thirtyDayTs), fixedAnchorMs + THIRTY_DAYS_MS);
    assert.equal(toEpochMillis(fixedAnchorMs + 5000), fixedAnchorMs + 5000);

    // 4b) Aislamiento estricto B2B vs EDU en TenantMetricsService
    TenantMetricsService.clearSegmentCacheForTesting();
    const mockDb = createInMemoryMetricsFirestore();
    const period = '2026_11';

    mockDb.docs.set('accounts/b2b-escondida', {
        id: 'b2b-escondida',
        name: 'Minera Escondida',
        type: 'ENTERPRISE',
        isEduSandbox: false,
    });
    mockDb.docs.set('accounts/b2b-centinela', {
        id: 'b2b-centinela',
        name: 'Minera Centinela',
        type: 'BUSINESS',
        isEduSandbox: false,
    });
    mockDb.docs.set('accounts/edu-uchile', {
        id: 'edu-uchile',
        name: 'Universidad de Chile — Ingeniería en Minas',
        type: 'EDUCATIONAL',
        classification: 'edu',
        isEduSandbox: true,
    });

    // Cuenta B2B: escribe SOLO en accounts/{id}/metrics/{period} y JAMÁS en edu_metrics
    await TenantMetricsService.recordAiUsage({
        accountId: 'b2b-escondida',
        isEduSandbox: false,
        cacheHit: false,
        tier: 'SECONDARY',
        tokensInput: 420,
        tokensOutput: 180,
        period,
        dbOverride: mockDb,
    });
    await TenantMetricsService.recordCasDigestion({
        accountId: 'b2b-escondida',
        originalBytes: 1_000_000,
        optimizedBytes: 220_000,
        period,
        dbOverride: mockDb,
    });
    await TenantMetricsService.recordM2mRequest({
        accountId: 'b2b-escondida',
        period,
        dbOverride: mockDb,
    });
    await TenantMetricsService.recordAiUsage({
        accountId: 'b2b-centinela',
        isEduSandbox: false,
        cacheHit: false,
        tier: 'PRIMARY',
        tokensInput: 800,
        tokensOutput: 250,
        period,
        dbOverride: mockDb,
    });

    const b2bDoc = mockDb.docs.get(`accounts/b2b-escondida/metrics/${period}`);
    assert.ok(b2bDoc, 'Debe existir métrica mensual en accounts/b2b-escondida/metrics/2026_11');
    assert.equal(b2bDoc.segment, 'B2B');
    assert.equal(b2bDoc.aiRequestsTotal, 1);
    assert.equal(b2bDoc.aiTierFlash, 1);
    assert.equal(b2bDoc.aiTokensInput, 420);
    assert.equal(b2bDoc.aiTokensOutput, 180);
    assert.equal(b2bDoc.casAssetsCount, 1);
    assert.equal(b2bDoc.casOriginalBytes, 1_000_000);
    assert.equal(b2bDoc.casOptimizedBytes, 220_000);
    assert.equal(b2bDoc.m2mRequests, 1);
    assert.equal(
        mockDb.docs.has(`edu_metrics/b2b-escondida_${period}`),
        false,
        'Tráfico B2B jamás debe contaminar edu_metrics'
    );

    // Cuenta EDU: escribe atómicamente en accounts/{id}/metrics/{period} Y en edu_metrics/{id}_{period}
    await TenantMetricsService.recordAiUsage({
        accountId: 'edu-uchile',
        isEduSandbox: true,
        cacheHit: false,
        tier: 'ANCHOR_HA',
        tokensInput: 300,
        tokensOutput: 95,
        period,
        dbOverride: mockDb,
    });
    await TenantMetricsService.recordAiUsage({
        accountId: 'edu-uchile',
        isEduSandbox: true,
        cacheHit: true,
        tier: 'ANCHOR_HA',
        period,
        dbOverride: mockDb,
    });

    const eduAccDoc = mockDb.docs.get(`accounts/edu-uchile/metrics/${period}`);
    const eduIsolatedDoc = mockDb.docs.get(`edu_metrics/edu-uchile_${period}`);
    assert.ok(eduAccDoc, 'Debe existir métrica en accounts/edu-uchile/metrics/2026_11');
    assert.ok(eduIsolatedDoc, 'Debe existir espejo académico aislado en edu_metrics/edu-uchile_2026_11');
    assert.equal(eduAccDoc.segment, 'EDU');
    assert.equal(eduIsolatedDoc.segment, 'EDU');
    assert.equal(eduIsolatedDoc.aiRequestsTotal, 2);
    assert.equal(eduIsolatedDoc.aiCacheHits, 1);
    assert.equal(eduIsolatedDoc.aiTierFlashLite, 1);
    assert.equal(eduIsolatedDoc.aiTokensInput, 300);
    assert.equal(eduIsolatedDoc.aiTokensOutput, 95);

    // Identificadores sintéticos globales deben ser ignorados (0 escrituras basura)
    const ignored = await TenantMetricsService.recordAiUsage({
        accountId: 'GLOBAL',
        cacheHit: false,
        tier: 'SECONDARY',
        period,
        dbOverride: mockDb,
    });
    assert.equal(ignored.written, false);

    // Consulta administrativa segmentada B2B vs EDU sin cruce
    const b2bReport = await TenantMetricsService.listMetricsBySegment({
        segment: 'B2B',
        period,
        dbOverride: mockDb,
    });
    const eduReport = await TenantMetricsService.listMetricsBySegment({
        segment: 'EDU',
        period,
        dbOverride: mockDb,
    });

    assert.equal(b2bReport.count, 2, 'Debe incluir cuentas B2B con type ENTERPRISE y BUSINESS');
    assert.deepEqual(
        b2bReport.items.map((i) => i.accountId).sort(),
        ['b2b-centinela', 'b2b-escondida']
    );
    assert.equal(b2bReport.totals.casOriginalBytes, 1_000_000);
    assert.equal(b2bReport.totals.aiRequestsTotal, 2);
    assert.equal(b2bReport.totals.aiTierPro, 1);

    assert.equal(eduReport.count, 1);
    assert.equal(eduReport.items[0].accountId, 'edu-uchile');
    assert.equal(eduReport.totals.aiRequestsTotal, 2);
    assert.equal(eduReport.totals.aiTierFlashLite, 1);
}

async function main(): Promise<void> {
    testResolveEffectiveTierFinOps();
    console.log('✓ [1/4] ResilientAIClient.resolveEffectiveTier (Flash en chat + Flash-Lite en EDU) OK');

    testMultiCountryTaxIdAndE164Validator();
    console.log('✓ [2/4] taxIdValidator (CL, PE, BR, AR, US + ITU-T E.164) OK');

    testConfidentialityAirlockMultiCountryAndUtm();
    console.log('✓ [3/4] ConfidentialityAirlockService (Multi-país + UTM global + WGS84 + preservación OEM) OK');

    await testRetentionPolicyAndSeparatedTenantMetrics();
    console.log('✓ [4/4] retention-policy (6 años / 30d TTL) + TenantMetricsService (B2B vs EDU) OK');

    console.log('✅ BLOQUE 1.2 FINOPS & MULTI-COUNTRY SUITE: TODAS LAS ASERCIONES APROBADAS');
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ FALLO EN BLOQUE 1.2 FINOPS & MULTI-COUNTRY SUITE:', err);
        process.exit(1);
    });
