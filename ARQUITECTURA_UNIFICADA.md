# 🏗️ MinReport - Arquitectura Unificada: Desarrollo & Producción

## 📋 Status Actual

### ✅ Lo Que YA Está Bien
- ✅ Firebase Emulators para desarrollo local
- ✅ Persistencia offline en cliente (Firestore local cache)
- ✅ Configuration basada en environment variables
- ✅ 3 aplicaciones web separadas (client, admin, public)
- ✅ Service Workers parcialmente implementados

### ⚠️ Problemas Identificados

#### 1. **Versiones Duplicadas / Inconsistentes**
```
Problema: Existen múltiples configs de Firebase en diferentes archivos
├─ sites/client-app/src/firebaseConfig.ts ❌ Hardcoded credentials
├─ sites/admin-app/src/firebaseConfig.ts ❌ Hardcoded placeholder
├─ sites/public-site/src/firebaseConfig.ts ❌ ???
└─ packages/sdk/src/index.ts ❌ Duplicated config

Resultado: Dificultad mantener sincronización entre envs
```

#### 2. **Capacidades Offline Incompletas**
```
Lo que FALTA:
❌ Service Worker no completo (solo parcialmente implementado)
❌ Sync manager no totalmente funcional
❌ Offline-first arquitectura no optimizada
❌ No hay fallback strategy clara
❌ No hay conflict resolution
```

#### 3. **Environment Setup Complejo**
```
Problema: 15+ scripts de desarrollo diferentes
├─ dev-clean-start.sh
├─ dev-persist-manual.sh
├─ dev-simple.sh
├─ dev-start-fixed.sh
├─ start-dev-safe.sh
├─ start-persist.sh
├─ pre-dev-safe.sh
├─ pre-dev.sh
└─ 8 más...

Resultado: Confusión sobre cuál usar, inconsistencias
```

---

## ✨ Solución: Arquitectura Unificada

### **FASE 1: Centralizar Configuración Firebase**

#### 1.1 Crear archivo de configuración central
```
packages/core/src/config/
├─ firebase.config.ts (config base)
├─ environments.ts (dev/prod config)
└─ index.ts (export centralizado)
```

#### 1.2 Estructura de Config
```typescript
// packages/core/src/config/environments.ts
export type Environment = 'development' | 'production' | 'staging';

export interface FirebaseEnvironmentConfig {
  projectId: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  region: string;
  useEmulator: boolean;
  emulatorPorts?: {
    auth: number;
    firestore: number;
    functions: number;
    storage: number;
  };
}

// Configuraciones predefinidas
export const FIREBASE_CONFIG: Record<Environment, FirebaseEnvironmentConfig> = {
  development: {
    projectId: 'minreport-8f2a8',
    useEmulator: true,
    emulatorPorts: {
      auth: 9190,
      firestore: 8085,
      functions: 9196,
      storage: 9195,
    },
    // ... (otros campos)
  },
  production: {
    projectId: 'minreport-8f2a8',
    apiKey: process.env.FIREBASE_API_KEY!,
    useEmulator: false,
    // ... credenciales reales
  },
  staging: {
    // ... staging config
  },
};

export const getCurrentEnvironment = (): Environment => {
  if (typeof window !== 'undefined') {
    // Client-side
    return import.meta.env.MODE === 'production' ? 'production' : 'development';
  }
  // Server-side
  return (process.env.NODE_ENV as Environment) || 'development';
};
```

---

### **FASE 2: Implementar Offline-First Completo**

#### 2.1 Service Worker Mejorado
```
sites/client-app/public/
├─ sw.ts (service worker mejorado)
└─ offline-db.ts (sync manager)
```

#### 2.2 Estructura Offline
```typescript
// Service Worker completo
export interface OfflineSyncQueue {
  id: string;
  action: 'create' | 'update' | 'delete';
  collection: string;
  data: any;
  timestamp: number;
  retries: number;
  synced: boolean;
}

// Implementar:
- Queue de acciones offline
- Sync automático cuando vuelva online
- Conflict resolution
- Retry logic con exponential backoff
- Storage manager (IndexedDB)
```

#### 2.3 Estado Online/Offline
```typescript
// Hook para detectar conexión
export const useOnlineStatus = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  return isOnline;
};
```

---

### **FASE 3: Unificar Scripts de Desarrollo**

#### 3.1 Crear único script principal
```bash
# ANTES: 15 scripts confusos
pnpm dev:clean      # ¿Cuál usar?
pnpm dev:persist
pnpm dev:simple
pnpm dev:safe
pnpm start-dev-safe
# ...

# DESPUÉS: Un script claro
pnpm dev              # Desarrollo automático con persistencia
pnpm dev --fresh      # Limpiar datos y empezar
pnpm dev --prod       # Simulación de producción
```

