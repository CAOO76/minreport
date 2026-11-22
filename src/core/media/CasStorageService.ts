import { FieldValue } from 'firebase-admin/firestore';
import { db, storage } from '../../config/firebase';
import type {
    CasStorageScope,
    DigestedMediaDescriptor,
    MediaDigestionProfile,
} from '../../contracts/media.contracts';
import { MediaDigestorServer, type DigestedBinaryOutput } from './MediaDigestorServer';
import { TenantMetricsService } from '../../services/tenant-metrics.service';

/**
 * CAS STORAGE SERVICE v4.1 — Almacenamiento Direccionado por Contenido Multi-Tenant (SHA-256 + pHash 64-bit)
 *
 * Garantías de Economía y Seguridad:
 * 1. Cada archivo optimizado se guarda UNA SOLA VEZ en Cloud Storage (`southamerica-west1` / Emulador `:9195`):
 *    - `cas_blobs/global_oem/{sha256}.{ext}` (Conocimiento común OEM sanitizado)
 *    - `assets/symbology/cas/{sha256}.{ext}` (Simbología vectorial e ISO universal)
 *    - `cas_blobs/tenants/{tenantId}/{sha256}.{ext}` (Evidencia privada aislada por tenant)
 * 2. Aislamiento determinista en `media_registry`:
 *    - `buildMediaRegistryDocId(sha256, scope, tenantId)` genera `tenant_${tenantId}_${sha256}` para `TENANT_PRIVATE`
 *      y `${scope.toLowerCase()}_${sha256}` para ámbitos globales (`GLOBAL_OEM`, `SYMBOLOGY_MASTER`, `GLOBAL_CATALOG`, etc.).
 *    - Fallback de solo lectura a `.doc(sha256)` para retrocompatibilidad 100% con activos preexistentes.
 * 3. Streaming directo (`openCasBlobStream`) con 1 sola llamada `getMetadata()` sin cargar binarios pesados en RAM.
 */

export function buildMediaRegistryDocId(
    sha256: string,
    scope: CasStorageScope | string,
    tenantId?: string | null
): string {
    const cleanHash = String(sha256 || '').trim().toLowerCase();
    const normalizedScope = String(scope || 'GLOBAL_OEM').trim().toUpperCase();

    if (normalizedScope === 'TENANT_PRIVATE') {
        const safeTenant = String(tenantId || '')
            .trim()
            .replace(/[^a-zA-Z0-9_-]/g, '_');
        if (!safeTenant) {
            throw new Error('tenantId es obligatorio para media_registry con scope TENANT_PRIVATE.');
        }
        return `tenant_${safeTenant}_${cleanHash}`;
    }

    const safeScope = normalizedScope.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return `${safeScope}_${cleanHash}`;
}

export interface PersistDigestedOptions {
    scope: CasStorageScope;
    tenantId?: string;
    actorUid?: string;
    originalFilename?: string;
    clientOriginalBytes?: number;
    nearDuplicateHammingThreshold?: number;
    enablePerceptualDedup?: boolean;
}

export interface CasBlobStreamHandle {
    stream: NodeJS.ReadableStream;
    contentType: string;
    cacheControl?: string;
    contentLength?: number;
    etag?: string;
    storagePath: string;
}

export class CasStorageService {
    private static readonly REGISTRY_COLLECTION = 'media_registry';

    public static readonly buildMediaRegistryDocId = buildMediaRegistryDocId;

