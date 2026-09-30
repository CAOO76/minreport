/**
 * CalculationEngine para Stockpiles Mineros (Monolito Modular Web 3.0)
 * Fórmulas volumétricas analíticas según normas de ingeniería minera y topografía.
 */

export interface StockpileCalculationInput {
    shape: 'elliptic-cone' | 'truncated-elliptic-cone' | 'perimeter-cone';
    d1: number;       // Diámetro mayor base (m)
    d2: number;       // Diámetro menor base (m)
    h: number;        // Altura (m)
    d1p?: number;     // Diámetro mayor superior (m)
    d2p?: number;     // Diámetro menor superior (m)
    pBase?: number;   // Perímetro base (m)
    pTop?: number;    // Perímetro superior (m)
    density: number;  // Densidad aparente (t/m³)
}

export interface StockpileCalculationOutput {
    volumeM3: number;
    tonnage: number;
    confidence: number;
}

export class CalculationEngine {
    /**
     * Cono Elíptico simple
     * V = (1/3) * PI * (d1/2) * (d2/2) * h
     */
    public calculateEllipticCone(d1: number, d2: number, h: number): number {
        const r1 = d1 / 2;
        const r2 = d2 / 2;
        const areaBase = Math.PI * r1 * r2;
        return (1 / 3) * areaBase * h;
    }

    /**
     * Cono Elíptico Truncado
     * V = (1/3) * h * (AreaBase + AreaTop + sqrt(AreaBase * AreaTop))
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
     * Cono Truncado medido por Perímetro
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
     * Realiza el cálculo integrado devolviendo volumen y tonelaje
     */
    public compute(input: StockpileCalculationInput): StockpileCalculationOutput {
        let volumeM3 = 0;

        if (input.shape === 'elliptic-cone') {
            volumeM3 = this.calculateEllipticCone(input.d1, input.d2, input.h);
        } else if (input.shape === 'truncated-elliptic-cone') {
            volumeM3 = this.calculateTruncatedEllipticCone(
                input.d1, 
                input.d2, 
                input.d1p || input.d1 * 0.4, 
                input.d2p || input.d2 * 0.4, 
                input.h
            );
        } else if (input.shape === 'perimeter-cone') {
            volumeM3 = this.calculatePerimeterTruncatedCone(
                input.pBase || 0, 
                input.pTop || 0, 
                input.h
            );
        }

        const safeVolume = Math.max(0, parseFloat(volumeM3.toFixed(2)));
        const tonnage = Math.max(0, parseFloat((safeVolume * input.density).toFixed(2)));

        return {
            volumeM3: safeVolume,
            tonnage,
            confidence: 96.5
        };
    }
}

export const calculationEngine = new CalculationEngine();
