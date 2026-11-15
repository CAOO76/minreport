/**
 * Validador y normalizador modular de Identificadores Tributarios Multi-País y Teléfonos E.164.
 * Soporta validación criptográfica/algorítmica nativa para:
 * - CL: RUT / RUN chileno (Módulo-11)
 * - PE: RUC peruano SUNAT (11 dígitos, Módulo-11)
 * - BR: CNPJ (14 dígitos) y CPF (11 dígitos) brasileños (Doble Módulo-11)
 * - AR: CUIT / CUIL argentino AFIP (11 dígitos, Módulo-11)
 * - Internacional (US, AU, CA, EU y códigos ISO-2): patrón alfanumérico estricto `[A-Z0-9-]{5,20}`
 * - Teléfono global ITU-T E.164: `+[1-9]\d{6,14}`
 */

export type TaxIdScheme =
    | 'CL_RUT'
    | 'PE_RUC'
    | 'BR_CNPJ'
    | 'BR_CPF'
    | 'AR_CUIT'
    | 'INTL_TAX_ID';

export interface TaxIdValidationResult {
    valid: boolean;
    countryCode: string;
    scheme: TaxIdScheme;
    normalized: string;
    formatted: string;
    reason?: string;
}

export interface E164PhoneValidationResult {
    valid: boolean;
    normalized: string;
    reason?: string;
}

const SUNAT_VALID_PREFIXES = new Set(['10', '15', '16', '17', '20']);
const AFIP_VALID_PREFIXES = new Set(['20', '23', '24', '27', '30', '33', '34']);

/**
 * Valida RUT / RUN chileno (Módulo-11).
 */
export function validateChileanRut(rawInput: string): TaxIdValidationResult {
    const cleaned = String(rawInput || '')
        .replace(/[\s.-]/g, '')
        .toUpperCase();

    if (!/^\d{7,8}[0-9K]$/.test(cleaned)) {
        return {
            valid: false,
            countryCode: 'CL',
            scheme: 'CL_RUT',
            normalized: cleaned,
            formatted: cleaned,
            reason: 'Formato RUT chileno inválido (se esperan 7-8 dígitos + dígito verificador).',
        };
    }

    const body = cleaned.slice(0, -1);
    const dv = cleaned.slice(-1);

    if (/^(\d)\1+$/.test(body)) {
        return {
            valid: false,
            countryCode: 'CL',
            scheme: 'CL_RUT',
            normalized: `${body}-${dv}`,
            formatted: `${body}-${dv}`,
            reason: 'RUT con dígitos repetidos triviales rechazado.',
        };
    }

    let sum = 0;
    let factor = 2;
    for (let i = body.length - 1; i >= 0; i--) {
        sum += Number(body[i]) * factor;
        factor = factor === 7 ? 2 : factor + 1;
    }
    const remainder = 11 - (sum % 11);
    const expectedDv = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);

    const formattedBody = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const normalized = `${body}-${dv}`;
    const formatted = `${formattedBody}-${dv}`;

    if (dv !== expectedDv) {
        return {
            valid: false,
            countryCode: 'CL',
            scheme: 'CL_RUT',
            normalized,
            formatted,
            reason: 'Dígito verificador Módulo-11 inválido para RUT chileno.',
        };
    }

    return {
        valid: true,
        countryCode: 'CL',
        scheme: 'CL_RUT',
        normalized,
        formatted,
    };
}

/**
 * Valida RUC peruano SUNAT de 11 dígitos (prefijos 10, 15, 16, 17, 20 + Módulo-11).
 */
export function validatePeruvianRuc(rawInput: string): TaxIdValidationResult {
    const cleaned = String(rawInput || '').replace(/[\s.-]/g, '');

    if (!/^\d{11}$/.test(cleaned)) {
        return {
            valid: false,
            countryCode: 'PE',
            scheme: 'PE_RUC',
            normalized: cleaned,
            formatted: cleaned,
            reason: 'RUC peruano debe contener exactamente 11 dígitos numéricos.',
        };
    }

    const prefix = cleaned.slice(0, 2);
    if (!SUNAT_VALID_PREFIXES.has(prefix)) {
        return {
            valid: false,
            countryCode: 'PE',
            scheme: 'PE_RUC',
            normalized: cleaned,
            formatted: cleaned,
            reason: 'Prefijo SUNAT inválido para RUC peruano.',
        };
    }

    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += Number(cleaned[i]) * weights[i];
    }
    const complement = 11 - (sum % 11);
    const expectedDv = complement === 10 ? 0 : complement === 11 ? 1 : complement;
    const actualDv = Number(cleaned[10]);

    if (actualDv !== expectedDv) {
        return {
            valid: false,
            countryCode: 'PE',
            scheme: 'PE_RUC',
            normalized: cleaned,
            formatted: cleaned,
            reason: 'Dígito verificador SUNAT Módulo-11 inválido.',
        };
    }

    return {
        valid: true,
        countryCode: 'PE',
        scheme: 'PE_RUC',
        normalized: cleaned,
        formatted: cleaned,
    };
}

