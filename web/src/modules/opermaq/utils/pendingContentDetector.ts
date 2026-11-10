import type { ExtractedFigureRef, ItemizedSource, PillarId } from '../types/vault';
import { countItemPendingFigures, parsePendingMarker } from './pendingFigureMarkers';

/**
 * DETECTOR CANÓNICO DE INFORMACIÓN NO DECLARADA Y CONTENIDO PENDIENTE (OPERMAQ)
 *
 * Identifica determinísticamente todos los campos y fragmentos que indican:
 * - `[Información técnica no declarada en ficha]`
 * - `[Nivel acústico / vibratorio del equipo no declarado en fuente OEM]`
 * - `[No declarado en ficha]` / `[No declarado]` / `NO DECLARADO EN FUENTE`
 * - `[Pendiente de registro]` / `[Información declarada...]`
 * Y consolida el conteo reactivo de `CONTENIDO PENDIENTE` por ítem (`campos de texto + imágenes pendientes`).
 */

export const UNDECLARED_CONTENT_SOURCE =
  '(?:\\[\\s*[^\\]\\n]*?\\b(?:no\\s+declarad[oa]s?|pendiente\\s+de\\s+registro|sin\\s+informaci[oó]n\\s+declarada|informaci[oó]n\\s+(?:t[eé]cnica\\s+)?declarada)\\b[^\\]\\n]*\\]|\\b(?:informaci[oó]n\\s+(?:t[eé]cnica\\s+)?no\\s+declarada(?:\\s+en\\s+ficha)?|nivel\\s+ac[uú]stico\\s*\\/\\s*vibratorio\\s+del\\s+equipo\\s+no\\s+declarado(?:\\s+en\\s+fuente\\s+oem)?|no\\s+declarado\\s+en\\s+(?:ficha|fuente(?:\\s+consultada|\\s+oem)?)|pendiente\\s+de\\s+registro)\\b)';

export function createUndeclaredContentRegex(): RegExp {
  return new RegExp(UNDECLARED_CONTENT_SOURCE, 'gi');
}

export function isUndeclaredContentText(text: string | null | undefined): boolean {
  if (!text) return false;
  return new RegExp(UNDECLARED_CONTENT_SOURCE, 'i').test(String(text));
}

/**
 * Clases visuales estándar MINREPORT (Acento Cobre Oficial #C68346, Geometría 0px, Alto Contraste Light/Dark).
 */
export const PENDING_CONTENT_HIGHLIGHT_CLASS =
  'bg-[#C68346]/15 dark:bg-[#C68346]/20 text-[#C68346] border border-[#C68346] px-[6px] py-[2px] font-mono text-[11px] font-bold rounded-none shadow-none inline-block align-baseline';

/**
 * Cuenta cuántas ocurrencias de texto no declarado / pendiente existen en un bloque Markdown,
 * ignorando líneas de marcadores `![IMAGEN_PENDIENTE: ...]` (que se contabilizan como figuras pendientes).
 */
export function countUndeclaredTextInMarkdown(markdown: string | null | undefined): number {
  if (!markdown) return 0;
  const lines = String(markdown).split('\n');
  let count = 0;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (parsePendingMarker(trimmed)) continue;
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) continue;
    const matches = trimmed.match(createUndeclaredContentRegex());
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

export interface ItemPendingContentSummary {
  undeclaredFieldsCount: number;
  pendingFiguresCount: number;
  total: number;
}

export function computeItemPendingContentSummary(params: {
  renderedMarkdown: string | null | undefined;
  rawContent: string | null | undefined;
  itemTitle: string;
  itemSources?: ItemizedSource[];
  galleryFigures?: ExtractedFigureRef[];
  pillarId?: PillarId;
}): ItemPendingContentSummary {
  const undeclaredFieldsCount = countUndeclaredTextInMarkdown(
    params.renderedMarkdown ?? params.rawContent ?? ''
  );
  const pendingFiguresCount = countItemPendingFigures(
    params.rawContent,
    params.itemTitle,
    params.itemSources,
    params.galleryFigures
  );
  return {
    undeclaredFieldsCount,
    pendingFiguresCount,
    total: undeclaredFieldsCount + pendingFiguresCount,
  };
}

