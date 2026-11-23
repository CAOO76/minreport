import crypto from 'crypto';
import { env, isDevPrivateReleaseStage } from '../../../config/env';
import { db } from '../../../config/firebase';
import { resolveSupplyWhatsAppDevAllowlist } from '../../../config/secrets';
import {
    type ControlledLicenseMetadata,
    ConfirmSupplyProfileOptInRequestSchema,
    GrantTemporaryChannelRequestSchema,
    type SupplyProfileGrant,
    SupplyProfileGrantSchema,
    type SupplyProfileOptInStatus,
    type SupplyWhatsAppChannelId,
    type TemporaryChannelGrant,
    UpdateSupplyProfileChannelsRequestSchema,
    UpsertSupplyProfileRequestSchema,
} from '../../../contracts/supply.contracts';
import { AuditLedger } from '../../../core/audit-ledger';
import { normalizeE164Phone, validateE164Phone } from '../../../utils/taxIdValidator';
import {
    SUPPLY_COLLECTIONS,
    SupplyConflictError,
    SupplyNotFoundError,
    SupplyValidationError,
} from '../application/SupplyRepository';
import { maskPiiForLog } from '../application/supply.types';
import type {
    EffectiveChannelEvaluationResult,
    EffectiveSupplyProfileEvaluation,
    HumanResourcesActorContext,
    IHumanResourcesProfilePort,
} from '../ports/IHumanResourcesProfilePort';
import { MetaWhatsAppCloudAdapter } from './MetaWhatsAppCloudAdapter';

/**
 * ADAPTADOR PROVISORIO DE PERFILES Y CANALES WHATSAPP (`supply_channel_grants` — V3-E02)
 *
 * Implementa `IHumanResourcesProfilePort` mientras se construye el módulo independiente `RRHH`:
 * - Almacena en `supply_channel_grants` (`docId = ${tenantId}__${profileId}`) usando
 *   `phoneHashSha256`, `phoneMasked` y `phoneCiphertext` (AES-256-GCM; cero teléfono plano en logs o API HTTP).
 * - Calcula `effectiveChannels(nowIso)` combinando casillas permanentes + permisos temporales vigentes
 *   sin requerir cron jobs para expirar ventanas horarias.
 * - Compuerta DGMN inviolable (Ley N° 17.798): `CH_CONTROLLED_DGMN` jamás se activa sin licencia vigente.
 * - Doble Opt-In Ley N° 21.719: toda creación o cambio de celular queda en `PENDING_DOUBLE_OPT_IN`,
 *   con revocación inmediata vía `STOP`/`BAJA` -> `REVOKED_STOP`.
 * - En `DEV_PRIVATE`, administra perfiles libremente en escritorio `DEV_ROOT` y aplica doble compuerta
 *   `(phoneE164 ∈ SUPPLY_WHATSAPP_DEV_ALLOWLIST) && status === 'ACTIVE' && optInStatus === 'ACTIVE'` para despacho WA.
 */

export const SUPPLY_CHANNEL_GRANTS_COLLECTION = SUPPLY_COLLECTIONS.CHANNEL_GRANTS;

interface StoredSupplyChannelGrantDoc extends Omit<SupplyProfileGrant, 'effectiveChannels'> {
    phoneCiphertext: string;
}

function safeDocPart(raw: string): string {
    return String(raw || '')
        .trim()
        .replace(/[^A-Za-z0-9._-]/g, '_');
}

export function buildProfileGrantDocId(tenantId: string, profileId: string): string {
    return `${safeDocPart(tenantId)}__${safeDocPart(profileId)}`;
}

function hashPhoneSha256(normalizedPhoneE164: string): string {
    return crypto.createHash('sha256').update(normalizedPhoneE164, 'utf8').digest('hex');
}

export function maskE164PhoneForStorage(normalizedPhoneE164: string): string {
    const clean = String(normalizedPhoneE164 || '').trim();
    if (!clean) return '****';
    if (clean.length <= 7) {
        return `${clean.slice(0, 2)}****${clean.slice(-2)}`;
    }
    return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
}

function resolveProfileCipherKey(): Buffer {
    const secretMaterial =
        process.env.SUPPLY_PROFILE_CIPHER_KEY ||
        process.env.X402_HMAC_SECRET ||
        env.WHATSAPP_APP_SECRET ||
        'minreport-supply-profile-cipher-dev-v3';
    return crypto.createHash('sha256').update(secretMaterial, 'utf8').digest();
}

