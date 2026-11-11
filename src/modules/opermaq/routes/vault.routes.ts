import { randomUUID } from 'crypto';
import { type NextFunction, Router, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import multer from 'multer';
import { db, storage } from '../../../config/firebase';
import { env } from '../../../config/env';
import { AuditLedger } from '../../../core/audit-ledger';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { AISwarmUnavailableError } from '../../../core/resilient-ai-client';
import type { ScopedRequest } from '../../../middleware/sessionScope';
import { assertSafeExternalUrl, safeFetchExternal, SSRFBlockedError } from '../../../utils/ssrfGuard';
import {
    assistItemEdit,
    assistRejection,
    correctManualItemText,
    evolveItemContent,
} from '../services/AiAssistService';
import { resolveAssetSymbology } from '../services/AssetResolverService';
import { validateCatalogProfileGate } from '../services/CatalogUpsertService';
import {
    type BenchmarkMetricKind,
    CollectiveBenchmarkService,
} from '../services/CollectiveBenchmarkService';
import { enrichCatalogProfile } from '../services/CatalogProfileEnricher';
import {
    isValidHitlConfirmWord,
    HitlConfirmWordSchema,
    PilotHitlConsolidateBodySchema,
    ReconcileSidebarProfileBodySchema,
    ReframeOfficialPhotoBodySchema,
    VaultApplyAssistProposalBodySchema,
    VaultBulkApproveBodySchema,
    VaultCreateItemBodySchema,
    VaultMutateItemHitlBodySchema,
    VaultPillarIdSchema,
    VaultResolveConflictBodySchema,
    VaultRollbackVersionBodySchema,
    VaultUpdateAssetImageBodySchema,
    VaultUpdateItemContentBodySchema,
} from '../../../contracts/opermaq.contracts';
import { resolveOrLearnEquipmentType } from '../services/EquipmentTypeRegistryService';
import { buildAndPersistAssetSymbologyPack } from '../services/EquipmentSymbologyPackBuilder';
import {
    buildAndPersistEquipmentCostMatrix,
    compileEquipmentCostMatrixFromPillars,
} from '../services/EquipmentCostMatrixCompiler';
import {
    huntVaultItem,
    reconcileAssetSidebarProfileFromVault,
    scheduleDebouncedAssetSymbologyPackRebuild,
} from '../services/ItemHunterService';
import {
    type CanonicalSpecSlot,
    deriveEnergyConsumptionProfile,
    hasOnlyGenericOrMissingContextItems,
    normalizeCanonicalSlotsByResolvedEnergy,
    sanitizeDesignAndWorkContextItems,
    serializeCanonicalSlotsToSpecsArray,
} from '../utils/canonicalArchetypeSpecs';
import { inferAssetConfigurationProfile } from '../utils/lockedVariantDirective';
import {
    computePillarContentDigestSha256,
    computePillarStructureDigestSha256,
    computeVaultMerkleRootSha256,
    ensureFichaTecnicaConsumptionBaseItem,
    ensurePautaMantencionWearAndRodadoBaseItem,
    isPillarMerkleChainEvolved,
    itemizeSinglePillar,
    sortAndReindexPillarItems,
    suggestComplementaryPillarItems,
} from '../services/ItemizerService';
import {
    computeFactFingerprint,
    injectVerifiedInlineSymbology,
    verifyAndNormalizeTechnicalUnits,
} from '../services/NeuroSymbolicVerifier';
import { OpermaqManualPublisher } from '../services/OpermaqManualPublisher';
import { createEmptyKnowledgeVault, PILLAR_LABELS } from '../services/pillarAgents';
import { OfficialEquipmentPhotoService } from '../services/OfficialEquipmentPhotoService';
import { SegmentedDocumentProcessorService } from '../services/SegmentedDocumentProcessorService';
import { VaultPersistenceService } from '../services/VaultPersistenceService';
import {
    drawStandardIcon,
    generateBrandVariant,
    getMasterSymbols,
    getPendingSymbols,
    isValidHitlSymbologyWord,
    registerBrandVariant,
    registerStandardIcon,
    searchIsoIconFromWikimedia,
    uploadManualVariant,
    uploadStandardIcon,
} from '../services/SymbologyService';
import { buildHuntTaskId, enqueueItemHuntTask, isHuntTaskActivelyRunning } from '../services/TaskQueueService';
import { ensureUniversalSymbologySeeded } from '../services/UniversalSymbologySeedService';
import {
    injectExplicitFigureCitationInSection,
    parsePendingMarker,
    sanitizeMarkdownFiguresAndBrokenMarkers,
    sanitizeMarkdownLabel,
    splitMarkdownSections,
    tokenContainment,
} from '../services/PendingFigureMarkers';
import {
    filterFiguresReferencedInMarkdown,
    formatFigureMarkdownBlock,
    mergeDeduplicatedFigures,
    reconcileSectionFiguresAndPendingMarkers,
} from '../services/VaultReconciliationService';
import { processVaultChat } from '../services/vaultChatService';
import {
    type AdHocManualProfileId,
    type ChatMessage,
    type ExtractedFigureRef,
    HITL_CONFIRM_KEYWORD,
    PILLAR_PREREQUISITE_MAP,
    type PillarId,
    ReviewContributionBodySchema,
    VALID_PILLAR_IDS,
} from '../types/vault.types';
import { z } from 'zod';

/**
 * OPERMAQ — Vault Routes (Etapas 2, 3 y 4: Itemizado, Caza On-Demand, Curaduría HITL y Simbología ISO 7000)
 *
 * Subordinación 100% a MINREPORT Core (`req.opermaqContext`):
 * - Cero gestión de usuarios, contratos o ledger paralelo (`vault_audit_logs` eliminado).
 * - Confirmación HITL unificada bajo palabra clave `"ACTUALIZAR"` (`GEMINI.md §3.8`).
 */

const MAX_VAULT_UPLOAD_BYTES = 64 * 1024 * 1024; // Tope seguro 64 MB

const vaultRouter = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_VAULT_UPLOAD_BYTES },
});
const uploadDocument = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_VAULT_UPLOAD_BYTES },
});

const MAX_DOCUMENT_INGEST_CONCURRENCY = 2;
let activeDocumentIngestions = 0;
const documentIngestQueue: Array<() => void> = [];

async function withDocumentIngestSemaphore<T>(task: () => Promise<T>): Promise<T> {
    if (activeDocumentIngestions >= MAX_DOCUMENT_INGEST_CONCURRENCY) {
        await new Promise<void>((resolve) => {
            documentIngestQueue.push(resolve);
        });
    }
    activeDocumentIngestions++;
    try {
        return await task();
    } finally {
        activeDocumentIngestions = Math.max(0, activeDocumentIngestions - 1);
        const next = documentIngestQueue.shift();
        if (next) next();
    }
}

function requireCurateAI(req: ScopedRequest, res: Response, next: NextFunction) {
    if (!req.opermaqContext?.capabilities?.canCurateAI) {
        return res.status(403).json({
            error: 'FORBIDDEN_GLOBAL_CURATION',
            message: 'Permisos insuficientes: se requiere rol con privilegio de curaduría global OEM (DEV_ROOT, SUPER_ADMIN o TEST_PILOT).',
        });
    }
    return next();
}

function handleVaultError(res: Response, err: unknown, fallbackMessage: string) {
    console.error(`[VAULT-ROUTE-ERROR] ${fallbackMessage}:`, err);
    if (err instanceof SSRFBlockedError) {
        return res.status(400).json({
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
        error: anyErr?.message || fallbackMessage,
        ...(anyErr?.missingFields ? { missingFields: anyErr.missingFields } : {}),
    });
}

function sendConfirmWordMismatch(res: Response) {
    return res.status(400).json({
        error: 'CONFIRM_WORD_MISMATCH',
        message: `Debe confirmar escribiendo "${HITL_CONFIRM_KEYWORD}".`,
    });
}

function sendZodBadRequest(res: Response, error: z.ZodError, fallbackMessage: string) {
    const hasConfirmMismatch = error.issues.some(
        (iss) =>
            iss.message === 'CONFIRM_WORD_MISMATCH' ||
            iss.path.includes('confirmWord')
    );
    if (hasConfirmMismatch) {
        return sendConfirmWordMismatch(res);
    }
    return res.status(400).json({
        error: error.issues[0]?.message || fallbackMessage,
        details: error.issues,
    });
}

function scrubUnknownStringsDeep(value: unknown): unknown {
    if (typeof value === 'string') {
        return ConfidentialityAirlockService.scrubDeterministicPii(value).scrubbed;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => scrubUnknownStringsDeep(entry));
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = scrubUnknownStringsDeep(v);
        }
        return out;
    }
    return value;
}

interface SidebarProfileSnapshot {
    equipment_type_key: string;
    canonical_specs: CanonicalSpecSlot[];
    caracteristicas_principales: string[];
    ambiente_operativo: string[];
    contexto_operativo: string[];
    energy_consumption_profile: Record<string, any> | null;
    configuration_profile: Record<string, any> | null;
}

async function computeSidebarProfilePreviewFromVault(
    globalAssetId: string,
    options?: { allowGroundedEnrichmentIfNeeded?: boolean; preferVaultMarkdownOverExisting?: boolean }
): Promise<{
    currentProfile: SidebarProfileSnapshot;
    proposedProfile: SidebarProfileSnapshot;
    canonicalTypeLabel: string;
} | null> {
    const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
    if (!hydrated.exists || !hydrated.data) return null;
    const data = hydrated.data;

    const makeOficial = String(data.make_oficial || data.make || 'GENÉRICO').trim();
    const modelOficial = String(data.model_oficial || data.model || globalAssetId).trim();

    const fichaItems: any[] = Array.isArray(data.knowledge_vault?.ficha_tecnica?.items)
        ? data.knowledge_vault.ficha_tecnica.items.filter((it: any) => !it?.is_discarded)
        : [];
    const fullMarkdown = fichaItems
        .map((it) => `${it.title}\n${it.content || ''}`)
        .join('\n\n');

    const typeRes = await resolveOrLearnEquipmentType({
        rawTypeKey: data.equipment_type_key,
        rawTypeHint: data.tipo_equipo,
        rawCategoryHint: data.categoria_equipo,
        assetQueryContext: `${makeOficial} ${modelOficial}`,
    });
    const typeDoc = typeRes.typeDoc;

    const existingSlots: CanonicalSpecSlot[] = Array.isArray(data.canonical_specs)
        ? [...data.canonical_specs]
        : [];
    const existingByKey = new Map<string, CanonicalSpecSlot>();
    for (const s of existingSlots) {
        if (s && s.axis_key) existingByKey.set(s.axis_key, s);
    }

    const primaryVerifiedUrl =
        String(data.official_url || '').trim() ||
        fichaItems.find((it) => Array.isArray(it.item_sources) && it.item_sources.length > 0)?.item_sources?.[0]
            ?.url ||
        null;

    const profile = deriveEnergyConsumptionProfile({
        tipo_equipo: data.tipo_equipo || typeDoc.canonical_type_es,
        categoria_equipo: data.categoria_equipo || typeDoc.categoria_equipo,
        canonical_specs: existingSlots,
        caracteristicas_principales: data.caracteristicas_principales,
        fichaTecnicaMarkdown: fullMarkdown,
        official_url: primaryVerifiedUrl,
        existingProfile: data.energy_consumption_profile,
    });

    const preliminaryConfig = inferAssetConfigurationProfile({
        make_oficial: makeOficial,
        model_oficial: modelOficial,
        tipo_equipo: data.tipo_equipo || typeDoc.canonical_type_es,
        categoria_equipo: data.categoria_equipo || typeDoc.categoria_equipo,
        version: data.version,
        physical_traits: data.physical_traits,
        canonical_specs: existingSlots,
        caracteristicas_principales: data.caracteristicas_principales,
        chassis_versions: data.chassis_versions,
        extra_evidence_text: fullMarkdown.slice(0, 6000),
        existing_profile: data.configuration_profile,
    });

    const preferMarkdown = Boolean(options?.preferVaultMarkdownOverExisting);
    const mergedSlots: CanonicalSpecSlot[] = typeDoc.spec_schema.map((schemaAxis) => {
        const prev = existingByKey.get(schemaAxis.axis_key);
        if (!preferMarkdown && prev && prev.value_si && !prev.value_si.startsWith('[')) {
            return {
                ...prev,
                label_es: schemaAxis.label_es,
                unit_si: schemaAxis.unit_si,
                mandatory: schemaAxis.mandatory,
                is_differentiator: schemaAxis.is_differentiator,
                value_kind: schemaAxis.value_kind,
            };
        }

        let rescuedValue: string | null = null;
        if (schemaAxis.axis_key === 'fuente_energia' && profile.energy_source !== 'NO_DECLARADO') {
            const mapLabel: Record<string, string> = {
                DIESEL: 'Diésel',
                GASOLINA: 'Gasolina',
                ELECTRICO_RED_AC: 'Eléctrico Red AC',
                ELECTRICO_BATERIA_BEV: 'Eléctrico Batería (BEV)',
                HIBRIDO_DIESEL_ELECTRICO: 'Híbrido Diésel-Eléctrico',
                HIBRIDO_GASOLINA_ELECTRICO: 'Híbrido Gasolina-Eléctrico',
                DUAL_FUEL_DIESEL_GAS: 'Dual-Fuel Diésel-Gas',
                GLP_GNV: 'GLP / GNV',
                NEUMATICO_AIRE_COMPRIMIDO: 'Neumático (Aire Comprimido)',
            };
            rescuedValue = profile.energy_spec_label || mapLabel[profile.energy_source] || null;
        } else if (schemaAxis.axis_key === 'transmision_caja') {
            rescuedValue = preliminaryConfig.transmission_model_spec || null;
        } else if (
            schemaAxis.axis_key === 'traccion_ejes' ||
            schemaAxis.axis_key === 'traccion' ||
            schemaAxis.axis_key === 'configuracion_rodaje'
        ) {
            rescuedValue = preliminaryConfig.axle_or_undercarriage_config || null;
        } else if (schemaAxis.axis_key === 'consumo_energetico_nominal') {
            rescuedValue =
                profile.hourly_consumption_by_load.medium_load_50_65pct ||
                profile.road_haul_efficiency.km_per_liter ||
                profile.road_haul_efficiency.liters_per_100km ||
                profile.pneumatic_or_hydraulic_flow ||
                profile.specific_consumption_bsfc_gkwh ||
                null;
        } else if (schemaAxis.axis_key === 'capacidad_energetica_autonomia') {
            rescuedValue = profile.storage_and_autonomy.tank_or_battery_capacity || null;
        } else if (schemaAxis.axis_key === 'caudal_presion_hidraulica_aux' && fullMarkdown) {
            const flowMatch = fullMarkdown.match(
                /(?:caudal\s+hidr[aá]ulico(?:\s+auxiliar|\s+xhp|\s+m[aá]ximo)?|high\s+flow|xhp)[^\n]{0,65}?(\d{2,3}(?:[.,]\d+)?\s*L\/min)/i
            );
            const pressMatch = fullMarkdown.match(
                /(?:presi[oó]n\s+hidr[aá]ulica(?:\s+auxiliar|\s+xhp|\s+de\s+alivio)?|xhp)[^\n]{0,65}?(\d{2,3}(?:[.,]\d+)?\s*bar)/i
            );
            if (flowMatch && pressMatch) {
                rescuedValue = `${flowMatch[1].trim()} @ ${pressMatch[1].trim()}`;
            } else if (flowMatch) {
                rescuedValue = flowMatch[1].trim();
            }
        } else if (schemaAxis.axis_key === 'carga_vuelco_estatica' && fullMarkdown) {
            const tipMatch = fullMarkdown.match(
                /(?:carga\s+(?:est[aá]tica\s+de\s+)?vuelco|tipping\s+load)[^\n]{0,60}?(\d{1,2}[.,]\d{3}\s*kg|\d{3,5}\s*kg)/i
            );
            if (tipMatch) {
                rescuedValue = tipMatch[1].trim();
            }
        } else if (schemaAxis.axis_key === 'peso_operativo' && fullMarkdown) {
            const weightMatch = fullMarkdown.match(
                /(?:peso\s+operativo|operating\s+weight)[^\n]{0,60}?(\d{1,3}(?:[.,]\d{3})+\s*kg|\d{3,6}\s*kg)/i
            );
            if (weightMatch) {
                rescuedValue = weightMatch[1].trim();
            }
        } else if (schemaAxis.axis_key === 'potencia_neta' && fullMarkdown) {
            const powerMatch = fullMarkdown.match(
                /(?:potencia\s+neta|net\s+power)[^\n]{0,60}?(\d{1,4}(?:[.,]\d+)?\s*kW(?:\s*\(\s*\d{1,4}\s*HP\s*\))?)/i
            );
            if (powerMatch) {
                rescuedValue = powerMatch[1].trim();
            }
        } else if (schemaAxis.axis_key === 'roc_capacidad_nominal' && fullMarkdown) {
            const rocMatch = fullMarkdown.match(
                /(?:capacidad\s+operativa\s+nominal|\broc\b)[^\n]{0,60}?(\d{1,2}[.,]\d{3}\s*kg|\d{3,5}\s*kg)/i
            );
            if (rocMatch) {
                rescuedValue = rocMatch[1].trim();
            }
        }

        const finalVal =
            rescuedValue || (prev && prev.value_si && !prev.value_si.startsWith('[') ? prev.value_si : null);

        return {
            axis_key: schemaAxis.axis_key,
            label_es: schemaAxis.label_es,
            value_si: finalVal,
            unit_si: schemaAxis.unit_si,
            mandatory: schemaAxis.mandatory,
            is_differentiator: schemaAxis.is_differentiator,
            value_kind: schemaAxis.value_kind,
            ...(schemaAxis.allowed_enum_values ? { allowed_enum_values: schemaAxis.allowed_enum_values } : {}),
            source_url: rescuedValue ? profile.source_url || primaryVerifiedUrl : prev?.source_url || null,
            verbatim_evidence: prev?.verbatim_evidence || null,
        };
    });

    const canonicalTypeLabel = String(data.tipo_equipo || typeDoc.canonical_type_es || '').trim();
    let nextAmbiente = sanitizeDesignAndWorkContextItems(data.ambiente_operativo, undefined, {
        canonicalTypeEs: canonicalTypeLabel,
    });
    let nextContexto = sanitizeDesignAndWorkContextItems(data.contexto_operativo, undefined, {
        canonicalTypeEs: canonicalTypeLabel,
    });
    let finalSlots = mergedSlots;

    const needsContextUpgrade =
        hasOnlyGenericOrMissingContextItems(data.ambiente_operativo, { canonicalTypeEs: canonicalTypeLabel }) ||
        hasOnlyGenericOrMissingContextItems(data.contexto_operativo, { canonicalTypeEs: canonicalTypeLabel });
    const missingDiffAxes = finalSlots.filter((s) => s.is_differentiator && !s.value_si).length;

    if (Boolean(options?.allowGroundedEnrichmentIfNeeded) && (needsContextUpgrade || missingDiffAxes > 0)) {
        try {
            const enriched = await enrichCatalogProfile(
                makeOficial,
                modelOficial,
                {
                    equipment_type_key: typeDoc.type_key,
                    tipo_equipo: typeDoc.canonical_type_es,
                    categoria_equipo: data.categoria_equipo || typeDoc.categoria_equipo,
                    ambiente_operativo: nextAmbiente,
                    contexto_operativo: nextContexto,
                },
                Boolean(data.is_generic),
                {
                    globalAssetId,
                    preResolvedTypeDoc: typeDoc,
                }
            );

            if (
                !hasOnlyGenericOrMissingContextItems(enriched.ambiente_operativo, {
                    canonicalTypeEs: canonicalTypeLabel,
                })
            ) {
                nextAmbiente = sanitizeDesignAndWorkContextItems(enriched.ambiente_operativo, undefined, {
                    canonicalTypeEs: canonicalTypeLabel,
                });
            }
            if (
                !hasOnlyGenericOrMissingContextItems(enriched.contexto_operativo, {
                    canonicalTypeEs: canonicalTypeLabel,
                })
            ) {
                nextContexto = sanitizeDesignAndWorkContextItems(enriched.contexto_operativo, undefined, {
                    canonicalTypeEs: canonicalTypeLabel,
                });
            }
            if (Array.isArray(enriched.canonical_specs)) {
                finalSlots = finalSlots.map((slot) => {
                    if (slot.value_si && !slot.value_si.startsWith('[')) return slot;
                    const found = enriched.canonical_specs?.find((e) => e.axis_key === slot.axis_key);
                    return found && found.value_si ? { ...slot, ...found } : slot;
                });
            }
        } catch {
            // Conservar slots y listas sanitizadas locales si el enriquecedor falla
        }
    }

    finalSlots = normalizeCanonicalSlotsByResolvedEnergy(finalSlots, {
        typeContextText: canonicalTypeLabel,
        primaryEnergy: data.physical_traits?.primary_energy || null,
        energyValueText:
            profile.energy_spec_label ||
            (profile.energy_source !== 'NO_DECLARADO' ? profile.energy_source : null),
    });

    const nextCaracteristicas = serializeCanonicalSlotsToSpecsArray(finalSlots);
    const nextConfigProfile = inferAssetConfigurationProfile({
        make_oficial: makeOficial,
        model_oficial: modelOficial,
        tipo_equipo: data.tipo_equipo || typeDoc.canonical_type_es,
        categoria_equipo: data.categoria_equipo || typeDoc.categoria_equipo,
        version: data.version,
        physical_traits: data.physical_traits,
        canonical_specs: finalSlots,
        caracteristicas_principales: nextCaracteristicas,
        chassis_versions: data.chassis_versions,
        extra_evidence_text: fullMarkdown.slice(0, 6000),
        existing_profile: data.configuration_profile,
    });

    const currentProfile: SidebarProfileSnapshot = {
        equipment_type_key: String(data.equipment_type_key || typeDoc.type_key),
        canonical_specs: existingSlots,
        caracteristicas_principales: Array.isArray(data.caracteristicas_principales)
            ? data.caracteristicas_principales.map((s: unknown) => String(s))
            : [],
        ambiente_operativo: Array.isArray(data.ambiente_operativo)
            ? data.ambiente_operativo.map((s: unknown) => String(s))
            : [],
        contexto_operativo: Array.isArray(data.contexto_operativo)
            ? data.contexto_operativo.map((s: unknown) => String(s))
            : [],
        energy_consumption_profile: data.energy_consumption_profile || null,
        configuration_profile: data.configuration_profile || null,
    };

    const proposedProfile: SidebarProfileSnapshot = {
        equipment_type_key: typeDoc.type_key,
        canonical_specs: finalSlots,
        caracteristicas_principales: nextCaracteristicas,
        ambiente_operativo: nextAmbiente,
        contexto_operativo: nextContexto,
        energy_consumption_profile: profile,
        configuration_profile: nextConfigProfile,
    };

    return { currentProfile, proposedProfile, canonicalTypeLabel };
}

