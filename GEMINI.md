# MINREPORT — Reglas Exclusivas del Workspace

Este archivo define las reglas obligatorias y exclusivas para el proyecto **MINREPORT**.
Cargado automáticamente por el IDE al abrir cualquier archivo dentro de este repositorio.

---

## 1. Identidad y Entorno del Proyecto

- **Proyecto:** MINREPORT
- **URL de Acceso Clientes:** `https://minreport-access.web.app`
- **Naturaleza:** Plataforma de reportería industrial de alta precisión y máxima accesibilidad ergonómica.

---

## 2. Infraestructura Cloud y Persistencia

- **Región Google Cloud:** Exclusivamente `southamerica-west1` (Santiago, Chile) para TODOS los servicios.
- **PROHIBICIÓN ABSOLUTA:** Google App Engine y cualquier servicio dependiente de él están terminantemente prohibidos.
- **Integridad de Datos:** Prohibido reiniciar o eliminar colecciones de bases de datos, datos de emuladores locales (`.firebase-emulator-data`) o el usuario super-admin durante el ciclo de desarrollo.
- **Servicios Permitidos:** Cloud Firestore, Cloud Storage, Cloud Functions Gen 2, Cloud Run, Firebase Hosting / Firebase App Hosting, Cloud Secret Manager.

---

## 3. UI/UX — Minimalismo Industrial y Accesibilidad

### 3.1 Modo Claro / Modo Oscuro
- **OBLIGATORIO:** Toda interfaz de MINREPORT debe soportar tanto modo claro como modo oscuro.
- No se permite desarrollar vistas o componentes exclusivos para un solo modo.

### 3.2 Tipografía Exclusiva
- **Fuente Principal:** `Atkinson Hyperlegible Next` (variable font, alta diferenciación tipográfica industrial).
- **Fuente de Datos / Tablas:** `Atkinson Hyperlegible Mono` para columnas numéricas, tablas densas, formularios de códigos y terminales.
- **PROHIBIDO:** Usar Google Sans, Roboto o Inter en MINREPORT (solo permitidas como fallbacks genéricos de sistema).

### 3.3 Componentes e Iconografía
- **Switch Estándar:** `M3Switch` (implementación de la especificación Material Design 3). Prohibido `AdminSwitch`.
- **Iconografía:** Material Symbols de Google (`material-symbols-outlined`), limpios, sin texto adosado ni marcos decorativos de fondo.
- **Gráficos:** Simples, directos y estéticamente informativos. Prohibida la decoración sin valor de dato analítico.

### 3.4 Seguridad en Formularios
- **OBLIGATORIO:** `autocomplete="off"` en todos los elementos `<form>` e `<input>` por seguridad de datos industriales y privacidad multi-usuario.

### 3.5 Anulación de Decorativos
- Prohibidos badges falsos ("PRO", "V2.6"), sombras ornamentales, bordes visuales superfluos o textos de marketing en la interfaz operativa.

---

## 4. Monetización M2M (Protocolo x402)

- Endpoints `/api/m2m/*` protegidos con `x402Gatekeeper.ts`.
- Retornar `HTTP 402 Payment Required` según el estándar de la **x402 Foundation** si la petición carece de autorización o saldo.

---

## Política de Revisión

Estas directivas son de alcance local estricto para MINREPORT y no aplican a ningún otro proyecto del entorno.