function encryptPhoneE164(normalizedPhoneE164: string): string {
    const key = resolveProfileCipherKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(normalizedPhoneE164, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

function decryptPhoneE164(ciphertext?: string | null): string | null {
    if (!ciphertext || typeof ciphertext !== 'string') return null;
    const parts = ciphertext.split('.');
    if (parts.length !== 3) return null;
    try {
        const key = resolveProfileCipherKey();
        const iv = Buffer.from(parts[0], 'base64url');
        const tag = Buffer.from(parts[1], 'base64url');
        const enc = Buffer.from(parts[2], 'base64url');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const dec = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
        return dec || null;
    } catch {
        return null;
    }
}

function parseTimestampMs(iso: string | null | undefined): number {
    if (!iso) return Number.NaN;
    return Date.parse(iso);
}

function isLicenseValidAt(
    license: ControlledLicenseMetadata | null | undefined,
    nowMs: number
): boolean {
    if (!license || !license.resolutionCode || !license.expiresAtIso) return false;
    const expMs = parseTimestampMs(license.expiresAtIso);
    return Number.isFinite(expMs) && expMs > nowMs;
}

function parseEnvDevAllowlist(): Set<string> {
    const raw = String(env.SUPPLY_WHATSAPP_DEV_ALLOWLIST || process.env.SUPPLY_WHATSAPP_DEV_ALLOWLIST || '');
    const set = new Set<string>();
    for (const part of raw.split(/[,\s;]+/)) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const normalized = normalizeE164Phone(trimmed, 'CL');
        if (normalized) set.add(normalized);
    }
    return set;
}

async function resolveEffectiveDevAllowlistSet(): Promise<Set<string>> {
    if (!isDevPrivateReleaseStage()) return new Set();
    try {
        const list = await resolveSupplyWhatsAppDevAllowlist();
        const set = new Set<string>();
        for (const item of list || []) {
            const norm = normalizeE164Phone(item, 'CL');
            if (norm) set.add(norm);
        }
        for (const envPhone of parseEnvDevAllowlist()) {
            set.add(envPhone);
        }
        return set;
    } catch {
        return parseEnvDevAllowlist();
    }
}

export function evaluateWhatsappDispatchEligibility(params: {
    status: SupplyProfileGrant['status'];
    optInStatus: SupplyProfileOptInStatus;
    phoneE164: string | null;
    devAllowlist?: ReadonlySet<string>;
}): boolean {
    if (params.status !== 'ACTIVE' || params.optInStatus !== 'ACTIVE' || !params.phoneE164) {
        return false;
    }
    if (isDevPrivateReleaseStage()) {
        const allowlist = params.devAllowlist ?? parseEnvDevAllowlist();
        return allowlist.has(params.phoneE164);
    }
    return true;
}

export function evaluateEffectiveChannelsForProfile(
    profile: Pick<
        SupplyProfileGrant,
        'status' | 'permanentChannels' | 'temporaryGrants' | 'maxAmountClp' | 'allowedSiteIds' | 'controlledLicense'
    >,
    nowIso?: string
): EffectiveChannelEvaluationResult {
    const resolvedNowIso = nowIso || new Date().toISOString();
    const nowMs = parseTimestampMs(resolvedNowIso);
    const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const hasValidDgmnLicense = isLicenseValidAt(profile.controlledLicense, safeNowMs);

    if (profile.status !== 'ACTIVE') {
        return {
            evaluatedAtIso: new Date(safeNowMs).toISOString(),
            effectiveChannels: [],
            activeTemporaryGrants: [],
            expiredTemporaryGrantsCount: (profile.temporaryGrants || []).length,
            effectiveMaxAmountClp: 0,
            effectiveAllowedSiteIds: [],
            hasValidDgmnLicense,
        };
    }

    const activeTemporaryGrants: TemporaryChannelGrant[] = [];
    let expiredTemporaryGrantsCount = 0;

    for (const grant of profile.temporaryGrants || []) {
        if (grant.revokedAtIso) {
            expiredTemporaryGrantsCount += 1;
            continue;
        }
        const fromMs = parseTimestampMs(grant.validFromIso);
        const untilMs = parseTimestampMs(grant.validUntilIso);
        if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs)) {
            expiredTemporaryGrantsCount += 1;
            continue;
        }
        if (fromMs <= safeNowMs && safeNowMs < untilMs) {
            activeTemporaryGrants.push(grant);
        } else {
            expiredTemporaryGrantsCount += 1;
        }
    }

    const channelSet = new Set<SupplyWhatsAppChannelId>();
    for (const ch of profile.permanentChannels || []) {
        channelSet.add(ch);
    }
    for (const grant of activeTemporaryGrants) {
        channelSet.add(grant.channelId);
    }

    // Compuerta DGMN inviolable (Ley N° 17.798): CH_CONTROLLED_DGMN jamás activo sin licencia vigente
    if (!hasValidDgmnLicense) {
        channelSet.delete('CH_CONTROLLED_DGMN');
    }

    const filteredActiveGrants = hasValidDgmnLicense
        ? activeTemporaryGrants
        : activeTemporaryGrants.filter((g) => g.channelId !== 'CH_CONTROLLED_DGMN');

    let effectiveMaxAmountClp = Number(profile.maxAmountClp || 0);
    const siteSet = new Set<string>(profile.allowedSiteIds || []);
    for (const grant of filteredActiveGrants) {
        if (typeof grant.maxAmountClpOverride === 'number' && grant.maxAmountClpOverride > effectiveMaxAmountClp) {
            effectiveMaxAmountClp = grant.maxAmountClpOverride;
        }
        if (Array.isArray(grant.allowedSiteIdsOverride)) {
            for (const s of grant.allowedSiteIdsOverride) {
                if (s) siteSet.add(s);
            }
        }
    }

    return {
        evaluatedAtIso: new Date(safeNowMs).toISOString(),
        effectiveChannels: Array.from(channelSet),
        activeTemporaryGrants: filteredActiveGrants,
        expiredTemporaryGrantsCount,
        effectiveMaxAmountClp,
        effectiveAllowedSiteIds: Array.from(siteSet),
        hasValidDgmnLicense,
    };
}

