import { createHash } from 'crypto';
import { db } from '../../../config/firebase';
import { AuditLedger } from '../../../core/audit-ledger';
import { ResilientAIClient, Type, UngroundedEvidenceError } from '../../../core/resilient-ai-client';
import type {
    CanonicalSpecSlot,
    EquipmentTypePillarBlueprint,
    GlobalEquipmentTypeDoc,
    ItemizedSource,
    PillarDocument,
    PillarId,
    PillarItem,
} from '../types/vault.types';
import { PILLAR_PREREQUISITE_MAP, SEQUENTIAL_PILLAR_ORDER } from '../types/vault.types';
import { validateCatalogProfileGate } from './CatalogUpsertService';
import { buildAndPersistEquipmentCostMatrix } from './EquipmentCostMatrixCompiler';
import {
    buildDedicatedCapexCoreChapter,
    buildDedicatedConsumptionCoreChapter,
    buildDedicatedWearAndRodadoCoreChapter,
    evolveEquipmentTypeChecklistPreOpBlueprint,
    evolveEquipmentTypeFichaTecnicaBlueprint,
    evolveEquipmentTypeManualOperacionesBlueprint,
    evolveEquipmentTypeMatrizRiesgosBlueprint,
    evolveEquipmentTypePautaMantencionBlueprint,
    resolveElasticChecklistPreOpBlueprint,
    resolveElasticFichaTecnicaBlueprint,
    resolveElasticManualOperacionesBlueprint,
    resolveElasticMatrizRiesgosBlueprint,
    resolveElasticPautaMantencionBlueprint,
    resolveOrLearnEquipmentType,
} from './EquipmentTypeRegistryService';
import { createEmptyKnowledgeVault, PILLAR_AGENTS, PILLAR_LABELS } from './pillarAgents';
import { classifySourcesByAuthorship } from './SourceClassifierService';
import {
    extractConfirmedSpecsSummaryFromMarkdown,
    extractPositivelyConfirmedSubsystems,
    normalizeComparableTitle,
    tokenJaccardSimilarity,
} from './TextSimilarityUtils';
import { VaultPersistenceService } from './VaultPersistenceService';
import { buildLockedVariantDirective } from '../utils/lockedVariantDirective';

/**
 * ITEMIZER SERVICE v9.1 — ETAPA 2 ON-DEMAND CON ONTOLOGÍA ELÁSTICA EN 2 ANILLOS (`TIPO`-FIRST)
 * Y PRIORIDAD SOBERANA `SOVEREIGN_VAULT_FIRST` (`southamerica-west1`)
 *
 * Capacidades de Ingeniería:
 * 1. Ontología Elástica en 2 Anillos (`Núcleo Mínimo + Expansión Abierta por Complejidad del Modelo`):
 *    - Anillo 1 (`core_chapters`): Garantiza que todos los equipos del mismo `TIPO` compartan los mismos
 *      4 a 6 capítulos basales y los ejes físicos SI (`spec_schema` + `canonical_specs`).
 *    - Anillo 2 (`conditional_subsystems` + Descubrimiento Abierto): Un equipo simple (ej. `FIAT Fiorino`
 *      o herramienta manual) se mantiene limpio en 5–6 capítulos sin relleno artificial, mientras que un
 *      equipo complejo registrado después (ej. `Ford F-350 Super Duty` o `CAT 797F`) activa todos sus
 *      subsistemas reales (`PTO`, `Quinta Rueda`, `DRW`, `Lock-Up`, `Retardo ARC`, `RAX`, `TPMS/VIMS`)
 *      sin techo rígido y retroalimenta el catálogo del `TIPO`.
 * 2. Soberanía Documental `SOVEREIGN_VAULT_FIRST` (Ley N° 21.719):
 *    - Consulta primero `vault_corpus_chunks` y `vault_files` en `southamerica-west1` antes de salir a Google Search.
 * 3. Fusión No Destructiva (`mergeItemizedStructure`):
 *    - Si el pilar ya tenía capítulos creados por ingesta previa de PDF/lámina o curaduría manual,
 *      conserva el 100% de sus contenidos, figuras, candados `is_human_locked` e historial, e inserta
 *      únicamente los capítulos faltantes como `PENDIENTE`.
 */

function slugifyItemId(pillarId: PillarId, title: string, index: number): string {
    const clean = title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    return `${pillarId}_${clean || 'item'}_${index + 1}`;
}

interface SovereignLocalCorpusContext {
    digestText: string;
    sovereignSources: ItemizedSource[];
    chapterTitles: string[];
}

/**
 * Consulta en `southamerica-west1` los manuales PDF, ETT y láminas ya ingeridos para este activo
 * (`SOVEREIGN_VAULT_FIRST`), extrayendo sus capítulos y fuentes CAS verificadas.
 */
async function loadSovereignLocalCorpusForPillar(
    globalAssetId: string,
    pillarId: PillarId,
    makeOficial: string
): Promise<SovereignLocalCorpusContext> {
    const assetRef = db.collection('global_asset_catalog').doc(globalAssetId);
    const sovereignSources: ItemizedSource[] = [];
    const chapterTitles: string[] = [];
    const digestLines: string[] = [];

    try {
        const [chunksSnap, filesSnap] = await Promise.all([
            assetRef
                .collection('vault_corpus_chunks')
                .where('pillar_id', '==', pillarId)
                .limit(30)
                .get(),
            assetRef.collection('vault_files').limit(15).get(),
        ]);

        const fileUrlByHash = new Map<string, { url: string; filename: string }>();
        for (const fDoc of filesSnap.docs) {
            const fData = fDoc.data();
            if (fData?.storageUrl) {
                fileUrlByHash.set(fDoc.id, {
                    url: String(fData.storageUrl),
                    filename: String(fData.originalFilename || 'Manual Técnico OEM (CAS southamerica-west1)'),
                });
            }
        }

        const seenUrls = new Set<string>();
        for (const cDoc of chunksSnap.docs) {
            const cData = cDoc.data();
            const title = String(cData?.chapter_title || '').trim();
            const filename = String(cData?.source_filename || 'Documento Técnico Local').trim();
            const snippet = String(cData?.markdown_es || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 260);
            const fileMeta = fileUrlByHash.get(String(cData?.file_sha256 || ''));
            const sourceUrl = fileMeta?.url || `/vault-local/${globalAssetId}/${cDoc.id}`;

            if (title) {
                chapterTitles.push(title);
                digestLines.push(`- [${filename}] Capítulo: "${title}" -> ${snippet}`);
            }

            if (!seenUrls.has(sourceUrl)) {
                seenUrls.add(sourceUrl);
                sovereignSources.push({
                    type: 'OEM',
                    author: makeOficial !== 'GENÉRICO' ? makeOficial : 'Bóveda Soberana MINREPORT',
                    description: `${filename} (Almacenamiento Soberano southamerica-west1)`,
                    url: sourceUrl,
                });
            }
        }
    } catch {
        // Continuar limpiamente si el activo aún no tiene documentos PDF ingeridos
    }

    return {
        digestText: digestLines.join('\n'),
        sovereignSources,
        chapterTitles,
    };
}

/**
 * Cortafuegos determinista de presencia positiva sobre capítulos candidatos de itemizado:
 * Bloquea la creación o aprendizaje de capítulos dedicados a subsistemas inexistentes ("No aplica",
 * "Ausencia de...", SCR/AdBlue en unidades eléctricas o motores sin SCR, embrague manual en automáticas/hidrostáticas).
 */
function filterPositivePresenceItemCandidates<
    T extends { title?: string; section?: string; rationale?: string }
>(
    candidates: T[],
    assetData: Record<string, any> | null | undefined,
    typeDoc: Pick<GlobalEquipmentTypeDoc, 'physical_traits'> | null | undefined
): T[] {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];

    const primaryEnergy = typeDoc?.physical_traits?.primary_energy;
    const isNonThermalEnergy =
        primaryEnergy === 'ELECTRICO_RED_AC' ||
        primaryEnergy === 'ELECTRICO_BATERIA_BEV' ||
        primaryEnergy === 'NEUMATICO_AIRE_COMPRIMIDO' ||
        primaryEnergy === 'HIDRAULICO_AUXILIAR' ||
        primaryEnergy === 'MANUAL_MECANICO' ||
        primaryEnergy === 'REMOLCADO_SIN_PROPULSION_PROPIA';

    const emissionCorpus = [
        assetData?.configuration_profile?.factory_emission_or_grid_spec || '',
        ...(Array.isArray(assetData?.ambiente_operativo) ? assetData.ambiente_operativo : []),
        ...(Array.isArray(assetData?.caracteristicas_principales) ? assetData.caracteristicas_principales : []),
    ].join(' ');

    const isExplicitlyWithoutScr =
        isNonThermalEnergy ||
        /\b(?:sin\s+(?:sistema\s+)?(?:scr|adblue|def)|tier\s*[0123]\b|stage\s*iii\s*a\b|euro\s*(?:i|ii|iii)\b)\b/i.test(
            emissionCorpus
        );

    const txCategory = assetData?.configuration_profile?.transmission_category;
    const isClutchlessTransmission =
        txCategory === 'AUTOMATIC_PLANETARY_CONVERTER' ||
        txCategory === 'HYDROSTATIC' ||
        txCategory === 'AUTOMATED_MANUAL_AMT';

    return candidates.filter((item) => {
        const title = String(item?.title || '').trim();
        const rationale = String(item?.rationale || '').trim();
        if (!title) return false;

        if (
            /\b(?:no\s+aplica|inexistencia\s+de|ausencia\s+de|exenci[oó]n\s+de|carencia\s+de|sin\s+sistema\b|sin\s+adblue\b|sin\s+scr\b)\b/i.test(
                title
            )
        ) {
            return false;
        }

        if (
            /\b(?:no\s+aplica\s+a\s+este\s+(?:equipo|activo|modelo)|(?:equipo|activo|modelo)\s+no\s+(?:posee|equipa|incorpora|requiere)|ausencia\s+de\s+este\s+subsistema)\b/i.test(
                rationale
            )
        ) {
            return false;
        }

        if (
            isExplicitlyWithoutScr &&
            /\b(?:sistema\s+scr|adblue|fluido\s+def|dosificaci[oó]n\s+def|urea\s+automotriz)\b/i.test(title) &&
            !/\b(?:motorizaci[oó]n|planta\s+motriz|consumos?\s+horarios|lubricantes\s+y\s+fluidos)\b/i.test(title)
        ) {
            return false;
        }

        if (
            isClutchlessTransmission &&
            /\b(?:pedal\s+de\s+embrague|reglaje\s+de\s+embrague|doble\s+embrague|caja\s+manual\s+fuller|roadranger)\b/i.test(
                title
            )
        ) {
            return false;
        }

        return true;
    });
}

/**
 * Construye el contexto estructural y de contenidos confirmados acumulativo de los pilares previos ya itemizados/cazados
 * siguiendo la secuencia obligatoria: `01 Ficha Técnica ➔ 02 Manual de Operaciones ➔ 03 Pauta de Mantención ➔ 04 Matriz de Riesgos ➔ 05 Checklist Pre-Op`.
 * Aplica cortafuegos de presencia positiva para impedir que subsistemas negados ("sin SCR", "No aplica") contagien pilares derivados (`CAD-01`).
 */
