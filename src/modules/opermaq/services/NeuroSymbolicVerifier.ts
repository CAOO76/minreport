import { createHash } from 'crypto';
import { db } from '../../../config/firebase';
import { FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX } from '../utils/canonicalArchetypeSpecs';
import { ensureUniversalSymbologySeeded } from './UniversalSymbologySeedService';

/**
 * NEURO-SYMBOLIC VERIFIER v4.0 — Verificador Determinista SI + Normativa ISO + Huella de Hechos
 *
 * Funciones críticas:
 * 1. Normalización y validación determinista al Sistema Internacional (`SI`):
 *    convierte o complementa magnitudes imperiales (`psi`, `lb`, `gal`, `ft-lb`, `hp`, `°F`)
 *    y detecta valores físicamente inverosímiles antes de persistir en `global_asset_catalog`.
 * 2. Huella canónica de hechos (`computeFactFingerprint`) invariante a puntuación, idioma de conectores
 *    y formato numérico para impedir duplicados al cruzar manuales PDF, ETT y caza web.
 * 3. Verificación determinista de referencias `ISO 7010`, `ISO 7000`, `ISO 2575`, `IEC 60417` y `GHS`
 *    contra `master_symbology_vault` (cero códigos inventados).
 */

const STOPWORDS_MULTILINGUAL = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'en', 'con', 'por',
    'para', 'según', 'segun', 'sobre', 'entre', 'hasta', 'desde', 'este', 'esta', 'estos', 'estas',
    'que', 'como', 'cuando', 'donde', 'the', 'and', 'for', 'with', 'from', 'into', 'this', 'that',
    'must', 'should', 'debe', 'deben', 'ser', 'estar', 'equipo', 'maquina', 'máquina', 'sistema',
]);

export interface SiVerificationResult {
    normalizedMarkdown: string;
    conversionsApplied: number;
    warnings: string[];
}

function formatSmartNumber(val: number): string {
    if (!Number.isFinite(val)) return String(val);
    if (Math.abs(val) >= 100) return Math.round(val).toString();
    if (Math.abs(val) >= 10) return (Math.round(val * 10) / 10).toString();
    return (Math.round(val * 100) / 100).toString();
}

/**
 * Calcula una huella SHA-256 compacta (24 hex chars) de un hecho técnico,
 * canonizando unidades frecuentes para discriminar información repetida aunque cambie la redacción.
 */
export function computeFactFingerprint(rawText: string, componentHint?: string): string {
    const combined = `${componentHint || ''} ${rawText || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[*_`~>#|\[\]()]/g, ' ');

    // Canonizar sufijos de unidades comunes (`horas`/`hrs`/`hr` -> `h`, `litros`/`liters` -> `l`, etc.)
    const unitCanonical = combined
        .replace(/(\d+(?:[.,]\d+)?)\s*(?:horas|hora|hours|hrs|hr)\b/g, '$1h')
        .replace(/(\d+(?:[.,]\d+)?)\s*(?:litros|litro|liters|litres|lts)\b/g, '$1l')
        .replace(/(\d+(?:[.,]\d+)?)\s*(?:kilogramos|kilos|kgs)\b/g, '$1kg')
        .replace(/(\d+(?:[.,]\d+)?)\s*(?:metros|meters|mts)\b/g, '$1m')
        .replace(/(\d+(?:[.,]\d+)?)\s*(?:milimetros|millimeters)\b/g, '$1mm')
        .replace(/(\d+),(\d+)/g, '$1.$2');

    const tokens = unitCanonical
        .split(/[^a-z0-9.+-]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && !STOPWORDS_MULTILINGUAL.has(t));

    // Ordenar tokens únicos manteniendo sensibilidad a cifras y componentes clave
    const uniqueSorted = Array.from(new Set(tokens)).sort();
    const canonicalPayload = uniqueSorted.join('|');
    return createHash('sha256').update(canonicalPayload).digest('hex').slice(0, 24);
}

/**
 * Verifica y enriquece unidades técnicas al Sistema Internacional (SI) sin alterar las cifras OEM originales:
 * si aparece una magnitud imperial aislada (`3045 psi`), añade su conversión exacta (`210 bar [3045 psi]`)
 * y audita rangos físicos plausibles.
 */
