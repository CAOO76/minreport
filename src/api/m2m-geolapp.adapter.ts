import { type Express, type Response } from 'express';
import { z } from 'zod';
import { db } from '../config/firebase';
import { ConfidentialityAirlockService } from '../core/privacy/ConfidentialityAirlockService';
import { type X402AuthenticatedRequest, x402Gatekeeper } from '../middleware/x402Gatekeeper';

const STOCKPILE_ID_REGEX = /^[A-Za-z0-9._-]{1,128}$/;

const CopperDomainFilterSchema = z.enum([
    'OXIDO_CU',
    'MIXTO_CU',
    'SULFURO_SECUNDARIO_CU',
    'SULFURO_PRIMARIO_CU',
    'CONCENTRADO_CU',
    'BAJA_LEY_CU',
    'ESTERIL_RIPIOS',
]);

const LimitQueryFieldSchema = z
    .union([z.string(), z.number()])
    .optional()
    .transform((val, ctx) => {
        if (val === undefined) return 25;
        const raw = typeof val === 'string' ? val.trim() : val;
        if (raw === '') {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'El parametro limit no puede estar vacio.',
            });
            return z.NEVER;
        }
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'El parametro limit debe ser un entero entre 1 y 100.',
            });
            return z.NEVER;
        }
        return parsed;
    });

const DataFeedQuerySchema = z.object({
    limit: LimitQueryFieldSchema,
});

const GeolappStockpilesQuerySchema = z.object({
    limit: LimitQueryFieldSchema,
    copperDomain: CopperDomainFilterSchema.optional(),
});

const NonStockpileDomainModeFilterSchema = z.enum([
    'GEOMENSURA_GEO',
    'EXPLORACION_SONDAJES',
    'ESTRUCTURAL_HIDRO',
]);

const GeolappDomainRecordsQuerySchema = z.object({
    limit: LimitQueryFieldSchema,
    tenantId: z.string().trim().regex(/^[A-Za-z0-9._-]{1,128}$/).optional(),
    domainMode: NonStockpileDomainModeFilterSchema.optional(),
});

const DossierParamsSchema = z.object({
    stockpileId: z
        .string()
        .trim()
        .regex(STOCKPILE_ID_REGEX, 'stockpileId invalido'),
});

