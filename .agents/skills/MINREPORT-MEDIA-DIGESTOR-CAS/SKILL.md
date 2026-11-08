---
name: MINREPORT-MEDIA-DIGESTOR-CAS
description: Gobernador Soberano de Digestión Multimedia, Extracción Óptica/Vectorial de PDF y Consolidación Ligera CAS (SHA-256 + dHash 64-bit) en southamerica-west1. Se activa automáticamente en todo requerimiento que involucre ingesta, carga, recorte, optimización o almacenamiento de PDFs, imágenes, diagramas, simbología SVG o video en MINREPORT, OPERMAQ y STOCKPILE CONTROL.
---

# MINREPORT-MEDIA-DIGESTOR-CAS (Motor Soberano de Digestión Multimedia, Extracción de Información y Consolidación Ligera CAS)

Actúas como el **Arquitecto Principal de Ingesta Multimedia, Cosecha Óptica/Vectorial y Almacenamiento Direccionado por Contenido (CAS)** de **MINREPORT** (`MINREPORT`, `OPERMAQ` y `STOCKPILE CONTROL`).

> **MANDATO DE ACTIVACIÓN AUTOMÁTICA INCONDICIONAL:**
> Esta Skill se aplica **de oficio y sin que el usuario deba volver a solicitarlo** en todo nuevo requerimiento, endpoint, formulario o flujo de agentes que reciba, procese, recorte, extraiga o almacene archivos **PDF, fotografías de terreno, diagramas técnicos, esquemas CAD, simbología ISO/OEM o secuencias de video**.

---

## 1. Principio Rector: "Cero Crudos Pesados en Base de Datos — Solo la Versión Liviana Optimizada en CAS"

Queda **estrictamente prohibido** guardar buffers crudos sin optimizar, cadenas `base64` inline en documentos de Cloud Firestore o archivos duplicados en Cloud Storage. Todo activo multimedia o documental DEBE atravesar el pipeline de 4 etapas antes de tocar la persistencia en `southamerica-west1`:

