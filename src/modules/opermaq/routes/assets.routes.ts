import { createHash } from 'crypto';
import { Router, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../../../config/firebase';
import { AuditLedger } from '../../../core/audit-ledger';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { AISwarmUnavailableError, UngroundedEvidenceError } from '../../../core/resilient-ai-client';
import type { ScopedRequest } from '../../../middleware/sessionScope';
import { inferAssetPhysicalTraits } from '../services/AssetOntologyEngine';
import { resolveMachineryCandidates } from '../services/AssetResolverService';
import { resolveFromLocalCommonsCatalog } from '../services/CanonicalEntityResolver';
import { enrichCatalogProfile, proposeCatalogHomologation } from '../services/CatalogProfileEnricher';
import { upsertGlobalAssetCatalog } from '../services/CatalogUpsertService';
import {
    listRegisteredEquipmentTypes,
    resolveOrLearnEquipmentType,
} from '../services/EquipmentTypeRegistryService';
import {
    ApplyCatalogHomologationBodySchema,
    FleetUnitRegistrationBodySchema,
    HITL_CONFIRM_KEYWORD,
    ResolveAssetBodySchema,
} from '../types/vault.types';
import {
    buildHomologousEquipmentDescription,
    cleanDynamicAxisValue,
    extractHomologousAxisValues,
    MISSING_FULL_TECH_SPEC,
    serializeCanonicalSlotsToSpecsArray,
    type CanonicalSpecSlot,
    type MachineryArchetypeId,
} from '../utils/canonicalArchetypeSpecs';
import { DomainRejectionError, validateIndustrialDomain } from '../utils/domainGuard';

/**
 * OPERMAQ — Assets Routes (Etapa 1: Catálogo Maestro OEM y Control de Flota por Tenant)
 *
 * 100% Independiente de la Bóveda de 5 Pilares (`knowledge_vault: null`).
 * 100% Subordinado a `req.opermaqContext` inyectado por MINREPORT Core.
 */

const assetsRouter = Router();
const uploadPrivatePhoto = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
});

function normalizeCompactOwnershipId(raw: string): string {
    return String(raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

const ACCESSORY_SPEC_REGEX =
    /per[ií]odo\s+de\s+(producci[oó]n|fabricaci[oó]n)|a[ñn]os?\s+de\s+(producci[oó]n|fabricaci[oó]n|lanzamiento|comercializaci[oó]n)|introducid[oa]\s+en|fabricad[oa]\s+(entre|desde|en)|lanzad[oa]\s+en|primera\s+generaci[oó]n|evoluci[oó]n\s+serie|reemplaz[ao]\s+al|sucesor\s+de|antecesor\s+de|pa[ií]s\s+de\s+origen|\b(19|20)\d{2}\s*[-–—/]\s*((19|20)\d{2}|presente|actualidad|hoy)\b|\b(19|20)\d{2}\+\b/i;

function cleanMachineryType(rawType: unknown): string {
    const base = String(rawType || '').trim();
    if (!base || base.startsWith('[')) return '[Información técnica no declarada en ficha]';
    const cleaned = base
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\b(19|20)\d{2}\s*[-–—/]\s*((19|20)\d{2}|presente|actualidad)\b/gi, ' ')
        .replace(/\b(19|20)\d{2}\+\b/g, ' ')
        .replace(/\s*[-–—]\s*serie\s+[a-z0-9-]+$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || base;
}

function sanitizeOperationalSpec(raw: unknown): string | null {
    const trimmed = String(raw || '').trim();
    if (!trimmed || trimmed.startsWith('[') || ACCESSORY_SPEC_REGEX.test(trimmed)) {
        return null;
    }
    const segments = trimmed
        .split(/\s*[—–]\s*/)
        .map((seg) =>
            seg
                .replace(/\(EU\s+Stage[^)]*\)/gi, '')
                .replace(/\(Tier\s+\d[^)]*\)/gi, '')
                .replace(/\(ROC\)/gi, '')
                .replace(/\s+([,.;:])/g, '$1')
                .replace(/\s+/g, ' ')
                .trim()
        )
        .filter((seg) => seg.length > 0 && !ACCESSORY_SPEC_REGEX.test(seg));

    if (segments.length === 0) return null;
    if (
        segments.length >= 2 &&
        /^motor\b/i.test(segments[0]) &&
        !/\d+\s*(kw|hp|cv|l\/min|bar|mpa|kg|t\b|nm)/i.test(segments[0])
    ) {
        return segments.slice(1).join(' · ');
    }
    return segments.join(' · ');
}

/**
 * Proyecta determinísticamente la firma física homóloga del equipo según su arquetipo mecánico,
 * sin prosa comercial, sin alucinaciones y sin truncamiento de caracteres.
 */
function buildConciseEquipmentDescription(docData: Record<string, any>): string {
    return buildHomologousEquipmentDescription(docData);
}

function handleRouteError(res: Response, err: unknown, fallbackMsg: string) {
    if (err instanceof DomainRejectionError) {
        return res.status(422).json({
            error: 'DOMINIO_NO_PERMITIDO',
            message: err.message,
        });
    }
    if (err instanceof UngroundedEvidenceError) {
        return res.status(422).json({
            error: err.code,
            message: err.message,
        });
    }
    if (err instanceof AISwarmUnavailableError) {
        return res.status(503).json({
            error: err.code,
            message: err.message,
        });
    }
    const anyErr = err as any;
    const status = typeof anyErr?.statusCode === 'number' ? anyErr.statusCode : 500;
    return res.status(status).json({
        error: anyErr?.message || fallbackMsg,
    });
}

const CATALOG_PROJECTED_FIELDS = [
    'make_oficial',
    'make',
    'model_oficial',
    'model',
    'equipment_type_key',
    'archetype_id',
    'physical_traits',
    'tipo_equipo',
    'categoria_equipo',
    'canonical_specs',
    'contexto_operativo',
    'caracteristicas_principales',
    'foto_url',
    'official_url',
    'versions',
    'chassis_versions',
    'version',
    'search_aliases',
    'is_generic',
    'catalog_key',
    'knowledge_vault',
    'archived',
] as const;

const CATALOG_CACHE_TTL_MS = 30_000;
let catalogProjectionCache: {
    expiresAt: number;
    docs: Array<{ id: string; data: Record<string, any> }>;
} | null = null;

export function invalidateCatalogProjectionCache(): void {
    catalogProjectionCache = null;
}

async function getProjectedCatalogDocs(): Promise<Array<{ id: string; data: Record<string, any> }>> {
    if (catalogProjectionCache && Date.now() < catalogProjectionCache.expiresAt) {
        return catalogProjectionCache.docs;
    }
    const snap = await db
        .collection('global_asset_catalog')
        .select(...CATALOG_PROJECTED_FIELDS)
        .get();
    const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
    catalogProjectionCache = {
        expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
        docs,
    };
    return docs;
}

function resolveFleetCollectionName(ctx: ScopedRequest['opermaqContext']): string {
    return ctx?.isEduSandbox ? 'edu_sandbox_fleet' : 'tenant_assets';
}

function countPublishedVaultPillars(knowledgeVault: Record<string, any> | null | undefined): number {
    if (!knowledgeVault || typeof knowledgeVault !== 'object') return 0;
    const pillarIds = [
        'ficha_tecnica',
        'manual_operaciones',
        'pauta_mantencion',
        'matriz_riesgos',
        'checklist_pre_op',
    ];
    let count = 0;
    for (const pid of pillarIds) {
        const pSummary = knowledgeVault[pid];
        if (!pSummary || typeof pSummary !== 'object') continue;
        if (typeof pSummary.approved_items_count === 'number' && pSummary.approved_items_count > 0) {
            count += 1;
            continue;
        }
        const items: any[] = Array.isArray(pSummary.items) ? pSummary.items : [];
        const hasApproved = items.some(
            (it) =>
                !it?.is_discarded &&
                it?.content_status === 'COMPLETADO' &&
                (it?.estado_aprobacion === 'APROBADO_HUMANO' || it?.status === 'APROBADO_HUMANO') &&
                Boolean(String(it?.content || '').trim())
        );
        if (hasApproved) count += 1;
    }
    return count;
}

