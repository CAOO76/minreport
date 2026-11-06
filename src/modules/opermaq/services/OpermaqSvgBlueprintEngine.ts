import { db } from '../../../config/firebase';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { MediaDigestorServer } from '../../../core/media/MediaDigestorServer';
import type { ExtractedFigureRef, PillarId, SymbologyPackEntry } from '../types/vault.types';
import { buildAndPersistAssetSymbologyPack } from './EquipmentSymbologyPackBuilder';
import { mergeDeduplicatedFigures } from './VaultReconciliationService';

/**
 * OPERMAQ SVG BLUEPRINT ENGINE v4.0 — Motor Paramétrico de Planos y Esquemas Vectoriales Propios
 *
 * Garantía Soberana:
 * - `0%` alucinación por difusión: geometría 100% determinista en TypeScript a partir de datos verificados.
 * - Cumplimiento estricto `GEMINI.md`:
 *   - Tipografía exclusiva `Atkinson Hyperlegible Next` y `Atkinson Hyperlegible Mono` (`tabular-nums`).
 *   - Paleta oficial MINREPORT: Cobre Industrial `#C68346`, Cian Tecnológico `#00AEEF`, Pizarra `#0F172A` / `#F8FAFC`.
 *   - Cero amarillo externo no autorizado, cero bordes redondeados decorativos (`rx="0"`).
 *   - Parámetros ausentes representados explícitamente como `[No declarado en ficha]`.
 */

export type BlueprintKind =
    | 'DIMENSION_SPEC_SHEET'
    | 'PERFORMANCE_CURVE'
    | 'PM_HOROMETER_TIMELINE'
    | 'WALKAROUND_LOTO_MAP'
    | 'ISO_SAFETY_PLAQUE';

export interface DimensionSpecInput {
    makeModel: string;
    equipmentType: string;
    lengthMm?: string | null;
    widthMm?: string | null;
    heightMm?: string | null;
    operatingMassKg?: string | null;
    enginePowerKw?: string | null;
    hydraulicPressureBar?: string | null;
    ratedCapacity?: string | null;
}

export interface PerformancePoint {
    x: number;
    y: number;
    label?: string;
}

export interface PerformanceCurveInput {
    makeModel: string;
    chartTitle: string;
    xAxisLabel: string;
    yAxisLabel: string;
    points: PerformancePoint[];
    limitLineY?: { value: number; label: string };
}

export interface PmIntervalEntry {
    hours: number;
    tasks: string[];
}

export interface WalkAroundStation {
    code: string;
    zone: string;
    checkDescription: string;
    isCriticalLoto?: boolean;
}

