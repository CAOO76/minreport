import { z } from 'zod';
import admin, { db } from '../../../config/firebase';
import { AuditLedger } from '../../../core/audit-ledger';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { ResilientAIClient, type GroundingSource } from '../../../core/resilient-ai-client';
import { assertSafeExternalUrl } from '../../../utils/ssrfGuard';
import {
    BrandSvgAssetDescriptor,
    DirectCreateManufacturerBody,
    EMPTY_MANUFACTURER_OFFICIAL_CONTACTS,
    MANUFACTURER_MACHINERY_ARCHETYPE_IDS,
    ManufacturerCurationStatus,
    ManufacturerLogoCandidate,
    ManufacturerMachineryArchetypeId,
    ManufacturerOfficialContacts,
    ManufacturerRecord,
    UpdateManufacturerHitlBody,
} from '../../../contracts/manufacturers.contracts';
import type { ManufacturerRegisteredEquipmentItem } from '../../../contracts/manufacturers.contracts';
import { resolveMachineryArchetype } from '../utils/canonicalArchetypeSpecs';
import { detectCanonicalMake, registerLearnedManufacturerAliases } from './CanonicalEntityResolver';
import {
    isBlockedNonIndustrialLogoRef,
    ManufacturerLogoHunterService,
} from './ManufacturerLogoHunterService';

/**
 * REGISTRO SEMI-AUTÓNOMO DE FABRICANTES OEM (`global_manufacturers`) — DOMINIO 1 DESACOPLADO
 *
 * Regla de Unicidad (`1 Marca = 1 Registro Maestro`, Zero-Preset):
 * - Al registrar cualquier equipo (`CATÁLOGO`, `FLOTA`, `ONBOARDING`) o al ejecutar `syncManufacturersFromExistingEquipment`,
 *   detecta e inscribe la marca matriz original UNA ÚNICA VEZ.
 * - Equipos adicionales de la misma marca incrementan `equipmentCount`, agregan `sampleModels[]` y `observedArchetypeIds[]`.
 * - Pipeline IA de 2 Pasadas Grounded con contexto real de modelo/tipo para desambiguación industrial
 *   y extracción de `officialWebsiteUrl` + `officialContacts` de fábrica. Cero distribuidores locales acoplados.
 */

const MANUFACTURERS_COL = 'global_manufacturers';

const GENERIC_MAKE_BLOCKLIST = new Set([
    '',
    'GENERICO',
    'GENERIC',
    'SIN MARCA',
    'NO DECLARADO',
    'N/A',
    'NA',
    'NONE',
    'UNKNOWN',
]);

const PERSONAL_FREE_EMAIL_DOMAINS = new Set([
    'gmail.com',
    'googlemail.com',
    'hotmail.com',
    'outlook.com',
    'live.com',
    'msn.com',
    'yahoo.com',
    'yahoo.es',
    'icloud.com',
    'me.com',
    'proton.me',
    'protonmail.com',
]);

function normalizeSlug(raw: string): string {
    return String(raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 118);
}

export function normalizeManufacturerKey(rawMake: string): string {
    const clean = String(rawMake || '').trim();
    if (!clean) return '';
    const canonical = detectCanonicalMake(clean) || clean;
    const upper = canonical
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .toUpperCase()
        .trim();
    if (GENERIC_MAKE_BLOCKLIST.has(upper)) return '';
    return normalizeSlug(canonical);
}

export function formatInitialOfficialBrandName(rawMake: string): string {
    const clean = String(rawMake || '').trim();
    if (!clean) return '';
    const canonical = detectCanonicalMake(clean) || clean;
    if (canonical === canonical.toUpperCase()) {
        if (canonical.length <= 3) return canonical;
        return canonical.toLowerCase().replace(/\b([a-z])/g, (_, ch: string) => ch.toUpperCase());
    }
    return canonical;
}

export async function filterSafeHttpsUrl(rawUrl?: string | null): Promise<string | null> {
    const clean = String(rawUrl || '').trim();
    if (!clean || !clean.startsWith('https://')) return null;
    try {
        await assertSafeExternalUrl(clean);
        return clean;
    } catch {
        return null;
    }
}

export function sanitizeFunctionalCorporateEmail(rawEmail?: string | null): string | null {
    const raw = String(rawEmail || '').trim();
    if (!raw || /RESERVAD[OA]|REDACTED|\[|\]/i.test(raw)) return null;
    const clean = raw.toLowerCase();
    if (clean.length > 180) return null;
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) return null;
    const domain = clean.split('@')[1] || '';
    if (PERSONAL_FREE_EMAIL_DOMAINS.has(domain)) return null;
    return clean;
}

export function sanitizeCorporatePhone(rawPhone?: string | null): string | null {
    const clean = String(rawPhone || '').trim();
    if (!clean || clean.length < 6 || clean.length > 64) return null;
    if (/RESERVAD[OA]|REDACTED|\[|\]/i.test(clean)) return null;
    if (clean.replace(/\D/g, '').length < 6) return null;
    // Evitar exposición de celulares móviles personales locales (+56 9 XXXX XXXX) en ficha global OEM
    if (/^\+?56\s*9\s*\d{4}[\s-]?\d{4}$/.test(clean)) return null;
    return clean;
}

function resolveValidArchetypeId(
    rawArchetype?: string | null,
    tipoEquipo?: string | null,
    categoriaEquipo?: string | null
): ManufacturerMachineryArchetypeId | null {
    if (rawArchetype && (MANUFACTURER_MACHINERY_ARCHETYPE_IDS as readonly string[]).includes(rawArchetype)) {
        return rawArchetype as ManufacturerMachineryArchetypeId;
    }
    if (tipoEquipo && String(tipoEquipo).trim().length >= 2) {
        const resolved = resolveMachineryArchetype(tipoEquipo, categoriaEquipo);
        if (resolved?.id && (MANUFACTURER_MACHINERY_ARCHETYPE_IDS as readonly string[]).includes(resolved.id)) {
            return resolved.id as ManufacturerMachineryArchetypeId;
        }
    }
    return null;
}

function mergeLimitedUniqueStrings(existing: string[] | undefined, additions: Array<string | null | undefined>, max = 12): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of [...(existing || []), ...additions]) {
        const clean = String(raw || '').trim();
        if (!clean || clean.length < 2) continue;
        const norm = clean.toUpperCase();
        if (seen.has(norm) || GENERIC_MAKE_BLOCKLIST.has(norm)) continue;
        seen.add(norm);
        out.push(clean);
        if (out.length >= max) break;
    }
    return out;
}

const AiPass2ManufacturerSchema = z.object({
    hasPublicWebFootprint: z.boolean().default(true),
    officialName: z.string().trim().max(180).nullable().optional(),
    legalCorporateName: z.string().trim().max(220).nullable().optional(),
    hqCountryIso2: z.string().trim().max(4).nullable().optional(),
    hqCity: z.string().trim().max(120).nullable().optional(),
    officialWebsiteUrl: z.string().trim().max(512).nullable().optional(),
    corporateContactUrl: z.string().trim().max(512).nullable().optional(),
    corporateEmail: z.string().trim().max(180).nullable().optional(),
    corporatePhone: z.string().trim().max(64).nullable().optional(),
    officialPartsUrl: z.string().trim().max(512).nullable().optional(),
    officialSupportUrl: z.string().trim().max(512).nullable().optional(),
    dealerLocatorUrl: z.string().trim().max(512).nullable().optional(),
    aliases: z.array(z.string().trim().max(80)).max(24).default([]),
});

