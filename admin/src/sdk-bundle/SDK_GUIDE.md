# Guía de Desarrollo: MINREPORT SDK v2.1

Bienvenido al ecosistema de desarrollo de MINREPORT. Esta guía detalla cómo crear plugins compatibles con el estándar "Elite Industrial Minimalism" y listos para el Marketplace especializado.

## 1. Filosofía de Diseño
Para mantener la coherencia estética en todo el sistema, es obligatorio seguir estas reglas:
- **Tipografía**: Usar exclusivamente `font-atkinson`.
- **Bordes**: Todos los componentes deben tener `rounded-none` (bordes rectos).
- **Acento**: El color de acción principal es el **Copper** (`#C68346`).
- **Contraste**: Mantener fondos claros/oscuros limpios con acentos metálicos.

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
- **Región**: Todos los procesamientos deben ser compatibles con `southamerica-west1`.
- **Seguridad**: Nunca uses IDs globales; utiliza siempre el `SecureContext` proporcionado en el método `onInit`.
- **PWA**: Asegura que tus componentes sean responsivos y funcionen en dispositivos móviles.

---
© 2026 MINREPORT® - Mining Control System.
