/**
 * TEXT SIMILARITY & DETERMINISTIC SPEC EXTRACTION UTILS — OPERMAQ VAULT
 *
 * Módulo centralizado para comparación léxica determinista de capítulos/ítems
 * y extracción quirúrgica de magnitudes y subsistemas confirmados desde Markdown cazado.
 */

export function normalizeComparableTitle(str: string): string {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function tokenJaccardSimilarity(a: string, b: string): number {
    const tokensA = normalizeComparableTitle(a)
        .split(' ')
        .filter((w) => w.length > 2);
    const tokensB = normalizeComparableTitle(b)
        .split(' ')
        .filter((w) => w.length > 2);
    if (tokensA.length === 0 || tokensB.length === 0) return 0;

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let inter = 0;
    for (const t of setA) {
        if (setB.has(t)) inter++;
    }
    return inter / (setA.size + setB.size - inter);
}

const NEGATED_OR_MISSING_ROW_VALUE_REGEX =
    /^(?:\[?\s*(?:no\s+aplica|n\s*\/\s*a|no\s+(?:posee|equipa|requiere|utiliza|incorpora|cuenta\s+con|disponible|incurre)|sin\s+(?:sistema|equipo|dispositivo|postratamiento|scr|adblue|def|dpf|pto|toma\s+de\s+fuerza|quinta\s+rueda|cabina|embrague|freno|acumulador)|ausencia\s+de|inexistencia\s+de|exento\s+de|carente\s+de)\b|—+$|-+$)|(?:\bno\s+declarad|\bpendiente\s+de\s+registro)/i;

const SPECIALIZED_SUBSYSTEM_KEYWORDS_REGEX =
    /\b(XHP|HIGH\s*FLOW|ALTO\s*CAUDAL|SAHR|FRENO\s*H[ÚU]MEDO|AFEX|ANSUL|SUPRESI[ÓO]N\s*DE\s*INCENDIO|AUTOLUBE|LUBRICACI[ÓO]N\s*AUTOM[ÁA]TICA|VIMS|TPMS|PTO|TOMA\s*DE\s*FUERZA|LOCK[\s-]*UP|RETARDO\s*DIN[ÁA]MICO|ARC|ACUMULADOR\s*HIDR[ÁA]ULICO|RIDE\s*CONTROL|QUICK\s*COUPLER|ACOPLE\s*R[ÁA]PIDO|DPF|SCR|DEF|ADBLUE|QUINTA\s*RUEDA|ROPS|FOPS|ALLISON|M[\s-]*DRIVE|I[\s-]*SHIFT|OPTICRUISE|TRAXON|FULLER|ROADRANGER|POWERSHIFT|HIDROST[ÁA]TICA|8X4|8X6|8X8|6X4|6X6|TOLVA)\b/gi;

const CLAUSE_NEGATION_CUE_REGEX =
    /\b(?:sin|no\s+aplica|n\s*\/\s*a|no\s+posee|no\s+equipa|no\s+requiere|no\s+utiliza|no\s+incorpora|no\s+cuenta\s+con|no\s+dispone\s+de|no\s+incurre(?:\s+en)?|no\s+tiene|libre\s+de|exento\s+de|ausencia\s+de|inexistencia\s+de|carente\s+de|descartando|excluyendo|prohibido|omitir|omitiendo|ni)\b/gi;

const CLAUSE_AFFIRMATIVE_RESET_REGEX =
    /(?<!\bno\s)\b(?:equipa|incorpora|incluye|posee|dispone\s+de|cuenta\s+con|dotado\s+de|provisto\s+de|integra|monta)\b/i;

const POST_KEYWORD_NEGATION_REGEX =
    /^\s*(?:[:—–-]\s*)?(?:no\s+aplica|n\s*\/\s*a\b|ausente|inexistente|no\s+(?:instalad|equipad|disponible|presente))/i;

function stripInlineNegativeParentheticals(text: string): string {
    return text
        .replace(/\(\s*(?:sin|no\s+aplica|exento\s+de|ausencia\s+de)\s+[^)]*\)/gi, '')
        .replace(/,\s*sin\s+(?:sistema\s+)?(?:scr|adblue|def|dpf|pto|embrague|cabina)[^,.;|]*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extrae únicamente los subsistemas especializados cuya presencia física en el activo
 * está afirmada positivamente en `markdown`, descartando menciones precedidas o seguidas
 * por negación ("sin sistema SCR", "No aplica", "no incurre en costos... DEF/AdBlue", etc.).
 */
export function extractPositivelyConfirmedSubsystems(markdown: string | undefined): string[] {
    const raw = String(markdown || '').trim();
    if (!raw) return [];

    const confirmed = new Set<string>();
    const candidateClauses: string[] = [];

    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (/^\|[\s:|-]+\|$/.test(line)) continue;

        if (line.startsWith('|') && line.endsWith('|')) {
            const cells = line
                .split('|')
                .map((c) => c.replace(/\*\*/g, '').trim())
                .filter(Boolean);
            if (cells.length < 2) continue;

            const col0Upper = cells[0].toUpperCase();
            if (
                col0Upper === 'PARÁMETRO' ||
                col0Upper === 'PARAMETRO' ||
                col0Upper.startsWith('PARÁMETRO /') ||
                col0Upper.startsWith('PARAMETRO /') ||
                col0Upper === 'N°' ||
                col0Upper === 'PASO' ||
                col0Upper === 'COMPONENTE' ||
                col0Upper.startsWith('PELIGRO') ||
                col0Upper.startsWith('PUNTO / COMPONENTE') ||
                col0Upper.startsWith('---')
            ) {
                continue;
            }

            const valueCell =
                /^\d{1,2}$/.test(cells[0]) && cells.length >= 3 ? cells[2] : cells[1];
            if (NEGATED_OR_MISSING_ROW_VALUE_REGEX.test(valueCell)) {
                continue;
            }

            const subjectAndValue =
                /^\d{1,2}$/.test(cells[0]) && cells.length >= 3
                    ? `${cells[1]}. ${cells[2]}`
                    : `${cells[0]}. ${cells[1]}`;
            candidateClauses.push(...subjectAndValue.split(/[.;]+/));
            continue;
        }

        candidateClauses.push(...line.split(/[.;]+/));
    }

    for (const clause of candidateClauses) {
        const cleanClause = clause.trim();
        if (!cleanClause) continue;

        SPECIALIZED_SUBSYSTEM_KEYWORDS_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = SPECIALIZED_SUBSYSTEM_KEYWORDS_REGEX.exec(cleanClause)) !== null) {
            const matchIdx = match.index;
            const tokenRaw = match[0];
            const prefix = cleanClause.slice(0, matchIdx);
            const suffix = cleanClause.slice(matchIdx + tokenRaw.length, matchIdx + tokenRaw.length + 48);

            if (POST_KEYWORD_NEGATION_REGEX.test(suffix)) {
                continue;
            }

            CLAUSE_NEGATION_CUE_REGEX.lastIndex = 0;
            let negMatch: RegExpExecArray | null;
            let lastNegEnd = -1;
            while ((negMatch = CLAUSE_NEGATION_CUE_REGEX.exec(prefix)) !== null) {
                lastNegEnd = negMatch.index + negMatch[0].length;
            }

            if (lastNegEnd >= 0) {
                const between = prefix.slice(lastNegEnd);
                if (!CLAUSE_AFFIRMATIVE_RESET_REGEX.test(between)) {
                    continue;
                }
            }

            confirmed.add(tokenRaw.toUpperCase().replace(/\s+/g, ' '));
        }
    }

    return Array.from(confirmed);
}