function mergeApprovedSidebarProfile(
    approvedProfile: Record<string, unknown>,
    baseProposed: SidebarProfileSnapshot
): SidebarProfileSnapshot {
    const cleanStringArray = (raw: unknown, fallback: string[]): string[] => {
        if (!Array.isArray(raw)) return fallback;
        return raw
            .map((entry) =>
                ConfidentialityAirlockService.scrubDeterministicPii(String(entry ?? '')).scrubbed.trim()
            )
            .filter(Boolean);
    };

    const nextSlots: CanonicalSpecSlot[] = Array.isArray(approvedProfile.canonical_specs)
        ? (scrubUnknownStringsDeep(approvedProfile.canonical_specs) as CanonicalSpecSlot[])
        : baseProposed.canonical_specs;

    const nextCaracteristicas = Array.isArray(approvedProfile.caracteristicas_principales)
        ? cleanStringArray(approvedProfile.caracteristicas_principales, baseProposed.caracteristicas_principales)
        : Array.isArray(approvedProfile.canonical_specs)
          ? serializeCanonicalSlotsToSpecsArray(nextSlots)
          : baseProposed.caracteristicas_principales;

    return {
        equipment_type_key:
            typeof approvedProfile.equipment_type_key === 'string' &&
            approvedProfile.equipment_type_key.trim().length > 0
                ? ConfidentialityAirlockService.scrubDeterministicPii(
                      approvedProfile.equipment_type_key.trim()
                  ).scrubbed
                : baseProposed.equipment_type_key,
        canonical_specs: nextSlots,
        caracteristicas_principales: nextCaracteristicas,
        ambiente_operativo: cleanStringArray(approvedProfile.ambiente_operativo, baseProposed.ambiente_operativo),
        contexto_operativo: cleanStringArray(approvedProfile.contexto_operativo, baseProposed.contexto_operativo),
        energy_consumption_profile:
            approvedProfile.energy_consumption_profile &&
            typeof approvedProfile.energy_consumption_profile === 'object' &&
            !Array.isArray(approvedProfile.energy_consumption_profile)
                ? (scrubUnknownStringsDeep(approvedProfile.energy_consumption_profile) as Record<string, any>)
                : baseProposed.energy_consumption_profile,
        configuration_profile:
            approvedProfile.configuration_profile &&
            typeof approvedProfile.configuration_profile === 'object' &&
            !Array.isArray(approvedProfile.configuration_profile)
                ? (scrubUnknownStringsDeep(approvedProfile.configuration_profile) as Record<string, any>)
                : baseProposed.configuration_profile,
    };
}

async function checkVaultNotSealed(req: ScopedRequest, res: Response, next: NextFunction) {
    const globalAssetId =
        req.body?.globalAssetId ||
        req.body?.assetId ||
        req.params?.globalAssetId ||
        req.query?.globalAssetId ||
        req.query?.assetId;
    if (!globalAssetId || typeof globalAssetId !== 'string') {
        return next();
    }

    try {
        const snap = await db.collection('global_asset_catalog').doc(globalAssetId).get();
        (req as any).catalogDocSnap = snap;
        if (req.body?.previewOnly === true) {
            return next();
        }
        const data = snap.data();
        if (
            snap.exists &&
            (data?.isSealed === true ||
                data?.is_sealed === true ||
                data?.knowledge_vault?.is_sealed === true)
        ) {
            return res.status(403).json({
                error: 'VAULT_SEALED',
                message: 'La bóveda técnica está sellada y no admite mutaciones sin desbloqueo previo.',
            });
        }
        return next();
    } catch {
        return next();
    }
}

function reindexPillarItems(items: any[]): any[] {
    const active = items.filter((it) => !it.is_discarded).sort((a, b) => (a.order || 0) - (b.order || 0));
    const discarded = items.filter((it) => it.is_discarded).sort((a, b) => (a.order || 0) - (b.order || 0));
    active.forEach((it, idx) => {
        it.order = idx + 1;
    });
    discarded.forEach((it, idx) => {
        it.order = active.length + idx + 1;
    });
    return [...active, ...discarded];
}

async function sanitizeAndEnrichItemContentForSave(
    rawContent: string,
    pillarId: PillarId
): Promise<{ content: string; symbologyRefs: string[] }> {
    const unitChecked = verifyAndNormalizeTechnicalUnits(String(rawContent || ''));
    const symbologyRes = await injectVerifiedInlineSymbology(unitChecked.normalizedMarkdown, {
        pillarId,
    });
    return {
        content: symbologyRes.enrichedMarkdown,
        symbologyRefs: symbologyRes.detectedConceptIds,
    };
}

/**
 * Orquestador de Cadena Indirecta Multi-Pilar (`propagateItemContentMutationEffects`):
 * Ejecutado tras cualquier mutación en los editores de contenido de la columna derecha
 * (`apply-assist-proposal`, `evolve-item`, `update-item-content`, `rollback-item-version`,
 * `update-item-approval-state`, `resolve-pending-figure`):
 * 1. Calcula `content_digest_sha256` del pilar y actualiza `vault_merkle_root_sha256`.
 * 2. Sincroniza el contenido curado en `vault_corpus_chunks` (`southamerica-west1`) para retroalimentar el RAG soberano.
 * 3. Si `pillarId === 'ficha_tecnica'`, reconcilia automáticamente la Ficha Lateral Izquierda y la Matriz Energética.
 */
async function propagateItemContentMutationEffects(params: {
    globalAssetId: string;
    pillarId: PillarId;
    itemId: string;
    updatedItem: any;
    updatedItems: any[];
    existingVault: Record<string, any> | undefined;
}): Promise<{ contentDigestSha256: string | null; vaultMerkleRootSha256: string | null }> {
    const { globalAssetId, pillarId, itemId, updatedItem, updatedItems, existingVault } = params;
    const docRef = db.collection('global_asset_catalog').doc(globalAssetId);

    const contentDigestSha256 = computePillarContentDigestSha256(updatedItems);
    const updatedPillarDoc = {
        ...(existingVault?.[pillarId] || {
            pillar_id: pillarId,
            status: 'COMPLETED',
            itemize_status: 'COMPLETED',
            make_model: '',
        }),
        pillar_id: pillarId,
        items: updatedItems,
        content_digest_sha256: contentDigestSha256,
        updated_at: new Date().toISOString(),
    };
    const nextVault = {
        ...(existingVault || {}),
        [pillarId]: updatedPillarDoc,
    };
    const vaultMerkleRootSha256 = computeVaultMerkleRootSha256(nextVault);

    await VaultPersistenceService.savePillarDocument({
        globalAssetId,
        pillarId,
        pillarDoc: updatedPillarDoc as any,
        vaultMerkleRootSha256,
    });

    if (updatedItem && typeof updatedItem.content === 'string' && updatedItem.content.trim().length > 0) {
        const chunkId = `curated_${pillarId}_${itemId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
        await docRef
            .collection('vault_corpus_chunks')
            .doc(chunkId)
            .set(
                {
                    chunk_id: chunkId,
                    pillar_id: pillarId,
                    item_id: itemId,
                    chapter_title: String(updatedItem.title || itemId),
                    section: String(updatedItem.section || ''),
                    source_filename: 'Curaduría Técnica HITL Soberana (southamerica-west1)',
                    markdown_es: updatedItem.content,
                    is_curated_hitl: true,
                    is_human_locked: Boolean(updatedItem.is_human_locked),
                    estado_aprobacion: String(updatedItem.estado_aprobacion || 'GENERADO_IA'),
                    updated_at: new Date().toISOString(),
                },
                { merge: true }
            )
            .catch(() => undefined);
    }

    if (pillarId === 'ficha_tecnica') {
        await reconcileAssetSidebarProfileFromVault(globalAssetId, {
            allowGroundedEnrichmentIfNeeded: false,
            preferVaultMarkdownOverExisting: true,
        }).catch(() => null);
    }

    if (pillarId === 'ficha_tecnica' || pillarId === 'pauta_mantencion') {
        await buildAndPersistEquipmentCostMatrix(globalAssetId).catch(() => null);
    }

    scheduleDebouncedAssetSymbologyPackRebuild(globalAssetId);

    return { contentDigestSha256, vaultMerkleRootSha256 };
}

// ── ETAPA 2: INICIALIZACIÓN E ITEMIZADO ON-DEMAND POR PILAR ──────────────────

const InitializeVaultBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
});

vaultRouter.post('/initialize-vault', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = InitializeVaultBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'globalAssetId es requerido.');
    }
    const { globalAssetId } = parsed.data;

    try {
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) {
            return res.status(404).json({ error: 'Activo no encontrado en global_asset_catalog.' });
        }

        const data = hydrated.data;
        const hasVaultKeys =
            data.knowledge_vault &&
            VALID_PILLAR_IDS.some((pid) => Boolean(data.knowledge_vault?.[pid]));

        let healedFicha = false;
        let healedPauta = false;

        if (!hasVaultKeys) {
            const makeModel =
                data.make_model || `${data.make_oficial || data.make || ''} ${data.model_oficial || data.model || ''}`.trim();
            await docRef.update({
                knowledge_vault: createEmptyKnowledgeVault(makeModel),
                vault_partition_version: 3,
                updatedAt: Date.now(),
            });
        } else {
            const fichaDoc = data.knowledge_vault?.ficha_tecnica;
            const fichaItems = Array.isArray(fichaDoc?.items) ? fichaDoc.items : [];
            if (fichaItems.length > 0 && !data.is_sealed && !data.isSealed && !data.knowledge_vault?.is_sealed) {
                const healed = ensureFichaTecnicaConsumptionBaseItem({
                    items: fichaItems,
                    typeDoc: {
                        type_key: String(data.equipment_type_key || data.tipo_equipo || ''),
                        canonical_type_es: String(data.tipo_equipo || 'MAQUINARIA INDUSTRIAL'),
                        categoria_equipo: String(data.categoria_equipo || 'MAQUINARIA'),
                        physical_traits: data.physical_traits,
                    } as any,
                    defaultSources: Array.isArray(fichaDoc?.classified_sources_itemized)
                        ? fichaDoc.classified_sources_itemized
                        : [],
                });
                if (healed.modified) {
                    healedFicha = true;
                    const structureDigest = computePillarStructureDigestSha256(healed.items, null) || '';
                    await VaultPersistenceService.savePillarDocument({
                        globalAssetId,
                        pillarId: 'ficha_tecnica',
                        pillarDoc: {
                            ...fichaDoc,
                            pillar_id: 'ficha_tecnica',
                            items: healed.items,
                            structure_digest_sha256: structureDigest,
                            updated_at: new Date().toISOString(),
                        },
                    });
                }
            }

            const pmDoc = data.knowledge_vault?.pauta_mantencion;
            const pmItems = Array.isArray(pmDoc?.items) ? pmDoc.items : [];
            if (pmItems.length > 0 && !data.is_sealed && !data.isSealed && !data.knowledge_vault?.is_sealed) {
                const healedPm = ensurePautaMantencionWearAndRodadoBaseItem({
                    items: pmItems,
                    typeDoc: {
                        type_key: String(data.equipment_type_key || data.tipo_equipo || ''),
                        canonical_type_es: String(data.tipo_equipo || 'MAQUINARIA INDUSTRIAL'),
                        categoria_equipo: String(data.categoria_equipo || 'MAQUINARIA'),
                        physical_traits: data.physical_traits,
                    } as any,
                    defaultSources: Array.isArray(pmDoc?.classified_sources_itemized)
                        ? pmDoc.classified_sources_itemized
                        : [],
                });
                if (healedPm.modified) {
                    healedPauta = true;
                    const pmStructureDigest =
                        computePillarStructureDigestSha256(
                            healedPm.items,
                            pmDoc?.parent_pillar_digest_sha256 || null
                        ) || '';
                    await VaultPersistenceService.savePillarDocument({
                        globalAssetId,
                        pillarId: 'pauta_mantencion',
                        pillarDoc: {
                            ...pmDoc,
                            pillar_id: 'pauta_mantencion',
                            items: healedPm.items,
                            structure_digest_sha256: pmStructureDigest,
                            updated_at: new Date().toISOString(),
                        },
                    });
                }
            }
        }

        if (!data.is_sealed && !data.isSealed && !data.knowledge_vault?.is_sealed) {
            await buildAndPersistEquipmentCostMatrix(globalAssetId).catch(() => null);
        }

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_INITIALIZED',
            targetEntity: `global_asset_catalog/${globalAssetId}`,
            details: {
                globalAssetId,
                createdEmptyVault: !hasVaultKeys,
                healedFicha,
                healedPauta,
            },
        }).catch(() => undefined);

        return res.status(200).json({
            success: true,
            message: 'Estructura base de 5 pilares inicializada en IDLE.',
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error inicializando bóveda técnica.');
    }
});

vaultRouter.post('/itemize-pillar', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().trim().min(1).max(160),
        pillarId: VaultPillarIdSchema,
        forceSmartMerge: z.boolean().optional(),
        confirmWord: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros inválidos (globalAssetId, pillarId).');
    }

    const { globalAssetId, pillarId, forceSmartMerge, confirmWord } = parsed.data;
    if (forceSmartMerge === true && !isValidHitlConfirmWord(confirmWord)) {
        return sendConfirmWordMismatch(res);
    }

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) {
            return res.status(404).json({ error: 'Catálogo no encontrado.' });
        }
        const data = hydrated.data;
        const gate = validateCatalogProfileGate(data);
        if (!gate.valid) {
            return res.status(422).json({
                error: 'PERFIL_INCOMPLETO',
                message: 'Complete el perfil técnico base antes de itemizar este pilar.',
                missingFields: gate.missingFields,
            });
        }

        const pillar = data.knowledge_vault?.[pillarId];
        const isAuthorizedSmartMerge = forceSmartMerge === true && isValidHitlConfirmWord(confirmWord);

        // Compuerta de secuencia lógica de 5 pilares (`01 ➔ 02 ➔ 03 ➔ 04 ➔ 05`)
        const prerequisitePillarId = PILLAR_PREREQUISITE_MAP[pillarId];
        let isParentPillarEvolved = false;
        if (prerequisitePillarId) {
            const prereqPillar = data.knowledge_vault?.[prerequisitePillarId];
            const prereqActiveItems = Array.isArray(prereqPillar?.items)
                ? prereqPillar.items.filter((it: any) => !it?.is_discarded)
                : [];
            if (prereqActiveItems.length === 0) {
                const prereqLabel = PILLAR_LABELS[prerequisitePillarId] || prerequisitePillarId;
                const currentLabel = PILLAR_LABELS[pillarId] || pillarId;
                return res.status(409).json({
                    error: 'PREREQUISITE_PILLAR_NOT_ITEMIZED',
                    code: 'SECUENCIA_PILAR_BLOQUEADA',
                    prerequisitePillarId,
                    message: `Secuencia de 5 Pilares: Debe itemizar primero "${prereqLabel}" antes de itemizar "${currentLabel}".`,
                });
            }
            if (isPillarMerkleChainEvolved(data.knowledge_vault, pillarId)) {
                isParentPillarEvolved = true;
            }
        }

        if (pillar?.itemize_status === 'COMPLETED' && !isAuthorizedSmartMerge && !isParentPillarEvolved) {
            return res.status(409).json({
                error: 'ALREADY_ITEMIZED',
                message:
                    'El pilar ya fue itemizado. Para sincronizar y fusionar nuevos subsistemas sin borrar datos existentes, autorice con "ACTUALIZAR".',
            });
        }
        if (pillar?.itemize_status === 'GENERATING') {
            const startedMs = pillar.started_at ? new Date(pillar.started_at).getTime() : 0;
            if (startedMs > 0 && Date.now() - startedMs < 45 * 1000) {
                return res.status(409).json({
                    error: 'ALREADY_ITEMIZED',
                    message: 'El pilar se encuentra en itemización activa.',
                });
            }
        }

        const result = await itemizeSinglePillar(globalAssetId, pillarId, {
            actorId: ctx.actorId,
            actorEmail: ctx.actorEmail,
            forceSmartMerge: isAuthorizedSmartMerge,
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_PILLAR_ITEMIZED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}`,
            details: {
                globalAssetId,
                pillarId,
                totalItems: result.totalItems,
                preservedItemsCount: result.preservedItemsCount ?? 0,
                addedItemsCount: result.addedItemsCount ?? result.totalItems,
                forceSmartMerge: isAuthorizedSmartMerge,
            },
        }).catch(() => undefined);

        return res.status(200).json({
            success: true,
            items: result.items,
            classified_sources: result.classified_sources,
            preservedItemsCount: result.preservedItemsCount ?? 0,
            addedItemsCount: result.addedItemsCount ?? result.totalItems,
            message: `Pilar ${pillarId} itemizado (${result.totalItems} ítems activos).`,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error ejecutando itemizado del pilar.');
    }
});

vaultRouter.post(
    '/asset-image',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const rawConfirmWord = req.body?.confirmWord ?? req.query?.confirmWord;
        if (!isValidHitlConfirmWord(rawConfirmWord)) {
            return sendConfirmWordMismatch(res);
        }

        const parsed = VaultUpdateAssetImageBodySchema.safeParse({
            ...(req.body || {}),
            confirmWord: String(rawConfirmWord),
        });
        if (!parsed.success) {
            return sendZodBadRequest(res, parsed.error, 'Parámetros de imagen inválidos.');
        }

        const {
            tenantAssetId,
            imageUrl,
            imagePath,
            imageMetadata,
            fotoMediaTelemetry,
            fotoVlmAuditVersion,
            officialPhotoCandidates,
        } = parsed.data;
        const globalAssetId = String(parsed.data.globalAssetId || parsed.data.assetId);

        try {
            const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
            const snap = await docRef.get();
            if (!snap.exists) {
                return res.status(404).json({ error: 'Activo no encontrado en catálogo.' });
            }
            const data = snap.data() || {};
            const nextSpecs = {
                ...(data.specifications || {}),
                imageUrl: imageUrl ?? null,
                imagePath: imagePath ?? null,
                imageMetadata: imageMetadata ?? null,
            };

            const existingPool = Array.isArray(data.official_photo_candidates)
                ? data.official_photo_candidates
                : [];
            const incomingPool = Array.isArray(officialPhotoCandidates) ? officialPhotoCandidates : [];
            const mergedCandidates: Record<string, any>[] = [];
            const seenShas = new Set<string>();
            for (const cand of [...incomingPool, ...existingPool]) {
                const sha = String((cand as any)?.sha256 || '').trim();
                const preview = String((cand as any)?.preview_url || '').trim();
                if (sha && preview && !seenShas.has(sha) && mergedCandidates.length < 12) {
                    seenShas.add(sha);
                    mergedCandidates.push(cand as Record<string, any>);
                }
            }

            const telemetrySha =
                fotoMediaTelemetry && typeof (fotoMediaTelemetry as any).sha256 === 'string'
                    ? String((fotoMediaTelemetry as any).sha256)
                    : null;

            const matchedAuditCandidate = imageUrl
                ? mergedCandidates.find(
                      (c) =>
                          c &&
                          (c.preview_url === imageUrl || (telemetrySha && c.sha256 === telemetrySha))
                  )
                : null;
            const resolvedPhotoAuditVersion: number | null = !imageUrl
                ? null
                : typeof fotoVlmAuditVersion === 'number'
                ? fotoVlmAuditVersion
                : typeof matchedAuditCandidate?.vlm_audit_version === 'number'
                ? matchedAuditCandidate.vlm_audit_version
                : typeof data.foto_vlm_audit_version === 'number'
                ? data.foto_vlm_audit_version
                : null;

            const nowMs = Date.now();
            const updatePayload: Record<string, any> = {
                foto_url: imageUrl ?? '',
                foto_media_telemetry: fotoMediaTelemetry ?? imageMetadata ?? null,
                foto_vlm_audit_version: resolvedPhotoAuditVersion,
                specifications: nextSpecs,
                updatedAt: nowMs,
            };
            if (mergedCandidates.length > 0) {
                updatePayload.official_photo_candidates = mergedCandidates;
            }
            await docRef.update(updatePayload);

            if (tenantAssetId && tenantAssetId !== globalAssetId) {
                await db
                    .collection('tenant_assets')
                    .doc(tenantAssetId)
                    .update({
                        foto_url: imageUrl ?? '',
                        foto_media_telemetry: fotoMediaTelemetry ?? imageMetadata ?? null,
                        foto_vlm_audit_version: resolvedPhotoAuditVersion,
                        updatedAt: nowMs,
                    })
                    .catch(() => undefined);
            }

            void AuditLedger.record({
                tenantId: 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: imageUrl ? 'VAULT_ASSET_IMAGE_UPDATED' : 'VAULT_ASSET_IMAGE_REMOVED',
                targetEntity: `global_asset_catalog/${globalAssetId}`,
                details: {
                    globalAssetId,
                    hasImage: Boolean(imageUrl),
                    imagePath: imagePath || null,
                    telemetry: fotoMediaTelemetry || null,
                },
            }).catch(() => undefined);

            return res.status(200).json({ ok: true, success: true, specifications: nextSpecs });
        } catch (err) {
            return handleVaultError(res, err, 'Error actualizando fotografía oficial del activo.');
        }
    }
);

const HuntOfficialPhotoBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    refreshAttempt: z.number().int().min(0).max(50).optional().default(0),
    excludeSha256s: z.array(z.string().trim().max(128)).max(100).optional().default([]),
});

vaultRouter.post(
    '/hunt-official-photo',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const parsed = HuntOfficialPhotoBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return sendZodBadRequest(res, parsed.error, 'globalAssetId es requerido.');
        }
        const { globalAssetId, refreshAttempt, excludeSha256s } = parsed.data;
        try {
            const candidates = await OfficialEquipmentPhotoService.huntOfficialEquipmentPhotos({
                globalAssetId,
                actorId: ctx.actorId,
                actorEmail: ctx.actorEmail,
                refreshAttempt,
                excludeSha256s,
            });
            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: 'VAULT_OFFICIAL_PHOTO_HUNTED',
                targetEntity: `global_asset_catalog/${globalAssetId}`,
                details: {
                    globalAssetId,
                    refreshAttempt,
                    candidatesFound: Array.isArray(candidates) ? candidates.length : 0,
                },
            }).catch(() => undefined);
            return res.status(200).json({ success: true, candidates });
        } catch (err) {
            return handleVaultError(res, err, 'Error ejecutando caza asistida de fotografía oficial.');
        }
    }
);

const VerifyManualPhotoInputSchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    imageUrl: z.string().trim().max(2048).optional(),
});