/**
 * GET /api/assets/equipment-types
 * Lista los esquemas de `TIPO` registrados en `global_equipment_types` (semilla ISO + aprendidos dinámicamente).
 */
assetsRouter.get('/equipment-types', async (_req: ScopedRequest, res: Response) => {
    try {
        const items = await listRegisteredEquipmentTypes();
        return res.status(200).json({ items });
    } catch (err) {
        return handleRouteError(res, err, 'Error consultando esquemas de tipos de equipo.');
    }
});

/**
 * GET /api/assets/catalog
 * Listado íntegro del Catálogo Maestro OEM (`global_asset_catalog`) exclusivo para
 * curadores soberanos (`DEV` / `ADMIN` / `TEST-PILOT`). Ordenado por Marca -> Tipo -> Modelo.
 */
assetsRouter.get('/catalog', async (req: ScopedRequest, res: Response) => {
    try {
        const caps = req.opermaqContext?.capabilities;
        if (!caps?.canViewMasterCatalog && !caps?.canCurateAI) {
            return res.status(403).json({
                error: 'CATALOG_CURATOR_ONLY',
                message: 'El Catálogo Maestro completo es exclusivo de ingeniería, administración y curaduría MINREPORT.',
            });
        }

        const docs = await getProjectedCatalogDocs();
        const items = docs
            .map((docEntry) => {
                const d = docEntry.data || {};
                if (d.archived === true) return null;
                const makeOficial = String(
                    d.make_oficial || d.make || MISSING_FULL_TECH_SPEC
                ).trim();
                const modelOficial = String(d.model_oficial || d.model || '').trim();
                const tipoEquipo = cleanMachineryType(
                    d.tipo_equipo || d.categoria_equipo || MISSING_FULL_TECH_SPEC
                );
                const homologous = extractHomologousAxisValues(d);
                const physicalTraits =
                    d.physical_traits ||
                    inferAssetPhysicalTraits({
                        rawTypeText: tipoEquipo,
                        rawCategoryText: d.categoria_equipo,
                        makeModelText: `${makeOficial} ${modelOficial}`,
                    });

                return {
                    id: docEntry.id,
                    make_oficial: makeOficial || MISSING_FULL_TECH_SPEC,
                    model_oficial: modelOficial,
                    equipment_type_key: d.equipment_type_key ? String(d.equipment_type_key) : undefined,
                    archetype_id: homologous.archetype.id,
                    physical_traits: physicalTraits,
                    tipo_equipo: tipoEquipo,
                    categoria_equipo: d.categoria_equipo ? String(d.categoria_equipo) : undefined,
                    canonical_specs: homologous.slots,
                    contexto_operativo: Array.isArray(d.contexto_operativo) ? d.contexto_operativo : [],
                    caracteristicas_principales: serializeCanonicalSlotsToSpecsArray(homologous.slots),
                    short_description: buildConciseEquipmentDescription(d),
                    foto_url: d.foto_url ? String(d.foto_url) : undefined,
                    published_pillars_count: countPublishedVaultPillars(d.knowledge_vault),
                };
            })
            .filter((row): row is NonNullable<typeof row> => row !== null)
            .sort((a, b) => {
                const byBrand = a.make_oficial.localeCompare(b.make_oficial, 'es', { sensitivity: 'base' });
                if (byBrand !== 0) return byBrand;
                const byType = a.tipo_equipo.localeCompare(b.tipo_equipo, 'es', { sensitivity: 'base' });
                if (byType !== 0) return byType;
                return a.model_oficial.localeCompare(b.model_oficial, 'es', {
                    sensitivity: 'base',
                    numeric: true,
                });
            });

        return res.status(200).json({ items });
    } catch (err) {
        return handleRouteError(res, err, 'Error listando el Catálogo Maestro.');
    }
});

/**
 * POST /api/assets/catalog/:id/propose-homologation
 * Propuesta HITL de solo lectura (`[Actual] ➔ [Sugerido Grounded]`) mediante el pipeline
 * de 2 pasadas con evidencia web/PDF obligatoria. Cero mutación automática de datos maestros.
 */
assetsRouter.post('/catalog/:id/propose-homologation', async (req: ScopedRequest, res: Response) => {
    try {
        if (!req.opermaqContext?.capabilities?.canCurateAI) {
            return res.status(403).json({
                error: 'CATALOG_CURATOR_ONLY',
                message: 'La verificación y homologación del Catálogo Maestro es exclusiva de curadores MINREPORT.',
            });
        }

        const docId = String(req.params.id || '').trim();
        const docSnap = await db.collection('global_asset_catalog').doc(docId).get();
        if (!docSnap.exists) {
            return res.status(404).json({ error: 'Equipo no encontrado en el Catálogo Maestro.' });
        }

        const proposal = await proposeCatalogHomologation(docId, docSnap.data() || {});
        return res.status(200).json({ success: true, proposal });
    } catch (err) {
        return handleRouteError(res, err, 'Error generando propuesta de homologación verificada.');
    }
});

/**
 * PATCH /api/assets/catalog/:id/apply-homologation
 * Consolida únicamente los ejes físicos autorizados 1 a 1 por un humano tras escribir `"ACTUALIZAR"`,
 * validados contra el esquema canónico del `TIPO` (`global_equipment_types/{typeKey}`),
 * purga cualquier `caracteristica_diferenciadora` de prosa previa y registra el evento en `AuditLedger`.
 */