let lastIndexHydrationMs = 0;
let lastAutoRetroSyncMs = 0;
let retroSyncInFlight: Promise<void> | null = null;
const INDEX_HYDRATION_TTL_MS = 60_000;

export async function hydrateDynamicManufacturerIndex(force = false): Promise<number> {
    if (!force && Date.now() - lastIndexHydrationMs < INDEX_HYDRATION_TTL_MS) return 0;
    const snap = await db.collection(MANUFACTURERS_COL).get();
    let count = 0;
    for (const doc of snap.docs) {
        const d = doc.data() || {};
        if (typeof d.officialName === 'string' && d.officialName.trim()) {
            registerLearnedManufacturerAliases(d.officialName, Array.isArray(d.aliases) ? d.aliases : []);
            count += 1;
        }
    }
    lastIndexHydrationMs = Date.now();
    return count;
}

function isBrokenOrIncompleteManufacturer(docData: Partial<ManufacturerRecord>): boolean {
    const hasBlockedLogo =
        (docData.logoCandidates || []).some((c) => isBlockedNonIndustrialLogoRef(c?.sourceUrl || '')) ||
        Boolean(docData.logoSvg?.sourceUrl && isBlockedNonIndustrialLogoRef(docData.logoSvg.sourceUrl));

    if (hasBlockedLogo) return true;
    if (docData.curationStatus === 'VERIFIED') return false;

    const name = String(docData.officialName || '').trim();
    const isLowercaseAcronymOrRaw = name.length > 0 && name === name.toLowerCase();
    const missingWebsite = docData.hasPublicWebFootprint !== false && !docData.officialWebsiteUrl;
    const missingLegalName = docData.hasPublicWebFootprint !== false && !docData.legalCorporateName;

    return isLowercaseAcronymOrRaw || missingWebsite || missingLegalName;
}

export async function ensureManufacturerOnEquipmentRegistration(params: {
    rawMake?: string | null;
    archetypeId?: ManufacturerMachineryArchetypeId | null;
    sampleModel?: string | null;
    sampleEquipmentType?: string | null;
    isNewEquipmentRecord?: boolean;
    actorUid?: string;
    skipBackgroundAi?: boolean;
}): Promise<ManufacturerRecord | null> {
    const cleanRaw = String(params.rawMake || '').trim();
    if (!cleanRaw) return null;

    await hydrateDynamicManufacturerIndex().catch(() => 0);

    const upperCheck = cleanRaw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .toUpperCase()
        .trim();
    if (GENERIC_MAKE_BLOCKLIST.has(upperCheck)) return null;

    const canonicalOrRaw = detectCanonicalMake(cleanRaw) || cleanRaw;
    const manufacturerKey = normalizeManufacturerKey(canonicalOrRaw);
    if (!manufacturerKey) return null;

    const validArchetype = resolveValidArchetypeId(
        params.archetypeId,
        params.sampleEquipmentType,
        null
    );

    const docRef = db.collection(MANUFACTURERS_COL).doc(manufacturerKey);
    const snap = await docRef.get();
    const nowMs = Date.now();

    if (snap.exists) {
        const existing = { manufacturerKey: snap.id, ...(snap.data() as any) } as ManufacturerRecord;
        const observedSet = new Set<ManufacturerMachineryArchetypeId>(existing.observedArchetypeIds || []);
        if (validArchetype) observedSet.add(validArchetype);

        const nextObserved = Array.from(observedSet);
        const nextAliases = mergeLimitedUniqueStrings(existing.aliases, [cleanRaw], 24);
        const nextModels = mergeLimitedUniqueStrings(existing.sampleModels, [params.sampleModel], 12);
        const shouldIncrement = params.isNewEquipmentRecord !== false;

        const cleanName =
            existing.curationStatus !== 'VERIFIED' &&
            existing.officialName === existing.officialName.toLowerCase()
                ? formatInitialOfficialBrandName(canonicalOrRaw)
                : existing.officialName;

        const updatePayload: Record<string, any> = {
            officialName: cleanName,
            observedArchetypeIds: nextObserved,
            sampleModels: nextModels,
            aliases: nextAliases,
            updatedAt: nowMs,
        };
        if (shouldIncrement) {
            updatePayload.equipmentCount = admin.firestore.FieldValue.increment(1);
        }

        await docRef.update(updatePayload);
        registerLearnedManufacturerAliases(cleanName, nextAliases);

        const updatedRecord: ManufacturerRecord = {
            ...existing,
            officialName: cleanName,
            officialContacts: existing.officialContacts || { ...EMPTY_MANUFACTURER_OFFICIAL_CONTACTS },
            observedArchetypeIds: nextObserved,
            sampleModels: nextModels,
            aliases: nextAliases,
            equipmentCount: shouldIncrement ? (existing.equipmentCount || 0) + 1 : existing.equipmentCount || 0,
            updatedAt: nowMs,
        };

        if (!params.skipBackgroundAi && isBrokenOrIncompleteManufacturer(updatedRecord)) {
            void ManufacturerRegistryService.autoPopulateManufacturerWithAi({
                manufacturerKey,
                actorUid: params.actorUid || 'system-auto-discovery',
            }).catch(() => {});
        }

        return updatedRecord;
    }

    const displayOfficialName = formatInitialOfficialBrandName(canonicalOrRaw);
    const initialAliases = mergeLimitedUniqueStrings([cleanRaw, displayOfficialName], [], 24);
    const initialModels = mergeLimitedUniqueStrings([], [params.sampleModel], 12);

    const newRecord: ManufacturerRecord = {
        manufacturerKey,
        officialName: displayOfficialName,
        legalCorporateName: null,
        aliases: initialAliases,
        hqCountryIso2: null,
        hqCity: null,
        officialWebsiteUrl: null,
        officialContacts: { ...EMPTY_MANUFACTURER_OFFICIAL_CONTACTS },
        observedArchetypeIds: validArchetype ? [validArchetype] : [],
        sampleModels: initialModels,
        logoSvg: null,
        logoCandidates: [],
        curationStatus: 'AUTO_DISCOVERED',
        hasPublicWebFootprint: true,
        equipmentCount: 1,
        linkedSuppliersCount: 0,
        createdAt: nowMs,
        updatedAt: nowMs,
        verifiedByUid: null,
    };

    await docRef.set(newRecord);
    registerLearnedManufacturerAliases(newRecord.officialName, newRecord.aliases);

    if (!params.skipBackgroundAi) {
        void ManufacturerRegistryService.autoPopulateManufacturerWithAi({
            manufacturerKey,
            actorUid: params.actorUid || 'system-auto-discovery',
        }).catch(() => {});
    }

    return newRecord;
}