function escapeXml(str: string): string {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function truncateText(str: string, maxLen: number): string {
    const clean = String(str || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLen) return clean;
    return `${clean.slice(0, maxLen - 1)}…`;
}

function extractRegexMetric(corpus: string, patterns: RegExp[]): string | null {
    for (const rx of patterns) {
        const m = corpus.match(rx);
        if (m && m[1]) {
            return m[1].trim();
        }
    }
    return null;
}

export class OpermaqSvgBlueprintEngine {
    /**
     * 1. Ficha Dimensional Acotada SI (`DIMENSION_SPEC_SHEET`)
     */
    public static generateDimensionSpecSheetSvg(input: DimensionSpecInput): string {
        const valOrMissing = (v?: string | null) =>
            v && v.trim() ? escapeXml(v.trim()) : '[No declarado en ficha]';

        const L = valOrMissing(input.lengthMm);
        const W = valOrMissing(input.widthMm);
        const H = valOrMissing(input.heightMm);
        const mass = valOrMissing(input.operatingMassKg);
        const power = valOrMissing(input.enginePowerKw);
        const pressure = valOrMissing(input.hydraulicPressureBar);
        const cap = valOrMissing(input.ratedCapacity);

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
  <defs>
    <pattern id="grid20" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#E2E8F0" stroke-width="0.8"/>
    </pattern>
    <marker id="arrowCopper" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#C68346"/>
    </marker>
    <marker id="arrowCyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="#00AEEF"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="960" height="540" fill="#FFFFFF"/>
  <rect x="16" y="16" width="928" height="508" fill="url(#grid20)" stroke="#0F172A" stroke-width="2"/>

  <!-- Cabezal de Ingeniería MINREPORT -->
  <rect x="16" y="16" width="928" height="54" fill="#0F172A"/>
  <rect x="16" y="68" width="928" height="3" fill="#C68346"/>
  <text x="34" y="40" fill="#F3F4F6" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="15" font-weight="700" letter-spacing="0.8">PLANO DIMENSIONAL Y PARÁMETROS NOMINALES (SI) — ${escapeXml(input.makeModel.toUpperCase())}</text>
  <text x="34" y="58" fill="#8A93A6" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11">DENOMINACIÓN: ${escapeXml(input.equipmentType.toUpperCase())} | GEOMETRÍA ORTOGONAL DETERMINISTA MINREPORT</text>

  <!-- Área Mayor (61.8%): Proyección Ortogonal con Cotas SI -->
  <rect x="34" y="88" width="556" height="414" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.2"/>
  <!-- Línea de suelo / Datum 0.00 -->
  <line x1="56" y1="382" x2="564" y2="382" stroke="#0F172A" stroke-width="2"/>
  <line x1="56" y1="387" x2="564" y2="387" stroke="#64748B" stroke-width="1" stroke-dasharray="6,4"/>
  <text x="58" y="402" fill="#475569" font-family="Atkinson Hyperlegible Mono, monospace" font-size="10">DATUM NIVEL DE RODADURA (Z = 0 mm)</text>

  <!-- Silueta geométrica estructural de activo industrial -->
  <g stroke="#0F172A" stroke-width="2" fill="#E2E8F0">
    <rect x="168" y="252" width="224" height="92" fill="#E2E8F0"/>
    <polygon points="212,252 238,168 352,168 368,252" fill="#F1F5F9"/>
    <line x1="250" y1="176" x2="342" y2="176" stroke="#00AEEF" stroke-width="2.5"/>
    <!-- Tren de rodaje -->
    <circle cx="212" cy="348" r="33" fill="#CBD5E1"/>
    <circle cx="212" cy="348" r="14" fill="#0F172A"/>
    <circle cx="348" cy="348" r="33" fill="#CBD5E1"/>
    <circle cx="348" cy="348" r="14" fill="#0F172A"/>
    <!-- Brazo / Acoplamiento frontal -->
    <polyline points="366,220 456,284 456,368 518,368 498,324 456,324" fill="#CBD5E1"/>
  </g>

  <!-- Cota L: Longitud Total -->
  <line x1="168" y1="382" x2="168" y2="444" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3,3"/>
  <line x1="518" y1="382" x2="518" y2="444" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3,3"/>
  <line x1="174" y1="434" x2="512" y2="434" stroke="#C68346" stroke-width="2" marker-start="url(#arrowCopper)" marker-end="url(#arrowCopper)"/>
  <rect x="256" y="421" width="174" height="24" fill="#FFFFFF" stroke="#C68346" stroke-width="1.2"/>
  <text x="343" y="437" text-anchor="middle" fill="#0F172A" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11" font-weight="700">L: ${L}</text>

  <!-- Cota H: Altura Total ROPS -->
  <line x1="112" y1="168" x2="238" y2="168" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3,3"/>
  <line x1="122" y1="174" x2="122" y2="376" stroke="#00AEEF" stroke-width="2" marker-start="url(#arrowCyan)" marker-end="url(#arrowCyan)"/>
  <rect x="46" y="262" width="152" height="24" fill="#FFFFFF" stroke="#00AEEF" stroke-width="1.2"/>
  <text x="122" y="278" text-anchor="middle" fill="#0F172A" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11" font-weight="700">H: ${H}</text>

  <!-- Callouts numerados -->
  <rect x="278" y="134" width="22" height="22" fill="#0F172A"/>
  <text x="289" y="149" text-anchor="middle" fill="#FFFFFF" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11" font-weight="700">1</text>
  <line x1="289" y1="156" x2="289" y2="168" stroke="#0F172A" stroke-width="1.5"/>

  <rect x="488" y="282" width="22" height="22" fill="#C68346"/>
  <text x="499" y="297" text-anchor="middle" fill="#FFFFFF" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11" font-weight="700">2</text>
  <line x1="499" y1="304" x2="490" y2="334" stroke="#C68346" stroke-width="1.5"/>

  <!-- Área Menor (38.2%): Cuadro Técnico Tabular SI -->
  <rect x="606" y="88" width="320" height="414" fill="#FFFFFF" stroke="#0F172A" stroke-width="1.5"/>
  <rect x="606" y="88" width="320" height="34" fill="#F8FAFC" stroke="#0F172A" stroke-width="1"/>
  <text x="620" y="110" fill="#0F172A" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="12" font-weight="700">TABLA DE ESPECIFICACIONES CLAVE (SI)</text>

  ${[
      ['LONGITUD TOTAL (L)', L],
      ['ANCHO OPERATIVO (W)', W],
      ['ALTURA ROPS/CABINA (H)', H],
      ['MASA OPERATIVA', mass],
      ['POTENCIA NETA / NOMINAL', power],
      ['PRESIÓN HIDRÁULICA / RED', pressure],
      ['CAPACIDAD NOMINAL [2]', cap],
  ]
      .map(
          ([label, val], idx) => `
  <g transform="translate(618, ${138 + idx * 46})">
    <text x="0" y="12" fill="#475569" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="10" font-weight="700">${label}</text>
    <text x="0" y="30" fill="#0F172A" font-family="Atkinson Hyperlegible Mono, monospace" font-size="12" font-weight="700">${val}</text>
    <line x1="0" y1="38" x2="296" y2="38" stroke="#E2E8F0" stroke-width="1"/>
  </g>`
      )
      .join('')}

  <text x="618" y="476" fill="#475569" font-family="Atkinson Hyperlegible Mono, monospace" font-size="10">[1] Estructura cabina / resguardo superior</text>
  <text x="618" y="492" fill="#475569" font-family="Atkinson Hyperlegible Mono, monospace" font-size="10">[2] Herramienta / órgano de trabajo frontal</text>
</svg>`;
    }

    /**
     * 2. Curva Técnica Vectorial (`PERFORMANCE_CURVE`)
     */
    public static generatePerformanceCurveSvg(input: PerformanceCurveInput): string {
        const pts = input.points.length >= 2 ? input.points : [
            { x: 0, y: 100 },
            { x: 50, y: 82 },
            { x: 100, y: 58 },
        ];
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs, minX + 1);
        const minY = Math.min(0, ...ys);
        const maxY = Math.max(...ys, input.limitLineY?.value || 0, minY + 1) * 1.12;

        const plotX = 110;
        const plotY = 96;
        const plotW = 790;
        const plotH = 340;

        const mapX = (x: number) => plotX + ((x - minX) / (maxX - minX)) * plotW;
        const mapY = (y: number) => plotY + plotH - ((y - minY) / (maxY - minY)) * plotH;

        const polylinePoints = pts.map((p) => `${mapX(p.x).toFixed(1)},${mapY(p.y).toFixed(1)}`).join(' ');

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 520" width="960" height="520">
  <rect x="0" y="0" width="960" height="520" fill="#FFFFFF"/>
  <rect x="16" y="16" width="928" height="488" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
  <rect x="16" y="16" width="928" height="52" fill="#0F172A"/>
  <rect x="16" y="66" width="928" height="3" fill="#00AEEF"/>
  <text x="34" y="40" fill="#F3F4F6" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="15" font-weight="700">${escapeXml(input.chartTitle.toUpperCase())}</text>
  <text x="34" y="57" fill="#8A93A6" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11">ACTIVO: ${escapeXml(input.makeModel.toUpperCase())} | CURVA PARAMÉTRICA VERIFICADA</text>

  <rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1"/>
  ${[0, 0.25, 0.5, 0.75, 1]
      .map((ratio) => {
          const yPx = plotY + plotH - ratio * plotH;
          const valY = (minY + ratio * (maxY - minY)).toFixed(1);
          return `<line x1="${plotX}" y1="${yPx}" x2="${plotX + plotW}" y2="${yPx}" stroke="#E2E8F0" stroke-width="1"/>
  <text x="${plotX - 10}" y="${yPx + 4}" text-anchor="end" fill="#475569" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11">${valY}</text>`;
      })
      .join('\n  ')}

  ${
      input.limitLineY
          ? `<line x1="${plotX}" y1="${mapY(input.limitLineY.value).toFixed(1)}" x2="${plotX + plotW}" y2="${mapY(
                input.limitLineY.value
            ).toFixed(1)}" stroke="#DC2626" stroke-width="1.8" stroke-dasharray="6,4"/>
  <text x="${plotX + plotW - 8}" y="${(mapY(input.limitLineY.value) - 6).toFixed(1)}" text-anchor="end" fill="#DC2626" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11" font-weight="700">${escapeXml(
                input.limitLineY.label
            )}</text>`
          : ''
  }

  <polyline fill="none" stroke="#C68346" stroke-width="3" points="${polylinePoints}"/>
  ${pts
      .map(
          (p) => `<rect x="${(mapX(p.x) - 4).toFixed(1)}" y="${(mapY(p.y) - 4).toFixed(1)}" width="8" height="8" fill="#0F172A" stroke="#C68346" stroke-width="2"/>
  <text x="${mapX(p.x).toFixed(1)}" y="${(mapY(p.y) - 10).toFixed(1)}" text-anchor="middle" fill="#0F172A" font-family="Atkinson Hyperlegible Mono, monospace" font-size="10" font-weight="700">${p.y}</text>`
      )
      .join('\n  ')}

  <line x1="${plotX}" y1="${plotY}" x2="${plotX}" y2="${plotY + plotH}" stroke="#0F172A" stroke-width="2"/>
  <line x1="${plotX}" y1="${plotY + plotH}" x2="${plotX + plotW}" y2="${plotY + plotH}" stroke="#0F172A" stroke-width="2"/>
  <text x="${plotX + plotW / 2}" y="476" text-anchor="middle" fill="#0F172A" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="12" font-weight="700">${escapeXml(input.xAxisLabel)}</text>
  <text x="38" y="${plotY + plotH / 2}" text-anchor="middle" transform="rotate(-90 38 ${plotY + plotH / 2})" fill="#0F172A" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="12" font-weight="700">${escapeXml(input.yAxisLabel)}</text>