export function verifyAndNormalizeTechnicalUnits(markdown: string): SiVerificationResult {
    if (!markdown || !markdown.trim()) {
        return { normalizedMarkdown: markdown, conversionsApplied: 0, warnings: [] };
    }

    let text = markdown;
    let conversionsApplied = 0;
    const warnings: string[] = [];

    // 1. PSI -> bar (solo si en la vecindad simétrica ±32 caracteres no figura ya `bar`, `MPa` o `kPa`)
    text = text.replace(
        /(\b\d{2,5}(?:[.,]\d{1,2})?)\s*psi\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\b(?:bar|mpa|kpa)\b/i.test(neighborhood)) return match;
            const psi = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(psi) || psi <= 0) return match;
            const bar = psi * 0.0689476;
            if (bar > 850) {
                warnings.push(`Presión inusualmente alta detectada (${psi} psi / ${formatSmartNumber(bar)} bar).`);
            }
            conversionsApplied++;
            return `${formatSmartNumber(bar)} bar (${rawVal} psi)`;
        }
    );

    // 2. US gal -> L (evitando duplicar si en la vecindad simétrica ya figura `L` o `litros`)
    text = text.replace(
        /(\b\d{1,5}(?:[.,]\d{1,2})?)\s*(?:us\s*)?gal(?:ones|lons)?\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\b(?:l|litros|liters|litres)\b/i.test(neighborhood)) return match;
            const gal = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(gal) || gal <= 0) return match;
            const liters = gal * 3.78541;
            conversionsApplied++;
            return `${formatSmartNumber(liters)} L (${rawVal} gal)`;
        }
    );

    // 3. Torque `lb-ft` / `ft-lb` -> `N·m`
    text = text.replace(
        /(\b\d{1,5}(?:[.,]\d{1,2})?)\s*(?:lb[-·\s]?ft|ft[-·\s]?lb|lbf[-·\s]?ft)\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\bn[·\s-]?m\b/i.test(neighborhood)) return match;
            const ftLb = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(ftLb) || ftLb <= 0) return match;
            const nm = ftLb * 1.35582;
            conversionsApplied++;
            return `${formatSmartNumber(nm)} N·m (${rawVal} lb·ft)`;
        }
    );

    // 4. Masa `lb` / `lbs` -> `kg`
    text = text.replace(
        /(\b\d{2,6}(?:[.,]\d{1,2})?)\s*lbs?\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\b(?:kg|t|ton)\b/i.test(neighborhood)) return match;
            const lb = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(lb) || lb <= 0) return match;
            const kg = lb * 0.453592;
            conversionsApplied++;
            return `${formatSmartNumber(kg)} kg (${rawVal} lb)`;
        }
    );

    // 5. Potencia `HP` -> `kW` (solo cuando no exista `kW` en la vecindad simétrica ±32 caracteres)
    text = text.replace(
        /(\b\d{1,4}(?:[.,]\d{1,2})?)\s*hp\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\bkw\b/i.test(neighborhood)) return match;
            const hp = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(hp) || hp <= 0 || hp > 15000) return match;
            const kw = hp * 0.7457;
            conversionsApplied++;
            return `${formatSmartNumber(kw)} kW (${rawVal} HP)`;
        }
    );

    // 6. Cortafuegos determinista Anti-Marketing y Verificación de Envolvente Física:
    // Elimina oraciones promocionales o afirmaciones operacionales falsas (ej. "mayor alcance para carga de camiones"
    // traducido de folletos residenciales en equipos compactos).
    const filteredLines: string[] = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        const isTableLine = trimmed.startsWith('|') && trimmed.endsWith('|');
        if (!isTableLine && FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(trimmed)) {
            warnings.push(`Prosa publicitaria o afirmación no verificada suprimida: "${trimmed.slice(0, 90)}"`);
            // Si la línea contiene una magnitud técnica antes de un separador o cláusula subordinada ("que proporciona..."),
            // conservar exclusivamente el dato técnico duro y amputar la cláusula comercial.
            const strippedClause = line
                .replace(
                    /\s*(?:,\s*)?\b(?:que\s+(?:proporciona|ofrece|permite|brinda|garantiza)|para\s+(?:carga\s+(?:f[aá]cil\s+)?de\s+camiones|mayor\s+alcance|m[aá]xima\s+eficiencia))[^.\n]*/gi,
                    ''
                )
                .trim();
            if (
                strippedClause &&
                strippedClause !== trimmed &&
                !FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(strippedClause) &&
                /\d/.test(strippedClause)
            ) {
                filteredLines.push(strippedClause);
            }
            continue;
        }
        filteredLines.push(line);
    }
    text = filteredLines.join('\n').replace(/\n{3,}/g, '\n\n');

    return {
        normalizedMarkdown: text,
        conversionsApplied,
        warnings,
    };
}