function toPublicProfileGrant(
    stored: StoredSupplyChannelGrantDoc,
    evalRes: EffectiveChannelEvaluationResult
): SupplyProfileGrant {
    const { phoneCiphertext: _omitCiphertext, ...rest } = stored;
    void _omitCiphertext;
    return SupplyProfileGrantSchema.parse({
        ...rest,
        effectiveChannels: evalRes.effectiveChannels,
    });
}

async function dispatchDoubleOptInConsentTemplateSafe(
    normalizedPhoneE164: string,
    displayName: string
): Promise<void> {
    try {
        await MetaWhatsAppCloudAdapter.sendTemplateMessage(
            normalizedPhoneE164,
            'minreport_supply_optin_es',
            'es',
            [displayName]
        );
    } catch (err) {
        console.warn(
            `[SUPPLY-PROFILES] Envío plantilla Doble Opt-In omitido/fallido para ${maskPiiForLog(normalizedPhoneE164)}:`,
            err instanceof Error ? err.message : 'UnknownError'
        );
    }
}

export class ProvisionalSupplyProfileAdapterImpl implements IHumanResourcesProfilePort {
    public evaluateEffectiveChannels(
        profile: SupplyProfileGrant,
        nowIso?: string
    ): EffectiveChannelEvaluationResult {
        return evaluateEffectiveChannelsForProfile(profile, nowIso);
    }

    public async resolveEffectiveProfileByPhone(
        phoneE164: string,
        nowIso?: string,
        options: { tenantIdHint?: string; includeDispatchPhone?: boolean } = {}
    ): Promise<EffectiveSupplyProfileEvaluation | null> {
        const normalized = normalizeE164Phone(phoneE164, 'CL');
        if (!normalized) return null;
        const phoneHash = hashPhoneSha256(normalized);

        const snap = await db
            .collection(SUPPLY_CHANNEL_GRANTS_COLLECTION)
            .where('phoneHashSha256', '==', phoneHash)
            .limit(20)
            .get();

        if (snap.empty) return null;
        const docs = snap.docs.map((d) => d.data() as StoredSupplyChannelGrantDoc);
        const activeMatches = docs.filter((d) => d.status === 'ACTIVE');
        const candidates = activeMatches.length > 0 ? activeMatches : docs;
        const chosen =
            (options.tenantIdHint
                ? candidates.find((d) => d.tenantId === options.tenantIdHint)
                : undefined) || candidates[0];
        if (!chosen) return null;

        const evalRes = evaluateEffectiveChannelsForProfile(chosen, nowIso);
        const publicProfile = toPublicProfileGrant(chosen, evalRes);
        const decryptedPhone = decryptPhoneE164(chosen.phoneCiphertext);
        const devAllowlist = await resolveEffectiveDevAllowlistSet();
        const whatsappDispatchAllowed = evaluateWhatsappDispatchEligibility({
            status: publicProfile.status,
            optInStatus: publicProfile.optInStatus,
            phoneE164: decryptedPhone,
            devAllowlist,
        });

        return {
            profile: publicProfile,
            ...evalRes,
            whatsappDispatchAllowed,
            ...(options.includeDispatchPhone && whatsappDispatchAllowed
                ? { dispatchPhoneE164: decryptedPhone }
                : {}),
        };
    }