assetsRouter.patch('/catalog/:id/apply-homologation', async (req: ScopedRequest, res: Response) => {
    try {
        const ctx = req.opermaqContext!;
        if (!ctx.capabilities.canCurateAI) {
            return res.status(403).json({
                error: 'CATALOG_CURATOR_ONLY',
                message: 'Permisos insuficientes para modificar registros maestros del Catálogo.',
            });
        }

        const parsed = ApplyCatalogHomologationBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Payload de homologación inválido.',
                details: parsed.error.format(),
            });
        }

        const body = parsed.data;
        if (body.confirm_word.trim().toUpperCase() !== HITL_CONFIRM_KEYWORD) {
            return res.status(400).json({
                error: `Confirmación obligatoria inválida. Escriba exactamente "${HITL_CONFIRM_KEYWORD}".`,
            });
        }

        const docId = String(req.params.id || '').trim();
        const docRef = db.collection('global_asset_catalog').doc(docId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return res.status(404).json({ error: 'Equipo no encontrado en el Catálogo Maestro.' });
        }

        const existingData = docSnap.data() || {};
        const nextTipoHint = body.tipo_equipo
            ? cleanMachineryType(body.tipo_equipo)
            : cleanMachineryType(existingData.tipo_equipo);
        const nextCategoria = (
            body.categoria_equipo ||
            existingData.categoria_equipo ||
            'EQUIPAMIENTO INDUSTRIAL'
        )
            .trim()
            .toUpperCase();

        const { typeDoc } = await resolveOrLearnEquipmentType({
            rawTypeKey: body.equipment_type_key || existingData.equipment_type_key,
            rawTypeHint: nextTipoHint,
            rawCategoryHint: nextCategoria,
            assetQueryContext: `${existingData.make_oficial || ''} ${existingData.model_oficial || ''}`.trim(),
        });

        const targetArchetypeId: MachineryArchetypeId =
            typeDoc.archetype_id || 'HERRAMIENTA_INDUSTRIAL_GENERAL';
        const finalCanonicalTipo = typeDoc.canonical_type_es;

        const incomingMap = new Map(body.approved_slots.map((s) => [s.axis_key, s]));
        const consolidatedSlots: CanonicalSpecSlot[] = typeDoc.spec_schema.map((axisSchema) => {
            const incoming = incomingMap.get(axisSchema.axis_key);
            const cleaned = incoming?.value_si
                ? cleanDynamicAxisValue(incoming.value_si, axisSchema)
                : null;
            return {
                axis_key: axisSchema.axis_key,
                label_es: axisSchema.label_es,
                value_si: cleaned,
                unit_si: axisSchema.unit_si,
                mandatory: axisSchema.mandatory,
                is_differentiator: axisSchema.is_differentiator,
                value_kind: axisSchema.value_kind,
                ...(axisSchema.allowed_enum_values ? { allowed_enum_values: axisSchema.allowed_enum_values } : {}),
                source_url: cleaned ? incoming?.source_url || null : null,
                verbatim_evidence: cleaned ? incoming?.verbatim_evidence || null : null,
            };
        });

        const serializedSpecs = serializeCanonicalSlotsToSpecsArray(consolidatedSlots);
        const resolvedTraits =
            body.physical_traits ||
            typeDoc.physical_traits ||
            inferAssetPhysicalTraits({
                rawTypeText: finalCanonicalTipo,
                rawCategoryText: nextCategoria,
                makeModelText: `${existingData.make_oficial || ''} ${existingData.model_oficial || ''}`.trim(),
            });
        const updatePayload: Record<string, any> = {
            equipment_type_key: typeDoc.type_key,
            archetype_id: targetArchetypeId,
            physical_traits: resolvedTraits,
            tipo_equipo: finalCanonicalTipo,
            categoria_equipo: nextCategoria,
            canonical_specs: consolidatedSlots,
            caracteristicas_principales: serializedSpecs,
            caracteristica_diferenciadora: FieldValue.delete(),
            homologated_by: ctx.actorEmail,
            homologated_at: new Date().toISOString(),
            updatedAt: Date.now(),
        };
        if (body.energy_consumption_profile) {
            updatePayload.energy_consumption_profile = body.energy_consumption_profile;
        }
        if (body.official_url && body.official_url.startsWith('http')) {
            updatePayload.official_url = body.official_url.trim();
        }

        await docRef.update(updatePayload);
        invalidateCatalogProjectionCache();

        const updatedRecord = {
            ...existingData,
            equipment_type_key: typeDoc.type_key,
            archetype_id: targetArchetypeId,
            tipo_equipo: finalCanonicalTipo,
            categoria_equipo: nextCategoria,
            canonical_specs: consolidatedSlots,
            caracteristicas_principales: serializedSpecs,
        };
        delete (updatedRecord as any).caracteristica_diferenciadora;

        await AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            action: 'OPERMAQ_CATALOG_HOMOLOGATION_HITL_APPLIED',
            module: 'opermaq',
            targetEntity: docId,
            details: {
                equipmentTypeKey: typeDoc.type_key,
                archetypeId: targetArchetypeId,
                tipoEquipo: finalCanonicalTipo,
                verifiedSlotsCount: consolidatedSlots.filter((s) => Boolean(s.value_si)).length,
            },
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            id: docId,
            equipment_type_key: typeDoc.type_key,
            archetype_id: targetArchetypeId,
            tipo_equipo: finalCanonicalTipo,
            canonical_specs: consolidatedSlots,
            short_description: buildHomologousEquipmentDescription(updatedRecord),
        });
    } catch (err) {
        return handleRouteError(res, err, 'Error aplicando homologación HITL en el Catálogo Maestro.');
    }
});

/**
 * GET /api/assets/catalog-lookup
 * Detección instantánea (< 35 ms) sobre el Catálogo Maestro (`global_asset_catalog`)
 * antes de activar el buscador de candidatos IA durante el alta de equipos en FLOTA.
 */
