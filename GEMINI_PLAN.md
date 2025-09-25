# Plan de Desarrollo: MINREPORT

## 1. Descripción General del Producto

MINREPORT es una plataforma de planificación, gestión, control y reportabilidad para proyectos mineros, diseñada inicialmente para la pequeña minería en Chile con planes de expansión a Latinoamérica. El núcleo de la plataforma es un sistema dinámico de gestión de cuentas (`B2B` y `EDUCACIONALES`) y una arquitectura de plugins desacoplada que garantiza la estabilidad, seguridad y escalabilidad del sistema.

## 2. Arquitectura y Estrategia Tecnológica

Se adopta una estrategia de desarrollo moderna, minimalista y funcional, basada en las siguientes tecnologías y principios:

### Reglas Arquitectónicas Fundamentales

- **Soberanía del Dato:** Todos los recursos en la nube deben residir exclusivamente en la región `southamerica-west1` (Santiago, Chile).
- **Tecnología de Backend:** El backend se compondrá principalmente de servicios contenerizados en Cloud Run para la lógica de negocio compleja. Se permite el uso de Cloud Functions (2ª Gen), especialmente de tipo `onCall`, para acciones específicas que son invocadas directamente desde el cliente y se benefician de la capa de autenticación y contexto de Firebase Functions.

### Patrones y Tecnologías

- **Monorepo:** Se utiliza `pnpm workspaces` para gestionar todo el código base (frontends, backends, librerías compartidas) en un único repositorio, facilitando la coherencia y el desarrollo.
- **Backend:** Servicios desacoplados escritos en **TypeScript** y desplegados como contenedores en **Cloud Run**.
- **Frontend:** Aplicaciones **React (TypeScript) con Vite**. Se mantienen dos sitios separados:
    -   `client-app`: Portal público para solicitudes de cuenta y acceso de clientes (`minreport-access.web.app`).
    -   `admin-app`: Panel de administración para la gestión interna de MINREPORT (`minreport-x.web.app`).
- **Base de Datos:** **Firestore** (NoSQL) para almacenar todos los datos.
- **Despliegue:** **Firebase Hosting** para los frontends y **Cloud Run** para los servicios de backend.
- **Desarrollo de Componentes:** **Storybook** se utiliza en `client-app` para desarrollar y documentar componentes de UI de forma aislada.

### Principios de Seguridad y Acceso

Se establecen los siguientes principios de seguridad como inalterables:

- **Secretismo del Portal de Administración:** La URL de acceso para administradores (`minreport-x.web.app`) es confidencial. No debe ser enlazada o mencionada en ninguna web pública.
- **Fallo de Autenticación Silencioso:** Si un usuario intenta acceder a un portal que no le corresponde, el sistema no proporcionará mensajes de error específicos.
- **No Autocompletado en Formularios:** Todos los campos en formularios de inicio de sesión deben tener el autocompletado deshabilitado.

### Gestión de Entorno y Configuración

Para permitir el trabajo colaborativo en diferentes máquinas sin conflictos, se utiliza un sistema de variables de entorno:

- **Archivo `.env` (Local):** Cada desarrollador debe crear un archivo `.env` en la raíz del proyecto para definir sus configuraciones locales (ej. puertos). Este archivo no se sube a GitHub.
- **Archivo `.env.example` (Plantilla):** Existe un archivo `.env.example` en el repositorio que sirve como plantilla.

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

### Principios de Verificación y Despliegue (Actualizado 17/09/2025)

Para asegurar la calidad y la total funcionalidad del sistema en un contexto real, se establece la siguiente jerarquía de verificación, donde el despliegue completo es el criterio final de éxito.

-   **Nivel 1: Verificación en Entorno Local (Prueba Preliminar):** El entorno de emuladores local (`pnpm dev`) se utilizará para el desarrollo inicial y la validación rápida de funcionalidades. Es una herramienta para agilizar el desarrollo, pero **no se considera una prueba suficiente** para dar por finalizada una tarea.

-   **Nivel 2: Verificación en Entorno Desplegado (Prueba Mandatoria):** Como regla general, **toda implementación debe ser probada con todo el sistema desplegado** en un entorno de nube real (Staging o Producción). Una tarea solo se considerará "terminada" o "funcional" después de haber sido validada exitosamente en su URL pública o endpoint correspondiente tras un despliegue completo. Este paso es **mandatorio** para asegurar la compatibilidad, configuración y funcionamiento de todos los servicios integrados.

### Cierre de Sesión de Desarrollo

Para cerrar una sesión de desarrollo de manera eficiente y económica, sigue estos pasos:

1.  **Verificación Manual en Entorno Local:** Prueba manualmente la funcionalidad en la que trabajaste en la `client-app` o `admin-app` usando los emuladores.
2.  **Ejecución de Pruebas Automatizadas:** Ejecuta el conjunto de pruebas completo para asegurar que no hay regresiones.
    ```bash
    pnpm -r test
    ```
    **¡IMPORTANTE!** Los pasos 1 y 2 son **OBLIGATORIOS** y deben completarse **ANTES** de cualquier `commit` o `push`.

