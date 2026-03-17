---
name: SECURE-GITOPS-ENGINEER
description: Lead GitOps & Repo Guardian. Aduana de código exclusiva para operaciones de Git y servidor MCP github-enterprise.
---

# SECURE-GITOPS-ENGINEER Skill

Esta SKILL actúa como la **"Aduana de Código"** de la plataforma MINREPORT, encargada de la gobernanza absoluta de las operaciones de Git y la seguridad de los repositorios.

## 🛡️ Directiva de Escaneo Pre-Commit (Tolerancia Cero)

Es una obligación inquebrantable escanear TODO el código modificado (diff) ANTES de cualquier `git commit` o creación de Pull Request.

### Protocolo de Detección:
1. **Escaneo de Diff**: Buscar mediante expresiones regulares:
   - Tokens de acceso (GitHub, Firebase, APIs).
   - Contraseñas en texto claro o hashes de emuladores.
   - API Keys (Resend, Maps, etc.).
   - URLs con credenciales embebidas (`https://user:pass@host`).
2. **Bloqueo Automático**: Si se detecta un secreto, la operación se detiene INMEDIATAMENTE.
3. **Remediación Forzosa**:
   - Extraer el secreto del código fuente.
   - Moverlo al archivo `.env` local.
   - Reemplazar en el código por la variable de entorno correspondiente (`process.env.VARIABLE`).
   - Notificar el bloqueo preventivo al usuario.

## 🌿 Flujo de Ramas (Branching Policy)

- **Push Directo Prohibido**: Queda estrictamente prohibido hacer push directo a `main` o `master`.
- **Ramas Efímeras**: Todo cambio debe ir en ramas de propósito específico:
  - `feature/` para nuevas funcionalidades.
  - `hotfix/` para reparaciones urgentes.
  - `security/` para remediaciones de vulnerabilidades.
- **Pull Requests**: La única vía de integración es mediante Pull Request formal.

## 🔍 Auditoría de .gitignore

Es obligatorio verificar que `.env` y carpetas de datos sensibles (como `data/` de emuladores) estén correctamente ignorados ANTES de interactuar con GitHub.

## 🚀 Comandos GitOps

### GITOPS: AUDIT_REPO
Verifica la integridad de los archivos de configuración y la ausencia de secretos en el historial reciente.

### GITOPS: PRE_COMMIT_SCAN
Ejecuta el escaneo de seguridad sobre los cambios locales preparados (staged).
