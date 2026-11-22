#!/usr/bin/env node
/**
 * AUDITOR AUTOMATIZADO HMI ICON-FIRST, ANTI-FOUT Y SEPARACIÓN MÓVIL/ESCRITORIO MINREPORT
 *
 * Verifica determinísticamente:
 * 1. Existencia de la Skill `.agents/skills/ICON-FIRST-MINIMALISM-AUDITOR/SKILL.md`.
 * 2. Puerta Anti-FOUT en `web/src/index.css` y `web/src/main.tsx` (`font-display: block`, `ms-ready`, `1em`).
 * 3. Validez de cada ligadura literal `material-symbols-outlined` usada en `web/src` contra el WOFF local.
 * 4. Escritorio ACOPIOS 100% solo lectura (ausencia de DesktopClosureModal, edición o cierre).
 * 5. Barra inferior móvil de 3 iconos ad hoc en `StockpileDossierView.tsx`, visor de foto única y hub sin texto.
 * 6. Cero regresiones de marca/tokens (#FFCD00, Google Sans/Roboto/Inter, progress_activity, rounded-lg).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const repoRoot = process.cwd();
const violations = [];

function readText(relPath) {
    const abs = path.join(repoRoot, relPath);
    if (!fs.existsSync(abs)) {
        violations.push(`[ARCHIVO AUSENTE] ${relPath}`);
        return '';
    }
    return fs.readFileSync(abs, 'utf8');
}

function walkTsxFiles(dirPath) {
    const results = [];
    if (!fs.existsSync(dirPath)) return results;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
            continue;
        }
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkTsxFiles(full));
        } else if (entry.name.endsWith('.tsx')) {
            results.push(full);
        }
    }
    return results;
}

function loadWoffGlyphNames(relWoffPath) {
    const abs = path.join(repoRoot, relWoffPath);
    if (!fs.existsSync(abs)) return null;
    const buf = fs.readFileSync(abs);
    const numTables = buf.readUInt16BE(12);
    const tables = {};
    for (let i = 0; i < numTables; i++) {
        const o = 44 + i * 20;
        const tag = buf.toString('ascii', o, o + 4);
        const off = buf.readUInt32BE(o + 4);
        const compLen = buf.readUInt32BE(o + 8);
        const origLen = buf.readUInt32BE(o + 12);
        let sub = buf.subarray(off, off + compLen);
        if (compLen < origLen) sub = zlib.inflateSync(sub);
        tables[tag] = sub;
    }

    const validIcons = new Set();

    // Nombres de glifos desde tabla post
    if (tables.post) {
        const s = tables.post;
        const g = s.readUInt16BE(32);
        let idx = 34 + g * 2;
        while (idx < s.length) {
            const len = s[idx++];
            if (!len) break;
            validIcons.add(s.toString('ascii', idx, idx + len));
            idx += len;
        }
    }

    // Ligaduras OpenType reales desde cmap + GSUB (LookupType 4 y Extension Type 7)
    if (tables.cmap && tables.GSUB) {
        const cmap = tables.cmap;
        const numSub = cmap.readUInt16BE(2);
        const gidToChar = new Map();
        for (let i = 0; i < numSub; i++) {
            const subOff = cmap.readUInt32BE(4 + i * 8 + 4);
            const fmt = cmap.readUInt16BE(subOff);
            if (fmt === 4) {
                const segCount = cmap.readUInt16BE(subOff + 6) / 2;
                for (let s = 0; s < segCount; s++) {
                    const end = cmap.readUInt16BE(subOff + 14 + s * 2);
                    const start = cmap.readUInt16BE(subOff + 16 + segCount * 2 + s * 2);
                    const delta = cmap.readInt16BE(subOff + 16 + segCount * 4 + s * 2);
                    const roOff = subOff + 16 + segCount * 6 + s * 2;
                    const ro = cmap.readUInt16BE(roOff);
                    for (let cp = start; cp <= end && cp <= 127; cp++) {
                        if (cp < 32) continue;
                        const gid =
                            ro === 0
                                ? (cp + delta) & 0xffff
                                : cmap.readUInt16BE(roOff + ro + (cp - start) * 2);
                        if (gid) gidToChar.set(gid, String.fromCharCode(cp));
                    }
                }
            }
        }

        const gsub = tables.GSUB;
        const lookupListOff = gsub.readUInt16BE(8);
        const lookupCount = gsub.readUInt16BE(lookupListOff);
        for (let l = 0; l < lookupCount; l++) {
            const lo = lookupListOff + gsub.readUInt16BE(lookupListOff + 2 + l * 2);
            const ltype = gsub.readUInt16BE(lo);
            const stCount = gsub.readUInt16BE(lo + 4);
            for (let st = 0; st < stCount; st++) {
                let so = lo + gsub.readUInt16BE(lo + 6 + st * 2);
                let effType = ltype;
                if (ltype === 7) {
                    effType = gsub.readUInt16BE(so + 2);
                    so = so + gsub.readUInt32BE(so + 4);
                }
                if (effType !== 4) continue;
                const covOff = so + gsub.readUInt16BE(so + 2);
                const covFmt = gsub.readUInt16BE(covOff);
                const covGids = [];
                if (covFmt === 1) {
                    const cnt = gsub.readUInt16BE(covOff + 2);
                    for (let c = 0; c < cnt; c++) {
                        covGids.push(gsub.readUInt16BE(covOff + 4 + c * 2));
                    }
                } else if (covFmt === 2) {
                    const cnt = gsub.readUInt16BE(covOff + 2);
                    for (let r = 0; r < cnt; r++) {
                        const sg = gsub.readUInt16BE(covOff + 4 + r * 6);
                        const eg = gsub.readUInt16BE(covOff + 6 + r * 6);
                        for (let g = sg; g <= eg; g++) covGids.push(g);
                    }
                }
                const lsCount = gsub.readUInt16BE(so + 4);
                for (let i = 0; i < lsCount; i++) {
                    const firstChar = gidToChar.get(covGids[i]);
                    if (!firstChar) continue;
                    const lso = so + gsub.readUInt16BE(so + 6 + i * 2);
                    const ligCnt = gsub.readUInt16BE(lso);
                    for (let j = 0; j < ligCnt; j++) {
                        const ligo = lso + gsub.readUInt16BE(lso + 2 + j * 2);
                        const compCnt = gsub.readUInt16BE(ligo + 2);
                        let str = firstChar;
                        let ok = true;
                        for (let k = 0; k < compCnt - 1; k++) {
                            const ch = gidToChar.get(gsub.readUInt16BE(ligo + 4 + k * 2));
                            if (!ch) {
                                ok = false;
                                break;
                            }
                            str += ch;
                        }
                        if (ok) validIcons.add(str);
                    }
                }
            }
        }
    }

    return validIcons.size > 0 ? validIcons : null;
}

// 1. Skill & Anti-FOUT
readText('.agents/skills/ICON-FIRST-MINIMALISM-AUDITOR/SKILL.md');
const indexCss = readText('web/src/index.css');
const mainTsx = readText('web/src/main.tsx');
if (indexCss && (!indexCss.includes('font-display: block') || !indexCss.includes('html:not(.ms-ready)'))) {
    violations.push('[ANTI-FOUT] web/src/index.css debe declarar font-display: block y puerta html:not(.ms-ready)');
}
if (mainTsx && !mainTsx.includes('ms-ready')) {
    violations.push('[ANTI-FOUT] web/src/main.tsx debe activar clase ms-ready tras document.fonts.load');
}

// 2. Validar ligaduras estáticas Material Symbols contra el .woff local
const woffGlyphs = loadWoffGlyphNames(
    'web/node_modules/@fontsource/material-symbols-outlined/files/material-symbols-outlined-latin-400-normal.woff'
);
const webTsxFiles = walkTsxFiles(path.join(repoRoot, 'web', 'src'));
const spanIconRegex = /<span[^>]*material-symbols-outlined[^>]*>\s*([a-z][a-z0-9_]+)\s*<\/span>/g;

if (woffGlyphs) {
    for (const absFile of webTsxFiles) {
        const relFile = path.relative(repoRoot, absFile);
        const content = fs.readFileSync(absFile, 'utf8');
        let match;
        while ((match = spanIconRegex.exec(content)) !== null) {
            const glyph = match[1];
            if (!woffGlyphs.has(glyph)) {
                violations.push(`[GLIFO INVÁLIDO] ${relFile}: '${glyph}' no existe en Material Symbols Outlined local.`);
            }
        }
    }
}

// 3. Escritorio 100% Solo Lectura & Modal eliminado
const deletedDesktopClosurePath = path.join(
    repoRoot,
    'web/src/modules/geolapp/components/desktop/DesktopClosureModal.tsx'
);
if (fs.existsSync(deletedDesktopClosurePath)) {
    violations.push('[ESCRITORIO READ-ONLY] DesktopClosureModal.tsx debe estar eliminado.');
}

const desktopStageSrc = readText('web/src/modules/geolapp/components/desktop/DesktopStageWorkspace.tsx');
if (
    desktopStageSrc &&
    (desktopStageSrc.includes('onRequestClosure') ||
        desktopStageSrc.includes('onRequestReopen') ||
        desktopStageSrc.includes('onRequestDelete') ||
        desktopStageSrc.includes('toggleIgnoreMeasurement') ||
        desktopStageSrc.includes('handleReconstruct3D'))
) {
    violations.push('[ESCRITORIO READ-ONLY] DesktopStageWorkspace.tsx no debe contener mutaciones ni acciones de cierre/borrado.');
}

const desktopDossierSrc = readText('web/src/modules/geolapp/components/desktop/DesktopDossierPanel.tsx');
if (
    desktopDossierSrc &&
    (desktopDossierSrc.includes('GeolappAiEnrichDrawer') ||
        desktopDossierSrc.includes('updateAssetWithHitl') ||
        desktopDossierSrc.includes('canEdit={true}'))
) {
    violations.push('[ESCRITORIO READ-ONLY] DesktopDossierPanel.tsx debe permanecer 100% en solo lectura.');
}

// 4. Visor de foto única, Hub iconos puros y Barra móvil 3 iconos ad hoc
const visualStageSrc = readText('web/src/modules/geolapp/components/StockpileVisualStage.tsx');
if (
    visualStageSrc &&
    (visualStageSrc.includes('StagePhotoThumb') ||
        visualStageSrc.includes('visual.latest_short') ||
        visualStageSrc.includes('visual.initial_short'))
) {
    violations.push('[VISOR ACOPIO] StockpileVisualStage.tsx no debe incluir carrusel ni etiquetas ÚLTIMA/INICIAL.');
}

const dossierSrc = readText('web/src/modules/geolapp/components/StockpileDossierView.tsx');
for (const requiredIcon of ['picture_as_pdf', 'add_a_photo', 'done_all', 'lock_open']) {
    if (dossierSrc && !dossierSrc.includes(requiredIcon)) {
        violations.push(`[ICON-FIRST] StockpileDossierView.tsx debe incluir el icono '${requiredIcon}'.`);
    }
}
if (
    dossierSrc &&
    (dossierSrc.includes('showMobileBottomNav') ||
        dossierSrc.includes('showClosureForm') ||
        dossierSrc.includes('quickCauses'))
) {
    violations.push('[LAYOUT] StockpileDossierView.tsx no debe incluir formulario/chips de cierre inline ni banderas obsoletas.');
}

const closureViewSrc = readText('web/src/modules/geolapp/components/MobileStockpileClosureView.tsx');
for (const requiredIcon of ['arrow_back', 'close', 'check', 'delivery_truck_speed', 'delete_sweep']) {
    if (closureViewSrc && !closureViewSrc.includes(requiredIcon)) {
        violations.push(`[CIERRE DEDICADO] MobileStockpileClosureView.tsx debe incluir el icono '${requiredIcon}'.`);
    }
}
if (
    closureViewSrc &&
    (closureViewSrc.includes('quickCauses') ||
        closureViewSrc.includes('chip_shipped_plant') ||
        closureViewSrc.includes('chip_removed_cleared'))
) {
    violations.push('[CIERRE DEDICADO] MobileStockpileClosureView.tsx no debe incluir chips o razones preestablecidas.');
}

const scannerSrc = readText('web/src/modules/geolapp/components/MobileScanner.tsx');
if (scannerSrc && (scannerSrc.includes('MEDIR VOLUMEN') || scannerSrc.includes('measure_volume_btn'))) {
    violations.push('[ESCÁNER MÓVIL] MobileScanner.tsx no debe contener el botón con texto prohibido MEDIR VOLUMEN.');
}
if (scannerSrc && (!scannerSrc.includes('autoStartScan') || !scannerSrc.includes('tune'))) {
    violations.push('[ESCÁNER MÓVIL] MobileScanner.tsx debe implementar captura directa autoStartScan e icono tune.');
}

const spatialCapabilitySrc = readText('web/src/modules/geolapp/core/services/spatialDeviceCapability.ts');
if (spatialCapabilitySrc && !spatialCapabilitySrc.includes('warmSpatialDeviceCapability')) {
    violations.push('[ANTI-FLASH] spatialDeviceCapability.ts debe exportar warmSpatialDeviceCapability para pre-sondeo sin flash.');
}

const mainLayoutSrc = readText('web/src/modules/geolapp/layouts/MainLayout.tsx');
if (mainLayoutSrc && (mainLayoutSrc.includes('showMobileBottomNav') || mainLayoutSrc.includes('showCenterCamera'))) {
    violations.push('[LAYOUT] MainLayout.tsx conserva lógica muerta de barra inferior.');
}

const hubSrc = readText('web/src/modules/geolapp/components/MobileAcopiosHub.tsx');
if (hubSrc && (!hubSrc.includes('measuring_tape') || !hubSrc.includes('compass_calibration'))) {
    violations.push('[HUB MÓVIL] MobileAcopiosHub.tsx debe exponer measuring_tape y compass_calibration.');
}

// 6. Cero regresiones de marca/tokens, WCAG 2.2 AAA Sol Atacama & Paridad i18n en web/src y web/src/modules/supply/**
function walkCodeFiles(dirPath, exts = ['.tsx', '.ts', '.css']) {
    const results = [];
    if (!fs.existsSync(dirPath)) return results;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
            continue;
        }
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkCodeFiles(full, exts));
        } else if (exts.includes(path.extname(entry.name))) {
            results.push(full);
        }
    }
    return results;
}

// 6a. Checks globales seguros en web/src (cero #FFCD00, AdminSwitch, material-symbols-rounded)
for (const absFile of webTsxFiles) {
    const relFile = path.relative(repoRoot, absFile);
    if (relFile.includes(`${path.sep}__tests__${path.sep}`)) continue;
    const content = fs.readFileSync(absFile, 'utf8');
    if (/#FFCD00/i.test(content)) {
        violations.push(`[MARCA PROHIBIDA] ${relFile} contiene color externo prohibido #FFCD00.`);
    }
    if (/\bAdminSwitch\b/.test(content)) {
        violations.push(`[COMPONENTE PROHIBIDO] ${relFile} usa AdminSwitch (debe usar M3Switch).`);
    }
    if (/material-symbols-rounded/.test(content)) {
        violations.push(`[ICONOGRAFÍA PROHIBIDA] ${relFile} usa material-symbols-rounded (solo material-symbols-outlined).`);
    }
}

// 6b. Checks estrictos en web/src/modules/supply/** (WCAG 2.2 AAA, geometría 0px, fuentes, progreso M3)
const supplyCodeFiles = walkCodeFiles(path.join(repoRoot, 'web', 'src', 'modules', 'supply'));
const forbiddenSupplyFontRegex =
    /\bGoogle\s+Sans\b|\bRoboto\b|font-(?:sans|family)[^;'"\n]*\bInter\b|['"]Inter['"]/;
const forbiddenCopperWhiteRegex =
    /bg-\[#C68346\][^'"`\n]*text-(?:white|\[#(?:FFF|FFFFFF)\])|text-(?:white|\[#(?:FFF|FFFFFF)\])[^'"`\n]*bg-\[#C68346\]/i;
const forbiddenRoundedRegex = /\brounded-(?:sm|md|lg|xl|2xl|3xl|full)\b/;

for (const absFile of supplyCodeFiles) {
    const relFile = path.relative(repoRoot, absFile);
    if (relFile.includes(`${path.sep}__tests__${path.sep}`)) continue;
    const content = fs.readFileSync(absFile, 'utf8');

    if (/#FFCD00/i.test(content)) {
        violations.push(`[SUPPLY TOKEN] ${relFile} contiene #FFCD00 prohibido.`);
    }
    if (forbiddenSupplyFontRegex.test(content)) {
        violations.push(`[SUPPLY TIPOGRAFÍA] ${relFile} referencia fuente no autorizada (Google Sans/Roboto/Inter).`);
    }
    if (/\bAdminSwitch\b/.test(content)) {
        violations.push(`[SUPPLY SWITCH] ${relFile} usa AdminSwitch prohibido.`);
    }
    if (/material-symbols-rounded/.test(content)) {
        violations.push(`[SUPPLY ICONOS] ${relFile} usa material-symbols-rounded prohibido.`);
    }
    if (/progress_activity/.test(content) && /animate-spin/.test(content)) {
        violations.push(`[SUPPLY PROGRESO] ${relFile} usa progress_activity + animate-spin (debe usar M3LinearProgress / M3CircularProgress).`);
    }
    if (forbiddenCopperWhiteRegex.test(content)) {
        violations.push(`[SUPPLY WCAG AAA] ${relFile} combina bg-[#C68346] con texto blanco (debe usar text-[#000000]).`);
    }
    if (forbiddenRoundedRegex.test(content)) {
        violations.push(`[SUPPLY GEOMETRÍA] ${relFile} usa bordes redondeados no autorizados (geometría estricta rounded-none).`);
    }
    if (/\(38\.2%\)/.test(content)) {
        violations.push(`[SUPPLY CERO PROSA] ${relFile} expone texto decorativo literal '(38.2%)'.`);
    }
}

// 6c. Paridad exacta 1:1 de llaves i18n en web/src/modules/supply/locales/{es,en,pt}.json y cero PILHAS
function flattenJsonKeys(obj, prefix = '') {
    const keys = [];
    for (const [k, v] of Object.entries(obj || {})) {
        const next = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            keys.push(...flattenJsonKeys(v, next));
        } else {
            keys.push(next);
        }
    }
    return keys.sort();
}

const supplyLocalePaths = {
    es: 'web/src/modules/supply/locales/es.json',
    en: 'web/src/modules/supply/locales/en.json',
    pt: 'web/src/modules/supply/locales/pt.json',
};
const supplyLocaleKeys = {};
for (const [lang, relPath] of Object.entries(supplyLocalePaths)) {
    const raw = readText(relPath);
    if (!raw) continue;
    if (/\bPILHAS\b/i.test(raw)) {
        violations.push(`[SUPPLY MARCA SOBERANA] ${relPath} contiene cadena legada prohibida 'PILHAS' (usar 'ACOPIOS').`);
    }
    if (/\(38\.2%\)/.test(raw)) {
        violations.push(`[SUPPLY CERO PROSA] ${relPath} contiene texto decorativo literal '(38.2%)'.`);
    }
    try {
        supplyLocaleKeys[lang] = flattenJsonKeys(JSON.parse(raw));
    } catch (err) {
        violations.push(`[SUPPLY I18N JSON] ${relPath} inválido: ${err instanceof Error ? err.message : String(err)}`);
    }
}
if (supplyLocaleKeys.es && supplyLocaleKeys.en && supplyLocaleKeys.pt) {
    const esSet = new Set(supplyLocaleKeys.es);
    for (const lang of ['en', 'pt']) {
        const targetSet = new Set(supplyLocaleKeys[lang]);
        const missing = supplyLocaleKeys.es.filter((k) => !targetSet.has(k));
        const extra = supplyLocaleKeys[lang].filter((k) => !esSet.has(k));
        if (missing.length > 0 || extra.length > 0) {
            violations.push(
                `[SUPPLY I18N PARIDAD] ${lang}.json desalineado vs es.json (faltantes=${missing.length}, extras=${extra.length}).`
            );
        }
    }
}

if (violations.length > 0) {
    console.error(`\nFAIL verify-hmi-icons (${violations.length} hallazgos):`);
    for (const v of violations) {
        console.error(` - ${v}`);
    }
    process.exit(1);
}

console.log(
    `OK verify-hmi-icons: Anti-FOUT, glifos WOFF (${woffGlyphs ? woffGlyphs.size : 0} verificados), Escritorio Solo Lectura, Supply WCAG AAA e i18n (${supplyLocaleKeys.es ? supplyLocaleKeys.es.length : 0} llaves es/en/pt) conformes.`
);
