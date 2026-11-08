import { db } from '../../../config/firebase';
import { AuditLedger } from '../../../core/audit-ledger';
import {
    ResilientAIClient,
    Type,
    UngroundedEvidenceError,
} from '../../../core/resilient-ai-client';
import {
    type ExtractedFigureRef,
    ItemizedSource,
    type PillarDocument,
    PillarId,
    PillarItem,
    ProposedUpdate,
    SEQUENTIAL_PILLAR_ORDER,
} from '../types/vault.types';
import { buildAndPersistAssetSymbologyPack } from './EquipmentSymbologyPackBuilder';
import { GroundedWebMediaHarvester, type MediaHarvestReport } from './GroundedWebMediaHarvester';
import {
    computeFactFingerprint,
    injectVerifiedInlineSymbology,
    verifyAndNormalizeTechnicalUnits,
} from './NeuroSymbolicVerifier';
import { isDeprecatedSyntheticBlueprintFigure } from './OpermaqSvgBlueprintEngine';
import { createEmptyKnowledgeVault, PILLAR_AGENTS, PILLAR_LABELS } from './pillarAgents';
import {
    buildSectionVisualSummary,
    countSectionsWithExplicitVisualReference,
} from './PendingFigureMarkers';
import { SegmentedDocumentProcessorService } from './SegmentedDocumentProcessorService';
import { classifySourcesByAuthorship } from './SourceClassifierService';
import {
    analyzeTableTraceability,
    applyTraceabilityAnnotations,
    type EvidenceDocument,
    extractRowSourceUrlsFromGrounding,
} from './TechnicalEvidenceVerifier';
import { ensureUniversalSymbologySeeded } from './UniversalSymbologySeedService';
import {
    filterFiguresReferencedInMarkdown,
    mergeDeduplicatedFigures,
    reconcileSectionFiguresAndPendingMarkers,
} from './VaultReconciliationService';

/**
 * ITEM HUNTER SERVICE v4.0 — ETAPA 3 CAZA TÉCNICA MULTIMODAL Y CORPUS-FIRST
 *
 * Evolución v4.0:
 * 1. Corpus-First Local RAG (`768d`): Consulta primero `vault_corpus_chunks` (manuales PDF/ETT ya ingeridos)
 *    antes de invocar Google Search, evitando contradecir datos oficiales ya cargados y reduciendo alucinación.
 * 2. Cosecha Visual Autónoma (`GroundedWebMediaHarvester` Anti-SSRF + Juez VLM `ANCHOR_HA`):
 *    Captura diagramas, tablas gráficas y fotos de componentes reales desde las fuentes grounded,
 *    comprimiéndolas a WebP en CAS (`GLOBAL_OEM`) y anclándolas a `item.figures[]`.
 * 3. Simbología Universal Sin Tope Artificial (`<= 40` símbolos `ISO 7010` / `ISO 7000` / `ISO 2575` / `IEC 60417` / `GHS`):
 *    Elimina el límite heredado `.slice(0, 6)` y reconstruye el paquete ad-hoc del equipo.
 * 4. Verificación Neuro-Simbólica SI + Deduplicación por `fact_fingerprint`:
 *    Impide duplicar hallazgos idénticos en re-cazas sucesivas y respeta `is_human_locked`
 *    (registrando avisos no destructivos en `locked_item_advisories[]` cuando `recordAdvisoryIfLocked` está activo).
 */

export interface HuntItemOptions {
    globalAssetId: string;
    pillarId: PillarId;
    itemId: string;
    humanCorrection?: string;
    forceOverwrite?: boolean;
    recordAdvisoryIfLocked?: boolean;
    onProgress?: (percent: number, message: string) => Promise<void> | void;
}

export interface HuntItemResult {
    success: boolean;
    item: PillarItem;
    content: string | null;
    item_sources: ItemizedSource[];
    hunted_at: string;
    mode: 'INITIAL_HUNT' | 'CONFLICT_BUFFER' | 'LOCKED_ADVISORY';
    newConflictsCount: number;
    harvestedFiguresCount?: number;
    error?: string;
}

const DIFF_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        differences: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    estado_fusion: {
                        type: Type.STRING,
                        description:
                            'NUEVO (información complementaria ausente) o CONFLICTO (contradicción numérica o procedimental con el texto vigente).',
                    },
                    valor_actual: { type: Type.STRING },
                    valor_nuevo: { type: Type.STRING },
                    synthesis: { type: Type.STRING },
                },
                required: ['estado_fusion', 'valor_nuevo', 'synthesis'],
            },
        },
    },
    required: ['differences'],
};

/**
 * Valida en vivo contra Wikimedia Commons si existe un pictograma oficial ISO 7000 / IEC 60417
 * para bloquear códigos de símbolos inventados por el LLM.
 */
