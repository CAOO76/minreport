# Contrato de Datos de MINREPORT

Este documento define la estructura de los datos para las colecciones principales en Firestore. Sirve como una única fuente de verdad para el desarrollo.

---

## 1. Colección: `requests`

Almacena todas las solicitudes de nuevas cuentas. Un mismo RUT puede tener múltiples solicitudes, pero solo una puede ser aprobada para crear una cuenta.

```typescript
{
  // ID del documento: autogenerado por Firestore

  // --- Datos de la solicitud inicial ---
  requesterName: string;         // Nombre de la persona que solicita
  requesterEmail: string;        // Email de contacto para la solicitud
  rut: string;                   // RUT de la institución o persona (para B2B o Educacional)
  institutionName: string;       // Nombre de la institución
  requestType: 'B2B' | 'EDUCATIONAL'; // Tipo de cuenta solicitada

  // --- Estado y Trazabilidad ---
  status: 'pending_review' | 'pending_additional_data' | 'rejected' | 'approved';
  createdAt: Timestamp;          // Fecha de creación de la solicitud
  updatedAt: Timestamp;          // Última fecha de modificación
  rejectionReason?: string;      // Motivo del rechazo (opcional, añadido por un admin)

  // --- Datos Adicionales (segundo formulario) ---
  additionalData?: {
    legalRepresentativeName: string;
    address: string;
    // ... otros campos requeridos por el admin
  };
}
```

---

## 2. Colección: `accounts`

Contiene la información de las cuentas aprobadas y activas. El ID de cada documento es el `UID` del usuario correspondiente en Firebase Authentication.

```typescript
{
  // ID del documento: UID del usuario en Firebase Auth

  email: string;                 // Email de inicio de sesión (coincide con Firebase Auth)
  rut: string;                   // RUT asociado a la cuenta (único para cuentas activas)
  accountType: 'B2B' | 'EDUCATIONAL';
  status: 'active' | 'suspended';// Estado actual de la cuenta

  displayName: string;           // Nombre para mostrar en la aplicación
  institutionName: string;

  // --- Plugins y Funcionalidades ---
  plugins: string[];             // Array con los IDs de los plugins activados para la cuenta

  // --- Trazabilidad ---
  createdAt: Timestamp;          // Fecha de creación del usuario en Firebase Auth
  activatedAt: Timestamp;        // Fecha de aprobación final y activación de la cuenta
  suspendedAt?: Timestamp;       // Fecha de suspensión (opcional)
}
```

---

## 3. Colección: `account_logs`

Registro inmutable de todas las acciones importantes que ocurren en una cuenta. Esencial para la auditoría y trazabilidad.

```typescript
{
  // ID del documento: autogenerado por Firestore

  accountId: string;             // UID de la cuenta afectada
  timestamp: Timestamp;          // Momento exacto del evento
  event: string;                 // Tipo de evento, ej: 'ACCOUNT_CREATED', 'PLUGIN_ACTIVATED', 'ACCOUNT_SUSPENDED'
  actor: {
    id: string;                  // UID del usuario que realiza la acción (puede ser un admin o el propio usuario)
    type: 'admin' | 'user' | 'system'; // Tipo de actor
  };
  details?: object;              // Objeto con datos contextuales sobre el evento (ej: { pluginId: '...' })
}
```