vaultRouter.post(
    '/verify-manual-official-photo',
    requireCurateAI,
    checkVaultNotSealed,
    upload.single('file'),
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const parsed = VerifyManualPhotoInputSchema.safeParse({
            globalAssetId: req.body?.globalAssetId ?? req.query?.globalAssetId,
            imageUrl: req.body?.imageUrl,
        });
        if (!parsed.success) {
            return sendZodBadRequest(res, parsed.error, 'globalAssetId es requerido.');
        }
        const { globalAssetId, imageUrl: rawBodyImageUrl } = parsed.data;

        let fileBuffer: Buffer | null = null;
        let mimeType = 'image/jpeg';
        let fileName = 'manual_upload.webp';

        if (req.file) {
            fileBuffer = req.file.buffer;
            mimeType = req.file.mimetype || 'image/jpeg';
            fileName = req.file.originalname || 'manual_photo.webp';
        } else if (rawBodyImageUrl) {
            const safeUrl = await assertSafeExternalUrl(rawBodyImageUrl).catch(() => null);
            if (safeUrl) {
                const fetched = await safeFetchExternal(safeUrl.toString(), {
                    maxBytes: 12 * 1024 * 1024,
                    headers: { 'User-Agent': 'MINREPORT-OfficialPhotoBot/1.0' },
                }).catch(() => null);
                if (fetched && fetched.ok) {
                    const ab = await fetched.arrayBuffer();
                    fileBuffer = Buffer.from(ab);
                    mimeType = (fetched.headers.get('content-type') || '').split(';')[0].trim() || 'image/jpeg';
                    fileName = safeUrl.pathname.split('/').pop() || 'remote_photo.webp';
                }
            }
        }

        if (!fileBuffer || fileBuffer.length < 50) {
            return res.status(400).json({ error: 'Archivo de imagen requerido para verificación.' });
        }

        try {
            const result = await OfficialEquipmentPhotoService.verifyManualOfficialEquipmentPhoto({
                globalAssetId,
                fileBuffer,
                mimeType,
                fileName,
                actorId: ctx.actorId,
            });
            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: 'VAULT_MANUAL_PHOTO_VERIFIED',
                targetEntity: `global_asset_catalog/${globalAssetId}`,
                details: {
                    globalAssetId,
                    fileName,
                    mimeType,
                    inputBytes: fileBuffer.length,
                },
            }).catch(() => undefined);
            return res.status(200).json({ success: true, ...result });
        } catch (err) {
            return handleVaultError(res, err, 'Error auditando fotografía manual.');
        }
    }
);

vaultRouter.post(
    '/reframe-official-photo',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const parsed = ReframeOfficialPhotoBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return sendZodBadRequest(res, parsed.error, 'assetId o globalAssetId es requerido.');
        }

        const { previewOnly, confirmWord, proposedUrl, proposedSha256, proposedMetrics } = parsed.data;
        const targetAssetId = String(parsed.data.assetId || parsed.data.globalAssetId);

        if (!previewOnly && !isValidHitlConfirmWord(confirmWord)) {
            return sendConfirmWordMismatch(res);
        }

        try {
            const docRef = db.collection('global_asset_catalog').doc(targetAssetId);
            const snap = await docRef.get();
            if (!snap.exists) {
                return res.status(404).json({ error: 'Activo no encontrado.' });
            }

            const data = snap.data() || {};
            const currentUrl = String(data.foto_url || '').trim();
            if (!currentUrl) {
                return res.status(400).json({ error: 'El activo no tiene fotografía cargada para re-encuadrar.' });
            }

            // Camino de consolidación directa desde vista previa CAS aprobada por humano (`previewOnly === false` + `proposedUrl`)
            if (!previewOnly && proposedUrl) {
                if (/^(?:blob:|data:|javascript:)/i.test(proposedUrl)) {
                    return res.status(400).json({
                        error: 'URL propuesta rechazada (blob:/data: prohibidos en persistencia).',
                    });
                }

                let resolvedUrl = proposedUrl;
                let resolvedSha = proposedSha256 || '';
                let origBytes = Number(
                    proposedMetrics?.original_bytes ??
                        proposedMetrics?.originalBytes ??
                        data.foto_media_telemetry?.original_bytes ??
                        0
                );
                let optBytes = Number(
                    proposedMetrics?.optimized_bytes ?? proposedMetrics?.optimizedBytes ?? 0
                );
                let savingsPct = Number(
                    proposedMetrics?.savings_pct ?? proposedMetrics?.savingsPct ?? 0
                );
                let widthVal = proposedMetrics?.width;
                let heightVal = proposedMetrics?.height;

                if (proposedSha256) {
                    const casDescriptor = await CasStorageService.preflightCheck(
                        proposedSha256,
                        'GLOBAL_OEM'
                    ).catch(() => null);
                    if (!casDescriptor) {
                        return res.status(422).json({
                            error: 'El SHA-256 propuesto no existe en el registro CAS (GLOBAL_OEM).',
                        });
                    }
                    const expectedGateway = CasStorageService.buildGatewayUrl(
                        'GLOBAL_OEM',
                        casDescriptor.sha256,
                        casDescriptor.extension
                    );
                    if (proposedUrl !== casDescriptor.downloadUrl && proposedUrl !== expectedGateway) {
                        return res.status(422).json({
                            error: 'La URL propuesta no coincide con el registro CAS.',
                        });
                    }
                    resolvedUrl = casDescriptor.downloadUrl;
                    resolvedSha = casDescriptor.sha256;
                    origBytes = origBytes > 0 ? origBytes : casDescriptor.originalBytes;
                    optBytes = casDescriptor.optimizedBytes;
                    savingsPct =
                        casDescriptor.savingsPct ??
                        Math.max(
                            0,
                            Math.round(((origBytes - optBytes) / Math.max(1, origBytes)) * 100)
                        );
                    widthVal = casDescriptor.width ?? widthVal;
                    heightVal = casDescriptor.height ?? heightVal;
                }

                const nowIso = new Date().toISOString();
                const consolidatedTelemetry = {
                    original_bytes: origBytes,
                    optimized_bytes: optBytes,
                    savings_pct: savingsPct,
                    originalBytes: origBytes,
                    optimizedBytes: optBytes,
                    savingsPct,
                    sha256: resolvedSha,
                    ...(widthVal ? { width: widthVal } : {}),
                    ...(heightVal ? { height: heightVal } : {}),
                    updated_at: nowIso,
                };

                await docRef.update({
                    foto_url: resolvedUrl,
                    foto_media_telemetry: consolidatedTelemetry,
                    updatedAt: Date.now(),
                });

                void AuditLedger.record({
                    tenantId: 'GLOBAL_OEM',
                    actorUid: ctx.actorId || 'system',
                    actorEmail: ctx.actorEmail || 'curador@minreport.com',
                    module: 'opermaq',
                    action: 'VAULT_ASSET_IMAGE_REFRAMED_STUDIO_88',
                    targetEntity: `global_asset_catalog/${targetAssetId}`,
                    details: {
                        globalAssetId: targetAssetId,
                        previousUrl: currentUrl,
                        proposedUrl: resolvedUrl,
                        sha256: resolvedSha,
                        telemetry: consolidatedTelemetry,
                    },
                }).catch(() => undefined);

                return res.status(200).json({
                    ok: true,
                    success: true,
                    previewOnly: false,
                    currentUrl,
                    proposedUrl: resolvedUrl,
                    proposedSha256: resolvedSha,
                    metrics: consolidatedTelemetry,
                    foto_url: resolvedUrl,
                    foto_media_telemetry: consolidatedTelemetry,
                });
            }

            // Descargar imagen actual (CAS por ruta directa, proxy /api/media/blob o URL externa)
            let imgBuffer: Buffer | null = null;
            const casDirectMatch = currentUrl.match(/(cas_blobs\/[^?#]+)/);
            const casProxyMatch = currentUrl.match(/\/api\/media\/blob\/([^/?#]+)\/([^/?#]+)/);
            const resolvedCasPath = casDirectMatch
                ? casDirectMatch[1]
                : casProxyMatch
                  ? `cas_blobs/${casProxyMatch[1]}/${casProxyMatch[2]}`
                  : null;
            if (resolvedCasPath) {
                const casBlob = await CasStorageService.readCasBlob(resolvedCasPath);
                if (casBlob) imgBuffer = casBlob.buffer;
            }

            if (!imgBuffer) {
                const safeUrl = await assertSafeExternalUrl(currentUrl).catch(() => null);
                if (safeUrl) {
                    const fetched = await safeFetchExternal(safeUrl.toString(), {
                        maxBytes: 12 * 1024 * 1024,
                    }).catch(() => null);
                    if (fetched && fetched.ok) {
                        const ab = await fetched.arrayBuffer();
                        imgBuffer = Buffer.from(ab);
                    }
                }
            }

            if (!imgBuffer) {
                return res.status(422).json({
                    error: 'No se pudo obtener el binario de la imagen actual para re-encuadrar.',
                });
            }

            const storedOrigBytes = Number(data.foto_media_telemetry?.original_bytes || 0);
            const baseOriginalBytes = storedOrigBytes > 0 ? storedOrigBytes : imgBuffer.length;

            const framed = await OfficialEquipmentPhotoService.frameBufferToStudio4x3({
                inputBuffer: imgBuffer,
                originalByteLength: baseOriginalBytes,
            });

            const descriptor = await CasStorageService.persistDigestedBinary(
                {
                    buffer: framed.buffer,
                    sha256: framed.sha256,
                    mimeType: 'image/webp',
                    extension: 'webp',
                    profile: 'IMAGE_TECHNICAL_HD',
                    originalBytes: baseOriginalBytes,
                    optimizedBytes: framed.buffer.length,
                    savingsRatio: Number(
                        ((baseOriginalBytes - framed.buffer.length) / Math.max(1, baseOriginalBytes)).toFixed(4)
                    ),
                    width: framed.width,
                    height: framed.height,
                },
                {
                    scope: 'GLOBAL_OEM',
                    actorUid: ctx.actorId,
                    originalFilename: 'reframed_photo_studio88.webp',
                    clientOriginalBytes: baseOriginalBytes,
                }
            );

            const savingsPct = Math.max(
                0,
                Math.round(((baseOriginalBytes - framed.buffer.length) / Math.max(1, baseOriginalBytes)) * 100)
            );
            const fotoMediaTelemetry = {
                original_bytes: baseOriginalBytes,
                optimized_bytes: framed.buffer.length,
                savings_pct: savingsPct,
                originalBytes: baseOriginalBytes,
                optimizedBytes: framed.buffer.length,
                savingsPct,
                sha256: framed.sha256,
                width: framed.width,
                height: framed.height,
                updated_at: new Date().toISOString(),
            };

            if (previewOnly) {
                return res.status(200).json({
                    ok: true,
                    success: true,
                    previewOnly: true,
                    currentUrl,
                    proposedUrl: descriptor.downloadUrl,
                    proposedSha256: framed.sha256,
                    metrics: fotoMediaTelemetry,
                });
            }

            await docRef.update({
                foto_url: descriptor.downloadUrl,
                foto_media_telemetry: fotoMediaTelemetry,
                updatedAt: Date.now(),
            });

            void AuditLedger.record({
                tenantId: 'GLOBAL_OEM',
                actorUid: ctx.actorId || 'system',
                actorEmail: ctx.actorEmail || 'curador@minreport.com',
                module: 'opermaq',
                action: 'VAULT_ASSET_IMAGE_REFRAMED_STUDIO_88',
                targetEntity: `global_asset_catalog/${targetAssetId}`,
                details: {
                    globalAssetId: targetAssetId,
                    previousUrl: currentUrl,
                    sha256: framed.sha256,
                    telemetry: fotoMediaTelemetry,
                },
            }).catch(() => undefined);

            return res.status(200).json({
                ok: true,
                success: true,
                previewOnly: false,
                currentUrl,
                proposedUrl: descriptor.downloadUrl,
                proposedSha256: framed.sha256,
                metrics: fotoMediaTelemetry,
                foto_url: descriptor.downloadUrl,
                foto_media_telemetry: fotoMediaTelemetry,
            });
        } catch (err) {
            return handleVaultError(res, err, 'Error re-encuadrando fotografía oficial.');
        }
    }
);

vaultRouter.post(
    '/reconcile-sidebar-profile',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const parsed = ReconcileSidebarProfileBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return sendZodBadRequest(res, parsed.error, 'assetId o globalAssetId es requerido.');
        }

        const { previewOnly, confirmWord, approvedProfile } = parsed.data;
        const targetAssetId = String(parsed.data.assetId || parsed.data.globalAssetId);

        if (!previewOnly && !isValidHitlConfirmWord(confirmWord)) {
            return sendConfirmWordMismatch(res);
        }

        try {
            const previewComputed = await computeSidebarProfilePreviewFromVault(targetAssetId, {
                allowGroundedEnrichmentIfNeeded: !approvedProfile,
            });
            if (!previewComputed) {
                return res.status(404).json({
                    error: 'No se encontró el activo para reconciliar su perfil lateral.',
                });
            }

            if (previewOnly) {
                return res.status(200).json({
                    ok: true,
                    success: true,
                    previewOnly: true,
                    currentProfile: previewComputed.currentProfile,
                    proposedProfile: previewComputed.proposedProfile,
                });
            }

            const finalProfile = approvedProfile
                ? mergeApprovedSidebarProfile(approvedProfile, previewComputed.proposedProfile)
                : previewComputed.proposedProfile;

            const docRef = db.collection('global_asset_catalog').doc(targetAssetId);
            await docRef.update({
                equipment_type_key: finalProfile.equipment_type_key,
                canonical_specs: finalProfile.canonical_specs,
                caracteristicas_principales: finalProfile.caracteristicas_principales,
                ambiente_operativo: finalProfile.ambiente_operativo,
                contexto_operativo: finalProfile.contexto_operativo,
                energy_consumption_profile: finalProfile.energy_consumption_profile,
                configuration_profile: finalProfile.configuration_profile,
                updatedAt: Date.now(),
            });

            void AuditLedger.record({
                tenantId: 'GLOBAL_OEM',
                actorUid: ctx.actorId || 'system',
                actorEmail: ctx.actorEmail || 'curador@minreport.com',
                module: 'opermaq',
                action: 'VAULT_SIDEBAR_PROFILE_RECONCILED',
                targetEntity: `global_asset_catalog/${targetAssetId}`,
                details: {
                    globalAssetId: targetAssetId,
                    usedGranularApprovedProfile: Boolean(approvedProfile),
                    caracteristicasCount: finalProfile.caracteristicas_principales.length,
                    ambienteCount: finalProfile.ambiente_operativo.length,
                    contextoCount: finalProfile.contexto_operativo.length,
                },
            }).catch(() => undefined);

            return res.status(200).json({
                ok: true,
                success: true,
                previewOnly: false,
                currentProfile: previewComputed.currentProfile,
                proposedProfile: finalProfile,
                ...finalProfile,
            });
        } catch (err) {
            return handleVaultError(res, err, 'Error reconciliando perfil lateral del equipo.');
        }
    }
);

vaultRouter.post(
    '/update-sidebar-profile',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const schema = z.object({
            globalAssetId: z.string().trim().min(1).max(160),
            confirmationKeyword: z.string().optional(),
            confirmWord: z.string().optional(),
            caracteristicas_principales: z.array(z.string()).optional(),
            ambiente_operativo: z.array(z.string()).optional(),
            contexto_operativo: z.array(z.string()).optional(),
        });

        const parsed = schema.safeParse(req.body || {});
        if (!parsed.success) {
            return sendZodBadRequest(
                res,
                parsed.error,
                'Parámetros inválidos para actualización quirúrgica del perfil lateral.'
            );
        }

        const {
            globalAssetId,
            confirmationKeyword,
            confirmWord,
            caracteristicas_principales,
            ambiente_operativo,
            contexto_operativo,
        } = parsed.data;

        if (!isValidHitlConfirmWord(confirmWord ?? confirmationKeyword)) {
            return sendConfirmWordMismatch(res);
        }

        try {
            const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
            const snap = await docRef.get();
            if (!snap.exists) {
                return res.status(404).json({ error: 'Activo no encontrado.' });
            }

            const updates: Record<string, any> = { updatedAt: Date.now() };
            if (Array.isArray(caracteristicas_principales)) {
                updates.caracteristicas_principales = caracteristicas_principales
                    .map((s) => ConfidentialityAirlockService.scrubDeterministicPii(s).scrubbed.trim())
                    .filter(Boolean);
                updates.sidebar_caracteristicas_human_curated = true;
            }
            if (Array.isArray(ambiente_operativo)) {
                updates.ambiente_operativo = ambiente_operativo
                    .map((s) => ConfidentialityAirlockService.scrubDeterministicPii(s).scrubbed.trim())
                    .filter(Boolean);
                updates.sidebar_ambiente_human_curated = true;
            }
            if (Array.isArray(contexto_operativo)) {
                updates.contexto_operativo = contexto_operativo
                    .map((s) => ConfidentialityAirlockService.scrubDeterministicPii(s).scrubbed.trim())
                    .filter(Boolean);
                updates.sidebar_contexto_human_curated = true;
            }

            await docRef.update(updates);

            void AuditLedger.record({
                tenantId: 'GLOBAL_OEM',
                actorUid: req.opermaqContext?.actorId || 'system',
                actorEmail: req.opermaqContext?.actorEmail || 'curador@minreport.com',
                module: 'opermaq',
                action: 'VAULT_SIDEBAR_PROFILE_HITL_UPDATED',
                targetEntity: `global_asset_catalog/${globalAssetId}`,
                details: {
                    globalAssetId,
                    updatedFields: Object.keys(updates).filter((k) => k !== 'updatedAt'),
                },
            }).catch(() => undefined);

            return res.status(200).json({
                ok: true,
                success: true,
                ...updates,
            });
        } catch (err) {
            return handleVaultError(res, err, 'Error guardando actualización HITL del perfil lateral.');
        }
    }
);

const SuggestComplementaryItemsBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    pillarId: VaultPillarIdSchema,
});

vaultRouter.post(
    '/suggest-complementary-items',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const parsed = SuggestComplementaryItemsBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return sendZodBadRequest(res, parsed.error, 'globalAssetId y pillarId válido son requeridos.');
        }
        const { globalAssetId, pillarId } = parsed.data;

        try {
            const suggestions = await suggestComplementaryPillarItems(globalAssetId, pillarId as PillarId);
            return res.status(200).json({ success: true, suggestions });
        } catch (err) {
            return handleVaultError(res, err, 'Error sugiriendo ítems complementarios.');
        }
    }
);

// ── ETAPA 3: CAZA PROFUNDA POR ÍTEM (SINCRÓNICA Y ASÍNCRONA) ─────────────────

vaultRouter.post('/hunt-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().trim().min(1).max(160),
        pillarId: VaultPillarIdSchema,
        itemId: z.string().trim().min(1).max(160),
        intent: z.enum(['INITIAL_CAPTURE', 'INCREMENTAL_UPDATE']).optional(),
        humanCorrection: z.string().max(4000).optional(),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros inválidos (globalAssetId, pillarId, itemId).');
    }

    const { globalAssetId, pillarId, itemId, intent, humanCorrection } = parsed.data;
    const cleanHumanCorrection = humanCorrection
        ? ConfidentialityAirlockService.scrubDeterministicPii(humanCorrection).scrubbed.trim()
        : undefined;

    try {
        const result = await huntVaultItem({
            globalAssetId,
            pillarId,
            itemId,
            intent,
            humanCorrection: cleanHumanCorrection,
        });

        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Fallo en caza técnica del ítem.' });
        }

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_HUNT_EXECUTED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: {
                pillarId,
                itemId,
                intent: intent || 'INITIAL_CAPTURE',
                mode: result.mode || null,
            },
        }).catch(() => undefined);

        return res.status(200).json({
            success: true,
            content: result.content,
            item_sources: result.item_sources,
            hunted_at: result.hunted_at,
            mode: result.mode,
            newConflictsCount: result.newConflictsCount,
            addedNewCount: result.addedNewCount,
            addedConflictCount: result.addedConflictCount,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error ejecutando caza técnica por ítem.');
    }
});

vaultRouter.post('/hunt-item-async', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().trim().min(1).max(160),
        pillarId: VaultPillarIdSchema,
        itemId: z.string().trim().min(1).max(160),
        intent: z.enum(['INITIAL_CAPTURE', 'INCREMENTAL_UPDATE']).optional(),
        humanCorrection: z.string().max(4000).optional(),
        forceRestart: z.boolean().optional(),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros requeridos: globalAssetId, pillarId, itemId.');
    }

    const { globalAssetId, pillarId, itemId, intent, humanCorrection, forceRestart } = parsed.data;
    const cleanHumanCorrection = humanCorrection
        ? ConfidentialityAirlockService.scrubDeterministicPii(humanCorrection).scrubbed.trim()
        : undefined;
    const taskId = buildHuntTaskId(globalAssetId, pillarId, itemId);

    try {
        const taskDoc = await db.collection('task_status').doc(taskId).get();
        if (taskDoc.exists && !forceRestart) {
            const current = taskDoc.data();
            if (isHuntTaskActivelyRunning(taskId, current)) {
                return res.status(200).json({
                    success: true,
                    taskId,
                    alreadyRunning: true,
                    message: 'Investigación en curso.',
                });
            }
        }

        // Marcar ítem en GENERANDO y sellar `initial_hunt_activated_at` desde su primera activación mediante transacción atómica
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const pillarRef = docRef.collection('pillars').doc(pillarId);
        const nowIso = new Date().toISOString();
        const lockedTitle = await db.runTransaction(async (tx) => {
            const [snap, pillarSnap] = await Promise.all([tx.get(docRef), tx.get(pillarRef)]);
            if (!snap.exists) return null;
            const rawPillar = pillarSnap.exists
                ? pillarSnap.data()
                : snap.data()?.knowledge_vault?.[pillarId];
            if (!rawPillar) return null;
            const items = [...(rawPillar.items || [])];
            const idx = items.findIndex((it: any) => it.item_id === itemId);
            if (idx === -1) return null;
            if (items[idx].is_human_locked === true) {
                return String(items[idx].title || itemId);
            }
            items[idx] = {
                ...items[idx],
                initial_hunt_activated_at: items[idx].initial_hunt_activated_at || nowIso,
                content_status: 'GENERANDO',
                hunt_error: null,
            };
            VaultPersistenceService.writePillarInTransaction(tx, {
                globalAssetId,
                pillarId: pillarId as PillarId,
                pillarDoc: {
                    ...(rawPillar as any),
                    pillar_id: pillarId as PillarId,
                    items,
                    updated_at: nowIso,
                },
            });
            return null;
        });

        if (lockedTitle) {
            return res.status(403).json({
                error: `El ítem "${lockedTitle}" está bloqueado por autoridad humana.`,
            });
        }

        const enqueued = await enqueueItemHuntTask({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            intent,
            tenantId: ctx.tenantId,
            actorId: ctx.actorId,
            humanCorrection: cleanHumanCorrection,
            forceRestart: Boolean(forceRestart),
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_HUNT_ENQUEUED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: {
                taskId: enqueued.taskId,
                pillarId,
                itemId,
                intent: intent || 'INITIAL_CAPTURE',
                dispatchMode: enqueued.dispatchMode,
                forceRestart: Boolean(forceRestart),
            },
        }).catch(() => undefined);

        return res.status(202).json({
            success: true,
            taskId: enqueued.taskId,
            mode: enqueued.dispatchMode,
            message: 'Tarea de caza encolada.',
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error encolando caza asíncrona.');
    }
});

const HuntStatusParamsSchema = z.object({
    taskId: z.string().trim().min(1).max(240),
});

