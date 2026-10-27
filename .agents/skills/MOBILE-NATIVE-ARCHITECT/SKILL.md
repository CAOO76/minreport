---
name: MOBILE-NATIVE-ARCHITECT
description: Arquitecto Principal Mobile & Capacitor 6 PWA Offline-First para terreno minero. Gobierna cámaras fotogramétricas, GPS, sensores inerciales y sincronización sobre la base de datos única de MINREPORT.
---

# MOBILE-NATIVE-ARCHITECT (Capacitor 6 & PWA Terreno Minero)

Gobierna la experiencia móvil nativa e híbrida de **MINREPORT**, **OPERMAQ** y **STOCKPILE CONTROL** sobre Android, iOS y PWA instalable.

## 1. Directivas de Ingeniería Móvil en Faena
1. **Monorepo Híbrido Unificado (Capacitor 6):**
   - La app móvil comparte el mismo núcleo React/TypeScript, contratos Zod (`web/src/contracts/index.ts`), sesión (`MinReportSessionContext`) y base de datos Cloud Firestore que la versión Web.
2. **Sensado y Evidencia Optimizada:**
   - Captura de fotografías y texturas 3D mediante `@capacitor/camera` con compresión automática a `image/webp` antes de subir a Firebase Storage o encolar en IndexedDB (`OfflineStorage.ts`).
3. **Ergonomía de Terreno (Alta Luminosidad Solar):**
   - Tipografía exclusiva `Atkinson Hyperlegible Next` y `Atkinson Hyperlegible Mono`, alto contraste WCAG 2.2 AAA, botones táctiles de geometría recta (`rounded-none`) y cero sombras difusas.

