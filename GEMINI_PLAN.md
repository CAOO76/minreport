# Plan de Desarrollo: MINREPORT

## 1. Descripción General del Producto

MINREPORT es una plataforma de planificación, gestión, control y reportabilidad para proyectos mineros, diseñada inicialmente para la pequeña minería en Chile con planes de expansión a Latinoamérica. El núcleo de la plataforma es un sistema dinámico de gestión de cuentas (`B2B` y `EDUCACIONALES`) y una arquitectura de plugins desacoplada que garantiza la estabilidad, seguridad y escalabilidad del sistema.

## 2. Arquitectura y Estrategia Tecnológica

Se adopta una estrategia de desarrollo moderna, minimalista y funcional, basada en las siguientes tecnologías y principios:

### Reglas Arquitectónicas Fundamentales

-   **Soberanía del Dato:** Todos los recursos en la nube deben residir exclusivamente en la región `southamerica-west1` (Santiago, Chile).
-   **Tecnología de Backend:** El backend se compone de servicios contenerizados en **Cloud Run**. No se utilizará App Engine ni Firebase Functions en la arquitectura.

### Patrones y Tecnologías

-   **Monorepo:** Se utiliza `pnpm workspaces` para gestionar todo el código base (frontends, backends, librerías compartidas) en un único repositorio, facilitando la coherencia y el desarrollo.
-   **Backend:** Servicios desacoplados escritos en **TypeScript** y desplegados como contenedores en **Cloud Run**.
-   **Frontend:** Aplicaciones **React (TypeScript) con Vite**. Se mantienen dos sitios separados:
    -   `client-app`: Portal público para solicitudes de cuenta y acceso de clientes (`minreport-access.web.app`).
    -   `admin-app`: Panel de administración para la gestión interna de MINREPORT (`minreport-x.web.app`).
-   **Base de Datos:** **Firestore** (NoSQL) para almacenar todos los datos.
-   **Despliegue:** **Firebase Hosting** para los frontends y **Cloud Run** para los servicios de backend.
-   **Desarrollo de Componentes:** **Storybook** se utiliza en `client-app` para desarrollar y documentar componentes de UI de forma aislada.

### Principios de Seguridad y Acceso

Se establecen los siguientes principios de seguridad como inalterables:

-   **Secretismo del Portal de Administración:** La URL de acceso para administradores (`minreport-x.web.app`) es confidencial. No debe ser enlazada o mencionada en ninguna web pública.
-   **Fallo de Autenticación Silencioso:** Si un usuario intenta acceder a un portal que no le corresponde, el sistema no proporcionará mensajes de error específicos.
-   **No Autocompletado en Formularios:** Todos los campos en formularios de inicio de sesión deben tener el autocompletado deshabilitado.

### Gestión de Entorno y Configuración

Para permitir el trabajo colaborativo en diferentes máquinas sin conflictos, se utiliza un sistema de variables de entorno:

-   **Archivo `.env` (Local):** Cada desarrollador debe crear un archivo `.env` en la raíz del proyecto para definir sus configuraciones locales (ej. puertos). Este archivo no se sube a GitHub.
-   **Archivo `.env.example` (Plantilla):** Existe un archivo `.env.example` en el repositorio que sirve como plantilla.

### Configuración del Entorno de Desarrollo Local (Colaborativo)

Para garantizar un entorno de desarrollo consistente y evitar conflictos de configuración entre colaboradores, especialmente en la gestión de puertos, sigue estas instrucciones:

1.  **Clonar el Repositorio:**
    ```bash
    git clone [URL_DEL_REPOSITORIO]
    cd minreport
    ```

2.  **Instalar pnpm:** Asegúrate de tener `pnpm` instalado globalmente. Si no, instálalo:
    ```bash
    npm install -g pnpm
    ```

3.  **Instalar Dependencias del Monorepo:**
    ```bash
    pnpm install
    ```

4.  **Configurar Variables de Entorno Locales (`.env`):**
    *   Crea un archivo `.env` en la raíz del proyecto copiando el `.env.example`:
        ```bash
        cp .env.example .env
        ```
    *   Este archivo `.env` es **exclusivo de tu máquina local** y no debe subirse a GitHub. Aquí puedes sobrescribir las configuraciones por defecto si es necesario (ej. si un puerto ya está en uso en tu sistema).
    *   **Variables de Entorno de Puertos de Servicios (para `services/*`):**
        *   `ACCOUNT_SERVICE_PORT=8081`
        *   `REGISTRATION_SERVICE_PORT=8082`
        *   `REVIEW_SERVICE_PORT=8083`
        Puedes cambiar estos valores en tu `.env` si los puertos por defecto están ocupados. Los servicios leerán estos valores.
    *   **Variables de Entorno de Emuladores de Firebase (para `sites/*`):**
        *   `VITE_EMULATOR_HOST=localhost`
        *   `VITE_AUTH_EMULATOR_PORT=9190`
        *   `VITE_FIRESTORE_EMULATOR_PORT=8085`
        Puedes ajustar `VITE_EMULATOR_HOST` si tus emuladores no corren en `localhost` o los puertos si los por defecto están ocupados.

5.  **Instalar Navegadores de Playwright (para pruebas de `client-app`):**
    ```bash
    pnpm --prefix sites/client-app exec playwright install
    ```
    Esto descargará los navegadores necesarios para ejecutar las pruebas automatizadas del frontend.

