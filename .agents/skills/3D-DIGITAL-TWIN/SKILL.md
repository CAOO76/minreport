---
name: 3D-DIGITAL-TWIN
description: Ingeniería de gemelos digitales 3D, visor dual Foto Real / Malla 3D Digital (StockpileVisualStage + StockpileTwin3DLazy), fotogrametría y cubicación volumétrica mediante Three.js / React Three Fiber con carga diferida obligatoria, modo compact e higiene estricta de memoria GPU (dispose).
---

# 3D-DIGITAL-TWIN (Capa 2 MINREPORT)

Gobierna la visualización espacial 3D, mallas topográficas (`.glb`/TIN) y evidencia fotogramétrica bajo la marca única **MINREPORT** —en el módulo nativo **`ACOPIOS`** (`moduleId` técnico interno: `stockpile`) y telemetría de activos en **`OPERMAQ`** (`moduleId`: `opermaq`)—. Quedan prohibidas toda sub-marca comercial heredada o denominación paralela para acopios.

## 1. Estándar Visual Dual Foto Real / Malla 3D Digital (`ACOPIOS`)
1. **Componente Unificado Obligatorio:** Todo registro de acopio debe usar `StockpileVisualStage` + `StockpileTwin3DLazy` (`StockpileTwin3D`) integrando en un único lienzo (NASA OpenMCT & NASA-STD-3001) evidencia fotográfica y/o gemelo digital sin prosa explicativa ni saltos innecesarios:
   - **Escritorio:** Modos **`FOTO | 3D | DUAL`** (panel foto optimizada con perimetrales y detecciones `box_2d` cuando existan + panel malla 3D `.glb`/TIN).
   - **Móvil:** Modos **`FOTO | 3D`** con **`compact={true}`** (canvas edge-to-edge sin tarjeta envolvente, botones planos en esquina superior derecha y una única franja hairline inferior tabular `X×Z×H · V_TIN m³ · TRI`).
2. **Trazabilidad CAS y Privacidad:** Toda imagen o textura pasa por el pipeline CAS SHA-256 + `dHash` 64-bit (`MINREPORT-MEDIA-DIGESTOR-CAS`) y cumple Ley N° 21.719 / N° 19.628 en `southamerica-west1`.

## 2. Presupuesto Espacial e Higiene Estricta de Memoria GPU
1. **Carga Diferida Obligatoria:** Todo visor 3D (`StockpileTwin3DLazy`), exportador GLTF o lienzo WebGL debe cargarse mediante `React.lazy` + `Suspense` (con fallback `<M3LinearProgress indeterminate />`, altura `4px`, `gap 4px`, `stop indicator 4×4px`, `rounded-none`, `shadow-none`) para no bloquear el LCP (`< 1.2s`).
2. **Desmontaje Reactivo por Modo:** `StockpileTwin3DLazy` debe montarse **únicamente** cuando el modo activo sea `'3D'` o `'DUAL'`, desmontándose de inmediato al conmutar a `'PHOTO'` para liberar contexto GPU.
3. **Liberación Estricta de Recursos (`dispose()`):**
   - Al desmontar un componente 3D, conmutar de modo o finalizar la generación de una malla (`BufferGeometry`, `Material`, `Texture`, `OrbitControls`, `WebGLRenderer`), es **obligatorio** invocar `geometry.dispose()`, `material.dispose()`, `texture.dispose()`, `controls.dispose()`, `renderer.dispose()`, `renderer.forceContextLoss()` y `URL.revokeObjectURL(objectUrl)` en un bloque `finally` o `useEffect` cleanup.

## 3. Estética HMI Aeroespacial & Invariantes UI
- **Lockheed Martin F-35 PCD & ANSI/ISA-101 (Color por Excepción):** `>= 85%` lienzo monocromático neutro (`#000000`/`#F3F4F6` oscuro y `#FFFFFF`/`#0F172A` claro *Sol Atacama*); Cobre **`#C68346`** reservado a wireframe protagonista, foco activo o excepción (ej. clastos `>= 250mm` en `box_2d` o talud `> 38°`); Cian **`#00AEEF`** reservado a verificación IA, nivel IMU óptimo e interactividad técnica. Cero badges largos o decoración "árbol de Navidad".
- **SpaceX Dragon / MBUX Zero-Layer / Leica Captivate:** Controles de cámara planos (`material-symbols-outlined`, sin cajas ni texto redundante), targets táctiles aptos para guantes (`>= 48px–64px`) en acciones críticas móviles, tipografía exclusiva `Atkinson Hyperlegible Next/Mono` (`tabular-nums`), `rounded-none` (`0px`), `shadow-none`, cero prosa y `autoComplete="off"` / `spellCheck={false}` en cualquier input auxiliar.