export function triggerAsyncManufacturerDiscovery(params: {
    rawMake?: string | null;
    archetypeId?: string | null;
    sampleModel?: string | null;
    sampleEquipmentType?: string | null;
    isNewEquipmentRecord?: boolean;
    actorUid?: string;
    skipBackgroundAi?: boolean;
}): void {
    const cleanMake = String(params.rawMake || '').trim();
    if (!cleanMake) return;

    const validArchetype = resolveValidArchetypeId(
        params.archetypeId,
        params.sampleEquipmentType,
        null
    );

    setImmediate(() => {
        void ensureManufacturerOnEquipmentRegistration({
            rawMake: cleanMake,
            archetypeId: validArchetype,
            sampleModel: params.sampleModel,
            sampleEquipmentType: params.sampleEquipmentType,
            isNewEquipmentRecord: params.isNewEquipmentRecord,
            actorUid: params.actorUid || 'system-auto-discovery',
            skipBackgroundAi: params.skipBackgroundAi,
        }).catch((err) => {
            console.warn('[OPERMAQ·FABRICANTES] Auto-descubrimiento omitido:', err?.message || err);
        });
    });
}

function normalizeCandidateToDescriptor(cand: ManufacturerLogoCandidate, invertOverride?: boolean): BrandSvgAssetDescriptor {
    return {
        sha256: cand.sha256,
        ...(cand.phashHex ? { phashHex: cand.phashHex } : {}),
        storagePath: cand.storagePath ?? null,
        downloadUrl: cand.downloadUrl,
        originalBytes: cand.originalBytes,
        optimizedBytes: cand.optimizedBytes,
        savingsPct: cand.savingsPct,
        invertInDark: typeof invertOverride === 'boolean' ? invertOverride : cand.invertInDark,
        wasVectorized: cand.wasVectorized,
        sourceKind: cand.sourceKind,
        sourceUrl: cand.sourceUrl ?? null,
    };
}

function hydrateRecordDefaults(id: string, raw: Record<string, any>): ManufacturerRecord {
    return {
        manufacturerKey: id,
        officialName: String(raw.officialName || id),
        legalCorporateName: raw.legalCorporateName ?? null,
        aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
        hqCountryIso2: raw.hqCountryIso2 ?? null,
        hqCity: raw.hqCity ?? null,
        officialWebsiteUrl: raw.officialWebsiteUrl ?? null,
        officialContacts: {
            ...EMPTY_MANUFACTURER_OFFICIAL_CONTACTS,
            ...(raw.officialContacts || {}),
        },
        observedArchetypeIds: Array.isArray(raw.observedArchetypeIds) ? raw.observedArchetypeIds : [],
        sampleModels: Array.isArray(raw.sampleModels) ? raw.sampleModels : [],
        logoSvg: raw.logoSvg ?? null,
        logoCandidates: Array.isArray(raw.logoCandidates) ? raw.logoCandidates : [],
        curationStatus: raw.curationStatus === 'VERIFIED' ? 'VERIFIED' : 'AUTO_DISCOVERED',
        hasPublicWebFootprint: raw.hasPublicWebFootprint !== false,
        equipmentCount: typeof raw.equipmentCount === 'number' ? raw.equipmentCount : 0,
        linkedSuppliersCount: typeof raw.linkedSuppliersCount === 'number' ? raw.linkedSuppliersCount : 0,
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
        verifiedByUid: raw.verifiedByUid ?? null,
    };
}

export class ManufacturerRegistryService {
    public static async listManufacturers(filters?: {
        q?: string;
        curationStatus?: ManufacturerCurationStatus;
    }): Promise<ManufacturerRecord[]> {
        await hydrateDynamicManufacturerIndex().catch(() => 0);

        let snap = await db.collection(MANUFACTURERS_COL).get();
        let records = snap.docs.map((d) => hydrateRecordDefaults(d.id, d.data() || {}));

        // Sincronización retroactiva automática ligera si falta detectar marcas del inventario existente
        const now = Date.now();
        const hasBroken = records.some((r) => isBrokenOrIncompleteManufacturer(r));
        if ((records.length === 0 || hasBroken || now - lastAutoRetroSyncMs > 120_000) && !retroSyncInFlight) {
            lastAutoRetroSyncMs = now;
            await this.syncManufacturersFromExistingEquipment({
                actorUid: 'system-auto-sync',
                runAi: false,
                forceRefreshBroken: false,
            }).catch(() => undefined);

            snap = await db.collection(MANUFACTURERS_COL).get();
            records = snap.docs.map((d) => hydrateRecordDefaults(d.id, d.data() || {}));

            if (records.some((r) => isBrokenOrIncompleteManufacturer(r))) {
                retroSyncInFlight = this.syncManufacturersFromExistingEquipment({
                    actorUid: 'system-auto-sync',
                    runAi: true,
                    forceRefreshBroken: true,
                })
                    .then(() => undefined)
                    .catch(() => undefined)
                    .finally(() => {
                        retroSyncInFlight = null;
                    });
            }
        }

        if (filters?.curationStatus) {
            records = records.filter((r) => r.curationStatus === filters.curationStatus);
        }
        if (filters?.q && filters.q.trim()) {
            const qNorm = filters.q
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .trim();
            records = records.filter(
                (r) =>
                    r.manufacturerKey.includes(qNorm) ||
                    r.officialName.toLowerCase().includes(qNorm) ||
                    (r.legalCorporateName || '').toLowerCase().includes(qNorm) ||
                    (r.aliases || []).some((a) => a.toLowerCase().includes(qNorm))
            );
        }

        const suppliersSnap = await db.collection('global_suppliers').get().catch(() => null);
        if (suppliersSnap) {
            const linkedCountMap = new Map<string, Set<string>>();
            for (const sDoc of suppliersSnap.docs) {
                const sData = sDoc.data() || {};
                const mfgKeys = new Set<string>();
                if (Array.isArray(sData.manufacturerKeys)) {
                    for (const k of sData.manufacturerKeys) {
                        const norm = normalizeManufacturerKey(String(k || ''));
                        if (norm) mfgKeys.add(norm);
                    }
                }
                if (Array.isArray(sData.divisions)) {
                    for (const d of sData.divisions) {
                        if (Array.isArray(d?.manufacturerKeys)) {
                            for (const k of d.manufacturerKeys) {
                                const norm = normalizeManufacturerKey(String(k || ''));
                                if (norm) mfgKeys.add(norm);
                            }
                        }
                    }
                }
                if (Array.isArray(sData.contacts)) {
                    for (const c of sData.contacts) {
                        if (Array.isArray(c?.manufacturerKeys)) {
                            for (const k of c.manufacturerKeys) {
                                const norm = normalizeManufacturerKey(String(k || ''));
                                if (norm) mfgKeys.add(norm);
                            }
                        }
                    }
                }
                for (const mk of mfgKeys) {
                    const set = linkedCountMap.get(mk) || new Set<string>();
                    set.add(sDoc.id);
                    linkedCountMap.set(mk, set);
                }
            }
            records = records.map((r) => ({
                ...r,
                linkedSuppliersCount: linkedCountMap.get(r.manufacturerKey)?.size ?? r.linkedSuppliersCount ?? 0,
            }));
        }

        records.sort((a, b) => a.officialName.localeCompare(b.officialName, 'es'));
        return records;
    }