1. **Pre-Vuelo y Deduplicación en Cliente (`MediaDigestorClient.ts`):**
   - Ruta: [`web/src/core/media/MediaDigestorClient.ts`](file:///Volumes/CODE/MINREPORT%20iMac/minreport/web/src/core/media/MediaDigestorClient.ts).
   - Antes de transmitir bytes por la red, calcula el hash `SHA-256` en el navegador (`Web Crypto API`) y consulta `/api/media/preflight`.
   - Si el blob ya existe en `media_registry/{sha256}` dentro del mismo ámbito (`GLOBAL_OEM`, `SYMBOLOGY_MASTER` o `TENANT_PRIVATE`), se reutiliza en `0 ms` con **0 bytes subidos**.
   - Si es nuevo, aplica pre-compresión en el cliente (WebP en `OffscreenCanvas` para imágenes o empaquetado de frames clave para video) antes del envío.

2. **Digestión, Recorte, Vectorización y Limpieza EXIF en Servidor (`MediaDigestorServer.ts`):**
   - Ruta: [`src/core/media/MediaDigestorServer.ts`](file:///Volumes/CODE/MINREPORT%20iMac/minreport/src/core/media/MediaDigestorServer.ts).
   - **Purga Total de Metadatos Privados (Ley N° 21.719):** Elimina `EXIF`, coordenadas `GPS`, `XMP`, autor y metadatos de dispositivo en el 100% de las imágenes y PDFs.
   - **Perfiles de Optimización Obligatorios (`MediaDigestionProfile`):**
     - `IMAGE_TECHNICAL_HD` (`maxDim: 2048px`, WebP `q=86`): Planos, diagramas hidráulicos/eléctricos y tablas técnicas recortadas de manuales OEM.
     - `IMAGE_FIELD_EVIDENCE` (`maxDim: 1280px`, WebP `q=76`): Fotografías operativas de terreno, hallazgos de inspección e incidentes.
     - `IMAGE_THUMBNAIL` (`maxDim: 420px`, WebP `q=62`): Miniaturas de catálogo y vistas previas de tarjetas/tablas.
     - `IMAGE_ISO_SYMBOL` (`maxDim: 512px`, WebP `nearLossless` + `autoTrimAlpha: true` con `sharp.trim()` o vectorización `.svg` vía `vtracer` WASM): Pictogramas ISO 7000 / ISO 7010 / GHS / OEM sin márgenes muertos.
     - `PDF_MANUAL_HYBRID`: Compresión estructural `pdf-lib` Object Streams + rasterización selectiva `mupdf` WASM (`withMupdfSemaphore`, máx. 2 instancias concurrentes) a `160 DPI` únicamente en páginas escaneadas pesadas sin capa de texto (`< 160` caracteres), preservando intactos los vectores CAD y el texto seleccionable.
     - `SVG_VECTOR_CLEAN`: Sanitización XML/XSS y minificación estructural de trazados vectoriales.
     - `VIDEO_KEYFRAME_DIGEST`: En flujos de video de inspección o terreno, nunca almacenar el contenedor de video pesado sin procesar en Firestore; extraer fotogramas clave (`keyframes` representativos optimizados en WebP `IMAGE_FIELD_EVIDENCE`) y consolidar únicamente el descriptor ligero y la transcripción/telemetría estructurada.

3. **Almacenamiento Único Direccionado por Contenido (`CasStorageService.ts`):**
   - Ruta: [`src/core/media/CasStorageService.ts`](file:///Volumes/CODE/MINREPORT%20iMac/minreport/src/core/media/CasStorageService.ts).
   - **Persistencia Exclusiva de la Versión Liviana:** Solo el binario resultante de `MediaDigestorServer` (`optimizedBytes`) se escribe en Cloud Storage (`southamerica-west1`) bajo su llave inmutable `SHA-256`:
     - `cas_blobs/global_oem/{sha256}.{ext}` (`GLOBAL_OEM` — Conocimiento técnico OEM compartido, `Cache-Control: public, max-age=31536000, immutable`).
     - `assets/symbology/cas/{sha256}.{ext}` (`SYMBOLOGY_MASTER` — Simbología vectorial universal).
     - `cas_blobs/tenants/{tenantId}/{sha256}.{ext}` (`TENANT_PRIVATE` — Evidencia privada aislada por `tenantId`).
   - **Deduplicación Doble (Exacta + Perceptual):**
     - Exacta `O(1)` por `sha256` en `media_registry/{sha256}` (incrementa `refCount`).
     - Perceptual por `phashHex` (`dHash` 64-bit, distancia de Hamming $\le 5$) para evitar guardar dos veces la misma imagen re-escalada o recodificada.

4. **Extracción Segmentada de Información y Cosecha de Figuras desde PDF (`SegmentedDocumentProcessorService.ts`):**
   - Ruta: [`src/modules/opermaq/services/SegmentedDocumentProcessorService.ts`](file:///Volumes/CODE/MINREPORT%20iMac/minreport/src/modules/opermaq/services/SegmentedDocumentProcessorService.ts).
   - **Deduplicación por Página (`FastCDC` SHA-256):** Calcula la huella por página para omitir páginas ya procesadas en ingestas previas.
   - **Cosecha Óptica `box_2d` `[ymin, xmin, ymax, xmax]` (escala `0..1000`):**
     - Renderiza con `mupdf` WASM únicamente las páginas que contienen diagramas, tablas complejas o símbolos detectados.
     - Recorta con precisión quirúrgica (`sharp.extract` con margen de seguridad `1.5%`), aplica `sharp.trim` en símbolos o `IMAGE_TECHNICAL_HD` WebP en diagramas, y guarda **solo el recorte liviano** en `CasStorageService`, vinculando su `ExtractedFigureRef` (`url`, `sha256`, `caption`, `page`, `kind`) directamente al ítem de la base de datos.
   - **Consolidación en Corpus Soberano (`vault_corpus_chunks`):**
     - Almacena el texto técnico extraído y estructurado en Markdown junto con sus embeddings `text-embedding-004` (`768d`) y metadatos de página/fuente, sin retener copias redundantes del PDF crudo por cada consulta.

---

## 2. Trazabilidad Obligatoria de Optimización (Estándar Heredado de Referencia Técnica: Peso Original vs. Peso Guardado y % de Optimización)

Todo archivo importado, recortado o procesado en MINREPORT (`PDF`, `Imagen`, `Figura box_2d`, `Símbolo SVG` o `Video`) **DEBE registrar en base de datos y presentar en la interfaz de usuario** sus 3 métricas de trazabilidad de compresión:
1. **`originalBytes` (Peso Original Real Pre-Digestión):**
   - Si el archivo fue pre-comprimido en el cliente (`MediaDigestorClient.ts`), el cliente DEBE enviar `clientOriginalBytes` (`rawFile.size`) al servidor (`/api/media/digest-upload`, `/api/vault/ingest-document`, etc.) para que `CasStorageService` y Firestore conserven el **peso crudo real original** y nunca lo sobrescriban con el peso intermedio pre-digerido.
   - Si es un recorte óptico `box_2d` desde una página PDF (`SegmentedDocumentProcessorService.ts`), `originalBytes` registra el peso del raster PNG recortado sin comprimir antes de su conversión a WebP/SVG en CAS.
2. **`optimizedBytes` (Peso Final Procesado y Guardado en CAS):**
   - El tamaño exacto en bytes del binario liviano efectivamente almacenado en `southamerica-west1`.
3. **`savingsRatio` (`0..1`) y `savingsPct` (`0..100%` — Porcentaje de Optimización):**
   - Calculado determinísticamente como:
     $$\text{savingsPct} = \max\left(0, \text{round}\left(\left(1 - \frac{\text{optimizedBytes}}{\text{originalBytes}}\right) \times 1000\right) / 10\right)\%$$
4. **Presentación Obligatoria en Interfaz (UI/UX Minimalismo Industrial Puro):**
   - Toda tabla de archivos ingeridos (`OpermaqEngineeringStudioDrawer`), galería de figuras técnicas (`ItemFiguresAndAdvisoriesBlock`, `ProposalCard`), fotografía principal de activo (`KnowledgeVaultDashboard`) y tabla de simbología debe exhibir en tipografía `Atkinson Hyperlegible Mono` (`font-mono tabular-nums`) la telemetría verificable:
     `ORIG: 14.20 MB ➔ CAS: 1.18 MB (-91.7%)`.

---

## 3. Reglas de Implementación para Nuevos Desarrollos

Siempre que implementes un nuevo módulo, ruta API o componente UI que maneje archivos o medios:

1. **En Backend (Rutas y Servicios):**
   - Importa y utiliza siempre `CasStorageService.digestAndStore(...)` pasando `clientOriginalBytes` cuando provenga de subida multipart pre-digerida.
   - Nunca uses `bucket.file(...).save(rawBuffer)` directo saltándote `MediaDigestorServer` y `CasStorageService`.
   - En documentos de Firestore (`media_registry`, `vault_files`, `ExtractedFigureRef` en `global_asset_catalog`, `tenant_assets`, `master_symbology_vault`, `stockpile_measurements`, `pilot_feedback`, `AuditLedger`), guarda **siempre** la versión liviana junto con `originalBytes`, `optimizedBytes` y `savingsRatio` (`savingsPct`).

2. **En Frontend (Componentes React / Capacitor PWA):**
   - Para subidas de archivos o capturas de cámara, utiliza `MediaDigestorClient` antes del `fetch`, adjuntando `clientOriginalBytes: String(rawFile.size)` en el `FormData`.
   - Muestra siempre el desglose `Peso Original | Peso Guardado CAS | % Optimización` en `font-mono tabular-nums` y envuelve los medios con los atributos de blindaje de activos de `GEMINI.md` (`draggable={false}`, `select-none pointer-events-none`, `loading="lazy"`).

