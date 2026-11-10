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

function splitMarkdownTableCells(line: string): string[] {
    return line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
}

function isMarkdownTableSeparatorLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) return false;
    const cells = splitMarkdownTableCells(trimmed);
    return cells.length >= 2 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * Reconstruye determinísticamente tablas Markdown de 3 a 6 columnas (Pilares 01 a 05):
 * - Convierte `<br>` dentro de líneas con `|` en separador inline ` — `.
 * - Detecta el número de columnas del encabezado (`expectedCols`) y une cualquier fila de cuerpo partida
 *   en múltiples líneas (incluso si el LLM insertó saltos de línea vacíos intermedios o cerró prematuramente una celda con `|`).
 * - Elimina líneas en blanco espurias entre filas consecutivas de una misma tabla para evitar que una fila intermedia se convierta en falso `<thead>`.
 */
export function normalizeMarkdownTableRows(markdown: string): string {
    if (!markdown) return markdown;
    const rawLines = markdown
        .split('\n')
        .map((ln) => (ln.includes('|') ? ln.replace(/<br[^>]*\/?>/gi, ' — ') : ln));

    const out: string[] = [];
    let expectedCols = 0;
    let idx = 0;

    const isBlockStarter = (trimmed: string): boolean =>
        /^(?:#{1,6}\s|[-*]\s|>\s|!\[|---|\*\*REGLA\s+DE\s+BLOQUEO|REGLA\s+DE\s+BLOQUEO)/i.test(trimmed);

    while (idx < rawLines.length) {
        let cur = rawLines[idx];
        const trimmed = cur.trim();

        if (!trimmed) {
            if (expectedCols >= 2) {
                let peek = idx + 1;
                while (peek < rawLines.length && !rawLines[peek].trim()) peek++;
                if (peek < rawLines.length) {
                    const nextNonEmpty = rawLines[peek].trim();
                    const lineAfterNext = peek + 1 < rawLines.length ? rawLines[peek + 1].trim() : '';
                    if (nextNonEmpty.startsWith('|') && !isMarkdownTableSeparatorLine(lineAfterNext)) {
                        idx = peek;
                        continue;
                    }
                }
                expectedCols = 0;
            }
            out.push(cur);
            idx++;
            continue;
        }

        if (isBlockStarter(trimmed)) {
            expectedCols = 0;
            out.push(cur);
            idx++;
            continue;
        }

        if (trimmed.startsWith('|')) {
            const nextLine = idx + 1 < rawLines.length ? rawLines[idx + 1].trim() : '';
            if (isMarkdownTableSeparatorLine(nextLine)) {
                expectedCols = splitMarkdownTableCells(trimmed).length;
                out.push(cur);
                out.push(rawLines[idx + 1]);
                idx += 2;
                continue;
            }

            while (idx + 1 < rawLines.length) {
                const curCells = splitMarkdownTableCells(cur).length;
                const curEndsWithPipe = cur.trim().endsWith('|');
                const needsMoreCells = expectedCols >= 2 ? curCells < expectedCols : !curEndsWithPipe;

                let peek = idx + 1;
                if (needsMoreCells) {
                    while (peek < rawLines.length && !rawLines[peek].trim()) peek++;
                }
                if (peek >= rawLines.length) break;

                const nextTrimmed = rawLines[peek].trim();
                if (!nextTrimmed || isBlockStarter(nextTrimmed) || isMarkdownTableSeparatorLine(nextTrimmed)) break;

                const nextStartsWithPipe = nextTrimmed.startsWith('|');
                const nextHasPipe = nextTrimmed.includes('|');

                if ((!nextStartsWithPipe && nextHasPipe) || (needsMoreCells && (nextHasPipe || !curEndsWithPipe))) {
                    if (curEndsWithPipe && nextStartsWithPipe) {
                        cur = `${cur.trimEnd()} ${nextTrimmed.replace(/^\|\s*/, '')}`;
                    } else if (curEndsWithPipe || nextStartsWithPipe) {
                        cur = `${cur.trimEnd()} ${nextTrimmed}`;
                    } else {
                        cur = `${cur.trimEnd()} — ${nextTrimmed}`;
                    }
                    idx = peek;
                } else {
                    break;
                }
            }

            if (!cur.trim().endsWith('|')) {
                cur = `${cur.trimEnd()} |`;
            }
            out.push(cur);
            idx++;
            continue;
        }

        expectedCols = 0;
        out.push(cur);
        idx++;
    }

    return normalizeProceduralStepsToMarkdownTable(out.join('\n'));
}

function capitalizeFirstChar(str: string): string {
    const s = str.trim();
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeProceduralCell(text: string): string {
    return text
        .replace(/\r?\n/g, ' ')
        .replace(/\|/g, '/')
        .replace(/\s+/g, ' ')
        .trim();
}

const BACKEND_NUMBERED_STEP_RE = /^\s*(?:\*\*\s*)?(?:paso\s+)?(\d{1,2})[.):-]\s*(.+)$/i;
const BACKEND_PROCEDURAL_HEADING_RE =
    /\b(?:secuencia|procedimiento|protocolo|paso\s+a\s+paso|aislamiento|bloqueo|loto|energ[ií]a\s+cero|actuaci[oó]n|respuesta|emergencia|evacuaci[oó]n|purga|despresurizaci[oó]n|maniobra|verificaci[oó]n)\b/i;

function isStructuralLineBackend(trimmed: string): boolean {
    if (!trimmed) return true;
    if (/^#{1,6}\s/.test(trimmed)) return true;
    if (trimmed.startsWith('|')) return true;
    if (trimmed.startsWith('![') || /^\[IMAGEN[_\s-]PENDIENTE:/i.test(trimmed)) return true;
    if (/^\*Figura\s+(?:t[eé]cnica|\d+):/i.test(trimmed)) return true;
    if (/^---+$/.test(trimmed)) return true;
    if (/^(?:\*\*)?REGLA\s+DE\s+BLOQUEO/i.test(trimmed)) return true;
    if (/^\s*[-*•]\s+\*\*\[\d+\]\*\*/.test(trimmed)) return true;
    if (/^\*\*([A-ZÁÉÍÓÚÑ0-9\s—–()/.,:-]{10,})\*\*:?$/.test(trimmed)) return true;
    return false;
}

export function parseProceduralStepToColumnsBackend(
    stepNumber: number,
    rawStepText: string
): [string, string, string, string] {
    const pasoCol = String(stepNumber).padStart(2, '0');
    const trimmedRaw = rawStepText.trim();
    const normalized =
        !trimmedRaw.startsWith('**') && /^[^*]{2,80}\*\*/.test(trimmedRaw)
            ? `**${trimmedRaw}`
            : trimmedRaw;

    if (normalized.includes('|')) {
        const parts = normalized
            .split('|')
            .map((p) => escapeProceduralCell(p))
            .filter(Boolean);
        if (parts.length >= 3) {
            return [
                pasoCol,
                parts[0].startsWith('**') ? parts[0] : `**${parts[0].replace(/\*\*/g, '')}**`,
                parts[1],
                parts.slice(2).join(' — '),
            ];
        }
    }

    let stageLabel = 'Maniobra Operativa';
    let contentRest = normalized;

    const boldPrefixMatch = normalized.match(/^\*\*([^*]+)\*\*\s*[:.—–-]?\s*([\s\S]+)$/);
    if (boldPrefixMatch) {
        stageLabel = boldPrefixMatch[1].replace(/[:.—–-]+$/, '').trim();
        contentRest = boldPrefixMatch[2].trim();
    } else {
        const colonPrefixMatch = normalized.match(/^([^:.]{3,70}):\s*([\s\S]+)$/);
        if (colonPrefixMatch) {
            stageLabel = colonPrefixMatch[1].replace(/\*\*/g, '').replace(/[:.—–-]+$/, '').trim();
            contentRest = colonPrefixMatch[2].trim();
        }
    }

    const formattedStage = `**${escapeProceduralCell(stageLabel.replace(/\*\*/g, ''))}**`;
    let actionCol = contentRest;
    let verificationCol = '';

    const confirmRe =
        /\b(?:para\s+(?:confirmar|verificar|comprobar|asegurar)|confirmando|verificando)\s+([^.;]+?)(?=(?:\s+y\s+[a-záéíóúñ0-9]+\s+para\s+(?:confirmar|verificar|comprobar))|[.;]|$)/gi;
    const confirmCriteria: string[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = confirmRe.exec(contentRest)) !== null) {
        const crit = cm[1].trim();
        if (crit) confirmCriteria.push(capitalizeFirstChar(crit));
    }

    if (confirmCriteria.length > 0) {
        verificationCol = confirmCriteria.join(' — ');
        const strippedAction = contentRest
            .replace(
                /\s*\b(?:para\s+(?:confirmar|verificar|comprobar|asegurar)|confirmando|verificando)\s+[^.;]+?(?=(?:\s+y\s+[a-záéíóúñ0-9]+\s+para\s+(?:confirmar|verificar|comprobar))|[.;]|$)/gi,
                ''
            )
            .replace(/\s+\./g, '.')
            .replace(/\s{2,}/g, ' ')
            .trim();
        if (strippedAction.length >= 15) {
            actionCol = strippedAction;
        }
    } else {
        const hastaQueMatch = contentRest.match(/^([\s\S]+?)\s+hasta\s+que\s+([^.]+)\.?$/i);
        if (hastaQueMatch && hastaQueMatch[1].trim().length >= 15) {
            actionCol = `${hastaQueMatch[1].trim().replace(/\.$/, '')}.`;
            verificationCol = `${capitalizeFirstChar(hastaQueMatch[2].trim().replace(/\.$/, ''))}.`;
        } else {
            const sentences = contentRest
                .split(/(?<=[.?!])\s+(?=[A-ZÁÉÍÓÚÑ0-9])/)
                .map((s) => s.trim())
                .filter(Boolean);

            const trailingParenMatch =
                sentences.length === 1
                    ? contentRest.match(
                          /^([\s\S]+?)\s*\(([^)]*(?:\d|OFF|ON|CERO|BLOQUEADO|RPM|bar|psi|kPa|MPa|V|A|°C|°F|mm|N·m|kg|L)[^)]*)\)\.?$/i
                      )
                    : null;

            if (trailingParenMatch && trailingParenMatch[1].trim().length >= 10) {
                actionCol = `${trailingParenMatch[1].trim().replace(/\.$/, '')}.`;
                verificationCol = trailingParenMatch[2].trim();
            } else if (sentences.length >= 2) {
                actionCol = sentences.slice(0, -1).join(' ');
                verificationCol = sentences[sentences.length - 1];
            } else {
                actionCol = contentRest;
                const metricMatches = contentRest.match(
                    /\b\d+(?:[.,]\d+)?\s*(?:bar|psi|kPa|MPa|V|VDC|RPM|°C|°F|N·m|lb[-·]ft|mm|cm|m|kg|lb|L|gal|dB\(A\)|m\/s²)\b|[<>]\s*\d+(?:[.,]\d+)?\s*(?:°[CF]|bar|psi|V|RPM)|\bISO\s+\d+(?:[-:]\d+)?(?:\s+[A-Z]\d{3})?\b|\bDS\s+\d+\b|\bEN\s+\d+\b/gi
                );
                if (metricMatches && metricMatches.length > 0) {
                    verificationCol = Array.from(new Set(metricMatches.map((m) => m.trim()))).join(' / ');
                } else {
                    verificationCol = 'Verificación operativa en el equipo';
                }
            }
        }
    }

    return [
        pasoCol,
        formattedStage,
        escapeProceduralCell(actionCol),
        escapeProceduralCell(verificationCol || 'Verificación operativa en el equipo'),
    ];
}