    public static async getManufacturerByKey(manufacturerKey: string): Promise<ManufacturerRecord | null> {
        const cleanKey = normalizeSlug(manufacturerKey);
        if (!cleanKey) return null;
        const [snap, suppliersSnap] = await Promise.all([
            db.collection(MANUFACTURERS_COL).doc(cleanKey).get(),
            db.collection('global_suppliers').get().catch(() => null),
        ]);
        if (!snap.exists) return null;
        const record = hydrateRecordDefaults(snap.id, snap.data() || {});
        if (suppliersSnap) {
            let count = 0;
            for (const sDoc of suppliersSnap.docs) {
                const sData = sDoc.data() || {};
                const keys = [
                    ...(Array.isArray(sData.manufacturerKeys) ? sData.manufacturerKeys : []),
                    ...(Array.isArray(sData.divisions)
                        ? sData.divisions.flatMap((d: any) => (Array.isArray(d?.manufacturerKeys) ? d.manufacturerKeys : []))
                        : []),
                    ...(Array.isArray(sData.contacts)
                        ? sData.contacts.flatMap((c: any) => (Array.isArray(c?.manufacturerKeys) ? c.manufacturerKeys : []))
                        : []),
                ]
                    .map((k) => normalizeManufacturerKey(String(k || '')))
                    .filter(Boolean);
                if (keys.includes(cleanKey)) count++;
            }
            record.linkedSuppliersCount = count;
        }
        return record;
    }

    /**
     * Lista los equipos registrados en `global_asset_catalog` asociados a una marca OEM (Pilar 02 del espacio de marca).
     */
    public static async listRegisteredEquipmentByManufacturer(
        manufacturerKey: string
    ): Promise<ManufacturerRegisteredEquipmentItem[]> {
        const cleanKey = normalizeManufacturerKey(manufacturerKey) || normalizeSlug(manufacturerKey);
        if (!cleanKey) return [];

        const [mfgSnap, catSnap] = await Promise.all([
            db.collection(MANUFACTURERS_COL).doc(cleanKey).get(),
            db.collection('global_asset_catalog').get().catch(() => null),
        ]);
        if (!catSnap) return [];

        const aliasKeys = new Set<string>([cleanKey]);
        if (mfgSnap.exists) {
            const mData = mfgSnap.data() || {};
            if (mData.officialName) {
                const ok = normalizeManufacturerKey(String(mData.officialName));
                if (ok) aliasKeys.add(ok);
            }
            if (Array.isArray(mData.aliases)) {
                for (const alias of mData.aliases) {
                    const ak = normalizeManufacturerKey(String(alias || ''));
                    if (ak) aliasKeys.add(ak);
                }
            }
        }

        const items: ManufacturerRegisteredEquipmentItem[] = [];
        for (const doc of catSnap.docs) {
            const data = doc.data() || {};
            const rawMake = String(data.make_oficial || data.make || '').trim();
            if (!rawMake) continue;
            const canonical = detectCanonicalMake(rawMake) || rawMake;
            const resolvedKey = normalizeManufacturerKey(canonical) || normalizeSlug(rawMake);
            if (!aliasKeys.has(resolvedKey) && normalizeSlug(rawMake) !== cleanKey) {
                continue;
            }
            const equipmentType = String(data.tipo_equipo || data.equipmentType || 'OTROS_EQUIPOS').trim() || 'OTROS_EQUIPOS';
            const archetypeId = resolveValidArchetypeId(
                data.archetype_id ? String(data.archetype_id) : null,
                equipmentType,
                null
            );
            items.push({
                catalogId: doc.id,
                make: canonical,
                model: String(data.model_oficial || data.model || doc.id).trim(),
                equipmentType,
                category: data.categoria_equipo ? String(data.categoria_equipo).trim() : null,
                archetypeId,
                photoUrl: data.foto_url ? String(data.foto_url).trim() : null,
                shortDescription: data.short_description ? String(data.short_description).trim().slice(0, 400) : null,
            });
        }

        items.sort((a, b) => {
            const typeCmp = a.equipmentType.localeCompare(b.equipmentType, 'es');
            if (typeCmp !== 0) return typeCmp;
            return a.model.localeCompare(b.model, 'es');
        });
        return items;
    }