vaultRouter.get('/hunt-status/:taskId', async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsedParams = HuntStatusParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
        return sendZodBadRequest(res, parsedParams.error, 'taskId inválido.');
    }
    const { taskId } = parsedParams.data;
    const docRef = db.collection('task_status').doc(taskId);

    try {
        const initialSnap = await docRef.get();
        if (initialSnap.exists) {
            const task = initialSnap.data() || {};
            if (task.tenantId !== ctx.tenantId && !ctx.capabilities.canCurateAI) {
                return res.status(403).json({
                    error: 'TENANT_ACCESS_DENIED',
                    message: 'No autorizado para suscribirse a una tarea de otro tenant.',
                });
            }
        }
    } catch (err) {
        return handleVaultError(res, err, 'Error verificando permisos de tarea.');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = docRef.onSnapshot(
        (docSnap) => {
            if (docSnap.exists) {
                const data = docSnap.data();
                if (data?.tenantId !== ctx.tenantId && !ctx.capabilities.canCurateAI) {
                    res.write(`data: ${JSON.stringify({ status: 'FORBIDDEN', error: 'TENANT_ACCESS_DENIED' })}\n\n`);
                    unsubscribe();
                    res.end();
                    return;
                }
                res.write(`data: ${JSON.stringify(data)}\n\n`);
                if (data?.status === 'COMPLETED' || data?.status === 'FAILED') {
                    unsubscribe();
                    res.end();
                }
            } else {
                res.write(`data: ${JSON.stringify({ status: 'NOT_FOUND' })}\n\n`);
                unsubscribe();
                res.end();
            }
        },
        (err) => {
            res.write(`data: ${JSON.stringify({ status: 'ERROR', message: err.message })}\n\n`);
            unsubscribe();
            res.end();
        }
    );

    req.on('close', () => unsubscribe());
});

// ── ETAPA 4: ASISTENCIA IA, CHAT CONVERSACIONAL Y CURADURÍA HITL ─────────────

const AiAssistItemBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    pillarId: VaultPillarIdSchema,
    itemId: z.string().trim().min(1).max(160),
    userRequest: z.string().trim().min(1).max(12000),
});

vaultRouter.post('/ai-assist-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const parsed = AiAssistItemBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(
            res,
            parsed.error,
            'Parámetros requeridos: globalAssetId, pillarId, itemId, userRequest.'
        );
    }
    const { globalAssetId, pillarId, itemId, userRequest } = parsed.data;
    const cleanUserRequest = ConfidentialityAirlockService.scrubDeterministicPii(userRequest).scrubbed.trim();

    try {
        const result = await assistItemEdit({
            globalAssetId,
            pillarId,
            itemId,
            userRequest: cleanUserRequest,
        });
        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Error en edición asistida.' });
        }
        return res.status(200).json(result);
    } catch (err) {
        return handleVaultError(res, err, 'Error en asistente de edición IA.');
    }
});

const AiAssistChatBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    pillarId: VaultPillarIdSchema,
    itemId: z.string().trim().min(1).max(160),
    sessionId: z.string().trim().min(1).max(160),
    userRequest: z.string().trim().min(1).max(16000),
    selectedFragment: z.string().max(16000).optional(),
});

vaultRouter.post('/ai-assist-chat', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = AiAssistChatBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(
            res,
            parsed.error,
            'Parámetros requeridos: globalAssetId, pillarId, itemId, sessionId, userRequest.'
        );
    }
    const { globalAssetId, pillarId, itemId, sessionId, userRequest, selectedFragment } = parsed.data;

    // Ley N° 21.719 (A-06): Sanitización determinista PII ANTES de enviar a IA y ANTES de persistir en `vault_chats`
    const sanitizedUserRequest = ConfidentialityAirlockService.scrubDeterministicPii(userRequest).scrubbed.trim();
    const sanitizedSelectedFragment = selectedFragment
        ? ConfidentialityAirlockService.scrubDeterministicPii(selectedFragment).scrubbed
        : undefined;

    try {
        const sessionRef = db
            .collection('global_asset_catalog')
            .doc(globalAssetId)
            .collection('vault_chats')
            .doc(itemId)
            .collection('sessions')
            .doc(sessionId);

        const sessionSnap = await sessionRef.get();
        const history: ChatMessage[] = sessionSnap.exists ? sessionSnap.data()?.messages || [] : [];

        const result = await processVaultChat({
            globalAssetId,
            pillarId,
            itemId,
            userRequest: sanitizedUserRequest,
            history,
            selectedFragment: sanitizedSelectedFragment,
            userEmail: ctx.actorEmail,
        });

        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Error procesando chat técnico.' });
        }

        const userMsg: ChatMessage = {
            id: `msg_user_${Date.now()}`,
            role: 'user',
            content: sanitizedUserRequest,
            timestamp: new Date().toISOString(),
        };

        const modelMsg: ChatMessage = {
            id: `msg_model_${Date.now()}`,
            role: 'model',
            content: result.message,
            timestamp: new Date().toISOString(),
            ...(result.highlightText !== undefined ? { highlightText: result.highlightText } : {}),
            ...(result.draftContent !== undefined
                ? {
                      draftContent: result.draftContent,
                      draftStatus: 'PENDING' as const,
                  }
                : {}),
            ...(result.selectedFragmentTarget !== undefined
                ? { selectedFragmentTarget: result.selectedFragmentTarget }
                : {}),
            ...(result.intent !== undefined ? { intent: result.intent } : {}),
        };

        const nextHistory = [...history, userMsg, modelMsg];
        await sessionRef.set(
            {
                sessionId,
                itemId,
                pillarId,
                createdAt: sessionSnap.exists ? sessionSnap.data()?.createdAt : new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                messages: nextHistory,
            },
            { merge: true }
        );

        return res.status(200).json(result);
    } catch (err) {
        return handleVaultError(res, err, 'Error en chat técnico de bóveda.');
    }
});

const AiAssistSessionCloseBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    itemId: z.string().trim().min(1).max(160),
    sessionId: z.string().trim().min(1).max(160),
});

vaultRouter.post('/ai-assist-session-close', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = AiAssistSessionCloseBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros requeridos: globalAssetId, itemId, sessionId.');
    }
    const { globalAssetId, itemId, sessionId } = parsed.data;

    try {
        await db
            .collection('global_asset_catalog')
            .doc(globalAssetId)
            .collection('vault_chats')
            .doc(itemId)
            .collection('sessions')
            .doc(sessionId)
            .set({ closedAt: new Date().toISOString() }, { merge: true });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_CHAT_SESSION_CLOSED',
            targetEntity: `global_asset_catalog/${globalAssetId}/vault_chats/${itemId}/sessions/${sessionId}`,
            details: { globalAssetId, itemId, sessionId },
        }).catch(() => undefined);

        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error cerrando sesión de chat.');
    }
});

const AiAssistChatHistoryQuerySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    itemId: z.string().trim().min(1).max(160),
    sessionId: z.string().trim().min(1).max(160).optional(),
});

vaultRouter.get('/ai-assist-chat/history', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const parsed = AiAssistChatHistoryQuerySchema.safeParse({
        globalAssetId: req.query?.globalAssetId,
        itemId: req.query?.itemId,
        sessionId: req.query?.sessionId || undefined,
    });
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros requeridos: globalAssetId, itemId.');
    }
    const { globalAssetId, itemId, sessionId } = parsed.data;

    try {
        const sessionsColl = db
            .collection('global_asset_catalog')
            .doc(globalAssetId)
            .collection('vault_chats')
            .doc(itemId)
            .collection('sessions');

        if (sessionId) {
            const snap = await sessionsColl.doc(sessionId).get();
            if (!snap.exists) return res.status(404).json({ error: 'Sesión no encontrada.' });
            return res.status(200).json(snap.data());
        }

        const snap = await sessionsColl.limit(10).get();
        const sessions = snap.docs
            .map((d) => d.data())
            .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .slice(0, 5);
        return res.status(200).json({ sessions });
    } catch (err) {
        return handleVaultError(res, err, 'Error consultando historial de chat.');
    }
});

const AiAssistRejectionBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    pillarId: VaultPillarIdSchema,
    itemId: z.string().trim().min(1).max(160),
    rejectionNote: z.string().trim().min(1).max(8000),
});

vaultRouter.post('/ai-assist-rejection', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const parsed = AiAssistRejectionBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(
            res,
            parsed.error,
            'Parámetros requeridos: globalAssetId, pillarId, itemId, rejectionNote.'
        );
    }
    const { globalAssetId, pillarId, itemId, rejectionNote } = parsed.data;
    const cleanRejectionNote = ConfidentialityAirlockService.scrubDeterministicPii(rejectionNote).scrubbed.trim();

    try {
        const result = await assistRejection({
            globalAssetId,
            pillarId,
            itemId,
            rejectionNote: cleanRejectionNote,
        });
        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Error asistiendo corrección.' });
        }
        return res.status(200).json(result);
    } catch (err) {
        return handleVaultError(res, err, 'Error en asistente de rechazo HITL.');
    }
});

vaultRouter.post('/apply-assist-proposal', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }
    const parsed = VaultApplyAssistProposalBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(
            res,
            parsed.error,
            'Parámetros requeridos: globalAssetId, pillarId, itemId, finalContent, confirmWord.'
        );
    }
    const { globalAssetId, pillarId, itemId, finalContent, intent, sessionId, messageId } = parsed.data;

    try {
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) {
            return res.status(404).json({ error: 'Catálogo no encontrado.' });
        }

        const catalogData = hydrated.data;
        const pillar = catalogData?.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
        }

        const sanitized = await sanitizeAndEnrichItemContentForSave(
            String(finalContent),
            pillarId as PillarId
        );
        const nowIso = new Date().toISOString();
        const oldContent = items[idx].content;

        const nextHistory = await VaultPersistenceService.appendItemRevision({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            existingHistory: items[idx].historial_cambios,
            accion: `EDICIÓN_ASISTIDA_${intent || 'GENERAL'}`,
            actor: ctx.actorEmail,
            detalle: 'Propuesta aplicada mediante corrector técnico.',
            snapshotAnterior: oldContent,
        });

        items[idx] = {
            ...items[idx],
            content: sanitized.content,
            symbology_refs: sanitized.symbologyRefs,
            content_status: 'COMPLETADO',
            hunted_at: nowIso,
            last_edit_by: ctx.actorEmail,
            historial_cambios: nextHistory,
        };

        const propagation = await propagateItemContentMutationEffects({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            updatedItem: items[idx],
            updatedItems: items,
            existingVault: catalogData.knowledge_vault,
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ASSIST_PROPOSAL_APPLIED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId, intent: intent || 'GENERAL' },
        }).catch(() => undefined);

        if (sessionId) {
            const sessionRef = docRef.collection('vault_chats').doc(itemId).collection('sessions').doc(sessionId);
            const sessionSnap = await sessionRef.get();
            if (sessionSnap.exists) {
                const rawHistory: ChatMessage[] = sessionSnap.data()?.messages || [];
                const history = rawHistory.map((m) => {
                    if (m.role === 'model' && m.draftContent && (!messageId || m.id === messageId || m.draftStatus !== 'DISCARDED')) {
                        return {
                            ...m,
                            draftStatus: 'APPLIED' as const,
                            appliedAt: nowIso,
                        };
                    }
                    return m;
                });
                history.push(
                    {
                        id: `msg_user_aprobacion_${Date.now()}`,
                        role: 'user',
                        content: HITL_CONFIRM_KEYWORD,
                        timestamp: nowIso,
                    },
                    {
                        id: `msg_model_aprobacion_${Date.now()}`,
                        role: 'model',
                        content: 'Cambios consolidados en el catálogo, sincronizados en la cadena de pilares y registrados en el historial del ítem.',
                        timestamp: nowIso,
                        intent: 'CHAT',
                    }
                );
                await sessionRef.set({ messages: history, updatedAt: nowIso }, { merge: true });
            }
        }

        return res.status(200).json({
            ok: true,
            success: true,
            content: sanitized.content,
            symbology_refs: sanitized.symbologyRefs,
            content_digest_sha256: propagation.contentDigestSha256,
            vault_merkle_root_sha256: propagation.vaultMerkleRootSha256,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error aplicando propuesta asistida.');
    }
});

const DismissAssistProposalBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    itemId: z.string().trim().min(1).max(160),
    sessionId: z.string().trim().min(1).max(160),
    messageId: z.string().trim().max(160).optional(),
});

vaultRouter.post('/dismiss-assist-proposal', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = DismissAssistProposalBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros requeridos: globalAssetId, itemId, sessionId.');
    }
    const { globalAssetId, itemId, sessionId, messageId } = parsed.data;

    try {
        const sessionRef = db
            .collection('global_asset_catalog')
            .doc(globalAssetId)
            .collection('vault_chats')
            .doc(itemId)
            .collection('sessions')
            .doc(sessionId);

        const sessionSnap = await sessionRef.get();
        if (!sessionSnap.exists) {
            return res.status(200).json({ success: true });
        }

        const nowIso = new Date().toISOString();
        const rawHistory: ChatMessage[] = sessionSnap.data()?.messages || [];
        const updatedHistory = rawHistory.map((m) => {
            if (m.role === 'model' && m.draftContent && (!messageId || m.id === messageId)) {
                return {
                    ...m,
                    draftStatus: 'DISCARDED' as const,
                    discardedAt: nowIso,
                };
            }
            return m;
        });

        await sessionRef.set({ messages: updatedHistory, updatedAt: nowIso }, { merge: true });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ASSIST_PROPOSAL_DISMISSED',
            targetEntity: `global_asset_catalog/${globalAssetId}/vault_chats/${itemId}/sessions/${sessionId}`,
            details: { globalAssetId, itemId, sessionId, messageId: messageId || null },
        }).catch(() => undefined);

        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error descartando propuesta de borrador.');
    }
});

// Resolución in-situ de una imagen técnica pendiente en la sección exacta del capítulo
// (Re-Auditoría v2 · F2: validación CAS en servidor, confirmación "ACTUALIZAR", anclaje determinista y advisory si está bloqueado)
const PENDING_FIGURE_TYPES = [
    'DIAGRAMA_ACOTADO',
    'CURVA_RENDIMIENTO',
    'ESQUEMA_HIDRAULICO_ELECTRICO',
    'FOTO_COMPONENTE',
    'MAPA_LUBRICACION_PM',
    'SIMBOLOGIA_SEGURIDAD',
    'PLANO_VECTORIAL_SVG',
] as const;

const ResolvePendingFigureSchema = z.object({
    globalAssetId: z.string().min(1),
    pillarId: VaultPillarIdSchema,
    itemId: z.string().min(1),
    confirmWord: HitlConfirmWordSchema,
    pendingMarkerLine: z.string().max(1200).optional(),
    pendingDescription: z.string().max(600).optional(),
    figure: z.object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/i),
        storage_url: z
            .string()
            .min(1)
            .refine((u) => !/^(?:blob:|data:|javascript:)/i.test(u.trim()), {
                message: 'URL no CAS rechazada (blob:/data: no se persisten).',
            }),
        figure_type: z.enum(PENDING_FIGURE_TYPES),
        title_es: z.string().min(1).max(400),
        caption_es: z.string().max(400).optional(),
        source_url: z.string().max(2000).optional(),
    }),
});

