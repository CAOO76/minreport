# MINREPORT — Regla Soberana de Protección de Datos Personales y Empresariales de Chile (Ley N° 19.628 y Nueva Ley N° 21.719)

Esta regla es de aplicación **permanente, obligatoria e inviolable (`always_on`)** para todos los agentes, subagentes, servicios backend, componentes frontend y pipelines CI/CD de **MINREPORT**.

---

## 1. Marco Legal Rector y Jurisdicción Exclusiva

Todo dato procesado, información generada, telemetría, manual técnico, plano, nube de puntos 3D y registro operativo en **MINREPORT** se rige estrictamente por:
1. **Ley N° 19.628** sobre Protección de la Vida Privada y **Nueva Ley N° 21.719** de Protección de Datos Personales de Chile (Agencia de Protección de Datos Personales):
   - **Privacidad desde el Diseño y por Defecto (Art. 14 ter Ley 21.719):** Ningún flujo puede exponer datos personales ni secretos industriales de clientes (`B2B` / `EDU`) por omisión.
   - **Minimización y Finalidad:** Solo se procesan los datos estrictamente necesarios para la operación técnica minera autorizada.
2. **Residencia Física y Jurisdiccional Exclusiva (`southamerica-west1` — Santiago de Chile):**
   - Toda persistencia (Cloud Firestore, Cloud Storage CAS `CasStorageService`, Secret Manager) y cómputo (Cloud Run, Cloud Functions Gen 2) debe residir **exclusivamente en `southamerica-west1`**.
   - Queda estrictamente prohibido transferir o alojar fuentes privadas en regiones no autorizadas.

---

## 2. Exclusividad del Motor Propio Símil NotebookLM y Bloqueo de Servicios de Terceros

1. **Prohibición Absoluta de Servicios de Consumo Externos para Fuentes de MINREPORT:**
   - Queda **terminantemente prohibido** alojar, procesar o sincronizar documentos, manuales, planos, nubes de puntos o bases de datos de MINREPORT o sus clientes en servicios de consumo de terceros tales como:
     - **Gemini Notebook / NotebookLM externo** (`notebooklm.google*`)
     - **Google Drive personal o de consumo** (`drive.google.com`)
     - **Google Colab** (`colab.research.google.com`) conectado a datos reales de `minreport-8f2a8`
2. **Uso Obligatorio del Motor Propio Símil NotebookLM de MINREPORT (`southamerica-west1`):**
   - Toda ingesta, segmentación, deduplicación CAS, vectorización y consulta conversacional sobre fuentes de información privada se ejecuta **100% mediante código propio de MINREPORT**:
     - Almacenamiento direccionado por contenido SHA-256: `src/core/media/CasStorageService.ts` (`cas_blobs/tenants/{tenantId}/` y `cas_blobs/global_oem/`).
     - Ingesta y cosecha documental PDF/WASM: `src/modules/opermaq/services/SegmentedDocumentProcessorService.ts`.
     - Asistente contextual de Bóveda: `src/modules/opermaq/services/vaultChatService.ts` operando en modo **`SOVEREIGN_VAULT_FIRST`** (`useGoogleSearch: false` por defecto).

---

## 3. Esclusa Zero-Trust Pre-Inferencia y Contrato Corporativo CDPA (Zero-Training)

1. **Centralización Obligatoria en `resilient-ai-client.ts`:**
   - Queda prohibido instanciar `new GoogleGenAI` o llamar a APIs de LLMs fuera de `src/core/resilient-ai-client.ts`.
2. **Garantía Paid-Tier CDPA (Cero Entrenamiento / Cero Revisión Humana):**
   - Toda inferencia de IA debe operar sobre proyectos cubiertos por facturación Cloud corporativa (`Pago de Firebase` / `minreport-8f2a8`) bajo el **Cloud Data Processing Addendum (CDPA)** de Google Cloud, donde Google tiene prohibido usar los prompts o documentos para entrenar modelos.
   - Queda prohibido utilizar llaves de API en modalidad gratuita (*Free Tier* sin facturación vinculada) en flujos de MINREPORT.
3. **Sanitización Determinista Obligatoria Pre-Vuelo (Ley 21.719):**
   - Antes de enviar cualquier texto con contexto de un tenant privado (`tenantId !== 'GLOBAL'`) a un modelo o a una búsqueda web externa, debe aplicarse obligatoriamente la purga determinista de PII chilena y secretos de faena (`ConfidentialityAirlockService.scrubDeterministicPii`):
     - **RUT Chileno** (`12.345.678-9` -> `[RUT_RESERVADO]`)
     - **Patentes Vehiculares Chilenas PPU** (`ABCD-12` -> `[PATENTE_RESERVADA]`)
     - **Teléfonos Chilenos** (`+56 9 ...` -> `[TEL_RESERVADO]`)
     - **Correos Electrónicos** (`[EMAIL_RESERVADO]`)
     - **Coordenadas GPS / UTM de Faena** (`[COORD_FAENA_RESERVADA]`)
     - **Órdenes de Compra, Contratos y Licitaciones** (`[REF_CONTRACTUAL_RESERVADA]`)
4. **Redacción Óptica en Imágenes Promovidas a `COMMONS`:**
   - Toda imagen capturada en terreno antes de promoverse al catálogo común (`GLOBAL_OEM`) debe pasar por `ConfidentialityAirlockService.sanitizeImageForCommons` (purga total de metadatos EXIF/GPS y desenfoque gaussiano `sharp` sobre rostros, patentes, credenciales e insignias corporativas de clientes).