    /**
     * Pipeline IA de 2 Pasadas Grounded (Industrial Disambiguation -> Deterministic JSON):
     * - Pasada 1 (`useGoogleSearch: true`): investiga al fabricante OEM enviando marca + modelos + tipo
     *   real observado, evitando homónimos de entretenimiento/consumo, obteniendo `groundingSources`.
     * - Pasada 2 (`Temperature: 0`): extrae estrictamente identidad corporativa, sede, web oficial y
     *   canales de contacto directos de fábrica (`officialContacts`), bloqueando inventos si 0 fuentes.
     */
    public static async autoPopulateManufacturerWithAi(params: {
        manufacturerKey: string;
        actorUid?: string;
    }): Promise<ManufacturerRecord> {
        const docRef = db.collection(MANUFACTURERS_COL).doc(normalizeSlug(params.manufacturerKey));
        const snap = await docRef.get();
        if (!snap.exists) {
            const err: any = new Error('Fabricante no encontrado en maestro.');
            err.statusCode = 404;
            throw err;
        }
        const current = hydrateRecordDefaults(snap.id, snap.data() || {});

        let nextOfficialName = formatInitialOfficialBrandName(current.officialName);
        let nextLegalName = current.legalCorporateName ?? null;
        let nextCountryIso2 = current.hqCountryIso2 ?? null;
        let nextHqCity = current.hqCity ?? null;
        let nextWebsiteUrl = current.officialWebsiteUrl ?? null;
        let nextAliases = current.aliases || [];
        let nextHasWeb = current.hasPublicWebFootprint ?? true;
        let nextContacts: ManufacturerOfficialContacts = { ...current.officialContacts };

        try {
            const modelsContext = (current.sampleModels || []).slice(0, 6).join(', ');
            const typesContext = (current.observedArchetypeIds || []).slice(0, 4).join(', ');
            const safeBrandBlock = ConfidentialityAirlockService.scrubDeterministicPii(
                `Marca=${nextOfficialName}; Alias=${nextAliases.join(', ')}; Modelos=${modelsContext || 'N/A'}; Tipos=${typesContext || 'N/A'}`,
                'CL'
            ).scrubbed;

            const pass1Prompt = `Investiga en fuentes corporativas oficiales quién es el FABRICANTE ORIGINAL (OEM) de maquinaria pesada, camiones, vehículos o equipos industriales identificado con estos datos:
${safeBrandBlock}

Entrega un informe técnico factual con:
1. Nombre comercial oficial de la marca y razón social corporativa legal (ej. "Caterpillar Inc.", "Mack Trucks, Inc.", "Automobiles Peugeot").
2. País (código ISO-2) y ciudad donde se ubica su casa matriz global.
3. Sitio web corporativo oficial matriz (URL https://).
4. Canales y portales oficiales DIRECTOS DEL FABRICANTE (NUNCA de distribuidores locales terceros):
   - URL de contacto corporativo matriz
   - Correo electrónico corporativo funcional público (si existe publicado)
   - Teléfono central de casa matriz público (si existe publicado)
   - Portal oficial de repuestos del fabricante (ej. portal OEM de partes)
   - Portal oficial de soporte técnico / posventa OEM
   - Localizador oficial global de distribuidores/concesionarios OEM

Si la marca corresponde a un fabricante o maestranza local sin sitio web público verificable, indícalo explícitamente sin inventar URLs ni confundir con personajes o medios de entretenimiento.`;

            let pass1Text = '';
            let groundingSources: GroundingSource[] = [];

            try {
                const pass1Res = await ResilientAIClient.generate({
                    module: 'opermaq',
                    preferredTier: 'SECONDARY',
                    temperature: 0.1,
                    useGoogleSearch: true,
                    prompt: pass1Prompt,
                });
                pass1Text = pass1Res.text || '';
                groundingSources = pass1Res.groundingSources || [];
            } catch {
                // Degradación limpia si falla Pasada 1 Search
            }

            const sourcesManifest =
                groundingSources.length > 0
                    ? groundingSources.map((s, i) => `[${i + 1}] ${s.title} -> ${s.uri}`).join('\n')
                    : '[SIN_FUENTES_WEB_VERIFICADAS]';

            const pass2Prompt = `Eres un extractor determinista de datos corporativos OEM (Temperatura 0).
Analiza la evidencia investigada para el fabricante "${nextOfficialName}" y responde ÚNICAMENTE un objeto JSON válido con las llaves exactas:
{
  "hasPublicWebFootprint": boolean,
  "officialName": string | null,
  "legalCorporateName": string | null,
  "hqCountryIso2": string | null,
  "hqCity": string | null,
  "officialWebsiteUrl": string | null,
  "corporateContactUrl": string | null,
  "corporateEmail": string | null,
  "corporatePhone": string | null,
  "officialPartsUrl": string | null,
  "officialSupportUrl": string | null,
  "dealerLocatorUrl": string | null,
  "aliases": string[]
}

EVIDENCIA RECUPERADA EN PASADA 1:
"""
${pass1Text.slice(0, 12000)}
"""

FUENTES GROUNDED VERIFICADAS:
${sourcesManifest}

REGLAS ESTRICTAS FAIL-CLOSED:
1. Solo incluye URLs https:// que correspondan al dominio oficial del FABRICANTE ORIGINAL OEM (prohibido URLs de concesionarios locales, Wikipedia como web oficial o redes sociales genéricas).
2. Si FUENTES GROUNDED VERIFICADAS indica [SIN_FUENTES_WEB_VERIFICADAS], devuelve null en TODAS las URLs salvo evidencia textual explícita inequívoca en PASADA 1, o fija "hasPublicWebFootprint": false si no existe huella web oficial.
3. Jamás incluyas distribuidores ni correos personales privados en los campos de contacto oficial OEM.
4. "hqCountryIso2" debe ser código ISO-2 de la casa matriz mundial (ej. "US", "FR", "JP", "SE", "DE", "CL").`;

            const aiRes = await ResilientAIClient.generateStructured(
                {
                    module: 'opermaq',
                    preferredTier: 'SECONDARY',
                    temperature: 0,
                    useGoogleSearch: false,
                    prompt: pass2Prompt,
                },
                AiPass2ManufacturerSchema
            );

            const data = aiRes.data;
            const hasVerifiedGrounding =
                groundingSources.length > 0 ||
                pass1Text.trim().length > 0 ||
                (aiRes.meta?.groundingSources?.length ?? 0) > 0;
            nextHasWeb = data.hasPublicWebFootprint ?? true;

            if (data.officialName && data.officialName.trim().length >= 2) {
                nextOfficialName = data.officialName.trim();
            }
            if (data.legalCorporateName && data.legalCorporateName.trim().length >= 2) {
                nextLegalName = data.legalCorporateName.trim();
            }
            if (data.hqCountryIso2 && /^[A-Za-z]{2}$/.test(data.hqCountryIso2.trim())) {
                nextCountryIso2 = data.hqCountryIso2.trim().toUpperCase();
            }
            if (data.hqCity && data.hqCity.trim().length >= 2) {
                nextHqCity = data.hqCity.trim();
            }

            if (nextHasWeb && hasVerifiedGrounding) {
                const [safeWeb, safeContact, safeParts, safeSupport, safeLocator] = await Promise.all([
                    filterSafeHttpsUrl(data.officialWebsiteUrl),
                    filterSafeHttpsUrl(data.corporateContactUrl),
                    filterSafeHttpsUrl(data.officialPartsUrl),
                    filterSafeHttpsUrl(data.officialSupportUrl),
                    filterSafeHttpsUrl(data.dealerLocatorUrl),
                ]);
                nextWebsiteUrl = safeWeb ?? nextWebsiteUrl;
                nextContacts = {
                    corporateContactUrl: safeContact ?? nextContacts.corporateContactUrl ?? null,
                    corporateEmail: sanitizeFunctionalCorporateEmail(data.corporateEmail) ?? nextContacts.corporateEmail ?? null,
                    corporatePhone: sanitizeCorporatePhone(data.corporatePhone) ?? nextContacts.corporatePhone ?? null,
                    officialPartsUrl: safeParts ?? nextContacts.officialPartsUrl ?? null,
                    officialSupportUrl: safeSupport ?? nextContacts.officialSupportUrl ?? null,
                    dealerLocatorUrl: safeLocator ?? nextContacts.dealerLocatorUrl ?? null,
                };
            } else if (!nextHasWeb) {
                nextWebsiteUrl = null;
            }

            nextAliases = mergeLimitedUniqueStrings(nextAliases, data.aliases || [], 24);
        } catch {
            // Degradación limpia sin inventario de datos falsos si no hay red o API key
        }

        // Purgar posibles candidatos heredados con referencias de entretenimiento/ficción (ej. Top Cat)
        const cleanExistingCandidates = (current.logoCandidates || []).filter(
            (c) => !c.sourceUrl || !isBlockedNonIndustrialLogoRef(c.sourceUrl)
        );
        let nextCandidates = cleanExistingCandidates;

        if (nextHasWeb) {
            try {
                const hunted = await ManufacturerLogoHunterService.huntLogosFromWebsite({
                    officialName: nextOfficialName,
                    legalCorporateName: nextLegalName,
                    officialWebsiteUrl: nextWebsiteUrl,
                    actorUid: params.actorUid || 'system-auto-discovery',
                });
                nextCandidates = ManufacturerLogoHunterService.deduplicateCandidates(nextCandidates, hunted);
            } catch {
                // Cero bloqueo por falla de captura visual
            }
        }

        const freshSnap = await docRef.get();
        const fresh = hydrateRecordDefaults(docRef.id, (freshSnap.exists ? freshSnap.data() : current) || {});
        const isAlreadyVerified = fresh.curationStatus === 'VERIFIED';

        const sanitizedFreshCandidates = (fresh.logoCandidates || []).filter(
            (c) => !c.sourceUrl || !isBlockedNonIndustrialLogoRef(c.sourceUrl)
        );
        const mergedCandidates = ManufacturerLogoHunterService.deduplicateCandidates(
            sanitizedFreshCandidates,
            nextCandidates
        );

        const freshLogoValid =
            fresh.logoSvg && (!fresh.logoSvg.sourceUrl || !isBlockedNonIndustrialLogoRef(fresh.logoSvg.sourceUrl))
                ? fresh.logoSvg
                : null;

        const patch: Partial<ManufacturerRecord> = {
            aliases: mergeLimitedUniqueStrings(fresh.aliases, nextAliases, 24),
            logoCandidates: mergedCandidates,
            updatedAt: Date.now(),
        };

        if (!isAlreadyVerified) {
            patch.officialName = nextOfficialName;
            patch.legalCorporateName = nextLegalName || fresh.legalCorporateName || null;
            patch.hqCountryIso2 = nextCountryIso2 || fresh.hqCountryIso2 || null;
            patch.hqCity = nextHqCity || fresh.hqCity || null;
            patch.officialWebsiteUrl = nextWebsiteUrl || fresh.officialWebsiteUrl || null;
            patch.officialContacts = {
                corporateContactUrl:
                    nextContacts.corporateContactUrl || fresh.officialContacts?.corporateContactUrl || null,
                corporateEmail: nextContacts.corporateEmail || fresh.officialContacts?.corporateEmail || null,
                corporatePhone: nextContacts.corporatePhone || fresh.officialContacts?.corporatePhone || null,
                officialPartsUrl: nextContacts.officialPartsUrl || fresh.officialContacts?.officialPartsUrl || null,
                officialSupportUrl:
                    nextContacts.officialSupportUrl || fresh.officialContacts?.officialSupportUrl || null,
                dealerLocatorUrl: nextContacts.dealerLocatorUrl || fresh.officialContacts?.dealerLocatorUrl || null,
            };
            patch.hasPublicWebFootprint = nextHasWeb;
            patch.logoSvg =
                freshLogoValid ||
                (mergedCandidates[0] ? normalizeCandidateToDescriptor(mergedCandidates[0]) : null);
        }

        await docRef.set(patch, { merge: true });
        registerLearnedManufacturerAliases(patch.officialName || fresh.officialName, patch.aliases || []);

        const finalSnap = await docRef.get();
        return hydrateRecordDefaults(finalSnap.id, finalSnap.data() || {});
    }