/**
 * Extrae determinísticamente los parámetros, subsistemas y magnitudes verificadas
 * desde el Markdown cazado de un ítem (`it.content`), priorizando filas de tablas técnicas
 * con cifras/unidades y subtítulos `###` para retroalimentar el itemizado de pilares derivados (`CAD-01`)
 * y el contexto de ítems hermanos (`CAD-03`), omitiendo filas "No aplica" o subsistemas negados.
 */
export function extractConfirmedSpecsSummaryFromMarkdown(
    markdown: string | undefined,
    maxChars = 320
): string {
    const raw = String(markdown || '').trim();
    if (raw.length < 30) return '';

    const lines = raw.split(/\r?\n/);
    const extractedSegments: string[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        // 1. Subtítulos de subsistemas (### Subsistema)
        if (/^#{2,4}\s+/.test(line)) {
            const heading = line
                .replace(/^#{2,4}\s+/, '')
                .replace(/\[sym:[^\]]+\]/gi, '')
                .trim();
            if (
                heading.length >= 4 &&
                heading.length <= 90 &&
                !/\b(?:directiva\s+de\s+c[aá]lculo|gesti[oó]n\s+de\s+autonom[ií]a|no\s+aplica|sin\s+sistema)\b/i.test(
                    heading
                )
            ) {
                extractedSegments.push(`[Subsistema: ${heading}]`);
            }
            continue;
        }

        // 2. Filas de tablas Markdown con datos técnicos reales (omitiendo "No aplica" / ausencias)
        if (line.startsWith('|') && line.endsWith('|') && !/^\|[\s:|-]+\|$/.test(line)) {
            const cells = line
                .split('|')
                .map((c) =>
                    c
                        .replace(/\[sym:[^\]]+\]/gi, '')
                        .replace(/\[F\d+\]/g, '')
                        .replace(/\*\*/g, '')
                        .trim()
                )
                .filter(Boolean);

            if (cells.length >= 2) {
                const col0 = cells[0].toUpperCase();
                if (
                    col0 === 'PARÁMETRO' ||
                    col0 === 'PARAMETRO' ||
                    col0.startsWith('PARÁMETRO /') ||
                    col0.startsWith('PARAMETRO /') ||
                    col0 === 'N°' ||
                    col0 === 'PASO' ||
                    col0 === 'COMPONENTE' ||
                    col0 === 'PELIGRO / ENERGÍA' ||
                    col0.startsWith('PELIGRO Y FUENTE') ||
                    col0 === 'PUNTO / COMPONENTE DE INSPECCIÓN' ||
                    col0.startsWith('---')
                ) {
                    continue;
                }

                const rawValueCell =
                    /^\d{1,2}$/.test(cells[0]) && cells.length >= 3 ? cells[2] : cells[1];
                if (NEGATED_OR_MISSING_ROW_VALUE_REGEX.test(rawValueCell)) {
                    continue;
                }

                const cleanValueCell = stripInlineNegativeParentheticals(rawValueCell);
                if (!cleanValueCell || NEGATED_OR_MISSING_ROW_VALUE_REGEX.test(cleanValueCell)) {
                    continue;
                }

                const paramLabel = cells[0].replace(/^\d{1,2}\s*$/, '').trim() || cells[1] || '';
                const valueCandidate =
                    cells[0].match(/^\d{1,2}$/) && cells.length >= 3
                        ? `${cells[1]}: ${cleanValueCell}`
                        : `${paramLabel}: ${cleanValueCell}`;
                const cleanedPair = valueCandidate.replace(/\s+/g, ' ').trim();
                if (
                    cleanedPair.length >= 6 &&
                    !/no declarad|pendiente de registro/i.test(cleanedPair)
                ) {
                    extractedSegments.push(cleanedPair);
                }
            }
        }
    }

    if (extractedSegments.length === 0) {
        const positiveSentences = raw
            .replace(/\[sym:[^\]]+\]/gi, '')
            .replace(/\[FIGURA_PENDIENTE:[^\]]+\]/gi, '')
            .split(/(?<=[.!?])\s+|\r?\n/)
            .map((s) => s.trim())
            .filter(
                (s) =>
                    s.length > 0 &&
                    !/\b(?:no\s+aplica|no\s+incurre\s+en\s+costos|directiva\s+de\s+c[aá]lculo|turno\s+est[aá]ndar\s+de\s+\d+\s*(?:a|-|–)\s*\d+\s*horas)\b/i.test(
                        s
                    )
            );
        return positiveSentences.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
    }

    const joined = extractedSegments.join(' ; ');
    return joined.length > maxChars ? `${joined.slice(0, maxChars - 1)}…` : joined;
}

