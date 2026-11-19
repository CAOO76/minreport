---
name: RESILIENT-AI-SWARM-ORCHESTRATOR
description: Orquestador del Enjambre Gemini AI (Capa 4 MINREPORT) con fallback Pro/Flash/Flash-Lite, caché determinista SHA-256, soporte multimodal, retroalimentación de TEST-PILOTS y aprobación humana HITL ("ACTUALIZAR").
---

# RESILIENT-AI-SWARM-ORCHESTRATOR (Capa 4 MINREPORT)

Gobierna toda inferencia de Inteligencia Artificial en **MINREPORT**, **OPERMAQ** y **STOCKPILE CONTROL**.

## 1. Reglas de Arquitectura de Inferencia
1. **Prohibición de Llamadas Directas desde el Cliente:** Ningún componente frontend ni servicio de módulo (como `vision-ia.ts`) puede leer `VITE_GEMINI_API_KEY` ni llamar directamente a `generativelanguage.googleapis.com` (incluyendo `v1beta/decisions`). Toda solicitud debe pasar por el backend (`/api/ai/inference` o `/api/vault/*`) hacia `src/core/resilient-ai-client.ts`.
2. **Jerarquía del Enjambre Gemini (Evergreen 3.x + Nivel 0 Decisions):**
   - **Nivel 0 — Compuerta de Decisiones Calibradas (`ResilientAIClient.decide` / `gemini-decision-1`):** Para evaluación cerrada (`noul` Sí/No, `choice` selección única 2..255, `score` rúbrica lineal 2..255), enrutamiento y auditoría multimodal con `0` tokens de salida. Prohibido para generación de texto/Markdown, Grounding Web (`googleSearch`), extracción `box_2d` o embeddings.
     - Exige sanitización pre-vuelo `ConfidentialityAirlockService.scrubDeterministicPii` y caché SHA-256 (`dec_*`).
     - En producción exige perfil Paid-Tier CDPA (`PROD_SECRET_MANAGER_GCP`, prohibido Free Tier).
     - Si `USE_VERTEX_AI=true` y la carga es `TENANT_PRIVATE`, conmuta automáticamente hacia `ANCHOR_HA` en Vertex AI `southamerica-west1` hasta disponibilidad regional de `gemini-decision-1`; ante bloqueos `HTTP 400` de seguridad (`safety`, `prohibited_content`, etc.), aborta en modo Fail-Closed (`DecisionSafetyBlockedError`).
   - **Primario (Razonamiento Crítico / HITL / Visión Compleja):** `gemini-3.1-pro-preview`
   - **Secundario (Operación Estándar / Velocidad):** `gemini-3.8-flash`
   - **Ancla de Alta Disponibilidad (< 400ms P95):** `gemini-3.5-flash-lite`
3. **Algoritmo Invariante de Retroceso con Jitter:**
   $$D(n) = \min(32\text{ s}, 2.0\text{ s} \times 2^n) + \text{jitter}(0, 1\text{ s})$$
4. **Optimización de Costos Cloud/IA (Caché SHA-256):**
   - Antes de invocar la API de Gemini para prompts deterministas (`temperature <= 0.3`), `ResilientAIClient` verifica el hash SHA-256 (`module + modelTier + systemInstruction + prompt`) en la colección `ai_inference_cache` de Firestore.
5. **Entrenamiento Continuo por `TEST-PILOTS` y Gobernanza HITL:**
   - Las correcciones y observaciones emitidas por usuarios `TEST-PILOT` en `pilot_feedback` y `hitl_candidates` enriquecen las instrucciones de sistema del módulo correspondiente.
   - Toda mutación sugerida por IA sobre catálogos maestros o bóvedas técnicas requiere vista comparativa (`[Actual] ➔ [Sugerido]`) y confirmación humana escribiendo `"ACTUALIZAR"`.