/**
 * Valida CNPJ (14 dígitos) o CPF (11 dígitos) de Brasil mediante doble Módulo-11.
 */
export function validateBrazilianTaxId(rawInput: string): TaxIdValidationResult {
    const cleaned = String(rawInput || '').replace(/[\s./-]/g, '');

    if (/^\d{14}$/.test(cleaned)) {
        if (/^(\d)\1{13}$/.test(cleaned)) {
            return {
                valid: false,
                countryCode: 'BR',
                scheme: 'BR_CNPJ',
                normalized: cleaned,
                formatted: cleaned,
                reason: 'CNPJ con secuencia repetida trivial rechazado.',
            };
        }

        const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

        let sum1 = 0;
        for (let i = 0; i < 12; i++) sum1 += Number(cleaned[i]) * w1[i];
        const rem1 = sum1 % 11;
        const dv1 = rem1 < 2 ? 0 : 11 - rem1;

        let sum2 = 0;
        for (let i = 0; i < 13; i++) sum2 += Number(cleaned[i]) * w2[i];
        const rem2 = sum2 % 11;
        const dv2 = rem2 < 2 ? 0 : 11 - rem2;

        const formatted = `${cleaned.slice(0, 2)}.${cleaned.slice(2, 5)}.${cleaned.slice(5, 8)}/${cleaned.slice(8, 12)}-${cleaned.slice(12, 14)}`;

        if (Number(cleaned[12]) !== dv1 || Number(cleaned[13]) !== dv2) {
            return {
                valid: false,
                countryCode: 'BR',
                scheme: 'BR_CNPJ',
                normalized: cleaned,
                formatted,
                reason: 'Dígitos verificadores de CNPJ brasileño inválidos.',
            };
        }

        return {
            valid: true,
            countryCode: 'BR',
            scheme: 'BR_CNPJ',
            normalized: cleaned,
            formatted,
        };
    }

    if (/^\d{11}$/.test(cleaned)) {
        if (/^(\d)\1{10}$/.test(cleaned)) {
            return {
                valid: false,
                countryCode: 'BR',
                scheme: 'BR_CPF',
                normalized: cleaned,
                formatted: cleaned,
                reason: 'CPF con secuencia repetida trivial rechazado.',
            };
        }

        let sum1 = 0;
        for (let i = 0; i < 9; i++) sum1 += Number(cleaned[i]) * (10 - i);
        const rem1 = sum1 % 11;
        const dv1 = rem1 < 2 ? 0 : 11 - rem1;

        let sum2 = 0;
        for (let i = 0; i < 10; i++) sum2 += Number(cleaned[i]) * (11 - i);
        const rem2 = sum2 % 11;
        const dv2 = rem2 < 2 ? 0 : 11 - rem2;

        const formatted = `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6, 9)}-${cleaned.slice(9, 11)}`;

        if (Number(cleaned[9]) !== dv1 || Number(cleaned[10]) !== dv2) {
            return {
                valid: false,
                countryCode: 'BR',
                scheme: 'BR_CPF',
                normalized: cleaned,
                formatted,
                reason: 'Dígitos verificadores de CPF brasileño inválidos.',
            };
        }

        return {
            valid: true,
            countryCode: 'BR',
            scheme: 'BR_CPF',
            normalized: cleaned,
            formatted,
        };
    }

    return {
        valid: false,
        countryCode: 'BR',
        scheme: 'BR_CNPJ',
        normalized: cleaned,
        formatted: cleaned,
        reason: 'Identificador tributario brasileño debe tener 14 dígitos (CNPJ) u 11 dígitos (CPF).',
    };
}

/**
 * Valida CUIT / CUIL argentino de 11 dígitos (Módulo-11 AFIP).
 */
