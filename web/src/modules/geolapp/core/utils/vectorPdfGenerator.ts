import {
    PDFDocument,
    PageSizes,
    StandardFonts,
    rgb,
    type PDFFont,
    type PDFPage,
    type RGB,
} from 'pdf-lib';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { buildCanonicalGeoFix } from '../../../../core/geo/wgs84UtmProjection';
import type { CanonicalGeoFix, GeoCaptureSource } from '../../../../contracts/geo.contracts';
import { calculationEngine } from '../services/calculation-engine';
import { projectEqualAreaPole } from './geoscienceCalculations';
import type {
    BoulderDetectionBox2D,
    CopperGovernanceAlert,
    CopperMineralDomain,
    EstructuralHidroPayload,
    ExploracionSondajePayload,
    GeolappDomainRecord,
    GeomensuraSurveyPayload,
    StockpileAsset,
    StockpileMeasurement,
} from '../types/GeolappTypes';

export interface GeolappPdfGovernanceAlert {
    severity: string;
    message: string;
    code?: string;
}

export interface GeolappVectorPdfOptions {
    locale?: string;
    authorEmail?: string;
    governanceAlerts?: GeolappPdfGovernanceAlert[];
    filename?: string;
    share?: boolean;
}

export interface GeolappVectorPdfResult {
    bytes: Uint8Array;
    blob: Blob;
    filename: string;
}

type PdfLocale = 'es' | 'en' | 'pt';

interface PdfCopy {
    undeclared: string;
    brandTitle: string;
    certificateTitle: string;
    sovereignRegion: string;
    assetId: string;
    assetName: string;
    materialClass: string;
    locationRef: string;
    emittedAt: string;
    authorLabel: string;
    geospatialHeader: string;
    utmZoneBand: string;
    hemisphere: string;
    easting: string;
    northing: string;
    altitude: string;
    latLon: string;
    accuracy: string;
    geometryHeader: string;
    geometryModel: string;
    majorAxisOrLength: string;
    minorAxisOrWidth: string;
    topOrCrest: string;
    perimeters: string;
    wallAngle: string;
    height: string;
    clinometerImu: string;
    volume: string;
    density: string;
    captureMethod: string;
    copperHeader: string;
    mineralDomain: string;
    thm: string;
    moisture: string;
    tml: string;
    tms: string;
    cuTotal: string;
    cuSoluble: string;
    rsRatio: string;
    cuFine: string;
    residenceDays: string;
    weighbridge: string;
    alertsHeader: string;
    noAlerts: string;
    imsbcBlockTag: string;
    casHeader: string;
    casTraceLabel: string;
    evidenceRefLabel: string;
    perimeterCountLabel: string;
    twin3dHeader: string;
    tinVolume: string;
    meshSha256: string;
    meshSource: string;
    meshCasTrace: string;
    meshUri: string;
    rosinHeader: string;
    p80Label: string;
    p50Label: string;
    p20Label: string;
    xcLabel: string;
    uniformityNLabel: string;
    oversizeLabel: string;
    rrSourceLabel: string;
    boulderCountLabel: string;
    maxBoulderLabel: string;
    colBoulderIdx: string;
    colBoulderLabel: string;
    colBoulderBox: string;
    colBoulderEstMm: string;
    colBoulderConf: string;
    colBoulderCas: string;
    noBoulders: string;
    historyHeader: string;
    noMeasurements: string;
    colDate: string;
    colMethod: string;
    colModel: string;
    colVol: string;
    colDens: string;
    colThm: string;
    colTms: string;
    colGrade: string;
    colFine: string;
    colCas: string;
    footerText: string;
    pageLabel: string;
    continuationSuffix: string;
}

const PDF_COPY: Record<PdfLocale, PdfCopy> = {
    es: {
        undeclared: '[Información técnica no declarada en ficha]',
        brandTitle: 'MINREPORT · GEOLAPP(R)',
        certificateTitle: 'CERTIFICADO TÉCNICO VECTORIAL DE ACOPIO (Cu)',
        sovereignRegion: 'southamerica-west1',
        assetId: 'CÓDIGO ACOPIO',
        assetName: 'DENOMINACIÓN',
        materialClass: 'CLASE OPERATIVA',
        locationRef: 'UBICACIÓN / NIVEL',
        emittedAt: 'EMISIÓN ISO',
        authorLabel: 'RESPONSABLE TÉCNICO',
        geospatialHeader: '01 · GEOLOCALIZACIÓN SOBERANA UTM / WGS84',
        utmZoneBand: 'ZONA / BANDA UTM',
        hemisphere: 'HEMISFERIO / EPSG',
        easting: 'ESTE [m]',
        northing: 'NORTE [m]',
        altitude: 'ALTITUD [m.s.n.m.]',
        latLon: 'LATITUD / LONGITUD',
        accuracy: 'EXACTITUD GNSS',
        geometryHeader: '02 · GEOMETRÍA DEL SÓLIDO, CLINOMETRÍA IMU Y VOLUMETRÍA',
        geometryModel: 'MODELO GEOMÉTRICO',
        majorAxisOrLength: 'EJE MAYOR / LONG. BASE',
        minorAxisOrWidth: 'EJE MENOR / ANCHO BASE',
        topOrCrest: 'EJE SUP. / CRESTA',
        perimeters: 'PERÍMETROS BASE / SUP.',
        wallAngle: 'ÁNGULO DE MURO',
        height: 'ALTURA DECLARADA',
        clinometerImu: 'CLINÓMETRO IMU (ANG / DIST / OCULAR)',
        volume: 'VOLUMEN [m3]',
        density: 'DENSIDAD [t/m3]',
        captureMethod: 'MÉTODO DE CAPTURA',
        copperHeader: '03 · BALANCE METALÚRGICO COBRE (Cu) Y CONCILIACIÓN',
        mineralDomain: 'DOMINIO MINERAL Cu',
        thm: 'THM [t]',
        moisture: 'HUMEDAD w%',
        tml: 'TML%',
        tms: 'TMS [t]',
        cuTotal: 'CuT%',
        cuSoluble: 'CuS%',
        rsRatio: 'RS% (CuS/CuT)',
        cuFine: 'Cu FINO [t]',
        residenceDays: 'DÍAS RESIDENCIA',
        weighbridge: 'ROMANA [t] / FACTOR',
        alertsHeader: '04 · GOBERNANZA Y ALERTAS OPERATIVAS COBRE (Cu)',
        noAlerts: 'Sin alertas criticas de envejecimiento ni bloqueo IMSBC activas.',
        imsbcBlockTag: 'BLOQUEO IMSBC',
        casHeader: '05 · TRAZABILIDAD CRIPTOGRÁFICA Y EVIDENCIA CAS',
        casTraceLabel: 'BALANCE DE PESO CAS',
        evidenceRefLabel: 'REFERENCIA EVIDENCIA',
        perimeterCountLabel: 'FOTOS PERIMETRALES',
        twin3dHeader: '06 · GEMELO DIGITAL 3D (.glb) Y VOLUMETRÍA TIN',
        tinVolume: 'VOLUMEN V_TIN [m3]',
        meshSha256: 'SHA-256 MALLA .glb',
        meshSource: 'ORIGEN MALLA 3D',
        meshCasTrace: 'TRAZA CAS .glb (ORIG -> CAS)',
        meshUri: 'REFERENCIA MALLA .glb',
        rosinHeader: '07 · GRANULOMETRÍA ROSIN-RAMMLER (P80) Y COLPAS box_2d',
        p80Label: 'P80 [mm]',
        p50Label: 'P50 [mm]',
        p20Label: 'P20 [mm]',
        xcLabel: 'TAM. CARACT. xc [mm]',
        uniformityNLabel: 'UNIFORMIDAD n',
        oversizeLabel: 'SOBRETAMAÑO / UMBRAL',
        rrSourceLabel: 'ORIGEN PERFIL RRSB',
        boulderCountLabel: 'COLPAS DETECTADAS (box_2d)',
        maxBoulderLabel: 'COLPA MÁXIMA [mm]',
        colBoulderIdx: '#',
        colBoulderLabel: 'ETIQUETA',
        colBoulderBox: 'box_2d [ymin,xmin,ymax,xmax]',
        colBoulderEstMm: 'EST [mm]',
        colBoulderConf: 'CONF',
        colBoulderCas: 'CAS (ORIG -> CAS)',
        noBoulders: 'Sin detecciones de colpas box_2d registradas en ficha.',
        historyHeader: '08 · REGISTRO HISTÓRICO DE MEDICIONES',
        noMeasurements: 'Sin mediciones registradas para este acopio.',
        colDate: 'FECHA',
        colMethod: 'MET',
        colModel: 'MODELO',
        colVol: 'VOL [m3]',
        colDens: 'DENS',
        colThm: 'THM [t]',
        colTms: 'TMS [t]',
        colGrade: 'CuT/CuS%',
        colFine: 'Cu FINO',
        colCas: 'CAS',
        footerText: 'MINREPORT · GEOLAPP(R) | southamerica-west1 | CERTIFICADO VECTORIAL',
        pageLabel: 'PÁGINA',
        continuationSuffix: 'CONTINUACIÓN',
    },
    en: {
        undeclared: '[Technical information not declared on record]',
        brandTitle: 'MINREPORT · GEOLAPP(R)',
        certificateTitle: 'VECTOR TECHNICAL STOCKPILE CERTIFICATE (Cu)',
        sovereignRegion: 'southamerica-west1',
        assetId: 'STOCKPILE CODE',
        assetName: 'STOCKPILE NAME',
        materialClass: 'OPERATIONAL CLASS',
        locationRef: 'LOCATION / BENCH',
        emittedAt: 'ISO TIMESTAMP',
        authorLabel: 'TECHNICAL OFFICER',
        geospatialHeader: '01 · SOVEREIGN UTM / WGS84 GEOLOCATION',
        utmZoneBand: 'UTM ZONE / BAND',
        hemisphere: 'HEMISPHERE / EPSG',
        easting: 'EASTING [m]',
        northing: 'NORTHING [m]',
        altitude: 'ALTITUDE [m.a.s.l.]',
        latLon: 'LATITUDE / LONGITUDE',
        accuracy: 'GNSS ACCURACY',
        geometryHeader: '02 · SOLID GEOMETRY, IMU CLINOMETRY AND VOLUMETRICS',
        geometryModel: 'GEOMETRIC MODEL',
        majorAxisOrLength: 'MAJOR AXIS / BASE LEN.',
        minorAxisOrWidth: 'MINOR AXIS / BASE WIDTH',
        topOrCrest: 'TOP AXES / CREST',
        perimeters: 'PERIMETERS BASE / TOP',
        wallAngle: 'WALL ANGLE',
        height: 'DECLARED HEIGHT',
        clinometerImu: 'IMU CLINOMETER (DEG / DIST / EYE)',
        volume: 'VOLUME [m3]',
        density: 'DENSITY [t/m3]',
        captureMethod: 'CAPTURE METHOD',
        copperHeader: '03 · COPPER METALLURGICAL BALANCE (Cu) & RECONCILIATION',
        mineralDomain: 'Cu MINERAL DOMAIN',
        thm: 'WMT [t]',
        moisture: 'MOISTURE w%',
        tml: 'TML%',
        tms: 'DMT [t]',
        cuTotal: 'CuT%',
        cuSoluble: 'CuS%',
        rsRatio: 'SR% (CuS/CuT)',
        cuFine: 'FINE Cu [t]',
        residenceDays: 'RESIDENCE DAYS',
        weighbridge: 'WEIGHBRIDGE [t] / FACTOR',
        alertsHeader: '04 · COPPER GOVERNANCE AND COMPLIANCE ALERTS (Cu)',
        noAlerts: 'No active sulfide aging warnings or IMSBC dispatch blocks.',
        imsbcBlockTag: 'IMSBC BLOCK',
        casHeader: '05 · CRYPTOGRAPHIC TRACEABILITY AND CAS EVIDENCE',
        casTraceLabel: 'CAS STORAGE DELTA',
        evidenceRefLabel: 'EVIDENCE URI',
        perimeterCountLabel: 'PERIMETER PHOTOS',
        twin3dHeader: '06 · 3D DIGITAL TWIN (.glb) AND TIN VOLUMETRICS',
        tinVolume: 'V_TIN VOLUME [m3]',
        meshSha256: 'SHA-256 .glb MESH',
        meshSource: '3D MESH SOURCE',
        meshCasTrace: 'CAS .glb TRACE (ORIG -> CAS)',
        meshUri: '.glb MESH REFERENCE',
        rosinHeader: '07 · ROSIN-RAMMLER GRANULOMETRY (P80) & box_2d BOULDERS',
        p80Label: 'P80 [mm]',
        p50Label: 'P50 [mm]',
        p20Label: 'P20 [mm]',
        xcLabel: 'CHAR. SIZE xc [mm]',
        uniformityNLabel: 'UNIFORMITY n',
        oversizeLabel: 'OVERSIZE / THRESHOLD',
        rrSourceLabel: 'RRSB PROFILE SOURCE',
        boulderCountLabel: 'DETECTED BOULDERS (box_2d)',
        maxBoulderLabel: 'MAX BOULDER [mm]',
        colBoulderIdx: '#',
        colBoulderLabel: 'LABEL',
        colBoulderBox: 'box_2d [ymin,xmin,ymax,xmax]',
        colBoulderEstMm: 'EST [mm]',
        colBoulderConf: 'CONF',
        colBoulderCas: 'CAS (ORIG -> CAS)',
        noBoulders: 'No box_2d boulder detections recorded on file.',
        historyHeader: '08 · MEASUREMENT TRACEABILITY LOG',
        noMeasurements: 'No measurements recorded for this stockpile.',
        colDate: 'DATE',
        colMethod: 'MET',
        colModel: 'MODEL',
        colVol: 'VOL [m3]',
        colDens: 'DENS',
        colThm: 'WMT [t]',
        colTms: 'DMT [t]',
        colGrade: 'CuT/CuS%',
        colFine: 'FINE Cu',
        colCas: 'CAS',
        footerText: 'MINREPORT · GEOLAPP(R) | southamerica-west1 | VECTOR CERTIFICATE',
        pageLabel: 'PAGE',
        continuationSuffix: 'CONTINUATION',
    },
    pt: {
        undeclared: '[Informação técnica não declarada na ficha]',
        brandTitle: 'MINREPORT · GEOLAPP(R)',
        certificateTitle: 'CERTIFICADO TÉCNICO VETORIAL DE PILHA (Cu)',
        sovereignRegion: 'southamerica-west1',
        assetId: 'CÓDIGO DA PILHA',
        assetName: 'DENOMINAÇÃO',
        materialClass: 'CLASSE OPERACIONAL',
        locationRef: 'LOCALIZAÇÃO / NÍVEL',
        emittedAt: 'EMISSÃO ISO',
        authorLabel: 'RESPONSÁVEL TÉCNICO',
        geospatialHeader: '01 · GEOLOCALIZAÇÃO SOBERANA UTM / WGS84',
        utmZoneBand: 'ZONA / BANDA UTM',
        hemisphere: 'HEMISFÉRIO / EPSG',
        easting: 'ESTE [m]',
        northing: 'NORTE [m]',
        altitude: 'ALTITUDE [m.s.n.m.]',
        latLon: 'LATITUDE / LONGITUDE',
        accuracy: 'PRECISÃO GNSS',
        geometryHeader: '02 · GEOMETRIA DO SÓLIDO, CLINOMETRIA IMU E VOLUMETRIA',
        geometryModel: 'MODELO GEOMÉTRICO',
        majorAxisOrLength: 'EIXO MAIOR / COMP. BASE',
        minorAxisOrWidth: 'EIXO MENOR / LARG. BASE',
        topOrCrest: 'EIXO SUP. / CRISTA',
        perimeters: 'PERÍMETROS BASE / SUP.',
        wallAngle: 'ÂNGULO DO MURO',
        height: 'ALTURA DECLARADA',
        clinometerImu: 'CLINÔMETRO IMU (ANG / DIST / OCULAR)',
        volume: 'VOLUME [m3]',
        density: 'DENSIDADE [t/m3]',
        captureMethod: 'MÉTODO DE CAPTURA',
        copperHeader: '03 · BALANÇO METALÚRGICO COBRE (Cu) E CONCILIAÇÃO',
        mineralDomain: 'DOMÍNIO MINERAL Cu',
        thm: 'THM [t]',
        moisture: 'UMIDADE w%',
        tml: 'TML%',
        tms: 'TMS [t]',
        cuTotal: 'CuT%',
        cuSoluble: 'CuS%',
        rsRatio: 'RS% (CuS/CuT)',
        cuFine: 'Cu FINO [t]',
        residenceDays: 'DIAS RESIDÊNCIA',
        weighbridge: 'BALANÇA [t] / FATOR',
        alertsHeader: '04 · GOVERNANÇA E ALERTAS OPERACIONAIS COBRE (Cu)',
        noAlerts: 'Sem alertas críticos de envelhecimento ou bloqueio IMSBC ativos.',
        imsbcBlockTag: 'BLOQUEIO IMSBC',
        casHeader: '05 · RASTREABILIDADE CRIPTOGRÁFICA E EVIDÊNCIA CAS',
        casTraceLabel: 'BALANÇO DE PESO CAS',
        evidenceRefLabel: 'REFERÊNCIA EVIDÊNCIA',
        perimeterCountLabel: 'FOTOS PERIMETRAIS',
        twin3dHeader: '06 · GÊMEO DIGITAL 3D (.glb) E VOLUMETRIA TIN',
        tinVolume: 'VOLUME V_TIN [m3]',
        meshSha256: 'SHA-256 MALHA .glb',
        meshSource: 'ORIGEM MALHA 3D',
        meshCasTrace: 'RASTRO CAS .glb (ORIG -> CAS)',
        meshUri: 'REFERÊNCIA MALHA .glb',
        rosinHeader: '07 · GRANULOMETRIA ROSIN-RAMMLER (P80) E MATACÕES box_2d',
        p80Label: 'P80 [mm]',
        p50Label: 'P50 [mm]',
        p20Label: 'P20 [mm]',
        xcLabel: 'TAM. CARACT. xc [mm]',
        uniformityNLabel: 'UNIFORMIDADE n',
        oversizeLabel: 'SOBREGRANDE / LIMITE',
        rrSourceLabel: 'ORIGEM PERFIL RRSB',
        boulderCountLabel: 'MATACÕES DETECTADOS (box_2d)',
        maxBoulderLabel: 'MATACÃO MÁXIMO [mm]',
        colBoulderIdx: '#',
        colBoulderLabel: 'RÓTULO',
        colBoulderBox: 'box_2d [ymin,xmin,ymax,xmax]',
        colBoulderEstMm: 'EST [mm]',
        colBoulderConf: 'CONF',
        colBoulderCas: 'CAS (ORIG -> CAS)',
        noBoulders: 'Nenhuma detecção de matacões box_2d registrada na ficha.',
        historyHeader: '08 · REGISTRO HISTÓRICO DE MEDIÇÕES',
        noMeasurements: 'Sem medições registradas para esta pilha.',
        colDate: 'DATA',
        colMethod: 'MET',
        colModel: 'MODELO',
        colVol: 'VOL [m3]',
        colDens: 'DENS',
        colThm: 'THM [t]',
        colTms: 'TMS [t]',
        colGrade: 'CuT/CuS%',
        colFine: 'Cu FINO',
        colCas: 'CAS',
        footerText: 'MINREPORT · GEOLAPP(R) | southamerica-west1 | CERTIFICADO VETORIAL',
        pageLabel: 'PÁGINA',
        continuationSuffix: 'CONTINUAÇÃO',
    },
};