assetsRouter.get('/catalog-lookup', async (req: ScopedRequest, res: Response) => {
    const start = Date.now();
    try {
        const rawQuery = String(req.query.q || '').trim();
        const isGeneric = String(req.query.isGeneric || 'false') === 'true';

        if (rawQuery.length < 2) {
            return res.status(200).json({
                matched: false,
                tier: 'NONE',
                latencyMs: Date.now() - start,
                items: [],
            });
        }

        const localHit = await resolveFromLocalCommonsCatalog(rawQuery, isGeneric);
        const foundMap = new Map<string, Record<string, any>>();

        for (const c of localHit.candidates) {
            const gid = c.global_asset_id || c.existing_catalog_id || c.catalog_key || '';
            if (!gid) continue;
            const cleanSpecs = Array.isArray(c.caracteristicas_principales)
                ? c.caracteristicas_principales
                      .map(sanitizeOperationalSpec)
                      .filter((s): s is string => Boolean(s))
                : [];
            foundMap.set(gid, {
                global_asset_id: gid,
                catalog_key: c.catalog_key || gid,
                make_oficial: c.make_oficial,
                model_oficial: c.model_oficial,
                tipo_equipo: cleanMachineryType(c.tipo_equipo),
                categoria_equipo: c.categoria_equipo,
                contexto_operativo: Array.isArray(c.contexto_operativo) ? c.contexto_operativo : [],
                caracteristicas_principales: cleanSpecs,
                short_description: buildConciseEquipmentDescription(c),
                versions:
                    Array.isArray(c.versions) && c.versions.length > 0
                        ? c.versions
                        : Array.isArray(c.chassis_versions) && c.chassis_versions.length > 0
                        ? c.chassis_versions
                        : ['ESTÁNDAR'],
                chassis_versions:
                    Array.isArray(c.chassis_versions) && c.chassis_versions.length > 0
                        ? c.chassis_versions
                        : ['ESTÁNDAR'],
                official_url: c.official_url || '',
                isNew: false,
            });
        }

        // Complementar con coincidencia parcial rápida por prefijo/subcadena en `global_asset_catalog`
        const qNorm = rawQuery
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
        const qTokens = qNorm.split(/\s+/).filter(Boolean);

        const catalogDocs = await getProjectedCatalogDocs();
        for (const docEntry of catalogDocs) {
            const d = docEntry.data;
            if (d.archived === true) continue;
            const make = String(d.make_oficial || d.make || '').trim();
            const model = String(d.model_oficial || d.model || '').trim();
            if (!make && !model) continue;

            const resolvedTraits =
                d.physical_traits ||
                inferAssetPhysicalTraits({
                    rawTypeText: d.tipo_equipo,
                    rawCategoryText: d.categoria_equipo,
                    makeModelText: `${make} ${model}`,
                });

            if (foundMap.has(docEntry.id)) {
                const existing = foundMap.get(docEntry.id)!;
                const homologous = extractHomologousAxisValues(d);
                existing.foto_url = d.foto_url ? String(d.foto_url) : undefined;
                existing.equipment_type_key = d.equipment_type_key || undefined;
                existing.archetype_id = homologous.archetype.id;
                existing.physical_traits = resolvedTraits;
                existing.canonical_specs = homologous.slots;
                existing.short_description = buildConciseEquipmentDescription(d);
                continue;
            }

            const haystack = [
                make,
                model,
                d.tipo_equipo || '',
                d.categoria_equipo || '',
                ...(Array.isArray(d.search_aliases) ? d.search_aliases : []),
                ...(Array.isArray(d.versions) ? d.versions : []),
            ]
                .join(' ')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');

            const allTokensMatch = qTokens.every((tk) => haystack.includes(tk));
            if (!allTokensMatch) continue;
            if (isGeneric && make.toUpperCase() !== 'GENÉRICO' && !d.is_generic) continue;

            const versions = Array.from(
                new Set(
                    [
                        ...(Array.isArray(d.versions) ? d.versions : []),
                        ...(Array.isArray(d.chassis_versions) ? d.chassis_versions : []),
                        ...(d.version ? [String(d.version)] : []),
                    ]
                        .map((v) => String(v || '').trim())
                        .filter(Boolean)
                )
            );

            const homologous = extractHomologousAxisValues(d);
            foundMap.set(docEntry.id, {
                global_asset_id: docEntry.id,
                catalog_key: d.catalog_key || docEntry.id,
                make_oficial: make,
                model_oficial: model,
                equipment_type_key: d.equipment_type_key || undefined,
                archetype_id: homologous.archetype.id,
                physical_traits: resolvedTraits,
                tipo_equipo: cleanMachineryType(d.tipo_equipo),
                categoria_equipo: String(d.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL'),
                canonical_specs: homologous.slots,
                contexto_operativo: Array.isArray(d.contexto_operativo) ? d.contexto_operativo : [],
                caracteristicas_principales: serializeCanonicalSlotsToSpecsArray(homologous.slots),
                short_description: buildConciseEquipmentDescription(d),
                foto_url: d.foto_url ? String(d.foto_url) : undefined,
                versions: versions.length > 0 ? versions : ['ESTÁNDAR'],
                chassis_versions: versions.length > 0 ? versions : ['ESTÁNDAR'],
                official_url: d.official_url ? String(d.official_url) : '',
                isNew: false,
            });
        }

        const items = Array.from(foundMap.values()).sort((a, b) => {
            const byMake = String(a.make_oficial || '').localeCompare(String(b.make_oficial || ''), 'es', {
                sensitivity: 'base',
            });
            if (byMake !== 0) return byMake;
            const byType = String(a.tipo_equipo || '').localeCompare(String(b.tipo_equipo || ''), 'es', {
                sensitivity: 'base',
            });
            if (byType !== 0) return byType;
            return String(a.model_oficial || '').localeCompare(String(b.model_oficial || ''), 'es', {
                numeric: true,
                sensitivity: 'base',
            });
        });

        return res.status(200).json({
            matched: items.length > 0,
            tier: localHit.matched ? localHit.tier : items.length > 0 ? 'CATALOG_SUBSTRING' : 'NONE',
            latencyMs: Date.now() - start,
            items,
        });
    } catch (err) {
        return handleRouteError(res, err, 'Error consultando coincidencias en el Catálogo Maestro.');
    }
});

/**
 * GET /api/assets/my-fleet
 * Retorna la flota de la cuenta activa (`tenantId`) en MINREPORT hidratada con metadatos base del catálogo
 * y ordenada determinísticamente por Marca -> Tipo de Maquinaria -> Modelo -> Serie.
 */
assetsRouter.get('/my-fleet', async (req: ScopedRequest, res: Response) => {
    try {
        const ctx = req.opermaqContext!;
        const fleetCol = resolveFleetCollectionName(ctx);
        const [bySnake, byCamel] = await Promise.all([
            db.collection(fleetCol).where('tenant_id', '==', ctx.tenantId).get(),
            db.collection(fleetCol).where('tenantId', '==', ctx.tenantId).get(),
        ]);

        const merged = new Map<string, Record<string, any>>();
        bySnake.docs.forEach((d) => merged.set(d.id, { id: d.id, ...d.data() }));
        byCamel.docs.forEach((d) => merged.set(d.id, { id: d.id, ...d.data() }));

        const activeUnits = Array.from(merged.values()).filter((item) => item.archived !== true);

        // Hidratar en lote desde `global_asset_catalog` para asegurar nombre oficial, miniatura y descripción técnica concisa
        const catalogIds = Array.from(
            new Set(
                activeUnits
                    .map((u) => String(u.global_asset_id || u.globalAssetId || '').trim())
                    .filter(Boolean)
            )
        );
        const catalogMap = new Map<string, Record<string, any>>();
        if (catalogIds.length > 0) {
            const snaps = await Promise.all(
                catalogIds.map((cid) => db.collection('global_asset_catalog').doc(cid).get())
            );
            for (const s of snaps) {
                if (s.exists) {
                    const cData = s.data() || {};
                    catalogMap.set(s.id, cData);
                }
            }
        }

        const items = activeUnits.map((unit) => {
            const gid = String(unit.global_asset_id || unit.globalAssetId || '').trim();
            const cat = gid ? catalogMap.get(gid) : undefined;
            const makeOficial = String(
                unit.make_oficial || cat?.make_oficial || cat?.make || '[Información técnica no declarada en ficha]'
            ).trim();
            const modelOficial = String(unit.model_oficial || cat?.model_oficial || cat?.model || '').trim();
            const tipoEquipo = cleanMachineryType(
                unit.tipo_equipo || cat?.tipo_equipo || unit.categoria_equipo || cat?.categoria_equipo
            );
            const shortDescription = cat
                ? buildConciseEquipmentDescription(cat)
                : buildConciseEquipmentDescription(unit);
            const privateThumb = unit.primary_private_photo_url || unit.foto_url || undefined;
            const catalogThumb = cat?.foto_url ? String(cat.foto_url) : undefined;
            const serialOrIdentifier = String(
                unit.serial_number || unit.identifier_value || '[Pendiente de registro]'
            ).trim();

            const resolvedTraits =
                unit.physical_traits ||
                cat?.physical_traits ||
                inferAssetPhysicalTraits({
                    rawTypeText: tipoEquipo,
                    rawCategoryText: unit.categoria_equipo || cat?.categoria_equipo,
                    makeModelText: `${makeOficial} ${modelOficial}`,
                });

            return {
                ...unit,
                global_asset_id: gid,
                make_oficial: makeOficial,
                model_oficial: modelOficial,
                tipo_equipo: tipoEquipo,
                archetype_id: cat?.archetype_id || unit.archetype_id || undefined,
                physical_traits: resolvedTraits,
                canonical_specs: Array.isArray(cat?.canonical_specs)
                    ? cat.canonical_specs
                    : Array.isArray(unit.canonical_specs)
                    ? unit.canonical_specs
                    : undefined,
                caracteristicas_principales: Array.isArray(cat?.caracteristicas_principales)
                    ? cat.caracteristicas_principales
                    : Array.isArray(unit.caracteristicas_principales)
                    ? unit.caracteristicas_principales
                    : undefined,
                short_description: shortDescription,
                primary_private_photo_url: privateThumb || null,
                catalog_foto_url: catalogThumb || null,
                foto_url: privateThumb || catalogThumb || null,
                serial_number: serialOrIdentifier,
            };
        });

        items.sort((a, b) => {
            const byMake = String(a.make_oficial || '').localeCompare(String(b.make_oficial || ''), 'es', {
                sensitivity: 'base',
            });
            if (byMake !== 0) return byMake;
            const byType = String(a.tipo_equipo || '').localeCompare(String(b.tipo_equipo || ''), 'es', {
                sensitivity: 'base',
            });
            if (byType !== 0) return byType;
            const byModel = String(a.model_oficial || '').localeCompare(String(b.model_oficial || ''), 'es', {
                numeric: true,
                sensitivity: 'base',
            });
            if (byModel !== 0) return byModel;
            return String(a.serial_number || '').localeCompare(String(b.serial_number || ''), 'es', {
                numeric: true,
                sensitivity: 'base',
            });
        });

        return res.status(200).json({ success: true, items });
    } catch (err) {
        return handleRouteError(res, err, 'Error listando flota de la cuenta activa.');
    }
});

/**
 * GET /api/assets/unit/:id
 * Retorna el detalle aislado de una unidad física de `tenant_assets` con sus fotos privadas
 * y referencia oficial al `CATÁLOGO`.
 */
assetsRouter.get('/unit/:id', async (req: ScopedRequest, res: Response) => {
    try {
        const ctx = req.opermaqContext!;
        const fleetCol = resolveFleetCollectionName(ctx);
        const unitSnap = await db.collection(fleetCol).doc(String(req.params.id)).get();
        if (!unitSnap.exists) {
            return res.status(404).json({ error: 'Unidad de flota no encontrada.' });
        }

        const unitData = unitSnap.data() || {};
        const docTenant = String(unitData.tenant_id || unitData.tenantId || '');
        if (docTenant !== ctx.tenantId && !ctx.capabilities.canCurateAI) {
            return res.status(403).json({ error: 'Acceso denegado: la unidad pertenece a otra cuenta.' });
        }

        const globalAssetId = String(unitData.global_asset_id || unitData.globalAssetId || '').trim();
        let catalogSummary: Record<string, any> | null = null;
        let catalogTraits: Record<string, any> | undefined;
        if (globalAssetId) {
            const catSnap = await db.collection('global_asset_catalog').doc(globalAssetId).get();
            if (catSnap.exists) {
                const c = catSnap.data() || {};
                catalogTraits = c.physical_traits;
                catalogSummary = {
                    id: catSnap.id,
                    make_oficial: c.make_oficial || c.make || '',
                    model_oficial: c.model_oficial || c.model || '',
                    make_model: c.make_model || `${c.make_oficial || ''} ${c.model_oficial || ''}`.trim(),
                    tipo_equipo: c.tipo_equipo || '[Información técnica no declarada en ficha]',
                    categoria_equipo: c.categoria_equipo || '',
                    physical_traits: c.physical_traits || undefined,
                    caracteristicas_principales: Array.isArray(c.caracteristicas_principales)
                        ? c.caracteristicas_principales
                        : [],
                    short_description: buildConciseEquipmentDescription(c),
                    foto_url: c.foto_url || null,
                    official_url: c.official_url || '',
                };
            }
        }

        const unitTraits =
            unitData.physical_traits ||
            catalogTraits ||
            inferAssetPhysicalTraits({
                rawTypeText: unitData.tipo_equipo || catalogSummary?.tipo_equipo,
                rawCategoryText: unitData.categoria_equipo || catalogSummary?.categoria_equipo,
                makeModelText: `${unitData.make_oficial || ''} ${unitData.model_oficial || ''}`,
            });

        return res.status(200).json({
            success: true,
            unit: {
                id: unitSnap.id,
                ...unitData,
                global_asset_id: globalAssetId,
                physical_traits: unitTraits,
                serial_number: String(
                    unitData.serial_number || unitData.identifier_value || '[Pendiente de registro]'
                ),
                private_photos: Array.isArray(unitData.private_photos) ? unitData.private_photos : [],
            },
            catalog: catalogSummary,
        });
    } catch (err) {
        return handleRouteError(res, err, 'Error cargando ficha de unidad de flota.');
    }
});

/**
 * POST /api/assets/register-fleet-unit
 * Alta diferenciada de unidad física en FLOTA:
 * - Caso A: Si `global_asset_id` ya existe en CATÁLOGO, lo asocia directamente sin re-cazar.
 * - Caso B: Si viene de un candidato nuevo, actualiza `global_asset_catalog` (`knowledge_vault: null`)
 *   y registra la unidad en `tenant_assets`.
 * - Exige Número de Serie / Patente / Identificador único acreditativo (sin duplicados intra-tenant,
 *   permitiendo `1..N` unidades del mismo modelo con distinto número de serie) + palabra `"ACTUALIZAR"`.
 */
assetsRouter.post('/register-fleet-unit', async (req: ScopedRequest, res: Response) => {
    try {
        const ctx = req.opermaqContext!;
        if (!ctx.capabilities.canManageFleet && !ctx.capabilities.canCurateAI) {
            return res.status(403).json({
                error: 'Permisos insuficientes para incorporar equipos en la flota de la cuenta.',
            });
        }

        const parsed = FleetUnitRegistrationBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Datos de registro de unidad inválidos.',
                details: parsed.error.format(),
            });
        }

        const data = parsed.data;
        if (data.confirm_word.trim().toUpperCase() !== HITL_CONFIRM_KEYWORD) {
            return res.status(400).json({
                error: `Confirmación obligatoria inválida. Escriba exactamente "${HITL_CONFIRM_KEYWORD}".`,
            });
        }

        const compactIdentifier = normalizeCompactOwnershipId(data.identifier_value);
        if (compactIdentifier.length < 2) {
            return res.status(400).json({
                error: 'El Número de Serie, Patente o Identificador debe contener al menos 2 caracteres alfanuméricos.',
            });
        }

        const displayIdentifier = data.identifier_value.trim().toUpperCase().replace(/\s+/g, ' ');
        const uniquenessKey = createHash('sha256')
            .update(`${ctx.tenantId}:${data.identifier_type}:${compactIdentifier}`)
            .digest('hex');

        const fleetCol = resolveFleetCollectionName(ctx);

        // Validar cero duplicidad del Número de Serie / Patente dentro del mismo tenant
        const [tenantUnitsSnake, tenantUnitsCamel] = await Promise.all([
            db.collection(fleetCol).where('tenant_id', '==', ctx.tenantId).get(),
            db.collection(fleetCol).where('tenantId', '==', ctx.tenantId).get(),
        ]);
        const existingTenantDocs = [...tenantUnitsSnake.docs, ...tenantUnitsCamel.docs];
        const duplicateUnit = existingTenantDocs.find((d) => {
            const u = d.data();
            if (u.archived === true) return false;
            if (u.identity_uniqueness_key && u.identity_uniqueness_key === uniquenessKey) return true;
            const prevCompact = normalizeCompactOwnershipId(String(u.serial_number || u.identifier_value || ''));
            return prevCompact.length > 0 && prevCompact === compactIdentifier;
        });

        if (duplicateUnit) {
            return res.status(409).json({
                error: 'IDENTIFICADOR_DUPLICADO_EN_FLOTA',
                message: `Ya existe un equipo activo en su flota con el identificador "${displayIdentifier}". Cada unidad física debe poseer un Número de Serie o Patente único.`,
            });
        }

        validateIndustrialDomain(`${data.make_oficial} ${data.model_oficial}`, data.categoria_equipo);

        let finalGlobalId = String(data.global_asset_id || '').trim();
        let catalogAsset: Record<string, any> = {};
        let catalogAlreadyExisted = false;

        if (ctx.isEduSandbox) {
            if (finalGlobalId) {
                const existingSnap = await db.collection('global_asset_catalog').doc(finalGlobalId).get();
                if (existingSnap.exists) {
                    catalogAsset = existingSnap.data() || {};
                    catalogAlreadyExisted = true;
                }
            } else {
                const simHash = createHash('sha256')
                    .update(`${data.make_oficial}:${data.model_oficial}`)
                    .digest('hex')
                    .slice(0, 12);
                finalGlobalId = `edu_sim_${simHash}`;
            }
        } else {
            const upserted = await upsertGlobalAssetCatalog({
                existingCatalogId: data.global_asset_id,
                make_oficial: data.make_oficial,
                model_oficial: data.model_oficial,
                equipment_type_key: data.equipment_type_key,
                categoria_equipo: data.categoria_equipo,
                tipo_equipo: data.tipo_equipo,
                physical_traits: data.physical_traits,
                archetype_id: data.archetype_id as MachineryArchetypeId | undefined,
                canonical_specs: data.canonical_specs,
                ambiente_operativo: data.ambiente_operativo,
                contexto_operativo: data.contexto_operativo,
                caracteristicas_principales: data.caracteristicas_principales,
                version: data.version,
                versions: data.chassis_versions,
                official_url: data.official_url,
                original_jargon: data.original_jargon,
                isGeneric: data.isGeneric,
                actorId: ctx.actorId,
                actorEmail: ctx.actorEmail,
            });
            invalidateCatalogProjectionCache();
            finalGlobalId = upserted.global_asset_id;
            catalogAsset = upserted.asset_data || {};
            catalogAlreadyExisted = upserted.already_existed;
        }

        const makeOficial = String(catalogAsset.make_oficial || data.make_oficial).toUpperCase();
        const modelOficial = String(catalogAsset.model_oficial || data.model_oficial).toUpperCase();
        const tipoEquipo = String(
            catalogAsset.tipo_equipo || data.tipo_equipo || '[Información técnica no declarada en ficha]'
        );
        const resolvedTraits =
            data.physical_traits ||
            catalogAsset.physical_traits ||
            inferAssetPhysicalTraits({
                rawTypeText: tipoEquipo,
                rawCategoryText: catalogAsset.categoria_equipo || data.categoria_equipo,
                makeModelText: `${makeOficial} ${modelOficial}`,
            });

        const nowDate = new Date();
        const unitPayload = {
            global_asset_id: finalGlobalId,
            make_oficial: makeOficial,
            model_oficial: modelOficial,
            make_model: `${makeOficial} ${modelOficial}`.trim(),
            categoria_equipo: String(catalogAsset.categoria_equipo || data.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL'),
            tipo_equipo: tipoEquipo,
            equipment_type_key: catalogAsset.equipment_type_key || data.equipment_type_key || null,
            archetype_id: catalogAsset.archetype_id || data.archetype_id || null,
            physical_traits: resolvedTraits,
            canonical_specs: Array.isArray(catalogAsset.canonical_specs)
                ? catalogAsset.canonical_specs
                : Array.isArray(data.canonical_specs)
                ? data.canonical_specs
                : [],
            short_description: buildConciseEquipmentDescription(
                Object.keys(catalogAsset).length > 0 ? catalogAsset : data
            ),
            version: data.version || 'ESTÁNDAR',
            identifier_type: data.identifier_type,
            identifier_value: displayIdentifier,
            serial_number: displayIdentifier,
            identity_uniqueness_key: uniquenessKey,
            ownership_type: data.ownership_type,
            horometer: Number(data.horometer || 0),
            odometer_km: typeof data.odometer_km === 'number' ? data.odometer_km : null,
            cycles_count: typeof data.cycles_count === 'number' ? data.cycles_count : null,
            calibration_due_date: data.calibration_due_date || null,
            status: 'OPERATIVO',
            private_photos: [],
            primary_private_photo_url: null,
            original_jargon: data.original_jargon || '',
            tenant_id: ctx.tenantId,
            tenantId: ctx.tenantId,
            registered_by: ctx.actorId,
            registered_by_email: ctx.actorEmail,
            data_scope: ctx.dataScope,
            is_edu_sandbox: Boolean(ctx.isEduSandbox),
            archived: false,
            createdAt: nowDate,
            updatedAt: nowDate,
        };

        const createdRef = await db.collection(fleetCol).add(unitPayload);

        await AuditLedger.record({
            tenantId: ctx.tenantId,
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            action: 'OPERMAQ_FLEET_UNIT_REGISTERED',
            module: 'opermaq',
            targetEntity: createdRef.id,
            details: {
                globalAssetId: finalGlobalId,
                catalogAlreadyExisted,
                identifierType: data.identifier_type,
                identifierValue: displayIdentifier,
                ownershipType: data.ownership_type,
                version: data.version || 'ESTÁNDAR',
                fleetCollection: fleetCol,
            },
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            tenant_asset_id: createdRef.id,
            global_asset_id: finalGlobalId,
            catalog_already_existed: catalogAlreadyExisted,
            serial_number: displayIdentifier,
        });
    } catch (err) {
        return handleRouteError(res, err, 'Error registrando unidad física en Control de Flota.');
    }
});