export function validateArgentineCuit(rawInput: string): TaxIdValidationResult {
    const cleaned = String(rawInput || '').replace(/[\s.-]/g, '');

    if (!/^\d{11}$/.test(cleaned)) {
        return {
            valid: false,
            countryCode: 'AR',
            scheme: 'AR_CUIT',
            normalized: cleaned,
            formatted: cleaned,
            reason: 'CUIT/CUIL argentino debe contener exactamente 11 dígitos.',
        };
    }

    const prefix = cleaned.slice(0, 2);
    if (!AFIP_VALID_PREFIXES.has(prefix)) {
        return {
            valid: false,
            countryCode: 'AR',
            scheme: 'AR_CUIT',
            normalized: cleaned,
            formatted: cleaned,
            reason: 'Prefijo AFIP inválido para CUIT/CUIL argentino.',
        };
    }

    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += Number(cleaned[i]) * weights[i];
    }
    const mod = sum % 11;
    const actualDv = Number(cleaned[10]);
    const formatted = `${cleaned.slice(0, 2)}-${cleaned.slice(2, 10)}-${cleaned.slice(10)}`;

    let isValidDv = false;
    if (mod === 0) {
        isValidDv = actualDv === 0;
    } else if (mod === 1) {
        isValidDv = (prefix === '23' || prefix === '33') && (actualDv === 9 || actualDv === 4);
    } else {
        isValidDv = actualDv === 11 - mod;
    }

    if (!isValidDv) {
        return {
            valid: false,
            countryCode: 'AR',
            scheme: 'AR_CUIT',
            normalized: cleaned,
            formatted,
            reason: 'Dígito verificador Módulo-11 AFIP inválido para CUIT/CUIL.',
        };
    }

    return {
        valid: true,
        countryCode: 'AR',
        scheme: 'AR_CUIT',
        normalized: formatted,
        formatted,
    };
}

/**
 * Fallback internacional estricto (`US` EIN, `AU` ABN, `CA` BN, `EU` VAT, etc.): `[A-Z0-9-]{5,20}`.
 */
export function validateInternationalTaxId(rawInput: string, countryCode: string): TaxIdValidationResult {
    const code = String(countryCode || 'INTL')
        .trim()
        .toUpperCase();
    const cleaned = String(rawInput || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');

    const alnumCount = cleaned.replace(/-/g, '').length;
    const isPatternValid =
        /^[A-Z0-9-]{5,20}$/.test(cleaned) &&
        !cleaned.startsWith('-') &&
        !cleaned.endsWith('-') &&
        !cleaned.includes('--') &&
        alnumCount >= 5;

    if (!isPatternValid) {
        return {
            valid: false,
            countryCode: code,
            scheme: 'INTL_TAX_ID',
            normalized: cleaned,
            formatted: cleaned,
            reason: 'Identificador tributario internacional fuera de formato [A-Z0-9-]{5,20}.',
        };
    }

    return {
        valid: true,
        countryCode: code,
        scheme: 'INTL_TAX_ID',
        normalized: cleaned,
        formatted: cleaned,
    };
}

/**
 * Despachador modular de validación tributaria según `countryCode` (default `'CL'`).
 */
export function validateTaxId(rawInput: string, countryCode: string = 'CL'): TaxIdValidationResult {
    const iso = String(countryCode || 'CL')
        .trim()
        .toUpperCase();

    switch (iso) {
        case 'CL':
        case 'CHL':
            return validateChileanRut(rawInput);
        case 'PE':
        case 'PER':
            return validatePeruvianRuc(rawInput);
        case 'BR':
        case 'BRA':
            return validateBrazilianTaxId(rawInput);
        case 'AR':
        case 'ARG':
            return validateArgentineCuit(rawInput);
        default:
            return validateInternationalTaxId(rawInput, iso);
    }
}

export function normalizeTaxId(rawInput: string, countryCode: string = 'CL'): string | null {
    const res = validateTaxId(rawInput, countryCode);
    return res.valid ? res.normalized : null;
}

/**
 * Normaliza y valida teléfonos internacionales bajo el estándar ITU-T E.164 (`+[1-9]\d{6,14}`).
 */
export function normalizeE164Phone(rawPhone: string): string {
    const trimmed = String(rawPhone || '').trim();
    if (!trimmed) return '';
    const hasPlus = trimmed.startsWith('+') || trimmed.startsWith('00');
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (!digitsOnly) return '';
    if (trimmed.startsWith('00')) {
        return `+${digitsOnly.slice(2)}`;
    }
    return hasPlus ? `+${digitsOnly}` : `+${digitsOnly}`;
}

export function validateE164Phone(rawPhone: string): E164PhoneValidationResult {
    const rawTrimmed = String(rawPhone || '').trim();
    if (!rawTrimmed.startsWith('+')) {
        return {
            valid: false,
            normalized: normalizeE164Phone(rawTrimmed),
            reason: 'Teléfono E.164 debe iniciar explícitamente con prefijo internacional "+".',
        };
    }
    const normalized = `+${rawTrimmed.slice(1).replace(/[\s().-]/g, '')}`;
    if (!/^\+[1-9]\d{6,14}$/.test(normalized)) {
        return {
            valid: false,
            normalized,
            reason: 'Formato ITU-T E.164 inválido (se requiere +[1-9] seguido de 6 a 14 dígitos).',
        };
    }
    return {
        valid: true,
        normalized,
    };
}
