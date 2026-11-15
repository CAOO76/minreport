import { createHash } from 'crypto';
import { z } from 'zod';
import { db } from '../../../config/firebase';
import { AuditLedger } from '../../../core/audit-ledger';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { ResilientAIClient, Type, type GroundingSource } from '../../../core/resilient-ai-client';
import { computeThirtyDayTtlTimestamp } from '../../../core/retention-policy';
import {
    AiSupplierSuggestion,
    ApproveSuppliersAiBody,
    COMMERCIAL_CHANNEL_TYPES,
    CommercialChannelType,
    DiscoverSuppliersAiBody,
    MANUFACTURER_MACHINERY_ARCHETYPE_IDS,
    MachineryArchetypeFilterId,
    ManufacturerMachineryArchetypeId,
    ManufacturerRecord,
    ModerateSupplierContributionBody,
    ResolvedSupplierMatch,
    ResolveSupplierChannelsResult,
    SubmitSupplierContributionBody,
    SupplierBranch,
    SupplierChannelResolveQuery,
    SupplierContactContribution,
    SupplierDivision,
    SupplierEntity,
    SupplierRepresentation,
    TenantPrivateSupplierContact,
    UpsertSupplierBody,
    UpsertTenantPrivateContactBody,
} from '../../../contracts/manufacturers.contracts';
import {
    EMPTY_SUPPLIER_SII_TAX_PROFILE,
    SII_DTE_DOCUMENT_TYPES,
    type AiSupplierContactHint,
    type CreateSupplierDirectHitlBody,
    type DiscoverSupplierAreasAiBody,
    type SiiDteDocumentType,
    type SupplierContactEntry,
    type SupplierSiiTaxProfile,
    type SupplierTaxReadinessCheck,
    type SupplierTaxReadinessSummary,
    type TenantSupplierBillingRule,
    type UpdateSupplierProfileHitlBody,
    type UpsertSupplierContactHitlBody,
    type UpsertTenantSupplierBillingRuleBody,
} from '../../../contracts/manufacturers.contracts';
import { validateTaxId } from '../../../utils/taxIdValidator';
import { resolveMachineryArchetype } from '../utils/canonicalArchetypeSpecs';
import { detectCanonicalMake } from './CanonicalEntityResolver';
import {
    filterSafeHttpsUrl,
    ManufacturerRegistryService,
    normalizeManufacturerKey,
    sanitizeCorporatePhone,
    sanitizeFunctionalCorporateEmail,
} from './ManufacturerRegistryService';

/**
 * SERVICIO DE AGENDA INDEPENDIENTE DE PROVEEDORES Y RESOLUCIÓN MULTICANAL (`global_suppliers`)
 * — DOMINIO 2 DESACOPLADO & BASE SILENCIOSA MARKETPLACE MINREPORT —
 *
 * Responsabilidades:
 * 1. Deduplicar empresas proveedoras/distribuidoras por `countryIso2 + supplierTaxId` en `global_suppliers`.
 * 2. Modelar la organización interna real del proveedor por divisiones (`divisions[]`: Equipos Nuevos,
 *    Usados, Arriendo, Repuestos, Servicio Técnico), marcas N:M y sucursales regionales (`branches[]`).
 * 3. Investigación IA Grounded 2-Pasadas posterior (sin contaminar `global_manufacturers`) moderada HITL por 1º DEV.
 * 4. Agenda privada Offline-First por tenant (`accounts/{tenantId}/manufacturer_contacts`), con o sin marca asociada.
 * 5. Aportes comunitarios bajo Ley N° 19.628 / Nueva Ley N° 21.719 con exclusa PII y TTL 30d en rechazos.
 * 6. Resolución M2M / x402 (`/api/m2m/suppliers/resolve`) y campos base KYB / `x402SellerWalletId`.
 */

const SUPPLIERS_COL = 'global_suppliers';
const CONTRIBUTIONS_COL = 'supplier_contact_contributions';
const PRIVATE_CONTACTS_SUBCOL = 'manufacturer_contacts';
const PRIVATE_BILLING_RULES_SUBCOL = 'supplier_billing_rules';

const COUNTRY_ISO2_LABELS: Record<string, string> = {
    CL: 'Chile',
    PE: 'Perú',
    BR: 'Brasil',
    AR: 'Argentina',
    CO: 'Colombia',
    MX: 'México',
    EC: 'Ecuador',
    BO: 'Bolivia',
    US: 'Estados Unidos',
    CA: 'Canadá',
    AU: 'Australia',
    DE: 'Alemania',
    JP: 'Japón',
    SE: 'Suecia',
    FI: 'Finlandia',
    GB: 'Reino Unido',
    ES: 'España',
    ZA: 'Sudáfrica',
    CN: 'China',
    KR: 'Corea del Sur',
    FR: 'Francia',
    IT: 'Italia',
};

export function resolveCountryDisplayName(iso2?: string | null): string {
    const code = String(iso2 || 'CL').trim().toUpperCase();
    return COUNTRY_ISO2_LABELS[code] || code;
}

export function normalizeSupplierAreaKey(rawArea: string): string {
    const clean = String(rawArea || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 100);
    return clean.length >= 2 ? clean : 'general';
}

export function deriveSiiGiroRecep40(giroEmis?: string | null): string | null {
    const collapsed = String(giroEmis || '').replace(/\s+/g, ' ').trim();
    if (!collapsed) return null;
    if (collapsed.length <= 40) return collapsed;
    const sliced = collapsed.slice(0, 40);
    const lastSpace = sliced.lastIndexOf(' ');
    if (lastSpace >= 20) {
        return sliced.slice(0, lastSpace).trim();
    }
    return sliced.trim();
}

export function normalizeSiiXmlRut(rawTaxId?: string | null): {
    valid: boolean;
    normalizedXmlRut: string | null;
    displayRut: string | null;
    compactRut: string | null;
    reason?: string;
} {
    const trimmed = String(rawTaxId || '').trim();
    if (!trimmed) {
        return { valid: false, normalizedXmlRut: null, displayRut: null, compactRut: null, reason: 'EMPTY' };
    }
    const check = validateTaxId(trimmed, 'CL');
    const compact = check.normalized.replace(/[^0-9K]/gi, '').toUpperCase();
    if (!check.valid || compact.length < 8) {
        return {
            valid: false,
            normalizedXmlRut: null,
            displayRut: null,
            compactRut: null,
            reason: check.reason || 'INVALID_CL_RUT_MOD11',
        };
    }
    const body = compact.slice(0, -1);
    const dv = compact.slice(-1);
    const xmlRut = `${body}-${dv}`.slice(0, 10);
    return {
        valid: true,
        normalizedXmlRut: xmlRut,
        displayRut: check.formatted,
        compactRut: compact,
    };
}

export function computeSupplierTaxReadiness(params: {
    countryIso2?: string | null;
    supplierTaxId?: string | null;
    legalName?: string | null;
    siiTaxProfile?: Partial<SupplierSiiTaxProfile> | null;
}): SupplierTaxReadinessSummary {
    const country = String(params.countryIso2 || 'CL').trim().toUpperCase();
    const profile = params.siiTaxProfile || {};
    const scope: 'SII_CL' | 'INTERNATIONAL' =
        profile.taxRegimeScope === 'INTERNATIONAL' || country !== 'CL' ? 'INTERNATIONAL' : 'SII_CL';

    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    if (scope === 'SII_CL') {
        const rutRes = normalizeSiiXmlRut(profile.siiRutNormalized || params.supplierTaxId);
        const rznSoc = String(profile.siiRznSoc || params.legalName || '').trim();
        const giroEmis = String(profile.siiGiroEmis || '').trim();
        const actecoOk =
            Array.isArray(profile.actecoCodes) && profile.actecoCodes.some((c) => /^\d{6}$/.test(String(c || '').trim()));
        const addrOk =
            String(profile.taxAddressDir || '').trim().length >= 3 &&
            String(profile.taxComuna || '').trim().length >= 2 &&
            String(profile.taxCiudad || '').trim().length >= 2;
        const dteMailOk = emailRx.test(String(profile.dteInterchangeEmail || '').trim());

        const checks: SupplierTaxReadinessCheck[] = [
            { code: 'sii_rut', passed: rutRes.valid },
            { code: 'sii_rzn_soc', passed: rznSoc.length >= 2 && rznSoc.length <= 100 },
            { code: 'sii_giro_emis', passed: giroEmis.length >= 3 && giroEmis.length <= 80 },
            { code: 'sii_acteco', passed: actecoOk },
            { code: 'sii_address', passed: addrOk },
            { code: 'sii_dte_email', passed: dteMailOk },
        ];
        const score = checks.filter((c) => c.passed).length;
        return {
            scope: 'SII_CL',
            score,
            total: checks.length,
            isReady: score === checks.length,
            checks,
        };
    }

    const intlTaxOk = String(profile.foreignTaxId || params.supplierTaxId || '').trim().length >= 4;
    const intlNameOk = String(profile.siiRznSoc || params.legalName || '').trim().length >= 2;
    const intlAddrOk =
        String(profile.taxAddressDir || '').trim().length >= 3 &&
        (String(profile.taxCiudad || '').trim().length >= 2 || String(profile.taxComuna || '').trim().length >= 2);
    const intlMailOk = emailRx.test(String(profile.apBillingEmail || profile.dteInterchangeEmail || '').trim());

    const checks: SupplierTaxReadinessCheck[] = [
        { code: 'intl_tax_id', passed: intlTaxOk },
        { code: 'intl_legal_name', passed: intlNameOk },
        { code: 'intl_tax_address', passed: intlAddrOk },
        { code: 'intl_billing_email', passed: intlMailOk },
    ];
    const score = checks.filter((c) => c.passed).length;
    return {
        scope: 'INTERNATIONAL',
        score,
        total: checks.length,
        isReady: score === checks.length,
        checks,
    };
}

function mapChannelToDefaultAreaName(ch: CommercialChannelType): string {
    switch (ch) {
        case 'NEW':
            return 'Equipos Nuevos';
        case 'USED':
            return 'Equipos Usados';
        case 'RENTAL':
            return 'Arriendo Operativo';
        case 'PARTS':
            return 'Repuestos';
        case 'SERVICE':
            return 'Servicio Técnico';
        default:
            return 'Comercial';
    }
}

function inferLegacyChannelsFromAreaName(areaName: string): CommercialChannelType[] {
    const norm = normalizeSupplierAreaKey(areaName);
    const channels: CommercialChannelType[] = [];
    if (norm.includes('nuevo')) channels.push('NEW');
    if (norm.includes('usad') || norm.includes('reman') || norm.includes('reacond')) channels.push('USED');
    if (norm.includes('arriend') || norm.includes('renta') || norm.includes('rental')) channels.push('RENTAL');
    if (norm.includes('serv') || norm.includes('tall') || norm.includes('mant') || norm.includes('postventa'))
        channels.push('SERVICE');
    if (
        norm.includes('repuest') ||
        norm.includes('part') ||
        norm.includes('lubri') ||
        norm.includes('neum') ||
        norm.includes('filtr') ||
        norm.includes('component') ||
        channels.length === 0
    ) {
        channels.push('PARTS');
    }
    return Array.from(new Set(channels)).slice(0, 5);
}

function normalizeSupplierSiiTaxProfile(
    rawProfile: any,
    countryIso2: string,
    supplierTaxId?: string | null,
    legalName?: string | null
): SupplierSiiTaxProfile {
    const raw = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
    const taxRegimeScope: 'SII_CL' | 'INTERNATIONAL' =
        raw.taxRegimeScope === 'INTERNATIONAL' || (countryIso2 !== 'CL' && raw.taxRegimeScope !== 'SII_CL')
            ? 'INTERNATIONAL'
            : 'SII_CL';

    const rutCandidate = raw.siiRutNormalized || (taxRegimeScope === 'SII_CL' ? supplierTaxId : null);
    const rutCheck = taxRegimeScope === 'SII_CL' ? normalizeSiiXmlRut(rutCandidate) : null;

    const siiRznSoc = cleanOptionalText(raw.siiRznSoc ?? legalName, 100);
    const siiGiroEmis = cleanOptionalText(raw.siiGiroEmis, 80);
    const siiGiroRecep = cleanOptionalText(raw.siiGiroRecep, 40) ?? deriveSiiGiroRecep40(siiGiroEmis);

    const actecoCodes = Array.isArray(raw.actecoCodes)
        ? Array.from(
              new Set(
                  raw.actecoCodes
                      .map((c: unknown) => String(c || '').replace(/\D/g, '').slice(0, 6))
                      .filter((c: string) => /^\d{6}$/.test(c))
              )
          ).slice(0, 4)
        : [];

    const validDteSet = new Set<number>(SII_DTE_DOCUMENT_TYPES as readonly number[]);
    const supportedDteTypes: SiiDteDocumentType[] = Array.isArray(raw.supportedDteTypes)
        ? Array.from(
              new Set<SiiDteDocumentType>(
                  raw.supportedDteTypes
                      .map((v: unknown) => Number(v))
                      .filter((n: number): n is SiiDteDocumentType => validDteSet.has(n))
              )
          ).slice(0, 7)
        : [...EMPTY_SUPPLIER_SII_TAX_PROFILE.supportedDteTypes];

    const branchOffices = Array.isArray(raw.branchOffices)
        ? raw.branchOffices
              .filter((b: any) => b && typeof b === 'object' && String(b.branchName || '').trim())
              .slice(0, 24)
              .map((b: any) => ({
                  cdgSiiSucur: b.cdgSiiSucur ? String(b.cdgSiiSucur).replace(/\D/g, '').slice(0, 9) || null : null,
                  branchName: String(b.branchName).trim().slice(0, 120),
                  dirOrigin: String(b.dirOrigin || '').trim().slice(0, 70) || '-',
                  cmnaOrigin: String(b.cmnaOrigin || '').trim().slice(0, 20) || '-',
                  ciudadOrigin: String(b.ciudadOrigin || '').trim().slice(0, 20) || '-',
              }))
        : [];

    return {
        taxRegimeScope,
        siiRutNormalized: rutCheck?.valid ? rutCheck.normalizedXmlRut : cleanOptionalText(raw.siiRutNormalized, 10),
        siiRutDisplay: rutCheck?.valid ? rutCheck.displayRut : cleanOptionalText(raw.siiRutDisplay, 16),
        siiRznSoc,
        siiGiroEmis,
        siiGiroRecep,
        actecoCodes: actecoCodes as string[],
        taxAddressDir: cleanOptionalText(raw.taxAddressDir, 70),
        taxComuna: cleanOptionalText(raw.taxComuna, 20),
        taxCiudad: cleanOptionalText(raw.taxCiudad, 20),
        cdgSiiSucur: raw.cdgSiiSucur ? String(raw.cdgSiiSucur).replace(/\D/g, '').slice(0, 9) || null : null,
        branchOffices,
        dteInterchangeEmail: cleanOptionalText(raw.dteInterchangeEmail, 80),
        apBillingEmail: cleanOptionalText(raw.apBillingEmail, 180),
        supportedDteTypes: supportedDteTypes.length > 0 ? supportedDteTypes : [33, 52, 56, 61],
        isDteCertified: Boolean(raw.isDteCertified),
        foreignTaxId: cleanOptionalText(
            raw.foreignTaxId ?? (taxRegimeScope === 'INTERNATIONAL' ? supplierTaxId : null),
            48
        ),
        verifiedAt: typeof raw.verifiedAt === 'number' ? raw.verifiedAt : null,
    };
}

