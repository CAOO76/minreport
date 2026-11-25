import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
    calculateEllipticCone as backendEllipticCone,
    calculateSlopeAwareWindrowVolume as backendWindrowV2,
    calculateToeWallStockpileVolume as backendToeWallV2,
    calculateTruncatedEllipticCone as backendTruncatedCone,
    computeStockpileVolumeV2 as backendComputeV2,
    evaluateStockpileSlopePhysics as backendEvaluateSlope,
} from '../../modules/geolapp/stockpile-geometry.engine';

const ROOT_DIR = path.resolve(__dirname, '../../..');
const WEB_SRC = path.join(ROOT_DIR, 'web/src');

const webModuleCache = new Map<string, any>();

function resolveTsFile(candidate: string): string | null {
    const attempts = [
        candidate,
        `${candidate}.ts`,
        `${candidate}.tsx`,
        path.join(candidate, 'index.ts'),
        path.join(candidate, 'index.tsx'),
    ];
    for (const filePath of attempts) {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return filePath;
        }
    }
    return null;
}

function loadWebModule(tsFilePath: string): any {
    const normalizedPath = path.normalize(tsFilePath);
    if (webModuleCache.has(normalizedPath)) {
        return webModuleCache.get(normalizedPath);
    }

    const rawSource = fs.readFileSync(normalizedPath, 'utf8');
    const source = rawSource
        .replace(/import\.meta\.url/g, `'file://${normalizedPath}'`)
        .replace(/import\.meta\.env/g, `({} as Record<string, any>)`)
        .replace(/\bimport\.meta\b/g, `({ url: 'file://${normalizedPath}', env: {} })`);
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
            jsx: ts.JsxEmit.ReactJSX,
        },
        fileName: normalizedPath,
    });
    const cjsOutput = transpiled.outputText
        .replace(/import\.meta\.url/g, `'file://${normalizedPath}'`)
        .replace(/import\.meta\.env/g, `({})`)
        .replace(/\bimport\.meta\b/g, `({ url: '', env: {} })`);

    const mod: { exports: Record<string, any> } = { exports: {} };
    webModuleCache.set(normalizedPath, mod.exports);

    const localDir = path.dirname(normalizedPath);
    const customRequire = (request: string): any => {
        if (request === '@capacitor/core') {
            return { Capacitor: { isNativePlatform: () => false } };
        }
        if (request.startsWith('.')) {
            const targetNorm = path.normalize(path.resolve(localDir, request));
            const resolved = resolveTsFile(targetNorm);
            if (resolved) {
                return loadWebModule(resolved);
            }
        }
        return require(request);
    };

    const wrapper = new Function('require', 'module', 'exports', '__filename', '__dirname', cjsOutput);
    wrapper(customRequire, mod, mod.exports, normalizedPath, localDir);
    webModuleCache.set(normalizedPath, mod.exports);
    return mod.exports;
}

function numericalTruncatedEllipticCone(
    d1: number,
    d2: number,
    d1p: number,
    d2p: number,
    h: number,
    steps = 1000
): number {
    const dz = h / steps;
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = d1 + (d1p - d1) * t;
        const b = d2 + (d2p - d2) * t;
        const area = Math.PI * (a / 2) * (b / 2);
        const w = i === 0 || i === steps ? 1 : i % 2 === 0 ? 2 : 4;
        sum += w * area;
    }
    return (dz / 3) * sum;
}