/**
 * POST /api/assets/:id/private-photo
 * Sube una fotografía privada de la unidad física del cliente (`TENANT_PRIVATE` en CAS).
 * Uso estrictamente privado del cliente propietario; jamás se publica en `global_asset_catalog`.
 */
assetsRouter.post(
    '/:id/private-photo',
    uploadPrivatePhoto.single('file'),
    async (req: ScopedRequest, res: Response) => {
        try {
            const ctx = req.opermaqContext!;
            if (!ctx.capabilities.canManageFleet && !ctx.capabilities.canCurateAI) {
                return res.status(403).json({ error: 'Permisos insuficientes para gestionar fotos de la unidad.' });
            }

            const file = req.file;
            if (!file || !file.buffer || !String(file.mimetype || '').startsWith('image/')) {
                return res.status(400).json({
                    error: 'Adjunte un archivo de imagen válido (JPG, PNG o WebP) de la unidad.',
                });
            }

            const fleetCol = resolveFleetCollectionName(ctx);
            const unitRef = db.collection(fleetCol).doc(String(req.params.id));
            const unitSnap = await unitRef.get();
            if (!unitSnap.exists) {
                return res.status(404).json({ error: 'Unidad de flota no encontrada.' });
            }

            const unitData = unitSnap.data() || {};
            const ownerTenant = String(unitData.tenant_id || unitData.tenantId || '');
            if (ownerTenant !== ctx.tenantId && !ctx.capabilities.canCurateAI) {
                return res.status(403).json({ error: 'Acceso denegado: la unidad pertenece a otra cuenta.' });
            }

            const targetTenant = ownerTenant || ctx.tenantId;
            const { descriptor } = await CasStorageService.digestAndStore(
                file.buffer,
                file.mimetype,
                'IMAGE_FIELD_EVIDENCE',
                {
                    scope: 'TENANT_PRIVATE',
                    tenantId: targetTenant,
                    actorUid: ctx.actorId,
                    originalFilename: file.originalname || 'equipo_flota.webp',
                }
            );

            const caption = String(req.body?.caption || '').trim().slice(0, 160);
            const existingPhotos: Array<Record<string, any>> = Array.isArray(unitData.private_photos)
                ? [...unitData.private_photos]
                : [];

            const alreadyIdx = existingPhotos.findIndex((p) => p.sha256 === descriptor.sha256);
            const photoEntry = {
                sha256: descriptor.sha256,
                url: descriptor.downloadUrl,
                caption: caption || undefined,
                width: descriptor.width || undefined,
                height: descriptor.height || undefined,
                uploadedAt: new Date().toISOString(),
                uploadedBy: ctx.actorEmail,
            };

            if (alreadyIdx >= 0) {
                existingPhotos[alreadyIdx] = photoEntry;
            } else {
                existingPhotos.unshift(photoEntry);
            }

            const primaryUrl = existingPhotos[0]?.url || descriptor.downloadUrl;
            await unitRef.update({
                private_photos: existingPhotos.slice(0, 24),
                primary_private_photo_url: primaryUrl,
                foto_url: primaryUrl,
                updatedAt: new Date(),
            });

            await AuditLedger.record({
                tenantId: targetTenant,
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                action: 'TENANT_ASSET_PRIVATE_PHOTO_UPLOADED',
                module: 'opermaq',
                targetEntity: unitRef.id,
                details: {
                    sha256: descriptor.sha256,
                    scope: 'TENANT_PRIVATE',
                    optimizedBytes: descriptor.optimizedBytes,
                },
            }).catch(() => {});

            return res.status(200).json({
                success: true,
                photo: photoEntry,
                private_photos: existingPhotos.slice(0, 24),
                primary_private_photo_url: primaryUrl,
            });
        } catch (err) {
            return handleRouteError(res, err, 'Error almacenando fotografía privada de la unidad.');
        }
    }
);

