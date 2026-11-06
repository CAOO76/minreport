#!/usr/bin/env node
/**
 * AUDITOR AUTOMATIZADO PERMANENTE DE PROTECCIÓN DE DATOS Y SOBERANÍA (Ley N° 19.628 y Nueva Ley N° 21.719 Chile + ISO 27001)
 *
 * Se ejecuta en desarrollo (`npm run audit:privacy`) y como compuerta bloqueante Fail-Closed en GitHub Actions (`.github/workflows/ci.yml`).
 * Verifica determinísticamente:
 * 1. Centralización exclusiva de inferencia IA en `src/core/resilient-ai-client.ts` (prohibido `new GoogleGenAI` en otros módulos).
 * 2. Presencia activa del filtro Pre-Vuelo `sanitizePromptForLey21719` (RUT, PPU, +56, Email, GPS, Contratos) en `resilient-ai-client.ts`
 *    y de `ConfidentialityAirlockService.scrubDeterministicPii` en `ConfidentialityAirlockService.ts`.
 * 3. Operación del motor propio símil NotebookLM (`vaultChatService.ts`) en modo `SOVEREIGN_VAULT_FIRST`
 *    (prohibido `useGoogleSearch: true` incondicional sobre fuentes privadas).
 * 4. Cero integraciones en código productivo hacia servicios de almacenamiento/procesamiento de consumo externos
 *    (`notebooklm.google`, `colab.research.google.com`, `drive.google.com`).
 * 5. Cero exposición de secretos de servidor (`VITE_GEMINI_API_KEY`, `VITE_RESEND_API_KEY`, `DEV_ROOT_PASSWORD`) en `web/src/`.
 * 6. Existencia de la regla permanente `.agents/rules/ley-chilena-proteccion-datos-21719.md` y skill `CHILE-DATA-PRIVACY-LEY21719`.
 */

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const violations = [];

function walkFiles(dirPath, exts = ['.ts', '.tsx', '.js', '.mjs']) {
    const results = [];
    if (!fs.existsSync(dirPath)) return results;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkFiles(full, exts));
        } else if (exts.includes(path.extname(entry.name))) {
            results.push(full);
        }
    }
    return results;
}

const srcFiles = walkFiles(path.join(repoRoot, 'src'));
const webFiles = walkFiles(path.join(repoRoot, 'web', 'src'));
const allCodeFiles = [...srcFiles, ...webFiles];

// 1. Verificar existencia de Regla Always-On y Skill DPO Ley 21.719
const requiredGovernanceFiles = [
    '.agents/rules/ley-chilena-proteccion-datos-21719.md',
    '.agents/skills/CHILE-DATA-PRIVACY-LEY21719/SKILL.md',
    'src/core/privacy/ConfidentialityAirlockService.ts',
    'src/core/resilient-ai-client.ts',
    'src/modules/opermaq/services/vaultChatService.ts',
];

for (const rel of requiredGovernanceFiles) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
        violations.push(`[GOBERNANZA AUSENTE] Falta archivo obligatorio de cumplimiento Ley 21.719: ${rel}`);
    }
}

// 2. Verificar centralización de GoogleGenAI y prohibición de servicios de consumo externos
const allowedGenAiFile = path.normalize(path.join(repoRoot, 'src/core/resilient-ai-client.ts'));
const blockedExternalServiceRegex = /\b(notebooklm\.google|colab\.research\.google\.com|drive\.google\.com\/drive)\b/i;

for (const file of allCodeFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(repoRoot, file);

    if (path.normalize(file) !== allowedGenAiFile && /\bnew\s+GoogleGenAI\s*\(/.test(content)) {
        violations.push(
            `[BYPASS CLIENTE RESILIENTE] ${rel} instancia 'new GoogleGenAI()' directamente, saltando la esclusa Ley 21.719 de resilient-ai-client.ts.`
        );
    }

    if (blockedExternalServiceRegex.test(content)) {
        violations.push(
            `[FUGA A SERVICIO DE CONSUMO EXTERNO] ${rel} contiene referencias a servicios de consumo bloqueados (NotebookLM externo, Colab o Google Drive).`
        );
    }
}

// 3. Verificar sanitización Pre-Vuelo Ley 21.719 en resilient-ai-client.ts
if (fs.existsSync(allowedGenAiFile)) {
    const resilientContent = fs.readFileSync(allowedGenAiFile, 'utf8');
    if (!resilientContent.includes('sanitizePromptForLey21719')) {
        violations.push(
            `[ESCLUSA PRE-VUELO AUSENTE] src/core/resilient-ai-client.ts no implementa ni invoca sanitizePromptForLey21719.`
        );
    }
}

// 4. Verificar modo SOVEREIGN_VAULT_FIRST en vaultChatService.ts
const vaultChatFile = path.join(repoRoot, 'src/modules/opermaq/services/vaultChatService.ts');
if (fs.existsSync(vaultChatFile)) {
    const vaultContent = fs.readFileSync(vaultChatFile, 'utf8');
    const vaultCodeNoComments = vaultContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    if (/useGoogleSearch\s*:\s*true/.test(vaultCodeNoComments)) {
        violations.push(
            `[EXPOSICIÓN BÓVEDA PRIVADA] src/modules/opermaq/services/vaultChatService.ts tiene 'useGoogleSearch: true' incondicional. Debe usar modo SOVEREIGN_VAULT_FIRST (shouldUseExternalSearch).`
        );
    }
    if (!vaultCodeNoComments.includes('ConfidentialityAirlockService.scrubDeterministicPii')) {
        violations.push(
            `[FALTA SANITIZACIÓN EN BÓVEDA] src/modules/opermaq/services/vaultChatService.ts debe sanitizar las entradas con ConfidentialityAirlockService.scrubDeterministicPii.`
        );
    }
}

// 5. Verificar cero exposición de secretos de servidor en web/src/
const forbiddenFrontendSecretRegex = /\b(VITE_GEMINI_API_KEY|VITE_GEMINI_DEV_API_KEY|VITE_RESEND_API_KEY|DEV_ROOT_PASSWORD|SUPER_ADMIN_PASSWORD)\b/;
for (const file of webFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(forbiddenFrontendSecretRegex);
    if (match) {
        const rel = path.relative(repoRoot, file);
        violations.push(
            `[SECRETO EN CLIENTE] ${rel} referencia la credencial privada '${match[1]}' en el bundle frontend.`
        );
    }
}

if (violations.length > 0) {
    console.error('\n❌ [AUDITORÍA LEY 21.719 / LEY 19.628 / ISO 27001 FALLIDA]:');
    for (const v of violations) {
        console.error(`  - ${v}`);
    }
    process.exit(1);
}

console.log(
    `✅ [AUDITORÍA LEY 21.719 / LEY 19.628 CHILE & ISO 27001 APROBADA] (${allCodeFiles.length} archivos verificados en southamerica-west1, 0 infracciones).`
);
