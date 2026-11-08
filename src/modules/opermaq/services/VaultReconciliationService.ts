import { randomUUID } from 'crypto';
import { db } from '../../../config/firebase';
import { MediaDigestorServer } from '../../../core/media/MediaDigestorServer';
import { ResilientAIClient } from '../../../core/resilient-ai-client';
import type {
    ExtractedFigureRef,
    ItemizedSource,
    LockedItemAdvisory,
    PillarId,
    PillarItem,
    ProposedUpdate,
} from '../types/vault.types';
import { createEmptyKnowledgeVault } from './pillarAgents';
import {
    buildDeterministicPendingDescription,
    buildPendingMarkerLine,
    buildSourceWhitelist,
    cleanHeadingLabel,
    extractDiagramCallouts,
    FIGURE_SECTION_MATCH_THRESHOLD,
    hasExplicitVisualReference,
    injectExplicitFigureCitationInSection,
    isFigureExplicitlyCitedInSection,
    isPortCode,
    isTableChartFigure,
    normalizeBrokenPendingMarkersInMarkdown,
    parsePendingMarker,
    PENDING_MARKER_GLOBAL_REGEX,
    pickBestSource,
    resolveWhitelistedSource,
    sanitizeMarkdownFiguresAndBrokenMarkers,
    sanitizeMarkdownLabel,
    scoreFigureForContext,
    splitMarkdownSections,
} from './PendingFigureMarkers';
import {
    computeFactFingerprint,
    verifyAndNormalizeTechnicalUnits,
    verifyAndResolveSymbologyRefs,
} from './NeuroSymbolicVerifier';
import { normalizeComparableTitle, tokenJaccardSimilarity } from './TextSimilarityUtils';

/**
 * VAULT RECONCILIATION SERVICE v4.0 — Reconciliador Unificado de los 5 Pilares OPERMAQ
 *
 * Única puerta de escritura evolutiva hacia `global_asset_catalog/{id}.knowledge_vault.{pillarId}.items[]`,
 * compartida tanto por:
 * - Ingesta de manuales PDF extensos, catálogos, ETT y láminas (`SegmentedDocumentProcessorService`)
 * - Caza web profunda bajo demanda (`ItemHunterService`)
 *
 * Reglas de Gobernanza Inviolables:
 * 1. Deduplicación Estricta ("Se caza una sola vez"):
 *    - Huella determinista `fact_fingerprint` + similitud semántica `768d` (`cosine >= 0.92`)
 *    - Deduplicación visual de figuras por `sha256` exacto y distancia Hamming `pHash <= 4`.
 * 2. Autoridad Humana Absoluta (`is_human_locked === true`):
 *    - Jamás altera `content` ni `pending_conflicts`; registra hallazgos nuevos en `locked_item_advisories[]`.
 * 3. Poblado Inicial vs. Fusión Evolutiva HITL:
 *    - Si el ítem está `PENDIENTE` (vacío), consolida directamente `content`, `figures`, `symbology_refs` e `item_sources`.
 *    - Si el ítem ya posee contenido, encola deltas verificados (`NUEVO` o `CONFLICTO` `[Actual] ➔ [Sugerido]`)
 *      en `pending_conflicts[]` con sus figuras adjuntas para aprobación 1 a 1.
 */

export interface StructuredDeltaInput {
    zona: string;
    componente: string;
    valor_actual?: string;
    valor_nuevo: string;
    condicion_esperada?: string;
    tipo_input?: 'NUMERIC' | 'BOOLEAN' | 'WARNING' | 'text_block';
    is_oem?: boolean;
    synthesis?: string;
    estado_fusion?: 'NUEVO' | 'CONFLICTO';
}

export interface ReconcilePillarContributionInput {
    globalAssetId: string;
    pillarId: PillarId;
    targetItemId?: string;
    chapterTitle: string;
    section?: string;
    rationale?: string;
    priority?: 'CRÍTICO' | 'IMPORTANTE' | 'COMPLEMENTARIO';
    markdownContent: string;
    structuredDeltas?: StructuredDeltaInput[];
    figures?: ExtractedFigureRef[];
    symbologyCandidates?: Array<string | { concept_id?: string; iso_reference?: string }>;
    sources?: ItemizedSource[];
    sourceLabel: string;
    sourceUrl?: string;
    isOemSource?: boolean;
    actorEmail?: string;
}

