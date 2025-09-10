# Plan de Trabajo: MINREPORT

## Descripción General
MINREPORT es una plataforma de planificación, gestión, control y reportabilidad de proyectos mineros. Su núcleo es un gestor de cuentas dinámico con una arquitectura de plugins desacoplada para garantizar la estabilidad y escalabilidad del sistema.

## Arquitectura Tecnológica
- **Monorepo:** pnpm workspaces
- **Backend:** Cloud Functions for Firebase (TypeScript)
- **Frontend:** React con Vite (TypeScript), desplegado en Firebase Hosting (multi-sitio)
- **Base de Datos:** Firestore
- **UI Components:** Storybook para desarrollo de componentes de UI.

---

## FASE 1: Desarrollo del Núcleo - Flujo de Registro y Aprobación

El objetivo de esta fase es construir el sistema central de solicitud y aprobación de cuentas, que es la base de toda la plataforma.

**Task 9: Diseño de Datos en Firestore**
- **Descripción:** Definir y documentar los modelos de datos (esquemas) para las colecciones principales en Firestore:
  - `requests`: Almacenará todas las solicitudes de nuevas cuentas, con estados como `pending_review`, `pending_additional_data`, `rejected`, `approved`.
  - `accounts`: Contendrá la información detallada de las cuentas aprobadas y activas, incluyendo tipo (`B2B`, `EDUCATIONAL`), estado (`active`, `suspended`) y datos de la institución.
  - `account_logs`: Guardará un registro inmutable de todas las acciones importantes realizadas sobre una cuenta para garantizar la trazabilidad.
- **Estado:** `Pendiente`

**Task 10: UI - Formulario de Solicitud Inicial**
- **Descripción:** En la aplicación pública (`client-app`), crear una nueva página/ruta con un formulario para que los nuevos usuarios envíen su solicitud de cuenta inicial.
- **Estado:** `Pendiente`

**Task 11: Backend - Recepción de Solicitudes**
- **Descripción:** Crear una Cloud Function (HTTPS) llamada `requestInitialRegistration` que reciba los datos del formulario de la Task 10, los valide y cree un nuevo documento en la colección `requests`.
- **Estado:** `Pendiente`

**Task 12: UI - Panel de Revisión de Solicitudes**
- **Descripción:** En la aplicación de administración (`admin-app`), construir la interfaz que liste las solicitudes pendientes de la colección `requests`, permitiendo al super administrador ver los detalles de cada una.
- **Estado:** `Pendiente`

**Task 13: Backend - Lógica de Aprobación**
- **Descripción:** Crear las Cloud Functions (HTTPS, solo para administradores) que manejarán el flujo de aprobación:
  - `reviewRequest`: Permite al admin aprobar inicialmente una solicitud (cambiando su estado a `pending_additional_data`) o rechazarla.
  - `finalApproveAccount`: La función más crítica. Crea el usuario en Firebase Authentication, crea el documento final en la colección `accounts`, y actualiza todos los estados correspondientes.
- **Estado:** `Pendiente`

**Task 14: UI - Formulario de Datos Adicionales**
- **Descripción:** Crear la página y el formulario donde el usuario, después de la aprobación inicial, puede completar la información adicional requerida por el administrador.
- **Estado:** `Pendiente`

**Task 15: Implementación de Inicio de Sesión**
- **Descripción:** Crear la página de inicio de sesión en `client-app` para que los usuarios con cuentas finalmente aprobadas puedan autenticarse.
- **Estado:** `Pendiente`

---

## FASE 2: Gestión de Cuentas y Plugins (Próximamente)
- Tareas relacionadas con la suspensión/reactivación de cuentas.
- Tareas para la visualización de logs de trazabilidad.
- Tareas para la implementación de la arquitectura de plugins basada en eventos.

---

## Registro de Progreso Anterior
- [x] Tarea 1-8: Configuración inicial de la infraestructura, proyecto y despliegue.