    /**
     * Sincronizador Retroactivo Idempotente (`global_asset_catalog` + `tenant_assets` + `equipment_onboarding_requests`).
     * Consolida cada marca única UNA ÚNICA VEZ, actualiza conteo/modelos reales y repara registros incompletos o
     * contaminados (ej. `"cat"` / `Top Cat`).
     */
    public static async syncManufacturersFromExistingEquipment(opts?: {
        actorUid?: string;
        runAi?: boolean;
        forceRefreshBroken?: boolean;
    }): Promise<{
        syncedCount: number;
        enrichedKeys: string[];
        manufacturers: ManufacturerRecord[];
    }> {
        await hydrateDynamicManufacturerIndex(true).catch(() => 0);

        const [catalogSnap, fleetSnap, onboardingSnap, existingMfrsSnap] = await Promise.all([
            db.collection('global_asset_catalog').get(),
            db.collection('tenant_assets').get(),
            db.collection('equipment_onboarding_requests').get(),
            db.collection(MANUFACTURERS_COL).get(),
        ]);

        interface BrandAccumulator {
            rawMake: string;
            catalogIds: Set<string>;
            unlinkedFleetIds: Set<string>;
            pendingOnboardingIds: Set<string>;
            models: string[];
            archetypes: Set<ManufacturerMachineryArchetypeId>;
            aliases: string[];
        }

        const grouped = new Map<string, BrandAccumulator>();
        const catalogIdsInBase = new Set<string>();

        const ensureBucket = (rawMake: string): BrandAccumulator | null => {
            const key = normalizeManufacturerKey(rawMake);
            if (!key) return null;
            let bucket = grouped.get(key);
            if (!bucket) {
                bucket = {
                    rawMake: rawMake.trim(),
                    catalogIds: new Set<string>(),
                    unlinkedFleetIds: new Set<string>(),
                    pendingOnboardingIds: new Set<string>(),
                    models: [],
                    archetypes: new Set<ManufacturerMachineryArchetypeId>(),
                    aliases: [],
                };
                grouped.set(key, bucket);
            }
            bucket.aliases.push(rawMake.trim());
            return bucket;
        };

        for (const doc of catalogSnap.docs) {
            const d = doc.data() || {};
            if (d.is_generic === true) continue;
            catalogIdsInBase.add(doc.id);
            const rawMake = String(d.make_oficial || d.make || '').trim();
            const bucket = ensureBucket(rawMake);
            if (!bucket) continue;
            bucket.catalogIds.add(doc.id);
            const model = String(d.model_oficial || d.model || '').trim();
            if (model) bucket.models.push(model);
            const arch = resolveValidArchetypeId(d.archetype_id, d.tipo_equipo, d.categoria_equipo);
            if (arch) bucket.archetypes.add(arch);
        }

        for (const doc of fleetSnap.docs) {
            const d = doc.data() || {};
            if (d.archived === true || d.is_edu_sandbox === true) continue;
            const globalId = String(d.global_asset_id || '').trim();
            const rawMake = String(d.make_oficial || d.make || '').trim();
            const bucket = ensureBucket(rawMake);
            if (!bucket) continue;
            if (!globalId || !catalogIdsInBase.has(globalId)) {
                bucket.unlinkedFleetIds.add(doc.id);
            }
            const model = String(d.model_oficial || d.model || '').trim();
            if (model) bucket.models.push(model);
            const arch = resolveValidArchetypeId(d.archetype_id, d.tipo_equipo, d.categoria_equipo);
            if (arch) bucket.archetypes.add(arch);
        }

        for (const doc of onboardingSnap.docs) {
            const d = doc.data() || {};
            if (d.status === 'REJECTED' || d.status === 'PUBLISHED') continue;
            const rawMake = String(d.manufacturerRef || d.make || '').trim();
            const bucket = ensureBucket(rawMake);
            if (!bucket) continue;
            bucket.pendingOnboardingIds.add(doc.id);
            const model = String(d.modelRef || d.model || '').trim();
            if (model) bucket.models.push(model);
            const arch = resolveValidArchetypeId(
                null,
                d.equipmentType || d.equipmentCategory,
                d.equipmentCategory || null
            );
            if (arch) bucket.archetypes.add(arch);
        }

        const existingMap = new Map<string, ManufacturerRecord>();
        for (const doc of existingMfrsSnap.docs) {
            existingMap.set(doc.id, hydrateRecordDefaults(doc.id, doc.data() || {}));
        }

        const keysToEnrich: string[] = [];
        const nowMs = Date.now();

        for (const [key, bucket] of grouped.entries()) {
            const existing = existingMap.get(key);
            const totalCount =
                bucket.catalogIds.size + bucket.unlinkedFleetIds.size + bucket.pendingOnboardingIds.size;
            const canonicalName = formatInitialOfficialBrandName(bucket.rawMake);
            const mergedModels = mergeLimitedUniqueStrings(existing?.sampleModels, bucket.models, 12);
            const mergedArchetypes = Array.from(
                new Set<ManufacturerMachineryArchetypeId>([
                    ...(existing?.observedArchetypeIds || []),
                    ...Array.from(bucket.archetypes),
                ])
            );
            const mergedAliases = mergeLimitedUniqueStrings(existing?.aliases, [...bucket.aliases, canonicalName], 24);

            const docRef = db.collection(MANUFACTURERS_COL).doc(key);

            if (!existing) {
                const stub: ManufacturerRecord = {
                    manufacturerKey: key,
                    officialName: canonicalName,
                    legalCorporateName: null,
                    aliases: mergedAliases,
                    hqCountryIso2: null,
                    hqCity: null,
                    officialWebsiteUrl: null,
                    officialContacts: { ...EMPTY_MANUFACTURER_OFFICIAL_CONTACTS },
                    observedArchetypeIds: mergedArchetypes,
                    sampleModels: mergedModels,
                    logoSvg: null,
                    logoCandidates: [],
                    curationStatus: 'AUTO_DISCOVERED',
                    hasPublicWebFootprint: true,
                    equipmentCount: totalCount,
                    linkedSuppliersCount: 0,
                    createdAt: nowMs,
                    updatedAt: nowMs,
                    verifiedByUid: null,
                };
                await docRef.set(stub);
                registerLearnedManufacturerAliases(stub.officialName, stub.aliases);
                keysToEnrich.push(key);
            } else {
                const sanitizedCandidates = (existing.logoCandidates || []).filter(
                    (c) => !c.sourceUrl || !isBlockedNonIndustrialLogoRef(c.sourceUrl)
                );
                const badActiveLogo =
                    existing.logoSvg?.sourceUrl && isBlockedNonIndustrialLogoRef(existing.logoSvg.sourceUrl);
                const nextLogoSvg = badActiveLogo
                    ? sanitizedCandidates[0]
                        ? normalizeCandidateToDescriptor(sanitizedCandidates[0])
                        : null
                    : existing.logoSvg;

                const repairedName =
                    existing.curationStatus !== 'VERIFIED' &&
                    existing.officialName === existing.officialName.toLowerCase()
                        ? canonicalName
                        : existing.officialName;

                const repairedCountry =
                    existing.curationStatus !== 'VERIFIED' && !existing.officialWebsiteUrl
                        ? null
                        : existing.hqCountryIso2;

                await docRef.set(
                    {
                        officialName: repairedName,
                        hqCountryIso2: repairedCountry,
                        aliases: mergedAliases,
                        sampleModels: mergedModels,
                        observedArchetypeIds: mergedArchetypes,
                        equipmentCount: totalCount,
                        logoCandidates: sanitizedCandidates,
                        logoSvg: nextLogoSvg,
                        updatedAt: nowMs,
                    },
                    { merge: true }
                );
                registerLearnedManufacturerAliases(repairedName, mergedAliases);

                if (
                    isBrokenOrIncompleteManufacturer({
                        ...existing,
                        officialName: repairedName,
                        hqCountryIso2: repairedCountry,
                        logoCandidates: sanitizedCandidates,
                        logoSvg: nextLogoSvg,
                    }) ||
                    (opts?.forceRefreshBroken && existing.curationStatus !== 'VERIFIED' && !existing.logoSvg)
                ) {
                    keysToEnrich.push(key);
                }
            }
        }

        const enrichedKeys: string[] = [];
        if (opts?.runAi !== false) {
            for (const key of keysToEnrich) {
                try {
                    await this.autoPopulateManufacturerWithAi({
                        manufacturerKey: key,
                        actorUid: opts?.actorUid || 'system-retroactive-sync',
                    });
                    enrichedKeys.push(key);
                } catch {
                    // Continuar con la siguiente marca
                }
            }
        }

        const finalSnap = await db.collection(MANUFACTURERS_COL).get();
        const manufacturers = finalSnap.docs
            .map((d) => hydrateRecordDefaults(d.id, d.data() || {}))
            .sort((a, b) => a.officialName.localeCompare(b.officialName, 'es'));

        return {
            syncedCount: grouped.size,
            enrichedKeys,
            manufacturers,
        };
    }