function buildCumulativePriorPillarsContext(
    vault: Record<string, any> | undefined,
    targetPillarId: PillarId
): string {
    if (!vault || typeof vault !== 'object') return '';
    const targetIdx = SEQUENTIAL_PILLAR_ORDER.indexOf(targetPillarId);
    if (targetIdx <= 0) return '';

    const blocks: string[] = [];
    const specializedAndCriticalHighlights: string[] = [];
    const seenHighlights = new Set<string>();

    for (let i = 0; i < targetIdx; i++) {
        const pid = SEQUENTIAL_PILLAR_ORDER[i];
        const pLabel = PILLAR_LABELS[pid] || pid;
        const pItems: PillarItem[] = Array.isArray(vault[pid]?.items)
            ? vault[pid].items.filter(
                  (it: any) =>
                      !it?.is_discarded &&
                      !/\b(?:no\s+aplica|inexistencia\s+de|ausencia\s+de|exenci[oó]n\s+de|sin\s+sistema\s+scr|sin\s+adblue)\b/i.test(
                          String(it?.title || '')
                      )
              )
            : [];
        if (pItems.length === 0) continue;

        for (const it of pItems) {
            const sec = String(it.section || '').toUpperCase();
            const contentStr = String(it.content || '');
            const matchedSubsystems = extractPositivelyConfirmedSubsystems(contentStr);

            if (
                it.priority === 'CRÍTICO' ||
                /\b(ESPECIALIZADO|CONDICIONAL|SUBSISTEMA|ETAPA V|DOMINIO IV|ZONA III|FASE IV)\b/.test(sec) ||
                matchedSubsystems.length > 0
            ) {
                const subTag =
                    matchedSubsystems.length > 0
                        ? ` [Subsistemas físicos confirmados: ${matchedSubsystems.slice(0, 6).join(', ')}]`
                        : '';
                const highlightLine = `  • [0${i + 1} · ${pLabel}] "${it.title}" (${it.section || 'GENERAL'})${subTag}`;
                if (specializedAndCriticalHighlights.length < 22 && !seenHighlights.has(highlightLine)) {
                    seenHighlights.add(highlightLine);
                    specializedAndCriticalHighlights.push(highlightLine);
                }
            }
        }

        const lines = pItems.map((it, idx) => {
            const rationale = String(it.rationale || '')
                .replace(/\(\s*sin\s+[^)]*\)/gi, '')
                .trim()
                .slice(0, 120);
            const confirmedSpecs = extractConfirmedSpecsSummaryFromMarkdown(it.content || undefined, 260);
            return `  ${idx + 1}. [${it.section || 'GENERAL'}] "${it.title}" (${it.priority}) — ${rationale}${
                confirmedSpecs ? ` | DATOS CAZADOS CONFIRMADOS: ${confirmedSpecs}` : ''
            }`;
        });
        blocks.push(
            `PILAR 0${i + 1} CONFIRMADO (${pLabel.toUpperCase()} — ${pItems.length} capítulos):\n${lines.join('\n')}`
        );
    }

    if (specializedAndCriticalHighlights.length > 0) {
        blocks.unshift(
            `MATRIZ DE SUBSISTEMAS FÍSICOS CONFIRMADOS EN PILARES PREVIOS (COBERTURA 1 A 1 EXCLUSIVA DE EQUIPAMIENTO REALMENTE INSTALADO):\n${specializedAndCriticalHighlights.join('\n')}`
        );
    }

    return blocks.join('\n\n');
}

export const DEDICATED_CONSUMPTION_ITEM_REGEX =
    /\b(consumos?\s+de\s+combustible|consumos?\s+de\s+energ[ií]a|consumos?\s+por\s+factor\s+de\s+carga|consumos?\s+y\s+autonom[ií]a|rendimiento\s+de\s+combustible|matriz\s+energ[eé]tica|consumo\s+horario|consumo\s+espec[ií]fico|autonom[ií]a\s+operativa|autonom[ií]a\s+por\s+ciclo|demanda\s+de\s+potencia\s+y\s+factor\s+de\s+carga)\b/i;

export const DEDICATED_CAPEX_ITEM_REGEX =
    /\b(valorizaci[oó]n\s+referencial|valorizaci[oó]n\s+patrimonial|capex|costo\s+referencial\s+(?:de\s+)?(?:reposici[oó]n|equipo\s+nuevo)|vida\s+[uú]til\s+econ[oó]mica|base\s+de\s+depreciaci[oó]n|valor\s+residual\s+referencial)\b/i;