const COPPER_DOMAIN_LABELS: Record<CopperMineralDomain, string> = {
    OXIDO_CU: 'OXIDO DE COBRE (OXIDO_CU)',
    MIXTO_CU: 'MINERAL MIXTO (MIXTO_CU)',
    SULFURO_SECUNDARIO_CU: 'SULFURO SECUNDARIO (SULFURO_SECUNDARIO_CU)',
    SULFURO_PRIMARIO_CU: 'SULFURO PRIMARIO (SULFURO_PRIMARIO_CU)',
    CONCENTRADO_CU: 'CONCENTRADO Cu (CONCENTRADO_CU)',
    BAJA_LEY_CU: 'BAJA LEY Cu (BAJA_LEY_CU)',
    ESTERIL_RIPIOS: 'ESTERIL / RIPIOS (ESTERIL_RIPIOS)',
};

const COLOR_INK = rgb(0.059, 0.09, 0.165); // #0F172A
const COLOR_MUTED = rgb(0.278, 0.333, 0.412); // #475569
const COLOR_SURFACE = rgb(0.973, 0.98, 0.988); // #F8FAFC
const COLOR_WHITE = rgb(1, 1, 1);
const COLOR_BORDER = rgb(0.82, 0.855, 0.9);
const COLOR_COPPER = rgb(0.776, 0.514, 0.275); // #C68346
const COLOR_CYAN = rgb(0.0, 0.682, 0.937); // #00AEEF
const COLOR_ALERT_BG = rgb(0.996, 0.949, 0.949);
const COLOR_ALERT_INK = rgb(0.725, 0.11, 0.11);

const PAGE_W = PageSizes.A4[0]; // 595.28
const PAGE_H = PageSizes.A4[1]; // 841.89
const MARGIN_X = 34;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const TOP_Y = PAGE_H - 34;
const BOTTOM_Y = 46;

function resolveLocale(raw?: string): PdfLocale {
    const norm = String(raw || 'es').trim().toLowerCase().slice(0, 2);
    if (norm === 'en' || norm === 'pt') return norm;
    return 'es';
}

/**
 * Sanitiza texto para StandardFonts WinAnsi de `pdf-lib` evitando fallos con símbolos
 * Unicode no soportados (`®`, flechas, superíndices, marcas combinantes o emojis).
 */
export function sanitizePdfText(value: unknown, fallback = ''): string {
    if (value === null || value === undefined) return fallback;
    const raw = String(value);
    if (!raw) return fallback;

    const mapped = raw
        .normalize('NFC')
        .replace(/\u00AE/g, '(R)')
        .replace(/\u2122/g, '(TM)')
        .replace(/\u00A9/g, '(C)')
        .replace(/[\u2794\u2192\u21D2\u279C]/g, '->')
        .replace(/[\u2190\u21D0]/g, '<-')
        .replace(/\u2265/g, '>=')
        .replace(/\u2264/g, '<=')
        .replace(/\u2260/g, '!=')
        .replace(/\u2248/g, '~')
        .replace(/\u00B3/g, '3')
        .replace(/\u00B2/g, '2')
        .replace(/[\u2013\u2014\u2212]/g, '-')
        .replace(/\u2022/g, '-')
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\u03C0/g, 'pi')
        .replace(/\u0394/g, 'Delta')
        .replace(/\u03A6/g, 'Phi')
        .replace(/[\r\n\t\u00A0\u202F\u200B\uFEFF]/g, ' ');

    let result = '';
    for (const ch of mapped) {
        const cp = ch.codePointAt(0);
        if (cp === undefined) continue;
        if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) {
            result += ch;
        } else if (cp > 0xff) {
            const decomposed = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            for (const baseCh of decomposed) {
                const baseCp = baseCh.codePointAt(0);
                if (
                    baseCp !== undefined &&
                    ((baseCp >= 0x20 && baseCp <= 0x7e) || (baseCp >= 0xa0 && baseCp <= 0xff))
                ) {
                    result += baseCh;
                }
            }
        }
    }

    const trimmed = result.replace(/\s{2,}/g, ' ').trim();
    return trimmed || fallback;
}

function drawSafeText(
    page: PDFPage,
    text: string,
    options: {
        font: PDFFont;
        size: number;
        x: number;
        y: number;
        color?: RGB;
    }
): void {
    let safe = sanitizePdfText(text);
    if (!safe) return;
    try {
        options.font.encodeText(safe);
    } catch {
        safe = safe.replace(/[^\x20-\x7e]/g, '?');
    }
    page.drawText(safe, {
        x: options.x,
        y: options.y,
        size: options.size,
        font: options.font,
        color: options.color ?? COLOR_INK,
    });
}

function measureSafeWidth(font: PDFFont, text: string, size: number): number {
    let safe = sanitizePdfText(text);
    if (!safe) return 0;
    try {
        return font.widthOfTextAtSize(safe, size);
    } catch {
        safe = safe.replace(/[^\x20-\x7e]/g, '?');
        return font.widthOfTextAtSize(safe, size);
    }
}

function wrapTextLines(
    text: string,
    font: PDFFont,
    size: number,
    maxWidth: number
): string[] {
    const safe = sanitizePdfText(text);
    if (!safe) return [''];
    const words = safe.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (measureSafeWidth(font, candidate, size) <= maxWidth) {
            current = candidate;
            continue;
        }
        if (current) {
            lines.push(current);
            current = '';
        }
        if (measureSafeWidth(font, word, size) <= maxWidth) {
            current = word;
        } else {
            let chunk = '';
            for (const ch of word) {
                const nextChunk = chunk + ch;
                if (measureSafeWidth(font, nextChunk, size) > maxWidth && chunk) {
                    lines.push(chunk);
                    chunk = ch;
                } else {
                    chunk = nextChunk;
                }
            }
            current = chunk;
        }
    }

    if (current) {
        lines.push(current);
    }

    return lines.length > 0 ? lines : [''];
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
    const safe = sanitizePdfText(text);
    if (measureSafeWidth(font, safe, size) <= maxWidth) return safe;
    const ellipsis = '...';
    let out = '';
    for (const ch of safe) {
        if (measureSafeWidth(font, `${out}${ch}${ellipsis}`, size) > maxWidth) {
            break;
        }
        out += ch;
    }
    return `${out}${ellipsis}`;
}

