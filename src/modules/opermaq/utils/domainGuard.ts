import { HITL_CONFIRM_KEYWORD } from '../types/vault.types';

/**
 * GUARDIA DE PERTINENCIA INDUSTRIAL Y NORMALIZACIÓN CANÓNICA — OPERMAQ
 */

export class DomainRejectionError extends Error {
    public readonly statusCode: number = 422;

    constructor(message: string) {
        super(message);
        this.name = 'DomainRejectionError';
    }
}

const FORBIDDEN_DOMESTIC_PATTERNS: RegExp[] = [
    /\b(cafetera|nespresso|microondas|refrigerador domestico|lavadora de ropa|televisor|consola|playstation|xbox|iphone|smartphone|juguete|perfume|zapatilla|silla gamer|colchon|aspiradora robot)\b/i,
];

export function validateIndustrialDomain(inputText: string, category?: string): void {
    const combined = `${inputText} ${category || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const regex of FORBIDDEN_DOMESTIC_PATTERNS) {
        if (regex.test(combined)) {
            throw new DomainRejectionError(
                `Rechazo de pertinencia industrial (HTTP 422): "${inputText.trim()}" corresponde a un artículo doméstico o de consumo ajeno a maquinaria, equipos e instrumentos mineros/industriales.`
            );
        }
    }
}

export function normalizeCatalogKey(make: string, model: string): string {
    const norm = (s: string) =>
        s
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');

    const cleanMake = norm(make || 'generico');
    const cleanModel = norm(model || 'equipo');
    return `${cleanMake}_${cleanModel}`;
}

export function isValidHitlConfirmation(keyword?: string): boolean {
    if (!keyword) return false;
    return keyword.trim().toUpperCase() === HITL_CONFIRM_KEYWORD;
}

