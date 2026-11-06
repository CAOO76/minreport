import { ResilientAIClient, Type } from '../../../core/resilient-ai-client';

/**
 * ASSET CONTEXT GENERATOR (R3 / R4 / R5)
 *
 * Genera dinámicamente:
 * 1. Campos de identidad física inmutable para alta en flota (`tenant_assets`):
 *    VIN/Patente/Horómetro en equipos mayores vs Código Interno/Nº Serie en herramientas.
 * 2. Perfil de ecosistema de consumibles y repuestos frecuentes OEM.
 * 3. Contexto fotográfico industrial limpio 1:1 para representación en catálogo.
 *
 * 100% libre de imports legacy (`core-sdk-shield`) y modelos inexistentes.
 */

export interface DynamicRegistrationField {
    key: string;
    label: string;
    placeholder: string;
    required: boolean;
    type: 'text' | 'number';
}

const FIELDS_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        fields: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    key: { type: Type.STRING },
                    label: { type: Type.STRING },
                    placeholder: { type: Type.STRING },
                    required: { type: Type.BOOLEAN },
                    type: { type: Type.STRING },
                },
                required: ['key', 'label', 'placeholder', 'required', 'type'],
            },
        },
    },
    required: ['fields'],
};

export async function generateRegistrationFields(
    makeModel: string,
    categoriaEquipo: string,
    tipoEquipo?: string
): Promise<DynamicRegistrationField[]> {
    const prompt = `Determina entre 2 y 4 campos estrictos de identificación física inmutable para dar de alta una unidad real en inventario de flota minera/industrial:
- Activo: "${makeModel}"
- Categoría: "${categoriaEquipo}"
- Tipo técnico: "${tipoEquipo || categoriaEquipo}"

REGLAS:
- Si es vehículo o maquinaria móvil autopropulsada con rodado: incluir Número de Serie / PIN (VIN), Código Interno de Flota, Horómetro Inicial y Patente (opcional si opera solo interior mina).
- Si es equipo estacionario o perforadora manual / herramienta industrial: incluir Código Interno de Inventario y Número de Serie de Fábrica (NUNCA pedir patente vehicular a una perforadora manual o esmeril).
- Máximo 4 campos concisos.`;

    try {
        const { data } = await ResilientAIClient.generateStructured<{ fields: DynamicRegistrationField[] }>({
            module: 'opermaq',
            preferredTier: 'ANCHOR_HA',
            temperature: 0.1,
            responseSchema: FIELDS_SCHEMA,
            prompt,
        });

        if (Array.isArray(data.fields) && data.fields.length >= 2) {
            return data.fields.slice(0, 4).map((f) => ({
                key: f.key,
                label: f.label,
                placeholder: f.placeholder,
                required: Boolean(f.required),
                type: f.type === 'number' ? 'number' : 'text',
            }));
        }
    } catch {
        // Fallback determinista según categoría
    }

    const lower = `${categoriaEquipo} ${tipoEquipo || ''}`.toLowerCase();
    const isHandTool = /manual|herramienta|instrumento|portatil|neumatic/.test(lower);

    if (isHandTool) {
        return [
            { key: 'internal_code', label: 'Código Interno Activo', placeholder: 'Ej. PERF-014', required: true, type: 'text' },
            { key: 'serial_number', label: 'Número de Serie OEM', placeholder: 'Ej. SN-884920', required: true, type: 'text' },
        ];
    }

    return [
        { key: 'internal_code', label: 'Código Interno de Flota', placeholder: 'Ej. MC-04', required: true, type: 'text' },
        { key: 'serial_number', label: 'Número de Serie / PIN (VIN)', placeholder: 'Ej. CAT0242DJDZT01234', required: true, type: 'text' },
        { key: 'horometer', label: 'Horómetro Actual (h)', placeholder: 'Ej. 1250', required: true, type: 'number' },
        { key: 'license_plate', label: 'Patente / Placa (Opcional)', placeholder: 'Ej. ABCD-12', required: false, type: 'text' },
    ];
}