function isFiniteNum(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

function firstFinitePositive(...vals: unknown[]): number | null {
    for (const v of vals) {
        if (isFiniteNum(v) && v > 0) return v;
    }
    return null;
}

function firstFinite(...vals: unknown[]): number | null {
    for (const v of vals) {
        if (isFiniteNum(v)) return v;
    }
    return null;
}

function formatCasBytes(bytes: number): string {
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const kb = bytes / 1024;
    return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
}

function formatCasTrace(
    originalBytes?: number | null,
    optimizedBytes?: number | null,
    savingsPct?: number | null
): string | null {
    if (
        !isFiniteNum(originalBytes) ||
        !isFiniteNum(optimizedBytes) ||
        originalBytes <= 0 ||
        optimizedBytes < 0
    ) {
        return null;
    }
    const pct = isFiniteNum(savingsPct)
        ? savingsPct
        : ((originalBytes - optimizedBytes) / originalBytes) * 100;
    const pctStr =
        pct > 0 ? `-${pct.toFixed(1)}%` : pct < 0 ? `+${Math.abs(pct).toFixed(1)}%` : '0.0%';
    return `ORIG ${formatCasBytes(originalBytes)} -> CAS ${formatCasBytes(optimizedBytes)} (${pctStr})`;
}

function buildSafeGeoFix(
    asset: StockpileAsset,
    activeMeas: StockpileMeasurement | null
): CanonicalGeoFix | null {
    const tryBuild = (params: {
        lat?: unknown;
        lng?: unknown;
        altitudeM?: number | null;
        accuracyM?: number | null;
        capturedAt?: string;
        source: GeoCaptureSource;
    }): CanonicalGeoFix | null => {
        if (
            !isFiniteNum(params.lat) ||
            !isFiniteNum(params.lng) ||
            params.lat < -80 ||
            params.lat > 84 ||
            params.lng < -180 ||
            params.lng > 180 ||
            (params.lat === 0 && params.lng === 0)
        ) {
            return null;
        }
        try {
            return buildCanonicalGeoFix({
                lat: params.lat,
                lng: params.lng,
                altitudeM: params.altitudeM ?? null,
                accuracyM: params.accuracyM ?? null,
                capturedAt: params.capturedAt,
                source: params.source,
            });
        } catch {
            return null;
        }
    };

    if (activeMeas?.location_metadata) {
        const fix = tryBuild({
            lat: activeMeas.location_metadata.lat,
            lng: activeMeas.location_metadata.lng,
            altitudeM: asset.geo_point?.altitude ?? null,
            accuracyM: isFiniteNum(activeMeas.location_metadata.accuracy)
                ? activeMeas.location_metadata.accuracy
                : null,
            capturedAt: new Date(activeMeas.timestamp).toISOString(),
            source: activeMeas.method === 'manual' ? 'MANUAL_INPUT' : 'CAPACITOR_GNSS',
        });
        if (fix) return fix;
    }

    if (asset.geo_point) {
        const fix = tryBuild({
            lat: asset.geo_point.latitude,
            lng: asset.geo_point.longitude,
            altitudeM: asset.geo_point.altitude ?? null,
            accuracyM: isFiniteNum(asset.geo_point.accuracy) ? asset.geo_point.accuracy : null,
            capturedAt: asset.createdAt ? new Date(asset.createdAt).toISOString() : undefined,
            source: isFiniteNum(asset.geo_point.accuracy) ? 'WEB_GEOLOCATION' : 'MANUAL_INPUT',
        });
        if (fix) return fix;
    }

    if (asset.location) {
        return tryBuild({
            lat: asset.location.lat,
            lng: asset.location.lng,
            altitudeM: asset.geo_point?.altitude ?? null,
            source: 'MANUAL_INPUT',
        });
    }

    return null;
}

function getGeometryModel(
    asset: StockpileAsset,
    activeMeas: StockpileMeasurement | null
): string | null {
    const raw =
        activeMeas?.geometry?.type ||
        asset.last_geometry_type ||
        asset.geometria ||
        null;
    if (!raw || !String(raw).trim()) return null;
    return String(raw).trim();
}

function readDim(dims: Record<string, number> | undefined, keys: string[]): number | null {
    if (!dims) return null;
    for (const k of keys) {
        const val = dims[k];
        if (isFiniteNum(val) && val > 0) return val;
    }
    return null;
}

function formatDateIsoShort(ts: unknown): string {
    if (!isFiniteNum(ts)) return '-';
    try {
        return new Date(ts).toISOString().slice(0, 10);
    } catch {
        return '-';
    }
}

function buildSafeFilename(asset: StockpileAsset, explicit?: string): string {
    if (explicit && explicit.trim()) {
        const clean = sanitizePdfText(explicit.trim()).replace(/[^a-zA-Z0-9._-]/g, '_');
        return clean.toLowerCase().endsWith('.pdf') ? clean : `${clean}.pdf`;
    }
    const baseName = sanitizePdfText(asset.name || asset.id || 'STOCKPILE')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'STOCKPILE';
    const dateStamp = new Date().toISOString().slice(0, 10);
    return `GEOLAPP_${baseName}_${dateStamp}.pdf`;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function uint8ArrayToBase64(bytes: Uint8Array): string {
    if (typeof btoa === 'function') {
        const chunkSize = 0x8000;
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const slice = bytes.subarray(i, i + chunkSize);
            chunks.push(String.fromCharCode(...slice));
        }
        return btoa(chunks.join(''));
    }
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const hasB1 = i + 1 < bytes.length;
        const hasB2 = i + 2 < bytes.length;
        const b1 = hasB1 ? bytes[i + 1] : 0;
        const b2 = hasB2 ? bytes[i + 2] : 0;
        const triplet = (b0 << 16) | (b1 << 8) | b2;
        out += BASE64_ALPHABET[(triplet >> 18) & 0x3f];
        out += BASE64_ALPHABET[(triplet >> 12) & 0x3f];
        out += hasB1 ? BASE64_ALPHABET[(triplet >> 6) & 0x3f] : '=';
        out += hasB2 ? BASE64_ALPHABET[triplet & 0x3f] : '=';
    }
    return out;
}

interface FontSet {
    regular: PDFFont;
    bold: PDFFont;
    mono: PDFFont;
    monoBold: PDFFont;
}

class VectorPdfCursor {
    public pages: PDFPage[] = [];
    public currentPage!: PDFPage;
    public y = TOP_Y;

    constructor(
        private readonly doc: PDFDocument,
        private readonly fonts: FontSet,
        private readonly copy: PdfCopy,
        private readonly assetCode: string,
        private readonly emittedIso: string
    ) {
        this.addPage(false);
    }

    public addPage(isContinuation: boolean): PDFPage {
        const page = this.doc.addPage(PageSizes.A4);
        this.pages.push(page);
        this.currentPage = page;
        this.y = TOP_Y;
        if (isContinuation) {
            this.drawContinuationHeader();
        }
        return page;
    }

    public ensureSpace(neededHeight: number): void {
        if (this.y - neededHeight < BOTTOM_Y) {
            this.addPage(true);
        }
    }

    private drawContinuationHeader(): void {
        const p = this.currentPage;
        p.drawRectangle({
            x: MARGIN_X,
            y: this.y - 24,
            width: CONTENT_W,
            height: 24,
            color: COLOR_SURFACE,
            borderColor: COLOR_INK,
            borderWidth: 0.75,
        });
        drawSafeText(
            p,
            `${this.copy.brandTitle} | ${this.copy.certificateTitle} (${this.copy.continuationSuffix})`,
            { font: this.fonts.bold, size: 8, x: MARGIN_X + 8, y: this.y - 15, color: COLOR_INK }
        );
        const rightTag = `${this.assetCode} | ${this.emittedIso}`;
        const rightW = measureSafeWidth(this.fonts.mono, rightTag, 7.5);
        drawSafeText(p, rightTag, {
            font: this.fonts.mono,
            size: 7.5,
            x: PAGE_W - MARGIN_X - 8 - rightW,
            y: this.y - 15,
            color: COLOR_MUTED,
        });
        this.y -= 34;
    }

    public drawSectionTitle(title: string): void {
        this.ensureSpace(28);
        const p = this.currentPage;
        p.drawRectangle({
            x: MARGIN_X,
            y: this.y - 18,
            width: CONTENT_W,
            height: 18,
            color: COLOR_INK,
        });
        p.drawRectangle({
            x: MARGIN_X,
            y: this.y - 18,
            width: 4,
            height: 18,
            color: COLOR_COPPER,
        });
        drawSafeText(p, title, {
            font: this.fonts.bold,
            size: 8.5,
            x: MARGIN_X + 10,
            y: this.y - 12.5,
            color: COLOR_WHITE,
        });
        this.y -= 20;
    }

    public drawKeyValueGrid(
        cells: Array<{ label: string; value: string; mono?: boolean; accent?: 'copper' | 'cyan' | 'alert' }>,
        columns = 2
    ): void {
        const colW = CONTENT_W / columns;
        for (let i = 0; i < cells.length; i += columns) {
            const rowCells = cells.slice(i, i + columns);
            const cellLayouts = rowCells.map((cell) => {
                const font = cell.mono ? this.fonts.monoBold : this.fonts.bold;
                const lines = wrapTextLines(cell.value, font, 8.5, colW - 14);
                return { cell, font, lines };
            });
            const maxLines = Math.max(1, ...cellLayouts.map((c) => c.lines.length));
            const rowH = 16 + maxLines * 10.5;
            this.ensureSpace(rowH + 2);

            const p = this.currentPage;
            rowCells.forEach((_, idx) => {
                const layout = cellLayouts[idx];
                const cellX = MARGIN_X + idx * colW;
                p.drawRectangle({
                    x: cellX,
                    y: this.y - rowH,
                    width: colW,
                    height: rowH,
                    color: COLOR_WHITE,
                    borderColor: COLOR_BORDER,
                    borderWidth: 0.6,
                });
                drawSafeText(p, layout.cell.label, {
                    font: this.fonts.bold,
                    size: 6.5,
                    x: cellX + 7,
                    y: this.y - 10,
                    color: COLOR_MUTED,
                });

                const valueColor =
                    layout.cell.accent === 'copper'
                        ? COLOR_COPPER
                        : layout.cell.accent === 'cyan'
                          ? COLOR_CYAN
                          : layout.cell.accent === 'alert'
                            ? COLOR_ALERT_INK
                            : COLOR_INK;

                layout.lines.forEach((line, lineIdx) => {
                    drawSafeText(p, line, {
                        font: layout.font,
                        size: 8.5,
                        x: cellX + 7,
                        y: this.y - 21 - lineIdx * 10.5,
                        color: valueColor,
                    });
                });
            });
            this.y -= rowH;
        }
        this.y -= 8;
    }

    public stampFooters(): void {
        const total = this.pages.length;
        this.pages.forEach((page, idx) => {
            const footerY = 26;
            page.drawLine({
                start: { x: MARGIN_X, y: footerY + 10 },
                end: { x: PAGE_W - MARGIN_X, y: footerY + 10 },
                thickness: 0.75,
                color: COLOR_INK,
            });
            drawSafeText(page, this.copy.footerText, {
                font: this.fonts.mono,
                size: 7,
                x: MARGIN_X,
                y: footerY,
                color: COLOR_MUTED,
            });
            const pageStr = `${this.copy.pageLabel} ${idx + 1} / ${total}`;
            const pageW = measureSafeWidth(this.fonts.monoBold, pageStr, 7.5);
            drawSafeText(page, pageStr, {
                font: this.fonts.monoBold,
                size: 7.5,
                x: PAGE_W - MARGIN_X - pageW,
                y: footerY,
                color: COLOR_INK,
            });
        });
    }
}

/**
 * Genera el Certificado Técnico Vectorial A4 de GEOLAPP® en memoria mediante `pdf-lib`
 * (sin captura raster de DOM). Compatible con Node y Browser/Capacitor.
 */