function numOrNull(val: unknown): number | null {
    return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function strOrNull(val: unknown): string | null {
    return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
}

function scrubTextOrNull(val: unknown): string | null {
    const raw = strOrNull(val);
    if (!raw) return null;
    return ConfidentialityAirlockService.scrubDeterministicPii(raw, 'CL').scrubbed;
}

function resolveInlineLatestMeasurement(data: Record<string, any>): Record<string, any> | null {
    const arr = Array.isArray(data.mediciones)
        ? data.mediciones
        : Array.isArray(data.measurements)
        ? data.measurements
        : null;
    if (!arr || arr.length === 0) return null;

    let latest: Record<string, any> = arr[0];
    let latestTs = Number(latest?.timestamp ?? latest?.createdAt ?? 0);
    for (let i = 1; i < arr.length; i++) {
        const candidate = arr[i];
        const ts = Number(candidate?.timestamp ?? candidate?.createdAt ?? 0);
        if (ts >= latestTs) {
            latest = candidate;
            latestTs = ts;
        }
    }
    return latest;
}

async function fetchLatestMeasurementWithFallback(
    stockpileId: string,
    data: Record<string, any>
): Promise<Record<string, any> | null> {
    const inlineLatest = resolveInlineLatestMeasurement(data);
    if (inlineLatest) return inlineLatest;

    const subSnap = await db
        .collection('stockpiles')
        .doc(stockpileId)
        .collection('measurements')
        .get()
        .catch(() => null);

    if (!subSnap || !Array.isArray(subSnap.docs) || subSnap.docs.length === 0) {
        return null;
    }

    let latestDoc: Record<string, any> | null = null;
    let latestTs = -Infinity;
    for (const mDoc of subSnap.docs) {
        const mData = mDoc.data() || {};
        const ts = Number(mData.timestamp ?? mData.createdAt ?? 0);
        if (!latestDoc || ts >= latestTs) {
            latestDoc = { id: mDoc.id, ...mData };
            latestTs = ts;
        }
    }
    return latestDoc;
}

async function queryTenantStockpileDocs(
    tenantId: string,
    limit: number
): Promise<Array<{ id: string; data: Record<string, any> }>> {
    const byTenantSnap = await db
        .collection('stockpiles')
        .where('tenantId', '==', tenantId)
        .limit(limit)
        .get()
        .catch(() => null);

    let docs = Array.isArray(byTenantSnap?.docs) ? byTenantSnap!.docs : [];
    if (docs.length === 0) {
        const byAccountSnap = await db
            .collection('stockpiles')
            .where('accountId', '==', tenantId)
            .limit(limit)
            .get()
            .catch(() => null);
        docs = Array.isArray(byAccountSnap?.docs) ? byAccountSnap!.docs : [];
    }

    const mapped: Array<{ id: string; data: Record<string, any> }> = [];
    for (const doc of docs) {
        const data = doc.data() || {};
        const ownerTenant = String(data.tenantId || data.accountId || '').trim();
        if (ownerTenant && ownerTenant !== tenantId) continue;
        mapped.push({ id: doc.id, data });
    }
    return mapped.slice(0, limit);
}

function buildGeolappStockpileFeedItem(
    stockpileId: string,
    d: Record<string, any>,
    latestMeas: Record<string, any> | null
) {
    const rosinRammler = d.rosin_rammler ?? latestMeas?.rosin_rammler ?? null;
    const meshSha256 = strOrNull(d.mesh_sha256 ?? latestMeas?.mesh_sha256);

    return {
        id: stockpileId,
        name: scrubTextOrNull(d.name),
        materialType: scrubTextOrNull(d.materialType ?? d.clase),
        copperDomain: strOrNull(d.copper_domain ?? latestMeas?.copper_domain),
        volumeM3: numOrNull(
            d.last_volume_m3 ?? d.volume_m3 ?? d.volumen ?? latestMeas?.volumen ?? d.tin_volume_m3
        ),
        wetWeightThm: numOrNull(
            d.wet_weight_thm ??
                latestMeas?.wet_weight_thm ??
                d.last_weight_t ??
                d.peso_final_toneladas ??
                latestMeas?.peso_final_toneladas
        ),
        dryWeightTms: numOrNull(d.dry_weight_tms ?? latestMeas?.dry_weight_tms),
        moisturePct: numOrNull(d.moisture_pct ?? latestMeas?.moisture_pct),
        cuTotalPct: numOrNull(d.cu_total_pct ?? latestMeas?.cu_total_pct),
        cuSolublePct: numOrNull(d.cu_soluble_pct ?? latestMeas?.cu_soluble_pct),
        fineCuT: numOrNull(d.fine_cu_t ?? latestMeas?.fine_cu_t),
        p80Mm: numOrNull(
            d.p80_mm ?? rosinRammler?.p80_mm ?? latestMeas?.p80_mm ?? latestMeas?.rosin_rammler?.p80_mm
        ),
        tinVolumeM3: numOrNull(d.tin_volume_m3 ?? latestMeas?.tin_volume_m3),
        meshSha256,
        meshUrl: strOrNull(d.mesh_url ?? latestMeas?.mesh_url),
        locationRef: scrubTextOrNull(d.location_ref),
        recordedAt: d.updatedAt ?? d.last_measured_at ?? latestMeas?.timestamp ?? d.createdAt ?? null,
    };
}

function resolveSettlementMode(req: X402AuthenticatedRequest): string {
    return req.x402Context?.mode || 'CORPORATE_CONTRACT';
}

function getTreasuryWallet(): string {
    return process.env.X402_TREASURY_ACCOUNT || 'minreport-treasury-southamerica-west1';
}

export function registerM2mGeolappAdapterRoutes(app: Express): void {
    const treasuryWallet = getTreasuryWallet();

    /**
     * GET /api/m2m/data-feed
     * Feed M2M soberano protegido por x402 para telemetria GEOLAPP®.
     */
    app.get(
        '/api/m2m/data-feed',
        x402Gatekeeper({
            priceMicroUSD: 25000,
            destinationWallet: treasuryWallet,
            acceptedTokens: ['USDC', 'X402_CREDIT'],
            resourceId: 'mining-telemetry-feed',
        }),
        async (req: X402AuthenticatedRequest, res: Response) => {
            const parsedQuery = DataFeedQuerySchema.safeParse(req.query || {});
            if (!parsedQuery.success) {
                return res.status(400).json({
                    error: 'Query invalida para /api/m2m/data-feed.',
                    details: parsedQuery.error.flatten(),
                });
            }

            try {
                const { limit } = parsedQuery.data;
                const x402Ctx = req.x402Context;
                const scopedTenantId = x402Ctx?.tenantId ? String(x402Ctx.tenantId).trim() : null;

                let rawDocs: Array<{ id: string; data: Record<string, any> }> = [];
                if (scopedTenantId) {
                    rawDocs = await queryTenantStockpileDocs(scopedTenantId, limit);
                } else {
                    const publicSnap = await db
                        .collection('stockpiles')
                        .where('isPublicBenchmark', '==', true)
                        .limit(limit)
                        .get()
                        .catch(() => null);
                    rawDocs = (publicSnap?.docs || []).map((doc) => ({
                        id: doc.id,
                        data: doc.data() || {},
                    }));
                }

                const stockpiles = await Promise.all(
                    rawDocs.map(async ({ id, data }) => {
                        const latestMeas = await fetchLatestMeasurementWithFallback(id, data);
                        return buildGeolappStockpileFeedItem(id, data, latestMeas);
                    })
                );

                return res.status(200).json({
                    status: 'success',
                    protocol: 'x402',
                    settlementMode: resolveSettlementMode(req),
                    region: 'southamerica-west1',
                    data: {
                        tenantId: scopedTenantId,
                        timestamp: new Date().toISOString(),
                        stockpiles,
                    },
                });
            } catch (err) {
                console.error('[M2M-GEOLAPP-ADAPTER] Error en /api/m2m/data-feed:', err);
                return res.status(500).json({
                    error: 'Error consultando feed operacional GEOLAPP®.',
                });
            }
        }
    );

    /**
     * GET /api/m2m/geolapp/stockpiles
     * Consulta paginada multi-tenant de acopios GEOLAPP® con filtro por dominio cuprifero.
     */
    app.get(
        '/api/m2m/geolapp/stockpiles',
        x402Gatekeeper({
            priceMicroUSD: 25000,
            destinationWallet: treasuryWallet,
            acceptedTokens: ['USDC', 'X402_CREDIT'],
            resourceId: 'geolapp-copper-stockpiles',
        }),
        async (req: X402AuthenticatedRequest, res: Response) => {
            const parsedQuery = GeolappStockpilesQuerySchema.safeParse(req.query || {});
            if (!parsedQuery.success) {
                return res.status(400).json({
                    error: 'Parametros de consulta invalidos para acopios GEOLAPP®.',
                    details: parsedQuery.error.flatten(),
                });
            }

            const scopedTenantId = req.x402Context?.tenantId
                ? String(req.x402Context.tenantId).trim()
                : '';
            if (!scopedTenantId) {
                return res.status(403).json({
                    error: 'TENANT_SCOPE_REQUIRED: Se requiere tenantId autenticado para acceder a acopios privados.',
                });
            }

            try {
                const { limit, copperDomain } = parsedQuery.data;
                const rawDocs = await queryTenantStockpileDocs(scopedTenantId, limit);

                const enriched = await Promise.all(
                    rawDocs.map(async ({ id, data }) => {
                        const latestMeas = await fetchLatestMeasurementWithFallback(id, data);
                        return buildGeolappStockpileFeedItem(id, data, latestMeas);
                    })
                );

                const filtered = copperDomain
                    ? enriched.filter((item) => item.copperDomain === copperDomain)
                    : enriched;

                return res.status(200).json({
                    status: 'success',
                    protocol: 'x402',
                    settlementMode: resolveSettlementMode(req),
                    region: 'southamerica-west1',
                    data: {
                        tenantId: scopedTenantId,
                        timestamp: new Date().toISOString(),
                        copperDomainFilter: copperDomain || null,
                        total: filtered.length,
                        stockpiles: filtered,
                    },
                });
            } catch (err) {
                console.error('[M2M-GEOLAPP-ADAPTER] Error en /api/m2m/geolapp/stockpiles:', err);
                return res.status(500).json({
                    error: 'Error consultando acopios cupriferos GEOLAPP®.',
                });
            }
        }
    );

    /**
     * GET /api/m2m/geolapp/stockpiles/:stockpileId/dossier
     * Dossier tecnico M2M completo: balance metalurgico Cu, granulometria Rosin-Rammler y metadatos CAS 3D .glb.
     */
    app.get(
        '/api/m2m/geolapp/stockpiles/:stockpileId/dossier',
        x402Gatekeeper({
            priceMicroUSD: 35000,
            destinationWallet: treasuryWallet,
            acceptedTokens: ['USDC', 'X402_CREDIT'],
            resourceId: 'geolapp-stockpile-dossier-3d',
        }),
        async (req: X402AuthenticatedRequest, res: Response) => {
            const parsedParams = DossierParamsSchema.safeParse(req.params || {});
            if (!parsedParams.success) {
                return res.status(400).json({
                    error: 'Identificador de acopio invalido.',
                    details: parsedParams.error.flatten(),
                });
            }

            const scopedTenantId = req.x402Context?.tenantId
                ? String(req.x402Context.tenantId).trim()
                : '';
            if (!scopedTenantId) {
                return res.status(403).json({
                    error: 'TENANT_SCOPE_REQUIRED: Se requiere tenantId autenticado para consultar dossier 3D.',
                });
            }

            try {
                const { stockpileId } = parsedParams.data;
                const docSnap = await db.collection('stockpiles').doc(stockpileId).get();
                if (!docSnap.exists) {
                    return res.status(404).json({ error: 'Acopio no encontrado.' });
                }

                const d = docSnap.data() || {};
                const docTenantId = String(d.tenantId || d.accountId || '').trim();
                if (!docTenantId || docTenantId !== scopedTenantId) {
                    return res.status(403).json({
                        error: 'TENANT_ACCESS_DENIED: Acopio pertenece a otro tenant.',
                    });
                }

                const latestMeas = await fetchLatestMeasurementWithFallback(stockpileId, d);
                const rosinRammler = d.rosin_rammler ?? latestMeas?.rosin_rammler ?? null;
                const scrubbedAlerts = Array.isArray(d.copper_governance_alerts)
                    ? d.copper_governance_alerts.map((a: any) => ({
                          ...a,
                          message: scrubTextOrNull(a?.message),
                      }))
                    : [];

                return res.status(200).json({
                    status: 'success',
                    protocol: 'x402',
                    settlementMode: resolveSettlementMode(req),
                    region: 'southamerica-west1',
                    data: {
                        tenantId: scopedTenantId,
                        stockpileId,
                        timestamp: new Date().toISOString(),
                        name: scrubTextOrNull(d.name),
                        clase: scrubTextOrNull(d.clase ?? d.materialType),
                        status: strOrNull(d.status),
                        locationRef: scrubTextOrNull(d.location_ref),
                        copperBalance: {
                            copperDomain: strOrNull(d.copper_domain ?? latestMeas?.copper_domain),
                            volumeM3: numOrNull(
                                d.last_volume_m3 ??
                                    d.volume_m3 ??
                                    d.volumen ??
                                    latestMeas?.volumen ??
                                    d.tin_volume_m3
                            ),
                            wetWeightThm: numOrNull(
                                d.wet_weight_thm ??
                                    latestMeas?.wet_weight_thm ??
                                    d.last_weight_t ??
                                    d.peso_final_toneladas ??
                                    latestMeas?.peso_final_toneladas
                            ),
                            dryWeightTms: numOrNull(d.dry_weight_tms ?? latestMeas?.dry_weight_tms),
                            moisturePct: numOrNull(d.moisture_pct ?? latestMeas?.moisture_pct),
                            tmlPct: numOrNull(d.tml_pct ?? latestMeas?.tml_pct),
                            cuTotalPct: numOrNull(d.cu_total_pct ?? latestMeas?.cu_total_pct),
                            cuSolublePct: numOrNull(d.cu_soluble_pct ?? latestMeas?.cu_soluble_pct),
                            fineCuT: numOrNull(d.fine_cu_t ?? latestMeas?.fine_cu_t),
                            residenceDays: numOrNull(
                                d.residence_days ?? latestMeas?.residence_days
                            ),
                            governanceAlerts: scrubbedAlerts,
                        },
                        granulometry: {
                            tipoGranulometria: strOrNull(
                                d.tipo_granulometria ?? latestMeas?.tipo_granulometria
                            ),
                            p80Mm: numOrNull(
                                d.p80_mm ??
                                    rosinRammler?.p80_mm ??
                                    latestMeas?.p80_mm ??
                                    latestMeas?.rosin_rammler?.p80_mm
                            ),
                            rosinRammler,
                        },
                        digitalTwin3d: {
                            meshUrl: strOrNull(d.mesh_url ?? latestMeas?.mesh_url),
                            meshSha256: strOrNull(d.mesh_sha256 ?? latestMeas?.mesh_sha256),
                            tinVolumeM3: numOrNull(d.tin_volume_m3 ?? latestMeas?.tin_volume_m3),
                            originalBytes: numOrNull(
                                d.mesh_original_bytes ?? latestMeas?.mesh_original_bytes
                            ),
                            optimizedBytes: numOrNull(
                                d.mesh_optimized_bytes ?? latestMeas?.mesh_optimized_bytes
                            ),
                            savingsPct: numOrNull(
                                d.mesh_savings_pct ?? latestMeas?.mesh_savings_pct
                            ),
                            source: strOrNull(d.mesh_source ?? latestMeas?.mesh_source),
                            vertexCount: numOrNull(
                                d.mesh_vertex_count ?? latestMeas?.mesh_vertex_count
                            ),
                            triangleCount: numOrNull(
                                d.mesh_triangle_count ?? latestMeas?.mesh_triangle_count
                            ),
                            surfaceAreaM2: numOrNull(
                                d.mesh_surface_area_m2 ?? latestMeas?.mesh_surface_area_m2
                            ),
                            boundingBoxM: d.mesh_bounding_box_m ?? latestMeas?.mesh_bounding_box_m ?? null,
                            reconstructedAt:
                                d.mesh_reconstructed_at ?? latestMeas?.mesh_reconstructed_at ?? null,
                        },
                    },
                });
            } catch (err) {
                console.error(
                    '[M2M-GEOLAPP-ADAPTER] Error en /api/m2m/geolapp/stockpiles/:stockpileId/dossier:',
                    err
                );
                return res.status(500).json({
                    error: 'Error generando dossier tecnico M2M GEOLAPP®.',
                });
            }
        }
    );

    /**
     * GET /api/m2m/geolapp/domain-records
     * Consulta paginada multi-tenant M2M de registros geocientíficos (Geomensura, Sondajes, Estructural/Hidro).
     */
    app.get(
        '/api/m2m/geolapp/domain-records',
        x402Gatekeeper({
            priceMicroUSD: 25000,
            destinationWallet: treasuryWallet,
            acceptedTokens: ['USDC', 'X402_CREDIT'],
            resourceId: 'geolapp-domain-records-v1',
        }),
        async (req: X402AuthenticatedRequest, res: Response) => {
            const parsedQuery = GeolappDomainRecordsQuerySchema.safeParse(req.query || {});
            if (!parsedQuery.success) {
                return res.status(400).json({
                    error: 'Parametros de consulta invalidos para registros geocientificos GEOLAPP®.',
                    details: parsedQuery.error.flatten(),
                });
            }

            const scopedTenantId = req.x402Context?.tenantId
                ? String(req.x402Context.tenantId).trim()
                : '';
            const requestedTenantId = parsedQuery.data.tenantId
                ? String(parsedQuery.data.tenantId).trim()
                : '';

            if (!scopedTenantId) {
                return res.status(403).json({
                    error: 'TENANT_SCOPE_REQUIRED: Se requiere tenantId autenticado para acceder a registros geocientificos privados.',
                });
            }

            if (requestedTenantId && requestedTenantId !== scopedTenantId) {
                return res.status(403).json({
                    error: 'TENANT_SCOPE_MISMATCH: El tenantId consultado no coincide con la credencial M2M activa.',
                });
            }

            try {
                const { limit, domainMode } = parsedQuery.data;
                const snap = await db
                    .collection('geolapp_records')
                    .where('tenantId', '==', scopedTenantId)
                    .get();

                const mapped = snap.docs
                    .map((doc) => {
                        const d = (doc.data() || {}) as Record<string, any>;
                        const ownerTenant = String(d.tenantId || d.accountId || '').trim();
                        if (ownerTenant !== scopedTenantId) return null;
                        if (domainMode && d.domainMode !== domainMode) return null;

                        return {
                            id: doc.id,
                            tenantId: scopedTenantId,
                            accountId: scopedTenantId,
                            domainMode: d.domainMode,
                            code: scrubTextOrNull(d.code),
                            title: scrubTextOrNull(d.title),
                            status: d.status || 'ACTIVE',
                            utmFix: d.utmFix || null,
                            payload: d.payload || null,
                            notes: scrubTextOrNull(d.notes),
                            createdAt: d.createdAt ?? null,
                            updatedAt: d.updatedAt ?? null,
                        };
                    })
                    .filter((item): item is NonNullable<typeof item> => item !== null)
                    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
                    .slice(0, limit);

                return res.status(200).json({
                    status: 'success',
                    protocol: 'x402',
                    settlementMode: resolveSettlementMode(req),
                    region: 'southamerica-west1',
                    data: {
                        tenantId: scopedTenantId,
                        timestamp: new Date().toISOString(),
                        domainModeFilter: domainMode || null,
                        total: mapped.length,
                        records: mapped,
                    },
                });
            } catch (err) {
                console.error(
                    '[M2M-GEOLAPP-ADAPTER] Error en /api/m2m/geolapp/domain-records:',
                    err
                );
                return res.status(500).json({
                    error: 'Error consultando registros geocientificos GEOLAPP®.',
                });
            }
        }
    );
}