    private static mapRegistryDataToDescriptor(
        fallbackSha256: string,
        data: Record<string, any>,
        deduplicatedHit: boolean,
        nearDuplicateOf?: string
    ): DigestedMediaDescriptor {
        const resolvedSha = String(data.sha256 || fallbackSha256).trim().toLowerCase();
        return {
            sha256: resolvedSha,
            phashHex: data.phashHex || undefined,
            scope: data.scope,
            tenantId: data.tenantId || undefined,
            profile: data.profile || 'IMAGE_FIELD_EVIDENCE',
            mimeType: data.mimeType || 'application/octet-stream',
            extension: data.extension || 'bin',
            originalFilename: data.originalFilename,
            originalBytes: Number(data.originalBytes || data.optimizedBytes || 0),
            optimizedBytes: Number(data.optimizedBytes || 0),
            savingsRatio: Number(data.savingsRatio || 0),
            savingsPct:
                typeof data.savingsPct === 'number'
                    ? Number(data.savingsPct)
                    : Number((Number(data.savingsRatio || 0) * 100).toFixed(1)),
            width: data.width || undefined,
            height: data.height || undefined,
            pageCount: data.pageCount || undefined,
            resampledPages: data.resampledPages ?? undefined,
            preservedVectorPages: data.preservedVectorPages ?? undefined,
            durationSec: data.durationSec ?? undefined,
            storagePath: data.storagePath,
            downloadUrl: data.downloadUrl,
            deduplicatedHit,
            nearDuplicateOf,
            createdAt: data.createdAt || new Date().toISOString(),
        };
    }

    private static isLegacyDocAllowedForScope(
        data: Record<string, any>,
        requestedScope: CasStorageScope | string,
        requestedTenantId?: string,
        allowCrossTenantAudit: boolean = false
    ): boolean {
        const normalizedRequestedScope = String(requestedScope || '').trim().toUpperCase();
        const docScope = String(data.scope || '').trim().toUpperCase();

        if (docScope === 'TENANT_PRIVATE') {
            if (normalizedRequestedScope !== 'TENANT_PRIVATE') return false;
            if (allowCrossTenantAudit) return true;
            const cleanReqTenant = String(requestedTenantId || '').trim();
            const cleanDocTenant = String(data.tenantId || data.tenant_id || '').trim();
            return Boolean(cleanReqTenant && cleanDocTenant && cleanReqTenant === cleanDocTenant);
        }

        if (normalizedRequestedScope === 'TENANT_PRIVATE') {
            return false;
        }

        return !docScope || docScope === normalizedRequestedScope;
    }

    private static async lookupRegistryDocWithFallback(
        cleanHash: string,
        scope: CasStorageScope | string,
        tenantId?: string,
        allowCrossTenantAudit: boolean = false
    ): Promise<{ docId: string; data: Record<string, any>; isLegacyFallback: boolean } | null> {
        const normalizedScope = String(scope || 'GLOBAL_OEM').trim().toUpperCase();
        if (normalizedScope === 'TENANT_PRIVATE' && (!tenantId || !tenantId.trim())) {
            if (!allowCrossTenantAudit) {
                return null;
            }
        } else {
            const compositeDocId = buildMediaRegistryDocId(cleanHash, normalizedScope, tenantId);
            const compositeSnap = await db.collection(this.REGISTRY_COLLECTION).doc(compositeDocId).get();
            if (compositeSnap.exists) {
                const data = compositeSnap.data()!;
                if (
                    normalizedScope === 'TENANT_PRIVATE' &&
                    !allowCrossTenantAudit &&
                    data.tenantId &&
                    tenantId &&
                    String(data.tenantId).trim() !== tenantId.trim()
                ) {
                    return null;
                }
                return { docId: compositeDocId, data, isLegacyFallback: false };
            }
        }

        // Fallback de solo lectura a `.doc(sha256)` para retrocompatibilidad con activos previos de OPERMAQ
        const legacySnap = await db.collection(this.REGISTRY_COLLECTION).doc(cleanHash).get();
        if (!legacySnap.exists) return null;

        const legacyData = legacySnap.data()!;
        if (!this.isLegacyDocAllowedForScope(legacyData, normalizedScope, tenantId, allowCrossTenantAudit)) {
            return null;
        }

        return { docId: cleanHash, data: legacyData, isLegacyFallback: true };
    }