export async function generateGeolappVectorPdf(
    asset: StockpileAsset,
    measurements: StockpileMeasurement[],
    options?: GeolappVectorPdfOptions
): Promise<GeolappVectorPdfResult> {
    const locale = resolveLocale(options?.locale);
    const copy = PDF_COPY[locale];
    const emittedIso = new Date().toISOString();

    const sortedMeasurements = [...(measurements || [])].sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
    );
    const activeMeas =
        sortedMeasurements.find((m) => !m.ignored) || sortedMeasurements[0] || null;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(sanitizePdfText(`${copy.brandTitle} - ${asset.name || asset.id}`));
    pdfDoc.setAuthor(sanitizePdfText(options?.authorEmail || asset.createdBy || 'MINREPORT'));
    pdfDoc.setSubject(sanitizePdfText(copy.certificateTitle));
    pdfDoc.setProducer('MINREPORT GEOLAPP Vector PDF Engine (pdf-lib)');
    pdfDoc.setCreator('MINREPORT southamerica-west1');

    const fonts: FontSet = {
        regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
        bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
        mono: await pdfDoc.embedFont(StandardFonts.Courier),
        monoBold: await pdfDoc.embedFont(StandardFonts.CourierBold),
    };

    const assetCode = sanitizePdfText(asset.id || copy.undeclared);
    const cursor = new VectorPdfCursor(pdfDoc, fonts, copy, assetCode, emittedIso);

    // ── ENCABEZADO SOBERANO ───────────────────────────────────────────────────
    const headerH = 74;
    const p0 = cursor.currentPage;
    p0.drawRectangle({
        x: MARGIN_X,
        y: cursor.y - headerH,
        width: CONTENT_W,
        height: headerH,
        color: COLOR_SURFACE,
        borderColor: COLOR_INK,
        borderWidth: 1,
    });
    p0.drawRectangle({
        x: MARGIN_X,
        y: cursor.y - 5,
        width: CONTENT_W,
        height: 5,
        color: COLOR_COPPER,
    });

    drawSafeText(p0, copy.brandTitle, {
        font: fonts.monoBold,
        size: 11,
        x: MARGIN_X + 10,
        y: cursor.y - 22,
        color: COLOR_COPPER,
    });
    drawSafeText(p0, copy.certificateTitle, {
        font: fonts.bold,
        size: 13,
        x: MARGIN_X + 10,
        y: cursor.y - 39,
        color: COLOR_INK,
    });
    drawSafeText(
        p0,
        `${copy.assetId}: ${assetCode}  |  ${copy.emittedAt}: ${emittedIso}`,
        {
            font: fonts.mono,
            size: 7.5,
            x: MARGIN_X + 10,
            y: cursor.y - 55,
            color: COLOR_MUTED,
        }
    );
    drawSafeText(
        p0,
        `REGION: ${copy.sovereignRegion}  |  TENANT: ${sanitizePdfText(asset.tenantId || asset.accountId, copy.undeclared)}`,
        {
            font: fonts.mono,
            size: 7.5,
            x: MARGIN_X + 10,
            y: cursor.y - 66,
            color: COLOR_MUTED,
        }
    );

    const regionTag = copy.sovereignRegion;
    const regionW = measureSafeWidth(fonts.monoBold, regionTag, 8);
    p0.drawRectangle({
        x: PAGE_W - MARGIN_X - regionW - 22,
        y: cursor.y - 26,
        width: regionW + 14,
        height: 16,
        color: COLOR_INK,
    });
    drawSafeText(p0, regionTag, {
        font: fonts.monoBold,
        size: 8,
        x: PAGE_W - MARGIN_X - regionW - 15,
        y: cursor.y - 21,
        color: COLOR_WHITE,
    });

    cursor.y -= headerH + 10;

    cursor.drawKeyValueGrid(
        [
            {
                label: copy.assetName,
                value: sanitizePdfText(asset.name, copy.undeclared),
            },
            {
                label: copy.materialClass,
                value: sanitizePdfText(asset.clase?.toUpperCase(), copy.undeclared),
                mono: true,
            },
            {
                label: copy.locationRef,
                value: sanitizePdfText(asset.location_ref, copy.undeclared),
            },
            {
                label: copy.authorLabel,
                value: sanitizePdfText(options?.authorEmail || asset.createdBy, copy.undeclared),
                mono: true,
            },
        ],
        2
    );

    // ── BLOQUE 01: GEOESPACIAL ────────────────────────────────────────────────
    const geoFix = buildSafeGeoFix(asset, activeMeas);
    cursor.drawSectionTitle(copy.geospatialHeader);
    cursor.drawKeyValueGrid(
        [
            {
                label: copy.utmZoneBand,
                value: geoFix ? `${String(geoFix.utm.zone).padStart(2, '0')}${geoFix.utm.band}` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.hemisphere,
                value: geoFix ? `${geoFix.utm.hemisphere} (${geoFix.utm.epsg} / ${geoFix.utm.datum})` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.easting,
                value: geoFix ? `${geoFix.utm.eastingM.toFixed(2)} m` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.northing,
                value: geoFix ? `${geoFix.utm.northingM.toFixed(2)} m` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.altitude,
                value:
                    geoFix && isFiniteNum(geoFix.altitudeM)
                        ? `${geoFix.altitudeM.toFixed(1)} m`
                        : isFiniteNum(asset.geo_point?.altitude)
                          ? `${asset.geo_point.altitude.toFixed(1)} m`
                          : copy.undeclared,
                mono: true,
            },
            {
                label: copy.latLon,
                value: geoFix ? `${geoFix.lat.toFixed(6)}, ${geoFix.lng.toFixed(6)}` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.accuracy,
                value:
                    geoFix && isFiniteNum(geoFix.accuracyM)
                        ? `+/- ${geoFix.accuracyM.toFixed(1)} m (${geoFix.source})`
                        : copy.undeclared,
                mono: true,
            },
        ],
        2
    );

    // ── BLOQUE 02: GEOMETRÍA Y VOLUMETRÍA ─────────────────────────────────────
    const geometryModel = getGeometryModel(asset, activeMeas);
    const dims = activeMeas?.geometry?.dimensions;
    const axisA = readDim(dims, ['a', 'baseLengthM', 'lengthM', 'l']);
    const axisB = readDim(dims, ['b', 'baseWidthM', 'widthFromWallM', 'w']);
    const axisAp = firstFinite(activeMeas?.crest_length_m, readDim(dims, ['ap', 'crestLengthM', 'crest_length_m']));
    const axisBp = firstFinite(activeMeas?.crest_width_m, readDim(dims, ['bp', 'crestWidthM', 'crest_width_m']));
    const perimBase = readDim(dims, ['p', 'perimeterBaseM']);
    const perimTop = readDim(dims, ['pp', 'perimeterTopM']);
    const wallAngle = firstFinite(activeMeas?.wall_angle_deg, readDim(dims, ['wallAngleDeg', 'wall_angle_deg']));
    const geomHeight = readDim(dims, ['h', 'heightM', 'heightAtWallM']);

    const volumeM3 = firstFinitePositive(
        activeMeas?.volumen_m3,
        asset.last_volume_m3,
        asset.volume_m3,
        asset.volumen
    );
    const derivedMeasDensity =
        activeMeas && isFiniteNum(activeMeas.peso_t) && activeMeas.peso_t > 0 && activeMeas.volumen_m3 > 0
            ? activeMeas.peso_t / activeMeas.volumen_m3
            : null;
    const derivedAssetDensity =
        isFiniteNum(asset.last_weight_t) &&
        isFiniteNum(asset.last_volume_m3) &&
        asset.last_weight_t > 0 &&
        asset.last_volume_m3 > 0
            ? asset.last_weight_t / asset.last_volume_m3
            : null;
    const densityFactor = firstFinitePositive(
        activeMeas?.density_factor,
        derivedMeasDensity,
        asset.density_factor,
        asset.factor_real,
        derivedAssetDensity
    );

    const hasImuClinometer =
        isFiniteNum(activeMeas?.imu_pitch_deg) ||
        isFiniteNum(activeMeas?.imu_height_m) ||
        isFiniteNum(activeMeas?.imu_distance_m);
    const imuSummary = hasImuClinometer
        ? [
              isFiniteNum(activeMeas?.imu_pitch_deg) ? `${activeMeas.imu_pitch_deg.toFixed(1)} deg` : '--',
              isFiniteNum(activeMeas?.imu_distance_m) ? `D=${activeMeas.imu_distance_m.toFixed(2)} m` : '--',
              isFiniteNum(activeMeas?.imu_eye_height_m) ? `Ojo=${activeMeas.imu_eye_height_m.toFixed(2)} m` : '--',
              isFiniteNum(activeMeas?.imu_height_m) ? `H_imu=${activeMeas.imu_height_m.toFixed(2)} m` : '',
          ]
              .filter(Boolean)
              .join(' | ')
        : copy.undeclared;

    cursor.drawSectionTitle(copy.geometryHeader);
    cursor.drawKeyValueGrid(
        [
            {
                label: copy.geometryModel,
                value: geometryModel || copy.undeclared,
                mono: true,
                accent: 'copper',
            },
            {
                label: copy.captureMethod,
                value: activeMeas?.method ? activeMeas.method.toUpperCase() : copy.undeclared,
                mono: true,
            },
            {
                label: copy.majorAxisOrLength,
                value: axisA !== null ? `${axisA.toFixed(2)} m` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.minorAxisOrWidth,
                value: axisB !== null ? `${axisB.toFixed(2)} m` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.topOrCrest,
                value:
                    axisAp !== null || axisBp !== null
                        ? `${axisAp !== null ? axisAp.toFixed(2) : '--'} m / ${axisBp !== null ? axisBp.toFixed(2) : '--'} m`
                        : copy.undeclared,
                mono: true,
            },
            {
                label: copy.perimeters,
                value:
                    perimBase !== null || perimTop !== null
                        ? `${perimBase !== null ? perimBase.toFixed(2) : '--'} m / ${perimTop !== null ? perimTop.toFixed(2) : '--'} m`
                        : copy.undeclared,
                mono: true,
            },
            {
                label: copy.height,
                value: geomHeight !== null ? `${geomHeight.toFixed(2)} m` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.wallAngle,
                value: wallAngle !== null ? `${wallAngle.toFixed(1)} deg` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.clinometerImu,
                value: imuSummary,
                mono: true,
            },
            {
                label: copy.volume,
                value: volumeM3 !== null ? `${volumeM3.toFixed(2)} m3` : copy.undeclared,
                mono: true,
                accent: 'copper',
            },
            {
                label: copy.density,
                value: densityFactor !== null ? `${densityFactor.toFixed(3)} t/m3` : copy.undeclared,
                mono: true,
            },
        ],
        2
    );

    // ── BLOQUE 03: TABLA METALÚRGICA COBRE (Cu) ───────────────────────────────
    const activeDomain = (activeMeas?.copper_domain ?? asset.copper_domain ?? null) as CopperMineralDomain | null;
    const thmVal = firstFinite(activeMeas?.wet_weight_thm, asset.wet_weight_thm);
    const moistureVal = firstFinite(activeMeas?.moisture_pct, asset.moisture_pct);
    const tmlVal = firstFinite(activeMeas?.tml_pct, asset.tml_pct);
    const tmsVal = firstFinite(activeMeas?.dry_weight_tms, asset.dry_weight_tms);
    const cuTotalVal = firstFinite(activeMeas?.cu_total_pct, asset.cu_total_pct);
    const cuSolubleVal = firstFinite(activeMeas?.cu_soluble_pct, asset.cu_soluble_pct);
    const rsPct =
        cuSolubleVal !== null && cuTotalVal !== null && cuTotalVal > 0
            ? (cuSolubleVal / cuTotalVal) * 100
            : null;
    const fineCuVal = firstFinite(activeMeas?.fine_cu_t, asset.fine_cu_t);
    const residenceDays = firstFinite(activeMeas?.residence_days, asset.residence_days);
    const romanaWeight = firstFinite(asset.peso_romana);

    cursor.drawSectionTitle(copy.copperHeader);
    cursor.drawKeyValueGrid(
        [
            {
                label: copy.mineralDomain,
                value: activeDomain ? COPPER_DOMAIN_LABELS[activeDomain] || activeDomain : copy.undeclared,
                mono: true,
                accent: 'copper',
            },
            {
                label: copy.thm,
                value: thmVal !== null ? `${thmVal.toFixed(2)} t` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.moisture,
                value: moistureVal !== null ? `${moistureVal.toFixed(2)} %` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.tml,
                value: tmlVal !== null ? `${tmlVal.toFixed(2)} %` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.tms,
                value: tmsVal !== null ? `${tmsVal.toFixed(2)} t` : copy.undeclared,
                mono: true,
                accent: 'cyan',
            },
            {
                label: copy.cuTotal,
                value: cuTotalVal !== null ? `${cuTotalVal.toFixed(3)} %` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.cuSoluble,
                value: cuSolubleVal !== null ? `${cuSolubleVal.toFixed(3)} %` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.rsRatio,
                value: rsPct !== null ? `${rsPct.toFixed(2)} %` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.cuFine,
                value: fineCuVal !== null ? `${fineCuVal.toFixed(3)} t` : copy.undeclared,
                mono: true,
                accent: 'copper',
            },
            {
                label: copy.residenceDays,
                value: residenceDays !== null ? `${Math.round(residenceDays)} d` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.weighbridge,
                value:
                    romanaWeight !== null
                        ? `${romanaWeight.toFixed(2)} t${isFiniteNum(asset.factor_real) ? ` | f=${asset.factor_real.toFixed(3)}` : ''}`
                        : copy.undeclared,
                mono: true,
            },
        ],
        3
    );

    // ── BLOQUE 04: ALERTAS DE GOBERNANZA COBRE (Cu) ───────────────────────────
    const computedGov = calculationEngine.evaluateCopperGovernance({
        copperDomain: activeDomain ?? undefined,
        residenceDays,
        moisturePct: moistureVal,
        tmlLimitPct: tmlVal,
    });

    const mergedAlerts: GeolappPdfGovernanceAlert[] = [];
    const seenAlerts = new Set<string>();
    const pushAlert = (a: { severity: string; message: string; code?: string }) => {
        const cleanMsg = sanitizePdfText(a.message);
        if (!cleanMsg) return;
        const key = `${a.severity.toUpperCase()}::${a.code || cleanMsg}`;
        if (seenAlerts.has(key)) return;
        seenAlerts.add(key);
        const messageWithTag =
            a.code === 'CONCENTRATE_TML_EXCEEDED' && !cleanMsg.toUpperCase().includes('IMSBC')
                ? `${copy.imsbcBlockTag}: ${cleanMsg}`
                : cleanMsg;
        mergedAlerts.push({
            severity: sanitizePdfText(a.severity).toUpperCase(),
            code: a.code,
            message: messageWithTag,
        });
    };

    (options?.governanceAlerts || []).forEach(pushAlert);
    (activeMeas?.copper_governance_alerts || []).forEach((a: CopperGovernanceAlert) => pushAlert(a));
    (asset.copper_governance_alerts || []).forEach((a: CopperGovernanceAlert) => pushAlert(a));
    computedGov.alerts.forEach(pushAlert);

    cursor.drawSectionTitle(copy.alertsHeader);
    if (mergedAlerts.length === 0) {
        cursor.ensureSpace(26);
        const p = cursor.currentPage;
        p.drawRectangle({
            x: MARGIN_X,
            y: cursor.y - 22,
            width: CONTENT_W,
            height: 22,
            color: COLOR_SURFACE,
            borderColor: COLOR_BORDER,
            borderWidth: 0.6,
        });
        drawSafeText(p, copy.noAlerts, {
            font: fonts.mono,
            size: 8,
            x: MARGIN_X + 8,
            y: cursor.y - 14,
            color: COLOR_MUTED,
        });
        cursor.y -= 30;
    } else {
        for (const alert of mergedAlerts) {
            const label = `[${alert.severity}${alert.code ? ` · ${alert.code}` : ''}] ${alert.message}`;
            const lines = wrapTextLines(label, fonts.monoBold, 8, CONTENT_W - 18);
            const boxH = 12 + lines.length * 10.5;
            cursor.ensureSpace(boxH + 4);
            const p = cursor.currentPage;
            const isCritical = alert.severity === 'BLOCK' || alert.severity === 'CRITICAL';
            p.drawRectangle({
                x: MARGIN_X,
                y: cursor.y - boxH,
                width: CONTENT_W,
                height: boxH,
                color: isCritical ? COLOR_ALERT_BG : COLOR_SURFACE,
                borderColor: isCritical ? COLOR_ALERT_INK : COLOR_COPPER,
                borderWidth: 0.9,
            });
            lines.forEach((line, idx) => {
                drawSafeText(p, line, {
                    font: fonts.monoBold,
                    size: 8,
                    x: MARGIN_X + 9,
                    y: cursor.y - 14 - idx * 10.5,
                    color: isCritical ? COLOR_ALERT_INK : COLOR_COPPER,
                });
            });
            cursor.y -= boxH + 4;
        }
        cursor.y -= 6;
    }

    // ── BLOQUE 05: TRAZABILIDAD CAS ───────────────────────────────────────────
    const casTrace =
        formatCasTrace(
            activeMeas?.cas_original_bytes,
            activeMeas?.cas_optimized_bytes,
            activeMeas?.cas_savings_pct
        ) ||
        formatCasTrace(
            asset.cas_original_bytes,
            asset.cas_optimized_bytes,
            asset.cas_savings_pct
        );
    const primaryPhotoRef =
        activeMeas?.photo_url || asset.last_photo_url || asset.initial_photo_url || null;
    const perimeterList =
        (activeMeas?.perimeter_photo_urls?.length
            ? activeMeas.perimeter_photo_urls
            : asset.perimeter_photo_urls) || [];

    cursor.drawSectionTitle(copy.casHeader);
    cursor.drawKeyValueGrid(
        [
            {
                label: copy.casTraceLabel,
                value: casTrace || copy.undeclared,
                mono: true,
                accent: casTrace ? 'cyan' : undefined,
            },
            {
                label: copy.perimeterCountLabel,
                value: perimeterList.length > 0 ? `${perimeterList.length}` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.evidenceRefLabel,
                value: primaryPhotoRef ? sanitizePdfText(primaryPhotoRef) : copy.undeclared,
                mono: true,
            },
        ],
        2
    );

    // ── BLOQUE 06: GEMELO DIGITAL 3D (.glb) Y VOLUMETRÍA TIN ─────────────────
    const tinVolumeM3 = firstFinitePositive(activeMeas?.tin_volume_m3, asset.tin_volume_m3);
    const meshSha256 = activeMeas?.mesh_sha256 || asset.mesh_sha256 || null;
    const meshSource = activeMeas?.mesh_source || asset.mesh_source || null;
    const meshUri = activeMeas?.mesh_url || asset.mesh_url || null;
    const meshCasTrace =
        formatCasTrace(
            activeMeas?.mesh_original_bytes,
            activeMeas?.mesh_optimized_bytes,
            activeMeas?.mesh_savings_pct
        ) ||
        formatCasTrace(
            asset.mesh_original_bytes,
            asset.mesh_optimized_bytes,
            asset.mesh_savings_pct
        );

    cursor.drawSectionTitle(copy.twin3dHeader);
    cursor.drawKeyValueGrid(
        [
            {
                label: copy.tinVolume,
                value: tinVolumeM3 !== null ? `${tinVolumeM3.toFixed(2)} m3` : copy.undeclared,
                mono: true,
                accent: tinVolumeM3 !== null ? 'copper' : undefined,
            },
            {
                label: copy.meshSource,
                value: meshSource ? sanitizePdfText(meshSource) : copy.undeclared,
                mono: true,
            },
            {
                label: copy.meshSha256,
                value: meshSha256 ? sanitizePdfText(meshSha256) : copy.undeclared,
                mono: true,
            },
            {
                label: copy.meshCasTrace,
                value: meshCasTrace || copy.undeclared,
                mono: true,
                accent: meshCasTrace ? 'cyan' : undefined,
            },
            {
                label: copy.meshUri,
                value: meshUri ? sanitizePdfText(meshUri) : copy.undeclared,
                mono: true,
            },
        ],
        2
    );

    // ── BLOQUE 07: GRANULOMETRÍA ROSIN-RAMMLER (P80) Y COLPAS box_2d ─────────
    const rrProfile = activeMeas?.rosin_rammler || asset.rosin_rammler || null;
    const p80Val = firstFinitePositive(rrProfile?.p80_mm, activeMeas?.p80_mm, asset.p80_mm);
    const p50Val =
        rrProfile && isFiniteNum(rrProfile.p50_mm) && rrProfile.p50_mm > 0 ? rrProfile.p50_mm : null;
    const p20Val =
        rrProfile && isFiniteNum(rrProfile.p20_mm) && rrProfile.p20_mm > 0 ? rrProfile.p20_mm : null;
    const xcVal =
        rrProfile && isFiniteNum(rrProfile.xc_mm) && rrProfile.xc_mm > 0 ? rrProfile.xc_mm : null;
    const nVal =
        rrProfile && isFiniteNum(rrProfile.uniformity_n) && rrProfile.uniformity_n > 0
            ? rrProfile.uniformity_n
            : null;
    const boulders: BoulderDetectionBox2D[] =
        (activeMeas?.boulder_detections?.length
            ? activeMeas.boulder_detections
            : asset.boulder_detections) || [];
    const maxObservedBoulderMm = boulders.reduce<number>(
        (acc, b) => (isFiniteNum(b.estimated_mm) && b.estimated_mm > acc ? b.estimated_mm : acc),
        0
    );
    const maxBoulderVal = firstFinitePositive(
        rrProfile?.max_boulder_mm,
        maxObservedBoulderMm > 0 ? maxObservedBoulderMm : null
    );

    cursor.drawSectionTitle(copy.rosinHeader);
    cursor.drawKeyValueGrid(
        [
            {
                label: copy.p80Label,
                value: p80Val !== null ? `${p80Val.toFixed(1)} mm` : copy.undeclared,
                mono: true,
                accent: p80Val !== null ? 'copper' : undefined,
            },
            {
                label: copy.p50Label,
                value: p50Val !== null ? `${p50Val.toFixed(1)} mm` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.p20Label,
                value: p20Val !== null ? `${p20Val.toFixed(1)} mm` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.xcLabel,
                value: xcVal !== null ? `${xcVal.toFixed(1)} mm` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.uniformityNLabel,
                value: nVal !== null ? nVal.toFixed(3) : copy.undeclared,
                mono: true,
                accent: nVal !== null ? 'cyan' : undefined,
            },
            {
                label: copy.oversizeLabel,
                value: rrProfile
                    ? `${rrProfile.oversize_count} (>= ${rrProfile.oversize_threshold_mm.toFixed(0)} mm)`
                    : copy.undeclared,
                mono: true,
            },
            {
                label: copy.rrSourceLabel,
                value: rrProfile?.source ? sanitizePdfText(rrProfile.source) : copy.undeclared,
                mono: true,
            },
            {
                label: copy.boulderCountLabel,
                value: boulders.length > 0 ? `${boulders.length}` : copy.undeclared,
                mono: true,
            },
            {
                label: copy.maxBoulderLabel,
                value: maxBoulderVal !== null ? `${maxBoulderVal.toFixed(1)} mm` : copy.undeclared,
                mono: true,
            },
        ],
        3
    );

    if (boulders.length === 0) {
        cursor.ensureSpace(26);
        const p = cursor.currentPage;
        p.drawRectangle({
            x: MARGIN_X,
            y: cursor.y - 22,
            width: CONTENT_W,
            height: 22,
            color: COLOR_SURFACE,
            borderColor: COLOR_BORDER,
            borderWidth: 0.6,
        });
        drawSafeText(p, copy.noBoulders, {
            font: fonts.mono,
            size: 8,
            x: MARGIN_X + 8,
            y: cursor.y - 14,
            color: COLOR_MUTED,
        });
        cursor.y -= 28;
    } else {
        const bCols = [
            { title: copy.colBoulderIdx, w: 22 },
            { title: copy.colBoulderLabel, w: 88 },
            { title: copy.colBoulderBox, w: 146 },
            { title: copy.colBoulderEstMm, w: 56 },
            { title: copy.colBoulderConf, w: 46 },
            { title: copy.colBoulderCas, w: CONTENT_W - (22 + 88 + 146 + 56 + 46) },
        ];

        const drawBoulderHeader = () => {
            cursor.ensureSpace(18);
            const p = cursor.currentPage;
            p.drawRectangle({
                x: MARGIN_X,
                y: cursor.y - 15,
                width: CONTENT_W,
                height: 15,
                color: COLOR_SURFACE,
                borderColor: COLOR_INK,
                borderWidth: 0.7,
            });
            let bx = MARGIN_X;
            for (const col of bCols) {
                drawSafeText(p, col.title, {
                    font: fonts.monoBold,
                    size: 6.2,
                    x: bx + 3,
                    y: cursor.y - 10.5,
                    color: COLOR_INK,
                });
                bx += col.w;
            }
            cursor.y -= 15;
        };

        drawBoulderHeader();

        const displayedBoulders = boulders.slice(0, 24);
        for (let idx = 0; idx < displayedBoulders.length; idx++) {
            const b = displayedBoulders[idx];
            const rowH = 15;
            if (cursor.y - rowH < BOTTOM_Y) {
                cursor.addPage(true);
                drawBoulderHeader();
            }

            const p = cursor.currentPage;
            p.drawRectangle({
                x: MARGIN_X,
                y: cursor.y - rowH,
                width: CONTENT_W,
                height: rowH,
                color: COLOR_WHITE,
                borderColor: COLOR_BORDER,
                borderWidth: 0.5,
            });

            const boxFmt = Array.isArray(b.box_2d) && b.box_2d.length === 4
                ? `[${b.box_2d.map((v) => Math.round(v)).join(', ')}]`
                : '--';
            const estFmt = isFiniteNum(b.estimated_mm) && b.estimated_mm > 0 ? b.estimated_mm.toFixed(1) : '--';
            const confFmt = isFiniteNum(b.confidence) && b.confidence > 0 ? `${(b.confidence * 100).toFixed(0)}%` : '--';
            const cropCas = formatCasTrace(b.cas_original_bytes, b.cas_optimized_bytes, b.cas_savings_pct);
            const rowVals = [
                String(idx + 1).padStart(2, '0'),
                sanitizePdfText(b.label || 'COLPA'),
                boxFmt,
                estFmt,
                confFmt,
                cropCas || (b.crop_cas_url ? sanitizePdfText(b.crop_cas_url) : '--'),
            ];

            let bx = MARGIN_X;
            rowVals.forEach((val, colIdx) => {
                const cellText = truncateToWidth(val, fonts.mono, 6.2, bCols[colIdx].w - 5);
                drawSafeText(p, cellText, {
                    font: fonts.mono,
                    size: 6.2,
                    x: bx + 3,
                    y: cursor.y - 10.5,
                    color: COLOR_INK,
                });
                bx += bCols[colIdx].w;
            });
            cursor.y -= rowH;
        }
        cursor.y -= 8;
    }

    // ── BLOQUE 08: HISTORIAL DE MEDICIONES (MULTIPÁGINA) ─────────────────────
    cursor.drawSectionTitle(copy.historyHeader);
    if (sortedMeasurements.length === 0) {
        cursor.ensureSpace(26);
        const p = cursor.currentPage;
        p.drawRectangle({
            x: MARGIN_X,
            y: cursor.y - 22,
            width: CONTENT_W,
            height: 22,
            color: COLOR_SURFACE,
            borderColor: COLOR_BORDER,
            borderWidth: 0.6,
        });
        drawSafeText(p, copy.noMeasurements, {
            font: fonts.mono,
            size: 8,
            x: MARGIN_X + 8,
            y: cursor.y - 14,
            color: COLOR_MUTED,
        });
        cursor.y -= 28;
    } else {
        const cols = [
            { title: copy.colDate, w: 54 },
            { title: copy.colMethod, w: 28 },
            { title: copy.colModel, w: 80 },
            { title: copy.colVol, w: 48 },
            { title: copy.colDens, w: 34 },
            { title: copy.colThm, w: 46 },
            { title: copy.colTms, w: 46 },
            { title: copy.colGrade, w: 54 },
            { title: copy.colFine, w: 46 },
            { title: copy.colCas, w: CONTENT_W - (54 + 28 + 80 + 48 + 34 + 46 + 46 + 54 + 46) },
        ];

        const drawTableHeader = () => {
            cursor.ensureSpace(20);
            const p = cursor.currentPage;
            p.drawRectangle({
                x: MARGIN_X,
                y: cursor.y - 16,
                width: CONTENT_W,
                height: 16,
                color: COLOR_SURFACE,
                borderColor: COLOR_INK,
                borderWidth: 0.7,
            });
            let cx = MARGIN_X;
            for (const col of cols) {
                drawSafeText(p, col.title, {
                    font: fonts.monoBold,
                    size: 6.2,
                    x: cx + 3,
                    y: cursor.y - 11,
                    color: COLOR_INK,
                });
                cx += col.w;
            }
            cursor.y -= 16;
        };

        drawTableHeader();

        for (const m of sortedMeasurements) {
            const rowH = 16;
            if (cursor.y - rowH < BOTTOM_Y) {
                cursor.addPage(true);
                drawTableHeader();
            }

            const p = cursor.currentPage;
            p.drawRectangle({
                x: MARGIN_X,
                y: cursor.y - rowH,
                width: CONTENT_W,
                height: rowH,
                color: m.ignored ? COLOR_SURFACE : COLOR_WHITE,
                borderColor: COLOR_BORDER,
                borderWidth: 0.5,
            });

            const mDens = isFiniteNum(m.density_factor) && m.density_factor > 0
                ? m.density_factor
                : m.volumen_m3 > 0 && m.peso_t > 0
                  ? m.peso_t / m.volumen_m3
                  : null;
            const mCas = formatCasTrace(m.cas_original_bytes, m.cas_optimized_bytes, m.cas_savings_pct);
            const mCut = isFiniteNum(m.cu_total_pct) ? m.cu_total_pct.toFixed(2) : '--';
            const mCus = isFiniteNum(m.cu_soluble_pct) ? m.cu_soluble_pct.toFixed(2) : '--';

            const rowValues = [
                formatDateIsoShort(m.timestamp),
                m.ignored ? 'IGN' : (m.method || '-').slice(0, 3).toUpperCase(),
                m.geometry?.type || '-',
                isFiniteNum(m.volumen_m3) ? m.volumen_m3.toFixed(1) : '--',
                mDens !== null ? mDens.toFixed(2) : '--',
                isFiniteNum(m.wet_weight_thm) ? m.wet_weight_thm.toFixed(1) : '--',
                isFiniteNum(m.dry_weight_tms) ? m.dry_weight_tms.toFixed(1) : '--',
                `${mCut}/${mCus}`,
                isFiniteNum(m.fine_cu_t) ? m.fine_cu_t.toFixed(2) : '--',
                mCas || '--',
            ];

            let cx = MARGIN_X;
            rowValues.forEach((val, idx) => {
                const cellText = truncateToWidth(val, fonts.mono, 6.2, cols[idx].w - 5);
                drawSafeText(p, cellText, {
                    font: fonts.mono,
                    size: 6.2,
                    x: cx + 3,
                    y: cursor.y - 11,
                    color: m.ignored ? COLOR_MUTED : COLOR_INK,
                });
                cx += cols[idx].w;
            });

            cursor.y -= rowH;
        }
    }

    cursor.stampFooters();

    const bytes = await pdfDoc.save();
    const safeBytes = new Uint8Array(bytes);
    const filename = buildSafeFilename(asset, options?.filename);
    const blob =
        typeof Blob !== 'undefined'
            ? new Blob([safeBytes], { type: 'application/pdf' })
            : (undefined as unknown as Blob);

    return {
        bytes: safeBytes,
        blob,
        filename,
    };
}

