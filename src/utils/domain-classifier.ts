/**
 * MINREPORT Domain Classifier (Web 3.0 Identity Standard)
 * 
 * Determina automáticamente la clasificación de cuenta y las restricciones
 * de licenciamiento industrial a partir del dominio del correo electrónico.
 */

export interface DomainClassificationResult {
    domain: string;
    classification: 'edu-academic' | 'b2b-corporate' | 'public';
    suggestedAccountType: 'EDUCATIONAL' | 'ENTERPRISE' | 'PERSONAL';
    isAcademic: boolean;
    isCorporate: boolean;
    isPublic: boolean;
    defaultLicensing: {
        maxUsers: number;
        allowInternalUsers: boolean;
        isCommercial: boolean;
        watermarkRequired: boolean;
    };
}

const PUBLIC_DOMAINS = new Set<string>([
    'gmail.com',
    'googlemail.com',
    'hotmail.com',
    'outlook.com',
    'yahoo.com',
    'yahoo.es',
    'live.com',
    'icloud.com',
    'msn.com',
    'aol.com',
    'proton.me',
    'protonmail.com'
]);

const ACADEMIC_DOMAINS_WHITELIST = new Set<string>([
    'uchile.cl',
    'puc.cl',
    'usm.cl',
    'uda.cl',
    'ucn.cl',
    'uantof.cl',
    'unap.cl',
    'usach.cl',
    'utalca.cl',
    'ubiobio.cl',
    'udec.cl',
    'ufrontera.cl',
    'unab.cl',
    'uss.cl',
    'uai.cl',
    'duoc.cl',
    'inacap.cl',
    'santotomas.cl',
    'aiep.cl'
]);

export function classifyEmailDomain(email: string): DomainClassificationResult {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const parts = normalizedEmail.split('@');
    const domain = parts.length === 2 ? parts[1].trim() : '';

    if (!domain) {
        return {
            domain: '',
            classification: 'public',
            suggestedAccountType: 'PERSONAL',
            isAcademic: false,
            isCorporate: false,
            isPublic: true,
            defaultLicensing: {
                maxUsers: 1,
                allowInternalUsers: false,
                isCommercial: false,
                watermarkRequired: true
            }
        };
    }

    // 1. Detección Académica
    const isAcademic = 
        domain.endsWith('.edu') ||
        domain.includes('.edu.') ||
        domain.includes('.ac.') ||
        ACADEMIC_DOMAINS_WHITELIST.has(domain);

    if (isAcademic) {
        return {
            domain,
            classification: 'edu-academic',
            suggestedAccountType: 'EDUCATIONAL',
            isAcademic: true,
            isCorporate: false,
            isPublic: false,
            defaultLicensing: {
                maxUsers: 1, // Silla única estricta para cuentas EDU
                allowInternalUsers: false,
                isCommercial: false,
                watermarkRequired: true
            }
        };
    }

    // 2. Detección Dominios Públicos
    const isPublic = PUBLIC_DOMAINS.has(domain);
    if (isPublic) {
        return {
            domain,
            classification: 'public',
            suggestedAccountType: 'PERSONAL',
            isAcademic: false,
            isCorporate: false,
            isPublic: true,
            defaultLicensing: {
                maxUsers: 1,
                allowInternalUsers: false,
                isCommercial: false,
                watermarkRequired: true
            }
        };
    }

    // 3. Dominio Corporativo B2B por descarte calificado
    return {
        domain,
        classification: 'b2b-corporate',
        suggestedAccountType: 'ENTERPRISE',
        isAcademic: false,
        isCorporate: true,
        isPublic: false,
        defaultLicensing: {
            maxUsers: 50,
            allowInternalUsers: true,
            isCommercial: true,
            watermarkRequired: false
        }
    };
}
