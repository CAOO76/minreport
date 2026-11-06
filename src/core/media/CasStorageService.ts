import { FieldValue } from 'firebase-admin/firestore';
import { db, storage } from '../../config/firebase';
import type {
    CasStorageScope,
    DigestedMediaDescriptor,
    MediaDigestionProfile,
} from '../../contracts/media.contracts';
import { MediaDigestorServer, type DigestedBinaryOutput } from './MediaDigestorServer';

/**
 * CAS STORAGE SERVICE v4.0 — Almacenamiento Direccionado por Contenido (SHA-256 + pHash 64-bit)
 *
 * Garantías de Economía y Seguridad:
 * 1. Cada archivo optimizado se guarda UNA SOLA VEZ en Cloud Storage (`southamerica-west1` / Emulador `:9195`):
 *    - `cas_blobs/global_oem/{sha256}.{ext}` (Conocimiento común OEM sanitizado)
 *    - `assets/symbology/cas/{sha256}.{ext}` (Simbología vectorial e ISO universal)
 *    - `cas_blobs/tenants/{tenantId}/{sha256}.{ext}` (Evidencia privada aislada por tenant)
 * 2. Deduplicación en 2 niveles:
 *    - Nivel Exacto: `media_registry/{sha256}` O(1) — si ya existe, incrementa `refCount` y evita re-escritura.
 *    - Nivel Perceptual: `phashHex` (`dHash` 64-bit, distancia de Hamming <= 5) dentro del mismo ámbito (`GLOBAL_OEM` o mismo `tenantId`).
 * 3. Directivas Edge Capa 1: `Cache-Control: public, max-age=31536000, immutable` en activos globales.
 */

export interface PersistDigestedOptions {
    scope: CasStorageScope;
    tenantId?: string;
    actorUid?: string;
    originalFilename?: string;
    nearDuplicateHammingThreshold?: number;
}

export class CasStorageService {
    private static readonly REGISTRY_COLLECTION = 'media_registry';

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
        const safeTenant = tenantId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
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
        const docSnap = await db.collection(this.REGISTRY_COLLECTION).doc(cleanHash).get();
        if (!docSnap.exists) return null;

        const data = docSnap.data()!;
        // Control de aislamiento multi-tenant en registros privados
        if (data.scope === 'TENANT_PRIVATE' && scope === 'TENANT_PRIVATE') {
            if (data.tenantId && tenantId && data.tenantId !== tenantId) {
                return null;
            }
        } else if (data.scope === 'TENANT_PRIVATE' && scope === 'GLOBAL_OEM') {
            return null;
        }

        return {
            sha256: cleanHash,
            phashHex: data.phashHex,
            scope: data.scope,
            tenantId: data.tenantId,
            profile: data.profile || 'IMAGE_FIELD_EVIDENCE',
            mimeType: data.mimeType || 'application/octet-stream',
            extension: data.extension || 'bin',
            originalFilename: data.originalFilename,
            originalBytes: Number(data.originalBytes || data.optimizedBytes || 0),
            optimizedBytes: Number(data.optimizedBytes || 0),
            savingsRatio: Number(data.savingsRatio || 0),
            width: data.width,
            height: data.height,
            pageCount: data.pageCount,
            resampledPages: data.resampledPages,
            preservedVectorPages: data.preservedVectorPages,
            durationSec: data.durationSec,
            storagePath: data.storagePath,
            downloadUrl: data.downloadUrl,
            deduplicatedHit: true,
            createdAt: data.createdAt || new Date().toISOString(),
        };
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
        if (!phashHex || phashHex.length !== 16) return null;