vaultRouter.post(
    '/resolve-pending-figure',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
            return sendConfirmWordMismatch(res);
        }
        const parsed = ResolvePendingFigureSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return sendZodBadRequest(
                res,
                parsed.error,
                'Parámetros inválidos para resolución de figura pendiente.'
            );
        }

        const { globalAssetId, pillarId, itemId, pendingMarkerLine, pendingDescription, figure } = parsed.data;

        // OPT-F2.1: el binario debe existir en el registro CAS y la URL debe ser exactamente la del registro
        const casDescriptor = await CasStorageService.preflightCheck(figure.sha256, 'GLOBAL_OEM').catch(() => null);
        if (!casDescriptor) {
            return res.status(422).json({ error: 'El SHA-256 informado no existe en el registro CAS (GLOBAL_OEM).' });
        }
        const expectedGateway = CasStorageService.buildGatewayUrl('GLOBAL_OEM', casDescriptor.sha256, casDescriptor.extension);
        const clientUrl = figure.storage_url.trim();
        if (clientUrl !== casDescriptor.downloadUrl && clientUrl !== expectedGateway) {
            return res.status(422).json({ error: 'La URL de la figura no coincide con el registro CAS.' });
        }

        const cleanTitle = sanitizeMarkdownLabel(
            ConfidentialityAirlockService.scrubDeterministicPii(figure.title_es).scrubbed,
            160
        );
        const cleanCaption = figure.caption_es
            ? sanitizeMarkdownLabel(ConfidentialityAirlockService.scrubDeterministicPii(figure.caption_es).scrubbed, 220)
            : '';
        const safeSourceUrl =
            figure.source_url && /^https:\/\//i.test(figure.source_url.trim()) ? figure.source_url.trim() : undefined;
        const mime: ExtractedFigureRef['mime_type'] =
            casDescriptor.mimeType === 'image/svg+xml'
                ? 'image/svg+xml'
                : casDescriptor.mimeType === 'image/png'
                ? 'image/png'
                : 'image/webp';

        const newFigureRef: ExtractedFigureRef = {
            figure_id: `fig_manual_${casDescriptor.sha256.slice(0, 12)}`,
            sha256: casDescriptor.sha256,
            ...(casDescriptor.phashHex ? { phash_hex: casDescriptor.phashHex } : {}),
            storage_url: casDescriptor.downloadUrl,
            mime_type: mime,
            figure_type: figure.figure_type,
            title_es: cleanTitle,
            ...(cleanCaption ? { caption_es: cleanCaption } : {}),
            ...(safeSourceUrl ? { source_url: safeSourceUrl } : {}),
            ...(casDescriptor.width ? { width: casDescriptor.width } : {}),
            ...(casDescriptor.height ? { height: casDescriptor.height } : {}),
            original_bytes: casDescriptor.originalBytes,
            optimized_bytes: casDescriptor.optimizedBytes,
            savings_pct: casDescriptor.savingsPct ?? Number((Number(casDescriptor.savingsRatio || 0) * 100).toFixed(1)),
        };
        const figureBlock = formatFigureMarkdownBlock(newFigureRef);

        try {
            const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
            const pillarRef = docRef.collection('pillars').doc(pillarId);
            const outcome = await db.runTransaction(async (tx) => {
                const [snap, pillarSnap] = await Promise.all([tx.get(docRef), tx.get(pillarRef)]);
                if (!snap.exists) {
                    const err: any = new Error('Catálogo no encontrado.');
                    err.statusCode = 404;
                    throw err;
                }
                const pillar = pillarSnap.exists
                    ? pillarSnap.data()
                    : snap.data()?.knowledge_vault?.[pillarId];
                if (!pillar || !Array.isArray(pillar.items)) {
                    const err: any = new Error('Pilar no encontrado.');
                    err.statusCode = 404;
                    throw err;
                }
                const items = [...pillar.items];
                const idx = items.findIndex((it: any) => it.item_id === itemId);
                if (idx === -1) {
                    const err: any = new Error('Ítem no encontrado.');
                    err.statusCode = 404;
                    throw err;
                }
                const nowIso = new Date().toISOString();

                // OPT-F2.5: ítem aprobado/bloqueado → la figura queda como propuesta (advisory) sin tocar el contenido
                if (items[idx].is_human_locked === true) {
                    const advisories = [...(items[idx].locked_item_advisories || [])];
                    if (!advisories.some((a: any) => a?.figure?.sha256 === newFigureRef.sha256)) {
                        advisories.push({
                            advisory_id: `adv_fig_${Date.now()}`,
                            kind: 'PENDING_FIGURE',
                            detected_at: nowIso,
                            source_label: `Imagen técnica aportada por ${ctx.actorEmail}`,
                            ...(safeSourceUrl ? { source_url: safeSourceUrl } : {}),
                            summary: `Imagen propuesta para sección pendiente: "${cleanTitle}". Requiere desbloqueo del ítem para integrarla.`,
                            proposed_value: figureBlock,
                            figure: newFigureRef,
                            ...(pendingMarkerLine ? { pending_marker_line: pendingMarkerLine.slice(0, 1200) } : {}),
                            acknowledged: false,
                        });
                        items[idx] = { ...items[idx], locked_item_advisories: advisories };
                        VaultPersistenceService.writePillarInTransaction(tx, {
                            globalAssetId,
                            pillarId: pillarId as PillarId,
                            pillarDoc: {
                                ...(pillar as any),
                                pillar_id: pillarId as PillarId,
                                items,
                                updated_at: nowIso,
                            },
                        });
                    }
                    return { mode: 'LOCKED_ADVISORY' as const };
                }

                const currentContent = String(items[idx].content || '');
                const sanitizedCurrent = sanitizeMarkdownFiguresAndBrokenMarkers(
                    currentContent,
                    items[idx].title || '',
                    items[idx].item_sources || [],
                    items[idx].figures || []
                );
                const existingFigCount = (
                    sanitizedCurrent.match(/!\[(?!IMAGEN[_\s-]PENDIENTE)[^\]]*\]\([^)]+\)/gi) || []
                ).length;
                const nextFigNum = existingFigCount + 1;
                const numberedFigureBlock = formatFigureMarkdownBlock(newFigureRef, nextFigNum);

                const replaceMarkerInSections = (markdownInput: string, targetLine: string): string | null => {
                    if (!targetLine || !markdownInput.includes(targetLine)) return null;
                    const sections = splitMarkdownSections(markdownInput);
                    let replaced = false;
                    const outSections = sections.map((sec) => {
                        const lineIdx = sec.lines.findIndex((l) => l.trim() === targetLine.trim() || l.includes(targetLine));
                        if (lineIdx === -1 || replaced) return sec.lines.join('\n');
                        replaced = true;
                        const beforeMarker = sec.lines.slice(0, lineIdx);
                        const afterMarker = sec.lines.slice(lineIdx + 1);
                        const citedBefore = injectExplicitFigureCitationInSection(beforeMarker, nextFigNum, cleanTitle);
                        return [...citedBefore, '', numberedFigureBlock, '', ...afterMarker].join('\n');
                    });
                    return replaced ? outSections.join('\n').replace(/\n{4,}/g, '\n\n\n') : null;
                };

                let nextContent: string | null = null;

                // 1. Marcador persistido exacto (sobre contenido original o sanitizado)
                if (pendingMarkerLine) {
                    nextContent =
                        replaceMarkerInSections(sanitizedCurrent, pendingMarkerLine) ??
                        replaceMarkerInSections(currentContent, pendingMarkerLine);
                }

                // 2. OPT-F2.6: marcadores deterministas o reparados en servidor sobre el texto guardado
                //    y elección del más afín a la descripción enviada por el cliente
                if (nextContent === null) {
                    const normalized = reconcileSectionFiguresAndPendingMarkers(
                        sanitizedCurrent,
                        [],
                        items[idx].item_sources || [],
                        items[idx].title || ''
                    );
                    const markerLines = normalized
                        .split('\n')
                        .filter((l) => parsePendingMarker(l) !== null);
                    const reference = `${pendingDescription || ''} ${pendingMarkerLine || ''}`;
                    let bestLine: string | null = null;
                    let bestScore = 0;
                    for (const ml of markerLines) {
                        const desc = parsePendingMarker(ml)?.description || '';
                        const score = markerLines.length === 1 ? 1 : tokenContainment(desc, reference);
                        if (score > bestScore) {
                            bestScore = score;
                            bestLine = ml;
                        }
                    }
                    if (bestLine && bestScore >= 0.35) {
                        nextContent = replaceMarkerInSections(normalized, bestLine);
                    }
                }

                if (nextContent === null) {
                    const err: any = new Error(
                        'No se localizó la sección de la imagen pendiente en el contenido guardado. Recargue el ítem e intente nuevamente.'
                    );
                    err.statusCode = 409;
                    throw err;
                }

                const { merged: mergedFigures } = mergeDeduplicatedFigures(items[idx].figures || [], [newFigureRef]);
                const referencedFigures = filterFiguresReferencedInMarkdown(nextContent, mergedFigures);

                let revisionId: string | undefined;
                if (currentContent.length > 0) {
                    revisionId = `rev_${Date.now()}_${randomUUID().slice(0, 8)}`;
                    const detalleHist = `Imagen técnica integrada en sección: "${cleanTitle}" (SHA-256 ${newFigureRef.sha256.slice(
                        0,
                        12
                    )}, ${newFigureRef.original_bytes || 0} B ➔ ${newFigureRef.optimized_bytes || 0} B, -${
                        newFigureRef.savings_pct || 0
                    }%).`;
                    tx.set(docRef.collection('item_revisions').doc(revisionId), {
                        revision_id: revisionId,
                        global_asset_id: globalAssetId,
                        pillar_id: pillarId,
                        item_id: itemId,
                        accion: 'RESOLUCION_IMAGEN_PENDIENTE_CAS',
                        actor: ctx.actorEmail,
                        detalle: detalleHist,
                        snapshot_anterior: currentContent,
                        created_at: nowIso,
                    });
                }

                const cleanExistingHistory = (items[idx].historial_cambios || []).map((h: any) => {
                    const { snapshot_anterior: _drop, ...rest } = h || {};
                    return rest;
                });

                items[idx] = {
                    ...items[idx],
                    content: nextContent,
                    figures: referencedFigures,
                    last_edit_by: ctx.actorEmail,
                    historial_cambios: [
                        ...cleanExistingHistory,
                        {
                            fecha: nowIso,
                            accion: 'RESOLUCION_IMAGEN_PENDIENTE_CAS',
                            actor: ctx.actorEmail,
                            detalle: `Imagen técnica integrada en sección: "${cleanTitle}" (SHA-256 ${newFigureRef.sha256.slice(
                                0,
                                12
                            )}, ${newFigureRef.original_bytes || 0} B ➔ ${newFigureRef.optimized_bytes || 0} B, -${
                                newFigureRef.savings_pct || 0
                            }%).`,
                            ...(revisionId ? { revision_id: revisionId } : {}),
                        },
                    ].slice(-20),
                };

                const contentDigest = computePillarContentDigestSha256(items);
                VaultPersistenceService.writePillarInTransaction(tx, {
                    globalAssetId,
                    pillarId: pillarId as PillarId,
                    pillarDoc: {
                        ...(pillar as any),
                        pillar_id: pillarId as PillarId,
                        items,
                        content_digest_sha256: contentDigest,
                        updated_at: nowIso,
                    },
                });
                return { mode: 'INTEGRATED' as const };
            });

            await AuditLedger.record({
                module: 'opermaq',
                tenantId: ctx.tenantId,
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                action:
                    outcome.mode === 'LOCKED_ADVISORY'
                        ? 'VAULT_PENDING_FIGURE_PROPOSED_LOCKED'
                        : 'VAULT_PENDING_FIGURE_RESOLVED_CAS',
                targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}/${itemId}`,
                details: {
                    sha256: newFigureRef.sha256,
                    figure_type: newFigureRef.figure_type,
                    title_es: cleanTitle,
                    original_bytes: newFigureRef.original_bytes,
                    optimized_bytes: newFigureRef.optimized_bytes,
                    savings_pct: newFigureRef.savings_pct,
                },
            }).catch(() => undefined);

            return res.status(200).json({ success: true, mode: outcome.mode, figure: newFigureRef });
        } catch (err) {
            return handleVaultError(res, err, 'Error integrando imagen técnica en la sección del capítulo.');
        }
    }
);

const CorrectManualItemBodySchema = z.object({
    title: z.string().trim().min(1).max(400),
    rationale: z.string().trim().min(1).max(4000),
    globalAssetId: z.string().trim().max(160).optional(),
    pillarId: VaultPillarIdSchema.optional(),
});

vaultRouter.post('/correct-manual-item', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const parsed = CorrectManualItemBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'title y rationale son requeridos.');
    }
    const { title, rationale, globalAssetId, pillarId } = parsed.data;
    const cleanTitle = ConfidentialityAirlockService.scrubDeterministicPii(title).scrubbed.trim();
    const cleanRationale = ConfidentialityAirlockService.scrubDeterministicPii(rationale).scrubbed.trim();

    try {
        let makeModel: string | undefined;
        let tipoEquipo: string | undefined;
        if (globalAssetId) {
            const snap = await db.collection('global_asset_catalog').doc(globalAssetId).get();
            if (snap.exists) {
                const d = snap.data() || {};
                makeModel = d.make_model || `${d.make_oficial || d.make || ''} ${d.model_oficial || d.model || ''}`.trim();
                tipoEquipo = d.tipo_equipo;
            }
        }
        const corrected = await correctManualItemText(cleanTitle, cleanRationale, {
            makeModel,
            tipoEquipo,
            pillarId: pillarId as PillarId | undefined,
        });
        return res.status(200).json({ corrected });
    } catch {
        return res.status(200).json({
            corrected: {
                title: cleanTitle,
                rationale: cleanRationale,
                section: 'ESPECIFICACIÓN TÉCNICA',
            },
        });
    }
});

vaultRouter.post('/create-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }
    const parsed = VaultCreateItemBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(
            res,
            parsed.error,
            'Parámetros requeridos: globalAssetId, pillarId, title, section, confirmWord.'
        );
    }
    const { globalAssetId, pillarId, title, section, rationale, priority, itemSource } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        // Sanitización determinista PII (Ley N° 21.719)
        const cleanTitle = ConfidentialityAirlockService.scrubDeterministicPii(String(title)).scrubbed.trim();
        const cleanSection = ConfidentialityAirlockService.scrubDeterministicPii(String(section)).scrubbed.trim().toUpperCase();
        const cleanRationale = rationale
            ? ConfidentialityAirlockService.scrubDeterministicPii(String(rationale)).scrubbed.trim()
            : 'Registrado manualmente.';

        const items = [...(pillar.items || [])];
        const newId = `manual_${randomUUID().substring(0, 8)}`;

        const newItem = {
            item_id: newId,
            title: cleanTitle,
            section: cleanSection || 'ESPECIFICACIÓN TÉCNICA',
            rationale: cleanRationale,
            priority: priority || 'IMPORTANTE',
            order: items.filter((it: any) => !it.is_discarded).length + 1,
            content_status: 'PENDIENTE',
            content: null,
            is_discarded: false,
            created_at: new Date().toISOString(),
            created_by: ctx.actorEmail,
            historial_cambios: [
                {
                    fecha: new Date().toISOString(),
                    accion: itemSource ? 'CREACION_IA_COMPLEMENTARIA' : 'CREACION_MANUAL',
                    actor: ctx.actorEmail,
                    detalle: `Ítem inscrito: "${cleanTitle}".`,
                },
            ],
            item_sources: [
                itemSource
                    ? {
                          type: String((itemSource as any).type || 'IA'),
                          author: String((itemSource as any).author || ctx.actorEmail),
                          description: String((itemSource as any).description || cleanRationale || cleanTitle),
                          url: String((itemSource as any).url || ''),
                      }
                    : {
                          type: 'MANUAL',
                          author: ctx.actorEmail,
                          description: cleanRationale || cleanTitle,
                          url: '',
                      },
            ],
        };

        const finalItems = sortAndReindexPillarItems(pillarId as PillarId, [...items, newItem]);
        const newStructureDigest = computePillarStructureDigestSha256(finalItems);
        const pillarSources = [...(pillar.classified_sources_itemized || []), newItem.item_sources[0]];
        const updatedPending = (pillar.suggested_items_pending || []).filter(
            (it: any) => String(it.title || '').toLowerCase().trim() !== String(title).toLowerCase().trim()
        );

        const nextPillarDoc = {
            ...pillar,
            pillar_id: pillarId as PillarId,
            items: finalItems,
            structure_digest_sha256: newStructureDigest,
            classified_sources_itemized: pillarSources,
            suggested_items_pending: updatedPending,
            updated_at: new Date().toISOString(),
        };
        const nextVault = {
            ...(hydrated.data.knowledge_vault || {}),
            [pillarId]: nextPillarDoc,
        };
        const newMerkleRoot = computeVaultMerkleRootSha256(nextVault);

        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: nextPillarDoc,
            vaultMerkleRootSha256: newMerkleRoot,
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: itemSource ? 'VAULT_ITEM_CREATED_FROM_SUGGESTION' : 'VAULT_ITEM_CREATED_MANUAL',
            targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}/${newId}`,
            details: {
                pillarId,
                itemId: newId,
                title: cleanTitle,
                section: cleanSection,
                actorEmail: ctx.actorEmail,
            },
        }).catch(() => undefined);

        return res.status(200).json({ ok: true, success: true, item: newItem });
    } catch (err) {
        return handleVaultError(res, err, 'Error creando ítem en pilar.');
    }
});

vaultRouter.post('/discard-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }
    const parsed = VaultMutateItemHitlBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(
            res,
            parsed.error,
            'Parámetros requeridos: globalAssetId, pillarId, itemId, confirmWord.'
        );
    }
    const { globalAssetId, pillarId, itemId } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

        items[idx] = {
            ...items[idx],
            is_discarded: true,
            discarded_at: new Date().toISOString(),
            discarded_by: ctx.actorEmail,
        };

        const finalItems = sortAndReindexPillarItems(pillarId as PillarId, items);
        const newStructureDigest = computePillarStructureDigestSha256(finalItems);
        const nextPillarDoc = {
            ...pillar,
            pillar_id: pillarId as PillarId,
            items: finalItems,
            structure_digest_sha256: newStructureDigest,
            updated_at: new Date().toISOString(),
        };
        const nextVault = {
            ...(hydrated.data.knowledge_vault || {}),
            [pillarId]: nextPillarDoc,
        };
        const newMerkleRoot = computeVaultMerkleRootSha256(nextVault);

        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: nextPillarDoc,
            vaultMerkleRootSha256: newMerkleRoot,
        });

        if (pillarId === 'ficha_tecnica' || pillarId === 'pauta_mantencion') {
            await buildAndPersistEquipmentCostMatrix(globalAssetId).catch(() => null);
        }

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_DISCARDED',
            targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}/${itemId}`,
            details: {
                pillarId,
                itemId,
                title: items[idx].title,
                actorEmail: ctx.actorEmail,
            },
        }).catch(() => undefined);

        return res.status(200).json({ ok: true, success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error descartando ítem.');
    }
});

const DiscardSuggestedItemBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    pillarId: VaultPillarIdSchema,
    title: z.string().trim().min(1).max(400),
    section: z.string().trim().min(1).max(240),
    rationale: z.string().max(4000).optional(),
    source: z.record(z.string(), z.unknown()).optional(),
});

vaultRouter.post('/discard-suggested-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = DiscardSuggestedItemBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros requeridos: globalAssetId, pillarId, title, section.');
    }
    const { globalAssetId, pillarId, title, section, rationale, source } = parsed.data;
    const cleanTitle = ConfidentialityAirlockService.scrubDeterministicPii(title).scrubbed.trim();
    const cleanSection = ConfidentialityAirlockService.scrubDeterministicPii(section).scrubbed.trim();
    const cleanRationale = rationale
        ? ConfidentialityAirlockService.scrubDeterministicPii(rationale).scrubbed.trim()
        : 'Sugerencia descartada.';

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const updatedPending = (pillar.suggested_items_pending || []).filter(
            (it: any) => String(it.title || '').toLowerCase().trim() !== String(title).toLowerCase().trim()
        );

        const newItem = {
            item_id: `manual_${randomUUID().substring(0, 8)}`,
            title: cleanTitle,
            section: cleanSection,
            rationale: cleanRationale,
            priority: 'IMPORTANTE',
            order: 999,
            content_status: 'PENDIENTE',
            content: null,
            is_discarded: true,
            created_at: new Date().toISOString(),
            created_by: ctx.actorEmail,
            discarded_at: new Date().toISOString(),
            discarded_by: ctx.actorEmail,
            historial_cambios: [
                {
                    fecha: new Date().toISOString(),
                    accion: 'DESCARTE_SUGERENCIA_IA',
                    actor: ctx.actorEmail,
                    detalle: `Sugerencia descartada: "${cleanTitle}".`,
                },
            ],
            item_sources: source
                ? [
                      {
                          type: String((source as any).type || 'IA'),
                          author: String((source as any).author || ''),
                          description: String((source as any).description || ''),
                          url: String((source as any).url || ''),
                      },
                  ]
                : [],
        };

        const finalItems = reindexPillarItems([...(pillar.items || []), newItem]);
        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: {
                ...pillar,
                pillar_id: pillarId as PillarId,
                items: finalItems,
                suggested_items_pending: updatedPending,
                updated_at: new Date().toISOString(),
            },
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_SUGGESTION_DISCARDED',
            targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}/${newItem.item_id}`,
            details: {
                pillarId,
                title: cleanTitle,
                actorEmail: ctx.actorEmail,
            },
        }).catch(() => undefined);

        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error descartando sugerencia.');
    }
});

