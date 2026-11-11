/**
 * KnowledgeVaultDashboard — v9.0 ITEMIZADO + CAZA POR ÍTEM
 * Flujo: 1º ITEMIZADO por pilar → 2º CAZA on-demand por ítem.
 * Sin generación monolítica de pilares.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth, API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import {
  isTrustedMasterSymbol,
  sanitizeSpeculativeSymbolMarkers,
} from '../utils/symbologyExplicitMention';
import {
  buildSourceWhitelist,
  countItemPendingFigures,
  inferFigureTypeFromDescription,
  injectLegacyPendingMarkers,
  parsePendingMarker,
  PENDING_FIGURE_TYPES,
  type PendingFigureType,
  resolveWhitelistedSource,
  sourceLabel,
} from '../utils/pendingFigureMarkers';
import {
  normalizeProceduralStepsToMarkdownTable,
  stripRedundantNarrativeInTabularPillar,
} from '../utils/proceduralTableNormalizer';
import {
  computeItemPendingContentSummary,
  countUndeclaredTextInMarkdown,
  createUndeclaredContentRegex,
  PENDING_CONTENT_HIGHLIGHT_CLASS,
} from '../utils/pendingContentDetector';
import { toast } from 'react-toastify';
import { M3IconButton } from './M3IconButton';
import { M3Button } from './M3Button';
import { M3LinearProgress, M3CircularProgress } from './M3ProgressIndicator';
import { useTranslation } from 'react-i18next';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { syncQueueEngine } from '../../../core/offline/SyncQueueEngine';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { ItemFiguresAndAdvisoriesBlock, resolveMediaSrc, formatByteWeight } from './ItemFiguresAndAdvisoriesBlock';
import { OpermaqEngineeringStudioDrawer, type StudioTabId } from './OpermaqEngineeringStudioDrawer';
import type { PillarId, PillarDocument, PillarItem, ItemizedSource, ProposedUpdate, EstadoAprobacion, HistorialAuditoria, ChatMessage, ExtractedFigureRef, HuntIntent } from '../types/vault';
import { PILLAR_PREREQUISITE_MAP } from '../types/vault';
import type { AssetPhysicalTraits, EnergyConsumptionProfile, CanonicalSpecSlot, OperationalCostMatrix } from '../../../contracts';
import { EquipmentCostMatrixPanel } from './EquipmentCostMatrixPanel';
import {
  VaultCatalogSidebar,
  formatPhotoBytes,
  type OfficialPhotoCandidate,
  type SidebarCatalogPatch,
} from './VaultCatalogSidebar';
import {
  VaultSymbologyReadOnlyPanel,
  useLiveHuntedSymbology,
} from './VaultSymbologyReadOnlyPanel';
import { VaultPilotFeedbackBox } from './VaultPilotFeedbackBox';

// ─── Types ───────────────────────────────────────────────────────────────────
interface VaultDashboardProps {
  assetId: string;
  onBack: () => void;
}
interface CatalogSnapshot {
  id: string; makeModel: string; make?: string; categoria_equipo?: string;
  tipo_equipo?: string;
  is_sealed?: boolean;
  official_url?: string;
  foto_url?: string;
  foto_vlm_audit_version?: number | null;
  foto_media_telemetry?: {
    original_bytes: number;
    optimized_bytes: number;
    savings_pct: number;
    sha256?: string;
    updated_at?: string;
  };
  official_photo_candidates?: OfficialPhotoCandidate[];
  ambiente_operativo?: string[];
  contexto_operativo?: string[];
  caracteristicas_principales?: string[];
  physical_traits?: AssetPhysicalTraits;
  energy_consumption_profile?: EnergyConsumptionProfile;
  operational_cost_matrix?: OperationalCostMatrix;
  canonical_specs?: CanonicalSpecSlot[] | Record<string, any>;
  version?: string;
  knowledge_vault?: Partial<Record<PillarId, PillarDocument>>;
  symbology_pack?: {
    compiled_entries?: Array<{
      concept_id: string;
      iso_code?: string;
      category?: string;
      technical_name_es?: string;
      description_es?: string;
      icon_url?: string;
      source_mode?: string;
    }>;
  };
}

interface AiAssistResponse {
  success: boolean;
  intent: 'CORRECTION' | 'RESEARCH' | 'DELETION' | 'GENERAL';
  originalFragment?: string;
  proposedFragment?: string;
  additionalBlock?: string;
  finalContent?: string;
  clarification: string;
  error?: string;
}


// ─── Constants ───────────────────────────────────────────────────────────────
const PILLARS: Array<{ id: PillarId; stepCode: string; icon: string; romanNumeral: string; label: string; shortLabel: string; color: string; accent: string }> = [
  { id: 'ficha_tecnica', stepCode: '01', icon: 'fact_check', romanNumeral: '0', label: 'Ficha Técnica', shortLabel: 'Ficha Técnica', color: 'text-[#C68346]', accent: '#C68346' },
  { id: 'manual_operaciones', stepCode: '02', icon: 'settings', romanNumeral: 'I', label: 'Manual de Operaciones', shortLabel: 'Manual Oper.', color: 'text-[#C68346]', accent: '#C68346' },
  { id: 'pauta_mantencion', stepCode: '03', icon: 'build', romanNumeral: 'II', label: 'Pauta de Mantención', shortLabel: 'Pauta Mant.', color: 'text-[#C68346]', accent: '#C68346' },
  { id: 'matriz_riesgos', stepCode: '04', icon: 'security', romanNumeral: 'III', label: 'Matriz de Riesgos', shortLabel: 'Matriz Riesgos', color: 'text-[#C68346]', accent: '#C68346' },
  { id: 'checklist_pre_op', stepCode: '05', icon: 'rule', romanNumeral: 'IV', label: 'Checklist Pre-Op', shortLabel: 'Checklist Pre-Op', color: 'text-[#C68346]', accent: '#C68346' },
];

const SOURCE_ICONS: Record<string, string> = { OEM: 'precision_manufacturing', EXTERNO: 'school', YOUTUBE: 'smart_display', MANUAL: 'person' };
const SOURCE_COLORS: Record<string, string> = { OEM: 'text-[#00AEEF]', EXTERNO: 'text-[#C68346]', YOUTUBE: 'text-[#C68346]', MANUAL: 'text-[#475569] dark:text-[#8A93A6]' };


/**
 * Sanitizador defensivo: convierte HTML crudo en Markdown limpio.
 * Protege contra contenido generado antes de la restricción de formato.
 */
function sanitizeHtmlToMarkdown(raw: string, pillarId?: PillarId): string {
  if (!raw) return '';
  let s = raw;

  // Etiquetas de bloque → equivalentes Markdown o saltos de línea
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  s = s.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  s = s.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  s = s.replace(/<ul[^>]*>|<\/ul>/gi, '\n');
  s = s.replace(/<ol[^>]*>|<\/ol>/gi, '\n');
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  s = s.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '\n$1\n');
  s = s.replace(/<tr[^>]*>/gi, '\n');
  s = s.replace(/<\/tr>/gi, '');
  s = s.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, (_, inner) => `| **${String(inner).replace(/<br[^>]*\/?>|\r?\n/gi, ' — ').trim()}** `);
  s = s.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, (_, inner) => `| ${String(inner).replace(/<br[^>]*\/?>|\r?\n/gi, ' — ').trim()} `);
  s = s.replace(/<table[^>]*>|<\/table>|<thead[^>]*>|<\/thead>|<tbody[^>]*>|<\/tbody>/gi, '\n');
  s = s.replace(/<hr[^>]*\/?>/gi, '\n---\n');
  // En líneas de tabla Markdown (con `|`), `<br>` debe convertirse en separador inline ` — ` y NUNCA en `\n` (para no partir la fila)
  s = s
    .split('\n')
    .map((ln) => (ln.includes('|') ? ln.replace(/<br[^>]*\/?>/gi, ' — ') : ln))
    .join('\n');
  s = s.replace(/<br[^>]*\/?>/gi, '\n');

  // Etiquetas de estilo en línea → Markdown
  s = s.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  s = s.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  s = s.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  s = s.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Eliminar únicamente etiquetas HTML reales en una sola línea (preservando operadores matemáticos `< 50 °C` y `> 600 °C`)
  s = s.replace(/<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s+[^>\n]*)?>/g, '');

  // Decodificar entidades HTML comunes
  s = s.replace(/&amp;/g, '&');
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#39;/g, "'");
  s = s.replace(/&nbsp;/g, ' ');

  // Reconstruir determinísticamente tablas Markdown (`expectedCols` de 3 a 6 columnas en los 5 pilares)
  const splitTableCells = (ln: string): string[] =>
    ln
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  const isSeparatorLine = (ln: string): boolean => {
    const t = ln.trim();
    if (!t.startsWith('|')) return false;
    const cs = splitTableCells(t);
    return cs.length >= 2 && cs.every((c) => /^:?-{2,}:?$/.test(c));
  };
  const isBlockStarter = (t: string): boolean =>
    /^(?:#{1,6}\s|[-*]\s|>\s|!\[|---|\*\*REGLA\s+DE\s+BLOQUEO|REGLA\s+DE\s+BLOQUEO)/i.test(t);

  const rawLines = s.split('\n');
  const rejoinedLines: string[] = [];
  let expectedCols = 0;
  let idx = 0;
  while (idx < rawLines.length) {
    let cur = rawLines[idx];
    const trimmed = cur.trim();

    if (!trimmed) {
      if (expectedCols >= 2) {
        let peek = idx + 1;
        while (peek < rawLines.length && !rawLines[peek].trim()) peek++;
        if (peek < rawLines.length) {
          const nextNonEmpty = rawLines[peek].trim();
          const lineAfterNext = peek + 1 < rawLines.length ? rawLines[peek + 1].trim() : '';
          if (nextNonEmpty.startsWith('|') && !isSeparatorLine(lineAfterNext)) {
            idx = peek;
            continue;
          }
        }
        expectedCols = 0;
      }
      rejoinedLines.push(cur);
      idx++;
      continue;
    }

    if (isBlockStarter(trimmed)) {
      expectedCols = 0;
      rejoinedLines.push(cur);
      idx++;
      continue;
    }

    if (trimmed.startsWith('|')) {
      const nextLine = idx + 1 < rawLines.length ? rawLines[idx + 1].trim() : '';
      if (isSeparatorLine(nextLine)) {
        expectedCols = splitTableCells(trimmed).length;
        rejoinedLines.push(cur);
        rejoinedLines.push(rawLines[idx + 1]);
        idx += 2;
        continue;
      }

      while (idx + 1 < rawLines.length) {
        const curCells = splitTableCells(cur).length;
        const curEndsWithPipe = cur.trim().endsWith('|');
        const needsMoreCells = expectedCols >= 2 ? curCells < expectedCols : !curEndsWithPipe;

        let peek = idx + 1;
        if (needsMoreCells) {
          while (peek < rawLines.length && !rawLines[peek].trim()) peek++;
        }
        if (peek >= rawLines.length) break;

        const nextTrimmed = rawLines[peek].trim();
        if (!nextTrimmed || isBlockStarter(nextTrimmed) || isSeparatorLine(nextTrimmed)) break;

        const nextStartsWithPipe = nextTrimmed.startsWith('|');
        const nextHasPipe = nextTrimmed.includes('|');

        if ((!nextStartsWithPipe && nextHasPipe) || (needsMoreCells && (nextHasPipe || !curEndsWithPipe))) {
          if (curEndsWithPipe && nextStartsWithPipe) {
            cur = `${cur.trimEnd()} ${nextTrimmed.replace(/^\|\s*/, '')}`;
          } else if (curEndsWithPipe || nextStartsWithPipe) {
            cur = `${cur.trimEnd()} ${nextTrimmed}`;
          } else {
            cur = `${cur.trimEnd()} — ${nextTrimmed}`;
          }
          idx = peek;
        } else {
          break;
        }
      }

      if (!cur.trim().endsWith('|')) {
        cur = `${cur.trimEnd()} |`;
      }
      rejoinedLines.push(cur);
      idx++;
      continue;
    }

    expectedCols = 0;
    rejoinedLines.push(cur);
    idx++;
  }
  s = rejoinedLines.join('\n');

  // Estandarizar secuencias procedimentales numeradas / etiquetadas en Tablas Operativas de 4 columnas
  s = normalizeProceduralStepsToMarkdownTable(s, { pillarId });

  // Limpiar líneas vacías excesivas (más de 2 seguidas)
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

function highlightInNode(node: React.ReactNode, activeHighlightText?: string): React.ReactNode {
  if (!activeHighlightText || !activeHighlightText.trim()) return node;

  if (Array.isArray(node)) {
    return node.map((n, idx) => <React.Fragment key={idx}>{highlightInNode(n, activeHighlightText)}</React.Fragment>);
  }

  if (typeof node === 'string') {
    const query = activeHighlightText.trim();
    const index = node.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return node;

    const parts: React.ReactNode[] = [];
    let current = node;
    let idxKey = 0;
    while (true) {
      const idx = current.toLowerCase().indexOf(query.toLowerCase());
      if (idx === -1) {
        if (current) {
          parts.push(<React.Fragment key={`text-end-${idxKey}`}>{current}</React.Fragment>);
        }
        break;
      }
      if (idx > 0) {
        parts.push(<React.Fragment key={`text-pre-${idxKey++}`}>{current.substring(0, idx)}</React.Fragment>);
      }
      const matchText = current.substring(idx, idx + query.length);
      parts.push(
        <mark
          key={`mark-${idxKey++}-${Math.random()}`}
          className="bg-[#C68346]/20 text-[#0F172A] dark:text-[#F3F4F6] px-1 py-0.5 rounded-none border border-[#C68346]/40 font-bold inline-block shadow-none"
        >
          {matchText}
        </mark>
      );
      current = current.substring(idx + query.length);
    }
    return <React.Fragment>{parts}</React.Fragment>;
  }

  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>;
    const children = element.props.children;
    if (children) {
      const highlightedChildren = React.Children.map(children, child =>
        highlightInNode(child, activeHighlightText)
      );
      return React.cloneElement(element, { ...element.props, children: highlightedChildren });
    }
  }

  return node;
}

function highlightUndeclaredInNode(node: React.ReactNode): React.ReactNode {
  if (Array.isArray(node)) {
    return node.map((n, idx) => <React.Fragment key={`und-arr-${idx}`}>{highlightUndeclaredInNode(n)}</React.Fragment>);
  }

  if (typeof node === 'string') {
    const regex = createUndeclaredContentRegex();
    let match: RegExpExecArray | null = regex.exec(node);
    if (!match) return node;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let seq = 0;
    while (match !== null) {
      if (match.index > lastIndex) {
        parts.push(<React.Fragment key={`und-pre-${seq++}`}>{node.slice(lastIndex, match.index)}</React.Fragment>);
      }
      const matchedText = match[0];
      parts.push(
        <mark
          key={`und-mark-${seq++}`}
          data-pending-content-slot="true"
          data-pending-fragment={matchedText}
          className={PENDING_CONTENT_HIGHLIGHT_CLASS}
          title="Contenido pendiente de declaración — Clic para seleccionar y completar con OPERMAQ IA"
        >
          {matchedText}
        </mark>
      );
      lastIndex = match.index + matchedText.length;
      match = regex.exec(node);
    }
    if (lastIndex < node.length) {
      parts.push(<React.Fragment key={`und-end-${seq}`}>{node.slice(lastIndex)}</React.Fragment>);
    }
    return <React.Fragment>{parts}</React.Fragment>;
  }

  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ children?: React.ReactNode;['data-pending-content-slot']?: string }>;
    if (element.props?.['data-pending-content-slot']) return node;
    const children = element.props.children;
    if (children) {
      const highlightedChildren = React.Children.map(children, (child) => highlightUndeclaredInNode(child));
      return React.cloneElement(element, { ...element.props, children: highlightedChildren });
    }
  }

  return node;
}

const INLINE_SYMBOL_MARKER_REGEX = /\[[sS][íÍiI][mM][bB][oO][lL][oO]:\s*([a-zA-Z0-9_-]+)\]/g;