#### 3.2 Script unificado
```bash
#!/bin/bash
# ultra-dev-start.sh - Script único para desarrollo

MODE=${1:-normal}  # normal | fresh | prod

case $MODE in
  fresh)
    echo "🗑️  Limpiando datos previos..."
    rm -rf firebase-emulators-data
    rm -f persistent-data.json
    ;;
  prod)
    echo "🏭 Modo producción simulado"
    export NODE_ENV=production
    ;;
  *)
    echo "🔄 Modo normal (preserva datos)"
    ;;
esac

# 1. Instalar dependencias si es necesario
if [ ! -d "node_modules" ]; then
  echo "📦 Instalando dependencias..."
  pnpm install
fi

# 2. Iniciar emuladores
echo "🔥 Iniciando Firebase Emulators..."
firebase emulators:start --only auth,firestore,functions,storage &
FIREBASE_PID=$!

# 3. Esperar a que los emuladores estén listos
sleep 5

# 4. Crear super admin si no existe
if [ "$MODE" = "fresh" ]; then
  node create-super-admin.cjs
fi

# 5. Iniciar aplicaciones
echo "🚀 Iniciando aplicaciones..."
pnpm dev:all

# Cleanup
trap "kill $FIREBASE_PID; exit 0" SIGINT SIGTERM
wait
```

---

### **FASE 4: Normalizar Estructura de Apps**

#### 4.1 Mismo patrón en 3 apps
```
sites/
├─ client-app/
│  ├─ src/
│  │  ├─ config/        (importa del core)
│  │  ├─ services/      (APIs, offline)
│  │  ├─ components/
│  │  ├─ hooks/
│  │  └─ pages/
│  ├─ public/sw.ts      (service worker)
│  └─ vite.config.ts
├─ admin-app/           (mismo patrón)
└─ public-site/         (mismo patrón)
```

#### 4.2 Servicio centralizado de API
```typescript
// packages/sdk/src/api-client.ts
export class MinReportAPIClient {
  private isOnline = navigator.onLine;
  private syncQueue: OfflineSyncQueue[] = [];
  
  constructor(private config: FirebaseEnvironmentConfig) {
    this.setupOnlineListener();
  }
  
  async request<T>(endpoint: string, options: RequestInit): Promise<T> {
    if (this.isOnline) {
      // Conectar a servidor
      return this.fetchFromServer<T>(endpoint, options);
    } else {
      // Guardar en queue local
      return this.queueForSync<T>(endpoint, options);
    }
  }
  
  private setupOnlineListener() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.syncQueue.forEach(item => this.retrySyncItem(item));
    });
    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }
}
```

---

## 🎯 Plan de Implementación

### **Paso 1: Centralizar Config (2 horas)**
- [ ] Crear `packages/core/src/config/`
- [ ] Mover todas las configs a un lugar
- [ ] Actualizar imports en todas las apps

### **Paso 2: Offline-First Completo (4 horas)**
- [ ] Service Worker mejorado
- [ ] Sync manager
- [ ] IndexedDB para local storage
- [ ] UI para mostrar estado online/offline

### **Paso 3: Unificar Scripts (1 hora)**
- [ ] Crear script único
- [ ] Remover scripts antiguos
- [ ] Actualizar documentación

### **Paso 4: Testing (3 horas)**
- [ ] Tests en dev local
- [ ] Tests en modo offline
- [ ] Tests de producción

---

## 📊 Comparativa Antes vs Después

| Aspecto | Antes | Después |
|---------|-------|---------|
| **Config Firebase** | 3 lugares duplicados | 1 lugar centralizado |
| **Scripts dev** | 15 scripts confusos | 1 script claro con opciones |
| **Offline support** | Parcial | Completo |
| **Sync manager** | No existe | Implementado |
| **Conflict resolution** | No existe | Implementado |
| **Service Worker** | Incompleto | Completo |
| **Documentación** | Confusa | Clara |
| **Tiempo setup dev** | 10 minutos confuso | 2 minutos directo |

---

## ✅ Checklist de Implementación

### Config Centralizada
- [ ] `packages/core/src/config/firebase.config.ts` creado
- [ ] `packages/core/src/config/environments.ts` creado
- [ ] `packages/core/src/config/index.ts` con exports
- [ ] `sites/client-app/src/firebaseConfig.ts` actualizado
- [ ] `sites/admin-app/src/firebaseConfig.ts` actualizado
- [ ] `sites/public-site/src/firebaseConfig.ts` actualizado
- [ ] `packages/sdk/src/index.ts` actualizado

### Offline-First
- [ ] Service Worker mejorado
- [ ] `packages/sdk/src/offline-manager.ts` creado
- [ ] `packages/sdk/src/sync-manager.ts` creado
- [ ] Hook `useOnlineStatus.ts` creado
- [ ] IndexedDB adapter creado
- [ ] Tests escritos

### Scripts
- [ ] `ultra-dev-start.sh` creado
- [ ] `package.json` actualizado con nuevos scripts
- [ ] Scripts antiguos movidos a `.deprecated`
- [ ] `README.md` actualizado

### Documentación
- [ ] `DEVELOPMENT.md` actualizado
- [ ] `OFFLINE_GUIDE.md` creado
- [ ] Swagger/OpenAPI docs generado

---

## 🚀 Resultado Final

```
✨ MinReport - Desarrollo & Producción Unificados

Un único:
✅ Punto de configuración
✅ Script de desarrollo
✅ Sistema offline-first
✅ Manera de desplegar

Resultado:
✅ Setup más rápido (2 min vs 10 min)
✅ Menos confusión
✅ Offline completamente funcional
✅ Fácil de mantener
✅ Listo para producción
```