    public static sanitizeTenantIdForPath(tenantId: string): string {
        return String(tenantId || '')
            .trim()
            .replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    public static normalizeAndValidateStoragePath(rawPath: string): string | null {
        const trimmed = String(rawPath || '').trim();
        if (!trimmed) return null;
        if (
            trimmed.includes('\0') ||
            trimmed.includes('\\') ||
            trimmed.startsWith('/') ||
            trimmed.includes('..') ||
            /[\r\n]/.test(trimmed) ||
            /%(2e|2f|5c|00)/i.test(trimmed)
        ) {
            return null;
        }
        const segments = trimmed.split('/');
        if (segments.some((seg) => seg.length === 0 || seg === '.' || seg === '..')) {
            return null;
        }
        return segments.join('/');
    }

    public static isTenantPrivateStoragePath(storagePath: string, tenantId: string): boolean {
        const cleanPath = this.normalizeAndValidateStoragePath(storagePath);
        if (!cleanPath) return false;
        const safeTenant = this.sanitizeTenantIdForPath(tenantId);
        if (!safeTenant) return false;
        return cleanPath.startsWith(`cas_blobs/tenants/${safeTenant}/`);
    }

    private static isAllowedPathForOptions(
        cleanPath: string,
        options?: {
            scope?: CasStorageScope | string;
            tenantId?: string;
            allowCrossTenantAudit?: boolean;
        }
    ): boolean {
        const normalizedScope = options?.scope ? String(options.scope).trim().toUpperCase() : '';
        const allowAudit = Boolean(options?.allowCrossTenantAudit);
        const rawTenant = options?.tenantId?.trim() || '';
        const safeTenant = rawTenant ? this.sanitizeTenantIdForPath(rawTenant) : '';

        if (normalizedScope === 'TENANT_PRIVATE' || rawTenant) {
            if (allowAudit) {
                return cleanPath.startsWith('cas_blobs/tenants/');
            }
            if (!safeTenant) {
                return false;
            }
            return cleanPath.startsWith(`cas_blobs/tenants/${safeTenant}/`);
        }

        if (cleanPath.startsWith('cas_blobs/tenants/')) {
            return allowAudit;
        }

        if (normalizedScope === 'GLOBAL_OEM') {
            return cleanPath.startsWith('cas_blobs/global_oem/');
        }
        if (normalizedScope === 'PUBLIC_SYMBOLOGY') {
            return cleanPath.startsWith('cas_blobs/symbology/');
        }
        if (normalizedScope === 'SYMBOLOGY_MASTER') {
            return (
                cleanPath.startsWith('assets/symbology/') ||
                cleanPath.startsWith('cas_blobs/symbology/')
            );
        }

        return true;
    }

    public static buildStoragePath(
        scope: CasStorageScope,
        sha256: string,
        extension: string,
        tenantId?: string
    ): string {
        const cleanExt = extension.replace(/^\.+/, '').toLowerCase() || 'bin';
        if (scope === 'SYMBOLOGY_MASTER') {
            return `assets/symbology/cas/${sha256}.${cleanExt}`;
        }
        if (scope === 'GLOBAL_OEM') {
            return `cas_blobs/global_oem/${sha256}.${cleanExt}`;
        }
        if (!tenantId || !tenantId.trim()) {
            throw new Error('tenantId es obligatorio para blobs TENANT_PRIVATE en CAS.');
        }
        const safeTenant = this.sanitizeTenantIdForPath(tenantId);
        return `cas_blobs/tenants/${safeTenant}/${sha256}.${cleanExt}`;
    }

    public static buildGatewayUrl(
        scope: CasStorageScope,
        sha256: string,
        extension: string,
        tenantId?: string
    ): string {
        const cleanExt = extension.replace(/^\.+/, '').toLowerCase() || 'bin';
        if (scope === 'SYMBOLOGY_MASTER') {
            return `/api/media/blob/symbology/${sha256}.${cleanExt}`;
        }
        if (scope === 'GLOBAL_OEM') {
            return `/api/media/blob/global_oem/${sha256}.${cleanExt}`;
        }
        if (!tenantId || !tenantId.trim()) {
            throw new Error('tenantId es obligatorio para URLs TENANT_PRIVATE en CAS.');
        }
        const safeTenant = encodeURIComponent(tenantId.trim());
        return `/api/media/blob/tenant/${safeTenant}/${sha256}.${cleanExt}`;
    }

    /**
     * Consulta rápida de pre-vuelo (`0 bytes` subidos si el SHA-256 ya está en CAS con acceso permitido)
     */
    public static async preflightCheck(
        sha256: string,
        scope: CasStorageScope,
        tenantId?: string
    ): Promise<DigestedMediaDescriptor | null> {
        if (!/^[a-f0-9]{64}$/i.test(sha256)) return null;
        const cleanHash = sha256.toLowerCase();
        const found = await this.lookupRegistryDocWithFallback(cleanHash, scope, tenantId, false);
        if (!found) return null;
        return this.mapRegistryDataToDescriptor(cleanHash, found.data, true);
    }

    /**
     * Resuelve metadatos en `media_registry` por SHA-256 verificando primero ID compuesto multi-tenant/global
     * y aplicando fallback de solo lectura a `.doc(sha256)`.
     */
    public static async resolveRegistryEntryBySha256(
        sha256: string,
        options?: {
            scope?: CasStorageScope | string;
            tenantId?: string;
            allowCrossTenantAudit?: boolean;
        }
    ): Promise<DigestedMediaDescriptor | null> {
        if (!/^[a-f0-9]{64}$/i.test(sha256)) return null;
        const cleanHash = sha256.toLowerCase();
        const allowAudit = Boolean(options?.allowCrossTenantAudit);
        const cleanTenant = options?.tenantId?.trim() || undefined;

        if (options?.scope) {
            const directHit = await this.lookupRegistryDocWithFallback(
                cleanHash,
                options.scope,
                cleanTenant,
                allowAudit
            );
            if (directHit) {
                return this.mapRegistryDataToDescriptor(cleanHash, directHit.data, true);
            }
            if (allowAudit && String(options.scope).toUpperCase() === 'TENANT_PRIVATE') {
                const auditQuery = await db
                    .collection(this.REGISTRY_COLLECTION)
                    .where('sha256', '==', cleanHash)
                    .limit(5)
                    .get();
                const privateDoc = auditQuery.docs.find(
                    (d) => String(d.data()?.scope || '').toUpperCase() === 'TENANT_PRIVATE'
                );
                if (privateDoc) {
                    return this.mapRegistryDataToDescriptor(cleanHash, privateDoc.data(), true);
                }
            }
            return null;
        }

        // Sin scope explícito: 1) tenant activo (si aplica), 2) ámbitos globales, 3) fallback legacy `.doc(sha256)`
        if (cleanTenant) {
            const tenantCompositeId = buildMediaRegistryDocId(cleanHash, 'TENANT_PRIVATE', cleanTenant);
            const tenantSnap = await db.collection(this.REGISTRY_COLLECTION).doc(tenantCompositeId).get();
            if (tenantSnap.exists) {
                return this.mapRegistryDataToDescriptor(cleanHash, tenantSnap.data()!, true);
            }
        }

        for (const globalScope of ['GLOBAL_OEM', 'SYMBOLOGY_MASTER'] as const) {
            const globalCompositeId = buildMediaRegistryDocId(cleanHash, globalScope);
            const globalSnap = await db.collection(this.REGISTRY_COLLECTION).doc(globalCompositeId).get();
            if (globalSnap.exists) {
                return this.mapRegistryDataToDescriptor(cleanHash, globalSnap.data()!, true);
            }
        }

        const legacySnap = await db.collection(this.REGISTRY_COLLECTION).doc(cleanHash).get();
        if (legacySnap.exists) {
            const legacyData = legacySnap.data()!;
            const legacyScope = String(legacyData.scope || '').toUpperCase();
            if (legacyScope === 'TENANT_PRIVATE') {
                const legacyTenant = String(legacyData.tenantId || legacyData.tenant_id || '').trim();
                if (allowAudit || (cleanTenant && legacyTenant && cleanTenant === legacyTenant)) {
                    return this.mapRegistryDataToDescriptor(cleanHash, legacyData, true);
                }
            } else {
                return this.mapRegistryDataToDescriptor(cleanHash, legacyData, true);
            }
        }

        if (allowAudit) {
            const auditSnap = await db
                .collection(this.REGISTRY_COLLECTION)
                .where('sha256', '==', cleanHash)
                .limit(1)
                .get();
            if (!auditSnap.empty) {
                return this.mapRegistryDataToDescriptor(cleanHash, auditSnap.docs[0].data(), true);
            }
        }

        return null;
    }

    /**
     * Busca cuasi-duplicados visuales por `phashHex` (distancia Hamming <= umbral) dentro del mismo ámbito
     */
    public static async findNearDuplicateByPhash(
        phashHex: string,
        scope: CasStorageScope,
        tenantId?: string,
        maxHamming: number = 4
    ): Promise<DigestedMediaDescriptor | null> {
        const normalizedPhash = String(phashHex || '').trim().toLowerCase();
        if (!normalizedPhash || normalizedPhash.length !== 16) return null;

        const cleanTenant = String(tenantId || '').trim();
        // Fail-closed multi-tenant: JAMÁS ejecutar búsqueda perceptual TENANT_PRIVATE sin tenantId explícito
        if (scope === 'TENANT_PRIVATE' && !cleanTenant) {
            return null;
        }
        // Evitar falsos positivos perceptuales en imágenes planas sin gradiente dentro de TENANT_PRIVATE
        if (
            scope === 'TENANT_PRIVATE' &&
            (normalizedPhash === '0000000000000000' || normalizedPhash === 'ffffffffffffffff')
        ) {
            return null;
        }

        try {
            // En TENANT_PRIVATE consultar por `tenantId` (índice simple sin requerir índice compuesto)
            // y verificar frontera de scope+tenantId también en memoria (defensa en profundidad).
            const query: FirebaseFirestore.Query =
                scope === 'TENANT_PRIVATE'
                    ? db.collection(this.REGISTRY_COLLECTION).where('tenantId', '==', cleanTenant)
                    : db.collection(this.REGISTRY_COLLECTION).where('scope', '==', scope);

            const snap = await query.limit(150).get();
            for (const docSnap of snap.docs) {
                const d = docSnap.data() || {};
                const docScope = String(d.scope || '').trim().toUpperCase();
                if (docScope !== scope) continue;
                if (scope === 'TENANT_PRIVATE') {
                    const docTenant = String(d.tenantId || d.tenant_id || '').trim();
                    if (!docTenant || docTenant !== cleanTenant) continue;
                }
                if (!d.phashHex) continue;
                const dist = MediaDigestorServer.hammingDistanceHex64(normalizedPhash, d.phashHex);
                if (dist <= maxHamming) {
                    const realSha = String(d.sha256 || docSnap.id).trim().toLowerCase();
                    await db
                        .collection(this.REGISTRY_COLLECTION)
                        .doc(docSnap.id)
                        .set(
                            {
                                refCount: FieldValue.increment(1),
                                lastReferencedAt: new Date().toISOString(),
                            },
                            { merge: true }
                        )
                        .catch(() => {});
                    return this.mapRegistryDataToDescriptor(realSha, d, true, realSha);
                }
            }
        } catch {
            // Si falta índice en emulador, no bloquear escritura
        }
        return null;
    }

    /**
     * Persiste un binario ya digerido por `MediaDigestorServer` en Cloud Storage CAS + `media_registry`
     */
    public static async persistDigestedBinary(
        digested: DigestedBinaryOutput,
        options: PersistDigestedOptions
    ): Promise<DigestedMediaDescriptor> {
        const cleanHash = digested.sha256.toLowerCase();
        // 1. Verificar hit exacto SHA-256 (ID compuesto primero + fallback de solo lectura a `.doc(sha256)`)
        const existingLookup = await this.lookupRegistryDocWithFallback(
            cleanHash,
            options.scope,
            options.tenantId,
            false
        );
        if (existingLookup) {
            if (!existingLookup.isLegacyFallback) {
                await db
                    .collection(this.REGISTRY_COLLECTION)
                    .doc(existingLookup.docId)
                    .set(
                        {
                            refCount: FieldValue.increment(1),
                            lastReferencedAt: new Date().toISOString(),
                        },
                        { merge: true }
                    )
                    .catch(() => {});
            }
            return this.mapRegistryDataToDescriptor(cleanHash, existingLookup.data, true);
        }

        // 2. Verificar cuasi-duplicado perceptual (`dHash` 64-bit) en OEM/Simbología (<=3) y TENANT_PRIVATE aislado (<=2)
        if (options.enablePerceptualDedup !== false && digested.phashHex) {
            if (options.scope === 'GLOBAL_OEM' || options.scope === 'SYMBOLOGY_MASTER') {
                const nearHit = await this.findNearDuplicateByPhash(
                    digested.phashHex,
                    options.scope,
                    undefined,
                    options.nearDuplicateHammingThreshold ?? 3
                );
                if (nearHit) {
                    return nearHit;
                }
            } else if (options.scope === 'TENANT_PRIVATE' && options.tenantId?.trim()) {
                const nearHit = await this.findNearDuplicateByPhash(
                    digested.phashHex,
                    'TENANT_PRIVATE',
                    options.tenantId.trim(),
                    options.nearDuplicateHammingThreshold ?? 2
                );
                if (nearHit) {
                    return nearHit;
                }
            }
        }

        const storagePath = this.buildStoragePath(
            options.scope,
            cleanHash,
            digested.extension,
            options.tenantId
        );
        const downloadUrl = this.buildGatewayUrl(
            options.scope,
            cleanHash,
            digested.extension,
            options.tenantId
        );

        const isPublicImmutable = options.scope === 'GLOBAL_OEM' || options.scope === 'SYMBOLOGY_MASTER';
        const cacheControl = isPublicImmutable
            ? 'public, max-age=31536000, immutable'
            : 'private, max-age=86400, immutable';

        const bucket = storage.bucket();
        const file = bucket.file(storagePath);
        await file.save(digested.buffer, {
            resumable: false,
            contentType: digested.mimeType,
            metadata: {
                cacheControl,
                metadata: {
                    sha256: cleanHash,
                    phashHex: digested.phashHex || '',
                    profile: digested.profile,
                    scope: options.scope,
                    tenantId: options.tenantId || '',
                },
            },
        });

        const nowIso = new Date().toISOString();
        const trueOriginalBytes = Math.max(
            Number(options.clientOriginalBytes || 0),
            Number(digested.originalBytes || 0),
            Number(digested.optimizedBytes || 0)
        );
        const finalOptimizedBytes = Number(digested.optimizedBytes || 0);
        const trueSavingsRatio =
            trueOriginalBytes > 0
                ? Math.max(
                      0,
                      Number(((trueOriginalBytes - finalOptimizedBytes) / trueOriginalBytes).toFixed(4))
                  )
                : Number(digested.savingsRatio || 0);
        const trueSavingsPct = Number((trueSavingsRatio * 100).toFixed(1));

        const registryDocId = buildMediaRegistryDocId(cleanHash, options.scope, options.tenantId);
        const registryDoc: Record<string, any> = {
            sha256: cleanHash,
            phashHex: digested.phashHex || null,
            scope: options.scope,
            tenantId: options.scope === 'TENANT_PRIVATE' ? (options.tenantId || '').trim() : null,
            tenant_id: options.scope === 'TENANT_PRIVATE' ? (options.tenantId || '').trim() : null,
            profile: digested.profile,
            mimeType: digested.mimeType,
            extension: digested.extension,
            originalFilename: (options.originalFilename || '').slice(0, 240),
            originalBytes: trueOriginalBytes,
            optimizedBytes: finalOptimizedBytes,
            savingsRatio: trueSavingsRatio,
            savingsPct: trueSavingsPct,
            width: digested.width || null,
            height: digested.height || null,
            pageCount: digested.pageCount || null,
            resampledPages: digested.resampledPages ?? null,
            preservedVectorPages: digested.preservedVectorPages ?? null,
            storagePath,
            downloadUrl,
            refCount: 1,
            createdBy: options.actorUid || 'system',
            createdAt: nowIso,
            lastReferencedAt: nowIso,
        };

        await db.collection(this.REGISTRY_COLLECTION).doc(registryDocId).set(registryDoc, { merge: true });

        if (options.tenantId) {
            TenantMetricsService.recordCasDigestion({
                accountId: options.tenantId,
                originalBytes: trueOriginalBytes,
                optimizedBytes: finalOptimizedBytes,
            }).catch(() => {});
        }

        return {
            sha256: cleanHash,
            phashHex: digested.phashHex,
            scope: options.scope,
            tenantId: options.tenantId,
            profile: digested.profile,
            mimeType: digested.mimeType,
            extension: digested.extension,
            originalFilename: options.originalFilename,
            originalBytes: trueOriginalBytes,
            optimizedBytes: finalOptimizedBytes,
            savingsRatio: trueSavingsRatio,
            savingsPct: trueSavingsPct,
            width: digested.width,
            height: digested.height,
            pageCount: digested.pageCount,
            resampledPages: digested.resampledPages,
            preservedVectorPages: digested.preservedVectorPages,
            storagePath,
            downloadUrl,
            deduplicatedHit: false,
            createdAt: nowIso,
        };
    }

    /**
     * Pipeline completo en un paso: Digerir binario crudo + Persistir en CAS con deduplicación
     */
    public static async digestAndStore(
        rawBuffer: Buffer,
        mimeType: string,
        profile: MediaDigestionProfile,
        options: PersistDigestedOptions & { enableSelectiveRaster?: boolean }
    ): Promise<{ descriptor: DigestedMediaDescriptor; digested: DigestedBinaryOutput }> {
        const digested = await MediaDigestorServer.digestAny(rawBuffer, mimeType, profile, {
            enableSelectiveRaster: options.enableSelectiveRaster,
        });
        const descriptor = await this.persistDigestedBinary(digested, options);
        return { descriptor, digested };
    }

    private static async resolveEffectiveStoragePath(
        storagePathOrSha256: string,
        options?: {
            scope?: CasStorageScope | string;
            tenantId?: string;
            allowCrossTenantAudit?: boolean;
        }
    ): Promise<string | null> {
        const trimmed = String(storagePathOrSha256 || '').trim();
        if (!trimmed) return null;

        let candidatePath: string | null = null;
        if (!trimmed.includes('/') && !trimmed.includes('\\') && /^[a-f0-9]{64}$/i.test(trimmed)) {
            const entry = await this.resolveRegistryEntryBySha256(trimmed, options);
            candidatePath = entry?.storagePath || null;
        } else {
            candidatePath = trimmed;
        }

        if (!candidatePath) return null;

        const cleanPath = this.normalizeAndValidateStoragePath(candidatePath);
        if (!cleanPath) return null;

        if (!this.isAllowedPathForOptions(cleanPath, options)) {
            return null;
        }

        return cleanPath;
    }

    /**
     * Abre un stream de lectura directo desde Cloud Storage tras validar existencia/metadatos
     * con 1 sola llamada `getMetadata()`, evitando cargar binarios de hasta 120 MB en RAM.
     */
    public static async openCasBlobStream(
        storagePathOrSha256: string,
        options?: {
            scope?: CasStorageScope | string;
            tenantId?: string;
            allowCrossTenantAudit?: boolean;
        }
    ): Promise<CasBlobStreamHandle | null> {
        try {
            const resolvedPath = await this.resolveEffectiveStoragePath(storagePathOrSha256, options);
            if (!resolvedPath) return null;

            const file = storage.bucket().file(resolvedPath);
            const [metadata] = await file.getMetadata();
            const rawSize = metadata.size !== undefined ? Number(metadata.size) : undefined;
            const contentLength =
                typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize >= 0
                    ? rawSize
                    : undefined;

            const stream = file.createReadStream();
            return {
                stream,
                contentType: metadata.contentType || 'application/octet-stream',
                cacheControl: metadata.cacheControl || undefined,
                contentLength,
                etag: metadata.etag || undefined,
                storagePath: resolvedPath,
            };
        } catch {
            return null;
        }
    }

    /**
     * Lee los bytes de un blob CAS desde Cloud Storage (mantiene compatibilidad 100% con módulos internos)
     */
    public static async readCasBlob(
        storagePathOrSha256: string,
        options?: {
            scope?: CasStorageScope | string;
            tenantId?: string;
            allowCrossTenantAudit?: boolean;
        }
    ): Promise<{
        buffer: Buffer;
        contentType: string;
        cacheControl: string;
    } | null> {
        try {
            const resolvedPath = await this.resolveEffectiveStoragePath(storagePathOrSha256, options);
            if (!resolvedPath) return null;

            const file = storage.bucket().file(resolvedPath);
            const [metadata] = await file.getMetadata();
            const [buffer] = await file.download();

            return {
                buffer,
                contentType: metadata.contentType || 'application/octet-stream',
                cacheControl: metadata.cacheControl || 'public, max-age=31536000, immutable',
            };
        } catch {
            return null;
        }
    }
}


