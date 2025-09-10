# Plan de Trabajo Final: MINREPORT

## Descripción General
MINREPORT es una aplicación serverless diseñada para la generación de reportes, optimizada para operar dentro de los límites de los planes gratuitos de Google Cloud y Firebase. La arquitectura sigue un enfoque de monorepo desacoplado para facilitar el mantenimiento y la escalabilidad.

## Arquitectura Tecnológica
- **Monorepo:** pnpm workspaces
- **Backend:** Cloud Functions for Firebase (TypeScript)
- **Frontend:** React con Vite (TypeScript), desplegado en Firebase Hosting (multi-sitio)
- **Base de Datos:** Firestore
- **UI Components:** Storybook y MSW para desarrollo desacoplado

---

## Estrategia de Optimización de Almacenamiento (< 5GB)
Para mantenernos dentro de la cuota gratuita de 5GB de Firebase Storage, implementaremos las siguientes tácticas:

1.  **Compresión de Imágenes en el Cliente:** Antes de subir cualquier imagen a Firebase Storage, se comprimirá y redimensionará en el lado del cliente utilizando librerías como `browser-image-compression`. El objetivo es reducir el tamaño de los archivos sin una pérdida de calidad perceptible.
2.  **Políticas de Ciclo de Vida de Objetos:** Se configurarán reglas de ciclo de vida en Firebase Storage para archivar o eliminar automáticamente los archivos que no se han accedido en un período determinado (ej. 90 días). Esto es ideal para reportes o datos temporales.
3.  **Uso de URLs en lugar de Almacenamiento Directo:** Para recursos que no son críticos o que pueden ser alojados externamente, se almacenarán únicamente las URLs en Firestore en lugar de los archivos completos en Storage.
4.  **Limpieza de Artefactos de Build:** El `.gitignore` está configurado para excluir directorios como `dist` y `build`, evitando que se suban al repositorio y ocupen espacio innecesario.

---

## Estrategia de Uso Eficiente de Cloud Functions (Control de Cuotas)
Para no exceder las 2 millones de invocaciones mensuales del plan gratuito, se aplicarán las siguientes estrategias:

1.  **Funciones Desencadenadas por Eventos:** Se priorizará el uso de funciones que se activan por eventos de Firestore, Storage o Authentication (`onWrite`, `onCreate`, `onDelete`). Esto evita la necesidad de endpoints HTTP para operaciones internas.
2.  **Agrupación de Operaciones (Batching):** En lugar de realizar múltiples escrituras a Firestore desde una función, se agruparán en una sola operación atómica (`batch`) para reducir el número de operaciones facturables.
3.  **Diseño de Datos para Minimizar Lecturas:** La estructura de datos en Firestore se diseñará de forma desnormalizada para evitar consultas complejas y reducir el número de lecturas necesarias por operación. Por ejemplo, si un reporte necesita datos de un usuario, se duplicarán los datos necesarios en el documento del reporte.
4.  **Uso de Cache en el Cliente:** Las aplicaciones frontend cachearán datos de Firestore localmente para reducir las lecturas repetitivas de información que no cambia con frecuencia.
5.  **Optimización de Tiempos de Ejecución:** El código de las funciones será lo más eficiente posible para minimizar el tiempo de ejecución, utilizando `Promise.all` para operaciones asíncronas paralelas y evitando la inicialización de variables globales dentro del cuerpo de la función.

---

## Registro de Progreso
- [x] Tarea 1: Inicializar Repositorio Git y Configurar Exclusiones.
- [x] Tarea 2: Crear la Arquitectura de Directorios.
- [x] Tarea 3: Crear el Archivo de Plan Maestro y Documentar Estrategias.
- [x] Tarea 4: Inicializar el Proyecto de Firebase.
- [x] Tarea 5: Inicializar Aplicaciones Frontend.
- [x] Tarea 6: Configurar la Arquitectura de UI Desacoplada.
- [x] Tarea 7: Conectar y Subir el Proyecto a GitHub.
