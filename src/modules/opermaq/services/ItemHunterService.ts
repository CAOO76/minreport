import { db } from '../../../config/firebase';
import { ResilientAIClient, Type } from '../../../core/resilient-ai-client';
import {
    type ExtractedFigureRef,
    ItemizedSource,
    PillarId,
    PillarItem,
    ProposedUpdate,
} from '../types/vault.types';
import { buildAndPersistAssetSymbologyPack } from './EquipmentSymbologyPackBuilder';
import { GroundedWebMediaHarvester } from './GroundedWebMediaHarvester';
import {
    computeFactFingerprint,
    verifyAndNormalizeTechnicalUnits,
    verifyAndResolveSymbologyRefs,
} from './NeuroSymbolicVerifier';
import { createEmptyKnowledgeVault, PILLAR_AGENTS } from './pillarAgents';
import { SegmentedDocumentProcessorService } from './SegmentedDocumentProcessorService';
import { classifySourcesByAuthorship } from './SourceClassifierService';
import { ensureUniversalSymbologySeeded } from './UniversalSymbologySeedService';
import { mergeDeduplicatedFigures } from './VaultReconciliationService';

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

    // 1. Consulta Corpus-First en fragmentos locales `vault_corpus_chunks` (`768d`)
    const localChunks = await SegmentedDocumentProcessorService.searchLocalAssetCorpus(
        globalAssetId,
        `${currentItem.title} ${currentItem.rationale || ''}`,
        4
    );
    const localCorpusContext =
        localChunks.length > 0
            ? `\nEVIDENCIA OFICIAL YA INGERIDA EN CORPUS LOCAL OEM (PRIORIDAD MÁXIMA DE VERACIDAD):\n${localChunks
                  .map(
                      (c) =>
                          `--- [${c.sourceFilename} Págs. ${c.pages.join(',') || 'N/A'} | ${c.title}] ---\n${c.markdown.slice(
                              0,
                              2400
                          )}`
                  )
                  .join('\n\n')}\n`
            : '';

    const existingConceptIds = new Set<string>();
    let symbologyCatalogBlock = '';
    try {
        const symSnap = await db.collection('master_symbology_vault').limit(120).get();
        if (!symSnap.empty) {
            const rows = symSnap.docs.map((d) => {
                existingConceptIds.add(d.id);
                const s = d.data();
                return `- concept_id: "${d.id}" | ISO: "${s.iso_reference || s.iso_code || 'N/A'}" | Nombre: "${
                    s.technical_name_es || s.name_es || d.id
                }"`;
            });
            symbologyCatalogBlock = `\nCATÁLOGO DE SÍMBOLOS VECTORIALES DISPONIBLES (ISO 7010 / ISO 7000 / ISO 2575 / IEC 60417 / GHS):\n${rows.join(
                '\n'
            )}`;
        }
    } catch {
        // Continuar si colección vacía
    }

    const profileSummary = [
        `- Activo: ${makeModel} (${assetData.tipo_equipo || ''})`,
        `- Categoría: ${assetData.categoria_equipo || ''}`,
        `- Ambientes: ${(assetData.ambiente_operativo || []).join(', ')}`,
        `- Especificaciones Base: ${(assetData.caracteristicas_principales || []).join(' | ')}`,
    ].join('\n');

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
${feedbackBlock}
${symbologyCatalogBlock}