vaultRouter.post('/reactivate-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }
    const parsed = VaultMutateItemHitlBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(
            res,
            parsed.error,
            'Parámetros requeridos: globalAssetId, pillarId, itemId, confirmWord.'
        );
    }
    const { globalAssetId, pillarId, itemId } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

        items[idx] = {
            ...items[idx],
            is_discarded: false,
            reactivated_at: new Date().toISOString(),
        };

        const finalItems = sortAndReindexPillarItems(pillarId as PillarId, items);
        const newStructureDigest = computePillarStructureDigestSha256(finalItems);
        const nextPillarDoc = {
            ...pillar,
            pillar_id: pillarId as PillarId,
            items: finalItems,
            structure_digest_sha256: newStructureDigest,
            updated_at: new Date().toISOString(),
        };
        const nextVault = {
            ...(hydrated.data.knowledge_vault || {}),
            [pillarId]: nextPillarDoc,
        };
        const newMerkleRoot = computeVaultMerkleRootSha256(nextVault);

        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: nextPillarDoc,
            vaultMerkleRootSha256: newMerkleRoot,
        });

        if (pillarId === 'ficha_tecnica' || pillarId === 'pauta_mantencion') {
            await buildAndPersistEquipmentCostMatrix(globalAssetId).catch(() => null);
        }

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_REACTIVATED',
            targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}/${itemId}`,
            details: {
                pillarId,
                itemId,
                title: items[idx].title,
                actorEmail: ctx.actorEmail,
            },
        }).catch(() => undefined);

        return res.status(200).json({ ok: true, success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error reactivando ítem.');
    }
});

const AttachImageBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    activeTab: z.string().trim().min(1).max(120),
    targetIndex: z.coerce.number().int().min(0).max(5000),
    imageUrl: z.string().trim().max(2048).optional(),
});

vaultRouter.post(
    '/attach-image',
    requireCurateAI,
    checkVaultNotSealed,
    upload.single('image'),
    async (req: ScopedRequest, res: Response) => {
        const file = req.file;
        const parsed = AttachImageBodySchema.safeParse(req.body || {});
        if (!parsed.success || (!file && !parsed.data.imageUrl)) {
            return res.status(400).json({
                error: 'Parámetros requeridos: archivo image (o imageUrl HTTPS segura), globalAssetId, activeTab, targetIndex.',
                ...(parsed.success ? {} : { details: parsed.error.issues }),
            });
        }
        const { globalAssetId, activeTab, targetIndex, imageUrl } = parsed.data;

        try {
            const ctx = req.opermaqContext!;
            let imgBuffer: Buffer;
            let imgMime: string;
            let originalFilename: string;

            if (file) {
                imgBuffer = file.buffer;
                imgMime = file.mimetype || 'image/jpeg';
                originalFilename = file.originalname || 'adjunto_tecnico.webp';
            } else {
                const remoteUrlStr = String(imageUrl).trim();
                const remoteRes = await safeFetchExternal(remoteUrlStr, {
                    method: 'GET',
                    maxBytes: 15 * 1024 * 1024,
                    headers: { Accept: 'image/*;q=0.9,*/*;q=0.1' },
                });
                if (!remoteRes.ok) {
                    return res.status(400).json({
                        error: `No se pudo descargar la imagen remota (HTTP ${remoteRes.status}).`,
                    });
                }
                const cType = (remoteRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
                if (!cType.startsWith('image/')) {
                    return res.status(400).json({
                        error: 'La URL externa no corresponde a un recurso de imagen válido.',
                    });
                }
                imgBuffer = Buffer.from(await remoteRes.arrayBuffer());
                imgMime = cType;
                originalFilename = 'remote_technical_attachment.webp';
            }

            const { descriptor } = await CasStorageService.digestAndStore(
                imgBuffer,
                imgMime,
                'IMAGE_TECHNICAL_HD',
                {
                    scope: 'GLOBAL_OEM',
                    actorUid: ctx.actorId,
                    originalFilename,
                }
            );

            const resolvedSavingsPct =
                descriptor.savingsPct ?? Number((descriptor.savingsRatio * 100).toFixed(1));

            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: 'VAULT_TECHNICAL_IMAGE_ATTACHED',
                targetEntity: `global_asset_catalog/${globalAssetId}`,
                details: {
                    globalAssetId,
                    activeTab,
                    targetIndex,
                    sha256: descriptor.sha256,
                    originalBytes: descriptor.originalBytes,
                    optimizedBytes: descriptor.optimizedBytes,
                    savingsPct: resolvedSavingsPct,
                    deduplicatedHit: descriptor.deduplicatedHit,
                },
            }).catch(() => undefined);

            return res.status(200).json({
                success: true,
                imageUrl: descriptor.downloadUrl,
                sha256: descriptor.sha256,
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsRatio: descriptor.savingsRatio,
                savingsPct: resolvedSavingsPct,
                deduplicatedHit: descriptor.deduplicatedHit,
            });
        } catch (err) {
            return handleVaultError(res, err, 'Error adjuntando imagen técnica.');
        }
    }
);

vaultRouter.post(
    '/update-item-approval-state',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;

        const schema = z.object({
            globalAssetId: z.string().trim().min(1).max(160),
            pillarId: VaultPillarIdSchema,
            itemId: z.string().trim().min(1).max(160),
            nuevo_estado: z.enum(['REQUIERE_CAMBIOS', 'APROBADO_HUMANO', 'GENERADO_IA']),
            review_notes: z.string().max(8000).optional(),
        });

        const parsed = schema.safeParse(req.body || {});
        if (!parsed.success) {
            return sendZodBadRequest(res, parsed.error, 'Parámetros inválidos.');
        }

        const { globalAssetId, pillarId, itemId, nuevo_estado, review_notes } = parsed.data;

        try {
            const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
                globalAssetId,
                (req as any).catalogDocSnap
            );
            if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

            const pillar = hydrated.data.knowledge_vault?.[pillarId];
            if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

            const items = [...(pillar.items || [])];
            const idx = items.findIndex((it: any) => it.item_id === itemId);
            if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

            const item = { ...items[idx] };
            item.estado_aprobacion = nuevo_estado;
            item.historial_cambios = item.historial_cambios || [];

            if (nuevo_estado === 'REQUIERE_CAMBIOS') {
                const cleanNotes = review_notes
                    ? ConfidentialityAirlockService.scrubDeterministicPii(review_notes).scrubbed.trim()
                    : '';
                if (!cleanNotes) {
                    return res.status(400).json({ error: 'review_notes es requerido para REQUIERE_CAMBIOS.' });
                }
                item.review_notes = cleanNotes;
                delete item.approved_by;
                delete item.approved_at;
                item.is_human_locked = false;
                item.historial_cambios.push({
                    fecha: new Date().toISOString(),
                    accion: 'SOLICITUD_CORRECCION',
                    actor: ctx.actorEmail,
                    detalle: cleanNotes,
                });
            } else if (nuevo_estado === 'APROBADO_HUMANO') {
                delete item.review_notes;
                item.approved_by = ctx.actorEmail;
                item.approved_at = new Date().toISOString();
                item.is_human_locked = true;
                item.historial_cambios.push({
                    fecha: item.approved_at,
                    accion: 'APROBACION_FINAL',
                    actor: ctx.actorEmail,
                    detalle: 'Ítem validado por experto y bloqueado contra sobrescritura IA.',
                });
            } else {
                delete item.review_notes;
                item.is_human_locked = false;
            }

            items[idx] = item;
            await propagateItemContentMutationEffects({
                globalAssetId,
                pillarId: pillarId as PillarId,
                itemId,
                updatedItem: item,
                updatedItems: items,
                existingVault: hydrated.data.knowledge_vault,
            });

            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: `VAULT_ITEM_APPROVAL_${nuevo_estado}`,
                targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
                details: { pillarId, itemId, nuevo_estado },
            }).catch(() => undefined);

            return res.status(200).json({ success: true, estado: nuevo_estado });
        } catch (err) {
            return handleVaultError(res, err, 'Error actualizando estado de aprobación HITL.');
        }
    }
);

vaultRouter.post('/bulk-approve', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }

    const parsed = VaultBulkApproveBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Formato inválido.');
    }

    const { items } = parsed.data;
    const now = new Date().toISOString();

    try {
        const catalogMap = new Map<string, Record<string, any>>();
        const mutatedPillarsByAsset = new Map<string, Set<PillarId>>();

        for (const it of items) {
            if (!catalogMap.has(it.globalAssetId)) {
                const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(it.globalAssetId);
                if (hydrated.exists && hydrated.data) {
                    catalogMap.set(it.globalAssetId, hydrated.data);
                }
            }
        }

        let approved = 0;
        for (const it of items) {
            const catalogData = catalogMap.get(it.globalAssetId);
            const pillarDoc = catalogData?.knowledge_vault?.[it.pillarId];
            if (!pillarDoc || !Array.isArray(pillarDoc.items) || !VALID_PILLAR_IDS.includes(it.pillarId as PillarId)) {
                continue;
            }

            const idx = pillarDoc.items.findIndex((pi: any) => pi.item_id === it.itemId);
            if (idx === -1) continue;

            pillarDoc.items[idx] = {
                ...pillarDoc.items[idx],
                estado_aprobacion: 'APROBADO_HUMANO',
                approved_by: ctx.actorEmail,
                approved_at: now,
                is_human_locked: true,
                historial_cambios: [
                    ...(pillarDoc.items[idx].historial_cambios || []),
                    {
                        fecha: now,
                        accion: 'APROBACION_BATCH',
                        actor: ctx.actorEmail,
                        detalle: 'Aprobación HITL por lote.',
                    },
                ],
            };
            pillarDoc.updated_at = now;
            if (!mutatedPillarsByAsset.has(it.globalAssetId)) {
                mutatedPillarsByAsset.set(it.globalAssetId, new Set());
            }
            mutatedPillarsByAsset.get(it.globalAssetId)!.add(it.pillarId as PillarId);
            approved++;
        }

        for (const [assetId, pidSet] of mutatedPillarsByAsset.entries()) {
            const catalogData = catalogMap.get(assetId);
            if (!catalogData) continue;
            const pillarsToSave: Partial<Record<PillarId, any>> = {};
            for (const pid of pidSet) {
                const pDoc = catalogData.knowledge_vault?.[pid];
                if (pDoc) {
                    pDoc.content_digest_sha256 = computePillarContentDigestSha256(pDoc.items || []);
                    pillarsToSave[pid] = pDoc;
                }
            }
            const merkleRoot = computeVaultMerkleRootSha256(catalogData.knowledge_vault);
            await VaultPersistenceService.saveMultiplePillars({
                globalAssetId: assetId,
                pillars: pillarsToSave,
                vaultMerkleRootSha256: merkleRoot,
            });
            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: 'VAULT_ITEMS_BULK_APPROVED',
                targetEntity: `global_asset_catalog/${assetId}`,
                details: { pillars: Array.from(pidSet), approved },
            }).catch(() => undefined);
        }

        return res.status(200).json({ ok: true, success: true, approved });
    } catch (err) {
        return handleVaultError(res, err, 'Error en aprobación HITL por lote.');
    }
});

vaultRouter.post('/update-item-content', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }

    const parsed = VaultUpdateItemContentBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros inválidos.');
    }

    const { globalAssetId, pillarId, itemId, newContent } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar || !Array.isArray(pillar.items)) {
            return res.status(404).json({ error: 'Pilar no encontrado.' });
        }

        const items = [...pillar.items];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
        }

        const sanitized = await sanitizeAndEnrichItemContentForSave(
            String(newContent),
            pillarId as PillarId
        );
        const oldContent = items[idx].content;
        const nextHistory = await VaultPersistenceService.appendItemRevision({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            existingHistory: items[idx].historial_cambios,
            accion: 'EDICION_HITL',
            actor: ctx.actorEmail,
            detalle: 'Edición quirúrgica manual.',
            snapshotAnterior: oldContent,
        });

        items[idx] = {
            ...items[idx],
            content: sanitized.content,
            symbology_refs: sanitized.symbologyRefs,
            content_status: 'COMPLETADO',
            last_edit_by: ctx.actorEmail,
            historial_cambios: nextHistory,
        };

        await propagateItemContentMutationEffects({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            updatedItem: items[idx],
            updatedItems: items,
            existingVault: hydrated.data.knowledge_vault,
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_CONTENT_HITL_UPDATED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId },
        }).catch(() => undefined);

        return res.status(200).json({ ok: true, success: true, content: sanitized.content });
    } catch (err) {
        return handleVaultError(res, err, 'Error guardando contenido del ítem.');
    }
});

vaultRouter.post('/resolve-item-conflict', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }
    const parsed = VaultResolveConflictBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros requeridos incompletos.');
    }
    const { globalAssetId, pillarId, itemId, action, proposal } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
        }

        const item = { ...items[idx] };
        const finalPending = (item.pending_conflicts || []).filter(
            (p: any) => p.proposal_id !== proposal.proposal_id
        );

        if (action === 'ACCEPT') {
            const filteredBuffer = (item.authorized_delta_buffer || []).filter(
                (it: any) =>
                    !(it.componente === proposal.componente && it.zona === proposal.zona) &&
                    it.proposal_id !== proposal.proposal_id
            );
            item.authorized_delta_buffer = [
                ...filteredBuffer,
                {
                    ...proposal,
                    authorized_at: new Date().toISOString(),
                    authorized_by: ctx.actorEmail,
                    status: 'AUTHORIZED',
                },
            ];
            item.historial_cambios = [
                ...(item.historial_cambios || []),
                {
                    fecha: new Date().toISOString(),
                    accion: 'PROPUESTA_ACEPTADA',
                    actor: ctx.actorEmail,
                    detalle: `Propuesta autorizada para ${proposal.componente || 'componente'}.`,
                },
            ];
        }

        item.pending_conflicts = finalPending;
        items[idx] = item;
        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: {
                ...pillar,
                pillar_id: pillarId as PillarId,
                items,
                updated_at: new Date().toISOString(),
            },
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: `VAULT_ITEM_CONFLICT_${action}`,
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId, proposalId: proposal?.proposal_id || null, action },
        }).catch(() => undefined);

        return res.status(200).json({
            ok: true,
            success: true,
            pendingCount: finalPending.length,
            authorizedCount: action === 'ACCEPT' ? 1 : 0,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error resolviendo conflicto de ítem.');
    }
});

vaultRouter.post(
    '/resolve-item-conflicts-bulk',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const schema = z.object({
            globalAssetId: z.string().trim().min(1).max(160),
            pillarId: VaultPillarIdSchema,
            itemId: z.string().trim().min(1).max(160),
            action: z.enum(['ACCEPT', 'REJECT']),
            proposals: z
                .array(
                    z
                        .object({
                            proposal_id: z.string().optional(),
                            componente: z.string().optional(),
                            zona: z.string().optional(),
                        })
                        .passthrough()
                )
                .max(200),
            confirmWord: HitlConfirmWordSchema,
        });

        if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
            return sendConfirmWordMismatch(res);
        }
        const parsed = schema.safeParse(req.body || {});
        if (!parsed.success) {
            return sendZodBadRequest(res, parsed.error, 'Parámetros inválidos.');
        }

        const { globalAssetId, pillarId, itemId, action, proposals } = parsed.data;

        try {
            const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
                globalAssetId,
                (req as any).catalogDocSnap
            );
            if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

            const pillar = hydrated.data.knowledge_vault?.[pillarId];
            if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

            const items = [...(pillar.items || [])];
            const idx = items.findIndex((it: any) => it.item_id === itemId);
            if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
            if (items[idx].is_human_locked === true) {
                return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
            }

            const item = { ...items[idx] };
            const ids = new Set(proposals.map((p: any) => p.proposal_id));
            const finalPending = (item.pending_conflicts || []).filter((p: any) => !ids.has(p.proposal_id));

            if (action === 'ACCEPT') {
                let buffer = [...(item.authorized_delta_buffer || [])];
                item.historial_cambios = item.historial_cambios || [];
                for (const proposal of proposals) {
                    buffer = buffer.filter(
                        (it: any) =>
                            !(it.componente === proposal.componente && it.zona === proposal.zona) &&
                            it.proposal_id !== proposal.proposal_id
                    );
                    buffer.push({
                        ...proposal,
                        authorized_at: new Date().toISOString(),
                        authorized_by: ctx.actorEmail,
                        status: 'AUTHORIZED',
                    });
                    item.historial_cambios.push({
                        fecha: new Date().toISOString(),
                        accion: 'PROPUESTA_ACEPTADA',
                        actor: ctx.actorEmail,
                        detalle: `Propuesta autorizada para ${proposal.componente || 'componente'}.`,
                    });
                }
                item.authorized_delta_buffer = buffer;
            }

            item.pending_conflicts = finalPending;
            items[idx] = item;
            await VaultPersistenceService.savePillarDocument({
                globalAssetId,
                pillarId: pillarId as PillarId,
                pillarDoc: {
                    ...pillar,
                    pillar_id: pillarId as PillarId,
                    items,
                    updated_at: new Date().toISOString(),
                },
            });

            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: `VAULT_ITEM_CONFLICTS_BULK_${action}`,
                targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
                details: { pillarId, itemId, count: proposals.length, action },
            }).catch(() => undefined);

            return res.status(200).json({
                ok: true,
                success: true,
                pendingCount: finalPending.length,
                authorizedCount: action === 'ACCEPT' ? proposals.length : 0,
            });
        } catch (err) {
            return handleVaultError(res, err, 'Error resolviendo conflictos en lote.');
        }
    }
);

function buildFallbackProposalKey(p: any, idx?: number): string {
    const estado = String(p?.estado_fusion || 'NUEVO').trim();
    const comp = String(p?.componente || '').trim();
    const val = String(p?.valor_nuevo || '').trim().slice(0, 80);
    return idx !== undefined
        ? `fallback_${estado}::${comp}::${val}::${idx}`
        : `fallback_${estado}::${comp}::${val}`;
}

function matchPendingProposalIndex(pendingList: any[], proposalId: string): number {
    const exactIdx = pendingList.findIndex((p: any) => p.proposal_id === proposalId);
    if (exactIdx !== -1) return exactIdx;

    const withIdxMatch = pendingList.findIndex(
        (p: any, i: number) => buildFallbackProposalKey(p, i) === proposalId
    );
    if (withIdxMatch !== -1) return withIdxMatch;

    const withoutIdxMatch = pendingList.findIndex(
        (p: any) => buildFallbackProposalKey(p) === proposalId
    );
    return withoutIdxMatch;
}

const VaultGlobalAssetIdParamSchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
});

vaultRouter.post('/decide-proposal', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().trim().min(1).max(160),
        pillarId: VaultPillarIdSchema,
        itemId: z.string().trim().min(1).max(160),
        proposalId: z.string().trim().min(1).max(240),
        decision: z.enum(['APROBADO', 'ELIMINADO']),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros inválidos.');
    }

    const { globalAssetId, pillarId, itemId, proposalId, decision } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const data = hydrated.data;
        const pillar = data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
        }

        const item = { ...items[idx] };
        const currentPending = [...(item.pending_conflicts || [])];
        const pIdx = matchPendingProposalIndex(currentPending, proposalId);
        if (pIdx === -1) return res.status(404).json({ error: 'Propuesta no encontrada.' });

        const proposal = {
            ...currentPending[pIdx],
            proposal_id: currentPending[pIdx].proposal_id || proposalId,
            human_decision: decision,
            decided_at: new Date().toISOString(),
            decided_by: ctx.actorEmail,
        };
        currentPending[pIdx] = proposal;

        const targetFusionType: 'NUEVO' | 'CONFLICTO' =
            proposal.estado_fusion === 'CONFLICTO' ? 'CONFLICTO' : 'NUEVO';

        if (decision === 'ELIMINADO') {
            const rejectedFp =
                proposal.fact_fingerprint ||
                computeFactFingerprint(proposal.valor_nuevo || '', item.title || proposal.componente || '');
            const prevRejected: string[] = Array.isArray(item.rejected_fact_fingerprints)
                ? item.rejected_fact_fingerprints
                : [];
            if (rejectedFp && !prevRejected.includes(rejectedFp)) {
                item.rejected_fact_fingerprints = [...prevRejected.slice(-199), rejectedFp];
            }

            const remainingPending = currentPending.filter(
                (p: any, i: number) => i !== pIdx && p.human_decision !== 'ELIMINADO'
            );
            item.pending_conflicts = remainingPending;
            item.historial_cambios = [
                ...(item.historial_cambios || []),
                {
                    fecha: new Date().toISOString(),
                    accion: 'PROPUESTA_ELIMINADA',
                    actor: ctx.actorEmail,
                    detalle: `Decisión ELIMINADO para ${proposal.componente}.`,
                },
            ];
            item.last_edit_by = ctx.actorEmail;
            items[idx] = item;

            await propagateItemContentMutationEffects({
                globalAssetId,
                pillarId: pillarId as PillarId,
                itemId,
                updatedItem: item,
                updatedItems: items,
                existingVault: data.knowledge_vault,
            });

            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: 'VAULT_PROPOSAL_DECIDED',
                targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
                details: {
                    pillarId,
                    itemId,
                    proposalId,
                    decision,
                    targetFusionType,
                    autoConsolidated: false,
                },
            }).catch(() => undefined);

            const remainingCount = remainingPending.filter(
                (p: any) => p.estado_fusion === targetFusionType && p.human_decision !== 'ELIMINADO' && p.human_decision !== 'APROBADO'
            ).length;

            return res.status(200).json({
                success: true,
                decision,
                proposalId,
                remainingCount,
                autoConsolidated: false,
            });
        }

        // decision === 'APROBADO': Consolidación inmediata en item.content + remoción física de pending_conflicts
        const deltas = currentPending.filter(
            (p: any) => p.estado_fusion === targetFusionType && p.human_decision === 'APROBADO'
        );

        const make = String(data.make_oficial || data.make || '').trim();
        const model = String(data.model_oficial || data.model || '').trim();
        const makeModel = `${make} ${model}`.trim() || globalAssetId;
        const currentContent = item.content || '';

        const evolvedContent = await evolveItemContent({
            makeModel,
            itemTitle: item.title,
            currentContent,
            deltas,
            pillarId: pillarId as PillarId,
        });

        item.historial_cambios = await VaultPersistenceService.appendItemRevision({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            existingHistory: item.historial_cambios,
            accion: targetFusionType === 'NUEVO' ? 'EVOLUCION_NUEVO_CONTENIDO' : 'EVOLUCION_CONFLICTOS',
            actor: ctx.actorEmail,
            detalle: `Aprobación e integración inmediata de ${deltas.length} hallazgo(s) ${targetFusionType} (${proposal.componente}).`,
            snapshotAnterior: currentContent,
        });

        const remainingPending = currentPending.filter(
            (p: any) =>
                p.human_decision !== 'ELIMINADO' &&
                !(p.estado_fusion === targetFusionType && p.human_decision === 'APROBADO')
        );

        item.item_sources = item.item_sources || [];
        const existingFingerprints = new Set<string>(item.fact_fingerprints || []);
        let incomingFigures: ExtractedFigureRef[] = [];

        for (const d of deltas) {
            if (d.source_url && d.source_url.trim() && d.source_url.trim() !== '#') {
                const urlStr = d.source_url.trim();
                if (!item.item_sources.some((s: any) => s.url === urlStr)) {
                    item.item_sources.push({
                        type: d.is_oem ? 'OEM' : 'EXTERNO',
                        author: make || 'Fabricante',
                        description: `${d.componente} (${d.zona})`,
                        url: urlStr,
                    });
                }
            }
            if (d.valor_nuevo) {
                existingFingerprints.add(computeFactFingerprint(d.valor_nuevo, d.componente || ''));
            }
            if (Array.isArray(d.figures) && d.figures.length > 0) {
                incomingFigures = incomingFigures.concat(d.figures);
            }
        }

        if (incomingFigures.length > 0) {
            const { merged } = mergeDeduplicatedFigures(item.figures || [], incomingFigures);
            item.figures = merged;
        }
        item.fact_fingerprints = Array.from(existingFingerprints);

        const sanitized = await sanitizeAndEnrichItemContentForSave(
            evolvedContent,
            pillarId as PillarId
        );
        item.content = sanitized.content;
        item.symbology_refs = sanitized.symbologyRefs;
        item.pending_conflicts = remainingPending;
        item.authorized_delta_buffer = [];
        item.estado_aprobacion = 'GENERADO_IA';
        item.last_edit_by = ctx.actorEmail;
        items[idx] = item;

        await propagateItemContentMutationEffects({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            updatedItem: item,
            updatedItems: items,
            existingVault: data.knowledge_vault,
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_PROPOSAL_DECIDED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: {
                pillarId,
                itemId,
                proposalId,
                decision,
                targetFusionType,
                deltasConsolidated: deltas.length,
                autoConsolidated: true,
            },
        }).catch(() => undefined);

        const remainingCount = remainingPending.filter(
            (p: any) => p.estado_fusion === targetFusionType && p.human_decision !== 'ELIMINADO' && p.human_decision !== 'APROBADO'
        ).length;

        return res.status(200).json({
            success: true,
            decision,
            proposalId,
            remainingCount,
            evolvedContent: sanitized.content,
            autoConsolidated: true,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error registrando decisión sobre propuesta.');
    }
});

vaultRouter.post('/evolve-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().trim().min(1).max(160),
        pillarId: VaultPillarIdSchema,
        itemId: z.string().trim().min(1).max(160),
        filterType: z.enum(['NUEVO', 'CONFLICTO']),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros inválidos.');
    }

    const { globalAssetId, pillarId, itemId, filterType } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const data = hydrated.data;
        const pillar = data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
        }

        const item = { ...items[idx] };
        const currentContent = item.content || '';
        const currentPending = item.pending_conflicts || [];
        const deltas = currentPending.filter(
            (p: any) => p.estado_fusion === filterType && p.human_decision === 'APROBADO'
        );

        if (deltas.length === 0) {
            return res.status(400).json({
                error: `Sin propuestas ${filterType} aprobadas para consolidar.`,
            });
        }

        const make = String(data.make_oficial || data.make || '').trim();
        const model = String(data.model_oficial || data.model || '').trim();
        const makeModel = `${make} ${model}`.trim() || globalAssetId;

        const evolvedContent = await evolveItemContent({
            makeModel,
            itemTitle: item.title,
            currentContent,
            deltas,
            pillarId: pillarId as PillarId,
        });

        item.historial_cambios = await VaultPersistenceService.appendItemRevision({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            existingHistory: item.historial_cambios,
            accion: filterType === 'NUEVO' ? 'EVOLUCION_NUEVO_CONTENIDO' : 'EVOLUCION_CONFLICTOS',
            actor: ctx.actorEmail,
            detalle: `Fusión evolutiva de ${deltas.length} hallazgo(s) ${filterType}.`,
            snapshotAnterior: currentContent,
        });

        const remainingPending = currentPending.filter(
            (p: any) =>
                p.human_decision !== 'ELIMINADO' &&
                !(
                    p.estado_fusion === filterType &&
                    (p.human_decision === 'APROBADO' || p.human_decision === 'ELIMINADO')
                )
        );

        item.item_sources = item.item_sources || [];
        const existingFingerprints = new Set<string>(item.fact_fingerprints || []);
        let incomingFigures: ExtractedFigureRef[] = [];

        for (const d of deltas) {
            if (d.source_url && d.source_url.trim() && d.source_url.trim() !== '#') {
                const urlStr = d.source_url.trim();
                if (!item.item_sources.some((s: any) => s.url === urlStr)) {
                    item.item_sources.push({
                        type: d.is_oem ? 'OEM' : 'EXTERNO',
                        author: make || 'Fabricante',
                        description: `${d.componente} (${d.zona})`,
                        url: urlStr,
                    });
                }
            }
            if (d.valor_nuevo) {
                existingFingerprints.add(computeFactFingerprint(d.valor_nuevo, d.componente || ''));
            }
            if (Array.isArray(d.figures) && d.figures.length > 0) {
                incomingFigures = incomingFigures.concat(d.figures);
            }
        }

        if (incomingFigures.length > 0) {
            const { merged } = mergeDeduplicatedFigures(item.figures || [], incomingFigures);
            item.figures = merged;
        }
        item.fact_fingerprints = Array.from(existingFingerprints);

        const sanitized = await sanitizeAndEnrichItemContentForSave(
            evolvedContent,
            pillarId as PillarId
        );
        item.content = sanitized.content;
        item.symbology_refs = sanitized.symbologyRefs;
        item.pending_conflicts = remainingPending;
        item.authorized_delta_buffer = [];
        item.estado_aprobacion = 'GENERADO_IA';
        item.last_edit_by = ctx.actorEmail;
        items[idx] = item;

        await propagateItemContentMutationEffects({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            updatedItem: item,
            updatedItems: items,
            existingVault: data.knowledge_vault,
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_EVOLVED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: {
                pillarId,
                itemId,
                filterType,
                deltasConsolidated: deltas.length,
            },
        }).catch(() => undefined);

        return res.status(200).json({ success: true, evolvedContent: sanitized.content });
    } catch (err) {
        return handleVaultError(res, err, 'Error evolucionando contenido del ítem.');
    }
});

vaultRouter.post('/cancel-evolution', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().trim().min(1).max(160),
        pillarId: VaultPillarIdSchema,
        itemId: z.string().trim().min(1).max(160),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros requeridos: globalAssetId, pillarId, itemId.');
    }
    const { globalAssetId, pillarId, itemId } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });
        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

        const count = (items[idx].authorized_delta_buffer || []).length;
        items[idx] = {
            ...items[idx],
            authorized_delta_buffer: [],
            historial_cambios: [
                ...(items[idx].historial_cambios || []),
                {
                    fecha: new Date().toISOString(),
                    accion: 'EVOLUCION_CANCELADA',
                    actor: ctx.actorEmail,
                    detalle: `Descartados ${count} cambios en búfer.`,
                },
            ],
        };

        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: {
                ...pillar,
                pillar_id: pillarId as PillarId,
                items,
                updated_at: new Date().toISOString(),
            },
        });
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_EVOLUTION_CANCELLED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId, discardedBufferCount: count },
        }).catch(() => undefined);
        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error cancelando evolución.');
    }
});

vaultRouter.post('/unlock-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;

    if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }

    const parsed = VaultMutateItemHitlBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros requeridos: globalAssetId, pillarId, itemId, confirmWord.');
    }
    const { globalAssetId, pillarId, itemId } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });
        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

        items[idx] = {
            ...items[idx],
            is_human_locked: false,
            estado_aprobacion: 'GENERADO_IA',
            historial_cambios: [
                ...(items[idx].historial_cambios || []),
                {
                    fecha: new Date().toISOString(),
                    accion: 'DESBLOQUEO_MANUAL',
                    actor: ctx.actorEmail,
                    detalle: 'Ítem desbloqueado manualmente.',
                },
            ],
        };

        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: {
                ...pillar,
                pillar_id: pillarId as PillarId,
                items,
                updated_at: new Date().toISOString(),
            },
        });
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_UNLOCKED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId },
        }).catch(() => undefined);
        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error desbloqueando ítem.');
    }
});

vaultRouter.post('/rollback-item-version', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;

    if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }

    const parsed = VaultRollbackVersionBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(
            res,
            parsed.error,
            'Parámetros requeridos: globalAssetId, pillarId, itemId, timestamp, confirmWord.'
        );
    }
    const { globalAssetId, pillarId, itemId, timestamp } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const items = [...(hydrated.data.knowledge_vault?.[pillarId]?.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Desbloquee el ítem antes de restaurar versión previa.' });
        }

        const targetEntry = (items[idx].historial_cambios || []).find(
            (h: any) => h.fecha === timestamp && (h.snapshot_anterior !== undefined || Boolean(h.revision_id))
        );
        if (!targetEntry) {
            return res.status(404).json({ error: 'Versión histórica no encontrada.' });
        }

        const resolvedSnapshot = await VaultPersistenceService.resolveRevisionSnapshot({
            globalAssetId,
            historyEntry: targetEntry,
        });
        if (resolvedSnapshot === null) {
            return res.status(404).json({ error: 'El snapshot histórico solicitado no está disponible.' });
        }

        const sanitized = await sanitizeAndEnrichItemContentForSave(
            String(resolvedSnapshot),
            pillarId as PillarId
        );
        const previous = items[idx].content || '';
        const nextHistory = await VaultPersistenceService.appendItemRevision({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            existingHistory: items[idx].historial_cambios,
            accion: 'REVERSION_HISTORICA',
            actor: ctx.actorEmail,
            detalle: `Restauración de versión ${timestamp}.`,
            snapshotAnterior: previous,
        });

        items[idx] = {
            ...items[idx],
            content: sanitized.content,
            symbology_refs: sanitized.symbologyRefs,
            estado_aprobacion: 'GENERADO_IA',
            last_edit_by: ctx.actorEmail,
            historial_cambios: nextHistory,
        };

        await propagateItemContentMutationEffects({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            updatedItem: items[idx],
            updatedItems: items,
            existingVault: hydrated.data.knowledge_vault,
        });
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_VERSION_ROLLED_BACK',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId, restoredTimestamp: timestamp },
        }).catch(() => undefined);
        return res.status(200).json({ success: true, restoredContent: sanitized.content });
    } catch (err) {
        return handleVaultError(res, err, 'Error restaurando versión previa.');
    }
});

// ── SELLADO Y LECTURA DEL CATÁLOGO CON SIMBOLOGÍA RESUELTA ───────────────────

vaultRouter.post('/seal/:globalAssetId', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const paramsParsed = VaultGlobalAssetIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return sendZodBadRequest(res, paramsParsed.error, 'globalAssetId inválido.');
    }
    const bodyParsed = z.object({ confirmWord: HitlConfirmWordSchema }).safeParse(req.body || {});
    if (!bodyParsed.success) {
        return sendConfirmWordMismatch(res);
    }

    const { globalAssetId } = paramsParsed.data;
    try {
        await db.collection('global_asset_catalog').doc(globalAssetId).set(
            {
                isSealed: true,
                is_sealed: true,
                knowledge_vault: { is_sealed: true },
                sealedAt: FieldValue.serverTimestamp(),
                sealedBy: ctx.actorEmail,
                updatedAt: Date.now(),
            },
            { merge: true }
        );
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_CATALOG_SEALED',
            targetEntity: `global_asset_catalog/${globalAssetId}`,
            details: { globalAssetId },
        }).catch(() => undefined);
        return res.status(200).json({ success: true, isSealed: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error sellando bóveda.');
    }
});

vaultRouter.post('/unseal/:globalAssetId', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const paramsParsed = VaultGlobalAssetIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return sendZodBadRequest(res, paramsParsed.error, 'globalAssetId inválido.');
    }
    const bodyParsed = z.object({ confirmWord: HitlConfirmWordSchema }).safeParse(req.body || {});
    if (!bodyParsed.success) {
        return sendConfirmWordMismatch(res);
    }

    const { globalAssetId } = paramsParsed.data;
    try {
        await db.collection('global_asset_catalog').doc(globalAssetId).set(
            {
                isSealed: false,
                is_sealed: false,
                knowledge_vault: { is_sealed: false },
                unsealedAt: FieldValue.serverTimestamp(),
                unsealedBy: ctx.actorEmail,
                updatedAt: Date.now(),
            },
            { merge: true }
        );
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_CATALOG_UNSEALED',
            targetEntity: `global_asset_catalog/${globalAssetId}`,
            details: { globalAssetId },
        }).catch(() => undefined);
        return res.status(200).json({ success: true, isSealed: false });
    } catch (err) {
        return handleVaultError(res, err, 'Error desbloqueando bóveda.');
    }
});

vaultRouter.get('/asset/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const paramsParsed = VaultGlobalAssetIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return sendZodBadRequest(res, paramsParsed.error, 'globalAssetId inválido.');
    }
    const { globalAssetId } = paramsParsed.data;
    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
        if (!hydrated.exists || !hydrated.data) {
            return res.status(404).json({ exists: false, error: 'Activo no encontrado en el catálogo.' });
        }

        const rawData = hydrated.data;
        const vault = rawData.knowledge_vault || null;
        const storedMatrix = rawData.operational_cost_matrix;
        const currentMerkle = vault?.vault_merkle_root_sha256 || null;

        const effectiveCostMatrix =
            storedMatrix &&
            storedMatrix.version === '3.0.0' &&
            (!currentMerkle || storedMatrix.source_merkle_root_sha256 === currentMerkle)
                ? storedMatrix
                : compileEquipmentCostMatrixFromPillars({
                      assetData: rawData,
                      fichaDoc: vault?.ficha_tecnica || null,
                      mantencionDoc: vault?.pauta_mantencion || null,
                  });

        const resolved = await resolveAssetSymbology({
            id: hydrated.id,
            ...rawData,
            operational_cost_matrix: effectiveCostMatrix,
            energy_consumption_profile: effectiveCostMatrix.energy_consumption,
        });

        const projected = VaultPersistenceService.projectAssetForAudience(resolved, req.opermaqContext);
        return res.status(200).json({ exists: true, ...projected });
    } catch (err) {
        return handleVaultError(res, err, 'Error leyendo activo de catálogo.');
    }
});

// ── BÓVEDA GLOBAL DE SIMBOLOGÍA ISO 7000 / IEC 60417 ─────────────────────────

const SymbologySearchSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
    isoReference: z.string().trim().min(1).max(160),
});

const SymbologyRegisterStandardSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
    confirmWord: z.string().trim().min(1).max(32),
});

const SymbologyDrawStandardSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
    candidateIndex: z.coerce.number().int().min(0).max(20).optional().default(0),
});

const SymbologyBrandVariantSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
    brand: z.string().trim().min(1).max(120),
});

const SymbologyRegisterVariantSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
    brand: z.string().trim().min(1).max(120),
    confirmWord: z.string().trim().min(1).max(32),
});

const SymbologyUploadStandardSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
    confirmWord: HitlConfirmWordSchema,
});

const SymbologySeedUniversalSchema = z.object({
    forceFullIso7010: z.coerce.boolean().optional().default(false),
});

const SymbologyPackRebuildSchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
});

const emptyStringToUndefined = (val: unknown) =>
    typeof val === 'string' && val.trim() === '' ? undefined : val;

const VaultIngestDocumentBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    visibilityScope: z.preprocess(
        emptyStringToUndefined,
        z.enum(['COMMONS_OEM', 'TENANT_ONLY']).optional().default('COMMONS_OEM')
    ),
    documentCategory: z.preprocess(
        emptyStringToUndefined,
        z
            .enum(['OEM_MANUAL', 'CATALOG_BROCHURE', 'ETT_SPEC_SHEET', 'TECHNICAL_CHART_PHOTO'])
            .optional()
    ),
    maxWindowsPerRun: z.preprocess(
        emptyStringToUndefined,
        z.coerce.number().int().min(1).max(30).optional()
    ),
    clientOriginalBytes: z.preprocess(
        emptyStringToUndefined,
        z.coerce.number().int().positive().optional()
    ),
});

vaultRouter.get('/symbology/concepts', async (_req: ScopedRequest, res: Response) => {
    try {
        const symbols = await getMasterSymbols();
        return res.status(200).json(symbols);
    } catch (err) {
        return handleVaultError(res, err, 'Error listando conceptos de simbología.');
    }
});

vaultRouter.get('/symbology/pending', async (_req: ScopedRequest, res: Response) => {
    try {
        const pending = await getPendingSymbols();
        return res.status(200).json(pending);
    } catch (err) {
        return handleVaultError(res, err, 'Error listando símbolos pendientes.');
    }
});

vaultRouter.post('/symbology/search-iso-icon', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = SymbologySearchSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'conceptId e isoReference son requeridos.');
    }

    try {
        const url = await searchIsoIconFromWikimedia(parsed.data.conceptId, parsed.data.isoReference);
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'SYMBOLOGY_ISO_ICON_SEARCHED',
            targetEntity: `master_symbology_vault/${parsed.data.conceptId}`,
            details: {
                conceptId: parsed.data.conceptId,
                isoReference: parsed.data.isoReference,
                found: Boolean(url),
            },
        }).catch(() => undefined);
        return res.status(200).json({ success: true, url, temp_standard_icon_url: url });
    } catch (err) {
        return handleVaultError(res, err, 'Error buscando pictograma ISO en Wikimedia Commons.');
    }
});

vaultRouter.post('/symbology/register-standard', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }
    const parsed = SymbologyRegisterStandardSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'conceptId y confirmWord son requeridos.');
    }
    if (!isValidHitlSymbologyWord(parsed.data.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }

    try {
        const updated = await registerStandardIcon(parsed.data.conceptId, ctx.actorEmail, parsed.data.confirmWord);
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'SYMBOLOGY_STANDARD_REGISTERED',
            targetEntity: `master_symbology_vault/${parsed.data.conceptId}`,
            details: { conceptId: parsed.data.conceptId },
        }).catch(() => undefined);
        return res.status(200).json(updated);
    } catch (err) {
        return handleVaultError(res, err, 'Error consolidando pictograma estándar.');
    }
});

vaultRouter.post('/symbology/draw-standard', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = SymbologyDrawStandardSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'conceptId válido es requerido.');
    }

    try {
        const url = await drawStandardIcon(parsed.data.conceptId, parsed.data.candidateIndex, ctx.actorEmail);
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'SYMBOLOGY_STANDARD_VECTORIZED',
            targetEntity: `master_symbology_vault/${parsed.data.conceptId}`,
            details: {
                conceptId: parsed.data.conceptId,
                candidateIndex: parsed.data.candidateIndex,
            },
        }).catch(() => undefined);
        return res.status(200).json({ success: true, temp_standard_icon_url: url });
    } catch (err) {
        return handleVaultError(res, err, 'Error vectorizando pictograma estándar.');
    }
});

vaultRouter.post('/symbology/generate-variant', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = SymbologyBrandVariantSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'conceptId y brand son requeridos.');
    }

    try {
        const result = await generateBrandVariant(parsed.data.conceptId, parsed.data.brand, ctx.actorEmail);
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'SYMBOLOGY_OEM_VARIANT_GENERATED',
            targetEntity: `master_symbology_vault/${parsed.data.conceptId}`,
            details: {
                conceptId: parsed.data.conceptId,
                brand: parsed.data.brand,
            },
        }).catch(() => undefined);
        return res.status(200).json(result);
    } catch (err) {
        return handleVaultError(res, err, 'Error generando variante OEM.');
    }
});

vaultRouter.post('/symbology/register-variant', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }
    const parsed = SymbologyRegisterVariantSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'conceptId, brand y confirmWord son requeridos.');
    }
    if (!isValidHitlSymbologyWord(parsed.data.confirmWord)) {
        return sendConfirmWordMismatch(res);
    }

    try {
        const updated = await registerBrandVariant(
            parsed.data.conceptId,
            parsed.data.brand,
            ctx.actorEmail,
            parsed.data.confirmWord
        );
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'SYMBOLOGY_OEM_VARIANT_REGISTERED',
            targetEntity: `master_symbology_vault/${parsed.data.conceptId}`,
            details: {
                conceptId: parsed.data.conceptId,
                brand: parsed.data.brand,
            },
        }).catch(() => undefined);
        return res.status(200).json(updated);
    } catch (err) {
        return handleVaultError(res, err, 'Error consolidando variante OEM.');
    }
});

vaultRouter.post(
    '/symbology/upload-manual',
    requireCurateAI,
    upload.single('file'),
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const rawConfirmWord = req.body?.confirmWord ?? req.query?.confirmWord;
        if (!isValidHitlConfirmWord(rawConfirmWord)) {
            return sendConfirmWordMismatch(res);
        }
        const parsed = SymbologyRegisterVariantSchema.safeParse({
            ...(req.body || {}),
            confirmWord: String(rawConfirmWord),
        });
        if (!parsed.success || !req.file) {
            return res.status(400).json({
                error: 'conceptId, brand, confirmWord y archivo son requeridos.',
                details: parsed.success ? undefined : parsed.error.issues,
            });
        }
        if (!isValidHitlSymbologyWord(parsed.data.confirmWord)) {
            return sendConfirmWordMismatch(res);
        }

        try {
            const updated = await uploadManualVariant(
                parsed.data.conceptId,
                parsed.data.brand,
                req.file.buffer,
                ctx.actorEmail,
                parsed.data.confirmWord
            );
            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: 'SYMBOLOGY_OEM_VARIANT_UPLOADED',
                targetEntity: `master_symbology_vault/${parsed.data.conceptId}`,
                details: {
                    conceptId: parsed.data.conceptId,
                    brand: parsed.data.brand,
                    originalBytes: req.file.size,
                },
            }).catch(() => undefined);
            return res.status(200).json(updated);
        } catch (err) {
            return handleVaultError(res, err, 'Error subiendo variante manual.');
        }
    }
);

vaultRouter.post(
    '/symbology/upload-standard',
    requireCurateAI,
    upload.single('file'),
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const rawConfirmWord = req.body?.confirmWord ?? req.query?.confirmWord;
        if (!isValidHitlConfirmWord(rawConfirmWord)) {
            return sendConfirmWordMismatch(res);
        }
        const parsed = SymbologyUploadStandardSchema.safeParse({
            ...(req.body || {}),
            confirmWord: String(rawConfirmWord),
        });
        if (!parsed.success || !req.file) {
            return res.status(400).json({
                error: 'conceptId, confirmWord y archivo son requeridos.',
                details: parsed.success ? undefined : parsed.error.issues,
            });
        }

        try {
            const updated = await uploadStandardIcon(
                parsed.data.conceptId,
                req.file.buffer,
                ctx.actorEmail,
                parsed.data.confirmWord
            );
            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: 'SYMBOLOGY_STANDARD_UPLOADED',
                targetEntity: `master_symbology_vault/${parsed.data.conceptId}`,
                details: {
                    conceptId: parsed.data.conceptId,
                    originalBytes: req.file.size,
                },
            }).catch(() => undefined);
            return res.status(200).json(updated);
        } catch (err) {
            return handleVaultError(res, err, 'Error subiendo icono estándar.');
        }
    }
);

// ── v4.0: INGESTA SEGMENTADA DE PDFs EXTENSOS, CATÁLOGOS, ETT Y LÁMINAS OEM (EXCLUSIVO CURADORES MINREPORT) ──

vaultRouter.post(
    '/ingest-document',
    requireCurateAI,
    uploadDocument.single('file'),
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const file = req.file;
        const parsed = VaultIngestDocumentBodySchema.safeParse(req.body || {});
        if (!file || !parsed.success) {
            return res.status(400).json({
                error: 'Parámetros requeridos: archivo (file) y globalAssetId válido.',
                details: parsed.success ? undefined : parsed.error.issues,
            });
        }

        const {
            globalAssetId,
            visibilityScope,
            documentCategory,
            maxWindowsPerRun,
            clientOriginalBytes,
        } = parsed.data;

        try {
            const result = await withDocumentIngestSemaphore(() =>
                SegmentedDocumentProcessorService.ingestDocument({
                    globalAssetId,
                    fileBuffer: file.buffer,
                    mimeType: file.mimetype || 'application/octet-stream',
                    originalFilename: file.originalname || 'documento_oem.pdf',
                    clientOriginalBytes,
                    documentCategory,
                    visibilityScope,
                    tenantId: ctx.tenantId,
                    actorUid: ctx.actorId,
                    actorEmail: ctx.actorEmail,
                    isPrivilegedCurator: ctx.capabilities.canCurateAI,
                    maxWindowsPerRun,
                })
            );

            await AuditLedger.record({
                tenantId: ctx.tenantId,
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                action: 'OPERMAQ_MULTIMODAL_DOCUMENT_INGESTED',
                module: 'opermaq',
                targetEntity: globalAssetId,
                details: {
                    jobId: result.jobId,
                    fileSha256: result.fileSha256,
                    originalFilename: file.originalname,
                    originalBytes: result.originalBytes,
                    optimizedBytes: result.optimizedBytes,
                    savingsRatio: result.savingsRatio,
                    deduplicatedDocumentHit: result.deduplicatedDocumentHit,
                    totalPages: result.totalPages,
                    skippedUnchangedPages: result.skippedUnchangedPages,
                    extractedChaptersCount: result.extractedChaptersCount,
                    extractedFiguresCount: result.extractedFiguresCount,
                    vectorizedSymbolsCount: result.vectorizedSymbolsCount,
                },
            });

            return res.status(200).json({ success: true, ...result });
        } catch (err) {
            return handleVaultError(res, err, 'Error procesando documento técnico OEM.');
        }
    }
);

vaultRouter.get('/corpus/:globalAssetId', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const paramsParsed = VaultGlobalAssetIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return sendZodBadRequest(res, paramsParsed.error, 'globalAssetId requerido.');
    }
    const { globalAssetId } = paramsParsed.data;

    try {
        const assetRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const [filesSnap, jobsSnap] = await Promise.all([
            assetRef.collection('vault_files').limit(40).get(),
            assetRef.collection('ingestion_jobs').limit(25).get(),
        ]);

        const files = filesSnap.docs
            .map((d) => d.data())
            .sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        const jobs = jobsSnap.docs
            .map((d) => d.data())
            .sort((a: any, b: any) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));

        return res.status(200).json({ files, jobs });
    } catch (err) {
        return handleVaultError(res, err, 'Error consultando corpus técnico del activo.');
    }
});

// ── PROYECCIÓN SEGURA DE LOS 5 PILARES PUBLICADOS (`APROBADO_HUMANO`) Y CUARENTENA DOCUMENTAL CLIENTES ──

/**
 * GET /api/vault/published/:globalAssetId
 * Proyecta únicamente la información técnica autorizada para publicación por un humano de MINREPORT
 * (`estado_aprobacion === 'APROBADO_HUMANO'`), ocultando borradores crudos de IA y metadatos internos.
 */
vaultRouter.get('/published/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const paramsParsed = VaultGlobalAssetIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return sendZodBadRequest(res, paramsParsed.error, 'globalAssetId requerido.');
    }
    const { globalAssetId } = paramsParsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
        if (!hydrated.exists || !hydrated.data) {
            return res.status(404).json({ error: 'Ficha de catálogo no encontrada.' });
        }

        const data = hydrated.data;
        const rawVault = data.knowledge_vault || {};
        const publishedPillars: Record<
            PillarId,
            {
                pillar_id: PillarId;
                published_count: number;
                items: Array<{
                    item_id: string;
                    order: number;
                    title: string;
                    section: string;
                    priority: string;
                    content: string;
                    figures: any[];
                    symbology_refs: string[];
                    approved_at: string | null;
                }>;
            }
        > = {} as any;

        for (const pid of VALID_PILLAR_IDS) {
            const pDoc = rawVault?.[pid];
            const rawItems: any[] = Array.isArray(pDoc?.items) ? pDoc.items : [];
            const approvedItems = rawItems
                .filter(
                    (it) =>
                        !it?.is_discarded &&
                        it?.content_status === 'COMPLETADO' &&
                        it?.estado_aprobacion === 'APROBADO_HUMANO' &&
                        Boolean(String(it?.content || '').trim())
                )
                .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
                .map((it, idx) => ({
                    item_id: String(it.item_id || `${pid}_${idx + 1}`),
                    order: idx + 1,
                    title: String(it.title || 'Capítulo Técnico'),
                    section: String(it.section || 'INGENIERÍA PUBLICADA'),
                    priority: String(it.priority || 'IMPORTANTE'),
                    content: String(it.content || ''),
                    figures: Array.isArray(it.figures) ? it.figures : [],
                    symbology_refs: Array.isArray(it.symbology_refs) ? it.symbology_refs : [],
                    approved_at: it.approved_at ? String(it.approved_at) : null,
                }));

            publishedPillars[pid] = {
                pillar_id: pid,
                published_count: approvedItems.length,
                items: approvedItems,
            };
        }

        return res.status(200).json({
            id: hydrated.id,
            make_oficial: String(data.make_oficial || data.make || ''),
            model_oficial: String(data.model_oficial || data.model || ''),
            make_model: String(
                data.make_model || `${data.make_oficial || data.make || ''} ${data.model_oficial || data.model || ''}`
            ).trim(),
            tipo_equipo: String(data.tipo_equipo || '[Información técnica no declarada en ficha]'),
            categoria_equipo: String(data.categoria_equipo || ''),
            ambiente_operativo: Array.isArray(data.ambiente_operativo) ? data.ambiente_operativo : [],
            contexto_operativo: Array.isArray(data.contexto_operativo) ? data.contexto_operativo : [],
            caracteristicas_principales: Array.isArray(data.caracteristicas_principales)
                ? data.caracteristicas_principales
                : [],
            foto_url: data.foto_url || null,
            official_url: data.official_url || '',
            is_sealed: Boolean(data.is_sealed || data.isSealed || rawVault?.is_sealed),
            published_pillars: publishedPillars,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error consultando proyección publicada de los 5 pilares.');
    }
});

const VaultClientContributePdfBodySchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    tenantAssetId: z.preprocess(emptyStringToUndefined, z.string().trim().max(160).optional()),
    clientOriginalBytes: z.preprocess(
        emptyStringToUndefined,
        z.coerce.number().int().positive().optional()
    ),
});

const VaultContributionsQuerySchema = z.object({
    globalAssetId: z.preprocess(emptyStringToUndefined, z.string().trim().max(160).optional()),
    status: z.preprocess(emptyStringToUndefined, z.string().trim().max(64).optional()),
});

const VaultContributionIdParamSchema = z.object({
    contributionId: z.string().trim().min(1).max(160),
});

const VaultPilotCandidateIdParamSchema = z.object({
    candidateId: z.string().trim().min(1).max(160),
});

const BenchmarkMetricKindSchema = z.enum([
    'FUEL_CONSUMPTION_LH',
    'HYDRAULIC_FILTER_LIFE_H',
    'TIRE_OR_TRACK_LIFE_H',
    'PM_AVAILABILITY_PCT',
    'MATERIAL_BULK_DENSITY_TM3',
]);

/**
 * POST /api/vault/client-contribute-pdf
 * Subida segura de PDF desde Control de Flota (Clientes B2B / EDU):
 * Evalúa el contenido por IA + deduplicación de triple capa y lo envía a cuarentena humana
 * (`knowledge_contributions` -> `PENDING_HUMAN_REVIEW`) sin publicar automáticamente.
 */
vaultRouter.post(
    '/client-contribute-pdf',
    uploadDocument.single('file'),
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        if (ctx.isEduSandbox) {
            return res.status(403).json({
                error: 'EDU_SANDBOX_ISOLATED',
                message: 'El entorno académico EDU opera en sandbox aislado y no envía aportes al repositorio productivo.',
            });
        }
        if (!ctx.capabilities.canManageFleet && !ctx.capabilities.canCurateAI) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: 'Permisos insuficientes para enviar documentación técnica desde flota.',
            });
        }

        const file = req.file;
        const parsed = VaultClientContributePdfBodySchema.safeParse(req.body || {});
        if (!file || !parsed.success) {
            return res.status(400).json({
                error: 'Adjunte un archivo PDF válido e indique el equipo destino (`globalAssetId`).',
                details: parsed.success ? undefined : parsed.error.issues,
            });
        }

        const { globalAssetId, tenantAssetId, clientOriginalBytes } = parsed.data;

        try {
            const result = await withDocumentIngestSemaphore(() =>
                SegmentedDocumentProcessorService.ingestClientPdfToQuarantine({
                    globalAssetId,
                    tenantAssetId,
                    fileBuffer: file.buffer,
                    mimeType: file.mimetype || 'application/pdf',
                    originalFilename: file.originalname || 'aporte_tecnico.pdf',
                    clientOriginalBytes,
                    tenantId: ctx.tenantId,
                    actorUid: ctx.actorId,
                    actorEmail: ctx.actorEmail,
                })
            );

            await AuditLedger.record({
                tenantId: ctx.tenantId,
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                action: 'OPERMAQ_CLIENT_PDF_QUARANTINED',
                module: 'opermaq',
                targetEntity: globalAssetId,
                details: {
                    contributionId: result.contributionId,
                    quarantineStatus: result.quarantineStatus,
                    fileSha256: result.fileSha256,
                    totalPages: result.totalPages,
                    skippedUnchangedPages: result.skippedUnchangedPages,
                    skippedSemanticDuplicates: result.skippedSemanticDuplicates,
                    netNewItemsCount: result.netNewItemsCount,
                },
            }).catch(() => {});

            return res.status(200).json({ success: true, ...result });
        } catch (err) {
            return handleVaultError(res, err, 'Error evaluando PDF para revisión humana MINREPORT.');
        }
    }
);

/**
 * GET /api/vault/my-contributions/:globalAssetId
 * Retorna exclusivamente el estado de los PDFs enviados por el propio tenant activo sobre ese modelo.
 */
vaultRouter.get('/my-contributions/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const paramsParsed = VaultGlobalAssetIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return sendZodBadRequest(res, paramsParsed.error, 'globalAssetId inválido.');
    }
    const { globalAssetId } = paramsParsed.data;
    if (!ctx.tenantId) {
        return res.status(200).json({ items: [] });
    }

    try {
        const snap = await db
            .collection('knowledge_contributions')
            .where('tenantId', '==', ctx.tenantId)
            .limit(40)
            .get();

        const items = snap.docs
            .map((d): Record<string, any> => ({ id: d.id, ...(d.data() || {}) }))
            .filter((d) => d.global_asset_id === globalAssetId)
            .map((d) => ({
                id: d.id,
                sanitized_filename: d.sanitized_filename || 'Documento PDF',
                status: d.status || 'PENDING_HUMAN_REVIEW',
                dedup_metrics: d.dedup_metrics || {},
                created_at: d.created_at || '',
                reviewed_at: d.reviewed_at || null,
            }))
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

        return res.status(200).json({ items });
    } catch (err) {
        return handleVaultError(res, err, 'Error consultando estado de aportes documentales.');
    }
});

/**
 * GET /api/vault/contributions
 * Bandeja exclusiva de humanos acreditados en MINREPORT (`DEV` / `SUPER_ADMIN` / `TEST-PILOT`)
 * para revisar aportes PDF en cuarentena sin exponer razones sociales entre clientes.
 */
vaultRouter.get('/contributions', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const queryParsed = VaultContributionsQuerySchema.safeParse(req.query || {});
    if (!queryParsed.success) {
        return sendZodBadRequest(res, queryParsed.error, 'Filtros de consulta inválidos.');
    }
    const filterAssetId = queryParsed.data.globalAssetId || '';
    const filterStatus = queryParsed.data.status || '';

    try {
        let q: FirebaseFirestore.Query = db.collection('knowledge_contributions');
        if (filterAssetId) {
            q = q.where('global_asset_id', '==', filterAssetId);
        }
        const snap = await q.limit(100).get();

        const items = snap.docs
            .map((d) => {
                const raw = d.data();
                return {
                    id: d.id,
                    global_asset_id: raw.global_asset_id || '',
                    make_model: raw.make_model || '',
                    sanitized_filename: raw.sanitized_filename || 'Aporte PDF',
                    file_sha256: raw.file_sha256 || '',
                    status: raw.status || 'PENDING_HUMAN_REVIEW',
                    estado_aprobacion: raw.estado_aprobacion || 'BORRADOR_IA',
                    proposed_items: Array.isArray(raw.proposed_items) ? raw.proposed_items : [],
                    dedup_metrics: raw.dedup_metrics || {},
                    review_notes: raw.review_notes || '',
                    reviewed_by_email: raw.reviewed_by_email || null,
                    reviewed_at: raw.reviewed_at || null,
                    created_at: raw.created_at || '',
                };
            })
            .filter((item) => (!filterStatus ? true : item.status === filterStatus))
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

        return res.status(200).json({ items });
    } catch (err) {
        return handleVaultError(res, err, 'Error listando bandeja de cuarentena documental HITL.');
    }
});

/**
 * POST /api/vault/contributions/:contributionId/review
 * Autorización humana granular 1 a 1 (`[Actual] ➔ [Sugerido]`) + palabra obligatoria `"ACTUALIZAR"`.
 */
vaultRouter.post(
    '/contributions/:contributionId/review',
    requireCurateAI,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const paramsParsed = VaultContributionIdParamSchema.safeParse(req.params);
        if (!paramsParsed.success) {
            return sendZodBadRequest(res, paramsParsed.error, 'contributionId inválido.');
        }
        if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
            return sendConfirmWordMismatch(res);
        }
        const parsed = ReviewContributionBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return sendZodBadRequest(res, parsed.error, 'Parámetros de revisión HITL inválidos.');
        }
        const { contributionId } = paramsParsed.data;

        try {
            const outcome = await SegmentedDocumentProcessorService.consolidateHumanReviewedContribution({
                contributionId,
                acceptedProposalIds: parsed.data.acceptedProposalIds,
                rejectedProposalIds: parsed.data.rejectedProposalIds,
                publishApprovedItems: parsed.data.publishApprovedItems,
                reviewNotes: parsed.data.reviewNotes
                    ? ConfidentialityAirlockService.scrubDeterministicPii(parsed.data.reviewNotes).scrubbed
                    : undefined,
                reviewerUid: ctx.actorId,
                reviewerEmail: ctx.actorEmail,
            });

            await AuditLedger.record({
                tenantId: ctx.tenantId,
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                action: 'OPERMAQ_CONTRIBUTION_HITL_REVIEWED',
                module: 'opermaq',
                targetEntity: outcome.globalAssetId,
                details: {
                    contributionId,
                    status: outcome.status,
                    consolidatedCount: outcome.consolidatedCount,
                    rejectedCount: outcome.rejectedCount,
                    publishedImmediately: parsed.data.publishApprovedItems,
                },
            }).catch(() => {});

            return res.status(200).json({ success: true, ...outcome });
        } catch (err) {
            return handleVaultError(res, err, 'Error consolidando revisión humana de aporte documental.');
        }
    }
);

vaultRouter.post('/acknowledge-locked-advisory', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;

    const schema = z.object({
        globalAssetId: z.string().trim().min(1).max(160),
        pillarId: VaultPillarIdSchema,
        itemId: z.string().trim().min(1).max(160),
        advisoryId: z.string().trim().min(1).max(200),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros inválidos.');
    }

    const { globalAssetId, pillarId, itemId, advisoryId } = parsed.data;
    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });
        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

        const advisories = [...(items[idx].locked_item_advisories || [])].map((adv: any) =>
            adv.advisory_id === advisoryId
                ? {
                      ...adv,
                      acknowledged: true,
                      acknowledged_by: ctx.actorEmail,
                      acknowledged_at: new Date().toISOString(),
                  }
                : adv
        );

        items[idx] = { ...items[idx], locked_item_advisories: advisories };
        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: {
                ...pillar,
                pillar_id: pillarId as PillarId,
                items,
                updated_at: new Date().toISOString(),
            },
        });
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_LOCKED_ADVISORY_ACKNOWLEDGED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId, advisoryId },
        }).catch(() => undefined);
        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error confirmando aviso sobre ítem bloqueado.');
    }
});

// ── v3.0: PAQUETE AD-HOC DE SIMBOLOGÍA VECTORIAL + MANUALES AD-HOC + FEEDBACK TEST-PILOT ──

vaultRouter.get('/symbology-pack/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const paramsParsed = VaultGlobalAssetIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return sendZodBadRequest(res, paramsParsed.error, 'globalAssetId inválido.');
    }
    const { globalAssetId } = paramsParsed.data;
    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Activo no encontrado.' });

        const data = hydrated.data;
        const pack =
            data.symbology_pack && data.symbology_pack.total_symbols > 0
                ? data.symbology_pack
                : await buildAndPersistAssetSymbologyPack(globalAssetId, data);

        return res.status(200).json(pack);
    } catch (err) {
        return handleVaultError(res, err, 'Error obteniendo paquete ad-hoc de simbología.');
    }
});

vaultRouter.post('/symbology-pack/rebuild', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = SymbologyPackRebuildSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'globalAssetId requerido.');
    }

    try {
        const pack = await buildAndPersistAssetSymbologyPack(parsed.data.globalAssetId);
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'SYMBOLOGY_PACK_REBUILT',
            targetEntity: `global_asset_catalog/${parsed.data.globalAssetId}`,
            details: {
                globalAssetId: parsed.data.globalAssetId,
                totalSymbols: pack?.total_symbols ?? 0,
            },
        }).catch(() => undefined);
        return res.status(200).json({ success: true, pack });
    } catch (err) {
        return handleVaultError(res, err, 'Error reconstruyendo paquete de simbología.');
    }
});

vaultRouter.post('/symbology/seed-universal', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = SymbologySeedUniversalSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros de semilla universal inválidos.');
    }
    const fullIso7010 = parsed.data.forceFullIso7010;
    try {
        const result = await ensureUniversalSymbologySeeded(fullIso7010);
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'SYMBOLOGY_UNIVERSAL_SEEDED',
            targetEntity: 'master_symbology_vault',
            details: { forceFullIso7010: fullIso7010 },
        }).catch(() => undefined);
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return handleVaultError(res, err, 'Error sembrando catálogo vectorial universal.');
    }
});

const VaultPilotFeedbackSchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    pillarId: VaultPillarIdSchema.optional(),
    itemId: z.string().trim().max(120).optional(),
    category: z
        .enum(['AI_KNOWLEDGE_TRAINING', 'CHANGE_REQUEST', 'BUG_CORRECTION', 'FIELD_SIMULATION'])
        .default('AI_KNOWLEDGE_TRAINING'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    observation: z.string().trim().min(3).max(4000),
    expectedAiBehavior: z.string().trim().max(2000).optional(),
    proposedContent: z.string().max(32000).optional(),
});

vaultRouter.post('/pilot-feedback', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = VaultPilotFeedbackSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros de feedback TEST-PILOT inválidos.');
    }

    try {
        const d = parsed.data;
        const cleanObs = ConfidentialityAirlockService.scrubDeterministicPii(d.observation).scrubbed.trim();
        const cleanExpected = d.expectedAiBehavior
            ? ConfidentialityAirlockService.scrubDeterministicPii(d.expectedAiBehavior).scrubbed.trim()
            : null;
        const cleanProposed = d.proposedContent
            ? ConfidentialityAirlockService.scrubDeterministicPii(d.proposedContent).scrubbed.trim()
            : null;

        const feedbackRef = db.collection('pilot_feedback').doc();
        const nowIso = new Date().toISOString();
        const record = {
            id: feedbackRef.id,
            feedbackId: feedbackRef.id,
            tenantId: ctx.tenantId || 'dev-master-sandbox',
            authorUid: ctx.actorId,
            authorEmail: ctx.actorEmail,
            authorRole:
                ctx.accountTier === 1
                    ? 'DEV_ROOT'
                    : ctx.accountTier === 2
                    ? 'SUPER_ADMIN'
                    : ctx.isTestPilot
                    ? 'TEST_PILOT'
                    : 'CURATOR',
            module: 'opermaq' as const,
            executionMode: 'integrated' as const,
            category: d.category,
            priority: d.priority,
            contextPath: `/opermaq/vault/${d.globalAssetId}${d.pillarId ? `/${d.pillarId}` : ''}${d.itemId ? `/${d.itemId}` : ''}`,
            assetOrSurveyId: d.globalAssetId,
            pillarId: d.pillarId || null,
            itemId: d.itemId || null,
            observation: cleanObs,
            expectedAiBehavior: cleanExpected,
            status: 'OPEN' as const,
            timestamp: nowIso,
            createdAt: Date.now(),
        };

        await feedbackRef.set(record);

        let hitlCandidateId: string | null = null;
        if (d.category === 'AI_KNOWLEDGE_TRAINING' || cleanProposed) {
            const candRef = db.collection('hitl_candidates').doc();
            hitlCandidateId = candRef.id;
            await candRef.set({
                id: candRef.id,
                feedbackId: feedbackRef.id,
                module: 'opermaq',
                globalAssetId: d.globalAssetId,
                pillarId: d.pillarId || null,
                itemId: d.itemId || null,
                authorUid: ctx.actorId,
                authorEmail: ctx.actorEmail,
                observation: cleanObs,
                expectedAiBehavior: cleanExpected,
                proposedContent: cleanProposed,
                status: 'PENDING_REVIEW',
                createdAt: nowIso,
            });
        }

        await AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'test-pilot',
            action: `OPERMAQ_PILOT_FEEDBACK_${d.category}`,
            targetEntity: feedbackRef.id,
            details: {
                globalAssetId: d.globalAssetId,
                pillarId: d.pillarId || null,
                itemId: d.itemId || null,
                hitlCandidateId,
                priority: d.priority,
            },
        }).catch(() => undefined);

        return res.status(201).json({
            success: true,
            feedbackId: feedbackRef.id,
            hitlCandidateId,
            item: record,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error registrando retroalimentación TEST-PILOT.');
    }
});

/**
 * POST /api/vault/pilot-hitl/:candidateId/consolidate
 * Cierra el bucle TEST-PILOT (`hitl_candidates` -> `pilot_feedback` con `status: 'APPLIED_TO_AI'`),
 * habilitando su inyección inmediata por `ResilientAIClient.enrichSystemInstructionWithPilotFeedback`.
 */
vaultRouter.post(
    '/pilot-hitl/:candidateId/consolidate',
    requireCurateAI,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const paramsParsed = VaultPilotCandidateIdParamSchema.safeParse(req.params);
        if (!paramsParsed.success) {
            return sendZodBadRequest(res, paramsParsed.error, 'candidateId inválido.');
        }

        if (!isValidHitlConfirmWord(req.body?.confirmWord)) {
            return sendConfirmWordMismatch(res);
        }

        const parsed = PilotHitlConsolidateBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return sendZodBadRequest(res, parsed.error, 'Payload de consolidación TEST-PILOT inválido.');
        }

        const { candidateId } = paramsParsed.data;
        const { decision, approvedFields, curatedDirective } = parsed.data;

        try {
            const candRef = db.collection('hitl_candidates').doc(candidateId);
            const candSnap = await candRef.get();
            if (!candSnap.exists) {
                return res.status(404).json({
                    error: 'CANDIDATE_NOT_FOUND',
                    message: 'Candidato HITL no encontrado.',
                });
            }

            const candidate = candSnap.data() || {};
            const nowIso = new Date().toISOString();
            const sanitizedApprovedFields = (scrubUnknownStringsDeep(approvedFields || {}) || {}) as Record<
                string,
                unknown
            >;
            const cleanCuratedDirective = curatedDirective
                ? ConfidentialityAirlockService.scrubDeterministicPii(curatedDirective).scrubbed.trim()
                : '';

            let promotedFeedbackId: string | null = candidate.feedbackId
                ? String(candidate.feedbackId).trim()
                : null;

            await candRef.set(
                {
                    status: decision,
                    approvedFields: sanitizedApprovedFields,
                    reviewedByUid: ctx.actorId,
                    reviewedByEmail: ctx.actorEmail,
                    reviewedAt: nowIso,
                    ...(cleanCuratedDirective ? { curatedDirective: cleanCuratedDirective } : {}),
                },
                { merge: true }
            );

            if (decision === 'APPROVED') {
                const candidateModule = String(candidate.module || 'opermaq').trim() || 'opermaq';
                const cleanObservation = ConfidentialityAirlockService.scrubDeterministicPii(
                    String(candidate.observation || '')
                ).scrubbed.trim();
                const rawDirectiveFallback = String(
                    candidate.expectedAiBehavior || candidate.proposedContent || candidate.observation || ''
                );
                const effectiveDirective =
                    cleanCuratedDirective ||
                    ConfidentialityAirlockService.scrubDeterministicPii(rawDirectiveFallback).scrubbed.trim();

                const feedbackRef = promotedFeedbackId
                    ? db.collection('pilot_feedback').doc(promotedFeedbackId)
                    : db.collection('pilot_feedback').doc();
                promotedFeedbackId = feedbackRef.id;

                const feedbackSnap = await feedbackRef.get();
                if (feedbackSnap.exists) {
                    await feedbackRef.set(
                        {
                            status: 'APPLIED_TO_AI',
                            ...(cleanObservation ? { observation: cleanObservation } : {}),
                            expectedAiBehavior: effectiveDirective,
                            appliedAt: nowIso,
                            updatedAt: nowIso,
                            appliedByUid: ctx.actorId,
                            appliedByEmail: ctx.actorEmail,
                        },
                        { merge: true }
                    );
                } else {
                    await feedbackRef.set({
                        id: feedbackRef.id,
                        feedbackId: feedbackRef.id,
                        tenantId: String(candidate.tenantId || ctx.tenantId || 'dev-master-sandbox'),
                        authorUid: String(candidate.authorUid || ctx.actorId),
                        authorEmail: String(candidate.authorEmail || ctx.actorEmail),
                        module: candidateModule,
                        executionMode: 'integrated',
                        category: 'AI_KNOWLEDGE_TRAINING',
                        priority: 'HIGH',
                        assetOrSurveyId: candidate.globalAssetId || null,
                        pillarId: candidate.pillarId || null,
                        itemId: candidate.itemId || null,
                        observation: cleanObservation || effectiveDirective,
                        expectedAiBehavior: effectiveDirective,
                        status: 'APPLIED_TO_AI',
                        timestamp: nowIso,
                        createdAt: Date.now(),
                        appliedAt: nowIso,
                        updatedAt: nowIso,
                        appliedByUid: ctx.actorId,
                        appliedByEmail: ctx.actorEmail,
                    });
                }

                if (!candidate.feedbackId) {
                    await candRef.set({ feedbackId: promotedFeedbackId }, { merge: true });
                }
            }

            await AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: 'OPERMAQ_PILOT_HITL_CONSOLIDATED',
                targetEntity: `hitl_candidates/${candidateId}`,
                details: {
                    candidateId,
                    decision,
                    feedbackId: promotedFeedbackId,
                    feedbackPromoted: decision === 'APPROVED',
                },
            }).catch(() => undefined);

            return res.status(200).json({
                ok: true,
                candidateId,
                status: decision,
                feedbackPromoted: decision === 'APPROVED',
            });
        } catch (err) {
            return handleVaultError(res, err, 'Error consolidando candidato HITL TEST-PILOT.');
        }
    }
);

vaultRouter.post('/compile-manual', async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().trim().min(1).max(160),
        profileId: z.enum([
            'MASTER_5_PILLARS',
            'OPERATOR_POCKET_GUIDE',
            'WORKSHOP_PM_MANUAL',
            'REGULATORY_DS132_LOTO',
        ]),
        tenantAssetId: z.string().trim().max(160).optional(),
        includeTenantOverrides: z.boolean().optional().default(false),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros inválidos.');
    }

    try {
        const compiled = await OpermaqManualPublisher.compileAdHocManual({
            globalAssetId: parsed.data.globalAssetId,
            profileId: parsed.data.profileId as AdHocManualProfileId,
            tenantAssetId: parsed.data.tenantAssetId,
            includeTenantOverrides: parsed.data.includeTenantOverrides,
            tenantId: ctx.tenantId,
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ADHOC_MANUAL_COMPILED',
            targetEntity: `global_asset_catalog/${parsed.data.globalAssetId}`,
            details: {
                globalAssetId: parsed.data.globalAssetId,
                profileId: parsed.data.profileId,
                includeTenantOverrides: parsed.data.includeTenantOverrides,
            },
        }).catch(() => undefined);

        return res.status(200).json({ success: true, ...compiled });
    } catch (err) {
        return handleVaultError(res, err, 'Error compilando manual ad-hoc ilustrado.');
    }
});

vaultRouter.get('/manuals/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const paramsParsed = VaultGlobalAssetIdParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
        return sendZodBadRequest(res, paramsParsed.error, 'globalAssetId inválido.');
    }
    const { globalAssetId } = paramsParsed.data;
    try {
        const snap = await db
            .collection('global_asset_catalog')
            .doc(globalAssetId)
            .collection('generated_manuals')
            .limit(20)
            .get();

        const manuals = snap.docs
            .map((d) => d.data())
            .sort((a: any, b: any) => String(b.compiledAt || '').localeCompare(String(a.compiledAt || '')));

        return res.status(200).json({ manuals });
    } catch (err) {
        return handleVaultError(res, err, 'Error listando manuales ad-hoc generados.');
    }
});

// ── v4.0: INTELIGENCIA COLECTIVA (k >= 5)-ANÓNIMA + CATÁLOGO MATERIALES STOCKPILE ──

vaultRouter.post('/benchmarks/record', async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (ctx.isEduSandbox) {
        return res.status(403).json({
            error: 'EDU_SANDBOX_ISOLATED',
            message: 'El entorno académico EDU opera en sandbox aislado y no contamina benchmarks productivos.',
        });
    }
    const schema = z.object({
        module: z.enum(['opermaq', 'stockpile']),
        targetCanonicalId: z.string().trim().min(1).max(160),
        metricKind: BenchmarkMetricKindSchema,
        numericValue: z.number().positive(),
        unitSi: z.string().trim().min(1).max(32),
        operatingContextTag: z.string().trim().max(120).optional(),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
        return sendZodBadRequest(res, parsed.error, 'Parámetros inválidos.');
    }

    try {
        const recorded = await CollectiveBenchmarkService.recordAnonymousMetricEvent({
            tenantId: ctx.tenantId,
            module: parsed.data.module,
            targetCanonicalId: parsed.data.targetCanonicalId,
            metricKind: parsed.data.metricKind as BenchmarkMetricKind,
            numericValue: parsed.data.numericValue,
            unitSi: parsed.data.unitSi,
            operatingContextTag: parsed.data.operatingContextTag,
        });
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: parsed.data.module,
            action: 'OPERMAQ_ANONYMOUS_BENCHMARK_RECORDED',
            targetEntity: parsed.data.targetCanonicalId,
            details: {
                module: parsed.data.module,
                metricKind: parsed.data.metricKind,
                unitSi: parsed.data.unitSi,
            },
        }).catch(() => undefined);
        return res.status(200).json({ success: true, ...recorded });
    } catch (err) {
        return handleVaultError(res, err, 'Error registrando telemetría anónima.');
    }
});

vaultRouter.get('/benchmarks/:targetCanonicalId/:metricKind', async (req: ScopedRequest, res: Response) => {
    const paramsParsed = z
        .object({
            targetCanonicalId: z.string().trim().min(1).max(160),
            metricKind: BenchmarkMetricKindSchema,
        })
        .safeParse(req.params);
    if (!paramsParsed.success) {
        return sendZodBadRequest(res, paramsParsed.error, 'Parámetros de benchmark inválidos.');
    }
    try {
        const summary = await CollectiveBenchmarkService.getAnonymousBenchmarkSummary(
            paramsParsed.data.targetCanonicalId,
            paramsParsed.data.metricKind as BenchmarkMetricKind
        );
        return res.status(200).json(summary);
    } catch (err) {
        return handleVaultError(res, err, 'Error consultando benchmark k-anónimo.');
    }
});

vaultRouter.get('/materials-catalog', async (_req: ScopedRequest, res: Response) => {
    try {
        const materials = await CollectiveBenchmarkService.listGlobalMaterialsCatalog();
        return res.status(200).json({ materials });
    } catch (err) {
        return handleVaultError(res, err, 'Error listando catálogo universal de materiales.');
    }
});

export default vaultRouter;