    public async resolveEffectiveProfileById(
        tenantId: string,
        profileId: string,
        nowIso?: string,
        options: { includeDispatchPhone?: boolean } = {}
    ): Promise<EffectiveSupplyProfileEvaluation | null> {
        const docId = buildProfileGrantDocId(tenantId, profileId);
        const snap = await db.collection(SUPPLY_CHANNEL_GRANTS_COLLECTION).doc(docId).get();
        if (!snap.exists) return null;
        const stored = snap.data() as StoredSupplyChannelGrantDoc;
        if (stored.tenantId !== tenantId) return null;

        const evalRes = evaluateEffectiveChannelsForProfile(stored, nowIso);
        const publicProfile = toPublicProfileGrant(stored, evalRes);
        const decryptedPhone = decryptPhoneE164(stored.phoneCiphertext);
        const devAllowlist = await resolveEffectiveDevAllowlistSet();
        const whatsappDispatchAllowed = evaluateWhatsappDispatchEligibility({
            status: publicProfile.status,
            optInStatus: publicProfile.optInStatus,
            phoneE164: decryptedPhone,
            devAllowlist,
        });

        return {
            profile: publicProfile,
            ...evalRes,
            whatsappDispatchAllowed,
            ...(options.includeDispatchPhone && whatsappDispatchAllowed
                ? { dispatchPhoneE164: decryptedPhone }
                : {}),
        };
    }

    public async listTenantProfiles(
        tenantId: string,
        nowIso?: string
    ): Promise<EffectiveSupplyProfileEvaluation[]> {
        const snap = await db
            .collection(SUPPLY_CHANNEL_GRANTS_COLLECTION)
            .where('tenantId', '==', tenantId)
            .limit(250)
            .get();
        const devAllowlist = await resolveEffectiveDevAllowlistSet();

        return snap.docs
            .map((doc) => doc.data() as StoredSupplyChannelGrantDoc)
            .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'))
            .map((stored) => {
                const evalRes = evaluateEffectiveChannelsForProfile(stored, nowIso);
                const publicProfile = toPublicProfileGrant(stored, evalRes);
                const decryptedPhone = decryptPhoneE164(stored.phoneCiphertext);
                return {
                    profile: publicProfile,
                    ...evalRes,
                    whatsappDispatchAllowed: evaluateWhatsappDispatchEligibility({
                        status: publicProfile.status,
                        optInStatus: publicProfile.optInStatus,
                        phoneE164: decryptedPhone,
                        devAllowlist,
                    }),
                };
            });
    }

