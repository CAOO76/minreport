export interface SpokenStockpileSpecs {
    baseMajorAxis?: string;
    baseMinorAxis?: string;
    totalHeight?: string;
    density?: string;
    classification?: 'COLPA' | 'GRANSA' | 'FINO';
}

function normalizeSpokenDecimal(raw?: string): string | undefined {
    if (!raw) return undefined;
    const cleaned = raw.replace(/,/g, '.').trim();
    const num = Number.parseFloat(cleaned);
    if (!Number.isFinite(num) || num <= 0) return undefined;
    return cleaned;
}

/**
 * Extrae determinísticamente cotas geométricas, densidad y clasificación granulométrica
 * desde dictado por voz en terreno (ES / EN / PT). Cero valores inventados cuando no hay coincidencia.
 */
export function parseSpokenStockpileSpecs(transcript: string): SpokenStockpileSpecs {
    if (!transcript || !transcript.trim()) return {};

    const normalized = transcript
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    const result: SpokenStockpileSpecs = {};

    const majorMatch = normalized.match(
        /(?:eje\s*mayor(?:\s*base)?|eixo\s*maior(?:\s*base)?|major\s*axis(?:\s*base)?|base\s*mayor|largo|length|comprimento)\s*(?:de|es|en|a|is|equals|=|:)?\s*(\d+(?:[.,]\d+)?)/i
    );
    const majorVal = normalizeSpokenDecimal(majorMatch?.[1]);
    if (majorVal) result.baseMajorAxis = majorVal;

    const minorMatch = normalized.match(
        /(?:eje\s*menor(?:\s*base)?|eixo\s*menor(?:\s*base)?|minor\s*axis(?:\s*base)?|base\s*menor|ancho|width|largura)\s*(?:de|es|en|a|is|equals|=|:)?\s*(\d+(?:[.,]\d+)?)/i
    );
    const minorVal = normalizeSpokenDecimal(minorMatch?.[1]);
    if (minorVal) result.baseMinorAxis = minorVal;

    const heightMatch = normalized.match(
        /(?:altura(?:\s*total)?|alto|height)\s*(?:de|es|en|a|is|equals|=|:)?\s*(\d+(?:[.,]\d+)?)/i
    );
    const heightVal = normalizeSpokenDecimal(heightMatch?.[1]);
    if (heightVal) result.totalHeight = heightVal;

    const densityMatch = normalized.match(
        /(?:factor\s*(?:de\s*)?densidad[ae]?|densidad[ae]?|density|factor)\s*(?:de|es|en|a|is|equals|=|:)?\s*(\d+(?:[.,]\d+)?)/i
    );
    const densityVal = normalizeSpokenDecimal(densityMatch?.[1]);
    if (densityVal) result.density = densityVal;

    if (/\b(?:colpas?|coarse)\b/i.test(normalized)) {
        result.classification = 'COLPA';
    } else if (/\b(?:gransas?|medium|granulado|granulated)\b/i.test(normalized)) {
        result.classification = 'GRANSA';
    } else if (/\b(?:fin[ao]s?|fine)\b/i.test(normalized)) {
        result.classification = 'FINO';
    }

    return result;
}
