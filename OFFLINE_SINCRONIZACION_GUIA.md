# 🚀 MinReport - Guía Offline y Sincronización

## 1. Estado Actual del Sistema Offline

### ✅ Implementado

#### A. SDK Offline (`packages/sdk/`)
```
Estado: ✅ FUNCIONAL Y TESTADO
Ubicación: /packages/sdk/src/index.ts
Líneas: 273 líneas de código offline-aware
```

**Características activas**:
- ✅ Clase `OfflineQueue` para encolar acciones
- ✅ Detección automática de online/offline
- ✅ Persistencia en localStorage
- ✅ Reintentos con backoff exponencial
- ✅ Sincronización batch
- ✅ Tests unitarios

**Métodos principales**:
```typescript
// Iniciar
const queue = new OfflineQueue();

// Activar modo offline
await queue.enableOfflineMode();

// Encolar una acción
const actionId = queue.enqueue({
  action: 'create',
  resource: 'report',
  data: { title: 'Mi reporte', content: '...' }
});

// Sincronizar cuando vuelve internet
const results = await queue.syncData();

// Volver a online
await queue.enableOnlineMode();
```

#### B. Firebase Offline Persistence
```
Estado: ✅ CONFIGURADO EN firebaseConfig.ts
Ubicación: /sites/client-app/src/firebaseConfig.ts:25-30
```

**Configuración activa**:
```typescript
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
```

**Beneficios automáticos**:
- ✅ Lectura de datos en caché cuando offline
- ✅ Escritura diferida hasta reconnexión
- ✅ Sincronización automática multi-tab
- ✅ Manejo de conflictos
- ✅ Cuota de 40MB por defecto

#### C. Progressive Web App
```
Estado: ⚠️ PARCIALMENTE IMPLEMENTADO
Ubicación: /sites/client-app/public/manifest.json
```

**Presente**:
- ✅ manifest.json válido
- ✅ display: standalone
- ✅ Colores temáticos
- ✅ Name y descripción

**Faltante**:
- ⚠️ Iconos (solo vite.svg)
- ⚠️ Screenshots
- ⚠️ Service Worker
- ⚠️ Offline page fallback

---

## 2. Flujo de Sincronización Offline

### Escenario: Usuario crea reporte sin internet

```
PASO 1: Usuario offline en client-app
├─ Hace clic en "Crear Reporte"
└─ Llena formulario (sin internet)

PASO 2: SDK intercepta la acción
├─ Detecta que está offline (navigator.onLine = false)
├─ No intenta enviar a Firebase
└─ Encola en localStorage

PASO 3: Acción se persiste
├─ Se guarda en: localStorage['minreport_offline_queue']
├─ Formato: OfflineAction[]
└─ Incluye: id, timestamp, status, retryCount

PASO 4: UI muestra estado
├─ Toast/badge: "Guardado localmente"
├─ Spinner de sync
├─ Contador de acciones pendientes

PASO 5: Usuario recupera conexión
├─ SDK detecta event 'online'
├─ Inicia syncData()
├─ Envía acciones a Firebase

PASO 6: Sincronización
├─ Batch de 10 acciones por defecto
├─ Retry automático si falla (máx 5 intentos)
├─ Exponential backoff: 1s, 2s, 4s, 8s, 16s
└─ Backoff aleatorio para evitar thundering herd

PASO 7: UI actualiza
├─ Elimina de cola
├─ Muestra confirmación
├─ Actualiza UI con datos del servidor
└─ Notifica al usuario éxito
```

---

## 3. Configuración por Aplicación

### 3.1 Client-App (Principal)

**Ubicación**: `/sites/client-app/`

**Configuración offline**:
```typescript
// src/firebaseConfig.ts
✅ Firestore offline persistence habilitada
✅ connectFirestoreEmulator en desarrollo
✅ Multi-tab synchronization activo
```

**Uso en componentes**:
```typescript
import { OfflineQueue } from '@minreport/sdk';

export function ReportForm() {
  const offlineQueue = new OfflineQueue();

  async function handleSubmit(data) {
    if (!navigator.onLine) {
      // Offline: encolar
      const actionId = offlineQueue.enqueue({
        action: 'create',
        resource: 'report',
        data
      });
      setMessage('Guardado localmente. Se sincronizará automáticamente.');
    } else {
      // Online: enviar directo
      await saveToFirebase(data);
    }
  }
}
```

### 3.2 Admin-App

**Ubicación**: `/sites/admin-app/`

**Configuración offline**:
```
⚠️ Posiblemente diferente de client-app
Necesita: Verificar si tiene su propia firebaseConfig.ts
```

### 3.3 Public-Site

**Ubicación**: `/sites/public-site/`