/**
 * Descarga el Certificado Vectorial PDF en Web (`<a download>`) o lo guarda y
 * comparte nativamente en Android Capacitor (`Directory.Documents` + `Directory.Cache` + `Share`).
 */
export async function downloadGeolappVectorPdf(
    asset: StockpileAsset,
    measurements: StockpileMeasurement[],
    options?: GeolappVectorPdfOptions
): Promise<void> {
    const { bytes, blob, filename } = await generateGeolappVectorPdf(asset, measurements, options);

    if (Capacitor.isNativePlatform()) {
        const base64Data = uint8ArrayToBase64(bytes);

        await Filesystem.writeFile({
            path: filename,
            data: base64Data,
            directory: Directory.Documents,
        });

        const shouldShare = options?.share !== false;
        if (shouldShare) {
            const canShareRes = await Share.canShare().catch(() => ({ value: false }));
            if (canShareRes.value) {
                const cachedFile = await Filesystem.writeFile({
                    path: filename,
                    data: base64Data,
                    directory: Directory.Cache,
                });
                try {
                    await Share.share({
                        title: filename,
                        text: sanitizePdfText(`MINREPORT · GEOLAPP(R) - ${asset.name || asset.id}`),
                        url: cachedFile.uri,
                        dialogTitle: filename,
                    });
                } catch (err: unknown) {
                    const msg = String((err as { message?: string })?.message || err || '');
                    if (!/cancel/i.test(msg)) {
                        throw err;
                    }
                }
            }
        }
        return;
    }

    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
        window.URL.revokeObjectURL(url);
    }, 1000);
}

