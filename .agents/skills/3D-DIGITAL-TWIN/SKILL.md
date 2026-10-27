---
name: 3D-DIGITAL-TWIN
description: Ingeniería de gemelos digitales 3D, fotogrametría y cubicación volumétrica mediante Three.js / React Three Fiber con carga diferida obligatoria e higiene estricta de memoria GPU (dispose).
---

# 3D-DIGITAL-TWIN (Capa 2 MINREPORT)

Gobierna la visualización espacial 3D, mallas topográficas (`.glb`) de acopios en `STOCKPILE CONTROL` y telemetría de activos en `OPERMAQ`.

## 1. Presupuesto Espacial e Higiene de Memoria GPU
1. **Carga Diferida Obligatoria:** Todo visor 3D, exportador GLTF o lienzo WebGL debe cargarse mediante `React.lazy` + `Suspense` o `import()` dinámico para no bloquear el LCP (< 1.2s).
2. **Liberación Estricta de Recursos (`dispose()`):**
   - Al desmontar un componente 3D o finalizar la generación de una malla (`BufferGeometry`, `Material`, `Texture`, `WebGLRenderer`), es **obligatorio** invocar `geometry.dispose()`, `material.dispose()` y `URL.revokeObjectURL(objectUrl)` en un bloque `finally` o `useEffect` cleanup.
3. **Estética Técnica:** Iluminación limpia sobre espacio negativo (`#000000` / `#FFFFFF`), wireframes de ingeniería en Cobre `#C68346` y Cian `#00AEEF`, y cero sombras CSS ornamentales.