    public async upsertProfileGrant(
        tenantId: string,
        rawInput: unknown,
        actor: HumanResourcesActorContext
    ): Promise<EffectiveSupplyProfileEvaluation> {
        const parsed = UpsertSupplyProfileRequestSchema.safeParse(rawInput);
        if (!parsed.success) {
            throw new SupplyValidationError(
                'INVALID_PROFILE_GRANT_PAYLOAD',
                parsed.error.issues[0]?.message || 'Payload inválido para perfil de canales WhatsApp.'
            );
        }

        const input = parsed.data;
        const nowIso = new Date().toISOString();
        const nowMs = Date.parse(nowIso);
        const profileId =
            input.profileId?.trim() ||
            `sprof_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
        const docId = buildProfileGrantDocId(tenantId, profileId);
        const ref = db.collection(SUPPLY_CHANNEL_GRANTS_COLLECTION).doc(docId);

        const existingSnap = await ref.get();
        const existing = existingSnap.exists
            ? (existingSnap.data() as StoredSupplyChannelGrantDoc)
            : null;
        if (existing && existing.tenantId !== tenantId) {
            throw new SupplyConflictError('CROSS_TENANT_PROFILE_CONFLICT', 'Conflicto de aislamiento multi-tenant.');
        }

        // Resolver teléfono y Doble Opt-In Ley N° 21.719
        let phoneMasked = existing?.phoneMasked || '';
        let phoneHashSha256 = existing?.phoneHashSha256 || '';
        let phoneCiphertext = existing?.phoneCiphertext || '';
        let optInStatus: SupplyProfileOptInStatus = existing?.optInStatus || 'PENDING_DOUBLE_OPT_IN';
        let optInConfirmedAtIso: string | null = existing?.optInConfirmedAtIso ?? null;
        let optInRevokedAtIso: string | null = existing?.optInRevokedAtIso ?? null;
        let phoneChangedOrNew = false;
        let normalizedPhoneToDispatch: string | null = null;

        if (input.phoneE164) {
            const normalized = normalizeE164Phone(input.phoneE164, 'CL');
            const validation = validateE164Phone(normalized);
            if (!validation.valid) {
                throw new SupplyValidationError(
                    'INVALID_PHONE_E164',
                    validation.reason || 'El teléfono debe cumplir formato internacional E.164.'
                );
            }
            const nextHash = hashPhoneSha256(validation.normalized);
            if (!existing || existing.phoneHashSha256 !== nextHash) {
                phoneChangedOrNew = true;
                phoneHashSha256 = nextHash;
                phoneMasked = maskE164PhoneForStorage(validation.normalized);
                phoneCiphertext = encryptPhoneE164(validation.normalized);
                optInStatus = 'PENDING_DOUBLE_OPT_IN';
                optInConfirmedAtIso = null;
                optInRevokedAtIso = null;
                normalizedPhoneToDispatch = validation.normalized;
            }
        } else if (!existing) {
            throw new SupplyValidationError(
                'PHONE_E164_REQUIRED',
                'Se requiere teléfono E.164 válido al crear un nuevo perfil de abastecimiento.'
            );
        }

        const effectiveLicense =
            input.controlledLicense !== undefined
                ? input.controlledLicense
                : existing?.controlledLicense ?? null;

        if (
            input.permanentChannels.includes('CH_CONTROLLED_DGMN') &&
            !isLicenseValidAt(effectiveLicense, nowMs)
        ) {
            throw new SupplyValidationError(
                'DGMN_LICENSE_REQUIRED',
                'No se puede asignar CH_CONTROLLED_DGMN sin licencia DGMN vigente (Ley N° 17.798).'
            );
        }

        const storedDoc: StoredSupplyChannelGrantDoc = {
            profileId,
            tenantId,
            displayName: input.displayName,
            role: input.role,
            phoneMasked,
            phoneHashSha256,
            phoneCiphertext,
            optInStatus,
            optInConfirmedAtIso,
            optInRevokedAtIso,
            status: input.status,
            permanentChannels: Array.from(new Set(input.permanentChannels)),
            temporaryGrants: existing?.temporaryGrants || [],
            allowedSiteIds: Array.from(new Set(input.allowedSiteIds)),
            allowedWarehouseIds: Array.from(new Set(input.allowedWarehouseIds)),
            maxAmountClp: Math.round(input.maxAmountClp),
            allowCapex: Boolean(input.allowCapex),
            controlledLicense: effectiveLicense,
            linkedMemberUid:
                input.linkedMemberUid !== undefined
                    ? input.linkedMemberUid
                    : existing?.linkedMemberUid ?? null,
            hrPersonId:
                input.hrPersonId !== undefined ? input.hrPersonId : existing?.hrPersonId ?? null,
            createdAtIso: existing?.createdAtIso || nowIso,
            updatedAtIso: nowIso,
        };

        await ref.set(storedDoc);

        if (phoneChangedOrNew && normalizedPhoneToDispatch && input.sendOptInTemplate !== false) {
            await dispatchDoubleOptInConsentTemplateSafe(normalizedPhoneToDispatch, storedDoc.displayName);
        }

        await AuditLedger.record({
            tenantId,
            actorUid: actor.actorUid,
            actorEmail: actor.actorEmail,
            action: existing ? 'SUPPLY_PROFILE_GRANT_UPDATED' : 'SUPPLY_PROFILE_GRANT_CREATED',
            module: 'supply',
            targetEntity: `${SUPPLY_CHANNEL_GRANTS_COLLECTION}/${docId}`,
            details: {
                profileId,
                role: storedDoc.role,
                phoneMasked: storedDoc.phoneMasked,
                optInStatus: storedDoc.optInStatus,
                permanentChannelsCount: storedDoc.permanentChannels.length,
                hitlConfirmed: true,
            },
            ipAddress: actor.ipAddress,
        });

        const evalRes = evaluateEffectiveChannelsForProfile(storedDoc, nowIso);
        const devAllowlist = await resolveEffectiveDevAllowlistSet();
        return {
            profile: toPublicProfileGrant(storedDoc, evalRes),
            ...evalRes,
            whatsappDispatchAllowed: evaluateWhatsappDispatchEligibility({
                status: storedDoc.status,
                optInStatus: storedDoc.optInStatus,
                phoneE164: decryptPhoneE164(storedDoc.phoneCiphertext),
                devAllowlist,
            }),
        };
    }

    public async updateProfileChannels(
        tenantId: string,
        profileId: string,
        rawInput: unknown,
        actor: HumanResourcesActorContext
    ): Promise<EffectiveSupplyProfileEvaluation> {
        const parsed = UpdateSupplyProfileChannelsRequestSchema.safeParse(rawInput);
        if (!parsed.success) {
            throw new SupplyValidationError(
                'INVALID_CHANNEL_MATRIX_PAYLOAD',
                parsed.error.issues[0]?.message || 'Payload inválido actualizando casillas WS.'
            );
        }

        const docId = buildProfileGrantDocId(tenantId, profileId);
        const ref = db.collection(SUPPLY_CHANNEL_GRANTS_COLLECTION).doc(docId);
        const snap = await ref.get();
        if (!snap.exists) {
            throw new SupplyNotFoundError(`Perfil ${profileId} no encontrado.`);
        }
        const existing = snap.data() as StoredSupplyChannelGrantDoc;
        if (existing.tenantId !== tenantId) {
            throw new SupplyNotFoundError(`Perfil ${profileId} no encontrado en tenant.`);
        }

        const nowIso = new Date().toISOString();
        const nowMs = Date.parse(nowIso);
        const input = parsed.data;
        const nextLicense =
            input.controlledLicense !== undefined
                ? input.controlledLicense
                : existing.controlledLicense ?? null;

        if (
            input.permanentChannels.includes('CH_CONTROLLED_DGMN') &&
            !isLicenseValidAt(nextLicense, nowMs)
        ) {
            throw new SupplyValidationError(
                'DGMN_LICENSE_REQUIRED',
                'No se puede activar la casilla CH_CONTROLLED_DGMN sin licencia DGMN vigente.'
            );
        }

        const updated: StoredSupplyChannelGrantDoc = {
            ...existing,
            permanentChannels: Array.from(new Set(input.permanentChannels)),
            maxAmountClp:
                input.maxAmountClp !== undefined
                    ? Math.round(input.maxAmountClp)
                    : existing.maxAmountClp,
            allowCapex: input.allowCapex !== undefined ? input.allowCapex : existing.allowCapex,
            allowedSiteIds:
                input.allowedSiteIds !== undefined
                    ? Array.from(new Set(input.allowedSiteIds))
                    : existing.allowedSiteIds,
            allowedWarehouseIds:
                input.allowedWarehouseIds !== undefined
                    ? Array.from(new Set(input.allowedWarehouseIds))
                    : existing.allowedWarehouseIds,
            controlledLicense: nextLicense,
            status: input.status !== undefined ? input.status : existing.status,
            updatedAtIso: nowIso,
        };

        await ref.set(updated);

        await AuditLedger.record({
            tenantId,
            actorUid: actor.actorUid,
            actorEmail: actor.actorEmail,
            action: 'SUPPLY_PROFILE_CHANNELS_UPDATED',
            module: 'supply',
            targetEntity: `${SUPPLY_CHANNEL_GRANTS_COLLECTION}/${docId}`,
            details: {
                profileId,
                permanentChannels: updated.permanentChannels,
                status: updated.status,
                hitlConfirmed: true,
            },
            ipAddress: actor.ipAddress,
        });

        const evalRes = evaluateEffectiveChannelsForProfile(updated, nowIso);
        const devAllowlist = await resolveEffectiveDevAllowlistSet();
        return {
            profile: toPublicProfileGrant(updated, evalRes),
            ...evalRes,
            whatsappDispatchAllowed: evaluateWhatsappDispatchEligibility({
                status: updated.status,
                optInStatus: updated.optInStatus,
                phoneE164: decryptPhoneE164(updated.phoneCiphertext),
                devAllowlist,
            }),
        };
    }

    public async grantTemporaryChannel(
        tenantId: string,
        profileId: string,
        rawInput: unknown,
        actor: HumanResourcesActorContext
    ): Promise<EffectiveSupplyProfileEvaluation> {
        const parsed = GrantTemporaryChannelRequestSchema.safeParse(rawInput);
        if (!parsed.success) {
            throw new SupplyValidationError(
                'INVALID_TEMP_GRANT_PAYLOAD',
                parsed.error.issues[0]?.message || 'Payload inválido para permiso temporal WS.'
            );
        }

        const input = parsed.data;
        const fromMs = parseTimestampMs(input.validFromIso);
        const untilMs = parseTimestampMs(input.validUntilIso);
        if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs <= fromMs) {
            throw new SupplyValidationError(
                'INVALID_GRANT_TIME_WINDOW',
                'validUntilIso debe ser estrictamente posterior a validFromIso.'
            );
        }

        const docId = buildProfileGrantDocId(tenantId, profileId);
        const ref = db.collection(SUPPLY_CHANNEL_GRANTS_COLLECTION).doc(docId);
        const snap = await ref.get();
        if (!snap.exists) {
            throw new SupplyNotFoundError(`Perfil ${profileId} no encontrado.`);
        }
        const existing = snap.data() as StoredSupplyChannelGrantDoc;
        if (existing.tenantId !== tenantId) {
            throw new SupplyNotFoundError(`Perfil ${profileId} no encontrado en tenant.`);
        }

        const nowIso = new Date().toISOString();
        if (
            input.channelId === 'CH_CONTROLLED_DGMN' &&
            !isLicenseValidAt(existing.controlledLicense, Math.max(Date.parse(nowIso), untilMs - 1))
        ) {
            throw new SupplyValidationError(
                'DGMN_LICENSE_REQUIRED',
                'No se puede otorgar permiso temporal CH_CONTROLLED_DGMN sin licencia DGMN vigente para todo el período.'
            );
        }

        const newGrant: TemporaryChannelGrant = {
            grantItemId: `tgrant_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
            channelId: input.channelId,
            validFromIso: input.validFromIso,
            validUntilIso: input.validUntilIso,
            timezoneIana: input.timezoneIana,
            reason: input.reason,
            maxAmountClpOverride: input.maxAmountClpOverride ?? null,
            allowedSiteIdsOverride: input.allowedSiteIdsOverride ?? null,
            revokedAtIso: null,
            grantedByUid: actor.actorUid,
            createdAtIso: nowIso,
        };

