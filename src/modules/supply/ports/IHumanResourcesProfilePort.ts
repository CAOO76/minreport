/**
 * MINREPORT · ABASTECIMIENTO — Puerto Hexagonal de Perfiles Operativos y Matriz de Canales WS (`V3-E02`)
 *
 * Desacopla la resolución de identidad telefónica E.164, casillas permanentes de WhatsApp,
 * permisos temporales auto-expirables, licencia DGMN y Doble Opt-In (Ley N° 21.719) detrás
 * de un contrato único para que el futuro módulo independiente `RRHH` implemente
 * `HrModuleProfileAdapter` con cero refactor en `camp.channel.ts` o `DynamicChannelScopeResolver`.
 */

import type {
    ConfirmSupplyProfileOptInRequest,
    GrantTemporaryChannelRequest,
    SupplyProfileGrant,
    SupplyWhatsAppChannelId,
    TemporaryChannelGrant,
    UpdateSupplyProfileChannelsRequest,
    UpsertSupplyProfileRequest,
} from '../../../contracts/supply.contracts';

export interface HumanResourcesActorContext {
    actorUid: string;
    actorEmail: string;
    ipAddress?: string;
}

export interface EffectiveChannelEvaluationResult {
    evaluatedAtIso: string;
    effectiveChannels: SupplyWhatsAppChannelId[];
    activeTemporaryGrants: TemporaryChannelGrant[];
    expiredTemporaryGrantsCount: number;
    effectiveMaxAmountClp: number;
    effectiveAllowedSiteIds: string[];
    hasValidDgmnLicense: boolean;
}

export interface EffectiveSupplyProfileEvaluation extends EffectiveChannelEvaluationResult {
    profile: SupplyProfileGrant;
    /** Teléfono E.164 desencriptado exclusivamente en runtime para despacho WhatsApp autorizado; jamás exponer en respuestas HTTP de listado */
    dispatchPhoneE164?: string | null;
    /** Evalúa estado ACTIVE + optIn ACTIVE + (en DEV_PRIVATE) pertenencia a SUPPLY_WHATSAPP_DEV_ALLOWLIST */
    whatsappDispatchAllowed?: boolean;
}

export interface IHumanResourcesProfilePort {
    resolveEffectiveProfileByPhone(
        phoneE164: string,
        nowIso?: string,
        options?: { tenantIdHint?: string; includeDispatchPhone?: boolean }
    ): Promise<EffectiveSupplyProfileEvaluation | null>;

    resolveEffectiveProfileById(
        tenantId: string,
        profileId: string,
        nowIso?: string
    ): Promise<EffectiveSupplyProfileEvaluation | null>;

    listTenantProfiles(
        tenantId: string,
        nowIso?: string
    ): Promise<EffectiveSupplyProfileEvaluation[]>;

    upsertProfileGrant(
        tenantId: string,
        input: UpsertSupplyProfileRequest,
        actor: HumanResourcesActorContext
    ): Promise<EffectiveSupplyProfileEvaluation>;

    updateProfileChannels(
        tenantId: string,
        profileId: string,
        input: UpdateSupplyProfileChannelsRequest,
        actor: HumanResourcesActorContext
    ): Promise<EffectiveSupplyProfileEvaluation>;

    grantTemporaryChannel(
        tenantId: string,
        profileId: string,
        input: GrantTemporaryChannelRequest,
        actor: HumanResourcesActorContext
    ): Promise<EffectiveSupplyProfileEvaluation>;

    revokeTemporaryChannel(
        tenantId: string,
        profileId: string,
        grantItemId: string,
        actor: HumanResourcesActorContext
    ): Promise<EffectiveSupplyProfileEvaluation>;

    confirmOrRevokeOptIn(
        tenantId: string,
        profileId: string,
        input: ConfirmSupplyProfileOptInRequest,
        actor: HumanResourcesActorContext
    ): Promise<EffectiveSupplyProfileEvaluation>;

    evaluateEffectiveChannels(
        profile: SupplyProfileGrant,
        nowIso?: string
    ): EffectiveChannelEvaluationResult;
}
