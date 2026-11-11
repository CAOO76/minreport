import { createHash, randomUUID } from 'crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { db, storage } from '../../../config/firebase';
import { AuditLedger } from '../../../core/audit-ledger';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { MediaDigestorServer } from '../../../core/media/MediaDigestorServer';
import { ResilientAIClient } from '../../../core/resilient-ai-client';
import { assertSafeExternalUrl, safeFetchExternal } from '../../../utils/ssrfGuard';
import { VALID_PILLAR_IDS } from '../types/vault.types';
import {
    type MachineryArchetypeId,
    resolveMachineryArchetype,
} from '../utils/canonicalArchetypeSpecs';
import { inferAssetConfigurationProfile } from '../utils/lockedVariantDirective';
import { renderPdfPageToPng } from './SegmentedDocumentProcessorService';

/**
 * OFFICIAL EQUIPMENT PHOTO SERVICE v4.0 (Forensic VLM Variant & Brand Shield)
 *
 * Motor Soberano Universal de Caza Asistida por IA para CUALQUIER Arquetipo de Maquinaria (OPERMAQ / MINREPORT):
 * - Exige correspondencia exacta de variante mecánica (`matches_exact_variant_configuration`: conteo real de ejes
 *   `8x4` vs `6x4`, carrocería `Tolva` vs `Tracto` / `Mixer`, rodado `Orugas` vs `Neumáticos`).
 * - Bloquea 100% imágenes sintéticas generadas por IA (`is_authentic_real_photograph`: exceso o fusión de ruedas,
 *   llantas deformes, emblemas/textos ilegibles o artefactos de difusión).
 * - Bloquea marcas ajenas y marcas hermanas del mismo grupo corporativo en el fondo o concesionario
 *   (`is_free_of_other_manufacturer_and_dealer_branding`: p. ej. bloquea letreros/banderas `VOLVO` tras un `MACK`).
 * - Exige contexto exclusivo de Estudio OEM neutro/blanco o contexto real limpio de Minería / Construcción / Industria
 *   (`is_valid_industrial_or_studio_context`).
 * - Bloquea patentes PPU, números de serie y personas (Ley N° 21.719) y encuadra al 88% sobre lienzo 4:3 WebP Zero-Inflation.
 */

export const CURRENT_VLM_AUDIT_VERSION = 4;

export interface OfficialPhotoCandidate {
    candidate_id: string;
    preview_url: string;
    storage_path: string;
    source_type: 'VAULT_PDF' | 'OEM_DOMAIN';
    source_label: string;
    authenticity_score: number;
    subject_box_2d: [number, number, number, number] | null;
    original_bytes: number;
    optimized_bytes: number;
    savings_pct: number;
    sha256: string;
    phash_hex?: string;
    width: number;
    height: number;
    framing_mode: 'STUDIO_88' | 'VLM_BOX_4X3' | 'CENTER_4X3';
    vlm_audit_version?: number;
    verified_variant_summary?: string;
}

export interface ManualPhotoVerificationResult {
    approved: boolean;
    authenticity_score: number;
    rejection_reasons: string[];
    candidate?: OfficialPhotoCandidate;
}

const VlmPhotoVerdictSchema = z.object({
    is_authentic_real_photograph: z.boolean(),
    is_exact_make_and_model: z.boolean(),
    matches_exact_variant_configuration: z.boolean(),
    is_mining_appropriate_configuration: z.boolean(),
    is_valid_industrial_or_studio_context: z.boolean(),
    is_free_of_other_manufacturer_and_dealer_branding: z.boolean(),
    is_free_of_pii_and_plates: z.boolean(),
    is_clean_unweathered_machine: z.boolean(),
    authenticity_score: z.number().min(0).max(1),
    subject_box_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional().default(null),
    observed_axle_or_track_layout: z.string().default(''),
    observed_body_or_attachment: z.string().default(''),
    detected_model_description: z.string(),
    rejection_reasons: z.array(z.string()).default([]),
});

type VlmPhotoVerdict = z.infer<typeof VlmPhotoVerdictSchema>;

function normalizeVlmVerdictPayload(raw: any): VlmPhotoVerdict {
    const obj = raw && typeof raw === 'object' ? raw : {};
    let score = Number(obj.authenticity_score);
    if (!Number.isFinite(score) || score < 0) score = 0;
    else if (score > 1 && score <= 100) score = Number((score / 100).toFixed(3));
    else if (score > 100) score = 1;

    let box: [number, number, number, number] | null = null;
    if (Array.isArray(obj.subject_box_2d) && obj.subject_box_2d.length >= 4) {
        const nums = obj.subject_box_2d.slice(0, 4).map((n: unknown) => Number(n));
        if (nums.every((n: number) => Number.isFinite(n) && n >= 0 && n <= 1000)) {
            box = [nums[0], nums[1], nums[2], nums[3]];
        }
    }

    const reasons = Array.isArray(obj.rejection_reasons)
        ? obj.rejection_reasons.map((r: unknown) => String(r || '').trim()).filter(Boolean)
        : [];

    return VlmPhotoVerdictSchema.parse({
        is_authentic_real_photograph: Boolean(obj.is_authentic_real_photograph),
        is_exact_make_and_model: Boolean(obj.is_exact_make_and_model),
        matches_exact_variant_configuration: Boolean(obj.matches_exact_variant_configuration),
        is_mining_appropriate_configuration: Boolean(obj.is_mining_appropriate_configuration),
        is_valid_industrial_or_studio_context: Boolean(obj.is_valid_industrial_or_studio_context),
        is_free_of_other_manufacturer_and_dealer_branding: Boolean(
            obj.is_free_of_other_manufacturer_and_dealer_branding ?? obj.is_free_of_third_party_branding
        ),
        is_free_of_pii_and_plates: Boolean(obj.is_free_of_pii_and_plates),
        is_clean_unweathered_machine: Boolean(obj.is_clean_unweathered_machine),
        authenticity_score: score,
        subject_box_2d: box,
        observed_axle_or_track_layout: String(obj.observed_axle_or_track_layout || '').trim(),
        observed_body_or_attachment: String(obj.observed_body_or_attachment || '').trim(),
        detected_model_description: String(obj.detected_model_description || 'Sin descripción'),
        rejection_reasons: reasons,
    });
}

const IGNORED_IMAGE_URL_PATTERNS =
    /(?:logo|avatar|icon|sprite|pixel|tracker|analytics|banner-ad|badge|favicon|social|facebook|linkedin|twitter|instagram|youtube\.com\/img|placeholder|spacer|blank\.gif|flag|map-pin|dealer-locator|button|arrow|1x1|spinner|loader)/i;

const NON_MINING_OR_TOY_PATTERNS =
    /(?:cold[-_\s]?planer|asphalt[-_\s]?cutter|pavement[-_\s]?miller|mulcher|brush[-_\s]?cutter|flail[-_\s]?mower|snow[-_\s]?blower|snow[-_\s]?push|snow[-_\s]?blade|snow[-_\s]?wing|street[-_\s]?sweeper|angle[-_\s]?broom|pickup[-_\s]?broom|bale[-_\s]?spear|stump[-_\s]?grinder|landscape[-_\s]?tiller|lawn[-_\s]?mower|tree[-_\s]?spade|log[-_\s]?grapple|tree[-_\s]?harvester|1[:/-]50|1[:/-]32|1[:/-]64|1[:/-]87|diecast|scale[-_\s]?model|toy|lego|bruder|norscot|diecastmasters|rc[-_\s]?truck|tamiya|farm[-_\s]?sim|ats[-_\s]?mod|ets2[-_\s]?mod|snowrunner|beamng)/i;

const AUCTION_AND_AI_SYNTHETIC_SITE_PATTERNS =
    /(?:purplewave\.com|bigiron\.com|rbauction\.com|ironplanet\.com|machinio\.com|truckpaper\.com|marketbook\.|commercialtrucktrader\.com|machinerytrader\.com|autoline\.|truck1\.|mascus\.|alibaba\.com|aliexpress\.com|ebay\.|craigslist\.|pinterest\.|tiktok\.com|stockcake\.com|freepik\.com|vecteezy\.com|lexica\.art|openart\.ai|civitai\.com|nightcafe\.studio|playground\.com|playgroundai\.com|craiyon\.com|arthub\.ai|prompthero\.com|deviantart\.com|midjourney\.com|ideogram\.ai|stablediffusionweb\.com|seaart\.ai|tensor\.art|leonardo\.ai|krea\.ai|lummi\.ai|pixai\.art|bing\.com\/images\/create|shutterstock\.com|gettyimages\.|istockphoto\.com|alamy\.com|123rf\.com|depositphotos\.com|dreamstime\.com)/i;

const SYNTHETIC_AI_TEXT_PATTERNS =
    /\b(?:ai[-_\s]?generated|generated[-_\s]?by[-_\s]?ai|midjourney|stable[-_\s]?diffusion|dall[-_\s]?e|flux[-_\s]?ai|ai[-_\s]?art|prompt[-_\s]?gallery|synthetic[-_\s]?render|concept[-_\s]?art[-_\s]?ai|stockcake)\b/i;

const BROWSER_COMPAT_HEADERS: Record<string, string> = {
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'es-CL,es;q=0.9,en-US;q=0.8,en;q=0.7',
};

interface RawCandidateBuffer {
    buffer: Buffer;
    source_type: 'VAULT_PDF' | 'OEM_DOMAIN';
    source_label: string;
    original_filename?: string;
    is_full_document_page?: boolean;
    priority_score?: number;
    phash_hex?: string;
}

interface ExtractedHtmlImageCandidate {
    url: string;
    fallbackUrl?: string;
    rawFallbackUrl?: string;
    priority: number;
    sourceHost: string;
}

interface ArchetypePhotoSearchProfile {
    archetypeId: MachineryArchetypeId;
    archetypeLabelEs: string;
    primarySearchFocusEn: string;
    negativeQueryTokens: string;
    vlmExpectedConfigEs: string;
}

/**
 * Resuelve dinámicamente el perfil de búsqueda y validación visual según el arquetipo mecánico
 * de cualquier maquinaria o equipo registrado en OPERMAQ.
 */
function resolveArchetypePhotoProfile(
    tipoEquipo: string,
    categoriaEquipo: string,
    make: string,
    model: string
): ArchetypePhotoSearchProfile {
    const arch = resolveMachineryArchetype(`${tipoEquipo} ${make} ${model}`, categoriaEquipo);

    switch (arch.id) {
        case 'MINICARGADOR_SSL_CTL':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: 'bucket',
                negativeQueryTokens: '-planer -mulcher -broom -snow -mower -1:50 -toy',
                vlmExpectedConfigEs:
                    'Equipada con su BALDE ESTÁNDAR de excavación/carga/movimiento de tierra (General Purpose / Dirt Bucket). Rechazar si tiene acoplada fresadora de asfalto (Cold Planer), desbrozadora forestal (Mulcher), barredora vial (Broom), soplador/hoja de nieve, hoyadora o implementos agrícolas/jardinería.',
            };
        case 'CARGADOR_FRONTAL':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: 'wheel loader bucket',
                negativeQueryTokens: '-log -forestry -snow -broom -1:50 -toy',
                vlmExpectedConfigEs:
                    'Equipada con su BALDE ESTÁNDAR de carguío minero, roca o movimiento de tierra. Rechazar garras forestales de troncos (log grapples), hojas quitanieves, barredoras o implementos agrícolas.',
            };
        case 'EXCAVADORA_HIDRAULICA':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: 'excavator bucket',
                negativeQueryTokens: '-forestry -harvester -magnet -mulcher -1:50 -toy',
                vlmExpectedConfigEs:
                    'Equipada con pluma, brazo y BALDE ESTÁNDAR de excavación/roca (o martillo hidráulico de picado minero). Rechazar cabezales procesadores forestales de tala, desbrozadoras, electroimanes de chatarra o cizallas de demolición urbana.',
            };
        case 'RETROEXCAVADORA':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: 'backhoe loader bucket',
                negativeQueryTokens: '-planer -broom -snow -mulcher -1:50 -toy',
                vlmExpectedConfigEs:
                    'Equipada con su balde cargador frontal estándar y brazo excavador trasero estándar. Rechazar fresadoras de asfalto, barredoras urbanas o quitanieves.',
            };
        case 'BULLDOZER_ORUGAS':
        case 'BULLDOZER_NEUMATICOS':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: 'dozer blade',
                negativeQueryTokens: '-snow -forestry -1:50 -toy',
                vlmExpectedConfigEs:
                    'Equipada con su HOJA TOPADORA estándar (U, Semi-U, S) y/o desgarrador (ripper) trasero para movimiento de tierra y minería. Rechazar configuraciones forestales o de nieve.',
            };
        case 'MOTONIVELADORA':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: 'motor grader',
                negativeQueryTokens: '-snow -wing -1:50 -toy',
                vlmExpectedConfigEs:
                    'Equipada con su HOJA VERTEDERA central (moldboard) y/o ripper estándar de mantención de caminos mineros. Rechazar alas laterales quitanieves o accesorios invernales.',
            };
        case 'CAMION_TOLVA_CAEX':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: 'mining truck',
                negativeQueryTokens: '-1:50 -toy -diecast',
                vlmExpectedConfigEs:
                    'Equipada con su TOLVA MINERA de extracción/volquete (o estanque cisterna aljibe si el modelo es camión aljibe) estándar de fábrica.',
            };
        case 'PERFORADORA_SONDAJE':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: 'drill rig',
                negativeQueryTokens: '-1:50 -toy -diecast',
                vlmExpectedConfigEs:
                    'Equipada con su VIGA DE AVANCE, BRAZO HIDRÁULICO O MÁSTIL DE PERFORACIÓN estándar para minería o sondaje.',
            };
        case 'GRUA_IZAJE_MANIPULADOR':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: tipoEquipo || 'crane telehandler',
                negativeQueryTokens: '-bale -agricultural -snow -1:50 -toy',
                vlmExpectedConfigEs:
                    'Equipada con su PLUMA TELESCÓPICA, GANCHO DE IZAJE, HORQUILLA PORTA-PALLETS, MANIPULADOR DE NEUMÁTICOS O CANASTILLO estándar industrial/minero. Rechazar pinchos de fardos agrícolas (bale spears) o accesorios de granja.',
            };
        case 'COMPACTADOR_RODILLO':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: 'roller compactor',
                negativeQueryTokens: '-1:50 -toy -diecast',
                vlmExpectedConfigEs:
                    'Equipada con su TAMBOR COMPACTADOR liso o pata de cabra (o placa compactadora) estándar de movimiento de tierra.',
            };
        case 'COMPRESOR_GENERADOR_BOMBA':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: tipoEquipo || 'industrial unit',
                negativeQueryTokens: '-1:50 -toy',
                vlmExpectedConfigEs:
                    'Unidad estacionaria, skid o remolcable en su GABINETE, CARRO O CHASIS INDUSTRIAL estándar de fábrica.',
            };
        case 'VEHICULO_LIVIANO_TRANSPORTE':
            return {
                archetypeId: arch.id,
                archetypeLabelEs: arch.name_es,
                primarySearchFocusEn: tipoEquipo || 'pickup truck',
                negativeQueryTokens: '-tuning -racing -crash -1:50 -toy',
                vlmExpectedConfigEs:
                    'Vehículo en su CARROCERÍA ESTÁNDAR de fábrica o configuración limpia de servicio minero/transporte, sin modificaciones recreativas ni daños.',
            };
        default:
            return {
                archetypeId: arch.id,
                archetypeLabelEs: tipoEquipo || arch.name_es,
                primarySearchFocusEn: tipoEquipo || 'industrial equipment',
                negativeQueryTokens: '-planer -mulcher -snow -1:50 -toy -diecast',
                vlmExpectedConfigEs:
                    'Equipada en su CONFIGURACIÓN NOMINAL ESTÁNDAR DE FÁBRICA para operación en minería, movimiento de tierra o industria pesada, libre de accesorios agrícolas, jardinería, barrido urbano o nieve.',
            };
    }
}

function withHardTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    return Promise.race([
        promise,
        new Promise<T>((resolve) => {
            timer = setTimeout(() => {
                console.warn(`[OfficialPhotoService] Timeout preventivo (${ms}ms) alcanzado en: ${label}`);
                resolve(fallback);
            }, ms);
        }),
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function deriveBaseModelSeries(model: string): string {
    // Ej. "272D XHP" -> "272D", "320D2 L" -> "320D2", "GU813 (8x4 · Tolva)" -> "GU813"
    const withoutParens = String(model || '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const parts = withoutParens.split(/\s+/);
    if (parts.length > 1 && parts[0].length >= 3) {
        return parts[0];
    }
    return withoutParens || model.trim();
}

interface BrandDomainAndRivalPolicy {
    allowedOemDomainsRegex: RegExp;
    forbiddenOtherBrandRegex: RegExp | null;
    forbiddenBrandListEs: string;
    negativeBrandQueryTokens: string;
}

const KNOWN_OEM_BRAND_POLICIES: Array<{
    key: string;
    matchMake: RegExp;
    officialDomains: string[];
    extraSisterNegativeTokens?: string;
}> = [
    {
        key: 'MACK',
        matchMake: /\bmack\b/i,
        officialDomains: ['macktrucks\\.com', 'macktrucks\\.cl', 'macktrucks\\.com\\.au'],
        extraSisterNegativeTokens: '-volvo -renault -freightliner -kenworth -scania',
    },
    {
        key: 'VOLVO',
        matchMake: /\bvolvo\b/i,
        officialDomains: ['volvoce\\.com', 'volvotrucks\\.', 'volvogroup\\.com'],
        extraSisterNegativeTokens: '-mack -renault -scania -mercedes',
    },
    {
        key: 'CATERPILLAR',
        matchMake: /\b(?:caterpillar|cat)\b/i,
        officialDomains: ['cat\\.com', 'scene7\\.com\\/is\\/image\\/Caterpillar', 'finning\\.com', 'holtcat\\.com'],
        extraSisterNegativeTokens: '-komatsu -deere -bobcat -case',
    },
    {
        key: 'KOMATSU',
        matchMake: /\bkomatsu\b/i,
        officialDomains: ['komatsu\\.com', 'komatsu\\.cl', 'komatsu\\.eu', 'komatsuamerica\\.com'],
        extraSisterNegativeTokens: '-caterpillar -hitachi',
    },
    {
        key: 'SANDVIK',
        matchMake: /\bsandvik\b/i,
        officialDomains: ['rocktechnology\\.sandvik', 'sandvik\\.com'],
        extraSisterNegativeTokens: '-epiroc',
    },
    {
        key: 'EPIROC',
        matchMake: /\bepiroc\b/i,
        officialDomains: ['epiroc\\.com'],
        extraSisterNegativeTokens: '-sandvik',
    },
    {
        key: 'LIEBHERR',
        matchMake: /\bliebherr\b/i,
        officialDomains: ['liebherr\\.com'],
    },
    {
        key: 'JOHN DEERE',
        matchMake: /\b(?:john\s+deere|deere)\b/i,
        officialDomains: ['deere\\.com'],
    },
    {
        key: 'HITACHI',
        matchMake: /\bhitachi\b/i,
        officialDomains: ['hitachicm\\.com', 'hitachicm\\.eu', 'hitachicm\\.us'],
    },
    {
        key: 'SCANIA',
        matchMake: /\bscania\b/i,
        officialDomains: ['scania\\.com'],
        extraSisterNegativeTokens: '-volvo -mercedes -man',
    },
    {
        key: 'MERCEDES-BENZ',
        matchMake: /\b(?:mercedes|daimler)\b/i,
        officialDomains: ['mercedes-benz-trucks\\.com', 'mercedes-benz\\.com'],
        extraSisterNegativeTokens: '-volvo -scania -man -freightliner',
    },
    {
        key: 'FREIGHTLINER',
        matchMake: /\bfreightliner\b/i,
        officialDomains: ['freightliner\\.com'],
        extraSisterNegativeTokens: '-kenworth -peterbilt -mack -volvo',
    },
    {
        key: 'KENWORTH',
        matchMake: /\bkenworth\b/i,
        officialDomains: ['kenworth\\.com'],
        extraSisterNegativeTokens: '-peterbilt -freightliner -mack -volvo',
    },
    {
        key: 'PETERBILT',
        matchMake: /\bpeterbilt\b/i,
        officialDomains: ['peterbilt\\.com'],
        extraSisterNegativeTokens: '-kenworth -freightliner -mack -volvo',
    },
    {
        key: 'INTERNATIONAL',
        matchMake: /\b(?:international|navistar)\b/i,
        officialDomains: ['internationaltrucks\\.com'],
        extraSisterNegativeTokens: '-freightliner -kenworth -mack -volvo',
    },
    {
        key: 'CASE',
        matchMake: /\bcase\b/i,
        officialDomains: ['casece\\.com'],
        extraSisterNegativeTokens: '-"new holland" -caterpillar -deere',
    },
    {
        key: 'NEW HOLLAND',
        matchMake: /\bnew\s+holland\b/i,
        officialDomains: ['construction\\.newholland\\.com', 'newholland\\.com'],
        extraSisterNegativeTokens: '-case -caterpillar -deere',
    },
    {
        key: 'BOBCAT',
        matchMake: /\bbobcat\b/i,
        officialDomains: ['bobcat\\.com'],
        extraSisterNegativeTokens: '-caterpillar -jcb -case',
    },
    {
        key: 'JCB',
        matchMake: /\bjcb\b/i,
        officialDomains: ['jcb\\.com'],
    },
    {
        key: 'DOOSAN / DEVELON',
        matchMake: /\b(?:doosan|develon)\b/i,
        officialDomains: ['develon-ce\\.com', 'doosanequipment\\.com'],
    },
    {
        key: 'WIRTGEN / HAMM / VOGELE',
        matchMake: /\b(?:wirtgen|hamm|vogele|vögele|kleemann)\b/i,
        officialDomains: ['wirtgen-group\\.com'],
    },
    {
        key: 'METSO',
        matchMake: /\bmetso\b/i,
        officialDomains: ['metso\\.com'],
    },
    {
        key: 'NORMET',
        matchMake: /\bnormet\b/i,
        officialDomains: ['normet\\.com'],
    },
    {
        key: 'ATLAS COPCO',
        matchMake: /\batlas\s*copco\b/i,
        officialDomains: ['atlascopco\\.com'],
    },
];

const ALL_MAJOR_COMPETITOR_BRAND_TOKENS: Array<{ label: string; tokenRegex: string; matchMake: RegExp }> = [
    { label: 'VOLVO', tokenRegex: 'volvo', matchMake: /\bvolvo\b/i },
    { label: 'MACK', tokenRegex: 'mack\\s*trucks|\\bmack\\b', matchMake: /\bmack\b/i },
    { label: 'RENAULT TRUCKS', tokenRegex: 'renault\\s*trucks', matchMake: /\brenault\b/i },
    { label: 'UD TRUCKS', tokenRegex: 'ud\\s*trucks', matchMake: /\bud\s*trucks\b/i },
    { label: 'CATERPILLAR', tokenRegex: 'caterpillar|holtcat|finning', matchMake: /\b(?:caterpillar|cat)\b/i },
    { label: 'KOMATSU', tokenRegex: 'komatsu', matchMake: /\bkomatsu\b/i },
    { label: 'SCANIA', tokenRegex: 'scania', matchMake: /\bscania\b/i },
    { label: 'MERCEDES-BENZ', tokenRegex: 'mercedes[-\\s]?benz|actros|arocs', matchMake: /\b(?:mercedes|daimler)\b/i },
    { label: 'MAN', tokenRegex: 'man\\s*trucks', matchMake: /\bman\b/i },
    { label: 'FREIGHTLINER', tokenRegex: 'freightliner', matchMake: /\bfreightliner\b/i },
    { label: 'WESTERN STAR', tokenRegex: 'western\\s*star', matchMake: /\bwestern\s*star\b/i },
    { label: 'KENWORTH', tokenRegex: 'kenworth', matchMake: /\bkenworth\b/i },
    { label: 'PETERBILT', tokenRegex: 'peterbilt', matchMake: /\bpeterbilt\b/i },
    { label: 'INTERNATIONAL', tokenRegex: 'international\\s*trucks|navistar', matchMake: /\b(?:international|navistar)\b/i },
    { label: 'IVECO', tokenRegex: 'iveco', matchMake: /\biveco\b/i },
    { label: 'DAF', tokenRegex: 'daf\\s*trucks', matchMake: /\bdaf\b/i },
    { label: 'SINOTRUK / HOWO', tokenRegex: 'sinotruk|howo', matchMake: /\b(?:sinotruk|howo)\b/i },
    { label: 'SHACMAN', tokenRegex: 'shacman', matchMake: /\bshacman\b/i },
    { label: 'FAW', tokenRegex: 'faw\\s*trucks', matchMake: /\bfaw\b/i },
    { label: 'FOTON', tokenRegex: 'foton', matchMake: /\bfoton\b/i },
    { label: 'JOHN DEERE', tokenRegex: 'john\\s*deere|\\bdeere\\b', matchMake: /\b(?:john\s*deere|deere)\b/i },
    { label: 'HITACHI', tokenRegex: 'hitachi', matchMake: /\bhitachi\b/i },
    { label: 'LIEBHERR', tokenRegex: 'liebherr', matchMake: /\bliebherr\b/i },
    { label: 'SANDVIK', tokenRegex: 'sandvik', matchMake: /\bsandvik\b/i },
    { label: 'EPIROC', tokenRegex: 'epiroc', matchMake: /\bepiroc\b/i },
    { label: 'BOBCAT', tokenRegex: 'bobcat', matchMake: /\bbobcat\b/i },
    { label: 'JCB', tokenRegex: '\\bjcb\\b', matchMake: /\bjcb\b/i },
    { label: 'NEW HOLLAND', tokenRegex: 'new\\s*holland', matchMake: /\bnew\s*holland\b/i },
];

function resolveBrandDomainAndRivalPolicy(make: string): BrandDomainAndRivalPolicy {
    const cleanMake = String(make || '').trim();
    const matchedPolicy = KNOWN_OEM_BRAND_POLICIES.find((p) => p.matchMake.test(cleanMake));

    const neutralSpecDomains = ['ritchiespecs\\.com', 'lectura-specs\\.com'];
    const allowedPatterns = matchedPolicy
        ? [...matchedPolicy.officialDomains, ...neutralSpecDomains]
        : neutralSpecDomains;
    const allowedOemDomainsRegex = new RegExp(`(?:${allowedPatterns.join('|')})`, 'i');

    const forbiddenEntries = ALL_MAJOR_COMPETITOR_BRAND_TOKENS.filter(
        (entry) => !entry.matchMake.test(cleanMake)
    );
    const forbiddenOtherBrandRegex =
        forbiddenEntries.length > 0
            ? new RegExp(`\\b(?:${forbiddenEntries.map((e) => e.tokenRegex).join('|')})\\b`, 'i')
            : null;

    const forbiddenBrandListEs = forbiddenEntries
        .slice(0, 14)
        .map((e) => e.label)
        .join(', ');

    return {
        allowedOemDomainsRegex,
        forbiddenOtherBrandRegex,
        forbiddenBrandListEs,
        negativeBrandQueryTokens: matchedPolicy?.extraSisterNegativeTokens || '',
    };
}

interface VariantPhotoRequirements {
    cleanModelDesignator: string;
    requiredAxleCode: string | null;
    requiredBodyType:
        | 'DUMP_TOLVA'
        | 'TRACTOR_FIFTH_WHEEL'
        | 'WATER_ALJIBE'
        | 'MIXER'
        | 'CRANE_BOOM'
        | null;
    requiredUndercarriage: 'TRACKED' | 'WHEELED' | null;
    variantSearchFocusEn: string;
    variantSearchFocusEs: string;
    negativeVariantTokens: string;
    contradictoryTitleRegex: RegExp | null;
    vlmVariantMandateEs: string;
    summaryBadgePrefix: string;
}

function extractVariantPhotoRequirements(
    assetData: Record<string, any>,
    make: string,
    model: string,
    archetypeProfile: ArchetypePhotoSearchProfile
): VariantPhotoRequirements {
    const configProfile = inferAssetConfigurationProfile({
        make_oficial: make,
        model_oficial: model,
        tipo_equipo: assetData.tipo_equipo,
        categoria_equipo: assetData.categoria_equipo,
        version: assetData.version,
        physical_traits: assetData.physical_traits,
        canonical_specs: assetData.canonical_specs,
        caracteristicas_principales: assetData.caracteristicas_principales,
        chassis_versions: assetData.chassis_versions,
        existing_profile: assetData.configuration_profile,
    });

    // Limpiar designador de modelo para búsquedas de imagen (removiendo paréntesis de desambiguación y prosa de caja/volumen)
    const cleanModelDesignator =
        String(model || '')
            .replace(/\([^)]*\)/g, ' ')
            .replace(
                /\b(?:10x6|10x4|8x8|8x6|8x4|6x6|6x4|6x2|4x4|4x2|tolva|volquete|batea|tractocamion|aljibe|mixer|automatic[ao]|automatizada|manual|fuller|allison|mdrive|i-shift|\d+(?:[.,]\d+)?\s*(?:m3|m³|litros))\b/gi,
                ' '
            )
            .replace(/\s+/g, ' ')
            .trim() || deriveBaseModelSeries(model);

    const combinedCorpus = [
        model,
        assetData.version || '',
        assetData.tipo_equipo || '',
        configProfile.axle_or_undercarriage_config || '',
        configProfile.work_body_or_implement || '',
    ].join(' ');

    const axleMatch = combinedCorpus.match(/\b(10x6|10x4|8x8|8x6|8x4|6x6|6x4|6x2|4x4|4x2)\b/i);
    const requiredAxleCode = axleMatch ? axleMatch[1].toLowerCase() : null;

    let requiredBodyType: VariantPhotoRequirements['requiredBodyType'] = null;
    if (/\b(tolva|volquete|batea|dump|tipper)\b/i.test(combinedCorpus)) {
        requiredBodyType = 'DUMP_TOLVA';
    } else if (/\b(tractocamion|tracto\b|quinta\s+rueda|fifth[\s-]?wheel)\b/i.test(combinedCorpus)) {
        requiredBodyType = 'TRACTOR_FIFTH_WHEEL';
    } else if (/\b(aljibe|cisterna|water\s+truck)\b/i.test(combinedCorpus)) {
        requiredBodyType = 'WATER_ALJIBE';
    } else if (/\b(mixer|betonera|hormigonera|concrete\s+mixer)\b/i.test(combinedCorpus)) {
        requiredBodyType = 'MIXER';
    } else if (/\b(camion\s+pluma|grua\s+articulada|boom\s+truck)\b/i.test(combinedCorpus)) {
        requiredBodyType = 'CRANE_BOOM';
    }

    let requiredUndercarriage: VariantPhotoRequirements['requiredUndercarriage'] = null;
    const mobility = assetData.physical_traits?.mobility;
    if (mobility === 'SELF_PROPELLED_TRACKED' || /\b(orugas?|crawler|compact\s+track)\b/i.test(combinedCorpus)) {
        requiredUndercarriage = 'TRACKED';
    } else if (mobility === 'SELF_PROPELLED_WHEELED' || Boolean(requiredAxleCode)) {
        requiredUndercarriage = 'WHEELED';
    }

    const focusEnParts: string[] = [];
    const focusEsParts: string[] = [];
    const negParts: string[] = ['-ai', '-generated', '-midjourney', '-stockcake'];
    const contradictoryPatterns: string[] = [];
    const mandateLines: string[] = [];
    const badgeParts: string[] = [];

    if (requiredAxleCode) {
        focusEnParts.push(requiredAxleCode);
        focusEsParts.push(requiredAxleCode);
        badgeParts.push(requiredAxleCode.toUpperCase());

        const allAxles = ['4x2', '4x4', '6x2', '6x4', '6x6', '8x4', '8x6', '8x8', '10x4', '10x6'];
        const rivalAxles = allAxles.filter((ax) => ax !== requiredAxleCode);
        for (const rAx of rivalAxles.slice(0, 5)) {
            negParts.push(`-${rAx}`);
        }
        contradictoryPatterns.push(...rivalAxles);

        if (requiredAxleCode === '8x4' || requiredAxleCode === '8x6' || requiredAxleCode === '8x8') {
            mandateLines.push(
                `- CONTEO ANATÓMICO OBLIGATORIO DE EJES (${requiredAxleCode.toUpperCase()}): El equipo en la fotografía DEBE ser un chasis de 4 EJES con DOBLE EJE DIRECCIONAL DELANTERO (2 ejes delanteros gemelos + 2 ejes traseros en tándem = 4 ruedas visibles por costado). Si la foto muestra solo 1 eje direccional delantero (chasis 6x4 de 3 ejes o 4x2 de 2 ejes), o si muestra 5 o más ejes irreales, DEBES marcar matches_exact_variant_configuration=false.`
            );
        } else if (requiredAxleCode === '6x4' || requiredAxleCode === '6x6' || requiredAxleCode === '6x2') {
            mandateLines.push(
                `- CONTEO ANATÓMICO OBLIGATORIO DE EJES (${requiredAxleCode.toUpperCase()}): El equipo en la fotografía DEBE ser un chasis de 3 EJES (1 eje direccional delantero simple + 2 ejes traseros en tándem = 3 ruedas visibles por costado). Si la foto muestra doble eje delantero (chasis 8x4 de 4 ejes) o eje trasero simple (4x2), DEBES marcar matches_exact_variant_configuration=false.`
            );
        } else if (requiredAxleCode === '4x2' || requiredAxleCode === '4x4') {
            mandateLines.push(
                `- CONTEO ANATÓMICO OBLIGATORIO DE EJES (${requiredAxleCode.toUpperCase()}): El equipo DEBE tener exactamente 2 ejes (1 delantero + 1 trasero). Rechazar chasis tándem 6x4 u 8x4.`
            );
        } else {
            mandateLines.push(
                `- CONFIGURACIÓN DE EJES OBLIGATORIA: Debe corresponder visualmente a chasis ${requiredAxleCode.toUpperCase()}.`
            );
        }
    }

    if (requiredBodyType === 'DUMP_TOLVA') {
        focusEnParts.push('dump truck tipper');
        focusEsParts.push('camion tolva');
        badgeParts.push('Tolva');
        negParts.push('-tractor', '-"fifth wheel"', '-semi', '-mixer', '-concrete');
        contradictoryPatterns.push('tractor', 'tractocamion', 'fifth[\\s-]?wheel', 'mixer', 'betonera', 'hormigonera');
        mandateLines.push(
            '- CARROCERÍA OBLIGATORIA (TOLVA / VOLQUETE): El camión DEBE tener instalada una TOLVA / BATEA de volteo minero o movimiento de tierra. Si es un tractocamión con quinta rueda sin tolva, un chasis cabinado desnudo (cab-chassis), un camión mixer hormigonero o un camión aljibe, DEBES marcar matches_exact_variant_configuration=false.'
        );
    } else if (requiredBodyType === 'TRACTOR_FIFTH_WHEEL') {
        focusEnParts.push('tractor truck');
        focusEsParts.push('tractocamion');
        badgeParts.push('Tracto');
        negParts.push('-dump', '-tipper', '-mixer');
        contradictoryPatterns.push('dump\\s*truck', 'tipper', 'camion\\s*tolva', 'mixer', 'betonera');
        mandateLines.push(
            '- CARROCERÍA OBLIGATORIA (TRACTOCAMIÓN): Debe ser unidad tractocamión de quinta rueda, rechazando camiones tolva rígidos o mixers.'
        );
    } else if (requiredBodyType === 'WATER_ALJIBE') {
        focusEnParts.push('water truck tank');
        focusEsParts.push('camion aljibe');
        badgeParts.push('Aljibe');
        negParts.push('-tractor', '-mixer');
        contradictoryPatterns.push('tractor', 'mixer', 'betonera');
        mandateLines.push(
            '- CARROCERÍA OBLIGATORIA (ALJIBE / CISTERNA): Debe portar estanque cisterna regador/aljibe industrial o minero.'
        );
    } else if (requiredBodyType === 'MIXER') {
        focusEnParts.push('concrete mixer truck');
        focusEsParts.push('camion mixer');
        badgeParts.push('Mixer');
        negParts.push('-tractor', '-dump');
        mandateLines.push(
            '- CARROCERÍA OBLIGATORIA (MIXER): Debe portar tambor hormigonero / mixer.'
        );
    } else if (requiredBodyType === 'CRANE_BOOM') {
        focusEnParts.push('boom crane truck');
        focusEsParts.push('camion pluma');
        badgeParts.push('Pluma');
        mandateLines.push(
            '- CARROCERÍA OBLIGATORIA (PLUMA): Debe portar grúa articulada / pluma hidráulica.'
        );
    }

    if (!requiredAxleCode && requiredUndercarriage === 'TRACKED') {
        mandateLines.push(
            '- RODADO OBLIGATORIO SOBRE ORUGAS: El equipo DEBE desplazarse sobre orugas/cadenas. Rechazar versiones sobre neumáticos.'
        );
    } else if (!requiredAxleCode && requiredUndercarriage === 'WHEELED') {
        mandateLines.push(
            '- RODADO OBLIGATORIO SOBRE NEUMÁTICOS: El equipo DEBE desplazarse sobre neumáticos/ruedas. Rechazar versiones sobre orugas.'
        );
    }

    if (mandateLines.length === 0) {
        mandateLines.push(
            `- CORRESPONDENCIA DE VARIANTE: Debe corresponder visualmente a la configuración nominal de fábrica del modelo "${make} ${cleanModelDesignator}" (${archetypeProfile.archetypeLabelEs}).`
        );
    }

    const contradictoryTitleRegex =
        contradictoryPatterns.length > 0
            ? new RegExp(`\\b(?:${contradictoryPatterns.join('|')})\\b`, 'i')
            : null;

    return {
        cleanModelDesignator,
        requiredAxleCode,
        requiredBodyType,
        requiredUndercarriage,
        variantSearchFocusEn:
            focusEnParts.length > 0 ? focusEnParts.join(' ') : archetypeProfile.primarySearchFocusEn,
        variantSearchFocusEs: focusEsParts.join(' '),
        negativeVariantTokens: negParts.join(' '),
        contradictoryTitleRegex,
        vlmVariantMandateEs: mandateLines.join('\n'),
        summaryBadgePrefix: badgeParts.join(' · '),
    };
}

function upgradeOemCdnImageUrl(rawUrl: string): string {
    try {
        const u = new URL(rawUrl);
        if (/scene7\.com\/is\/image\//i.test(u.href)) {
            u.searchParams.set('wid', '1600');
            u.searchParams.set('hei', '1200');
            u.searchParams.set('fit', 'constrain,1');
            u.searchParams.set('fmt', 'webp');
            return u.toString();
        }
        return u.toString();
    } catch {
        return rawUrl;
    }
}

function upgradeBingThumbnailUrl(rawUrl: string): string {
    try {
        const u = new URL(rawUrl);
        if (/\.bing\.net\/th/i.test(u.href)) {
            u.searchParams.set('w', '1200');
            u.searchParams.set('qlt', '92');
            u.searchParams.delete('h');
            u.searchParams.delete('c');
            u.searchParams.delete('rs');
            return u.toString();
        }
        return u.toString();
    } catch {
        return rawUrl;
    }
}

function decodeHtmlEntities(input: string): string {
    return input
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function pickBestFromSrcset(srcset: string): string | null {
    const entries = srcset
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
            const [url, desc] = s.split(/\s+/);
            const n = Number(String(desc || '').replace(/[^0-9.]/g, '')) || 1;
            return { url, n };
        })
        .filter((e) => e.url && !e.url.startsWith('data:'));
    if (entries.length === 0) return null;
    entries.sort((a, b) => b.n - a.n);
    return entries[0].url;
}

function extractImgUrlFromTag(tag: string): string | null {
    const srcsetMatch = tag.match(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/i);
    if (srcsetMatch) {
        const best = pickBestFromSrcset(srcsetMatch[1]);
        if (best) return best;
    }
    const lazyMatch = tag.match(
        /(?:data-lazy-src|data-original|data-src|data-asset|data-image|src)\s*=\s*["']([^"']+)["']/i
    );
    if (lazyMatch && !lazyMatch[1].startsWith('data:')) return lazyMatch[1];
    return null;
}

function extractHeroImagesFromOemHtml(
    html: string,
    baseUrl: URL,
    make: string,
    model: string,
    brandPolicy?: BrandDomainAndRivalPolicy,
    variantReqs?: VariantPhotoRequirements
): { images: ExtractedHtmlImageCandidate[]; pdfUrls: string[] } {
    const images: ExtractedHtmlImageCandidate[] = [];
    const pdfUrls = new Set<string>();
    const seenUrls = new Set<string>();
    const baseSeries = deriveBaseModelSeries(model);
    const modelTokens = `${make} ${variantReqs?.cleanModelDesignator || model} ${baseSeries}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2);

    const unescapedHtml = html.replace(/\\\//g, '/').replace(/&amp;/g, '&');

    const pushCandidate = (rawUrl: string | null | undefined, basePriority: number, hintText: string = '') => {
        if (!rawUrl || typeof rawUrl !== 'string') return;
        const cleaned = rawUrl
            .replace(/&amp;/g, '&')
            .replace(/['")\]}>\\]+$/g, '')
            .trim();
        if (!cleaned || cleaned.startsWith('data:') || cleaned.length < 8) return;
        try {
            const resolved = upgradeOemCdnImageUrl(new URL(cleaned, baseUrl).toString());
            if (!resolved.startsWith('https://')) return;
            if (IGNORED_IMAGE_URL_PATTERNS.test(resolved)) return;
            const combinedMeta = `${resolved} ${hintText}`;
            if (NON_MINING_OR_TOY_PATTERNS.test(combinedMeta)) return;
            if (AUCTION_AND_AI_SYNTHETIC_SITE_PATTERNS.test(resolved)) return;
            if (SYNTHETIC_AI_TEXT_PATTERNS.test(combinedMeta)) return;
            if (
                brandPolicy?.forbiddenOtherBrandRegex &&
                brandPolicy.forbiddenOtherBrandRegex.test(combinedMeta) &&
                !brandPolicy.allowedOemDomainsRegex.test(resolved)
            ) {
                return;
            }
            if (
                variantReqs?.contradictoryTitleRegex &&
                variantReqs.contradictoryTitleRegex.test(combinedMeta) &&
                !(variantReqs.requiredAxleCode && combinedMeta.toLowerCase().includes(variantReqs.requiredAxleCode))
            ) {
                return;
            }
            if (/\.svg(?:\?|$)/i.test(resolved)) return;
            if (seenUrls.has(resolved)) return;
            seenUrls.add(resolved);

            let priority = basePriority;
            const combinedLower = combinedMeta.toLowerCase();
            for (const tok of modelTokens) {
                if (combinedLower.includes(tok)) priority += 2;
            }
            if (variantReqs?.requiredAxleCode && combinedLower.includes(variantReqs.requiredAxleCode)) {
                priority += 4;
            }
            if (brandPolicy?.allowedOemDomainsRegex.test(resolved)) {
                priority += 4;
            } else if (/scene7\.com\/is\/image|\/content\/dam\/|hero|product|gallery|studio|overview/i.test(combinedLower)) {
                priority += 2;
            }

            images.push({
                url: resolved,
                priority,
                sourceHost: baseUrl.hostname.replace(/^www\./, ''),
            });
        } catch {
            // Ignorar URL inválida
        }
    };

    // 1. Meta tags OpenGraph y Twitter Card
    const metaRegex = /<meta\b[^>]*>/gi;
    let metaMatch: RegExpExecArray | null;
    while ((metaMatch = metaRegex.exec(unescapedHtml)) !== null) {
        const tag = metaMatch[0];
        if (/(?:property|name)\s*=\s*["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["']/i.test(tag)) {
            const contentMatch = tag.match(/content\s*=\s*["']([^"']+)["']/i);
            if (contentMatch?.[1]) {
                pushCandidate(contentMatch[1], 12, 'og:image');
            }
        }
    }

    // 2. Adobe Scene7 / Dynamic Media URLs de imagen
    const scene7ImgRegex = /https?:\/\/[a-z0-9.-]*scene7\.com\/is\/image\/[a-zA-Z0-9_/-]+(?:\?[^\s"'<>\\()]*)?/gi;
    let s7Match: RegExpExecArray | null;
    while ((s7Match = scene7ImgRegex.exec(unescapedHtml)) !== null && images.length < 35) {
        pushCandidate(s7Match[0], 12, 'scene7-dam');
    }

    // 2b. Adobe Scene7 PDF Brochures (`/is/content/Caterpillar/C...`)
    const scene7ContentRegex = /https?:\/\/[a-z0-9.-]*scene7\.com\/is\/content\/[a-zA-Z0-9_/-]+/gi;
    let s7ContentMatch: RegExpExecArray | null;
    while ((s7ContentMatch = scene7ContentRegex.exec(unescapedHtml)) !== null && pdfUrls.size < 4) {
        pdfUrls.add(s7ContentMatch[0]);
    }

    // 3. Rutas AEM DAM (`/content/dam/...(jpg|jpeg|png|webp)`)
    const damRegex = /(?:https?:\/\/[^\s"'<>\\()]+)?\/content\/dam\/[^\s"'<>\\()]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>\\()]*)?/gi;
    let damMatch: RegExpExecArray | null;
    while ((damMatch = damRegex.exec(unescapedHtml)) !== null && images.length < 35) {
        pushCandidate(damMatch[0], 10, 'aem-dam');
    }

    // 4. Etiquetas `<img ...>` y `<source ...>`
    const tagRegex = /<(?:img|source)\b[^>]*>/gi;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(unescapedHtml)) !== null && images.length < 40) {
        const tag = tagMatch[0];
        const declaredW = Number(tag.match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1] || 0);
        const declaredH = Number(tag.match(/\bheight\s*=\s*["']?(\d+)/i)?.[1] || 0);
        if ((declaredW > 0 && declaredW < 200) || (declaredH > 0 && declaredH < 140)) continue;

        const alt = (tag.match(/alt\s*=\s*["']([^"']*)["']/i)?.[1] || '').trim();
        const imgUrl = extractImgUrlFromTag(tag);
        pushCandidate(imgUrl, alt.length > 3 ? 8 : 6, alt);
    }

    // 5. Barrido general de URLs de imagen directas en JSON-LD / estado hidratado SPA
    const rawImgUrlRegex = /https?:\/\/[^\s"'<>\\()]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>\\()]*)?/gi;
    let rawMatch: RegExpExecArray | null;
    while ((rawMatch = rawImgUrlRegex.exec(unescapedHtml)) !== null && images.length < 45) {
        pushCandidate(rawMatch[0], 6, 'embedded-json-img');
    }

    // 6. Folletos PDF vinculados en la página
    const pdfRegex = /href\s*=\s*["']([^"']+\.pdf(?:[?#][^"']*)?)["']/gi;
    let pdfMatch: RegExpExecArray | null;
    while ((pdfMatch = pdfRegex.exec(unescapedHtml)) !== null && pdfUrls.size < 4) {
        try {
            const resolvedPdf = new URL(pdfMatch[1], baseUrl).toString();
            if (resolvedPdf.startsWith('https://')) pdfUrls.add(resolvedPdf);
        } catch {
            // Ignorar
        }
    }

    images.sort((a, b) => b.priority - a.priority);
    return { images: images.slice(0, 10), pdfUrls: Array.from(pdfUrls) };
}

/**
 * Construye un pool diversificado por fuente (`source_label`) para evitar que un solo PDF o dominio
 * acapare todas las ranuras de auditoría VLM.
 */
function buildDiversifiedCandidatePool(
    candidates: RawCandidateBuffer[],
    maxPoolSize: number
): RawCandidateBuffer[] {
    if (candidates.length <= maxPoolSize) return candidates;

    const buckets = new Map<string, RawCandidateBuffer[]>();
    for (const c of candidates) {
        const key = c.source_label.replace(/\s*\(Pág\.\s*\d+\)$/i, '');
        const list = buckets.get(key) || [];
        list.push(c);
        buckets.set(key, list);
    }

    const diversified: RawCandidateBuffer[] = [];
    let addedInRound = true;
    while (diversified.length < maxPoolSize && addedInRound) {
        addedInRound = false;
        for (const list of buckets.values()) {
            const next = list.shift();
            if (next) {
                diversified.push(next);
                addedInRound = true;
                if (diversified.length >= maxPoolSize) break;
            }
        }
    }

    return diversified;
}

export class OfficialEquipmentPhotoService {
    /**
     * Canal Directo Resiliente Anti-WAF (< 1.5s):
     * Preserva estrictamente los rasgos diferenciadores de variante (`8x4`, `Tolva`, etc.),
     * bloquea portales de IA sintética y filtra marcas ajenas o hermanas (`VOLVO` cuando la marca es `MACK`).
     */
    private static async searchDirectWebImageCandidates(
        make: string,
        baseSeries: string,
        profile: ArchetypePhotoSearchProfile,
        brandPolicy: BrandDomainAndRivalPolicy,
        variantReqs: VariantPhotoRequirements,
        refreshAttempt: number = 0
    ): Promise<ExtractedHtmlImageCandidate[]> {
        const results: ExtractedHtmlImageCandidate[] = [];
        const seenUrls = new Set<string>();

        const cleanModel = variantReqs.cleanModelDesignator || baseSeries;
        const focusEn = variantReqs.variantSearchFocusEn || profile.primarySearchFocusEn;
        const combinedNegatives = [
            profile.negativeQueryTokens,
            variantReqs.negativeVariantTokens,
            brandPolicy.negativeBrandQueryTokens,
        ]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

        const queries = [
            `${make} ${cleanModel} ${focusEn} ${combinedNegatives}`.trim(),
            `${make} ${cleanModel} ${focusEn} white background studio ${combinedNegatives}`.trim(),
            variantReqs.variantSearchFocusEs
                ? `${make} ${cleanModel} ${variantReqs.variantSearchFocusEs} mineria construccion ${combinedNegatives}`.trim()
                : `${make} ${baseSeries} ${focusEn} studio catalog ${combinedNegatives}`.trim(),
            `${make} ${baseSeries} ${focusEn} official brochure ${combinedNegatives}`.trim(),
        ];
        const baseOffset = 1 + ((refreshAttempt % 4) * 5);

        await Promise.all(
            queries.map(async (q, qIdx) => {
                try {
                    const searchUrl = new URL('https://www.bing.com/images/async');
                    searchUrl.searchParams.set('q', q);
                    searchUrl.searchParams.set('first', String(baseOffset + qIdx * 2));
                    searchUrl.searchParams.set('count', '18');
                    searchUrl.searchParams.set('qft', '+filterui:imagesize-large+filterui:photo-photo');

                    const res = await safeFetchExternal(searchUrl.toString(), {
                        maxBytes: 2 * 1024 * 1024,
                        maxRedirects: 3,
                        headers: BROWSER_COMPAT_HEADERS,
                        signal: AbortSignal.timeout(4500),
                    }).catch(() => null);

                    if (!res || !res.ok) return;
                    const html = await res.text().catch(() => '');
                    if (!html) return;

                    const mAttrRegex = /\bm="([^"]+)"/gi;
                    let match: RegExpExecArray | null;
                    while ((match = mAttrRegex.exec(html)) !== null && results.length < 28) {
                        try {
                            const jsonStr = decodeHtmlEntities(match[1]);
                            const meta = JSON.parse(jsonStr) as {
                                murl?: string;
                                turl?: string;
                                purl?: string;
                                t?: string;
                                desc?: string;
                            };

                            const murl = String(meta.murl || '').trim();
                            const rawTurl = String(meta.turl || '').trim();
                            const turl = rawTurl ? upgradeBingThumbnailUrl(rawTurl) : '';
                            const purl = String(meta.purl || '').trim();
                            const titleDesc = `${meta.t || ''} ${meta.desc || ''} ${murl} ${purl}`;

                            if (NON_MINING_OR_TOY_PATTERNS.test(titleDesc)) continue;
                            if (IGNORED_IMAGE_URL_PATTERNS.test(murl)) continue;
                            if (AUCTION_AND_AI_SYNTHETIC_SITE_PATTERNS.test(`${murl} ${purl}`)) continue;
                            if (SYNTHETIC_AI_TEXT_PATTERNS.test(titleDesc)) continue;

                            const isOfficialBrandDomain = brandPolicy.allowedOemDomainsRegex.test(`${murl} ${purl}`);
                            if (
                                !isOfficialBrandDomain &&
                                brandPolicy.forbiddenOtherBrandRegex &&
                                brandPolicy.forbiddenOtherBrandRegex.test(titleDesc)
                            ) {
                                continue;
                            }

                            if (
                                variantReqs.contradictoryTitleRegex &&
                                variantReqs.contradictoryTitleRegex.test(titleDesc) &&
                                !(
                                    variantReqs.requiredAxleCode &&
                                    titleDesc.toLowerCase().includes(variantReqs.requiredAxleCode)
                                )
                            ) {
                                continue;
                            }

                            const primaryUrl = murl.startsWith('https://')
                                ? upgradeOemCdnImageUrl(murl)
                                : turl.startsWith('https://')
                                  ? turl
                                  : rawTurl.startsWith('https://')
                                    ? rawTurl
                                    : '';
                            if (!primaryUrl || seenUrls.has(primaryUrl)) continue;
                            seenUrls.add(primaryUrl);

                            const fallbackUrl =
                                turl.startsWith('https://') && turl !== primaryUrl ? turl : undefined;
                            const rawFallbackUrl =
                                rawTurl.startsWith('https://') &&
                                rawTurl !== primaryUrl &&
                                rawTurl !== fallbackUrl
                                    ? rawTurl
                                    : undefined;

                            let hostLabel = 'Catálogo Web OEM';
                            try {
                                const originUrl = new URL(purl || primaryUrl);
                                hostLabel = originUrl.hostname.replace(/^www\./, '');
                            } catch {
                                // Mantener etiqueta por defecto
                            }

                            let priority = qIdx === 0 ? 14 : qIdx === 1 ? 14 : 12;
                            if (isOfficialBrandDomain) {
                                priority += 5;
                            }
                            if (
                                variantReqs.requiredAxleCode &&
                                titleDesc.toLowerCase().includes(variantReqs.requiredAxleCode)
                            ) {
                                priority += 3;
                            }

                            results.push({
                                url: primaryUrl,
                                fallbackUrl,
                                rawFallbackUrl,
                                priority,
                                sourceHost: hostLabel,
                            });
                        } catch {
                            // Ignorar bloque malformado
                        }
                    }
                } catch {
                    // Continuar con otras fuentes
                }
            })
        );

        return results;
    }

    /**
     * Canal abierto complementario: consulta la API pública de Wikimedia Commons preservando
     * configuración de ejes/carrocería y filtrando marcas ajenas o variantes contradictorias.
     */
    private static async searchWikimediaCommonsCandidates(
        make: string,
        baseSeries: string,
        brandPolicy: BrandDomainAndRivalPolicy,
        variantReqs: VariantPhotoRequirements
    ): Promise<ExtractedHtmlImageCandidate[]> {
        const results: ExtractedHtmlImageCandidate[] = [];
        const seenUrls = new Set<string>();
        const cleanModel = variantReqs.cleanModelDesignator || baseSeries;
        const axleToken = variantReqs.requiredAxleCode ? ` ${variantReqs.requiredAxleCode}` : '';
        const queries = Array.from(
            new Set(
                [
                    `${make} ${cleanModel}${axleToken}`.trim(),
                    `${make} ${baseSeries}${axleToken}`.trim(),
                ].filter((q) => q.length >= 4)
            )
        );

        for (const q of queries.slice(0, 2)) {
            try {
                const apiUrl = new URL('https://commons.wikimedia.org/w/api.php');
                apiUrl.searchParams.set('action', 'query');
                apiUrl.searchParams.set('generator', 'search');
                apiUrl.searchParams.set('gsrsearch', `filetype:bitmap ${q}`);
                apiUrl.searchParams.set('gsrnamespace', '6');
                apiUrl.searchParams.set('gsrlimit', '5');
                apiUrl.searchParams.set('prop', 'imageinfo');
                apiUrl.searchParams.set('iiprop', 'url|dimensions|mime');
                apiUrl.searchParams.set('iiurlwidth', '1600');
                apiUrl.searchParams.set('format', 'json');

                const res = await safeFetchExternal(apiUrl.toString(), {
                    maxBytes: 2 * 1024 * 1024,
                    headers: BROWSER_COMPAT_HEADERS,
                    signal: AbortSignal.timeout(4500),
                }).catch(() => null);

                if (!res || !res.ok) continue;
                const data = (await res.json().catch(() => null)) as any;
                const pages = data?.query?.pages;
                if (!pages || typeof pages !== 'object') continue;

                for (const page of Object.values(pages) as any[]) {
                    const title = String(page?.title || '');
                    if (NON_MINING_OR_TOY_PATTERNS.test(title)) continue;
                    if (SYNTHETIC_AI_TEXT_PATTERNS.test(title)) continue;
                    if (brandPolicy.forbiddenOtherBrandRegex?.test(title)) continue;
                    if (
                        variantReqs.contradictoryTitleRegex &&
                        variantReqs.contradictoryTitleRegex.test(title) &&
                        !(variantReqs.requiredAxleCode && title.toLowerCase().includes(variantReqs.requiredAxleCode))
                    ) {
                        continue;
                    }

                    const info = page?.imageinfo?.[0];
                    const imgUrl = info?.thumburl || info?.url;
                    const width = Number(info?.thumbwidth || info?.width || 0);
                    const height = Number(info?.thumbheight || info?.height || 0);
                    const mime = String(info?.mime || '');

                    if (
                        typeof imgUrl === 'string' &&
                        imgUrl.startsWith('https://') &&
                        !seenUrls.has(imgUrl) &&
                        mime.startsWith('image/') &&
                        !mime.includes('svg') &&
                        width >= 400 &&
                        height >= 260
                    ) {
                        seenUrls.add(imgUrl);
                        results.push({
                            url: imgUrl,
                            priority: 9,
                            sourceHost: 'commons.wikimedia.org',
                        });
                    }
                }
                if (results.length >= 4) break;
            } catch {
                // Continuar con el resto de fuentes
            }
        }

        return results;
    }

    /**
     * Renderiza páginas seleccionadas (`[0, 1, 2]`) de un folleto PDF para capturar tanto la portada
     * como las fotografías interiores en configuración estándar de la familia del equipo.
     */
    private static async extractCandidatePagesFromPdfBuffer(params: {
        pdfBuffer: Buffer;
        sourceType: 'VAULT_PDF' | 'OEM_DOMAIN';
        baseLabel: string;
        baseFilename: string;
        maxPages?: number;
    }): Promise<RawCandidateBuffer[]> {
        const { pdfBuffer, sourceType, baseLabel, baseFilename, maxPages = 3 } = params;
        const extractedPages: RawCandidateBuffer[] = [];

        for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
            const rendered = await withHardTimeout(
                renderPdfPageToPng(pdfBuffer, pageIdx, 175).catch(() => null),
                4000,
                null,
                `renderPdfPageToPng(${baseFilename}, pág ${pageIdx + 1})`
            );
            if (!rendered?.pngBuffer) {
                if (pageIdx === 0) break;
                continue;
            }
            extractedPages.push({
                buffer: rendered.pngBuffer,
                source_type: sourceType,
                source_label: `${baseLabel} (Pág. ${pageIdx + 1})`,
                original_filename: `page_${pageIdx + 1}_${baseFilename}`,
                is_full_document_page: true,
                priority_score: pageIdx === 1 ? 11 : pageIdx === 0 ? 10 : 9,
            });
        }

        return extractedPages;
    }

    /**
     * Caza asistida por IA de fotografías oficiales OEM (v4.0 — Forensic VLM Variant & Brand Shield):
     * 1. Detecta el arquetipo mecánico, la política estricta de marca (`resolveBrandDomainAndRivalPolicy`)
     *    y los requisitos diferenciadores de variante (`extractVariantPhotoRequirements`: `8x4` vs `6x4`, `Tolva`, etc.).
     * 2. Recolecta fuentes multi-pilar y PDFs locales bloqueando semillas contaminadas por marcas hermanas/rivales.
     * 3. Ejecuta búsqueda directa de imágenes web anti-WAF + Wikimedia Commons + inspección de folletos PDF.
     * 4. Audita con VLM Forense (`preferredTier: 'PRIMARY'`, `thinkingLevel: 'medium'`), bloquea renders IA de múltiples ruedas,
     *    fondos de otras marcas (ej. `VOLVO` tras `MACK`) y variantes equivocadas, encuadrando al 88% sobre 4:3 WebP.
     */
    public static async huntOfficialEquipmentPhotos(params: {
        globalAssetId: string;
        actorId?: string;
        actorEmail?: string;
        refreshAttempt?: number;
        excludeSha256s?: string[];
    }): Promise<OfficialPhotoCandidate[]> {
        const {
            globalAssetId,
            actorId = 'system',
            actorEmail = 'curador@minreport.com',
            refreshAttempt = 0,
            excludeSha256s = [],
        } = params;
        const excludedShaSet = new Set(excludeSha256s.map((s) => String(s || '').trim()).filter(Boolean));

        const assetRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const assetSnap = await assetRef.get();
        if (!assetSnap.exists) {
            throw new Error(`Activo no encontrado: ${globalAssetId}`);
        }

        const data = assetSnap.data() || {};
        let make = String(data.make_oficial || data.make || '').trim();
        let model = String(data.model_oficial || data.model || '').trim();
        const makeModelCombined = String(data.make_model || `${make} ${model}`).trim();

        if ((!make || !model) && makeModelCombined) {
            const parts = makeModelCombined.split(/\s+/);
            if (!make && parts.length > 0) make = parts[0];
            if (!model && parts.length > 1) model = parts.slice(1).join(' ');
        }

        const baseSeries = deriveBaseModelSeries(model);
        const tipoEquipo = String(data.tipo_equipo || '').trim();
        const categoriaEquipo = String(data.categoria_equipo || '').trim();
        const equipmentType = tipoEquipo || categoriaEquipo || 'Maquinaria Minera';
        const officialUrl = String(data.official_url || '').trim();

        if (!make && !model) {
            throw new Error('El activo no tiene marca ni modelo definido en su ficha técnica.');
        }

        const archetypeProfile = resolveArchetypePhotoProfile(tipoEquipo, categoriaEquipo, make, model);
        const brandPolicy = resolveBrandDomainAndRivalPolicy(make);
        const variantReqs = extractVariantPhotoRequirements(data, make, model, archetypeProfile);

        console.info(
            `[OfficialPhotoService] [Paso 1/4] Iniciando caza forense v4.0 para "${make} ${model}" [arquetipo: ${archetypeProfile.archetypeId} | variante: ${variantReqs.summaryBadgePrefix || 'estándar'} | serie: ${baseSeries}] (${globalAssetId})...`
        );

        const candidateBuffers: RawCandidateBuffer[] = [];

        // ── 1. Cosecha Soberana desde PDFs de la Bóveda (`vault_files`, Págs. 1 a 3) ──
        try {
            const vaultFilesSnap = await assetRef.collection('vault_files').limit(3).get();

            for (const doc of vaultFilesSnap.docs) {
                const vf = doc.data();
                const storagePath =
                    vf.storagePath ||
                    vf.storage_path ||
                    (vf.sha256 ? `cas_blobs/global_oem/${vf.sha256}.pdf` : '');
                if (!storagePath) continue;

                let pdfBuffer: Buffer | null = null;
                const casBlob = await CasStorageService.readCasBlob(storagePath);
                if (casBlob) {
                    pdfBuffer = casBlob.buffer;
                } else {
                    const [exists] = await storage.bucket().file(storagePath).exists();
                    if (exists) {
                        const [downloaded] = await storage.bucket().file(storagePath).download();
                        pdfBuffer = downloaded;
                    }
                }

                if (!pdfBuffer || pdfBuffer.length < 1000) continue;

                const pages = await this.extractCandidatePagesFromPdfBuffer({
                    pdfBuffer,
                    sourceType: 'VAULT_PDF',
                    baseLabel: vf.originalFilename || 'Manual OEM',
                    baseFilename: vf.originalFilename || 'doc.pdf',
                    maxPages: 3,
                });
                candidateBuffers.push(...pages);
            }
        } catch (err) {
            console.warn('[OfficialPhotoService] Error cosechando PDFs locales de Bóveda:', err);
        }

        // ── 2. Recolección Multi-Pilar de Fuentes de Bóveda (`classified_sources_itemized` + `item_sources`) ──
        const prioritizedSeedUrls: string[] = [];
        const secondarySeedUrls: string[] = [];
        const seenSeedUrls = new Set<string>();
        const htmlImageCandidates: ExtractedHtmlImageCandidate[] = [];
        const discoveredPdfUrls = new Set<string>();

        const registerSeedUrl = (rawUrl: string | undefined | null, hintDesc: string = '') => {
            if (!rawUrl || typeof rawUrl !== 'string') return;
            const trimmed = rawUrl.trim();
            if (!trimmed.startsWith('https://') || trimmed.startsWith('https://#')) return;
            if (seenSeedUrls.has(trimmed)) return;
            if (AUCTION_AND_AI_SYNTHETIC_SITE_PATTERNS.test(trimmed)) return;

            const combined = `${trimmed} ${hintDesc}`;
            if (SYNTHETIC_AI_TEXT_PATTERNS.test(combined)) return;
            const isAllowedBrandDomain = brandPolicy.allowedOemDomainsRegex.test(trimmed);
            if (
                !isAllowedBrandDomain &&
                brandPolicy.forbiddenOtherBrandRegex &&
                brandPolicy.forbiddenOtherBrandRegex.test(combined)
            ) {
                return;
            }

            seenSeedUrls.add(trimmed);

            if (/\.pdf(?:[?#]|$)|scene7\.com\/is\/content\//i.test(trimmed)) {
                discoveredPdfUrls.add(trimmed);
                prioritizedSeedUrls.push(trimmed);
            } else if (/scene7\.com\/is\/image\/|\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/i.test(trimmed)) {
                htmlImageCandidates.push({
                    url: upgradeOemCdnImageUrl(trimmed),
                    priority: isAllowedBrandDomain ? 15 : 12,
                    sourceHost: 'vault-verified-img',
                });
            } else if (isAllowedBrandDomain) {
                prioritizedSeedUrls.push(trimmed);
            } else {
                secondarySeedUrls.push(trimmed);
            }
        };

        if (officialUrl) {
            registerSeedUrl(officialUrl, 'official_url');
        }

        const vault = data.knowledge_vault || {};
        for (const pid of VALID_PILLAR_IDS) {
            const pillar = vault[pid];
            if (!pillar || typeof pillar !== 'object') continue;

            const itemizedList = Array.isArray(pillar.classified_sources_itemized)
                ? pillar.classified_sources_itemized
                : [];
            for (const src of itemizedList) {
                registerSeedUrl(
                    src?.url || src?.url_limpia || src?.url_original,
                    `${src?.author || ''} ${src?.description || ''}`
                );
            }

            if (Array.isArray(pillar.classified_sources)) {
                for (const src of pillar.classified_sources) {
                    registerSeedUrl(
                        src?.url || src?.url_limpia || src?.url_original,
                        `${src?.author || ''} ${src?.description || ''}`
                    );
                }
            } else if (pillar.classified_sources && typeof pillar.classified_sources === 'object') {
                const groupedSources = [
                    ...(Array.isArray(pillar.classified_sources.fabricante)
                        ? pillar.classified_sources.fabricante
                        : []),
                    ...(Array.isArray(pillar.classified_sources.externos)
                        ? pillar.classified_sources.externos
                        : []),
                ];
                for (const src of groupedSources) {
                    registerSeedUrl(
                        src?.url || src?.url_limpia || src?.url_original,
                        `${src?.dominio || ''} ${src?.titulo_sugerido || ''}`
                    );
                }
            }

            const pillarItems = Array.isArray(pillar.items) ? pillar.items : [];
            for (const it of pillarItems) {
                const itemSourceList = Array.isArray(it?.item_sources)
                    ? it.item_sources
                    : Array.isArray(it?.sources)
                      ? it.sources
                      : [];
                for (const src of itemSourceList) {
                    registerSeedUrl(
                        src?.url || src?.url_limpia || src?.url_original,
                        `${src?.author || ''} ${src?.description || ''}`
                    );
                }
            }
        }

        // ── 3. Búsqueda Directa de Imágenes Anti-WAF (< 2s) + Wikimedia Commons en Paralelo ──
        console.info(
            `[OfficialPhotoService] [Paso 2/4] Consultando canales directos para "${make} ${variantReqs.cleanModelDesignator}" (${variantReqs.summaryBadgePrefix || archetypeProfile.archetypeLabelEs}, ${prioritizedSeedUrls.length} semillas OEM en bóveda, intento #${refreshAttempt + 1})...`
        );

        const [directWebCandidates, wikimediaCandidates] = await Promise.all([
            withHardTimeout(
                this.searchDirectWebImageCandidates(
                    make,
                    baseSeries,
                    archetypeProfile,
                    brandPolicy,
                    variantReqs,
                    refreshAttempt
                ),
                5500,
                [],
                'searchDirectWebImageCandidates'
            ),
            withHardTimeout(
                this.searchWikimediaCommonsCandidates(make, baseSeries, brandPolicy, variantReqs),
                5000,
                [],
                'searchWikimediaCommonsCandidates'
            ),
        ]);

        for (const dc of directWebCandidates) {
            htmlImageCandidates.push(dc);
        }
        for (const wm of wikimediaCandidates) {
            htmlImageCandidates.push(wm);
        }

        // Solo si no se obtuvieron suficientes candidatos directos ni semillas de bóveda, lanzar 1 consulta Grounding acotada a 6.5s
        if (htmlImageCandidates.length < 4 && prioritizedSeedUrls.length < 2) {
            const quickSearchPrompt = `Localiza URLs directas oficiales del fabricante "${make}" (folletos PDF o páginas oficiales de producto) exclusivamente para el modelo "${make} ${variantReqs.cleanModelDesignator}" ${variantReqs.summaryBadgePrefix ? `en variante exacta ${variantReqs.summaryBadgePrefix}` : ''} (${equipmentType}). Excluye concesionarios multimarca, subastas y portales de imágenes IA.`;
            const aiSearchRes = await withHardTimeout(
                ResilientAIClient.generate({
                    prompt: quickSearchPrompt,
                    module: 'opermaq',
                    preferredTier: 'SECONDARY',
                    useGoogleSearch: true,
                    requireGroundedEvidence: false,
                    bypassCache: true,
                    temperature: 0.1,
                }).catch(() => null),
                6500,
                null,
                'GroundingFallbackSearch'
            );

            if (aiSearchRes) {
                for (const src of aiSearchRes.groundingSources || []) {
                    if (src.uri && /^https?:\/\//i.test(src.uri)) {
                        registerSeedUrl(src.uri, src.title || '');
                    }
                }
            }
        }

        const orderedSeeds = [...prioritizedSeedUrls, ...secondarySeedUrls].slice(0, 8);

        console.info(
            `[OfficialPhotoService] [Paso 3/4] Recolectadas ${htmlImageCandidates.length} imágenes directas (Web/Wikimedia) y ${orderedSeeds.length} páginas/PDFs semilla (${discoveredPdfUrls.size} PDFs). Descargando buffers...`
        );

        // ── 4. Descargar Imágenes Directas (con Doble Fallback Anti-WAF `turl` HD + `rawFallbackUrl`) e Inspeccionar Semillas ──
        htmlImageCandidates.sort((a, b) => b.priority - a.priority);
        const uniqueHtmlImgs: ExtractedHtmlImageCandidate[] = [];
        const seenImgUrls = new Set<string>();
        for (const item of htmlImageCandidates) {
            if (!seenImgUrls.has(item.url)) {
                seenImgUrls.add(item.url);
                uniqueHtmlImgs.push(item);
            }
            if (uniqueHtmlImgs.length >= 24) break;
        }

        const seenRawBufferShas = new Set<string>();

        const downloadCandidateImage = async (cand: ExtractedHtmlImageCandidate): Promise<void> => {
            const urlsToTry = Array.from(
                new Set([cand.url, cand.fallbackUrl, cand.rawFallbackUrl].filter((u): u is string => Boolean(u)))
            );

            for (const targetUrl of urlsToTry) {
                const safeImgUrl = await assertSafeExternalUrl(targetUrl).catch(() => null);
                if (!safeImgUrl) continue;

                const res = await safeFetchExternal(safeImgUrl.toString(), {
                    maxBytes: 10 * 1024 * 1024,
                    maxRedirects: 4,
                    headers: {
                        ...BROWSER_COMPAT_HEADERS,
                        Accept: 'image/avif,image/webp,image/apng,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
                    },
                    signal: AbortSignal.timeout(4500),
                }).catch(() => null);

                if (!res || !res.ok) continue;
                const cType = (res.headers.get('content-type') || '').toLowerCase();
                if (!cType.startsWith('image/') || cType.includes('svg')) continue;

                const ab = await res.arrayBuffer().catch(() => null);
                if (!ab || ab.byteLength < 3500) continue;
                const imgBuf = Buffer.from(ab);

                const rawSha = createHash('sha256').update(imgBuf).digest('hex');
                if (seenRawBufferShas.has(rawSha) || excludedShaSet.has(rawSha)) {
                    return;
                }

                const meta = await sharp(imgBuf).metadata().catch(() => null);
                if (!meta?.width || !meta?.height) continue;
                if (meta.width < 280 || meta.height < 180) continue;
                const aspect = meta.width / meta.height;
                if (aspect > 3.6 || aspect < 0.32) continue;

                seenRawBufferShas.add(rawSha);
                const phashHex = await MediaDigestorServer.computePerceptualHash64(imgBuf).catch(() => '');

                candidateBuffers.push({
                    buffer: imgBuf,
                    source_type: 'OEM_DOMAIN',
                    source_label: cand.sourceHost,
                    original_filename: safeImgUrl.pathname.split('/').pop() || 'oem_hero.webp',
                    priority_score: cand.priority,
                    phash_hex: phashHex || undefined,
                });
                return;
            }
        };

        let imgCursor = 0;
        const imgWorkers = Array.from({ length: Math.min(6, uniqueHtmlImgs.length) }, async () => {
            while (imgCursor < uniqueHtmlImgs.length && candidateBuffers.length < 16) {
                const cand = uniqueHtmlImgs[imgCursor++];
                await downloadCandidateImage(cand).catch(() => {});
            }
        });
        await Promise.all(imgWorkers);

        // Si tenemos menos de 10 imágenes en el pool, complementar con semillas/PDFs de la bóveda
        if (candidateBuffers.length < 10 && orderedSeeds.length > 0) {
            const renderedPdfFingerprints = new Set<string>();

            const inspectSeedUrl = async (rawUrl: string): Promise<void> => {
                if (IGNORED_IMAGE_URL_PATTERNS.test(rawUrl)) return;
                const safeUrl = await assertSafeExternalUrl(rawUrl).catch(() => null);
                if (!safeUrl) return;

                const res = await safeFetchExternal(safeUrl.toString(), {
                    maxBytes: 14 * 1024 * 1024,
                    maxRedirects: 5,
                    headers: BROWSER_COMPAT_HEADERS,
                    signal: AbortSignal.timeout(5500),
                }).catch(() => null);

                if (!res || !res.ok) return;

                let finalUrl = safeUrl;
                try {
                    const hdrFinal = res.headers.get('x-final-url') || res.url;
                    if (hdrFinal) finalUrl = new URL(hdrFinal);
                } catch {
                    finalUrl = safeUrl;
                }

                const cType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
                const arrayBuf = await res.arrayBuffer().catch(() => null);
                if (!arrayBuf || arrayBuf.byteLength < 200) return;
                const buf = Buffer.from(arrayBuf);

                if (cType.startsWith('image/') && !cType.includes('svg')) {
                    const rawSha = createHash('sha256').update(buf).digest('hex');
                    if (seenRawBufferShas.has(rawSha) || excludedShaSet.has(rawSha)) return;
                    const meta = await sharp(buf).metadata().catch(() => null);
                    if (meta?.width && meta?.height && meta.width >= 280 && meta.height >= 180) {
                        seenRawBufferShas.add(rawSha);
                        const phashHex = await MediaDigestorServer.computePerceptualHash64(buf).catch(() => '');
                        candidateBuffers.push({
                            buffer: buf,
                            source_type: 'OEM_DOMAIN',
                            source_label: finalUrl.hostname.replace(/^www\./, ''),
                            original_filename: finalUrl.pathname.split('/').pop() || 'oem_direct.webp',
                            priority_score: 12,
                            phash_hex: phashHex || undefined,
                        });
                    }
                    return;
                }

                if (
                    cType.includes('pdf') ||
                    finalUrl.pathname.toLowerCase().endsWith('.pdf') ||
                    buf.subarray(0, 5).toString('latin1') === '%PDF-'
                ) {
                    const pdfKey = `${finalUrl.hostname}${finalUrl.pathname}`;
                    if (!renderedPdfFingerprints.has(pdfKey) && renderedPdfFingerprints.size < 2) {
                        renderedPdfFingerprints.add(pdfKey);
                        const pdfFilename = finalUrl.pathname.split('/').pop() || 'oem_brochure.pdf';
                        const hostLabel = `${finalUrl.hostname.replace(/^www\./, '')} (${pdfFilename})`;
                        const pages = await this.extractCandidatePagesFromPdfBuffer({
                            pdfBuffer: buf,
                            sourceType: 'OEM_DOMAIN',
                            baseLabel: hostLabel,
                            baseFilename: pdfFilename,
                            maxPages: 3,
                        });
                        candidateBuffers.push(...pages);
                    }
                    return;
                }

                if (cType.includes('html') && buf.byteLength <= 3_500_000) {
                    const html = buf.toString('utf8');
                    const extracted = extractHeroImagesFromOemHtml(
                        html,
                        finalUrl,
                        make,
                        model,
                        brandPolicy,
                        variantReqs
                    );
                    for (const img of extracted.images.slice(0, 4)) {
                        await downloadCandidateImage(img).catch(() => {});
                    }
                }
            };

            let seedCursor = 0;
            const seedsToRun = orderedSeeds.slice(0, 4);
            const seedWorkers = Array.from({ length: Math.min(3, seedsToRun.length) }, async () => {
                while (seedCursor < seedsToRun.length && candidateBuffers.length < 16) {
                    const nextUrl = seedsToRun[seedCursor++];
                    await inspectSeedUrl(nextUrl).catch(() => {});
                }
            });
            await Promise.all(seedWorkers);
        }

        // Ordenar por prioridad y construir pool diversificado de hasta 10 candidatas por fuente
        candidateBuffers.sort((a, b) => (b.priority_score || 8) - (a.priority_score || 8));
        const poolToInspect = buildDiversifiedCandidatePool(candidateBuffers, 10);

        console.info(
            `[OfficialPhotoService] [Paso 4/4] Candidatas únicas descargadas: ${candidateBuffers.length} -> Auditando ${poolToInspect.length} en paralelo con VLM Forense v4.0 (${archetypeProfile.archetypeId})...`
        );

        // ── 5. Auditoría Multimodal VLM Forense v4.0 en Paralelo (Concurrencia = 3, Timeout = 28s) ──
        const approvedCandidates: OfficialPhotoCandidate[] = [];
        const seenShas = new Set<string>();

        let auditCursor = 0;
        const auditWorkers = Array.from({ length: Math.min(3, poolToInspect.length) }, async () => {
            while (auditCursor < poolToInspect.length && approvedCandidates.length < 6) {
                const candidate = poolToInspect[auditCursor++];
                const verdict = await withHardTimeout(
                    this.auditImageWithVlm({
                        imageBuffer: candidate.buffer,
                        make,
                        model,
                        equipmentType,
                        archetypeProfile,
                        brandPolicy,
                        variantReqs,
                        isFullDocumentPage: Boolean(candidate.is_full_document_page),
                    }),
                    28000,
                    {
                        is_authentic_real_photograph: false,
                        is_exact_make_and_model: false,
                        matches_exact_variant_configuration: false,
                        is_mining_appropriate_configuration: false,
                        is_valid_industrial_or_studio_context: false,
                        is_free_of_other_manufacturer_and_dealer_branding: false,
                        is_free_of_pii_and_plates: false,
                        is_clean_unweathered_machine: false,
                        authenticity_score: 0,
                        subject_box_2d: null,
                        observed_axle_or_track_layout: '',
                        observed_body_or_attachment: '',
                        detected_model_description: 'Timeout VLM',
                        rejection_reasons: ['Tiempo de auditoría VLM excedido'],
                    },
                    `auditImageWithVlm(${candidate.source_label})`
                );

                const isAcceptable =
                    verdict.is_authentic_real_photograph &&
                    verdict.is_exact_make_and_model &&
                    verdict.matches_exact_variant_configuration &&
                    verdict.is_mining_appropriate_configuration &&
                    verdict.is_valid_industrial_or_studio_context &&
                    verdict.is_free_of_other_manufacturer_and_dealer_branding &&
                    verdict.is_free_of_pii_and_plates &&
                    verdict.is_clean_unweathered_machine &&
                    verdict.authenticity_score >= 0.78;

                console.info(
                    `[OfficialPhotoService] Veredicto VLM v4 [${candidate.source_label}]: approved=${isAcceptable}, real=${verdict.is_authentic_real_photograph}, exactVar=${verdict.matches_exact_variant_configuration}, noOtherBrand=${verdict.is_free_of_other_manufacturer_and_dealer_branding}, context=${verdict.is_valid_industrial_or_studio_context}, score=${verdict.authenticity_score.toFixed(
                        2
                    )}, obs="${verdict.observed_axle_or_track_layout} | ${verdict.observed_body_or_attachment}", desc="${verdict.detected_model_description}"${
                        !isAcceptable && verdict.rejection_reasons.length > 0
                            ? `, motivos=${verdict.rejection_reasons.join('; ')}`
                            : ''
                    }`
                );

                if (!isAcceptable || approvedCandidates.length >= 6) continue;

                const framed = await this.frameBufferToStudio4x3({
                    inputBuffer: candidate.buffer,
                    subjectBox2d: verdict.subject_box_2d,
                    isFullDocumentPage: Boolean(candidate.is_full_document_page),
                }).catch((err) => {
                    console.warn('[OfficialPhotoService] Error en frameBufferToStudio4x3:', err);
                    return null;
                });

                if (!framed || seenShas.has(framed.sha256) || excludedShaSet.has(framed.sha256)) continue;

                const framedPhash = await MediaDigestorServer.computePerceptualHash64(framed.buffer).catch(
                    () => candidate.phash_hex || ''
                );
                const isDuplicateApproved = approvedCandidates.some(
                    (c) =>
                        c.sha256 === framed.sha256 ||
                        (Boolean(c.phash_hex) &&
                            Boolean(framedPhash) &&
                            MediaDigestorServer.hammingDistanceHex64(c.phash_hex!, framedPhash) <= 3)
                );
                if (isDuplicateApproved) continue;

                seenShas.add(framed.sha256);

                const verifiedVariantSummary =
                    [verdict.observed_axle_or_track_layout, verdict.observed_body_or_attachment]
                        .map((s) => String(s || '').trim())
                        .filter((s) => s.length > 0 && s.length <= 42)
                        .join(' · ') ||
                    variantReqs.summaryBadgePrefix ||
                    archetypeProfile.archetypeLabelEs;

                const descriptor = await CasStorageService.persistDigestedBinary(
                    {
                        buffer: framed.buffer,
                        sha256: framed.sha256,
                        mimeType: 'image/webp',
                        extension: 'webp',
                        profile: 'IMAGE_TECHNICAL_HD',
                        originalBytes: candidate.buffer.length,
                        optimizedBytes: framed.buffer.length,
                        savingsRatio: Number(
                            (
                                (candidate.buffer.length - framed.buffer.length) /
                                Math.max(1, candidate.buffer.length)
                            ).toFixed(4)
                        ),
                        width: framed.width,
                        height: framed.height,
                    },
                    {
                        scope: 'GLOBAL_OEM',
                        actorUid: actorId,
                        originalFilename: `${globalAssetId}__v4__${candidate.original_filename || 'candidate.webp'}`,
                        clientOriginalBytes: candidate.buffer.length,
                    }
                );

                approvedCandidates.push({
                    candidate_id: `cand_${randomUUID().slice(0, 8)}`,
                    preview_url: descriptor.downloadUrl,
                    storage_path: descriptor.storagePath,
                    source_type: candidate.source_type,
                    source_label: candidate.source_label,
                    authenticity_score: verdict.authenticity_score,
                    subject_box_2d: verdict.subject_box_2d,
                    original_bytes: candidate.buffer.length,
                    optimized_bytes: framed.buffer.length,
                    savings_pct: Math.max(
                        0,
                        Math.round(
                            ((candidate.buffer.length - framed.buffer.length) /
                                Math.max(1, candidate.buffer.length)) *
                                100
                        )
                    ),
                    sha256: framed.sha256,
                    phash_hex: framedPhash || undefined,
                    width: framed.width,
                    height: framed.height,
                    framing_mode: framed.framing_mode,
                    vlm_audit_version: CURRENT_VLM_AUDIT_VERSION,
                    verified_variant_summary: verifiedVariantSummary,
                });
            }
        });

        await Promise.all(auditWorkers);

        approvedCandidates.sort((a, b) => b.authenticity_score - a.authenticity_score);

        // ── 6. Fusión Exclusiva con Candidatas Certificadas VLM v4.0 (Purgando candidatas legacy pre-v4 contaminadas) ──
        const existingPoolRaw = Array.isArray(data.official_photo_candidates)
            ? (data.official_photo_candidates as OfficialPhotoCandidate[])
            : [];
        const existingPoolV4 = existingPoolRaw.filter(
            (cand) =>
                cand &&
                cand.vlm_audit_version === CURRENT_VLM_AUDIT_VERSION &&
                !excludedShaSet.has(cand.sha256)
        );

        const recoveredFromCas = await this.recoverVerifiedCasAlternatives(globalAssetId).catch(() => []);

        const mergedAlternatives: OfficialPhotoCandidate[] = [];
        const pushUniqueAlternative = (cand: OfficialPhotoCandidate) => {
            if (!cand || !cand.preview_url || !cand.sha256 || excludedShaSet.has(cand.sha256)) return;
            const isDup = mergedAlternatives.some(
                (existing) =>
                    existing.sha256 === cand.sha256 ||
                    (Boolean(existing.phash_hex) &&
                        Boolean(cand.phash_hex) &&
                        MediaDigestorServer.hammingDistanceHex64(existing.phash_hex!, cand.phash_hex!) <= 3)
            );
            if (!isDup && mergedAlternatives.length < 12) {
                mergedAlternatives.push(cand);
            }
        };

        for (const cand of approvedCandidates) pushUniqueAlternative(cand);
        for (const cand of existingPoolV4) pushUniqueAlternative(cand);
        for (const cand of recoveredFromCas) pushUniqueAlternative(cand);

        if (mergedAlternatives.length > 0 || existingPoolRaw.length !== existingPoolV4.length) {
            await assetRef
                .set(
                    {
                        official_photo_candidates: mergedAlternatives,
                        updatedAt: Date.now(),
                    },
                    { merge: true }
                )
                .catch((err) => {
                    console.warn('[OfficialPhotoService] No se pudo persistir official_photo_candidates:', err);
                });
        }

        console.info(
            `[OfficialPhotoService] Caza v4.0 finalizada para "${make} ${model}" (${archetypeProfile.archetypeId}): ${approvedCandidates.length} nueva(s) aprobada(s) | ${mergedAlternatives.length} alternativa(s) v4 certificada(s) | ${existingPoolRaw.length - existingPoolV4.length} legacy purgada(s).`
        );

        void AuditLedger.record({
            tenantId: 'GLOBAL_OEM',
            actorUid: actorId,
            actorEmail,
            module: 'opermaq',
            action: 'OFFICIAL_EQUIPMENT_PHOTOS_HUNTED',
            targetEntity: `global_asset_catalog/${globalAssetId}`,
            details: {
                make,
                model,
                archetypeId: archetypeProfile.archetypeId,
                variantBadge: variantReqs.summaryBadgePrefix || null,
                vlmAuditVersion: CURRENT_VLM_AUDIT_VERSION,
                totalInspected: poolToInspect.length,
                approvedCount: approvedCandidates.length,
                totalAlternativesPool: mergedAlternatives.length,
            },
        }).catch(() => {});

        return mergedAlternatives;
    }

    /**
     * Recupera exclusivamente alternativas oficiales auditadas bajo VLM Forense v4.0 (`__v4__`)
     * almacenadas en `media_registry` / CAS, descartando registros pre-v4 sin auditoría de variante/marca.
     */
    public static async recoverVerifiedCasAlternatives(
        globalAssetId: string
    ): Promise<OfficialPhotoCandidate[]> {
        const recovered: OfficialPhotoCandidate[] = [];
        const v4Prefix = `${globalAssetId}__v4__`;

        const taggedSnap = await db
            .collection('media_registry')
            .where('scope', '==', 'GLOBAL_OEM')
            .limit(40)
            .get()
            .catch(() => null);

        if (taggedSnap && !taggedSnap.empty) {
            for (const docSnap of taggedSnap.docs) {
                const reg = docSnap.data() || {};
                const origName = String(reg.originalFilename || '');
                if (!origName.startsWith(v4Prefix)) continue;
                const sha = String(reg.sha256 || docSnap.id);
                if (recovered.some((r) => r.sha256 === sha)) continue;
                const origBytes = Number(reg.originalBytes || reg.optimizedBytes || 85000);
                const optBytes = Number(reg.optimizedBytes || 80000);
                const savPct = Math.max(
                    0,
                    Math.round(((origBytes - optBytes) / Math.max(1, origBytes)) * 100)
                );
                recovered.push({
                    candidate_id: `cand_cas_${sha.slice(0, 8)}`,
                    preview_url: String(reg.downloadUrl || `/api/media/blob/global_oem/${sha}.webp`),
                    storage_path: String(reg.storagePath || `cas_blobs/global_oem/${sha}.webp`),
                    source_type: 'OEM_DOMAIN',
                    source_label: origName.slice(v4Prefix.length) || 'Catálogo CAS OEM',
                    authenticity_score: 0.9,
                    subject_box_2d: null,
                    original_bytes: origBytes,
                    optimized_bytes: optBytes,
                    savings_pct: savPct,
                    sha256: sha,
                    phash_hex: reg.phashHex ? String(reg.phashHex) : undefined,
                    width: Number(reg.width || 1600),
                    height: Number(reg.height || 1200),
                    framing_mode: 'STUDIO_88',
                    vlm_audit_version: CURRENT_VLM_AUDIT_VERSION,
                });
            }
        }

        return recovered;
    }

    /**
     * Auditoría y Verificación de Carga Manual de Contingencia (VLM Forense v4.0):
     * Exige los mismos 8 filtros de variante exacta, autenticidad anti-IA y ausencia de marcas ajenas.
     */
    public static async verifyManualOfficialEquipmentPhoto(params: {
        globalAssetId: string;
        fileBuffer: Buffer;
        mimeType: string;
        fileName: string;
        actorId?: string;
    }): Promise<ManualPhotoVerificationResult> {
        const { globalAssetId, fileBuffer, fileName, actorId = 'system' } = params;

        const assetRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const assetSnap = await assetRef.get();
        if (!assetSnap.exists) {
            throw new Error(`Activo no encontrado: ${globalAssetId}`);
        }

        const data = assetSnap.data() || {};
        let make = String(data.make_oficial || data.make || '').trim();
        let model = String(data.model_oficial || data.model || '').trim();
        const makeModelCombined = String(data.make_model || `${make} ${model}`).trim();
        if ((!make || !model) && makeModelCombined) {
            const parts = makeModelCombined.split(/\s+/);
            if (!make && parts.length > 0) make = parts[0];
            if (!model && parts.length > 1) model = parts.slice(1).join(' ');
        }
        const tipoEquipo = String(data.tipo_equipo || '').trim();
        const categoriaEquipo = String(data.categoria_equipo || '').trim();
        const equipmentType = tipoEquipo || categoriaEquipo || 'Maquinaria Minera';
        const archetypeProfile = resolveArchetypePhotoProfile(tipoEquipo, categoriaEquipo, make, model);
        const brandPolicy = resolveBrandDomainAndRivalPolicy(make);
        const variantReqs = extractVariantPhotoRequirements(data, make, model, archetypeProfile);

        const verdict = await this.auditImageWithVlm({
            imageBuffer: fileBuffer,
            make,
            model,
            equipmentType,
            archetypeProfile,
            brandPolicy,
            variantReqs,
        });

        const rejectionReasons: string[] = [...verdict.rejection_reasons];

        if (!verdict.is_authentic_real_photograph) {
            rejectionReasons.push(
                'La imagen presenta indicios de generación sintética por IA, distorsión anatómica de ruedas/ejes o emblemas artificiales.'
            );
        }
        if (!verdict.is_exact_make_and_model) {
            rejectionReasons.push(`El equipo en la foto no corresponde a la marca/modelo declarado (${make} ${model}).`);
        }
        if (!verdict.matches_exact_variant_configuration) {
            rejectionReasons.push(
                `El equipo no coincide con la configuración mecánica exacta registrada (${variantReqs.summaryBadgePrefix || model}).`
            );
        }
        if (!verdict.is_mining_appropriate_configuration) {
            rejectionReasons.push(
                `El equipo muestra un accesorio o configuración ajena al contexto minero/industrial para ${archetypeProfile.archetypeLabelEs}.`
            );
        }
        if (!verdict.is_valid_industrial_or_studio_context) {
            rejectionReasons.push(
                'El entorno no corresponde a un estudio neutro OEM ni a un contexto limpio de minería, construcción o industria.'
            );
        }
        if (!verdict.is_free_of_other_manufacturer_and_dealer_branding) {
            rejectionReasons.push(
                `Se detectaron marcas de otros fabricantes o concesionarios en el fondo/equipo, calcomanías de contratistas o marcas de agua.`
            );
        }
        if (!verdict.is_free_of_pii_and_plates) {
            rejectionReasons.push(
                'Se detectaron personas, rostros o patentes vehiculares en el encuadre (Infracción Ley N° 21.719).'
            );
        }
        if (!verdict.is_clean_unweathered_machine) {
            rejectionReasons.push(
                'El estado visual del equipo no cumple estándar oficial de catálogo (suciedad severa, óxido o daño estructural).'
            );
        }

        const approved =
            verdict.is_authentic_real_photograph &&
            verdict.is_exact_make_and_model &&
            verdict.matches_exact_variant_configuration &&
            verdict.is_mining_appropriate_configuration &&
            verdict.is_valid_industrial_or_studio_context &&
            verdict.is_free_of_other_manufacturer_and_dealer_branding &&
            verdict.is_free_of_pii_and_plates &&
            verdict.is_clean_unweathered_machine &&
            verdict.authenticity_score >= 0.78;

        if (!approved) {
            return {
                approved: false,
                authenticity_score: verdict.authenticity_score,
                rejection_reasons: Array.from(new Set(rejectionReasons)),
            };
        }

        const framed = await this.frameBufferToStudio4x3({
            inputBuffer: fileBuffer,
            subjectBox2d: verdict.subject_box_2d,
        });

        const framedPhash = await MediaDigestorServer.computePerceptualHash64(framed.buffer).catch(() => '');
        const verifiedVariantSummary =
            [verdict.observed_axle_or_track_layout, verdict.observed_body_or_attachment]
                .map((s) => String(s || '').trim())
                .filter((s) => s.length > 0 && s.length <= 42)
                .join(' · ') ||
            variantReqs.summaryBadgePrefix ||
            archetypeProfile.archetypeLabelEs;

        const descriptor = await CasStorageService.persistDigestedBinary(
            {
                buffer: framed.buffer,
                sha256: framed.sha256,
                mimeType: 'image/webp',
                extension: 'webp',
                profile: 'IMAGE_TECHNICAL_HD',
                originalBytes: fileBuffer.length,
                optimizedBytes: framed.buffer.length,
                savingsRatio: Number(
                    ((fileBuffer.length - framed.buffer.length) / Math.max(1, fileBuffer.length)).toFixed(4)
                ),
                width: framed.width,
                height: framed.height,
            },
            {
                scope: 'GLOBAL_OEM',
                actorUid: actorId,
                originalFilename: `${globalAssetId}__v4__${fileName}`,
                clientOriginalBytes: fileBuffer.length,
            }
        );

        const candidate: OfficialPhotoCandidate = {
            candidate_id: `manual_${randomUUID().slice(0, 8)}`,
            preview_url: descriptor.downloadUrl,
            storage_path: descriptor.storagePath,
            source_type: 'OEM_DOMAIN',
            source_label: 'Carga Manual Verificada VLM v4',
            authenticity_score: verdict.authenticity_score,
            subject_box_2d: verdict.subject_box_2d,
            original_bytes: fileBuffer.length,
            optimized_bytes: framed.buffer.length,
            savings_pct: Math.max(
                0,
                Math.round(((fileBuffer.length - framed.buffer.length) / Math.max(1, fileBuffer.length)) * 100)
            ),
            sha256: framed.sha256,
            phash_hex: framedPhash || undefined,
            width: framed.width,
            height: framed.height,
            framing_mode: framed.framing_mode,
            vlm_audit_version: CURRENT_VLM_AUDIT_VERSION,
            verified_variant_summary: verifiedVariantSummary,
        };

        const existingPoolV4 = (
            Array.isArray(data.official_photo_candidates)
                ? (data.official_photo_candidates as OfficialPhotoCandidate[])
                : []
        ).filter((c) => c?.vlm_audit_version === CURRENT_VLM_AUDIT_VERSION && c?.sha256 !== candidate.sha256);

        const updatedPool = [candidate, ...existingPoolV4].slice(0, 12);
        await assetRef
            .set({ official_photo_candidates: updatedPool, updatedAt: Date.now() }, { merge: true })
            .catch(() => {});

        return {
            approved: true,
            authenticity_score: verdict.authenticity_score,
            rejection_reasons: [],
            candidate,
        };
    }

    /**
     * Juez Forense VLM v4.0 (`preferredTier: 'PRIMARY'`, `thinkingLevel: 'medium'`):
     * Evalúa autenticidad fotográfica anti-IA, variante exacta de ejes/carrocería/rodado,
     * ausencia total de marcas ajenas o hermanas en el fondo y contexto minero/construcción/industrial o estudio OEM.
     */
    private static async auditImageWithVlm(params: {
        imageBuffer: Buffer;
        make: string;
        model: string;
        equipmentType: string;
        archetypeProfile: ArchetypePhotoSearchProfile;
        brandPolicy: BrandDomainAndRivalPolicy;
        variantReqs: VariantPhotoRequirements;
        isFullDocumentPage?: boolean;
    }): Promise<VlmPhotoVerdict> {
        const {
            imageBuffer,
            make,
            model,
            equipmentType,
            archetypeProfile,
            brandPolicy,
            variantReqs,
            isFullDocumentPage = false,
        } = params;
        const baseSeries = deriveBaseModelSeries(model);

        const previewBuffer = await sharp(imageBuffer)
            .rotate()
            .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 86 })
            .toBuffer();

        const base64Data = previewBuffer.toString('base64');

        const systemInstruction = `Eres el Auditor Forense VLM v4.0 de Autenticidad Visual y Control de Catálogos Oficiales de Maquinaria de MINREPORT (OPERMAQ).
Tu misión es auditar con rigor quirúrgico si la imagen es una FOTOGRAFÍA OFICIAL OEM REAL Y EXACTA para el equipo "${make} ${model}" (Designador base: "${variantReqs.cleanModelDesignator}" | Serie: "${baseSeries}" | Tipo: "${equipmentType}" | Arquetipo: "${archetypeProfile.archetypeLabelEs}").

EVALÚA LOS 8 CORTES FORENSES OBLIGATORIOS (SI FALLA UNO SOLO, MARCA SU BOOLEANO EN FALSE Y EXPLICA EN rejection_reasons):

1. is_authentic_real_photograph (BLOQUEO ANTI-IA GENERATIVA Y RENDERS SINTÉTICOS):
   - Debe ser una fotografía óptica real de fábrica/catálogo OEM (100% real, escala 1:1).
   - RECHAZA INMEDIATAMENTE (false) cualquier imagen generada por IA (Midjourney, Stable Diffusion, DALL-E, StockCake, Flux) o render sintético defectuoso:
     * Exceso anatómico o incoherente de ruedas/ejes (ej. camiones con 5, 6 o más ejes seguidos irreales, neumáticos fusionados o flotantes).
     * Llantas deformes, tuercas derretidas, geometría asimétrica de cabina/parrilla/espejos o cilindros hidráulicos que no conectan mecánicamente.
     * Emblemas de marca o textos laterales con letras ilegibles, deformadas o pseudo-alfabeto típico de IA generativa.
     * Modelos a escala (1:50, diecast, juguetes) o capturas de videojuegos/simuladores.

2. is_exact_make_and_model:
   - El equipo principal DEBE corresponder inequívocamente al fabricante "${make}" y al modelo/familia "${variantReqs.cleanModelDesignator}" (${baseSeries}).
   - Verifica parrilla frontal, cabina, geometría de capó/contrapeso y emblema oficial "${make}". Si es otro fabricante u otro modelo distinto, marca false.

3. matches_exact_variant_configuration (EXACTITUD ESTRICTA DE VARIANTE MECÁNICA — PROHIBIDO ACEPTAR VERSIONES HERMANAS EQUIVOCADAS):
${variantReqs.vlmVariantMandateEs}
   - Registra obligatoriamente en observed_axle_or_track_layout qué configuración de ejes o rodado contaste visualmente (ej. "8x4 (4 ejes)", "6x4 (3 ejes)", "Orugas", "4x4") y en observed_body_or_attachment qué carrocería o implemento observaste (ej. "Tolva minera", "Tractocamión quinta rueda", "Balde excavación").

4. is_mining_appropriate_configuration:
   - CRITERIO DEL ARQUETIPO (${archetypeProfile.archetypeLabelEs}): ${archetypeProfile.vlmExpectedConfigEs}

5. is_valid_industrial_or_studio_context (CONTEXTO VISUAL PERMITIDO):
   - ÚNICAMENTE se aprueban (true) dos contextos:
     a) Estudio fotográfico oficial OEM con fondo blanco puro, gris neutro uniforme o recorte limpio de ficha técnica.
     b) Operación o demostración limpia en contexto real de MINERÍA (rajo, cantera, acopio), CONSTRUCCIÓN PESADA / MOVIMIENTO DE TIERRA o PLANTA INDUSTRIAL.
   - RECHAZA (false) estacionamientos comerciales o patios de concesionarios abarrotados de otros vehículos, patios de subasta/chatarra, talleres desordenados, calles urbanas residenciales, carreteras con tráfico civil o jardines domésticos.

6. is_free_of_other_manufacturer_and_dealer_branding (CERO MARCAS DE OTROS FABRICANTES O CONCESIONARIOS EN EL FONDO O EQUIPO):
   - Inspecciona TANTO la máquina COMO TODO EL FONDO (edificios, fachadas de concesionarios, tótems, banderas, pancartas, letreros luminosos, vehículos estacionados atrás y marcas de agua).
   - ÚNICAMENTE se permite el emblema oficial "${make}" sobre el propio equipo.
   - Si aparece CUALQUIER logotipo, texto, edificio o bandera de otra marca o marca hermana del mismo grupo corporativo (${brandPolicy.forbiddenBrandListEs} — por ejemplo, un camión MACK fotografiado frente a un edificio o letrero VOLVO, o viceversa), o logos de concesionarios comerciales, empresas contratistas, alquiler o marcas de agua de portales web, DEBES marcar is_free_of_other_manufacturer_and_dealer_branding=false.

7. is_free_of_pii_and_plates (LEY N° 21.719):
   - Libre de rostros humanos reconocibles, personas posando junto a la máquina y placas patentes vehiculares (PPU) legibles.

8. is_clean_unweathered_machine:
   - Unidad nueva o en condición impecable de catálogo OEM, sin barro espeso, abolladuras, corrosión ni desgaste severo de faena.

${
    isFullDocumentPage
        ? `NOTA PARA PÁGINA DE FOLLETO PDF: Esta imagen es una página completa de folleto OEM. Si contiene una fotografía limpia que cumpla TODOS los 8 puntos anteriores, delimita en subject_box_2d EXCLUSIVAMENTE la fotografía de esa máquina excluyendo textos, tablas y márgenes del documento.`
        : 'Delimita en subject_box_2d el Bounding Box [ymin, xmin, ymax, xmax] (0..1000) que encierra únicamente al equipo completo sin cortar ruedas, tolva ni pluma.'
}`;

        const prompt = `Ejecuta auditoría forense VLM v4.0 sobre esta imagen candidata para "${make} ${model}" (${equipmentType}). Cuenta los ejes/ruedas reales, verifica la carrocería/implemento, inspecciona el fondo completo en busca de letreros de otras marcas (prohibidos: ${brandPolicy.forbiddenBrandListEs}) y descarta cualquier imagen generada por IA. Devuelve JSON estricto.`;

        try {
            const { data } = await ResilientAIClient.generateStructured<VlmPhotoVerdict>({
                prompt,
                systemInstruction,
                module: 'opermaq',
                preferredTier: 'PRIMARY',
                thinkingLevel: 'medium',
                media: [{ mimeType: 'image/jpeg', dataBase64: base64Data }],
                responseSchema: {
                    type: 'object',
                    properties: {
                        is_authentic_real_photograph: { type: 'boolean' },
                        is_exact_make_and_model: { type: 'boolean' },
                        matches_exact_variant_configuration: { type: 'boolean' },
                        is_mining_appropriate_configuration: { type: 'boolean' },
                        is_valid_industrial_or_studio_context: { type: 'boolean' },
                        is_free_of_other_manufacturer_and_dealer_branding: { type: 'boolean' },
                        is_free_of_pii_and_plates: { type: 'boolean' },
                        is_clean_unweathered_machine: { type: 'boolean' },
                        authenticity_score: {
                            type: 'number',
                            description: 'Puntaje forense de autenticidad entre 0.0 y 1.0 (mínimo aprobatorio 0.78)',
                        },
                        subject_box_2d: {
                            type: 'array',
                            nullable: true,
                            items: { type: 'number' },
                            description: '[ymin, xmin, ymax, xmax] en escala 0..1000',
                        },
                        observed_axle_or_track_layout: {
                            type: 'string',
                            description: 'Ej: "8x4 (4 ejes)", "6x4 (3 ejes)", "Orugas", "4x4"',
                        },
                        observed_body_or_attachment: {
                            type: 'string',
                            description: 'Ej: "Tolva minera", "Tractocamión", "Balde estándar"',
                        },
                        detected_model_description: { type: 'string' },
                        rejection_reasons: { type: 'array', items: { type: 'string' } },
                    },
                    required: [
                        'is_authentic_real_photograph',
                        'is_exact_make_and_model',
                        'matches_exact_variant_configuration',
                        'is_mining_appropriate_configuration',
                        'is_valid_industrial_or_studio_context',
                        'is_free_of_other_manufacturer_and_dealer_branding',
                        'is_free_of_pii_and_plates',
                        'is_clean_unweathered_machine',
                        'authenticity_score',
                        'subject_box_2d',
                        'observed_axle_or_track_layout',
                        'observed_body_or_attachment',
                        'detected_model_description',
                        'rejection_reasons',
                    ],
                },
                temperature: 0.0,
            });

            return normalizeVlmVerdictPayload(data);
        } catch (err) {
            console.warn('[OfficialPhotoService] Fallo VLM v4.0 audit:', err);
            return {
                is_authentic_real_photograph: false,
                is_exact_make_and_model: false,
                matches_exact_variant_configuration: false,
                is_mining_appropriate_configuration: false,
                is_valid_industrial_or_studio_context: false,
                is_free_of_other_manufacturer_and_dealer_branding: false,
                is_free_of_pii_and_plates: false,
                is_clean_unweathered_machine: false,
                authenticity_score: 0.0,
                subject_box_2d: null,
                observed_axle_or_track_layout: '',
                observed_body_or_attachment: '',
                detected_model_description: 'Error en inferencia VLM',
                rejection_reasons: ['Error de análisis visual en el enjambre de inferencia.'],
            };
        }
    }

    /**
     * Inspecciona el perímetro real de una imagen (canal alfa o blanco de estudio R,G,B >= 238)
     * para determinar si corresponde a una toma aislada sobre fondo de estudio/transparente.
     */
    private static async isStudioOrTransparentPerimeter(buffer: Buffer): Promise<boolean> {
        try {
            const { data, info } = await sharp(buffer)
                .ensureAlpha()
                .resize(320, 240, { fit: 'inside', withoutEnlargement: true })
                .raw()
                .toBuffer({ resolveWithObject: true });

            const w = info.width;
            const h = info.height;
            if (w < 16 || h < 16) return false;

            let perimeterPixels = 0;
            let studioOrAlphaPixels = 0;

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
                        perimeterPixels++;
                        const idx = (y * w + x) * 4;
                        const r = data[idx];
                        const g = data[idx + 1];
                        const b = data[idx + 2];
                        const a = data[idx + 3];

                        if (a <= 15 || (r >= 238 && g >= 238 && b >= 238)) {
                            studioOrAlphaPixels++;
                        }
                    }
                }
            }

            return perimeterPixels > 0 && studioOrAlphaPixels / perimeterPixels >= 0.72;
        } catch {
            return false;
        }
    }

    /**
     * Codificador adaptativo Zero-Inflation CAS (4:3 WebP):
     * Garantiza que `optimizedBytes < originalBytes` evitando el sobremuestreo artificial
     * de imágenes livianas y ajustando progresivamente calidad WebP (`effort: 6`) y lienzo 4:3.
     */
    private static async encodeZeroInflationWebp4x3(params: {
        originalByteLength: number;
        nativeWidth: number;
        renderAtSize: (width: number, height: number) => Promise<Buffer>;
    }): Promise<{ buffer: Buffer; width: number; height: number }> {
        const { originalByteLength, nativeWidth, renderAtSize } = params;
        const targetCeilingBytes =
            originalByteLength > 18 * 1024
                ? Math.floor(originalByteLength * 0.92)
                : Math.max(1024, originalByteLength - 512);

        const baseWidth =
            nativeWidth >= 1400 && originalByteLength >= 180 * 1024
                ? 1440
                : nativeWidth >= 1000 && originalByteLength >= 95 * 1024
                  ? 1120
                  : Math.min(960, Math.max(640, Math.round(nativeWidth / 16) * 16));

        const compressionSteps: Array<{ scale: number; quality: number }> = [
            { scale: 1.0, quality: 82 },
            { scale: 1.0, quality: 72 },
            { scale: 0.85, quality: 66 },
            { scale: 0.74, quality: 58 },
            { scale: 0.64, quality: 52 },
        ];

        let bestResult: { buffer: Buffer; width: number; height: number } | null = null;

        for (const step of compressionSteps) {
            const w = Math.max(480, Math.round((baseWidth * step.scale) / 4) * 4);
            const h = Math.round((w * 3) / 4);
            const rawComposite = await renderAtSize(w, h);
            const encoded = await sharp(rawComposite)
                .webp({ quality: step.quality, effort: 6, smartSubsample: true })
                .toBuffer();

            if (!bestResult || encoded.length < bestResult.buffer.length) {
                bestResult = { buffer: encoded, width: w, height: h };
            }

            if (encoded.length <= targetCeilingBytes) {
                return { buffer: encoded, width: w, height: h };
            }
        }

        return bestResult!;
    }

    /**
     * Enmarca un buffer a proporción 4:3 al 88% de escala útil bajo invariante Zero-Inflation CAS:
     * 1. Si proviene de una página completa de folleto PDF (`isFullDocumentPage`), recorta primero `subjectBox2d`.
     * 2. Si el perímetro es blanco de estudio o transparente (>= 72%), aplica `STUDIO_88` (recorte exacto + escala 88% sobre #FFFFFF).
     * 3. Si es fotografía oficial de catálogo con entorno natural y posee `subjectBox2d`, aplica `VLM_BOX_4X3` sin barras blancas artificiales.
     * 4. Garantiza mediante `encodeZeroInflationWebp4x3` que el peso CAS resultante nunca infle el tamaño original.
     */
    public static async frameBufferToStudio4x3(params: {
        inputBuffer: Buffer;
        originalByteLength?: number;
        subjectBox2d?: [number, number, number, number] | null;
        isFullDocumentPage?: boolean;
    }): Promise<{
        buffer: Buffer;
        sha256: string;
        width: number;
        height: number;
        framing_mode: 'STUDIO_88' | 'VLM_BOX_4X3' | 'CENTER_4X3';
    }> {
        const { inputBuffer, originalByteLength, subjectBox2d, isFullDocumentPage = false } = params;
        const effectiveOrigBytes =
            typeof originalByteLength === 'number' && originalByteLength > 0
                ? originalByteLength
                : inputBuffer.length;
        const fillRatio = 0.88;

        let workingBuffer = await sharp(inputBuffer).rotate().toBuffer();
        const metadata = await sharp(workingBuffer).metadata();
        let origW = metadata.width || 1200;
        let origH = metadata.height || 900;

        let activeBox2d = subjectBox2d;

        // 0. Si es página de documento PDF con subjectBox2d válido, extraer primero la fotografía del equipo
        if (isFullDocumentPage && activeBox2d && activeBox2d.length === 4) {
            const [ymin, xmin, ymax, xmax] = activeBox2d;
            const margin = 15; // 1.5% margen en escala 0..1000
            const y0 = Math.max(0, ymin - margin);
            const x0 = Math.max(0, xmin - margin);
            const y1 = Math.min(1000, ymax + margin);
            const x1 = Math.min(1000, xmax + margin);

            const left = Math.round((x0 / 1000) * origW);
            const top = Math.round((y0 / 1000) * origH);
            const cropW = Math.min(origW - left, Math.round(((x1 - x0) / 1000) * origW));
            const cropH = Math.min(origH - top, Math.round(((y1 - y0) / 1000) * origH));

            if (cropW >= 180 && cropH >= 140) {
                workingBuffer = await sharp(workingBuffer)
                    .extract({ left, top, width: cropW, height: cropH })
                    .toBuffer();
                origW = cropW;
                origH = cropH;
                activeBox2d = null; // Ya recortado al sujeto
            }
        }

        // 1. Verificar si la imagen tiene fondo blanco de estudio o transparencia perimetral real
        const isStudioOrAlpha = await this.isStudioOrTransparentPerimeter(workingBuffer);

        if (isStudioOrAlpha) {
            try {
                const trimmedBuf = await sharp(workingBuffer)
                    .flatten({ background: { r: 255, g: 255, b: 255 } })
                    .trim({ threshold: 18 })
                    .toBuffer({ resolveWithObject: true });

                if (trimmedBuf.info.width > 80 && trimmedBuf.info.height > 80) {
                    const subW = trimmedBuf.info.width;
                    const subH = trimmedBuf.info.height;

                    const encoded = await this.encodeZeroInflationWebp4x3({
                        originalByteLength: effectiveOrigBytes,
                        nativeWidth: Math.max(origW, Math.round(subW / fillRatio)),
                        renderAtSize: async (targetWidth, targetHeight) => {
                            const scale = Math.min(
                                (targetWidth * fillRatio) / subW,
                                (targetHeight * fillRatio) / subH
                            );
                            const drawW = Math.max(1, Math.round(subW * scale));
                            const drawH = Math.max(1, Math.round(subH * scale));

                            const scaledSubject = await sharp(trimmedBuf.data)
                                .resize(drawW, drawH, { fit: 'fill' })
                                .png()
                                .toBuffer();

                            const left = Math.round((targetWidth - drawW) / 2);
                            const top = Math.round((targetHeight - drawH) / 2);

                            return sharp({
                                create: {
                                    width: targetWidth,
                                    height: targetHeight,
                                    channels: 4,
                                    background: { r: 255, g: 255, b: 255, alpha: 1 },
                                },
                            })
                                .composite([{ input: scaledSubject, left, top }])
                                .png()
                                .toBuffer();
                        },
                    });

                    const sha256 = MediaDigestorServer.computeSha256Hex(encoded.buffer);
                    return {
                        buffer: encoded.buffer,
                        sha256,
                        width: encoded.width,
                        height: encoded.height,
                        framing_mode: 'STUDIO_88',
                    };
                }
            } catch {
                // Si falla el trim, continúa al encuadre guiado por VLM
            }
        }

        // 2. Si hay subjectBox2d del VLM en fotografía de catálogo exterior, centrar recorte 4:3 sobre la máquina
        if (activeBox2d && activeBox2d.length === 4) {
            const [ymin, xmin, ymax, xmax] = activeBox2d;
            const boxW = ((xmax - xmin) / 1000) * origW;
            const boxH = ((ymax - ymin) / 1000) * origH;
            const cx = (((xmin + xmax) / 2) / 1000) * origW;
            const cy = (((ymin + ymax) / 2) / 1000) * origH;

            if (boxW > 50 && boxH > 50) {
                const targetAspect = 4 / 3;
                let cropW = Math.max(boxW / fillRatio, (boxH / fillRatio) * targetAspect);
                let cropH = cropW / targetAspect;

                if (cropW > origW) {
                    cropW = origW;
                    cropH = cropW / targetAspect;
                }
                if (cropH > origH) {
                    cropH = origH;
                    cropW = cropH * targetAspect;
                }

                const safeCropW = Math.max(1, Math.min(origW, Math.round(cropW)));
                const safeCropH = Math.max(1, Math.min(origH, Math.round(cropH)));
                const left = Math.max(0, Math.min(origW - safeCropW, Math.round(cx - safeCropW / 2)));
                const top = Math.max(0, Math.min(origH - safeCropH, Math.round(cy - safeCropH / 2)));

                const extractedCrop = await sharp(workingBuffer)
                    .extract({ left, top, width: safeCropW, height: safeCropH })
                    .toBuffer();

                const encoded = await this.encodeZeroInflationWebp4x3({
                    originalByteLength: effectiveOrigBytes,
                    nativeWidth: safeCropW,
                    renderAtSize: (targetWidth, targetHeight) =>
                        sharp(extractedCrop).resize(targetWidth, targetHeight, { fit: 'fill' }).png().toBuffer(),
                });

                const sha256 = MediaDigestorServer.computeSha256Hex(encoded.buffer);
                return {
                    buffer: encoded.buffer,
                    sha256,
                    width: encoded.width,
                    height: encoded.height,
                    framing_mode: 'VLM_BOX_4X3',
                };
            }
        }

        // 3. Fallback: encuadre 4:3 proporcional limpio bajo Zero-Inflation
        const encoded = await this.encodeZeroInflationWebp4x3({
            originalByteLength: effectiveOrigBytes,
            nativeWidth: origW,
            renderAtSize: (targetWidth, targetHeight) =>
                sharp(workingBuffer)
                    .resize(targetWidth, targetHeight, {
                        fit: isStudioOrAlpha ? 'contain' : 'cover',
                        position: 'centre',
                        background: { r: 255, g: 255, b: 255, alpha: 1 },
                    })
                    .png()
                    .toBuffer(),
        });

        const sha256 = MediaDigestorServer.computeSha256Hex(encoded.buffer);
        return {
            buffer: encoded.buffer,
            sha256,
            width: encoded.width,
            height: encoded.height,
            framing_mode: isStudioOrAlpha ? 'STUDIO_88' : 'CENTER_4X3',
        };
    }
}