6.  **Iniciar el Entorno de Desarrollo Completo:**
    *   El script `dev` en el `package.json` raíz está configurado para iniciar todos los emuladores de Firebase, los servicios de backend y las aplicaciones frontend simultáneamente.
    *   Ejecuta:
        ```bash
        pnpm dev
        ```
    *   Esto iniciará:
        *   Emuladores de Firebase (Auth, Firestore, Storage, Hosting, UI) en los puertos definidos en `firebase.json` (o los sobrescritos en tu `.env`).
        *   Servicios de backend (`account-management-service`, `request-registration-service`, `review-request-service`) en los puertos definidos en sus respectivos `index.ts` (o los sobrescritos en tu `.env`).
        *   Aplicaciones frontend (`client-app` en `http://localhost:5175`, `admin-app` en `http://localhost:5174`).

7.  **Acceso a las Aplicaciones:**
    *   `client-app`: `http://localhost:5175` (o el puerto configurado en `sites/client-app/vite.config.ts`)
    *   `admin-app`: `http://localhost:5174` (o el puerto configurado en `sites/admin-app/vite.config.ts`)
    *   Firebase Emulator UI: `http://localhost:4001` (o el puerto configurado en `firebase.json`)

### Normas de Contribución con Git

Para mantener un historial de cambios limpio y legible, es mandatorio seguir estas normas:

1.  **Configurar Identidad de Git:** Cada desarrollador debe configurar su nombre y email en su máquina local.
    ```bash
    git config --global user.name "Tu Nombre"
    git config --global user.email "tu@email.com"
    ```
2.  **Mensajes de Commit Convencionales:** Todos los mensajes de commit deben seguir el estándar de [Conventional Commits](https://www.conventionalcommits.org/) (ej. `feat:`, `fix:`, `docs:`).

### Principios de Verificación y Despliegue

Para asegurar la calidad y estabilidad del proyecto, se establecen los siguientes niveles de verificación:

-   **Verificación en Entorno Local (Desarrollo Diario):** Para el desarrollo y la validación de funcionalidades individuales, el **entorno de emuladores local** se considera el "entorno real" de trabajo. Toda nueva funcionalidad debe ser probada y validada exhaustivamente aquí antes de ser considerada "terminada" para un commit.
-   **Verificación en Entorno de Staging/Producción (Integración y Despliegue):** Para la validación de la integración de múltiples funcionalidades, pruebas de rendimiento o la preparación para un lanzamiento, se realizará un despliegue completo a un entorno de staging o directamente a producción. Este paso es crucial para asegurar el comportamiento en un escenario real de la nube y detectar posibles regresiones o diferencias entre emuladores y servicios reales.

### Cierre de Sesión de Desarrollo

Para cerrar una sesión de desarrollo de manera eficiente y económica, sigue estos pasos:

1.  **Verificación Manual en Entorno Local:** Prueba manualmente la funcionalidad en la que trabajaste en la `client-app` o `admin-app` usando los emuladores.
2.  **Ejecución de Pruebas Automatizadas (si existen):** Si hay tests unitarios o de integración, ejecútalos localmente.
    **¡IMPORTANTE!** Los pasos 1 y 2 son **OBLIGATORIOS** y deben completarse **ANTES** de cualquier `commit` o `push`.
3.  **Consolidación en Git:** Haz un `commit` de tus cambios con un mensaje claro y siguiendo las "Normas de Contribución con Git".
4.  **Subir a GitHub:** Haz un `git push` para subir tus cambios al repositorio.

## 3. Flujo de Registro y Ciclo de Vida de la Cuenta

El proceso de alta de una cuenta es un flujo de aprobación de varios pasos, diseñado para máxima seguridad y control. **No se crean credenciales de acceso hasta la aprobación final.**

1.  **Solicitud Inicial:** Un usuario llena un formulario básico en `client-app`.
2.  **Recepción y Validación:** El servicio `request-registration-service` recibe la data, la valida y crea un documento en `requests` con estado `pending_review`.
3.  **Revisión de Administrador:** Un administrador revisa la solicitud en `admin-app`.
4.  **Aprobación Inicial o Rechazo:** El administrador aprueba (`pending_additional_data`) o rechaza (`rejected`) la solicitud.
5.  **Datos Adicionales:** El usuario recibe un email para completar un segundo formulario.
6.  **Aprobación Final:** El administrador revisa la información completa y otorga la aprobación final.
7.  **Creación de la Cuenta:** Solo en este punto, un servicio de backend crea el usuario en Firebase Authentication, crea el documento en la colección `accounts` y actualiza la solicitud a `approved`.
8.  **Trazabilidad:** Todas las acciones se registran en una colección `account_logs` para auditoría.

## 4. Política de Desarrollo y Colaboración (Desde 13/09/2025)

Para optimizar el uso de cuotas del plan Gemini Pro y agilizar el desarrollo, se establece la siguiente separación de roles:

-   **Rol de Gemini CLI (Generación de Código):** Responsable de **crear, editar y modificar** el código. No ejecutará comandos de terminal.
-   **Rol del Usuario (Ejecución de Comandos):** Responsable de **ejecutar manualmente** todos los comandos que Gemini CLI le indique.

## 5. Roadmap de Desarrollo (Fases)

(Roadmap sin cambios)
