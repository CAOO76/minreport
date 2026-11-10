import React, { useMemo } from 'react';
import type { PillarDocument, PillarId, PillarItem } from '../types/vault';
import { extractExplicitSymbolIds, isTrustedMasterSymbol } from '../utils/symbologyExplicitMention';
import { M3LinearProgress } from './M3ProgressIndicator';

export interface CompiledHuntedSymbolEntry {
    concept_id: string;
    iso_code?: string;
    category: string;
    technical_name_es: string;
    description_es: string;
    icon_url: string;
    source_mode: string;
    applications: Array<{
        pillar_id: PillarId;
        pillar_label: string;
        item_id: string;
        item_title: string;
        context_excerpt: string;
    }>;
}

export interface LiveHuntedSymbologyResult {
    entries: CompiledHuntedSymbolEntry[];
    huntedItemsCount: number;
    totalActiveItemsCount: number;
}

interface PillarMetaLite {
    id: PillarId;
    label: string;
}

export function useLiveHuntedSymbology(params: {
    knowledgeVault?: Partial<Record<PillarId, PillarDocument>>;
    make?: string;
    compiledEntries?: Array<{
        concept_id: string;
        iso_code?: string;
        category?: string;
        technical_name_es?: string;
        description_es?: string;
        icon_url?: string;
    }>;
    masterSymbols: Record<string, any>;
    pillars: ReadonlyArray<PillarMetaLite>;
}): LiveHuntedSymbologyResult {
    const { knowledgeVault, make, compiledEntries, masterSymbols, pillars } = params;

    return useMemo(() => {
        const makeKey = (make || '').toLowerCase().trim();
        let huntedItemsCount = 0;
        let totalActiveItemsCount = 0;

        const byConcept = new Map<string, CompiledHuntedSymbolEntry>();

        const extractExcerptForMarker = (
            content: string,
            needle: string,
            fallbackTitle: string,
            pillarLabel: string
        ): string => {
            const lines = content
                .split(/\n+/)
                .map((l) => l.replace(/^[#>*\-\d.)\s|]+/, '').trim())
                .filter((l) => l.length > 8);
            const lowerNeedle = needle.toLowerCase();
            const matchedLine = lines.find((l) => l.toLowerCase().includes(lowerNeedle));
            const cleanLine = (
                matchedLine ||
                lines[0] ||
                `Aplicado en contenido técnico de "${fallbackTitle}" (${pillarLabel})`
            )
                .replace(/\[[sS][íÍiI][mM][bB][oO][lL][oO]:\s*[a-zA-Z0-9_-]+\]/g, '')
                .replace(/\*\*|\*|`/g, '')
                .replace(/\s{2,}/g, ' ')
                .trim();
            return cleanLine.length > 210 ? `${cleanLine.slice(0, 207)}...` : cleanLine;
        };

        const registerSymbolFromHuntedItem = (
            cid: string,
            pillarMeta: PillarMetaLite,
            item: PillarItem,
            needleForExcerpt: string
        ) => {
            const symData = masterSymbols[cid];
            if (symData && !isTrustedMasterSymbol(symData)) return;
            const masterLoaded = Object.keys(masterSymbols || {}).length > 0;
            const packFallback = masterLoaded
                ? undefined
                : compiledEntries?.find((e) => e.concept_id === cid);
            if (!symData && !packFallback) return;

            const brandVariant = symData?.brands_variants?.[makeKey];
            const hasBrandUrl = Boolean(
                brandVariant?.verified_by_human && brandVariant?.asset_storage_url
            );
            const iconUrl: string = hasBrandUrl
                ? brandVariant.asset_storage_url
                : symData?.standard_icon_url || packFallback?.icon_url || '';
            if (!iconUrl) return;

            const excerpt = extractExcerptForMarker(
                String(item.content || ''),
                needleForExcerpt,
                item.title,
                pillarMeta.label
            );

            const existing = byConcept.get(cid);
            if (existing) {
                if (
                    !existing.applications.some(
                        (a) => a.pillar_id === pillarMeta.id && a.item_id === item.item_id
                    )
                ) {
                    existing.applications.push({
                        pillar_id: pillarMeta.id,
                        pillar_label: pillarMeta.label,
                        item_id: item.item_id,
                        item_title: item.title,
                        context_excerpt: excerpt,
                    });
                }
                return;
            }

            byConcept.set(cid, {
                concept_id: cid,
                iso_code: symData?.iso_code || packFallback?.iso_code || undefined,
                category: symData?.category || packFallback?.category || 'ISO_7000',
                technical_name_es:
                    symData?.technical_name_es || packFallback?.technical_name_es || cid,
                description_es:
                    brandVariant?.brand_specific_meaning_es ||
                    symData?.action_operator_es ||
                    symData?.description_es ||
                    packFallback?.description_es ||
                    '[Información técnica no declarada en ficha]',
                icon_url: iconUrl,
                source_mode: hasBrandUrl ? 'BRAND_VARIANT' : 'STANDARD_ISO_FALLBACK',
                applications: [
                    {
                        pillar_id: pillarMeta.id,
                        pillar_label: pillarMeta.label,
                        item_id: item.item_id,
                        item_title: item.title,
                        context_excerpt: excerpt,
                    },
                ],
            });
        };

        if (knowledgeVault) {
            for (const pMeta of pillars) {
                const items = knowledgeVault[pMeta.id]?.items ?? [];
                for (const item of items) {
                    if (!item || item.is_discarded) continue;
                    totalActiveItemsCount += 1;

                    const huntedContent =
                        typeof item.content === 'string' ? item.content.trim() : '';
                    if (item.content_status !== 'COMPLETADO' || !huntedContent) continue;
                    huntedItemsCount += 1;

                    const explicitIds = extractExplicitSymbolIds(huntedContent, pMeta.id);
                    for (const cid of explicitIds) {
                        registerSymbolFromHuntedItem(cid, pMeta, item, `[SÍMBOLO: ${cid}]`);
                    }

                    if (Array.isArray(item.symbology_refs)) {
                        const explicitSet = new Set(explicitIds);
                        for (const refId of item.symbology_refs) {
                            const cid = typeof refId === 'string' ? refId.trim() : '';
                            if (cid && explicitSet.has(cid)) {
                                const symName = masterSymbols[cid]?.technical_name_es || cid;
                                registerSymbolFromHuntedItem(cid, pMeta, item, symName);
                            }
                        }
                    }
                }
            }
        }

        return {
            entries: Array.from(byConcept.values()),
            huntedItemsCount,
            totalActiveItemsCount,
        };
    }, [knowledgeVault, make, compiledEntries, masterSymbols, pillars]);
}

export interface VaultSymbologyReadOnlyPanelProps {
    liveHuntedSymbology: LiveHuntedSymbologyResult;
}

export const VaultSymbologyReadOnlyPanel: React.FC<VaultSymbologyReadOnlyPanelProps> = ({
    liveHuntedSymbology,
}) => {
    const { entries, huntedItemsCount, totalActiveItemsCount } = liveHuntedSymbology;

    return (
        <div className="flex flex-col h-full min-h-0 select-none font-atkinson">
            <div className="shrink-0 flex flex-wrap items-center justify-between gap-[13px] px-[21px] py-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                <div className="flex items-center gap-[13px] min-w-0">
                    <h1 className="text-[13px] font-bold uppercase tracking-widest text-[#0F172A] dark:text-[#F3F4F6] leading-none">
                        SIMBOLOGÍA TÉCNICA APLICADA AL EQUIPO
                    </h1>
                    <span className="font-mono tabular-nums text-[10px] font-bold uppercase text-[#5A6072]">
                        [SOLO LECTURA · ACTUALIZACIÓN AUTOMÁTICA POR CAZA DE CONTENIDOS]
                    </span>
                </div>

                <div className="flex items-center gap-[13px] shrink-0 ml-auto">
                    <div
                        className="flex items-center gap-[8px]"
                        title={`Ítems con contenido cazado analizados: ${huntedItemsCount}/${totalActiveItemsCount}`}
                    >
                        <M3LinearProgress
                            value={
                                totalActiveItemsCount > 0
                                    ? Math.round((huntedItemsCount / totalActiveItemsCount) * 100)
                                    : 0
                            }
                            tone={
                                totalActiveItemsCount > 0 &&
                                huntedItemsCount === totalActiveItemsCount
                                    ? 'cyan'
                                    : 'copper'
                            }
                            className="w-[89px]"
                            ariaLabel="Ítems cazados procesados"
                        />
                        <span className="text-[10px] font-bold font-mono tabular-nums text-[#00AEEF]">
                            {entries.length} SÍMBOLO(S) · {huntedItemsCount}/{totalActiveItemsCount}{' '}
                            ÍTEMS CAZADOS
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-[21px] py-[21px]">
                {huntedItemsCount === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center py-16 text-center max-w-lg mx-auto gap-[13px]">
                        <span className="material-symbols-outlined !text-[24px] text-[#5A6072]">
                            info
                        </span>
                        <p className="text-[12px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6] font-mono">
                            [SIN CONTENIDOS CAZADOS REGISTRADOS]
                        </p>
                        <p className="text-[12px] text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                            Esta sección es de solo lectura y se actualiza automáticamente a medida
                            que se ejecuta la caza de contenidos de cada ítem. Los títulos del
                            itemizado no generan simbología.
                        </p>
                    </div>
                ) : entries.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center py-16 text-center">
                        <p className="text-[13px] text-[#5A6072]">
                            [Información técnica no declarada en ficha]
                        </p>
                    </div>
                ) : (
                    <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] overflow-x-auto rounded-none shadow-none">
                        <table className="w-full border-collapse text-left">
                            <thead>
                                <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                                    <th className="p-[13px] text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] w-[89px]">
                                        SÍMBOLO
                                    </th>
                                    <th className="p-[13px] text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] w-[190px]">
                                        CÓDIGO / NORMA
                                    </th>
                                    <th className="p-[13px] text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6] w-[260px]">
                                        SIGNIFICADO TÉCNICO
                                    </th>
                                    <th className="p-[13px] text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                                        APLICACIÓN ESPECÍFICA EN EL EQUIPO (CAZA DE CONTENIDOS)
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((entry) => (
                                    <tr
                                        key={entry.concept_id}
                                        className="border-b border-[#E2E8F0] dark:border-[#12151C] last:border-b-0 align-top"
                                    >
                                        <td className="p-[13px]">
                                            <div className="w-[55px] h-[55px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] p-[8px] flex items-center justify-center rounded-none shadow-none">
                                                <img
                                                    src={entry.icon_url}
                                                    alt={entry.technical_name_es}
                                                    draggable={false}
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    style={
                                                        {
                                                            WebkitUserDrag: 'none',
                                                        } as React.CSSProperties
                                                    }
                                                    className="max-w-full max-h-full object-contain select-none pointer-events-none"
                                                />
                                            </div>
                                        </td>
                                        <td className="p-[13px] font-mono tabular-nums">
                                            <p className="text-[12px] font-bold text-[#0F172A] dark:text-[#F3F4F6] select-text">
                                                {entry.concept_id}
                                            </p>
                                            <p className="text-[11px] text-[#C68346] font-bold mt-[4px]">
                                                {entry.iso_code || entry.category}
                                            </p>
                                            <p className="text-[10px] text-[#5A6072] mt-[4px]">
                                                {entry.source_mode === 'BRAND_VARIANT'
                                                    ? 'OEM VERIFICADO'
                                                    : 'ESTÁNDAR ISO'}
                                            </p>
                                        </td>
                                        <td className="p-[13px]">
                                            <p className="text-[13px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                {entry.technical_name_es}
                                            </p>
                                            <p className="text-[12px] text-[#475569] dark:text-[#8A93A6] mt-[4px] leading-snug">
                                                {entry.description_es}
                                            </p>
                                        </td>
                                        <td className="p-[13px]">
                                            <div className="flex flex-col gap-[8px]">
                                                {entry.applications.map((ch, idx) => (
                                                    <div
                                                        key={`${entry.concept_id}-ch-${idx}`}
                                                        className="border-l-2 border-[#C68346] pl-[8px]"
                                                    >
                                                        <p className="font-mono tabular-nums text-[11px] font-bold text-[#00AEEF]">
                                                            [{ch.pillar_label}] {ch.item_title}
                                                        </p>
                                                        <p className="text-[12px] text-[#0F172A] dark:text-[#F3F4F6] mt-[2px] leading-snug">
                                                            {ch.context_excerpt}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

