import type { StockpileAsset } from '../types/StockpileAsset';

export interface AssetCalculation {
    volume_m3: number;
    factor_applied: number;
    weight_t: number;
    confidence_level: number; // 0.0 to 1.0
    source: 'manual' | 'inference' | 'default';
}

export interface SuggestionIA {
    density: number;
    confidence: number;
    reasoning: string;
    texture_features?: Record<string, number>;
}

export class CalculationEngine {

    /**
     * Cálculo Manual: Cono Elíptico
     * Formula: (1/3) * PI * r1 * r2 * h
     * Recibe diámetros d1, d2 (Ejes totales)
     */
    public calculateEllipticCone(d1: number, d2: number, h: number): number {
        const r1 = d1 / 2;
        const r2 = d2 / 2;
        const areaBase = Math.PI * r1 * r2;
        return (1 / 3) * areaBase * h;
    }

    /**
     * Cálculo Manual: Cono Elíptico Truncado
     * Formula: (1/3) * h * (AreaBase + AreaTop + sqrt(AreaBase * AreaTop))
     * Recibe diámetros d1, d2, d1p, d2p (Ejes totales base y superior)
     */
    public calculateTruncatedEllipticCone(d1: number, d2: number, d1p: number, d2p: number, h: number): number {
        const r1 = d1 / 2;
        const r2 = d2 / 2;
        const r1p = d1p / 2;
        const r2p = d2p / 2;

        const areaBase = Math.PI * r1 * r2;
        const areaTop = Math.PI * r1p * r2p;

        return (1 / 3) * h * (areaBase + areaTop + Math.sqrt(areaBase * areaTop));
    }

    /**
     * Cálculo Manual: Cono Truncado con Perímetro
     * Formula: (1/3) * h * (AreaBase + AreaTop + sqrt(AreaBase * AreaTop))
     * R = P / 2PI, r = Pp / 2PI
     */
    public calculatePerimeterTruncatedCone(P: number, Pp: number, h: number): number {
        const R = P / (2 * Math.PI);
        const r = Pp / (2 * Math.PI);

        const areaBase = Math.PI * (R * R);
        const areaTop = Math.PI * (r * r);

        return (1 / 3) * h * (areaBase + areaTop + Math.sqrt(areaBase * areaTop));
    }

    /**
     * Lógica de Peso: P = V * D
     */
    public computeTotalMass(volume: number, density: number): number {
        return volume * density;
    }

    /**
     * Calcula el factor de densidad real basado en pesaje de romana
     * D = P / V
     */
    public computeRealTonnage(volume: number, realWeight: number): number {
        if (volume <= 0) return 0;
        return realWeight / volume;
    }

    /**
     * Compara tonelaje estimado vs real
     */
    public compareTonnage(estWeight: number, realWeight: number) {
        if (estWeight <= 0) return { differencePercent: 0, isWithinTolerance: true };
        const diff = Math.abs(estWeight - realWeight);
        const percent = (diff / estWeight) * 100;
        return {
            differencePercent: percent,
            isWithinTolerance: percent <= 5 // Tolerancia del 5%
        };
    }

    /**
     * Sugiere una calibración basada en el histórico de factores reales
     */
    public getSuggestedCalibration(history: { realFactor: number }[]): number | null {
        if (history.length === 0) return null;
        const sum = history.reduce((acc, curr) => acc + curr.realFactor, 0);
        return parseFloat((sum / history.length).toFixed(3));
    }

    /**
     * Prepara el objeto para entrenamiento de IA
     * Captura la relación: Foto (Features) -> Predicción -> Corrección Humana -> Resultado Físico
     */
    public prepareTrainingData(
        asset: Partial<StockpileAsset>,
        suggestion: SuggestionIA | null,
        finalDensity: number
    ): StockpileAsset['training_data'] {
        if (!suggestion) return undefined;

        // @ts-ignore - tipo_granulometria es compatible en runtime
        const applied = asset.tipo_granulometria as string;

        return {
            original_granulometry_prediction: suggestion.reasoning,
            applied_granulometry: applied,
            photo_texture_features: suggestion.texture_features,
            user_correction: Math.abs(suggestion.density - finalDensity) > 0.05
        };
    }
}

export const calculationEngine = new CalculationEngine();