export async function validateIsoReferenceExists(isoCode: string): Promise<{ exists: boolean; fileTitle?: string }> {
    const cleanCode = isoCode
        .trim()
        .replace(/^(ISO\s*7000|IEC\s*60417|Ref-No\.?)\s*[-:]?\s*/gi, '')
        .trim();
    if (!cleanCode || !/^[0-9A-Za-z-]+$/.test(cleanCode)) {
        return { exists: false };
    }

    const queries = [`ISO 7000 ${cleanCode}`, `IEC 60417 ${cleanCode}`];
    for (const q of queries) {
        try {
            const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srsearch=${encodeURIComponent(
                q
            )}&format=json&origin=*`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4000);
            const resp = await fetch(url, {
                signal: controller.signal,
                headers: { 'User-Agent': 'MINREPORT-OPERMAQ-ISOValidator/4.0' },
            });
            clearTimeout(timer);

            if (resp.ok) {
                const json: any = await resp.json();
                const hits: any[] = json?.query?.search || [];
                const exactHit = hits.find((h) => String(h.title || '').includes(cleanCode));
                if (exactHit) {
                    return { exists: true, fileTitle: exactHit.title };
                }
            }
        } catch {
            // Degradación limpia si no hay red hacia Wikimedia en entorno aislado
        }
    }
    return { exists: false };
}

export async function detectContentDifferences(
    pillarId: PillarId,
    itemId: string,
    makeModel: string,
    itemTitle: string,
    existingContent: string,
    newHuntedContent: string,
    primarySource?: ItemizedSource,
    attachedFigures?: ExtractedFigureRef[]
): Promise<ProposedUpdate[]> {
    const prompt = `Actúa como Compulsor Técnico Forense OEM para "${makeModel}" — Capítulo "${itemTitle}".
Compara el CONTENIDO VIGENTE de la bóveda contra el NUEVO HALLAZGO DE CAZA WEB.

REGLAS:
1. Ignora diferencias meramente estilísticas o de redacción equivalente.
2. Si el nuevo hallazgo aporta datos duros reales que faltaban en el contenido vigente (capacidades, torques, pasos verificados), clasifícalo con "estado_fusion": "NUEVO".
3. Si el nuevo hallazgo contradice un valor numérico, viscosidad, intervalo u orden crítico del contenido vigente, clasifícalo con "estado_fusion": "CONFLICTO" citando exactamente "valor_actual".
4. Si no hay diferencias sustanciales reales, devuelve "differences": [].

=== CONTENIDO VIGENTE ===
${existingContent}

=== NUEVO HALLAZGO DE CAZA ===
${newHuntedContent}`;

    const nowIso = new Date().toISOString();
    const srcUrl = primarySource?.url || '';
    const isOem = primarySource?.type === 'OEM';

    try {
        const { data } = await ResilientAIClient.generateStructured<{
            differences: Array<{
                estado_fusion: string;
                valor_actual?: string;
                valor_nuevo: string;
                synthesis: string;
            }>;
        }>({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            temperature: 0.1,
            responseSchema: DIFF_SCHEMA,
            prompt,
        });

        return (Array.isArray(data.differences) ? data.differences : []).map((d, idx) => ({
            proposal_id: `prop_${itemId}_${Date.now()}_${idx}`,
            estado_fusion: d.estado_fusion === 'CONFLICTO' ? 'CONFLICTO' : 'NUEVO',
            zona: pillarId,
            componente: itemTitle || itemId,
            tipo_input: 'text_block',
            is_oem: isOem,
            valor_actual: d.valor_actual || '',
            valor_nuevo: d.valor_nuevo,
            condicion_esperada: d.valor_nuevo,
            synthesis: d.synthesis,
            source_url: srcUrl,
            detected_at: nowIso,
            human_decision: null,
            fact_fingerprint: computeFactFingerprint(d.valor_nuevo, itemTitle),
            figures: idx === 0 && attachedFigures && attachedFigures.length > 0 ? attachedFigures : undefined,
        }));
    } catch {
        return [
            {
                proposal_id: `prop_${itemId}_${Date.now()}_0`,
                estado_fusion: 'CONFLICTO',
                zona: pillarId,
                componente: itemTitle || itemId,
                tipo_input: 'text_block',
                is_oem: isOem,
                valor_actual: existingContent.slice(0, 400),
                valor_nuevo: newHuntedContent,
                synthesis: 'Propuesta íntegra de re-caza web pendiente de revisión comparativa HITL.',
                source_url: srcUrl,
                detected_at: nowIso,
                human_decision: null,
                fact_fingerprint: computeFactFingerprint(newHuntedContent, itemTitle),
                figures: attachedFigures && attachedFigures.length > 0 ? attachedFigures : undefined,
            },
        ];
    }
}

/**
 * Extrae las especificaciones y cifras oficiales ya verificadas en los pilares previos de la secuencia (`01 ➔ 02 ➔ 03 ➔ 04 ➔ 05`),
 * junto con sus documentos de evidencia y fuentes `OEM`, para garantizar coherencia numérica inter-pilar (ej. `01 · Ficha Técnica ➔ 02 · Manual de Operaciones`).
 */
function buildCrossPillarConfirmedSpecsAndSources(
    vault: Record<string, any> | undefined,
    targetPillarId: PillarId,
    makeOficial: string
): {
    promptBlock: string;
    priorPillarEvidenceDocs: EvidenceDocument[];
    priorPillarOemSources: ItemizedSource[];
} {
    if (!vault || typeof vault !== 'object') {
        return { promptBlock: '', priorPillarEvidenceDocs: [], priorPillarOemSources: [] };
    }
    const targetIdx = SEQUENTIAL_PILLAR_ORDER.indexOf(targetPillarId);
    if (targetIdx <= 0) {
        return { promptBlock: '', priorPillarEvidenceDocs: [], priorPillarOemSources: [] };
    }

    const sectionSummaries: string[] = [];
    const priorPillarEvidenceDocs: EvidenceDocument[] = [];
    const priorPillarOemSources: ItemizedSource[] = [];
    const seenUrls = new Set<string>();

    for (let i = 0; i < targetIdx; i++) {
        const pid = SEQUENTIAL_PILLAR_ORDER[i];
        const pLabel = PILLAR_LABELS[pid] || pid;
        const pItems: PillarItem[] = Array.isArray(vault[pid]?.items)
            ? vault[pid].items.filter((it: any) => !it?.is_discarded)
            : [];
        if (pItems.length === 0) continue;

        for (const src of vault[pid]?.classified_sources_itemized || []) {
            if (src?.url && src.type === 'OEM' && !seenUrls.has(src.url) && priorPillarOemSources.length < 6) {
                seenUrls.add(src.url);
                priorPillarOemSources.push(src);
            }
        }

        const itemFactBlocks: string[] = [];
        for (const it of pItems) {
            for (const src of it.item_sources || []) {
                if (src?.url && src.type === 'OEM' && !seenUrls.has(src.url) && priorPillarOemSources.length < 6) {
                    seenUrls.add(src.url);
                    priorPillarOemSources.push(src);
                }
            }

            if (it.content_status !== 'COMPLETADO' || !it.content || !it.content.trim()) {
                itemFactBlocks.push(`  - [${it.section || 'CAPÍTULO'}] ${it.title} (pendiente de caza)`);
                continue;
            }

            const primaryUrl =
                (it.item_sources || []).find((s) => s?.url && s.type === 'OEM')?.url ||
                (it.item_sources || [])[0]?.url ||
                `#pillar-0${i + 1}:${pid}`;
            priorPillarEvidenceDocs.push({
                url: primaryUrl,
                text: String(it.content),
            });
            if (primaryUrl.startsWith('#pillar-') && !seenUrls.has(primaryUrl)) {
                seenUrls.add(primaryUrl);
                priorPillarOemSources.push({
                    type: 'OEM',
                    author: makeOficial,
                    description: `Pilar 0${i + 1} (${pLabel}) — Especificaciones verificadas en bóveda`,
                    url: primaryUrl,
                });
            }

            const allNumericLines = String(it.content)
                .split('\n')
                .map((l) => l.trim())
                .filter(
                    (l) =>
                        /\d/.test(l) &&
                        !/^\|[\s:-]+\|$/.test(l) &&
                        !/informaci[oó]n t[eé]cnica no declarada|sin trazabilidad directa/i.test(l) &&
                        (l.startsWith('|') || l.startsWith('-') || l.startsWith('*'))
                );

            // Priorizar filas con capacidades de llenado (L/gal/qt), viscosidades SAE/ISO, presiones (bar/psi/MPa), temperaturas (°C), pares de apriete (N·m), parámetros críticos HSEC y puntos de chequeo pre-turno
            const priorityMaintenanceLineRegex =
                /\b(?:capacidad|c[aá]rter|estanque|tanque|dep[oó]sito|sistema\s+de\s+enfriamiento|refrigerante|hidr[aá]ulic|transmisi[oó]n|diferencial|mando\s+final|caja\s+de\s+cadena|sae\s*\d|iso\s*vg|api\s*c|nlgi|rops|fops|iso\s*3471|iso\s*3449|iso\s*3450|loto|traba|acumulador|alivio|freno|bater[ií]a|neum[aá]tico|llanta|tuerca|oruga|mirilla|varilla|separador|acople|pasador|extintor|afex|cintur[oó]n|bocina|alarma|estacionamiento|cortacorriente|\d+(?:[.,]\d+)?\s*(?:l\b|gal|qt|bar|mpa|kpa|psi|n·m|lb-ft|°c|v\b|vdc|cca|kw|hp|kg|t\b|db|m\/s))\b/i;

            const prioritizedLines = [
                ...allNumericLines.filter((l) => priorityMaintenanceLineRegex.test(l)),
                ...allNumericLines.filter((l) => !priorityMaintenanceLineRegex.test(l)),
            ].slice(0, 7);

            if (prioritizedLines.length > 0) {
                itemFactBlocks.push(`  - De "${it.title}":\n    ${prioritizedLines.join('\n    ')}`);
            } else {
                itemFactBlocks.push(`  - [${it.section || 'CAPÍTULO'}] ${it.title}`);
            }
        }

        if (itemFactBlocks.length > 0) {
            // Reparto equitativo por cada pilar previo (01, 02, 03, 04) para que ninguno quede truncado en Pilares 04 y 05
            const perPillarQuota = Math.min(2200, Math.floor(6000 / Math.max(1, targetIdx)));
            const perPillarBlock = `PILAR 0${i + 1} (${pLabel.toUpperCase()}) — SUBSISTEMAS Y CIFRAS VERIFICADAS:\n${itemFactBlocks.join('\n')}`;
            sectionSummaries.push(perPillarBlock.slice(0, perPillarQuota));
        }
    }

    // En Matriz de Riesgos (Pilar 04) y Checklist Pre-Operacional (Pilar 05), incorporar la referencia oficial de límites estatutarios HSEC (DS 132 / DS 594 / PREXOR / PLANESI / ISO 2631-1 / ISO 5349 / Ley 20.949)
    if (targetPillarId === 'matriz_riesgos' || targetPillarId === 'checklist_pre_op') {
        const hsecNormUrl = '#normativa-hsec:ds132-ds594-iso45001';
        priorPillarEvidenceDocs.push({
            url: hsecNormUrl,
            text:
                'Umbrales normativos HSEC Chile e ISO: Ruido ocupacional PREXOR / DS 594 criterio de acción 82 dB(A), límite permisible 85 dB(A) para 8 h, pico 140 dB(C). ' +
                'Vibración cuerpo entero ISO 2631-1 / DS 594 acción 0,5 m/s² (0.5 m/s2), límite 1,15 m/s² (1.15 m/s2) o 0,81 m/s². ' +
                'Vibración mano-brazo HAVS ISO 5349 / DS 594 acción 2,5 m/s² (2.5 m/s2), límite 5,0 m/s² (5.0 m/s2). ' +
                'Sílice libre cristalizada PLANESI / DS 594 LPP 0,08 mg/m³ (0.08 mg/m3), acción 0,04 mg/m³ (0.04 mg/m3), polvo respirable 2,4 mg/m³. ' +
                'Manejo manual de carga Ley 20.949 / DS 63 límite máximo 25 kg (20 kg mujeres/menores). ' +
                'Trabajo en altura física ≥ 1,8 m (1.8 m / 6 ft). Enfriamiento seguro LOTO < 50 °C (122 °F), espera de descarga de condensadores/acumuladores 5 min a 15 min, verificación Energía Cero 0 V, 0 bar (0 psi), 0 RPM. ' +
                'Regeneración térmica DPF > 600 °C (1.112 °F). Iluminación mínima faena DS 594 150 lux. ' +
                'Inspección pre-operacional y extintores NCh 1430 / NFPA 10 / MSHA 30 CFR 56.14100: manómetro extintor PQS ABC franja verde 10 bar, 12 bar a 14 bar (150 psi, 175 psi, 195 psi a 200 psi), alarma acústica de retroceso 85 dB(A) a 107 dB(A), mirilla de nivel 50% a 100%, integridad de tuercas/pernos 100%, recorrido perimetral 360°, duración pre-uso 10 min a 15 min, surco mínimo de neumático 3 mm a 5 mm.',
        });
        if (!seenUrls.has(hsecNormUrl)) {
            seenUrls.add(hsecNormUrl);
            priorPillarOemSources.push({
                type: 'EXTERNO',
                author: 'SERNAGEOMIN / MINSAL / ISO',
                description: 'DS 132 Seguridad Minera, DS 594 (PREXOR / PLANESI), Ley 20.949, ISO 45001, ISO 2631-1 e ISO 5349',
                url: hsecNormUrl,
            });
        }
    }

    const promptBlock =
        sectionSummaries.length > 0
            ? `\nESPECIFICACIONES Y CIFRAS OFICIALES HEREDADAS DE PILARES PREVIOS (COHERENCIA INTER-PILAR OBLIGATORIA — PROHIBIDO CONTRADECIR ESTOS VALORES):\n${sectionSummaries
                  .join('\n\n')
                  .slice(0, 6200)}\n`
            : '';

    return { promptBlock, priorPillarEvidenceDocs, priorPillarOemSources };
}

