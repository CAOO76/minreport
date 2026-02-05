---
description: Cómo conectar un nuevo plugin al Core de MINREPORT
---

Para conectar un nuevo plugin de terceros a MINREPORT, sigue estos pasos:

### 1. Preparación del Plugin (Lado Externo)
Asegúrate de que el plugin cumpla con `docs/PLUGIN_DEV_STANDARD.md`:
- `package.json` con `react` y `firebase` en `peerDependencies`.
- Archivo `src/index.tsx` que haga `export default pluginInstance`.

### 2. Enlace al Proyecto Web (Lado Core)
Dependiendo del método de desarrollo:
- **npm link**: Ejecuta `npm link ruta/al/plugin` en `web/`.
- **Importación Directa**: Si el código está en el mismo repo, asegúrate de que la ruta sea accesible.

### 3. Registro en el Catálogo
Edita el archivo `web/src/core/PluginRegistry.ts`:
1. Importa el plugin:
   ```typescript
   import MyNewPlugin from '../plugins/my-new-plugin';
   ```
2. Añádelo al `PLUGIN_CATALOG`:
   ```typescript
   const PLUGIN_CATALOG = [
       // ... otros plugins
       {
           manifest: {
               id: 'my-plugin-id',
               name: 'Nombre del Plugin',
               version: '1.0.0',
               author: 'Autor'
           },
           instance: MyNewPlugin
       }
   ];
   ```

### 4. Uso en la Interfaz
Utiliza el componente `PluginLoader` para renderizar el plugin en cualquier página o dashboard:
```tsx
import { PluginLoader } from './components/plugins/PluginLoader';

// ... en el render
<PluginLoader pluginId="my-plugin-id" />
```

### 5. Verificación
El `PluginLoader` se encargará de:
- Inicializar el plugin con el contexto (`projectId`, `theme`, etc.).
- Envolverlo en un `PluginErrorBoundary` para proteger el Core.
- Gestionar el estado de carga y 404 si el ID no existe.