/**
 * Resuelve y verifica códigos de simbología normativa (`ISO 7010`, `ISO 7000`, `ISO 2575`, `IEC 60417`, `GHS`)
 * contra `master_symbology_vault` para devolver `concept_id` reales y libres de alucinación.
 */
export async function verifyAndResolveSymbologyRefs(
    candidates: Array<
        | string
        | {
              concept_id?: string;
              iso_reference?: string;
              technical_name_es?: string;
          }
    >
): Promise<string[]> {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];

    await ensureUniversalSymbologySeeded(false);

    const resolvedIds = new Set<string>();

    // Cargar índice ligero de `master_symbology_vault` para mapeo exacto por `concept_id` o `iso_reference`
    const vaultSnap = await db.collection('master_symbology_vault').select('iso_reference', 'iso_code').get();
    const byId = new Set<string>();
    const byIsoRef = new Map<string, string>();

    for (const doc of vaultSnap.docs) {
        byId.add(doc.id);
        const data = doc.data();
        const isoRef = String(data.iso_reference || '')
            .toUpperCase()
            .replace(/[\s_-]+/g, '');
        if (isoRef) {
            byIsoRef.set(isoRef, doc.id);
        }
        const isoCode = String(data.iso_code || '')
            .toUpperCase()
            .trim();
        if (isoCode) {
            byIsoRef.set(isoCode, doc.id);
            byIsoRef.set(`ISO7010${isoCode}`, doc.id);
        }
    }

    for (const raw of candidates) {
        if (resolvedIds.size >= 45) break;

        const cidRaw = typeof raw === 'string' ? raw : raw?.concept_id || '';
        const isoRaw = typeof raw === 'string' ? raw : raw?.iso_reference || '';

        const cleanCid = cidRaw
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9_]+/g, '_');

        if (cleanCid && byId.has(cleanCid)) {
            resolvedIds.add(cleanCid);
            continue;
        }

        // Intentar match por código ISO 7010 directo (`M014`, `W019`, `P002`, `F001`, `E001`)
        const m7010 = `${cidRaw} ${isoRaw}`.toUpperCase().match(/\b([MWPFE]\d{3})\b/);
        if (m7010) {
            const candidate7010 = `iso_7010_${m7010[1].toLowerCase()}`;
            if (byId.has(candidate7010)) {
                resolvedIds.add(candidate7010);
                continue;
            }
        }

        // Intentar match por GHS (`GHS01`..`GHS09`)
        const mGhs = `${cidRaw} ${isoRaw}`.toUpperCase().match(/\bGHS\s*0?([1-9])\b/);
        if (mGhs) {
            const ghsPrefix = `ghs_0${mGhs[1]}_`;
            for (const existingId of byId) {
                if (existingId.startsWith(ghsPrefix)) {
                    resolvedIds.add(existingId);
                    break;
                }
            }
            continue;
        }

        // Intentar match por referencia ISO/IEC normalizada (`ISO70000248`, `IEC604175172`)
        const compactRef = (isoRaw || cidRaw).toUpperCase().replace(/[\s_-]+/g, '');
        const mapped = byIsoRef.get(compactRef);
        if (mapped) {
            resolvedIds.add(mapped);
        }
    }

    return Array.from(resolvedIds);
}

