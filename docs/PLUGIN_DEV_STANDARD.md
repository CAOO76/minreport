# Estándar de Desarrollo de Plugins - MINREPORT

Este documento establece los requisitos técnicos y de diseño obligatorios para todos los plugins externos que se integren en el ecosistema de MINREPORT. El cumplimiento de estas normas garantiza la estabilidad del núcleo y una experiencia de usuario coherente.

## 1. Gestión de Dependencias (CRÍTICO)

Para evitar la duplicación de código y conflictos de estado (especialmente con hooks de React), los plugins deben tratar las dependencias del núcleo como externas.

### Dependencias Prohibidas
**NUNCA** incluyas las siguientes librerías en la sección `dependencies` de tu `package.json`:
- `react`
- `react-dom`
- `firebase`
- `@minreport/sdk` (si se usa la versión bundle)

### Dependencias Obligatorias (Peer Dependencies)
Debes declarar estas librerías exclusivamente como `peerDependencies`:

```json
{
  "peerDependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "firebase": "^10.x.x"
  }
}
```

## 2. Arquitectura y Entrada

### Estructura de Proyecto
Cada plugin debe ser un paquete de Node válido:
- **`package.json`**: Debe tener un campo `main` (o `module`) que apunte al punto de entrada compilado o fuente.
- **Punto de Entrada**: Debe exportar por defecto (`export default`) una instancia o clase que implemente la interfaz `PluginLifeCycle`.

```typescript
import { PluginLifeCycle, MinReportContext } from '@minreport/sdk';

class MyPlugin implements PluginLifeCycle {
  async onInit(context: MinReportContext) {
    // Inicialización segura
  }
  
  renderWidget() {
    // Retorna el componente React
  }
}

export default new MyPlugin();
```

## 3. UI/UX y Diseño

### Estilos y Colisiones
- **Prohibido**: Importar librerías de estilos globales o frameworks CSS que inyecten estilos base (ej: Bootstrap, Material UI, Ant Design). Esto rompería el layout del Core.
- **Obligatorio**: Uso de **Tailwind CSS**.
- **Tipografía**: Uso mandatorio de `Atkinson Hyperlegible` para todo el texto.
- **Modo Oscuro**: Implementación obligatoria de soporte para modo oscuro usando el prefijo `dark:`.

### Iconografía
- Solo se permite el uso de **Material Symbols Rounded**.

## 4. Gestión de Datos y Seguridad

### Almacenamiento
Los plugins tienen prohibido escribir datos en la raíz de las colecciones compartidas. Cualquier dato específico del plugin debe almacenarse dentro del objeto de extensiones:

- **Ruta**: `items/[itemId]/extensions/[pluginId]`
- **Ruta**: `accounts/[accountId]/extensions/[pluginId]`

## 5. Rendimiento y Sandboxing

- El sistema envolverá automáticamente cada widget en un `PluginErrorBoundary`.
- Evita procesos pesados en el hilo principal durante `onInit`.
- Los plugins que causen degradación visual o de rendimiento persistente serán desactivados automáticamente por el sistema de monitoreo del Core.