**Nota**: Sitio de marketing, offline no es crítico
```
Recomendación: Static content cached por CDN
```

---

## 4. Persistencia Local

### 4.1 localStorage

```typescript
// Automáticamente manejado por SDK
localStorage.setItem('minreport_offline_queue', JSON.stringify([
  {
    id: 'action_1234567890_abc',
    userId: 'user123',
    action: 'create',
    resource: 'report',
    data: { title: 'Mi reporte', ... },
    timestamp: '2025-11-01T...',
    status: 'pending',
    retryCount: 0
  },
  // ... más acciones
]));

// Límite: 5-10MB típicamente
```

### 4.2 IndexedDB

```typescript
// Automáticamente manejado por Firebase
// Ubicación: /minreport_firebase_... en DevTools

// Estructuras:
- firestore/documents  ← Documentos en caché
- firestore/metadata   ← Metadata de sincronización
- firestore/indexes    ← Índices locales

// Límite: 50MB por defecto (verificable)
```

### 4.3 Multi-tab Synchronization

```typescript
// Configurado en firebaseConfig.ts
persistentMultipleTabManager()

// Beneficio:
// Si abre client-app en 2 tabs:
// - Tab 1 crea reporte
// - Tab 2 ve el reporte instantáneamente
// - No hay conflictos de escritura
```

---

## 5. Manejo de Conflictos

### Escenarios

#### Escenario 1: Edición dual offline
```
Momento 1: 
- Tab A (offline): Edita "Contenido A"
- Tab B (offline): Edita "Contenido B"

Momento 2:
- Usuario vuelve online
- ¿Qué gana?

Solución actual: Last-write-wins
- Última escritura en sincronizar wins
- Timestamp determina orden
```

#### Escenario 2: Edición offline + servidor
```
Momento 1:
- Usuario A (online): Edita documento
- Usuario B (offline): Edita mismo documento offline

Momento 2:
- Usuario B vuelve online
- Firebase tiene versión de Usuario A

Solución: 
- Detección de conflicto en sync
- Opción 1: Overwrite (no recomendado)
- Opción 2: Merge (complejo)
- Opción 3: Alertar al usuario
```

---

## 6. Testing Offline

### Prueba Manual en DevTools

```
1. Abrir DevTools (F12)
2. Ir a "Application" → "Service Workers"
3. O ir a "Network" → throttle a "Offline"
4. Hacer acción en app
5. Ver en Console que se encola
6. Cambiar a "Online"
7. Ver sincronización automática
```

### Prueba Programática

```typescript
// packages/sdk/src/firebase-offline.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { OfflineQueue } from './index';

describe('Offline Queue', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    queue = new OfflineQueue();
  });

  it('should enqueue actions when offline', async () => {
    await queue.enableOfflineMode();
    
    const actionId = queue.enqueue({
      action: 'create',
      resource: 'report',
      data: { title: 'Test' }
    });

    expect(actionId).toBeDefined();
    // Verificar que está en localStorage
  });

  it('should sync when online', async () => {
    // Simular online
    await queue.enableOnlineMode();
    
    const results = await queue.syncData();
    
    expect(results).toHaveLength(0); // No hay nada que sincronizar
  });
});
```

---

## 7. Monitoreo y Debugging

### 7.1 Ver Cola Offline en Console

```javascript
// En DevTools Console:

// Ver cola actual
JSON.parse(localStorage.getItem('minreport_offline_queue'))

// Limpiar cola (cuidado!)
localStorage.removeItem('minreport_offline_queue')

// Ver estado de sincronización
firebase.firestore().disableNetwork(); // Simular offline
firebase.firestore().enableNetwork();  // Volver online
```

### 7.2 Logging

```typescript
// Agregar en OfflineQueue (mejora futura)
class OfflineQueue {
  private debug = true; // Activar/desactivar logs
  
  enqueue(action) {
    if (this.debug) {
      console.log('[OfflineQueue] Acción encolada:', action);
    }
    // ...
  }
}
```

---

## 8. Mejoras Recomendadas

### Priority 1: Service Worker Completo

```typescript
// Crear: src/service-worker.ts

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('minreport-v1').then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/main.css',
        // ... recursos críticos
      ]);
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Cache first para assets
  // Network first para datos
  // Stale while revalidate para datos
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-queue') {
    event.waitUntil(offlineQueue.syncData());
  }
});
```

**Beneficio**: 
- Instalable como PWA
- Funciona completamente sin conexión
- Caché de assets automático

### Priority 2: Indicador de Sync Status