export const DEDICATED_WEAR_RODADO_ITEM_REGEX =
    /\b(recambio\s+de\s+elementos\s+de\s+desgaste|elementos\s+de\s+desgaste\s*\(?get\)?|recambio\s+de\s+aceros\s+de\s+perforaci[oó]n|recambio\s+de\s+neum[aá]ticos|recambio\s+de\s+piezas\s+de\s+desgaste|desgaste\s+de\s+ataque\s*\(?get|desgaste\s+de\s+conminuci[oó]n)\b/i;

function getFichaTecnicaSectionRank(section?: string, title?: string): number {
    const s = `${section || ''} ${title || ''}`.toUpperCase();
    if (/\bDESEMPE[ÑN]O NOMINAL\b|\bEJES DIFERENCIADORES\b|\bPAR[ÁA]METROS CR[ÍI]TICOS\b|\bIDENTIFICACI[ÓO]N\b|\bARQUITECTURA GENERAL\b/.test(s)) return 1;
    if (DEDICATED_CONSUMPTION_ITEM_REGEX.test(s)) return 2.5;
    if (DEDICATED_CAPEX_ITEM_REGEX.test(s)) return 6.5;
    if (
        (/\bPLANTA MOTRIZ\b|\bMOTOR(IZACI[ÓO]N)?\b|\bCILINDRADA\b|\bSOBREALIMENTACI[ÓO]N\b|\bCURVAS DE (PAR|POTENCIA|TORQUE)\b/.test(s)) &&
        !/\bTREN DE POTENCIA\b|\bFRENO MOTOR\b|\bFRENADO\b|\bRETARDO\b/.test(s)
    ) {
        return 2;
    }
    if (/\bTRANSMISI[ÓO]N\b|\bTREN DE FUERZA\b|\bTREN DE POTENCIA\b|\bTREN MOTRIZ\b|\bCAJA DE CAMBIOS\b|\bTRACCI[ÓO]N\b|\bEJES\b|\bFRENOS\b|\bDIRECCI[ÓO]N\b|\bSUSPENSI[ÓO]N\b|\bRODADO\b|\bORUGAS\b|\bNEUM[ÁA]TICOS\b/.test(s)) return 3;
    if (/\bHIDR[ÁA]ULIC|\bIMPLEMENTO\b|\bÓRGANO DE TRABAJO\b|\bTOLVA\b|\bHOJA\b|\bBALDE\b|\bPLUMA\b|\bPERFORACI[ÓO]N\b|\bSISTEMA DE TRABAJO\b/.test(s)) return 4;
    if (/\bGEOMETR[ÍI]A\b|\bDIMENSIONES\b|\bPESOS\b|\bMASAS\b/.test(s)) return 4.5;
    if (/\bESPECIALIZADO\b|\bCONDICIONAL\b|\bPTO\b|\bQUINTA RUEDA\b|\bDRW\b|\bRAX\b|\bAUTOLUBE\b|\bVIMS\b|\bTPMS\b|\bAFEX\b/.test(s)) return 5;
    if (/\bCAPACIDADES DE LLENADO\b|\bCAPACIDADES DE ESTANQUE\b|\bFLUIDOS\b|\bSISTEMA EL[ÉE]CTRICO\b|\bCABINA\b|\bROPS\b|\bFOPS\b|\bNORMATIVA\b|\bSEGURIDAD\b|\bEMISIONES\b|\bSERVICIO\b/.test(s)) return 6;
    return 4;
}

function getManualOperacionesPhaseRank(section?: string, title?: string): number {
    const s = `${section || ''} ${title || ''}`.toUpperCase();
    if (/\bFASE\s*I\b|\bMANDOS\b|\bCABINA\b|\bEMPU[ÑN]ADURA\b|\bCUADRO DE INSTRUMENTOS\b/.test(s)) return 1;
    if (/\bFASE\s*II\b|\bPUESTA EN MARCHA\b|\bARRANQUE\b|\bPRECALENTAMIENTO\b|\bCONEXI[ÓO]N A\b/.test(s)) return 2;
    if (/\bFASE\s*III\b|\bOPERACI[ÓO]N PRODUCTIVA\b|\bT[ÉE]CNICAS DE\b|\bCICLO DE TRABAJO\b/.test(s)) return 3;
    if (/\bFASE\s*IV\b|\bL[ÍI]MITES\b|\bCONDICIONES ADVERSAS\b|\bPENDIENTES\b|\bREGENERACI[ÓO]N\b|\bTOMA DE FUERZA\b|\bVIMS\b/.test(s)) return 4;
    if (/\bFASE\s*V\b|\bPARADA\b|\bDETENCI[ÓO]N\b|\bESTACIONAMIENTO\b|\bREMOLQUE\b|\bLOTO\b/.test(s)) return 5;
    return 3;
}

function getPautaMantencionStageRank(section?: string, title?: string): number {
    const s = `${section || ''} ${title || ''}`.toUpperCase();
    if (/\bETAPA\s*I\b|\bCARTA MAESTRA\b|\bLUBRICANTES\b|\bVISCOSIDADES\b|\bCAPACIDADES DE LLENADO\b|\bCONSUMIBLES OEM\b/.test(s)) return 1;
    if (/\bETAPA\s*II\b|\bDIARIO\b|\b10\s*H\b|\b50\s*H\b|\b5\.?000\s*KM\b|\bSEMANAL\b|\bPRE\/POST-JORNADA\b|\bPUNTOS DE ENGRASE\b/.test(s)) return 2;
    if (/\bETAPA\s*III\b|\b250\s*H\b|\b500\s*H\b|\bPM1\b|\bPM2\b|\b10\.?000\s*KM\b|\b20\.?000\s*KM\b|\bMENORES E INTERMEDIAS\b/.test(s)) return 3;
    if (/\bETAPA\s*IV\b|\b1\.?000\s*H\b|\b2\.?000\s*H\b|\b4\.?000\s*H\b|\bPM3\b|\bPM4\b|\b40\.?000\s*KM\b|\b60\.?000\s*KM\b|\b100\.?000\s*KM\b|\bOVERHAUL\b|\bMAYOR\b/.test(s)) return 4;
    if (DEDICATED_WEAR_RODADO_ITEM_REGEX.test(s)) return 5.2;
    if (/\bETAPA\s*V\b|\bS·O·S\b|\bTRIBOL[ÓO]GICO\b|\bSUBSISTEMAS ESPECIALIZADOS\b|\bRAX\b|\bAUTOLUBE\b|\bACUMULADORES\b|\bDPF\b|\bQUINTA RUEDA\b|\bTRANSFERENCIA 4X4\b/.test(s)) return 5;
    if (/\bETAPA\s*VI\b|\bPARES DE APRIETE\b|\bTORQUE\b|\bTOLERANCIAS\b|\bL[ÍI]MITES DE CONDENA\b|\bLOTO\b/.test(s)) return 6;
    return 4;
}

function getMatrizRiesgosDomainRank(section?: string, title?: string): number {
    const sec = String(section || '').toUpperCase();
    const romanMatch = sec.match(/\bDOMINIO\s+(VI|IV|V|III|II|I)\b/);
    if (romanMatch) {
        const map: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
        return map[romanMatch[1]] ?? 4;
    }
    const s = `${sec} ${title || ''}`.toUpperCase();
    if (/\bLOTO\b|\bENERG[ÍI]A CERO\b|\bAISLAMIENTO\b|\bBLOQUEO\b/.test(s)) return 1;
    if (/\bINCENDIO\b|\bEMERGENCIA\b|\bEPP\b|\bEVACUACI[ÓO]N\b/.test(s)) return 6;
    if (/\bRUIDO\b|\bVIBRACI[ÓO]N\b|\bS[ÍI]LICE\b|\bPREXOR\b|\bPLANESI\b|\bHIGIENE\b|\bERGONOM/.test(s)) return 5;
    if (/\bMANTENCI[ÓO]N\b|\bINTERVENCI[ÓO]N\b|\bIZAJE\b|\bDESARME\b/.test(s)) return 3;
    if (/\bOPERACI[ÓO]N\b|\bVUELCO\b|\bCOLISI[ÓO]N\b|\bPUNTOS CIEGOS\b|\bCONDUCCI[ÓO]N\b/.test(s)) return 2;
    return 4;
}

function getChecklistPreOpZoneRank(section?: string, title?: string): number {
    const sec = String(section || '').toUpperCase();
    const romanMatch = sec.match(/\bZONA\s+(VI|IV|V|III|II|I)\b/);
    if (romanMatch) {
        const map: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
        return map[romanMatch[1]] ?? 3;
    }
    const s = `${sec} ${title || ''}`.toUpperCase();
    if (/\bPRUEBA\b|\bPUESTA EN MARCHA\b|\bARRANQUE\b|\bENERGIZACI[ÓO]N\b/.test(s)) return 6;
    if (/\bCABINA\b|\bINSTRUMENT|\bCONSOLA\b|\bTABLERO\b/.test(s)) return 5;
    if (/\bSEGURIDAD\b|\bEXTINTOR\b|\bSUPRESI[ÓO]N\b|\bEMERGENCIA\b|\bESCALERA|\bPASARELA/.test(s)) return 4;
    if (/\bNIVEL(ES)? DE\b|\bFLUIDO|\bMIRILLA|\bBAJO CAP[ÓO]\b|\bMANGUERA|\bSUMINISTRO\b/.test(s)) return 2;
    if (/\bPERIMETRAL\b|\bNIVEL DE PISO\b|\b360\b|\bFUGAS\b|\bCARCASA\b|\bBASTIDOR\b/.test(s)) return 1;
    return 3;
}

/**
 * Ordena determinísticamente y reindexa los ítems de cualquiera de los 5 pilares (`01..05`).
 */
export function sortAndReindexPillarItems(pillarId: PillarId, items: PillarItem[]): PillarItem[] {
    if (!Array.isArray(items) || items.length === 0) return [];
    const rankFn =
        pillarId === 'ficha_tecnica'
            ? getFichaTecnicaSectionRank
            : pillarId === 'manual_operaciones'
            ? getManualOperacionesPhaseRank
            : pillarId === 'pauta_mantencion'
            ? getPautaMantencionStageRank
            : pillarId === 'matriz_riesgos'
            ? getMatrizRiesgosDomainRank
            : getChecklistPreOpZoneRank;

    const active = items.filter((it) => !it.is_discarded).map((it) => ({ ...it }));
    const discarded = items.filter((it) => it.is_discarded).map((it) => ({ ...it, order: 999 }));

    active.sort((a, b) => {
        const rankA = rankFn(a.section, a.title);
        const rankB = rankFn(b.section, b.title);
        if (rankA !== rankB) return rankA - rankB;
        return (a.order || 0) - (b.order || 0);
    });

    return [
        ...active.map((it, idx) => ({ ...it, order: idx + 1 })),
        ...discarded,
    ];
}

/**
 * Calcula el Hash Criptográfico SHA-256 canónico de la estructura activa de un pilar (`Web 3.0 Merkle Chain`).
 * Encadena opcionalmente `parentPillarDigestSha256` (`CAD-02`) para que cualquier evolución en un pilar ancestral
 * invalide criptográficamente el digest de todos los pilares descendientes (`01 ➔ 02 ➔ 03 ➔ 04 ➔ 05`).
 */
export function computePillarStructureDigestSha256(
    items: PillarItem[] | undefined,
    parentPillarDigestSha256?: string | null
): string | null {
    const active = Array.isArray(items) ? items.filter((it) => !it?.is_discarded) : [];
    if (active.length === 0) return null;
    const canonicalItems = active.map((it, idx) => ({
        order: idx + 1,
        title: normalizeComparableTitle(it.title),
        section: String(it.section || '').trim().toUpperCase(),
    }));
    const payload = parentPillarDigestSha256
        ? { parent: parentPillarDigestSha256, items: canonicalItems }
        : canonicalItems;
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Calcula el digest Merkle acumulativo de todos los pilares ancestrales (`01..N-1`) previos a `targetPillarId` (`CAD-02`).
 * Garantiza que un cambio en el Pilar `01` (abuelo) sea detectado instantáneamente por `03`, `04` y `05`.
 */
export function computeCumulativeAncestorDigestSha256(
    vault: Record<string, any> | undefined,
    targetPillarId: PillarId
): string | null {
    if (!vault || typeof vault !== 'object') return null;
    const targetIdx = SEQUENTIAL_PILLAR_ORDER.indexOf(targetPillarId);
    if (targetIdx <= 0) return null;

    const immediateParentId = SEQUENTIAL_PILLAR_ORDER[targetIdx - 1];
    const immediateParentDoc = vault[immediateParentId];
    if (targetIdx === 1) {
        return (
            immediateParentDoc?.structure_digest_sha256 ||
            computePillarStructureDigestSha256(immediateParentDoc?.items)
        );
    }

    const ancestorChain: string[] = [];
    for (let i = 0; i < targetIdx; i++) {
        const pid = SEQUENTIAL_PILLAR_ORDER[i];
        const pDoc = vault[pid];
        const pDigest =
            pDoc?.structure_digest_sha256 || computePillarStructureDigestSha256(pDoc?.items);
        if (pDigest) {
            ancestorChain.push(`${pid}:${pDigest}`);
        }
    }
    if (ancestorChain.length === 0) return null;
    return createHash('sha256').update(ancestorChain.join('|')).digest('hex');
}

/**
 * Verifica si algún eslabón ancestral (`01..N`) de la cadena Merkle de pilares ha evolucionado (`CAD-02`).
 */
export function isPillarMerkleChainEvolved(
    vault: Record<string, any> | undefined,
    targetPillarId: PillarId
): boolean {
    if (!vault || typeof vault !== 'object') return false;
    const targetIdx = SEQUENTIAL_PILLAR_ORDER.indexOf(targetPillarId);
    if (targetIdx <= 0) return false;

    const targetDoc = vault[targetPillarId];
    const targetActiveCount = Array.isArray(targetDoc?.items)
        ? targetDoc.items.filter((it: any) => !it?.is_discarded).length
        : 0;
    if (targetActiveCount === 0) return false;

    // 1. Verificar contra el digest acumulativo de todos los ancestros (`01..N-1`)
    const cumulativeAncestorDigest = computeCumulativeAncestorDigestSha256(vault, targetPillarId);
    const immediateParentId = SEQUENTIAL_PILLAR_ORDER[targetIdx - 1];
    const immediateParentDigest =
        vault[immediateParentId]?.structure_digest_sha256 ||
        computePillarStructureDigestSha256(vault[immediateParentId]?.items);

    const recordedParentDigest = targetDoc?.parent_pillar_digest_sha256;
    if (
        recordedParentDigest &&
        recordedParentDigest !== cumulativeAncestorDigest &&
        recordedParentDigest !== immediateParentDigest
    ) {
        return true;
    }

    // 2. Verificar recursivamente si algún ancestro intermedio (`02..N-1`) está desincronizado respecto a su propio padre
    for (let i = 1; i < targetIdx; i++) {
        const ancId = SEQUENTIAL_PILLAR_ORDER[i];
        const prevAncId = SEQUENTIAL_PILLAR_ORDER[i - 1];
        const ancDoc = vault[ancId];
        const prevAncDoc = vault[prevAncId];
        const ancParentRecorded = ancDoc?.parent_pillar_digest_sha256;
        const prevAncCurrent =
            prevAncDoc?.structure_digest_sha256 ||
            computePillarStructureDigestSha256(prevAncDoc?.items);
        const prevCumulative = computeCumulativeAncestorDigestSha256(vault, ancId);
        if (
            ancParentRecorded &&
            prevAncCurrent &&
            ancParentRecorded !== prevAncCurrent &&
            ancParentRecorded !== prevCumulative
        ) {
            return true;
        }
    }

    return false;
}

/**
 * Calcula el Hash Criptográfico SHA-256 del contenido técnico y estado de aprobación HITL
 * de los capítulos activos de un pilar (`content_digest_sha256`).
 * Permite detectar derivas de parámetros cuando un editor lateral modifica cifras o bloquea un ítem.
 */
export function computePillarContentDigestSha256(
    items: PillarItem[] | undefined
): string | null {
    const active = Array.isArray(items) ? items.filter((it) => !it?.is_discarded) : [];
    if (active.length === 0) return null;
    const canonicalContent = active.map((it, idx) => ({
        order: idx + 1,
        item_id: String(it.item_id || ''),
        title: normalizeComparableTitle(it.title),
        content_hash:
            it.content && String(it.content).trim()
                ? createHash('sha256').update(String(it.content).trim()).digest('hex')
                : 'PENDIENTE',
        locked: Boolean(it.is_human_locked),
        approval: String(it.estado_aprobacion || 'GENERADO_IA'),
    }));
    return createHash('sha256').update(JSON.stringify(canonicalContent)).digest('hex');
}

/**
 * Calcula la Raíz Merkle SHA-256 de la bóveda de 5 pilares (`vault_merkle_root_sha256`).
 * Cubre tanto el índice estructural (`structure_digest_sha256`) como el estado de contenido (`content_digest_sha256`).
 */
export function computeVaultMerkleRootSha256(vault: Record<string, any> | undefined): string | null {
    if (!vault || typeof vault !== 'object') return null;
    const digests: string[] = [];
    for (const pid of SEQUENTIAL_PILLAR_ORDER) {
        const doc = vault[pid];
        const digest =
            doc?.structure_digest_sha256 || computePillarStructureDigestSha256(doc?.items);
        const contentDigest =
            doc?.content_digest_sha256 || computePillarContentDigestSha256(doc?.items);
        if (digest) {
            digests.push(contentDigest ? `${pid}:${digest}:${contentDigest}` : `${pid}:${digest}`);
        }
    }
    if (digests.length === 0) return null;
    return createHash('sha256').update(digests.join('|')).digest('hex');
}

const KNOWN_SECTION_HEADER_REGEX =
    /^(DESEMPE[ÑN]O NOMINAL( Y EJES DIFERENCIADORES)?|DESEMPE[ÑN]O Y CAPACIDADES NOMINALES|PLANTA MOTRIZ|POTENCIA Y CONSUMOS|CONSUMOS DE (COMBUSTIBLE|ENERG[ÍI]A).*|EFICIENCIA ENERG[ÉE]TICA.*|VALORIZACI[ÓO]N PATRIMONIAL.*|TREN DE POTENCIA|TREN MOTRIZ( HEAVY-DUTY)?|SISTEMA DE TRABAJO|HIDR[ÁA]ULICA E IMPLEMENTOS|GEOMETR[ÍI]A Y (MASAS|PESOS)|GEOMETR[ÍI]A E INSTALACI[ÓO]N|SERVICIO, ELECTRICIDAD Y CABINA|SERVICIO Y CONTROL|CAPACIDADES Y ELECTRICIDAD|CHASIS Y (RODADO|SUSPENSI[ÓO]N.*)|FRENADO Y RETARDO.*|TELEMETR[ÍI]A.*|CONFIGURACI[ÓO]N DE TOLVA.*|AUTOMATIZACI[ÓO]N Y TELEMETR[ÍI]A|DIRECCI[ÓO]N, FRENADO.*|HERRAMIENTA DE TRABAJO.*|ETAPA\s+[IVX]+\s*—.*)$/i;

export function normalizeSwappedPillarItemFields<T extends { title: string; section: string }>(item: T): T {
    const rawTitle = String(item.title || '').trim();
    const rawSection = String(item.section || '').trim();
    if (!rawTitle || !rawSection) return item;

    const titleIsKnownSection = KNOWN_SECTION_HEADER_REGEX.test(rawTitle);
    const sectionIsKnownSection = KNOWN_SECTION_HEADER_REGEX.test(rawSection);

    if (
        (titleIsKnownSection && !sectionIsKnownSection && rawSection.length > rawTitle.length) ||
        (rawTitle === rawTitle.toUpperCase() && rawTitle.length <= 38 && rawSection.length >= rawTitle.length + 10 && !sectionIsKnownSection)
    ) {
        return {
            ...item,
            title: rawSection,
            section: rawTitle.toUpperCase(),
        };
    }
    return item;
}

/**
 * Verificador Neuro-Simbólico de Cobertura del Anillo 1 (`ensureRing1CoreCoverage`):
 * Garantiza determinísticamente en 0 ms que ningún capítulo obligatorio `CRÍTICO` del Anillo 1 (`core_chapters`)
 * haya sido omitido por el LLM (respetando siempre cualquier capítulo descartado explícitamente por un humano).
 */
function ensureRing1CoreCoverage(
    rawItems: Array<{
        title: string;
        section: string;
        rationale: string;
        priority: string;
        standard?: string;
        is_conditional_subsystem?: boolean;
        source_indices?: number[];
    }>,
    elasticBlueprint: EquipmentTypePillarBlueprint | null,
    existingItems: PillarItem[]
): typeof rawItems {
    const normalizedInput = rawItems.map((r) => normalizeSwappedPillarItemFields(r));
    if (!elasticBlueprint || !Array.isArray(elasticBlueprint.core_chapters)) {
        return normalizedInput;
    }
    const result = [...normalizedInput];
    const discardedExisting = existingItems.filter((it) => it.is_discarded);

    for (const core of elasticBlueprint.core_chapters) {
        if (core.priority !== 'CRÍTICO') continue;
        const wasDiscardedByHuman = discardedExisting.some(
            (d) =>
                normalizeComparableTitle(d.title) === normalizeComparableTitle(core.title_es) ||
                tokenJaccardSimilarity(d.title, core.title_es) >= 0.48
        );
        if (wasDiscardedByHuman) continue;

        const coreSectionPrefix = String(core.section_es || '')
            .split('—')[0]
            .trim()
            .toUpperCase();
        const combinedCore = `${core.title_es} ${core.section_es || ''}`.toLowerCase();
        const isConsumptionCore =
            core.chapter_key === 'matriz_energetica_consumos_y_autonomia' ||
            DEDICATED_CONSUMPTION_ITEM_REGEX.test(combinedCore);
        const isCapexCore =
            core.chapter_key === 'valorizacion_capex_vida_economica_y_depreciacion' ||
            DEDICATED_CAPEX_ITEM_REGEX.test(combinedCore);
        const isWearRodadoCore =
            core.chapter_key === 'etapa_5_recambio_elementos_desgaste_get_y_rodado' ||
            DEDICATED_WEAR_RODADO_ITEM_REGEX.test(combinedCore);

        const alreadyCovered = result.some((r) => {
            const combinedCandidate = `${r.title} ${r.section || ''}`.toLowerCase();
            if (isConsumptionCore) {
                return DEDICATED_CONSUMPTION_ITEM_REGEX.test(combinedCandidate);
            }
            if (isCapexCore) {
                return DEDICATED_CAPEX_ITEM_REGEX.test(combinedCandidate);
            }
            if (isWearRodadoCore) {
                return DEDICATED_WEAR_RODADO_ITEM_REGEX.test(combinedCandidate);
            }
            if (tokenJaccardSimilarity(r.title, core.title_es) >= 0.34) return true;
            if (tokenJaccardSimilarity(r.section, core.section_es) >= 0.34) return true;
            if (tokenJaccardSimilarity(r.title, core.section_es) >= 0.48) return true;
            if (tokenJaccardSimilarity(r.section, core.title_es) >= 0.48) return true;
            if (tokenJaccardSimilarity(combinedCandidate, combinedCore) >= 0.36) return true;
            if (
                coreSectionPrefix.length >= 6 &&
                (String(r.section || '').toUpperCase().includes(coreSectionPrefix) ||
                    String(r.title || '').toUpperCase().includes(coreSectionPrefix))
            ) {
                return true;
            }
            return false;
        });

        if (!alreadyCovered) {
            result.push({
                title: core.title_es,
                section: core.section_es,
                rationale: core.rationale_es,
                priority: core.priority,
                is_conditional_subsystem: false,
                source_indices: [0],
            });
        }
    }

    return result;
}


/**
 * Fusión Inteligente No Destructiva (`mergeItemizedStructure`):
 * Conserva el 100% de los ítems preexistentes (creados por ingesta de PDF/láminas, cazas previas,
 * bloqueos humanos `is_human_locked` o alta manual) e incorpora únicamente los capítulos nuevos
 * que aún no existían en la estructura del pilar.
 */
export function mergeItemizedStructure(
    existingItems: PillarItem[],
    incomingItems: PillarItem[]
): { mergedItems: PillarItem[]; preservedCount: number; addedCount: number } {
    if (!Array.isArray(existingItems) || existingItems.length === 0) {
        const indexed = incomingItems.map((it, idx) => ({
            ...it,
            order: idx + 1,
        }));
        return {
            mergedItems: indexed,
            preservedCount: 0,
            addedCount: indexed.length,
        };
    }

    const activeExisting = existingItems.filter((it) => !it.is_discarded);
    const discardedExisting = existingItems.filter((it) => it.is_discarded);

    // Conservar todo ítem existente que tenga contenido, figuras, candado humano, creación manual o propuestas pendientes
    const preserved: PillarItem[] = activeExisting.map((it) => ({ ...it }));
    const newlyAdded: PillarItem[] = [];

    for (const incoming of incomingItems) {
        const incNorm = normalizeComparableTitle(incoming.title);
        if (!incNorm) continue;

        // Si el usuario ya había descartado explícitamente este capítulo, respetar el descarte humano
        const wasExplicitlyDiscarded = discardedExisting.some(
            (d) =>
                normalizeComparableTitle(d.title) === incNorm ||
                tokenJaccardSimilarity(d.title, incoming.title) >= 0.55
        );
        if (wasExplicitlyDiscarded) continue;

        // Buscar si ya existe un capítulo equivalente en `preserved`
        const incomingCombo = `${incoming.title} ${incoming.section || ''}`;
        const incomingIsDedicatedConsumption = DEDICATED_CONSUMPTION_ITEM_REGEX.test(incomingCombo);
        const incomingIsDedicatedCapex = DEDICATED_CAPEX_ITEM_REGEX.test(incomingCombo);
        const incomingIsDedicatedWearRodado = DEDICATED_WEAR_RODADO_ITEM_REGEX.test(incomingCombo);
        let bestIdx = -1;
        let bestSim = 0;
        for (let i = 0; i < preserved.length; i++) {
            const preservedCombo = `${preserved[i].title} ${preserved[i].section || ''}`;
            const preservedIsDedicatedConsumption = DEDICATED_CONSUMPTION_ITEM_REGEX.test(preservedCombo);
            const preservedIsDedicatedCapex = DEDICATED_CAPEX_ITEM_REGEX.test(preservedCombo);
            const preservedIsDedicatedWearRodado = DEDICATED_WEAR_RODADO_ITEM_REGEX.test(preservedCombo);
            // Evitar que los capítulos dedicados de Consumos, CAPEX o Desgaste/Rodado sean absorbidos por otros capítulos
            if (
                incomingIsDedicatedConsumption !== preservedIsDedicatedConsumption ||
                incomingIsDedicatedCapex !== preservedIsDedicatedCapex ||
                incomingIsDedicatedWearRodado !== preservedIsDedicatedWearRodado
            ) {
                continue;
            }
            if (
                (incomingIsDedicatedConsumption && preservedIsDedicatedConsumption) ||
                (incomingIsDedicatedCapex && preservedIsDedicatedCapex) ||
                (incomingIsDedicatedWearRodado && preservedIsDedicatedWearRodado)
            ) {
                bestIdx = i;
                bestSim = 1;
                break;
            }
            const pNorm = normalizeComparableTitle(preserved[i].title);
            if (pNorm === incNorm) {
                bestIdx = i;
                bestSim = 1;
                break;
            }
            const sim = tokenJaccardSimilarity(preserved[i].title, incoming.title);
            const simSection = tokenJaccardSimilarity(preserved[i].section || '', incoming.section || '');
            const simCross1 = tokenJaccardSimilarity(preserved[i].title, incoming.section || '');
            const simCross2 = tokenJaccardSimilarity(preserved[i].section || '', incoming.title);
            const effectiveSim = Math.max(sim, simSection * 0.88, simCross1 * 0.92, simCross2 * 0.92);
            if (effectiveSim > bestSim) {
                bestSim = effectiveSim;
                bestIdx = i;
            }
        }

        if (bestIdx !== -1 && bestSim >= 0.36) {
            const target = preserved[bestIdx];
            // Enriquecer fuentes sin tocar jamás `content`, `figures` ni `is_human_locked`
            const existingUrls = new Set((target.item_sources || []).map((s) => s.url));
            const mergedSources = [...(target.item_sources || [])];
            for (const s of incoming.item_sources || []) {
                if (s?.url && !existingUrls.has(s.url)) {
                    existingUrls.add(s.url);
                    mergedSources.push(s);
                }
            }
            preserved[bestIdx] = {
                ...target,
                section:
                    !target.section || target.section === 'GENERAL' || target.section === 'DOCUMENTACIÓN OEM'
                        ? incoming.section
                        : target.section,
                item_sources: mergedSources,
            };
        } else {
            newlyAdded.push(incoming);
        }
    }

    const combinedActive = [...preserved, ...newlyAdded].map((it, idx) => ({
        ...it,
        order: idx + 1,
    }));

    return {
        mergedItems: [...combinedActive, ...discardedExisting],
        preservedCount: preserved.length,
        addedCount: newlyAdded.length,
    };
}

/**
 * Auto-Saneamiento Determinista del Ítem Base de Consumos en `ficha_tecnica`:
 * Garantiza que cualquier activo cuyo Pilar 01 (`Ficha Técnica OEM`) ya haya sido itemizado
 * posea siempre en su listado de capítulos (`knowledge_vault.ficha_tecnica.items`) un `PillarItem`
 * dedicado e interactivo para Consumos (Combustible, Energía, Aire Comprimido, DEF/AdBlue, Otros)
 * adaptado al tipo de equipo.
 */
export function ensureFichaTecnicaConsumptionBaseItem(params: {
    items: PillarItem[];
    typeDoc: Pick<GlobalEquipmentTypeDoc, 'type_key' | 'canonical_type_es' | 'categoria_equipo' | 'archetype_id'>;
    defaultSources?: ItemizedSource[];
}): { items: PillarItem[]; modified: boolean } {
    const rawExisting = Array.isArray(params.items) ? params.items : [];
    const activeRaw = rawExisting.filter((it) => !it?.is_discarded);
    if (activeRaw.length === 0) {
        return { items: rawExisting, modified: false };
    }

    let modified = false;

    // 1. Normalizar cualquier inversión accidental entre `title` y `section`
    const normalizedItems = rawExisting.map((it) => {
        if (it?.is_discarded) return it;
        const norm = normalizeSwappedPillarItemFields(it);
        if (norm.title !== it.title || norm.section !== it.section) {
            modified = true;
            return norm;
        }
        return it;
    });

    // 2. Deduplicar capítulos equivalentes (conservando siempre el que tenga `content` o `is_human_locked`)
    const dedupedActive: PillarItem[] = [];
    const discardedList: PillarItem[] = normalizedItems.filter((it) => it?.is_discarded);
    for (const candidate of normalizedItems.filter((it) => !it?.is_discarded)) {
        const candCombo = `${candidate.title || ''} ${candidate.section || ''}`;
        const candIsConsumption = DEDICATED_CONSUMPTION_ITEM_REGEX.test(candCombo);
        const candIsCapex = DEDICATED_CAPEX_ITEM_REGEX.test(candCombo);
        const dupIdx = dedupedActive.findIndex((existingItem) => {
            const existCombo = `${existingItem.title || ''} ${existingItem.section || ''}`;
            const existIsConsumption = DEDICATED_CONSUMPTION_ITEM_REGEX.test(existCombo);
            const existIsCapex = DEDICATED_CAPEX_ITEM_REGEX.test(existCombo);
            if (candIsConsumption !== existIsConsumption || candIsCapex !== existIsCapex) return false;
            if ((candIsConsumption && existIsConsumption) || (candIsCapex && existIsCapex)) return true;
            const sameSection =
                String(existingItem.section || '').trim().toUpperCase() ===
                String(candidate.section || '').trim().toUpperCase();
            return (
                normalizeComparableTitle(existingItem.title) === normalizeComparableTitle(candidate.title) ||
                tokenJaccardSimilarity(existingItem.title, candidate.title) >= (sameSection ? 0.42 : 0.56)
            );
        });

        if (dupIdx === -1) {
            dedupedActive.push(candidate);
        } else {
            modified = true;
            const prev = dedupedActive[dupIdx];
            const prevHasContent = Boolean(prev.content && prev.content.trim());
            const candHasContent = Boolean(candidate.content && candidate.content.trim());
            if (!prevHasContent && candHasContent) {
                dedupedActive[dupIdx] = {
                    ...candidate,
                    title: candidate.title.length >= prev.title.length ? candidate.title : prev.title,
                    section: prev.section || candidate.section,
                };
            }
        }
    }

    let working = [...dedupedActive, ...discardedList];
    const fallbackSources =
        Array.isArray(params.defaultSources) && params.defaultSources.length > 0
            ? params.defaultSources.slice(0, 4)
            : dedupedActive.find((it) => Array.isArray(it.item_sources) && it.item_sources.length > 0)?.item_sources?.slice(0, 4) || [];
    const nowIso = new Date().toISOString();

    // 3. Garantizar capítulo dedicado de Consumos (salvo descarte humano explícito)
    const wasConsumptionDiscarded = working.some(
        (it) =>
            it?.is_discarded &&
            DEDICATED_CONSUMPTION_ITEM_REGEX.test(`${it.title || ''} ${it.section || ''}`)
    );
    if (!wasConsumptionDiscarded) {
        const core = buildDedicatedConsumptionCoreChapter(params.typeDoc);
        const existingIdx = working.findIndex(
            (it) =>
                !it?.is_discarded &&
                DEDICATED_CONSUMPTION_ITEM_REGEX.test(`${it.title || ''} ${it.section || ''}`)
        );
        if (existingIdx !== -1) {
            const current = working[existingIdx];
            if (
                !current.is_human_locked &&
                current.title !== core.title_es &&
                (/^Matriz\s+Energ[eé]tica\b/i.test(current.title || '') ||
                    /\bDEF\s*\/\s*AdBlue\b/i.test(current.title || '') ||
                    /^Consumos\s+de\s+Combustible/i.test(current.title || ''))
            ) {
                modified = true;
                working = working.map((it, idx) =>
                    idx === existingIdx
                        ? {
                              ...it,
                              title: core.title_es,
                              section: core.section_es,
                              rationale: core.rationale_es,
                          }
                        : it
                );
            }
        } else {
            modified = true;
            working.push({
                item_id: slugifyItemId('ficha_tecnica', core.title_es, working.length),
                order: 3,
                title: core.title_es,
                section: core.section_es,
                rationale: core.rationale_es,
                priority: 'CRÍTICO',
                content: null,
                content_status: 'PENDIENTE',
                created_at: nowIso,
                item_sources: fallbackSources,
                is_discarded: false,
                estado_aprobacion: 'GENERADO_IA',
                is_human_locked: false,
                historial_cambios: [],
                pending_conflicts: [],
                authorized_delta_buffer: [],
                symbology_refs: [],
            });
        }
    }

    // 4. Garantizar capítulo dedicado de Valorización Referencial (CAPEX) y Base de Depreciación (salvo descarte humano explícito)
    const wasCapexDiscarded = working.some(
        (it) =>
            it?.is_discarded &&
            DEDICATED_CAPEX_ITEM_REGEX.test(`${it.title || ''} ${it.section || ''}`)
    );
    if (!wasCapexDiscarded) {
        const capexCore = buildDedicatedCapexCoreChapter(params.typeDoc);
        const existingCapexIdx = working.findIndex(
            (it) =>
                !it?.is_discarded &&
                DEDICATED_CAPEX_ITEM_REGEX.test(`${it.title || ''} ${it.section || ''}`)
        );
        if (existingCapexIdx === -1) {
            modified = true;
            working.push({
                item_id: slugifyItemId('ficha_tecnica', capexCore.title_es, working.length),
                order: working.length + 1,
                title: capexCore.title_es,
                section: capexCore.section_es,
                rationale: capexCore.rationale_es,
                priority: 'CRÍTICO',
                content: null,
                content_status: 'PENDIENTE',
                created_at: nowIso,
                item_sources: fallbackSources,
                is_discarded: false,
                estado_aprobacion: 'GENERADO_IA',
                is_human_locked: false,
                historial_cambios: [],
                pending_conflicts: [],
                authorized_delta_buffer: [],
                symbology_refs: [],
            });
        }
    }

    if (!modified) {
        return { items: rawExisting, modified: false };
    }
    return {
        items: sortAndReindexPillarItems('ficha_tecnica', working),
        modified: true,
    };
}

/**
 * Auto-Saneamiento Determinista del Ítem Base de Elementos de Desgaste (GET) y Tren de Rodado en `pauta_mantencion`:
 * Garantiza que cualquier activo cuyo Pilar 03 (`Pauta de Mantención`) ya haya sido itemizado
 * posea siempre en `ETAPA V` su capítulo dedicado de recambio de piezas de desgaste y rodado.
 */
export function ensurePautaMantencionWearAndRodadoBaseItem(params: {
    items: PillarItem[];
    typeDoc: Pick<GlobalEquipmentTypeDoc, 'type_key' | 'canonical_type_es' | 'categoria_equipo' | 'archetype_id'>;
    defaultSources?: ItemizedSource[];
}): { items: PillarItem[]; modified: boolean } {
    const rawExisting = Array.isArray(params.items) ? params.items : [];
    const activeRaw = rawExisting.filter((it) => !it?.is_discarded);
    if (activeRaw.length === 0) {
        return { items: rawExisting, modified: false };
    }

    const wasDiscarded = rawExisting.some(
        (it) =>
            it?.is_discarded &&
            DEDICATED_WEAR_RODADO_ITEM_REGEX.test(`${it.title || ''} ${it.section || ''}`)
    );
    if (wasDiscarded) {
        return { items: rawExisting, modified: false };
    }

    const wearCore = buildDedicatedWearAndRodadoCoreChapter(params.typeDoc);
    const existingIdx = rawExisting.findIndex(
        (it) =>
            !it?.is_discarded &&
            DEDICATED_WEAR_RODADO_ITEM_REGEX.test(`${it.title || ''} ${it.section || ''}`)
    );
    if (existingIdx !== -1) {
        const current = rawExisting[existingIdx];
        if (!current.is_human_locked && (current.title !== wearCore.title_es || current.section !== wearCore.section_es)) {
            const updated = rawExisting.map((it, idx) =>
                idx === existingIdx
                    ? {
                          ...it,
                          title: wearCore.title_es,
                          section: wearCore.section_es,
                          rationale: wearCore.rationale_es,
                      }
                    : it
            );
            return {
                items: sortAndReindexPillarItems('pauta_mantencion', updated),
                modified: true,
            };
        }
        return { items: rawExisting, modified: false };
    }

    const fallbackSources =
        Array.isArray(params.defaultSources) && params.defaultSources.length > 0
            ? params.defaultSources.slice(0, 4)
            : activeRaw.find((it) => Array.isArray(it.item_sources) && it.item_sources.length > 0)?.item_sources?.slice(0, 4) || [];

    const nowIso = new Date().toISOString();
    const newItem: PillarItem = {
        item_id: slugifyItemId('pauta_mantencion', wearCore.title_es, rawExisting.length),
        order: rawExisting.length + 1,
        title: wearCore.title_es,
        section: wearCore.section_es,
        rationale: wearCore.rationale_es,
        priority: 'CRÍTICO',
        content: null,
        content_status: 'PENDIENTE',
        created_at: nowIso,
        item_sources: fallbackSources,
        is_discarded: false,
        estado_aprobacion: 'GENERADO_IA',
        is_human_locked: false,
        historial_cambios: [],
        pending_conflicts: [],
        authorized_delta_buffer: [],
        symbology_refs: [],
    };

    const sorted = sortAndReindexPillarItems('pauta_mantencion', [...rawExisting, newItem]);
    return { items: sorted, modified: true };
}

export async function itemizeSinglePillar(
    globalAssetId: string,
    pillarId: PillarId,
    options?: { actorId?: string; actorEmail?: string; forceSmartMerge?: boolean }
): Promise<{
    pillar: PillarDocument;
    items: PillarItem[];
    classified_sources: ItemizedSource[];
    totalItems: number;
    preservedItemsCount?: number;
    addedItemsCount?: number;
}> {
    const agent = PILLAR_AGENTS[pillarId];
    if (!agent) {
        throw new Error(`Pilar inválido: ${pillarId}`);
    }

    const assetRef = db.collection('global_asset_catalog').doc(globalAssetId);
    const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
    if (!hydrated.exists || !hydrated.data) {
        throw new Error(`Activo ${globalAssetId} no encontrado en global_asset_catalog.`);
    }

    const assetData = hydrated.data;
    if (assetData.isSealed === true || assetData.is_sealed === true || assetData.knowledge_vault?.is_sealed === true) {
        const err: any = new Error('La bóveda maestra está sellada (HTTP 403). Desbloquéela antes de itemizar.');
        err.statusCode = 403;
        throw err;
    }

    const profileCheck = validateCatalogProfileGate(assetData);
    if (!profileCheck.valid) {
        const err: any = new Error(
            `Perfil técnico base incompleto para itemizar (${profileCheck.missingFields.join(', ')}).`
        );
        err.statusCode = 422;
        err.missingFields = profileCheck.missingFields;
        throw err;
    }

    // COMPUERTA DE SECUENCIA LÓGICA DE 5 PILARES (`01 ➔ 02 ➔ 03 ➔ 04 ➔ 05`):
    // Ningún pilar puede itemizarse si el pilar inmediatamente anterior no cuenta con capítulos activos.
    const prerequisitePillarId = PILLAR_PREREQUISITE_MAP[pillarId];
    if (prerequisitePillarId) {
        const prereqPillar = assetData.knowledge_vault?.[prerequisitePillarId];
        const prereqActiveItems = Array.isArray(prereqPillar?.items)
            ? prereqPillar.items.filter((it: any) => !it?.is_discarded)
            : [];
        if (prereqActiveItems.length === 0) {
            const prereqLabel = PILLAR_LABELS[prerequisitePillarId] || prerequisitePillarId;
            const currentLabel = PILLAR_LABELS[pillarId] || pillarId;
            const err: any = new Error(
                `[SECUENCIA LÓGICA DE 5 PILARES] Para itemizar "${currentLabel}", debe completar primero el itemizado de "${prereqLabel}".`
            );
            err.statusCode = 409;
            err.prerequisitePillarId = prerequisitePillarId;
            throw err;
        }
    }

    const makeOficial = String(assetData.make_oficial || assetData.make || 'GENÉRICO');
    const modelOficial = String(assetData.model_oficial || assetData.model || globalAssetId);
    const makeModel = assetData.make_model || `${makeOficial} ${modelOficial}`;
    const [minItems, maxItems] = agent.itemRange;

    // Marcar inicio de itemización del pilar en repositorio particionado Anti-1MiB
    const vaultInit = assetData.knowledge_vault || createEmptyKnowledgeVault(makeModel);
    const generatingPillarDoc: PillarDocument = {
        ...(vaultInit[pillarId] || createEmptyKnowledgeVault(makeModel)[pillarId]),
        pillar_id: pillarId,
        make_model: makeModel,
        itemize_status: 'GENERATING',
        started_at: new Date().toISOString(),
        itemize_error: null,
        items: Array.isArray(vaultInit[pillarId]?.items) ? vaultInit[pillarId].items : [],
    };
    await VaultPersistenceService.savePillarDocument({
        globalAssetId,
        pillarId,
        pillarDoc: generatingPillarDoc,
    });

    try {
        // 1. Resolver Ontología por `TIPO` (`global_equipment_types/{typeKey}`) y `canonical_specs` de Etapa 1
        const typeResolution = await resolveOrLearnEquipmentType({
            rawTypeHint: String(assetData.equipment_type_key || assetData.tipo_equipo || ''),
            rawCategoryHint: String(assetData.categoria_equipo || ''),
            assetQueryContext: makeModel,
        });
        const typeDoc = typeResolution.typeDoc;
        const canonicalSpecs: CanonicalSpecSlot[] = Array.isArray(assetData.canonical_specs)
            ? assetData.canonical_specs
            : [];
        const verifiedSpecsLines = canonicalSpecs
            .filter((s) => s?.label_es)
            .map(
                (s) =>
                    `  • ${s.label_es}: ${
                        s.value_si || `[Magnitud obligatoria a cubrir en Ficha Técnica — Unidad SI: ${s.unit_si || 'SI'}]`
                    }`
            )
            .join('\n');

        // 2. Consultar primero el Corpus Soberano Local en `southamerica-west1` (`SOVEREIGN_VAULT_FIRST`)
        const sovereignCorpus = await loadSovereignLocalCorpusForPillar(globalAssetId, pillarId, makeOficial);

        // 2.b Recolectar fuentes verificadas heredadas de pilares previos (`01 ➔ 02 ➔ 03 ➔ 04 ➔ 05`)
        const priorPillarSources: ItemizedSource[] = [];
        const seenPriorUrls = new Set<string>(sovereignCorpus.sovereignSources.map((s) => s.url));
        for (const pId of SEQUENTIAL_PILLAR_ORDER) {
            if (pId === pillarId) break;
            const pDoc = assetData.knowledge_vault?.[pId];
            const pSources: ItemizedSource[] = Array.isArray(pDoc?.classified_sources_itemized)
                ? pDoc.classified_sources_itemized
                : [];
            for (const src of pSources) {
                if (src?.url && !seenPriorUrls.has(src.url)) {
                    seenPriorUrls.add(src.url);
                    priorPillarSources.push(src);
                }
            }
        }

        // 3. Construir el Contexto Ontológico Elástico en 2 Anillos (`ficha_tecnica`, `manual_operaciones`, `pauta_mantencion`) + Herencia Acumulativa
        const elasticBlueprint =
            pillarId === 'ficha_tecnica'
                ? resolveElasticFichaTecnicaBlueprint(typeDoc)
                : pillarId === 'manual_operaciones'
                ? resolveElasticManualOperacionesBlueprint(typeDoc)
                : pillarId === 'pauta_mantencion'
                ? resolveElasticPautaMantencionBlueprint(typeDoc)
                : pillarId === 'matriz_riesgos'
                ? resolveElasticMatrizRiesgosBlueprint(typeDoc)
                : pillarId === 'checklist_pre_op'
                ? resolveElasticChecklistPreOpBlueprint(typeDoc)
                : null;

        const cumulativePriorContext = buildCumulativePriorPillarsContext(assetData.knowledge_vault, pillarId);

        const ring1CoreText = elasticBlueprint
            ? elasticBlueprint.core_chapters
                  .map(
                      (c, idx) =>
                          `  ${idx + 1}. [${c.section_es}] "${c.title_es}" (${c.priority}) — ${c.rationale_es}`
                  )
                  .join('\n')
            : '';

        const ring2ConditionalText = elasticBlueprint
            ? elasticBlueprint.conditional_subsystems
                  .map(
                      (c) =>
                          `  • [${c.section_es}] "${c.title_es}" (Activar SOLO si "${makeModel}" posee: ${c.trigger_keywords.join(', ')}) — ${c.rationale_es}`
                  )
                  .join('\n')
            : '';

        const lockedVariantDirective = buildLockedVariantDirective(assetData);

        const profileSummary = [
            `- Marca / Modelo Oficial: ${makeModel}`,
            `- TIPO Canónico de Equipo (Ontología MINREPORT): ${typeDoc.canonical_type_es} (key: ${typeDoc.type_key})`,
            `- Categoría: ${assetData.categoria_equipo || typeDoc.categoria_equipo}`,
            `- Ambientes Operativos: ${(assetData.ambiente_operativo || []).join(', ')}`,
            `- Contexto Operativo: ${(assetData.contexto_operativo || []).join(', ')}`,
            `- Características Duras: ${(assetData.caracteristicas_principales || []).join(' | ')}`,
            verifiedSpecsLines
                ? `\nEJES FÍSICOS DIFERENCIADORES DEL TIPO (${typeDoc.canonical_type_es}) RESUELTOS EN ETAPA 1:\n${verifiedSpecsLines}`
                : '',
            lockedVariantDirective ? `\n${lockedVariantDirective}` : '',
            cumulativePriorContext
                ? `\nHERENCIA ACUMULATIVA DE PILARES PREVIOS CONFIRMADOS (OBLIGATORIO MANTENER TRAZABILIDAD 1 A 1 CON ESTOS SUBSISTEMAS):\n${cumulativePriorContext}`
                : '',
            ring1CoreText
                ? `\nANILLO 1 — CAPÍTULOS BASALES OBLIGATORIOS DEL TIPO (${typeDoc.canonical_type_es}):\n${ring1CoreText}`
                : '',
            ring2ConditionalText
                ? `\nANILLO 2 — CATÁLOGO DE SUBSISTEMAS CONDICIONALES CONOCIDOS EN ESTE TIPO (Activar solo si corresponden a "${makeModel}"):\n${ring2ConditionalText}`
                : '',
            sovereignCorpus.digestText
                ? `\nEVIDENCIA SOBERANA LOCAL EN BÓVEDA (southamerica-west1 — Manuales/ETT ya ingeridos):\n${sovereignCorpus.digestText}`
                : '',
        ]
            .filter(Boolean)
            .join('\n');

        const pass1ResearchPrompt = `${agent.taskItemize(makeModel, profileSummary)}

REGLA DE PRESENCIA POSITIVA ESTRICTA (CERO CAPÍTULOS DE SUBSISTEMAS INEXISTENTES):
- Crea capítulos EXCLUSIVAMENTE para sistemas, órganos de trabajo, transmisiones y postratamientos físicamente instalados en "${makeModel}".
- PROHIBIDO crear capítulos para declarar que un subsistema "No aplica", "No posee" o está ausente (ej. jamás crear capítulos de SCR/DEF/AdBlue en motores sin SCR o equipos eléctricos/neumáticos; jamás crear capítulos de embrague manual en cajas automáticas/hidrostáticas; jamás crear capítulos de cabina en herramientas o unidades sin cabina).

REGLA DE CARDINALIDAD ELÁSTICA POR COMPLEJIDAD REAL DEL MODELO (${minItems} a ${maxItems} capítulos):
- NO apliques un número fijo de capítulos. La cantidad total de capítulos debe reflejar fielmente la complejidad física real de "${makeModel}":
  * Si "${makeModel}" es un activo simple (ej. furgón utilitario liviano 4x2, compresor portátil o herramienta manual), incluye únicamente sus 5 a 6 capítulos reales del Anillo 1 sin inventar subsistemas inexistentes.
  * Si "${makeModel}" es un activo Heavy-Duty o Ultra-Class de alta complejidad (ej. Ford F-350 Super Duty con PTO/Quinta Rueda/DRW o CAEX CAT 797F con motor 20 cilindros cuádruple turbo, convertidor Lock-Up, frenos húmedos enfriados por aceite con retardo ARC, enfriamiento de ejes RAX, pesaje TPMS 10/10/20, etc.), despliega TODOS los capítulos adicionales necesarios (10, 14, 18 o más capítulos) para que ningún subsistema técnico real quede omitido ni comprimido.

PROTOCOLO DE INVESTIGACIÓN MULTILINGÜE (SOVEREIGN VAULT + GOOGLE SEARCH):
Combina la evidencia local de la bóveda con Google Search (en español, inglés "${makeModel} specification sheet brochure manual" y portugués) y redacta el listado técnico estructurado de capítulos con su título en español, sección funcional en MAYÚSCULAS, justificación técnica (rationale), prioridad (CRÍTICO, IMPORTANTE o COMPLEMENTARIO) e indica si es un subsistema especializado/condicional del modelo.`;

        const initialSourcesPool: ItemizedSource[] = [
            ...sovereignCorpus.sovereignSources,
            ...priorPillarSources.filter(
                (ps) => !sovereignCorpus.sovereignSources.some((ls) => ls.url === ps.url)
            ),
        ];

        const itemizeResponseSchema = {
            type: Type.OBJECT,
            properties: {
                items: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            section: { type: Type.STRING },
                            rationale: { type: Type.STRING },
                            priority: { type: Type.STRING },
                            standard: { type: Type.STRING },
                            is_conditional_subsystem: { type: Type.BOOLEAN },
                            source_indices: {
                                type: Type.ARRAY,
                                items: { type: Type.INTEGER },
                            },
                        },
                        required: ['title', 'section', 'rationale', 'priority'],
                    },
                },
            },
            required: ['items'],
        };

        let allAvailableSources: ItemizedSource[] = [...initialSourcesPool];
        let webClassifiedSources: ItemizedSource[] = [];
        let rawItems: Array<{
            title: string;
            section: string;
            rationale: string;
            priority: string;
            standard?: string;
            is_conditional_subsystem?: boolean;
            source_indices?: number[];
        }> = [];

        // Optimización VEL-01 & SEC-01 (`SOVEREIGN_VAULT_FIRST`):
        // Single-Pass Structured Synthesis cuando:
        // - Es un pilar derivado (02..05) con herencia acumulativa y fuentes verificadas, O
        // - Es el Pilar 01 (`ficha_tecnica`) y ya posee manuales OEM ingeridos en la bóveda soberana (`southamerica-west1`).
        const hasStrongSovereignLocalCorpus =
            sovereignCorpus.sovereignSources.length >= 1 &&
            sovereignCorpus.digestText.length >= 500;
        const canUseSinglePassSynthesis =
            (pillarId !== 'ficha_tecnica' &&
                Boolean(cumulativePriorContext) &&
                (sovereignCorpus.sovereignSources.length > 0 || initialSourcesPool.length >= 1)) ||
            (pillarId === 'ficha_tecnica' && hasStrongSovereignLocalCorpus);

        if (canUseSinglePassSynthesis) {
            try {
                const numberedInitialSources = initialSourcesPool
                    .map((s, idx) => `[${idx}] (${s.type}) ${s.author}: ${s.description} — ${s.url}`)
                    .join('\n');

                const { data: singlePassParsed } = await ResilientAIClient.generateStructured<{
                    items: typeof rawItems;
                }>({
                    module: 'opermaq',
                    preferredTier: 'SECONDARY',
                    systemInstruction: agent.systemPrompt,
                    temperature: 0,
                    topP: 1,
                    topK: 1,
                    thinkingLevel: 'low',
                    maxOutputTokens: 8192,
                    responseSchema: itemizeResponseSchema,
                    prompt: `${pass1ResearchPrompt}\n\nMODO SÍNTESIS ESTRUCTURADA DIRECTA (SINGLE-PASS):\nGenera directamente todos los capítulos técnicos reales (entre ${minItems} y ${maxItems} ítems según la complejidad demostrada de "${makeModel}"). Asigna en "source_indices" los índices [0..${Math.max(0, initialSourcesPool.length - 1)}] de las fuentes verificadas disponibles; indica en "standard" la norma aplicable si corresponde; marca "is_conditional_subsystem": true en aquellos capítulos que correspondan a subsistemas especializados del modelo.\n\nFuentes verificadas disponibles:\n${numberedInitialSources || '(Evidencia soberana en bóveda)'}`,
                });

                if (Array.isArray(singlePassParsed?.items) && singlePassParsed.items.length >= Math.min(4, minItems)) {
                    rawItems = singlePassParsed.items;
                }
            } catch {
                // Fallback transparente a doble pasada con Google Search si Single-Pass falla
                rawItems = [];
            }
        }

        if (rawItems.length === 0) {
            let aiText = '';
            let groundingSources: Array<{ uri: string; title: string }> = [];

            try {
                const aiResponse = await ResilientAIClient.generate({
                    module: 'opermaq',
                    preferredTier: 'SECONDARY',
                    systemInstruction: agent.systemPrompt,
                    temperature: 0,
                    topP: 1,
                    topK: 1,
                    thinkingLevel: 'low',
                    maxOutputTokens: 8192,
                    useGoogleSearch: true,
                    requireGroundedEvidence:
                        sovereignCorpus.sovereignSources.length === 0 &&
                        priorPillarSources.length === 0 &&
                        !cumulativePriorContext,
                    prompt: pass1ResearchPrompt,
                });
                aiText = aiResponse.text;
                groundingSources = aiResponse.groundingSources || [];
            } catch (err) {
                if (err instanceof UngroundedEvidenceError) {
                    const fallbackLocalRes = await ResilientAIClient.generate({
                        module: 'opermaq',
                        preferredTier: 'SECONDARY',
                        systemInstruction: agent.systemPrompt,
                        temperature: 0,
                        topP: 1,
                        topK: 1,
                        thinkingLevel: 'low',
                        maxOutputTokens: 8192,
                        useGoogleSearch: false,
                        requireGroundedEvidence: false,
                        prompt: `${pass1ResearchPrompt}\n\nNOTA: Fundamenta el índice directamente en la HERENCIA ACUMULATIVA DE PILARES PREVIOS CONFIRMADOS, la EVIDENCIA SOBERANA LOCAL EN BÓVEDA y el Anillo 1 + Anillo 2 del TIPO (${typeDoc.canonical_type_es}).`,
                    });
                    aiText = fallbackLocalRes.text;
                } else {
                    throw err;
                }
            }

            webClassifiedSources = await classifySourcesByAuthorship(
                groundingSources,
                makeOficial,
                modelOficial
            );

            allAvailableSources = [
                ...sovereignCorpus.sovereignSources,
                ...webClassifiedSources.filter(
                    (ws) => !sovereignCorpus.sovereignSources.some((ls) => ls.url === ws.url)
                ),
                ...priorPillarSources.filter(
                    (ps) =>
                        !sovereignCorpus.sovereignSources.some((ls) => ls.url === ps.url) &&
                        !webClassifiedSources.some((ws) => ws.url === ps.url)
                ),
            ];

            const numberedSourcesContext = allAvailableSources
                .map((s, idx) => `[${idx}] (${s.type}) ${s.author}: ${s.description} — ${s.url}`)
                .join('\n');

            const { data: parsed } = await ResilientAIClient.generateStructured<{
                items: typeof rawItems;
            }>({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                temperature: 0,
                topP: 1,
                topK: 1,
                thinkingLevel: 'low',
                maxOutputTokens: 8192,
                responseSchema: itemizeResponseSchema,
                prompt: `Extrae determinísticamente todos los capítulos técnicos reales (entre ${minItems} y ${maxItems} ítems según la complejidad demostrada del modelo "${makeModel}") desde el siguiente informe técnico:\n\n"""\n${aiText.slice(0, 18000)}\n"""\n\nFuentes verificadas disponibles (asigna en "source_indices" los índices [0..${Math.max(0, allAvailableSources.length - 1)}] que respaldan cada capítulo; indica en "standard" la norma aplicable si corresponde, ej. "ISO 6750 / DS 132", "ISO 20474", "SAE J1349"; marca "is_conditional_subsystem": true en aquellos capítulos que correspondan a subsistemas avanzados o particulares del modelo más allá del núcleo básico):\n${numberedSourcesContext || '(Sin índice numérico adicional)'}`,
            });

            rawItems = Array.isArray(parsed.items) ? parsed.items : [];
        }

        rawItems = filterPositivePresenceItemCandidates(rawItems, assetData, typeDoc);

        if (rawItems.length === 0) {
            throw new Error(`El agente especialista de ${pillarId} no devolvió capítulos válidos.`);
        }

        // 4. Aprendizaje Ascendente Sin Techo: si se descubrieron subsistemas condicionales nuevos en `01..05`,
        // enriquecer `global_equipment_types/{typeKey}.pillar_blueprints`
        if (
            (pillarId === 'ficha_tecnica' ||
                pillarId === 'manual_operaciones' ||
                pillarId === 'pauta_mantencion' ||
                pillarId === 'matriz_riesgos' ||
                pillarId === 'checklist_pre_op') &&
            typeDoc.type_key
        ) {
            const newlyDiscovered = rawItems
                .filter((r) => r.is_conditional_subsystem === true && r.title && r.rationale)
                .map((r) => ({
                    title_es: String(r.title).trim(),
                    section_es: String(r.section || 'SUBSISTEMA ESPECIALIZADO').trim().toUpperCase(),
                    rationale_es: String(r.rationale).trim(),
                }));
            if (newlyDiscovered.length > 0) {
                if (pillarId === 'ficha_tecnica') {
                    void evolveEquipmentTypeFichaTecnicaBlueprint({
                        typeKey: typeDoc.type_key,
                        modelOficial: makeModel,
                        discoveredSubsystems: newlyDiscovered,
                    });
                } else if (pillarId === 'manual_operaciones') {
                    void evolveEquipmentTypeManualOperacionesBlueprint({
                        typeKey: typeDoc.type_key,
                        modelOficial: makeModel,
                        discoveredSubsystems: newlyDiscovered,
                    });
                } else if (pillarId === 'pauta_mantencion') {
                    void evolveEquipmentTypePautaMantencionBlueprint({
                        typeKey: typeDoc.type_key,
                        modelOficial: makeModel,
                        discoveredSubsystems: newlyDiscovered,
                    });
                } else if (pillarId === 'matriz_riesgos') {
                    void evolveEquipmentTypeMatrizRiesgosBlueprint({
                        typeKey: typeDoc.type_key,
                        modelOficial: makeModel,
                        discoveredSubsystems: newlyDiscovered,
                    });
                } else if (pillarId === 'checklist_pre_op') {
                    void evolveEquipmentTypeChecklistPreOpBlueprint({
                        typeKey: typeDoc.type_key,
                        modelOficial: makeModel,
                        discoveredSubsystems: newlyDiscovered,
                    });
                }
            }
        }

        const freshHydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
        const freshData = freshHydrated.data || assetData;
        const vault = freshData.knowledge_vault || createEmptyKnowledgeVault(makeModel);
        const existingItems: PillarItem[] = Array.isArray(vault[pillarId]?.items) ? vault[pillarId].items : [];

        // IC-04: Garantizar cobertura determinista del Anillo 1 (`core_chapters`) antes de construir candidatos
        const verifiedRawItems = ensureRing1CoreCoverage(rawItems, elasticBlueprint, existingItems);

        const nowIso = new Date().toISOString();
        const candidateItems: PillarItem[] = verifiedRawItems.slice(0, maxItems).map((r, index) => {
            const rawPrio = String(r.priority || 'IMPORTANTE').toUpperCase();
            const priority: 'CRÍTICO' | 'IMPORTANTE' | 'COMPLEMENTARIO' =
                rawPrio === 'CRÍTICO' || rawPrio === 'CRITICO'
                    ? 'CRÍTICO'
                    : rawPrio === 'COMPLEMENTARIO'
                    ? 'COMPLEMENTARIO'
                    : 'IMPORTANTE';

            const mappedSources = Array.isArray(r.source_indices)
                ? r.source_indices
                      .map((idx) => allAvailableSources[Number(idx)])
                      .filter((s): s is ItemizedSource => Boolean(s))
                : [];
            const itemSources =
                mappedSources.length > 0 ? mappedSources : allAvailableSources.slice(0, 4);

            return {
                item_id: slugifyItemId(pillarId, String(r.title), index),
                order: index + 1,
                title: String(r.title).trim(),
                section: String(r.section || 'ESPECIFICACIÓN TÉCNICA').trim().toUpperCase(),
                rationale: String(r.rationale || 'Especificación técnica del equipo').trim(),
                priority,
                ...(r.standard ? { standard: String(r.standard).trim() } : {}),
                content: null,
                content_status: 'PENDIENTE',
                created_at: nowIso,
                item_sources: itemSources,
                is_discarded: false,
                estado_aprobacion: 'GENERADO_IA',
                is_human_locked: false,
                historial_cambios: [],
                pending_conflicts: [],
                authorized_delta_buffer: [],
                symbology_refs: [],
            };
        });

        // 5. Fusión No Destructiva con cualquier ítem existente (de ingesta PDF previa o curaduría manual)
        const { mergedItems: rawMergedItems, preservedCount, addedCount } = mergeItemizedStructure(
            existingItems,
            candidateItems
        );

        // IC-01 & IC-02: Ordenamiento determinista para los 5 pilares (`01..05`)
        const mergedItems = sortAndReindexPillarItems(pillarId, rawMergedItems);

        // W3-01 & CAD-02: Cadena Criptográfica Merkle Acumulativa entre Pilares (`structure_digest_sha256` + `parent_pillar_digest_sha256`)
        const parentPillarDigestSha256 = prerequisitePillarId
            ? computeCumulativeAncestorDigestSha256(vault, pillarId)
            : null;
        const structureDigestSha256 =
            computePillarStructureDigestSha256(mergedItems, parentPillarDigestSha256) || '';
        const contentDigestSha256 = computePillarContentDigestSha256(mergedItems);

        const finalPillar: PillarDocument = {
            ...(vault[pillarId] || createEmptyKnowledgeVault(makeModel)[pillarId]),
            pillar_id: pillarId,
            status: 'COMPLETED',
            make_model: makeModel,
            itemize_status: 'COMPLETED',
            itemized_at: nowIso,
            itemize_error: null,
            items: mergedItems,
            classified_sources_itemized: allAvailableSources,
            suggested_items_pending: vault[pillarId]?.suggested_items_pending || [],
            structure_digest_sha256: structureDigestSha256,
            content_digest_sha256: contentDigestSha256,
            parent_pillar_digest_sha256: parentPillarDigestSha256,
            updated_at: nowIso,
        };

        vault[pillarId] = finalPillar;
        const vaultMerkleRootSha256 = computeVaultMerkleRootSha256(vault);

        // IC-03 & Anti-1MiB: Persistir pilar en `pillars/{pillarId}` y resumen ligero + Merkle Root en documento raíz
        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId,
            pillarDoc: finalPillar,
            vaultMerkleRootSha256,
            extraRootUpdates: {
                equipment_type_key: assetData.equipment_type_key || typeDoc.type_key,
            },
        });

        if (pillarId === 'ficha_tecnica' || pillarId === 'pauta_mantencion') {
            await buildAndPersistEquipmentCostMatrix(globalAssetId).catch(() => null);
        }

        // 6. Trazabilidad Criptográfica Inmutable en `AuditLedger` (SHA-256 + Merkle Root)
        void AuditLedger.record({
            tenantId: 'GLOBAL_OEM',
            actorUid: options?.actorId || 'SYSTEM_CURATOR',
            actorEmail: options?.actorEmail || 'system@minreport.com',
            module: 'opermaq',
            action: preservedCount > 0 ? 'VAULT_PILLAR_REITEMIZED_MERGE' : 'VAULT_PILLAR_ITEMIZED',
            targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}`,
            details: {
                makeModel,
                pillarId,
                equipmentTypeKey: typeDoc.type_key,
                totalActiveItems: mergedItems.filter((it) => !it.is_discarded).length,
                preservedItemsCount: preservedCount,
                addedItemsCount: addedCount,
                sovereignSourcesCount: sovereignCorpus.sovereignSources.length,
                webSourcesCount: webClassifiedSources.length,
                structureDigestSha256,
                parentPillarDigestSha256,
                vaultMerkleRootSha256,
            },
        }).catch(() => undefined);

        return {
            pillar: finalPillar,
            items: finalPillar.items,
            classified_sources: allAvailableSources,
            totalItems: finalPillar.items.filter((it) => !it.is_discarded).length,
            preservedItemsCount: preservedCount,
            addedItemsCount: addedCount,
        };
    } catch (err: any) {
        const errNow = new Date().toISOString();
        await Promise.all([
            assetRef
                .collection('pillars')
                .doc(pillarId)
                .set(
                    {
                        pillar_id: pillarId,
                        itemize_status: 'ERROR',
                        started_at: null,
                        itemize_error: err?.message || 'Error en itemización.',
                        updated_at: errNow,
                    },
                    { merge: true }
                )
                .catch(() => {}),
            assetRef
                .update({
                    [`knowledge_vault.${pillarId}.itemize_status`]: 'ERROR',
                    [`knowledge_vault.${pillarId}.started_at`]: null,
                    [`knowledge_vault.${pillarId}.itemize_error`]: err?.message || 'Error en itemización.',
                    [`knowledge_vault.${pillarId}.updated_at`]: errNow,
                    updatedAt: Date.now(),
                })
                .catch(() => {}),
        ]);
        throw err;
    }
}

export async function suggestComplementaryPillarItems(
    globalAssetId: string,
    pillarId: PillarId
): Promise<Array<{ title: string; rationale: string; section: string; source?: ItemizedSource }>> {
    const agent = PILLAR_AGENTS[pillarId];
    if (!agent) throw new Error(`Pilar inválido: ${pillarId}`);

    const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
    if (!hydrated.exists || !hydrated.data) throw new Error(`Activo ${globalAssetId} no encontrado.`);

    const assetData = hydrated.data;
    const makeOficial = String(assetData.make_oficial || assetData.make || 'GENÉRICO');
    const modelOficial = String(assetData.model_oficial || assetData.model || globalAssetId);
    const makeModel = assetData.make_model || `${makeOficial} ${modelOficial}`;

    const vault = assetData.knowledge_vault || createEmptyKnowledgeVault(makeModel);
    const currentItems: PillarItem[] = vault[pillarId]?.items || [];
    const currentPending = vault[pillarId]?.suggested_items_pending || [];

    const existingList = [
        ...currentItems.map((i) => ({
            title: i.title,
            section: i.section,
            status: i.is_discarded ? 'DESCARTADO' : 'ACTIVO',
        })),
        ...currentPending.map((p: any) => ({
            title: p.title,
            section: p.section,
            status: 'SUGERENCIA_PENDIENTE',
        })),
    ];

    // Consultar ontología elástica del TIPO y corpus soberano local
    const [typeResolution, sovereignCorpus] = await Promise.all([
        resolveOrLearnEquipmentType({
            rawTypeHint: String(assetData.equipment_type_key || assetData.tipo_equipo || ''),
            rawCategoryHint: String(assetData.categoria_equipo || ''),
            assetQueryContext: makeModel,
        }),
        loadSovereignLocalCorpusForPillar(globalAssetId, pillarId, makeOficial),
    ]);

    const elasticBlueprint =
        pillarId === 'ficha_tecnica'
            ? resolveElasticFichaTecnicaBlueprint(typeResolution.typeDoc)
            : pillarId === 'manual_operaciones'
            ? resolveElasticManualOperacionesBlueprint(typeResolution.typeDoc)
            : pillarId === 'pauta_mantencion'
            ? resolveElasticPautaMantencionBlueprint(typeResolution.typeDoc)
            : pillarId === 'matriz_riesgos'
            ? resolveElasticMatrizRiesgosBlueprint(typeResolution.typeDoc)
            : pillarId === 'checklist_pre_op'
            ? resolveElasticChecklistPreOpBlueprint(typeResolution.typeDoc)
            : null;
    const candidateSubsystemsHint = elasticBlueprint
        ? elasticBlueprint.conditional_subsystems
              .map((s) => `- [${s.section_es}] ${s.title_es}: ${s.rationale_es}`)
              .join('\n')
        : '';

    const cumulativePriorContext = buildCumulativePriorPillarsContext(vault, pillarId);
    const priorPillarSources: ItemizedSource[] = [];
    const seenPriorUrls = new Set<string>(sovereignCorpus.sovereignSources.map((s) => s.url));
    for (const pId of SEQUENTIAL_PILLAR_ORDER) {
        if (pId === pillarId) break;
        const pSources: ItemizedSource[] = Array.isArray(vault[pId]?.classified_sources_itemized)
            ? vault[pId].classified_sources_itemized
            : [];
        for (const src of pSources) {
            if (src?.url && !seenPriorUrls.has(src.url)) {
                seenPriorUrls.add(src.url);
                priorPillarSources.push(src);
            }
        }
    }

    const researchPrompt = `Audita como "${agent.rolePersona}" el índice actual del pilar "${agent.title}" para el equipo "${makeModel}" (TIPO: ${typeResolution.typeDoc.canonical_type_es}).
Ítems ya registrados o descartados (PROHIBIDO repetir o solapar):
${JSON.stringify(existingList, null, 2)}

${cumulativePriorContext ? `Herencia acumulativa de pilares previos confirmados (verifica si algún subsistema confirmado en pilares previos aún no tiene su capítulo correspondiente en este pilar):\n${cumulativePriorContext}\n` : ''}
${candidateSubsystemsHint ? `Subsistemas condicionales de referencia para este TIPO (sugerir SOLO si "${makeModel}" realmente los posee y aún no están en la lista):\n${candidateSubsystemsHint}\n` : ''}
${sovereignCorpus.digestText ? `Evidencia soberana en bóveda local (southamerica-west1):\n${sovereignCorpus.digestText}\n` : ''}
Usa Google Search para contrastar contra el manual oficial OEM y fichas técnicas de "${makeModel}". Identifica entre 1 y 3 subsistemas o capítulos técnicos reales del modelo que falten en el índice actual.`;

    let aiText = '';
    let groundingSources: Array<{ uri: string; title: string }> = [];
    try {
        const aiResponse = await ResilientAIClient.generate({
            module: 'opermaq',
            preferredTier: 'SECONDARY',
            systemInstruction: agent.systemPrompt,
            temperature: 0,
            topP: 1,
            topK: 1,
            thinkingLevel: 'low',
            useGoogleSearch: true,
            requireGroundedEvidence:
                sovereignCorpus.sovereignSources.length === 0 &&
                priorPillarSources.length === 0 &&
                !cumulativePriorContext,
            prompt: researchPrompt,
        });
        aiText = aiResponse.text;
        groundingSources = aiResponse.groundingSources || [];
    } catch (err) {
        if (err instanceof UngroundedEvidenceError) {
            const fallbackRes = await ResilientAIClient.generate({
                module: 'opermaq',
                preferredTier: 'SECONDARY',
                systemInstruction: agent.systemPrompt,
                temperature: 0,
                topP: 1,
                topK: 1,
                thinkingLevel: 'low',
                useGoogleSearch: false,
                requireGroundedEvidence: false,
                prompt: researchPrompt,
            });
            aiText = fallbackRes.text;
        } else {
            throw err;
        }
    }

    const webSources = await classifySourcesByAuthorship(
        groundingSources,
        makeOficial,
        modelOficial
    );
    const verifiedSourcesPool: ItemizedSource[] = [
        ...sovereignCorpus.sovereignSources,
        ...webSources.filter((w) => !sovereignCorpus.sovereignSources.some((l) => l.url === w.url)),
        ...priorPillarSources.filter(
            (ps) =>
                !sovereignCorpus.sovereignSources.some((l) => l.url === ps.url) &&
                !webSources.some((w) => w.url === ps.url)
        ),
    ];

    const poolContext = verifiedSourcesPool
        .map((s, idx) => `[${idx}] (${s.type}) ${s.author}: ${s.description} — ${s.url}`)
        .join('\n');

    const { data: structured } = await ResilientAIClient.generateStructured<{
        suggestions: Array<{
            title: string;
            rationale: string;
            section: string;
            source_index: number;
        }>;
    }>({
        module: 'opermaq',
        preferredTier: 'ANCHOR_HA',
        temperature: 0,
        topP: 1,
        topK: 1,
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                suggestions: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            rationale: { type: Type.STRING },
                            section: { type: Type.STRING },
                            source_index: { type: Type.INTEGER },
                        },
                        required: ['title', 'rationale', 'section', 'source_index'],
                    },
                },
            },
            required: ['suggestions'],
        },
        prompt: `Extrae hasta 3 sugerencias de capítulos técnicos complementarios para "${makeModel}" desde el análisis siguiente. No inventes URLs; referencia en "source_index" el índice [0..${Math.max(0, verifiedSourcesPool.length - 1)}] de la fuente real que lo respalda:\n\nAnálisis:\n"""\n${aiText.slice(0, 10000)}\n"""\n\nFuentes verificadas:\n${poolContext || '[0] Fuente técnica verificada'}`,
    });

    const rawSuggestions = filterPositivePresenceItemCandidates(
        Array.isArray(structured.suggestions) ? structured.suggestions : [],
        assetData,
        typeResolution.typeDoc
    );
    const updatedPending = [...currentPending];

    for (const s of rawSuggestions.slice(0, 4)) {
        const title = String(s.title || '').trim();
        if (!title) continue;
        const exists =
            updatedPending.some((p) => tokenJaccardSimilarity(p.title, title) >= 0.45) ||
            currentItems.some((p) => tokenJaccardSimilarity(p.title, title) >= 0.45);
        if (!exists) {
            const matchedSource =
                verifiedSourcesPool[Number(s.source_index)] || verifiedSourcesPool[0];
            updatedPending.push({
                title,
                rationale: String(s.rationale || '').trim(),
                section: String(s.section || 'SUBSISTEMA COMPLEMENTARIO').trim().toUpperCase(),
                ...(matchedSource ? { source: matchedSource } : {}),
            });
        }
    }

    const currentPillarDoc: PillarDocument = {
        ...(vault[pillarId] || createEmptyKnowledgeVault(makeModel)[pillarId]),
        pillar_id: pillarId,
        make_model: makeModel,
        items: currentItems,
        suggested_items_pending: updatedPending,
        updated_at: new Date().toISOString(),
    };
    await VaultPersistenceService.savePillarDocument({
        globalAssetId,
        pillarId,
        pillarDoc: currentPillarDoc,
    });

    return updatedPending;
}
