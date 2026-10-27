---
name: RESILIENT-AI-SWARM-ORCHESTRATOR
description: Orquestador del Enjambre Gemini AI (Capa 4 MINREPORT) con fallback Pro/Flash/Flash-Lite, caché determinista SHA-256, soporte multimodal, retroalimentación de TEST-PILOTS y aprobación humana HITL ("ACTUALIZAR").
---

# RESILIENT-AI-SWARM-ORCHESTRATOR (Capa 4 MINREPORT)

Gobierna toda inferencia de Inteligencia Artificial en **MINREPORT**, **OPERMAQ** y **STOCKPILE CONTROL**.

## 1. Reglas de Arquitectura de Inferencia
1. **Prohibición de Llamadas Directas desde el Cliente:** Ningún componente frontend ni servicio de módulo (como `vision-ia.ts`) puede leer `VITE_GEMINI_API_KEY` ni llamar directamente a `generativelanguage.googleapis.com`. Toda solicitud debe pasar por el backend (`/api/ai/inference` o `/api/vault/*`) hacia `src/core/resilient-ai-client.ts`.
2. **Jerarquía del Enjambre Gemini:**
   - **Primario (Razonamiento Crítico / HITL / Visión Compleja):** `gemini-2.5-pro`
   - **Secundario (Operación Estándar / Velocidad):** `gemini-2.5-flash`
   - **Ancla de Alta Disponibilidad (< 400ms P95):** `gemini-2.5-flash-lite`
3. **Algoritmo Invariante de Retroceso con Jitter:**
   $$D(n) = \min(32\text{ s}, 2.0\text{ s} \times 2^n) + \text{jitter}(0, 1\text{ s})$$
4. **Optimización de Costos Cloud/IA (Caché SHA-256):**
   - Antes de invocar la API de Gemini para prompts deterministas (`temperature <= 0.3`), `ResilientAIClient` verifica el hash SHA-256 (`module + modelTier + systemInstruction + prompt`) en la colección `ai_inference_cache` de Firestore.
5. **Entrenamiento Continuo por `TEST-PILOTS` y Gobernanza HITL:**
   - Las correcciones y observaciones emitidas por usuarios `TEST-PILOT` en `pilot_feedback` y `hitl_candidates` enriquecen las instrucciones de sistema del módulo correspondiente.
   - Toda mutación sugerida por IA sobre catálogos maestros o bóvedas técnicas requiere vista comparativa (`[Actual] ➔ [Sugerido]`) y confirmación humana escribiendo `"ACTUALIZAR"`.