export function normalizeProceduralStepsToMarkdownTable(markdown: string): string {
    if (!markdown) return '';
    const rawLines = markdown.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let lastHeadingText = '';
    let i = 0;

    while (i < rawLines.length) {
        const rawLine = rawLines[i];
        const trimmed = rawLine.trim();

        const standaloneUpperBold = trimmed.match(/^\*\*([A-ZÁÉÍÓÚÑ0-9\s—–()/.,:-]{10,})\*\*:?$/);
        if (standaloneUpperBold && !/^REGLA\s+DE\s+BLOQUEO/i.test(standaloneUpperBold[1].trim())) {
            const cleanHeading = standaloneUpperBold[1].replace(/:$/, '').trim();
            lastHeadingText = cleanHeading;
            out.push(`#### ${cleanHeading}`);
            i++;
            continue;
        }

        if (/^#{1,6}\s+/.test(trimmed)) {
            lastHeadingText = trimmed.replace(/^#{1,6}\s+/, '').trim();
            out.push(rawLine);
            i++;
            continue;
        }

        const stepMatch = trimmed.match(BACKEND_NUMBERED_STEP_RE);
        if (stepMatch) {
            const collectedSteps: Array<{ stepNum: number; text: string }> = [];
            let cursor = i;

            while (cursor < rawLines.length) {
                const curTrimmed = rawLines[cursor].trim();
                const m = curTrimmed.match(BACKEND_NUMBERED_STEP_RE);
                if (!m) break;

                let stepText = m[2].trim();
                const parsedNum = parseInt(m[1], 10);
                cursor++;

                while (cursor < rawLines.length) {
                    const contTrimmed = rawLines[cursor].trim();
                    if (!contTrimmed) break;
                    if (BACKEND_NUMBERED_STEP_RE.test(contTrimmed) || isStructuralLineBackend(contTrimmed)) {
                        break;
                    }
                    stepText += ` ${contTrimmed}`;
                    cursor++;
                }

                collectedSteps.push({
                    stepNum: Number.isFinite(parsedNum) ? parsedNum : collectedSteps.length + 1,
                    text: stepText,
                });

                let peek = cursor;
                while (peek < rawLines.length && !rawLines[peek].trim()) peek++;
                if (peek < rawLines.length && BACKEND_NUMBERED_STEP_RE.test(rawLines[peek].trim())) {
                    cursor = peek;
                } else {
                    break;
                }
            }

            if (collectedSteps.length >= 2 || (collectedSteps.length === 1 && BACKEND_PROCEDURAL_HEADING_RE.test(lastHeadingText))) {
                out.push(
                    '',
                    '| Paso | Etapa / Punto de Intervención | Procedimiento Operativo de Control / Maniobra | Criterio de Verificación / Magnitud Nominal (SI) |',
                    '| :---: | :--- | :--- | :--- |'
                );
                for (let sIdx = 0; sIdx < collectedSteps.length; sIdx++) {
                    const [paso, stage, action, verification] = parseProceduralStepToColumnsBackend(
                        sIdx + 1,
                        collectedSteps[sIdx].text
                    );
                    out.push(`| ${paso} | ${stage} | ${action} | ${verification} |`);
                }
                out.push('');
                i = cursor;
                continue;
            }
        }

        out.push(rawLine);
        i++;
    }

    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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

    // 0. Normalización estructural determinista de tablas Markdown (`expectedCols`) en los 5 pilares
    let text = normalizeMarkdownTableRows(markdown);
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

    // 2b. US qt / quarts -> L (evitando duplicar si en la vecindad simétrica ya figura `L` o `litros`)
    text = text.replace(
        /(\b\d{1,4}(?:[.,]\d{1,2})?)\s*(?:us\s*)?(?:qt|quarts?)\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\b(?:l|litros|liters|litres)\b/i.test(neighborhood)) return match;
            const qt = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(qt) || qt <= 0) return match;
            const liters = qt * 0.946353;
            conversionsApplied++;
            return `${formatSmartNumber(liters)} L (${rawVal} qt)`;
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

    // 3b. Torque ligero `in-lb` / `lb-in` / `lbf-in` -> `N·m`
    text = text.replace(
        /(\b\d{1,5}(?:[.,]\d{1,2})?)\s*(?:in[-·\s]?lb|lb[-·\s]?in|lbf[-·\s]?in)\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\bn[·\s-]?m\b/i.test(neighborhood)) return match;
            const inLb = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(inLb) || inLb <= 0) return match;
            const nm = inLb * 0.112985;
            conversionsApplied++;
            return `${formatSmartNumber(nm)} N·m (${rawVal} in·lb)`;
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

    // 6. Caudal `gpm` (US gal/min) -> `L/min`
    text = text.replace(
        /(\b\d{1,4}(?:[.,]\d{1,2})?)\s*(?:us\s*)?gpm\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\b(?:l\/min|lpm)\b/i.test(neighborhood)) return match;
            const gpm = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(gpm) || gpm <= 0 || gpm > 5000) return match;
            const lpm = gpm * 3.78541;
            conversionsApplied++;
            return `${formatSmartNumber(lpm)} L/min (${rawVal} gpm)`;
        }
    );

    // 7. Velocidad `mph` -> `km/h`
    text = text.replace(
        /(\b\d{1,3}(?:[.,]\d{1,2})?)\s*mph\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\bkm\/h\b/i.test(neighborhood)) return match;
            const mph = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(mph) || mph <= 0 || mph > 250) return match;
            const kmh = mph * 1.60934;
            conversionsApplied++;
            return `${formatSmartNumber(kmh)} km/h (${rawVal} mph)`;
        }
    );

    // 8. Volumen `yd³` / `cu yd` -> `m³`
    text = text.replace(
        /(\b\d{1,4}(?:[.,]\d{1,2})?)\s*(?:cu\.?\s*yd\.?|yd³|yd3)\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\bm(?:³|3)\b/i.test(neighborhood)) return match;
            const yd3 = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(yd3) || yd3 <= 0) return match;
            const m3 = yd3 * 0.764555;
            conversionsApplied++;
            return `${formatSmartNumber(m3)} m³ (${rawVal} yd³)`;
        }
    );

    // 9. Temperatura `°F` -> `°C`
    text = text.replace(
        /(-?\b\d{1,4}(?:[.,]\d{1,2})?)\s*°\s*F\b/g,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/°\s*C\b/i.test(neighborhood)) return match;
            const f = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(f) || f < -80 || f > 2500) return match;
            const c = ((f - 32) * 5) / 9;
            conversionsApplied++;
            return `${formatSmartNumber(c)} °C (${rawVal} °F)`;
        }
    );

    // 10. Distancia / Altura `ft` / `feet` -> `m` (excluyendo `lb-ft`, `ft-lb`, `ft³`)
    text = text.replace(
        /(?<![-·\w])(\b\d{1,4}(?:[.,]\d{1,2})?)\s*(?:ft|feet)\b(?![-·³3])/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\b(?:\d+(?:[.,]\d+)?\s*(?:m|mm|cm)|lb[-·\s]?ft|ft[-·\s]?lb)\b/i.test(neighborhood)) return match;
            const ft = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(ft) || ft <= 0 || ft > 2000) return match;
            const meters = ft * 0.3048;
            conversionsApplied++;
            return `${formatSmartNumber(meters)} m (${rawVal} ft)`;
        }
    );

    // 11. Pulgadas lineales `in` / `inches` / `pulg` / `pulgadas` -> `mm` (excluyendo `in³`, `in-lb`, `lb-in` y preposición inglesa `in`)
    text = text.replace(
        /(?<![-·\w])(\b\d{1,3}(?:[.,]\d{1,2})?)\s*(?:inches|pulgadas|pulg\.?|in)\b(?![-·³3\w]|\s+(?:the|a|an|this|that|order|case|line|gear|cab|mode|service|operation|neutral|parallel|series)\b)/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\b(?:\d+(?:[.,]\d+)?\s*(?:mm|cm|m)\b|in[-·\s]?lb|lb[-·\s]?in|cu\.?\s*in)/i.test(neighborhood)) return match;
            const inches = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(inches) || inches <= 0 || inches > 500) return match;
            const mm = inches * 25.4;
            conversionsApplied++;
            return `${formatSmartNumber(mm)} mm (${rawVal} in)`;
        }
    );

    // 12. Consumo horario `gal/h` / `gph` -> `L/h`
    text = text.replace(
        /(\b\d{1,4}(?:[.,]\d{1,2})?)\s*(?:gal\/h|gph)\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\bl\/h\b/i.test(neighborhood)) return match;
            const gph = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(gph) || gph <= 0) return match;
            const lh = gph * 3.78541;
            conversionsApplied++;
            return `${formatSmartNumber(lh)} L/h (${rawVal} gal/h)`;
        }
    );

    // 13. Rendimiento de combustible `mpg` -> `km/L` y `L/100 km`
    text = text.replace(
        /(\b\d{1,3}(?:[.,]\d{1,2})?)\s*mpg\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\b(?:km\/l|l\/100\s*km)\b/i.test(neighborhood)) return match;
            const mpg = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(mpg) || mpg <= 0) return match;
            const kmL = mpg * 0.425144;
            const lPer100km = 235.215 / mpg;
            conversionsApplied++;
            return `${formatSmartNumber(kmL)} km/L [${formatSmartNumber(lPer100km)} L/100 km] (${rawVal} mpg)`;
        }
    );

    // 14. Consumo específico de motor `lb/(hp·h)` -> `g/kWh`
    text = text.replace(
        /(\b\d{1,2}(?:[.,]\d{1,3})?)\s*(?:lb\/(?:hp[·.\s-]?h|hp-hr)|lbs?\/hp-?h)\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\bg\/kwh\b/i.test(neighborhood)) return match;
            const lbHph = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(lbHph) || lbHph <= 0) return match;
            const gKwh = lbHph * 608.277;
            conversionsApplied++;
            return `${formatSmartNumber(gKwh)} g/kWh (${rawVal} lb/hp·h)`;
        }
    );

    // 15. Caudal neumático de aire libre `cfm` / `scfm` -> `m³/min`
    text = text.replace(
        /(\b\d{1,5}(?:[.,]\d{1,2})?)\s*(?:scfm|cfm)\b/gi,
        (match, rawVal, offset: number, fullStr: string) => {
            const neighborhood = fullStr.slice(Math.max(0, offset - 32), Math.min(fullStr.length, offset + match.length + 32));
            if (/\b(?:m³\/min|m3\/min|l\/s)\b/i.test(neighborhood)) return match;
            const cfm = parseFloat(String(rawVal).replace(',', '.'));
            if (!Number.isFinite(cfm) || cfm <= 0) return match;
            const m3min = cfm * 0.0283168;
            conversionsApplied++;
            return `${formatSmartNumber(m3min)} m³/min (${rawVal} cfm)`;
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

export interface InlineSymbologyInjectionResult {
    enrichedMarkdown: string;
    detectedConceptIds: string[];
    applicationsByConcept: Record<string, string>;
}

const DETERMINISTIC_INLINE_SYMBOL_RULES: Array<{
    conceptId: string;
    pattern: RegExp;
}> = [
        {
            conceptId: 'iso_7000_0248_engine_oil_pressure',
            pattern: /\b(?:presi[oó]n\s+de\s+aceite\s+(?:de(?:l)?\s+)?motor|baja\s+presi[oó]n\s+de\s+aceite\s+de\s+motor|ISO\s*7000[- ]?0248)\b/i,
        },
        {
            conceptId: 'iso_7000_0246_coolant_temperature',
            pattern: /\b(?:temperatura\s+de(?:l)?\s+refrigerante|sobretemperatura\s+de(?:l)?\s+(?:motor|refrigerante)|ISO\s*7000[- ]?0246)\b/i,
        },
        {
            conceptId: 'iso_7000_0247_battery_charging',
            pattern: /\b(?:carga\s+de(?:l)?\s+alternador|testigo\s+de\s+bater[ií]a|sistema\s+de\s+carga\s+(?:12|24)\s*V|ISO\s*7000[- ]?0247)\b/i,
        },
        {
            conceptId: 'iso_7000_0238_parking_brake',
            pattern: /\b(?:freno\s+de\s+estacionamiento|freno\s+de\s+parqueo|ISO\s*7000[- ]?0238)\b/i,
        },
        {
            conceptId: 'iso_7000_0239_brake_system_failure',
            pattern: /\b(?:falla\s+(?:en\s+(?:el\s+)?)?sistema\s+de\s+frenos|baja\s+presi[oó]n\s+de\s+frenos|ISO\s*7000[- ]?0239)\b/i,
        },
        {
            conceptId: 'iso_7000_0249_seatbelt_reminder',
            pattern: /\b(?:cintur[oó]n\s+de\s+seguridad|barra\s+de\s+retenci[oó]n\s+ROPS|ISO\s*7000[- ]?0249)\b/i,
        },
        {
            conceptId: 'iso_7000_1409_hydraulic_oil_pressure',
            pattern: /\b(?:presi[oó]n\s+(?:de\s+aceite\s+)?hidr[aá]ulic[ao]|presi[oó]n\s+del\s+sistema\s+hidr[aá]ulico|ISO\s*7000[- ]?1409)\b/i,
        },
        {
            conceptId: 'iso_7000_1411_hydraulic_oil_temp',
            pattern: /\b(?:temperatura\s+(?:de(?:l)?\s+)?(?:aceite|fluido)\s+hidr[aá]ulico|ISO\s*7000[- ]?1411)\b/i,
        },
        {
            conceptId: 'iso_7000_1410_hydraulic_oil_level',
            pattern: /\b(?:nivel\s+(?:de(?:l)?\s+)?(?:aceite|fluido)\s+hidr[aá]ulico|mirilla\s+hidr[aá]ulica|ISO\s*7000[- ]?1410)\b/i,
        },
        {
            conceptId: 'iso_7000_1412_hydraulic_oil_filter',
            pattern: /\b(?:filtro\s+(?:de\s+aceite\s+)?hidr[aá]ulico|restricci[oó]n\s+de\s+filtro\s+hidr[aá]ulico|ISO\s*7000[- ]?1412)\b/i,
        },
        {
            conceptId: 'iso_7000_1156_transmission_oil_temp',
            pattern: /\b(?:temperatura\s+de\s+(?:aceite\s+de\s+)?(?:transmisi[oó]n|convertidor\s+de\s+par)|ISO\s*7000[- ]?1156)\b/i,
        },
        {
            conceptId: 'iso_7000_1658_quick_coupler_lock',
            pattern: /\b(?:acoplador\s+r[aá]pido|quick\s+coupler|pasadores\s+de\s+acople|ISO\s*7000[- ]?1658)\b/i,
        },
        {
            conceptId: 'iso_7000_1371_two_speed_rabbit_turtle',
            pattern: /\b(?:selector\s+de\s+velocidad\s+(?:de\s+traslado|alta\s*\/\s*baja)|modo\s+liebre|modo\s+tortuga|two[- ]speed|ISO\s*7000[- ]?1371)\b/i,
        },
        {
            conceptId: 'iso_7000_1665_auxiliary_hydraulics_high_flow',
            pattern: /\b(?:hidr[aá]ulic[ao]\s+auxiliar|high[- ]flow|caudal\s+auxiliar\s+continuo|ISO\s*7000[- ]?1665)\b/i,
        },
        {
            conceptId: 'iso_7000_0791_grease_lubrication_point',
            pattern: /\b(?:punto(?:s)?\s+de\s+engrase|grasera(?:s)?|lubricaci[oó]n\s+con\s+grasa|ISO\s*7000[- ]?0791)\b/i,
        },
        {
            conceptId: 'iso_7000_0029_horn_audible_warning',
            pattern: /\b(?:c[oó]digo\s+ac[uú]stico\s+de\s+maniobra|toque(?:s)?\s+de\s+bocina|ISO\s*7000[- ]?0029)\b/i,
        },
        {
            conceptId: 'iso_7000_1141_beacon_strobe_light',
            pattern: /\b(?:baliza\s+estrobosc[oó]pica|baliza\s+destellante|p[eé]rtiga\s+y\s+baliza|ISO\s*7000[- ]?1141)\b/i,
        },
        {
            conceptId: 'iso_7000_0639_master_battery_disconnect',
            pattern: /\b(?:cortacorriente(?:\s+maestro)?|interruptor\s+de\s+aislamiento\s+de\s+bater[ií]a|ISO\s*7000[- ]?0639)\b/i,
        },
        {
            conceptId: 'iso_7000_0245_fuel_level',
            pattern: /\b(?:nivel\s+de\s+combustible|abastecimiento\s+de\s+combustible|estanque\s+de\s+combustible\s+di[eé]sel|ISO\s*7000[- ]?0245)\b/i,
        },
        {
            conceptId: 'iso_7000_1393_water_in_fuel',
            pattern: /\b(?:agua\s+en\s+(?:el\s+)?(?:combustible|separador)|separador\s+de\s+agua\s+primario|decantador\s+de\s+combustible|ISO\s*7000[- ]?1393)\b/i,
        },
        {
            conceptId: 'iso_7000_1168_engine_air_filter',
            pattern: /\b(?:filtro\s+de\s+aire\s+de\s+admisi[oó]n|restricci[oó]n\s+de(?:l)?\s+filtro\s+de\s+aire|ISO\s*7000[- ]?1168)\b/i,
        },
        {
            conceptId: 'iso_7000_2433_dpf_regeneration',
            pattern: /\b(?:regeneraci[oó]n\s+(?:del\s+)?DPF|filtro\s+de\s+part[ií]culas\s+di[eé]sel\s*\(?DPF\)?|ISO\s*7000[- ]?2433)\b/i,
        },
        {
            conceptId: 'iso_7000_2946_def_adblue',
            pattern: /\b(?:fluido\s+DEF|AdBlue|urea\s+automotriz\s+SCR|ISO\s*7000[- ]?2946)\b/i,
        },
        {
            conceptId: 'iso_7000_0457_glow_plug_preheat',
            pattern: /\b(?:buj[ií]as\s+incandescentes|precalentador\s+de\s+admisi[oó]n|arranque\s+en\s+fr[ií]o|ISO\s*7000[- ]?0457)\b/i,
        },
        {
            conceptId: 'iso_2575_check_engine_mil',
            pattern: /\b(?:check\s+engine|testigo\s+MIL|falla\s+electr[oó]nica\s+de(?:l)?\s+motor|ISO\s*2575[- ]?F01)\b/i,
        },
        {
            conceptId: 'iso_2575_four_wheel_drive_4wd',
            pattern: /\b(?:tracci[oó]n\s+4x4|selector\s+4H\s*\/\s*4L|caja\s+de\s+transferencia\s+4WD|bloqueo\s+de\s+diferencial|ISO\s*7000[- ]?2412)\b/i,
        },
        {
            conceptId: 'iso_2575_tpms_tire_pressure',
            pattern: /\b(?:presi[oó]n\s+de\s+(?:inflado\s+de\s+)?neum[aá]ticos|sistema\s+TPMS|monitoreo\s+TKPH|ISO\s*2575[- ]?G03)\b/i,
        },
        {
            conceptId: 'iso_7000_pneumatic_air_pressure',
            pattern: /\b(?:presi[oó]n\s+de\s+red\s+neum[aá]tica|lubricador\s+en\s+l[ií]nea|cadena(?:s)?\s+antilatigazo|whipcheck|ISO\s*7000[- ]?1405)\b/i,
        },
        {
            conceptId: 'iec_60417_5172_class_ii_double_insulation',
            pattern: /\b(?:doble\s+aislamiento|aislamiento\s+Clase\s+II|IEC\s*60417[- ]?5172)\b/i,
        },
        {
            conceptId: 'iec_60417_5019_protective_earth',
            pattern: /\b(?:tierra\s+de\s+protecci[oó]n|puesta\s+a\s+tierra\s+PE|malla\s+a\s+tierra|IEC\s*60417[- ]?5019)\b/i,
        },
        {
            conceptId: 'iec_60417_5036_dangerous_voltage',
            pattern: /\b(?:tensi[oó]n\s+el[eé]ctrica\s+peligrosa|peligro\s+de\s+arco\s+el[eé]ctrico|IEC\s*60417[- ]?5036)\b/i,
        },
        {
            conceptId: 'iso_7010_m002',
            pattern: /\b(?:manual\s+de\s+instrucciones\s+OEM|manual\s+de\s+operaci[oó]n\s+y\s+mantenimiento|ISO\s*7010[- ]?M002)\b/i,
        },
        {
            conceptId: 'iso_7010_m003',
            pattern: /\b(?:protecci[oó]n\s+auditiva|protector(?:es)?\s+auditivo(?:s)?|ISO\s*7010[- ]?M003)\b/i,
        },
        {
            conceptId: 'iso_7010_m004',
            pattern: /\b(?:protecci[oó]n\s+ocular|lentes\s+de\s+seguridad|antiparras\s+de\s+seguridad|ISO\s*7010[- ]?M004)\b/i,
        },
        {
            conceptId: 'iso_7010_m008',
            pattern: /\b(?:calzado\s+de\s+seguridad|zapatos\s+de\s+seguridad|ISO\s*7010[- ]?M008)\b/i,
        },
        {
            conceptId: 'iso_7010_m009',
            pattern: /\b(?:guantes\s+(?:de\s+(?:protecci[oó]n|seguridad|cabritilla|nitrilo|diel[eé]ctricos|alta\s+temperatura)|anticorte|t[eé]rmicos|mec[aá]nicos|diel[eé]ctricos|resistentes\s+a\s+hidrocarburos)|ISO\s*7010[- ]?M009)\b/i,
        },
        {
            conceptId: 'iso_7010_m014',
            pattern: /\b(?:casco\s+de\s+seguridad|barbiquejo|ISO\s*7010[- ]?M014)\b/i,
        },
        {
            conceptId: 'iso_7010_m015',
            pattern: /\b(?:alta\s+visibilidad|chaleco\s+reflectante|ISO\s*7010[- ]?M015)\b/i,
        },
        {
            conceptId: 'iso_7010_m017',
            pattern: /\b(?:protecci[oó]n\s+respiratoria|respirador\s+(?:de\s+medio\s+rostro\s+|con\s+filtros\s+)?P100|mascarilla\s+P100|ISO\s*7010[- ]?M017)\b/i,
        },
        {
            conceptId: 'iso_7010_m018',
            pattern: /\b(?:arn[eé]s\s+(?:de\s+seguridad|antica[ií]das)|cuerda\s+de\s+vida|ISO\s*7010[- ]?M018)\b/i,
        },
        {
            conceptId: 'iso_7010_m021',
            pattern: /\b(?:bloqueo\s+y\s+etiquetado|procedimiento\s+LOTO|energ[ií]a\s+cero|candado\s+personal\s+LOTO|ISO\s*7010[- ]?M021)\b/i,
        },
        {
            conceptId: 'iso_7010_w008',
            pattern: /\b(?:tres\s+puntos\s+de\s+apoyo|ca[ií]da\s+a\s+distinto\s+nivel|ISO\s*7010[- ]?W008)\b/i,
        },
        {
            conceptId: 'iso_7010_w012',
            pattern: /\b(?:riesgo\s+de\s+electrocuci[oó]n|electrocuci[oó]n|contacto\s+el[eé]ctrico|descarga\s+el[eé]ctrica|l[ií]neas\s+el[eé]ctricas\s+energizadas|ISO\s*7010[- ]?W012)\b/i,
        },
        {
            conceptId: 'iso_7010_w015',
            pattern: /\b(?:carga(?:s)?\s+suspendida(?:s)?|bajo\s+pluma\s+o\s+carga|ca[ií]da\s+de\s+carga|brazos\s+de\s+levante\s+sin\s+traba|tolva\s+levantada|implemento\s+suspendido|ISO\s*7010[- ]?W015)\b/i,
        },
        {
            conceptId: 'iso_7010_w017',
            pattern: /\b(?:superficie(?:s)?\s+caliente(?:s)?|peligro\s+de\s+quemaduras\s+t[eé]rmicas|quemadura(?:s)?\s+t[eé]rmica(?:s)?|contacto\s+t[eé]rmico|ISO\s*7010[- ]?W017)\b/i,
        },
        {
            conceptId: 'iso_7010_w019',
            pattern: /\b(?:aplastamiento\s+por\s+partes\s+m[oó]viles|traba\s+de\s+articulaci[oó]n|zona\s+de\s+pellizco|punto(?:s)?\s+de\s+atrapamiento|ISO\s*7010[- ]?W019)\b/i,
        },
        {
            conceptId: 'iso_7010_w024',
            pattern: /\b(?:atrapamiento\s+de\s+manos|atrapamiento\s+rotatorio|partes\s+rotatorias\s+expuestas|correas\s+y\s+poleas|eje\s+card[aá]n|ISO\s*7010[- ]?W024)\b/i,
        },
        {
            conceptId: 'iso_7010_w029',
            pattern: /\b(?:sistema\s+presurizado|acumulador(?:es)?\s+hidroneum[aá]tico(?:s)?|alivio\s+de\s+presi[oó]n\s+residual|inyecci[oó]n\s+cut[aá]nea|inyecci[oó]n\s+de\s+fluido\s+a\s+alta\s+presi[oó]n|fluido\s+presurizado|latigazo\s+de\s+manguera|ISO\s*7010[- ]?W029)\b/i,
        },
        {
            conceptId: 'iso_7010_f001',
            pattern: /\b(?:extintor\s+(?:contra\s+incendios|PQS|port[aá]til)|sistema\s+AFEX|supresi[oó]n\s+de\s+incendios|ISO\s*7010[- ]?F001)\b/i,
        },
        {
            conceptId: 'iso_7010_e001',
            pattern: /\b(?:salida\s+de\s+emergencia|v[ií]a\s+de\s+evacuaci[oó]n|martillo\s+rompecristales|ISO\s*7010[- ]?E001)\b/i,
        },
        {
            conceptId: 'ghs_02_flammable_liquids',
            pattern: /\b(?:l[ií]quido(?:s)?\s+inflamable(?:s)?|vapor(?:es)?\s+inflamable(?:s)?|GHS02)\b/i,
        },
        {
            conceptId: 'ghs_04_compressed_gas',
            pattern: /\b(?:gas(?:es)?\s+comprimido(?:s)?|nitr[oó]geno\s+presurizado\s+N2|GHS04)\b/i,
        },
        {
            conceptId: 'ghs_05_corrosive_battery_acid',
            pattern: /\b(?:electrolito\s+corrosivo|[aá]cido\s+sulf[uú]rico\s+de\s+bater[ií]a|GHS05)\b/i,
        },
        {
            conceptId: 'ghs_08_health_hazard_silica_fumes',
            pattern: /\b(?:polvo\s+de\s+s[ií]lice|s[ií]lice\s+cristalina|material\s+particulado\s+di[eé]sel|GHS08)\b/i,
        },
        {
            conceptId: 'ghs_09_environmental_spill_hazard',
            pattern: /\b(?:derrame\s+de\s+hidrocarburos|kit\s+antiderrame|bandeja\s+de\s+contenci[oó]n|GHS09)\b/i,
        },
    ];

function extractSentenceSnippet(text: string, matchIndex: number, matchLen: number): string {
    const start = Math.max(0, text.lastIndexOf('\n', matchIndex) + 1);
    const endNewline = text.indexOf('\n', matchIndex + matchLen);
    const end = endNewline === -1 ? text.length : endNewline;
    const rawLine = text
        .slice(start, end)
        .replace(/\[S[IÍ]MBOLO:\s*[^\]]+\]/gi, '')
        .replace(/^[#>*\-\d.| ]+/, '')
        .replace(/\|/g, ' — ')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return rawLine.slice(0, 180);
}

/**
 * Autor de los símbolos sintéticos genéricos (engranaje/círculo verde o rojo) generados por la
 * versión anterior del motor ad-hoc (`SB-01`). Estos registros NO son pictogramas normativos y
 * deben ignorarse en lectura y purgarse de `master_symbology_vault`.
 */
export const SYNTHETIC_ADHOC_SYMBOL_AUTHOR = 'AGENTE_CAZADOR_IA_V5';

let syntheticPurgeDone = false;

/**
 * Purga idempotente (una vez por proceso) de los símbolos sintéticos `created_by == AGENTE_CAZADOR_IA_V5`
 * persistidos por el motor ad-hoc retirado. No toca símbolos semilla ni curados por DEV/TEST-PILOT.
 */
export async function purgeSyntheticAdHocSymbols(): Promise<number> {
    if (syntheticPurgeDone) return 0;
    try {
        const snap = await db
            .collection('master_symbology_vault')
            .where('created_by', '==', SYNTHETIC_ADHOC_SYMBOL_AUTHOR)
            .get();
        if (snap.empty) {
            syntheticPurgeDone = true;
            return 0;
        }
        let deleted = 0;
        let batch = db.batch();
        let ops = 0;
        for (const doc of snap.docs) {
            batch.delete(doc.ref);
            ops++;
            deleted++;
            if (ops >= 400) {
                await batch.commit();
                batch = db.batch();
                ops = 0;
            }
        }
        if (ops > 0) await batch.commit();
        syntheticPurgeDone = true;
        return deleted;
    } catch {
        return 0;
    }
}

type InlineSymbolCategory = 'TELLTALE' | 'PPE' | 'HAZARD';

function categorizeConcept(conceptId: string): InlineSymbolCategory {
    if (/^iso_7010_m\d{3}/.test(conceptId)) return 'PPE';
    if (/^(iso_7010_[wfe]\d{3}|iec_60417_|ghs_)/.test(conceptId)) return 'HAZARD';
    return 'TELLTALE';
}

/** Código normativo literal escrito en el texto (`ISO 7000-0248`, `ISO 7010 M014`, `IEC 60417-5036`, `GHS02`, `ISO 2575 F01`). */
const LITERAL_STANDARD_CODE_REGEX = /^(?:ISO\s*(?:7000|7010|2575)|IEC\s*60417|GHS\s*0?\d)/i;

/**
 * Contexto explícito obligatorio en la MISMA línea para inyectar un pictograma (Strict Explicit Mention Only):
 * - TELLTALE: el texto debe hablar de un testigo/indicador/luz de advertencia/alarma/pictograma, no del sistema nominal.
 * - PPE: el texto debe declarar uso de EPP (obligatorio/usar/utilizar/EPP).
 * - HAZARD: el texto debe declarar un peligro/riesgo/advertencia/señalética.
 */
const EXPLICIT_CONTEXT_BY_CATEGORY: Record<InlineSymbolCategory, RegExp> = {
    TELLTALE:
        /\b(?:testigo(?:s)?|indicador(?:es)?\s+(?:luminoso|de\s+advertencia|de\s+alarma|del\s+tablero|en\s+tablero|en\s+monitor)|luz(?:\s+|\s+de\s+)(?:advertencia|aviso|alarma|alerta)|luz\s+piloto|piloto\s+luminoso|se\s+enciende|se\s+ilumina|parpadea|destell(?:a|o)|alarma\s+(?:visual|ac[uú]stica|sonora|continua|intermitente)|categor[ií]a\s+(?:de\s+(?:advertencia|alerta)\s*)?[123](?:-S)?|nivel\s+de\s+(?:alerta|advertencia)\s*[123]|[ií]cono\s+(?:en\s+)?(?:pantalla|monitor|tablero)|pictograma|s[ií]mbolo\s+(?:ISO|del\s+tablero|de\s+advertencia|(?:en\s+|grabado\s+en\s+)?(?:interruptor|selector|tecla|bot[oó]n|consola|tablero))|mirilla|visor\s+de\s+nivel|varilla\s+de\s+(?:nivel|medici[oó]n)|prueba\s+funcional|verificaci[oó]n\s+funcional|comprobar\s+funcionamiento|autochequeo)\b/i,
    PPE: /\b(?:EPP|uso\s+obligatorio|obligatorio|obligatoria|usar|utilizar|use|utilice|portar|requiere(?:n)?|requerid[oa]s?|equipar|protecci[oó]n\s+(?:ocular|auditiva|facial|respiratoria|de\s+manos|de\s+pies)|equipo\s+de\s+protecci[oó]n\s+personal|elemento(?:s)?\s+de\s+protecci[oó]n)\b/i,
    HAZARD:
        /\b(?:peligro|riesgo|advertencia|precauci[oó]n|atenci[oó]n|prohibido|se[nñ]al(?:[eé]tica)?|rotulad[oa]|etiqueta(?:do)?\s+de\s+peligro|pictograma|emergencia|evacuaci[oó]n|extintor|incendio|bloqueo\s+LOTO|energ[ií]a\s+cero|fluido\s+(?:presurizado|caliente|a\s+alta\s+presi[oó]n)|inyecci[oó]n\s+(?:de\s+fluido|cut[aá]nea)|superficie\s+caliente|quemadura(?:s)?|aplastamiento|atrapamiento|arco\s+el[eé]ctrico|despresurizar|fatalidad|amputaci[oó]n|electrocuci[oó]n|intoxicaci[oó]n|hipoacusia|silicosis|vuelco|colisi[oó]n|atropello|ca[ií]da\s+a\s+distinto\s+nivel|proyecci[oó]n\s+de\s+part[ií]culas|derrame|explosi[oó]n|traba\s+mec[aá]nica|desenergizar|purga)\b/i,
};

function getLineAt(text: string, index: number): string {
    const start = Math.max(0, text.lastIndexOf('\n', index - 1) + 1);
    const endNl = text.indexOf('\n', index);
    return text.slice(start, endNl === -1 ? text.length : endNl);
}

function isHeadingOrTableHeaderLineAt(text: string, index: number): boolean {
    const start = Math.max(0, text.lastIndexOf('\n', Math.max(0, index - 1)) + 1);
    const endNl = text.indexOf('\n', index);
    const currentLine = text.slice(start, endNl === -1 ? text.length : endNl).trim();
    if (!currentLine) return false;
    if (currentLine.startsWith('#')) return true;
    if (isMarkdownTableSeparatorLine(currentLine)) return true;
    if (currentLine.startsWith('|') && endNl !== -1) {
        let nextStart = endNl + 1;
        while (nextStart < text.length) {
            const nextEnd = text.indexOf('\n', nextStart);
            const nextLine = text.slice(nextStart, nextEnd === -1 ? text.length : nextEnd).trim();
            if (nextLine) {
                if (isMarkdownTableSeparatorLine(nextLine)) {
                    return true;
                }
                break;
            }
            if (nextEnd === -1) break;
            nextStart = nextEnd + 1;
        }
    }
    return false;
}

function isMatchExplicitlyContextualized(params: {
    conceptId: string;
    matchedText: string;
    lineText: string;
    pillarId?: string;
}): boolean {
    const isLiteralCode = LITERAL_STANDARD_CODE_REGEX.test(params.matchedText.trim());
    if (isLiteralCode) return true;
    // `01 · Ficha Técnica`: tablas nominales. Solo códigos normativos literales habilitan pictogramas.
    if (params.pillarId === 'ficha_tecnica') return false;
    const category = categorizeConcept(params.conceptId);
    const lineWithoutMarkers = params.lineText.replace(/\[S[IÍ]MBOLO:\s*[^\]]+\]/gi, ' ');
    return EXPLICIT_CONTEXT_BY_CATEGORY[category].test(lineWithoutMarkers);
}

function lineHasLiteralCodeFor(conceptId: string, lineText: string, isoReference?: string): boolean {
    const compactLine = lineText.toUpperCase().replace(/[\s_-]+/g, '');
    const compactRef = String(isoReference || '').toUpperCase().replace(/[\s_-]+/g, '');
    if (compactRef && compactRef.length >= 6 && compactLine.includes(compactRef)) return true;
    const m7010 = conceptId.match(/^iso_7010_([mwpfe]\d{3})/);
    if (m7010 && new RegExp(`\\b${m7010[1].toUpperCase()}\\b`).test(lineText.toUpperCase())) return true;
    const mGhs = conceptId.match(/^ghs_0(\d)_/);
    if (mGhs && new RegExp(`\\bGHS\\s*0?${mGhs[1]}\\b`, 'i').test(lineText)) return true;
    return false;
}

/**
 * Inyección determinista en línea (`0 tokens`, `0% alucinación`) de pictogramas verificados bajo política
 * **Strict Explicit Mention Only** (`SB-03`):
 * 1. Valida cualquier marcador `[SÍMBOLO: ...]` preexistente contra `master_symbology_vault` (excluyendo símbolos
 *    sintéticos) y lo conserva solo si su línea contiene el código normativo literal o un contexto explícito
 *    (testigo/indicador/alarma, uso de EPP o peligro declarado). En `ficha_tecnica` solo con código literal.
 * 2. Inserta `[SÍMBOLO: concept_id]` únicamente en menciones explícitas; nunca en sustantivos nominales de
 *    especificación (`presión de aceite hidráulico`, `temperatura del refrigerante`, `sistema de carga 24 V`).
 */
export async function injectVerifiedInlineSymbology(
    markdown: string,
    options: { pillarId?: string } = {}
): Promise<InlineSymbologyInjectionResult> {
    if (!markdown || !markdown.trim()) {
        return {
            enrichedMarkdown: markdown,
            detectedConceptIds: [],
            applicationsByConcept: {},
        };
    }

    await ensureUniversalSymbologySeeded(false);
    await purgeSyntheticAdHocSymbols();

    const vaultSnap = await db
        .collection('master_symbology_vault')
        .select('iso_reference', 'iso_code', 'standard_icon_url', 'svg_inline', 'created_by', 'standard_icon_status')
        .get();

    const verifiedIds = new Set<string>();
    const byIsoRef = new Map<string, string>();
    const isoRefById = new Map<string, string>();

    for (const doc of vaultSnap.docs) {
        const d = doc.data();
        if (!d.standard_icon_url && !d.svg_inline) continue;
        if (d.created_by === SYNTHETIC_ADHOC_SYMBOL_AUTHOR) continue;
        if (d.standard_icon_status && d.standard_icon_status !== 'encontrado') continue;
        verifiedIds.add(doc.id);
        const isoRefRaw = String(d.iso_reference || '');
        isoRefById.set(doc.id, isoRefRaw);
        const isoRef = isoRefRaw.toUpperCase().replace(/[\s_-]+/g, '');
        if (isoRef) byIsoRef.set(isoRef, doc.id);
        const isoCode = String(d.iso_code || '')
            .toUpperCase()
            .trim();
        if (isoCode) {
            byIsoRef.set(isoCode, doc.id);
            byIsoRef.set(`ISO7010${isoCode}`, doc.id);
        }
    }

    const detectedSet = new Set<string>();
    const applicationsByConcept: Record<string, string> = {};
    const pillarId = options.pillarId;

    // 1. Validar marcadores preexistentes: código inexistente, sintético, en cabecera/thead o fuera de contexto => se elimina limpiamente.
    let text = markdown.replace(
        /\s*\[S[IÍ]MBOLO:\s*([^\]]+)\]/gi,
        (fullMatch, rawCode: string, offset: number, sourceStr: string) => {
            if (isHeadingOrTableHeaderLineAt(sourceStr, offset)) {
                return '';
            }
            const cleanCid = rawCode
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9_]+/g, '_');
            let resolved: string | undefined;
            if (verifiedIds.has(cleanCid)) {
                resolved = cleanCid;
            } else {
                const m7010 = rawCode.toUpperCase().match(/\b([MWPFE]\d{3})\b/);
                if (m7010 && verifiedIds.has(`iso_7010_${m7010[1].toLowerCase()}`)) {
                    resolved = `iso_7010_${m7010[1].toLowerCase()}`;
                } else {
                    const compact = rawCode.toUpperCase().replace(/[\s_-]+/g, '');
                    resolved = byIsoRef.get(compact);
                }
            }
            if (!resolved || !verifiedIds.has(resolved)) {
                return '';
            }

            const lineText = getLineAt(sourceStr, offset);
            const cleanLineWithoutMarkers = lineText.replace(/\[S[IÍ]MBOLO:\s*[^\]]+\]/gi, ' ');
            const hasLiteral = lineHasLiteralCodeFor(resolved, cleanLineWithoutMarkers, isoRefById.get(resolved));
            const matchingRule = DETERMINISTIC_INLINE_SYMBOL_RULES.find((r) => r.conceptId === resolved);
            const ruleMatch = matchingRule ? cleanLineWithoutMarkers.match(matchingRule.pattern) : null;
            const contextOk =
                hasLiteral ||
                Boolean(
                    ruleMatch &&
                    isMatchExplicitlyContextualized({
                        conceptId: resolved,
                        matchedText: ruleMatch[0],
                        lineText: cleanLineWithoutMarkers,
                        pillarId,
                    })
                );
            if (!contextOk || detectedSet.has(resolved)) {
                return '';
            }

            detectedSet.add(resolved);
            if (!applicationsByConcept[resolved]) {
                applicationsByConcept[resolved] = extractSentenceSnippet(sourceStr, offset, fullMatch.length);
            }
            return ` [SÍMBOLO: ${resolved}]`;
        }
    );

    // 2. Inyección determinista solo en la primera mención EXPLÍCITA (fuera de cabeceras `#`, `<thead>` y separadores de tabla).
    for (const rule of DETERMINISTIC_INLINE_SYMBOL_RULES) {
        if (!verifiedIds.has(rule.conceptId)) continue;
        if (detectedSet.has(rule.conceptId)) continue;

        const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
        let match: RegExpExecArray | null;
        while ((match = globalPattern.exec(text)) !== null) {
            const mIdx = match.index;
            const mText = match[0];
            if (!mText) {
                globalPattern.lastIndex++;
                continue;
            }
            if (isHeadingOrTableHeaderLineAt(text, mIdx)) continue;

            const lineText = getLineAt(text, mIdx);
            if (
                !isMatchExplicitlyContextualized({
                    conceptId: rule.conceptId,
                    matchedText: mText,
                    lineText,
                    pillarId,
                })
            ) {
                continue;
            }

            const insertPos = mIdx + mText.length;
            const snippet = extractSentenceSnippet(text, mIdx, mText.length);
            text = `${text.slice(0, insertPos)} [SÍMBOLO: ${rule.conceptId}]${text.slice(insertPos)}`;
            detectedSet.add(rule.conceptId);
            if (snippet) {
                applicationsByConcept[rule.conceptId] = snippet;
            }
            break;
        }
    }

    return {
        enrichedMarkdown: text,
        detectedConceptIds: Array.from(detectedSet),
        applicationsByConcept,
    };
}