/**
 * Construye el contexto de:
 * 1. Confinamiento temático intra-pilar (lista de capítulos hermanos para impedir que este ítem repita sus temas).
 * 2. Coherencia numérica intra-pilar (`Cross-Item Consistency`: cifras ya confirmadas en otros capítulos del mismo pilar).
 */
function buildIntraPillarConsistencyAndScopeContext(
    pillar: PillarDocument,
    currentItem: PillarItem
): string {
    const allActive = (pillar.items || []).filter(
        (it) => !it.is_discarded && it.item_id !== currentItem.item_id
    );
    if (allActive.length === 0) return '';

    const siblingTitles = allActive
        .map((it) => `  - [${it.section || 'SECCIÓN'}] ${it.title}`)
        .join('\n');

    const completedSiblings = allActive.filter(
        (it) => it.content_status === 'COMPLETADO' && it.content && it.content.trim().length > 0
    );

    const verifiedFactsLines: string[] = [];
    for (const sib of completedSiblings) {
        const lines = String(sib.content || '')
            .split('\n')
            .map((l) => l.trim())
            .filter(
                (l) =>
                    /\d/.test(l) &&
                    !/^\|[\s:-]+\|$/.test(l) &&
                    !/informaci[oó]n t[eé]cnica no declarada/i.test(l) &&
                    (l.startsWith('|') || l.startsWith('-') || l.startsWith('*'))
            )
            .slice(0, 5);
        if (lines.length > 0) {
            verifiedFactsLines.push(`  * De "${sib.title}":\n    ${lines.join('\n    ')}`);
        }
    }

    const factsBlock =
        verifiedFactsLines.length > 0
            ? `\nCIFRAS OFICIALES YA CONFIRMADAS EN CAPÍTULOS HERMANOS DE ESTE PILAR (PROHIBIDO CONTRADECIR ESTOS VALORES):\n${verifiedFactsLines
                  .join('\n')
                  .slice(0, 2200)}\n`
            : '';

    return [
        `\nMETADATOS CANÓNICOS DEL CAPÍTULO ACTUAL:`,
        `- Sección Canónica: ${currentItem.section || 'ESPECIFICACIÓN TÉCNICA'}`,
        ...(currentItem.standard ? [`- Norma Técnica Rectora: ${currentItem.standard}`] : []),
        `- Criticidad: ${currentItem.priority || 'IMPORTANTE'}`,
        `\nMAPA DE CAPÍTULOS HERMANOS EN ESTE MISMO PILAR (CONFINAMIENTO ESTRICTO — NO DESARROLLAR ESTOS TEMAS AQUÍ):`,
        siblingTitles,
        factsBlock,
    ]
        .filter(Boolean)
        .join('\n');
}