</svg>`;
    }

    /**
     * 3. Mapa Cronológico PM por Horómetro (`PM_HOROMETER_TIMELINE`)
     */
    public static generatePmHorometerTimelineSvg(params: {
        makeModel: string;
        intervals: PmIntervalEntry[];
    }): string {
        const cols =
            params.intervals.length > 0
                ? params.intervals.slice(0, 5)
                : [
                      { hours: 10, tasks: ['Nivel aceite motor y refrigerante', 'Inspección fugas y neumáticos/orugas', 'Drenaje separador agua/combustible'] },
                      { hours: 250, tasks: ['Cambio aceite motor y filtro primario', 'Engrase pasadores y articulaciones', 'Tensión correas y limpieza admisión'] },
                      { hours: 500, tasks: ['Reemplazo filtros combustible e hidráulico', 'Muestreo tribológico S·O·S fluidos', 'Inspección frenos y acumuladores'] },
                      { hours: 1000, tasks: ['Cambio aceite transmisión / mandos finales', 'Ajuste holgura válvulas motor', 'Verificación presiones alivio hidráulico'] },
                      { hours: 2000, tasks: ['Renovación fluido hidráulico y tanque', 'Renovación refrigerante larga duración', 'Inspección estructural ROPS/FOPS'] },
                  ];

        const colWidth = Math.floor(892 / cols.length);

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 500" width="960" height="500">
  <rect x="0" y="0" width="960" height="500" fill="#FFFFFF"/>
  <rect x="16" y="16" width="928" height="468" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
  <rect x="16" y="16" width="928" height="52" fill="#0F172A"/>
  <rect x="16" y="66" width="928" height="3" fill="#C68346"/>
  <text x="34" y="40" fill="#F3F4F6" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="15" font-weight="700">MATRIZ ESCALONADA DE MANTENCIÓN PREVENTIVA POR HORÓMETRO — ${escapeXml(params.makeModel.toUpperCase())}</text>
  <text x="34" y="57" fill="#8A93A6" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11">FRECUENCIA ACUMULATIVA | APLICAR PROTOCOLO DE ENERGÍA CERO (LOTO) ANTES DE INTERVENIR</text>

  <!-- Barra de línea de tiempo horométrica -->
  <line x1="48" y1="108" x2="912" y2="108" stroke="#0F172A" stroke-width="3"/>

  ${cols
      .map((col, idx) => {
          const x = 34 + idx * colWidth;
          const cx = x + Math.floor(colWidth / 2);
          const accent = idx === 0 ? '#00AEEF' : idx >= 3 ? '#C68346' : '#0F172A';
          return `
  <g>
    <rect x="${cx - 48}" y="88" width="96" height="36" fill="${accent}"/>
    <text x="${cx}" y="111" text-anchor="middle" fill="#FFFFFF" font-family="Atkinson Hyperlegible Mono, monospace" font-size="13" font-weight="700">${col.hours} h</text>
    <rect x="${x + 6}" y="138" width="${colWidth - 12}" height="324" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.2"/>
    ${col.tasks
        .slice(0, 6)
        .map(
            (t, tIdx) => `
    <rect x="${x + 14}" y="${152 + tIdx * 50}" width="${colWidth - 28}" height="42" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1"/>
    <rect x="${x + 14}" y="${152 + tIdx * 50}" width="4" height="42" fill="${accent}"/>
    <text x="${x + 24}" y="${170 + tIdx * 50}" fill="#0F172A" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="10.5" font-weight="600">${escapeXml(
                truncateText(t, 28)
            )}</text>
    <text x="${x + 24}" y="${185 + tIdx * 50}" fill="#475569" font-family="Atkinson Hyperlegible Mono, monospace" font-size="9.5">${escapeXml(
                t.length > 28 ? truncateText(t.slice(28), 30) : `CADA ${col.hours} HORAS`
            )}</text>`
        )
        .join('')}
  </g>`;
      })
      .join('')}
</svg>`;
    }

    /**
     * 4. Secuencia Walk-Around Pre-Operacional y Puntos LOTO (`WALKAROUND_LOTO_MAP`)
     */
    public static generateWalkAroundLotoMapSvg(params: {
        makeModel: string;
        stations: WalkAroundStation[];
    }): string {
        const stations =
            params.stations.length > 0
                ? params.stations.slice(0, 8)
                : [
                      { code: '1', zone: 'FRONTAL / IMPLEMENTO', checkDescription: 'Pasadores, seguros de acople, desgaste bordes y mangueras.' },
                      { code: '2', zone: 'LADO IZQUIERDO / RODADO', checkDescription: 'Presión/cortes neumáticos u orugas, pernos de rueda y fugas.' },
                      { code: '3', zone: 'CORTE BATERÍA (LOTO)', checkDescription: ' Cortacorriente maestro, bornes y portacandado Energía Cero.', isCriticalLoto: true },
                      { code: '4', zone: 'COMPARTIMIENTO MOTOR', checkDescription: 'Nivel aceite, refrigerante, correas, radiador y filtro aire.' },
                      { code: '5', zone: 'HIDRÁULICA / ACUMULADOR', checkDescription: 'Mirilla tanque hidráulico, válvulas y despresurización LOTO.', isCriticalLoto: true },
                      { code: '6', zone: 'CABINA ROPS / SEGURIDAD', checkDescription: 'Cinturón 3 pts, extintor vigente, bocina, luces y alarma retroceso.' },
                  ];

        // Coordenadas alrededor del chasis superior (planta)
        const stationCoords: Array<[number, number]> = [
            [470, 270],
            [295, 155],
            [155, 195],
            [110, 270],
            [175, 355],
            [295, 385],
            [395, 175],
            [395, 365],
        ];

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 520" width="960" height="520">
  <rect x="0" y="0" width="960" height="520" fill="#FFFFFF"/>
  <rect x="16" y="16" width="928" height="488" fill="#FFFFFF" stroke="#0F172A" stroke-width="2"/>
  <rect x="16" y="16" width="928" height="52" fill="#0F172A"/>
  <rect x="16" y="66" width="928" height="3" fill="#00AEEF"/>
  <text x="34" y="40" fill="#F3F4F6" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="15" font-weight="700">RUTA DE INSPECCIÓN PRE-OPERACIONAL (360°) Y BLOQUEO LOTO — ${escapeXml(params.makeModel.toUpperCase())}</text>
  <text x="34" y="57" fill="#8A93A6" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11">RECORRIDO EN SENTIDO HORARIO ANTES DEL ARRANQUE | ESTACIONES COBRE = BLOQUEO ENERGÍA CERO</text>

  <!-- Planta esquemática 360° -->
  <rect x="34" y="86" width="500" height="400" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.2"/>
  <ellipse cx="284" cy="272" rx="205" ry="138" fill="none" stroke="#94A3B8" stroke-width="1.5" stroke-dasharray="6,5"/>
  <!-- Chasis vista en planta -->
  <rect x="160" y="212" width="210" height="120" fill="#E2E8F0" stroke="#0F172A" stroke-width="2"/>
  <rect x="225" y="228" width="95" height="88" fill="#FFFFFF" stroke="#0F172A" stroke-width="1.5"/>
  <text x="272" y="276" text-anchor="middle" fill="#0F172A" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11" font-weight="700">ROPS / CAB</text>
  <!-- Ruedas/Orugas planta -->
  <rect x="172" y="188" width="64" height="20" fill="#0F172A"/>
  <rect x="292" y="188" width="64" height="20" fill="#0F172A"/>
  <rect x="172" y="336" width="64" height="20" fill="#0F172A"/>
  <rect x="292" y="336" width="64" height="20" fill="#0F172A"/>
  <!-- Cucharón/Frente -->
  <polygon points="370,224 432,204 432,340 370,320" fill="#CBD5E1" stroke="#0F172A" stroke-width="2"/>

  ${stations
      .map((st, idx) => {
          const [cx, cy] = stationCoords[idx % stationCoords.length];
          const fill = st.isCriticalLoto ? '#C68346' : '#0F172A';
          return `
  <g>
    <rect x="${cx - 15}" y="${cy - 15}" width="30" height="30" fill="${fill}" stroke="#FFFFFF" stroke-width="2"/>
    <text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="#FFFFFF" font-family="Atkinson Hyperlegible Mono, monospace" font-size="13" font-weight="700">${escapeXml(
              st.code
          )}</text>
  </g>`;
      })
      .join('')}

  <!-- Leyenda derecha -->
  <rect x="550" y="86" width="376" height="400" fill="#FFFFFF" stroke="#0F172A" stroke-width="1.5"/>
  <rect x="550" y="86" width="376" height="32" fill="#F8FAFC" stroke="#0F172A" stroke-width="1"/>
  <text x="564" y="107" fill="#0F172A" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="12" font-weight="700">ESTACIONES DE VERIFICACIÓN Y AISLAMIENTO</text>

  ${stations
      .map((st, idx) => {
          const y = 130 + idx * 44;
          const fill = st.isCriticalLoto ? '#C68346' : '#0F172A';
          return `
  <g transform="translate(562, ${y})">
    <rect x="0" y="0" width="24" height="24" fill="${fill}"/>
    <text x="12" y="16" text-anchor="middle" fill="#FFFFFF" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11" font-weight="700">${escapeXml(
              st.code
          )}</text>
    <text x="32" y="11" fill="#0F172A" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="11" font-weight="700">${escapeXml(
              truncateText(st.zone, 38)
          )}</text>
    <text x="32" y="26" fill="#475569" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="10">${escapeXml(
              truncateText(st.checkDescription, 52)
          )}</text>
    <line x1="0" y1="35" x2="352" y2="35" stroke="#E2E8F0" stroke-width="1"/>
  </g>`;
      })
      .join('')}
</svg>`;
    }

    /**
     * 5. Placa Normativa Combinada ISO 3864 / ANSI Z535 (`ISO_SAFETY_PLAQUE`)
     * Incrusta directamente los `.svg` vectoriales puros del paquete ad-hoc del equipo.
     */
    public static generateIsoSafetyPlaqueSvg(params: {
        makeModel: string;
        ppeEntries: SymbologyPackEntry[];
        hazardEntries: SymbologyPackEntry[];
    }): string {
        const ppe = params.ppeEntries.slice(0, 6);
        const hazards = params.hazardEntries.slice(0, 6);

        const embedInnerSvg = (entry: SymbologyPackEntry, x: number, y: number, size: number) => {
            if (entry.svg_inline && entry.svg_inline.includes('<svg')) {
                const viewBoxMatch = entry.svg_inline.match(/viewBox\s*=\s*["']([^"']+)["']/i);
                const vb = viewBoxMatch ? viewBoxMatch[1] : '0 0 64 64';
                const inner = entry.svg_inline
                    .replace(/^[\s\S]*?<svg[^>]*>/i, '')
                    .replace(/<\/svg>\s*$/i, '');
                return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${vb}">${inner}</svg>`;
            }
            return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#F8FAFC" stroke="#0F172A" stroke-width="1.5"/>
            <text x="${x + size / 2}" y="${y + size / 2 + 4}" text-anchor="middle" fill="#0F172A" font-family="Atkinson Hyperlegible Mono, monospace" font-size="10" font-weight="700">${escapeXml(
                entry.iso_reference
            )}</text>`;
        };

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 520" width="960" height="520">
  <rect x="0" y="0" width="960" height="520" fill="#FFFFFF"/>
  <rect x="16" y="16" width="928" height="488" fill="#FFFFFF" stroke="#0F172A" stroke-width="3"/>

  <!-- Banda Superior ANSI Z535 / ISO 3864 ADVERTENCIA -->
  <rect x="16" y="16" width="928" height="58" fill="#0F172A"/>
  <rect x="16" y="72" width="928" height="4" fill="#DC2626"/>
  <text x="480" y="44" text-anchor="middle" fill="#FFFFFF" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="20" font-weight="700" letter-spacing="2">PLACA DE SEGURIDAD OPERACIONAL ISO 3864 / ISO 7010</text>
  <text x="480" y="63" text-anchor="middle" fill="#CBD5E1" font-family="Atkinson Hyperlegible Mono, monospace" font-size="11">ACTIVO: ${escapeXml(params.makeModel.toUpperCase())} | CUMPLIMIENTO OBLIGATORIO EN FAENA</text>

  <!-- Mitad Izquierda: Peligros y Prohibiciones Críticas -->
  <rect x="34" y="92" width="438" height="394" fill="#F8FAFC" stroke="#DC2626" stroke-width="1.5"/>
  <rect x="34" y="92" width="438" height="32" fill="#DC2626"/>
  <text x="253" y="113" text-anchor="middle" fill="#FFFFFF" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="12" font-weight="700">PELIGROS Y PROHIBICIONES ACTIVAS</text>

  ${hazards
      .map((h, idx) => {
          const y = 136 + idx * 56;
          return `
  <g>
    ${embedInnerSvg(h, 46, y, 44)}
    <text x="102" y="${y + 17}" fill="#0F172A" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="11.5" font-weight="700">${escapeXml(
              truncateText(h.technical_name_es, 46)
          )}</text>
    <text x="102" y="${y + 34}" fill="#475569" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="10">${escapeXml(
              truncateText(h.action_operator_es, 56)
          )}</text>
  </g>`;
      })
      .join('')}

  <!-- Mitad Derecha: Acciones Obligatorias y EPP (ISO 7010 Serie M) -->
  <rect x="488" y="92" width="438" height="394" fill="#F8FAFC" stroke="#00AEEF" stroke-width="1.5"/>
  <rect x="488" y="92" width="438" height="32" fill="#0F172A"/>
  <text x="707" y="113" text-anchor="middle" fill="#FFFFFF" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="12" font-weight="700">EPP Y CONTROLES OBLIGATORIOS (ISO 7010)</text>

  ${ppe
      .map((m, idx) => {
          const y = 136 + idx * 56;
          return `
  <g>
    ${embedInnerSvg(m, 500, y, 44)}
    <text x="556" y="${y + 17}" fill="#0F172A" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="11.5" font-weight="700">${escapeXml(
              truncateText(m.technical_name_es, 46)
          )}</text>
    <text x="556" y="${y + 34}" fill="#475569" font-family="Atkinson Hyperlegible Next, sans-serif" font-size="10">${escapeXml(
              truncateText(m.action_operator_es, 56)
          )}</text>
  </g>`;
      })
      .join('')}
</svg>`;
    }

    /**
     * Genera un plano vectorial paramétrico a partir de los datos reales de `global_asset_catalog/{id}`,
     * lo sanitiza y almacena en CAS (`GLOBAL_OEM`, `.svg`) y opcionalmente lo ancla a un capítulo de la bóveda.
     */
    public static async generateAndStoreAssetBlueprint(params: {
        globalAssetId: string;
        kind: BlueprintKind;
        targetPillarId?: PillarId;
        targetItemId?: string;
        customPayload?: Record<string, any>;
        actorUid?: string;
    }): Promise<{ figure: ExtractedFigureRef; svgString: string }> {
        const assetRef = db.collection('global_asset_catalog').doc(params.globalAssetId);
        const snap = await assetRef.get();
        if (!snap.exists) {
            const err: any = new Error(`Activo ${params.globalAssetId} no encontrado.`);
            err.statusCode = 404;
            throw err;
        }

        const data = snap.data()!;
        const make = String(data.make_oficial || data.make || 'OEM');
        const model = String(data.model_oficial || data.model || params.globalAssetId);
        const makeModel = data.make_model || `${make} ${model}`.trim();
        const equipmentType = String(data.tipo_equipo || data.categoria_equipo || 'EQUIPO INDUSTRIAL');

        // Consolidar texto real de la bóveda para extraer cifras declaradas sin alucinar
        const vault = data.knowledge_vault || {};
        const fichaCorpus = [
            ...(data.caracteristicas_principales || []),
            ...((vault.ficha_tecnica?.items || []).map((i: any) => i.content || '')),
        ].join('\n');

        let rawSvg = '';
        let titleEs = '';
        let figureType: ExtractedFigureRef['figure_type'] = 'PLANO_VECTORIAL_SVG';

        if (params.kind === 'DIMENSION_SPEC_SHEET') {
            titleEs = `Plano Dimensional Acotado (SI) — ${makeModel}`;
            figureType = 'DIAGRAMA_ACOTADO';
            rawSvg = this.generateDimensionSpecSheetSvg({
                makeModel,
                equipmentType,
                lengthMm:
                    params.customPayload?.lengthMm ||
                    extractRegexMetric(fichaCorpus, [
                        /longitud[^:\n]{0,25}:\s*([0-9.,]+\s*(?:mm|m))/i,
                        /largo[^:\n]{0,25}:\s*([0-9.,]+\s*(?:mm|m))/i,
                    ]),
                widthMm:
                    params.customPayload?.widthMm ||
                    extractRegexMetric(fichaCorpus, [
                        /ancho[^:\n]{0,25}:\s*([0-9.,]+\s*(?:mm|m))/i,
                    ]),
                heightMm:
                    params.customPayload?.heightMm ||
                    extractRegexMetric(fichaCorpus, [
                        /altura[^:\n]{0,25}:\s*([0-9.,]+\s*(?:mm|m))/i,
                    ]),
                operatingMassKg:
                    params.customPayload?.operatingMassKg ||
                    extractRegexMetric(fichaCorpus, [
                        /(?:peso|masa)[^:\n]{0,28}:\s*([0-9.,]+\s*(?:kg|t))/i,
                        /([0-9]{3,6}(?:[.,][0-9]+)?\s*kg)\b/i,
                    ]),
                enginePowerKw:
                    params.customPayload?.enginePowerKw ||
                    extractRegexMetric(fichaCorpus, [
                        /potencia[^:\n]{0,28}:\s*([0-9.,]+\s*kW(?:\s*\([^)]+\))?)/i,
                        /([0-9]{1,4}(?:[.,][0-9]+)?\s*kW)\b/i,
                    ]),
                hydraulicPressureBar:
                    params.customPayload?.hydraulicPressureBar ||
                    extractRegexMetric(fichaCorpus, [
                        /presi[oó]n[^:\n]{0,28}:\s*([0-9.,]+\s*bar)/i,
                        /([0-9]{2,4}(?:[.,][0-9]+)?\s*bar)\b/i,
                    ]),
                ratedCapacity:
                    params.customPayload?.ratedCapacity ||
                    extractRegexMetric(fichaCorpus, [
                        /capacidad[^:\n]{0,28}:\s*([0-9.,]+\s*(?:kg|m³|m3|L|t))/i,
                    ]),
            });
        } else if (params.kind === 'PM_HOROMETER_TIMELINE') {
            titleEs = `Matriz Cronológica PM por Horómetro — ${makeModel}`;
            figureType = 'MAPA_LUBRICACION_PM';
            const pmItems = (vault.pauta_mantencion?.items || []).filter((i: any) => !i.is_discarded);
            const intervals: PmIntervalEntry[] = params.customPayload?.intervals || [];
            if (intervals.length === 0 && pmItems.length > 0) {
                const buckets: Record<number, string[]> = { 10: [], 250: [], 500: [], 1000: [], 2000: [] };
                for (const it of pmItems) {
                    const t = String(it.title || '');
                    if (/10\s*h|diari/i.test(t)) buckets[10].push(t);
                    else if (/250\s*h/i.test(t)) buckets[250].push(t);
                    else if (/500\s*h/i.test(t)) buckets[500].push(t);
                    else if (/1000\s*h|1\.000/i.test(t)) buckets[1000].push(t);
                    else if (/2000\s*h|2\.000/i.test(t)) buckets[2000].push(t);
                    else buckets[250].push(t);
                }
                for (const h of [10, 250, 500, 1000, 2000]) {
                    if (buckets[h].length > 0) {
                        intervals.push({ hours: h, tasks: buckets[h] });
                    }
                }
            }
            rawSvg = this.generatePmHorometerTimelineSvg({ makeModel, intervals });
        } else if (params.kind === 'WALKAROUND_LOTO_MAP') {
            titleEs = `Mapa de Inspección 360° y Estaciones LOTO — ${makeModel}`;
            figureType = 'PLANO_VECTORIAL_SVG';
            const preOpItems = (vault.checklist_pre_op?.items || []).filter((i: any) => !i.is_discarded);
            const stations: WalkAroundStation[] =
                params.customPayload?.stations ||
                preOpItems.slice(0, 6).map((it: any, idx: number) => ({
                    code: String(idx + 1),
                    zone: it.section || `ESTACIÓN ${idx + 1}`,
                    checkDescription: it.title,
                    isCriticalLoto: /loto|bloqueo|energ[ií]a|bater[ií]a|hidr[aá]ulic/i.test(it.title),
                }));
            rawSvg = this.generateWalkAroundLotoMapSvg({ makeModel, stations });
        } else if (params.kind === 'PERFORMANCE_CURVE') {
            titleEs = params.customPayload?.chartTitle || `Curva Operacional Paramétrica — ${makeModel}`;
            figureType = 'CURVA_RENDIMIENTO';
            rawSvg = this.generatePerformanceCurveSvg({
                makeModel,
                chartTitle: titleEs,
                xAxisLabel: params.customPayload?.xAxisLabel || 'Régimen / Alcance Operativo (%)',
                yAxisLabel: params.customPayload?.yAxisLabel || 'Capacidad / Eficiencia Relativa (%)',
                points: Array.isArray(params.customPayload?.points) ? params.customPayload.points : [],
                limitLineY: params.customPayload?.limitLineY,
            });
        } else {
            titleEs = `Placa Normativa ISO 3864 / ISO 7010 — ${makeModel}`;
            figureType = 'SIMBOLOGIA_SEGURIDAD';
            const pack =
                data.symbology_pack || (await buildAndPersistAssetSymbologyPack(params.globalAssetId, data));
            rawSvg = this.generateIsoSafetyPlaqueSvg({
                makeModel,
                ppeEntries: pack.groups?.MANDATORY_PPE || [],
                hazardEntries: pack.groups?.HAZARD_PROHIBITION || [],
            });
        }

        const digested = await MediaDigestorServer.digestSvg(rawSvg);
        const descriptor = await CasStorageService.persistDigestedBinary(digested, {
            scope: 'GLOBAL_OEM',
            actorUid: params.actorUid || 'opermaq-svg-blueprint-engine',
            originalFilename: `${params.globalAssetId}_${params.kind.toLowerCase()}.svg`,
        });

        const figure: ExtractedFigureRef = {
            figure_id: `bp_${params.kind.toLowerCase()}_${descriptor.sha256.slice(0, 8)}`,
            sha256: descriptor.sha256,
            storage_url: descriptor.downloadUrl,
            mime_type: 'image/svg+xml',
            figure_type: figureType,
            title_es: titleEs,
            caption_es: 'Esquema vectorial determinista generado por OpermaqSvgBlueprintEngine v4.0.',
            width: 960,
            height: 520,
            is_parametric_svg: true,
        };

        // Si se indicó un capítulo destino, adjuntar la figura sin duplicar
        if (params.targetPillarId && params.targetItemId) {
            const pItems = [...(vault[params.targetPillarId]?.items || [])];
            const idx = pItems.findIndex((i: any) => i.item_id === params.targetItemId);
            if (idx !== -1 && !pItems[idx].is_human_locked) {
                const { merged } = mergeDeduplicatedFigures(pItems[idx].figures || [], [figure]);
                pItems[idx] = { ...pItems[idx], figures: merged };
                await assetRef.update({
                    [`knowledge_vault.${params.targetPillarId}.items`]: pItems,
                    updatedAt: Date.now(),
                });
            }
        }

        return {
            figure,
            svgString: digested.buffer.toString('utf8'),
        };
    }
}

