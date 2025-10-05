# Contrato de Datos de MINREPORT

Este documento define la estructura de los datos para las colecciones principales en Firestore. Sirve como una única fuente de verdad para el desarrollo.

---

## 1. Colección: `requests`

Almacena todas las solicitudes de nuevas cuentas. Un mismo RUT/RUN puede tener múltiples solicitudes, pero solo una puede ser aprobada para crear una cuenta.

```typescript
{
  // ID del documento: autogenerado por Firestore

  // --- Datos de la solicitud inicial ---
  applicantName: string;         // Nombre de la persona que solicita
  applicantEmail: string;        // Email de contacto para la solicitud
  institutionName?: string;      // Nombre de la institución (para Empresarial/Educacional)
  rut?: string;                  // RUT de la institución (para Empresarial/Educacional)
  country: string;               // Código ISO del país (ej: 'CL')
  city: string;                  // Nombre de la ciudad
  accountType: 'EMPRESARIAL' | 'EDUCACIONAL' | 'INDIVIDUAL'; // Tipo de cuenta solicitada
  entityType: 'juridica' | 'natural'; // Derivado del accountType

  // --- Estado y Trazabilidad ---
  status: 'pending_review' | 'pending_additional_data' | 'pending_final_review' | 'rejected' | 'activated';
  createdAt: Timestamp;          // Fecha de creación de la solicitud
  updatedAt: Timestamp;          // Última fecha de modificación
  rejectionReason?: string;      // Motivo del rechazo (opcional, añadido por un admin)
  token?: {
      value: string; // Hash del token para completar datos
      expiresAt: Timestamp;
  }

  // --- Datos Adicionales (segundo formulario) ---
  additionalData?: {
    adminName: string;
    adminEmail: string;
    adminPhone: string;
    adminRole?: string; // Opcional, solo para Empresarial/Educacional
    run?: string; // Opcional, solo para Individual
    commercialAddress?: string; // Opcional, dirección de Google para Empresarial/Educacional
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
  rutOrRun: string;              // RUT o RUN asociado a la cuenta (único para cuentas activas)
  accountType: 'EMPRESARIAL' | 'EDUCACIONAL' | 'INDIVIDUAL';
  entityType: 'juridica' | 'natural';
  status: 'active' | 'suspended';// Estado actual de la cuenta

  displayName: string;           // Nombre para mostrar en la aplicación
  institutionName?: string;      // Opcional, solo para Empresarial/Educacional


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
  event: string;                 // Tipo de evento, ej: 'ACCOUNT_CREATED', 'ACCOUNT_SUSPENDED'
  actor: {
    id: string;                  // UID del usuario que realiza la acción (puede ser un admin o el propio usuario)
    type: 'admin' | 'user' | 'system'; // Tipo de actor
  };
  details?: object;              // Objeto con datos contextuales sobre el evento
}
```

---



```