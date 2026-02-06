# Playwright E2E Tests

## Estructura

```
tests/
├── .auth/                    # Estados de autenticación
├── fixtures/                 # Fixtures personalizados
│   └── auth.fixture.ts      # Fixtures de roles
├── utils/                    # Utilidades
│   ├── db-seeder.ts         # Seeder de base de datos
│   └── helpers.ts           # Helpers generales
├── e2e/                      # Tests E2E
│   ├── registration/        # Pruebas de registro
│   ├── admin/               # Pruebas de admin
│   ├── desktop/             # Pruebas desktop
│   └── mobile/              # Pruebas móviles
├── global-setup.ts          # Setup global
└── global-teardown.ts       # Teardown global
```

## Configuración

### Prerrequisitos

```bash
# Instalar dependencias
npm install --save-dev @playwright/test

# Instalar navegadores
npx playwright install
```

### Variables de Entorno

Asegúrate de tener configurado:

```env
# Backend
PORT=8080
RESEND_API_KEY=re_xxx

# Frontend
VITE_API_URL=http://localhost:8080

# Emuladores
FIRESTORE_EMULATOR_HOST=localhost:8081
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
```

## Ejecución

### Ejecutar Todos los Tests

```bash
# Modo headless
npx playwright test

# Modo UI (interactivo)
npx playwright test --ui

# Modo debug
npx playwright test --debug
```

### Ejecutar Tests Específicos

```bash
# Solo desktop
npx playwright test --project="Desktop Chrome"

# Solo móvil
npx playwright test --project="Mobile Pixel 5"

# Solo admin
npx playwright test --project="Admin Dashboard"

# Archivo específico
npx playwright test tests/e2e/registration/enterprise.spec.ts
```

### Ver Reportes

```bash
# Abrir reporte HTML
npx playwright show-report
```

## Fixtures Disponibles

### `superAdmin`
Usuario Super Admin con acceso al Admin Dashboard.

```typescript
test('should approve account', async ({ superAdmin }) => {
  await superAdmin.goto('/admin/dashboard');
  // ...
});
```

### `enterpriseOwner`
Dueño de cuenta ENTERPRISE "Minera ABC S.A.".

```typescript
test('should create job profile', async ({ enterpriseOwner }) => {
  await enterpriseOwner.goto('/dashboard');
  // ...
});
```

### `eduStudent`
Estudiante de cuenta EDUCATIONAL "Universidad de Chile".

```typescript
test('should access plugins', async ({ eduStudent }) => {
  await eduStudent.goto('/dashboard');
  // ...
});
```

### `workerUser`
Operador en cuenta ENTERPRISE con Job Profile asignado.

```typescript
test('should see limited plugins', async ({ workerUser }) => {
  await workerUser.goto('/dashboard');
  // ...
});
```

### `personalUser`
Usuario de cuenta PERSONAL.

```typescript
test('should manage account', async ({ personalUser }) => {
  await personalUser.goto('/dashboard');
  // ...
});
```

## Helpers Disponibles

```typescript
import { 
  fillRut, 
  waitForFirestore, 
  expectToast,
  waitForLoading 
} from './utils/helpers';

test('example', async ({ page }) => {
  await fillRut(page, 'input[name="rut"]', '12.345.678-9');
  await waitForLoading(page);
  await expectToast(page, 'Registro exitoso');
});
```

## Seeding de Datos

Para resetear y poblar la base de datos:

```bash
npx ts-node tests/utils/db-seeder.ts
```

Esto crea:
- Super Admin
- Cuenta ENTERPRISE (Minera ABC S.A.)
- Cuenta EDUCATIONAL (UChile)
- Cuenta PERSONAL (Carlos Muñoz)
- Worker User (Pedro Soto)
- Plugins disponibles
- Job Profiles

## Debugging

### Ver Trace

```bash
# Ejecutar con trace
npx playwright test --trace on

# Ver trace
npx playwright show-trace trace.zip
```

### Screenshots

Los screenshots de fallos se guardan en `test-results/`.

### Videos

Los videos de fallos se guardan en `test-results/`.

## CI/CD

En CI, los tests se ejecutan con:
- 2 reintentos en caso de fallo
- 1 worker (secuencial)
- Trace activado en primer reintento
- Screenshots y videos de fallos

## Troubleshooting

### Emuladores no inician

```bash
# Iniciar manualmente
firebase emulators:start

# Verificar
curl http://localhost:8080/health
```

### Tests fallan por timeout

Aumenta timeouts en `playwright.config.ts`:

```typescript
timeout: 60 * 1000, // 60 segundos
```

### Auth state inválido

Elimina estados guardados:

```bash
rm -rf tests/.auth/*.json
```

Y vuelve a ejecutar global setup.
