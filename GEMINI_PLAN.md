# Plan de Desarrollo: MINREPORT

## 1. Descripción General del Producto

MINREPORT es una plataforma de planificación, gestión, control y reportabilidad para proyectos mineros, diseñada inicialmente para la pequeña minería en Chile con planes de expansión a Latinoamérica. El núcleo de la plataforma es un sistema dinámico de gestión de cuentas (`B2B` y `EDUCACIONALES`) y una arquitectura de plugins desacoplada que garantiza la estabilidad, seguridad y escalabilidad del sistema.

## 2. Arquitectura y Estrategia Tecnológica

Se adopta una estrategia de desarrollo moderna, minimalista y funcional, basada en las siguientes tecnologías y principios:

-   **Monorepo:** Se utiliza `pnpm workspaces` para gestionar todo el código base (frontends, backends, librerías compartidas) en un único repositorio, facilitando la coherencia y el desarrollo.
-   **Backend:** Servicios desacoplados escritos en **TypeScript** y desplegados como contenedores en **Cloud Run**. Esto asegura la residencia de datos en `southamerica-west1` y evita las limitaciones de App Engine.
-   **Frontend:** Aplicaciones **React (TypeScript) con Vite**. Se mantienen dos sitios separados:
    -   `client-app`: Portal público para solicitudes de cuenta y acceso de clientes.
    -   `admin-app`: Panel de administración para la gestión interna de MINREPORT.
-   **Base de Datos:** **Firestore** (NoSQL) para almacenar todos los datos, incluyendo solicitudes, cuentas y logs de trazabilidad.
-   **Despliegue:** **Firebase Hosting** para los frontends y **Cloud Run** para los servicios de backend, configurado a través de `firebase.json`.
-   **Desarrollo de Componentes:** **Storybook** se utiliza en `client-app` para desarrollar y documentar componentes de UI de forma aislada, asegurando su reusabilidad y consistencia.
-   **Principio Fundamental: Desacoplamiento Total del Núcleo y Plugins:** Esta es la regla arquitectónica más importante. El núcleo de MINREPORT (gestión de cuentas, autenticación, datos base) es un sistema cerrado y estable. Los plugins son entidades completamente independientes que se comunican con el núcleo exclusivamente a través de un API Gateway y un bus de eventos bien definidos. **Bajo ninguna circunstancia un plugin podrá acceder directamente a la base de datos principal, modificar el código del núcleo o afectar la estabilidad de otros plugins.** Su desarrollo, despliegue, conexión y desconexión deben ser operaciones seguras y aisladas. Esta arquitectura es innegociable para permitir el desarrollo en paralelo por parte de terceros y garantizar la integridad y disponibilidad 24/7 de la plataforma.
-   **Preparación para Móvil:** La arquitectura de servicios desacoplados facilitará el desarrollo futuro de una aplicación móvil multiplataforma que consuma las mismas APIs.

### Principios de Verificación y Despliegue
-   **Verificación en Entorno Real:** Para confirmar cualquier avance o cambio en el proyecto, es **obligatorio** realizar un despliegue completo de la aplicación y verificar su funcionalidad y comportamiento directamente en el entorno web. Esto asegura que los cambios se comportan como se espera en un escenario de producción y y que no hay regresiones o problemas de integración.

## 3. Flujo de Registro y Ciclo de Vida de la Cuenta

El proceso de alta de una cuenta es un flujo de aprobación de varios pasos, diseñado para máxima seguridad y control. **No se crean credenciales de acceso hasta la aprobación final.**

1.  **Solicitud Inicial:** Un usuario llena un formulario básico en `client-app`.
2.  **Recepción y Validación:** El servicio `request-registration-service` (Cloud Run) recibe la data, la valida y crea un documento en la colección `requests` de Firestore con estado `pending_review`.
3.  **Revisión de Administrador:** Un super administrador revisa la solicitud pendiente en el `admin-app`.
4.  **Aprobación Inicial o Rechazo:** El administrador puede rechazar la solicitud (cambiando su estado a `rejected`) o aprobarla inicialmente (cambiando el estado a `pending_additional_data`).
5.  **Datos Adicionales:** El usuario es notificado para que complete un segundo formulario con información detallada de la institución.
6.  **Aprobación Final:** El administrador revisa la información completa y otorga la aprobación final.
7.  **Creación de la Cuenta:** **Solo en este punto**, un servicio de backend crea el usuario en **Firebase Authentication**, crea el documento final en la colección `accounts` con estado `active`, y actualiza el estado de la solicitud original a `approved`.
8.  **Trazabilidad:** Todas las acciones (solicitud, rechazo, aprobación, suspensión, etc.) se registran en una colección `account_logs` para garantizar una auditoría completa e inmutable. El historial jamás se borra.

## 4. Roadmap de Desarrollo (Fases)

### FASE 1: Núcleo de Cuentas y Registro (En Progreso)

El objetivo es completar el flujo de registro y aprobación.

-   [x] **Diseño de Datos en Firestore:** Colecciones `requests`, `accounts`, `account_logs`.
-   [x] **UI - Formulario de Solicitud Inicial:** Componente `RequestAccess.tsx` en `client-app`.
-   [x] **Backend - Recepción de Solicitudes:** Servicio `request-registration-service` en Cloud Run.
-   [x] **UI - Panel de Revisión de Solicitudes:** Componente `RequestReviewPanel.tsx` en `admin-app`.
-   [ ] **Backend - Lógica de Aprobación/Rechazo:** Crear los servicios de Cloud Run para que el admin gestione las solicitudes.
-   [ ] **UI - Formulario de Datos Adicionales:** Crear la vista para que el usuario complete su perfil tras la aprobación inicial.
-   [ ] **UI - Inicio de Sesión:** Implementar la página de login en `client-app` para cuentas activas.

### FASE 2: Gestión de Cuentas y Trazabilidad (Completada)

-   [x] **Gestión de Cuentas:** Implementación en `admin-app` de funcionalidades para visualizar y filtrar cuentas activas (B2B/EDUCACIONALES) y botón de suspender.
-   [x] **Visualizador de Trazabilidad:** Creación de la interfaz en `admin-app` para ver el historial de logs de una cuenta.
-   [ ] **Autenticación y Autorización en Admin-App:** Implementar inicio de sesión y verificación de rol de administrador para proteger el acceso al panel.

### FASE 3: Arquitectura de Plugins (Próximamente)

-   **Diseño del Bus de Eventos:** Definir la arquitectura para la comunicación entre el núcleo y los plugins.
-   **SDK de Plugins:** Crear una librería de desarrollo para facilitar la creación de plugins por terceros.
-   **Gestión de Plugins:** Implementar en `admin-app` la interfaz para asignar y configurar plugins a las cuentas.
-   **Desarrollo del Primer Plugin:** Crear un plugin de ejemplo (ej. "Reporte de Seguridad Básico").

### FASE 4: Versión Móvil y Métricas (Futuro)

-   **App Móvil:** Iniciar el desarrollo de la aplicación móvil multiplataforma para captura y visualización de datos en terreno.
-   **Dashboard de Métricas:** Implementar un panel en `admin-app` con métricas de uso de la plataforma y de los plugins.