/**
 * DELETE /api/assets/:id/private-photo/:sha256
 * Desvincula una fotografía privada de la unidad del cliente.
 */
assetsRouter.delete('/:id/private-photo/:sha256', async (req: ScopedRequest, res: Response) => {
    try {
        const ctx = req.opermaqContext!;
        if (!ctx.capabilities.canManageFleet && !ctx.capabilities.canCurateAI) {
            return res.status(403).json({ error: 'Permisos insuficientes.' });
        }

        const fleetCol = resolveFleetCollectionName(ctx);
        const unitRef = db.collection(fleetCol).doc(String(req.params.id));
        const unitSnap = await unitRef.get();
        if (!unitSnap.exists) {
            return res.status(404).json({ error: 'Unidad de flota no encontrada.' });
        }

        const unitData = unitSnap.data() || {};
        const ownerTenant = String(unitData.tenant_id || unitData.tenantId || '');
        if (ownerTenant !== ctx.tenantId && !ctx.capabilities.canCurateAI) {
            return res.status(403).json({ error: 'Acceso denegado.' });
        }

        const targetSha = String(req.params.sha256 || '').trim().toLowerCase();
        const remaining = (Array.isArray(unitData.private_photos) ? unitData.private_photos : []).filter(
            (p: any) => String(p?.sha256 || '').toLowerCase() !== targetSha
        );
        const nextPrimary = remaining[0]?.url || null;

        await unitRef.update({
            private_photos: remaining,
            primary_private_photo_url: nextPrimary,
            foto_url: nextPrimary,
            updatedAt: new Date(),
        });

        return res.status(200).json({
            success: true,
            private_photos: remaining,
            primary_private_photo_url: nextPrimary,
        });
    } catch (err) {
        return handleRouteError(res, err, 'Error eliminando fotografía privada de la unidad.');
    }
});

/**
 * POST /api/assets/resolve
 * Etapa 1: Caza taxonómica OEM / Genérica con Grounding Web en vivo, cero relación con los 5 pilares.
 */