function testGeometryEngineV2Parity(): void {
    const { CalculationEngine } = loadWebModule(
        path.join(WEB_SRC, 'modules/geolapp/core/services/calculation-engine.ts')
    );
    const engine = new CalculationEngine();

    // 1. Integral prismoidal exacta para cono elíptico truncado no homotético
    const feTrunc = engine.calculateTruncatedEllipticCone(20, 15, 10, 7.5, 5);
    const beTrunc = backendTruncatedCone(20, 15, 10, 7.5, 5);
    const numTrunc = numericalTruncatedEllipticCone(20, 15, 10, 7.5, 5);
    assert.ok(Math.abs(feTrunc - beTrunc) < 0.01, 'Frontend y Backend deben coincidir en cono truncado');
    assert.ok(Math.abs(feTrunc - numTrunc) < 0.05, 'Fórmula prismoidal debe coincidir con integración Simpson');

    // Caso no semejante (d1p/d1 != d2p/d2)
    const feNonHom = engine.calculateTruncatedEllipticCone(24, 14, 16, 4, 4.5);
    const numNonHom = numericalTruncatedEllipticCone(24, 14, 16, 4, 4.5);
    assert.ok(
        Math.abs(feNonHom - numNonHom) < 0.05,
        `Cono truncado no homotético debe ser exacto (obtenido=${feNonHom}, simpson=${numNonHom})`
    );

    // 2. Windrow con cabeceras semiconoides y talud real 40 grados
    const feWindrow = engine.calculateSlopeAwareWindrowVolume({
        baseLengthM: 25,
        baseWidthM: 12,
        heightM: 4,
        slopeAngleDeg: 40,
    });
    const beWindrow = backendWindrowV2({
        baseLengthM: 25,
        baseWidthM: 12,
        heightM: 4,
        slopeAngleDeg: 40,
    });
    assert.equal(feWindrow, beWindrow);
    // Verificación analítica exacta de cordón estadio: prisma trapezoidal (L-B=13m) + frustum circular extremos (D=12m, d=2.466m, h=4m)
    const deltaR40 = 4 / Math.tan((40 * Math.PI) / 180);
    const crestW40 = 12 - 2 * deltaR40;
    const expectedMid = ((12 + crestW40) / 2) * 4 * (25 - 12);
    const expectedFrustum =
        ((Math.PI * 4) / 3) * (36 + Math.pow(crestW40 / 2, 2) + 6 * (crestW40 / 2));
    const expectedWindrow40 = Math.round((expectedMid + expectedFrustum) * 100) / 100;
    assert.ok(
        Math.abs(feWindrow - expectedWindrow40) < 0.05 && Math.abs(feWindrow - 564.27) < 0.05,
        `Windrow con talud 40 grados esperado ~564.27 m3, obtenido ${feWindrow}`
    );

    // 3. Compatibilidad retroactiva de windrow legacy y toe-wall sin 5to parámetro
    assert.equal(engine.calculateWindrowVolume(20, 10, 4), 400);
    assert.equal(engine.calculateWindrowVolume(20, 10, 4, 16, 4), 512);
    assert.equal(engine.calculateToeWallStockpileVolume(10, 8, 4, 90), 160);
    assert.equal(engine.calculateToeWallStockpileVolume(10, 8, 4, 45), 80);

    // 4. Acopio contra 1 muro trasero (SINGLE_WALL) vs Bunker 3 muros
    const singleWallVol = engine.calculateToeWallStockpileVolume(15, 8, 5, 90, {
        confinement: 'SINGLE_WALL',
        slopeAngleDeg: 40,
    });
    const beSingleWall = backendToeWallV2(15, 8, 5, 90, {
        confinement: 'SINGLE_WALL',
        slopeAngleDeg: 40,
    });
    const bunker3Vol = engine.calculateToeWallStockpileVolume(15, 8, 5, 90);
    assert.equal(singleWallVol, beSingleWall);
    assert.ok(
        singleWallVol > 0 && singleWallVol < bunker3Vol,
        `SINGLE_WALL (${singleWallVol}) debe ser menor que BUNKER_3_WALLS (${bunker3Vol})`
    );

    // 5. Derivación de altura desde pendiente inclinada y talud > 48 grados
    const derivedH = engine.deriveHeightFromSlopeLength(6, 40);
    assert.ok(Math.abs(derivedH - 3.86) <= 0.02, `Altura inclinada esperada ~3.86m, obtenido ${derivedH}`);

    const steepFe = engine.evaluateStockpileSlopePhysics({
        geometryType: 'CONO_ELIPTICO',
        dimensions: { a: 10, b: 10, h: 7 },
    });
    const steepBe = backendEvaluateSlope({
        geometryType: 'CONO_ELIPTICO',
        dimensions: { a: 10, b: 10, h: 7 },
    });
    assert.equal(steepFe.status, 'STEEP_WARNING');
    assert.equal(steepBe.status, 'STEEP_WARNING');
    assert.ok(Boolean(steepFe.warning) && Boolean(steepBe.warning));

    // 6. Consistencia computeStockpileVolumeV2
    const beCone = backendComputeV2({
        geometryType: 'CONO_ELIPTICO',
        dimensions: { a: 12, b: 10, h: 4 },
    });
    assert.equal(Math.round(backendEllipticCone(12, 10, 4) * 100) / 100, beCone);
}