        const updated: StoredSupplyChannelGrantDoc = {
            ...existing,
            temporaryGrants: [...(existing.temporaryGrants || []), newGrant],
            updatedAtIso: nowIso,
        };

        await ref.set(updated);

        await AuditLedger.record({
            tenantId,
            actorUid: actor.actorUid,
            actorEmail: actor.actorEmail,
            action: 'SUPPLY_TEMPORARY_CHANNEL_GRANTED',
            module: 'supply',
            targetEntity: `${SUPPLY_CHANNEL_GRANTS_COLLECTION}/${docId}`,
            details: {
                profileId,
                grantItemId: newGrant.grantItemId,
                channelId: newGrant.channelId,
                validFromIso: newGrant.validFromIso,
                validUntilIso: newGrant.validUntilIso,
                hitlConfirmed: true,
            },
            ipAddress: actor.ipAddress,
        });

        const evalRes = evaluateEffectiveChannelsForProfile(updated, nowIso);
        const devAllowlist = await resolveEffectiveDevAllowlistSet();
        return {
            profile: toPublicProfileGrant(updated, evalRes),
            ...evalRes,
            whatsappDispatchAllowed: evaluateWhatsappDispatchEligibility({
                status: updated.status,
                optInStatus: updated.optInStatus,
                phoneE164: decryptPhoneE164(updated.phoneCiphertext),
                devAllowlist,
            }),
        };
    }

    public async revokeTemporaryChannel(
        tenantId: string,
        profileId: string,
        grantItemId: string,
        actor: HumanResourcesActorContext
    ): Promise<EffectiveSupplyProfileEvaluation> {
        const docId = buildProfileGrantDocId(tenantId, profileId);
        const ref = db.collection(SUPPLY_CHANNEL_GRANTS_COLLECTION).doc(docId);
        const snap = await ref.get();
        if (!snap.exists) {
            throw new SupplyNotFoundError(`Perfil ${profileId} no encontrado.`);
        }
        const existing = snap.data() as StoredSupplyChannelGrantDoc;
        if (existing.tenantId !== tenantId) {
            throw new SupplyNotFoundError(`Perfil ${profileId} no encontrado en tenant.`);
        }

        const idx = (existing.temporaryGrants || []).findIndex(
            (g) => g.grantItemId === grantItemId
        );
        if (idx < 0) {
            throw new SupplyNotFoundError(`Permiso temporal ${grantItemId} no encontrado.`);
        }

        const nowIso = new Date().toISOString();
        const nextGrants = [...existing.temporaryGrants];
        nextGrants[idx] = {
            ...nextGrants[idx],
            revokedAtIso: nextGrants[idx].revokedAtIso || nowIso,
        };

        const updated: StoredSupplyChannelGrantDoc = {
            ...existing,
            temporaryGrants: nextGrants,
            updatedAtIso: nowIso,
        };

        await ref.set(updated);

        await AuditLedger.record({
            tenantId,
            actorUid: actor.actorUid,
            actorEmail: actor.actorEmail,
            action: 'SUPPLY_TEMPORARY_CHANNEL_REVOKED',
            module: 'supply',
            targetEntity: `${SUPPLY_CHANNEL_GRANTS_COLLECTION}/${docId}`,
            details: {
                profileId,
                grantItemId,
                channelId: nextGrants[idx].channelId,
                hitlConfirmed: true,
            },
            ipAddress: actor.ipAddress,
        });

        const evalRes = evaluateEffectiveChannelsForProfile(updated, nowIso);
        const devAllowlist = await resolveEffectiveDevAllowlistSet();
        return {
            profile: toPublicProfileGrant(updated, evalRes),
            ...evalRes,
            whatsappDispatchAllowed: evaluateWhatsappDispatchEligibility({
                status: updated.status,
                optInStatus: updated.optInStatus,
                phoneE164: decryptPhoneE164(updated.phoneCiphertext),
                devAllowlist,
            }),
        };
    }

    public async confirmOrRevokeOptIn(
        tenantId: string,
        profileId: string,
        rawInput: unknown,
        actor: HumanResourcesActorContext
    ): Promise<EffectiveSupplyProfileEvaluation> {
        const parsed = ConfirmSupplyProfileOptInRequestSchema.safeParse(rawInput);
        if (!parsed.success) {
            throw new SupplyValidationError(
                'INVALID_OPT_IN_PAYLOAD',
                parsed.error.issues[0]?.message || 'Payload inválido para confirmación Doble Opt-In.'
            );
        }

        const docId = buildProfileGrantDocId(tenantId, profileId);
        const ref = db.collection(SUPPLY_CHANNEL_GRANTS_COLLECTION).doc(docId);
        const snap = await ref.get();
        if (!snap.exists) {
            throw new SupplyNotFoundError(`Perfil ${profileId} no encontrado.`);
        }
        const existing = snap.data() as StoredSupplyChannelGrantDoc;
        if (existing.tenantId !== tenantId) {
            throw new SupplyNotFoundError(`Perfil ${profileId} no encontrado en tenant.`);
        }

        const nowIso = new Date().toISOString();
        const isRevoke = parsed.data.action === 'REVOKE_STOP';
        const updated: StoredSupplyChannelGrantDoc = {
            ...existing,
            optInStatus: isRevoke ? 'REVOKED_STOP' : 'ACTIVE',
            optInConfirmedAtIso: isRevoke ? existing.optInConfirmedAtIso ?? null : nowIso,
            optInRevokedAtIso: isRevoke ? nowIso : null,
            updatedAtIso: nowIso,
        };

        await ref.set(updated);

        await AuditLedger.record({
            tenantId,
            actorUid: actor.actorUid,
            actorEmail: actor.actorEmail,
            action: isRevoke
                ? 'SUPPLY_PROFILE_OPT_OUT_STOP_RECORDED'
                : 'SUPPLY_PROFILE_DOUBLE_OPT_IN_CONFIRMED',
            module: 'supply',
            targetEntity: `${SUPPLY_CHANNEL_GRANTS_COLLECTION}/${docId}`,
            details: {
                profileId,
                phoneMasked: updated.phoneMasked,
                optInStatus: updated.optInStatus,
                hitlConfirmed: true,
            },
            ipAddress: actor.ipAddress,
        });

        const evalRes = evaluateEffectiveChannelsForProfile(updated, nowIso);
        const devAllowlist = await resolveEffectiveDevAllowlistSet();
        return {
            profile: toPublicProfileGrant(updated, evalRes),
            ...evalRes,
            whatsappDispatchAllowed: evaluateWhatsappDispatchEligibility({
                status: updated.status,
                optInStatus: updated.optInStatus,
                phoneE164: decryptPhoneE164(updated.phoneCiphertext),
                devAllowlist,
            }),
        };
    }

    public async revokeOptInByPhone(
        phoneE164: string,
        actor?: HumanResourcesActorContext
    ): Promise<number> {
        const normalized = normalizeE164Phone(phoneE164, 'CL');
        if (!normalized) return 0;
        const phoneHash = hashPhoneSha256(normalized);

        const snap = await db
            .collection(SUPPLY_CHANNEL_GRANTS_COLLECTION)
            .where('phoneHashSha256', '==', phoneHash)
            .limit(20)
            .get();

        if (snap.empty) return 0;
        const nowIso = new Date().toISOString();
        let revokedCount = 0;

        for (const doc of snap.docs) {
            const existing = doc.data() as StoredSupplyChannelGrantDoc;
            const updated: StoredSupplyChannelGrantDoc = {
                ...existing,
                optInStatus: 'REVOKED_STOP',
                optInRevokedAtIso: nowIso,
                updatedAtIso: nowIso,
            };
            await db.collection(SUPPLY_CHANNEL_GRANTS_COLLECTION).doc(doc.id).set(updated);
            revokedCount += 1;

            await AuditLedger.record({
                tenantId: existing.tenantId,
                actorUid: actor?.actorUid || existing.linkedMemberUid || existing.profileId,
                actorEmail: actor?.actorEmail || 'whatsapp-stop@minreport.local',
                action: 'SUPPLY_PROFILE_OPT_OUT_STOP_RECORDED',
                module: 'supply',
                targetEntity: `${SUPPLY_CHANNEL_GRANTS_COLLECTION}/${doc.id}`,
                details: {
                    profileId: existing.profileId,
                    phoneMasked: existing.phoneMasked,
                    optInStatus: 'REVOKED_STOP',
                    source: 'WHATSAPP_STOP',
                },
                ipAddress: actor?.ipAddress,
            });
        }

        return revokedCount;
    }
}

export const ProvisionalSupplyProfileAdapter = new ProvisionalSupplyProfileAdapterImpl();