export async function huntVaultItem(options: HuntItemOptions): Promise<HuntItemResult> {
    const {
        globalAssetId,
        pillarId,
        itemId,
        humanCorrection,
        forceOverwrite = false,
        recordAdvisoryIfLocked = false,
        onProgress,
    } = options;

    const agent = PILLAR_AGENTS[pillarId];
    if (!agent) throw new Error(`Pilar inválido: ${pillarId}`);

    await onProgress?.(10, 'Cargando ficha maestra y verificando estado HITL...');

    const assetRef = db.collection('global_asset_catalog').doc(globalAssetId);
    const assetSnap = await assetRef.get();
    if (!assetSnap.exists) {
        throw new Error(`Activo ${globalAssetId} no existe en global_asset_catalog.`);
    }

    const assetData = assetSnap.data()!;
    if (assetData.isSealed === true || assetData.is_sealed === true || assetData.knowledge_vault?.is_sealed === true) {
        const err: any = new Error('La bóveda está sellada (HTTP 403).');
        err.statusCode = 403;
        throw err;
    }

    const makeOficial = String(assetData.make_oficial || assetData.make || 'GENÉRICO');
    const modelOficial = String(assetData.model_oficial || assetData.model || globalAssetId);
    const makeModel = assetData.make_model || `${makeOficial} ${modelOficial}`;
    const equipmentType = String(assetData.tipo_equipo || assetData.categoria_equipo || 'EQUIPO INDUSTRIAL');

    const vault = assetData.knowledge_vault || createEmptyKnowledgeVault(makeModel);
    const pillar = vault[pillarId];
    if (!pillar || !Array.isArray(pillar.items)) {
        throw new Error(`El pilar ${pillarId} aún no ha sido itemizado.`);
    }

    const itemIndex = pillar.items.findIndex((i: PillarItem) => i.item_id === itemId);
    if (itemIndex === -1) {
        throw new Error(`Ítem ${itemId} no encontrado en ${pillarId}.`);
    }

    const currentItem: PillarItem = pillar.items[itemIndex];

    // CANDADO HITL INVIOLABLE (si no se pidió modo advisory silencioso, bloquear con HTTP 403)
    if (currentItem.is_human_locked && !recordAdvisoryIfLocked) {
        const err: any = new Error(
            `[HITL BLOCK] El ítem "${currentItem.title}" posee candado humano activo (is_human_locked). Desbloquéelo antes de re-cazar.`
        );
        err.statusCode = 403;
        throw err;
    }

    await onProgress?.(20, 'Consultando corpus local de manuales PDF/ETT y catálogo vectorial ISO...');

    await ensureUniversalSymbologySeeded(false);

    // 1. Consulta Corpus-First en fragmentos locales `vault_corpus_chunks` (`768d`) + `vault_documents`
    const [localChunks, vaultDocsSnap] = await Promise.all([
        SegmentedDocumentProcessorService.searchLocalAssetCorpus(
            globalAssetId,
            `${currentItem.section || ''} ${currentItem.title} ${currentItem.rationale || ''}`,
            5
        ),
        assetRef
            .collection('vault_documents')
            .limit(8)
            .get()
            .catch(() => null),
    ]);

    const extraVaultDocSnippets: string[] = [];
    const localDocSources: ItemizedSource[] = [];
    if (vaultDocsSnap && !vaultDocsSnap.empty) {
        for (const d of vaultDocsSnap.docs) {
            const data = d.data();
            const txt = String(data.extracted_text || data.markdown_es || data.summary || '').trim();
            const title = String(data.filename || data.title || d.id);
            if (txt.length > 40) {
                extraVaultDocSnippets.push(`--- [Documento Local: ${title}] ---\n${txt.slice(0, 2000)}`);
                localDocSources.push({
                    type: 'OEM',
                    author: makeOficial,
                    description: `Documento en bóveda soberana: ${title}`,
                    url: String(data.storage_url || data.download_url || `#vault-doc:${d.id}`),
                });
            }
        }
    }

    const crossPillarContext = buildCrossPillarConfirmedSpecsAndSources(vault, pillarId, makeOficial);

    const preAssignedSources: ItemizedSource[] = [
        ...(Array.isArray(currentItem.item_sources) ? currentItem.item_sources : []),
        ...(Array.isArray(pillar.classified_sources_itemized)
            ? pillar.classified_sources_itemized.slice(0, 6)
            : []),
        ...crossPillarContext.priorPillarOemSources.filter((s) => /^https?:\/\//i.test(s.url)),
    ].filter((s, idx, arr) => s?.url && arr.findIndex((x) => x?.url === s.url) === idx);

    const hasSovereignOrPreverifiedEvidence =
        localChunks.length > 0 ||
        extraVaultDocSnippets.length > 0 ||
        preAssignedSources.length > 0 ||
        crossPillarContext.priorPillarEvidenceDocs.length > 0;

    const localCorpusContext =
        localChunks.length > 0 || extraVaultDocSnippets.length > 0
            ? `\nEVIDENCIA OFICIAL YA INGERIDA EN CORPUS LOCAL SOBERANO (PRIORIDAD MÁXIMA DE VERACIDAD):\n${[
                  ...localChunks.map(
                      (c) =>
                          `--- [${c.sourceFilename} Págs. ${c.pages.join(',') || 'N/A'} | ${c.title}] ---\n${c.markdown.slice(
                              0,
                              2400
                          )}`
                  ),
                  ...extraVaultDocSnippets,
              ].join('\n\n')}\n`
            : '';

    const preverifiedUrlsContext =
        preAssignedSources.length > 0
            ? `\nFUENTES TÉCNICAS PRE-VERIFICADAS PARA ESTE CAPÍTULO (PRIORIZAR CONSULTA):\n${preAssignedSources
                  .slice(0, 6)
                  .map((s) => `- [${s.type}] ${s.author}: ${s.description} (${s.url})`)
                  .join('\n')}\n`
            : '';

    const intraPillarContext = buildIntraPillarConsistencyAndScopeContext(pillar, currentItem);

    const profileSummary = [
        `- Activo: ${makeModel} (${assetData.tipo_equipo || ''})`,
        `- Categoría: ${assetData.categoria_equipo || ''}`,
        `- Ambientes: ${(assetData.ambiente_operativo || []).join(', ')}`,
        `- Referencia de perfil NO VERIFICADA (solo orientativa; confirmar cada valor con fuente OEM y PROHIBIDO citarla como fuente): ${(assetData.caracteristicas_principales || []).join(' | ')}`,
        crossPillarContext.promptBlock,
        intraPillarContext,
    ]
        .filter(Boolean)
        .join('\n');

    const feedbackBlock = [
        currentItem.review_notes
            ? `\nOBSERVACIÓN DE RECHAZO HUMANO PREVIO (CORREGIR OBLIGATORIAMENTE): "${currentItem.review_notes}"`
            : '',
        humanCorrection ? `\nDIRECTIVA HUMANA EXPRESA PARA ESTA CAZA: "${humanCorrection}"` : '',
    ]
        .filter(Boolean)
        .join('\n');

    const huntPrompt = `${agent.taskHunt(makeModel, currentItem.title, currentItem.rationale || '', profileSummary)}
${localCorpusContext}
${preverifiedUrlsContext}
${feedbackBlock}

INSTRUCCIÓN DE REDACCIÓN TÉCNICA FUNDAMENTADA (MARKDOWN PURO + SIMBOLOGÍA INLINE + APOYO GRÁFICO CONTEXTUAL):
1. Usa Google Search y el corpus local OEM para consultar manuales oficiales, tablas de servicio y normativas reales aplicables a "${makeModel}".
2. Redacta directamente el desarrollo técnico completo en Markdown puro con tablas estructuradas, valores verificados en unidades métricas SI (con el valor imperial entre paréntesis si aplica) y procedimientos técnicos precisos (sin HTML y sin envolver en JSON).
3. PROHIBIDO escribir marcadores [SÍMBOLO: ...]: la simbología se inyecta de forma determinista solo cuando el texto menciona explícitamente un testigo/indicador del tablero, un EPP obligatorio, un peligro señalizado o un código ISO/IEC/GHS literal.
4. INDICACIÓN DE IMÁGENES / ESQUEMAS DE APOYO SOLO ANTE REFERENCIA EXPLÍCITA: Únicamente cuando una sección cite literalmente elementos de un diagrama o figura de la fuente consultada (callouts numerados como (1) A2 Locking Clip, pórticos a1/a2, receptáculo EC, o frases como "ver diagrama"), indica al final de esa misma sección:
![IMAGEN_PENDIENTE: <tipo de recurso y elementos citados en esa sección>](<URL exacta de una fuente consultada> "<Autor o título de la fuente>")
PROHIBIDO insertar este marcador en secciones de solo tablas o sin referencia visual explícita, y PROHIBIDO inventar URLs.
5. Si un valor específico no aparece en la documentación consultada, indícalo como [Información técnica no declarada en ficha].`;

    await onProgress?.(42, `Ejecutando caza profunda multimodal OEM para "${currentItem.title}"...`);

    let inferenceHeartbeatTimer: NodeJS.Timeout | null = null;
    let heartbeatPct = 42;
    if (onProgress) {
        inferenceHeartbeatTimer = setInterval(() => {
            if (heartbeatPct < 64) {
                heartbeatPct = Math.min(64, heartbeatPct + 4);
                void onProgress(
                    heartbeatPct,
                    `Consultando evidencia técnica OEM para "${currentItem.title}"...`
                );
            }
        }, 4000);
    }

    try {
        // CAPA IA AD-HOC 1: Agente Investigador Forense (`PRIMARY` Pro Grounded)
        let aiText = '';
        let groundingSources: Array<{ uri: string; title: string }> = [];
        let groundingCandidate: any = null;

        try {
            const aiResponse = await ResilientAIClient.generate({
                module: 'opermaq',
                preferredTier: 'PRIMARY',
                systemInstruction: agent.systemPrompt,
                temperature: 0.1,
                maxOutputTokens: 8192,
                useGoogleSearch: true,
                requireGroundedEvidence: !hasSovereignOrPreverifiedEvidence,
                useUrlContext: false,
                thinkingLevel: 'low',
                prompt: huntPrompt,
            });
            aiText = aiResponse.text;
            groundingSources = aiResponse.groundingSources || [];
            groundingCandidate = aiResponse.rawCandidate || null;
        } catch (err) {
            if (hasSovereignOrPreverifiedEvidence) {
                const fallbackRes = await ResilientAIClient.generate({
                    module: 'opermaq',
                    preferredTier: 'SECONDARY',
                    systemInstruction: agent.systemPrompt,
                    temperature: 0.05,
                    maxOutputTokens: 8192,
                    useGoogleSearch: false,
                    requireGroundedEvidence: false,
                    thinkingLevel: 'low',
                    prompt: `${huntPrompt}\n\nNOTA: Fundamenta el desarrollo directamente en la EVIDENCIA OFICIAL DEL CORPUS LOCAL SOBERANO, ESPECIFICACIONES CONFIRMADAS DE PILARES PREVIOS y las FUENTES PRE-VERIFICADAS DEL CAPÍTULO.`,
                });
                aiText = fallbackRes.text;
            } else {
                throw err;
            }
        } finally {
            if (inferenceHeartbeatTimer) {
                clearInterval(inferenceHeartbeatTimer);
                inferenceHeartbeatTimer = null;
            }
        }

        // Compuerta Fail-Closed: nunca dar por completado un capítulo técnico sin respaldo local, pre-verificado ni web
        if (!hasSovereignOrPreverifiedEvidence && groundingSources.length === 0) {
            throw new Error(
                '[FAIL-CLOSED SIN EVIDENCIA] No se encontraron manuales en el corpus local ni fuentes web verificables para este ítem. Cargue el manual PDF OEM o reintente.'
            );
        }

        const rawMarkdownContent = aiText.trim();
        if (!rawMarkdownContent) {
            throw new Error('El agente de caza devolvió contenido vacío.');
        }

        // 1. Normalización determinista SI (`NeuroSymbolicVerifier`: psi, gal, lb-ft, lb, hp, gpm, mph, yd³, °F)
        const unitNormalizedMarkdown = verifyAndNormalizeTechnicalUnits(rawMarkdownContent).normalizedMarkdown;

        await onProgress?.(
            68,
            'Capturando figuras técnicas OEM (corpus PDF + fuentes web) y verificando simbología normativa...'
        );

        // 2. Inyección determinista de simbología verificada (Strict Explicit Mention Only, `SB-01..SB-03`)
        const inlineSymResult = await injectVerifiedInlineSymbology(unitNormalizedMarkdown, { pillarId });
        const symbolizedMarkdown = inlineSymResult.enrichedMarkdown;

        // 3. CAPTURA VISUAL REAL Y EVIDENCIA EN PARALELO:
        //    a) Clasificación de autoría de fuentes web
        //    b) Cosecha web/PDF (URL final real, srcset, og:image, mupdf + box_2d) + texto de evidencia de cada fuente
        //    OPT-F3.5: el juez VLM recibe un resumen por sección y `maxFigures` se adapta a las secciones con referencia visual.
        const sectionVisualSummary = buildSectionVisualSummary(symbolizedMarkdown, currentItem.title);
        const adaptiveMaxFigures = Math.min(6, Math.max(2, countSectionsWithExplicitVisualReference(symbolizedMarkdown)));
        const harvestSources = [
            ...groundingSources,
            ...preAssignedSources
                .filter((s) => /^https:\/\//i.test(s.url) && !groundingSources.some((gs) => gs.uri === s.url))
                .slice(0, Math.max(0, 5 - groundingSources.length))
                .map((s) => ({ uri: s.url, title: `${s.author}: ${s.description}` })),
        ];
        const emptyHarvestFallback = {
            figures: [] as ExtractedFigureRef[],
            discoveredPdfUrls: [] as string[],
            resolvedSourceUrls: {} as Record<string, string>,
            sourceTexts: [] as Array<{ url: string; text: string }>,
            report: null as MediaHarvestReport | null,
        };
        let harvestHeartbeatTimer: NodeJS.Timeout | null = null;
        let harvestPct = 68;
        if (onProgress) {
            harvestHeartbeatTimer = setInterval(() => {
                if (harvestPct < 84) {
                    harvestPct = Math.min(84, harvestPct + 4);
                    void onProgress(
                        harvestPct,
                        'Verificando diagramas técnicos OEM y trazabilidad de tablas...'
                    );
                }
            }, 3500);
        }
        let harvestTimeoutHandle: NodeJS.Timeout | null = null;
        const [rawClassifiedSources, harvestedMedia] = await Promise.all([
            classifySourcesByAuthorship(groundingSources, makeOficial, modelOficial),
            Promise.race([
                GroundedWebMediaHarvester.harvestFromGroundingSources({
                    groundingSources: harvestSources,
                    makeModel,
                    itemTitle: currentItem.title,
                    chapterExcerpt: sectionVisualSummary,
                    maxFigures: adaptiveMaxFigures,
                }),
                new Promise<typeof emptyHarvestFallback>((resolve) => {
                    harvestTimeoutHandle = setTimeout(() => resolve(emptyHarvestFallback), 28_000);
                }),
            ])
                .catch(() => emptyHarvestFallback)
                .finally(() => {
                    if (harvestTimeoutHandle) clearTimeout(harvestTimeoutHandle);
                    if (harvestHeartbeatTimer) clearInterval(harvestHeartbeatTimer);
                }),
        ]);

        // Actualizar URLs de redirección (`vertexaisearch.cloud.google.com`) con la URL final real resuelta cuando exista
        const resolvedUrlMap = harvestedMedia.resolvedSourceUrls || {};
        const classifiedSources: ItemizedSource[] = rawClassifiedSources.map((src) => ({
            ...src,
            url: src.url && resolvedUrlMap[src.url] ? resolvedUrlMap[src.url] : src.url,
        }));

        // 3c) OPT-F3.1 / OPT-F3.2 / MO-H02: trazabilidad por fila (groundingSupports + verificación numérica contra evidencia real + pilares previos)
        const evidenceDocs: EvidenceDocument[] = [
            ...localChunks.map((lc) => ({ url: `#corpus:${lc.chunkId}`, text: String(lc.markdown || '') })),
            ...(vaultDocsSnap && !vaultDocsSnap.empty
                ? vaultDocsSnap.docs.map((d) => {
                      const data = d.data();
                      return {
                          url: String(data.storage_url || data.download_url || `#vault-doc:${d.id}`),
                          text: String(data.extracted_text || data.markdown_es || data.summary || ''),
                      };
                  })
                : []),
            ...crossPillarContext.priorPillarEvidenceDocs,
            ...(harvestedMedia.sourceTexts || []),
        ];
        const groundingRowUrls = extractRowSourceUrlsFromGrounding(rawMarkdownContent, groundingCandidate);
        const traceAnalysis = analyzeTableTraceability(
            symbolizedMarkdown,
            evidenceDocs,
            groundingRowUrls,
            resolvedUrlMap,
            pillarId
        );

        // 3e) Figuras ya recortadas de los manuales PDF OEM ingeridos (`vault_corpus_chunks.figures`),
        //     tomadas solo de los fragmentos semánticamente pertinentes a este capítulo.
        const corpusFigures: ExtractedFigureRef[] = [];
        for (const lc of localChunks.slice(0, 3)) {
            if (lc.score < 0.42) continue;
            for (const fig of lc.figures || []) {
                if (corpusFigures.length >= 4) break;
                if (isDeprecatedSyntheticBlueprintFigure(fig)) continue;
                if (!corpusFigures.some((f) => f.sha256 === fig.sha256)) corpusFigures.push(fig);
            }
        }

        const allCandidateFigures: ExtractedFigureRef[] = [
            ...corpusFigures,
            ...harvestedMedia.figures,
        ].filter((f) => !isDeprecatedSyntheticBlueprintFigure(f));

        const allAvailableSourcesForItem: ItemizedSource[] = [
            ...classifiedSources,
            ...preAssignedSources,
            ...localDocSources,
        ];

        // 4. Reconciliación estricta por sección: figuras reales solo con cita explícita en la sección,
        //    marcadores `IMAGEN_PENDIENTE` solo ante referencia visual explícita y con URL de lista blanca.
        const markdownContent = reconcileSectionFiguresAndPendingMarkers(
            symbolizedMarkdown,
            allCandidateFigures,
            allAvailableSourcesForItem,
            currentItem.title
        );
        const mediaHarvestReport: MediaHarvestReport | null = harvestedMedia.report || null;

        // Simbología estrictamente por mención explícita en el texto actual (cero arrastre de refs heredados).
        const verifiedSymbologyRefs: string[] = [...inlineSymResult.detectedConceptIds];

        await onProgress?.(88, 'Ejecutando motor de compulsa transaccional y guardando resultados...');

        // Evaluar si existe contenido previo antes de entrar en la transacción para no ejecutar LLM dentro de `runTransaction`
        const preTxSnap = await assetRef.get();
        const preTxItem: PillarItem | undefined = preTxSnap
            .data()
            ?.knowledge_vault?.[pillarId]?.items?.find((i: PillarItem) => i.item_id === itemId);

        const hasExistingContentPreTx =
            Boolean(preTxItem && !preTxItem.is_human_locked && preTxItem.content && preTxItem.content.trim().length > 0) &&
            !forceOverwrite &&
            !humanCorrection;

        const { newlyAdded: previewNewFigures } = mergeDeduplicatedFigures(
            preTxItem?.figures || [],
            allCandidateFigures
        );

        const preComputedDiffs = hasExistingContentPreTx
            ? await detectContentDifferences(
                  pillarId,
                  itemId,
                  makeModel,
                  preTxItem!.title,
                  preTxItem!.content!,
                  symbolizedMarkdown,
                  classifiedSources[0] || preAssignedSources[0],
                  previewNewFigures
              )
            : [];

        const nowIso = new Date().toISOString();

        // 4. Transacción Atómica Firestore (`FT-H05`): impide que dos cazas 1 a 1 concurrentes se pisen el arreglo `items[]`
        const txOutcome = await db.runTransaction(async (tx) => {
            const freshSnap = await tx.get(assetRef);
            const freshData = freshSnap.data() || assetData;
            const freshVault = freshData.knowledge_vault || vault;
            const freshPillar = freshVault[pillarId];
            const freshItems: PillarItem[] = [...(freshPillar?.items || [])];
            const freshIdx = freshItems.findIndex((i) => i.item_id === itemId);
            if (freshIdx === -1) throw new Error(`Ítem ${itemId} desapareció durante la caza.`);

            const targetItem: PillarItem = { ...freshItems[freshIdx] };

            if (targetItem.is_human_locked) {
                const fp = computeFactFingerprint(markdownContent, targetItem.title);
                const advisories = [...(targetItem.locked_item_advisories || [])];
                if (!advisories.some((a) => computeFactFingerprint(a.proposed_value, targetItem.title) === fp)) {
                    advisories.push({
                        advisory_id: `adv_${Date.now()}`,
                        detected_at: nowIso,
                        source_label:
                            classifiedSources[0]?.description ||
                            preAssignedSources[0]?.description ||
                            'Caza Web Grounded',
                        source_url: classifiedSources[0]?.url || preAssignedSources[0]?.url,
                        summary: 'Hallazgo web detectado sobre capítulo bloqueado por autoridad humana.',
                        proposed_value: markdownContent.slice(0, 2400),
                        current_locked_snapshot: (targetItem.content || '').slice(0, 600),
                        acknowledged: false,
                    });
                    targetItem.locked_item_advisories = advisories;
                    freshItems[freshIdx] = targetItem;
                    tx.update(assetRef, {
                        [`knowledge_vault.${pillarId}.items`]: freshItems,
                        updatedAt: Date.now(),
                    });
                }
                return {
                    targetItem,
                    mergedSources: targetItem.item_sources || [],
                    mode: 'LOCKED_ADVISORY' as const,
                    newConflictsCount: 0,
                    addedFiguresCount: 0,
                };
            }

            const mergedSources = [...(targetItem.item_sources || [])];
            for (const src of [...classifiedSources, ...localDocSources, ...crossPillarContext.priorPillarOemSources]) {
                if (src?.url && !mergedSources.some((existing) => existing.url === src.url)) {
                    mergedSources.push(src);
                }
            }
            for (const lc of localChunks) {
                const corpusUrl = `#corpus:${lc.chunkId}`;
                if (!mergedSources.some((existing) => existing.url === corpusUrl)) {
                    mergedSources.push({
                        type: 'OEM',
                        author: makeOficial,
                        description: `${lc.sourceFilename} (${lc.title})`,
                        url: corpusUrl,
                    });
                }
            }

            const { merged: mergedFigures, newlyAdded: newFigures } = mergeDeduplicatedFigures(
                targetItem.figures || [],
                allCandidateFigures
            );

            const existingFingerprints = new Set<string>(targetItem.fact_fingerprints || []);
            const hasExistingContent =
                Boolean(targetItem.content && targetItem.content.trim().length > 0) &&
                !forceOverwrite &&
                !humanCorrection;

            let mode: 'INITIAL_HUNT' | 'CONFLICT_BUFFER' = 'INITIAL_HUNT';
            let newConflictsCount = 0;

            if (hasExistingContent) {
                mode = 'CONFLICT_BUFFER';
                const pendingFingerprints = new Set<string>(
                    (targetItem.pending_conflicts || []).map(
                        (p) => p.fact_fingerprint || computeFactFingerprint(p.valor_nuevo || '', targetItem.title)
                    )
                );
                const dedupedDiffs = preComputedDiffs.filter((d) => {
                    const fp = d.fact_fingerprint || computeFactFingerprint(d.valor_nuevo || '', targetItem.title);
                    if (existingFingerprints.has(fp) || pendingFingerprints.has(fp)) return false;
                    pendingFingerprints.add(fp);
                    return true;
                });

                newConflictsCount = dedupedDiffs.length;
                targetItem.content_status = 'COMPLETADO';
                targetItem.hunt_error = null;
                targetItem.hunted_at = nowIso;
                targetItem.item_sources = mergedSources;
                if (newFigures.length > 0 && targetItem.content) {
                    targetItem.content = reconcileSectionFiguresAndPendingMarkers(
                        targetItem.content,
                        newFigures,
                        mergedSources,
                        targetItem.title
                    );
                }
                targetItem.figures = filterFiguresReferencedInMarkdown(targetItem.content || '', mergedFigures);
                targetItem.symbology_refs = [...verifiedSymbologyRefs];
                targetItem.media_harvest_report = mediaHarvestReport
                    ? { ...mediaHarvestReport, corpus_figures: corpusFigures.length, table_chart: false, traceability: traceAnalysis.stats, evidence_docs: evidenceDocs.length, at: nowIso }
                    : { corpus_figures: corpusFigures.length, table_chart: false, traceability: traceAnalysis.stats, evidence_docs: evidenceDocs.length, at: nowIso };
                targetItem.pending_conflicts = [...(targetItem.pending_conflicts || []), ...dedupedDiffs];
            } else {
                const previousSnapshot = targetItem.content;
                existingFingerprints.add(computeFactFingerprint(markdownContent, targetItem.title));

                targetItem.content = applyTraceabilityAnnotations(markdownContent, traceAnalysis, mergedSources);
                targetItem.content_status = 'COMPLETADO';
                targetItem.hunt_error = null;
                targetItem.hunted_at = nowIso;
                targetItem.estado_aprobacion = 'GENERADO_IA';
                targetItem.item_sources = mergedSources;
                targetItem.figures = filterFiguresReferencedInMarkdown(targetItem.content || '', mergedFigures);
                targetItem.symbology_refs = [...verifiedSymbologyRefs];
                targetItem.media_harvest_report = mediaHarvestReport
                    ? { ...mediaHarvestReport, corpus_figures: corpusFigures.length, table_chart: false, traceability: traceAnalysis.stats, evidence_docs: evidenceDocs.length, at: nowIso }
                    : { corpus_figures: corpusFigures.length, table_chart: false, traceability: traceAnalysis.stats, evidence_docs: evidenceDocs.length, at: nowIso };
                targetItem.fact_fingerprints = Array.from(existingFingerprints);
                targetItem.historial_cambios = [
                    ...(targetItem.historial_cambios || []),
                    {
                        fecha: nowIso,
                        accion: 'GENERACION_INICIAL',
                        actor: 'AGENTE_CAZADOR_IA_V5',
                        detalle: humanCorrection
                            ? `Re-caza dirigida por instrucción humana: "${humanCorrection.slice(0, 120)}"`
                            : `Caza técnica multimodal v5.0 (${targetItem.figures.length} recurso(s) gráfico(s) citado(s) en CAS, ${verifiedSymbologyRefs.length} símbolo(s) ad-hoc).`,
                        ...(previousSnapshot ? { snapshot_anterior: previousSnapshot } : {}),
                    },
                ];
            }

            freshItems[freshIdx] = targetItem;

            const pillarSources = [...(freshPillar.classified_sources_itemized || [])];
            for (const src of classifiedSources) {
                if (src?.url && !pillarSources.some((ps) => ps.url === src.url)) {
                    pillarSources.push(src);
                }
            }

            tx.update(assetRef, {
                [`knowledge_vault.${pillarId}.items`]: freshItems,
                [`knowledge_vault.${pillarId}.classified_sources_itemized`]: pillarSources,
                [`knowledge_vault.${pillarId}.updated_at`]: nowIso,
                updatedAt: Date.now(),
            });

            return {
                targetItem,
                mergedSources,
                mode,
                newConflictsCount,
                addedFiguresCount: newFigures.length,
            };
        });

        // 5. Actualizar paquete ad-hoc de simbología del activo con los nuevos símbolos detectados/creados
        await buildAndPersistAssetSymbologyPack(globalAssetId).catch(() => {});

        // 6. Trazabilidad Criptográfica Inmutable en `AuditLedger`
        void AuditLedger.record({
            tenantId: 'GLOBAL_OEM',
            actorUid: 'SYSTEM_HUNTER_V5',
            actorEmail: 'system@minreport.com',
            module: 'opermaq',
            action: txOutcome.mode === 'CONFLICT_BUFFER' ? 'VAULT_ITEM_REHUNTED_DIFF' : 'VAULT_ITEM_HUNTED',
            targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}/${itemId}`,
            details: {
                makeModel,
                pillarId,
                itemId,
                itemTitle: txOutcome.targetItem.title,
                mode: txOutcome.mode,
                sourcesCount: txOutcome.mergedSources.length,
                symbologyRefsCount: (txOutcome.targetItem.symbology_refs || []).length,
                explicitSymbolsDetectedCount: inlineSymResult.detectedConceptIds.length,
                tableChartGenerated: false,
                traceability: traceAnalysis.stats,
                corpusFiguresCount: corpusFigures.length,
                webFiguresCount: harvestedMedia.figures.length,
                mediaHarvestRejections: mediaHarvestReport?.rejections || {},
                harvestedFiguresCount: txOutcome.addedFiguresCount,
                newConflictsCount: txOutcome.newConflictsCount,
            },
        }).catch(() => undefined);

        await onProgress?.(100, 'Caza técnica multimodal finalizada exitosamente.');

        return {
            success: true,
            item: txOutcome.targetItem,
            content: txOutcome.targetItem.content,
            item_sources: txOutcome.mergedSources,
            hunted_at: nowIso,
            mode: txOutcome.mode,
            newConflictsCount: txOutcome.newConflictsCount,
            harvestedFiguresCount: txOutcome.addedFiguresCount,
        };
    } catch (err: any) {
        await db
            .runTransaction(async (tx) => {
                const s = await tx.get(assetRef);
                if (!s.exists) return;
                const d = s.data() || {};
                const items: PillarItem[] = [...(d?.knowledge_vault?.[pillarId]?.items || [])];
                const idx = items.findIndex((i) => i.item_id === itemId);
                if (idx !== -1) {
                    items[idx] = {
                        ...items[idx],
                        content_status: items[idx].content ? 'COMPLETADO' : 'ERROR',
                        hunt_error: err?.message || 'Error en caza técnica.',
                    };
                    tx.update(assetRef, {
                        [`knowledge_vault.${pillarId}.items`]: items,
                    });
                }
            })
            .catch(() => {});
        throw err;
    }
}