assetsRouter.post('/resolve', async (req: ScopedRequest, res: Response) => {
    try {
        const parsed = ResolveAssetBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Parámetros de búsqueda inválidos.',
                details: parsed.error.format(),
            });
        }

        const { jerga, modelo, marca, tipo, isGeneric, clarificationContext, forceWebDiscovery } = parsed.data;
        const searchTerms =
            (jerga || '').trim() ||
            [marca, modelo].filter((s) => s && s.trim().length > 0).join(' ').trim() ||
            (tipo || '').trim();

        if (!searchTerms || searchTerms.length < 2) {
            return res.status(400).json({
                error: 'Ingrese al menos marca/modelo o designador técnico (mínimo 2 caracteres).',
            });
        }

        const result = await resolveMachineryCandidates(
            searchTerms,
            Boolean(isGeneric),
            clarificationContext,
            Boolean(forceWebDiscovery)
        );

        if (result.requires_clarification) {
            return res.status(200).json({
                requires_clarification: true,
                clarification_message: result.clarification_message,
                candidates: [],
            });
        }

        res.setHeader('X-Minreport-Resolution-Tier', result.resolution_tier || 'TIER_2_WEB_DISCOVERY');
        res.setHeader('X-Minreport-Commons-Hit', String(Boolean(result.resolved_from_commons)));
        res.setHeader('X-Minreport-Resolution-Ms', String(result.resolution_latency_ms || 0));
        if (result.detected_equipment_type) {
            res.setHeader('X-Minreport-Equipment-Type', result.detected_equipment_type.type_key);
            res.setHeader(
                'X-Minreport-Type-Reused',
                String(Boolean(result.detected_equipment_type.reused_existing_schema))
            );
        }

        const sanitizedCandidates = (result.candidates || []).map((c: any) => {
            const homologous = extractHomologousAxisValues(c);
            const cleanedTipo = c.tipo_equipo ? cleanMachineryType(c.tipo_equipo) : c.tipo_equipo;
            const resolvedTraits =
                c.physical_traits ||
                inferAssetPhysicalTraits({
                    rawTypeText: cleanedTipo,
                    rawCategoryText: c.categoria_equipo,
                    makeModelText: `${c.make_oficial || ''} ${c.model_oficial || ''}`,
                });
            return {
                ...c,
                equipment_type_key: c.equipment_type_key || result.detected_equipment_type?.type_key || undefined,
                archetype_id: homologous.archetype.id,
                physical_traits: resolvedTraits,
                tipo_equipo: cleanedTipo,
                canonical_specs: homologous.slots,
                caracteristicas_principales: serializeCanonicalSlotsToSpecsArray(homologous.slots),
                short_description: buildHomologousEquipmentDescription(c),
            };
        });

        return res.status(200).json(sanitizedCandidates);
    } catch (err) {
        return handleRouteError(res, err, 'Error resolviendo candidatos de maquinaria.');
    }
});

/**
 * POST /api/assets/add-tenant-catalog
 * Registra el catálogo maestro (`knowledge_vault: null`) y lo vincula al `tenantId` activo.
 */
assetsRouter.post('/add-tenant-catalog', async (req: ScopedRequest, res: Response) => {
    try {
        const ctx = req.opermaqContext!;
        const {
            global_asset_id,
            make_oficial,
            model_oficial,
            equipment_type_key,
            archetype_id,
            categoria_equipo,
            tipo_equipo,
            canonical_specs,
            ambiente_operativo,
            contexto_operativo,
            caracteristicas_principales,
            chassis_versions,
            official_url,
            original_jargon,
            version,
            isGlobalOnly,
        } = req.body || {};

        if (isGlobalOnly && (!ctx.capabilities.canCurateAI || ctx.isEduSandbox)) {
            return res.status(403).json({
                error: 'Permisos insuficientes para pre-registro global de catálogos.',
            });
        }

        validateIndustrialDomain(`${make_oficial || ''} ${model_oficial || ''}`, categoria_equipo);

        const incomingAmbiente: string[] = Array.isArray(ambiente_operativo) ? ambiente_operativo : [];
        const incomingContexto: string[] = Array.isArray(contexto_operativo) ? contexto_operativo : [];
        const incomingCaracteristicas: string[] = Array.isArray(caracteristicas_principales)
            ? caracteristicas_principales
            : [];

        let profileData: {
            equipment_type_key?: string;
            archetype_id?: MachineryArchetypeId;
            tipo_equipo: string;
            canonical_specs?: CanonicalSpecSlot[];
            ambiente_operativo: string[];
            contexto_operativo: string[];
            caracteristicas_principales: string[];
        } = {
            equipment_type_key: equipment_type_key ? String(equipment_type_key) : undefined,
            archetype_id: archetype_id as MachineryArchetypeId | undefined,
            tipo_equipo: String(tipo_equipo || '').trim(),
            canonical_specs: Array.isArray(canonical_specs) ? canonical_specs : undefined,
            ambiente_operativo: incomingAmbiente,
            contexto_operativo: incomingContexto,
            caracteristicas_principales: incomingCaracteristicas,
        };

        const needsEnrichment =
            make_oficial &&
            model_oficial &&
            (!profileData.tipo_equipo ||
                profileData.ambiente_operativo.length === 0 ||
                profileData.contexto_operativo.length === 0 ||
                profileData.caracteristicas_principales.length === 0);

        if (needsEnrichment) {
            try {
                const enriched = await enrichCatalogProfile(make_oficial, model_oficial, {
                    equipment_type_key: profileData.equipment_type_key,
                    categoria_equipo: categoria_equipo || 'Maquinaria Industrial',
                    tipo_equipo: profileData.tipo_equipo,
                    canonical_specs: profileData.canonical_specs,
                });
                profileData = {
                    equipment_type_key: enriched.equipment_type_key || profileData.equipment_type_key,
                    archetype_id: enriched.archetype_id,
                    tipo_equipo: profileData.tipo_equipo || enriched.tipo_equipo,
                    canonical_specs: enriched.canonical_specs,
                    ambiente_operativo:
                        profileData.ambiente_operativo.length > 0
                            ? profileData.ambiente_operativo
                            : enriched.ambiente_operativo,
                    contexto_operativo:
                        profileData.contexto_operativo.length > 0
                            ? profileData.contexto_operativo
                            : enriched.contexto_operativo,
                    caracteristicas_principales:
                        profileData.caracteristicas_principales.length > 0
                            ? profileData.caracteristicas_principales
                            : enriched.caracteristicas_principales,
                };
            } catch (enrichErr: any) {
                console.warn('[OPERMAQ-ASSETS] enrichCatalogProfile degradado:', enrichErr?.message);
            }
        }

        let finalGlobalId: string | undefined = global_asset_id;
        if (ctx.isEduSandbox) {
            if (!finalGlobalId && make_oficial && model_oficial) {
                const simHash = createHash('sha256')
                    .update(`${make_oficial}:${model_oficial}`)
                    .digest('hex')
                    .slice(0, 12);
                finalGlobalId = `edu_sim_${simHash}`;
            }
        } else if (make_oficial && model_oficial) {
            const upserted = await upsertGlobalAssetCatalog({
                existingCatalogId: finalGlobalId,
                make_oficial,
                model_oficial,
                categoria_equipo,
                ...profileData,
                versions: Array.isArray(chassis_versions) ? chassis_versions : version ? [version] : undefined,
                official_url,
                original_jargon,
                actorId: ctx.actorId,
                actorEmail: ctx.actorEmail,
            });
            invalidateCatalogProjectionCache();
            finalGlobalId = upserted.global_asset_id;
        }

        if (!finalGlobalId) {
            return res.status(400).json({
                error: 'No se pudo determinar global_asset_id: faltan make_oficial y model_oficial.',
            });
        }

        if (isGlobalOnly) {
            return res.status(200).json({
                success: true,
                global_asset_id: finalGlobalId,
                isGlobalRegistration: true,
            });
        }

        const fleetCol = resolveFleetCollectionName(ctx);
        const existingQs = await db
            .collection(fleetCol)
            .where('tenant_id', '==', ctx.tenantId)
            .where('global_asset_id', '==', finalGlobalId)
            .limit(1)
            .get();

        if (!existingQs.empty) {
            const existingDoc = existingQs.docs[0];
            if (existingDoc.data().archived) {
                await existingDoc.ref.update({ archived: false, updatedAt: new Date() });
            }
            return res.status(200).json({
                success: true,
                tenant_asset_id: existingDoc.id,
                global_asset_id: finalGlobalId,
            });
        }

        const tenantAssetDoc = await db.collection(fleetCol).add({
            global_asset_id: finalGlobalId,
            make_model: `${make_oficial} ${model_oficial}`.trim(),
            make_oficial,
            model_oficial,
            categoria_equipo: categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL',
            tipo_equipo: profileData.tipo_equipo,
            version: version || 'ESTÁNDAR',
            original_jargon: original_jargon || '',
            tenant_id: ctx.tenantId,
            tenantId: ctx.tenantId,
            addedBy: ctx.actorId,
            addedByEmail: ctx.actorEmail,
            data_scope: ctx.dataScope,
            is_edu_sandbox: Boolean(ctx.isEduSandbox),
            archived: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        return res.status(200).json({
            success: true,
            tenant_asset_id: tenantAssetDoc.id,
            global_asset_id: finalGlobalId,
        });
    } catch (err) {
        return handleRouteError(res, err, 'Error vinculando equipo al catálogo de la cuenta.');
    }
});

/**
 * DELETE /api/assets/:id
 * Archiva lógicamente un equipo de la flota de la cuenta activa (`tenant_assets` o `edu_sandbox_fleet`).
 */
assetsRouter.delete('/:id', async (req: ScopedRequest, res: Response) => {
    try {
        const ctx = req.opermaqContext!;
        if (!ctx.capabilities.canManageFleet) {
            return res.status(403).json({ error: 'Permisos insuficientes para retirar equipos de flota.' });
        }

        const fleetCol = resolveFleetCollectionName(ctx);
        const docRef = db.collection(fleetCol).doc(String(req.params.id));
        const snap = await docRef.get();
        if (!snap.exists) {
            return res.status(404).json({ error: 'Equipo de flota no encontrado.' });
        }

        const data = snap.data() || {};
        const docTenant = data.tenant_id || data.tenantId;
        if (docTenant !== ctx.tenantId && !ctx.capabilities.canCurateAI) {
            return res.status(403).json({ error: 'El equipo no pertenece a la cuenta activa.' });
        }

        await docRef.update({
            archived: true,
            archivedAt: new Date(),
            archivedBy: ctx.actorEmail,
        });

        return res.status(200).json({ success: true });
    } catch (err) {
        return handleRouteError(res, err, 'Error archivando equipo de flota.');
    }
});

const TenantOverridesSchema = z.object({
    confirm_word: z.string(),
    faena_name: z.string().max(160).optional(),
    altitude_masl: z.number().min(0).max(6500).optional(),
    internal_radio_channel: z.string().max(80).optional(),
    max_ramp_speed_kmh: z.number().min(1).max(120).optional(),
    emergency_protocol_notes: z.string().max(6000).optional(),
    custom_pm_derating_factor: z.number().min(0.4).max(1.2).optional(),
    custom_checklist_additions: z.array(z.string().max(300)).max(30).optional(),
    private_operational_notes: z.string().max(10000).optional(),
});

/**
 * PATCH /api/assets/:id/overrides
 * Actualiza los parámetros operativos privados (`tenant_custom_overrides`) exclusivos del cliente activo
 * sin exponerlos al catálogo global común (`COMMONS`). Exige palabra clave HITL `"ACTUALIZAR"`.
 */
assetsRouter.patch('/:id/overrides', async (req: ScopedRequest, res: Response) => {
    try {
        const ctx = req.opermaqContext!;
        const parsed = TenantOverridesSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Payload de configuración privada inválido.',
                details: parsed.error.format(),
            });
        }

        if (parsed.data.confirm_word.trim().toUpperCase() !== HITL_CONFIRM_KEYWORD) {
            return res.status(400).json({
                error: `Confirmación HITL inválida. Debe escribir exactamente "${HITL_CONFIRM_KEYWORD}".`,
            });
        }

        const fleetCol = resolveFleetCollectionName(ctx);
        const docRef = db.collection(fleetCol).doc(String(req.params.id));
        const snap = await docRef.get();
        if (!snap.exists) {
            return res.status(404).json({ error: 'Activo de flota no encontrado.' });
        }

        const assetData = snap.data() || {};
        const docTenant = assetData.tenant_id || assetData.tenantId;
        if (docTenant !== ctx.tenantId && !ctx.capabilities.canCurateAI) {
            return res.status(403).json({ error: 'Acceso denegado: el activo pertenece a otra cuenta.' });
        }

        const { confirm_word: _cw, ...cleanOverrides } = parsed.data;
        const mergedOverrides = {
            ...(assetData.tenant_custom_overrides || {}),
            ...cleanOverrides,
            updatedAt: new Date().toISOString(),
            updatedBy: ctx.actorEmail,
        };

        await docRef.update({
            tenant_custom_overrides: mergedOverrides,
            updatedAt: new Date(),
        });

        await AuditLedger.record({
            tenantId: ctx.tenantId,
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            action: 'TENANT_ASSET_OVERRIDES_UPDATED',
            module: 'opermaq',
            targetEntity: docRef.id,
            details: { updatedFields: Object.keys(cleanOverrides) },
        }).catch(() => {});

        return res.status(200).json({
            success: true,
            tenant_custom_overrides: mergedOverrides,
        });
    } catch (err) {
        return handleRouteError(res, err, 'Error guardando configuración privada de faena.');
    }
});