export interface ReconcilePillarResult {
    itemId: string;
    outcome:
    | 'POPULATED_INITIAL'
    | 'QUEUED_DELTAS'
    | 'ATTACHED_FIGURES_ONLY'
    | 'LOCKED_ADVISORY_RECORDED'
    | 'SKIPPED_DUPLICATE';
    addedProposals: number;
    addedFigures: number;
    addedAdvisories: number;
    skippedDuplicates: number;
}

function slugifyChapterId(pillarId: PillarId, title: string, order: number): string {
    const clean = title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    return `${pillarId}_${clean || 'capitulo'}_${order}`;
}

function stripUndefinedDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((v) => stripUndefinedDeep(v)) as unknown as T;
    }
    if (value !== null && typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value as Record<string, any>)) {
            if (v !== undefined) {
                out[k] = stripUndefinedDeep(v);
            }
        }
        return out as T;
    }
    return value;
}

function isObsoleteSyntheticBlueprint(fig?: ExtractedFigureRef | null): boolean {
    if (!fig) return true;
    const fid = String(fig.figure_id || '');
    if (fid.startsWith('bp_') || fid.startsWith('fig_tbl_')) return true;
    if (isTableChartFigure(fig)) return true;
    const combined = `${fig.title_es || ''} ${fig.caption_es || ''}`;
    if (
        /Plano Dimensional Acotado|Plano Dimensional y Par[aá]metros|Mapa de Inspecci[oó]n 360|Matriz Cronol[oó]gica PM|OpermaqSvgBlueprintEngine|Comparativa\s+de\s+magnitudes|Comparativa\s+Param[eé]trica\s+SI/i.test(
            combined
        )
    ) {
        return true;
    }
    if (fig.is_parametric_svg && fig.figure_type === 'DIAGRAMA_ACOTADO') {
        return true;
    }
    return false;
}

/**
 * Fusiona nuevas figuras en un arreglo existente evitando duplicados exactos (`sha256`), visuales (`pHash <= 4`)
 * y purgando cualquier silueta sintética obsoleta (`bp_*`, `DIMENSION_SPEC_SHEET`, `fig_tbl_*`).
 */
export function mergeDeduplicatedFigures(
    existing: ExtractedFigureRef[] = [],
    incoming: ExtractedFigureRef[] = []
): { merged: ExtractedFigureRef[]; newlyAdded: ExtractedFigureRef[] } {
    const merged = existing.filter((f) => !isObsoleteSyntheticBlueprint(f));
    const newlyAdded: ExtractedFigureRef[] = [];

    for (const fig of incoming) {
        if (!fig?.storage_url || !fig?.sha256) continue;
        if (isObsoleteSyntheticBlueprint(fig)) continue;
        const isDuplicate = merged.some((ex) => {
            if (ex.sha256 === fig.sha256) return true;
            if (ex.storage_url === fig.storage_url) return true;
            if (ex.phash_hex && fig.phash_hex) {
                return MediaDigestorServer.hammingDistanceHex64(ex.phash_hex, fig.phash_hex) <= 4;
            }
            return false;
        });

        if (!isDuplicate) {
            merged.push(fig);
            newlyAdded.push(fig);
        }
    }

    return { merged, newlyAdded };
}

/**
 * Conserva en el arreglo de figuras del ítem únicamente aquellas cuya URL fue efectivamente citada e insertada
 * en el contenido Markdown (o cargadas manualmente por el usuario `fig_manual_`).
 */