INSTRUCCIÓN DE REDACCIÓN TÉCNICA FUNDAMENTADA (MARKDOWN PURO):
Usa Google Search y el corpus local OEM para consultar manuales oficiales, tablas de servicio y normativas reales aplicables a "${makeModel}".
Redacta directamente el desarrollo técnico completo en Markdown puro con tablas estructuradas, valores verificados en unidades métricas SI y procedimientos técnicos precisos (sin HTML y sin envolver en JSON). Si un valor específico no aparece en la documentación consultada, indícalo como [Información técnica no declarada en ficha].`;

    await onProgress?.(45, `Ejecutando caza profunda multimodal OEM para "${currentItem.title}"...`);

    try {
        const aiResponse = await ResilientAIClient.generate({
            module: 'opermaq',
            preferredTier: 'PRIMARY',
            systemInstruction: agent.systemPrompt,
            temperature: 0.1,
            maxOutputTokens: 8192,
            useGoogleSearch: true,
            requireGroundedEvidence: localChunks.length === 0,
            useUrlContext: true,
            thinkingLevel: 'medium',
            prompt: huntPrompt,
        });

        // Compuerta Fail-Closed: nunca dar por completado un capítulo técnico sin respaldo en PDF local ni web
        if (localChunks.length === 0 && aiResponse.groundingSources.length === 0) {
            throw new Error(
                '[FAIL-CLOSED SIN EVIDENCIA] No se encontraron manuales en el corpus local ni fuentes web verificables para este ítem. Cargue el manual PDF OEM o reintente.'
            );
        }

        const rawMarkdownContent = aiResponse.text.trim();
        let rawSymbols: Array<{ concept_id?: string; iso_code?: string; label?: string; context_usage?: string }> = [];

        if (rawMarkdownContent) {
            try {
                const { data: symData } = await ResilientAIClient.generateStructured<{
                    proposed_symbols: Array<{
                        concept_id: string;
                        iso_code: string;
                        label: string;
                        context_usage: string;
                    }>;
                }>({
                    module: 'opermaq',
                    preferredTier: 'ANCHOR_HA',
                    temperature: 0,
                    maxOutputTokens: 2048,
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            proposed_symbols: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        concept_id: { type: Type.STRING },
                                        iso_code: { type: Type.STRING },
                                        label: { type: Type.STRING },
                                        context_usage: { type: Type.STRING },
                                    },
                                    required: ['concept_id', 'iso_code', 'label', 'context_usage'],
                                },
                            },
                        },
                        required: ['proposed_symbols'],
                    },
                    prompt: `Identifica los símbolos normativos ISO 7010 / ISO 7000 / ISO 2575 / IEC 60417 / GHS pertinentes al siguiente capítulo técnico de "${makeModel}":\n${symbologyCatalogBlock}\n\nCAPÍTULO:\n"""\n${rawMarkdownContent.slice(0, 8000)}\n"""`,
                });
                rawSymbols = Array.isArray(symData.proposed_symbols) ? symData.proposed_symbols : [];
            } catch {
                rawSymbols = [];
            }
        }

        if (!rawMarkdownContent) {
            throw new Error('El agente de caza devolvió contenido vacío.');
        }

        // Normalización determinista SI (`NeuroSymbolicVerifier`)
        const markdownContent = verifyAndNormalizeTechnicalUnits(rawMarkdownContent).normalizedMarkdown;

        await onProgress?.(68, 'Clasificando fuentes, validando simbología vectorial y cosechando apoyo visual...');

        const [classifiedSources, harvestedMedia] = await Promise.all([
            classifySourcesByAuthorship(aiResponse.groundingSources, makeOficial, modelOficial),
            GroundedWebMediaHarvester.harvestFromGroundingSources({
                groundingSources: aiResponse.groundingSources,
                makeModel,
                itemTitle: currentItem.title,
                maxFigures: 2,
            }).catch(() => ({ figures: [] as ExtractedFigureRef[], discoveredPdfUrls: [] as string[] })),
        ]);

        // Resolver símbolos contra el catálogo universal semillado (sin tope de 6: hasta 40 símbolos por capítulo)
        const preResolvedIds = await verifyAndResolveSymbologyRefs(
            rawSymbols.slice(0, 40).map((s) => ({
                concept_id: s.concept_id,
                iso_reference: s.iso_code,
            }))
        );

        const verifiedSymbologyRefs: string[] = Array.from(
            new Set([...(currentItem.symbology_refs || []), ...preResolvedIds])
        );

        for (const sym of rawSymbols.slice(0, 40)) {
            const cid = String(sym.concept_id || '')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, '_')
                .replace(/^_+|_+$/g, '');
            if (!cid || verifiedSymbologyRefs.includes(cid)) continue;

            if (existingConceptIds.has(cid)) {
                verifiedSymbologyRefs.push(cid);
                continue;
            }

            if (sym.iso_code) {
                const wikiCheck = await validateIsoReferenceExists(sym.iso_code);
                if (wikiCheck.exists) {
                    const isoRef = `ISO 7000 - Ref-No ${sym.iso_code.replace(/[^0-9A-Za-z-]/g, '')}`;
                    await db
                        .collection('master_symbology_vault')
                        .doc(cid)
                        .set(
                            {
                                concept_id: cid,
                                standard_family: 'ISO_7000',
                                iso_reference: isoRef,
                                technical_name_es: sym.label || cid,
                                technical_name_en: cid.replace(/_/g, ' '),
                                description_es: sym.context_usage || `Indicador técnico en ${makeModel}`,
                                description_en: sym.context_usage || '',
                                action_operator_es: sym.context_usage || '',
                                critical_color: 'NONE',
                                standard_icon_status: 'pendiente_busqueda',
                                brands_variants: {},
                                referenced_by_items: [`${globalAssetId}:${pillarId}:${itemId}`],
                                created_at: new Date().toISOString(),
                                created_by: 'ITEM_HUNTER_IA_VERIFIED',
                            },
                            { merge: true }
                        );
                    existingConceptIds.add(cid);
                    verifiedSymbologyRefs.push(cid);
                }
            }
        }

        await onProgress?.(88, 'Ejecutando motor de compulsa no destructivo y guardando resultados...');

        const freshSnap = await assetRef.get();
        const freshData = freshSnap.data() || assetData;
        const freshVault = freshData.knowledge_vault || vault;
        const freshPillar = freshVault[pillarId];
        const freshItems: PillarItem[] = [...(freshPillar?.items || [])];
        const freshIdx = freshItems.findIndex((i) => i.item_id === itemId);
        if (freshIdx === -1) throw new Error(`Ítem ${itemId} desapareció durante la caza.`);

        const targetItem = { ...freshItems[freshIdx] };
        const nowIso = new Date().toISOString();

        // Si el ítem se bloqueó mientras corría la caza o venía en modo `recordAdvisoryIfLocked`
        if (targetItem.is_human_locked) {
            const fp = computeFactFingerprint(markdownContent, targetItem.title);
            const advisories = [...(targetItem.locked_item_advisories || [])];
            if (!advisories.some((a) => computeFactFingerprint(a.proposed_value, targetItem.title) === fp)) {
                advisories.push({
                    advisory_id: `adv_${Date.now()}`,
                    detected_at: nowIso,
                    source_label: classifiedSources[0]?.description || 'Caza Web Grounded',
                    source_url: classifiedSources[0]?.url,
                    summary: 'Hallazgo web detectado sobre capítulo bloqueado por autoridad humana.',
                    proposed_value: markdownContent.slice(0, 2400),
                    current_locked_snapshot: (targetItem.content || '').slice(0, 600),
                    acknowledged: false,
                });
                targetItem.locked_item_advisories = advisories;
                freshItems[freshIdx] = targetItem;
                await assetRef.update({
                    [`knowledge_vault.${pillarId}.items`]: freshItems,
                    updatedAt: Date.now(),
                });
            }
            return {
                success: true,
                item: targetItem,
                content: targetItem.content,
                item_sources: targetItem.item_sources || [],
                hunted_at: nowIso,
                mode: 'LOCKED_ADVISORY',
                newConflictsCount: 0,
                harvestedFiguresCount: 0,
            };
        }

        const hasExistingContent =
            Boolean(targetItem.content && targetItem.content.trim().length > 0) &&
            !forceOverwrite &&
            !humanCorrection;

        let mode: 'INITIAL_HUNT' | 'CONFLICT_BUFFER' = 'INITIAL_HUNT';
        let newConflictsCount = 0;

        const mergedSources = [...(targetItem.item_sources || [])];
        for (const src of classifiedSources) {
            if (!mergedSources.some((existing) => existing.url === src.url)) {
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
            harvestedMedia.figures
        );

        const existingFingerprints = new Set<string>(targetItem.fact_fingerprints || []);

        if (hasExistingContent) {
            mode = 'CONFLICT_BUFFER';
            const rawDiffs = await detectContentDifferences(
                pillarId,
                itemId,
                makeModel,
                targetItem.title,
                targetItem.content!,
                markdownContent,
                classifiedSources[0],
                newFigures
            );

            const pendingFingerprints = new Set<string>(
                (targetItem.pending_conflicts || []).map(
                    (p) => p.fact_fingerprint || computeFactFingerprint(p.valor_nuevo || '', targetItem.title)
                )
            );
            const dedupedDiffs = rawDiffs.filter((d) => {
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
            targetItem.figures = mergedFigures;
            targetItem.symbology_refs = verifiedSymbologyRefs;
            targetItem.pending_conflicts = [...(targetItem.pending_conflicts || []), ...dedupedDiffs];
        } else {
            const previousSnapshot = targetItem.content;
            let finalMarkdown = markdownContent;
            for (const fig of mergedFigures) {
                if (!finalMarkdown.includes(fig.storage_url)) {
                    finalMarkdown += `\n\n![${fig.title_es}](${fig.storage_url})\n*Figura técnica: ${fig.title_es}${
                        fig.caption_es ? ` — ${fig.caption_es}` : ''
                    }*`;
                }
            }

            existingFingerprints.add(computeFactFingerprint(markdownContent, targetItem.title));

            targetItem.content = finalMarkdown;
            targetItem.content_status = 'COMPLETADO';
            targetItem.hunt_error = null;
            targetItem.hunted_at = nowIso;
            targetItem.estado_aprobacion = 'GENERADO_IA';
            targetItem.item_sources = mergedSources;
            targetItem.figures = mergedFigures;
            targetItem.symbology_refs = verifiedSymbologyRefs;
            targetItem.fact_fingerprints = Array.from(existingFingerprints);
            targetItem.historial_cambios = [
                ...(targetItem.historial_cambios || []),
                {
                    fecha: nowIso,
                    accion: 'GENERACION_INICIAL',
                    actor: 'AGENTE_CAZADOR_IA_V4',
                    detalle: humanCorrection
                        ? `Re-caza dirigida por instrucción humana: "${humanCorrection.slice(0, 120)}"`
                        : `Caza técnica multimodal (${mergedFigures.length} figura(s) CAS, ${verifiedSymbologyRefs.length} símbolo(s)).`,
                    ...(previousSnapshot ? { snapshot_anterior: previousSnapshot } : {}),
                },
            ];
        }

        freshItems[freshIdx] = targetItem;

        const pillarSources = [...(freshPillar.classified_sources_itemized || [])];
        for (const src of classifiedSources) {
            if (!pillarSources.some((ps) => ps.url === src.url)) {
                pillarSources.push(src);
            }
        }

        await assetRef.update({
            [`knowledge_vault.${pillarId}.items`]: freshItems,
            [`knowledge_vault.${pillarId}.classified_sources_itemized`]: pillarSources,
            [`knowledge_vault.${pillarId}.updated_at`]: nowIso,
            updatedAt: Date.now(),
        });

        // Actualizar paquete ad-hoc de simbología con los nuevos símbolos detectados
        await buildAndPersistAssetSymbologyPack(globalAssetId).catch(() => {});

        await onProgress?.(100, 'Caza técnica multimodal finalizada exitosamente.');

        return {
            success: true,
            item: targetItem,
            content: targetItem.content,
            item_sources: mergedSources,
            hunted_at: nowIso,
            mode,
            newConflictsCount,
            harvestedFiguresCount: newFigures.length,
        };
    } catch (err: any) {
        await assetRef
            .get()
            .then(async (s) => {
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
                    await assetRef.update({
                        [`knowledge_vault.${pillarId}.items`]: items,
                    });
                }
            })
            .catch(() => {});
        throw err;
    }
}