function cleanSymbolMarkersFromText(rawText: string): string {
  if (!rawText) return '';
  return rawText
    .replace(INLINE_SYMBOL_MARKER_REGEX, '')
    .replace(/\s+([.,;:?!)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractCleanTextAndSymbols(
  rawText: string,
  resolvedSymbology?: Array<{ concept_id: string; url: string; technical_name_es: string }>
): {
  cleanText: string;
  symbols: Array<{ concept_id: string; url: string; technical_name_es: string }>;
} {
  if (!rawText) return { cleanText: '', symbols: [] };
  const symbols: Array<{ concept_id: string; url: string; technical_name_es: string }> = [];
  const seenIds = new Set<string>();

  if (resolvedSymbology && resolvedSymbology.length > 0) {
    const re = new RegExp(INLINE_SYMBOL_MARKER_REGEX.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawText)) !== null) {
      const conceptId = m[1].trim();
      if (!conceptId || seenIds.has(conceptId)) continue;
      const sym = resolvedSymbology.find((s) => s.concept_id === conceptId);
      if (sym && sym.url) {
        seenIds.add(conceptId);
        symbols.push(sym);
      }
    }
  }

  return {
    cleanText: cleanSymbolMarkersFromText(rawText),
    symbols,
  };
}

function parseInlineStyles(
  text: string,
  activeHighlightText?: string,
  resolvedSymbology?: Array<{ concept_id: string; url: string; technical_name_es: string }>
): React.ReactNode[] {
  if (!text) return [];
  const result: React.ReactNode[] = [];
  // Tokenizador manual: detecta **bold**, *italic*, `code`, y [SÍMBOLO: id] en orden de precedencia
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)|(\[[sS][íÍiI][mM][bB][oO][lL][oO]:\s*([a-zA-Z0-9_-]+)\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) result.push(text.slice(last, m.index));
    if (m[1]) {
      result.push(<strong key={m.index} className="font-bold text-[#0F172A] dark:text-[#F3F4F6]">{m[2]}</strong>);
    } else if (m[3]) {
      result.push(<code key={m.index} className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] px-[4px] py-[1px] rounded-none text-[11px] font-mono tabular-nums text-[#C68346]">{m[4]}</code>);
    } else if (m[5]) {
      result.push(<em key={m.index} className="italic text-[#475569] dark:text-[#8A93A6]">{m[6]}</em>);
    } else if (m[7]) {
      const conceptId = m[8].trim();
      const sym = resolvedSymbology?.find(s => s.concept_id === conceptId);

      if (sym && sym.url) {
        result.push(
          <img
            key={m.index}
            src={sym.url}
            alt={sym.technical_name_es}
            title={sym.technical_name_es}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
            className="w-7 h-7 object-contain inline-block align-middle mx-[6px] my-[2px] select-none pointer-events-none rounded-none shadow-none cursor-help"
          />
        );
      }
      // Marcador no verificado o especulativo: se elimina limpiamente (Strict Explicit Mention Only, `SB-04`).
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) result.push(text.slice(last));

  const withUndeclaredHighlight = result.map((node) => highlightUndeclaredInNode(node));

  const processed = activeHighlightText
    ? withUndeclaredHighlight.map(node => highlightInNode(node, activeHighlightText))
    : withUndeclaredHighlight;

  return processed.map((node, idx) => (
    <React.Fragment key={`inline-${idx}`}>{node}</React.Fragment>
  ));
}

function renderBlockWithPictogramStrip(
  rawText: string,
  activeHighlightText?: string,
  resolvedSymbology?: Array<{ concept_id: string; url: string; technical_name_es: string }>
): React.ReactNode {
  const { cleanText, symbols } = extractCleanTextAndSymbols(rawText, resolvedSymbology);
  return (
    <>
      {parseInlineStyles(cleanText, activeHighlightText, resolvedSymbology)}
      {symbols.length > 0 && (
        <div className="mt-[8px] pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center gap-[8px] select-none">
          {symbols.map((sym) => (
            <img
              key={sym.concept_id}
              src={sym.url}
              alt={sym.technical_name_es}
              title={sym.technical_name_es}
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
              style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
              className="w-7 h-7 object-contain inline-block select-none pointer-events-none rounded-none shadow-none"
            />
          ))}
        </div>
      )}
    </>
  );
}

function cleanFuentesFromMarkdown(text: string): string {
  // 1. Detectar divisor --- seguido de sección de fuentes
  const separatorMatch = text.match(/\n---\s*\n(?:#+\s*)?(?:fuentes|sources|fuente|source)\b[:\s]*/i);
  if (separatorMatch && separatorMatch.index !== undefined) {
    return text.substring(0, separatorMatch.index).trim();
  }

  // 2. Detectar sección de fuentes directa
  const fuentesRegex = /\n(?:#+\s*)?(?:fuentes|sources|fuente|source)\b[:\s]*/i;
  const match = text.match(fuentesRegex);
  if (match && match.index !== undefined) {
    return text.substring(0, match.index).trim();
  }
  return text;
}

export interface PendingFigureCasPreview {
  sha256: string;
  downloadUrl: string;
  previewSrc: string;
  originalBytes: number;
  optimizedBytes: number;
  savingsPct: number;
}

export interface ConfirmPendingFigurePayload {
  description: string;
  sourceUrl?: string;
  pendingMarkerLine: string;
  figureType: PendingFigureType;
  confirmWord: string;
  cas: PendingFigureCasPreview;
}

class PendingFigureOfflineError extends Error {
  constructor() {
    super('OFFLINE');
    this.name = 'PendingFigureOfflineError';
  }
}

function PendingSectionFigureCard({
  description,
  sourceUrl,
  allSources,
  rawMarkerLine,
  canCurateAI,
  isSealed,
  isItemLocked,
  onUploadToCas,
  onConfirm,
}: {
  description: string;
  sourceUrl?: string;
  allSources?: ItemizedSource[];
  rawMarkerLine: string;
  canCurateAI?: boolean;
  isSealed?: boolean;
  isItemLocked?: boolean;
  onUploadToCas?: (file: File | Blob) => Promise<PendingFigureCasPreview>;
  onConfirm?: (payload: ConfirmPendingFigurePayload) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const heldFileRef = useRef<File | Blob | null>(null);
  const [stage, setStage] = useState<'IDLE' | 'UPLOADING' | 'WAITING_ONLINE' | 'PREVIEW' | 'CONFIRMING'>('IDLE');
  const [preview, setPreview] = useState<PendingFigureCasPreview | null>(null);
  const [figureType, setFigureType] = useState<PendingFigureType>(() => inferFigureTypeFromDescription(description));
  const [confirmInput, setConfirmInput] = useState('');

  const whitelist = useMemo(() => buildSourceWhitelist(allSources || []), [allSources]);
  const primarySource = useMemo(
    () => resolveWhitelistedSource(sourceUrl || '', whitelist, description),
    [sourceUrl, whitelist, description]
  );
  const alternativeSources = whitelist.filter((s) => s.url !== primarySource?.url);
  const canAct = Boolean(canCurateAI && !isSealed && onUploadToCas && onConfirm);

  const runUpload = useCallback(
    async (file: File | Blob) => {
      if (!onUploadToCas) return;
      heldFileRef.current = file;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setStage('WAITING_ONLINE');
        return;
      }
      setStage('UPLOADING');
      try {
        const res = await onUploadToCas(file);
        heldFileRef.current = null;
        setPreview(res);
        setStage('PREVIEW');
      } catch (err) {
        if (err instanceof PendingFigureOfflineError) {
          setStage('WAITING_ONLINE');
          return;
        }
        heldFileRef.current = null;
        setStage('IDLE');
        toast.error((err as Error)?.message || t('vault_dashboard.pending_figure.error', 'Error al optimizar la imagen.'));
      }
    },
    [onUploadToCas, t]
  );

  // OPT-F2.3: la imagen capturada sin red se retiene y se procesa automáticamente al recuperar la conexión
  useEffect(() => {
    if (stage !== 'WAITING_ONLINE') return;
    const handleOnline = () => {
      if (heldFileRef.current) void runUpload(heldFileRef.current);
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [stage, runUpload]);

  const acceptFile = (file: File | Blob | null | undefined) => {
    if (!file || !canAct || stage === 'UPLOADING' || stage === 'CONFIRMING') return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/i.test(file.type || '')) {
      toast.warning(t('vault_dashboard.pending_figure.unsupported_type', 'Formato no admitido (PNG, JPG, WebP o SVG).'));
      return;
    }
    void runUpload(file);
  };

  // OPT-F4.2: pegado nativo Cmd/Ctrl+V sobre la tarjeta enfocada
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!canAct) return;
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      acceptFile(imgItem.getAsFile());
    }
  };

  const handleClipboardButton = async () => {
    if (!canAct) return;
    try {
      if (!navigator.clipboard?.read) {
        toast.info(t('vault_dashboard.pending_figure.clipboard_unsupported', 'Enfoque la tarjeta y use Cmd/Ctrl+V, o SUBIR IMAGEN.'));
        return;
      }
      const clipItems = await navigator.clipboard.read();
      for (const item of clipItems) {
        const imgType = item.types.find((ty) => ty.startsWith('image/'));
        if (imgType) {
          const blob = await item.getType(imgType);
          acceptFile(new File([blob], `captura_seccion_${Date.now()}.${imgType.split('/')[1] || 'png'}`, { type: imgType }));
          return;
        }
      }
      toast.warning(t('vault_dashboard.pending_figure.no_clipboard_image', 'El portapapeles no contiene una imagen.'));
    } catch {
      toast.info(t('vault_dashboard.pending_figure.clipboard_unsupported', 'Enfoque la tarjeta y use Cmd/Ctrl+V, o SUBIR IMAGEN.'));
    }
  };

  const resetFlow = () => {
    heldFileRef.current = null;
    setPreview(null);
    setConfirmInput('');
    setStage('IDLE');
  };

  const handleConfirm = async () => {
    if (!onConfirm || !preview || confirmInput.trim() !== 'ACTUALIZAR') return;
    setStage('CONFIRMING');
    const ok = await onConfirm({
      description,
      sourceUrl: primarySource?.url,
      pendingMarkerLine: rawMarkerLine,
      figureType,
      confirmWord: confirmInput.trim(),
      cas: preview,
    });
    if (ok) resetFlow();
    else setStage('PREVIEW');
  };

  return (
    <div
      tabIndex={canAct ? 0 : -1}
      onPaste={handlePaste}
      data-pending-content-slot="true"
      data-pending-fragment={`[IMAGEN PENDIENTE] ${description}`}
      className="my-[21px] border border-[#C68346]/60 border-l-2 border-l-[#C68346] bg-[#C68346]/10 dark:bg-[#C68346]/15 p-[13px] rounded-none shadow-none select-none outline-none focus:border-[#00AEEF] dark:focus:border-[#00AEEF]"
    >
      <div className="flex flex-wrap items-center justify-between gap-[8px] pb-[8px] border-b border-[#E2E8F0] dark:border-[#12151C]">
        <div className="flex items-center gap-[8px]">
          <span className="material-symbols-outlined !text-[16px] text-[#C68346]">image_search</span>
          <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#C68346]">
            {t('vault_dashboard.pending_figure.title', 'Imagen técnica pendiente en esta sección')}
          </span>
        </div>

        {canAct && (stage === 'IDLE' || stage === 'WAITING_ONLINE') && (
          <div className="flex items-center gap-[8px]">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              autoComplete="off"
              spellCheck={false}
              className="hidden"
              onChange={(e) => {
                acceptFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-[8px] py-[4px] bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] text-[10px] font-mono font-bold uppercase tracking-wider rounded-none shadow-none border-0 cursor-pointer transition-colors"
            >
              {t('vault_dashboard.pending_figure.upload', 'Subir imagen')}
            </button>
            <button
              type="button"
              onClick={() => void handleClipboardButton()}
              className="px-[8px] py-[4px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] text-[#0F172A] dark:text-[#F3F4F6] text-[10px] font-mono font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer transition-colors"
            >
              {t('vault_dashboard.pending_figure.paste', 'Pegar portapapeles')}
            </button>
          </div>
        )}
        {stage === 'UPLOADING' && (
          <div className="flex items-center gap-[8px] text-[10px] font-mono text-[#C68346]">
            <M3CircularProgress size={14} strokeWidth={2} indeterminate tone="copper" ariaLabel={t('vault_dashboard.pending_figure.consolidating', 'Optimizando en CAS')} />
            <span className="uppercase">{t('vault_dashboard.pending_figure.consolidating', 'Optimizando en CAS')}</span>
          </div>
        )}
      </div>

      <div className="mt-[8px] space-y-[8px]">
        <div>
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] block">
            {t('vault_dashboard.pending_figure.description_label', 'Recurso visual requerido')}
          </span>
          <p className="text-[13px] text-[#0F172A] dark:text-[#F3F4F6] leading-relaxed mt-0.5 select-text">{description}</p>
        </div>

        <div className="pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-col gap-[4px]">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
            {t('vault_dashboard.pending_figure.link_label', 'Fuente para obtención manual')}
          </span>
          {primarySource ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-[8px]">
                <span className="text-[11px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] select-text">{sourceLabel(primarySource)}</span>
                <a
                  href={primarySource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-[4px] text-[11px] font-mono font-bold text-[#00AEEF] hover:underline uppercase"
                >
                  <span className="material-symbols-outlined !text-[14px]">open_in_new</span>
                  <span>{t('vault_dashboard.pending_figure.visit_source', 'Visitar fuente')}</span>
                </a>
              </div>
              <a
                href={primarySource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-mono text-[#00AEEF]/80 hover:text-[#00AEEF] hover:underline break-all select-text"
              >
                {primarySource.url}
              </a>
              {alternativeSources.length > 0 && (
                <details className="mt-[4px]">
                  <summary className="text-[10px] font-mono text-[#475569] dark:text-[#8A93A6] cursor-pointer hover:text-[#0F172A] dark:hover:text-[#F3F4F6]">
                    {t('vault_dashboard.pending_figure.alt_links', 'Enlaces alternativos verificados')} ({alternativeSources.length})
                  </summary>
                  <ul className="mt-[4px] space-y-[4px] pl-[8px] border-l border-[#E2E8F0] dark:border-[#12151C]">
                    {alternativeSources.map((src, sIdx) => (
                      <li key={sIdx} className="text-[10px] font-mono">
                        <span className="text-[#475569] dark:text-[#8A93A6]">[{src.type}] {src.author}: </span>
                        <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-[#00AEEF] hover:underline break-all">
                          {src.description || src.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <span className="text-[11px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
              [{t('vault_dashboard.pending_figure.no_source', 'Fuente no declarada')}]
            </span>
          )}
        </div>

        {stage === 'WAITING_ONLINE' && (
          <div className="pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-[8px] text-[11px] font-mono text-[#C68346]">
            <span className="material-symbols-outlined !text-[14px]">cloud_off</span>
            <span>{t('vault_dashboard.pending_figure.offline_waiting', 'Sin conexión: la imagen se procesará al recuperar la red.')}</span>
          </div>
        )}

        {canAct && preview && (stage === 'PREVIEW' || stage === 'CONFIRMING') && (
          <div className="pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-col gap-[8px]">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#00AEEF]">
              {t('vault_dashboard.pending_figure.preview_title', 'Vista previa [Pendiente] ➔ [Imagen]')}
            </span>
            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] p-[8px]">
              <img
                src={preview.previewSrc}
                alt={description}
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                className="max-h-[260px] w-auto mx-auto object-contain select-none pointer-events-none"
                style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
              />
            </div>
            <span className="text-[11px] font-mono tabular-nums text-[#00AEEF]">
              ORIG: {formatPhotoBytes(preview.originalBytes)} ➔ CAS: {formatPhotoBytes(preview.optimizedBytes)} (-{preview.savingsPct}%) · SHA-256 {preview.sha256.slice(0, 12)}
            </span>
            <label className="flex flex-col gap-[4px]">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                {t('vault_dashboard.pending_figure.figure_type_label', 'Tipo de figura')}
              </span>
              <select
                value={figureType}
                onChange={(e) => setFigureType(e.target.value as PendingFigureType)}
                autoComplete="off"
                className="px-[8px] py-[4px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] outline-none text-[11px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
              >
                {PENDING_FIGURE_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {t(`vault_dashboard.pending_figure.figure_types.${ft}`, ft)}
                  </option>
                ))}
              </select>
            </label>
            {isItemLocked && (
              <p className="text-[11px] text-[#C68346]">
                {t('vault_dashboard.pending_figure.locked_advisory', 'Ítem aprobado: la imagen quedará como propuesta hasta desbloquear el ítem.')}
              </p>
            )}
            <p className="text-[10px] text-[#475569] dark:text-[#8A93A6]">
              {t('vault_dashboard.pending_figure.confirm_helper', 'Escriba "ACTUALIZAR" para integrar la imagen en esta sección:')}
            </p>
            <div className="flex gap-[8px]">
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="ACTUALIZAR"
                autoComplete="off"
                spellCheck={false}
                disabled={stage === 'CONFIRMING'}
                className="px-[8px] py-[4px] flex-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[11px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
              />
              <button
                type="button"
                disabled={confirmInput.trim() !== 'ACTUALIZAR' || stage === 'CONFIRMING'}
                onClick={() => void handleConfirm()}
                className="px-[13px] py-[4px] bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] text-[10px] font-mono font-bold uppercase disabled:opacity-40 rounded-none border-0 cursor-pointer"
              >
                {t('vault_dashboard.pending_figure.confirm', 'Confirmar')}
              </button>
              <button
                type="button"
                disabled={stage === 'CONFIRMING'}
                onClick={resetFlow}
                className="px-[13px] py-[4px] bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[10px] font-mono uppercase rounded-none cursor-pointer"
              >
                {t('vault_dashboard.pending_figure.cancel', 'Cancelar')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MarkdownRenderer({
  content,
  pillarId,
  activeHighlightText,
  onFragmentClick,
  resolvedSymbology,
  itemTitle,
  itemSources,
  galleryFigures,
  canCurateAI,
  isSealed,
  isItemLocked,
  onUploadPendingFigure,
  onConfirmPendingFigure,
}: {
  content: string;
  pillarId?: PillarId;
  activeHighlightText?: string;
  onFragmentClick?: (text: string, e: React.MouseEvent) => void;
  resolvedSymbology?: Array<{ concept_id: string; url: string; technical_name_es: string }>;
  itemTitle?: string;
  itemSources?: ItemizedSource[];
  galleryFigures?: ExtractedFigureRef[];
  canCurateAI?: boolean;
  isSealed?: boolean;
  isItemLocked?: boolean;
  onUploadPendingFigure?: (file: File | Blob) => Promise<PendingFigureCasPreview>;
  onConfirmPendingFigure?: (payload: ConfirmPendingFigurePayload) => Promise<boolean>;
}) {

  if (!content) return null;
  const rawClean = cleanFuentesFromMarkdown(content);
  // Sanitizar HTML crudo y normalizar procedimientos numerados a tablas antes de parsear
  const sanitizedMarkdown = sanitizeHtmlToMarkdown(rawClean, pillarId);
  // Normalizar marcadores rotos, filtrar imágenes no citadas y garantizar tarjeta de imagen pendiente por sección
  const withPendingMarkers = injectLegacyPendingMarkers(
    sanitizedMarkdown,
    itemTitle || '',
    itemSources || [],
    galleryFigures || []
  );
  const cleanContent = stripRedundantNarrativeInTabularPillar(withPendingMarkers, pillarId);
  const nodes: React.ReactNode[] = [];
  const lines = cleanContent.split('\n');

  const interactiveCls = onFragmentClick ? 'hover:bg-[#C68346]/10 cursor-pointer' : '';
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]; const line = raw.trim();
    if (!line) { i++; continue; }
    if (line.startsWith('#### ')) {
      const currentRaw = raw;
      nodes.push(<h4 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className={`text-[12px] font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] mt-[21px] mb-[8px] ${interactiveCls} rounded-none px-[8px] -mx-[8px] transition-colors duration-150`}>{parseInlineStyles(cleanSymbolMarkersFromText(line.replace('#### ', '')), activeHighlightText, resolvedSymbology)}</h4>);
      i++;
      continue;
    }
    if (line.startsWith('### ')) {
      const currentRaw = raw;
      nodes.push(<h3 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className={`text-[13px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6] mt-[21px] mb-[8px] border-b border-[#E2E8F0] dark:border-[#12151C] pb-[8px] ${interactiveCls} rounded-none px-[8px] -mx-[8px] transition-colors duration-150`}>{parseInlineStyles(cleanSymbolMarkersFromText(line.replace('### ', '')), activeHighlightText, resolvedSymbology)}</h3>);
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      const currentRaw = raw;
      nodes.push(<h2 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className={`text-[15px] font-bold uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6] mt-[34px] mb-[13px] ${interactiveCls} rounded-none px-[8px] -mx-[8px] transition-colors duration-150`}>{parseInlineStyles(cleanSymbolMarkersFromText(line.replace('## ', '')), activeHighlightText, resolvedSymbology)}</h2>);
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      const currentRaw = raw;
      nodes.push(<h1 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className={`text-[17px] font-bold uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6] mt-[34px] mb-[13px] ${interactiveCls} rounded-none px-[8px] -mx-[8px] transition-colors duration-150`}>{parseInlineStyles(cleanSymbolMarkersFromText(line.replace('# ', '')), activeHighlightText, resolvedSymbology)}</h1>);
      i++;
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: { rawText: string; cleanText: string }[] = [];
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        items.push({ rawText: lines[i], cleanText: lines[i].trim().replace(/^[-*] /, '') }); i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="list-none space-y-[8px] my-[13px] ml-0">
          {items.map((it, idx) => (
            <li
              key={idx}
              onClick={(e) => onFragmentClick?.(it.rawText, e)}
              className={`flex items-start gap-[8px] text-[13px] text-[#0F172A] dark:text-[#F3F4F6] ${interactiveCls} rounded-none px-[8px] -mx-[8px] transition-colors duration-150`}
            >
              <span className="text-[#C68346] mt-0.5 shrink-0">›</span>
              <div className="flex-1 min-w-0">
                {renderBlockWithPictogramStrip(it.cleanText, activeHighlightText, resolvedSymbology)}
              </div>
            </li>
          ))}
        </ul>
      );
      continue;
    }
    if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (!cells.every(c => /^[-:]+$/.test(c))) rows.push(cells);
        i++;
      }
      if (rows.length > 0) {
        const [header, ...rawBody] = rows;
        const colCount = header.length;
        const body = rawBody.map((r) => {
          if (r.length === colCount) return [...r];
          if (r.length < colCount) {
            return [...r, ...Array.from({ length: colCount - r.length }, () => '')];
          }
          return [...r.slice(0, colCount - 1), r.slice(colCount - 1).join(' — ')];
        });
        const cleanedHeader = header.map((h, ci) => {
          const headerMarkers = Array.from(
            h.matchAll(new RegExp(INLINE_SYMBOL_MARKER_REGEX.source, 'g'))
          ).map((m) => m[0]);
          if (headerMarkers.length > 0 && body.length > 0) {
            const colHasMarker = (marker: string) => body.some((r) => (r[ci] || '').includes(marker));
            const missingMarkers = headerMarkers.filter((mk) => !colHasMarker(mk));
            if (missingMarkers.length > 0) {
              body[0][ci] = `${body[0][ci] || ''} ${missingMarkers.join(' ')}`.trim();
            }
          }
          return cleanSymbolMarkersFromText(h);
        });
        const normHeader = cleanedHeader.map((h) => h.toUpperCase().replace(/\s+/g, ' ').trim());
        const isChecklistTable =
          normHeader.some((h) => h === 'CUMPLE' || h === 'PASA') &&
          normHeader.some((h) => h === 'NO CUMPLE' || h === 'NO PASA');
        const indexColIdx = normHeader.findIndex((h) => h === 'N°' || h === 'Nº' || h === 'NRO' || h === '#' || h === 'PASO');
        const cumpleColIdx = normHeader.findIndex((h) => h === 'CUMPLE' || h === 'PASA');
        const noCumpleColIdx = normHeader.findIndex((h) => h === 'NO CUMPLE' || h === 'NO PASA');
        const obsColIdx = normHeader.findIndex((h) => h.startsWith('OBSERVACION'));

        nodes.push(
          <div key={`tbl-${i}`} className="overflow-x-auto my-[21px]">
            <table className="w-full text-[12px] border-collapse tabular-nums font-mono">
              <thead>
                <tr>
                  {cleanedHeader.map((h, ci) => {
                    const isCenterCol = ci === indexColIdx || ci === cumpleColIdx || ci === noCumpleColIdx;
                    return (
                      <th
                        key={ci}
                        className={`${isCenterCol ? 'text-center whitespace-nowrap' : 'text-left'} px-[13px] py-[8px] bg-[#F8FAFC] dark:bg-[#07090D] font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] border border-[#E2E8F0] dark:border-[#12151C]`}
                      >
                        {parseInlineStyles(h, activeHighlightText, resolvedSymbology)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri} className="border-b border-[#E2E8F0] dark:border-[#12151C]">
                    {row.map((cell, ci) => {
                      const trimmedCell = cell.trim();
                      const isCheckboxCol = isChecklistTable && (ci === cumpleColIdx || ci === noCumpleColIdx);
                      const isCheckboxToken = /^(\[\s*\]|\[x\]|\[X\]|☐|☑)$/.test(trimmedCell);
                      const isObsCol = isChecklistTable && ci === obsColIdx;
                      const isIndexCol = ci === indexColIdx;

                      if (isCheckboxCol || isCheckboxToken) {
                        const isChecked = /^(\[x\]|\[X\]|☑)$/.test(trimmedCell);
                        return (
                          <td
                            key={ci}
                            onClick={(e) => onFragmentClick?.(cell, e)}
                            className={`px-[13px] py-[8px] text-center align-middle border border-[#E2E8F0] dark:border-[#12151C] ${interactiveCls} transition-colors duration-150`}
                          >
                            <span
                              aria-label={ci === noCumpleColIdx ? 'Casillero No Cumple' : 'Casillero Cumple'}
                              className="inline-flex items-center justify-center w-[14px] h-[14px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#0F172A] dark:border-[#F3F4F6] rounded-none shadow-none select-none"
                            >
                              {isChecked && <span className="w-[8px] h-[8px] bg-[#C68346] block rounded-none" />}
                            </span>
                          </td>
                        );
                      }

                      if (isObsCol && (!trimmedCell || /^[-—_]+$/.test(trimmedCell) || trimmedCell === '[ ]')) {
                        return (
                          <td
                            key={ci}
                            onClick={(e) => onFragmentClick?.(cell, e)}
                            className={`px-[13px] py-[8px] min-w-[140px] align-middle border border-[#E2E8F0] dark:border-[#12151C] ${interactiveCls} transition-colors duration-150`}
                          >
                            <div className="w-full h-[16px] border-b border-dashed border-[#94A3B8] dark:border-[#5A6072]" />
                          </td>
                        );
                      }

                      if (isIndexCol) {
                        return (
                          <td
                            key={ci}
                            onClick={(e) => onFragmentClick?.(cell, e)}
                            className={`px-[13px] py-[8px] text-center align-top font-bold text-[#C68346] whitespace-nowrap border border-[#E2E8F0] dark:border-[#12151C] ${interactiveCls} transition-colors duration-150`}
                          >
                            {trimmedCell.replace(/^\*\*|\*\*$/g, '')}
                          </td>
                        );
                      }

                      return (
                        <td
                          key={ci}
                          onClick={(e) => onFragmentClick?.(cell, e)}
                          className={`px-[13px] py-[8px] align-top text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] ${interactiveCls} transition-colors duration-150`}
                        >
                          {renderBlockWithPictogramStrip(cell, activeHighlightText, resolvedSymbology)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }
    const pendingParsed = parsePendingMarker(line);
    if (pendingParsed) {
      nodes.push(
        <PendingSectionFigureCard
          key={`pending-img-${i}`}
          description={pendingParsed.description}
          sourceUrl={pendingParsed.url}
          allSources={itemSources}
          rawMarkerLine={line}
          canCurateAI={canCurateAI}
          isSealed={isSealed}
          isItemLocked={isItemLocked}
          onUploadToCas={onUploadPendingFigure}
          onConfirm={onConfirmPendingFigure}
        />
      );
      i++;
      continue;
    }

    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const [, altText, rawImgUrl] = imgMatch;
      const safeImgUrl = rawImgUrl.trim();
      // Siluetas sintéticas o gráficos de tablas obsoletos (`FIX-01` / `Punto 4º`): nunca se renderizan
      if (/Plano Dimensional Acotado|Plano Dimensional y Par[aá]metros|Mapa de Inspecci[oó]n 360|Matriz Cronol[oó]gica PM|Comparativa\s+de\s+magnitudes|Comparativa\s+Param[eé]trica\s+SI/i.test(altText)) {
        i++;
        if (i < lines.length && /^\*Figura\s+(?:t[eé]cnica|\d+):/i.test(lines[i].trim())) i++;
        continue;
      }
      if (/^(https?:\/\/|\/api\/|data:image\/)/i.test(safeImgUrl)) {
        let captionDetail = '';
        if (i + 1 < lines.length && /^\*Figura\s+(?:t[eé]cnica|\d+):/i.test(lines[i + 1].trim())) {
          captionDetail = lines[i + 1].trim().replace(/^\*+|\*+$/g, '').trim();
          i++;
        }
        const matchedFig = (galleryFigures || []).find((gf) => gf?.storage_url === safeImgUrl);
        nodes.push(
          <figure key={`img-${i}`} className="my-[21px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-[13px] rounded-none shadow-none">
            <img
              src={resolveMediaSrc(safeImgUrl)}
              alt={altText || 'Figura técnica'}
              loading="lazy"
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
              className="max-h-[420px] w-auto mx-auto object-contain bg-[#FFFFFF] select-none pointer-events-none"
              style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
            />
            {(captionDetail || altText || matchedFig) && (
              <figcaption className="mt-[8px] pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-col gap-[4px]">
                <span className="text-[11px] font-mono font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-wider">
                  {altText || 'Figura técnica'}
                </span>
                {captionDetail && captionDetail !== altText && (
                  <span className="text-[12px] text-[#475569] dark:text-[#8A93A6]">
                    {captionDetail}
                  </span>
                )}
                {matchedFig && typeof matchedFig.original_bytes === 'number' && typeof matchedFig.optimized_bytes === 'number' && (
                  <span className="text-[10px] font-mono tabular-nums text-[#00AEEF]">
                    ORIG: {formatByteWeight(matchedFig.original_bytes)} ➔ CAS: {formatByteWeight(matchedFig.optimized_bytes)} (
                    {typeof matchedFig.savings_pct === 'number'
                      ? `-${matchedFig.savings_pct.toFixed(1)}%`
                      : matchedFig.original_bytes > 0
                        ? `-${Math.max(0, ((matchedFig.original_bytes - matchedFig.optimized_bytes) / matchedFig.original_bytes) * 100).toFixed(1)}%`
                        : '0%'}
                    )
                  </span>
                )}
              </figcaption>
            )}
          </figure>
        );
        i++;
        continue;
      }
    }
    const currentRaw = raw;
    nodes.push(
      <div
        key={i}
        onClick={(e) => onFragmentClick?.(currentRaw, e)}
        className={`text-[13px] text-[#0F172A] dark:text-[#F3F4F6] leading-relaxed mb-[8px] ${interactiveCls} rounded-none px-[8px] -mx-[8px] transition-colors duration-150`}
      >
        {renderBlockWithPictogramStrip(raw, activeHighlightText, resolvedSymbology)}
      </div>
    );
    i++;
  }
  return <div className="font-atkinson">{nodes}</div>;
}

// ─── Classified Sources (ITEMIZADO) ──────────────────────────────────────────
function ItemizedSourcesBlock({ sources }: { sources: ItemizedSource[] }) {
  if (!sources?.length) return null;
  const groups = ['OEM', 'EXTERNO', 'YOUTUBE', 'MANUAL'] as const;
  return (
    <details className="mt-[34px] pt-[21px] border-t border-[#E2E8F0] dark:border-[#12151C] group">
      <summary className="text-[11px] font-bold uppercase tracking-wider text-[#5A6072] dark:text-[#8A93A6] mb-[13px] cursor-pointer hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors list-none flex items-center gap-[8px]">
        <span className="material-symbols-outlined !text-[14px] transition-transform group-open:rotate-90">chevron_right</span>
        FUENTES VERIFICADAS ({sources.length})
      </summary>
      <div className="space-y-[21px] pl-[21px]">
        {groups.map(g => {
          const items = sources.filter(s => s.type === g);
          const refIndex = (src: ItemizedSource) => sources.indexOf(src) + 1;
          if (!items.length) return null;
          return (
            <div key={g}>
              <div className={`flex items-center gap-[8px] mb-[8px] text-[11px] font-bold uppercase tracking-wider font-mono tabular-nums ${SOURCE_COLORS[g]}`}>
                <span className="material-symbols-outlined !text-[13px]">{SOURCE_ICONS[g]}</span>
                {g} ({items.length})
              </div>
              <ul className="space-y-[8px]">
                {items.map((src, idx) => (
                  <li key={idx} className="flex items-start gap-[8px]">
                    <span className="text-[10px] font-mono tabular-nums font-bold text-[#475569] dark:text-[#8A93A6] mt-0.5 shrink-0 w-[26px]">F{refIndex(src)}</span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">{src.author}</p>
                      <p className="text-[11px] text-[#475569] dark:text-[#8A93A6]">{src.description}</p>
                      {src.url && (
                        <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono text-[#00AEEF] hover:underline break-all">{src.url}</a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </details>
  );
}

// ─── Item Content Block (CAZA POR ÍTEM) ─────────────────────────────────────
interface ItemContentBlockProps {
  item: PillarItem;
  canCurateAI: boolean;
  isHunting: boolean;
  huntProgressPct?: number;
  huntStageMessage?: string;
  assistingItemId: string | null;
  onAiAssist: (userRequest: string) => Promise<AiAssistResponse | null>;
  onApplyAssist: (finalContent: string, intent: string) => Promise<void>;
  isSealed: boolean;
  onHunt: () => void;
  onDiscard: () => void;
  onUnlockItem: () => Promise<void>;
  onUpdateApprovalState: (state: EstadoAprobacion, notes?: string) => Promise<void>;
  onRollbackVersion: (timestamp: string) => Promise<void>;
  catalogId: string;

  // Nuevos:
  pillarId: PillarId;
  activeProposalView: { itemId: string; pillarId: PillarId; view: 'nuevos' | 'conflictos' } | null;
  onSetProposalView: (v: { itemId: string; pillarId: PillarId; view: 'nuevos' | 'conflictos' } | null) => void;
  onDecideProposal: (proposalId: string, decision: 'APROBADO' | 'ELIMINADO') => Promise<void>;
  onEvolveItemByType: (filterType: 'NUEVO' | 'CONFLICTO') => Promise<void>;
  resolvedSymbology?: Array<{ concept_id: string; url: string; technical_name_es: string }>;
  onOpenStudio?: (tab: StudioTabId) => void;
}

// ─── Subcomponentes para la refactorización de Actualización por IA ─────────
function getEffectiveProposalId(proposal: ProposedUpdate, fallbackIdx?: number): string {
  if (proposal.proposal_id && proposal.proposal_id.trim()) {
    return proposal.proposal_id.trim();
  }
  const estado = String(proposal.estado_fusion || 'NUEVO').trim();
  const comp = String(proposal.componente || '').trim();
  const val = String(proposal.valor_nuevo || '').trim().slice(0, 80);
  return fallbackIdx !== undefined
    ? `fallback_${estado}::${comp}::${val}::${fallbackIdx}`
    : `fallback_${estado}::${comp}::${val}`;
}

interface ProposalCardProps {
  proposal: ProposedUpdate;
  fallbackIndex?: number;
  onDecide: (proposalId: string, decision: 'APROBADO' | 'ELIMINADO') => Promise<void>;
  onConsolidateApproved?: () => Promise<void>;
  isSealed: boolean;
  fallbackUrl?: string;
  children?: React.ReactNode;
}

function ProposalCard({
  proposal,
  fallbackIndex,
  onDecide,
  onConsolidateApproved,
  isSealed,
  fallbackUrl,
  children,
}: ProposalCardProps) {
  const [confirmingDecision, setConfirmingDecision] = useState<'APROBADO' | 'ELIMINADO' | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const effectiveProposalId = getEffectiveProposalId(proposal, fallbackIndex);

  const handleReset = () => {
    setConfirmingDecision(null);
    setConfirmText('');
  };

  const handleConfirm = async () => {
    if (!effectiveProposalId || !confirmingDecision || confirmText.trim().toUpperCase() !== 'ACTUALIZAR') return;
    setIsSubmitting(true);
    try {
      await onDecide(effectiveProposalId, confirmingDecision);
      handleReset();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDirectConsolidate = async () => {
    if (isSealed || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (onConsolidateApproved) {
        await onConsolidateApproved();
      } else {
        await onDecide(effectiveProposalId, 'APROBADO');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isApproved = proposal.human_decision === 'APROBADO';

  return (
    <div
      className={`border p-4 transition-colors duration-300 font-atkinson rounded-none shadow-none ${isApproved
        ? 'border-[#00AEEF] bg-[#00AEEF]/5'
        : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D]'
        }`}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
            {proposal.zona} — {proposal.componente}
          </span>
          {proposal.detected_at && (
            <span className="text-[10px] font-mono tabular-nums text-[#5A6072]">
              Detectado: {new Date(proposal.detected_at).toLocaleDateString()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isApproved ? (
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#00AEEF] border border-[#00AEEF]/30 px-2 py-0.5 rounded-none">
                {isSubmitting ? 'Integrando...' : 'Aprobado'}
              </span>
              {!confirmingDecision && (
                <>
                  <button
                    type="button"
                    disabled={isSealed || isSubmitting}
                    onClick={handleDirectConsolidate}
                    className="px-2 py-0.5 bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none border-0 cursor-pointer disabled:opacity-40"
                    title="Integrar inmediatamente este hallazgo aprobado al contenido del ítem"
                  >
                    {isSubmitting ? 'Integrando...' : 'Integrar Ahora'}
                  </button>
                  <M3IconButton
                    icon="delete"
                    onClick={() => setConfirmingDecision('ELIMINADO')}
                    variant="ghost"
                    title="Eliminar propuesta"
                    className="text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] !p-1 shrink-0"
                    disabled={isSealed || isSubmitting}
                  />
                </>
              )}
            </div>
          ) : confirmingDecision ? (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border border-[#C68346]/40 text-[#C68346] rounded-none">
              Confirmando...
            </span>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-[#F8FAFC] dark:bg-[#000000] text-[#5A6072] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
              Pendiente
            </span>
          )}

          {!isApproved && !confirmingDecision && (
            <div className="flex items-center gap-1">
              <M3IconButton
                icon="done"
                onClick={() => setConfirmingDecision('APROBADO')}
                variant="ghost"
                title="Aprobar e integrar hallazgo"
                className="text-[#00AEEF] !p-1 shrink-0"
                disabled={isSealed || isSubmitting}
              />
              <M3IconButton
                icon="delete"
                onClick={() => setConfirmingDecision('ELIMINADO')}
                variant="ghost"
                title="Eliminar propuesta"
                className="text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] !p-1 shrink-0"
                disabled={isSealed || isSubmitting}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        {children}
      </div>

      {proposal.figures && proposal.figures.length > 0 && (
        <div className="mt-[13px] pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] mb-[8px] font-mono tabular-nums">
            FIGURAS ASOCIADAS AL HALLAZGO ({proposal.figures.length})
          </p>
          <div className="grid grid-cols-2 gap-[8px]">
            {proposal.figures.map((fig) => (
              <div
                key={fig.figure_id}
                className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[8px] rounded-none shadow-none flex items-center gap-[8px]"
              >
                <img
                  src={fig.storage_url}
                  alt={fig.title_es}
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                  className="w-[44px] h-[44px] object-contain shrink-0 select-none pointer-events-none bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                    {fig.title_es}
                  </p>
                  <p className="text-[10px] font-mono tabular-nums text-[#5A6072] dark:text-[#8A93A6] truncate">
                    {fig.figure_type} {fig.source_page ? `· P.${fig.source_page}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(proposal.source_url || fallbackUrl) && (proposal.source_url || fallbackUrl) !== '#' && (
        <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-[#00AEEF]">
          <span className="material-symbols-outlined !text-[12px]">link</span>
          <a
            href={proposal.source_url || fallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline font-mono truncate max-w-full block"
            title={proposal.source_url || fallbackUrl}
          >
            Ver fuente técnica original
          </a>
        </div>
      )}

      {confirmingDecision && (
        <div className="mt-3 pt-3 border-t border-[#E2E8F0] dark:border-[#12151C] space-y-2">
          <p className="text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
            Escribe <span className="font-mono text-[#C68346] font-bold">"ACTUALIZAR"</span> para confirmar ({confirmingDecision === 'APROBADO' ? 'APROBAR E INTEGRAR' : 'ELIMINAR'}):
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="ACTUALIZAR"
              autoComplete="off"
              spellCheck={false}
              className="px-2 py-1 text-[11px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none flex-1 text-[#0F172A] dark:text-[#F3F4F6] font-mono rounded-none shadow-none"
            />
            <button
              type="button"
              disabled={confirmText.trim().toUpperCase() !== 'ACTUALIZAR' || isSubmitting}
              onClick={handleConfirm}
              className="px-3 py-1 font-bold text-[10px] text-[#FFFFFF] bg-[#C68346] hover:bg-[#b07239] disabled:opacity-40 rounded-none shadow-none transition-colors border-0 cursor-pointer"
            >
              {isSubmitting ? 'Integrando...' : 'Confirmar'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={isSubmitting}
              className="px-3 py-1 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-[10px] text-[#475569] dark:text-[#8A93A6] rounded-none shadow-none cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface NuevosHallazgosViewProps {
  item: PillarItem;
  onDecideProposal: (proposalId: string, decision: 'APROBADO' | 'ELIMINADO') => Promise<void>;
  onEvolveItemByType: (filterType: 'NUEVO' | 'CONFLICTO') => Promise<void>;
  onClose: () => void;
  isSealed: boolean;
}

function NuevosHallazgosView({ item, onDecideProposal, onEvolveItemByType, onClose, isSealed }: NuevosHallazgosViewProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firstValidUrl = item.item_sources?.find(s => s.url && s.url !== '#')?.url;

  const proposals = (item.pending_conflicts ?? []).filter(
    p => p.estado_fusion === 'NUEVO' && p.human_decision !== 'ELIMINADO'
  );

  const approvedCount = proposals.filter(p => p.human_decision === 'APROBADO').length;
  const pendingCount = proposals.filter(p => p.human_decision !== 'APROBADO').length;

  const handleEvolve = useCallback(async () => {
    if (isSealed || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onEvolveItemByType('NUEVO');
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSealed, isSubmitting, onEvolveItemByType]);

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full font-atkinson">
      <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] dark:border-[#12151C] shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            title="Volver al contenido"
          >
            <span className="material-symbols-outlined !text-[18px]">arrow_back</span>
          </button>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#0F172A] dark:text-[#F3F4F6]">
              Nuevo Contenido
            </h3>
            <p className="text-[11px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
              {pendingCount} pendiente(s){approvedCount > 0 ? ` · ${approvedCount} integrándose` : ''}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
          title="Cancelar y volver"
        >
          <span className="material-symbols-outlined !text-[18px]">close</span>
        </button>
      </div>

      {approvedCount > 0 && (
        <div className="mt-3 p-3 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#00AEEF] flex items-center justify-between gap-2 shrink-0 rounded-none shadow-none">
          <p className="text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
            Propuestas aprobadas (<span className="font-mono tabular-nums">{approvedCount}</span>) listas para consolidar en el documento:
          </p>
          <button
            type="button"
            disabled={isSealed || isSubmitting}
            onClick={handleEvolve}
            className="px-3 py-1 bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] font-bold text-[10px] uppercase tracking-wider disabled:opacity-40 rounded-none shadow-none transition-colors border-0 cursor-pointer shrink-0"
          >
            {isSubmitting ? 'Integrando...' : 'Integrar Ahora'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1 custom-scrollbar">
        {proposals.length === 0 ? (
          <div className="py-12 text-center text-[12px] text-[#5A6072] border border-[#E2E8F0] dark:border-[#12151C]">
            No hay propuestas de nuevo contenido pendientes de revisión.
          </div>
        ) : (
          proposals.map((prop, pIdx) => (
            <ProposalCard
              key={getEffectiveProposalId(prop, pIdx)}
              proposal={prop}
              fallbackIndex={pIdx}
              onDecide={onDecideProposal}
              onConsolidateApproved={handleEvolve}
              isSealed={isSealed}
              fallbackUrl={firstValidUrl}
            >
              <div className="space-y-2 text-[11px] leading-relaxed">
                {prop.synthesis && (
                  <p className="text-[#0F172A] dark:text-[#F3F4F6] font-medium bg-[#F8FAFC] dark:bg-[#000000] p-2 border-l-2 border-[#C68346]">
                    {prop.synthesis}
                  </p>
                )}
                <div className="mt-2 text-[#475569] dark:text-[#8A93A6]">
                  <span className="font-bold text-[#0F172A] dark:text-[#F3F4F6] block mb-0.5">Dato Propuesto:</span>
                  <div className="font-mono bg-[#F8FAFC] dark:bg-[#000000] p-2 border border-[#E2E8F0] dark:border-[#12151C] break-all max-h-32 overflow-y-auto custom-scrollbar">
                    {prop.valor_nuevo || prop.condicion_esperada}
                  </div>
                </div>
              </div>
            </ProposalCard>
          ))
        )}
      </div>
    </div>
  );
}

interface ConflictosViewProps {
  item: PillarItem;
  onDecideProposal: (proposalId: string, decision: 'APROBADO' | 'ELIMINADO') => Promise<void>;
  onEvolveItemByType: (filterType: 'NUEVO' | 'CONFLICTO') => Promise<void>;
  onClose: () => void;
  isSealed: boolean;
}

function ConflictosView({ item, onDecideProposal, onEvolveItemByType, onClose, isSealed }: ConflictosViewProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firstValidUrl = item.item_sources?.find(s => s.url && s.url !== '#')?.url;

  const proposals = (item.pending_conflicts ?? []).filter(
    p => p.estado_fusion === 'CONFLICTO' && p.human_decision !== 'ELIMINADO'
  );

  const approvedCount = proposals.filter(p => p.human_decision === 'APROBADO').length;
  const pendingCount = proposals.filter(p => p.human_decision !== 'APROBADO').length;

  const handleEvolve = useCallback(async () => {
    if (isSealed || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onEvolveItemByType('CONFLICTO');
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSealed, isSubmitting, onEvolveItemByType]);

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full font-atkinson">
      <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0] dark:border-[#12151C] shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            title="Volver al contenido"
          >
            <span className="material-symbols-outlined !text-[18px]">arrow_back</span>
          </button>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#0F172A] dark:text-[#F3F4F6]">
              Contenido en Conflicto
            </h3>
            <p className="text-[11px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
              {pendingCount} pendiente(s){approvedCount > 0 ? ` · ${approvedCount} integrándose` : ''}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
          title="Cancelar y volver"
        >
          <span className="material-symbols-outlined !text-[18px]">close</span>
        </button>
      </div>

      {approvedCount > 0 && (
        <div className="mt-3 p-3 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#C68346] flex items-center justify-between gap-2 shrink-0 rounded-none shadow-none">
          <p className="text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
            Conflictos resueltos (<span className="font-mono tabular-nums">{approvedCount}</span>) listos para consolidar en el documento:
          </p>
          <button
            type="button"
            disabled={isSealed || isSubmitting}
            onClick={handleEvolve}
            className="px-3 py-1 bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] font-bold text-[10px] uppercase tracking-wider disabled:opacity-40 rounded-none shadow-none transition-colors border-0 cursor-pointer shrink-0"
          >
            {isSubmitting ? 'Integrando...' : 'Integrar Ahora'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1 custom-scrollbar">
        {proposals.length === 0 ? (
          <div className="py-12 text-center text-[12px] text-[#5A6072] border border-[#E2E8F0] dark:border-[#12151C]">
            No hay propuestas de conflicto pendientes de revisión.
          </div>
        ) : (
          proposals.map((prop, pIdx) => (
            <ProposalCard
              key={getEffectiveProposalId(prop, pIdx)}
              proposal={prop}
              fallbackIndex={pIdx}
              onDecide={onDecideProposal}
              onConsolidateApproved={handleEvolve}
              isSealed={isSealed}
              fallbackUrl={firstValidUrl}
            >
              <div className="space-y-2 text-[11px] leading-relaxed">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-2 border-b border-[#E2E8F0] dark:border-[#12151C]">
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-[#5A6072] uppercase tracking-wide">Contenido Actual</span>
                    <div className="p-2 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] leading-relaxed font-mono break-all max-h-32 overflow-y-auto custom-scrollbar">
                      {prop.valor_actual ? (
                        highlightUndeclaredInNode(prop.valor_actual)
                      ) : (
                        <mark className={PENDING_CONTENT_HIGHLIGHT_CLASS}>[Información técnica no declarada en ficha]</mark>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1 md:border-l md:border-[#E2E8F0] md:dark:border-[#12151C] md:pl-3">
                    <span className="text-[9px] font-bold text-[#C68346] uppercase tracking-wide">Hallazgo Propuesto</span>
                    <div className="p-2 border border-[#C68346]/30 bg-[#C68346]/5 text-[#0F172A] dark:text-[#F3F4F6] leading-relaxed font-mono break-all max-h-32 overflow-y-auto custom-scrollbar">
                      {prop.valor_nuevo}
                    </div>
                  </div>
                </div>

                {prop.synthesis && (
                  <p className="text-[#0F172A] dark:text-[#F3F4F6] font-medium bg-[#F8FAFC] dark:bg-[#000000] p-2 border-l-2 border-[#C68346]">
                    {prop.synthesis}
                  </p>
                )}
              </div>
            </ProposalCard>
          ))
        )}
      </div>
    </div>
  );
}

const activeItemChatSessionMap = new Map<string, string>();

function ItemContentBlock({
  item,
  canCurateAI,
  isHunting,
  huntProgressPct,
  huntStageMessage,
  isSealed,
  onHunt,
  onDiscard,
  onUnlockItem,
  onUpdateApprovalState,
  onRollbackVersion,
  pillarId,
  activeProposalView,
  onSetProposalView,
  onDecideProposal,
  onEvolveItemByType,
  catalogId,
  resolvedSymbology,
  onOpenStudio,
}: ItemContentBlockProps) {
  const { t } = useTranslation();
  const { actorEmail, isTestPilot } = useOpermaqContext();
  const effectiveCuratorEmail = actorEmail || auth.currentUser?.email || 'curador@minreport.cl';
  const [correctionText, setCorrectionText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [selectedFragment, setSelectedFragment] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const [confirmUnlockInput, setConfirmUnlockInput] = useState('');
  const [confirmApprovalInput, setConfirmApprovalInput] = useState('');
  const [huntConfirmText, setHuntConfirmText] = useState('');
  const [draftConfirmInput, setDraftConfirmInput] = useState('');
  const [rollbackConfirmTimestamp, setRollbackConfirmTimestamp] = useState<string | null>(null);
  const [rollbackConfirmInput, setRollbackConfirmInput] = useState('');
  const [showHuntConfirm, setShowHuntConfirm] = useState(false);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const chatFeedRef = useRef<HTMLDivElement>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const pendingLocatorCursorRef = useRef<number>(0);

  const isHuntActive = item.content_status === 'GENERANDO' || isHunting;
  const isGenerating = isHuntActive || isSearching;

  useEffect(() => {
    if (!canCurateAI || !catalogId || !item.item_id) return;
    const sessionKey = `${catalogId}:${item.item_id}`;
    let currentSessionId = activeItemChatSessionMap.get(sessionKey);
    if (!currentSessionId) {
      currentSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      activeItemChatSessionMap.set(sessionKey, currentSessionId);
    }
    setSessionId(currentSessionId);
  }, [canCurateAI, catalogId, item.item_id]);

  const handleResetChatSession = useCallback(() => {
    if (!canCurateAI || !catalogId || !item.item_id) return;
    const sessionKey = `${catalogId}:${item.item_id}`;
    const prevSessionId = activeItemChatSessionMap.get(sessionKey) || sessionId;
    if (prevSessionId) {
      authFetch(`${API_BASE_URL}/vault/ai-assist-session-close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, itemId: item.item_id, sessionId: prevSessionId })
      }).catch(err => console.warn('[VaultChat] Error al reiniciar sesión:', err));
    }
    const freshSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    activeItemChatSessionMap.set(sessionKey, freshSessionId);
    setSessionId(freshSessionId);
    setMessages([]);
    setSelectedFragment(null);
    setDraftConfirmInput('');
  }, [canCurateAI, catalogId, item.item_id, sessionId]);

  useEffect(() => {
    if (!canCurateAI || !catalogId || !item.item_id || !sessionId) return;

    const sessionRef = doc(db, 'global_asset_catalog', catalogId, 'vault_chats', item.item_id, 'sessions', sessionId);
    const unsub = onSnapshot(sessionRef, (snap) => {
      if (snap.exists()) {
        setMessages(snap.data()?.messages || []);
      } else {
        setMessages([]);
      }
    }, (err) => {
      console.warn('[VaultChat] Error en el listener del chat:', err);
    });

    return () => unsub();
  }, [canCurateAI, catalogId, item.item_id, sessionId]);

  useEffect(() => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  const handleFragmentClick = (text: string, e: React.MouseEvent) => {
    if (!canCurateAI) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedFragment(text);
  };

  const latestDraftMessage = [...messages]
    .reverse()
    .find(msg => msg.role === 'model' && msg.draftContent && (!msg.draftStatus || msg.draftStatus === 'PENDING'));
  const latestDraftContent = latestDraftMessage?.draftContent || null;
  const latestDraftIntent = latestDraftMessage?.intent || 'EDIT_PROPOSAL';

  const latestModelMessage = [...messages].reverse().find(msg => msg.role === 'model');
  const activeHighlightText = latestModelMessage?.highlightText || undefined;

  const handleDismissDraft = useCallback(async (targetMsgId?: string) => {
    if (!canCurateAI || !catalogId || !item.item_id || !sessionId) return;
    setMessages(prev =>
      prev.map(m =>
        (targetMsgId ? m.id === targetMsgId : Boolean(m.draftContent && (!m.draftStatus || m.draftStatus === 'PENDING')))
          ? { ...m, draftStatus: 'DISCARDED' as const }
          : m
      )
    );
    setDraftConfirmInput('');
    try {
      await authFetch(`${API_BASE_URL}/vault/dismiss-assist-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalAssetId: catalogId,
          itemId: item.item_id,
          sessionId,
          messageId: targetMsgId,
        }),
      });
    } catch (err) {
      console.warn('[VaultChat] No se pudo persistir descarte de borrador:', err);
    }
  }, [canCurateAI, catalogId, item.item_id, sessionId]);

  const handleSendMessage = async () => {
    if (!canCurateAI || !correctionText.trim()) return;

    if (correctionText.trim() === 'ACTUALIZAR') {
      if (!latestDraftContent) {
        toast.warning('No hay ningún borrador de cambios pendiente para aprobar.');
        return;
      }

      setIsSending(true);
      const toastId = toast.loading('Aplicando propuesta de cambios...');
      try {
        const userEmail = effectiveCuratorEmail;
        const res = await authFetch(`${API_BASE_URL}/vault/apply-assist-proposal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            globalAssetId: catalogId,
            pillarId,
            itemId: item.item_id,
            finalContent: latestDraftContent,
            userEmail,
            intent: latestDraftIntent,
            sessionId,
            messageId: latestDraftMessage?.id,
          }),
        });
        if (res.ok) {
          setMessages(prev =>
            prev.map(m =>
              m.id === latestDraftMessage?.id ? { ...m, draftStatus: 'APPLIED' as const } : m
            )
          );
          toast.update(toastId, { render: 'Cambios aplicados exitosamente.', type: 'success', isLoading: false, autoClose: 3000 });
          setCorrectionText('');
          setDraftConfirmInput('');
          setSelectedFragment(null);
        } else {
          const json = await res.json();
          toast.update(toastId, { render: `Error: ${json.error || 'No se pudieron aplicar los cambios.'}`, type: 'error', isLoading: false, autoClose: 5000 });
        }
      } catch (_err) {
        toast.update(toastId, { render: 'Error de red al aplicar cambios.', type: 'error', isLoading: false, autoClose: 5000 });
      } finally {
        setIsSending(false);
      }
      return;
    }

    setIsSending(true);
    setIsSearching(true);
    try {
      const userEmail = effectiveCuratorEmail;
      const res = await authFetch(`${API_BASE_URL}/vault/ai-assist-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalAssetId: catalogId,
          pillarId,
          itemId: item.item_id,
          sessionId,
          userRequest: correctionText,
          selectedFragment: selectedFragment || undefined,
          userEmail
        })
      });
      const resp = await res.json();
      if (!res.ok || !resp.success) {
        toast.error(resp?.error || 'Error al enviar el mensaje.');
      } else {
        setCorrectionText('');
        setSelectedFragment(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSending(false);
      setIsSearching(false);
    }
  };

  // Figuras reales de galería (sin siluetas obsoletas ni gráficos de tabla) para no duplicar marcadores pendientes
  const galleryFigures = useMemo(
    () =>
      (item.figures || []).filter(
        (f) =>
          f?.storage_url &&
          !String(f.figure_id || '').startsWith('bp_') &&
          !String(f.figure_id || '').startsWith('fig_tbl_') &&
          !/Plano Dimensional Acotado|Plano Dimensional y Par[aá]metros|Mapa de Inspecci[oó]n 360|Matriz Cronol[oó]gica PM/i.test(
            `${f.title_es || ''} ${f.caption_es || ''}`
          )
      ),
    [item.figures]
  );

  const normalizedRenderedMarkdown = useMemo(() => {
    if (!item.content) return '';
    const specClean = sanitizeSpeculativeSymbolMarkers(item.content, pillarId);
    const rawClean = cleanFuentesFromMarkdown(specClean);
    const sanitized = sanitizeHtmlToMarkdown(rawClean, pillarId);
    const withPending = injectLegacyPendingMarkers(
      sanitized,
      item.title || '',
      item.item_sources || [],
      galleryFigures || []
    );
    return stripRedundantNarrativeInTabularPillar(withPending, pillarId);
  }, [item.content, pillarId, item.title, item.item_sources, galleryFigures]);

  const pendingContentSummary = useMemo(
    () =>
      computeItemPendingContentSummary({
        renderedMarkdown: normalizedRenderedMarkdown,
        rawContent: item.content,
        itemTitle: item.title,
        itemSources: item.item_sources,
        galleryFigures,
        pillarId,
      }),
    [normalizedRenderedMarkdown, item.content, item.title, item.item_sources, galleryFigures, pillarId]
  );
  const pendingFiguresCount = pendingContentSummary.pendingFiguresCount;

  const handleLocateNextPendingContent = useCallback(() => {
    if (activeProposalView?.itemId === item.item_id) {
      onSetProposalView(null);
    }
    setTimeout(() => {
      const container = contentContainerRef.current;
      if (!container) return;
      const slots = Array.from(
        container.querySelectorAll<HTMLElement>('[data-pending-content-slot="true"]')
      );
      if (slots.length === 0) return;
      const targetIdx = pendingLocatorCursorRef.current % slots.length;
      pendingLocatorCursorRef.current = targetIdx + 1;
      const targetEl = slots[targetIdx];
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const rowContext =
        targetEl.closest('tr')?.innerText?.replace(/\s+/g, ' ').trim() ||
        targetEl.closest('li, p')?.textContent?.trim() ||
        targetEl.getAttribute('data-pending-fragment') ||
        targetEl.textContent?.trim();
      if (rowContext && canCurateAI) {
        setSelectedFragment(rowContext.slice(0, 260));
      }
    }, 40);
  }, [activeProposalView, item.item_id, onSetProposalView, canCurateAI]);

  // OPT-F2.1 / F2.3: digestión CAS (SHA-256 + dHash, WebP) sin persistir URLs `blob:` en el contenido oficial
  const handleUploadPendingFigure = useCallback(
    async (file: File | Blob): Promise<PendingFigureCasPreview> => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new PendingFigureOfflineError();
      const { descriptor, digested } = await mediaDigestorClient.digestAndUploadCas(file, {
        profile: 'IMAGE_TECHNICAL_HD',
        scope: 'GLOBAL_OEM',
      });
      if (!descriptor?.downloadUrl || /^(?:blob:|data:)/i.test(descriptor.downloadUrl)) {
        throw new PendingFigureOfflineError();
      }
      const originalBytes = descriptor.originalBytes || digested.originalBytes;
      const optimizedBytes = descriptor.optimizedBytes || digested.optimizedBytes;
      return {
        sha256: descriptor.sha256,
        downloadUrl: descriptor.downloadUrl,
        previewSrc: resolveMediaSrc(descriptor.downloadUrl),
        originalBytes,
        optimizedBytes,
        savingsPct: Number(((descriptor.savingsRatio || digested.savingsRatio || 0) * 100).toFixed(1)),
      };
    },
    []
  );

  // OPT-F2.2: integración solo con confirmación "ACTUALIZAR"; el servidor valida contra el registro CAS
  const handleConfirmPendingFigure = useCallback(
    async (payload: ConfirmPendingFigurePayload): Promise<boolean> => {
      const toastId = toast.loading(t('vault_dashboard.pending_figure.integrating', 'Integrando imagen en la sección...'));
      try {
        const res = await authFetch(`${API_BASE_URL}/vault/resolve-pending-figure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            globalAssetId: catalogId,
            pillarId,
            itemId: item.item_id,
            confirmWord: payload.confirmWord,
            pendingMarkerLine: payload.pendingMarkerLine,
            pendingDescription: payload.description,
            figure: {
              sha256: payload.cas.sha256,
              storage_url: payload.cas.downloadUrl,
              figure_type: payload.figureType,
              title_es: payload.description.slice(0, 380),
              caption_es: payload.sourceUrl ? `Fuente: ${payload.sourceUrl}`.slice(0, 380) : undefined,
              source_url: payload.sourceUrl,
            },
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          throw new Error(json.error || json.message || `HTTP ${res.status}`);
        }
        toast.update(toastId, {
          render:
            json.mode === 'LOCKED_ADVISORY'
              ? t('vault_dashboard.pending_figure.locked_saved', 'Imagen registrada como propuesta del ítem aprobado.')
              : `${t('vault_dashboard.pending_figure.success', 'Imagen integrada en la sección')} (${formatPhotoBytes(
                payload.cas.originalBytes
              )} ➔ ${formatPhotoBytes(payload.cas.optimizedBytes)}, -${payload.cas.savingsPct}%).`,
          type: 'success',
          isLoading: false,
          autoClose: 3500,
        });
        return true;
      } catch (err: any) {
        toast.update(toastId, {
          render: err?.message || t('vault_dashboard.pending_figure.error', 'Error al integrar la imagen.'),
          type: 'error',
          isLoading: false,
          autoClose: 5000,
        });
        return false;
      }
    },
    [catalogId, pillarId, item.item_id, t]
  );

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 h-full w-full gap-[21px] font-atkinson relative overflow-hidden">
      <div ref={contentContainerRef} className="flex-1 lg:w-[61.8%] h-full min-h-0 overflow-y-auto custom-scrollbar pr-4 pb-6 select-text">
        {canCurateAI && activeProposalView?.itemId === item.item_id ? (
          activeProposalView.view === 'nuevos' ? (
            <NuevosHallazgosView
              item={item}
              onDecideProposal={onDecideProposal}
              onEvolveItemByType={onEvolveItemByType}
              onClose={() => onSetProposalView(null)}
              isSealed={isSealed}
            />
          ) : (
            <ConflictosView
              item={item}
              onDecideProposal={onDecideProposal}
              onEvolveItemByType={onEvolveItemByType}
              onClose={() => onSetProposalView(null)}
              isSealed={isSealed}
            />
          )
        ) : item.content ? (
          <div className="space-y-6">
            <>
              <MarkdownRenderer
                content={sanitizeSpeculativeSymbolMarkers(item.content, pillarId)}
                pillarId={pillarId}
                activeHighlightText={canCurateAI ? activeHighlightText : undefined}
                onFragmentClick={canCurateAI ? handleFragmentClick : undefined}
                resolvedSymbology={resolvedSymbology}
                itemTitle={item.title}
                itemSources={item.item_sources || []}
                galleryFigures={galleryFigures}
                canCurateAI={canCurateAI}
                isSealed={isSealed}
                isItemLocked={Boolean(item.is_human_locked)}
                onUploadPendingFigure={handleUploadPendingFigure}
                onConfirmPendingFigure={handleConfirmPendingFigure}
              />
              <ItemFiguresAndAdvisoriesBlock
                catalogId={catalogId}
                pillarId={pillarId}
                itemId={item.item_id}
                canCurateAI={canCurateAI}
                isHumanLocked={item.is_human_locked}
                isSealed={isSealed}
                figures={item.figures || []}
                advisories={item.locked_item_advisories}
              />
              {item.item_sources?.length ? (
                <ItemizedSourcesBlock sources={item.item_sources} />
              ) : null}
            </>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                {item.approved_by && (
                  <span className="text-[10px] text-[#5A6072] font-mono tabular-nums">
                    {t('vault_dashboard.labels.by')} {item.approved_by} · {item.approved_at ? new Date(item.approved_at).toLocaleDateString() : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-[21px] px-[21px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-center space-y-[8px] rounded-none shadow-none">
            <p className="text-[11px] font-mono font-bold text-[#5A6072]">
              [Información técnica no declarada en ficha]
            </p>
            {canCurateAI && (
              <p className="text-[11px] text-[#475569] dark:text-[#8A93A6]">
                {t(
                  'vault_dashboard.item_actions.empty_item_guidance',
                  'Utilice "Actualizar con IA", "Subir Archivos" o el asistente lateral OPERMAQ IA.'
                )}
              </p>
            )}
            {canCurateAI && item.content_status === 'ERROR' && item.hunt_error && (
              <p className="text-[10px] font-mono font-bold text-[#C68346]">
                ERROR: {item.hunt_error}
              </p>
            )}
          </div>
        )}
      </div>

      {canCurateAI && (
        <div className="w-full lg:w-[38.2%] lg:max-w-[380px] shrink-0 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-[#E2E8F0] dark:border-[#12151C] pt-[13px] lg:pt-0 lg:pl-[13px] pb-2 h-full min-h-0 overflow-hidden select-none">
          <div className="flex-1 flex flex-col min-h-0 pb-2 gap-2 overflow-hidden">
            <div className="flex items-center justify-between mb-0.5 shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">OPERMAQ IA</span>
              <div className="flex items-center gap-1">
                {isSearching && (
                  <M3CircularProgress size={12} strokeWidth={2} indeterminate tone="copper" ariaLabel="Generando respuesta IA" />
                )}
                {messages.length > 0 && !isSending && (
                  <button
                    type="button"
                    onClick={handleResetChatSession}
                    title="Reiniciar sesión de chat de este ítem"
                    aria-label="Reiniciar sesión de chat de este ítem"
                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined !text-[15px]">restart_alt</span>
                  </button>
                )}
              </div>
            </div>

            <div
              ref={chatFeedRef}
              className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 scroll-smooth custom-scrollbar"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: 'var(--color-scrollbar, rgba(198,131,70,0.25)) transparent',
              }}
            >
              {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                  <span className="material-symbols-outlined !text-[28px] text-[#5A6072] mb-2">forum</span>
                  <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                    Ingrese instrucciones técnicas para consultar o curar este ítem con OPERMAQ IA.
                  </p>
                </div>
              ) : (
                messages.map((msg, index) => {
                  const isUser = msg.role === 'user';
                  const isSystem = msg.role === 'system';

                  if (isSystem) {
                    return (
                      <div key={msg.id || index} className="p-2 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-center shrink-0">
                        <p className="text-[10px] text-[#475569] dark:text-[#8A93A6] font-medium leading-relaxed">
                          {msg.content}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={msg.id || index}
                      className={`flex flex-col gap-1 max-w-[90%] shrink-0 ${isUser ? 'self-end items-end' : 'self-start items-start'}`}
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[#5A6072]">
                        {isUser ? 'Operador' : 'OPERMAQ IA'}
                      </span>

                      <div
                        className={`p-2.5 text-[11px] leading-relaxed font-atkinson rounded-none shadow-none ${isUser
                          ? 'bg-[#F8FAFC] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C]'
                          : 'bg-[#C68346]/5 text-[#0F172A] dark:text-[#F3F4F6] border border-[#C68346]/30'
                          }`}
                      >
                        <MarkdownRenderer content={msg.content} resolvedSymbology={resolvedSymbology} />
                      </div>

                      {msg.highlightText && (
                        <div className="flex items-center gap-1 mt-0.5 text-[9px] text-[#C68346] font-bold shrink-0">
                          <span className="material-symbols-outlined !text-[12px]">local_library</span>
                          Destaque activo en pantalla
                        </div>
                      )}

                      {msg.draftContent && msg.draftStatus === 'APPLIED' && (
                        <div className="mt-1 px-2 py-1 border border-[#00AEEF]/40 bg-[#00AEEF]/10 text-[#00AEEF] text-[9px] font-mono font-bold uppercase tracking-wider rounded-none shadow-none shrink-0">
                          [BORRADOR APLICADO EN CATÁLOGO]
                        </div>
                      )}

                      {msg.draftContent && msg.draftStatus === 'DISCARDED' && (
                        <div className="mt-1 px-2 py-1 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-[#5A6072] text-[9px] font-mono font-bold uppercase tracking-wider rounded-none shadow-none shrink-0">
                          [BORRADOR DESCARTADO]
                        </div>
                      )}

                      {msg.draftContent && (!msg.draftStatus || msg.draftStatus === 'PENDING') && (
                        <div className="mt-2 w-full bg-[#FFFFFF] dark:bg-[#07090D] border border-[#00AEEF]/40 p-2.5 flex flex-col gap-[8px] rounded-none shadow-none shrink-0">
                          <div className="flex items-center justify-between gap-1.5 text-[9px] font-bold uppercase tracking-wider text-[#00AEEF]">
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined !text-[14px]">edit_document</span>
                              Vista Comparativa [Actual ➔ Sugerido]
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDismissDraft(msg.id)}
                              title="Descartar propuesta de borrador"
                              aria-label="Descartar propuesta de borrador"
                              className="bg-transparent border-0 outline-none p-0.5 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                            >
                              <span className="material-symbols-outlined !text-[13px]">close</span>
                            </button>
                          </div>
                          <div className="grid grid-cols-1 gap-[8px]">
                            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] p-1.5">
                              <span className="block text-[8px] font-mono font-bold uppercase tracking-wider text-[#5A6072] mb-0.5">
                                [ACTUAL]
                              </span>
                              <div className="max-h-16 overflow-y-auto text-[9px] font-mono text-[#475569] dark:text-[#8A93A6] custom-scrollbar select-text">
                                <pre className="whitespace-pre-wrap">{selectedFragment || item.content || '[Información técnica no declarada en ficha]'}</pre>
                              </div>
                            </div>
                            <div className="border border-[#00AEEF]/40 bg-[#F8FAFC] dark:bg-[#000000] p-1.5">
                              <span className="block text-[8px] font-mono font-bold uppercase tracking-wider text-[#00AEEF] mb-0.5">
                                [SUGERIDO IA]
                              </span>
                              <div className="max-h-24 overflow-y-auto text-[9px] font-mono text-[#0F172A] dark:text-[#F3F4F6] custom-scrollbar select-text">
                                <pre className="whitespace-pre-wrap">{msg.draftContent}</pre>
                              </div>
                            </div>
                          </div>
                          <p className="text-[10px] text-[#475569] dark:text-[#8A93A6] leading-snug">
                            Escribe <span className="font-mono font-bold text-[#C68346]">"ACTUALIZAR"</span> para aplicar estos cambios en el catálogo:
                          </p>
                          <input
                            type="text"
                            value={draftConfirmInput}
                            onChange={(e) => setDraftConfirmInput(e.target.value)}
                            placeholder="ACTUALIZAR"
                            autoComplete="off"
                            spellCheck={false}
                            className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[10px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                          />
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              disabled={isSealed || isSending || draftConfirmInput.trim() !== 'ACTUALIZAR'}
                              onClick={async () => {
                                setIsSending(true);
                                const toastId = toast.loading('Aplicando propuesta de cambios...');
                                try {
                                  const userEmail = effectiveCuratorEmail;
                                  const res = await authFetch(`${API_BASE_URL}/vault/apply-assist-proposal`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      globalAssetId: catalogId,
                                      pillarId,
                                      itemId: item.item_id,
                                      finalContent: msg.draftContent,
                                      userEmail,
                                      intent: msg.intent || 'EDIT_PROPOSAL',
                                      sessionId,
                                      messageId: msg.id,
                                    }),
                                  });
                                  if (res.ok) {
                                    setMessages(prev =>
                                      prev.map(m =>
                                        m.id === msg.id ? { ...m, draftStatus: 'APPLIED' as const } : m
                                      )
                                    );
                                    toast.update(toastId, { render: 'Cambios aplicados exitosamente.', type: 'success', isLoading: false, autoClose: 3000 });
                                    setDraftConfirmInput('');
                                  } else {
                                    const json = await res.json();
                                    toast.update(toastId, { render: `Error: ${json.error || 'No se pudieron aplicar los cambios.'}`, type: 'error', isLoading: false, autoClose: 5000 });
                                  }
                                } catch (_err) {
                                  toast.update(toastId, { render: 'Error de red al aplicar cambios.', type: 'error', isLoading: false, autoClose: 5000 });
                                } finally {
                                  setIsSending(false);
                                }
                              }}
                              className="bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] text-[10px] py-1.5 font-bold uppercase tracking-wider transition-colors disabled:opacity-40 rounded-none shadow-none border-0 cursor-pointer"
                            >
                              Aprobar
                            </button>
                            <button
                              type="button"
                              disabled={isSending}
                              onClick={() => handleDismissDraft(msg.id)}
                              className="bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#0F172A] dark:hover:border-[#F3F4F6] text-[#475569] dark:text-[#8A93A6] text-[10px] py-1.5 font-bold uppercase tracking-wider transition-colors rounded-none shadow-none cursor-pointer"
                            >
                              Descartar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {isSending && (
                <div className="flex items-center gap-1.5 py-1 justify-start text-[10px] text-[#C68346] shrink-0">
                  <M3CircularProgress size={14} strokeWidth={2} indeterminate tone="copper" ariaLabel="Procesando consulta" />
                  <span>Procesando consulta...</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col shrink-0 max-h-[64%] overflow-y-auto custom-scrollbar pr-0.5">
            {selectedFragment && (
              <div className="mb-[8px] bg-[#C68346]/5 border border-[#C68346]/30 p-[8px] text-[10px] flex items-start gap-[8px] shrink-0 rounded-none">
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-[#C68346] uppercase block text-[8px] tracking-wider mb-0.5">Fragmento Seleccionado</span>
                  <p className="text-[#475569] dark:text-[#8A93A6] truncate max-w-full">
                    "{selectedFragment}"
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFragment(null)}
                  className="bg-transparent border-0 outline-none p-0.5 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  <span className="material-symbols-outlined !text-[14px]">close</span>
                </button>
              </div>
            )}

            {!item.is_human_locked && (
              <div className="flex flex-col pb-[8px]">
                <div className="bg-[#F8FAFC] dark:bg-[#07090D] rounded-none flex flex-col p-[8px] border border-[#E2E8F0] dark:border-[#12151C]">
                  <textarea
                    value={correctionText}
                    onChange={(e) => setCorrectionText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    disabled={isSending || isGenerating || isSealed}
                    rows={2}
                    placeholder={latestDraftContent ? 'Escribe ACTUALIZAR para aplicar el borrador...' : 'Ingrese instrucciones técnicas a OPERMAQ'}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full bg-transparent resize-none focus:outline-none text-[12px] text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#5A6072] custom-scrollbar px-1"
                  />
                  <div className="flex justify-end items-center gap-[8px] mt-1">
                    <button
                      type="button"
                      onClick={() => toast.info('Función de dictado disponible próximamente.')}
                      title="Dictado por voz"
                      className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                      disabled={isSending || isGenerating || isSealed}
                    >
                      <span className="material-symbols-outlined !text-[18px]">mic</span>
                    </button>
                    <button
                      type="button"
                      disabled={!correctionText.trim() || isSending || isSealed || isGenerating}
                      onClick={handleSendMessage}
                      title="Enviar instrucción"
                      className={`bg-transparent border-0 outline-none p-1 transition-colors cursor-pointer ${correctionText.trim() && !isSending && !isSealed && !isGenerating
                        ? 'text-[#C68346] hover:text-[#b07239]'
                        : 'text-[#5A6072] opacity-40 cursor-not-allowed'
                        }`}
                    >
                      <span className="material-symbols-outlined !text-[18px]">
                        arrow_upward
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Bloque 1: Diagnóstico y Curaduría de Hallazgos del Ítem (Orden Vertical 1 a 3) */}
            <div className="flex flex-col gap-[8px] pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C]">
              <button
                type="button"
                onClick={handleLocateNextPendingContent}
                className={`w-full flex items-center justify-between px-[13px] py-[6px] transition-colors border rounded-none shadow-none cursor-pointer ${pendingContentSummary.total > 0
                  ? 'bg-[#C68346]/15 border-[#C68346] text-[#C68346] font-bold hover:bg-[#C68346]/25'
                  : 'bg-transparent text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                  }`}
                title={
                  pendingContentSummary.total > 0
                    ? `${t('vault_dashboard.pending_content.tooltip', 'Contenido Pendiente')}: ${pendingContentSummary.undeclaredFieldsCount} dato(s) no declarado(s) · ${pendingContentSummary.pendingFiguresCount} imagen(es) pendiente(s). Clic para localizar en el documento.`
                    : t('vault_dashboard.pending_content.completed_tooltip', 'Sin contenido pendiente en este ítem')
                }
              >
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {t('vault_dashboard.pending_content.label', 'Contenido Pendiente')}
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-none font-mono tabular-nums ${pendingContentSummary.total > 0
                    ? 'bg-[#C68346]/20 text-[#C68346] border border-[#C68346]'
                    : 'text-[#475569] dark:text-[#8A93A6]'
                    }`}
                >
                  {pendingContentSummary.total}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (activeProposalView?.itemId === item.item_id && activeProposalView.view === 'nuevos') {
                    onSetProposalView(null);
                  } else {
                    onSetProposalView({ itemId: item.item_id, pillarId, view: 'nuevos' });
                  }
                }}
                className={`w-full flex items-center justify-between px-[13px] py-[6px] bg-transparent transition-colors border rounded-none shadow-none cursor-pointer ${activeProposalView?.itemId === item.item_id && activeProposalView.view === 'nuevos'
                  ? 'text-[#00AEEF] font-bold border-[#00AEEF]'
                  : 'text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                  }`}
                title="Nuevo Contenido"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider">Nuevo Contenido</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-none font-mono tabular-nums text-[#00AEEF]">
                  {(item.pending_conflicts ?? []).filter(p => p.estado_fusion === 'NUEVO' && p.human_decision !== 'ELIMINADO' && p.human_decision !== 'APROBADO').length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (activeProposalView?.itemId === item.item_id && activeProposalView.view === 'conflictos') {
                    onSetProposalView(null);
                  } else {
                    onSetProposalView({ itemId: item.item_id, pillarId, view: 'conflictos' });
                  }
                }}
                className={`w-full flex items-center justify-between px-[13px] py-[6px] bg-transparent transition-colors border rounded-none shadow-none cursor-pointer ${activeProposalView?.itemId === item.item_id && activeProposalView.view === 'conflictos'
                  ? 'text-[#C68346] font-bold border-[#C68346]'
                  : 'text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                  }`}
                title="Contenido en Conflicto"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider">Contenido en Conflicto</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-none font-mono tabular-nums text-[#C68346]">
                  {(item.pending_conflicts ?? []).filter(p => p.estado_fusion === 'CONFLICTO' && p.human_decision !== 'ELIMINADO' && p.human_decision !== 'APROBADO').length}
                </span>
              </button>
            </div>

            {/* Bloque 2: Herramientas Independientes de Ingesta, Publicación, Regeneración e Historial (Orden Vertical 4 a 7) */}
            <div className="flex flex-col gap-[8px] pt-[8px] mt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C]">
              <button
                type="button"
                disabled={isSending || isGenerating || isSealed}
                onClick={() => onOpenStudio ? onOpenStudio('INGESTION') : toast.info('Ingesta documental no disponible.')}
                className="w-full text-left px-[13px] py-[6px] bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] transition-colors text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] disabled:opacity-40 disabled:pointer-events-none text-[10px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                title="Ingesta documental / multimedia (PDF, ETT, esquemas, fotos)"
              >
                Subir Archivos
              </button>

              <button
                type="button"
                disabled={isSending || isGenerating}
                onClick={() => onOpenStudio ? onOpenStudio('MANUAL_PUBLISHER') : toast.info('Exportación PDF no disponible.')}
                className="w-full text-left px-[13px] py-[6px] bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] transition-colors text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] disabled:opacity-40 disabled:pointer-events-none text-[10px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                title="Manuales ilustrados y diagramación vectorial"
              >
                Generar Manual Ilustrado
              </button>

              <button
                type="button"
                disabled={isSealed || isGenerating || item.is_human_locked}
                onClick={() => setShowHuntConfirm(!showHuntConfirm)}
                className="w-full flex items-center justify-between px-[13px] py-[6px] bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] transition-colors text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] disabled:opacity-40 disabled:pointer-events-none text-[10px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                title={t(
                  'vault_dashboard.item_actions.update_with_ai_tooltip',
                  'Buscar evidencia técnica actualizada sin sobrescribir el contenido vigente'
                )}
              >
                <span>{t('vault_dashboard.item_actions.update_with_ai', 'Actualizar con IA')}</span>
                {isHuntActive && (
                  <span className="font-mono tabular-nums text-[#C68346]">
                    {Math.max(0, Math.min(100, Math.round(huntProgressPct ?? 0)))}%
                  </span>
                )}
              </button>

              {isHuntActive && (
                <div className="p-[8px] border border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col gap-[8px] rounded-none shadow-none">
                  <M3LinearProgress
                    value={huntProgressPct ?? 0}
                    indeterminate={!huntProgressPct || huntProgressPct <= 0}
                    tone="copper"
                    ariaLabel={t('vault_dashboard.item_actions.update_with_ai', 'Actualizar con IA')}
                  />
                  {huntStageMessage && (
                    <p className="text-[10px] font-mono text-[#475569] dark:text-[#8A93A6] leading-snug">
                      {huntStageMessage}
                    </p>
                  )}
                </div>
              )}

              {showHuntConfirm && !isHuntActive && (
                <div className="p-[8px] border border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col gap-[8px] rounded-none shadow-none">
                  <p className="text-[10px] text-[#C68346] font-bold leading-snug">
                    {t(
                      'vault_dashboard.item_actions.confirm_update_with_ai',
                      'Escribe "ACTUALIZAR" para buscar nueva evidencia técnica (se enviará a Nuevo Contenido o Contenido en Conflicto sin sobrescribir el texto actual):'
                    )}
                  </p>
                  <input
                    type="text"
                    value={huntConfirmText}
                    onChange={(e) => setHuntConfirmText(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === 'Enter' &&
                        huntConfirmText.trim().toUpperCase() === 'ACTUALIZAR' &&
                        !isGenerating &&
                        !isSealed
                      ) {
                        e.preventDefault();
                        onHunt();
                        setHuntConfirmText('');
                        setShowHuntConfirm(false);
                      }
                    }}
                    placeholder="ACTUALIZAR"
                    autoComplete="off"
                    spellCheck={false}
                    className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[10px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                  />
                  <div className="flex gap-[8px]">
                    <button
                      type="button"
                      disabled={huntConfirmText.trim().toUpperCase() !== 'ACTUALIZAR' || isGenerating || isSealed}
                      onClick={() => {
                        onHunt();
                        setHuntConfirmText('');
                        setShowHuntConfirm(false);
                      }}
                      className="px-2 py-1 bg-[#C68346] text-[#FFFFFF] font-bold text-[10px] disabled:opacity-40 rounded-none shadow-none border-0 cursor-pointer"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowHuntConfirm(false);
                        setHuntConfirmText('');
                      }}
                      className="px-2 py-1 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[10px] rounded-none shadow-none cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowHistoryModal(true)}
                className="w-full text-left px-[13px] py-[6px] bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] transition-colors text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] text-[10px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                title="Historial de Cambios"
              >
                Historial de Cambios
              </button>
            </div>

            {/* Bloque 3: Gobernanza y Cierre HITL del Ítem (Orden Vertical 8 a 9) */}
            <div className="flex flex-col gap-[8px] pt-[8px] mt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C]">
              {item.is_human_locked ? (
                <button
                  type="button"
                  disabled={isSealed || isGenerating}
                  onClick={() => setShowUnlockConfirm(!showUnlockConfirm)}
                  className="w-full text-left px-[13px] py-[6px] bg-transparent border border-[#C68346] transition-colors text-[#C68346] hover:bg-[#C68346] hover:text-[#FFFFFF] disabled:opacity-40 disabled:pointer-events-none text-[10px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                >
                  Editar Ítem
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isSealed || isGenerating}
                  onClick={() => setShowApprovalConfirm(!showApprovalConfirm)}
                  className="w-full text-left px-[13px] py-[6px] bg-transparent border border-[#00AEEF] transition-colors text-[#00AEEF] hover:bg-[#00AEEF] hover:text-[#FFFFFF] disabled:opacity-40 disabled:pointer-events-none text-[10px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                >
                  Aprobar Ítem
                </button>
              )}

              {showUnlockConfirm && (
                <div className="p-[8px] border border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col gap-[8px] rounded-none shadow-none">
                  <p className="text-[10px] text-[#C68346] font-bold">Escribe "ACTUALIZAR" para confirmar el desbloqueo:</p>
                  <input
                    type="text"
                    value={confirmUnlockInput}
                    onChange={(e) => setConfirmUnlockInput(e.target.value)}
                    placeholder="ACTUALIZAR"
                    autoComplete="off"
                    spellCheck={false}
                    className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[10px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                  />
                  <div className="flex gap-[8px]">
                    <button
                      type="button"
                      disabled={confirmUnlockInput.trim() !== 'ACTUALIZAR'}
                      onClick={async () => {
                        await onUnlockItem();
                        setConfirmUnlockInput('');
                        setShowUnlockConfirm(false);
                      }}
                      className="px-2 py-1 bg-[#C68346] text-[#FFFFFF] font-bold text-[10px] disabled:opacity-40 rounded-none shadow-none border-0 cursor-pointer"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmUnlockInput('');
                        setShowUnlockConfirm(false);
                      }}
                      className="px-2 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[10px] text-[#475569] dark:text-[#8A93A6] rounded-none shadow-none cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {showApprovalConfirm && (
                <div className="p-[8px] border border-[#00AEEF]/40 bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col gap-[8px] rounded-none shadow-none">
                  {pendingFiguresCount > 0 && (
                    <p className="text-[10px] text-[#C68346] font-bold flex items-center gap-[4px]">
                      <span className="material-symbols-outlined !text-[14px]">image_search</span>
                      {t('vault_dashboard.pending_figure.approval_warning', {
                        count: pendingFiguresCount,
                        defaultValue: '{{count}} imagen(es) técnica(s) pendiente(s). Tras aprobar, solo podrán registrarse como propuesta.',
                      })}
                    </p>
                  )}
                  <p className="text-[10px] text-[#00AEEF] font-bold">Escribe "ACTUALIZAR" para confirmar la aprobación:</p>
                  <input
                    type="text"
                    value={confirmApprovalInput}
                    onChange={(e) => setConfirmApprovalInput(e.target.value)}
                    placeholder="ACTUALIZAR"
                    autoComplete="off"
                    spellCheck={false}
                    className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] outline-none text-[10px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                  />
                  <div className="flex gap-[8px]">
                    <button
                      type="button"
                      disabled={confirmApprovalInput.trim() !== 'ACTUALIZAR'}
                      onClick={async () => {
                        await onUpdateApprovalState('APROBADO_HUMANO');
                        setConfirmApprovalInput('');
                        setShowApprovalConfirm(false);
                      }}
                      className="px-2 py-1 bg-[#00AEEF] text-[#FFFFFF] font-bold text-[10px] disabled:opacity-40 rounded-none shadow-none border-0 cursor-pointer"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmApprovalInput('');
                        setShowApprovalConfirm(false);
                      }}
                      className="px-2 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[10px] text-[#475569] dark:text-[#8A93A6] rounded-none shadow-none cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={isSealed || isGenerating || item.is_human_locked}
                onClick={onDiscard}
                className="w-full text-left px-[13px] py-[6px] bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#0F172A] dark:hover:border-[#F3F4F6] transition-colors text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] disabled:opacity-40 disabled:pointer-events-none text-[10px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
              >
                Descartar Ítem
              </button>
            </div>

            <VaultPilotFeedbackBox
              globalAssetId={catalogId}
              pillarId={pillarId}
              itemId={item.item_id}
              isSealed={isSealed}
              isTestPilot={isTestPilot}
            />

          </div>

        </div>
      )}

      {canCurateAI && showHistoryModal && (
        <div className="fixed inset-0 bg-[#000000]/75 flex items-center justify-center z-[100] p-4">
          <div className="bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] w-full max-w-2xl h-[80vh] flex flex-col font-atkinson p-6 justify-between rounded-none shadow-none">

            <div className="flex items-center justify-between pb-4 border-b border-[#E2E8F0] dark:border-[#12151C]">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-[#0F172A] dark:text-[#F3F4F6]">Historial de Cambios</h3>
                <p className="text-[11px] text-[#475569] dark:text-[#8A93A6]">{item.title}</p>
              </div>
              <M3IconButton
                icon="close"
                onClick={() => {
                  setShowHistoryModal(false);
                  setRollbackConfirmTimestamp(null);
                  setRollbackConfirmInput('');
                }}
              />
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4 custom-scrollbar">
              {!item.historial_cambios || item.historial_cambios.length === 0 ? (
                <p className="text-[12px] text-[#5A6072] text-center py-8">[Sin registros de auditoría en el historial de este ítem]</p>
              ) : (
                [...item.historial_cambios].reverse().map((log: HistorialAuditoria, index) => (
                  <div key={index} className="p-3 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] space-y-2 rounded-none">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6]">
                          {log.accion.replace(/_/g, ' ')}
                        </span>
                        <div className="text-[10px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                          {log.actor} · <span className="font-mono tabular-nums text-[9px] text-[#5A6072]">{new Date(log.fecha).toLocaleString()}</span>
                        </div>
                      </div>
                      {log.snapshot_anterior !== undefined && (
                        <M3Button
                          variant="ghost"
                          disabled={item.is_human_locked || isSealed}
                          onClick={() => {
                            setRollbackConfirmTimestamp(log.fecha);
                            setRollbackConfirmInput('');
                          }}
                          className="text-[#C68346] text-[10px]"
                        >
                          Restaurar Versión
                        </M3Button>
                      )}
                    </div>
                    {rollbackConfirmTimestamp === log.fecha && (
                      <div className="p-2 border border-[#C68346] bg-[#FFFFFF] dark:bg-[#07090D] space-y-2">
                        <p className="text-[10px] font-bold text-[#C68346]">
                          Escribe "ACTUALIZAR" para restaurar esta versión histórica:
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={rollbackConfirmInput}
                            onChange={(e) => setRollbackConfirmInput(e.target.value)}
                            placeholder="ACTUALIZAR"
                            autoComplete="off"
                            spellCheck={false}
                            className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[10px] font-mono flex-1 text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                          />
                          <button
                            type="button"
                            disabled={rollbackConfirmInput.trim() !== 'ACTUALIZAR'}
                            onClick={async () => {
                              await onRollbackVersion(log.fecha);
                              setRollbackConfirmTimestamp(null);
                              setRollbackConfirmInput('');
                              setShowHistoryModal(false);
                            }}
                            className="px-3 py-1 bg-[#C68346] text-[#FFFFFF] text-[10px] font-bold disabled:opacity-40 rounded-none border-0 cursor-pointer"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRollbackConfirmTimestamp(null);
                              setRollbackConfirmInput('');
                            }}
                            className="px-3 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[10px] text-[#475569] dark:text-[#8A93A6] rounded-none cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                    {log.detalle && (
                      <p className="text-[11px] text-[#475569] dark:text-[#8A93A6]">
                        "{log.detalle}"
                      </p>
                    )}
                    {log.snapshot_anterior !== undefined && (
                      <details className="group border-t border-[#E2E8F0] dark:border-[#12151C] pt-2">
                        <summary className="text-[9px] font-bold text-[#5A6072] uppercase tracking-widest cursor-pointer hover:text-[#0F172A] dark:hover:text-[#F3F4F6] list-none flex items-center gap-1">
                          <span className="material-symbols-outlined !text-[12px] transition-transform group-open:rotate-90">chevron_right</span>
                          Ver contenido de esta versión
                        </summary>
                        <div className="mt-2 p-3 bg-[#FFFFFF] dark:bg-[#07090D] max-h-60 overflow-y-auto border border-[#E2E8F0] dark:border-[#12151C] custom-scrollbar text-[11px] text-[#0F172A] dark:text-[#F3F4F6]">
                          <MarkdownRenderer content={log.snapshot_anterior} resolvedSymbology={resolvedSymbology} />
                        </div>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 border-t border-[#E2E8F0] dark:border-[#12151C] flex justify-end">
              <M3Button onClick={() => setShowHistoryModal(false)} className="text-[10px]">
                Cerrar
              </M3Button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// ─── Items List (con CAZA POR ÍTEM) ──────────────────────────────────────────

interface ItemizedItemsListProps {
  items: PillarItem[];
  canCurateAI: boolean;
  onHunt: (itemId: string, correction?: string, forceRestart?: boolean, intent?: HuntIntent) => void;
  onAiAssist: (itemId: string, userRequest: string) => Promise<AiAssistResponse | null>;
  onApplyAssist: (itemId: string, finalContent: string, intent: string) => Promise<void>;
  isAssistingItemId: string | null;
  huntProgressByItem?: Record<string, number>;
  huntStageByItem?: Record<string, string>;
  expandedItems: Set<string>;
  onToggleExpand: (id: string) => void;
  onDiscard: (itemId: string) => void;
  onReactivate?: (itemId: string) => void;
  isArchive?: boolean;
  isSealed: boolean;
  onUnlockItem: (itemId: string) => Promise<void>;
  onUpdateApprovalState: (itemId: string, state: EstadoAprobacion, notes?: string) => Promise<void>;
  onRollbackVersion: (itemId: string, timestamp: string) => Promise<void>;
  catalogId: string;

  // Nuevos:
  pillarId: PillarId;
  activeProposalView: { itemId: string; pillarId: PillarId; view: 'nuevos' | 'conflictos' } | null;
  onSetProposalView: (v: { itemId: string; pillarId: PillarId; view: 'nuevos' | 'conflictos' } | null) => void;
  onDecideProposal: (itemId: string, proposalId: string, decision: 'APROBADO' | 'ELIMINADO') => Promise<void>;
  onEvolveItemByType: (itemId: string, filterType: 'NUEVO' | 'CONFLICTO') => Promise<void>;
  resolveItemSymbology: (symbologyRefs?: string[]) => Array<{ concept_id: string; url: string; technical_name_es: string }>;
  onOpenStudio?: (tab: StudioTabId) => void;
}


function ItemizedItemsList({
  items, canCurateAI, onHunt, onAiAssist, onApplyAssist, isAssistingItemId: assistingItemId, huntProgressByItem, huntStageByItem,
  expandedItems, onToggleExpand, onDiscard: _onDiscard, onReactivate, isArchive, isSealed,
  onUnlockItem, onUpdateApprovalState, onRollbackVersion, catalogId,
  pillarId, activeProposalView, onSetProposalView, onDecideProposal, onEvolveItemByType,
  resolveItemSymbology, onOpenStudio
}: ItemizedItemsListProps) {
  const { t } = useTranslation();

  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [discardConfirmInput, setDiscardConfirmInput] = useState('');

  const [confirmReactivateId, setConfirmReactivateId] = useState<string | null>(null);
  const [reactivateConfirmInput, setReactivateConfirmInput] = useState('');

  if (!items?.length) return null;
  const sections = [...new Set(items.map(it => it.section))];
  const hasExpanded = items.some(it => expandedItems.has(it.item_id));

  return (
    <div className={`mt-4 ${isArchive ? 'opacity-60' : ''} ${hasExpanded ? 'flex-1 flex flex-col h-full min-h-0 overflow-hidden' : 'space-y-5'}`}>
      {sections.map(sec => {
        const secItems = items.filter(it => it.section === sec);
        if (hasExpanded && !secItems.some(it => expandedItems.has(it.item_id))) return null;
        return (
          <div key={sec} className={hasExpanded ? 'flex-1 flex flex-col h-full min-h-0 overflow-hidden' : ''}>
            {!hasExpanded && <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] mb-2">{sec}</p>}
            <div className={hasExpanded ? 'flex-1 flex flex-col h-full min-h-0 overflow-hidden' : 'space-y-3'}>
              {secItems.map(item => {
                const itemHuntKey = `${pillarId}:${item.item_id}`;
                const itemHuntPct = huntProgressByItem?.[itemHuntKey];
                const isCompleted = item.content_status === 'COMPLETADO' && itemHuntPct === undefined;
                const isError = item.content_status === 'ERROR' && itemHuntPct === undefined;
                const isGenerating = item.content_status === 'GENERANDO' || itemHuntPct !== undefined;
                const displayPct = Math.max(0, Math.min(100, Math.round(itemHuntPct ?? 0)));
                const isExpanded = expandedItems.has(item.item_id);
                const hasContent = !!(item.content && item.content.trim());
                const isInitialHuntActivated = Boolean(
                  item.initial_hunt_activated_at ||
                  item.hunted_at ||
                  hasContent ||
                  isGenerating ||
                  item.content_status === 'COMPLETADO' ||
                  item.content_status === 'ERROR'
                );
                const canOpenItem = !isArchive && (hasContent || (canCurateAI && isInitialHuntActivated));
                const pendingProposalsCount = (item.pending_conflicts ?? []).filter(
                  (p) => p.human_decision !== 'ELIMINADO' && p.human_decision !== 'APROBADO'
                ).length;

                if (hasExpanded && !isExpanded) return null;

                return (
                  <div
                    key={item.item_id}
                    id={`item-card-${item.item_id}`}
                    className={`p-3 border transition-colors duration-200 flex flex-col rounded-none shadow-none ${isCompleted ? 'border-[#00AEEF]/30 bg-[#FFFFFF] dark:bg-[#07090D]' :
                      isError ? 'border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D]' :
                        isGenerating ? 'border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D]' :
                          'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D]'
                      } ${isExpanded ? 'flex-1 h-full min-h-0 overflow-hidden border-[#C68346]' : ''}`}
                  >
                    {/* Cabecera del ítem */}
                    <div className="flex items-start gap-3 shrink-0">
                      <div className="flex items-center gap-2 shrink-0 mt-0.5">
                        {isExpanded && (
                          <button
                            type="button"
                            onClick={() => {
                              if (activeProposalView?.itemId === item.item_id) {
                                onSetProposalView(null);
                              } else {
                                onToggleExpand(item.item_id);
                              }
                            }}
                            title={
                              activeProposalView?.itemId === item.item_id
                                ? 'Volver al contenido del ítem'
                                : 'Volver al listado de ítems'
                            }
                            aria-label={
                              activeProposalView?.itemId === item.item_id
                                ? 'Volver al contenido del ítem'
                                : 'Volver al listado de ítems'
                            }
                            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none"
                          >
                            <span className="material-symbols-outlined !text-[20px]">arrow_back</span>
                          </button>
                        )}
                        <span className="text-[11px] font-mono tabular-nums text-[#5A6072]">{String(item.order).padStart(2, '0')}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className={canOpenItem ? 'cursor-pointer' : ''} onClick={() => canOpenItem ? onToggleExpand(item.item_id) : undefined}>
                          <p className="text-[13px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">{item.title}</p>
                          <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] mt-0.5">{item.rationale}</p>
                          {!hasContent && !canCurateAI && (
                            <p className="mt-1">
                              <mark className={PENDING_CONTENT_HIGHLIGHT_CLASS}>[Información técnica no declarada en ficha]</mark>
                            </p>
                          )}
                        </div>
                        {item.created_by ? (
                          <p className="text-[10px] font-mono text-[#C68346] mt-1">{item.created_by}</p>
                        ) : item.standard ? (
                          <p className="text-[10px] font-mono text-[#C68346] mt-1">{item.standard}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-col items-end gap-[8px] shrink-0">
                        {!isArchive ? (
                          <div className="flex items-center gap-[8px]">
                            {isGenerating && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (canCurateAI && !isSealed) {
                                    onHunt(
                                      item.item_id,
                                      undefined,
                                      true,
                                      hasContent ? 'INCREMENTAL_UPDATE' : 'INITIAL_CAPTURE'
                                    );
                                  }
                                }}
                                title={
                                  canCurateAI
                                    ? 'Procesamiento IA en curso — Clic para reanudar si se interrumpió'
                                    : 'Procesamiento IA en curso'
                                }
                                className="bg-transparent border-0 outline-none flex items-center gap-[8px] h-8 px-1.5 text-[12px] font-mono tabular-nums font-bold text-[#C68346] select-none cursor-pointer rounded-none"
                                aria-live="polite"
                              >
                                <M3CircularProgress
                                  size={16}
                                  strokeWidth={2.5}
                                  value={displayPct}
                                  indeterminate={displayPct <= 0}
                                  tone="copper"
                                  ariaLabel="Progreso de captura IA"
                                />
                                <span>{displayPct}%</span>
                              </button>
                            )}

                            {canCurateAI && pendingProposalsCount > 0 && (
                              <span
                                className="flex items-center gap-[4px] h-6 px-[6px] shrink-0 bg-[#00AEEF]/10 dark:bg-[#00AEEF]/15 text-[#00AEEF] border border-[#00AEEF] rounded-none"
                                title={`${pendingProposalsCount} hallazgo(s) pendiente(s) de revisión (Nuevo Contenido / Conflicto)`}
                              >
                                <span className="material-symbols-outlined !text-[14px]">release_alert</span>
                                <span className="text-[11px] font-mono tabular-nums font-bold">{pendingProposalsCount}</span>
                              </span>
                            )}

                            {(() => {
                              const pendingFigCount = countItemPendingFigures(item.content, item.title, item.item_sources, item.figures);
                              const pendingTextCount = countUndeclaredTextInMarkdown(item.content);
                              const totalItemPending = pendingFigCount + pendingTextCount;
                              return totalItemPending > 0 ? (
                                <span
                                  className="flex items-center gap-[4px] h-6 px-[6px] shrink-0 bg-[#C68346]/15 dark:bg-[#C68346]/20 text-[#C68346] border border-[#C68346] rounded-none"
                                  title={`${t('vault_dashboard.pending_content.label', 'Contenido Pendiente')}: ${pendingTextCount} dato(s) no declarado(s) · ${pendingFigCount} imagen(es) pendiente(s)`}
                                >
                                  <span className="material-symbols-outlined !text-[14px]">pending_actions</span>
                                  <span className="text-[11px] font-mono tabular-nums font-bold">{totalItemPending}</span>
                                </span>
                              ) : null;
                            })()}

                            {item.is_human_locked ? (
                              <span className="flex items-center justify-center w-8 h-8 shrink-0">
                                <span className="material-symbols-outlined !text-[20px] text-[#00AEEF]" title="Verificado">verified</span>
                              </span>
                            ) : canCurateAI && isInitialHuntActivated && !isExpanded && !isGenerating ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleExpand(item.item_id);
                                }}
                                title={t('vault_dashboard.item_actions.open_item', 'Abrir contenido del ítem')}
                                aria-label={t('vault_dashboard.item_actions.open_item', 'Abrir contenido del ítem')}
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none"
                              >
                                <span className="material-symbols-outlined !text-[20px]">edit_document</span>
                              </button>
                            ) : canCurateAI && !isInitialHuntActivated && !isExpanded && !isGenerating ? (
                              <>
                                <M3IconButton
                                  icon="travel_explore"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isSealed) onHunt(item.item_id, undefined, false, 'INITIAL_CAPTURE');
                                  }}
                                  variant="ghost"
                                  title={t('vault_dashboard.item_actions.hunt_content', 'Cazar contenido')}
                                  className={`text-[#C68346] ${isSealed ? 'opacity-20 cursor-not-allowed' : ''}`}
                                  disabled={isSealed || item.is_human_locked}
                                />
                                <M3IconButton
                                  icon="text_ad_off"
                                  onClick={(e) => { e.stopPropagation(); if (!isSealed) setConfirmDiscardId(item.item_id); }}
                                  variant="ghost"
                                  title="Descartar ítem"
                                  className={`text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] ${isSealed ? 'opacity-20 cursor-not-allowed' : ''}`}
                                  disabled={isSealed || item.is_human_locked}
                                />
                              </>
                            ) : null}
                          </div>
                        ) : (
                          canCurateAI && !isExpanded && (
                            <M3Button
                              variant="ghost"
                              onClick={() => { if (!isSealed) setConfirmReactivateId(item.item_id); }}
                              className={`text-[10px] text-[#00AEEF] ${isSealed ? 'opacity-40 cursor-not-allowed' : ''}`}
                              disabled={isSealed}
                            >
                              {isSealed ? (t('vault_dashboard.bloqueado') || 'BLOQUEADO').toUpperCase() : (t('vault_dashboard.reactivate') || 'REACTIVAR').toUpperCase()}
                            </M3Button>
                          )
                        )}

                        {canCurateAI && !isArchive && item.content_status === 'ERROR' && item.hunt_error && (
                          <p className="text-[9px] text-[#C68346] font-bold uppercase tracking-tight">ERROR: {item.hunt_error}</p>
                        )}

                      </div>
                    </div>

                    {/* Confirmación Descarte Inline */}
                    {canCurateAI && confirmDiscardId === item.item_id && (
                      <div className="mt-3 p-3 bg-[#F8FAFC] dark:bg-[#000000] border border-[#C68346] space-y-2 w-full text-left rounded-none">
                        <p className="text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">¿Descartar este ítem del catálogo visible? Escribe <span className="font-mono text-[#C68346]">"ACTUALIZAR"</span> para confirmar:</p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={discardConfirmInput}
                            onChange={(e) => setDiscardConfirmInput(e.target.value)}
                            placeholder="ACTUALIZAR"
                            autoComplete="off"
                            spellCheck={false}
                            className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[11px] font-mono flex-1 text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                          />
                          <button
                            type="button"
                            disabled={discardConfirmInput.trim() !== 'ACTUALIZAR'}
                            onClick={() => {
                              _onDiscard(item.item_id);
                              setConfirmDiscardId(null);
                              setDiscardConfirmInput('');
                            }}
                            className="px-3 py-1 bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] font-bold disabled:opacity-40 text-[11px] rounded-none border-0 cursor-pointer"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDiscardId(null);
                              setDiscardConfirmInput('');
                            }}
                            className="px-3 py-1 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[11px] rounded-none cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Confirmación Reactivación Inline */}
                    {canCurateAI && confirmReactivateId === item.item_id && (
                      <div className="mt-3 p-3 bg-[#F8FAFC] dark:bg-[#000000] border border-[#00AEEF] space-y-2 w-full text-left rounded-none">
                        <p className="text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">¿Reactivar este ítem en el listado activo? Escribe <span className="font-mono text-[#C68346]">"ACTUALIZAR"</span> para confirmar:</p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={reactivateConfirmInput}
                            onChange={(e) => setReactivateConfirmInput(e.target.value)}
                            placeholder="ACTUALIZAR"
                            autoComplete="off"
                            spellCheck={false}
                            className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] outline-none text-[11px] font-mono flex-1 text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                          />
                          <button
                            type="button"
                            disabled={reactivateConfirmInput.trim() !== 'ACTUALIZAR'}
                            onClick={() => {
                              onReactivate?.(item.item_id);
                              setConfirmReactivateId(null);
                              setReactivateConfirmInput('');
                            }}
                            className="px-3 py-1 bg-[#00AEEF] text-[#FFFFFF] font-bold disabled:opacity-40 text-[11px] rounded-none border-0 cursor-pointer"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmReactivateId(null);
                              setReactivateConfirmInput('');
                            }}
                            className="px-3 py-1 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[11px] rounded-none cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Contenido del ítem */}
                    {isExpanded && (
                      <div className="mt-4 flex-1 flex flex-row min-h-0 border-t border-[#E2E8F0] dark:border-[#12151C] pt-4 h-full overflow-hidden">
                        <ItemContentBlock
                          item={item}
                          canCurateAI={canCurateAI}
                          isHunting={isGenerating}
                          huntProgressPct={displayPct}
                          huntStageMessage={huntStageByItem?.[itemHuntKey]}
                          onAiAssist={(req) => onAiAssist(item.item_id, req)}
                          onApplyAssist={(final, intent) => onApplyAssist(item.item_id, final, intent)}
                          assistingItemId={assistingItemId}
                          isSealed={isSealed}
                          onHunt={() => onHunt(item.item_id, undefined, false, 'INCREMENTAL_UPDATE')}
                          onDiscard={() => setConfirmDiscardId(item.item_id)}
                          onUnlockItem={() => onUnlockItem(item.item_id)}
                          onUpdateApprovalState={(state, notes) => onUpdateApprovalState(item.item_id, state, notes)}
                          onRollbackVersion={(timestamp) => onRollbackVersion(item.item_id, timestamp)}
                          pillarId={pillarId}
                          activeProposalView={activeProposalView}
                          onSetProposalView={onSetProposalView}
                          onDecideProposal={(proposalId, decision) => onDecideProposal(item.item_id, proposalId, decision)}
                          onEvolveItemByType={(filterType) => onEvolveItemByType(item.item_id, filterType)}
                          catalogId={catalogId}
                          resolvedSymbology={resolveItemSymbology(item.symbology_refs)}
                          onOpenStudio={onOpenStudio}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Complementary Suggestion Row (Formato de Lista Homologado a ItemizedItemsList) ───
interface ComplementarySuggestionCardProps {
  index: number;
  suggestion: { title: string; rationale: string; section: string; source?: Record<string, unknown> };
  onConfirm: (title: string, section: string, rationale: string) => Promise<void>;
  onIgnore: () => void;
}

const ComplementarySuggestionCard: React.FC<ComplementarySuggestionCardProps> = ({
  index, suggestion, onConfirm, onIgnore
}) => {
  const [showConfirmBar, setShowConfirmBar] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const source = suggestion.source as ItemizedSource | undefined;

  return (
    <div className="p-3 border border-[#00AEEF]/30 hover:border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#07090D] transition-colors duration-200 flex flex-col rounded-none shadow-none">
      {/* Cabecera de fila idéntica a ItemizedItemsList */}
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
          <span className="text-[11px] font-mono tabular-nums text-[#00AEEF]">
            +{String(index + 1).padStart(2, '0')}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
            {suggestion.title}
          </p>
          <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] mt-0.5">
            {suggestion.rationale}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="text-[10px] font-mono text-[#00AEEF] uppercase">
              {suggestion.section}
            </span>
            {source && (source.author || source.url) && (
              <span className="text-[10px] font-mono text-[#5A6072] flex items-center gap-1">
                <span>· {source.author || 'Fuente'}</span>
                {source.description && (
                  <span className="truncate max-w-[360px]">"{source.description}"</span>
                )}
                {source.url && (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#00AEEF] hover:underline font-bold ml-1"
                  >
                    [Fuente]
                  </a>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <M3IconButton
            icon="add_circle"
            onClick={() => setShowConfirmBar((prev) => !prev)}
            variant="ghost"
            title="Incorporar ítem complementario al pilar"
            className="text-[#00AEEF] hover:text-[#C68346]"
            disabled={isSubmitting}
          />
          <M3IconButton
            icon="text_ad_off"
            onClick={onIgnore}
            variant="ghost"
            title="Descartar sugerencia"
            className="text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]"
            disabled={isSubmitting}
          />
        </div>
      </div>

      {/* Confirmación Inline idéntica a ItemizedItemsList */}
      {showConfirmBar && (
        <div className="mt-3 p-3 bg-[#F8FAFC] dark:bg-[#000000] border border-[#C68346] space-y-2 w-full text-left rounded-none">
          <p className="text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
            ¿Incorporar este ítem complementario al listado del pilar? Escribe <span className="font-mono text-[#C68346]">"ACTUALIZAR"</span> para confirmar:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="ACTUALIZAR"
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
              className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[11px] font-mono flex-1 text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
            />
            <button
              type="button"
              disabled={confirmInput.trim() !== 'ACTUALIZAR' || isSubmitting}
              onClick={async () => {
                setIsSubmitting(true);
                try {
                  await onConfirm(suggestion.title, suggestion.section, suggestion.rationale);
                  setShowConfirmBar(false);
                  setConfirmInput('');
                } finally {
                  setIsSubmitting(false);
                }
              }}
              className="px-3 py-1 bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] font-bold disabled:opacity-40 text-[11px] rounded-none border-0 cursor-pointer"
            >
              {isSubmitting ? 'Actualizando...' : 'Confirmar'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowConfirmBar(false);
                setConfirmInput('');
              }}
              className="px-3 py-1 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[11px] rounded-none cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};



// ─── Pillar Tab Content ───────────────────────────────────────────────────────
interface PillarTabContentProps {
  pillarMeta: typeof PILLARS[number];
  pillar?: PillarDocument;
  catalogId: string;
  canCurateAI: boolean;
  onItemize: (pillarId: PillarId) => void;
  onHuntItem: (pillarId: PillarId, itemId: string, correction?: string, forceRestart?: boolean, intent?: HuntIntent) => void;
  onAiAssistItem: (pillarId: PillarId, itemId: string, userRequest: string) => Promise<AiAssistResponse | null>;
  onApplyAssistItem: (pillarId: PillarId, itemId: string, finalContent: string, intent: string) => Promise<void>;
  onCreateItem: (pillarId: PillarId, title: string, section: string, rationale?: string, itemSource?: Record<string, unknown>) => Promise<void>;
  itemizing: boolean;
  huntProgressByItem: Record<string, number>;
  huntStageByItem?: Record<string, string>;
  assistingItemId: string | null;
  expandedItems: Set<string>;
  onToggleExpand: (id: string) => void;
  onDiscardItem: (itemId: string) => void;
  onReactivateItem: (itemId: string) => void;
  isSealed: boolean;
  onUnlockItem: (itemId: string) => Promise<void>;
  onUpdateApprovalState: (itemId: string, state: EstadoAprobacion, notes?: string) => Promise<void>;
  onRollbackVersion: (itemId: string, timestamp: string) => Promise<void>;

  // Nuevos:
  activeProposalView: { itemId: string; pillarId: PillarId; view: 'nuevos' | 'conflictos' } | null;
  onSetProposalView: (v: { itemId: string; pillarId: PillarId; view: 'nuevos' | 'conflictos' } | null) => void;
  onDecideProposal: (pillarId: PillarId, itemId: string, proposalId: string, decision: 'APROBADO' | 'ELIMINADO') => Promise<void>;
  onEvolveItemByType: (pillarId: PillarId, itemId: string, filterType: 'NUEVO' | 'CONFLICTO') => Promise<void>;
  resolveItemSymbology: (symbologyRefs?: string[]) => Array<{ concept_id: string; url: string; technical_name_es: string }>;
  onOpenStudio?: (tab: StudioTabId) => void;
  prerequisitePillar?: {
    id: PillarId;
    stepCode: string;
    label: string;
    isItemized: boolean;
    currentDigest?: string | null;
    hasAncestorChainEvolved?: boolean;
  } | null;
  onNavigateToPillar?: (id: PillarId) => void;
}

const PillarTabContent: React.FC<PillarTabContentProps> = ({
  pillarMeta, pillar, catalogId, canCurateAI, onItemize, onHuntItem, onAiAssistItem, onApplyAssistItem, onCreateItem, itemizing, huntProgressByItem, huntStageByItem, assistingItemId, expandedItems, onToggleExpand, onDiscardItem, onReactivateItem,
  isSealed, onUnlockItem, onUpdateApprovalState, onRollbackVersion,
  activeProposalView, onSetProposalView, onDecideProposal, onEvolveItemByType,
  resolveItemSymbology, onOpenStudio, prerequisitePillar, onNavigateToPillar
}) => {
  const { t } = useTranslation();
  const [showArchive, setShowArchive] = useState(false);
  const [newManualItemTitle, setNewManualItemTitle] = useState('');

  // Estados para creación manual con validación de IA
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createFormTitle, setCreateFormTitle] = useState('');
  const [createFormRationale, setCreateFormRationale] = useState('');
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionResult, setCorrectionResult] = useState<{ title: string; rationale: string; section: string } | null>(null);
  const [registerConfirmation, setRegisterConfirmation] = useState('');

  // Estados para búsqueda complementaria
  const [isComplementarySearching, setIsComplementarySearching] = useState(false);
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);

  const handleTriggerComplementarySearch = async () => {
    if (!canCurateAI) return;
    setIsComplementarySearching(true);
    const toastId = toast.loading(t('vault_dashboard.status.searching_complementary_items', 'Buscando ítems complementarios…'));
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/suggest-complementary-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId: pillarMeta.id })
      });
      if (response.ok) {
        const data = await response.json();
        const hasNew = data.suggestions && data.suggestions.length > 0;
        if (hasNew) {
          toast.update(toastId, { render: t('vault_dashboard.status.complementary_items_found', 'Sugerencias encontradas.'), type: 'success', isLoading: false, autoClose: 3000 });
        } else {
          toast.update(toastId, { render: t('vault_dashboard.status.no_new_suggestions', 'No se encontraron nuevos ítems complementarios para sugerir.'), type: 'info', isLoading: false, autoClose: 5000 });
        }
      } else {
        const json = await response.json();
        toast.update(toastId, { render: `Error: ${json.error || t('vault_dashboard.status.failed_to_search_suggestions', 'Error al obtener sugerencias.')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_err) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error'), type: 'error', isLoading: false, autoClose: 5000 });
    } finally {
      setIsComplementarySearching(false);
    }
  };

  const handleDiscardSuggestion = async (title: string, section: string, rationale: string, source?: Record<string, unknown>) => {
    if (!canCurateAI) return;
    const toastId = toast.loading(t('vault_dashboard.status.discarding_suggestion', 'Descartando sugerencia…'));
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/discard-suggested-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalAssetId: catalogId,
          pillarId: pillarMeta.id,
          title,
          section,
          rationale,
          source
        })
      });
      if (response.ok) {
        toast.update(toastId, { render: t('vault_dashboard.status.suggestion_discarded', 'Sugerencia descartada y archivada.'), type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await response.json();
        toast.update(toastId, { render: `Error: ${json.error || t('vault_dashboard.status.failed_to_discard_suggestion', 'Error al descartar sugerencia.')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_err) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  };

  const itemizeStatus = pillar?.itemize_status ?? 'IDLE';

  const allItems = pillar?.items ?? [];
  const activeItems = allItems.filter(it => !it.is_discarded);
  const discardedItems = allItems.filter(it => it.is_discarded);

  const hasItems = activeItems.length > 0;
  const startedAt = pillar?.started_at;
  const startedTime = startedAt?.toDate ? startedAt.toDate().getTime() : (startedAt ? new Date(startedAt).getTime() : 0);
  const isStuck = itemizeStatus === 'GENERATING' && (startedTime <= 0 || Date.now() - startedTime > 45 * 1000);
  const isItemizing = itemizing || (itemizeStatus === 'GENERATING' && !isStuck);
  const completedItems = activeItems.filter(it => it.content_status === 'COMPLETADO').length;
  const totalItems = activeItems.length;
  const activeHuntsCount = activeItems.filter(
    (it) => it.content_status === 'GENERANDO' || huntProgressByItem[`${pillarMeta.id}:${it.item_id}`] !== undefined
  ).length;
  const isSequenceBlocked = Boolean(prerequisitePillar && !prerequisitePillar.isItemized);
  const isParentPillarEvolved = Boolean(
    hasItems &&
    (prerequisitePillar?.hasAncestorChainEvolved ||
      (prerequisitePillar?.currentDigest &&
        pillar?.parent_pillar_digest_sha256 &&
        prerequisitePillar.currentDigest !== pillar.parent_pillar_digest_sha256))
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-4 px-5 py-3 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
        {/* Izquierda: Icono volver (si hay ítem expandido) + Nombre del pilar + Controles exclusivos de curación */}
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          {expandedItems.size > 0 && (
            <button
              type="button"
              onClick={() => {
                if (activeProposalView) {
                  onSetProposalView(null);
                } else {
                  expandedItems.forEach((id) => onToggleExpand(id));
                }
              }}
              title={activeProposalView ? 'Volver al contenido del ítem' : 'Volver al listado de ítems'}
              aria-label={activeProposalView ? 'Volver al contenido del ítem' : 'Volver al listado de ítems'}
              className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none"
            >
              <span className="material-symbols-outlined !text-[20px]">arrow_back</span>
            </button>
          )}
          <h1 className="text-[13px] font-bold uppercase tracking-widest text-[#0F172A] dark:text-[#F3F4F6] leading-none whitespace-nowrap">
            {t(`vault_dashboard.pillars.${pillarMeta.id}`, pillarMeta.label)}
          </h1>

          {canCurateAI && itemizeStatus === 'PARTIAL_FROM_INGESTION' && expandedItems.size === 0 && (
            <button
              type="button"
              disabled={isSealed || isItemizing || isSequenceBlocked}
              onClick={() => onItemize(pillarMeta.id)}
              title={
                isSequenceBlocked && prerequisitePillar
                  ? `Debe itemizar primero ${prerequisitePillar.stepCode} ${prerequisitePillar.label}`
                  : 'Completar estructura elástica del pilar conservando los capítulos ya ingeridos'
              }
              className="px-[13px] py-[8px] border border-[#C68346] bg-transparent hover:bg-[#C68346] text-[#C68346] hover:text-[#FFFFFF] text-[10px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Completar Estructura del Pilar
            </button>
          )}

          {canCurateAI && isParentPillarEvolved && itemizeStatus !== 'PARTIAL_FROM_INGESTION' && expandedItems.size === 0 && (
            <button
              type="button"
              disabled={isSealed || isItemizing || isSequenceBlocked}
              onClick={() => onItemize(pillarMeta.id)}
              title={
                prerequisitePillar
                  ? `El pilar precedente (${prerequisitePillar.stepCode} ${prerequisitePillar.label}) evolucionó estructuralmente. Sincronizar capítulos faltantes sin perder avances.`
                  : 'Sincronizar estructura con pilar precedente'
              }
              className="px-[13px] py-[8px] border border-[#00AEEF] bg-transparent hover:bg-[#00AEEF] text-[#00AEEF] hover:text-[#FFFFFF] text-[10px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Sincronizar con Pilar Precedente
            </button>
          )}

          {canCurateAI && (itemizeStatus === 'COMPLETED' || itemizeStatus === 'PARTIAL_FROM_INGESTION') && expandedItems.size === 0 && (
            <button
              type="button"
              disabled={isSealed || isComplementarySearching}
              onClick={handleTriggerComplementarySearch}
              title={t('vault_dashboard.actions.search_complementary_items', 'Buscar ítems complementarios con IA')}
              className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              {isComplementarySearching ? (
                <M3CircularProgress
                  size={16}
                  strokeWidth={2.5}
                  indeterminate
                  tone="copper"
                  ariaLabel="Buscando ítems complementarios"
                />
              ) : (
                <span className="material-symbols-outlined !text-[18px]">autorenew</span>
              )}
            </button>
          )}

          {/* Campo de creación manual de ítem (exclusivo curación) */}
          {canCurateAI && (itemizeStatus === 'COMPLETED' || itemizeStatus === 'PARTIAL_FROM_INGESTION') && expandedItems.size === 0 && (
            <div className="flex items-center gap-1.5 flex-1 max-w-lg min-w-[200px]">
              <input
                type="text"
                value={newManualItemTitle}
                onChange={(e) => setNewManualItemTitle(e.target.value)}
                placeholder={t('vault_dashboard.labels.new_item_placeholder', 'Nombre del nuevo ítem...')}
                autoComplete="off"
                spellCheck={false}
                disabled={isSealed}
                className="w-full h-9 px-3 text-[13px] bg-transparent border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none transition-colors font-atkinson rounded-none text-[#0F172A] dark:text-[#F3F4F6]"
              />
              <button
                type="button"
                disabled={!newManualItemTitle.trim() || isSealed}
                onClick={() => {
                  setCreateFormTitle(newManualItemTitle);
                  setCreateFormRationale('');
                  setCorrectionResult(null);
                  setRegisterConfirmation('');
                  setShowCreateForm(true);
                  setNewManualItemTitle('');
                }}
                title={t('vault_dashboard.actions.create_item', 'Crear ítem')}
                className={`bg-transparent border-0 outline-none p-1 shrink-0 transition-colors cursor-pointer ${newManualItemTitle.trim() && !isSealed
                  ? 'text-[#C68346] hover:text-[#b07239]'
                  : 'text-[#5A6072] opacity-40 cursor-not-allowed'
                  }`}
              >
                <span className="material-symbols-outlined !text-[20px]">add_circle</span>
              </button>
            </div>
          )}
        </div>

        {/* Derecha: Estado asíncrono no bloqueante + Progreso M3 Linear Progress Indicator + Timestamp */}
        <div className="flex items-center gap-[13px] shrink-0 ml-auto">
          {activeHuntsCount > 0 && (
            <span className="text-[10px] font-mono tabular-nums font-bold uppercase tracking-wider text-[#C68346] border border-[#C68346]/40 px-[8px] py-[4px] select-none">
              SEGUNDO PLANO ({activeHuntsCount}) · NAVEGACIÓN Y BÚSQUEDAS HABILITADAS
            </span>
          )}
          {hasItems && totalItems > 0 && (
            <div className="flex items-center gap-[8px]" title={t('vault_dashboard.labels.items_progress', { completed: completedItems, total: totalItems })}>
              <M3LinearProgress
                value={Math.round((completedItems / totalItems) * 100)}
                tone={completedItems === totalItems ? 'cyan' : 'copper'}
                className="w-[89px]"
                ariaLabel={t('vault_dashboard.labels.items_progress', { completed: completedItems, total: totalItems })}
              />
              <span className={`text-[10px] font-bold font-mono tabular-nums ${completedItems === totalItems ? 'text-[#00AEEF]' : 'text-[#C68346]'
                }`}>
                {completedItems}/{totalItems}
              </span>
            </div>
          )}
          {pillar?.itemized_at && (
            <span className="text-[10px] text-[#5A6072] font-mono tabular-nums">
              {new Date(pillar.itemized_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
        </div>
      </div>

      {/* M3 Linear Progress Indeterminate durante itemización */}
      {isItemizing && (
        <M3LinearProgress
          indeterminate
          tone="copper"
          className="w-full shrink-0"
          ariaLabel="Itemizando estructura del pilar"
        />
      )}

      {/* Body scrollable */}
      <div className={`flex-1 min-h-0 px-5 py-5 ${expandedItems.size > 0 ? 'overflow-hidden flex flex-col' : 'overflow-y-auto custom-scrollbar'}`}>
        <>
          {/* Sugerencias de ítems complementarios en formato de lista homologado (exclusivo curación) */}
          {canCurateAI && expandedItems.size === 0 && (pillar?.suggested_items_pending || []).length > 0 && (
            <div className="mb-5 space-y-3 rounded-none shadow-none">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#00AEEF]">
                  {t('vault_dashboard.suggestions.title', 'Ítems Complementarios Sugeridos por IA')} (<span className="font-mono tabular-nums">{(pillar?.suggested_items_pending || []).length}</span>)
                </p>
                <button
                  type="button"
                  onClick={() => setSuggestionsCollapsed(!suggestionsCollapsed)}
                  title={suggestionsCollapsed ? t('vault_dashboard.actions.expand', 'Expandir') : t('vault_dashboard.actions.collapse', 'Contraer')}
                  className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined !text-[18px]">
                    {suggestionsCollapsed ? 'expand_more' : 'expand_less'}
                  </span>
                </button>
              </div>

              {!suggestionsCollapsed && (
                <div className="space-y-3">
                  {(pillar?.suggested_items_pending || []).map((sug, idx) => (
                    <ComplementarySuggestionCard
                      key={sug.title}
                      index={idx}
                      suggestion={sug}
                      onConfirm={async (title, section, rationale) => {
                        await onCreateItem(pillarMeta.id, title, section, rationale, sug.source);
                      }}
                      onIgnore={() => {
                        handleDiscardSuggestion(sug.title, sug.section, sug.rationale, sug.source);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Formulario de creación manual con validación de IA (exclusivo curación) */}
          {canCurateAI && showCreateForm && (
            <div className="mb-6 p-4 border border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none">
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-[#C68346] mb-3 font-atkinson">
                Crear Nuevo Ítem Manualmente
              </h3>

              {!correctionResult ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-widest mb-1">
                      Título del ítem
                    </label>
                    <input
                      type="text"
                      value={createFormTitle}
                      onChange={(e) => setCreateFormTitle(e.target.value)}
                      placeholder="Escriba el nombre del ítem..."
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full h-9 px-3 text-[12px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[#0F172A] dark:text-[#F3F4F6] font-atkinson rounded-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-[#475569] dark:text-[#8A93A6] uppercase tracking-widest mb-1">
                      Breve descripción de contenidos (Rationale)
                    </label>
                    <textarea
                      value={createFormRationale}
                      onChange={(e) => setCreateFormRationale(e.target.value)}
                      placeholder="Escriba una breve descripción..."
                      autoComplete="off"
                      spellCheck={false}
                      rows={3}
                      className="w-full p-3 text-[12px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[#0F172A] dark:text-[#F3F4F6] font-atkinson resize-none rounded-none"
                    />
                  </div>

                  <div className="flex gap-2 justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateForm(false);
                        setCreateFormTitle('');
                        setCreateFormRationale('');
                      }}
                      className="px-3 py-1.5 text-[11px] font-bold bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] cursor-pointer rounded-none"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={isCorrecting || !createFormTitle.trim() || !createFormRationale.trim()}
                      onClick={async () => {
                        setIsCorrecting(true);
                        try {
                          const response = await authFetch(`${API_BASE_URL}/vault/correct-manual-item`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              title: createFormTitle,
                              rationale: createFormRationale,
                              globalAssetId: catalogId,
                              pillarId: pillarMeta.id,
                            })
                          });
                          if (response.ok) {
                            const data = await response.json();
                            if (data.corrected) {
                              setCorrectionResult({
                                title: data.corrected.title || createFormTitle,
                                rationale: data.corrected.rationale || createFormRationale,
                                section: data.corrected.section || 'ESPECIFICACIÓN TÉCNICA',
                              });
                            } else {
                              setCorrectionResult({ title: createFormTitle, rationale: createFormRationale, section: 'ESPECIFICACIÓN TÉCNICA' });
                            }
                          } else {
                            setCorrectionResult({ title: createFormTitle, rationale: createFormRationale, section: 'ESPECIFICACIÓN TÉCNICA' });
                          }
                        } catch (_err) {
                          setCorrectionResult({ title: createFormTitle, rationale: createFormRationale, section: 'ESPECIFICACIÓN TÉCNICA' });
                        } finally {
                          setIsCorrecting(false);
                        }
                      }}
                      className="px-3 py-1.5 text-[11px] font-bold bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] disabled:opacity-50 border-0 cursor-pointer rounded-none"
                    >
                      {isCorrecting ? 'Validando con IA...' : 'Validar con IA'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] space-y-3 rounded-none">
                    <p className="text-[11px] font-bold text-[#C68346] uppercase tracking-wider mb-2">Revisión de IA (Original vs Sugerido)</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <p className="text-[9px] font-bold text-[#5A6072] uppercase">Título Original</p>
                        <p className="text-[11px] line-through text-[#475569] dark:text-[#8A93A6]">{createFormTitle}</p>
                        <p className="text-[9px] font-bold text-[#00AEEF] uppercase mt-2">Título Sugerido</p>
                        <p className="text-[12px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">{correctionResult.title}</p>
                        <p className="text-[9px] font-bold text-[#00AEEF] uppercase mt-2">Sección Técnica Asignada</p>
                        <p className="text-[11px] font-mono font-bold text-[#C68346]">{correctionResult.section}</p>
                      </div>

                      <div className="space-y-1">
                        <p className="text-[9px] font-bold text-[#5A6072] uppercase">Descripción Original</p>
                        <p className="text-[11px] line-through text-[#475569] dark:text-[#8A93A6]">{createFormRationale}</p>
                        <p className="text-[9px] font-bold text-[#00AEEF] uppercase mt-2">Descripción Sugerida</p>
                        <p className="text-[11px] text-[#0F172A] dark:text-[#F3F4F6]">{correctionResult.rationale}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                      Escriba <span className="font-mono text-[#C68346]">"ACTUALIZAR"</span> para autorizar el ingreso del nuevo ítem:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={registerConfirmation}
                        onChange={(e) => setRegisterConfirmation(e.target.value)}
                        placeholder="ACTUALIZAR"
                        autoComplete="off"
                        spellCheck={false}
                        className="px-3 h-9 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[12px] flex-1 text-[#0F172A] dark:text-[#F3F4F6] font-mono rounded-none"
                      />
                      <button
                        type="button"
                        disabled={registerConfirmation.trim() !== 'ACTUALIZAR'}
                        onClick={async () => {
                          await onCreateItem(
                            pillarMeta.id,
                            correctionResult.title,
                            correctionResult.section || 'ESPECIFICACIÓN TÉCNICA',
                            correctionResult.rationale
                          );
                          setShowCreateForm(false);
                          setCreateFormTitle('');
                          setCreateFormRationale('');
                          setCorrectionResult(null);
                          setRegisterConfirmation('');
                        }}
                        className="px-4 h-9 bg-[#C68346] hover:bg-[#b0743e] text-[#FFFFFF] font-bold disabled:opacity-40 text-[11px] transition-colors border-0 cursor-pointer rounded-none"
                      >
                        Confirmar y Actualizar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCorrectionResult(null);
                          setRegisterConfirmation('');
                        }}
                        className="px-4 h-9 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[11px] transition-colors cursor-pointer rounded-none"
                      >
                        Volver
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Estructura ITEMIZADA */}
          {hasItems && !isItemizing && (
            <div className={expandedItems.size > 0 ? "flex-1 flex flex-col min-h-0" : "mb-6"}>
              <ItemizedItemsList
                items={activeItems}
                canCurateAI={canCurateAI}
                catalogId={catalogId}
                onHunt={(itemId, correction, forceRestart, intent) => onHuntItem(pillarMeta.id, itemId, correction, forceRestart, intent)}
                onAiAssist={(itemId, req) => onAiAssistItem(pillarMeta.id, itemId, req)}
                onApplyAssist={(itemId, final, intent) => onApplyAssistItem(pillarMeta.id, itemId, final, intent)}
                isAssistingItemId={assistingItemId}
                huntProgressByItem={huntProgressByItem}
                huntStageByItem={huntStageByItem}
                expandedItems={expandedItems}
                onToggleExpand={onToggleExpand}
                onDiscard={onDiscardItem}
                isSealed={isSealed}
                onUnlockItem={onUnlockItem}
                onUpdateApprovalState={onUpdateApprovalState}
                onRollbackVersion={onRollbackVersion}
                pillarId={pillarMeta.id}
                activeProposalView={activeProposalView}
                onSetProposalView={onSetProposalView}
                onDecideProposal={(itemId, proposalId, decision) => onDecideProposal(pillarMeta.id, itemId, proposalId, decision)}
                onEvolveItemByType={(itemId, filterType) => onEvolveItemByType(pillarMeta.id, itemId, filterType)}
                resolveItemSymbology={resolveItemSymbology}
                onOpenStudio={onOpenStudio}
              />
              {(pillar?.classified_sources_itemized?.length ?? 0) > 0 && expandedItems.size === 0 && (
                <ItemizedSourcesBlock sources={pillar!.classified_sources_itemized!} />
              )}
            </div>
          )}
        </>

        {/* ARCHIVO DE ÍTEMS DESCARTADOS (Exclusivo curación) */}
        {canCurateAI && discardedItems.length > 0 && !isItemizing && expandedItems.size === 0 && (
          <div className="mt-12 pt-8 border-t border-[#E2E8F0] dark:border-[#12151C]">
            <M3Button
              variant="ghost"
              onClick={() => setShowArchive(!showArchive)}
              className="text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]"
            >
              {t('vault_dashboard.discarded_items_archive')} (<span className="font-mono tabular-nums">{discardedItems.length}</span>)
            </M3Button>

            {showArchive && (
              <div className="mt-4">
                <ItemizedItemsList
                  items={discardedItems}
                  canCurateAI={canCurateAI}
                  catalogId={catalogId}
                  onHunt={() => { }}
                  onAiAssist={async () => null}
                  onApplyAssist={async () => { }}
                  isAssistingItemId={null}
                  expandedItems={expandedItems}
                  onToggleExpand={onToggleExpand}
                  onDiscard={onDiscardItem}
                  onReactivate={onReactivateItem}
                  isArchive
                  isSealed={isSealed}
                  onUnlockItem={async () => { }}
                  onUpdateApprovalState={async () => { }}
                  onRollbackVersion={async () => { }}
                  pillarId={pillarMeta.id}
                  activeProposalView={null}
                  onSetProposalView={() => { }}
                  onDecideProposal={async () => { }}
                  onEvolveItemByType={async () => { }}
                  resolveItemSymbology={resolveItemSymbology}
                />
              </div>
            )}
          </div>
        )}

        {/* Empty state — IDLE, GENERATING, ERROR, o proceso ATASCADO */}
        {(!hasItems || isItemizing) && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-6">
            {isItemizing ? (
              <div className="flex flex-col items-center justify-center p-[21px] gap-[13px] rounded-none shadow-none">
                <M3CircularProgress
                  size={28}
                  strokeWidth={3}
                  indeterminate
                  tone="copper"
                  ariaLabel="En proceso"
                />
                {canCurateAI && !itemizing && (
                  <button
                    type="button"
                    disabled={isSealed}
                    onClick={() => onItemize(pillarMeta.id)}
                    className="mt-[8px] bg-transparent border border-[#C68346] text-[#C68346] hover:bg-[#C68346] hover:text-[#FFFFFF] px-[21px] py-[8px] text-[10px] font-bold uppercase tracking-wider font-mono transition-colors rounded-none shadow-none cursor-pointer"
                  >
                    Reintentar Itemización del Pilar
                  </button>
                )}
              </div>
            ) : canCurateAI ? (
              isSequenceBlocked && prerequisitePillar ? (
                <div className="flex flex-col items-center max-w-lg p-[21px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] text-center gap-[13px] rounded-none shadow-none">
                  <span className="material-symbols-outlined !text-[24px] text-[#5A6072]">lock</span>
                  <p className="text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase tracking-widest font-mono">
                    SECUENCIA LÓGICA DE 5 PILARES BLOQUEADA
                  </p>
                  <p className="text-[12px] text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                    Para evitar estructuras vacías y heredar la ontología confirmada del activo, debe itemizar primero el pilar precedente:{' '}
                    <span className="font-bold font-mono text-[#C68346]">
                      [{prerequisitePillar.stepCode} · {prerequisitePillar.label}]
                    </span>.
                  </p>
                  {onNavigateToPillar && (
                    <button
                      type="button"
                      onClick={() => onNavigateToPillar(prerequisitePillar.id)}
                      className="px-[21px] py-[8px] border border-[#C68346] bg-transparent hover:bg-[#C68346] text-[#C68346] hover:text-[#FFFFFF] text-[10px] font-bold uppercase tracking-wider font-mono rounded-none shadow-none transition-colors cursor-pointer"
                    >
                      IR A {prerequisitePillar.stepCode} · {prerequisitePillar.label.toUpperCase()}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {pillar?.itemize_status === 'ERROR' && pillar?.itemize_error && (
                    <div className="flex flex-col items-center max-w-md px-6 text-center">
                      <span className="material-symbols-outlined !text-xl text-[#C68346] mb-1">error</span>
                      <p className="text-[10px] font-bold text-[#C68346] uppercase tracking-widest mb-1">
                        {t('vault_dashboard.labels.itemize_error')}
                      </p>
                      <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] leading-relaxed font-medium">
                        {pillar.itemize_error}
                      </p>
                    </div>
                  )}

                  {isStuck && (
                    <div className="flex flex-col items-center max-w-md px-6 text-center">
                      <span className="material-symbols-outlined !text-xl text-[#C68346] mb-1">warning</span>
                      <p className="text-[10px] font-bold text-[#C68346] uppercase tracking-widest mb-1">
                        Proceso interrumpido
                      </p>
                      <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] leading-relaxed font-medium">
                        El proceso de itemización anterior falló o se interrumpió. Puedes reiniciarlo.
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={isSealed}
                    onClick={() => onItemize(pillarMeta.id)}
                    className="bg-transparent border border-[#C68346] text-[#C68346] hover:bg-[#C68346] hover:text-[#FFFFFF] px-[21px] py-[13px] text-[11px] font-bold uppercase tracking-wider transition-colors rounded-none shadow-none cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                    title={
                      isStuck
                        ? 'Proceso interrumpido — Reiniciar itemización'
                        : pillar?.itemize_status === 'ERROR'
                          ? 'Reintentar itemización'
                          : 'Iniciar itemización del pilar'
                    }
                  >
                    {isStuck ? 'Reiniciar Itemización del Pilar' : 'Itemizar Estructura del Pilar'}
                  </button>
                </>
              )
            ) : (
              <p className="text-[13px] text-[#5A6072]">
                [Información técnica no declarada en ficha]
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export const KnowledgeVaultDashboard: React.FC<VaultDashboardProps> = ({
  assetId,
  onBack,
}) => {
  const { t } = useTranslation();
  const { tenantId, capabilities, actorEmail, isEduSandbox } = useOpermaqContext();
  const effectiveCuratorEmail = actorEmail || auth.currentUser?.email || 'curador@minreport.cl';
  const canCurateAI = capabilities.canCurateAI;
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PillarId>('ficha_tecnica');
  const [masterSymbols, setMasterSymbols] = useState<Record<string, any>>({});
  const [itemizingPillar, setItemizingPillar] = useState<PillarId | null>(null);
  const [huntProgressByItem, setHuntProgressByItem] = useState<Record<string, number>>({});
  const [huntStageByItem, setHuntStageByItem] = useState<Record<string, string>>({});
  const huntListenersRef = useRef<Record<string, () => void>>({});
  const notifiedCompletedTasksRef = useRef<Set<string>>(new Set());
  const [assistingItemId, setAssistingItemId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioTab, setStudioTab] = useState<StudioTabId>(canCurateAI ? 'INGESTION' : 'MANUAL_PUBLISHER');
  const [showSymbologyInfo, setShowSymbologyInfo] = useState<boolean>(false);
  const [showCostMatrixInfo, setShowCostMatrixInfo] = useState<boolean>(false);
  const initializedVaultIdsRef = useRef<Set<string>>(new Set());
  const tenantOverridesRef = useRef<Record<string, any> | undefined>(undefined);
  const openStudio = useCallback((tab: StudioTabId) => {
    if (tab === 'SYMBOLOGY_PACK') {
      setShowCostMatrixInfo(false);
      setShowSymbologyInfo(true);
      return;
    }
    const safeTab: StudioTabId = !canCurateAI && tab === 'INGESTION' ? 'MANUAL_PUBLISHER' : tab;
    setStudioTab(safeTab);
    setStudioOpen(true);
  }, [canCurateAI]);
  const [activeProposalView, setActiveProposalView] = useState<{
    itemId: string;
    pillarId: PillarId;
    view: 'nuevos' | 'conflictos';
  } | null>(null);

  useEffect(() => {
    setActiveProposalView(null);
    setExpandedItems(new Set());
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;
    const loadMasterSymbolsFromCacheApi = async () => {
      try {
        const res = await authFetch(`${API_BASE_URL}/vault/symbology/concepts`);
        if (res.ok && !cancelled) {
          const list = await res.json().catch(() => []);
          if (Array.isArray(list)) {
            const symbolsMap: Record<string, any> = {};
            list.forEach((item: any) => {
              const cid = item?.concept_id || item?.id;
              if (cid) symbolsMap[String(cid)] = item;
            });
            setMasterSymbols(symbolsMap);
            void syncQueueEngine.saveOfflineKnowledge('opermaq_master_symbols_v3', symbolsMap);
            return;
          }
        }
      } catch {
        // Fallback offline soberano en IndexedDB
      }
      if (!cancelled) {
        const cached = await syncQueueEngine
          .getOfflineKnowledge<Record<string, any>>('opermaq_master_symbols_v3')
          .catch(() => null);
        if (cached && typeof cached === 'object') {
          setMasterSymbols(cached);
        }
      }
    };
    void loadMasterSymbolsFromCacheApi();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolveItemSymbology = useCallback((symbologyRefs?: string[]) => {
    if (!symbologyRefs || !Array.isArray(symbologyRefs)) return [];
    const make = (catalog?.make || '').toLowerCase().trim();
    const packEntries = catalog?.symbology_pack?.compiled_entries || [];
    const masterLoaded = Object.keys(masterSymbols || {}).length > 0;

    return symbologyRefs.map(cid => {
      const symData = masterSymbols[cid];
      if (symData && !isTrustedMasterSymbol(symData)) return null;
      if (symData) {
        const brandVariant = symData.brands_variants?.[make];
        if (brandVariant && brandVariant.verified_by_human === true && brandVariant.asset_storage_url) {
          return {
            concept_id: cid,
            url: brandVariant.asset_storage_url,
            technical_name_es: symData.technical_name_es || cid
          };
        } else if (symData.standard_icon_url) {
          return {
            concept_id: cid,
            url: symData.standard_icon_url,
            technical_name_es: symData.technical_name_es || cid
          };
        }
      }
      const fallbackEntry = masterLoaded ? undefined : packEntries.find((e) => e.concept_id === cid);
      if (fallbackEntry?.icon_url) {
        return {
          concept_id: cid,
          url: fallbackEntry.icon_url,
          technical_name_es: fallbackEntry.technical_name_es || cid,
        };
      }
      return null;
    }).filter(Boolean) as Array<{ concept_id: string; url: string; technical_name_es: string }>;
  }, [catalog?.make, catalog?.symbology_pack?.compiled_entries, masterSymbols]);

  const liveHuntedSymbology = useLiveHuntedSymbology({
    knowledgeVault: catalog?.knowledge_vault,
    make: catalog?.make,
    compiledEntries: catalog?.symbology_pack?.compiled_entries,
    masterSymbols,
    pillars: PILLARS,
  });

  const toggleItemExpansion = useCallback((itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
        setActiveProposalView(cur => (cur?.itemId === itemId ? null : cur));
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const ensureVaultInitialized = useCallback(async (globalAssetId: string) => {
    if (!canCurateAI) return;
    try {
      await authFetch(`${API_BASE_URL}/vault/initialize-vault`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId }),
      });
    } catch (e) { console.warn('[Vault] Initialize silently failed:', e); }
  }, [canCurateAI]);

  const applyCatalogSnapshot = useCallback(
    async (
      globalId: string,
      data: Record<string, any> | undefined,
      tenantOverrides?: Record<string, any>
    ) => {
      const effectiveOverrides = tenantOverrides ?? tenantOverridesRef.current;
      if (tenantOverrides) {
        tenantOverridesRef.current = tenantOverrides;
      }
      const rawMake = data?.make_oficial || data?.make || '';
      const rawModel = data?.model_oficial || data?.model || '';
      const displayMake = rawMake === 'GENÉRICO' ? '' : rawMake;
      const makeModel =
        [displayMake, rawModel].filter(Boolean).join(' ') || t('vault_dashboard.labels.equipment_default');

      setCatalog({
        id: globalId,
        makeModel,
        make: rawMake,
        categoria_equipo: data?.categoria_equipo,
        tipo_equipo: data?.tipo_equipo || '',
        ambiente_operativo: effectiveOverrides?.ambiente_operativo || data?.ambiente_operativo || [],
        contexto_operativo: effectiveOverrides?.contexto_operativo || data?.contexto_operativo || [],
        caracteristicas_principales: data?.caracteristicas_principales || [],
        physical_traits: data?.physical_traits || undefined,
        version: effectiveOverrides?.version || data?.version || 'ESTÁNDAR',
        official_url: effectiveOverrides?.official_url || data?.official_url || '',
        foto_url: effectiveOverrides?.foto_url || data?.foto_url || '',
        foto_vlm_audit_version:
          typeof effectiveOverrides?.foto_vlm_audit_version === 'number'
            ? effectiveOverrides.foto_vlm_audit_version
            : typeof data?.foto_vlm_audit_version === 'number'
              ? data.foto_vlm_audit_version
              : null,
        foto_media_telemetry: effectiveOverrides?.foto_media_telemetry || data?.foto_media_telemetry,
        official_photo_candidates: Array.isArray(data?.official_photo_candidates)
          ? data.official_photo_candidates
          : undefined,
        is_sealed: data?.is_sealed,
        energy_consumption_profile: data?.energy_consumption_profile,
        operational_cost_matrix: data?.operational_cost_matrix,
        canonical_specs: data?.canonical_specs,
        knowledge_vault: data?.knowledge_vault,
        symbology_pack: data?.symbology_pack,
      });
      setLoading(false);

      const hasPillars = PILLARS.some((p) => !!(data?.knowledge_vault)?.[p.id]);
      const fichaItems: any[] = Array.isArray(data?.knowledge_vault?.ficha_tecnica?.items)
        ? data.knowledge_vault.ficha_tecnica.items
        : [];
      const pmItems: any[] = Array.isArray(data?.knowledge_vault?.pauta_mantencion?.items)
        ? data.knowledge_vault.pauta_mantencion.items
        : [];
      const needsCostMatrixInit =
        (!data?.operational_cost_matrix || data?.operational_cost_matrix?.version !== '3.0.0') &&
        (fichaItems.length > 0 || pmItems.length > 0 || Boolean(data?.operational_cost_matrix));
      if (
        (!hasPillars || needsCostMatrixInit) &&
        canCurateAI &&
        !data?.is_sealed &&
        !initializedVaultIdsRef.current.has(globalId)
      ) {
        initializedVaultIdsRef.current.add(globalId);
        await ensureVaultInitialized(globalId);
      }
    },
    [canCurateAI, ensureVaultInitialized, t]
  );

  const refreshHydratedVault = useCallback(
    async (
      targetGlobalId?: string,
      fallbackRootData?: Record<string, any>,
      tenantOverrides?: Record<string, any>
    ) => {
      const gid = targetGlobalId || catalog?.id || assetId;
      if (!gid) return;
      try {
        const res = await authFetch(`${API_BASE_URL}/vault/asset/${encodeURIComponent(gid)}`);
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.exists !== false) {
            void syncQueueEngine.saveOfflineKnowledge(`opermaq_vault_v3_${gid}`, data);
            await applyCatalogSnapshot(String(data.id || gid), data, tenantOverrides);
            return;
          }
        }
      } catch {
        // Respaldo offline / caché local IndexedDB
      }
      const cachedOffline = await syncQueueEngine
        .getOfflineKnowledge<Record<string, any>>(`opermaq_vault_v3_${gid}`)
        .catch(() => null);
      if (cachedOffline) {
        await applyCatalogSnapshot(gid, { ...(fallbackRootData || {}), ...cachedOffline }, tenantOverrides);
        return;
      }
      if (fallbackRootData) {
        await applyCatalogSnapshot(gid, fallbackRootData, tenantOverrides);
      } else {
        setLoading(false);
      }
    },
    [applyCatalogSnapshot, assetId, catalog?.id]
  );

  useEffect(() => {
    if (!assetId) return;
    tenantOverridesRef.current = undefined;
    let unsubTenant: (() => void) | null = null;
    let unsubLinkedGlobal: (() => void) | null = null;
    let hydrateTimer: ReturnType<typeof setTimeout> | null = null;
    let isFirstSnapshot = true;

    const scheduleHydration = (
      gid: string,
      rootData?: Record<string, any>,
      tenantData?: Record<string, any>
    ) => {
      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        void refreshHydratedVault(gid, rootData, tenantData);
        return;
      }
      if (hydrateTimer) clearTimeout(hydrateTimer);
      hydrateTimer = setTimeout(() => {
        void refreshHydratedVault(gid, rootData, tenantData);
      }, 220);
    };

    const fleetCollectionName = isEduSandbox ? 'edu_sandbox_fleet' : 'tenant_assets';

    const unsubDirectGlobal = onSnapshot(
      doc(db, 'global_asset_catalog', assetId),
      (globalSnap) => {
        if (globalSnap.exists()) {
          if (unsubTenant) {
            unsubTenant();
            unsubTenant = null;
          }
          if (unsubLinkedGlobal) {
            unsubLinkedGlobal();
            unsubLinkedGlobal = null;
          }
          scheduleHydration(globalSnap.id, globalSnap.data());
          return;
        }

        if (!unsubTenant) {
          unsubTenant = onSnapshot(
            doc(db, fleetCollectionName, assetId),
            (tenantSnap) => {
              if (!tenantSnap.exists()) {
                setLoading(false);
                return;
              }
              const tenantData = tenantSnap.data();
              const docTenant = tenantData?.tenant_id || tenantData?.tenantId || tenantData?.accountId;
              if (!canCurateAI && tenantId && docTenant && docTenant !== tenantId) {
                setLoading(false);
                return;
              }
              const globalId: string | undefined = tenantData?.global_asset_id || tenantData?.globalAssetId;
              if (!globalId) {
                setLoading(false);
                return;
              }
              tenantOverridesRef.current = tenantData;
              if (unsubLinkedGlobal) unsubLinkedGlobal();
              unsubLinkedGlobal = onSnapshot(
                doc(db, 'global_asset_catalog', globalId),
                (linkedSnap) => {
                  if (!linkedSnap.exists()) {
                    void refreshHydratedVault(globalId, undefined, tenantData);
                    return;
                  }
                  scheduleHydration(linkedSnap.id, linkedSnap.data(), tenantData);
                },
                () => {
                  void refreshHydratedVault(globalId, undefined, tenantData);
                }
              );
            },
            () => {
              setLoading(false);
            }
          );
        }
      },
      () => {
        void refreshHydratedVault(assetId);
      }
    );

    return () => {
      if (hydrateTimer) clearTimeout(hydrateTimer);
      unsubDirectGlobal();
      if (unsubTenant) unsubTenant();
      if (unsubLinkedGlobal) unsubLinkedGlobal();
    };
  }, [assetId, canCurateAI, isEduSandbox, refreshHydratedVault, tenantId]);

  const catalogId = catalog?.id;

  const activeHuntKeys = useMemo(() => {
    const keys = new Set<string>(Object.keys(huntProgressByItem));
    const kv = catalog?.knowledge_vault;
    if (kv) {
      for (const pMeta of PILLARS) {
        const items = kv[pMeta.id]?.items || [];
        for (const it of items) {
          if (!it.is_discarded && it.content_status === 'GENERANDO') {
            keys.add(`${pMeta.id}:${it.item_id}`);
          }
        }
      }
    }
    return Array.from(keys);
  }, [catalog?.knowledge_vault, huntProgressByItem]);

  useEffect(() => {
    if (!catalogId) return;
    const activeSet = new Set(activeHuntKeys);

    for (const existingKey of Object.keys(huntListenersRef.current)) {
      if (!activeSet.has(existingKey)) {
        huntListenersRef.current[existingKey]?.();
        delete huntListenersRef.current[existingKey];
      }
    }

    for (const key of activeHuntKeys) {
      if (huntListenersRef.current[key]) continue;
      const [pillarId, itemId] = key.split(':');
      if (!pillarId || !itemId) continue;
      const taskId = `${catalogId}_${pillarId}_${itemId}`;

      huntListenersRef.current[key] = onSnapshot(
        doc(db, 'task_status', taskId),
        (snap) => {
          if (!snap.exists()) return;
          const data = snap.data();
          if (data.status === 'PENDING' || data.status === 'PROCESSING') {
            const pctVal =
              typeof data.progress_percent === 'number'
                ? Math.max(0, Math.min(100, Math.round(data.progress_percent)))
                : Math.max(0, Math.min(100, Number.parseInt(String(data.progress_percent ?? 0), 10) || 0));
            const stageMsg = typeof data.progress_message === 'string' ? data.progress_message.trim() : '';
            setHuntProgressByItem((prev) => (prev[key] === pctVal ? prev : { ...prev, [key]: pctVal }));
            setHuntStageByItem((prev) => (prev[key] === stageMsg ? prev : { ...prev, [key]: stageMsg }));

            const updatedAtMs = Number(data.updatedAtMs || (data.updated_at ? Date.parse(String(data.updated_at)) : 0));
            if (canCurateAI && updatedAtMs > 0 && Date.now() - updatedAtMs > 120_000) {
              void authFetch(`${API_BASE_URL}/vault/hunt-item-async`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  globalAssetId: catalogId,
                  pillarId,
                  itemId,
                  forceRestart: true,
                  ...(data.intent ? { intent: data.intent } : {}),
                }),
              }).catch(() => { });
            }
          } else if (data.status === 'COMPLETED') {
            huntListenersRef.current[key]?.();
            delete huntListenersRef.current[key];
            setHuntProgressByItem((prev) => {
              if (prev[key] === undefined) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            });
            setHuntStageByItem((prev) => {
              if (prev[key] === undefined) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            });

            if (data.result_mode === 'CONFLICT_BUFFER' || data.intent === 'INCREMENTAL_UPDATE') {
              const dedupToken = `${taskId}:${String(data.completed_at || data.updatedAtMs || '')}`;
              if (!notifiedCompletedTasksRef.current.has(dedupToken)) {
                notifiedCompletedTasksRef.current.add(dedupToken);
                const addedNew = Number(data.added_new_count ?? 0);
                const addedConflict = Number(data.added_conflict_count ?? 0);
                const totalAdded = addedNew + addedConflict;
                if (totalAdded > 0) {
                  toast.info(
                    t('vault_dashboard.item_actions.update_completed_with_findings', {
                      newCount: addedNew,
                      conflictCount: addedConflict,
                      defaultValue: `Actualización IA completada: +${addedNew} Nuevo Contenido · +${addedConflict} en Conflicto.`,
                    }),
                    {
                      autoClose: 5000,
                      style: { borderRadius: '0', boxShadow: 'none' },
                    }
                  );
                } else {
                  toast.info(
                    t(
                      'vault_dashboard.item_actions.update_completed_no_changes',
                      'Actualización IA completada: sin diferencias frente al contenido vigente.'
                    ),
                    {
                      autoClose: 4000,
                      style: { borderRadius: '0', boxShadow: 'none' },
                    }
                  );
                }
              }
            }

            void refreshHydratedVault(catalogId);
          } else if (data.status === 'FAILED' || data.status === 'ERROR') {
            const errMsg = data.error || t('vault_dashboard.status.async_research_failed');
            toast.error(`Error: ${errMsg}`, {
              autoClose: 5000,
              style: { borderRadius: '0', boxShadow: 'none' },
            });
            huntListenersRef.current[key]?.();
            delete huntListenersRef.current[key];
            setHuntProgressByItem((prev) => {
              if (prev[key] === undefined) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            });
            setHuntStageByItem((prev) => {
              if (prev[key] === undefined) return prev;
              const next = { ...prev };
              delete next[key];
              return next;
            });
          }
        },
        () => {
          // Silencioso en reconexión
        }
      );
    }
  }, [canCurateAI, catalogId, activeHuntKeys, refreshHydratedVault, t]);

  useEffect(() => {
    return () => {
      for (const unsub of Object.values(huntListenersRef.current)) {
        unsub?.();
      }
      huntListenersRef.current = {};
    };
  }, [catalogId]);

  const handleCatalogPatch = useCallback((patch: SidebarCatalogPatch) => {
    setCatalog((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);



  const handleItemizePillar = useCallback(async (pillarId: PillarId) => {
    if (!canCurateAI || !catalogId || itemizingPillar) return;
    setItemizingPillar(pillarId);
    const toastId = toast.loading('', {
      className: '[&_.Toastify__toast-icon]:!m-0',
      style: {
        borderRadius: '0',
        boxShadow: 'none',
        width: 'auto',
        minWidth: '0',
        minHeight: '0',
        padding: '13px',
      },
    });
    const resetToastStyle = {
      className: '',
      style: { borderRadius: '0', boxShadow: 'none' },
    };
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/itemize-pillar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.dismiss(toastId);
        void refreshHydratedVault(catalogId);
      } else if (
        (res.status === 422 || res.status === 409) &&
        (json.error === 'SECUENCIA_PILAR_BLOQUEADA' ||
          json.code === 'SECUENCIA_PILAR_BLOQUEADA' ||
          json.error === 'PREREQUISITE_PILLAR_NOT_ITEMIZED')
      ) {
        toast.update(toastId, { ...resetToastStyle, render: json.message || 'Debe itemizar el pilar precedente en la secuencia lógica.', type: 'warning', isLoading: false, autoClose: 6000 });
      } else if (res.status === 422 && json.error === 'PERFIL_INCOMPLETO') {
        toast.update(toastId, { ...resetToastStyle, render: `${t('vault_dashboard.status.incomplete_profile', 'Perfil incompleto')}: ${(json.missingFields ?? []).join(', ')}`, type: 'warning', isLoading: false, autoClose: 6000 });
      } else if (res.status === 429) {
        toast.update(toastId, { ...resetToastStyle, render: t('vault_dashboard.status.ia_limit_reached', 'Límite de cuota IA alcanzado. Reintente en unos segundos.'), type: 'error', isLoading: false, autoClose: 7000 });
      } else {
        toast.update(toastId, { ...resetToastStyle, render: `${t('vault_dashboard.labels.itemize_error', 'Error de itemización')}: ${json.error ?? t('vault_dashboard.status.unknown_failure', 'Fallo desconocido')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_err: unknown) {
      toast.update(toastId, { ...resetToastStyle, render: t('vault_dashboard.status.network_error_itemize', 'Error de red durante la itemización'), type: 'error', isLoading: false, autoClose: 5000 });
    } finally {
      setItemizingPillar(null);
    }
  }, [canCurateAI, catalogId, itemizingPillar, t]);

  const handleHuntItem = useCallback(async (
    pillarId: PillarId,
    itemId: string,
    correction?: string,
    forceRestart?: boolean,
    intent?: HuntIntent
  ) => {
    const huntKey = `${pillarId}:${itemId}`;
    if (!canCurateAI || !catalogId || (huntProgressByItem[huntKey] !== undefined && !forceRestart)) return;
    setHuntProgressByItem((prev) => ({ ...prev, [huntKey]: 0 }));
    setHuntStageByItem((prev) => ({
      ...prev,
      [huntKey]:
        intent === 'INCREMENTAL_UPDATE'
          ? t('vault_dashboard.item_actions.stage_enqueuing_update', 'Encolando búsqueda de actualización técnica...')
          : t('vault_dashboard.pending_in_queue', 'Pendiente en cola…'),
    }));

    try {
      const res = await authFetch(`${API_BASE_URL}/vault/hunt-item-async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalAssetId: catalogId,
          pillarId,
          itemId,
          humanCorrection: correction,
          forceRestart: Boolean(forceRestart),
          ...(intent ? { intent } : {}),
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || t('vault_dashboard.status.could_not_enqueue_task'));
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(`Error: ${errorMessage}`, {
        autoClose: 5000,
        style: { borderRadius: '0', boxShadow: 'none' },
      });
      huntListenersRef.current[huntKey]?.();
      delete huntListenersRef.current[huntKey];
      setHuntProgressByItem((prev) => {
        const next = { ...prev };
        delete next[huntKey];
        return next;
      });
      setHuntStageByItem((prev) => {
        const next = { ...prev };
        delete next[huntKey];
        return next;
      });
    }
  }, [canCurateAI, catalogId, huntProgressByItem, t]);

  const handleAiAssistItem = useCallback(async (pillarId: PillarId, itemId: string, userRequest: string): Promise<AiAssistResponse | null> => {
    if (!canCurateAI || !catalogId || assistingItemId) return null;
    setAssistingItemId(itemId);
    const toastId = toast.loading(t('vault_dashboard.status.ia_assistant_analyzing').concat('…'));
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/ai-assist-item`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, userRequest }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.update(toastId, { render: t('vault_dashboard.status.proposal_generated'), type: 'success', isLoading: false, autoClose: 2000 });
        return json as AiAssistResponse;
      } else {
        toast.update(toastId, { render: `Error: ${json.error || t('vault_dashboard.status.assistant_failed')}`, type: 'error', isLoading: false, autoClose: 5000 });
        return null;
      }
    } catch (_err) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error'), type: 'error', isLoading: false, autoClose: 5000 });
      return null;
    } finally { setAssistingItemId(null); }
  }, [canCurateAI, catalogId, assistingItemId, t]);

  const handleApplyAssistProposal = useCallback(async (pillarId: PillarId, itemId: string, finalContent: string, intent: string) => {
    if (!canCurateAI || !catalogId) return;
    const toastId = toast.loading(t('vault_dashboard.status.applying_changes').concat('…'));
    try {
      const userEmail = effectiveCuratorEmail;
      const res = await authFetch(`${API_BASE_URL}/vault/apply-assist-proposal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, finalContent, userEmail, intent }),
      });
      if (res.ok) {
        toast.update(toastId, { render: t('vault_dashboard.status.changes_persisted_success'), type: 'success', isLoading: false, autoClose: 3000 });
        void refreshHydratedVault(catalogId);
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || t('vault_dashboard.status.could_not_apply')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_err) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, effectiveCuratorEmail, refreshHydratedVault, t]);

  const handleCreateManualItem = useCallback(async (pillarId: PillarId, title: string, section: string, rationale?: string, itemSource?: Record<string, unknown>) => {
    if (!canCurateAI || !catalogId) return;

    const pillar = catalog?.knowledge_vault?.[pillarId];
    const existingTitles = (pillar?.items ?? []).map(it => it.title.toLowerCase().trim());
    if (existingTitles.includes(title.toLowerCase().trim())) {
      toast.error(t('vault_dashboard.status.item_already_exists', { title }));
      return;
    }

    const toastId = toast.loading(t('vault_dashboard.status.creating_item').concat('…'));
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/create-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, title, section, rationale, itemSource, confirmWord: 'ACTUALIZAR' }),
      });
      if (res.ok) {
        toast.update(toastId, { render: t('vault_dashboard.status.item_created_success'), type: 'success', isLoading: false, autoClose: 3000 });
        void refreshHydratedVault(catalogId);
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || t('vault_dashboard.status.failed_to_create')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_err) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, catalog?.knowledge_vault, refreshHydratedVault, t]);

  const handleDiscardItem = useCallback(async (itemId: string) => {
    if (!canCurateAI || !catalogId) return;

    setExpandedItems(prev => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });

    const userEmail = effectiveCuratorEmail;
    const toastId = toast.loading(t('vault_dashboard.status.discarding_item').concat('…'));
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/discard-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId: activeTab, itemId, userEmail, confirmWord: 'ACTUALIZAR' }),
      });
      if (res.ok) {
        toast.update(toastId, { render: t('vault_dashboard.status.item_discarded_success'), type: 'success', isLoading: false, autoClose: 3000 });
        void refreshHydratedVault(catalogId);
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error ?? t('vault_dashboard.status.unknown_failure')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error_discard_item'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, activeTab, effectiveCuratorEmail, refreshHydratedVault, t, setExpandedItems]);

  const handleReactivateItem = useCallback(async (itemId: string) => {
    if (!canCurateAI || !catalogId) return;

    const toastId = toast.loading(t('vault_dashboard.status.reactivating_item').concat('…'));
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/reactivate-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId: activeTab, itemId, confirmWord: 'ACTUALIZAR' }),
      });
      if (res.ok) {
        toast.update(toastId, { render: t('vault_dashboard.status.item_reactivated_success'), type: 'success', isLoading: false, autoClose: 3000 });
        void refreshHydratedVault(catalogId);
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error ?? t('vault_dashboard.status.unknown_failure')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error_reactivate_item'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, activeTab, refreshHydratedVault, t]);

  const handleDecideProposal = useCallback(async (
    pillarId: PillarId,
    itemId: string,
    proposalId: string,
    decision: 'APROBADO' | 'ELIMINADO'
  ) => {
    if (!canCurateAI || !catalogId) return;
    const toastId = toast.loading(
      decision === 'APROBADO'
        ? 'Aprobando e integrando propuesta al contenido del ítem…'
        : 'Eliminando propuesta…'
    );
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/decide-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, proposalId, decision }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        setCatalog((prev) => {
          if (!prev?.knowledge_vault?.[pillarId]) return prev;
          const currentPillar = prev.knowledge_vault[pillarId];
          const nextItems = (currentPillar.items || []).map((it) => {
            if (it.item_id !== itemId) return it;
            const currentPending = it.pending_conflicts || [];
            const matchedIdx = currentPending.findIndex(
              (p, i) =>
                p.proposal_id === proposalId ||
                getEffectiveProposalId(p, i) === proposalId ||
                getEffectiveProposalId(p) === proposalId
            );
            const targetFusion =
              matchedIdx !== -1
                ? currentPending[matchedIdx].estado_fusion
                : activeProposalView?.view === 'conflictos'
                  ? 'CONFLICTO'
                  : 'NUEVO';

            const filteredPending =
              decision === 'ELIMINADO'
                ? currentPending.filter(
                  (p, i) => i !== matchedIdx && p.human_decision !== 'ELIMINADO'
                )
                : currentPending.filter(
                  (p, i) =>
                    i !== matchedIdx &&
                    p.human_decision !== 'ELIMINADO' &&
                    !(p.estado_fusion === targetFusion && p.human_decision === 'APROBADO')
                );

            return {
              ...it,
              content: typeof json.evolvedContent === 'string' ? json.evolvedContent : it.content,
              pending_conflicts: filteredPending,
            };
          });
          return {
            ...prev,
            knowledge_vault: {
              ...prev.knowledge_vault,
              [pillarId]: {
                ...currentPillar,
                items: nextItems,
              },
            },
          };
        });

        if (typeof json.remainingCount === 'number' && json.remainingCount === 0) {
          setActiveProposalView(null);
        }

        toast.update(toastId, {
          render:
            decision === 'APROBADO'
              ? 'Propuesta aprobada e integrada en el contenido del ítem.'
              : 'Propuesta eliminada.',
          type: 'success',
          isLoading: false,
          autoClose: 3000,
        });
        void refreshHydratedVault(catalogId);
      } else {
        toast.update(toastId, {
          render: `Error: ${json.error || 'No se pudo registrar la decisión.'}`,
          type: 'error',
          isLoading: false,
          autoClose: 5000,
        });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al registrar decisión.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, activeProposalView, refreshHydratedVault]);

  const handleEvolveItemByType = useCallback(async (
    pillarId: PillarId,
    itemId: string,
    filterType: 'NUEVO' | 'CONFLICTO'
  ) => {
    if (!canCurateAI || !catalogId) return;
    const toastId = toast.loading(`Integrando propuestas aprobadas (${filterType}) en el contenido…`);
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/evolve-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, filterType }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        setCatalog((prev) => {
          if (!prev?.knowledge_vault?.[pillarId]) return prev;
          const currentPillar = prev.knowledge_vault[pillarId];
          const nextItems = (currentPillar.items || []).map((it) => {
            if (it.item_id !== itemId) return it;
            const currentPending = it.pending_conflicts || [];
            const filteredPending = currentPending.filter(
              (p) =>
                p.human_decision !== 'ELIMINADO' &&
                !(p.estado_fusion === filterType && p.human_decision === 'APROBADO')
            );
            return {
              ...it,
              content: typeof json.evolvedContent === 'string' ? json.evolvedContent : it.content,
              pending_conflicts: filteredPending,
            };
          });
          return {
            ...prev,
            knowledge_vault: {
              ...prev.knowledge_vault,
              [pillarId]: {
                ...currentPillar,
                items: nextItems,
              },
            },
          };
        });
        setActiveProposalView(null);
        toast.update(toastId, { render: 'Ítem actualizado con los hallazgos aprobados.', type: 'success', isLoading: false, autoClose: 3000 });
        void refreshHydratedVault(catalogId);
      } else {
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo evolucionar la redacción.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al evolucionar ítem.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, refreshHydratedVault]);

  const handleUnlockItem = useCallback(async (pillarId: PillarId, itemId: string) => {
    if (!canCurateAI || !catalogId) return;
    const toastId = toast.loading('Desbloqueando ítem…');
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/unlock-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId }),
      });
      if (res.ok) {
        toast.update(toastId, { render: 'Ítem desbloqueado.', type: 'success', isLoading: false, autoClose: 3000 });
        void refreshHydratedVault(catalogId);
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo desbloquear el ítem.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al desbloquear.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, refreshHydratedVault]);

  const handleUpdateItemApprovalState = useCallback(async (pillarId: PillarId, itemId: string, nuevo_estado: EstadoAprobacion, review_notes?: string) => {
    if (!canCurateAI || !catalogId) return;
    const toastId = toast.loading('Actualizando estado de aprobación…');
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/update-item-approval-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, nuevo_estado, review_notes }),
      });
      if (res.ok) {
        toast.update(toastId, { render: 'Estado de aprobación actualizado.', type: 'success', isLoading: false, autoClose: 3000 });
        void refreshHydratedVault(catalogId);
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo actualizar el estado de aprobación.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al actualizar estado de aprobación.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, refreshHydratedVault]);

  const handleRollbackItemVersion = useCallback(async (pillarId: PillarId, itemId: string, timestamp: string) => {
    if (!canCurateAI || !catalogId) return;
    const toastId = toast.loading('Restaurando versión histórica del ítem…');
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/rollback-item-version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, timestamp }),
      });
      if (res.ok) {
        toast.update(toastId, { render: 'Versión restaurada.', type: 'success', isLoading: false, autoClose: 3000 });
        void refreshHydratedVault(catalogId);
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo restaurar la versión.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al restaurar versión.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, refreshHydratedVault]);

  const activePillarMeta = PILLARS.find(p => p.id === activeTab)!;

  if (loading) return (
    <div className="h-full w-full bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center">
      <M3CircularProgress size={40} strokeWidth={4} indeterminate tone="copper" ariaLabel="Cargando bóveda técnica" />
    </div>
  );
  if (!catalog) return (
    <div className="h-full w-full bg-[#FFFFFF] dark:bg-[#000000] flex flex-col items-center justify-center gap-[21px]">
      <span className="material-symbols-outlined !text-5xl text-[#94A3B8] dark:text-[#5A6072]">error</span>
      <p className="text-[13px] text-[#475569] dark:text-[#8A93A6]">{t('vault_dashboard.labels.could_not_load_asset')}</p>
      <M3IconButton icon="arrow_back" onClick={onBack} variant="secondary" />
    </div>
  );

  return (
    <main className="h-full w-full bg-[#FFFFFF] dark:bg-[#000000] flex flex-col font-atkinson overflow-hidden select-none">

      {/* ── TOP BAR: Breadcrumb + Título + Acciones ─────────────────────────── */}
      <div className="no-print shrink-0 flex items-center justify-between gap-[13px] px-[21px] py-[8px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] z-50">
        <div className="flex items-center gap-[8px] min-w-0">
          <M3IconButton
            icon="arrow_back"
            onClick={onBack}
            variant="ghost"
            className="!w-7 !h-7 !min-w-0 shrink-0 text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346]"
          />
          <div className="flex items-baseline gap-[8px] leading-none flex-wrap min-w-0">
            <span className="text-[14px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">{catalog.makeModel}</span>
            {catalog.tipo_equipo && (
              <span className="text-[12px] text-[#475569] dark:text-[#8A93A6] uppercase tracking-wider">/ {catalog.tipo_equipo}</span>
            )}
            <span className="text-[12px] text-[#475569] dark:text-[#8A93A6] uppercase tracking-wider">
              / {catalog.categoria_equipo || 'MAQUINARIA'}
            </span>
          </div>
          {catalog.is_sealed && (
            <div className="shrink-0 px-[8px] py-0.5 bg-[#0F172A] dark:bg-[#F3F4F6] text-[#FFFFFF] dark:text-[#000000] flex items-center gap-1 ml-1">
              <span className="material-symbols-outlined !text-[9px]">lock</span>
              <span className="text-[7px] font-bold uppercase tracking-[0.2em]">{t('vault_dashboard.labels.sealed')}</span>
            </div>
          )}
        </div>

        {/* Acciones de Estudio de Ingeniería (Iconos planos: upload_file para Ingesta PDF/ETT · draw para Manuales Ilustrados) */}
        <div className="flex items-center gap-[8px] shrink-0">
          {canCurateAI && (
            <button
              type="button"
              onClick={() => openStudio('INGESTION')}
              title="Ingesta PDF / ETT"
              aria-label="Ingesta PDF / ETT"
              className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none"
            >
              <span className="material-symbols-outlined text-[20px]">upload_file</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => openStudio('MANUAL_PUBLISHER')}
            title="Manuales Ilustrados"
            aria-label="Manuales Ilustrados"
            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none"
          >
            <span className="material-symbols-outlined text-[20px]">draw</span>
          </button>
        </div>
      </div>

      {/* ── BODY: Columna catálogo + Área de pilares ────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        <VaultCatalogSidebar
          catalog={catalog}
          assetId={assetId}
          canCurateAI={canCurateAI}
          highlightUndeclared={highlightUndeclaredInNode}
          onCatalogPatch={handleCatalogPatch}
          onRefreshVault={() => refreshHydratedVault(catalog.id)}
        />

        {/* ── ÁREA DERECHA: Pilares + Items ─────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

          {/* Barra Minimalista de 5 Pilares + Iconos Automáticos de Solo Lectura (Matriz de Costos + Simbología) */}
          <nav className="shrink-0 flex items-stretch border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] overflow-x-auto hide-scrollbar">
            {PILLARS.map((p) => {
              const pillar = catalog.knowledge_vault?.[p.id];
              const isActive = !showSymbologyInfo && !showCostMatrixInfo && activeTab === p.id;
              const activeItems = (pillar?.items ?? []).filter((it) => !it.is_discarded);
              const hasActiveItems = activeItems.length > 0;
              const isItemized = pillar?.itemize_status === 'COMPLETED' || hasActiveItems;
              const isFullyCaptured =
                isItemized &&
                hasActiveItems &&
                activeItems.every(
                  (it) => it.content_status === 'COMPLETADO' && Boolean(it.content && it.content.trim())
                );

              const prereqId = PILLAR_PREREQUISITE_MAP[p.id];
              const prereqPillar = prereqId ? catalog.knowledge_vault?.[prereqId] : null;
              const isPrereqCompleted = !prereqId || prereqPillar?.itemize_status === 'COMPLETED';
              const isLockedInSequence = !isPrereqCompleted && !isItemized;

              const statusColorClass = isFullyCaptured
                ? 'text-[#00AEEF]'
                : isItemized
                  ? 'text-[#C68346]'
                  : isActive
                    ? 'text-[#0F172A] dark:text-[#F3F4F6]'
                    : 'text-[#94A3B8] dark:text-[#5A6072]';

              const activeBorderClass = isFullyCaptured
                ? '!border-[#00AEEF]'
                : '!border-[#C68346]';

              return (
                <M3Button
                  key={p.id}
                  onClick={() => {
                    setShowSymbologyInfo(false);
                    setShowCostMatrixInfo(false);
                    setExpandedItems(new Set());
                    setActiveProposalView(null);
                    setActiveTab(p.id);
                  }}
                  variant="ghost"
                  className={`relative flex-1 min-w-0 flex items-center justify-center !px-2 !py-4 !h-auto transition-all border-b-2 !rounded-none ${isActive
                    ? `${activeBorderClass} bg-[#F8FAFC] dark:bg-[#07090D]`
                    : '!border-transparent hover:bg-[#F8FAFC]/50 dark:hover:bg-[#07090D]/50'
                    }`}
                  title={
                    isFullyCaptured
                      ? `${t(`vault_dashboard.pillars.${p.id}`, p.label)} — Contenidos 100% capturados`
                      : isItemized
                        ? `${t(`vault_dashboard.pillars.${p.id}`, p.label)} — Itemizado`
                        : isLockedInSequence && prereqId
                          ? `${t(`vault_dashboard.pillars.${p.id}`, p.label)} — Pendiente del pilar anterior`
                          : t(`vault_dashboard.pillars.${p.id}`, p.label)
                  }
                >
                  <span className={`material-symbols-outlined !text-[20px] transition-colors ${statusColorClass}`}>
                    {p.icon}
                  </span>
                </M3Button>
              );
            })}

            {/* Icono INFO — Compilado Real de Simbología (Solo Lectura, derivado de caza de contenidos) */}
            {(() => {
              const allHunted =
                liveHuntedSymbology.totalActiveItemsCount > 0 &&
                liveHuntedSymbology.huntedItemsCount === liveHuntedSymbology.totalActiveItemsCount;
              const someHunted = liveHuntedSymbology.huntedItemsCount > 0;
              const infoColorClass = allHunted
                ? 'text-[#00AEEF]'
                : someHunted
                  ? 'text-[#C68346]'
                  : showSymbologyInfo
                    ? 'text-[#0F172A] dark:text-[#F3F4F6]'
                    : 'text-[#94A3B8] dark:text-[#5A6072]';
              const infoBorderClass = allHunted
                ? '!border-b-[#00AEEF]'
                : '!border-b-[#C68346]';

              return (
                <M3Button
                  onClick={() => {
                    setExpandedItems(new Set());
                    setActiveProposalView(null);
                    setShowCostMatrixInfo(false);
                    setShowSymbologyInfo(true);
                  }}
                  variant="ghost"
                  className={`relative flex-1 min-w-0 flex items-center justify-center !px-2 !py-4 !h-auto transition-all border-b-2 border-l border-l-[#E2E8F0] dark:border-l-[#12151C] !rounded-none ${showSymbologyInfo
                    ? `${infoBorderClass} bg-[#F8FAFC] dark:bg-[#07090D]`
                    : '!border-b-transparent hover:bg-[#F8FAFC]/50 dark:hover:bg-[#07090D]/50'
                    }`}
                  title="Simbología técnica aplicada al equipo (compilada de contenidos cazados)"
                >
                  <span className={`material-symbols-outlined !text-[20px] transition-colors ${infoColorClass}`}>
                    info
                  </span>
                </M3Button>
              );
            })()}

            {/* Icono PACKAGE_2 al final de la fila — Matriz Automática de Consumos, Insumos y Base de Costos (Solo Lectura) */}
            {(() => {
              const costStatus = catalog.operational_cost_matrix?.completeness_status;
              const hasHuntedFicha = (catalog.knowledge_vault?.ficha_tecnica?.items || []).some(
                (it) => !it?.is_discarded && it?.content_status === 'COMPLETADO' && Boolean(it?.content?.trim())
              );
              const hasHuntedMantencion = (catalog.knowledge_vault?.pauta_mantencion?.items || []).some(
                (it) => !it?.is_discarded && it?.content_status === 'COMPLETADO' && Boolean(it?.content?.trim())
              );
              const hasHuntedCostPillars = hasHuntedFicha || hasHuntedMantencion;
              const isCostComplete = hasHuntedFicha && hasHuntedMantencion && costStatus === 'COMPLETE';
              const isCostPartial = hasHuntedCostPillars && !isCostComplete;

              const costColorClass = isCostComplete
                ? 'text-[#00AEEF]'
                : isCostPartial
                  ? 'text-[#C68346]'
                  : showCostMatrixInfo
                    ? 'text-[#0F172A] dark:text-[#F3F4F6]'
                    : 'text-[#94A3B8] dark:text-[#5A6072]';
              const costBorderClass = isCostComplete
                ? '!border-b-[#00AEEF]'
                : '!border-b-[#C68346]';

              return (
                <M3Button
                  onClick={() => {
                    setExpandedItems(new Set());
                    setActiveProposalView(null);
                    setShowSymbologyInfo(false);
                    setShowCostMatrixInfo(true);
                  }}
                  variant="ghost"
                  className={`relative flex-1 min-w-0 flex items-center justify-center !px-2 !py-4 !h-auto transition-all border-b-2 border-l border-l-[#E2E8F0] dark:border-l-[#12151C] !rounded-none ${showCostMatrixInfo
                    ? `${costBorderClass} bg-[#F8FAFC] dark:bg-[#07090D]`
                    : '!border-b-transparent hover:bg-[#F8FAFC]/50 dark:hover:bg-[#07090D]/50'
                    }`}
                  title="Matriz automática de consumos, insumos y base de costos (compilada de Ficha Técnica y Pauta de Mantención)"
                >
                  <span className={`material-symbols-outlined !text-[20px] transition-colors ${costColorClass}`}>
                    package_2
                  </span>
                </M3Button>
              );
            })()}
          </nav>

          {/* Tab Content: Sección MATRIZ DE COSTOS, Sección INFO (Simbología Solo Lectura) o Listado de ítems del Pilar */}
          <section className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {showCostMatrixInfo ? (
              <EquipmentCostMatrixPanel
                makeModel={catalog.makeModel}
                tipoEquipo={catalog.tipo_equipo}
                categoriaEquipo={catalog.categoria_equipo}
                physicalTraits={catalog.physical_traits}
                operationalCostMatrix={catalog.operational_cost_matrix}
                energyConsumptionProfile={catalog.energy_consumption_profile}
                canonicalSpecs={catalog.canonical_specs}
                knowledgeVault={catalog.knowledge_vault || {}}
              />
            ) : showSymbologyInfo ? (
              <VaultSymbologyReadOnlyPanel liveHuntedSymbology={liveHuntedSymbology} />
            ) : (() => {
              const prereqId = PILLAR_PREREQUISITE_MAP[activeTab];
              const prereqMeta = prereqId ? PILLARS.find(x => x.id === prereqId) : null;
              const prereqDoc = prereqId ? catalog.knowledge_vault?.[prereqId] : null;
              const activeTabIdx = PILLARS.findIndex(x => x.id === activeTab);
              let hasAncestorChainEvolved = false;
              for (let i = 1; i <= activeTabIdx; i++) {
                const curPid = PILLARS[i].id;
                const prevPid = PILLARS[i - 1].id;
                const curDoc = catalog.knowledge_vault?.[curPid];
                const prevDoc = catalog.knowledge_vault?.[prevPid];
                if (
                  curDoc?.parent_pillar_digest_sha256 &&
                  prevDoc?.structure_digest_sha256 &&
                  curDoc.parent_pillar_digest_sha256 !== prevDoc.structure_digest_sha256
                ) {
                  hasAncestorChainEvolved = true;
                  break;
                }
              }
              const prerequisitePillar = prereqId && prereqMeta
                ? {
                  id: prereqId,
                  stepCode: prereqMeta.stepCode,
                  label: prereqMeta.label,
                  isItemized:
                    prereqDoc?.itemize_status === 'COMPLETED' ||
                    (prereqDoc?.items ?? []).some((it: any) => !it?.is_discarded),
                  currentDigest: prereqDoc?.structure_digest_sha256 ?? null,
                  hasAncestorChainEvolved,
                }
                : null;

              return (
                <PillarTabContent
                  key={activeTab}
                  pillarMeta={activePillarMeta}
                  pillar={catalog.knowledge_vault?.[activeTab]}
                  catalogId={catalog.id}
                  canCurateAI={canCurateAI}
                  onItemize={handleItemizePillar}
                  onHuntItem={handleHuntItem}
                  onAiAssistItem={handleAiAssistItem}
                  onApplyAssistItem={handleApplyAssistProposal}
                  onCreateItem={handleCreateManualItem}
                  itemizing={itemizingPillar === activeTab}
                  huntProgressByItem={huntProgressByItem}
                  huntStageByItem={huntStageByItem}
                  assistingItemId={assistingItemId}
                  expandedItems={expandedItems}
                  onToggleExpand={toggleItemExpansion}
                  onDiscardItem={handleDiscardItem}
                  onReactivateItem={handleReactivateItem}
                  isSealed={catalog.is_sealed || false}
                  onUnlockItem={(itemId) => handleUnlockItem(activeTab, itemId)}
                  onUpdateApprovalState={(itemId, state, notes) => handleUpdateItemApprovalState(activeTab, itemId, state, notes)}
                  onRollbackVersion={(itemId, timestamp) => handleRollbackItemVersion(activeTab, itemId, timestamp)}
                  activeProposalView={activeProposalView}
                  onSetProposalView={setActiveProposalView}
                  onDecideProposal={handleDecideProposal}
                  onEvolveItemByType={handleEvolveItemByType}
                  resolveItemSymbology={resolveItemSymbology}
                  onOpenStudio={openStudio}
                  prerequisitePillar={prerequisitePillar}
                  onNavigateToPillar={(id) => {
                    setExpandedItems(new Set());
                    setActiveProposalView(null);
                    setShowSymbologyInfo(false);
                    setShowCostMatrixInfo(false);
                    setActiveTab(id);
                  }}
                />
              );
            })()}
          </section>
        </div>
      </div>

      <OpermaqEngineeringStudioDrawer
        isOpen={studioOpen}
        initialTab={studioTab}
        catalogId={catalog.id}
        tenantAssetId={assetId !== catalog.id ? assetId : undefined}
        makeModel={catalog.makeModel}
        isSealed={catalog.is_sealed}
        onClose={() => setStudioOpen(false)}
      />
    </main>
  );
}


export default KnowledgeVaultDashboard;