function normalizeSupplierContactsList(
    rawContacts: unknown,
    divisions: SupplierDivision[],
    fallbackUpdatedAt: number
): SupplierContactEntry[] {
    if (Array.isArray(rawContacts) && rawContacts.length > 0) {
        const seenIds = new Set<string>();
        const out: SupplierContactEntry[] = [];
        for (let idx = 0; idx < rawContacts.length; idx += 1) {
            const c = rawContacts[idx];
            if (!c || typeof c !== 'object') continue;
            const rec = c as Record<string, any>;
            const areaName = String(rec.areaName || '').trim().slice(0, 120);
            if (areaName.length < 2) continue;
            const areaKey = normalizeSupplierAreaKey(String(rec.areaKey || areaName));
            const rawId = String(rec.contactId || `cnt_${areaKey.slice(0, 24)}_${idx + 1}`).trim().slice(0, 120);
            const contactId = seenIds.has(rawId) ? `${rawId.slice(0, 100)}_${idx + 1}` : rawId;
            seenIds.add(contactId);
            out.push({
                contactId,
                areaName,
                areaKey,
                contactLabel: cleanOptionalText(rec.contactLabel, 160),
                phone: cleanOptionalText(rec.phone, 64),
                roleEmail: cleanOptionalText(rec.roleEmail, 180),
                portalUrl: cleanOptionalText(rec.portalUrl, 512),
                cityRegion: cleanOptionalText(rec.cityRegion, 120),
                manufacturerKeys: normalizeManufacturerKeyList(rec.manufacturerKeys),
                isOfficialDealer: rec.isOfficialDealer !== false,
                legacyChannels: Array.isArray(rec.legacyChannels) ? normalizeChannels(rec.legacyChannels) : undefined,
                notes: cleanOptionalText(rec.notes, 600),
                updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : fallbackUpdatedAt,
            });
        }
        if (out.length > 0) return out;
    }

    // Proyección retroactiva limpia desde `divisions[]` legadas sin mutar la BD hasta edición HITL
    const projected: SupplierContactEntry[] = [];
    for (let dIdx = 0; dIdx < divisions.length; dIdx += 1) {
        const div = divisions[dIdx];
        const fallbackArea =
            div.channels.length === 1
                ? mapChannelToDefaultAreaName(div.channels[0])
                : div.divisionName || mapChannelToDefaultAreaName(div.channels[0] || 'PARTS');
        const areaName = fallbackArea.trim().slice(0, 120);
        const areaKey = normalizeSupplierAreaKey(areaName);
        if (div.branches && div.branches.length > 0) {
            for (let bIdx = 0; bIdx < div.branches.length; bIdx += 1) {
                const br = div.branches[bIdx];
                projected.push({
                    contactId: `proj_${div.divisionId}_${bIdx + 1}`.slice(0, 120),
                    areaName,
                    areaKey,
                    contactLabel: br.branchName ? br.branchName.slice(0, 160) : null,
                    phone: br.phone || null,
                    roleEmail: br.roleEmail || null,
                    portalUrl: br.portalUrl || null,
                    cityRegion: br.city ? `${br.city}${br.regionIso ? ` (${br.regionIso})` : ''}` : null,
                    manufacturerKeys: div.manufacturerKeys || [],
                    isOfficialDealer: div.isOfficialDealer !== false,
                    legacyChannels: div.channels,
                    notes: div.divisionName !== areaName ? div.divisionName : null,
                    updatedAt: fallbackUpdatedAt,
                });
            }
        } else {
            projected.push({
                contactId: `proj_${div.divisionId}_base`.slice(0, 120),
                areaName,
                areaKey,
                contactLabel: div.divisionName.slice(0, 160),
                phone: null,
                roleEmail: null,
                portalUrl: null,
                cityRegion: div.territories.join(', ').slice(0, 120) || null,
                manufacturerKeys: div.manufacturerKeys || [],
                isOfficialDealer: div.isOfficialDealer !== false,
                legacyChannels: div.channels,
                notes: null,
                updatedAt: fallbackUpdatedAt,
            });
        }
    }
    return projected;
}

function normalizeSlug(raw: string, maxLen = 110): string {
    return String(raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, maxLen);
}

export function normalizeTaxIdCompact(rawTaxId?: string | null): string | null {
    const raw = String(rawTaxId || '').trim();
    if (!raw || /RESERVAD[OA]|REDACTED|\[|\]|PENDIENTE|N\/A|NONE|NULL/i.test(raw)) {
        return null;
    }
    const clean = raw
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .trim();
    if (!clean || clean.length < 5 || !/\d/.test(clean)) return null;
    return clean.slice(0, 32);
}

export function buildSupplierKey(
    countryIso2: string,
    taxId?: string | null,
    fallbackName?: string
): string {
    const iso = (countryIso2 || 'CL').trim().toUpperCase().slice(0, 2) || 'CL';
    const compactTax = normalizeTaxIdCompact(taxId);
    if (compactTax) {
        return `${iso.toLowerCase()}_${compactTax.toLowerCase()}`;
    }
    const slug = normalizeSlug(fallbackName || 'supplier', 96) || 'supplier';
    return `${iso.toLowerCase()}_${slug}`;
}

function normalizeArchetypeFilters(raw?: string[]): MachineryArchetypeFilterId[] {
    const validSet = new Set<string>(['ALL', ...MANUFACTURER_MACHINERY_ARCHETYPE_IDS]);
    const filtered = (raw || []).filter((id) => validSet.has(id)) as MachineryArchetypeFilterId[];
    if (filtered.length === 0) return ['ALL'];
    if (filtered.length > 1 && filtered.includes('ALL')) {
        return Array.from(new Set(filtered.filter((id) => id !== 'ALL')));
    }
    return Array.from(new Set(filtered)).slice(0, 17);
}

function normalizeChannels(raw?: string[]): CommercialChannelType[] {
    const valid = new Set<string>(COMMERCIAL_CHANNEL_TYPES);
    const out = (raw || []).filter((c) => valid.has(c)) as CommercialChannelType[];
    return out.length > 0 ? Array.from(new Set(out)).slice(0, 5) : ['PARTS'];
}

function normalizeManufacturerKeyList(rawList?: Array<string | null | undefined>, single?: string | null): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [...(rawList || []), single || '']) {
        const key = normalizeManufacturerKey(String(candidate || ''));
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
        if (out.length >= 32) break;
    }
    return out;
}

function normalizeTerritories(raw?: string[], countryIso2 = 'CL'): string[] {
    const out = Array.from(
        new Set(
            (raw || [])
                .map((t) => String(t || '').trim().toUpperCase())
                .filter((t) => t.length >= 2)
        )
    ).slice(0, 24);
    return out.length > 0 ? out : [`${countryIso2}-NATIONAL`];
}

function mergeBranches(existing: SupplierBranch[], incoming: SupplierBranch[]): SupplierBranch[] {
    const map = new Map<string, SupplierBranch>();
    for (const item of [...existing, ...incoming]) {
        const bName = String(item.branchName || '').trim();
        const city = String(item.city || '').trim();
        if (!bName || !city) continue;
        const key = `${normalizeSlug(bName, 60)}::${normalizeSlug(city, 40)}`;
        const prev = map.get(key);
        map.set(key, {
            branchName: bName.slice(0, 160),
            city: city.slice(0, 120),
            regionIso: item.regionIso?.trim() || prev?.regionIso || null,
            phone: item.phone?.trim() || prev?.phone || null,
            roleEmail: item.roleEmail?.trim() || prev?.roleEmail || null,
            portalUrl: item.portalUrl?.trim() || prev?.portalUrl || null,
        });
    }
    return Array.from(map.values()).slice(0, 24);
}

/**
 * Convierte cualquier documento de proveedor (actual con `divisions[]` o legado con `representations[]`)
 * en divisiones operativas normalizadas sin requerir migración manual bloqueante.
 */
export function normalizeSupplierDivisions(raw: Partial<SupplierEntity>): SupplierDivision[] {
    if (Array.isArray(raw.divisions) && raw.divisions.length > 0) {
        return raw.divisions.map((d, idx) => ({
            divisionId: normalizeSlug(d.divisionId || d.divisionName || `div_${idx + 1}`, 80) || `div_${idx + 1}`,
            divisionName: String(d.divisionName || `División ${idx + 1}`).trim().slice(0, 180),
            isOfficialDealer: d.isOfficialDealer !== false,
            channels: normalizeChannels(d.channels),
            manufacturerKeys: normalizeManufacturerKeyList(d.manufacturerKeys),
            archetypeIds: normalizeArchetypeFilters(d.archetypeIds),
            territories: normalizeTerritories(d.territories, raw.countryIso2 || 'CL'),
            branches: Array.isArray(d.branches) ? d.branches.slice(0, 24) : [],
        }));
    }

    const legacyReps: SupplierRepresentation[] = Array.isArray(raw.representations) ? raw.representations : [];
    return legacyReps.map((rep, idx) => {
        const repKey = normalizeManufacturerKey(rep.manufacturerKey);
        const channels = normalizeChannels(rep.channels);
        const hasBranchData = Boolean(rep.branchName || rep.city || rep.phone || rep.roleEmail || rep.portalUrl);
        return {
            divisionId: normalizeSlug(`${repKey || 'general'}_${channels[0] || idx}`, 80) || `legacy_div_${idx}`,
            divisionName: rep.branchName
                ? String(rep.branchName).trim().slice(0, 180)
                : `División ${channels.join(' / ')}`,
            isOfficialDealer: rep.isOfficial !== false,
            channels,
            manufacturerKeys: repKey ? [repKey] : [],
            archetypeIds: normalizeArchetypeFilters(rep.archetypeIds),
            territories: normalizeTerritories(rep.territories, raw.countryIso2 || 'CL'),
            branches: hasBranchData
                ? [
                      {
                          branchName: String(rep.branchName || raw.tradeName || 'Sucursal Principal').slice(0, 160),
                          city: String(rep.city || 'Casa Matriz').slice(0, 120),
                          regionIso: rep.territories?.[0] || null,
                          phone: rep.phone || null,
                          roleEmail: rep.roleEmail || null,
                          portalUrl: rep.portalUrl || null,
                      },
                  ]
                : [],
        };
    });
}

function hydrateSupplierEntity(docId: string, raw: Record<string, any>): SupplierEntity {
    const countryIso2 = String(raw.countryIso2 || 'CL').trim().toUpperCase().slice(0, 2) || 'CL';
    const updatedAt = Number(raw.updatedAt || Date.now());
    const divisions = normalizeSupplierDivisions({
        ...(raw as Partial<SupplierEntity>),
        countryIso2,
    });
    const contacts = normalizeSupplierContactsList(raw.contacts, divisions, updatedAt);
    const mfgUnion = Array.from(
        new Set([
            ...normalizeManufacturerKeyList(raw.manufacturerKeys),
            ...divisions.flatMap((d) => d.manufacturerKeys || []),
            ...contacts.flatMap((c) => c.manufacturerKeys || []),
        ])
    );

    const tradeName = String(raw.tradeName || raw.legalName || docId);
    const legalName = String(raw.legalName || raw.tradeName || docId);
    const supplierTaxId = raw.supplierTaxId ? String(raw.supplierTaxId) : null;
    const siiTaxProfile = normalizeSupplierSiiTaxProfile(raw.siiTaxProfile, countryIso2, supplierTaxId, legalName);
    const taxReadiness = computeSupplierTaxReadiness({
        countryIso2,
        supplierTaxId,
        legalName,
        siiTaxProfile,
    });

    return {
        supplierKey: docId,
        tradeName,
        legalName,
        countryIso2,
        supplierTaxId,
        officialWebsiteUrl: raw.officialWebsiteUrl ? String(raw.officialWebsiteUrl) : null,
        x402SellerWalletId: raw.x402SellerWalletId ? String(raw.x402SellerWalletId) : null,
        manufacturerKeys: mfgUnion,
        divisions,
        contacts,
        siiTaxProfile,
        taxReadiness,
        createdAt: Number(raw.createdAt || Date.now()),
        updatedAt,
    };
}

const SUPPLIER_DISCOVERY_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        suppliers: {
            type: Type.ARRAY,
            description:
                'Lista de empresas proveedoras, distribuidoras autorizadas o especialistas y sus divisiones comerciales verificadas.',
            items: {
                type: Type.OBJECT,
                properties: {
                    tradeName: { type: Type.STRING },
                    legalName: { type: Type.STRING, nullable: true },
                    countryIso2: { type: Type.STRING, nullable: true },
                    supplierTaxId: { type: Type.STRING, nullable: true },
                    officialWebsiteUrl: { type: Type.STRING, nullable: true },
                    divisionName: { type: Type.STRING },
                    isOfficialDealer: { type: Type.BOOLEAN },
                    channels: { type: Type.ARRAY, items: { type: Type.STRING } },
                    manufacturerNames: { type: Type.ARRAY, items: { type: Type.STRING } },
                    archetypeIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                    territories: { type: Type.ARRAY, items: { type: Type.STRING } },
                    branches: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                branchName: { type: Type.STRING },
                                city: { type: Type.STRING },
                                regionIso: { type: Type.STRING, nullable: true },
                                phone: { type: Type.STRING, nullable: true },
                                roleEmail: { type: Type.STRING, nullable: true },
                                portalUrl: { type: Type.STRING, nullable: true },
                            },
                            required: ['branchName', 'city'],
                        },
                    },
                },
                required: ['tradeName', 'divisionName', 'channels'],
            },
        },
    },
    required: ['suppliers'],
};

const AiPass2EnvelopeLooseSchema = z.object({
    suppliers: z.array(z.record(z.string(), z.any())).max(20).default([]),
});

