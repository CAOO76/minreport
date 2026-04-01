# Guía de Desarrollo: MINREPORT SDK v3.0

Bienvenido al ecosistema de desarrollo de MINREPORT. Esta guía detalla cómo crear plugins compatibles con el estándar "Elite Industrial Minimalism" y listos para el Marketplace especializado.

## 1. Filosofía de Diseño ("Elite Industrial Minimalism")
Para mantener la coherencia estética e industrial en todo el sistema, es **obligatorio** seguir estas directrices:
- **Tipografía**: Usar exclusivamente `Atkinson Hyperlegible` (clase Tailwind: `font-atkinson`) para absolutamente todo texto.
- **Componentes e Íconos**: Restringido a Material Design 3 (m3.material.io). Usar los componentes del SDK (ej. `SDKSwitch` M3) en lugar de HTML nativos.
- **Marca del Plugin**: **Queda prohibido** el uso de logos gráficos, nombres de fantasía adornados o branding excesivo dentro de las interfaces. El plugin hereda el Theme del Core.
- **Formularios Seguros**: Por normativa de seguridad, desactivar siempre el autocompletado en los inputs (`autocomplete="off"`).
- **Modo Claro/Oscuro**: Soporte para ambos modos es obligatorio. Mantener fondos limpios con acentos metálicos y evitar colores genéricos puros.
- **Bordes**: Todos los contenedores base deben tener bordes rectos (`rounded-none`).
- **Acento**: El color de acción principal es el **Copper** (`#C68346`).

## 2. Desarrollo Local y Asignación de Puertos (Module Federation)
Es **CRÍTICO** evitar colisiones de puertos (ej. `5173`) entre tu plugin y el Host u otros plugins durante la fase de desarrollo. 

Para resolverlo, debes usar el asignador de puertos del SDK en tu archivo `vite.config.ts`. Este reservará un puerto consistente entre los rangos `5200` y `5999` basado en tu ID:

```typescript
import { defineConfig } from 'vite';
import { DevTools } from '@minreport/sdk';

export default defineConfig({
  server: {
    // Puerto único fijo generado crítpticamente a partir del ID
    port: DevTools.getDeterministicDevPort('my-plugin-id'),
    strictPort: true, // Forzar terminación si hay colisión local
    cors: true
  }
});
```

## 3. Componentes de UI Disponibles
Importa los componentes directamente desde el SDK para asegurar compatibilidad:

```tsx
import { SDKCard, SDKButton, SDKMetric, SDKBadge, SDKSwitch, SDKIcon } from '@minreport/sdk';

// Ejemplo de Widget de Terceros
export const MyMiningWidget = () => (
    <SDKCard title="Control de Vetas" action={<SDKIcon name="analytics" />}>
        <SDKMetric label="Ley de Corte" value={4.2} unit="g/t" trend={{ value: 12, isUp: true }} />
        <div className="mt-4 flex gap-2">
            <SDKBadge type="copper">Certificado Academia</SDKBadge>
            <SDKBadge type="success">Operativo</SDKBadge>
        </div>
        <SDKButton variant="copper" fullWidth className="mt-4">
            Sincronizar Datos
        </SDKButton>
    </SDKCard>
);
```

## 4. Manifiesto del Plugin y Design Contract v3
Cada plugin debe exportar un objeto `PluginManifest`. Desde la versión v3.0, es imperativo establecer el campo booleano `designContract: true` afirmando cumplimiento irrestricto de diseño.

```json
{
  "id": "com.university.vein-analyzer",
  "name": "Analizador de Vetas Profundo",
  "version": "1.0.0",
  "description": "Algoritmo avanzado para caracterización de vetas mediante fotogrametría.",
  "designContract": true
}
```

## 5. Estándares Técnicos
- **Global Ledger**: Todas las transacciones financieras DEBEN pasar por `FinancialEventSchema` e inyectarse vía el Singleton `eventBus` público del SDK. Nunca persistir montos localmente.
- **Soporte Offline (Edge)**: Diseña asumiendo pérdida de red intermitente. El `SecureContext` expone `storage.saveOfflineData` y `network` (IndexedDB/Capacitor).
- **Región GCP**: Todos los procesamientos serverless deben ser compatibles con `southamerica-west1`.
- **Seguridad UID**: No uses variables globales; utiliza siempre el `SecureContext` proporcionado en el método `onInit`.

---
© 2026 MINREPORT® - Mining Control System.