    public static async createDirectManufacturer(params: {
        actorUid: string;
        actorEmail: string;
        isDevRoot: boolean;
        isEduSandbox: boolean;
        body: DirectCreateManufacturerBody;
    }): Promise<ManufacturerRecord> {
        if (params.isEduSandbox || !params.isDevRoot) {
            const err: any = new Error('Alta directa de fabricantes reservada exclusivamente a 1º DEV.');
            err.statusCode = 403;
            throw err;
        }

        const key = normalizeManufacturerKey(params.body.rawMake);
        if (!key) {
            const err: any = new Error('El nombre del fabricante no puede ser genérico ni vacío.');
            err.statusCode = 400;
            throw err;
        }

        const docRef = db.collection(MANUFACTURERS_COL).doc(key);
        const existingSnap = await docRef.get();
        if (existingSnap.exists) {
            return hydrateRecordDefaults(existingSnap.id, existingSnap.data() || {});
        }

        const nowMs = Date.now();
        const safeWebsite = await filterSafeHttpsUrl(params.body.officialWebsiteUrl);
        const officialName = formatInitialOfficialBrandName(params.body.rawMake);

        const created: ManufacturerRecord = {
            manufacturerKey: key,
            officialName,
            legalCorporateName: params.body.legalCorporateName?.trim() || null,
            aliases: mergeLimitedUniqueStrings([params.body.rawMake.trim(), officialName], [], 24),
            hqCountryIso2: params.body.hqCountryIso2 || null,
            hqCity: params.body.hqCity?.trim() || null,
            officialWebsiteUrl: safeWebsite,
            officialContacts: { ...EMPTY_MANUFACTURER_OFFICIAL_CONTACTS },
            observedArchetypeIds: [],
            sampleModels: [],
            logoSvg: null,
            logoCandidates: [],
            curationStatus: safeWebsite ? 'VERIFIED' : 'AUTO_DISCOVERED',
            hasPublicWebFootprint: params.body.hasPublicWebFootprint,
            equipmentCount: 0,
            linkedSuppliersCount: 0,
            createdAt: nowMs,
            updatedAt: nowMs,
            verifiedByUid: safeWebsite ? params.actorUid : null,
        };

        await docRef.set(created);
        registerLearnedManufacturerAliases(created.officialName, created.aliases);

        await AuditLedger.record({
            tenantId: 'global',
            actorUid: params.actorUid,
            actorEmail: params.actorEmail,
            action: 'OPERMAQ_MANUFACTURER_CREATED_DIRECT',
            module: 'opermaq',
            targetEntity: key,
            details: { officialName: created.officialName },
        }).catch(() => {});

        if (params.body.runAiDiscovery && params.body.hasPublicWebFootprint) {
            void this.autoPopulateManufacturerWithAi({ manufacturerKey: key, actorUid: params.actorUid }).catch(() => {});
        }

        return created;
    }