export const generateStockpilePdf = generateGeolappVectorPdf;
export const downloadPDF = downloadGeolappVectorPdf;

// ─── FASE 4: DOSSIER VECTORIAL PARA DOMINIOS GEOCIENTÍFICOS ───

export interface GeolappDomainPdfOptions {
    locale?: string;
    authorEmail?: string;
    companyName?: string;
    faenaName?: string;
    isEduSandbox?: boolean;
    filename?: string;
    uploadToCas?: boolean;
    tenantId?: string;
}

export interface GeolappDomainPdfResult extends GeolappVectorPdfResult {
    casDescriptor?: {
        sha256: string;
        downloadUrl: string;
        originalBytes: number;
        optimizedBytes: number;
        savingsPct: number;
    } | null;
}

interface DomainDossierCopy {
    eduSeal: string;
    domainSectionGeoref: string;
    domainSectionGeomensura: string;
    domainSectionPolygon: string;
    domainSectionExploracion: string;
    domainSectionIntervals: string;
    domainSectionEstructural: string;
    domainSectionHydro: string;
    domainSectionNotesAudit: string;
    domainTitleMap: Record<GeolappDomainRecord['domainMode'], string>;
    codeLabel: string;
    titleLabel: string;
    statusLabel: string;
    siteCompanyLabel: string;
    notesLabel: string;
    auditLabel: string;
}

const DOMAIN_DOSSIER_COPY: Record<PdfLocale, DomainDossierCopy> = {
    es: {
        eduSeal: 'USO ACADEMICO NO COMERCIAL - SANDBOX EDUCATIVO MINREPORT',
        domainSectionGeoref: '01. IDENTIFICACION Y GEORREFERENCIA SIRGAS-CHILE / UTM',
        domainSectionGeomensura: '02. GEOMENSURA TOPOGRAFICA Y VECTOR DE REPLANTEO',
        domainSectionPolygon: '03. POLIGONAL DE MENSURA Y VERTICES UTM',
        domainSectionExploracion: '02. PARAMETROS DE COLLAR, COMPOSITOS Y QA/QC',
        domainSectionIntervals: '03. LOGUEO DE TESTIGOS, TCR / RQD Y LEYES',
        domainSectionEstructural: '02. ACTITUDES ESTRUCTURALES Y RED SCHMIDT (HEMISFERIO INFERIOR)',
        domainSectionHydro: '03. TELEMETRIA HIDROGEOLOGICA Y PIEZOMETRIA',
        domainSectionNotesAudit: '04. OBSERVACIONES TECNICAS Y TRAZABILIDAD DE AUDITORIA',
        domainTitleMap: {
            GEOMENSURA_GEO: 'DOSSIER DE GEOMENSURA TOPOGRAFICA UTM',
            EXPLORACION_SONDAJES: 'DOSSIER DE EXPLORACION Y LOGUEO DE SONDAJES',
            ESTRUCTURAL_HIDRO: 'DOSSIER ESTRUCTURAL E HIDROGEOLOGICO DE MACIZO',
        },
        codeLabel: 'CODIGO REGISTRO',
        titleLabel: 'TITULO TECNICO',
        statusLabel: 'ESTADO',
        siteCompanyLabel: 'ORGANIZACION / FAENA',
        notesLabel: 'NOTAS DE CAMPO',
        auditLabel: 'AUDITORIA REGISTRO',
    },
    en: {
        eduSeal: 'ACADEMIC NON-COMMERCIAL USE - MINREPORT EDUCATIONAL SANDBOX',
        domainSectionGeoref: '01. IDENTIFICATION AND SIRGAS-CHILE / UTM GEOREFERENCE',
        domainSectionGeomensura: '02. TOPOGRAPHIC SURVEY AND STAKEOUT VECTOR',
        domainSectionPolygon: '03. SURVEY POLYGON AND UTM VERTICES',
        domainSectionExploracion: '02. DRILLHOLE COLLAR, COMPOSITES AND QA/QC',
        domainSectionIntervals: '03. CORE LOGGING, TCR / RQD AND GRADES',
        domainSectionEstructural: '02. STRUCTURAL ATTITUDES AND SCHMIDT NET (LOWER HEMISPHERE)',
        domainSectionHydro: '03. HYDROGEOLOGY AND PIEZOMETER TELEMETRY',
        domainSectionNotesAudit: '04. TECHNICAL NOTES AND AUDIT TRACEABILITY',
        domainTitleMap: {
            GEOMENSURA_GEO: 'UTM TOPOGRAPHIC GEOMENSURA DOSSIER',
            EXPLORACION_SONDAJES: 'EXPLORATION AND DRILLHOLE LOGGING DOSSIER',
            ESTRUCTURAL_HIDRO: 'ROCK MASS STRUCTURAL AND HYDROGEOLOGY DOSSIER',
        },
        codeLabel: 'RECORD CODE',
        titleLabel: 'TECHNICAL TITLE',
        statusLabel: 'STATUS',
        siteCompanyLabel: 'ORGANIZATION / SITE',
        notesLabel: 'FIELD NOTES',
        auditLabel: 'RECORD AUDIT',
    },
    pt: {
        eduSeal: 'USO ACADEMICO NAO COMERCIAL - SANDBOX EDUCACIONAL MINREPORT',
        domainSectionGeoref: '01. IDENTIFICACAO E GEORREFERENCIAMENTO SIRGAS-CHILE / UTM',
        domainSectionGeomensura: '02. GEOMENSURA TOPOGRAFICA E VETOR DE LOCACAO',
        domainSectionPolygon: '03. POLIGONAL DE MEDICAO E VERTICES UTM',
        domainSectionExploracion: '02. COLAR DO FURO, COMPOSTOS E QA/QC',
        domainSectionIntervals: '03. DESCRICAO DE TESTEMUNHOS, TCR / RQD E TEORES',
        domainSectionEstructural: '02. ATITUDES ESTRUTURAIS E REDE SCHMIDT (HEMISFERIO INFERIOR)',
        domainSectionHydro: '03. TELEMETRIA HIDROGEOLOGICA E PIEZOMETRIA',
        domainSectionNotesAudit: '04. OBSERVACOES TECNICAS E RASTREABILIDADE DE AUDITORIA',
        domainTitleMap: {
            GEOMENSURA_GEO: 'DOSSIE DE GEOMENSURA TOPOGRAFICA UTM',
            EXPLORACION_SONDAJES: 'DOSSIE DE EXPLORACAO E LOGAGEM DE SONDAGENS',
            ESTRUCTURAL_HIDRO: 'DOSSIE ESTRUTURAL E HIDROGEOLOGICO DE MACICO',
        },
        codeLabel: 'CODIGO REGISTRO',
        titleLabel: 'TITULO TECNICO',
        statusLabel: 'ESTADO',
        siteCompanyLabel: 'ORGANIZACAO / UNIDADE',
        notesLabel: 'NOTAS DE CAMPO',
        auditLabel: 'AUDITORIA REGISTRO',
    },
};