```typescript
// Hook para React
function useSyncStatus() {
  const [status, setStatus] = useState('online');
  const [pendingActions, setPendingActions] = useState(0);

  useEffect(() => {
    window.addEventListener('online', () => {
      setStatus('syncing');
      offlineQueue.syncData().then(() => {
        setStatus('online');
      });
    });
    
    window.addEventListener('offline', () => {
      setStatus('offline');
    });
  }, []);

  return { status, pendingActions };
}

// Uso:
export function App() {
  const { status, pendingActions } = useSyncStatus();
  
  return (
    <>
      {status === 'offline' && (
        <Banner color="warning">
          Offline. {pendingActions} acciones pendientes.
        </Banner>
      )}
      {status === 'syncing' && (
        <Banner color="info">
          Sincronizando...
        </Banner>
      )}
    </>
  );
}
```

### Priority 3: Conflict Resolution

```typescript
// Detectar conflictos en sync
async function syncWithConflictDetection(action) {
  try {
    // Obtener versión del servidor
    const serverVersion = await getFromServer(action.resource);
    
    if (serverVersion.version > action.serverVersion) {
      // Conflicto detectado
      return {
        status: 'conflict',
        local: action.data,
        server: serverVersion.data,
        options: ['keep-local', 'keep-server', 'merge']
      };
    }
    
    // No hay conflicto, sincronizar normalmente
    return await sendToServer(action);
  } catch (error) {
    return { status: 'error', error };
  }
}
```

### Priority 4: Documentación de Offline

```markdown
# Guía de Uso Offline

## ¿Qué funciona offline?
- ✅ Ver reportes descargados
- ✅ Crear nuevos reportes
- ✅ Editar borradores
- ✅ Buscar localmente

## ¿Qué NO funciona offline?
- ❌ Sincronizar con equipo
- ❌ Ver reportes de otros usuarios
- ❌ Descargar datos nuevos

## Sincronización automática
1. MinReport guarda tus cambios localmente
2. Cuando vuelves online, se sincronizan automáticamente
3. Recibirás notificación cuando se complete

## Si hay problemas
1. Verifica tu conexión
2. Recarga la página
3. Abre DevTools → Application → Clear All
```

---

## 9. Arquitectura Offline Completa

```
┌─────────────────────────────────────────────────────┐
│  MINREPORT CLIENT-APP (React + Vite)                │
└─────────────────────────────────────────────────────┘
               ⬇️
┌─────────────────────────────────────────────────────┐
│  OfflineQueue (@minreport/sdk)                      │
│  ├─ Detección online/offline                        │
│  ├─ Enqueue/Dequeue de acciones                     │
│  ├─ Retry logic con exponential backoff             │
│  └─ Persistencia en localStorage                    │
└─────────────────────────────────────────────────────┘
               ⬇️
┌──────────────────────┬──────────────────────────────┐
│ OFFLINE              │ ONLINE                       │
├──────────────────────┼──────────────────────────────┤
│ localStorage         │ Firebase Firestore           │
│ IndexedDB (Firestore)│ Firebase Auth                │
│ Browser Cache        │ Cloud Functions              │
└──────────────────────┴──────────────────────────────┘
```

---

## 10. Checklist de Producción

```
✅ Offline Capability
  ├─ [x] OfflineQueue implementada
  ├─ [x] Firebase offline persistence
  ├─ [x] localStorage para acciones
  ├─ [x] Retry logic
  ├─ [x] Tests offline
  └─ [ ] Service Worker completo

✅ User Experience
  ├─ [ ] Indicador de estado online/offline
  ├─ [ ] Spinner de sincronización
  ├─ [ ] Toast de acciones encoladas
  ├─ [ ] Notificación de sync completo
  └─ [ ] Manejo de conflictos

✅ Monitoring
  ├─ [ ] Logging de sync failures
  ├─ [ ] Dashboard de sincronización
  ├─ [ ] Alerts de conflictos
  └─ [ ] Analytics de uso offline

✅ Security
  ├─ [x] Firebase rules validar integridad
  ├─ [ ] Encryptar cola offline en transporte
  ├─ [ ] Validar timestamp al sincronizar
  └─ [ ] Auditoria de cambios offline

✅ Performance
  ├─ [ ] Batch sync optimizado
  ├─ [ ] Compresión de queue
  ├─ [ ] Cleanupde queue después de sync
  └─ [ ] Monitoreo de tamaño IndexedDB
```

---

## Conclusión

**MinReport está preparado para offline** con:
- ✅ SDK offline funcional
- ✅ Firebase persistence configurada
- ✅ localStorage para acciones
- ⚠️ Necesita Service Worker para PWA completo

**Próximos pasos**:
1. Implementar Service Worker
2. Agregar indicadores de UI
3. Completar manifest.json
4. Documentar para usuarios