/**
 * POST /api/assets/:id/contribute-to-commons
 * Pasa un aporte técnico del usuario por la Esclusa Agéntica Zero-Trust (`ConfidentialityAirlockService`):
 * - Lo privado queda guardado únicamente en `tenant_custom_overrides` de la cuenta del usuario.
 * - El conocimiento técnico universal OEM sanitizado pasa a `commons_airlock_queue` sin PII ni marcas internas.
 */
assetsRouter.post('/:id/contribute-to-commons', async (req: ScopedRequest, res: Response) => {
    try {
        const ctx = req.opermaqContext!;
        if (ctx.isEduSandbox) {
            return res.status(403).json({
                error: 'EDU_SANDBOX_ISOLATED',
                message: 'Las cuentas académicas sandbox no modifican ni envían aportes al Catálogo Maestro común.',
            });
        }
        const rawText = String(req.body?.content || req.body?.text || '').trim();
        if (rawText.length < 8) {
            return res.status(400).json({
                error: 'Ingrese una observación técnica de al menos 8 caracteres.',
            });
        }

        const fleetCol = resolveFleetCollectionName(ctx);
        const docRef = db.collection(fleetCol).doc(String(req.params.id));
        const snap = await docRef.get();
        if (!snap.exists) {
            return res.status(404).json({ error: 'Unidad de flota no encontrada.' });
        }

        const assetData = snap.data() || {};
        const docTenant = assetData.tenant_id || assetData.tenantId;
        if (docTenant !== ctx.tenantId && !ctx.capabilities.canCurateAI) {
            return res.status(403).json({ error: 'La unidad no pertenece a la cuenta activa.' });
        }

        const globalAssetId = String(assetData.global_asset_id || '');
        const makeModel = String(
            assetData.make_model || `${assetData.make_oficial || ''} ${assetData.model_oficial || ''}`
        ).trim();

        const airlockRes = await ConfidentialityAirlockService.submitContributionThroughAirlock({
            globalAssetId,
            makeModel,
            tenantId: ctx.tenantId,
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            rawText,
        });

        // Si el usuario incluyó notas privadas de su propia operación, preservarlas solo en su `tenant_custom_overrides`
        if (airlockRes.evaluation.containsTenantPrivate && airlockRes.evaluation.tenantPrivateNotes) {
            const prevNotes = String(assetData.tenant_custom_overrides?.private_operational_notes || '');
            const combined = prevNotes
                ? `${prevNotes}\n\n[${new Date().toISOString().slice(0, 10)}] ${airlockRes.evaluation.tenantPrivateNotes}`
                : airlockRes.evaluation.tenantPrivateNotes;
            await docRef.update({
                'tenant_custom_overrides.private_operational_notes': combined.slice(0, 10000),
                'tenant_custom_overrides.updatedAt': new Date().toISOString(),
            });
        }

        return res.status(200).json({
            success: true,
            queueId: airlockRes.queueId,
            evaluation: airlockRes.evaluation,
        });
    } catch (err) {
        return handleRouteError(res, err, 'Error procesando aporte en Esclusa Zero-Trust.');
    }
});

export default assetsRouter;
