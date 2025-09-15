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
        *   Se envía un correo de bienvenida al **Administrador de la Cuenta** con un enlace para que **cree su contraseña definitiva**.
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