        try {
            // Prefijo de 4 hex chars (16 bits superiores) o escaneo acotado por scope
            let query: FirebaseFirestore.Query = db
                .collection(this.REGISTRY_COLLECTION)
                .where('scope', '==', scope);

            if (scope === 'TENANT_PRIVATE' && tenantId) {
                query = query.where('tenantId', '==', tenantId);
            }

            const snap = await query.limit(150).get();
            for (const docSnap of snap.docs) {
                const d = docSnap.data();
                if (!d.phashHex) continue;
                const dist = MediaDigestorServer.hammingDistanceHex64(phashHex, d.phashHex);
                if (dist <= maxHamming) {
                    return {
                        sha256: docSnap.id,
                        phashHex: d.phashHex,
                        scope: d.scope,
                        tenantId: d.tenantId,
                        profile: d.profile || 'IMAGE_TECHNICAL_HD',
                        mimeType: d.mimeType || 'image/webp',
                        extension: d.extension || 'webp',
                        originalFilename: d.originalFilename,
                        originalBytes: Number(d.originalBytes || 0),
                        optimizedBytes: Number(d.optimizedBytes || 0),
                        savingsRatio: Number(d.savingsRatio || 0),
                        width: d.width,
                        height: d.height,
                        storagePath: d.storagePath,
                        downloadUrl: d.downloadUrl,
                        deduplicatedHit: true,
                        nearDuplicateOf: docSnap.id,
                        createdAt: d.createdAt || new Date().toISOString(),
                    };
                }
            }
        } catch {
            // Si falta índice compuesto en emulador, no bloquear escritura
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
        // 1. Verificar hit exacto SHA-256
        const exactHit = await this.preflightCheck(digested.sha256, options.scope, options.tenantId);
        if (exactHit) {
            await db
                .collection(this.REGISTRY_COLLECTION)
                .doc(digested.sha256)
                .set(
                    {
                        refCount: FieldValue.increment(1),
                        lastReferencedAt: new Date().toISOString(),
                    },
                    { merge: true }
                )
                .catch(() => {});
            return exactHit;
        }

        // 2. Verificar cuasi-duplicado perceptual en imágenes OEM / Simbología
        if (
            digested.phashHex &&
            (options.scope === 'GLOBAL_OEM' || options.scope === 'SYMBOLOGY_MASTER')
        ) {
            const nearHit = await this.findNearDuplicateByPhash(
                digested.phashHex,
                options.scope,
                options.tenantId,
                options.nearDuplicateHammingThreshold ?? 3
            );
            if (nearHit) {
                return nearHit;
            }
        }

        const storagePath = this.buildStoragePath(
            options.scope,
            digested.sha256,
            digested.extension,
            options.tenantId
        );
        const downloadUrl = this.buildGatewayUrl(
            options.scope,
            digested.sha256,
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
                    sha256: digested.sha256,
                    phashHex: digested.phashHex || '',
                    profile: digested.profile,
                    scope: options.scope,
                    tenantId: options.tenantId || '',
                },
            },
        });

        const nowIso = new Date().toISOString();
        const registryDoc: Record<string, any> = {
            sha256: digested.sha256,
            phashHex: digested.phashHex || null,
            scope: options.scope,
            tenantId: options.scope === 'TENANT_PRIVATE' ? (options.tenantId || '').trim() : null,
            tenant_id: options.scope === 'TENANT_PRIVATE' ? (options.tenantId || '').trim() : null,
            profile: digested.profile,
            mimeType: digested.mimeType,
            extension: digested.extension,
            originalFilename: (options.originalFilename || '').slice(0, 240),
            originalBytes: digested.originalBytes,
            optimizedBytes: digested.optimizedBytes,
            savingsRatio: digested.savingsRatio,
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

        await db.collection(this.REGISTRY_COLLECTION).doc(digested.sha256).set(registryDoc, { merge: true });

        return {
            sha256: digested.sha256,
            phashHex: digested.phashHex,
            scope: options.scope,
            tenantId: options.tenantId,
            profile: digested.profile,
            mimeType: digested.mimeType,
            extension: digested.extension,
            originalFilename: options.originalFilename,
            originalBytes: digested.originalBytes,
            optimizedBytes: digested.optimizedBytes,
            savingsRatio: digested.savingsRatio,
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

    /**
     * Lee los bytes de un blob CAS desde Cloud Storage para entrega HTTP inmutable
     */
    public static async readCasBlob(storagePath: string): Promise<{
        buffer: Buffer;
        contentType: string;
        cacheControl: string;
    } | null> {
        try {
            const file = storage.bucket().file(storagePath);
            const [exists] = await file.exists();
            if (!exists) return null;

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