function buildDomainPdfFilename(record: GeolappDomainRecord, explicit?: string): string {
    if (explicit && explicit.trim()) {
        const clean = sanitizePdfText(explicit.trim()).replace(/[^a-zA-Z0-9._-]/g, '_');
        return clean.toLowerCase().endsWith('.pdf') ? clean : `${clean}.pdf`;
    }
    const cleanCode =
        sanitizePdfText(record.code || record.id || 'RECORD')
            .replace(/[^a-zA-Z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40) || 'RECORD';
    const dateStamp = new Date().toISOString().slice(0, 10);
    return `GEOLAPP_${record.domainMode}_${cleanCode}_${dateStamp}.pdf`;
}

function drawVectorTableHeader(
    cursor: VectorPdfCursor,
    fonts: FontSet,
    cols: Array<{ title: string; w: number }>
): void {
    cursor.ensureSpace(22);
    const p = cursor.currentPage;
    p.drawRectangle({
        x: MARGIN_X,
        y: cursor.y - 16,
        width: CONTENT_W,
        height: 16,
        color: COLOR_SURFACE,
        borderColor: COLOR_INK,
        borderWidth: 0.7,
    });
    let cx = MARGIN_X;
    for (const col of cols) {
        drawSafeText(p, col.title, {
            font: fonts.monoBold,
            size: 6.3,
            x: cx + 3,
            y: cursor.y - 11,
            color: COLOR_INK,
        });
        cx += col.w;
    }
    cursor.y -= 16;
}

function drawVectorTableRow(
    cursor: VectorPdfCursor,
    fonts: FontSet,
    cols: Array<{ title: string; w: number }>,
    values: string[],
    shaded = false
): void {
    const rowH = 16;
    if (cursor.y - rowH < BOTTOM_Y) {
        cursor.addPage(true);
        drawVectorTableHeader(cursor, fonts, cols);
    }
    const p = cursor.currentPage;
    p.drawRectangle({
        x: MARGIN_X,
        y: cursor.y - rowH,
        width: CONTENT_W,
        height: rowH,
        color: shaded ? COLOR_SURFACE : COLOR_WHITE,
        borderColor: COLOR_BORDER,
        borderWidth: 0.5,
    });
    let cx = MARGIN_X;
    values.forEach((val, idx) => {
        const safeCell = truncateToWidth(
            sanitizePdfText(val, '--'),
            fonts.mono,
            6.2,
            cols[idx].w - 5
        );
        drawSafeText(p, safeCell, {
            font: fonts.mono,
            size: 6.2,
            x: cx + 3,
            y: cursor.y - 11,
            color: COLOR_INK,
        });
        cx += cols[idx].w;
    });
    cursor.y -= rowH;
}

function drawStructuralStereonetBlock(
    cursor: VectorPdfCursor,
    fonts: FontSet,
    planes: EstructuralHidroPayload['planes']
): void {
    const boxH = 148;
    cursor.ensureSpace(boxH + 8);
    const p = cursor.currentPage;
    p.drawRectangle({
        x: MARGIN_X,
        y: cursor.y - boxH,
        width: CONTENT_W,
        height: boxH,
        color: COLOR_WHITE,
        borderColor: COLOR_BORDER,
        borderWidth: 0.75,
    });

    const netR = 54;
    const netCx = MARGIN_X + 86;
    const netCy = cursor.y - boxH / 2;

    p.drawCircle({
        x: netCx,
        y: netCy,
        size: netR,
        borderColor: COLOR_INK,
        borderWidth: 1,
        color: COLOR_SURFACE,
    });
    p.drawCircle({
        x: netCx,
        y: netCy,
        size: netR * 0.5,
        borderColor: COLOR_BORDER,
        borderWidth: 0.5,
    });
    p.drawLine({
        start: { x: netCx - netR, y: netCy },
        end: { x: netCx + netR, y: netCy },
        color: COLOR_BORDER,
        thickness: 0.6,
    });
    p.drawLine({
        start: { x: netCx, y: netCy - netR },
        end: { x: netCx, y: netCy + netR },
        color: COLOR_BORDER,
        thickness: 0.6,
    });

    drawSafeText(p, 'N', {
        font: fonts.monoBold,
        size: 7.5,
        x: netCx - 2.5,
        y: netCy + netR + 4,
        color: COLOR_INK,
    });
    drawSafeText(p, 'S', {
        font: fonts.monoBold,
        size: 7.5,
        x: netCx - 2.5,
        y: netCy - netR - 10,
        color: COLOR_INK,
    });
    drawSafeText(p, 'E', {
        font: fonts.monoBold,
        size: 7.5,
        x: netCx + netR + 4,
        y: netCy - 2.5,
        color: COLOR_INK,
    });
    drawSafeText(p, 'W', {
        font: fonts.monoBold,
        size: 7.5,
        x: netCx - netR - 11,
        y: netCy - 2.5,
        color: COLOR_INK,
    });

    planes.forEach((plane) => {
        const pt = projectEqualAreaPole(plane.dipDeg, plane.dipDirectionDeg, netR);
        // En PDF, Y crece hacia arriba mientras que SVG Y crece hacia abajo: y_pdf = netCy - pt.y
        p.drawCircle({
            x: netCx + pt.x,
            y: netCy - pt.y,
            size: 2.6,
            color: COLOR_COPPER,
            borderColor: COLOR_INK,
            borderWidth: 0.5,
        });
    });

    const summaryX = MARGIN_X + 178;
    drawSafeText(p, 'SCHMIDT EQUAL-AREA POLE PROJECTION', {
        font: fonts.monoBold,
        size: 8.5,
        x: summaryX,
        y: cursor.y - 26,
        color: COLOR_INK,
    });
    drawSafeText(p, `MEASURED PLANES: ${planes.length}  |  CONVENTION: DIP / DIP-DIR (RHR)`, {
        font: fonts.mono,
        size: 7.5,
        x: summaryX,
        y: cursor.y - 42,
        color: COLOR_MUTED,
    });
    drawSafeText(p, 'COPPER MARKERS: NORMAL POLES IN LOWER HEMISPHERE', {
        font: fonts.mono,
        size: 7.2,
        x: summaryX,
        y: cursor.y - 56,
        color: COLOR_COPPER,
    });

    cursor.y -= boxH + 6;
}

/**
 * Genera el Dossier Técnico Vectorial A4 (`pdf-lib`) para registros geocientíficos Fase 4
 * (`GEOMENSURA_GEO`, `EXPLORACION_SONDAJES`, `ESTRUCTURAL_HIDRO`).
 */
export async function generateGeolappDomainDossierPdf(
    record: GeolappDomainRecord,
    options?: GeolappDomainPdfOptions
): Promise<GeolappDomainPdfResult> {
    const locale = resolveLocale(options?.locale);
    const baseCopy = PDF_COPY[locale];
    const domainCopy = DOMAIN_DOSSIER_COPY[locale];
    const domainTitle = domainCopy.domainTitleMap[record.domainMode];
    const dossierCopy: PdfCopy = {
        ...baseCopy,
        certificateTitle: domainTitle,
        assetId: domainCopy.codeLabel,
    };

    const emittedIso = new Date().toISOString();
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(sanitizePdfText(`${baseCopy.brandTitle} - ${record.code} - ${record.title}`));
    pdfDoc.setAuthor(sanitizePdfText(options?.authorEmail || record.createdBy || 'MINREPORT'));
    pdfDoc.setSubject(sanitizePdfText(domainTitle));
    pdfDoc.setProducer('MINREPORT GEOLAPP Vector PDF Engine (pdf-lib)');
    pdfDoc.setCreator('MINREPORT southamerica-west1');

    const fonts: FontSet = {
        regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
        bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
        mono: await pdfDoc.embedFont(StandardFonts.Courier),
        monoBold: await pdfDoc.embedFont(StandardFonts.CourierBold),
    };

    const recordCode = sanitizePdfText(record.code || record.id, baseCopy.undeclared);
    const cursor = new VectorPdfCursor(pdfDoc, fonts, dossierCopy, recordCode, emittedIso);

    // ── ENCABEZADO CO-BRANDEADO ───────────────────────────────────────────────
    const headerH = options?.isEduSandbox ? 88 : 74;
    const p0 = cursor.currentPage;
    p0.drawRectangle({
        x: MARGIN_X,
        y: cursor.y - headerH,
        width: CONTENT_W,
        height: headerH,
        color: COLOR_SURFACE,
        borderColor: COLOR_INK,
        borderWidth: 1,
    });
    p0.drawRectangle({
        x: MARGIN_X,
        y: cursor.y - 5,
        width: CONTENT_W,
        height: 5,
        color: COLOR_COPPER,
    });

    const coBrandRight = [options?.companyName, options?.faenaName]
        .filter((v): v is string => Boolean(v && v.trim()))
        .map((v) => sanitizePdfText(v))
        .join(' / ');
    const brandHeader = coBrandRight
        ? `${baseCopy.brandTitle}  //  ${coBrandRight}`
        : baseCopy.brandTitle;

    drawSafeText(p0, truncateToWidth(brandHeader, fonts.monoBold, 10.5, CONTENT_W - 150), {
        font: fonts.monoBold,
        size: 10.5,
        x: MARGIN_X + 10,
        y: cursor.y - 22,
        color: COLOR_COPPER,
    });
    drawSafeText(p0, domainTitle, {
        font: fonts.bold,
        size: 12.5,
        x: MARGIN_X + 10,
        y: cursor.y - 38,
        color: COLOR_INK,
    });
    drawSafeText(
        p0,
        `${domainCopy.codeLabel}: ${recordCode}  |  ${baseCopy.emittedAt}: ${emittedIso}`,
        {
            font: fonts.mono,
            size: 7.4,
            x: MARGIN_X + 10,
            y: cursor.y - 53,
            color: COLOR_MUTED,
        }
    );
    drawSafeText(
        p0,
        `REGION: ${baseCopy.sovereignRegion}  |  TENANT: ${sanitizePdfText(record.tenantId || record.accountId, baseCopy.undeclared)}`,
        {
            font: fonts.mono,
            size: 7.4,
            x: MARGIN_X + 10,
            y: cursor.y - 64,
            color: COLOR_MUTED,
        }
    );

    if (options?.isEduSandbox) {
        p0.drawRectangle({
            x: MARGIN_X + 10,
            y: cursor.y - 83,
            width: CONTENT_W - 20,
            height: 14,
            color: COLOR_INK,
        });
        drawSafeText(p0, domainCopy.eduSeal, {
            font: fonts.monoBold,
            size: 7,
            x: MARGIN_X + 15,
            y: cursor.y - 79,
            color: COLOR_WHITE,
        });
    }

    const regionW = measureSafeWidth(fonts.monoBold, baseCopy.sovereignRegion, 8);
    p0.drawRectangle({
        x: PAGE_W - MARGIN_X - regionW - 22,
        y: cursor.y - 26,
        width: regionW + 14,
        height: 16,
        color: COLOR_INK,
    });
    drawSafeText(p0, baseCopy.sovereignRegion, {
        font: fonts.monoBold,
        size: 8,
        x: PAGE_W - MARGIN_X - regionW - 15,
        y: cursor.y - 21,
        color: COLOR_WHITE,
    });

    cursor.y -= headerH + 10;

    // ── BLOQUE 01: IDENTIFICACIÓN Y GEORREFERENCIA ────────────────────────────
    cursor.drawSectionTitle(domainCopy.domainSectionGeoref);
    const utmZoneLabel = record.utmFix
        ? `${String(record.utmFix.zone).padStart(2, '0')}${record.utmFix.band} (${record.utmFix.hemisphere})`
        : record.domainMode === 'GEOMENSURA_GEO'
          ? `${String(record.payload.utmZone).padStart(2, '0')}${record.payload.hemisphere}`
          : record.domainMode === 'EXPLORACION_SONDAJES'
            ? `${String(record.payload.utmZone).padStart(2, '0')}${record.payload.hemisphere}`
            : isFiniteNum(record.payload.utmZone) && record.payload.hemisphere
              ? `${String(record.payload.utmZone).padStart(2, '0')}${record.payload.hemisphere}`
              : baseCopy.undeclared;

    const eastingVal = record.utmFix
        ? record.utmFix.easting
        : record.domainMode === 'GEOMENSURA_GEO'
          ? record.payload.stationEasting
          : record.domainMode === 'EXPLORACION_SONDAJES'
            ? record.payload.collarEasting
            : record.payload.easting;
    const northingVal = record.utmFix
        ? record.utmFix.northing
        : record.domainMode === 'GEOMENSURA_GEO'
          ? record.payload.stationNorthing
          : record.domainMode === 'EXPLORACION_SONDAJES'
            ? record.payload.collarNorthing
            : record.payload.northing;
    const altVal = record.utmFix
        ? record.utmFix.altitudeM
        : record.domainMode === 'GEOMENSURA_GEO'
          ? record.payload.stationElevationM
          : record.domainMode === 'EXPLORACION_SONDAJES'
            ? record.payload.collarElevationM
            : record.payload.elevationM;

    cursor.drawKeyValueGrid(
        [
            {
                label: domainCopy.titleLabel,
                value: sanitizePdfText(record.title, baseCopy.undeclared),
            },
            {
                label: domainCopy.statusLabel,
                value: sanitizePdfText(record.status, baseCopy.undeclared),
                mono: true,
            },
            {
                label: domainCopy.siteCompanyLabel,
                value: coBrandRight || baseCopy.undeclared,
            },
            {
                label: baseCopy.utmZoneBand,
                value: utmZoneLabel,
                mono: true,
            },
            {
                label: baseCopy.easting,
                value: isFiniteNum(eastingVal) ? `${eastingVal.toFixed(3)} m E` : baseCopy.undeclared,
                mono: true,
            },
            {
                label: baseCopy.northing,
                value: isFiniteNum(northingVal) ? `${northingVal.toFixed(3)} m N` : baseCopy.undeclared,
                mono: true,
            },
            {
                label: baseCopy.altitude,
                value: isFiniteNum(altVal) ? `${altVal.toFixed(2)} m s.n.m.` : baseCopy.undeclared,
                mono: true,
            },
            {
                label: baseCopy.accuracy,
                value:
                    record.utmFix && isFiniteNum(record.utmFix.accuracyM)
                        ? `+/- ${record.utmFix.accuracyM.toFixed(2)} m (${sanitizePdfText(record.utmFix.fixQuality, 'GNSS')})`
                        : baseCopy.undeclared,
                mono: true,
            },
        ],
        2
    );

    // ── BLOQUE 02 / 03: ESPECÍFICO POR DOMINIO ────────────────────────────────
    if (record.domainMode === 'GEOMENSURA_GEO') {
        const p: GeomensuraSurveyPayload = record.payload;
        cursor.drawSectionTitle(domainCopy.domainSectionGeomensura);
        cursor.drawKeyValueGrid(
            [
                { label: 'STATION CODE', value: sanitizePdfText(p.stationCode, baseCopy.undeclared), mono: true },
                { label: 'TARGET CODE', value: sanitizePdfText(p.targetCode, baseCopy.undeclared), mono: true },
                {
                    label: 'DELTA E / DELTA N / DELTA Z',
                    value:
                        isFiniteNum(p.deltaE) && isFiniteNum(p.deltaN) && isFiniteNum(p.deltaZ)
                            ? `${p.deltaE.toFixed(3)} / ${p.deltaN.toFixed(3)} / ${p.deltaZ.toFixed(3)} m`
                            : baseCopy.undeclared,
                    mono: true,
                },
                {
                    label: 'DISTANCIA HORIZ / INCLINADA',
                    value:
                        isFiniteNum(p.horizontalDistanceM) && isFiniteNum(p.slopeDistanceM)
                            ? `${p.horizontalDistanceM.toFixed(3)} m  /  ${p.slopeDistanceM.toFixed(3)} m`
                            : baseCopy.undeclared,
                    mono: true,
                },
                {
                    label: 'AZIMUT / PENDIENTE',
                    value:
                        isFiniteNum(p.azimuthDeg) && isFiniteNum(p.slopePct)
                            ? `${p.azimuthDeg.toFixed(2)} deg  /  ${p.slopePct.toFixed(2)} %`
                            : baseCopy.undeclared,
                    mono: true,
                },
                {
                    label: 'RTK / HDOP',
                    value: `${sanitizePdfText(p.rtkFixQuality, baseCopy.undeclared)} / ${isFiniteNum(p.hdop) ? p.hdop.toFixed(2) : '--'}`,
                    mono: true,
                },
                {
                    label: 'AREA MENSURA',
                    value: isFiniteNum(p.polygonAreaM2)
                        ? `${p.polygonAreaM2.toFixed(2)} m2 (${(p.polygonAreaM2 / 10000).toFixed(4)} ha)`
                        : baseCopy.undeclared,
                    mono: true,
                },
                {
                    label: 'PERIMETRO MENSURA',
                    value: isFiniteNum(p.polygonPerimeterM)
                        ? `${p.polygonPerimeterM.toFixed(2)} m`
                        : baseCopy.undeclared,
                    mono: true,
                },
            ],
            2
        );

        if (Array.isArray(p.polygonVertices) && p.polygonVertices.length > 0) {
            cursor.drawSectionTitle(domainCopy.domainSectionPolygon);
            const cols = [
                { title: '#', w: 34 },
                { title: 'VERTICE', w: 96 },
                { title: 'ESTE (m)', w: 130 },
                { title: 'NORTE (m)', w: 140 },
                { title: 'COTA (m)', w: CONTENT_W - 400 },
            ];
            drawVectorTableHeader(cursor, fonts, cols);
            p.polygonVertices.forEach((v, idx) => {
                drawVectorTableRow(
                    cursor,
                    fonts,
                    cols,
                    [
                        String(idx + 1),
                        v.code,
                        v.easting.toFixed(3),
                        v.northing.toFixed(3),
                        isFiniteNum(v.elevationM) ? v.elevationM.toFixed(3) : '--',
                    ],
                    idx % 2 === 1
                );
            });
        }
    } else if (record.domainMode === 'EXPLORACION_SONDAJES') {
        const p: ExploracionSondajePayload = record.payload;
        cursor.drawSectionTitle(domainCopy.domainSectionExploracion);
        cursor.drawKeyValueGrid(
            [
                { label: 'HOLE ID / METODO', value: `${sanitizePdfText(p.holeId, baseCopy.undeclared)} (${p.method})`, mono: true },
                {
                    label: 'AZIMUT / INCLINACION / PROF.',
                    value: `${p.azimuthDeg.toFixed(1)} deg / ${p.dipDeg.toFixed(1)} deg / ${p.totalDepthM.toFixed(2)} m`,
                    mono: true,
                },
                {
                    label: 'COMPOSITO Cu TOTAL / SOLUBLE',
                    value: `${isFiniteNum(p.weightedCuTotalPct) ? `${p.weightedCuTotalPct.toFixed(3)} %` : baseCopy.undeclared} / ${isFiniteNum(p.weightedCuSolublePct) ? `${p.weightedCuSolublePct.toFixed(3)} %` : baseCopy.undeclared}`,
                    mono: true,
                },
                {
                    label: 'RQD PROMEDIO / TCR',
                    value: `${isFiniteNum(p.meanRqdPct) ? `${p.meanRqdPct.toFixed(1)} %` : baseCopy.undeclared} / ${isFiniteNum(p.meanRecoveryPct) ? `${p.meanRecoveryPct.toFixed(1)} %` : '--'}`,
                    mono: true,
                },
                {
                    label: 'CONTROL QA/QC',
                    value:
                        p.qaqcSampleType && p.qaqcSampleType !== 'NONE'
                            ? `${p.qaqcSampleType} | RPD: ${isFiniteNum(p.qaqcRpdPct) ? `${p.qaqcRpdPct.toFixed(2)}%` : '--'} | ${p.qaqcPassed === true ? 'PASS' : p.qaqcPassed === false ? 'FAIL' : '--'}`
                            : baseCopy.undeclared,
                    mono: true,
                },
                {
                    label: 'INTERVALOS LOGUEADOS',
                    value: String(Array.isArray(p.intervals) ? p.intervals.length : 0),
                    mono: true,
                },
            ],
            2
        );

        if (Array.isArray(p.intervals) && p.intervals.length > 0) {
            cursor.drawSectionTitle(domainCopy.domainSectionIntervals);
            const cols = [
                { title: 'TRAMO (m)', w: 70 },
                { title: 'TCR %', w: 42 },
                { title: 'RQD / DEERE', w: 86 },
                { title: 'LITOLOGIA / ALT', w: 120 },
                { title: 'DOM / CuT / CuS', w: 112 },
                { title: 'CAJA TESTIGO CAS', w: CONTENT_W - 430 },
            ];
            drawVectorTableHeader(cursor, fonts, cols);
            p.intervals.forEach((iv, idx) => {
                const casSummary = formatCasTrace(
                    iv.coreBoxOriginalBytes,
                    iv.coreBoxOptimizedBytes,
                    iv.coreBoxSavingsPct
                );
                const cuT = isFiniteNum(iv.cuTotalPct) ? iv.cuTotalPct.toFixed(2) : '--';
                const cuS = isFiniteNum(iv.cuSolublePct) ? iv.cuSolublePct.toFixed(2) : '--';
                drawVectorTableRow(
                    cursor,
                    fonts,
                    cols,
                    [
                        `${iv.fromM.toFixed(1)}-${iv.toM.toFixed(1)}`,
                        iv.recoveryPct.toFixed(1),
                        `${iv.rqdPct.toFixed(1)} ${iv.rqdQuality}`,
                        `${iv.lithology || '-'} / ${iv.alteration || '-'}`,
                        `${iv.copperDomain} ${cuT}/${cuS}`,
                        casSummary || (iv.coreBoxSha256 ? iv.coreBoxSha256.slice(0, 12) : '--'),
                    ],
                    idx % 2 === 1
                );
            });
        }
    } else if (record.domainMode === 'ESTRUCTURAL_HIDRO') {
        const p: EstructuralHidroPayload = record.payload;
        cursor.drawSectionTitle(domainCopy.domainSectionEstructural);
        drawStructuralStereonetBlock(cursor, fonts, p.planes || []);

        if (Array.isArray(p.planes) && p.planes.length > 0) {
            const cols = [
                { title: 'TIPO ESTRUCTURA', w: 108 },
                { title: 'DIP (deg)', w: 58 },
                { title: 'DIP DIR', w: 58 },
                { title: 'RUMBO RHR', w: 66 },
                { title: 'JRC', w: 44 },
                { title: 'APER (mm)', w: 60 },
                { title: 'RELLENO MINERAL', w: CONTENT_W - 394 },
            ];
            drawVectorTableHeader(cursor, fonts, cols);
            p.planes.forEach((pl, idx) => {
                drawVectorTableRow(
                    cursor,
                    fonts,
                    cols,
                    [
                        pl.structureType,
                        pl.dipDeg.toFixed(1),
                        pl.dipDirectionDeg.toFixed(1),
                        pl.strikeDeg.toFixed(1),
                        isFiniteNum(pl.jrcBarton) ? pl.jrcBarton.toFixed(1) : '--',
                        isFiniteNum(pl.apertureMm) ? pl.apertureMm.toFixed(2) : '--',
                        pl.infill || '--',
                    ],
                    idx % 2 === 1
                );
            });
        }

        cursor.drawSectionTitle(domainCopy.domainSectionHydro);
        const h = p.hydrogeology;
        cursor.drawKeyValueGrid(
            [
                {
                    label: 'PIEZOMETRO ID',
                    value: h ? sanitizePdfText(h.piezometerId, baseCopy.undeclared) : baseCopy.undeclared,
                    mono: true,
                },
                {
                    label: 'NIVEL FREATICO ESTATICO',
                    value: h && isFiniteNum(h.staticWaterLevelM) ? `${h.staticWaterLevelM.toFixed(2)} m` : baseCopy.undeclared,
                    mono: true,
                },
                {
                    label: 'PROFUNDIDAD POZO',
                    value: h && isFiniteNum(h.wellDepthM) ? `${h.wellDepthM.toFixed(2)} m` : baseCopy.undeclared,
                    mono: true,
                },
                {
                    label: 'pH / CONDUCTIVIDAD / TEMP',
                    value: h
                        ? `${isFiniteNum(h.ph) ? h.ph.toFixed(2) : '--'} / ${isFiniteNum(h.conductivityUsCm) ? `${h.conductivityUsCm.toFixed(0)} uS/cm` : '--'} / ${isFiniteNum(h.temperatureC) ? `${h.temperatureC.toFixed(1)} C` : '--'}`
                        : baseCopy.undeclared,
                    mono: true,
                },
            ],
            2
        );
    }

    // ── BLOQUE 04: NOTAS Y AUDITORÍA ──────────────────────────────────────────
    cursor.drawSectionTitle(domainCopy.domainSectionNotesAudit);
    cursor.drawKeyValueGrid(
        [
            {
                label: domainCopy.notesLabel,
                value: sanitizePdfText(record.notes, baseCopy.undeclared),
            },
            {
                label: domainCopy.auditLabel,
                value: `CREATED: ${formatDateIsoShort(record.createdAt)} (${sanitizePdfText(record.createdBy, '--')}) | UPDATED: ${formatDateIsoShort(record.updatedAt)}${record.updatedBy ? ` (${sanitizePdfText(record.updatedBy)})` : ''}`,
                mono: true,
            },
        ],
        1
    );

    cursor.stampFooters();

    const bytes = new Uint8Array(await pdfDoc.save());
    const filename = buildDomainPdfFilename(record, options?.filename);
    const blob =
        typeof Blob !== 'undefined'
            ? new Blob([bytes], { type: 'application/pdf' })
            : (undefined as unknown as Blob);

    let casDescriptor: GeolappDomainPdfResult['casDescriptor'] = null;
    if (options?.uploadToCas && typeof Blob !== 'undefined' && blob) {
        const { mediaDigestorClient } = await import('../../../../core/media/MediaDigestorClient');
        const { descriptor } = await mediaDigestorClient.digestAndUploadCas(blob, {
            profile: 'PDF_HYBRID_OEM',
            scope: 'TENANT_PRIVATE',
            tenantId: options.tenantId || record.tenantId,
            filename,
        });
        const savingsPct =
            descriptor.originalBytes > 0
                ? Math.round(
                      ((descriptor.originalBytes - descriptor.optimizedBytes) /
                          descriptor.originalBytes) *
                          1000
                  ) / 10
                : 0;
        casDescriptor = {
            sha256: descriptor.sha256,
            downloadUrl: descriptor.downloadUrl,
            originalBytes: descriptor.originalBytes,
            optimizedBytes: descriptor.optimizedBytes,
            savingsPct,
        };
    }

    return {
        bytes,
        blob,
        filename,
        casDescriptor,
    };
}