    public static async appendManualLogoCandidate(params: {
        manufacturerKey: string;
        fileBuffer: Buffer;
        filename: string;
        actorUid: string;
    }): Promise<{ manufacturer: ManufacturerRecord; candidate: ManufacturerLogoCandidate }> {
        const cleanKey = normalizeSlug(params.manufacturerKey);
        const docRef = db.collection(MANUFACTURERS_COL).doc(cleanKey);
        const snap = await docRef.get();
        if (!snap.exists) {
            const err: any = new Error('Fabricante no encontrado.');
            err.statusCode = 404;
            throw err;
        }
        const current = hydrateRecordDefaults(snap.id, snap.data() || {});

        const candidate = await ManufacturerLogoHunterService.ingestLogoBufferToCas(params.fileBuffer, {
            filename: params.filename,
            actorUid: params.actorUid,
            sourceKind: 'MANUAL_UPLOAD',
        });

        const nextCandidates = ManufacturerLogoHunterService.deduplicateCandidates(
            [candidate],
            current.logoCandidates || []
        );

        await docRef.set(
            {
                logoCandidates: nextCandidates,
                logoSvg: current.logoSvg || normalizeCandidateToDescriptor(candidate),
                updatedAt: Date.now(),
            },
            { merge: true }
        );

        const updatedSnap = await docRef.get();
        return {
            manufacturer: hydrateRecordDefaults(updatedSnap.id, updatedSnap.data() || {}),
            candidate,
        };
    }

    public static async updateManufacturerHitl(params: {
        manufacturerKey: string;
        actorUid: string;
        actorEmail: string;
        body: UpdateManufacturerHitlBody;
    }): Promise<ManufacturerRecord> {
        const cleanKey = normalizeSlug(params.manufacturerKey);
        const docRef = db.collection(MANUFACTURERS_COL).doc(cleanKey);
        const snap = await docRef.get();
        if (!snap.exists) {
            const err: any = new Error('Fabricante no encontrado.');
            err.statusCode = 404;
            throw err;
        }

        const current = hydrateRecordDefaults(snap.id, snap.data() || {});
        const candidates = current.logoCandidates || [];
        let nextLogo = current.logoSvg || null;

        if (params.body.selectedLogoCandidateId) {
            const chosen = candidates.find((c) => c.candidateId === params.body.selectedLogoCandidateId);
            if (chosen) {
                nextLogo = normalizeCandidateToDescriptor(chosen, params.body.invertInDark);
            }
        } else if (nextLogo && typeof params.body.invertInDark === 'boolean') {
            nextLogo = { ...nextLogo, invertInDark: params.body.invertInDark };
        }

        const nextOfficialName = params.body.officialName?.trim() || current.officialName;
        const nextAliases = mergeLimitedUniqueStrings(
            params.body.aliases ?? current.aliases,
            [nextOfficialName],
            24
        );

        const nextWebsite =
            params.body.officialWebsiteUrl !== undefined
                ? await filterSafeHttpsUrl(params.body.officialWebsiteUrl)
                : current.officialWebsiteUrl ?? null;

        const incomingContacts = params.body.officialContacts;
        let nextContacts: ManufacturerOfficialContacts = { ...current.officialContacts };
        if (incomingContacts) {
            const [safeContact, safeParts, safeSupport, safeLocator] = await Promise.all([
                incomingContacts.corporateContactUrl !== undefined
                    ? filterSafeHttpsUrl(incomingContacts.corporateContactUrl)
                    : Promise.resolve(nextContacts.corporateContactUrl),
                incomingContacts.officialPartsUrl !== undefined
                    ? filterSafeHttpsUrl(incomingContacts.officialPartsUrl)
                    : Promise.resolve(nextContacts.officialPartsUrl),
                incomingContacts.officialSupportUrl !== undefined
                    ? filterSafeHttpsUrl(incomingContacts.officialSupportUrl)
                    : Promise.resolve(nextContacts.officialSupportUrl),
                incomingContacts.dealerLocatorUrl !== undefined
                    ? filterSafeHttpsUrl(incomingContacts.dealerLocatorUrl)
                    : Promise.resolve(nextContacts.dealerLocatorUrl),
            ]);

            nextContacts = {
                corporateContactUrl: safeContact,
                corporateEmail:
                    incomingContacts.corporateEmail !== undefined
                        ? sanitizeFunctionalCorporateEmail(incomingContacts.corporateEmail)
                        : nextContacts.corporateEmail,
                corporatePhone:
                    incomingContacts.corporatePhone !== undefined
                        ? incomingContacts.corporatePhone?.trim() || null
                        : nextContacts.corporatePhone,
                officialPartsUrl: safeParts,
                officialSupportUrl: safeSupport,
                dealerLocatorUrl: safeLocator,
            };
        }

        const updated: ManufacturerRecord = {
            ...current,
            officialName: nextOfficialName,
            legalCorporateName:
                params.body.legalCorporateName !== undefined
                    ? params.body.legalCorporateName?.trim() || null
                    : current.legalCorporateName ?? null,
            hqCountryIso2:
                params.body.hqCountryIso2 !== undefined ? params.body.hqCountryIso2 : current.hqCountryIso2 ?? null,
            hqCity: params.body.hqCity !== undefined ? params.body.hqCity?.trim() || null : current.hqCity ?? null,
            officialWebsiteUrl: nextWebsite,
            officialContacts: nextContacts,
            aliases: nextAliases,
            hasPublicWebFootprint:
                typeof params.body.hasPublicWebFootprint === 'boolean'
                    ? params.body.hasPublicWebFootprint
                    : current.hasPublicWebFootprint,
            logoSvg: nextLogo,
            logoCandidates: candidates,
            curationStatus: 'VERIFIED',
            verifiedByUid: params.actorUid,
            updatedAt: Date.now(),
        };

        await docRef.set(updated, { merge: true });
        registerLearnedManufacturerAliases(updated.officialName, updated.aliases);

        await AuditLedger.record({
            tenantId: 'global',
            actorUid: params.actorUid,
            actorEmail: params.actorEmail,
            action: 'OPERMAQ_MANUFACTURER_HITL_UPDATED',
            module: 'opermaq',
            targetEntity: cleanKey,
            details: {
                officialName: updated.officialName,
                logoSha256: updated.logoSvg?.sha256 || null,
                savingsPct: updated.logoSvg?.savingsPct ?? null,
            },
        }).catch(() => {});

        return updated;
    }
}
