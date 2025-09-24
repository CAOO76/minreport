### **Manual de Resolución de Problemas de Pruebas en Monorepo MINREPORT (Vite/Vitest/PNPM/Firebase)**

**Introducción:**

Este manual es una bitácora de las lecciones aprendidas y las estrategias efectivas para diagnosticar y resolver fallos complejos en el entorno de pruebas de MINREPORT. La clave es la paciencia, la disciplina de "paso a paso, bit a bit" y la comprensión profunda de la interacción entre PNPM, Vite, Vitest, TypeScript y Firebase en un monorepo.

**Principios Clave de Depuración:**

1.  **Estrategia "Bit a Bit":** Nunca intentes arreglar múltiples cosas a la vez. Aísla el problema más pequeño, resuélvelo y verifica antes de pasar al siguiente.
2.  **Verificación Constante:** Tras cada cambio mínimo, ejecuta las pruebas relevantes para confirmar el efecto.
3.  **No Asumir:** Siempre verifica las configuraciones (`package.json`, `tsconfig.json`, `vite.config.ts`) y las dependencias.
4.  **Leer Errores Completos:** No ignores advertencias. Los mensajes de error de la consola son tu mejor guía.
5.  **Contexto del Monorepo:** Entiende que PNPM usa symlinks y que Vite/Vitest pueden tener comportamientos específicos en este entorno.
6.  **Identidad del Agente:** Soy Gemini, un modelo de lenguaje grande entrenado por Google.

**Flujo de Diagnóstico y Solución (Paso a Paso):**

#### **1. Identificación y Aislamiento del Fallo**

*   **Ejecutar Pruebas Generales:** `pnpm -r test`
*   **Identificar el Primer Fallo:** El log de `pnpm -r test` se detendrá en el *primer* paquete que falle. Concéntrate solo en ese paquete.
*   **Aislar la Suite de Pruebas:** Si el fallo es en un paquete específico, ejecuta las pruebas solo para ese paquete: `pnpm --filter <nombre_paquete> test`.
*   **Aislar el Archivo de Prueba:** Si el fallo persiste, aísla el archivo de prueba específico: `pnpm --filter <nombre_paquete> test <ruta/al/archivo.test.ts>`.

#### **2. Análisis Detallado del Error**

*   **Errores de Compilación/Transformación (Vite/TypeScript):**
    *   `Error: Failed to resolve import "..."`: Problemas de resolución de módulos.
    *   `Cannot find package "..."`: Dependencia no encontrada.
    *   `TSxxxx: ...`: Errores de TypeScript.
    *   `Transform failed with 1 error: ...`: Error de sintaxis o configuración en un archivo que Vite/Vitest intenta procesar.
*   **Errores de Ejecución (Vitest/Runtime):**
    *   `AssertionError`: La prueba espera algo diferente a lo que recibe.
    *   `TypeError: ... is not a function`: Mock incompleto o lógica de código incorrecta.
    *   `Test timed out` / `Test stuck`: Mocks asíncronos mal manejados.
    *   `expected "spy" to be called... Number of calls: 0`: El mock no fue llamado, verificar mocks y lógica.

#### **3. Estrategias de Solución (Aplicar "Bit a Bit")**

**A. Problemas de Lógica de Negocio / Código (Ej: `useAuth`):**

1.  **Auditar Código:** Leer el código de la función/hook (`.ts` o `.tsx`) para entender su propósito y lógica.
2.  **Demoler y Reconstruir (TDD):**
    *   Borrar el archivo de código (`.ts`/`.tsx`) y su archivo de prueba (`.test.ts`).
    *   **Paso 1 (Prueba Mínima):** Crear el archivo `.test.ts` con la prueba más simple que verifique el estado inicial.
    *   **Paso 2 (Código Mínimo):** Crear el archivo `.ts` con el código mínimo para que la prueba pase.
    *   **Paso 3 (Verificar):** Ejecutar `pnpm --filter <paquete> test <archivo.test.ts>`.
    *   **Repetir:** Añadir una nueva prueba para el siguiente escenario (ej: usuario no autenticado), luego el código para que pase, verificar. Continuar hasta cubrir toda la funcionalidad.
    *   **Manejo de Mocks Asíncronos:** Si el código usa funciones asíncronas (ej: `onAuthStateChanged`), asegúrate de que los mocks en el test también simulen el comportamiento asíncrono real (ej: `Promise.resolve().then(() => callback(...))`).

**B. Problemas de Configuración de TypeScript / Módulos (Ej: `services/functions`):**

1.  **`tsconfig.json`:**
    *   Asegurar que `compilerOptions.module` y `compilerOptions.moduleResolution` sean coherentes (ej: ambos `nodenext`).
    *   Si se usan alias en Vite (ej: `@minreport/core`), replicarlos en `compilerOptions.paths` en `tsconfig.base.json` o en el `tsconfig.json` del paquete.
2.  **`package.json`:**
    *   Asegurar que `"type": "module"` esté presente si el paquete usa ES Modules.
    *   Verificar que todas las dependencias necesarias estén explícitamente listadas (ej: `firebase` en `packages/core`, `firebase-functions-test` en `services/functions`).
3.  **Reconstruir y Verificar:** Tras modificar `tsconfig.json` o `package.json`, ejecutar `pnpm --filter <paquete> build` y luego `pnpm --filter <paquete> test`.

**C. Problemas de Resolución de Módulos en Monorepos (Ej: `admin-app`):**

1.  **Limpieza Profunda:** `rm -rf node_modules pnpm-lock.yaml && pnpm install`.
2.  **`vite.config.ts` (del paquete fallando):**
    *   `resolve.preserveSymlinks: false` (común con pnpm).
    *   `optimizeDeps.include`: Asegurar que las dependencias problemáticas estén listadas (ej: `firebase/auth`).
    *   `test.deps.optimizer.ssr.include`: Para dependencias enlazadas en monorepos (ej: `/@minreport\//`).
3.  **Mocks para Dependencias Externas (Ej: Playwright):**
    *   Si el error es de una herramienta externa, leer el mensaje de error.
    *   Ejecutar comandos sugeridos (ej: `pnpm exec playwright install`).

**D. Problemas de Mocks en Tests (Ej: `PluginViewer` o `firebaseConfig`):**

1.  **Mocks Completos:** Asegurar que los mocks de módulos exporten *todas* las funciones que el código real espera (ej: `getAuth`, `connectAuthEmulator`, `onAuthStateChanged` para `firebase/auth`).
2.  **Mocks Asíncronos:** Si el código real es asíncrono, el mock también debe simularlo (ej: `Promise.resolve().then(() => callback(...))`).
3.  **Mocks de Componentes:** Si un componente usa otro componente o hook que causa problemas, simularlo directamente en el test (ej: `ThemeToggleButton: () => null`).

#### **4. Verificación Final**

*   Una vez que una suite de pruebas individual pasa, ejecutar `pnpm -r test` para verificar que no se han introducido regresiones en otros paquetes.

**Conclusión:** La persistencia, el análisis detallado de cada error y la aplicación metódica de soluciones "bit a bit" son esenciales. No hay que perder la esperanza, incluso cuando el problema parece irresoluble.

---