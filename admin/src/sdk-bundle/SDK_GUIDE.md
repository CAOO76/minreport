# Guía de Desarrollo: MINREPORT SDK v2.1

Bienvenido al ecosistema de desarrollo de MINREPORT. Esta guía detalla cómo crear plugins compatibles con el estándar "Elite Industrial Minimalism" y listos para el Marketplace especializado.

## 1. Filosofía de Diseño ("Elite Industrial Minimalism")
Para mantener la coherencia estética e industrial en todo el sistema, es **obligatorio** seguir estas directrices:
- **Tipografía**: Usar exclusivamente `Atkinson Hyperlegible` (clase Tailwind: `font-atkinson`) para absolutamente todo texto.
- **Componentes e Íconos**: Restringido a Material Design 3 (m3.material.io). Usar los componentes del SDK (ej. `SDKSwitch` M3) en lugar de HTML nativos.
- **Formularios Seguros**: Por normativa de seguridad, desactivar siempre el autocompletado en los inputs (`autocomplete="off"`).
- **Modo Claro/Oscuro**: Soporte para ambos modos es obligatorio. Mantener fondos limpios con acentos metálicos y evitar colores genéricos puros.
- **Bordes**: Todos los contenedores base deben tener bordes rectos (`rounded-none`).
- **Acento**: El color de acción principal es el **Copper** (`#C68346`).

## 2. Componentes de UI Disponibles
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

## 3. Manifiesto del Plugin
Cada plugin debe incluir un `manifest.json` o exportar un objeto `PluginManifest`. Para el **Marketplace**, los campos de descripción y sitio web son obligatorios.

```json
{
  "id": "com.university.vein-analyzer",
  "name": "Analizador de Vetas Profundo",
  "version": "1.0.0",
  "author": "Universidad de Atacama",
  "description": "Algoritmo avanzado para caracterización de vetas mediante fotogrametría.",
  "website": "https://mining.uda.cl/software",
  "category": "geology",
  "permissions": ["storage", "camera"]
}
```

## 4. Estándares Técnicos
- **Global Ledger**: Todas las transacciones financieras DEBEN pasar por `FinancialEventSchema` e inyectarse vía el Singleton `eventBus` público del SDK. Nunca persistir montos localmente.
- **Soporte Offline (Edge)**: Diseña asumiendo pérdida de red intermitente. El `SecureContext` expone `storage.saveOfflineData` y `network` (IndexedDB/Capacitor) para retener operaciones en faena antes de sincronizar.
- **Región GCP**: Todos los procesamientos serverless deben ser compatibles con `southamerica-west1`.
- **Seguridad UID**: No uses variables globales; utiliza siempre el `SecureContext` proporcionado en el método `onInit`.
- **PWA / Android**: Asegura que la UI de tu plugin sea netamente responsiva y soporte ejecución dentro de Capacitor WebView.

---
© 2026 MINREPORT® - Mining Control System.
