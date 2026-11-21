import {
    PDFDocument,
    PageSizes,
    StandardFonts,
    rgb,
    type PDFFont,
    type PDFImage,
    type PDFPage,
    type RGB,
} from 'pdf-lib';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { buildCanonicalGeoFix } from '../../../../core/geo/wgs84UtmProjection';
import type { CanonicalGeoFix, GeoCaptureSource } from '../../../../contracts/geo.contracts';
import {
    calculationEngine,
    computeStockpileMeasurementChain,
} from '../services/calculation-engine';
import { resolveStockpileImageUrl } from '../services/StorageService';
import type {
    BoulderDetectionBox2D,
    CopperGovernanceAlert,
    CopperMineralDomain,
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
    coverPhotoBytes?: Uint8Array;
    staticMapBytes?: Uint8Array;
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
    descriptionLabel: string;
    projectLabel: string;
    projectPending: string;
    cycleStatusLabel: string;
    cycleActiveLabel: string;
    cycleClosedShipped: string;
    cycleClosedRemoved: string;
    cycleClosedZero: string;
    cycleClosedManual: string;
    closureCauseLabel: string;
    dispatchRefLabel: string;
    dispatchTransportLabel: string;
    dispatchDestinationLabel: string;
    dispatchTimestampLabel: string;
    shippedWeightLabel: string;
    visualBlockHeader: string;
    coverPhotoBoxLabel: string;
    staticMapBoxLabel: string;
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
    colDeltaV: string;
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
        brandTitle: 'MINREPORT',
        certificateTitle: 'CERTIFICADO TÉCNICO VECTORIAL DE ACOPIO (Cu)',
        sovereignRegion: 'southamerica-west1',
        assetId: 'CÓDIGO ACOPIO',
        assetName: 'DENOMINACIÓN',
        descriptionLabel: 'DESCRIPCIÓN TÉCNICA',
        projectLabel: 'PROYECTO',
        projectPending: '[Desarrollo pendiente]',
        cycleStatusLabel: 'ESTADO DEL CICLO',
        cycleActiveLabel: 'ACTIVO EN CANCHA',
        cycleClosedShipped: 'CERRADO - DESPACHO',
        cycleClosedRemoved: 'CERRADO - ELIMINADO EN TERRENO',
        cycleClosedZero: 'CERRADO - VOLUMEN 0 m3',
        cycleClosedManual: 'CERRADO',
        closureCauseLabel: 'CAUSA DE CIERRE EN TERRENO',
        dispatchRefLabel: 'REF. DESPACHO / LOTE',
        dispatchTransportLabel: 'TRANSPORTE DESPACHO',
        dispatchDestinationLabel: 'DESTINO DESPACHO',
        dispatchTimestampLabel: 'FECHA/HORA DESPACHO',
        shippedWeightLabel: 'TONELAJE DEDUCIDO [t]',
        visualBlockHeader: '00 · PORTADA FOTOGRÁFICA Y MAPA GEORREFERENCIADO (SIN INTERACCIÓN)',
        coverPhotoBoxLabel: 'ÚLTIMA CAPTURA VIGENTE (CAS)',
        staticMapBoxLabel: 'MAPA SATELITAL ESTÁTICO (SIN INTERACCIÓN)',
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
        colDeltaV: 'DELTA V',
        colDens: 'DENS',
        colThm: 'THM [t]',
        colTms: 'TMS [t]',
        colGrade: 'CuT/CuS%',
        colFine: 'Cu FINO',
        colCas: 'CAS',
        footerText: 'MINREPORT | southamerica-west1 | CERTIFICADO VECTORIAL',
        pageLabel: 'PÁGINA',
        continuationSuffix: 'CONTINUACIÓN',
    },
    en: {
        undeclared: '[Technical information not declared on record]',
        brandTitle: 'MINREPORT',
        certificateTitle: 'VECTOR TECHNICAL STOCKPILE CERTIFICATE (Cu)',
        sovereignRegion: 'southamerica-west1',
        assetId: 'STOCKPILE CODE',
        assetName: 'STOCKPILE NAME',
        descriptionLabel: 'TECHNICAL DESCRIPTION',
        projectLabel: 'PROJECT',
        projectPending: '[Pending development]',
        cycleStatusLabel: 'CYCLE STATUS',
        cycleActiveLabel: 'ACTIVE ON PAD',
        cycleClosedShipped: 'CLOSED - DISPATCHED',
        cycleClosedRemoved: 'CLOSED - FIELD REMOVED',
        cycleClosedZero: 'CLOSED - ZERO VOLUME',
        cycleClosedManual: 'CLOSED',
        closureCauseLabel: 'FIELD CLOSURE CAUSE',
        dispatchRefLabel: 'DISPATCH / LOT REF.',
        dispatchTransportLabel: 'DISPATCH TRANSPORT',
        dispatchDestinationLabel: 'DISPATCH DESTINATION',
        dispatchTimestampLabel: 'DISPATCH TIMESTAMP',
        shippedWeightLabel: 'DEDUCED WEIGHT [t]',
        visualBlockHeader: '00 · COVER PHOTO AND STATIC GEOREFERENCE MAP (NON-INTERACTIVE)',
        coverPhotoBoxLabel: 'LATEST ACTIVE PHOTO (CAS)',
        staticMapBoxLabel: 'STATIC SATELLITE MAP (NON-INTERACTIVE)',
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
        colDeltaV: 'DELTA V',
        colDens: 'DENS',
        colThm: 'WMT [t]',
        colTms: 'DMT [t]',
        colGrade: 'CuT/CuS%',
        colFine: 'FINE Cu',
        colCas: 'CAS',
        footerText: 'MINREPORT | southamerica-west1 | VECTOR CERTIFICATE',
        pageLabel: 'PAGE',
        continuationSuffix: 'CONTINUATION',
    },
    pt: {
        undeclared: '[Informação técnica não declarada na ficha]',
        brandTitle: 'MINREPORT',
        certificateTitle: 'CERTIFICADO TÉCNICO VETORIAL DE PILHA (Cu)',
        sovereignRegion: 'southamerica-west1',
        assetId: 'CÓDIGO DA PILHA',
        assetName: 'DENOMINAÇÃO',
        descriptionLabel: 'DESCRIÇÃO TÉCNICA',
        projectLabel: 'PROJETO',
        projectPending: '[Desenvolvimento pendente]',
        cycleStatusLabel: 'ESTADO DO CICLO',
        cycleActiveLabel: 'ATIVO EM PÁTIO',
        cycleClosedShipped: 'FECHADO - DESPACHO',
        cycleClosedRemoved: 'FECHADO - REMOVIDO EM CAMPO',
        cycleClosedZero: 'FECHADO - VOLUME 0 m3',
        cycleClosedManual: 'FECHADO',
        closureCauseLabel: 'CAUSA DO FECHAMENTO EM CAMPO',
        dispatchRefLabel: 'REF. DESPACHO / LOTE',
        dispatchTransportLabel: 'TRANSPORTE DESPACHO',
        dispatchDestinationLabel: 'DESTINO DESPACHO',
        dispatchTimestampLabel: 'DATA/HORA DESPACHO',
        shippedWeightLabel: 'TONELAGEM DEDUZIDA [t]',
        visualBlockHeader: '00 · CAPA FOTOGRÁFICA E MAPA GEORREFERENCIADO (SEM INTERAÇÃO)',
        coverPhotoBoxLabel: 'ÚLTIMA CAPTURA VIGENTE (CAS)',
        staticMapBoxLabel: 'MAPA SATELITAL ESTÁTICO (SEM INTERAÇÃO)',
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
        colDeltaV: 'DELTA V',
        colDens: 'DENS',
        colThm: 'THM [t]',
        colTms: 'TMS [t]',
        colGrade: 'CuT/CuS%',
        colFine: 'Cu FINO',
        colCas: 'CAS',
        footerText: 'MINREPORT | southamerica-west1 | CERTIFICADO VETORIAL',
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
    return `MINREPORT_${baseName}_${dateStamp}.pdf`;
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

async function convertRasterBlobToPngBytes(blob: Blob): Promise<Uint8Array | null> {
    if (
        typeof document === 'undefined' ||
        typeof createImageBitmap !== 'function'
    ) {
        return null;
    }
    try {
        const bitmap = await createImageBitmap(blob);
        try {
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.drawImage(bitmap, 0, 0);
            const pngBlob = await new Promise<Blob | null>((resolve) =>
                canvas.toBlob((out) => resolve(out), 'image/png')
            );
            if (!pngBlob) return null;
            return new Uint8Array(await pngBlob.arrayBuffer());
        } finally {
            bitmap.close();
        }
    } catch {
        return null;
    }
}

async function embedBinaryIntoPdf(
    pdfDoc: PDFDocument,
    rawBytes: Uint8Array
): Promise<PDFImage | null> {
    if (!rawBytes || rawBytes.byteLength < 8) return null;
    const isPng =
        rawBytes[0] === 0x89 &&
        rawBytes[1] === 0x50 &&
        rawBytes[2] === 0x4e &&
        rawBytes[3] === 0x47;
    if (isPng) {
        try {
            return await pdfDoc.embedPng(rawBytes);
        } catch {
            return null;
        }
    }
    const isJpg = rawBytes[0] === 0xff && rawBytes[1] === 0xd8;
    if (isJpg) {
        try {
            return await pdfDoc.embedJpg(rawBytes);
        } catch {
            return null;
        }
    }
    const isWebp =
        rawBytes[0] === 0x52 &&
        rawBytes[1] === 0x49 &&
        rawBytes[2] === 0x46 &&
        rawBytes[3] === 0x46;
    if (isWebp && typeof Blob !== 'undefined') {
        const bufCopy = new Uint8Array(rawBytes.byteLength);
        bufCopy.set(rawBytes);
        const pngBytes = await convertRasterBlobToPngBytes(
            new Blob([bufCopy.buffer], { type: 'image/webp' })
        );
        if (pngBytes) {
            try {
                return await pdfDoc.embedPng(pngBytes);
            } catch {
                return null;
            }
        }
    }
    return null;
}

async function tryEmbedImageFromSource(
    pdfDoc: PDFDocument,
    rawBytes?: Uint8Array | null,
    url?: string | null
): Promise<PDFImage | null> {
    if (rawBytes && rawBytes.byteLength > 0) {
        const direct = await embedBinaryIntoPdf(pdfDoc, rawBytes);
        if (direct) return direct;
    }
    if (!url || typeof url !== 'string' || url.startsWith('data:')) {
        return null;
    }
    let revokeFn: (() => void) | undefined;
    try {
        const resolved = await resolveStockpileImageUrl(url);
        revokeFn = resolved.revoke;
        const targetUrl = resolved.resolvedUrl;
        if (!targetUrl || typeof fetch !== 'function') return null;
        if (targetUrl.startsWith('/') && typeof window === 'undefined') {
            return null;
        }

        const headers: Record<string, string> = {};
        if (targetUrl.startsWith('/api/') && typeof window !== 'undefined') {
            try {
                const { auth } = await import('../../../../config/firebase');
                const token =
                    (await auth?.currentUser?.getIdToken().catch(() => null)) ||
                    window.localStorage.getItem('dev_auth_token') ||
                    window.localStorage.getItem('dev_vault_token');
                if (token) {
                    headers.Authorization = `Bearer ${token}`;
                }
                const accountId = window.localStorage
                    .getItem('minreport_active_account_id')
                    ?.trim();
                if (accountId) {
                    headers['X-Active-Account-Id'] = accountId;
                }
            } catch {
                // Sin token en cliente
            }
        }

        const resp = await fetch(targetUrl, { method: 'GET', headers });
        if (!resp.ok) return null;
        const buf = new Uint8Array(await resp.arrayBuffer());
        return await embedBinaryIntoPdf(pdfDoc, buf);
    } catch {
        return null;
    } finally {
        revokeFn?.();
    }
}

function drawVectorUtmCrosshairFallback(
    page: PDFPage,
    fonts: FontSet,
    boxX: number,
    boxY: number,
    boxW: number,
    boxH: number,
    geoFix: CanonicalGeoFix | null,
    undeclaredText: string
): void {
    const padX = boxX + 8;
    const padY = boxY + 8;
    const innerW = boxW - 16;
    const innerH = boxH - 18;
    const step = 18;
    for (let gx = padX + step; gx < padX + innerW; gx += step) {
        page.drawLine({
            start: { x: gx, y: padY },
            end: { x: gx, y: padY + innerH },
            thickness: 0.35,
            color: COLOR_BORDER,
        });
    }
    for (let gy = padY + step; gy < padY + innerH; gy += step) {
        page.drawLine({
            start: { x: padX, y: gy },
            end: { x: padX + innerW, y: gy },
            thickness: 0.35,
            color: COLOR_BORDER,
        });
    }
    const cx = boxX + boxW / 2;
    const cy = boxY + boxH / 2 + 2;
    if (geoFix) {
        page.drawCircle({
            x: cx,
            y: cy,
            size: 10,
            borderColor: COLOR_COPPER,
            borderWidth: 1.2,
        });
        page.drawCircle({
            x: cx,
            y: cy,
            size: 3,
            color: COLOR_COPPER,
        });
        drawSafeText(page, truncateToWidth(geoFix.utm.formatted, fonts.monoBold, 6.8, boxW - 14), {
            font: fonts.monoBold,
            size: 6.8,
            x: boxX + 7,
            y: boxY + 14,
            color: COLOR_INK,
        });
        drawSafeText(
            page,
            `${geoFix.lat.toFixed(6)}, ${geoFix.lng.toFixed(6)}`,
            {
                font: fonts.mono,
                size: 6.4,
                x: boxX + 7,
                y: boxY + 5,
                color: COLOR_MUTED,
            }
        );
    } else {
        drawSafeText(page, truncateToWidth(undeclaredText, fonts.mono, 6.8, boxW - 16), {
            font: fonts.mono,
            size: 6.8,
            x: boxX + 8,
            y: cy - 3,
            color: COLOR_MUTED,
        });
    }
}

/**
 * Genera el Certificado Técnico Vectorial A4 de MINREPORT en memoria mediante `pdf-lib`
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

    const chain = computeStockpileMeasurementChain(
        measurements || [],
        asset.initial_photo_url
    );
    const sortedMeasurements = chain.enrichedMeasurements;
    const activeMeas =
        sortedMeasurements.find((m) => !m.ignored) || sortedMeasurements[0] || null;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(sanitizePdfText(`${copy.brandTitle} - ${asset.name || asset.id}`));
    pdfDoc.setAuthor(sanitizePdfText(options?.authorEmail || asset.createdBy || 'MINREPORT'));
    pdfDoc.setSubject(sanitizePdfText(copy.certificateTitle));
    pdfDoc.setProducer('MINREPORT Vector PDF Engine (pdf-lib)');
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

    const cycleStatusText =
        asset.status === 'CLOSED'
            ? asset.closure_reason === 'SHIPPED'
                ? copy.cycleClosedShipped
                : asset.closure_reason === 'FIELD_REMOVED'
                  ? copy.cycleClosedRemoved
                  : asset.closure_reason === 'ZERO_VOLUME'
                    ? copy.cycleClosedZero
                    : copy.cycleClosedManual
            : copy.cycleActiveLabel;

    cursor.drawKeyValueGrid(
        [
            {
                label: copy.assetName,
                value: sanitizePdfText(asset.name, copy.undeclared),
            },
            {
                label: copy.cycleStatusLabel,
                value: cycleStatusText,
                mono: true,
                accent: asset.status === 'CLOSED' ? 'copper' : 'cyan',
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
                label: copy.projectLabel,
                value: asset.project_name
                    ? sanitizePdfText(asset.project_name, copy.projectPending)
                    : copy.projectPending,
                mono: true,
            },
            {
                label: copy.authorLabel,
                value: sanitizePdfText(options?.authorEmail || asset.createdBy, copy.undeclared),
                mono: true,
            },
        ],
        2
    );

    cursor.drawKeyValueGrid(
        [
            {
                label: copy.descriptionLabel,
                value: sanitizePdfText(asset.description, copy.undeclared),
            },
            ...(asset.status === 'CLOSED' && asset.dispatch_transport
                ? [
                      {
                          label: copy.dispatchTransportLabel,
                          value: sanitizePdfText(asset.dispatch_transport, copy.undeclared),
                      },
                  ]
                : []),
            ...(asset.status === 'CLOSED' && asset.dispatch_destination
                ? [
                      {
                          label: copy.dispatchDestinationLabel,
                          value: sanitizePdfText(asset.dispatch_destination, copy.undeclared),
                      },
                  ]
                : []),
            ...(asset.status === 'CLOSED' && isFiniteNum(asset.dispatch_timestamp)
                ? [
                      {
                          label: copy.dispatchTimestampLabel,
                          value: `${new Date(asset.dispatch_timestamp).toISOString().replace('T', ' ').slice(0, 16)} UTC`,
                          mono: true,
                      },
                  ]
                : []),
            ...(asset.status === 'CLOSED' && asset.dispatch_reference
                ? [
                      {
                          label: copy.dispatchRefLabel,
                          value: sanitizePdfText(asset.dispatch_reference, copy.undeclared),
                          mono: true,
                      },
                  ]
                : []),
            ...(asset.status === 'CLOSED' && asset.closure_cause
                ? [
                      {
                          label: copy.closureCauseLabel,
                          value: sanitizePdfText(asset.closure_cause, copy.undeclared),
                      },
                  ]
                : []),
            ...(asset.status === 'CLOSED' && isFiniteNum(asset.shipped_weight_t)
                ? [
                      {
                          label: copy.shippedWeightLabel,
                          value: `${asset.shipped_weight_t.toFixed(2)} t`,
                          mono: true,
                      },
                  ]
                : []),
        ],
        1
    );

    // ── BLOQUE 00: PORTADA FOTOGRÁFICA Y MAPA ESTÁTICO (SIN INTERACCIÓN) ─────
    const geoFix = buildSafeGeoFix(asset, activeMeas);
    const coverPhotoUrl =
        chain.summary.lastPhotoUrl || asset.last_photo_url || asset.initial_photo_url || null;
    const embeddedCover = await tryEmbedImageFromSource(
        pdfDoc,
        options?.coverPhotoBytes,
        coverPhotoUrl
    );
    const embeddedStaticMap = await tryEmbedImageFromSource(
        pdfDoc,
        options?.staticMapBytes,
        asset.static_map_url || null
    );

    cursor.drawSectionTitle(copy.visualBlockHeader);
    const visualH = 112;
    cursor.ensureSpace(visualH + 8);
    const visualPage = cursor.currentPage;
    const leftBoxW = Math.round(CONTENT_W * 0.618) - 4;
    const rightBoxX = MARGIN_X + leftBoxW + 8;
    const rightBoxW = CONTENT_W - leftBoxW - 8;
    const boxY = cursor.y - visualH;

    // Caja izquierda (61.8%): Última Foto Vigente CAS
    visualPage.drawRectangle({
        x: MARGIN_X,
        y: boxY,
        width: leftBoxW,
        height: visualH,
        color: COLOR_SURFACE,
        borderColor: COLOR_BORDER,
        borderWidth: 0.75,
    });
    drawSafeText(visualPage, copy.coverPhotoBoxLabel, {
        font: fonts.monoBold,
        size: 6.5,
        x: MARGIN_X + 6,
        y: cursor.y - 10,
        color: COLOR_COPPER,
    });
    if (embeddedCover) {
        const innerW = leftBoxW - 12;
        const innerH = visualH - 20;
        const scale = Math.min(innerW / embeddedCover.width, innerH / embeddedCover.height);
        const drawW = embeddedCover.width * scale;
        const drawH = embeddedCover.height * scale;
        visualPage.drawImage(embeddedCover, {
            x: MARGIN_X + 6 + (innerW - drawW) / 2,
            y: boxY + 5 + (innerH - drawH) / 2,
            width: drawW,
            height: drawH,
        });
    } else {
        drawSafeText(
            visualPage,
            truncateToWidth(
                coverPhotoUrl ? `${copy.evidenceRefLabel}: ${coverPhotoUrl}` : copy.undeclared,
                fonts.mono,
                6.8,
                leftBoxW - 16
            ),
            {
                font: fonts.mono,
                size: 6.8,
                x: MARGIN_X + 8,
                y: boxY + visualH / 2 - 3,
                color: COLOR_MUTED,
            }
        );
    }

    // Caja derecha (38.2%): Mapa Satelital Estático Sin Interacción
    visualPage.drawRectangle({
        x: rightBoxX,
        y: boxY,
        width: rightBoxW,
        height: visualH,
        color: COLOR_SURFACE,
        borderColor: COLOR_BORDER,
        borderWidth: 0.75,
    });
    drawSafeText(visualPage, copy.staticMapBoxLabel, {
        font: fonts.monoBold,
        size: 6.5,
        x: rightBoxX + 6,
        y: cursor.y - 10,
        color: COLOR_CYAN,
    });
    if (embeddedStaticMap) {
        const innerW = rightBoxW - 12;
        const innerH = visualH - 20;
        const scale = Math.min(
            innerW / embeddedStaticMap.width,
            innerH / embeddedStaticMap.height
        );
        const drawW = embeddedStaticMap.width * scale;
        const drawH = embeddedStaticMap.height * scale;
        visualPage.drawImage(embeddedStaticMap, {
            x: rightBoxX + 6 + (innerW - drawW) / 2,
            y: boxY + 5 + (innerH - drawH) / 2,
            width: drawW,
            height: drawH,
        });
    } else {
        drawVectorUtmCrosshairFallback(
            visualPage,
            fonts,
            rightBoxX,
            boxY,
            rightBoxW,
            visualH - 12,
            geoFix,
            copy.undeclared
        );
    }
    cursor.y = boxY - 10;

    // ── BLOQUE 01: GEOESPACIAL ────────────────────────────────────────────────
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

    const volumeM3 = firstFinite(
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
            { title: copy.colDate, w: 48 },
            { title: copy.colMethod, w: 24 },
            { title: copy.colModel, w: 66 },
            { title: copy.colVol, w: 42 },
            { title: copy.colDeltaV, w: 58 },
            { title: copy.colDens, w: 30 },
            { title: copy.colThm, w: 42 },
            { title: copy.colTms, w: 42 },
            { title: copy.colGrade, w: 46 },
            { title: copy.colFine, w: 42 },
            { title: copy.colCas, w: CONTENT_W - (48 + 24 + 66 + 42 + 58 + 30 + 42 + 42 + 46 + 42) },
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
                    size: 6,
                    x: cx + 2.5,
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
            let deltaStr = 'BASE';
            if (m.ignored) {
                deltaStr = 'IGN';
            } else if (m.previous_measurement_id) {
                const dv = isFiniteNum(m.delta_volumen) ? m.delta_volumen : 0;
                const dvSign = dv > 0 ? '+' : '';
                const pctPart = isFiniteNum(m.delta_volumen_pct)
                    ? ` (${dv > 0 ? '+' : ''}${m.delta_volumen_pct.toFixed(1)}%)`
                    : '';
                deltaStr = `${dvSign}${dv.toFixed(1)}${pctPart}`;
            }

            const rowValues = [
                formatDateIsoShort(m.timestamp),
                m.ignored
                    ? 'IGN'
                    : m.is_closure_measurement
                      ? 'CIE'
                      : (m.method || '-').slice(0, 3).toUpperCase(),
                m.geometry?.type || '-',
                isFiniteNum(m.volumen_m3) ? m.volumen_m3.toFixed(1) : '--',
                deltaStr,
                mDens !== null ? mDens.toFixed(2) : '--',
                isFiniteNum(m.wet_weight_thm) ? m.wet_weight_thm.toFixed(1) : '--',
                isFiniteNum(m.dry_weight_tms) ? m.dry_weight_tms.toFixed(1) : '--',
                `${mCut}/${mCus}`,
                isFiniteNum(m.fine_cu_t) ? m.fine_cu_t.toFixed(2) : '--',
                mCas || '--',
            ];

            let cx = MARGIN_X;
            rowValues.forEach((val, idx) => {
                const cellText = truncateToWidth(val, fonts.mono, 5.9, cols[idx].w - 4);
                drawSafeText(p, cellText, {
                    font: fonts.mono,
                    size: 5.9,
                    x: cx + 2.5,
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
                        text: sanitizePdfText(`MINREPORT - ${asset.name || asset.id}`),
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
