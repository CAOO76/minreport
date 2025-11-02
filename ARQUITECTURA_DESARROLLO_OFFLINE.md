# Arquitectura Optimizada MinReport - Desarrollo Unificado + Offline-First

## 1. VERSIÓN ÚNICA DEV/PROD ✅

### Problema Resuelto
Antes: Múltiples configuraciones, duplicación de código, inconsistencias entre dev y prod  
Después: Una única base de código, configuración automática según ambiente

### Solución Implementada

#### `app-config.ts` - Configuración Centralizada
```typescript
// Detecta automáticamente el ambiente
function getEnvironment(): 'development' | 'production'

// Cargas la config correcta sin cambios manuales
- Development: http://localhost:3000
- Production: https://minreport.com
```

#### Firebase Config Unificado
```
firebaseConfig.ts → app-config.ts → Uso automático
```

Las credenciales de Firebase son las mismas para ambos ambientes (el emulador local se detecta en desarrollo).

#### Environment File Único
```
.env.unified → Compartido para dev y prod
```

### Flujo Dev → Prod

```
Local Development (localhost:5173)
    ↓
npm run dev
    ↓
app-config.ts detecta: environment = 'development'
    ↓
Usa: localhost:3000, Firebase emulator, features de dev
    ↓
Código idéntico ejecutándose

Production (minreport.com)
    ↓
npm run build
    ↓
app-config.ts detecta: environment = 'production'
    ↓
Usa: api.minreport.com, Firebase prod, features habilitadas
    ↓
Mismo código compilado
```

**Resultado**: Cambios en local se reflejan automáticamente en prod sin modificar código.

---

## 2. ARQUITECTURA OFFLINE-FIRST ✅

### Tecnologías Implementadas

#### A. Service Worker (`service-worker.js`)
- **Cache Strategy**: Network-first para APIs, Cache-first para assets
- **Background Sync**: Sincroniza datos cuando vuelve conexión
- **Estrategia inteligente**: Assets cacheados permanentemente, APIs cachean solo cuando es necesario

#### B. IndexedDB (`offline-data-manager.ts`)
- **Almacenamiento Local**: Reportes, proyectos, usuarios
- **Operaciones Offline**: Create, read, update, delete sin conexión
- **Sincronización**: Queue de operaciones pendientes
- **Cleanup Automático**: Limpia datos > 30 días

#### C. Background Sync Manager (`background-sync-manager.ts`)
- **Queue Persistente**: Operaciones se guardan en IndexedDB
- **Reintento Automático**: Hasta 3 intentos por operación
- **Detección Online**: Inicia sync automáticamente cuando hay conexión
- **Sincronización Bidireccional**: Datos local ↔ servidor

#### D. Hooks React (`useOffline.ts`)
```typescript
// Estado offline
useOfflineStatus() → { isOnline, pendingReports, lastSync }

// Guardar reportes con fallback offline
useOfflineReports() → saveReport(), getPendingReports()

// Control de sincronización
useOfflineSync() → syncAll(), isSyncing, syncError
```

### Flujo Offline-to-Online

```
1. USUARIO EN TERRENO (SIN CONEXIÓN)
   ↓
   Captura reporte → saveReport()
   ↓
   OfflineDataManager guarda en IndexedDB
   ↓
   BackgroundSyncManager encola la operación
   ↓
   UI muestra: "📋 1 reporte pendiente"

2. USUARIO CONECTA A INTERNET
   ↓
   Service Worker detecta online
   ↓
   Dispara 'sync' event
   ↓
   BackgroundSyncManager.startSync()
   ↓
   Intenta enviar todos los reportes pendientes
   ↓
   Sincroniza datos con servidor

3. SINCRONIZACIÓN EXITOSA
   ↓
   OfflineDataManager marca como synced
   ↓
   UI actualiza: "✅ Sincronizado"
   ↓
   Datos duplicados en local + remoto
```

### Casos de Uso Soportados

#### ✅ Captura de Datos en Terreno
```
Trabajador en campo sin conexión:
1. Abre app (ya cargada en el navegador)
2. Captura reporte: texto, fotos, ubicación
3. Presiona "Guardar"
4. App guarda localmente
5. Cuando hay conexión → sincroniza automáticamente
```

#### ✅ Procesamiento Offline
```
Computadora de campo con conexión intermitente:
1. Descarga datos del servidor
2. Service Worker cachea todo
3. Trabaja offline sin problemas
4. Cambios se sincronizan al reconectar
```

#### ✅ Múltiples Dispositivos
```
Equipo de 10 trabajadores:
- Cada dispositivo tiene su IndexedDB local
- Cada uno sincroniza independientemente
- Sin conflictos gracias a timestamps y IDs únicos
```

---

## 3. ARQUITECTURA COMPLETA

### Diagrama de Flujo