function testMobileDigitalOnlyAndOfflineSyncContracts(): void {
    const mobileScannerSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/MobileScanner.tsx'),
        'utf8'
    );
    const manualCapturePath = path.join(
        WEB_SRC,
        'modules/geolapp/components/ManualCapture.tsx'
    );
    const quickCaptureSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/components/QuickStockpileCapture.tsx'),
        'utf8'
    );
    const mainLayoutSrc = fs.readFileSync(
        path.join(WEB_SRC, 'modules/geolapp/layouts/MainLayout.tsx'),
        'utf8'
    );
    const syncEngineSrc = fs.readFileSync(
        path.join(WEB_SRC, 'core/offline/SyncQueueEngine.ts'),
        'utf8'
    );
    const firebaseSrc = fs.readFileSync(
        path.join(WEB_SRC, 'config/firebase.ts'),
        'utf8'
    );
    const shellSrc = fs.readFileSync(
        path.join(WEB_SRC, 'pages/mobile/DevFieldTestModuleShell.tsx'),
        'utf8'
    );

    // Purga total de cubicación manual en escritorio/móvil, sensores externos y animate-spin
    assert.equal(mobileScannerSrc.includes('ExternalSensorsPanel'), false);
    assert.equal(fs.existsSync(manualCapturePath), false, 'ManualCapture.tsx debe estar eliminado');
    assert.equal(mobileScannerSrc.includes('animate-spin'), false);

    // Capacidades digitales limpias en MobileScanner (cámara + galería + guardar un toque + ARCore + XCover + CAS)
    assert.equal(mobileScannerSrc.includes('<FieldNumPad'), false, 'MobileScanner limpio no debe incluir FieldNumPad manual');
    assert.ok(
        /handleCaptureSource\(\s*'CAMERA'/.test(mobileScannerSrc) &&
            /handleCaptureSource\(\s*'PHOTOS'/.test(mobileScannerSrc) &&
            mobileScannerSrc.includes('handleSaveCapture'),
        'MobileScanner debe integrar captura directa por cámara, galería y guardado en un toque'
    );
    assert.ok(
        mobileScannerSrc.includes('useSpatialDeviceCapability') &&
            mobileScannerSrc.includes('OPTIMAL_SPATIAL') &&
            mobileScannerSrc.includes('NEEDS_UPDATE'),
        'MobileScanner debe integrar useSpatialDeviceCapability y compatibilidad ARCore'
    );
    assert.ok(mobileScannerSrc.includes('useXCoverHardwareKey'), 'MobileScanner debe soportar botón físico XCover Key');
    assert.ok(mobileScannerSrc.includes('mediaDigestorClient.digestFile'), 'MobileScanner debe procesar evidencia vía CAS');
    assert.ok(mobileScannerSrc.includes('CAPTURE_SESSION_UPLOAD'), 'Debe encolar sesión de captura V2 offline');
    assert.ok(mobileScannerSrc.includes('CAPTURED_OFFLINE_VALID'), 'Debe marcar estado CAPTURED_OFFLINE_VALID offline');

    // QuickStockpileCapture solo renderiza cámara móvil y expone modo subterráneo
    assert.equal(quickCaptureSrc.includes('ManualCapture'), false);
    assert.equal(quickCaptureSrc.includes('COTAS ESCRITORIO'), false);
    assert.ok(quickCaptureSrc.includes('UNDERGROUND_NO_FIX'));

    // Barra inferior móvil sin Analytics
    assert.equal(mainLayoutSrc.includes("id: 'analytics'"), false);

    // Prioridad 2-etapas y esquema densidad opcional en SyncQueueEngine
    assert.ok(syncEngineSrc.includes('CAS_MEDIA_UPLOAD: 1'));
    assert.ok(syncEngineSrc.includes('STOCKPILE_SURVEY: 2'));
    assert.ok(syncEngineSrc.includes('STOCKPILE_MEASUREMENT: 3'));
    assert.ok(syncEngineSrc.includes('CAPTURE_SESSION_UPLOAD'));
    assert.ok(syncEngineSrc.includes('density: z.number().nonnegative().optional()'));

    // Persistencia nativa Firebase y sincronización automática al volver primer plano
    assert.ok(firebaseSrc.includes('indexedDBLocalPersistence'));
    assert.ok(shellSrc.includes('appStateChange'));
}

function main(): void {
    testGeometryEngineV2Parity();
    testMobileDigitalOnlyAndOfflineSyncContracts();
    console.log('[PASS] geolapp-geometry-v2-offline.test.ts: TODOS LOS CASOS PASARON');
}

main();