export function filterFiguresReferencedInMarkdown(
    markdown: string,
    figures: ExtractedFigureRef[] = []
): ExtractedFigureRef[] {
    const contentStr = String(markdown || '');
    return (figures || []).filter((fig) => {
        if (!fig?.storage_url || isObsoleteSyntheticBlueprint(fig)) return false;
        if (String(fig.figure_id || '').startsWith('fig_manual_')) return true;
        return contentStr.includes(fig.storage_url);
    });
}

export function formatFigureMarkdownBlock(fig: ExtractedFigureRef, figureNumber?: number): string {
    const pageBadge = fig.source_page ? ` (Pág. ${fig.source_page} OEM)` : '';
    const safeTitle = sanitizeMarkdownLabel(fig.title_es || 'Figura técnica', 160);
    const safeCaption = fig.caption_es ? sanitizeMarkdownLabel(fig.caption_es, 220) : '';
    const labelPrefix = typeof figureNumber === 'number' && figureNumber > 0 ? `Figura ${figureNumber}: ` : 'Figura técnica: ';
    const calloutLines =
        Array.isArray(fig.callouts) && fig.callouts.length > 0
            ? '\n' +
            fig.callouts
                .map(
                    (c) =>
                        `  - **[${c.callout}]** ${c.component_es}${c.function_or_spec ? `: ${c.function_or_spec}` : ''
                        }`
                )
                .join('\n')
            : '';

    return `![${labelPrefix}${safeTitle}](${fig.storage_url})\n*${labelPrefix}${safeTitle}${pageBadge}${safeCaption ? ` — ${safeCaption}` : ''
        }*${calloutLines}`;
}

export interface ReconcileFiguresOptions {
    /** Permite crear marcadores nuevos en secciones con referencia visual explícita sin figura (default `true`). */
    allowNewMarkers?: boolean;
    /** Conserva tal cual los marcadores existentes que no sean reemplazados por una figura (sin lista blanca disponible). */
    preserveExistingMarkers?: boolean;
}

function pickBestExplicitlyCitedFigure(
    candidates: ExtractedFigureRef[],
    consumed: Set<string>,
    sectionPlainText: string,
    headingLabel: string,
    markerDescription: string = ''
): ExtractedFigureRef | null {
    let best: ExtractedFigureRef | null = null;
    let bestScore = 0;
    const fullContext = `${headingLabel}\n${sectionPlainText}\n${markerDescription}`;
    for (const fig of candidates) {
        if (consumed.has(fig.storage_url)) continue;
        if (!isFigureExplicitlyCitedInSection(fig, `${headingLabel}\n${sectionPlainText}`, markerDescription)) {
            continue;
        }
        const score = scoreFigureForContext(fig, fullContext);
        if (score > bestScore) {
            bestScore = score;
            best = fig;
        }
    }
    return best && bestScore >= FIGURE_SECTION_MATCH_THRESHOLD ? best : null;
}

function sectionHasRealImage(sectionText: string): boolean {
    return /!\[(?!IMAGEN[_\s-]PENDIENTE)[^\]]*\]\([^)]+\)/i.test(sectionText);
}

/**
 * Reconciliación estricta por sección de figuras reales y marcadores de imagen pendiente:
 * 1. Normaliza marcadores rotos/truncados (`![IMAGEN_PENDIENTE: ...`) y elimina figuras huérfanas o gráficos automáticos.
 * 2. Una figura real solo se inserta si la sección tiene referencia visual explícita Y la figura supera `isFigureExplicitlyCitedInSection` (≥ 0.45 + match de sustantivos del título en el texto), inyectando la cita explícita `(ver Figura N: <título>)` en el párrafo.
 * 3. Si la sección tiene referencia visual explícita pero ninguna figura capturada coincide, emite el marcador canónico `![IMAGEN_PENDIENTE: ...](url_fuente)` para carga in-situ con `"ACTUALIZAR"`.
 * 4. Cero inyección de figuras sobrantes (`trailing`) y cero gráficos automáticos de tablas (`Comparativa de magnitudes`).
 */