```
┌─────────────────────────────────────────────────────┐
│ MinReport App (Desarrollo & Producción)             │
├─────────────────────────────────────────────────────┤
│                                                       │
│  app-config.ts (Detecta ambiente automáticamente)   │
│  ├─ isDev? → localhost:3000                         │
│  └─ isProd? → minreport.com                         │
│                                                       │
│  Firebase Config (Mismo para ambos)                 │
│  └─ Emulator en dev, Prod en production             │
│                                                       │
│  ┌─────────────────────────────────────────────┐   │
│  │ UI Layer (React Components)                 │   │
│  │ useOfflineStatus()                          │   │
│  │ useOfflineReports()                         │   │
│  │ useOfflineSync()                            │   │
│  └─────────────────────────────────────────────┘   │
│           ↓        ↓         ↓                       │
│  ┌─────────────────────────────────────────────┐   │
│  │ Service Layer                               │   │
│  │ ├─ OfflineDataManager (IndexedDB)           │   │
│  │ ├─ BackgroundSyncManager (Queue)            │   │
│  │ └─ API Client (Fetch)                       │   │
│  └─────────────────────────────────────────────┘   │
│           ↓        ↓         ↓                       │
│  ┌─────────────────────────────────────────────┐   │
│  │ Storage Layer                               │   │
│  │ ├─ IndexedDB (Local Persistence)            │   │
│  │ ├─ Service Worker Cache (Assets)            │   │
│  │ └─ LocalStorage (Config)                    │   │
│  └─────────────────────────────────────────────┘   │
│           ↓        ↓         ↓                       │
│  ┌─────────────────────────────────────────────┐   │
│  │ Service Worker                              │   │
│  │ ├─ Install (Cache assets)                   │   │
│  │ ├─ Fetch (Network-first strategy)           │   │
│  │ └─ Sync (Background sync events)            │   │
│  └─────────────────────────────────────────────┘   │
│           ↓        ↓         ↓                       │
│  ┌─────────────────────────────────────────────┐   │
│  │ Server (minreport.com)                      │   │
│  │ ├─ API Endpoints                            │   │
│  │ ├─ Firebase/Firestore                       │   │
│  │ └─ Database                                 │   │
│  └─────────────────────────────────────────────┘   │
│                                                       │
└─────────────────────────────────────────────────────┘
```

---

## 4. CÓMO USAR

### Guardar Reporte (Con soporte offline)

```typescript
import { useOfflineReports } from '@/hooks/useOffline';

function ReportForm() {
  const { saveReport } = useOfflineReports();

  const handleSave = async (reportData) => {
    try {
      const saved = await saveReport(reportData);
      console.log('✅ Guardado (local o servidor)', saved);
    } catch (error) {
      console.error('❌ Error', error);
    }
  };

  return <form onSubmit={(e) => {
    e.preventDefault();
    handleSave(formData);
  }}>
    {/* fields */}
  </form>;
}
```

### Mostrar Estado Offline

```typescript
function OfflineIndicator() {
  const { status, updateSyncStatus } = useOfflineStatus();

  return (
    <div>
      {!status.isOnline && <p>⚠️ Trabajando Offline</p>}
      {status.pendingReports > 0 && (
        <p>📋 {status.pendingReports} reportes pendientes</p>
      )}
      <button onClick={updateSyncStatus}>
        Verificar sincronización
      </button>
    </div>
  );
}
```

### Sincronizar Manualmente

```typescript
function SyncButton() {
  const { syncAll, isSyncing, syncError } = useOfflineSync();

  return (
    <>
      <button onClick={syncAll} disabled={isSyncing}>
        {isSyncing ? '🔄 Sincronizando...' : '📤 Sincronizar'}
      </button>
      {syncError && <p style={{ color: 'red' }}>{syncError}</p>}
    </>
  );
}
```

---

## 5. FEATURES POR AMBIENTE

### Development
- ✅ Offline completo
- ✅ Reporting
- ✅ Analytics para testing
- ✅ Admin panel

### Production (minreport.com)
- ✅ Offline completo
- ✅ Reporting
- ❌ Analytics (disabled)
- ❌ Admin panel (disabled)

Configurable en `app-config.ts`:
```typescript
features: {
  offline: true,
  reporting: true,
  analytics: isDev,
  admin: isDev,
}
```

---

## 6. DEPLOYMENTE

### Build Local → Producción

```bash
# Development
npm run dev
# → http://localhost:5173
# → app-config detecta 'development'
# → Usa localhost:3000 + Firebase emulator

# Production Build
npm run build
# → Optimiza para minreport.com
# → app-config detecta 'production'
# → Usa api.minreport.com + Firebase prod

# Deploy
npm run build && npm run deploy
# → Los cambios se reflejan automáticamente en minreport.com
```

---

## 7. VENTAJAS

✅ **Una sola base de código** → Menos bugs, más mantenible  
✅ **Cambios locales = cambios en prod** → No hay sorpresas  
✅ **Offline-first** → Funciona sin conexión  
✅ **Sincronización automática** → Usuario no piensa en ello  
✅ **Persistencia robusta** → No pierden datos  
✅ **Queue de operaciones** → Reintentos automáticos  
✅ **Múltiples dispositivos** → Cada uno funciona independientemente  
✅ **Escalable** → Soporta cientos de trabajadores en terreno

---

## 8. ARCHIVOS IMPLEMENTADOS

```
✅ sites/client-app/
├── src/
│   ├── config/
│   │   └── app-config.ts (Configuración unificada)
│   ├── services/
│   │   ├── offline-data-manager.ts (IndexedDB)
│   │   └── background-sync-manager.ts (Queue)
│   ├── hooks/
│   │   └── useOffline.ts (React hooks)
│   └── firebaseConfig.ts (Actualizado)
├── public/
│   └── service-worker.js (Mejorado)
└── .env.unified (Variables de ambiente)
```

---

**Status**: ✅ Implementación completa y lista para producción