/**
 * @deprecated `SB-02`: la extracción especulativa de símbolos ad-hoc por IA fue retirada.
 * Se conserva el tipo solo por compatibilidad de firmas; su contenido se ignora.
 */
export interface AdHocSymbolRequirement {
    concept_id: string;
    iso_reference: string;
    technical_name_es: string;
    action_operator_es: string;
    critical_color?: 'RED' | 'AMBER' | 'GREEN' | 'BLUE' | 'NONE';
    target_phrase_in_text?: string;
}

/**
 * Compatibilidad (`SB-01`/`SB-02`): ya NO sintetiza SVG genéricos ni persiste símbolos en
 * `master_symbology_vault`, ni inyecta por `target_phrase_in_text`. Delega estrictamente en
 * `injectVerifiedInlineSymbology` (Strict Explicit Mention Only). `newlyCreatedCount` es siempre `0`.
 */
export async function upsertAndInjectAdHocSymbology(
    markdown: string,
    _adHocCandidates: AdHocSymbolRequirement[] = [],
    _itemContextRef?: string,
    options: { pillarId?: string } = {}
): Promise<InlineSymbologyInjectionResult & { newlyCreatedCount: number }> {
    const baseResult = await injectVerifiedInlineSymbology(markdown || '', options);
    return {
        ...baseResult,
        newlyCreatedCount: 0,
    };
}