interface CoercedRawAiSupplierItem {
    tradeName: string;
    legalName: string | null;
    countryIso2: string | null;
    supplierTaxId: string | null;
    officialWebsiteUrl: string | null;
    divisionName: string;
    isOfficialDealer: boolean;
    channels: string[];
    manufacturerNames: string[];
    archetypeIds: string[];
    territories: string[];
    branches: Array<{
        branchName: string;
        city: string;
        regionIso: string | null;
        phone: string | null;
        roleEmail: string | null;
        portalUrl: string | null;
    }>;
    contacts: Array<{
        areaName: string;
        contactLabel: string | null;
        phone: string | null;
        roleEmail: string | null;
        portalUrl: string | null;
        cityRegion: string | null;
        notes: string | null;
    }>;
    siiGiroEmis: string | null;
    taxAddressDir: string | null;
    taxComuna: string | null;
    taxCiudad: string | null;
    dteInterchangeEmail: string | null;
}

function cleanOptionalText(val: unknown, maxLen: number): string | null {
    if (typeof val !== 'string' && typeof val !== 'number') return null;
    const trimmed = String(val).trim();
    if (!trimmed || /^(null|undefined|n\/a|nd|pendiente)$/i.test(trimmed)) return null;
    if (/RESERVAD[OA]|REDACTED/i.test(trimmed)) return null;
    return trimmed.slice(0, maxLen);
}

function cleanStringArray(val: unknown, maxItems: number): string[] {
    if (!Array.isArray(val)) return [];
    return val
        .map((v) => cleanOptionalText(v, 140))
        .filter((v): v is string => Boolean(v))
        .slice(0, maxItems);
}

function tryExtractSuppliersFromJsonText(rawText: string): unknown[] | null {
    const text = String(rawText || '').trim();
    if (!text) return null;

    const candidates: string[] = [];
    const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;
    while ((match = fenceRegex.exec(text)) !== null) {
        if (match[1]?.trim()) {
            candidates.push(match[1].trim());
        }
    }

    candidates.push(text);

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        candidates.push(text.slice(firstBrace, lastBrace + 1).trim());
    }

    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        candidates.push(text.slice(firstBracket, lastBracket + 1).trim());
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) {
                return parsed;
            }
            if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, any>).suppliers)) {
                return (parsed as Record<string, any>).suppliers;
            }
        } catch {
            // Probar siguiente candidato JSON
        }
    }
    return null;
}

function coerceRawAiSupplierItems(rawList: unknown[]): CoercedRawAiSupplierItem[] {
    const out: CoercedRawAiSupplierItem[] = [];
    for (const raw of rawList) {
        if (!raw || typeof raw !== 'object') continue;
        const rec = raw as Record<string, any>;

        const tradeName =
            cleanOptionalText(rec.tradeName, 180) ||
            cleanOptionalText(rec.name, 180) ||
            cleanOptionalText(rec.companyName, 180) ||
            cleanOptionalText(rec.legalName, 180);
        if (!tradeName || tradeName.length < 2) continue;

        const legalName = cleanOptionalText(rec.legalName ?? rec.legal_name, 220);
        const countryIso2 = cleanOptionalText(rec.countryIso2 ?? rec.country_iso2, 4);
        const supplierTaxId = cleanOptionalText(rec.supplierTaxId ?? rec.taxId ?? rec.rut ?? rec.supplier_tax_id, 48);
        const officialWebsiteUrl = cleanOptionalText(
            rec.officialWebsiteUrl ?? rec.websiteUrl ?? rec.website ?? rec.official_website_url,
            512
        );

        const rawChannels = cleanStringArray(rec.channels, 5).map((c) => c.toUpperCase());
        const channels = normalizeChannels(rawChannels);

        const rawDivision = cleanOptionalText(rec.divisionName ?? rec.division ?? rec.division_name, 180);
        const divisionName =
            rawDivision && rawDivision.length >= 2 ? rawDivision : `División ${channels.join(' / ')}`;

        const isOfficialDealer =
            typeof rec.isOfficialDealer === 'boolean'
                ? rec.isOfficialDealer
                : typeof rec.isOfficial === 'boolean'
                  ? rec.isOfficial
                  : true;

        const manufacturerNames = cleanStringArray(rec.manufacturerNames ?? rec.brands, 24);
        const archetypeIds = cleanStringArray(rec.archetypeIds, 17);
        const territories = cleanStringArray(rec.territories, 16);

        const rawBranches = Array.isArray(rec.branches) ? rec.branches : [];
        const branches: CoercedRawAiSupplierItem['branches'] = [];
        for (const br of rawBranches.slice(0, 8)) {
            if (!br || typeof br !== 'object') continue;
            const brObj = br as Record<string, any>;
            const city = cleanOptionalText(brObj.city ?? brObj.ciudad, 120);
            if (!city) continue;
            const branchName =
                cleanOptionalText(brObj.branchName ?? brObj.name ?? brObj.sucursal, 160) || `Sucursal ${city}`;
            branches.push({
                branchName: branchName.slice(0, 160),
                city: city.slice(0, 120),
                regionIso: cleanOptionalText(brObj.regionIso ?? brObj.region ?? brObj.region_iso, 40),
                phone: cleanOptionalText(brObj.phone ?? brObj.telefono, 64),
                roleEmail: cleanOptionalText(brObj.roleEmail ?? brObj.email ?? brObj.role_email, 180),
                portalUrl: cleanOptionalText(brObj.portalUrl ?? brObj.portal_url ?? brObj.url, 512),
            });
        }

        const rawContacts = Array.isArray(rec.contacts) ? rec.contacts : [];
        const contacts: CoercedRawAiSupplierItem['contacts'] = [];
        for (const cnt of rawContacts.slice(0, 16)) {
            if (!cnt || typeof cnt !== 'object') continue;
            const cntObj = cnt as Record<string, any>;
            const areaName = cleanOptionalText(cntObj.areaName ?? cntObj.area ?? cntObj.division, 120);
            if (!areaName || areaName.length < 2) continue;
            contacts.push({
                areaName,
                contactLabel: cleanOptionalText(cntObj.contactLabel ?? cntObj.label ?? cntObj.role, 160),
                phone: cleanOptionalText(cntObj.phone ?? cntObj.telefono, 64),
                roleEmail: cleanOptionalText(cntObj.roleEmail ?? cntObj.email, 180),
                portalUrl: cleanOptionalText(cntObj.portalUrl ?? cntObj.url, 512),
                cityRegion: cleanOptionalText(cntObj.cityRegion ?? cntObj.city ?? cntObj.region, 120),
                notes: cleanOptionalText(cntObj.notes, 400),
            });
        }

        out.push({
            tradeName,
            legalName,
            countryIso2,
            supplierTaxId,
            officialWebsiteUrl,
            divisionName,
            isOfficialDealer,
            channels,
            manufacturerNames,
            archetypeIds: archetypeIds.length > 0 ? archetypeIds : ['ALL'],
            territories,
            branches,
            contacts,
            siiGiroEmis: cleanOptionalText(rec.siiGiroEmis ?? rec.giroEmis ?? rec.giro, 80),
            taxAddressDir: cleanOptionalText(rec.taxAddressDir ?? rec.address, 70),
            taxComuna: cleanOptionalText(rec.taxComuna ?? rec.comuna, 20),
            taxCiudad: cleanOptionalText(rec.taxCiudad ?? rec.ciudad, 20),
            dteInterchangeEmail: cleanOptionalText(rec.dteInterchangeEmail ?? rec.dteEmail, 80),
        });
        if (out.length >= 12) break;
    }
    return out;
}

interface DivisionMergeInput {
    tradeName: string;
    legalName?: string | null;
    countryIso2: string;
    supplierTaxId?: string | null;
    officialWebsiteUrl?: string | null;
    x402SellerWalletId?: string | null;
    divisionId?: string;
    divisionName: string;
    isOfficialDealer: boolean;
    channels: CommercialChannelType[];
    manufacturerKeys: string[];
    archetypeIds: MachineryArchetypeFilterId[];
    territories: string[];
    branches: SupplierBranch[];
}

export class SupplierChannelResolverService {
    private static async mergeDivisionIntoSupplier(
        input: DivisionMergeInput,
        nowMs: number
    ): Promise<SupplierEntity> {
        const countryIso2 = (input.countryIso2 || 'CL').trim().toUpperCase().slice(0, 2) || 'CL';
        const cleanTaxId = normalizeTaxIdCompact(input.supplierTaxId);
        const supplierKey = buildSupplierKey(countryIso2, cleanTaxId, input.tradeName);
        const docRef = db.collection(SUPPLIERS_COL).doc(supplierKey);
        const snap = await docRef.get();

        const existingEntity = snap.exists ? hydrateSupplierEntity(snap.id, snap.data() || {}) : null;
        const safeWebsite = await filterSafeHttpsUrl(input.officialWebsiteUrl);

        const sanitizedBranches: SupplierBranch[] = [];
        for (const b of input.branches || []) {
            const safePortal = await filterSafeHttpsUrl(b.portalUrl);
            const safeEmail = sanitizeFunctionalCorporateEmail(b.roleEmail);
            const safePhone = sanitizeCorporatePhone(b.phone);
            sanitizedBranches.push({
                branchName: b.branchName.trim().slice(0, 160),
                city: b.city.trim().slice(0, 120),
                regionIso: b.regionIso?.trim() || null,
                phone: safePhone,
                roleEmail: safeEmail,
                portalUrl: safePortal,
            });
        }

        const existingDivisions = existingEntity ? [...existingEntity.divisions] : [];
        const desiredDivId = normalizeSlug(input.divisionId || input.divisionName, 80) || 'div_general';
        const desiredDivNameLower = input.divisionName.trim().toLowerCase();

        const existingIdx = existingDivisions.findIndex(
            (d) => d.divisionId === desiredDivId || d.divisionName.trim().toLowerCase() === desiredDivNameLower
        );

        const nextMfgKeys = normalizeManufacturerKeyList(input.manufacturerKeys);
        const nextChannels = normalizeChannels(input.channels);
        const nextArchetypes = normalizeArchetypeFilters(input.archetypeIds);
        const nextTerritories = normalizeTerritories(input.territories, countryIso2);

        if (existingIdx >= 0) {
            const prev = existingDivisions[existingIdx];
            existingDivisions[existingIdx] = {
                divisionId: prev.divisionId,
                divisionName: input.divisionName.trim().slice(0, 180) || prev.divisionName,
                isOfficialDealer: input.isOfficialDealer,
                channels: normalizeChannels([...prev.channels, ...nextChannels]),
                manufacturerKeys: normalizeManufacturerKeyList([...prev.manufacturerKeys, ...nextMfgKeys]),
                archetypeIds: normalizeArchetypeFilters([
                    ...prev.archetypeIds.filter((a) => a !== 'ALL' || nextArchetypes.includes('ALL')),
                    ...nextArchetypes,
                ]),
                territories: normalizeTerritories([...prev.territories, ...nextTerritories], countryIso2),
                branches: mergeBranches(prev.branches || [], sanitizedBranches),
            };
        } else {
            existingDivisions.push({
                divisionId: desiredDivId,
                divisionName: input.divisionName.trim().slice(0, 180),
                isOfficialDealer: input.isOfficialDealer,
                channels: nextChannels,
                manufacturerKeys: nextMfgKeys,
                archetypeIds: nextArchetypes,
                territories: nextTerritories,
                branches: sanitizedBranches,
            });
        }

        const nextManufacturerKeys = normalizeManufacturerKeyList([
            ...existingDivisions.flatMap((d) => d.manufacturerKeys || []),
            ...(existingEntity?.contacts || []).flatMap((c) => c.manufacturerKeys || []),
            ...input.manufacturerKeys,
        ]);
        const nextTaxId = cleanTaxId || existingEntity?.supplierTaxId || null;
        const nextLegalName = (input.legalName || existingEntity?.legalName || input.tradeName).trim().slice(0, 220);
        const nextSiiProfile = normalizeSupplierSiiTaxProfile(
            existingEntity?.siiTaxProfile,
            countryIso2,
            nextTaxId,
            nextLegalName
        );

        const rawEntityToPersist: Record<string, any> = {
            supplierKey,
            tradeName: input.tradeName.trim().slice(0, 180),
            legalName: nextLegalName,
            countryIso2,
            supplierTaxId: nextTaxId,
            officialWebsiteUrl: safeWebsite || existingEntity?.officialWebsiteUrl || null,
            x402SellerWalletId:
                input.x402SellerWalletId?.trim() || existingEntity?.x402SellerWalletId || null,
            manufacturerKeys: nextManufacturerKeys,
            divisions: existingDivisions,
            contacts: existingEntity?.contacts || [],
            siiTaxProfile: nextSiiProfile,
            createdAt: existingEntity?.createdAt || nowMs,
            updatedAt: nowMs,
        };

        await docRef.set(rawEntityToPersist, { merge: true });
        return hydrateSupplierEntity(supplierKey, rawEntityToPersist);
    }