3.  **Consolidación y Subida a GitHub:** Prepara, consolida y sube tus cambios al repositorio. Sigue el estándar de [Conventional Commits](https://www.conventionalcommits.org/) para el mensaje.
    ```bash
    # 1. Añadir todos los cambios al área de preparación (staging)
    git add .

    # 2. Hacer commit con un mensaje descriptivo (ejemplo)
    git commit -m "feat: Add CI workflow and test comment"

    # 3. Subir los cambios a la rama principal
    git push origin main
    ```

4.  **Actualizar Bitácora:** Añadir una entrada en `GEMINI_PLAN.md` resumiendo el trabajo completado y el estado final de la tarea.

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

## 4. Arquitectura de Plugins Aislada con `<iframe>` (17/09/2025)

**Decisión Estratégica:** Se abandona por completo el uso de Module Federation en favor de una arquitectura basada en `<iframe>`. 

**Justificación:** La prioridad absoluta es garantizar la estabilidad, seguridad y aislamiento total del núcleo de MINREPORT (`client-app`). El uso de `<iframe>` proporciona el máximo nivel de sandboxing que ofrece el navegador, impidiendo que cualquier error, conflicto de dependencias o vulnerabilidad en un plugin pueda afectar a la aplicación principal.

### Modelo de Implementación

1.  **Contenedor de Plugins (`PluginViewer.tsx`):**
    *   Se ha creado un componente React (`PluginViewer`) en el núcleo (`client-app`) cuya única responsabilidad es renderizar un `<iframe>`.
    *   Este componente ocupa toda el área de contenido disponible, proporcionando al plugin un lienzo completo para su interfaz.
    *   Se utiliza el atributo `sandbox` en el `<iframe>` para restringir las capacidades del plugin a lo estrictamente necesario, aumentando la seguridad.

2.  **Carga de Plugins:**
    *   Cada plugin se desarrolla y despliega como una aplicación web completamente independiente (ej. en su propio subdominio o puerto).
    *   El núcleo (`client-app`) simplemente carga la URL del plugin en el `src` del `<iframe>` a través de una ruta dedicada (ej. `/plugins/nombre-del-plugin`).

3.  **Canal de Comunicación Seguro (`postMessage`):
    *   La comunicación entre el núcleo y el plugin se realiza exclusivamente a través de la API `window.postMessage`.
    *   **Núcleo hacia Plugin:** Al cargar el `<iframe>`, el `PluginViewer` envía un objeto con los datos de sesión (información del usuario, claims, etc.) al plugin. El origen del plugin se especifica explícitamente para evitar enviar datos a destinos no autorizados.
    *   **Plugin hacia Núcleo:** El `PluginViewer` implementa un listener de eventos que solo acepta mensajes provenientes del origen conocido del plugin. Esto permite al plugin solicitar acciones al núcleo (ej. realizar una llamada a la API de MINREPORT, solicitar una navegación) de forma segura y controlada.

## 5. Roadmap de Desarrollo (Fases)

(Roadmap sin cambios)

## 6. Actualización del Plan de Desarrollo (14/09/2025)

Se actualiza el flujo de creación de cuentas para adoptar un modelo de **aprobación única con trazabilidad absoluta**, reemplazando el flujo de múltiples pasos anterior.

### Plan de Optimización (v2): Flujo de Aprobación Única con Trazabilidad Absoluta

Este plan refina la propuesta anterior para incluir un sistema de auditoría detallado y validaciones basadas en el RUT.

#### **1. Estructura de Datos Auditable en Firestore**

*   **Acción:** Se modificará la estructura de datos para garantizar un historial inmutable por cada solicitud.
*   **Detalles:**
    *   **Historial por Solicitud:** Cada documento en la colección `requests` (`requests/{requestId}`) contendrá una subcolección `history`. Cada evento (creación, aprobación, rechazo, intento de duplicación) se registrará como un documento inmutable dentro de esa subcolección, incluyendo `timestamp`, `actor` (quién hizo la acción), `action` y `details`.
    *   **RUT como Clave de Negocio:** El campo `rut` será un campo obligatorio y principal en la colección `accounts`. Se asegurará que esté indexado para búsquedas eficientes.
    *   **Prohibición de Borrado:** Se establece como regla que ningún registro de solicitud o historial asociado a un RUT será eliminado jamás de la base de datos.

#### **2. Lógica de Negocio en `request-registration-service`**

*   **Acción:** Se centralizará y fortalecerá la lógica de negocio en este servicio.
*   **Detalles:**
    1.  **Validación Anti-Duplicación (Endpoint `createRequest`):**
        *   Antes de crear cualquier solicitud nueva, el servicio **verificará el `rut`** contra la colección `accounts`.
        *   **Si existe una cuenta `activa`:** Se rechaza la nueva solicitud y se registra el intento en el historial de la cuenta ya existente.
        *   **Si existe una cuenta `suspendida` o `cancelada`:** Se rechaza la solicitud de *nueva cuenta* y se informa al usuario sobre el estado actual, guiándolo a un futuro flujo de reactivación/reapertura. Se registra el intento.
        *   **Si no hay cuenta activa:** Se procede a crear la solicitud.
    2.  **Flujo de Aprobación Única (Endpoint `processRequest`):**
        *   Este endpoint reemplazará toda la lógica de aprobación anterior. Recibirá el `requestId`, la `decision` (`approved` | `rejected`) y la identidad del `admin`.
        *   Si es `approved`, el servicio se encargará de:
            1.  Crear el usuario en Firebase Auth.
            2.  Crear el documento final en la colección `accounts`.
            3.  Actualizar el estado de la solicitud original a `approved`.
            4.  Registrar la aprobación en el historial de la solicitud (`requests/{id}/history`).
        *   Si es `rejected`, se actualizará el estado y se registrará el motivo y el autor en el historial de la solicitud.

#### **3. Frontend (`client-app` y `admin-app`)**

*   **Acción:** Simplificar la experiencia del usuario y potenciar la del administrador.
*   **Detalles:**
    *   **`client-app`:** Se unificarán los formularios `RequestAccess` y `AdditionalDataForm` en uno solo. El usuario ingresará toda su información en un único paso.
    *   **`admin-app`:** El `AdminPanel` mostrará toda la información de la solicitud de una vez. Los botones serán "Aprobar y Crear Cuenta" y "Rechazar". Se añadirá una vista para consultar el historial detallado de cada solicitud.

#### **4. Limpieza de Arquitectura**

*   **Acción:** Eliminar código y servicios redundantes.
*   **Detalles:** El servicio `review-request-service` será completamente eliminado del monorepo, ya que su lógica se consolida en `request-registration-service`.

## 7. Actualización de Arquitectura (14/09/2025): Incorporación de Sitio Público

Se aprueba la siguiente modificación a la arquitectura de frontends para clarificar los dominios y puntos de acceso.

### Separación de Dominios

-   **`minreport.com` (Sitio Público):** Será la página de aterrizaje (landing page) pública y de marketing del proyecto. Contendrá información general y un punto de acceso para clientes.
    -   **Implementación:** Se creará una nueva aplicación React llamada `public-site` dentro de `sites/`.
    -   **Despliegue:** Se configurará para desplegarse en el hosting de Firebase asociado a `minreport.com`.

-   **`minreport-access.web.app` (Portal de Clientes):** Es la aplicación web privada donde los clientes inician sesión, gestionan sus datos y utilizan las herramientas de la plataforma.
    -   **Implementación:** Corresponde a la aplicación existente `client-app`.
    -   **Acceso:** Se accederá a través de un botón "Acceso Clientes" desde `minreport.com`.

### Plan de Implementación

1.  **Crear `public-site`:** Añadir una nueva aplicación React + Vite en `sites/public-site`.
2.  **Actualizar Configuración:** Modificar `pnpm-workspace.yaml`, `package.json` raíz y `firebase.json` para integrar el nuevo sitio.
3.  **Desarrollar Landing Page:** Implementar una página de inicio simple en `public-site` con un enlace claro hacia la `client-app`.

## 8. Redefinición del Ciclo de Vida de la Cuenta (14/09/2025)

Se redefine por completo el flujo de creación y activación de cuentas, reemplazando el modelo de aprobación única (v2). El nuevo modelo (v3) se basa en una cuenta provisional y un proceso de múltiples pasos para garantizar una mayor rigurosidad en la recolección de datos.

### Flujo v3: Activación con Cuenta Provisional

1.  **Solicitud de Acceso:**
    *   Un usuario llena un formulario de solicitud inicial en la `client-app`.
    *   El backend verifica que el RUT no esté asociado a una cuenta activa.
    *   Se crea un documento en la colección `requests` con estado `pending_review`.
    *   **Trazabilidad:** Se registra la acción `request_created` en el historial de la solicitud.

2.  **Aprobación Inicial:**
    *   Un administrador aprueba o rechaza la solicitud inicial desde el `admin-app`.
    *   Se notifica al solicitante vía Resend.
    *   **Si es aprobada:**
        *   Se crea un **usuario provisional** en Firebase Authentication con un claim personalizado (ej. `{ "status": "provisional" }`).
        *   Se actualiza el documento de la solicitud a `status: 'pending_additional_data'` y se le añade una fecha de expiración de 24 horas.
        *   Se envía un correo al solicitante con un enlace para iniciar sesión y completar la información requerida.
    *   **Trazabilidad:** Se registra `request_approved_initial` o `request_rejected_initial`.

3.  **Completar Datos por el Cliente:**
    *   El cliente inicia sesión con su cuenta provisional.
    *   Es redirigido a un formulario para completar datos **obligatorios**. El campo más importante es la designación del **Administrador de la Cuenta** (que puede ser una persona distinta al solicitante).
    *   Si no completa los datos en 24 horas, la cuenta provisional y la solicitud expiran.
    *   **Trazabilidad:** Una vez enviados los datos, se registra `additional_data_submitted` y el estado de la solicitud cambia a `pending_final_review`.

4.  **Aprobación Final y Activación:**
    *   Un administrador revisa la información completa en el `admin-app`.
    *   **Si es aprobada:**
        *   Se crea (o se actualiza) el usuario definitivo con los datos del **Administrador de la Cuenta** designado.
        *   Se crea el documento final en la colección `accounts`.
        *   El estado de la solicitud cambia a `activated`.
        *   Se envía un correo de bienvenida al **Administrador de la Cuenta** con un enlace para que **cree su contraseña por primera vez**. (Este enlace también debe ser seguro contra pre-fetching).
    *   **Si es rechazada:** El estado de la solicitud cambia a `rejected`.
    *   **Trazabilidad:** Se registra `account_activated` o `final_rejection`.

## 11. Redefinición del Flujo de Activación (v4 - 15/09/2025)

Se establece un nuevo flujo de activación que elimina el concepto de "cuenta provisional" para simplificar el proceso, aumentar la seguridad y resolver problemas con los enlaces de un solo uso de Firebase. **Este flujo v4 invalida el flujo v3.**

### Principios Fundamentales (v4)

-   **Cero Cuentas Provisionales:** No se crea ningún tipo de usuario en Firebase Authentication hasta la aprobación final por parte de un administrador.
-   **Token de Datos Seguros:** El proceso intermedio de recolección de datos se gestiona a través de un token seguro, de un solo uso y con tiempo de expiración, que no está ligado a una sesión de usuario.
-   **Trazabilidad Absoluta:** Todas las solicitudes de suscripción, sin importar su resultado (aprobada, rechazada, expirada), se registran y **nunca se eliminan** de la base de datos para garantizar una auditoría completa.
-   **Lógica de Reactivación:** Se pueden crear nuevas solicitudes de suscripción o reactivación para un mismo RUT/RUN siempre y cuando no exista ya una cuenta en estado `activa`.

### Flujo Detallado (v4)

1.  **Solicitud Inicial:**
    *   Un usuario llena el formulario `RequestAccess` en la `client-app`.
    *   El `request-registration-service` verifica que no exista una cuenta `activa` para el RUT/RUN proporcionado.
    *   Se crea un documento en la colección `requests` con estado `pending_review`.

2.  **Aprobación Inicial (Admin):**
    *   Un administrador aprueba la solicitud desde la `admin-app`.
    *   El `request-registration-service` **no crea un usuario**.
    *   Genera un **token criptográficamente seguro** y de un solo uso.
    *   Almacena el *hash* de este token en el documento de la solicitud junto con una fecha de expiración de 24 horas.
    *   Actualiza el estado de la solicitud a `pending_additional_data`.
    *   Envía un email al solicitante con un enlace público a la `client-app` que contiene el token en la URL (ej: `https://minreport-access.web.app/complete-data?token=...`).

3.  **Completar Datos por el Usuario (Sin Sesión):**
    *   El usuario hace clic en el enlace.
    *   La `client-app` recibe el token de la URL.
    *   Antes de mostrar el formulario, la `client-app` consulta a un nuevo endpoint del backend para validar el token.
    *   Si el token es válido, se muestra el formulario `CompleteDataForm`.
    *   El usuario envía los datos adicionales. La `client-app` envía estos datos junto con el token al backend.
    *   El backend verifica el token nuevamente, guarda los datos en la solicitud, la marca como `pending_final_review` e invalida el token para que no pueda ser reutilizado.

4.  **Aprobación Final y Creación de Cuenta (Admin):**
    *   Un administrador revisa la solicitud completa en la `admin-app`.
    *   Si la aprueba, el `request-registration-service` ejecuta la acción final:
        1.  **Crea el usuario definitivo** en Firebase Authentication.
        2.  Crea el documento correspondiente en la colección `accounts`.
        3.  Actualiza el estado de la solicitud a `activated`.
        4.  Envía un email de bienvenida al usuario con un enlace para que **cree su contraseña por primera vez**. (Este enlace también debe ser seguro contra pre-fetching).

Este es el flujo que regirá el desarrollo a partir de esta fecha.

## 12. Manejo de Direcciones y Verificación Geográfica (15/09/2025)

Se establecen los siguientes lineamientos para la captura y validación de datos de ubicación.

### 1. Captura de Datos de Ubicación

-   **Cuentas de Persona Natural (`INDIVIDUAL`):** Se capturará el **País** y la **Ciudad** en el primer formulario de solicitud (`RequestAccess.tsx`). No se solicitará dirección completa.
-   **Cuentas de Persona Jurídica (`EMPRESARIAL`, `EDUCACIONAL`):** En el segundo formulario (`CompleteDataForm.tsx`), se solicitará una dirección comercial estructurada en los siguientes campos: `Dirección (Calle y Número)`, `Ciudad`, `Región/Provincia/Estado` y `Código Postal`.

### 2. Verificación de Coherencia Geográfica

-   **País-Ciudad:** Se implementará una validación para asegurar que la ciudad introducida corresponde al país seleccionado. Para esto, se utilizará la librería `country-state-city`, que contiene una base de datos local y no requiere APIs externas.
-   **Validación de Dirección Comercial (Postergado):** La verificación de la existencia real de una dirección comercial (geocodificación) es un objetivo a futuro. Queda **pendiente y postergada** la integración de una API externa (como Google Maps Geocoding API) para esta funcionalidad, debido a la necesidad de gestionar claves de API y costes asociados. El sistema se diseñará para poder incorporar esta validación en el futuro sin cambios estructurales.

---


## 9. Manejo de RUT/RUN y Clasificación de Entidades (14/09/2025)

Se establecen nuevas directrices para el manejo del identificador tributario chileno (RUT/RUN) y la clasificación de las entidades solicitantes.

### Formato y Validación de RUT/RUN

-   **Formato de Almacenamiento:** El RUT/RUN se almacenará siempre en mayúsculas, con el número y el dígito verificador separados por un guion (ej. `12345678-K`).
-   **Normalización:** El sistema normalizará automáticamente el RUT/RUN ingresado por el usuario, independientemente de cómo lo haya tipeado (ej. `12345678K` o `12.345.678-K` se convertirán a `12345678-K`).
-   **Algoritmo de Verificación:** Se implementará el algoritmo estándar chileno para validar el dígito verificador del RUT/RUN tanto en el frontend como en el backend.

### Clasificación de Entidades (Persona Natural vs. Persona Jurídica)

-   **Nuevo Campo:** Se introducirá un nuevo campo `entityType` en el formulario de solicitud inicial (`RequestAccess.tsx`) con las opciones `natural` (persona natural) y `juridica` (persona jurídica).
-   **Etiquetado Dinámico:** La etiqueta del campo RUT/RUN se ajustará dinámicamente a "RUT de la Institución" o "RUN del Solicitante" según el `entityType` seleccionado.
-   **Propósito:** Esta clasificación permitirá ordenar y gestionar de forma diferenciada las cuentas, especialmente para futuros módulos como RRHH (donde los trabajadores serán personas naturales con RUN).

## 10. Simplificación y Especialización del Formulario de Solicitud (14/09/2025)

Se ajusta el formulario de solicitud de acceso para ofrecer una experiencia más simplificada y adaptada al tipo de cuenta, introduciendo el tipo "INDIVIDUAL".

### Formulario de Solicitud Inicial (`RequestAccess.tsx`)

-   **Selección de Tipo de Cuenta:** El campo "Tipo de Cuenta" se presentará mediante tres tarjetas visuales (ajustadas al mínimo tamaño necesario):
    -   **EMPRESARIAL:** Para empresas y organizaciones.
    -   **EDUCACIONAL:** Para instituciones educativas.
    -   **INDIVIDUAL:** Para personas naturales (ej. profesionales independientes, trabajadores).
-   **Campos Condicionales:**
    -   **Si se selecciona "EMPRESARIAL" o "EDUCACIONAL":** Se solicitarán los campos "Nombre de la Institución / Razón Social", "RUT de la Institución" y "País".
    -   **Si se selecciona "INDIVIDUAL":** Solo se solicitará el campo "País".
-   **Derivación de `entityType`:** El campo `entityType` (persona natural/jurídica) se derivará automáticamente del `accountType` seleccionado (`INDIVIDUAL` -> `natural`; `EMPRESARIAL`/`EDUCACIONAL` -> `juridica`). El campo `entityType` ya no será una selección explícita en este formulario.
-   **Manejo de RUN para Individuales:** Para solicitudes "INDIVIDUAL", el RUN se solicitará y validará en la etapa de la cuenta provisional (`CompleteDataForm.tsx`), no en el formulario inicial.

### Interfaz de Cuenta Provisional Diferenciada (`CompleteDataForm.tsx`)

-   **Adaptación por Tipo de Cuenta:** La interfaz del formulario para completar datos adicionales (`CompleteDataForm.tsx`) se adaptará según el `accountType` del usuario provisional.
-   **Cuentas "INDIVIDUAL":** Se presentará una interfaz simplificada que no incluirá información tributaria compleja o direcciones comerciales, ya que no aplica a personas naturales. Se solicitará el RUN en esta etapa.
-   **Cuentas "EMPRESARIAL" / "EDUCACIONAL":** Se mantendrá la solicitud de información detallada (direcciones, teléfonos, etc.).

### Información Adicional

-   La definición específica de la información adicional para cada tipo de cuenta se realizará en una fase posterior.

---
## 13. Ajuste del Ciclo de Suscripción y Direcciones con Google Maps (16/09/2025)

**Objetivo:** Modificar el ciclo de suscripción para diferenciar los datos requeridos por tipo de persona, simplificar la entrada de direcciones mediante la API de Google Maps y mantener intacta la operatividad del flujo de activación v4.

### Plan de Trabajo Revisado y Cauteloso

**Fase 1: Análisis de Código (Paso de solo lectura)**

Antes de escribir o modificar una sola línea de código, realizaré un análisis exhaustivo para entender exactamente cómo funcionan los subtipos "B2B" y "EDUCACIONAL" y dónde se gestionan los datos de dirección actuales.

1.  **Acción:** Usar la herramienta de búsqueda para localizar las apariciones de `B2B`, `EDUCACIONAL`, y campos de dirección (`direccion`, `calle`, `ciudad`, `pais`, etc.) en todo el proyecto, especialmente dentro de `sites/client-app` y `services/request-registration-service`.
2.  **Objetivo:** Crear un mapa preciso de los componentes, estados y lógica de negocio involucrados en el formulario de suscripción actual. Esto permitirá identificar el lugar exacto para cada cambio sin afectar el flujo de notificaciones, creación de claves, etc.

**Fase 2: Implementación Frontend Incremental (`sites/client-app`)**

Realizaré los cambios en el frontend en pequeños pasos, asegurando que la aplicación siga siendo funcional después de cada uno.

1.  **Paso 2.1: Añadir Campos de País y Ciudad.**
    *   **Acción:** Modificar el formulario de solicitud para añadir los campos `select` de "País" y "Ciudad" para todos los tipos de persona. Implementar la lógica de dependencia entre ellos.
    *   **Verificación:** Después de este cambio, el formulario deberá ser 100% funcional, simplemente ignorando los nuevos campos en el envío de datos hasta que el backend esté listo.

2.  **Paso 2.2: Introducir Dirección Comercial con Google Maps (Condicionalmente).**
    *   **Acción:**
        *   Instalar `@react-google-maps/api` y configurar el acceso a la API Key mediante variables de entorno.
        *   Identificar la condición que ya existe para diferenciar "Persona Jurídica" (y sus subtipos B2B/EDUCACIONAL).
        *   Usando esa condición, mostrar el nuevo campo "Dirección Comercial" utilizando el componente de autocompletado de Google Maps.
        *   Los campos de dirección antiguos (`calle`, `número`, etc.) serán **ocultados visualmente** (no eliminados del código) cuando aparezca el nuevo campo de Google Maps, para simplificar la UI sin romper nada.
    *   **Verificación:** La aplicación seguirá funcionando. El nuevo campo solo aparecerá para personas jurídicas y los datos del formulario se seguirán enviando como antes.

**Fase 3: Adaptación del Backend y Contrato de Datos**

1.  **Acción:**
    *   Actualizar `DATA_CONTRACT.md` para incluir los nuevos campos.
    *   Modificar `request-registration-service` para que sea capaz de recibir `pais`, `ciudad` y la `direccionComercial` (proveniente de Google Maps).
    *   La lógica del servicio se adaptará para manejar los datos de la new dirección y asociarlos correctamente a la cuenta.
    *   **Verificación:** Probar el flujo completo de suscripción para una persona natural y una jurídica, asegurando que los datos llegan correctamente y el resto del proceso (notificaciones, etc.) no se ve afectado.

**Fase 4: Limpieza de Código (Solo tras confirmación)**

1.  **Acción:** Una vez que se confirme que todo el nuevo flujo funciona a la perfección durante un tiempo prudencial, procederé a eliminar del código los antiguos campos de dirección que fueron ocultados en el paso 2.2.
2.  **Objetivo:** Dejar el código limpio y eliminar la deuda técnica, pero solo cuando sea 100% seguro hacerlo.

### Estado (16/09/2025)

**Estado:** Completado y consolidado en commit `064b04f`.

## 15. Plan de Evolución: Arquitectura de Plugins a SDK (18/09/2025)

**Objetivo:** Formalizar la arquitectura de comunicación de plugins en un SDK distribuible (`@minreport/sdk`) para mejorar la experiencia de desarrollo de terceros, la seguridad y la mantenibilidad.

### Fase 1: Creación del Paquete `@minreport/sdk` y Abstracción de Comunicación

**Meta:** Eliminar la necesidad de que los desarrolladores de plugins interactúen directamente con la API `postMessage`.

-   **1.1.** Crear una nueva carpeta de paquete en `packages/sdk`.
-   **1.2.** Inicializar un `package.json` para `@minreport/sdk`, configurándolo para la compilación de una librería TypeScript.
-   **1.3.** Implementar la función `initialize(allowedOrigins)`:
    *   Esta función será lo primero que un plugin debe llamar.
    *   Establecerá un `listener` de `message` para recibir datos del núcleo.
    *   Validará que el `event.origin` esté en la lista `allowedOrigins` proporcionada.
    *   Almacenará los datos de sesión (`user`, `claims`) en una variable interna segura.
-   **1.4.** Implementar la función `getSession()`:
    *   Devolverá los datos de sesión almacenados, permitiendo al plugin acceder a la información del usuario de forma síncrona después de la inicialización.
-   **1.5.** Definir y exportar todas las interfaces de TypeScript relevantes (ej. `MinreportUser`, `MinreportClaims`) para una experiencia de desarrollo tipada.
-   **1.6. [Verificación]** Refactorizar `sites/test-plugin` para que importe y utilice el nuevo SDK `@minreport/sdk` en lugar de su lógica manual de `postMessage`.

### Fase 2: Gestión Centralizada y Carga Dinámica de Plugins

**Meta:** Eliminar las URLs hardcodeadas del código y gestionarlas desde una base de datos central.

-   **2.1.** Actualizar `DATA_CONTRACT.md` para definir una nueva colección `plugins` en Firestore. Cada documento contendrá `pluginId`, `name`, `description`, `url` y `version`.
-   **2.2.** Crear una nueva página en `admin-app` para la gestión (CRUD) de los documentos en esta nueva colección `plugins`.
-   **2.3. [Verificación]** Refactorizar el componente `PluginViewer.tsx` en `client-app`:
    *   Eliminar el objeto `PLUGIN_URLS` hardcodeado.
    *   Al montarse, deberá obtener la `url` del plugin desde la colección `plugins` en Firestore usando el `pluginId` de los parámetros de la ruta.

### Fase 3: Habilitación de Comunicación Bidireccional (Plugin -> Núcleo)

**Meta:** Permitir que los plugins soliciten acciones al núcleo de forma segura y controlada.

-   **3.1.** Definir un nuevo tipo de mensaje, `MINREPORT_ACTION`, con una estructura `{ type: 'MINREPORT_ACTION', payload: { action: string, data: any } }`.
-   **3.2.** Implementar en el SDK (`@minreport/sdk`) funciones de acción seguras. Por ejemplo:
    -   `requestNavigation(path: string)`: Enviará una acción `{ action: 'navigate', data: { path } }`.
    -   `showNotification(level: 'info' | 'success' | 'error', message: string)`: Enviará una acción `{ action: 'showNotification', data: { level, message } }`.
-   **3.3.** Actualizar el `listener` de eventos en `PluginViewer.tsx` para que:
    *   Escuche los mensajes de tipo `MINREPORT_ACTION`.
    *   Valide rigurosamente el origen y la estructura del mensaje.
    *   Utilice un `switch` en `payload.action` para ejecutar **únicamente un conjunto predefinido y seguro de acciones** (ej. usar `react-router` para navegar, o un sistema de notificaciones para mostrar un mensaje).
-   **3.4. [Verificación]** Añadir botones en `sites/test-plugin` que utilicen las nuevas funciones del SDK (`requestNavigation`, `showNotification`) para demostrar y probar la comunicación bidireccional.

## 16. Plan de Estabilización: Refactorización de Gestión de Plugins (18/09/2025)

**Objetivo:** Corregir un bug crítico que causa la pérdida de datos al asignar plugins y alinear el componente `ManageClientPlugins.tsx` con la arquitectura de datos centralizada. **Esta tarea tiene la máxima prioridad sobre cualquier otra.**

### Fase 1: Eliminación de Lógica Obsoleta y Peligrosa (Backend)

-   **1.1.** Localizar la Cloud Function `togglePluginStatus` en el directorio `services/functions/src`.
-   **1.2.** Eliminar el archivo o el código correspondiente a la función `togglePluginStatus` para erradicar la causa del borrado de datos.
-   **1.3.** Actualizar el `index.ts` de las funciones para remover la exportación de `togglePluginStatus`.

### Fase 2: Refactorización del Componente de Gestión (Frontend)

-   **2.1.** Modificar `ManageClientPlugins.tsx` para que obtenga la lista de plugins disponibles desde la colección `plugins` de Firestore, en lugar de la lista estática `availablePlugins`.
-   **2.2.** Reemplazar la llamada a la Cloud Function `togglePluginStatus` con una llamada directa y segura a Firestore desde el propio componente.
-   **2.3.** Implementar la lógica de guardado usando `updateDoc` para modificar únicamente el campo `activePlugins` en el documento de la cuenta. Esto garantiza que no se sobrescriban otros campos.
-   **2.4. [Verificación]** Probar el flujo completo en el `admin-app`: la lista de plugins debe aparecer dinámicamente, y al activar/desactivar un plugin, solo el campo correspondiente en el documento de la cuenta debe cambiar, sin pérdida de datos.

## 17. Plan de Implementación: Portal de Desarrolladores de Plugins (v1) (18/09/2025)

**Objetivo:** Crear un sistema robusto dentro del `admin-app` para registrar desarrolladores de plugins, enviarles acceso seguro al SDK y mantener una trazabilidad completa de su ciclo de vida, sentando las bases para una futura gestión de plugins.

### Fase 1: Fundamentos de Datos y Lógica de Negocio

-   **1.1. [Contrato de Datos] Actualizar `DATA_CONTRACT.md`:**
    -   Definir una nueva colección principal: `plugin_developers`. Cada documento representará a un desarrollador o empresa externa.
        -   **Campos:** `developerName`, `developerEmail`, `companyName`, `status` (ej: `pending_invitation`, `invited`, `active`, `revoked`), `invitationToken` (hash y expiración), `createdAt`.
    -   Definir una subcolección `development_logs` dentro de cada documento de desarrollador para registrar un historial inmutable de eventos.
        -   **Campos del log:** `timestamp`, `event` (ej: `developer_registered`, `invitation_sent`, `portal_accessed`), `details`.
    -   Añadir un campo opcional `developerId` a la definición de la colección `plugins` existente para vincular un plugin a su creador.


    -   Crear una nueva **Cloud Function de tipo `onCall`** que centralice las operaciones de gestión.
    -   **Acción `registerDeveloper`:** Recibirá los datos del nuevo desarrollador, creará el documento correspondiente en la colección `plugin_developers` y registrará el evento `developer_registered` en su historial.
    -   **Acción `sendDeveloperInvitation`:**
        1.  Recibirá el ID del desarrollador.
        2.  Generará un **token seguro, de un solo uso y con 24h de expiración** (usando la misma lógica del flujo de activación de cuentas v4).
        3.  Almacenará el *hash* de dicho token en el documento del desarrollador.
        4.  Enviará un email (vía Resend) al `developerEmail` con un enlace único al futuro portal de desarrollador (ej: `.../developer-portal?token=...`).
        5.  Registrará el evento `invitation_sent`.
    -   **Acción `validateDeveloperToken`:** Recibirá un token, buscará su hash en la colección, verificará que no haya expirado y, si es válido, lo marcará como utilizado y registrará el evento `portal_accessed`.

### Fase 2: Interfaz de Administración (`admin-app`)

**Meta:** Proveer a los administradores de MINREPORT una UI para gestionar el ciclo de vida de los desarrolladores de plugins.

-   **2.1. [UI] Crear Página de Gestión `Developers.tsx`:**
    -   Crear el componente de página `sites/admin-app/src/pages/Developers.tsx`.
    -   Esta página mostrará una tabla o lista de todos los desarrolladores registrados, obteniendo los datos de la colección `plugin_developers`.
    -   Incluirá un formulario (en un modal) para registrar un nuevo desarrollador, que llamará a la acción `registerDeveloper` del backend.

-   **2.2. [UI] Implementar Acciones y Navegación:**
    -   En la lista de desarrolladores, añadir un botón "Enviar Invitación" para cada uno que esté en estado `pending_invitation`. Este botón llamará a la acción `sendDeveloperInvitation`.
    -   Añadir una nueva ruta `/developers` en el `App.tsx` del `admin-app`.
    -   Añadir un nuevo enlace en el menú `Sidebar.tsx` con el texto "Desarrolladores" y un icono apropiado (ej: `code` o `integration_instructions`).

-   **2.3. [Verificación]** Probar el flujo completo desde la UI del administrador: registrar un nuevo desarrollador, verlo en la lista, enviarle una invitación y verificar en Firestore que el estado y el log de eventos se actualizan correctamente.

### Fase 3: Portal Básico para Desarrolladores (`client-app`)

**Meta:** Crear un punto de entrada seguro y controlado para que el desarrollador invitado acceda a los recursos del SDK.

-   **3.1. [UI] Crear Página Segura `DeveloperPortal.tsx`:**
    -   Crear el componente de página `sites/client-app/src/pages/DeveloperPortal.tsx`.
    -   Esta página será accesible a través de una ruta pública que no requiere login: `/developer-portal`.

-   **3.2. [Lógica] Implementar Verificación de Token:**
    *   Al cargar, la página leerá el `token` de los parámetros de la URL.
    *   Llamará a la acción `validateDeveloperToken` del backend para verificar su validez.
    *   Si el token no es válido o ya fue usado, mostrará un mensaje de "Acceso Denegado" o "Enlace Expirado".

-   **3.3. [Contenido] Mostrar Recursos del SDK:**
    *   Si el token es válido, la página mostrará:
        *   Un mensaje de bienvenida personalizado.
        *   Una sección de "Primeros Pasos" con una breve explicación.
        *   Un botón destacado: **"Descargar Paquete SDK (`@minreport/sdk`)"**. Por ahora, este botón puede apuntar a una URL temporal o simplemente registrar un evento.

-   **3.4. [Verificación]** Probar el flujo completo del desarrollador: recibir el email, hacer clic en el enlace, aterrizar en el portal, y que el sistema muestre el contenido correcto y registre el acceso en el log de eventos.

## 18. Protocolo de Emergencia: Persistencia de Datos en Emuladores (19/09/2025)

Esta sección documenta la solución definitiva al problema recurrente de pérdida de datos en la Firebase Emulator Suite durante el desarrollo local.

### Síntoma Principal

Al reiniciar el entorno de desarrollo (usando `pnpm dev`), los datos creados en la sesión anterior (usuarios en Authentication, documentos en Firestore, etc.) desaparecen. Esto provoca la pérdida del super admin y bloquea el acceso a la plataforma.

### Diagnóstico de la Causa Raíz

Tras un análisis exhaustivo con logs de depuración, se determinó que la causa raíz **no es** un problema de propagación de señales (`SIGINT`) en `pnpm` o `concurrently`, sino un **comportamiento anómalo en `firebase-tools`**.

-   **El Problema:** Al especificar la ruta de exportación en el flag `--export-on-exit` (ej: `--export-on-exit=./ruta`), el emulador intenta un mecanismo interno de "intercambio" de directorios que falla silenciosamente en algunos sistemas, resultando en que los datos se escriben en una carpeta temporal que nunca llega a su destino final.
-   **La Solución:** La forma correcta y robusta de configurar la persistencia es especificar la ruta de datos **únicamente** en el flag `--import` y usar `--export-on-exit` como un simple flag booleano (sin asignarle una ruta). Esto le indica al emulador que debe exportar los datos al mismo directorio del que los importó, evitando el mecanismo de "intercambio".

### Configuración Correcta y Definitiva (`package.json`)

Para que la persistencia funcione correctamente, los scripts en el `package.json` raíz deben tener la siguiente estructura:

```json
{
  "scripts": {
    "emulators:start": "firebase emulators:start --import=./firebase-emulators-data --export-on-exit",
    "dev": "concurrently --kill-others --kill-signal SIGINT --raw "pnpm:emulators:start" "pnpm:dev:services" "pnpm:dev:client" ...",
    "db:seed": "cross-env FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190' ts-node services/functions/src/seed-emulators.ts"
  }
}
```

-   `emulators:start`: Define la configuración de persistencia correcta.
-   `dev`: Asegura que la señal de cierre (`Ctrl+C`) se propague correctamente a los emuladores para que puedan guardar los datos.
-   `db:seed`: Permite (re)crear el estado inicial de la base de datos, incluyendo el super admin.

### Protocolo de Reseteo y Siembra (Para un Inicio Limpio)

Este es el procedimiento para resetear la base de datos del emulador a un estado inicial conocido y válido.

1.  **Detener Emuladores:** Asegúrate de que ningún proceso de `pnpm dev` o emuladores esté corriendo.
2.  **(Opcional) Limpieza Total:** Para un reseteo completo, elimina la carpeta de datos existente.
    ```bash
    rm -rf firebase-emulators-data
    ```
3.  **Iniciar Emuladores:** En una **primera terminal**, inicia los emuladores en modo de espera.
    ```bash
    pnpm emulators:start
    ```
4.  **Sembrar Datos:** En una **segunda terminal**, ejecuta el script de siembra para crear el super admin y cualquier otro dato inicial.
    ```bash
    pnpm db:seed
    ```
5.  **Guardar Estado Inicial:** Una vez que la siembra termine, vuelve a la **primera terminal** y presiona `Ctrl+C`. Los emuladores se cerrarán y guardarán este nuevo estado inicial en la carpeta `firebase-emulators-data`.

A partir de este punto, se puede usar `pnpm dev` para el trabajo diario con la certeza de que los datos persistirán.
## 19. Estabilización de CI y Entorno de Test (21/09/2025)

Se resuelven una serie de errores que impedían la correcta ejecución del pipeline de CI y los tests locales.

- **Corrección de Dependencia:** Se corrige una dependencia de workspace incorrecta en `test-plugin` (de `@minreport/sdk` a `@minreport/core`), solucionando un error `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` durante la instalación.
- **Limpieza de Submódulo Obsoleto:** Se elimina por completo el registro del submódulo de git `minreport-plugin-sdk-template`, que estaba mal configurado y causaba un error fatal en el post-job de la CI.
- **Habilitación de Tests de Navegador:** Se asegura la instalación de los navegadores de Playwright, requisito indispensable para la ejecución de los tests de `sites/client-app`, solucionando un error de `Executable doesn't exist`.

Estos cambios restauran la integridad del pipeline de integración continua y la fiabilidad de la ejecución de tests en el entorno local.

---

### **Plan de Trabajo Detallado: Arquitectura de Plugins Híbridos MINREPORT**

**Épica 1: El Núcleo - Módulo de Carga Segura y Comunicación**

*   **Objetivo:** Crear un `PluginViewer` centralizado y seguro, y refactorizar la aplicación principal para usarlo.
*   **Requerimientos:**
    *   Debe usar un sistema de "tickets" para la carga inicial del `<iframe>`.
    *   Debe inyectar el tema visual y el `idToken` de forma segura.
    *   Debe actuar como proxy para las acciones que el plugin solicite al backend.

*   **Tareas a Realizar:**
    *   `[X]` **Crear el paquete `@minreport/core`:** Si no existe, inicializar la estructura de carpetas y `package.json` en `packages/core`.
    *   `[X]` **Crear `PluginViewer.tsx` en `@minreport/core`:**
        *   `[X]` Implementar la lógica que acepta un `pluginId`.
        *   `[X]` Llamar a la nueva Cloud Function `generatePluginLoadToken` para obtener un "ticket" de carga.
        *   `[X]` Renderizar un `<iframe>` cuyo `src` incluya el ticket como query param (`?ticket=...`).
        *   `[X]` Añadir el atributo `sandbox="allow-scripts allow-same-origin allow-forms"` al `<iframe>`.
    *   `[X]` **Implementar el canal de comunicación en `PluginViewer.tsx`:**
        *   `[X]` En el evento `onLoad` del iframe, enviar un `postMessage` de tipo `MINREPORT_INIT` al plugin, conteniendo el `idToken` del usuario y un objeto `theme` con las variables de diseño.
        *   `[X]` Crear un listener de `message` que escuche por eventos de tipo `MINREPORT_ACTION` provenientes del plugin.
        *   `[X]` Validar siempre que `event.origin` coincida con el origen de la URL del plugin.
        *   `[X]` Implementar un `switch` para las acciones (`saveData`, `getData`). Dentro de cada `case`, llamar a la Cloud Function correspondiente (ej. `savePluginData`) y pasarle el payload.
        *   `[X]` Al recibir la respuesta de la Cloud Function, enviarla de vuelta al plugin con un `postMessage` de tipo `MINREPORT_RESPONSE`, incluyendo el `correlationId` original.
    *   `[X]` **Refactorizar `sites/client-app`:**
        *   `[X]` Eliminar el archivo local `sites/client-app/src/components/PluginViewer.tsx`.
        *   `[X]` Actualizar `sites/client-app/src/App.tsx` para importar y usar el nuevo `PluginViewer` desde `@minreport/core`.

**Épica 2: El Backend - Servicios de Seguridad y API de Plugins**

*   **Objetivo:** Construir los endpoints necesarios para el ciclo de vida seguro del plugin.
*   **Requerimientos:**
    *   Todas las funciones deben desplegarse en `southamerica-west1`.
    *   Deben usar el modelo de Callable Functions para validación automática de `idToken`.

*   **Tareas a Realizar:**
    *   `[X]` **Crear el "Bouncer" (`generatePluginLoadToken`):**
        *   `[X]` Crear el archivo `services/functions/src/tokens.ts`.
        *   `[X]` Implementar una **Callable Function** `generatePluginLoadToken({ pluginId })`.
        *   `[X]` La función debe generar un JWT de un solo uso con expiración corta (60s) que contenga el `uid` y el `pluginId`.
        *   `[X]` La función debe retornar el JWT (el "ticket") al cliente.
    *   `[X]` **Crear la "Caja Fuerte" (Ejemplo `savePluginData`):**
        *   `[X]` Crear el archivo `services/functions/src/pluginApi.ts`.
        *   `[X]` Implementar una **Callable Function** `savePluginData({ pluginId, data })`.
        *   `[X]` La función debe verificar que `context.auth` no sea nulo.
        *   `[X]` La función debe verificar que `context.auth.token.activePlugins` sea un array que incluya el `pluginId` recibido. Si no, lanzar error `permission-denied`.
        *   `[X]` Realizar la operación de escritura simulada en Firestore.
        *   `[X]` Retornar un objeto de éxito.
    *   `[X]` **Actualizar el punto de entrada del backend:**
        *   `[X]` En `services/functions/src/index.ts`, importar y exportar las nuevas funciones `generatePluginLoadToken` y `savePluginData`.

**Épica 3: El SDK - El Canal de Comunicación Oficial**

*   **Objetivo:** Crear un paquete NPM que abstraiga toda la comunicación para los desarrolladores de plugins.
*   **Requerimientos:**
    *   Debe ser un cliente de `postMessage` puro.
    *   Debe usar un sistema de promesas con IDs de correlación.

*   **Tareas a Realizar:**
    *   `[X]` **Crear el paquete `@minreport/sdk`:**
        *   `[X]` Crear la estructura de carpetas y `package.json` en `packages/sdk`.
    *   `[X]` **Implementar `sdk.init(callback)`:**
        *   `[X]` Crear el archivo `packages/sdk/src/index.ts`.
        *   `[X]` La función `init` debe crear un listener de `message` que espere el evento `MINREPORT_INIT` del Núcleo.
        *   `[X]` Al recibirlo, debe guardar internamente el `idToken` y el `theme`.
        *   `[X]` Debe aplicar dinámicamente el objeto `theme` como variables CSS en el `:root` del documento.
        *   `[X]` Debe ejecutar el `callback` del usuario pasándole la sesión.
    *   `[X]` **Implementar funciones de acción (ej. `sdk.saveData`):**
        *   `[X]` La función debe generar un ID de correlación único (`correlationId`).
        *   `[X]` Debe enviar un `postMessage` al `window.parent` con `{ type: 'MINREPORT_ACTION', payload: { action: 'saveData', data: ..., correlationId } }`.
        *   `[X]` Debe retornar una `Promise` que se resolverá o rechazará cuando reciba un mensaje `MINREPORT_RESPONSE` con el mismo `correlationId`.

**Épica 4: El Plugin - Adaptación al Nuevo Modelo**

*   **Objetivo:** Refactorizar el plugin de prueba para que sea un ejemplo funcional de la nueva arquitectura.
*   **Requerimientos:**
    *   Debe usar exclusivamente el SDK para comunicarse.
    *   Su UI debe ser 100% "themeable".

*   **Tareas a Realizar:**
    *   `[X]` **Refactorizar `sites/test-plugin/src/App.tsx`:**
        *   `[X]` Eliminar todo el código actual del `useEffect`.
        *   `[X]` Implementar la inicialización usando la nueva función `sdk.init()`.
    *   `[X]` **Crear `DataForm.tsx` y `DataForm.css` en `test-plugin`:**
        *   `[X]` `DataForm.tsx` debe renderizar un formulario y llamar a `sdk.saveData()` en el evento `onClick`.
        *   `[X]` `DataForm.css` debe estilizar el formulario usando **exclusivamente** variables CSS (ej. `var(--theme-primary-color)`).
    *   `[X]` **Añadir `manifest.json`:**
        *   `[X]` Crear un archivo `sites/test-plugin/public/manifest.json` con información básica del plugin (nombre, id, etc.).

**Épica 5: Alojamiento Seguro para Plugins Externos**

*   **Objetivo:** Crear un ejemplo de servidor que proteja el código fuente de un plugin externo.
*   **Requerimientos:**
    *   Debe validar el "ticket" de carga antes de servir los archivos.

*   **Tareas a Realizar:**
    *   `[X]` **Crear un servidor Express.js de ejemplo:**
        *   `[X]` Crear una nueva carpeta `examples/external-plugin-server`.
        *   `[X]` Implementar un middleware que intercepte todas las peticiones.
        *   `[X]` El middleware debe extraer el `ticket` de la URL.
        *   `[X]` Debe simular una llamada a un endpoint de MINREPORT para validar el ticket.
        *   `[X]` Si el ticket es inválido, retorna `403 Forbidden`. Si es válido, llama a `next()`.
        *   `[X]` Configurar el servidor para servir los archivos estáticos de una carpeta `build` después del middleware.

---

### **Épica 6: Actualización y Cobertura de Pruebas**

*   **Objetivo:** Asegurar que la nueva arquitectura de plugins esté cubierta por pruebas automáticas robustas, validando cada componente de forma aislada y el flujo completo de extremo a extremo.

*   **Tareas a Realizar:**
    *   `[ ]` **Pruebas Unitarias para el SDK (`@minreport/sdk`):**
        *   `[ ]` Crear mocks para `window.postMessage` y el DOM.
        *   `[ ]` Escribir pruebas que verifiquen que la función `init` resuelve la promesa correctamente al recibir el mensaje `MINREPORT_INIT`.
        *   `[ ]` Escribir pruebas que verifiquen que las funciones de acción (ej. `savePluginData`) envían el mensaje `MINREPORT_ACTION` con el formato y `correlationId` correctos.
    *   `[ ]` **Pruebas de Integración para el Núcleo (`@minreport/core`):**
        *   `[ ]` Escribir pruebas para el componente `PluginViewer` que simulen el renderizado dentro de un anfitrión de React.
        *   `[ ]` Validar que, al montarse, llama correctamente a la función para obtener el ticket de carga.
        *   `[ ]` Validar que envía el mensaje `MINREPORT_INIT` cuando el `iframe` emite el evento `load`.
    *   `[ ]` **Pruebas Unitarias para el Backend (Cloud Functions):**
        *   `[ ]` Configurar el entorno de pruebas de Firebase para emular las Cloud Functions.
        *   `[ ]` Escribir pruebas para `generatePluginLoadToken` que validen que solo los usuarios autenticados y con los permisos correctos pueden generar un token.
        *   `[ ]` Escribir pruebas para `savePluginData` que verifiquen la lógica de autorización basada en `custom claims`.
    *   `[ ]` **Pruebas de Extremo a Extremo (E2E con Playwright):**
        *   `[ ]` Modificar o crear un nuevo flujo de prueba en Playwright para `sites/client-app`.
        *   `[ ]` El test debe simular el login de un usuario.
        *   `[ ]` El test debe navegar a la URL de un plugin (ej. `/plugins/test-plugin`).
        *   `[ ]` El test debe verificar que el `iframe` se carga correctamente.
        *   `[ ]` El test debe verificar que un elemento dentro del `iframe` (del `test-plugin`) que depende del contexto del SDK (ej. el email del usuario) se renderiza correctamente.
## 20. Plan de Implementación: Nueva Mecánica de Activación de Plugins (23/09/2025)

**Objetivo:** Actualizar la mecánica de uso de plugins para que la visibilidad en la UI del cliente sea controlada por el administrador, manteniendo los plugins vinculados por defecto.

**Reglas de Implementación:**
*   No utilizar funciones preexistentes (solo nuevas con nuevos nombres).
*   No utilizar App Engine.
*   Utilizar únicamente la región `southamerica-west1`.

### Fase 1: Backend - Nuevas Cloud Functions para la Gestión de Plugins de Clientes

*   **Objetivo:** Crear una nueva Cloud Function para gestionar la lista `activePlugins` en los documentos de las cuentas.

1.  **[X] Tarea 1.1: Crear archivo `clientPluginManagement.ts`**
    *   Crear el archivo `services/functions/src/clientPluginManagement.ts`.
2.  **[X] Tarea 1.2: Implementar `manageClientPluginsCallable`**
    *   Dentro de `clientPluginManagement.ts`, implementar la Cloud Function `onCall` `manageClientPluginsCallable`.
    *   Asegurar la verificación de autenticación y permisos de administrador.
    *   Implementar la lógica para añadir/eliminar `pluginId` del array `activePlugins` en el documento de la cuenta.
    *   Asegurar la idempotencia.
3.  **[X] Tarea 1.3: Exportar función**
    *   Exportar `manageClientPluginsCallable` desde `services/functions/src/index.ts`.

### Fase 2: Frontend - Interfaz de Activación de Plugins en Admin App

*   **Objetivo:** Implementar la interfaz de usuario en la `admin-app` para que los administradores gestionen los plugins de los clientes.

1.  **[X] Tarea 2.1: Crear `ClientPluginManagementPage.tsx`**
    *   Crear el archivo `sites/admin-app/src/pages/ClientPluginManagementPage.tsx`.
    *   Implementar la lógica para obtener `accountId` de los parámetros de la URL.
    *   Implementar la obtención de todos los plugins de la colección `plugins` de Firestore.
    *   Implementar la obtención de la lista `activePlugins` del documento de la cuenta.
    *   Renderizar la lista de plugins con un `M3Switch` para cada uno, reflejando el estado de activación.
    *   Implementar la llamada a `manageClientPluginsCallable` al cambiar el `M3Switch`.
2.  **[X] Tarea 2.2: Añadir ruta en `admin-app`**
    *   Añadir la ruta `/accounts/:accountId/manage-plugins` en `sites/admin-app/src/App.tsx`.
3.  **[X] Tarea 2.3: Modificar `AccountDetailsPage.tsx`**
    *   Identificar el componente de detalles de la cuenta (ej. `sites/admin-app/src/pages/AccountDetailsPage.tsx`).
    *   Insertar un icono/botón para navegar a `/accounts/:accountId/manage-plugins`.

### Fase 3: Frontend - Visibilidad de Plugins en Client App

*   **Objetivo:** Asegurar que los plugins solo sean visibles en la UI del cliente si han sido activados por un administrador.

1.  **[X] Tarea 3.1: Verificar `PluginViewer.tsx`**
    *   Confirmar que la lógica existente en `packages/core/src/components/PluginViewer.tsx` (`if (!claims?.admin && (!activePlugins || !activePlugins.includes(pluginId)))`) es suficiente para controlar la visibilidad. (No se esperan cambios de código aquí).

### Fase 4: Data Model - Firestore

*   **Objetivo:** Asegurar que el documento de la cuenta (`accounts`) incluya el array `activePlugins`.

1.  **[X] Tarea 4.1: Actualizar `DATA_CONTRACT.md`**
    *   Añadir la definición del campo `activePlugins: string[]` (por defecto array vacío) a la colección `accounts` en `DATA_CONTRACT.md`.

### Fase 5: Test Plugin - Vinculación por Defecto

*   **Objetivo:** Asegurar que el plugin de prueba esté siempre disponible para activación.

1.  **[X] Tarea 5.1: Confirmar disponibilidad**
    *   Verificar que el plugin de prueba se lista como un plugin disponible en la `ClientPluginManagementPage` (no se requieren cambios de código, es una verificación de la lógica de la Fase 2.1).

1
  (Vite/Vitest/PNPM/Firebase)

  Introducción:

  Este manual es una bitácora de las lecciones aprendidas y las 
  estrategias efectivas para diagnosticar y resolver fallos 
  complejos en el entorno de pruebas de MINREPORT. La clave es la 
  paciencia, la disciplina de "paso a paso, bit a bit" y la 
  comprensión profunda de la interacción entre PNPM, Vite, Vitest, 
  TypeScript y Firebase en un monorepo.

  Principios Clave de Depuración:

   1. Estrategia "Bit a Bit": Nunca intentes arreglar múltiples cosas a 
      la vez. Aísla el problema más pequeño, resuélvelo y verifica antes
       de pasar al siguiente.
   2. Verificación Constante: Tras cada cambio mínimo, ejecuta las 
      pruebas relevantes para confirmar el efecto.
   3. No Asumir: Siempre verifica las configuraciones (package.json, 
      tsconfig.json, vite.config.ts) y las dependencias.
   4. Leer Errores Completos: No ignores advertencias. Los mensajes de 
      error de la consola son tu mejor guía.
   5. Contexto del Monorepo: Entiende que PNPM usa symlinks y que 
      Vite/Vitest pueden tener comportamientos específicos en este 
      entorno.
   6. Identidad del Agente: Soy Gemini, un modelo de lenguaje grande 
      entrenado por Google.

  Flujo de Diagnóstico y Solución (Paso a Paso):

  1. Identificación y Aislamiento del Fallo

   * Ejecutar Pruebas Generales: pnpm -r test
   * Identificar el Primer Fallo: El log de pnpm -r test se detendrá en 
     el primer paquete que falle. Concéntrate solo en ese paquete.
   * Aislar la Suite de Pruebas: Si el fallo es en un paquete 
     específico, ejecuta las pruebas solo para ese paquete: pnpm 
     --filter <nombre_paquete> test.
   * Aislar el Archivo de Prueba: Si el fallo persiste, aísla el 
     archivo de prueba específico: pnpm --filter <nombre_paquete> test 
     <ruta/al/archivo.test.ts>.

  2. Análisis Detallado del Error

   * Errores de Compilación/Transformación (Vite/TypeScript):
       * Error: Failed to resolve import "...": Problemas de resolución 
         de módulos.
       * Cannot find package "...": Dependencia no encontrada.
       * TSxxxx: ...: Errores de TypeScript (sintaxis, tipos, 
         configuración).
       * Transform failed with 1 error: ...: Error de sintaxis o 
         configuración en un archivo que Vite/Vitest intenta procesar.
   * Errores de Ejecución (Vitest/Runtime):
       * AssertionError: La prueba espera algo diferente a lo que 
         recibe.
       * TypeError: ... is not not a function: Mock incompleto, mock 
         asíncrono mal manejado o lógica de código incorrecta.
       * Test timed out / Test stuck: Mocks asíncronos mal manejados o 
         condiciones de waitFor que nunca se cumplen.
       * expected "spy" to be called... Number of calls: 0: El mock no 
         fue llamado, verificar mocks y lógica.

  3. Estrategias de Solución (Aplicar "Bit a Bit")

  A. Problemas de Lógica de Negocio / Código (Ej: `useAuth`):

   1. Auditar Código: Leer el código de la función/hook (.ts o .tsx) 
      para entender su propósito y lógica.
   2. Demoler y Reconstruir (TDD):
       * Borrar el archivo de código (.ts/.tsx) y su archivo de prueba 
         (.test.ts).
       * Paso 1 (Prueba Mínima): Crear el archivo .test.ts con la 
         prueba más simple que verifique el estado inicial.
       * Paso 2 (Código Mínimo): Crear el archivo .ts con el código 
         mínimo para que la prueba anterior pase.
       * Paso 3 (Verificar): Ejecutar pnpm --filter <paquete> test 
         <archivo.test.ts>.
       * Repetir: Añadir una nueva prueba para el siguiente escenario 
         (ej: usuario no autenticado), luego el código para que pase, 
         verificar. Continuar hasta cubrir toda la funcionalidad.
       * Manejo de Mocks Asíncronos: Si el código usa funciones 
         asíncronas (ej: onAuthStateChanged), asegúrate de que los 
         mocks en el test también simulen el comportamiento asíncrono 
         (ej: Promise.resolve().then(() => callback(...))).

  B. Problemas de Configuración de TypeScript / Módulos (Ej: 
  `services/functions`):

   1. `tsconfig.json`:
       * Asegurar que compilerOptions.module y 
         compilerOptions.moduleResolution sean coherentes (ej: ambos 
         nodenext).
       * Si se usan alias en Vite (ej: @minreport/core), replicarlos en 
         compilerOptions.paths en tsconfig.base.json o en el 
         tsconfig.json del paquete.
   2. `package.json`:
       * Asegurar que "type": "module" esté presente si el paquete usa 
         ES Modules.
       * Verificar que todas las dependencias necesarias estén 
         explícitamente listadas (ej: firebase en packages/core, 
         firebase-functions-test en services/functions).
   3. Reconstruir y Verificar: Tras modificar tsconfig.json o 
      package.json, ejecutar pnpm --filter <paquete> build y luego pnpm 
      --filter <paquete> test.

  C. Problemas de Resolución de Módulos en Monorepos (Ej: 
  `admin-app`):

   1. Limpieza Profunda: rm -rf node_modules pnpm-lock.yaml && pnpm 
      install.
   2. `vite.config.ts` (del paquete fallando):
       * resolve.preserveSymlinks: false (común con pnpm).
       * optimizeDeps.include: Asegurar que las dependencias 
         problemáticas estén listadas (ej: firebase/auth).
       * test.deps.optimizer.ssr.include: Para dependencias enlazadas 
         en monorepos (ej: /@minreport\//).
   3. Mocks para Dependencias Externas (Ej: Playwright):
       * Si el error es de una herramienta externa, leer el mensaje de 
         error y ejecutar el comando sugerido (ej: pnpm exec playwright
          install).

  D. Problemas de Mocks en Tests (Ej: `PluginViewer` o 
  `firebaseConfig`):

   1. Mocks Completos: Asegurar que los mocks de módulos exporten todas 
      las funciones que el código real espera (ej: getAuth, 
      connectAuthEmulator, onAuthStateChanged para firebase/auth).
   2. Mocks Asíncronos: Si el código real es asíncrono, el mock también 
      debe simularlo (ej: Promise.resolve().then(() => callback(...))).
   3. Mocks de Componentes: Si un componente usa otro componente o hook 
      que causa problemas, simularlo directamente en el test (ej: 
      ThemeToggleButton: () => null).

  4. Verificación Final

   * Una vez que una suite de pruebas individual pasa, ejecutar pnpm 
     -r test para verificar que no se han introducido regresiones en 
     otros paquetes.

  --- 

  Conclusión:

  La persistencia, el análisis detallado de cada error y la 
  aplicación metódica de soluciones "bit a bit" son esenciales. No 
  hay que perder la esperanza, incluso cuando el problema parece 
  irresoluble.

## 21. Manual para la Estabilización de Entornos de Desarrollo (Código, Tests y `pnpm dev`) - (25/09/2025)

Este manual documenta la estrategia "bit a bit" y las lecciones aprendidas para diagnosticar y resolver fallos complejos en el entorno de desarrollo de MINREPORT, especialmente aquellos relacionados con la interacción entre PNPM, Vite, Vitest, TypeScript y Firebase en un monorepo.

### Principios Clave de Depuración:

1.  **Estrategia "Bit a Bit":** Nunca intentes arreglar múltiples cosas a la vez. Aísla el problema más pequeño, resuélvelo y verifica antes de pasar al siguiente.
2.  **Verificación Constante:** Tras cada cambio mínimo, ejecuta las pruebas relevantes (`pnpm --filter <paquete> test`) para confirmar el efecto. Si las pruebas pasan, el cambio se mantiene. Si fallan, se revierte o reconsidera.
3.  **No Asumir:** Siempre verifica las configuraciones (`package.json`, `tsconfig.json`, `vite.config.ts`) y las dependencias.
4.  **Leer Errores Completos:** No ignores advertencias. Los mensajes de error de la consola son tu mejor guía.
5.  **Contexto del Monorepo:** Entiende que PNPM usa symlinks y que Vite/Vitest pueden tener comportamientos específicos en este entorno.
6.  **Consistencia del Entorno:** Asegúrate de que tu entorno local (versiones de Node.js, `firebase-tools`, etc.) sea consistente.

### Flujo de Diagnóstico y Solución (Paso a Paso):

#### 1. Identificación y Aislamiento del Fallo

*   **Ejecutar Pruebas Generales:** `pnpm -r test`
*   **Identificar el Primer Fallo:** El log se detendrá en el primer paquete que falle. Concéntrate solo en ese paquete.
*   **Aislar la Suite de Pruebas:** Si el fallo es en un paquete específico, ejecuta las pruebas solo para ese paquete: `pnpm --filter <nombre_paquete> test`.
*   **Aislar el Archivo de Prueba:** Si el fallo persiste, aísla el archivo de prueba específico: `pnpm --filter <nombre_paquete> test <ruta/al/archivo.test.ts>`.

#### 2. Análisis Detallado del Error

*   **Errores de Compilación/Transformación (TypeScript/Vite/ESBuild):**
    *   `TSxxxx: ...`: Errores de TypeScript (sintaxis, tipos, configuración).
    *   `Transform failed with 1 error`: Error de sintaxis o configuración en un archivo que Vite/Vitest intenta procesar.
    *   `Unmenterminated string literal`, `',' expected`: Típicamente errores de sintaxis o codificación de caracteres.
*   **Errores de Ejecución (Vitest/Runtime):**
    *   `AssertionError`: La prueba espera algo diferente a lo que recibe.
    *   `TypeError: ... is not a function`: Mock incompleto, mock asíncrono mal manejado o lógica de código incorrecta.
    *   `Cannot read properties of undefined`: Acceso a una propiedad de un objeto `undefined`, a menudo por mocks incompletos o contexto de ejecución incorrecto.
    *   `The default Firebase app does not exist. Make sure you call initializeApp()`: Firebase Admin SDK no inicializado correctamente en el entorno de prueba o ejecución.
*   **Errores de Entorno/Herramientas:**
    *   `Authentication Error: Your credentials are no longer valid`: Necesidad de `firebase login --reauth`.
    *   `Cannot find module '...'`: Problemas de resolución de módulos o archivos eliminados/movidos.

#### 3. Estrategias de Solución (Aplicar "Bit a Bit")

##### A. Errores de Inicialización de Firebase Admin SDK (`The default Firebase app does not exist`)

*   **Causa:** El código intenta usar `getFirestore()` o `getAuth()` antes de que `firebase-admin` haya sido inicializado con `initializeApp()`. Esto es común en entornos de prueba o en módulos que se cargan prematuramente.
*   **Solución:**
    1.  **Inicialización Diferida (Lazy Initialization):** Mover las llamadas a `getFirestore()`/`getAuth()` dentro de las funciones que las utilizan, en lugar de a nivel de módulo.
    2.  **Inyección de Dependencias:** Refactorizar las funciones para que `db` (Firestore) y `auth` (Auth) se pasen como parámetros a las funciones de lógica de negocio. Esto permite que las pruebas inyecten mocks y el código de producción inyecte las instancias reales.

##### B. Errores de Mocks en Tests (Ej: `TypeError: ... is not a function`, `expected spy to be called`)

*   **Causa:** Los mocks no están interceptando correctamente las llamadas a las dependencias externas, o no están configurados para devolver el valor esperado.
*   **Solución:**
    1.  **Mocks Autocontenidos:** Para cada archivo de prueba, definir los mocks de `vi.mock` directamente en la parte superior del archivo. Esto asegura que los mocks se apliquen antes de que el código bajo prueba sea importado.
    2.  **Mocks Completos:** Asegurarse de que los mocks de módulos exporten todas las funciones que el código real espera.
    3.  **Mocks de Dependencias Inyectadas:** Si se usa Inyección de Dependencias, crear objetos falsos (`fakeAuth`, `fakeDb`) con `vi.fn()` para los métodos que se llamarán, y pasarlos directamente a las funciones de lógica de negocio.

##### C. Conflictos de Mocks / Entorno de Test (Ej: `vitest.setup.ts` rompe otros tests)

*   **Causa:** Múltiples archivos de prueba o un archivo de configuración de test global (`vitest.setup.ts`) están interfiriendo entre sí, causando que los mocks de un test afecten a otro.
*   **Solución:**
    1.  **Eliminar Agregadores de Tests:** Evitar archivos como `index.test.ts` que simplemente importan otros archivos de prueba. Vitest está diseñado para descubrir y ejecutar todos los `*.test.ts` de forma aislada.
    2.  **Centralizar Mocks Globales (con precaución):** Si es absolutamente necesario tener mocks globales (ej. para `firebase-admin`), usar `vitest.setup.ts` para definirlos. Sin embargo, este archivo debe ser mínimo y solo definir los `vi.mock` globales, sin exportar nada que pueda causar errores de "unused imports" en `tsc`.
    3.  **Priorizar Mocks Autocontenidos:** La estrategia más robusta es que cada archivo de prueba defina sus propios mocks, eliminando la necesidad de mocks globales complejos.

##### D. Errores de Sintaxis / Codificación (`Unmenterminated string literal`, `',' expected`)

*   **Causa:** Errores tipográficos, código corrupto o problemas de codificación de caracteres (ej. emojis) que el compilador (`tsc`) no puede procesar.
*   **Solución:**
    1.  **Revisión Manual:** Inspeccionar el código alrededor de la línea indicada por el error.
    2.  **Sobreescritura Forzada:** Si el archivo parece correcto pero el compilador falla, sobreescribir el archivo con una versión conocida como buena (ej. desde el historial de Git o una copia limpia).
    3.  **Eliminar Caracteres Especiales:** Si el error persiste y hay caracteres no ASCII (como emojis) en cadenas, reemplazarlos por equivalentes ASCII.

##### E. Errores de Configuración de TypeScript (`tsconfig.json`)

*   **Causa:** La configuración del compilador (`module`, `moduleResolution`) no es compatible con el entorno de ejecución (ej. Firebase Emulator).
*   **Solución:** Ajustar `compilerOptions` en `tsconfig.json` para usar un formato de módulo más compatible, como `module: "commonjs"` y `moduleResolution: "node"`.

##### F. Errores de Entorno / Runtime del Emulador (`TypeError: admin.firestore is not a function`)

*   **Causa:** Incompatibilidad entre la forma en que el compilador genera el JavaScript y cómo el entorno de ejecución del emulador de Firebase espera cargar los módulos. Esto puede ser muy sutil y difícil de diagnosticar.
*   **Solución (Último Recurso):**
    1.  **Reinstalar Dependencias Forzadamente:** `pnpm install --force` para limpiar cualquier posible corrupción o enlace simbólico incorrecto en `node_modules`.
    2.  **Revisar Versiones:** Asegurarse de que las versiones de `firebase-tools`, Node.js y `pnpm` sean compatibles y estén actualizadas.
    3.  **Patrón de Importación Robusto:** Si el emulador falla con importaciones modulares (`import { getFirestore } from ...`), cambiar a un patrón de importación más antiguo pero robusto: `import * as admin from 'firebase-admin';` y luego usar `admin.firestore()`/`admin.auth()`. Asegurarse de que `admin.initializeApp()` se llame una vez.

### 4. Verificación Final

*   Una vez que se aplica una solución, ejecutar `pnpm --filter <paquete> test` para el paquete afectado.
*   Si pasa, ejecutar `pnpm -r test` para verificar que no se han introducido regresiones en otros paquetes.
*   Finalmente, ejecutar `pnpm dev` para confirmar que el entorno de desarrollo completo se inicia sin errores.

---

**Estado de Tareas Checkeables (si aplica):**

*   [X] Documentar estrategia de estabilización de entorno en `GEMINI_PLAN.md`.