export function reconcileSectionFiguresAndPendingMarkers(
    markdown: string,
    figures: ExtractedFigureRef[] = [],
    sources: ItemizedSource[] = [],
    itemTitle: string = '',
    options: ReconcileFiguresOptions = {}
): string {
    if (!markdown || !markdown.trim()) return markdown;
    const allowNewMarkers = options.allowNewMarkers !== false;
    const whitelist = buildSourceWhitelist(sources);

    const sanitizedInput = sanitizeMarkdownFiguresAndBrokenMarkers(
        normalizeBrokenPendingMarkersInMarkdown(markdown, itemTitle, sources),
        itemTitle,
        sources,
        figures
    );

    const validFigures = (figures || []).filter(
        (f) => f?.storage_url && !isObsoleteSyntheticBlueprint(f) && !sanitizedInput.includes(f.storage_url)
    );
    const visualFigures = validFigures.filter((f) => !isTableChartFigure(f));
    const consumed = new Set<string>();

    const sections = splitMarkdownSections(sanitizedInput);
    const outSections: string[][] = [];
    let nextFigureNumber = 1;

    for (const sec of sections) {
        const rawSectionText = sec.lines.join('\n');
        const plainText = rawSectionText.replace(PENDING_MARKER_GLOBAL_REGEX, ' ');
        const literalCallouts = extractDiagramCallouts(plainText);
        const explicit = hasExplicitVisualReference(plainText);
        const headingLabel = cleanHeadingLabel(sec.heading, itemTitle || 'Sección técnica');
        let hasImage = sectionHasRealImage(rawSectionText);
        let hadMarker = false;
        let newLines: string[] = [];

        for (const line of sec.lines) {
            const parsed = parsePendingMarker(line);
            if (!parsed) {
                newLines.push(line);
                continue;
            }
            hadMarker = true;

            const descCodes = parsed.description
                .split(/[\s,;:()/]+/)
                .map((t) => t.replace(/[`'"*]/g, ''))
                .filter((t) => isPortCode(t));
            const anchoredInText = explicit || descCodes.some((c) => plainText.includes(c));
            if (!anchoredInText && !options.preserveExistingMarkers) continue;

            const match = pickBestExplicitlyCitedFigure(
                visualFigures,
                consumed,
                plainText,
                headingLabel,
                parsed.description
            );
            if (match) {
                consumed.add(match.storage_url);
                const figNum = nextFigureNumber++;
                newLines = injectExplicitFigureCitationInSection(newLines, figNum, match.title_es);
                newLines.push(formatFigureMarkdownBlock(match, figNum));
                hasImage = true;
                continue;
            }
            if (hasImage) continue;

            const description = buildDeterministicPendingDescription(headingLabel, literalCallouts, parsed.description);
            const source = resolveWhitelistedSource(
                parsed.url,
                whitelist,
                `${headingLabel} ${literalCallouts.join(' ')} ${parsed.description} ${parsed.title}`
            );
            newLines.push(buildPendingMarkerLine(description, source));
        }

        if (!hadMarker && !hasImage && explicit) {
            const match = pickBestExplicitlyCitedFigure(visualFigures, consumed, plainText, headingLabel);
            if (match) {
                consumed.add(match.storage_url);
                const figNum = nextFigureNumber++;
                newLines = injectExplicitFigureCitationInSection(newLines, figNum, match.title_es);
                newLines.push('', formatFigureMarkdownBlock(match, figNum), '');
            } else if (allowNewMarkers) {
                const description = buildDeterministicPendingDescription(headingLabel, literalCallouts);
                const source = pickBestSource(`${headingLabel} ${literalCallouts.join(' ')}`, whitelist);
                newLines.push('', buildPendingMarkerLine(description, source), '');
            }
        }

        outSections.push(newLines);
    }

    const result = outSections.map((lines) => lines.join('\n')).join('\n');
    return result.replace(/\n{4,}/g, '\n\n\n');
}

/**
 * Anclaje directo de figuras (compatibilidad con reconciliación de PDF/ETT): delega en la reconciliación por sección
 * sin crear marcadores nuevos.
 */
export function anchorFiguresIntoMarkdown(markdown: string, figures: ExtractedFigureRef[]): string {
    if (!figures || figures.length === 0) return markdown;
    return reconcileSectionFiguresAndPendingMarkers(markdown, figures, [], '', {
        allowNewMarkers: false,
        preserveExistingMarkers: true,
    });
}

export class VaultReconciliationService {
    /**
     * Reconcilia un bloque técnico (proveniente de PDF/ETT o de Caza Web) dentro de la Bóveda de 5 Pilares.
     */
    public static async reconcileContribution(
        input: ReconcilePillarContributionInput
    ): Promise<ReconcilePillarResult> {
        const assetRef = db.collection('global_asset_catalog').doc(input.globalAssetId);
        const snap = await assetRef.get();
        if (!snap.exists) {
            throw new Error(`Activo ${input.globalAssetId} no existe en global_asset_catalog.`);
        }

        const assetData = snap.data()!;
        const make = String(assetData.make_oficial || assetData.make || 'OEM');
        const model = String(assetData.model_oficial || assetData.model || input.globalAssetId);
        const makeModel = assetData.make_model || `${make} ${model}`.trim();

        // 1. Verificación determinista SI + resolución de simbología normativa real
        const siVerified = verifyAndNormalizeTechnicalUnits(input.markdownContent || '');
        const cleanMarkdown = siVerified.normalizedMarkdown.trim();
        const verifiedSymbols = await verifyAndResolveSymbologyRefs(input.symbologyCandidates || []);
        const incomingFigures = input.figures || [];

        const vault = assetData.knowledge_vault || createEmptyKnowledgeVault(makeModel);
        const pillarDoc = vault[input.pillarId] || createEmptyKnowledgeVault(makeModel)[input.pillarId];
        const items: PillarItem[] = Array.isArray(pillarDoc.items) ? [...pillarDoc.items] : [];

        // 2. Localizar el capítulo destino (`targetItemId` directo o mejor coincidencia por título/sección)
        let itemIndex = -1;
        if (input.targetItemId) {
            itemIndex = items.findIndex((it) => it.item_id === input.targetItemId);
        }

        if (itemIndex === -1 && items.length > 0) {
            let bestScore = 0;
            let bestIdx = -1;
            for (let i = 0; i < items.length; i++) {
                if (items[i].is_discarded) continue;
                const score = tokenJaccardSimilarity(items[i].title, input.chapterTitle);
                if (score > bestScore) {
                    bestScore = score;
                    bestIdx = i;
                }
            }
            if (bestScore >= 0.36 && bestIdx !== -1) {
                itemIndex = bestIdx;
            }
        }

        const nowIso = new Date().toISOString();

        // Si el pilar aún no tenía ese capítulo (ej. manual PDF OEM aporta un capítulo inédito), crearlo limpio
        if (itemIndex === -1) {
            const newOrder = items.length + 1;
            const newItemId = input.targetItemId || slugifyChapterId(input.pillarId, input.chapterTitle, newOrder);
            const newItem: PillarItem = {
                item_id: newItemId,
                order: newOrder,
                title: input.chapterTitle.trim() || `Capítulo Técnico ${newOrder}`,
                section: (input.section || 'DOCUMENTACIÓN OEM').trim().toUpperCase(),
                rationale:
                    input.rationale ||
                    `Extraído desde fuente técnica verificada (${input.sourceLabel}).`,
                priority: input.priority || 'IMPORTANTE',
                content_status: 'PENDIENTE',
                content: null,
                created_at: nowIso,
                created_by: input.actorEmail || 'SegmentedDocumentProcessor v4.0',
                item_sources: input.sources || [],
                is_discarded: false,
                estado_aprobacion: 'GENERADO_IA',
                is_human_locked: false,
                historial_cambios: [],
                pending_conflicts: [],
                authorized_delta_buffer: [],
                locked_item_advisories: [],
                figures: [],
                fact_fingerprints: [],
                symbology_refs: [],
            };
            items.push(newItem);
            itemIndex = items.length - 1;
        }

        const currentItem: PillarItem = { ...items[itemIndex] };
        const existingFingerprints = new Set<string>(currentItem.fact_fingerprints || []);
        const mainFingerprint = computeFactFingerprint(cleanMarkdown, currentItem.title);

        // Fusionar fuentes sin duplicar URL
        const mergedSources: ItemizedSource[] = [...(currentItem.item_sources || [])];
        for (const src of input.sources || []) {
            if (src?.url && !mergedSources.some((s) => s.url === src.url)) {
                mergedSources.push(src);
            }
        }
        if (
            input.sourceUrl &&
            input.sourceUrl !== '#' &&
            !mergedSources.some((s) => s.url === input.sourceUrl)
        ) {
            mergedSources.push({
                type: input.isOemSource ? 'OEM' : 'MANUAL',
                author: make,
                description: input.sourceLabel,
                url: input.sourceUrl,
            });
        }

        // Fusionar simbología normativa sin duplicados
        const mergedSymbology = Array.from(
            new Set([...(currentItem.symbology_refs || []), ...verifiedSymbols])
        );

        // ── CASO A: ÍTEM BLOQUEADO POR AUTORIDAD HUMANA (`is_human_locked === true`) ──
        if (currentItem.is_human_locked === true) {
            if (existingFingerprints.has(mainFingerprint) || !cleanMarkdown) {
                return {
                    itemId: currentItem.item_id,
                    outcome: 'SKIPPED_DUPLICATE',
                    addedProposals: 0,
                    addedFigures: 0,
                    addedAdvisories: 0,
                    skippedDuplicates: 1,
                };
            }

            const existingAdvisories = [...(currentItem.locked_item_advisories || [])];
            const alreadyAdvised = existingAdvisories.some(
                (adv) => computeFactFingerprint(adv.proposed_value, currentItem.title) === mainFingerprint
            );

            if (alreadyAdvised) {
                return {
                    itemId: currentItem.item_id,
                    outcome: 'SKIPPED_DUPLICATE',
                    addedProposals: 0,
                    addedFigures: 0,
                    addedAdvisories: 0,
                    skippedDuplicates: 1,
                };
            }

            const newAdvisory: LockedItemAdvisory = {
                advisory_id: `adv_${randomUUID().slice(0, 10)}`,
                detected_at: nowIso,
                source_label: input.sourceLabel,
                source_url: input.sourceUrl,
                summary: `Nueva evidencia técnica detectada en ${input.sourceLabel} sobre ítem bloqueado por autoridad humana.`,
                proposed_value: cleanMarkdown.slice(0, 2400),
                current_locked_snapshot: (currentItem.content || '').slice(0, 600),
                acknowledged: false,
            };

            currentItem.locked_item_advisories = [...existingAdvisories, newAdvisory];
            items[itemIndex] = currentItem;

            await assetRef.update({
                [`knowledge_vault.${input.pillarId}.items`]: stripUndefinedDeep(items),
                updatedAt: Date.now(),
            });

            return {
                itemId: currentItem.item_id,
                outcome: 'LOCKED_ADVISORY_RECORDED',
                addedProposals: 0,
                addedFigures: 0,
                addedAdvisories: 1,
                skippedDuplicates: 0,
            };
        }

        // ── CASO B: ÍTEM VACÍO / `PENDIENTE` → POBLADO INICIAL DIRECTO ──
        const hasExistingContent =
            Boolean(currentItem.content && currentItem.content.trim().length > 25) &&
            currentItem.content_status === 'COMPLETADO';

        if (!hasExistingContent) {
            const { merged: finalFigures } = mergeDeduplicatedFigures(
                currentItem.figures || [],
                incomingFigures
            );
            const finalMarkdown = anchorFiguresIntoMarkdown(cleanMarkdown, finalFigures);
            const referencedFigures = filterFiguresReferencedInMarkdown(finalMarkdown, finalFigures);

            existingFingerprints.add(mainFingerprint);
            for (const d of input.structuredDeltas || []) {
                existingFingerprints.add(computeFactFingerprint(d.valor_nuevo, d.componente));
            }

            currentItem.content = finalMarkdown || '[Información técnica no declarada en ficha]';
            currentItem.content_status = 'COMPLETADO';
            currentItem.hunted_at = nowIso;
            currentItem.hunt_error = null;
            currentItem.estado_aprobacion = 'GENERADO_IA';
            currentItem.figures = referencedFigures;
            currentItem.item_sources = mergedSources;
            currentItem.symbology_refs = mergedSymbology;
            currentItem.fact_fingerprints = Array.from(existingFingerprints);
            currentItem.historial_cambios = [
                ...(currentItem.historial_cambios || []),
                {
                    fecha: nowIso,
                    accion: 'INGESTA_INICIAL_VERIFICADA',
                    actor: input.actorEmail || 'VaultReconciliationService v4.0',
                    detalle: `Poblado inicial desde ${input.sourceLabel} (${referencedFigures.length} figura(s), ${mergedSymbology.length} símbolo(s)).`,
                },
            ];

            items[itemIndex] = currentItem;
            pillarDoc.status = 'COMPLETED';
            if (pillarDoc.itemize_status !== 'COMPLETED') {
                pillarDoc.itemize_status = items.length >= 6 ? 'COMPLETED' : 'PARTIAL_FROM_INGESTION';
            }
            pillarDoc.items = items;
            pillarDoc.updated_at = nowIso;
            vault[input.pillarId] = pillarDoc;

            await assetRef.update({
                knowledge_vault: stripUndefinedDeep(vault),
                updatedAt: Date.now(),
            });

            return {
                itemId: currentItem.item_id,
                outcome: 'POPULATED_INITIAL',
                addedProposals: 0,
                addedFigures: referencedFigures.length,
                addedAdvisories: 0,
                skippedDuplicates: 0,
            };
        }

        // ── CASO C: ÍTEM CON CONTENIDO EXISTENTE → DEDUPLICACIÓN + COLA DE EVOLUCIÓN HITL ──
        let skippedDuplicates = 0;
        const { merged: updatedItemFigures, newlyAdded: newFigures } = mergeDeduplicatedFigures(
            currentItem.figures || [],
            incomingFigures
        );

        // Comprobar si el bloque completo ya está representado exacta o semánticamente
        let isSemanticallyIdentical = existingFingerprints.has(mainFingerprint);
        if (!isSemanticallyIdentical && cleanMarkdown.length > 40 && currentItem.content) {
            try {
                const [embExisting, embIncoming] = await ResilientAIClient.embedBatch(
                    [currentItem.content.slice(0, 3500), cleanMarkdown.slice(0, 3500)],
                    { taskType: 'SEMANTIC_SIMILARITY' }
                );
                const sim = ResilientAIClient.cosineSimilarity(embExisting, embIncoming);
                if (sim >= 0.94 && (!input.structuredDeltas || input.structuredDeltas.length === 0)) {
                    isSemanticallyIdentical = true;
                }
            } catch {
                // Si el embedding no está disponible en modo offline/mock, continuamos con fingerprint léxico
            }
        }

        const existingPending: ProposedUpdate[] = [...(currentItem.pending_conflicts || [])];
        const pendingFingerprints = new Set<string>(
            existingPending
                .map((p) => p.fact_fingerprint || computeFactFingerprint(p.valor_nuevo || '', p.componente))
                .filter(Boolean)
        );

        const candidateDeltas: StructuredDeltaInput[] =
            input.structuredDeltas && input.structuredDeltas.length > 0
                ? input.structuredDeltas
                : !isSemanticallyIdentical && cleanMarkdown.length > 25
                    ? [
                        {
                            zona: (input.section || currentItem.section || 'GENERAL').toUpperCase(),
                            componente: input.chapterTitle || currentItem.title,
                            valor_actual: (currentItem.content || '').slice(0, 280),
                            valor_nuevo: cleanMarkdown,
                            condicion_esperada: `Actualización detectada en ${input.sourceLabel}`,
                            tipo_input: 'text_block',
                            is_oem: Boolean(input.isOemSource),
                            synthesis: `Aporte técnico complementario desde ${input.sourceLabel}.`,
                            estado_fusion: 'NUEVO',
                        },
                    ]
                    : [];

        let addedProposals = 0;
        for (const delta of candidateDeltas) {
            const normalizedVal = verifyAndNormalizeTechnicalUnits(delta.valor_nuevo || '').normalizedMarkdown.trim();
            if (!normalizedVal) continue;

            const fp = computeFactFingerprint(normalizedVal, delta.componente);
            if (existingFingerprints.has(fp) || pendingFingerprints.has(fp)) {
                skippedDuplicates++;
                continue;
            }

            // Verificar si el texto exacto ya está contenido literalmente en `currentItem.content`
            if (
                normalizedVal.length < 180 &&
                (currentItem.content || '').toLowerCase().includes(normalizedVal.toLowerCase())
            ) {
                existingFingerprints.add(fp);
                skippedDuplicates++;
                continue;
            }

            // Determinar si es `CONFLICTO` (mismo componente mencionado en contenido actual con distinta cifra) o `NUEVO`
            const compLower = (delta.componente || '').toLowerCase().trim();
            const mentionsComponent =
                compLower.length >= 4 && (currentItem.content || '').toLowerCase().includes(compLower);
            const fusionState: 'NUEVO' | 'CONFLICTO' =
                delta.estado_fusion || (mentionsComponent && delta.valor_actual ? 'CONFLICTO' : 'NUEVO');

            existingPending.push({
                proposal_id: `prop_${randomUUID().slice(0, 10)}`,
                estado_fusion: fusionState,
                zona: delta.zona || currentItem.section || 'GENERAL',
                componente: delta.componente || currentItem.title,
                condicion_esperada: delta.condicion_esperada || input.sourceLabel,
                tipo_input: delta.tipo_input || 'text_block',
                is_oem: delta.is_oem ?? Boolean(input.isOemSource),
                valor_actual:
                    delta.valor_actual ||
                    (fusionState === 'CONFLICTO'
                        ? (currentItem.content || '').slice(0, 260)
                        : '[Sin registro previo de este parámetro]'),
                valor_nuevo: normalizedVal,
                detected_at: nowIso,
                synthesis: delta.synthesis || `Hallazgo desde ${input.sourceLabel}`,
                human_decision: null,
                source_url: input.sourceUrl || '#',
                fact_fingerprint: fp,
                ...(newFigures.length > 0 ? { figures: newFigures } : {}),
            });

            pendingFingerprints.add(fp);
            addedProposals++;
        }

        if (addedProposals === 0 && newFigures.length === 0) {
            return {
                itemId: currentItem.item_id,
                outcome: 'SKIPPED_DUPLICATE',
                addedProposals: 0,
                addedFigures: 0,
                addedAdvisories: 0,
                skippedDuplicates: Math.max(1, skippedDuplicates),
            };
        }

        // Si entraron figuras OEM inéditas sin conflicto textual, anclarlas limpiamente al ítem
        if (newFigures.length > 0 && addedProposals === 0 && currentItem.content) {
            currentItem.content = anchorFiguresIntoMarkdown(currentItem.content, newFigures);
        }
        currentItem.figures = filterFiguresReferencedInMarkdown(currentItem.content || '', updatedItemFigures);
        currentItem.pending_conflicts = existingPending;
        currentItem.item_sources = mergedSources;
        currentItem.symbology_refs = mergedSymbology;
        currentItem.fact_fingerprints = Array.from(existingFingerprints);

        items[itemIndex] = currentItem;
        await assetRef.update({
            [`knowledge_vault.${input.pillarId}.items`]: stripUndefinedDeep(items),
            updatedAt: Date.now(),
        });

        return {
            itemId: currentItem.item_id,
            outcome: addedProposals > 0 ? 'QUEUED_DELTAS' : 'ATTACHED_FIGURES_ONLY',
            addedProposals,
            addedFigures: newFigures.length,
            addedAdvisories: 0,
            skippedDuplicates,
        };
    }
}