    public static async listSuppliers(filters?: {
        manufacturerKey?: string;
        channelType?: CommercialChannelType;
        countryIso2?: string;
        q?: string;
    }): Promise<SupplierEntity[]> {
        const cleanMfg = filters?.manufacturerKey ? normalizeManufacturerKey(filters.manufacturerKey) : '';
        const snap = await db.collection(SUPPLIERS_COL).get();
        let suppliers = snap.docs.map((d) => hydrateSupplierEntity(d.id, d.data() || {}));

        if (cleanMfg) {
            suppliers = suppliers.filter(
                (s) =>
                    s.manufacturerKeys.includes(cleanMfg) ||
                    s.divisions.some((d) => d.manufacturerKeys.includes(cleanMfg)) ||
                    (s.contacts || []).some((c) => (c.manufacturerKeys || []).includes(cleanMfg))
            );
        }
        if (filters?.channelType) {
            suppliers = suppliers.filter(
                (s) =>
                    s.divisions.some((d) => d.channels.includes(filters.channelType!)) ||
                    (s.contacts || []).some((c) => (c.legacyChannels || []).includes(filters.channelType!))
            );
        }
        if (filters?.countryIso2) {
            const iso = filters.countryIso2.trim().toUpperCase();
            suppliers = suppliers.filter((s) => s.countryIso2 === iso);
        }
        if (filters?.q && filters.q.trim()) {
            const qNorm = filters.q.trim().toLowerCase();
            suppliers = suppliers.filter(
                (s) =>
                    s.tradeName.toLowerCase().includes(qNorm) ||
                    s.legalName.toLowerCase().includes(qNorm) ||
                    (s.supplierTaxId || '').toLowerCase().includes(qNorm) ||
                    (s.siiTaxProfile?.siiRutDisplay || '').toLowerCase().includes(qNorm) ||
                    s.manufacturerKeys.some((m) => m.includes(qNorm)) ||
                    (s.contacts || []).some(
                        (c) =>
                            c.areaName.toLowerCase().includes(qNorm) ||
                            (c.contactLabel || '').toLowerCase().includes(qNorm) ||
                            (c.cityRegion || '').toLowerCase().includes(qNorm)
                    ) ||
                    s.divisions.some(
                        (d) =>
                            d.divisionName.toLowerCase().includes(qNorm) ||
                            d.branches.some(
                                (b) =>
                                    b.branchName.toLowerCase().includes(qNorm) ||
                                    b.city.toLowerCase().includes(qNorm)
                            )
                    )
            );
        }

        suppliers.sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'es'));
        return suppliers;
    }

    public static async getSupplierByKey(supplierKey: string): Promise<SupplierEntity | null> {
        const cleanKey = normalizeSlug(supplierKey, 120);
        if (!cleanKey) return null;
        const snap = await db.collection(SUPPLIERS_COL).doc(cleanKey).get();
        if (!snap.exists) return null;
        return hydrateSupplierEntity(snap.id, snap.data() || {});
    }

    /**
     * Registra o actualiza una empresa proveedora y su división operativa / sucursal en `global_suppliers`.
     * Deduplicado por `countryIso2 + supplierTaxId` (o slug comercial). Requiere `"ACTUALIZAR"`.
     */
    public static async upsertSupplierDivision(
        params: UpsertSupplierBody & { actorUid: string; actorEmail?: string }
    ): Promise<SupplierEntity> {
        const nowMs = Date.now();
        const combinedMfgKeys = normalizeManufacturerKeyList(params.manufacturerKeys, params.manufacturerKey);
        const branchList: SupplierBranch[] =
            params.branchName || params.city || params.phone || params.roleEmail || params.portalUrl
                ? [
                      {
                          branchName: (params.branchName || `${params.tradeName} · Sucursal`).trim(),
                          city: (params.city || 'Casa Matriz').trim(),
                          regionIso: params.regionIso?.trim() || params.territories?.[0] || null,
                          phone: params.phone || null,
                          roleEmail: params.roleEmail || null,
                          portalUrl: params.portalUrl || null,
                      },
                  ]
                : [];

        const saved = await this.mergeDivisionIntoSupplier(
            {
                tradeName: params.tradeName,
                legalName: params.legalName || params.tradeName,
                countryIso2: params.countryIso2 || 'CL',
                supplierTaxId: params.supplierTaxId,
                officialWebsiteUrl: params.officialWebsiteUrl,
                x402SellerWalletId: params.x402SellerWalletId,
                divisionId: params.divisionId,
                divisionName: params.divisionName || 'División Comercial General',
                isOfficialDealer: params.isOfficialDealer !== false,
                channels: params.channels,
                manufacturerKeys: combinedMfgKeys,
                archetypeIds: params.archetypeIds || ['ALL'],
                territories: params.territories || ['NATIONAL'],
                branches: branchList,
            },
            nowMs
        );

        await AuditLedger.record({
            tenantId: 'global',
            actorUid: params.actorUid,
            actorEmail: params.actorEmail || 'dev@minreport.com',
            action: 'OPERMAQ_SUPPLIER_DIVISION_UPSERT',
            module: 'opermaq',
            targetEntity: saved.supplierKey,
            details: {
                tradeName: saved.tradeName,
                divisionName: params.divisionName,
                channels: params.channels,
                manufacturerKeys: combinedMfgKeys,
            },
        }).catch(() => {});

        return saved;
    }

    /**
     * Investigación IA posterior de distribuidores y estructura de divisiones (`global_suppliers` ONLY).
     * Pasada 1: `useGoogleSearch: true` + `requireGroundedEvidence: true` solicitando JSON canónico directo
     * para evitar reinyectar datos corporativos por la esclusa PII y reducir latencia ~50%.
     * Pasada 2 (Rescate): `Temperature: 0` + `responseSchema (Type.OBJECT)` solo si Pasada 1 devolvió prosa sin JSON.
     * Cero escritura automática (HITL obligatorio) y propagación Fail-Closed de errores del Enjambre IA.
     */
    public static async discoverSuppliersWithAi(
        params: DiscoverSuppliersAiBody & { actorUid?: string }
    ): Promise<{
        regionQuery: string;
        manufacturerKey: string | null;
        suggestions: AiSupplierSuggestion[];
        groundingSources: Array<{ title: string; uri: string }>;
        modelUsed: string;
        latencyMs: number;
    }> {
        const startedAt = Date.now();
        const rawCountryIso2 = params.countryIso2 ? params.countryIso2.trim().toUpperCase().slice(0, 2) : '';
        const countryLabel = rawCountryIso2 ? resolveCountryDisplayName(rawCountryIso2) : '';
        const rawRegionInput = (params.regionQuery || '').trim();
        const effectiveRegionRaw =
            rawRegionInput && rawCountryIso2 && !rawRegionInput.toUpperCase().includes(countryLabel.toUpperCase())
                ? `${countryLabel} (${rawCountryIso2}) — ${rawRegionInput}`
                : rawRegionInput || countryLabel || rawCountryIso2 || 'Chile';
        const regionClean = ConfidentialityAirlockService.scrubDeterministicPii(
            effectiveRegionRaw,
            'CL'
        ).scrubbed;
        const brandClean = params.brandQuery
            ? ConfidentialityAirlockService.scrubDeterministicPii(params.brandQuery.trim(), 'CL').scrubbed
            : '';
        const focusClean = params.queryFocus
            ? ConfidentialityAirlockService.scrubDeterministicPii(params.queryFocus.trim(), 'CL').scrubbed
            : '';

        const candidateBrandInput = params.manufacturerKey?.trim() || brandClean;
        let targetMfgKey: string | null = candidateBrandInput
            ? normalizeManufacturerKey(candidateBrandInput) || null
            : null;
        let resolvedOem: ManufacturerRecord | null = null;

        if (candidateBrandInput) {
            if (targetMfgKey) {
                resolvedOem = await ManufacturerRegistryService.getManufacturerByKey(targetMfgKey);
            }
            if (!resolvedOem) {
                const canonicalHit = detectCanonicalMake(candidateBrandInput);
                if (canonicalHit) {
                    const canonicalKey = normalizeManufacturerKey(canonicalHit);
                    if (canonicalKey) {
                        resolvedOem = await ManufacturerRegistryService.getManufacturerByKey(canonicalKey);
                        if (resolvedOem) {
                            targetMfgKey = resolvedOem.manufacturerKey;
                        } else if (!targetMfgKey) {
                            targetMfgKey = canonicalKey;
                        }
                    }
                }
            }
            if (!resolvedOem) {
                const allOems = await ManufacturerRegistryService.listManufacturers().catch(() => []);
                const normNeedle = normalizeManufacturerKey(candidateBrandInput);
                const lowerNeedle = candidateBrandInput.toLowerCase();
                resolvedOem =
                    allOems.find((m) => {
                        if (normNeedle && m.manufacturerKey === normNeedle) return true;
                        if (m.officialName.toLowerCase() === lowerNeedle) return true;
                        if (normNeedle && normalizeManufacturerKey(m.officialName) === normNeedle) return true;
                        return (m.aliases || []).some(
                            (al) =>
                                al.toLowerCase() === lowerNeedle ||
                                (normNeedle && normalizeManufacturerKey(al) === normNeedle)
                        );
                    }) || null;
                if (resolvedOem) {
                    targetMfgKey = resolvedOem.manufacturerKey;
                }
            }
        }

        let oemContextLine = 'Todos los fabricantes industriales / maquinaria pesada y vehículos comerciales';
        if (resolvedOem) {
            const parts: string[] = [
                `${resolvedOem.officialName}${resolvedOem.legalCorporateName ? ` (${resolvedOem.legalCorporateName})` : ''}`,
                `Web OEM: ${resolvedOem.officialWebsiteUrl || 'N/D'}`,
            ];
            if (resolvedOem.officialContacts?.dealerLocatorUrl) {
                parts.push(`Localizador oficial dealers OEM: ${resolvedOem.officialContacts.dealerLocatorUrl}`);
            }
            if (resolvedOem.officialContacts?.officialPartsUrl) {
                parts.push(`Portal oficial repuestos OEM: ${resolvedOem.officialContacts.officialPartsUrl}`);
            }
            if (resolvedOem.sampleModels?.length) {
                parts.push(`Modelos de referencia: ${resolvedOem.sampleModels.slice(0, 6).join(', ')}`);
            }
            oemContextLine = parts.join(' — ');
        } else if (candidateBrandInput) {
            oemContextLine = `${brandClean || targetMfgKey || candidateBrandInput} (marca OEM objetiva en modo Zero-Preset; consultar red oficial de distribuidores y especialistas)`;
        }

        const channelFocusLine =
            params.channelFocus && params.channelFocus !== 'ALL'
                ? `\nCanal / división comercial prioritaria: ${params.channelFocus}.`
                : '';

        const jsonContractInstructions = `Responde ÚNICAMENTE con un objeto JSON válido bajo la estructura exacta { "suppliers": [ ... ] } (máximo 12 elementos), donde cada elemento representa una división comercial verificada de una empresa proveedora/distribuidora con estas llaves exactas:
- "tradeName": string (nombre comercial de la empresa)
- "legalName": string | null (razón social legal si figura publicada)
- "countryIso2": string (código ISO-2 en mayúsculas, ej. "CL", "PE", "BR", "US")
- "supplierTaxId": string | null (RUT o ID tributario corporativo público si aparece en fuentes oficiales)
- "officialWebsiteUrl": string | null (URL https:// oficial de la empresa)
- "divisionName": string (nombre de la división comercial, ej. "División Minería y Repuestos")
- "isOfficialDealer": boolean (true si es distribuidor/concesionario oficial autorizado del fabricante, false si es especialista multimarca independiente)
- "channels": arreglo usando SOLO valores exactos de [${COMMERCIAL_CHANNEL_TYPES.join(', ')}]
- "manufacturerNames": arreglo con marcas atendidas por esa división
- "archetypeIds": arreglo usando SOLO ["ALL"] o IDs de [${MANUFACTURER_MACHINERY_ARCHETYPE_IDS.join(', ')}]
- "territories": arreglo de cobertura territorial (ej. ["CL", "CL-AN"])
- "branches": arreglo de sucursales relevantes en "${regionClean}" con llaves "branchName", "city", "regionIso", "phone", "roleEmail", "portalUrl" (usar solo teléfonos de mesa central pública y correos funcionales de rol como ventas@, repuestos@, contacto@; PROHIBIDO incluir datos de personas naturales)
- "contacts": arreglo opcional de áreas comerciales reales del distribuidor en ese país sin perfiles prefijados ("areaName", "contactLabel", "phone", "roleEmail", "portalUrl", "cityRegion") según la naturaleza de su industria (ej. Repuestos, Equipos Nuevos, Equipos Usados, Lubricantes, Arriendo, Servicio Técnico, Neumáticos OTR)
- "siiGiroEmis", "taxAddressDir", "taxComuna", "taxCiudad", "dteInterchangeEmail": campos tributarios públicos SOLO si constan explícitamente en fuentes oficiales (si no constan, null).`;

        const pass1Prompt = `Investiga distribuidores autorizados, concesionarios locales, representantes de repuestos, arriendo y talleres multimarca industriales reales en: "${regionClean}".
Fabricante / enfoque objetivo: ${oemContextLine}.${channelFocusLine}${focusClean ? `\nEnfoque operacional adicional: ${focusClean}.` : ''}

Reglas estrictas de veracidad:
1. Basa cada empresa, división, RUT tributario público, sitio web HTTPS y sucursal únicamente en las fuentes web consultadas con Google Search.
2. Prohibido inventar URLs, teléfonos, correos o RUTs no verificados en las fuentes consultadas. Si un dato no consta, usa null.

${jsonContractInstructions}`;

        // Fail-Closed: propagar AISwarmUnavailableError (503) o UngroundedEvidenceError (422) sin silenciar con catch {}.
        const pass1Res = await ResilientAIClient.generate({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            temperature: 0.1,
            useGoogleSearch: true,
            requireGroundedEvidence: true,
            prompt: pass1Prompt,
        });

        const pass1Text = pass1Res.text || '';
        const groundingSources: GroundingSource[] = pass1Res.groundingSources || [];
        let modelUsed = pass1Res.model || 'fallback-deterministic';

        if (!pass1Text.trim() && groundingSources.length === 0) {
            return {
                regionQuery: regionClean,
                manufacturerKey: targetMfgKey,
                suggestions: [],
                groundingSources: [],
                modelUsed,
                latencyMs: Date.now() - startedAt,
            };
        }

        const pass1Extracted = tryExtractSuppliersFromJsonText(pass1Text);
        let coercedItems: CoercedRawAiSupplierItem[] = [];

        if (pass1Extracted !== null) {
            coercedItems = coerceRawAiSupplierItems(pass1Extracted);
        } else {
            const sourcesText =
                groundingSources.length > 0
                    ? groundingSources.map((s, idx) => `[${idx + 1}] ${s.title} -> ${s.uri}`).join('\n')
                    : '[SIN_FUENTES_GROUNDING_ADICIONALES]';

            const pass2Prompt = `Extrae de forma estricta las empresas proveedoras/distribuidoras y sus divisiones operacionales encontradas en PASADA 1 para la zona "${regionClean}" y marca "${oemContextLine}".
${jsonContractInstructions}

EVIDENCIA PASADA 1:
"""
${pass1Text.slice(0, 14000)}
"""

FUENTES:
${sourcesText}`;

            const aiRes = await ResilientAIClient.generateStructured(
                {
                    module: 'opermaq',
                    preferredTier: 'SECONDARY',
                    temperature: 0,
                    useGoogleSearch: false,
                    responseSchema: SUPPLIER_DISCOVERY_RESPONSE_SCHEMA,
                    prompt: pass2Prompt,
                },
                AiPass2EnvelopeLooseSchema
            );

            coercedItems = coerceRawAiSupplierItems(aiRes.data?.suppliers || []);
            modelUsed = aiRes.meta?.model || modelUsed;
        }

        const candidateUrls = new Set<string>();
        for (const item of coercedItems) {
            if (item.officialWebsiteUrl) candidateUrls.add(item.officialWebsiteUrl);
            for (const b of item.branches) {
                if (b.portalUrl) candidateUrls.add(b.portalUrl);
            }
            for (const c of item.contacts || []) {
                if (c.portalUrl) candidateUrls.add(c.portalUrl);
            }
        }
        for (const src of groundingSources) {
            if (src?.uri) candidateUrls.add(src.uri);
        }

        const safeUrlMap = new Map<string, string | null>();
        await Promise.all(
            Array.from(candidateUrls).map(async (rawUrl) => {
                safeUrlMap.set(rawUrl, await filterSafeHttpsUrl(rawUrl));
            })
        );

        const suggestions: AiSupplierSuggestion[] = [];
        for (let i = 0; i < coercedItems.length; i += 1) {
            const item = coercedItems[i];
            const safeWebsite = item.officialWebsiteUrl ? safeUrlMap.get(item.officialWebsiteUrl) ?? null : null;
            const countryIso2 =
                item.countryIso2 && /^[A-Za-z]{2}$/.test(item.countryIso2.trim())
                    ? item.countryIso2.trim().toUpperCase()
                    : rawCountryIso2 || 'CL';
            const cleanBranches: SupplierBranch[] = item.branches.map((b) => ({
                branchName: b.branchName.trim().slice(0, 160),
                city: b.city.trim().slice(0, 120),
                regionIso: b.regionIso?.trim() || null,
                phone: sanitizeCorporatePhone(b.phone),
                roleEmail: sanitizeFunctionalCorporateEmail(b.roleEmail),
                portalUrl: b.portalUrl ? safeUrlMap.get(b.portalUrl) ?? null : null,
            }));

            const cleanContacts: AiSupplierContactHint[] = (item.contacts || []).map((c) => ({
                areaName: c.areaName.trim().slice(0, 120),
                contactLabel: c.contactLabel
                    ? ConfidentialityAirlockService.scrubDeterministicPii(c.contactLabel, countryIso2).scrubbed.slice(0, 160)
                    : null,
                phone: sanitizeCorporatePhone(c.phone),
                roleEmail: sanitizeFunctionalCorporateEmail(c.roleEmail),
                portalUrl: c.portalUrl ? safeUrlMap.get(c.portalUrl) ?? null : null,
                cityRegion: c.cityRegion ? c.cityRegion.trim().slice(0, 120) : null,
                notes: c.notes
                    ? ConfidentialityAirlockService.scrubDeterministicPii(c.notes, countryIso2).scrubbed.slice(0, 400)
                    : null,
            }));

            const derivedKeys = normalizeManufacturerKeyList(
                item.manufacturerNames,
                targetMfgKey || undefined
            );

            suggestions.push({
                suggestionId: normalizeSlug(`${item.tradeName}_${item.divisionName}_${i + 1}`, 72) || `sug_${i + 1}`,
                tradeName: item.tradeName.trim().slice(0, 180),
                legalName: item.legalName?.trim().slice(0, 220) || item.tradeName.trim().slice(0, 220),
                countryIso2,
                supplierTaxId: normalizeTaxIdCompact(item.supplierTaxId),
                officialWebsiteUrl: safeWebsite,
                divisionName: item.divisionName.trim().slice(0, 180),
                isOfficialDealer: item.isOfficialDealer !== false,
                channels: normalizeChannels(item.channels),
                manufacturerKeys: derivedKeys,
                archetypeIds: normalizeArchetypeFilters(item.archetypeIds),
                territories: normalizeTerritories(item.territories, countryIso2),
                branches: cleanBranches,
                contacts: cleanContacts,
                siiGiroEmis: item.siiGiroEmis ? item.siiGiroEmis.trim().slice(0, 80) : null,
                taxAddressDir: item.taxAddressDir ? item.taxAddressDir.trim().slice(0, 70) : null,
                taxComuna: item.taxComuna ? item.taxComuna.trim().slice(0, 20) : null,
                taxCiudad: item.taxCiudad ? item.taxCiudad.trim().slice(0, 20) : null,
                dteInterchangeEmail: sanitizeFunctionalCorporateEmail(item.dteInterchangeEmail)?.slice(0, 80) || null,
            });
        }

        const verifiedSources: GroundingSource[] = [];
        const seenSourceUris = new Set<string>();
        for (const src of groundingSources) {
            const safeUri = src?.uri ? safeUrlMap.get(src.uri) ?? null : null;
            if (!safeUri || seenSourceUris.has(safeUri)) continue;
            seenSourceUris.add(safeUri);
            verifiedSources.push({ title: String(src.title || safeUri).trim(), uri: safeUri });
        }

        return {
            regionQuery: regionClean,
            manufacturerKey: targetMfgKey,
            suggestions: suggestions.slice(0, 12),
            groundingSources: verifiedSources,
            modelUsed,
            latencyMs: Date.now() - startedAt,
        };
    }

    /**
     * Aprueba e incorpora sugerencias IA de proveedores/divisiones al maestro `global_suppliers` tras revisión HITL ("ACTUALIZAR").
     */
    public static async approveSupplierAiSuggestions(params: {
        suggestions: AiSupplierSuggestion[];
        actorUid: string;
        actorEmail?: string;
    }): Promise<{ suppliers: SupplierEntity[]; approvedCount: number }> {
        const nowMs = Date.now();
        const savedMap = new Map<string, SupplierEntity>();

        for (const s of params.suggestions || []) {
            let entity = await this.mergeDivisionIntoSupplier(
                {
                    tradeName: s.tradeName,
                    legalName: s.legalName || s.tradeName,
                    countryIso2: s.countryIso2 || 'CL',
                    supplierTaxId: s.supplierTaxId,
                    officialWebsiteUrl: s.officialWebsiteUrl,
                    divisionName: s.divisionName,
                    isOfficialDealer: s.isOfficialDealer !== false,
                    channels: s.channels,
                    manufacturerKeys: s.manufacturerKeys,
                    archetypeIds: s.archetypeIds,
                    territories: s.territories,
                    branches: s.branches || [],
                },
                nowMs
            );

            const hasExtraContacts = Array.isArray(s.contacts) && s.contacts.length > 0;
            const hasSiiHint = Boolean(
                s.siiGiroEmis || s.taxAddressDir || s.taxComuna || s.taxCiudad || s.dteInterchangeEmail
            );
            if (hasExtraContacts || hasSiiHint) {
                const existingContacts = [...(entity.contacts || [])];
                for (let idx = 0; idx < (s.contacts || []).length; idx += 1) {
                    const c = s.contacts[idx];
                    const areaKey = normalizeSupplierAreaKey(c.areaName);
                    const dedupSig = `${areaKey}|${(c.contactLabel || '').toLowerCase()}|${(c.cityRegion || '').toLowerCase()}|${(c.roleEmail || '').toLowerCase()}`;
                    const dup = existingContacts.some(
                        (ec) =>
                            `${ec.areaKey}|${(ec.contactLabel || '').toLowerCase()}|${(ec.cityRegion || '').toLowerCase()}|${(ec.roleEmail || '').toLowerCase()}` ===
                            dedupSig
                    );
                    if (!dup) {
                        existingContacts.push({
                            contactId: `ai_${areaKey.slice(0, 20)}_${nowMs.toString(36)}_${idx + 1}`,
                            areaName: c.areaName.trim().slice(0, 120),
                            areaKey,
                            contactLabel: c.contactLabel || null,
                            phone: sanitizeCorporatePhone(c.phone),
                            roleEmail: sanitizeFunctionalCorporateEmail(c.roleEmail),
                            portalUrl: await filterSafeHttpsUrl(c.portalUrl),
                            cityRegion: c.cityRegion || null,
                            manufacturerKeys: normalizeManufacturerKeyList(s.manufacturerKeys),
                            isOfficialDealer: s.isOfficialDealer !== false,
                            legacyChannels: inferLegacyChannelsFromAreaName(c.areaName),
                            notes: c.notes || null,
                            updatedAt: nowMs,
                        });
                    }
                }
                const nextSii = normalizeSupplierSiiTaxProfile(
                    {
                        ...(entity.siiTaxProfile || {}),
                        siiGiroEmis: entity.siiTaxProfile?.siiGiroEmis || s.siiGiroEmis || null,
                        taxAddressDir: entity.siiTaxProfile?.taxAddressDir || s.taxAddressDir || null,
                        taxComuna: entity.siiTaxProfile?.taxComuna || s.taxComuna || null,
                        taxCiudad: entity.siiTaxProfile?.taxCiudad || s.taxCiudad || null,
                        dteInterchangeEmail:
                            entity.siiTaxProfile?.dteInterchangeEmail || s.dteInterchangeEmail || null,
                    },
                    entity.countryIso2,
                    entity.supplierTaxId,
                    entity.legalName
                );
                await db.collection(SUPPLIERS_COL).doc(entity.supplierKey).set(
                    {
                        contacts: existingContacts,
                        siiTaxProfile: nextSii,
                        updatedAt: nowMs,
                    },
                    { merge: true }
                );
                entity = hydrateSupplierEntity(entity.supplierKey, {
                    ...entity,
                    contacts: existingContacts,
                    siiTaxProfile: nextSii,
                    updatedAt: nowMs,
                });
            }

            savedMap.set(entity.supplierKey, entity);
        }

        const suppliers = Array.from(savedMap.values());
        await AuditLedger.record({
            tenantId: 'global',
            actorUid: params.actorUid,
            actorEmail: params.actorEmail || 'dev@minreport.com',
            action: 'OPERMAQ_SUPPLIER_AI_APPROVED',
            module: 'opermaq',
            targetEntity: suppliers.map((x) => x.supplierKey).join(',').slice(0, 180) || 'global_suppliers',
            details: {
                approvedSuggestionsCount: params.suggestions.length,
                persistedSuppliersCount: suppliers.length,
            },
        }).catch(() => {});

        return {
            suppliers,
            approvedCount: params.suggestions.length,
        };
    }

    /**
     * Resuelve canales oficiales, especialistas multimarca y agenda privada por empresa,
     * marca, arquetipo, intención comercial (PARTS/RENTAL/NEW/USED/SERVICE) y región.
     * Usado tanto en UI como en endpoint agéntico `GET /api/m2m/suppliers/resolve` (`x402`).
     */
    public static async resolveSupplierChannels(params: {
        manufacturerKey?: string | null;
        make?: string | null;
        archetypeId?: ManufacturerMachineryArchetypeId | null;
        equipmentClass?: string | null;
        regionIso?: string | null;
        channelIntent?: CommercialChannelType | null;
        areaQuery?: string | null;
        includeIndependentSpecialists?: boolean;
        tenantId?: string | null;
    }): Promise<ResolveSupplierChannelsResult> {
        const startedAt = Date.now();
        const rawMake = params.make ? detectCanonicalMake(params.make) || params.make : '';
        const manufacturerKey = params.manufacturerKey
            ? normalizeManufacturerKey(params.manufacturerKey) || null
            : rawMake
            ? normalizeManufacturerKey(rawMake) || null
            : null;

        let archetypeId: ManufacturerMachineryArchetypeId | null = params.archetypeId || null;
        if (!archetypeId && params.equipmentClass) {
            const resolvedArch = resolveMachineryArchetype(params.equipmentClass);
            if (
                resolvedArch?.id &&
                (MANUFACTURER_MACHINERY_ARCHETYPE_IDS as readonly string[]).includes(resolvedArch.id)
            ) {
                archetypeId = resolvedArch.id as ManufacturerMachineryArchetypeId;
            }
        }

        const regionNorm = params.regionIso ? params.regionIso.trim().toUpperCase() : null;
        const regionCountry = regionNorm && regionNorm.includes('-') ? regionNorm.split('-')[0] : regionNorm;
        const areaQueryNorm = params.areaQuery ? normalizeSupplierAreaKey(params.areaQuery) : null;
        const areaQueryRaw = params.areaQuery ? params.areaQuery.trim().toLowerCase() : null;

        const allSuppliers = await this.listSuppliers();
        const officialMatches: ResolvedSupplierMatch[] = [];
        const independentMatches: ResolvedSupplierMatch[] = [];

        for (const supplier of allSuppliers) {
            const matchingContacts =
                areaQueryNorm || areaQueryRaw
                    ? (supplier.contacts || []).filter(
                          (c) =>
                              (!manufacturerKey ||
                                  c.manufacturerKeys.length === 0 ||
                                  c.manufacturerKeys.includes(manufacturerKey)) &&
                              (c.areaKey.includes(areaQueryNorm || '') ||
                                  c.areaName.toLowerCase().includes(areaQueryRaw || '') ||
                                  (c.contactLabel || '').toLowerCase().includes(areaQueryRaw || '') ||
                                  (c.notes || '').toLowerCase().includes(areaQueryRaw || ''))
                      )
                    : [];

            for (const div of supplier.divisions) {
                const brandMatched = manufacturerKey ? div.manufacturerKeys.includes(manufacturerKey) : true;

                if (manufacturerKey && !brandMatched) {
                    const isMultiBrandSpecialistAllowed =
                        !div.isOfficialDealer &&
                        params.includeIndependentSpecialists !== false &&
                        div.manufacturerKeys.length === 0;
                    if (!isMultiBrandSpecialistAllowed) continue;
                }

                if (!div.isOfficialDealer && params.includeIndependentSpecialists === false) {
                    continue;
                }

                if (params.channelIntent && !div.channels.includes(params.channelIntent)) {
                    continue;
                }

                const exactArch = archetypeId ? div.archetypeIds.includes(archetypeId) : false;
                const allArch = div.archetypeIds.includes('ALL');
                if (archetypeId && !exactArch && !allArch) {
                    continue;
                }

                let territoryScore = 0;
                if (regionNorm) {
                    const exactTerr = div.territories.some((t) => t.toUpperCase() === regionNorm);
                    const branchRegionMatch = div.branches.some(
                        (b) =>
                            (b.regionIso && b.regionIso.toUpperCase() === regionNorm) ||
                            b.city.toUpperCase().includes(regionNorm)
                    );
                    const nationalMatch = div.territories.some(
                        (t) =>
                            t.toUpperCase() === 'NATIONAL' ||
                            t.toUpperCase() === `${supplier.countryIso2}-NATIONAL` ||
                            t.toUpperCase() === 'GLOBAL' ||
                            t.toUpperCase() === 'LATAM'
                    );
                    const sameCountry = regionCountry && regionCountry.length === 2 && supplier.countryIso2 === regionCountry;

                    if (exactTerr || branchRegionMatch) {
                        territoryScore = 35;
                    } else if (nationalMatch && (!regionCountry || regionCountry.length !== 2 || sameCountry)) {
                        territoryScore = 15;
                    } else if (div.territories.includes('GLOBAL')) {
                        territoryScore = 10;
                    } else {
                        continue;
                    }
                }

                const divMatchesArea =
                    areaQueryRaw &&
                    (div.divisionName.toLowerCase().includes(areaQueryRaw) || matchingContacts.length > 0);
                if (areaQueryRaw && !divMatchesArea) {
                    continue;
                }

                const score =
                    (div.isOfficialDealer ? 100 : 50) +
                    (brandMatched && manufacturerKey ? 30 : 0) +
                    (params.channelIntent ? 25 : 0) +
                    (divMatchesArea ? 25 : 0) +
                    (exactArch ? 20 : 10) +
                    territoryScore +
                    (div.branches.length > 0 ? 10 : 0);

                const match: ResolvedSupplierMatch = {
                    supplier,
                    division: div,
                    isOfficial: div.isOfficialDealer,
                    score,
                    matchedAreaName: matchingContacts[0]?.areaName || (divMatchesArea ? div.divisionName : null),
                };

                if (div.isOfficialDealer) {
                    officialMatches.push(match);
                } else {
                    independentMatches.push(match);
                }
            }

            // Si el proveedor solo tiene contactos en `contacts[]` para el `areaQuery` (sin match previo por `divisions`)
            if (
                areaQueryRaw &&
                matchingContacts.length > 0 &&
                !officialMatches.some((m) => m.supplier.supplierKey === supplier.supplierKey) &&
                !independentMatches.some((m) => m.supplier.supplierKey === supplier.supplierKey) &&
                (!manufacturerKey || supplier.manufacturerKeys.includes(manufacturerKey))
            ) {
                const firstCnt = matchingContacts[0];
                const synthDiv: SupplierDivision = {
                    divisionId: `area_${firstCnt.areaKey}`.slice(0, 80),
                    divisionName: firstCnt.areaName,
                    isOfficialDealer: firstCnt.isOfficialDealer !== false,
                    channels: firstCnt.legacyChannels || inferLegacyChannelsFromAreaName(firstCnt.areaName),
                    manufacturerKeys: firstCnt.manufacturerKeys.length ? firstCnt.manufacturerKeys : supplier.manufacturerKeys,
                    archetypeIds: ['ALL'],
                    territories: [supplier.countryIso2],
                    branches: [
                        {
                            branchName: firstCnt.contactLabel || firstCnt.areaName,
                            city: firstCnt.cityRegion || supplier.countryIso2,
                            regionIso: null,
                            phone: firstCnt.phone || null,
                            roleEmail: firstCnt.roleEmail || null,
                            portalUrl: firstCnt.portalUrl || null,
                        },
                    ],
                };
                const match: ResolvedSupplierMatch = {
                    supplier,
                    division: synthDiv,
                    isOfficial: synthDiv.isOfficialDealer,
                    score: (synthDiv.isOfficialDealer ? 100 : 50) + 45,
                    matchedAreaName: firstCnt.areaName,
                };
                if (synthDiv.isOfficialDealer) officialMatches.push(match);
                else independentMatches.push(match);
            }
        }

        officialMatches.sort((a, b) => b.score - a.score);
        independentMatches.sort((a, b) => b.score - a.score);

        let tenantPrivateContacts: TenantPrivateSupplierContact[] = [];
        if (params.tenantId) {
            const allPrivate = await this.listTenantPrivateContacts(params.tenantId);
            tenantPrivateContacts = allPrivate.filter((c) => {
                if (manufacturerKey && c.manufacturerKey !== manufacturerKey) return false;
                if (params.channelIntent && c.channelType !== params.channelIntent) return false;
                if (
                    areaQueryRaw &&
                    !(c.areaName || '').toLowerCase().includes(areaQueryRaw) &&
                    !(c.areaKey || '').includes(areaQueryNorm || '') &&
                    !(c.notes || '').toLowerCase().includes(areaQueryRaw)
                ) {
                    return false;
                }
                return true;
            });
        }

        return {
            query: {
                manufacturerKey,
                archetypeId,
                regionIso: regionNorm,
                channelIntent: params.channelIntent || null,
                areaQuery: params.areaQuery?.trim() || null,
            },
            officialMatches,
            independentMatches,
            tenantPrivateContacts,
            latencyMs: Date.now() - startedAt,
        };
    }

    public static async listTenantPrivateContacts(
        tenantId: string,
        filters?: { manufacturerKey?: string; supplierKey?: string }
    ): Promise<TenantPrivateSupplierContact[]> {
        if (!tenantId) return [];
        const snap = await db
            .collection('accounts')
            .doc(tenantId)
            .collection(PRIVATE_CONTACTS_SUBCOL)
            .get();

        let items = snap.docs.map((d) => {
            const raw = d.data() || {};
            return {
                contactId: d.id,
                tenantId,
                supplierKey: raw.supplierKey ? String(raw.supplierKey) : null,
                manufacturerKey: raw.manufacturerKey ? String(raw.manufacturerKey) : null,
                distributorName: String(raw.distributorName || ''),
                areaName: raw.areaName ? String(raw.areaName) : null,
                areaKey: raw.areaKey ? String(raw.areaKey) : null,
                contactLabel: raw.contactLabel ? String(raw.contactLabel) : null,
                channelType: raw.channelType || 'PARTS',
                cityRegion: String(raw.cityRegion || ''),
                phone: raw.phone || null,
                emailOrWeb: raw.emailOrWeb || null,
                notes: raw.notes || null,
                createdByUid: String(raw.createdByUid || ''),
                createdAt: Number(raw.createdAt || Date.now()),
                updatedAt: Number(raw.updatedAt || Date.now()),
            } as TenantPrivateSupplierContact;
        });

        if (filters?.manufacturerKey) {
            const normMfg = normalizeManufacturerKey(filters.manufacturerKey);
            if (normMfg) {
                items = items.filter((c) => c.manufacturerKey === normMfg);
            }
        }
        if (filters?.supplierKey) {
            const cleanSup = normalizeSlug(filters.supplierKey, 120);
            items = items.filter((c) => c.supplierKey === cleanSup);
        }

        return items.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    public static async upsertTenantPrivateContact(
        params: UpsertTenantPrivateContactBody & { tenantId: string; actorUid: string; actorEmail?: string }
    ): Promise<TenantPrivateSupplierContact> {
        const colRef = db.collection('accounts').doc(params.tenantId).collection(PRIVATE_CONTACTS_SUBCOL);
        const contactId =
            params.contactId?.trim() ||
            `priv_${normalizeSlug(params.distributorName, 36)}_${Date.now().toString(36)}`;
        const docRef = colRef.doc(contactId);
        const existingSnap = await docRef.get();
        const nowMs = Date.now();

        const normalizedMfgKey = params.manufacturerKey
            ? normalizeManufacturerKey(params.manufacturerKey) || null
            : null;
        const cleanAreaName = params.areaName?.trim() ? params.areaName.trim().slice(0, 120) : null;
        const cleanAreaKey = cleanAreaName ? normalizeSupplierAreaKey(cleanAreaName) : null;

        const payload: TenantPrivateSupplierContact = {
            contactId,
            tenantId: params.tenantId,
            supplierKey: params.supplierKey?.trim() ? normalizeSlug(params.supplierKey, 120) : null,
            manufacturerKey: normalizedMfgKey,
            distributorName: params.distributorName.trim(),
            areaName: cleanAreaName,
            areaKey: cleanAreaKey,
            contactLabel: params.contactLabel?.trim() ? params.contactLabel.trim().slice(0, 160) : null,
            channelType: params.channelType || 'PARTS',
            cityRegion: params.cityRegion.trim(),
            phone: params.phone?.trim() || null,
            emailOrWeb: params.emailOrWeb?.trim() || null,
            notes: params.notes?.trim() || null,
            createdByUid: existingSnap.exists ? String(existingSnap.data()?.createdByUid || params.actorUid) : params.actorUid,
            createdAt: existingSnap.exists ? Number(existingSnap.data()?.createdAt || nowMs) : nowMs,
            updatedAt: nowMs,
        };

        await docRef.set(payload, { merge: true });

        await AuditLedger.record({
            tenantId: params.tenantId,
            actorUid: params.actorUid,
            actorEmail: params.actorEmail || 'user@minreport.com',
            action: 'OPERMAQ_TENANT_PRIVATE_CONTACT_UPSERT',
            module: 'opermaq',
            targetEntity: contactId,
            details: {
                supplierKey: payload.supplierKey,
                manufacturerKey: normalizedMfgKey,
                areaName: payload.areaName,
                channelType: payload.channelType,
            },
        }).catch(() => {});

        return payload;
    }

    public static async deleteTenantPrivateContact(params: {
        tenantId: string;
        contactId: string;
        actorUid: string;
        actorEmail?: string;
    }): Promise<void> {
        await db
            .collection('accounts')
            .doc(params.tenantId)
            .collection(PRIVATE_CONTACTS_SUBCOL)
            .doc(params.contactId)
            .delete();

        await AuditLedger.record({
            tenantId: params.tenantId,
            actorUid: params.actorUid,
            actorEmail: params.actorEmail || 'user@minreport.com',
            action: 'OPERMAQ_TENANT_PRIVATE_CONTACT_DELETE',
            module: 'opermaq',
            targetEntity: params.contactId,
            details: {},
        }).catch(() => {});
    }

    public static async listContributions(
        status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
    ): Promise<SupplierContactContribution[]> {
        const base = db.collection(CONTRIBUTIONS_COL);
        const snap = status ? await base.where('status', '==', status).get() : await base.get();
        return snap.docs
            .map((d) => ({ ...(d.data() as SupplierContactContribution), contributionId: d.id }))
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * Registra aporte de red B2B con purga obligatoria de PII (Ley N° 19.628 / Ley N° 21.719)
     * mediante `ConfidentialityAirlockService` + seudonimización SHA-256 de tenant.
     */
    public static async submitSupplierContribution(
        params: SubmitSupplierContributionBody & { tenantId: string; actorUid: string }
    ): Promise<SupplierContactContribution> {
        const nowMs = Date.now();
        const countryIso2 = (params.countryIso2 || 'CL').trim().toUpperCase().slice(0, 2) || 'CL';
        const purgedTypes = new Set<string>();
        let purgedCount = 0;

        const scrubField = (raw?: string | null): string | null => {
            if (!raw || !raw.trim()) return null;
            const res = ConfidentialityAirlockService.scrubDeterministicPii(raw.trim(), countryIso2);
            res.redactedCategories.forEach((t: string) => purgedTypes.add(t));
            purgedCount += res.redactedCategories.length;
            return res.scrubbed;
        };

        const scrubbedDistributor = scrubField(params.distributorName) || params.distributorName.trim();
        const scrubbedCity = scrubField(params.cityRegion) || params.cityRegion.trim();
        const scrubbedNotes = scrubField(params.notes);
        const scrubbedPhone = sanitizeCorporatePhone(scrubField(params.phone));

        const cleanRoleEmail = sanitizeFunctionalCorporateEmail(params.roleEmail);
        if (params.roleEmail && params.roleEmail.trim() && !cleanRoleEmail) {
            purgedTypes.add('PERSONAL_OR_INVALID_EMAIL');
            purgedCount += 1;
        }
        const safePortalUrl = await filterSafeHttpsUrl(params.portalUrl);

        const tenantHash = createHash('sha256')
            .update(`minreport-ley21719:${params.tenantId}`)
            .digest('hex');

        const contributionId = `contrib_${normalizeSlug(scrubbedDistributor, 32)}_${nowMs.toString(36)}`;
        const mfgKey = params.manufacturerKey ? normalizeManufacturerKey(params.manufacturerKey) || null : null;

        const record: SupplierContactContribution = {
            contributionId,
            manufacturerKey: mfgKey,
            distributorName: scrubbedDistributor,
            channelType: params.channelType,
            countryIso2,
            cityRegion: scrubbedCity,
            roleEmail: cleanRoleEmail,
            phone: scrubbedPhone,
            portalUrl: safePortalUrl,
            sanitizedNotes: scrubbedNotes,
            piiPurgedTypes: Array.from(purgedTypes),
            piiPurgedCount: purgedCount,
            status: 'PENDING_REVIEW',
            submittedByTenantHash: tenantHash,
            createdAt: nowMs,
            reviewedAt: null,
            reviewedByUid: null,
            ttlExpiresAt: null,
        };

        await db.collection(CONTRIBUTIONS_COL).doc(contributionId).set(record);
        return record;
    }

    /**
     * Moderación HITL 1º DEV sobre aportes de red:
     * - APPROVE: consolida empresa + división en `global_suppliers` (aunque `manufacturerKey` sea null).
     * - REJECT: marca `REJECTED` y fija `ttlExpiresAt` a 30 días exactos (Ley N° 21.719).
     */
    public static async moderateSupplierContribution(params: {
        contributionId: string;
        decision: 'APPROVE' | 'REJECT';
        actorUid: string;
        actorEmail?: string;
    }): Promise<{ contribution: SupplierContactContribution; supplier?: SupplierEntity }> {
        const docRef = db.collection(CONTRIBUTIONS_COL).doc(params.contributionId);
        const snap = await docRef.get();
        if (!snap.exists) {
            const err: any = new Error('Aporte no encontrado.');
            err.statusCode = 404;
            throw err;
        }

        const current = { ...(snap.data() as SupplierContactContribution), contributionId: snap.id };
        const nowMs = Date.now();

        if (params.decision === 'REJECT') {
            const ttlExpiresAt = computeThirtyDayTtlTimestamp(nowMs);
            const updated: SupplierContactContribution = {
                ...current,
                status: 'REJECTED',
                reviewedAt: nowMs,
                reviewedByUid: params.actorUid,
                ttlExpiresAt,
            };
            await docRef.set(updated, { merge: true });
            return { contribution: updated };
        }

        const supplier = await this.mergeDivisionIntoSupplier(
            {
                tradeName: current.distributorName,
                legalName: current.distributorName,
                countryIso2: current.countryIso2 || 'CL',
                officialWebsiteUrl: current.portalUrl || null,
                divisionName: `División ${current.channelType}`,
                isOfficialDealer: false,
                channels: [current.channelType],
                manufacturerKeys: current.manufacturerKey ? [current.manufacturerKey] : [],
                archetypeIds: ['ALL'],
                territories: [current.cityRegion],
                branches: [
                    {
                        branchName: `${current.distributorName} · ${current.cityRegion}`,
                        city: current.cityRegion,
                        regionIso: null,
                        phone: current.phone || null,
                        roleEmail: current.roleEmail || null,
                        portalUrl: current.portalUrl || null,
                    },
                ],
            },
            nowMs
        );

        const approvedContrib: SupplierContactContribution = {
            ...current,
            status: 'APPROVED',
            reviewedAt: nowMs,
            reviewedByUid: params.actorUid,
            ttlExpiresAt: null,
        };
        await docRef.set(approvedContrib, { merge: true });

        await AuditLedger.record({
            tenantId: 'global',
            actorUid: params.actorUid,
            actorEmail: params.actorEmail || 'dev@minreport.com',
            action: 'OPERMAQ_CONTRIBUTION_APPROVED',
            module: 'opermaq',
            targetEntity: supplier.supplierKey,
            details: { contributionId: current.contributionId },
        }).catch(() => {});

        return { contribution: approvedContrib, supplier };
    }

    /**
     * Alta directa de proveedor/distribuidor por país con agenda abierta opcional y perfil SII (`1º DEV` + `"ACTUALIZAR"`).
     * Deduplica automáticamente por `countryIso2 + supplierTaxId` en relaciones N:M con marcas.
     */
    public static async createSupplierDirectHitl(
        params: CreateSupplierDirectHitlBody & { actorUid: string; actorEmail?: string }
    ): Promise<SupplierEntity> {
        const nowMs = Date.now();
        const countryIso2 = (params.countryIso2 || 'CL').trim().toUpperCase().slice(0, 2) || 'CL';

        let compactTaxId = normalizeTaxIdCompact(params.supplierTaxId || params.siiTaxProfile?.siiRutNormalized);
        if (countryIso2 === 'CL' && (params.supplierTaxId || params.siiTaxProfile?.siiRutNormalized)) {
            const rutCheck = normalizeSiiXmlRut(params.supplierTaxId || params.siiTaxProfile?.siiRutNormalized);
            if (!rutCheck.valid) {
                const err: any = new Error(
                    `RUT chileno inválido (Módulo 11) para distribuidor SII: ${rutCheck.reason || 'FORMATO_INVALIDO'}.`
                );
                err.statusCode = 400;
                throw err;
            }
            compactTaxId = rutCheck.compactRut;
        }

        const safeWebsite = await filterSafeHttpsUrl(params.officialWebsiteUrl);
        const mfgKeys = normalizeManufacturerKeyList(params.manufacturerKeys);
        const supplierKey = buildSupplierKey(countryIso2, compactTaxId, params.tradeName);
        const docRef = db.collection(SUPPLIERS_COL).doc(supplierKey);
        const existingSnap = await docRef.get();
        const existing = existingSnap.exists ? hydrateSupplierEntity(existingSnap.id, existingSnap.data() || {}) : null;

        const mergedContacts: SupplierContactEntry[] = [...(existing?.contacts || [])];
        if (params.initialContact?.areaName) {
            const c = params.initialContact;
            const areaKey = normalizeSupplierAreaKey(c.areaName);
            mergedContacts.push({
                contactId: `cnt_${areaKey.slice(0, 24)}_${nowMs.toString(36)}`,
                areaName: c.areaName.trim().slice(0, 120),
                areaKey,
                contactLabel: c.contactLabel
                    ? ConfidentialityAirlockService.scrubDeterministicPii(c.contactLabel, countryIso2).scrubbed.slice(0, 160)
                    : null,
                phone: sanitizeCorporatePhone(c.phone),
                roleEmail: sanitizeFunctionalCorporateEmail(c.roleEmail),
                portalUrl: await filterSafeHttpsUrl(c.portalUrl),
                cityRegion: c.cityRegion ? c.cityRegion.trim().slice(0, 120) : null,
                manufacturerKeys: mfgKeys,
                isOfficialDealer: mfgKeys.length > 0,
                legacyChannels: inferLegacyChannelsFromAreaName(c.areaName),
                notes: c.notes
                    ? ConfidentialityAirlockService.scrubDeterministicPii(c.notes, countryIso2).scrubbed.slice(0, 600)
                    : null,
                updatedAt: nowMs,
            });
        }

        const existingDivisions = [...(existing?.divisions || [])];
        if (existingDivisions.length === 0) {
            const firstArea = params.initialContact?.areaName || 'Comercial General';
            existingDivisions.push({
                divisionId: `div_${normalizeSlug(firstArea, 36)}`,
                divisionName: firstArea.slice(0, 180),
                isOfficialDealer: mfgKeys.length > 0,
                channels: inferLegacyChannelsFromAreaName(firstArea),
                manufacturerKeys: mfgKeys,
                archetypeIds: ['ALL'],
                territories: [countryIso2],
                branches: params.initialContact?.cityRegion
                    ? [
                          {
                              branchName: params.initialContact.contactLabel || firstArea,
                              city: params.initialContact.cityRegion,
                              regionIso: null,
                              phone: sanitizeCorporatePhone(params.initialContact.phone),
                              roleEmail: sanitizeFunctionalCorporateEmail(params.initialContact.roleEmail),
                              portalUrl: await filterSafeHttpsUrl(params.initialContact.portalUrl),
                          },
                      ]
                    : [],
            });
        } else if (mfgKeys.length > 0) {
            existingDivisions[0] = {
                ...existingDivisions[0],
                manufacturerKeys: normalizeManufacturerKeyList([...existingDivisions[0].manufacturerKeys, ...mfgKeys]),
            };
        }

        const nextLegalName = (params.legalName || existing?.legalName || params.tradeName).trim().slice(0, 220);
        const nextTaxId = compactTaxId || existing?.supplierTaxId || null;
        const mergedMfgKeys = normalizeManufacturerKeyList([...(existing?.manufacturerKeys || []), ...mfgKeys]);
        const nextSii = normalizeSupplierSiiTaxProfile(
            {
                ...(existing?.siiTaxProfile || {}),
                ...(params.siiTaxProfile || {}),
            },
            countryIso2,
            nextTaxId,
            nextLegalName
        );

        const rawPayload: Record<string, any> = {
            supplierKey,
            tradeName: params.tradeName.trim().slice(0, 180),
            legalName: nextLegalName,
            countryIso2,
            supplierTaxId: nextTaxId,
            officialWebsiteUrl: safeWebsite || existing?.officialWebsiteUrl || null,
            x402SellerWalletId: existing?.x402SellerWalletId || null,
            manufacturerKeys: mergedMfgKeys,
            divisions: existingDivisions,
            contacts: mergedContacts,
            siiTaxProfile: nextSii,
            createdAt: existing?.createdAt || nowMs,
            updatedAt: nowMs,
        };

        await docRef.set(rawPayload, { merge: true });
        await AuditLedger.record({
            tenantId: 'global',
            actorUid: params.actorUid,
            actorEmail: params.actorEmail || 'dev@minreport.com',
            action: 'OPERMAQ_SUPPLIER_CREATED_DIRECT_HITL',
            module: 'opermaq',
            targetEntity: supplierKey,
            details: { countryIso2, manufacturerKeys: mergedMfgKeys },
        }).catch(() => {});

        return hydrateSupplierEntity(supplierKey, rawPayload);
    }

    /**
     * Actualiza ficha corporativa y perfil tributario SII (`DTE_v10.xsd`) o Internacional de un proveedor (`1º DEV` + `"ACTUALIZAR"`).
     */
    public static async updateSupplierProfileHitl(
        params: { supplierKey: string } & UpdateSupplierProfileHitlBody & { actorUid: string; actorEmail?: string }
    ): Promise<SupplierEntity> {
        const cleanKey = normalizeSlug(params.supplierKey, 120);
        const docRef = db.collection(SUPPLIERS_COL).doc(cleanKey);
        const snap = await docRef.get();
        if (!snap.exists) {
            const err: any = new Error('Distribuidor/proveedor no encontrado.');
            err.statusCode = 404;
            throw err;
        }
        const existing = hydrateSupplierEntity(snap.id, snap.data() || {});
        const nextCountry = params.countryIso2 ? params.countryIso2.trim().toUpperCase().slice(0, 2) : existing.countryIso2;
        const nextTradeName = params.tradeName ? params.tradeName.trim().slice(0, 180) : existing.tradeName;
        const nextLegalName = params.legalName ? params.legalName.trim().slice(0, 220) : existing.legalName;

        const targetScope =
            params.siiTaxProfile?.taxRegimeScope ||
            (nextCountry !== 'CL' ? 'INTERNATIONAL' : existing.siiTaxProfile?.taxRegimeScope || 'SII_CL');

        let nextCompactTaxId = existing.supplierTaxId ?? null;
        if (params.supplierTaxId !== undefined) {
            nextCompactTaxId = params.supplierTaxId ? normalizeTaxIdCompact(params.supplierTaxId) : null;
        }
        if (targetScope === 'SII_CL') {
            const rutToValidate =
                params.siiTaxProfile?.siiRutNormalized !== undefined
                    ? params.siiTaxProfile.siiRutNormalized
                    : params.supplierTaxId !== undefined
                      ? params.supplierTaxId
                      : existing.siiTaxProfile?.siiRutNormalized || existing.supplierTaxId;
            if (rutToValidate && String(rutToValidate).trim()) {
                const rutCheck = normalizeSiiXmlRut(rutToValidate);
                if (!rutCheck.valid) {
                    const err: any = new Error(
                        `RUT emisor/receptor SII inválido (Módulo 11): ${rutCheck.reason || 'FORMATO_INVALIDO'}.`
                    );
                    err.statusCode = 400;
                    throw err;
                }
                nextCompactTaxId = rutCheck.compactRut;
            }
        }

        const nextWebsite =
            params.officialWebsiteUrl !== undefined
                ? params.officialWebsiteUrl
                    ? await filterSafeHttpsUrl(params.officialWebsiteUrl)
                    : null
                : existing.officialWebsiteUrl ?? null;

        const nextMfgKeys =
            params.manufacturerKeys !== undefined
                ? normalizeManufacturerKeyList(params.manufacturerKeys)
                : existing.manufacturerKeys;

        const mergedSiiInput: Record<string, any> = {
            ...(existing.siiTaxProfile || {}),
            ...(params.siiTaxProfile || {}),
            taxRegimeScope: targetScope,
        };
        if (params.siiTaxProfile?.siiGiroEmis !== undefined && params.siiTaxProfile?.siiGiroRecep === undefined) {
            mergedSiiInput.siiGiroRecep = deriveSiiGiroRecep40(params.siiTaxProfile.siiGiroEmis);
        }
        if (targetScope === 'SII_CL' && nextCompactTaxId) {
            const xmlCheck = normalizeSiiXmlRut(nextCompactTaxId);
            if (xmlCheck.valid) {
                mergedSiiInput.siiRutNormalized = xmlCheck.normalizedXmlRut;
                mergedSiiInput.siiRutDisplay = xmlCheck.displayRut;
            }
        }
        if (mergedSiiInput.dteInterchangeEmail) {
            mergedSiiInput.dteInterchangeEmail =
                sanitizeFunctionalCorporateEmail(mergedSiiInput.dteInterchangeEmail)?.slice(0, 80) ||
                String(mergedSiiInput.dteInterchangeEmail).trim().slice(0, 80);
        }
        if (mergedSiiInput.apBillingEmail) {
            mergedSiiInput.apBillingEmail =
                sanitizeFunctionalCorporateEmail(mergedSiiInput.apBillingEmail) ||
                String(mergedSiiInput.apBillingEmail).trim().slice(0, 180);
        }

        const nextSiiProfile = normalizeSupplierSiiTaxProfile(
            mergedSiiInput,
            nextCountry,
            nextCompactTaxId,
            nextLegalName
        );
        const nowMs = Date.now();
        if (params.siiTaxProfile) {
            nextSiiProfile.verifiedAt = nowMs;
        }

        const updatedPayload: Record<string, any> = {
            supplierKey: existing.supplierKey,
            tradeName: nextTradeName,
            legalName: nextLegalName,
            countryIso2: nextCountry,
            supplierTaxId: nextCompactTaxId,
            officialWebsiteUrl: nextWebsite,
            x402SellerWalletId:
                params.x402SellerWalletId !== undefined
                    ? params.x402SellerWalletId?.trim() || null
                    : existing.x402SellerWalletId ?? null,
            manufacturerKeys: nextMfgKeys,
            divisions: existing.divisions,
            contacts: existing.contacts || [],
            siiTaxProfile: nextSiiProfile,
            createdAt: existing.createdAt,
            updatedAt: nowMs,
        };

        await docRef.set(updatedPayload, { merge: true });
        await AuditLedger.record({
            tenantId: 'global',
            actorUid: params.actorUid,
            actorEmail: params.actorEmail || 'dev@minreport.com',
            action: 'OPERMAQ_SUPPLIER_PROFILE_UPDATED_HITL',
            module: 'opermaq',
            targetEntity: existing.supplierKey,
            details: {
                countryIso2: nextCountry,
                taxRegimeScope: nextSiiProfile.taxRegimeScope,
                siiRutNormalized: nextSiiProfile.siiRutNormalized,
            },
        }).catch(() => {});

        return hydrateSupplierEntity(existing.supplierKey, updatedPayload);
    }

    /**
     * Registra o edita un contacto comercial por área abierta en la agenda global del distribuidor (`1º DEV` + `"ACTUALIZAR"`).
     * Zero-Preset: cualquier área según naturaleza de la industria (Lubricantes, Neumáticos OTR, Repuestos, etc.).
     */
    public static async upsertSupplierContactHitl(
        params: { supplierKey: string } & UpsertSupplierContactHitlBody & { actorUid: string; actorEmail?: string }
    ): Promise<SupplierEntity> {
        const cleanKey = normalizeSlug(params.supplierKey, 120);
        const docRef = db.collection(SUPPLIERS_COL).doc(cleanKey);
        const snap = await docRef.get();
        if (!snap.exists) {
            const err: any = new Error('Distribuidor/proveedor no encontrado.');
            err.statusCode = 404;
            throw err;
        }
        const existing = hydrateSupplierEntity(snap.id, snap.data() || {});
        const nowMs = Date.now();
        const areaName = params.areaName.trim().slice(0, 120);
        const areaKey = normalizeSupplierAreaKey(areaName);
        const safePortal = await filterSafeHttpsUrl(params.portalUrl);

        const contactId =
            params.contactId?.trim() || `cnt_${areaKey.slice(0, 24)}_${nowMs.toString(36)}`;
        const mfgKeys = normalizeManufacturerKeyList(params.manufacturerKeys || existing.manufacturerKeys);

        const nextEntry: SupplierContactEntry = {
            contactId,
            areaName,
            areaKey,
            contactLabel: params.contactLabel
                ? ConfidentialityAirlockService.scrubDeterministicPii(params.contactLabel, existing.countryIso2).scrubbed.slice(0, 160)
                : null,
            phone: sanitizeCorporatePhone(params.phone),
            roleEmail: sanitizeFunctionalCorporateEmail(params.roleEmail),
            portalUrl: safePortal,
            cityRegion: params.cityRegion ? params.cityRegion.trim().slice(0, 120) : null,
            manufacturerKeys: mfgKeys,
            isOfficialDealer: params.isOfficialDealer !== false,
            legacyChannels: inferLegacyChannelsFromAreaName(areaName),
            notes: params.notes
                ? ConfidentialityAirlockService.scrubDeterministicPii(params.notes, existing.countryIso2).scrubbed.slice(0, 600)
                : null,
            updatedAt: nowMs,
        };

        const contacts = [...(existing.contacts || [])];
        const idx = contacts.findIndex((c) => c.contactId === contactId);
        if (idx >= 0) {
            contacts[idx] = nextEntry;
        } else {
            contacts.push(nextEntry);
        }

        const mergedMfgKeys = normalizeManufacturerKeyList([
            ...(existing.manufacturerKeys || []),
            ...mfgKeys,
        ]);

        const patch: Record<string, any> = {
            contacts,
            manufacturerKeys: mergedMfgKeys,
            updatedAt: nowMs,
        };
        await docRef.set(patch, { merge: true });

        await AuditLedger.record({
            tenantId: 'global',
            actorUid: params.actorUid,
            actorEmail: params.actorEmail || 'dev@minreport.com',
            action: 'OPERMAQ_SUPPLIER_CONTACT_UPSERT_HITL',
            module: 'opermaq',
            targetEntity: existing.supplierKey,
            details: { contactId, areaName, areaKey },
        }).catch(() => {});

        return hydrateSupplierEntity(existing.supplierKey, { ...existing, ...patch });
    }

    public static async deleteSupplierContactHitl(params: {
        supplierKey: string;
        contactId: string;
        actorUid: string;
        actorEmail?: string;
    }): Promise<SupplierEntity> {
        const cleanKey = normalizeSlug(params.supplierKey, 120);
        const docRef = db.collection(SUPPLIERS_COL).doc(cleanKey);
        const snap = await docRef.get();
        if (!snap.exists) {
            const err: any = new Error('Distribuidor/proveedor no encontrado.');
            err.statusCode = 404;
            throw err;
        }
        const existing = hydrateSupplierEntity(snap.id, snap.data() || {});
        const nowMs = Date.now();
        const contacts = (existing.contacts || []).filter((c) => c.contactId !== params.contactId);

        await docRef.set({ contacts, updatedAt: nowMs }, { merge: true });
        await AuditLedger.record({
            tenantId: 'global',
            actorUid: params.actorUid,
            actorEmail: params.actorEmail || 'dev@minreport.com',
            action: 'OPERMAQ_SUPPLIER_CONTACT_DELETED_HITL',
            module: 'opermaq',
            targetEntity: existing.supplierKey,
            details: { contactId: params.contactId },
        }).catch(() => {});

        return hydrateSupplierEntity(existing.supplierKey, { ...existing, contacts, updatedAt: nowMs });
    }

    /**
     * Descubre áreas comerciales reales y metadatos tributarios públicos de un distribuidor ya registrado (Zero-Preset, 1º DEV).
     */
    public static async discoverSupplierAreasWithAi(
        params: { supplierKey: string } & DiscoverSupplierAreasAiBody & { actorUid?: string }
    ): Promise<{
        supplierKey: string;
        suggestions: AiSupplierContactHint[];
        siiTaxHint: {
            siiRut?: string | null;
            siiGiroEmis?: string | null;
            taxAddressDir?: string | null;
            taxComuna?: string | null;
            taxCiudad?: string | null;
            dteInterchangeEmail?: string | null;
        } | null;
        groundingSources: Array<{ title: string; uri: string }>;
        modelUsed: string;
        latencyMs: number;
    }> {
        const startedAt = Date.now();
        const supplier = await this.getSupplierByKey(params.supplierKey);
        if (!supplier) {
            const err: any = new Error('Distribuidor/proveedor no encontrado.');
            err.statusCode = 404;
            throw err;
        }

        const countryIso2 = params.countryIso2 || supplier.countryIso2 || 'CL';
        const countryLabel = resolveCountryDisplayName(countryIso2);
        const focusClean = params.focusArea
            ? ConfidentialityAirlockService.scrubDeterministicPii(params.focusArea.trim(), countryIso2).scrubbed
            : '';

        const prompt = `Investiga las áreas comerciales y canales corporativos reales del distribuidor/proveedor industrial "${supplier.tradeName}" (${supplier.legalName}) en ${countryLabel} (${countryIso2}).
Sitio web conocido: ${supplier.officialWebsiteUrl || 'N/D'}.
Marcas representadas: ${supplier.manufacturerKeys.join(', ') || 'Especialista independiente'}.${focusClean ? `\nÁrea prioritaria a investigar: ${focusClean}.` : ''}

Reglas estrictas de veracidad (Zero-Preset):
1. No uses perfiles genéricos prefijados: detecta las áreas reales de su industria (ej. Repuestos, Equipos Nuevos, Equipos Usados, Lubricantes, Neumáticos OTR, Arriendo, Servicio Técnico, Componentes Mineros, Mesa de Ayuda, etc.).
2. Incluye SOLO teléfonos de mesa central pública, correos funcionales de rol (ventas@, repuestos@, facturacion@, dte@) y portales HTTPS oficiales verificables. PROHIBIDO incluir datos de personas naturales.
3. Responde ÚNICAMENTE con JSON válido bajo la estructura exacta:
{
  "contacts": [
    { "areaName": "string", "contactLabel": "string | null", "phone": "string | null", "roleEmail": "string | null", "portalUrl": "string | null", "cityRegion": "string | null", "notes": "string | null" }
  ],
  "taxHint": {
    "siiRut": "string | null",
    "siiGiroEmis": "string | null",
    "taxAddressDir": "string | null",
    "taxComuna": "string | null",
    "taxCiudad": "string | null",
    "dteInterchangeEmail": "string | null"
  }
}`;

        const aiRes = await ResilientAIClient.generate({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            temperature: 0.1,
            useGoogleSearch: true,
            requireGroundedEvidence: true,
            prompt,
        });

        let parsed: Record<string, any> | null = null;
        const text = (aiRes.text || '').trim();
        if (text) {
            const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
            try {
                parsed = JSON.parse(cleaned);
            } catch {
                const start = cleaned.indexOf('{');
                const end = cleaned.lastIndexOf('}');
                if (start >= 0 && end > start) {
                    try {
                        parsed = JSON.parse(cleaned.slice(start, end + 1));
                    } catch {
                        parsed = null;
                    }
                }
            }
        }

        const rawContacts = Array.isArray(parsed?.contacts) ? parsed.contacts : [];
        const suggestions: AiSupplierContactHint[] = [];
        const candidateUrls = new Set<string>();
        for (const rc of rawContacts.slice(0, 16)) {
            if (rc?.portalUrl && typeof rc.portalUrl === 'string') candidateUrls.add(rc.portalUrl);
        }
        for (const src of aiRes.groundingSources || []) {
            if (src?.uri) candidateUrls.add(src.uri);
        }

        const safeUrlMap = new Map<string, string | null>();
        await Promise.all(
            Array.from(candidateUrls).map(async (u) => {
                safeUrlMap.set(u, await filterSafeHttpsUrl(u));
            })
        );

        for (const rc of rawContacts.slice(0, 16)) {
            if (!rc || typeof rc !== 'object') continue;
            const areaName = cleanOptionalText(rc.areaName ?? rc.area, 120);
            if (!areaName || areaName.length < 2) continue;
            suggestions.push({
                areaName,
                contactLabel: cleanOptionalText(rc.contactLabel ?? rc.label, 160),
                phone: sanitizeCorporatePhone(rc.phone),
                roleEmail: sanitizeFunctionalCorporateEmail(rc.roleEmail ?? rc.email),
                portalUrl: rc.portalUrl ? safeUrlMap.get(rc.portalUrl) ?? null : null,
                cityRegion: cleanOptionalText(rc.cityRegion ?? rc.city, 120),
                notes: cleanOptionalText(rc.notes, 400),
            });
        }

        const rawTax = parsed?.taxHint && typeof parsed.taxHint === 'object' ? parsed.taxHint : null;
        const siiTaxHint = rawTax
            ? {
                  siiRut: cleanOptionalText(rawTax.siiRut, 16),
                  siiGiroEmis: cleanOptionalText(rawTax.siiGiroEmis, 80),
                  taxAddressDir: cleanOptionalText(rawTax.taxAddressDir, 70),
                  taxComuna: cleanOptionalText(rawTax.taxComuna, 20),
                  taxCiudad: cleanOptionalText(rawTax.taxCiudad, 20),
                  dteInterchangeEmail: sanitizeFunctionalCorporateEmail(rawTax.dteInterchangeEmail)?.slice(0, 80) || null,
              }
            : null;

        const groundingSources: Array<{ title: string; uri: string }> = [];
        const seenUris = new Set<string>();
        for (const src of aiRes.groundingSources || []) {
            const safeUri = src?.uri ? safeUrlMap.get(src.uri) ?? null : null;
            if (!safeUri || seenUris.has(safeUri)) continue;
            seenUris.add(safeUri);
            groundingSources.push({ title: String(src.title || safeUri).trim(), uri: safeUri });
        }

        return {
            supplierKey: supplier.supplierKey,
            suggestions,
            siiTaxHint,
            groundingSources,
            modelUsed: aiRes.model || 'fallback-deterministic',
            latencyMs: Date.now() - startedAt,
        };
    }

    /**
     * Reglas contractuales privadas B2B por proveedor (aisladas en `accounts/{tenantId}/supplier_billing_rules/{supplierKey}`).
     */
    public static async getTenantSupplierBillingRule(params: {
        tenantId: string;
        supplierKey: string;
    }): Promise<TenantSupplierBillingRule | null> {
        if (!params.tenantId || !params.supplierKey) return null;
        const cleanKey = normalizeSlug(params.supplierKey, 120);
        const snap = await db
            .collection('accounts')
            .doc(params.tenantId)
            .collection(PRIVATE_BILLING_RULES_SUBCOL)
            .doc(cleanKey)
            .get();
        if (!snap.exists) return null;
        const raw = snap.data() || {};
        return {
            tenantId: params.tenantId,
            supplierKey: cleanKey,
            requiresPurchaseOrder801: raw.requiresPurchaseOrder801 !== false,
            requiresContract803: Boolean(raw.requiresContract803),
            requiresDispatchGuide52: Boolean(raw.requiresDispatchGuide52),
            requiresReceptionTokenType: raw.requiresReceptionTokenType || 'HES',
            defaultFormaPagoDte: raw.defaultFormaPagoDte === 1 || raw.defaultFormaPagoDte === 3 ? raw.defaultFormaPagoDte : 2,
            paymentTermDays: typeof raw.paymentTermDays === 'number' ? raw.paymentTermDays : 30,
            hasExceptionalPaymentAgreement: Boolean(raw.hasExceptionalPaymentAgreement),
            exceptionalAgreementNote: raw.exceptionalAgreementNote || null,
            dteClaimWindowDays: typeof raw.dteClaimWindowDays === 'number' ? raw.dteClaimWindowDays : 8,
            rcvClaimAlertEmail: raw.rcvClaimAlertEmail || null,
            allowFactoringCesion: raw.allowFactoringCesion !== false,
            billingPortalUrl: raw.billingPortalUrl || null,
            remittanceEmail: raw.remittanceEmail || null,
            defaultCentroCosto: raw.defaultCentroCosto || null,
            notes: raw.notes || null,
            updatedByUid: raw.updatedByUid || undefined,
            updatedAt: Number(raw.updatedAt || Date.now()),
        };
    }

    public static async upsertTenantSupplierBillingRule(
        params: {
            tenantId: string;
            supplierKey: string;
            actorUid: string;
            actorEmail?: string;
        } & UpsertTenantSupplierBillingRuleBody
    ): Promise<TenantSupplierBillingRule> {
        if (params.paymentTermDays > 30 && !params.hasExceptionalPaymentAgreement) {
            const err: any = new Error(
                'Cumplimiento Ley N° 21.131 (Pago a 30 días): un plazo superior a 30 días requiere acreditar acuerdo excepcional inscrito en el MEFT.'
            );
            err.statusCode = 400;
            throw err;
        }
        if (params.dteClaimWindowDays > 8 || params.dteClaimWindowDays < 1) {
            const err: any = new Error(
                'Cumplimiento Ley N° 19.983: la ventana de reclamo RCV ante el SII debe situarse entre 1 y 8 días corridos.'
            );
            err.statusCode = 400;
            throw err;
        }

        const cleanKey = normalizeSlug(params.supplierKey, 120);
        const nowMs = Date.now();
        const safePortal = await filterSafeHttpsUrl(params.billingPortalUrl);
        const cleanNotes = params.notes
            ? ConfidentialityAirlockService.scrubDeterministicPii(params.notes, 'CL').scrubbed.slice(0, 800)
            : null;
        const cleanExceptional = params.exceptionalAgreementNote
            ? ConfidentialityAirlockService.scrubDeterministicPii(params.exceptionalAgreementNote, 'CL').scrubbed.slice(0, 240)
            : null;

        const payload: TenantSupplierBillingRule = {
            tenantId: params.tenantId,
            supplierKey: cleanKey,
            requiresPurchaseOrder801: Boolean(params.requiresPurchaseOrder801),
            requiresContract803: Boolean(params.requiresContract803),
            requiresDispatchGuide52: Boolean(params.requiresDispatchGuide52),
            requiresReceptionTokenType: params.requiresReceptionTokenType || 'HES',
            defaultFormaPagoDte: params.defaultFormaPagoDte || 2,
            paymentTermDays: params.paymentTermDays,
            hasExceptionalPaymentAgreement: Boolean(params.hasExceptionalPaymentAgreement),
            exceptionalAgreementNote: cleanExceptional,
            dteClaimWindowDays: params.dteClaimWindowDays,
            rcvClaimAlertEmail: params.rcvClaimAlertEmail?.trim() ? params.rcvClaimAlertEmail.trim().slice(0, 180) : null,
            allowFactoringCesion: Boolean(params.allowFactoringCesion),
            billingPortalUrl: safePortal,
            remittanceEmail: params.remittanceEmail?.trim() ? params.remittanceEmail.trim().slice(0, 180) : null,
            defaultCentroCosto: params.defaultCentroCosto?.trim() ? params.defaultCentroCosto.trim().slice(0, 80) : null,
            notes: cleanNotes,
            updatedByUid: params.actorUid,
            updatedAt: nowMs,
        };

        await db
            .collection('accounts')
            .doc(params.tenantId)
            .collection(PRIVATE_BILLING_RULES_SUBCOL)
            .doc(cleanKey)
            .set(payload, { merge: true });

        await AuditLedger.record({
            tenantId: params.tenantId,
            actorUid: params.actorUid,
            actorEmail: params.actorEmail || 'user@minreport.com',
            action: 'OPERMAQ_TENANT_SUPPLIER_BILLING_RULE_UPDATED',
            module: 'opermaq',
            targetEntity: cleanKey,
            details: {
                requiresPurchaseOrder801: payload.requiresPurchaseOrder801,
                paymentTermDays: payload.paymentTermDays,
                dteClaimWindowDays: payload.dteClaimWindowDays,
            },
        }).catch(() => {});

        return payload;
    }
}
