/**
 * KnowledgeVaultDashboard — v9.0 ITEMIZADO + CAZA POR ÍTEM
 * Flujo: 1º ITEMIZADO por pilar → 2º CAZA on-demand por ítem.
 * Sin generación monolítica de pilares.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { doc, onSnapshot, updateDoc, collection } from 'firebase/firestore';
import { db, auth, API_BASE_URL, storage } from '../firebase/config';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { authFetch } from '../utils/authFetch';
import { toast } from 'react-toastify';
import { M3IconButton } from './M3IconButton';
import { M3Button } from './M3Button';
import { PremiumAIPanel } from './PremiumAIPanel';
import { useTranslation } from 'react-i18next';
import type { PillarId, PillarDocument, PillarItem, ItemizedSource, ProposedUpdate, EstadoAprobacion, HistorialAuditoria, ChatMessage } from '../backend/types/schema';

// ─── Types ───────────────────────────────────────────────────────────────────
interface VaultDashboardProps { assetId: string; onBack: () => void; }
interface CatalogSnapshot {
  id: string; makeModel: string; make?: string; categoria_equipo?: string;
  tipo_equipo?: string;
  is_sealed?: boolean;
  official_url?: string;
  foto_url?: string;
  ambiente_operativo?: string[];
  contexto_operativo?: string[];
  caracteristicas_principales?: string[];
  version?: string;
  knowledge_vault?: Partial<Record<PillarId, PillarDocument>>;
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
const PILLARS: Array<{ id: PillarId; icon: string; romanNumeral: string; label: string; color: string; accent: string }> = [
  { id: 'ficha_tecnica',      icon: 'fact_check',  romanNumeral: '0',   label: 'Ficha Técnica',             color: 'text-violet-500', accent: '#8b5cf6' },
  { id: 'manual_operaciones', icon: 'settings',    romanNumeral: 'I',   label: 'Manual de Operaciones',     color: 'text-blue-500',   accent: '#3b82f6' },
  { id: 'pauta_mantencion',   icon: 'build',       romanNumeral: 'II',  label: 'Pauta de Mantención',       color: 'text-emerald-500',accent: '#10b981' },
  { id: 'matriz_riesgos',     icon: 'security',    romanNumeral: 'III', label: 'Matriz de Riesgos',         color: 'text-amber-500',  accent: '#f59e0b' },
  { id: 'checklist_pre_op',   icon: 'rule',        romanNumeral: 'IV',  label: 'Checklist Pre-Op',          color: 'text-rose-500',   accent: '#f43f5e' },
];

function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 800;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas to blob failed'));
            }
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

const SOURCE_ICONS: Record<string, string> = { OEM: 'precision_manufacturing', EXTERNO: 'school', YOUTUBE: 'smart_display', MANUAL: 'person' };
const SOURCE_COLORS: Record<string, string> = { OEM: 'text-blue-500', EXTERNO: 'text-emerald-500', YOUTUBE: 'text-red-500', MANUAL: 'text-violet-500' };


/**
 * Sanitizador defensivo: convierte HTML crudo en Markdown limpio.
 * Protege contra contenido generado antes de la restricción de formato.
 */
function sanitizeHtmlToMarkdown(raw: string): string {
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
  s = s.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, '| **$1** ');
  s = s.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, '| $1 ');
  s = s.replace(/<table[^>]*>|<\/table>|<thead[^>]*>|<\/thead>|<tbody[^>]*>|<\/tbody>/gi, '\n');
  s = s.replace(/<hr[^>]*\/?>/gi, '\n---\n');
  s = s.replace(/<br[^>]*\/?>/gi, '\n');

  // Etiquetas de estilo en línea → Markdown
  s = s.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  s = s.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  s = s.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  s = s.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Eliminar cualquier otra etiqueta HTML que no se haya mapeado
  s = s.replace(/<[^>]+>/g, '');

  // Decodificar entidades HTML comunes
  s = s.replace(/&amp;/g, '&');
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#39;/g, "'");
  s = s.replace(/&nbsp;/g, ' ');

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
          className="bg-amber-200 dark:bg-amber-900/60 text-black dark:text-white px-1 py-0.5 rounded border border-amber-400/30 font-bold animate-pulse inline-block shadow-sm shadow-amber-500/10"
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
      result.push(<strong key={m.index} className="font-black text-black/90 dark:text-white/90">{m[2]}</strong>);
    } else if (m[3]) {
      result.push(<code key={m.index} className="bg-black/5 dark:bg-white/5 px-1 py-0.5 rounded text-[11px] font-mono text-copper">{m[4]}</code>);
    } else if (m[5]) {
      result.push(<em key={m.index} className="italic text-black/80 dark:text-white/80">{m[6]}</em>);
    } else if (m[7]) {
      const conceptId = m[8].trim();
      const sym = resolvedSymbology?.find(s => s.concept_id === conceptId);
      
      if (sym && sym.url) {
        result.push(
          <span 
            key={m.index} 
            className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 px-1 py-0.5 rounded-sm align-middle mx-0.5 group relative select-none cursor-help"
            title={sym.technical_name_es}
          >
            <img src={sym.url} alt={sym.technical_name_es} className="w-4 h-4 object-contain inline-block bg-white" />
            <span className="text-[9px] font-bold text-foreground font-mono">{conceptId}</span>
          </span>
        );
      } else {
        result.push(
          <span 
            key={m.index} 
            className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-sm align-middle mx-0.5 select-none cursor-help"
            title="Símbolo pendiente de dibujo o confirmación en el catálogo global"
          >
            <span className="material-symbols-outlined !text-[11px] animate-pulse">warning</span>
            <span className="text-[9px] font-bold font-mono">{conceptId}</span>
          </span>
        );
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) result.push(text.slice(last));

  const processed = activeHighlightText
    ? result.map(node => highlightInNode(node, activeHighlightText))
    : result;

  return processed.map((node, idx) => (
    <React.Fragment key={`inline-${idx}`}>{node}</React.Fragment>
  ));
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

function MarkdownRenderer({ 
  content, 
  activeHighlightText, 
  onFragmentClick,
  resolvedSymbology
}: { 
  content: string; 
  activeHighlightText?: string; 
  onFragmentClick?: (text: string, e: React.MouseEvent) => void; 
  resolvedSymbology?: Array<{ concept_id: string; url: string; technical_name_es: string }>;
}) {

  if (!content) return null;
  const rawClean = cleanFuentesFromMarkdown(content);
  // Sanitizar HTML crudo antes de parsear (retrocompatibilidad con contenido ya guardado)
  const cleanContent = sanitizeHtmlToMarkdown(rawClean);
  const nodes: React.ReactNode[] = [];
  const lines = cleanContent.split('\n');

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]; const line = raw.trim();
    if (!line) { i++; continue; }
    if (line.startsWith('#### ')) { 
      const currentRaw = raw;
      nodes.push(<h4 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className="text-[12px] font-black uppercase tracking-wider text-black/60 dark:text-white/60 mt-5 mb-2 hover:bg-amber-500/5 cursor-pointer rounded px-1 -mx-1 transition-all duration-150">{parseInlineStyles(line.replace('#### ', ''), activeHighlightText, resolvedSymbology)}</h4>); 
      i++; 
      continue; 
    }
    if (line.startsWith('### ')) { 
      const currentRaw = raw;
      nodes.push(<h3 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className="text-[13px] font-black uppercase tracking-wider text-black/70 dark:text-white/70 mt-6 mb-2 border-b border-black/10 dark:border-white/10 pb-1 hover:bg-amber-500/5 cursor-pointer rounded px-1 -mx-1 transition-all duration-150">{parseInlineStyles(line.replace('### ', ''), activeHighlightText, resolvedSymbology)}</h3>); 
      i++; 
      continue; 
    }
    if (line.startsWith('## ')) { 
      const currentRaw = raw;
      nodes.push(<h2 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className="text-[15px] font-black uppercase tracking-tight text-black/80 dark:text-white/80 mt-8 mb-3 hover:bg-amber-500/5 cursor-pointer rounded px-1 -mx-1 transition-all duration-150">{parseInlineStyles(line.replace('## ', ''), activeHighlightText, resolvedSymbology)}</h2>); 
      i++; 
      continue; 
    }
    if (line.startsWith('# ')) { 
      const currentRaw = raw;
      nodes.push(<h1 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className="text-[17px] font-black uppercase tracking-tight text-black dark:text-white mt-8 mb-4 hover:bg-amber-500/5 cursor-pointer rounded px-1 -mx-1 transition-all duration-150">{parseInlineStyles(line.replace('# ', ''), activeHighlightText, resolvedSymbology)}</h1>); 
      i++; 
      continue; 
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: { rawText: string; cleanText: string }[] = [];
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        items.push({ rawText: lines[i], cleanText: lines[i].trim().replace(/^[-*] /, '') }); i++;
      }
      nodes.push(<ul key={`ul-${i}`} className="list-none space-y-1.5 my-3 ml-0">{items.map((it, idx) => <li key={idx} onClick={(e) => onFragmentClick?.(it.rawText, e)} className="flex items-start gap-2 text-[12px] text-black/70 dark:text-white/70 hover:bg-amber-500/5 cursor-pointer rounded px-1 -mx-1 transition-all duration-150"><span className="text-copper mt-0.5 shrink-0">›</span><span>{parseInlineStyles(it.cleanText, activeHighlightText, resolvedSymbology)}</span></li>)}</ul>);
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
        const [header, ...body] = rows;
        nodes.push(<div key={`tbl-${i}`} className="overflow-x-auto my-4"><table className="w-full text-[11px] border-collapse"><thead><tr>{header.map((h, ci) => <th key={ci} className="text-left px-3 py-2 bg-black/5 dark:bg-white/5 font-black uppercase tracking-wider text-black/60 dark:text-white/60 border border-black/10 dark:border-white/10">{parseInlineStyles(h, activeHighlightText, resolvedSymbology)}</th>)}</tr></thead><tbody>{body.map((row, ri) => <tr key={ri} className="border-b border-black/10 dark:border-white/10 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">{row.map((cell, ci) => <td key={ci} onClick={(e) => onFragmentClick?.(cell, e)} className="px-3 py-2 text-black/70 dark:text-white/70 border border-black/10 dark:border-white/10 hover:bg-amber-500/5 cursor-pointer transition-colors duration-150">{parseInlineStyles(cell, activeHighlightText, resolvedSymbology)}</td>)}</tr>)}</tbody></table></div>);
      }
      continue;
    }
    const currentRaw = raw;
    nodes.push(<p key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className="text-[12px] text-black/70 dark:text-white/70 leading-relaxed mb-2 hover:bg-amber-500/5 cursor-pointer rounded px-1 -mx-1 transition-all duration-150">{parseInlineStyles(raw, activeHighlightText, resolvedSymbology)}</p>);
    i++;
  }
  return <div className="font-atkinson">{nodes}</div>;
}

// ─── Classified Sources (ITEMIZADO) ──────────────────────────────────────────
function ItemizedSourcesBlock({ sources }: { sources: ItemizedSource[] }) {
  if (!sources?.length) return null;
  const groups = ['OEM', 'EXTERNO', 'YOUTUBE', 'MANUAL'] as const;
  return (
    <details className="mt-8 pt-6 group">
      <summary className="text-[9px] font-black uppercase tracking-[0.25em] text-black/30 dark:text-white/30 mb-4 cursor-pointer hover:text-black/50 dark:hover:text-white/50 transition-colors list-none flex items-center gap-2">
        <span className="material-symbols-outlined !text-[14px] transition-transform group-open:rotate-90">chevron_right</span>
        FUENTES
      </summary>
      <div className="space-y-5 pl-5">
        {groups.map(g => {
          const items = sources.filter(s => s.type === g);
          if (!items.length) return null;
          return (
            <div key={g}>
              <div className={`flex items-center gap-1.5 mb-2 text-[9px] font-black uppercase tracking-widest ${SOURCE_COLORS[g]}`}>
                <span className="material-symbols-outlined !text-[13px]">{SOURCE_ICONS[g]}</span>
                {g} ({items.length})
              </div>
              <ul className="space-y-2">
                {items.map((src, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className={`material-symbols-outlined !text-[11px] mt-0.5 shrink-0 ${SOURCE_COLORS[g]}`}>link</span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-black/70 dark:text-white/70">{src.author}</p>
                      <p className="text-[10px] text-black/50 dark:text-white/50">{src.description}</p>
                      <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-copper hover:underline break-all">{src.url}</a>
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
  isHunting: boolean;
  huntStatusMessage?: string;
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
}

// ─── Subcomponentes para la refactorización de Actualización por IA ─────────
interface ProposalCardProps {
  proposal: ProposedUpdate;
  onDecide: (proposalId: string, decision: 'APROBADO' | 'ELIMINADO') => Promise<void>;
  isSealed: boolean;
  fallbackUrl?: string;
  children?: React.ReactNode;
}

function ProposalCard({ proposal, onDecide, isSealed, fallbackUrl, children }: ProposalCardProps) {
  const [confirmingDecision, setConfirmingDecision] = useState<'APROBADO' | 'ELIMINADO' | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleReset = () => {
    setConfirmingDecision(null);
    setConfirmText('');
  };

  const handleConfirm = async () => {
    if (!proposal.proposal_id || !confirmingDecision) return;
    setIsSubmitting(true);
    try {
      await onDecide(proposal.proposal_id, confirmingDecision);
      handleReset();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isApproved = proposal.human_decision === 'APROBADO';

  return (
    <div
      className={`border p-4 transition-all duration-300 font-atkinson ${
        isApproved
          ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-950/10'
          : 'border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900/40'
      }`}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-black uppercase tracking-wider text-black/40 dark:text-white/40">
            {proposal.zona} — {proposal.componente}
          </span>
          {proposal.detected_at && (
            <span className="text-[8px] font-mono text-black/30 dark:text-white/30">
              Detectado: {new Date(proposal.detected_at).toLocaleDateString()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isApproved ? (
            <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-emerald-600 bg-emerald-500/10 px-2 py-0.5">
              <span className="material-symbols-outlined !text-[12px]">check_circle</span>
              Aprobado
            </span>
          ) : confirmingDecision ? (
            <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 bg-amber-500/10 text-amber-600 animate-pulse">
              Confirmando...
            </span>
          ) : (
            <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 bg-black/5 dark:bg-white/5 text-black/40 dark:text-white/40">
              Pendiente
            </span>
          )}

          {!isApproved && !confirmingDecision && (
            <div className="flex items-center gap-1">
              <M3IconButton
                icon="done"
                onClick={() => setConfirmingDecision('APROBADO')}
                variant="ghost"
                title="Aprobar hallazgo"
                className="text-emerald-600 hover:bg-emerald-500/10 !p-1 shrink-0"
                disabled={isSealed || isSubmitting}
              />
              <M3IconButton
                icon="delete"
                onClick={() => setConfirmingDecision('ELIMINADO')}
                variant="ghost"
                title="Eliminar propuesta"
                className="text-rose-500 hover:bg-rose-500/10 !p-1 shrink-0"
                disabled={isSealed || isSubmitting}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        {children}
      </div>

      {(proposal.source_url || fallbackUrl) && (proposal.source_url || fallbackUrl) !== '#' && (
        <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-copper">
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
        <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5 space-y-2">
          <p className="text-[10px] font-bold text-black/75 dark:text-white/75">
            Escribe <span className="font-mono text-copper font-bold">"{confirmingDecision.toLowerCase()}"</span> para confirmar esta acción:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmingDecision.toLowerCase()}
              autoComplete="off"
              className="px-2 py-1 text-[11px] bg-white dark:bg-zinc-950 border border-black/15 dark:border-white/15 outline-none flex-1 text-black dark:text-white"
            />
            <button
              disabled={confirmText.toLowerCase().trim() !== confirmingDecision.toLowerCase() || isSubmitting}
              onClick={handleConfirm}
              className={`px-3 py-1 font-bold text-[10px] text-white disabled:opacity-40 rounded-none transition-colors ${
                confirmingDecision === 'APROBADO' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
              }`}
            >
              {isSubmitting ? 'Procesando...' : 'Confirmar'}
            </button>
            <button
              onClick={handleReset}
              disabled={isSubmitting}
              className="px-3 py-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/15 text-[10px] text-black/70 dark:text-white/70"
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
  const [evolveInput, setEvolveInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firstValidUrl = item.item_sources?.find(s => s.url && s.url !== '#')?.url;

  const proposals = (item.pending_conflicts ?? []).filter(
    p => p.estado_fusion === 'NUEVO' && p.human_decision !== 'ELIMINADO'
  );

  const approvedCount = proposals.filter(p => p.human_decision === 'APROBADO').length;
  const pendingCount = proposals.filter(p => p.human_decision === null).length;

  const handleEvolve = async () => {
    if (evolveInput.toLowerCase().trim() !== 'actualizar') return;
    setIsSubmitting(true);
    try {
      await onEvolveItemByType('NUEVO');
      setEvolveInput('');
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full font-atkinson">
      <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-black/50 hover:text-black dark:hover:text-white flex items-center justify-center p-1"
            title="Volver al contenido"
          >
            <span className="material-symbols-outlined !text-[18px]">arrow_back</span>
          </button>
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-black/85 dark:text-white/85">
              Nuevo Contenido
            </h3>
            <p className="text-[10px] text-black/50 dark:text-white/50">
              {pendingCount} pendiente(s) · {approvedCount} aprobado(s)
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-black/40 hover:text-black dark:hover:text-white flex items-center justify-center p-1"
          title="Cancelar y volver"
        >
          <span className="material-symbols-outlined !text-[18px]">close</span>
        </button>
      </div>

      {approvedCount > 0 && (
        <div className="mt-3 p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-300 dark:border-emerald-700 flex flex-col gap-2 shrink-0">
          <p className="text-[10px] font-bold text-emerald-800 dark:text-emerald-400">
            Tienes {approvedCount} propuesta(s) aprobada(s). Escribe "actualizar" para regenerar el ítem integrando estos cambios:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={evolveInput}
              onChange={(e) => setEvolveInput(e.target.value)}
              placeholder="actualizar"
              autoComplete="off"
              className="px-2 py-1 bg-white dark:bg-zinc-950 border border-emerald-300 dark:border-emerald-700 outline-none text-[11px] flex-1 text-black dark:text-white"
            />
            <button
              disabled={evolveInput.toLowerCase().trim() !== 'actualizar' || isSealed || isSubmitting}
              onClick={handleEvolve}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] disabled:opacity-40 rounded-none transition-colors"
            >
              {isSubmitting ? 'Actualizando...' : 'Actualizar Ítem'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1 custom-scrollbar">
        {proposals.length === 0 ? (
          <div className="py-12 text-center text-[11px] text-black/45 dark:text-white/45 italic border border-dashed border-black/10 dark:border-white/10">
            No hay propuestas de nuevo contenido pendientes de revisión.
          </div>
        ) : (
          proposals.map((prop) => (
            <ProposalCard
              key={prop.proposal_id}
              proposal={prop}
              onDecide={onDecideProposal}
              isSealed={isSealed}
              fallbackUrl={firstValidUrl}
            >
              <div className="space-y-2 text-[11px] leading-relaxed">
                {prop.synthesis && (
                  <p className="text-black/85 dark:text-white/85 font-medium bg-black/[0.02] dark:bg-white/[0.02] p-2 border-l-2 border-copper">
                    {prop.synthesis}
                  </p>
                )}
                <div className="mt-2 text-black/60 dark:text-white/60">
                  <span className="font-bold text-black/75 dark:text-white/75 block mb-0.5">Dato Propuesto:</span>
                  <div className="font-mono bg-black/[0.01] dark:bg-white/[0.01] p-2 border border-black/5 dark:border-white/5 break-all max-h-32 overflow-y-auto custom-scrollbar">
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
  const [evolveInput, setEvolveInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firstValidUrl = item.item_sources?.find(s => s.url && s.url !== '#')?.url;

  const proposals = (item.pending_conflicts ?? []).filter(
    p => p.estado_fusion === 'CONFLICTO' && p.human_decision !== 'ELIMINADO'
  );

  const approvedCount = proposals.filter(p => p.human_decision === 'APROBADO').length;
  const pendingCount = proposals.filter(p => p.human_decision === null).length;

  const handleEvolve = async () => {
    if (evolveInput.toLowerCase().trim() !== 'actualizar') return;
    setIsSubmitting(true);
    try {
      await onEvolveItemByType('CONFLICTO');
      setEvolveInput('');
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full font-atkinson">
      <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-black/50 hover:text-black dark:hover:text-white flex items-center justify-center p-1"
            title="Volver al contenido"
          >
            <span className="material-symbols-outlined !text-[18px]">arrow_back</span>
          </button>
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-black/85 dark:text-white/85">
              Contenido en Conflicto
            </h3>
            <p className="text-[10px] text-black/50 dark:text-white/50">
              {pendingCount} pendiente(s) · {approvedCount} aprobado(s)
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-black/40 hover:text-black dark:hover:text-white flex items-center justify-center p-1"
          title="Cancelar y volver"
        >
          <span className="material-symbols-outlined !text-[18px]">close</span>
        </button>
      </div>

      {approvedCount > 0 && (
        <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 flex flex-col gap-2 shrink-0">
          <p className="text-[10px] font-bold text-amber-800 dark:text-amber-400">
            Tienes {approvedCount} propuesta(s) aprobada(s). Escribe "actualizar" para regenerar el ítem resolviendo los conflictos:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={evolveInput}
              onChange={(e) => setEvolveInput(e.target.value)}
              placeholder="actualizar"
              autoComplete="off"
              className="px-2 py-1 bg-white dark:bg-zinc-950 border border-amber-300 dark:border-amber-700 outline-none text-[11px] flex-1 text-black dark:text-white"
            />
            <button
              disabled={evolveInput.toLowerCase().trim() !== 'actualizar' || isSealed || isSubmitting}
              onClick={handleEvolve}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] disabled:opacity-40 rounded-none transition-colors"
            >
              {isSubmitting ? 'Actualizando...' : 'Actualizar Ítem'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1 custom-scrollbar">
        {proposals.length === 0 ? (
          <div className="py-12 text-center text-[11px] text-black/45 dark:text-white/45 italic border border-dashed border-black/10 dark:border-white/10">
            No hay propuestas de conflicto pendientes de revisión.
          </div>
        ) : (
          proposals.map((prop) => (
            <ProposalCard
              key={prop.proposal_id}
              proposal={prop}
              onDecide={onDecideProposal}
              isSealed={isSealed}
              fallbackUrl={firstValidUrl}
            >
              <div className="space-y-2 text-[11px] leading-relaxed">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-2 border-b border-black/5 dark:border-white/5">
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-black/30 dark:text-white/30 uppercase tracking-wide">Contenido Actual</span>
                    <div className="p-2 border border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01] italic text-black/60 dark:text-white/60 leading-relaxed font-mono break-all max-h-32 overflow-y-auto custom-scrollbar">
                      {prop.valor_actual || "---"}
                    </div>
                  </div>
                  <div className="space-y-1 md:border-l md:border-black/5 md:dark:border-white/5 md:pl-3">
                    <span className="text-[9px] font-bold text-amber-600 dark:text-amber-500 uppercase tracking-wide">Hallazgo</span>
                    <div className="p-2 border border-amber-500/10 bg-amber-500/5 dark:bg-amber-950/10 text-black dark:text-white leading-relaxed font-mono break-all max-h-32 overflow-y-auto custom-scrollbar">
                      {prop.valor_nuevo}
                    </div>
                  </div>
                </div>

                {prop.synthesis && (
                  <p className="text-black/85 dark:text-white/85 font-medium bg-black/[0.02] dark:bg-white/[0.02] p-2 border-l-2 border-amber-500">
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

function ItemContentBlock({ 
  item, 
  isHunting,
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
}: ItemContentBlockProps) {
  const { t } = useTranslation();
  const [correctionText, setCorrectionText] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [selectedFragment, setSelectedFragment] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  
  const [confirmUnlockInput, setConfirmUnlockInput] = useState('');
  const [confirmApprovalInput, setConfirmApprovalInput] = useState('');
  const [huntConfirmText, setHuntConfirmText] = useState('');
  const [showHuntConfirm, setShowHuntConfirm] = useState(false);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const chatFeedRef = useRef<HTMLDivElement>(null);

  const isGenerating = item.content_status === 'GENERANDO' || isHunting || isSearching;

  useEffect(() => {
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setSessionId(newSessionId);

    return () => {
      if (catalogId && item.item_id && newSessionId) {
        authFetch(`${API_BASE_URL}/vault/ai-assist-session-close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ globalAssetId: catalogId, itemId: item.item_id, sessionId: newSessionId })
        }).catch(err => console.warn('[VaultChat] Error al cerrar sesión:', err));
      }
    };
  }, [catalogId, item.item_id]);

  useEffect(() => {
    if (!catalogId || !item.item_id || !sessionId) return;

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
  }, [catalogId, item.item_id, sessionId]);

  useEffect(() => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  const handleFragmentClick = (text: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedFragment(text);
  };

  const latestDraftMessage = [...messages].reverse().find(msg => msg.role === 'model' && msg.draftContent);
  const latestDraftContent = latestDraftMessage?.draftContent || null;
  const latestDraftIntent = latestDraftMessage?.intent || 'EDIT_PROPOSAL';

  const latestModelMessage = [...messages].reverse().find(msg => msg.role === 'model');
  const activeHighlightText = latestModelMessage?.highlightText || undefined;

  const handleSendMessage = async () => {
    if (!correctionText.trim()) return;

    const textInput = correctionText.trim().toLowerCase();
    
    if (['aprobar', 'aprobado', 'confirmar', 'confirmo'].includes(textInput)) {
      if (!latestDraftContent) {
        toast.warning('No hay ningún borrador de cambios pendiente para aprobar.');
        return;
      }
      
      setIsSending(true);
      const toastId = toast.loading('Aplicando propuesta de cambios...');
      try {
        const userEmail = auth.currentUser?.email || 'revisor.humano@opermaq.cl';
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
            sessionId
          }),
        });
        if (res.ok) {
          toast.update(toastId, { render: '✓ Cambios aplicados exitosamente.', type: 'success', isLoading: false, autoClose: 3000 });
          setCorrectionText('');
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
      const userEmail = auth.currentUser?.email || 'revisor.humano@opermaq.cl';
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

  return (
    <div className="flex-1 flex flex-row min-h-0 w-full gap-4 font-atkinson relative">
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto hide-scrollbar pr-4 select-text">
        {activeProposalView?.itemId === item.item_id ? (
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
        ) : (
          item.content && (
            <div className="space-y-6">
              <>
                <MarkdownRenderer 
                  content={item.content} 
                  activeHighlightText={activeHighlightText}
                  onFragmentClick={handleFragmentClick}
                  resolvedSymbology={resolvedSymbology}
                />
                {item.item_sources?.length ? (
                  <ItemizedSourcesBlock sources={item.item_sources} />
                ) : null}
              </>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  {item.approved_by && (
                    <span className="text-[8px] text-black/30 dark:text-white/30 font-mono">
                      {t('vault_dashboard.labels.by')} {item.approved_by} · {item.approved_at ? new Date(item.approved_at).toLocaleDateString() : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        )}
      </div>

      <div className="w-[260px] shrink-0 flex flex-col justify-between border-l border-black/10 dark:border-white/10 pl-4 pb-2 h-full min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 pb-4 gap-4 overflow-hidden">
          <div className="flex items-center justify-between mb-1 shrink-0">
            <span className="text-[9px] font-black uppercase tracking-widest text-black/40 dark:text-white/40">OPERMAQ IA</span>
            {isGenerating && (
              <span className="material-symbols-outlined !text-[12px] text-copper animate-spin">progress_activity</span>
            )}
          </div>

          <div 
            ref={chatFeedRef}
            className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 scroll-smooth custom-scrollbar"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'var(--color-scrollbar, rgba(184,115,51,0.25)) transparent',
            }}
          >
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                <span className="material-symbols-outlined !text-[28px] text-black/20 dark:text-white/20 mb-2">forum</span>
                <p className="text-[11px] text-black/45 dark:text-white/45 italic leading-relaxed">
                  Inicia una conversación para consultar o editar este ítem con asistencia de OPERMAQ IA.
                </p>
              </div>
            ) : (
              messages.map((msg, index) => {
                const isUser = msg.role === 'user';
                const isSystem = msg.role === 'system';
                
                if (isSystem) {
                  return (
                    <div key={msg.id || index} className="p-2 bg-black/[0.02] dark:bg-white/5 border border-black/5 dark:border-white/10 text-center animate-in fade-in duration-200 shrink-0">
                      <p className="text-[10px] text-black/55 dark:text-white/55 font-medium leading-relaxed">
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
                    <span className="text-[8px] font-black uppercase tracking-wider text-black/30 dark:text-white/30">
                      {isUser ? 'Tú' : 'OPERMAQ IA'}
                    </span>
                    
                    <div 
                      className={`p-2.5 text-[11px] leading-relaxed font-sans rounded-none ${
                        isUser 
                          ? 'bg-black/[0.04] dark:bg-white/[0.06] text-black/90 dark:text-white/90 border border-black/5 dark:border-white/10' 
                          : 'bg-copper/[0.03] dark:bg-copper/[0.06] text-black/95 dark:text-white/95 border border-copper/15 dark:border-copper/25'
                      }`}
                    >
                      <MarkdownRenderer content={msg.content} resolvedSymbology={resolvedSymbology} />
                    </div>

                    {msg.highlightText && (
                      <div className="flex items-center gap-1 mt-0.5 text-[9px] text-amber-600 dark:text-amber-500 font-bold shrink-0">
                        <span className="material-symbols-outlined !text-[12px] animate-pulse">local_library</span>
                        Destaque activo en pantalla
                      </div>
                    )}

                    {msg.draftContent && (
                      <div className="mt-2 w-full bg-white dark:bg-zinc-900 border border-emerald-500/20 p-2.5 flex flex-col gap-2 shadow-sm animate-in zoom-in-95 duration-200 shrink-0">
                        <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-500">
                          <span className="material-symbols-outlined !text-[14px]">edit_document</span>
                          Propuesta de Borrador
                        </div>
                        <p className="text-[10px] text-black/50 dark:text-white/50 leading-snug">
                          Escribe <span className="font-bold text-copper">"aprobar"</span> en el chat o pulsa abajo para aplicar estos cambios en el catálogo.
                        </p>
                        <div className="max-h-24 overflow-y-auto border border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01] p-1.5 text-[9px] font-mono text-black/60 dark:text-white/60 custom-scrollbar">
                          <pre className="whitespace-pre-wrap">{msg.draftContent}</pre>
                        </div>
                        <button
                          disabled={isSealed || isSending}
                          onClick={async () => {
                            setIsSending(true);
                            const toastId = toast.loading('Aplicando propuesta de cambios...');
                            try {
                              const userEmail = auth.currentUser?.email || 'revisor.humano@opermaq.cl';
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
                                  sessionId
                                }),
                              });
                              if (res.ok) {
                                toast.update(toastId, { render: '✓ Cambios aplicados exitosamente.', type: 'success', isLoading: false, autoClose: 3000 });
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
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] py-1 font-bold transition-colors disabled:opacity-40"
                        >
                          Aprobar y Guardar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {isSending && (
              <div className="flex items-center gap-1.5 py-1 justify-start text-[10px] text-copper animate-pulse shrink-0">
                <span className="material-symbols-outlined !text-[14px] animate-spin">progress_activity</span>
                <span>Procesando consulta...</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col shrink-0">
          {selectedFragment && (
            <div className="mb-2 bg-copper/5 border border-copper/20 p-2 text-[10px] flex items-start gap-2 animate-in slide-in-from-bottom-2 shrink-0">
              <div className="flex-1 min-w-0">
                <span className="font-bold text-copper uppercase block text-[8px] tracking-wider mb-0.5">Fragmento Seleccionado</span>
                <p className="text-black/60 dark:text-white/60 italic truncate max-w-full">
                  "{selectedFragment}"
                </p>
              </div>
              <button 
                onClick={() => setSelectedFragment(null)}
                className="text-black/45 hover:text-red-500 flex items-center justify-center p-0.5"
              >
                <span className="material-symbols-outlined !text-[14px]">close</span>
              </button>
            </div>
          )}

          {!item.is_human_locked && (
            <div className="flex flex-col gap-2 pb-3">
              <div className="bg-black/5 dark:bg-white/5 rounded-[1.25rem] flex flex-col p-2 border border-black/10 dark:border-white/10">
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
                  placeholder={latestDraftContent ? "Escribe 'aprobar' para aplicar el borrador..." : "Ingrese instrucciones a OPERMAQ"}
                  autoComplete="off"
                  className="w-full bg-transparent resize-none focus:outline-none text-[12px] text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 custom-scrollbar px-1"
                />
                <div className="flex justify-end items-center mt-1 gap-2">
                  <button
                    onClick={() => toast.info('Función de audio estará disponible próximamente.')}
                    className="text-black/40 hover:text-black/60 dark:text-white/40 dark:hover:text-white/60 p-1 rounded-full transition-colors flex items-center justify-center"
                    disabled={isSending || isGenerating || isSealed}
                  >
                    <span className="material-symbols-outlined !text-[20px]">mic</span>
                  </button>
                  <button
                    disabled={!correctionText.trim() || isSending || isSealed || isGenerating}
                    onClick={handleSendMessage}
                    className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                      correctionText.trim() && !isSending && !isSealed && !isGenerating
                        ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                        : 'bg-black/10 text-black/30 dark:bg-white/10 dark:text-white/30 cursor-not-allowed'
                    }`}
                  >
                    <span className="material-symbols-outlined !text-[16px]">
                      arrow_upward
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {!item.is_human_locked && (
            <div className="flex justify-start py-2 px-2 border-t border-black/10 dark:border-white/10">
              <button
                onClick={() => toast.info('Función de adjuntar foto estará disponible próximamente.')}
                className="text-black/40 hover:text-black/60 dark:text-white/40 dark:hover:text-white/60 p-1 rounded-full transition-colors flex items-center justify-center"
                disabled={isSending || isGenerating || isSealed}
              >
                <span className="material-symbols-outlined !text-[20px]">add_photo_alternate</span>
              </button>
            </div>
          )}

          <div className="flex flex-col gap-3 pt-3 border-t border-black/10 dark:border-white/10">
            <div className="flex flex-col gap-2">
              <button
                disabled={isSealed || isGenerating || item.is_human_locked}
                onClick={() => setShowHuntConfirm(!showHuntConfirm)}
                className="w-full flex items-center gap-3 px-3 py-2 bg-transparent transition-all text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white disabled:opacity-40 disabled:pointer-events-none"
              >
                <span className={`material-symbols-outlined !text-[20px] ${isGenerating && !isSending ? 'animate-spin text-copper' : ''}`}>sync</span>
                <span className="text-[10px] font-black uppercase tracking-wider">Actualizar</span>
              </button>

              {showHuntConfirm && (
                <div className="p-2 border border-copper/20 bg-copper/5 flex flex-col gap-2">
                  <p className="text-[9px] text-copper font-bold">Escribe "actualizar" para confirmar la regeneración por IA:</p>
                  <input
                    type="text"
                    value={huntConfirmText}
                    onChange={(e) => setHuntConfirmText(e.target.value)}
                    placeholder="actualizar"
                    autoComplete="off"
                    className="px-2 py-1 bg-white dark:bg-zinc-900 border border-copper/30 outline-none text-[10px] text-black dark:text-white"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={huntConfirmText.toLowerCase().trim() !== 'actualizar' || isGenerating || isSealed}
                      onClick={() => {
                        onHunt();
                        setHuntConfirmText('');
                        setShowHuntConfirm(false);
                      }}
                      className="px-2 py-0.5 bg-copper text-white font-bold text-[9px] disabled:opacity-40"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setShowHuntConfirm(false)}
                      className="px-2 py-0.5 text-black/40 hover:text-black dark:text-white/40 dark:hover:text-white text-[9px]"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => {
                if (activeProposalView?.itemId === item.item_id && activeProposalView.view === 'nuevos') {
                  onSetProposalView(null);
                } else {
                  onSetProposalView({ itemId: item.item_id, pillarId, view: 'nuevos' });
                }
              }}
              className={`w-full flex items-center justify-between px-3 py-2 bg-transparent transition-all border border-transparent hover:border-black/5 dark:hover:border-white/5 ${
                activeProposalView?.itemId === item.item_id && activeProposalView.view === 'nuevos'
                  ? 'text-emerald-600 dark:text-emerald-500 font-bold bg-emerald-500/5'
                  : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'
              }`}
              title="Nuevo Contenido"
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined !text-[20px]">docs_add_on</span>
                <span className="text-[10px] font-black uppercase tracking-wider">Nuevo Contenido</span>
              </div>
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-none font-mono ${
                (item.pending_conflicts ?? []).filter(p => p.estado_fusion === 'NUEVO' && p.human_decision !== 'ELIMINADO').length > 0
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-black/5 dark:bg-white/5 text-black/30 dark:text-white/30'
              }`}>
                {(item.pending_conflicts ?? []).filter(p => p.estado_fusion === 'NUEVO' && p.human_decision !== 'ELIMINADO').length}
              </span>
            </button>

            <button
              onClick={() => {
                if (activeProposalView?.itemId === item.item_id && activeProposalView.view === 'conflictos') {
                  onSetProposalView(null);
                } else {
                  onSetProposalView({ itemId: item.item_id, pillarId, view: 'conflictos' });
                }
              }}
              className={`w-full flex items-center justify-between px-3 py-2 bg-transparent transition-all border border-transparent hover:border-black/5 dark:hover:border-white/5 ${
                activeProposalView?.itemId === item.item_id && activeProposalView.view === 'conflictos'
                  ? 'text-amber-600 dark:text-amber-500 font-bold bg-amber-500/5'
                  : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'
              }`}
              title="Contenido en Conflicto"
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined !text-[20px]">swap_horiz</span>
                <span className="text-[10px] font-black uppercase tracking-wider">Contenido en Conflicto</span>
              </div>
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-none font-mono ${
                (item.pending_conflicts ?? []).filter(p => p.estado_fusion === 'CONFLICTO' && p.human_decision !== 'ELIMINADO').length > 0
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-black/5 dark:bg-white/5 text-black/30 dark:text-white/30'
              }`}>
                {(item.pending_conflicts ?? []).filter(p => p.estado_fusion === 'CONFLICTO' && p.human_decision !== 'ELIMINADO').length}
              </span>
            </button>
          </div>

          <div className="flex flex-col gap-3 pt-4 mt-1 border-t border-black/10 dark:border-white/10">
            <button
              onClick={() => toast.info('Exportación PDF estará disponible próximamente.')}
              className="w-full flex items-center gap-3 px-3 py-2 bg-transparent transition-all text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white"
            >
              <span className="material-symbols-outlined !text-[20px]">picture_as_pdf</span>
              <span className="text-[10px] font-black uppercase tracking-wider">Exportar PDF</span>
            </button>

            <button
              onClick={() => setShowHistoryModal(true)}
              className="w-full flex items-center gap-3 px-3 py-2 bg-transparent transition-all text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white"
            >
              <span className="material-symbols-outlined !text-[20px]">history</span>
              <span className="text-[10px] font-black uppercase tracking-wider">Historial</span>
            </button>

          {item.is_human_locked ? (
            <div className="flex flex-col gap-2">
              <button
                disabled={isSealed || isGenerating}
                onClick={() => setShowUnlockConfirm(!showUnlockConfirm)}
                className="w-full flex items-center gap-3 px-3 py-2 bg-transparent transition-all text-amber-600 hover:text-amber-700 disabled:opacity-40 disabled:pointer-events-none"
              >
                <span className="material-symbols-outlined !text-[20px] text-amber-500">edit_document</span>
                <span className="text-[10px] font-black uppercase tracking-wider">EDITAR ÍTEM</span>
              </button>
              {showUnlockConfirm && (
                <div className="p-2 border border-amber-500/20 bg-amber-500/5 flex flex-col gap-2">
                  <p className="text-[9px] text-amber-800 dark:text-amber-400 font-bold">Escribe "editar" para confirmar el desbloqueo:</p>
                  <input
                    type="text"
                    value={confirmUnlockInput}
                    onChange={(e) => setConfirmUnlockInput(e.target.value)}
                    placeholder="editar"
                    autoComplete="off"
                    className="px-2 py-1 bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-700 outline-none text-[10px] text-black dark:text-white"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={confirmUnlockInput.toLowerCase().trim() !== 'editar'}
                      onClick={async () => {
                        await onUnlockItem();
                        setConfirmUnlockInput('');
                        setShowUnlockConfirm(false);
                      }}
                      className="px-2 py-0.5 bg-amber-600 text-white font-bold text-[9px] disabled:opacity-40"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => {
                        setConfirmUnlockInput('');
                        setShowUnlockConfirm(false);
                      }}
                      className="px-2 py-0.5 border border-black/10 text-[9px]"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                disabled={isSealed || isGenerating}
                onClick={() => setShowApprovalConfirm(!showApprovalConfirm)}
                className="w-full flex items-center gap-3 px-3 py-2 bg-transparent transition-all text-emerald-600/70 hover:text-emerald-600 disabled:opacity-40 disabled:pointer-events-none"
              >
                <span className="material-symbols-outlined !text-[20px] text-emerald-500/60">verified</span>
                <span className="text-[10px] font-black uppercase tracking-wider">Aprobar Ítem</span>
              </button>
              {showApprovalConfirm && (
                <div className="p-2 border border-emerald-500/20 bg-emerald-500/5 flex flex-col gap-2">
                  <p className="text-[9px] text-emerald-800 dark:text-emerald-400 font-bold">Escribe "aprobar" para confirmar la aprobación:</p>
                  <input
                    type="text"
                    value={confirmApprovalInput}
                    onChange={(e) => setConfirmApprovalInput(e.target.value)}
                    placeholder="aprobar"
                    autoComplete="off"
                    className="px-2 py-1 bg-white dark:bg-zinc-900 border border-emerald-300 dark:border-emerald-700 outline-none text-[10px] text-black dark:text-white"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={confirmApprovalInput.toLowerCase().trim() !== 'aprobar'}
                      onClick={async () => {
                        await onUpdateApprovalState('APROBADO_HUMANO');
                        setConfirmApprovalInput('');
                        setShowApprovalConfirm(false);
                      }}
                      className="px-2 py-0.5 bg-emerald-600 text-white font-bold text-[9px] disabled:opacity-40"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => {
                        setConfirmApprovalInput('');
                        setShowApprovalConfirm(false);
                      }}
                      className="px-2 py-0.5 border border-black/10 text-[9px]"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            disabled={isSealed || isGenerating || item.is_human_locked}
            onClick={onDiscard}
            className="w-full flex items-center gap-3 px-3 py-2 bg-transparent transition-all text-red-600/65 hover:text-red-500 disabled:opacity-40 disabled:pointer-events-none"
          >
            <span className="material-symbols-outlined !text-[20px] text-red-500/50">text_ad_off</span>
            <span className="text-[10px] font-black uppercase tracking-wider">Descartar Ítem</span>
          </button>
          </div>

        </div>

      </div>

      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-950 border border-black/10 dark:border-white/10 w-full max-w-2xl h-[80vh] flex flex-col font-atkinson p-6 justify-between">
            
            <div className="flex items-center justify-between pb-4 border-b border-black/10 dark:border-white/10">
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-black/80 dark:text-white/80">Historial de Cambios</h3>
                <p className="text-[11px] text-black/50 dark:text-white/50">{item.title}</p>
              </div>
              <M3IconButton
                icon="close"
                onClick={() => setShowHistoryModal(false)}
                className="text-black/50 hover:text-black dark:hover:text-white"
              />
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4 custom-scrollbar">
              {!item.historial_cambios || item.historial_cambios.length === 0 ? (
                <p className="text-[12px] text-black/40 dark:text-white/40 italic text-center py-8">No hay registros en el historial de este ítem.</p>
              ) : (
                [...item.historial_cambios].reverse().map((log: HistorialAuditoria, index) => (
                  <div key={index} className="p-3 border border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01] space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="space-y-0.5">
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60">
                          {log.accion.replace(/_/g, ' ')}
                        </span>
                        <div className="text-[10px] font-bold text-black/80 dark:text-white/80">
                          {log.actor} · <span className="font-mono text-[9px] text-black/40">{new Date(log.fecha).toLocaleString()}</span>
                        </div>
                      </div>
                      {log.snapshot_anterior !== undefined && (
                        <M3Button
                          variant="ghost"
                          icon="history"
                          disabled={item.is_human_locked || isSealed}
                          onClick={async () => {
                            if (window.confirm('¿Confirmas que deseas restaurar esta versión anterior?')) {
                              await onRollbackVersion(log.fecha);
                              setShowHistoryModal(false);
                            }
                          }}
                          className="text-copper text-[10px]"
                        >
                          Restaurar Versión
                        </M3Button>
                      )}
                    </div>
                    {log.detalle && (
                      <p className="text-[11px] text-black/70 dark:text-white/70 italic">
                        "{log.detalle}"
                      </p>
                    )}
                    {log.snapshot_anterior !== undefined && (
                      <details className="group border-t border-black/5 dark:border-white/5 pt-2">
                        <summary className="text-[9px] font-black text-black/40 dark:text-white/40 uppercase tracking-widest cursor-pointer hover:text-black/60 list-none flex items-center gap-1">
                          <span className="material-symbols-outlined !text-[12px] transition-transform group-open:rotate-90">chevron_right</span>
                          Ver contenido de esta versión
                        </summary>
                        <div className="mt-2 p-3 bg-black/[0.02] dark:bg-zinc-900/40 max-h-60 overflow-y-auto border border-black/5 custom-scrollbar text-[11px] text-black/80 dark:text-white/80">
                          <MarkdownRenderer content={log.snapshot_anterior} resolvedSymbology={resolvedSymbology} />
                        </div>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 border-t border-black/10 dark:border-white/10 flex justify-end">
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
  onHunt: (itemId: string, correction?: string) => void;
  onAiAssist: (itemId: string, userRequest: string) => Promise<AiAssistResponse | null>;
  onApplyAssist: (itemId: string, finalContent: string, intent: string) => Promise<void>;
  isAssistingItemId: string | null;
  huntingItemId: string | null;
  huntStatusMessage?: string;
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
}


function ItemizedItemsList({ 
  items, onHunt, onAiAssist, onApplyAssist, isAssistingItemId: assistingItemId, huntingItemId, huntStatusMessage,
  expandedItems, onToggleExpand, onDiscard: _onDiscard, onReactivate, isArchive, isSealed,
  onUnlockItem, onUpdateApprovalState, onRollbackVersion, catalogId,
  pillarId, activeProposalView, onSetProposalView, onDecideProposal, onEvolveItemByType,
  resolveItemSymbology
}: ItemizedItemsListProps) {
  const { t } = useTranslation();
  
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [discardConfirmInput, setDiscardConfirmInput] = useState('');

  const [confirmReactivateId, setConfirmReactivateId] = useState<string | null>(null);
  const [reactivateConfirmInput, setReactivateConfirmInput] = useState('');

  if (!items?.length) return null;
  const sections = [...new Set(items.map(it => it.section))];
  const hasExpanded = expandedItems.size > 0;

  return (
    <div className={`mt-4 ${isArchive ? 'opacity-60 grayscale-[0.5]' : ''} ${hasExpanded ? 'flex-1 flex flex-col h-full min-h-0' : 'space-y-5'}`}>
      {sections.map(sec => {
        const secItems = items.filter(it => it.section === sec);
        if (hasExpanded && !secItems.some(it => expandedItems.has(it.item_id))) return null;
        return (
          <div key={sec} className={hasExpanded ? 'flex-1 flex flex-col h-full min-h-0' : ''}>
            {!hasExpanded && <p className="text-[9px] font-black uppercase tracking-[0.2em] text-black/40 dark:text-white/40 mb-2">{sec}</p>}
            <div className={hasExpanded ? 'flex-1 flex flex-col h-full min-h-0' : 'space-y-3'}>
              {secItems.map(item => {
                const isCompleted = item.content_status === 'COMPLETADO';
                const isError     = item.content_status === 'ERROR';
                const isGenerating = item.content_status === 'GENERANDO' || huntingItemId === item.item_id;
                const isExpanded = expandedItems.has(item.item_id);
                const hasContent = !!(item.content && item.content.trim());

                if (hasExpanded && !isExpanded) return null;

                return (
                  <div
                    key={item.item_id}
                    id={`item-card-${item.item_id}`}
                    className={`p-3 border transition-all duration-300 flex flex-col ${
                      isCompleted ? 'border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-900/10' :
                      isError     ? 'border-red-500/20 bg-red-50/30 dark:bg-red-900/10' :
                      isGenerating? 'border-copper/20 bg-amber-50/20 dark:bg-amber-900/10' :
                      'border-black/10 dark:border-white/10 bg-black/[0.01] dark:bg-white/[0.01]'
                    } ${isExpanded ? 'flex-1 h-full min-h-0 ring-1 ring-copper/10 shadow-sm' : ''}`}
                  >
                    {/* Cabecera del ítem */}
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
                        <span className="text-[10px] font-mono text-black/25">{String(item.order).padStart(2,'0')}</span>
                        <div className="w-9 h-9 shrink-0" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className={hasContent && !isArchive ? 'cursor-pointer' : ''} onClick={() => hasContent && !isArchive ? onToggleExpand(item.item_id) : undefined}>
                          <p className="text-[12px] font-black text-black/80 dark:text-white/80">{item.title}</p>
                          <p className="text-[10px] text-black/50 dark:text-white/50 mt-0.5">{item.rationale}</p>
                        </div>
                        {item.created_by ? (
                          <p className="text-[9px] font-mono text-copper mt-1">{item.created_by}</p>
                        ) : item.standard ? (
                          <p className="text-[9px] font-mono text-copper mt-1">{item.standard}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {/* Ícono de estado: siempre visible */}
                        {!isArchive && (
                          <div className="flex items-center gap-1">
                            {item.pending_conflicts && item.pending_conflicts.length > 0 && (
                              <span className="flex items-center justify-center w-10 h-10 shrink-0">
                                <span className="material-symbols-outlined !text-[24px] text-blue-500 animate-pulse" title="Nuevos hallazgos o conflictos pendientes">release_alert</span>
                              </span>
                            )}
                            {item.is_human_locked ? (
                              <span className="flex items-center justify-center w-10 h-10 shrink-0">
                                <span className="material-symbols-outlined !text-[24px] text-emerald-500" title="Aprobado Humano">verified</span>
                              </span>
                            ) : hasContent ? (
                              <span className="flex items-center justify-center w-10 h-10 shrink-0">
                                <span className="material-symbols-outlined !text-[24px] text-amber-500" title="Editable">edit_document</span>
                              </span>
                            ) : null}
                          </div>
                        )}

                        {/* Descartar / Reactivar: solo en listado colapsado */}
                        {!isExpanded && (
                          <div className="flex items-center gap-1">
                            {!isArchive ? (
                              !hasContent && (
                                <>
                                  <M3IconButton
                                    icon="travel_explore"
                                    onClick={(e) => { e.stopPropagation(); onHunt(item.item_id); }}
                                    variant="ghost"
                                    title="Cazar contenido"
                                    className={`text-copper/70 hover:text-copper ${isSealed || isGenerating ? 'opacity-20 cursor-not-allowed' : ''}`}
                                    disabled={isSealed || isGenerating || item.is_human_locked}
                                  />
                                  <M3IconButton
                                    icon="text_ad_off"
                                    onClick={(e) => { e.stopPropagation(); if (!isSealed) setConfirmDiscardId(item.item_id); }}
                                    variant="ghost"
                                    className={`text-red-400/50 hover:text-red-500 ${isSealed ? 'opacity-20 cursor-not-allowed' : ''}`}
                                    disabled={isSealed || isGenerating || item.is_human_locked}
                                  />
                                </>
                              )
                            ) : (
                              <M3Button
                                variant="ghost"
                                icon={isSealed ? 'lock' : 'lightbulb'}
                                onClick={() => { if (!isSealed) setConfirmReactivateId(item.item_id); }}
                                className={`text-[9px] text-emerald-500 ${isSealed ? 'opacity-40 cursor-not-allowed' : ''}`}
                                disabled={isSealed}
                              >
                                {isSealed ? (t('vault_dashboard.bloqueado') || 'BLOQUEADO').toUpperCase() : (t('vault_dashboard.reactivate') || 'REACTIVAR').toUpperCase()}
                              </M3Button>
                            )}
                          </div>
                        )}

                        {!isArchive && item.content_status === 'ERROR' && item.hunt_error && (
                          <p className="text-[8px] text-red-500 font-bold uppercase tracking-tighter">ERROR: {item.hunt_error}</p>
                        )}

                      </div>
                    </div>

                    {/* Confirmación Descarte Inline */}
                    {confirmDiscardId === item.item_id && (
                      <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 space-y-2 w-full text-left">
                        <p className="text-[11px] font-bold text-red-800 dark:text-red-400">¿Descartar este ítem? No se borrará del sistema pero ya no se mostrará a los clientes. Escribe "descartar" para confirmar:</p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={discardConfirmInput}
                            onChange={(e) => setDiscardConfirmInput(e.target.value)}
                            placeholder="descartar"
                            autoComplete="off"
                            className="px-2 py-1 bg-white dark:bg-zinc-900 border border-red-300 dark:border-red-700 outline-none text-[11px] flex-1 text-black dark:text-white"
                          />
                          <button
                            disabled={discardConfirmInput.toLowerCase().trim() !== 'descartar'}
                            onClick={() => {
                              _onDiscard(item.item_id);
                              setConfirmDiscardId(null);
                              setDiscardConfirmInput('');
                            }}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold disabled:opacity-40 text-[11px]"
                          >
                            Confirmar
                          </button>
                          <button
                            onClick={() => {
                              setConfirmDiscardId(null);
                              setDiscardConfirmInput('');
                            }}
                            className="px-3 py-1 bg-black/10 dark:bg-white/10 hover:bg-black/20 text-black/70 dark:text-white/70 text-[11px]"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Confirmación Reactivación Inline */}
                    {confirmReactivateId === item.item_id && (
                      <div className="mt-3 p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 space-y-2 w-full text-left">
                        <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-400">¿Reactivar este ítem? Volverá a aparecer en el listado activo y será visible para los clientes. Escribe "restaurar" para confirmar:</p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={reactivateConfirmInput}
                            onChange={(e) => setReactivateConfirmInput(e.target.value)}
                            placeholder="restaurar"
                            autoComplete="off"
                            className="px-2 py-1 bg-white dark:bg-zinc-900 border border-emerald-300 dark:border-emerald-700 outline-none text-[11px] flex-1 text-black dark:text-white"
                          />
                          <button
                            disabled={reactivateConfirmInput.toLowerCase().trim() !== 'restaurar'}
                            onClick={() => {
                              onReactivate?.(item.item_id);
                              setConfirmReactivateId(null);
                              setReactivateConfirmInput('');
                            }}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-40 text-[11px]"
                          >
                            Confirmar
                          </button>
                          <button
                            onClick={() => {
                              setConfirmReactivateId(null);
                              setReactivateConfirmInput('');
                            }}
                            className="px-3 py-1 bg-black/10 dark:bg-white/10 hover:bg-black/20 text-black/70 dark:text-white/70 text-[11px]"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Contenido de caza (Colapsable y 2 columnas) */}
                    {isExpanded && (
                      <div className="mt-4 flex-1 flex flex-row min-h-0 animate-in fade-in slide-in-from-top-2 duration-300 border-t border-black/10 dark:border-white/10 pt-4 h-full">
                        <ItemContentBlock
                          item={item}
                          isHunting={huntingItemId === item.item_id}
                          onAiAssist={(req) => onAiAssist(item.item_id, req)}
                          onApplyAssist={(final, intent) => onApplyAssist(item.item_id, final, intent)}
                          assistingItemId={assistingItemId}
                          huntStatusMessage={huntStatusMessage}
                          isSealed={isSealed}
                          onHunt={() => onHunt(item.item_id)}
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

// ─── Complementary Suggestion Card ───────────────────────────────────────────
interface ComplementarySuggestionCardProps {
  suggestion: { title: string; rationale: string; section: string; source?: Record<string, unknown> };
  onConfirm: (title: string, section: string, rationale: string) => Promise<void>;
  onIgnore: () => void;
}

const ComplementarySuggestionCard: React.FC<ComplementarySuggestionCardProps> = ({
  suggestion, onConfirm, onIgnore
}) => {
  const [confirmInput, setConfirmInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const source = suggestion.source as ItemizedSource | undefined;

  return (
    <div className="p-3 bg-white dark:bg-black border border-violet-500/20 hover:border-violet-500/40 transition-colors space-y-3 flex flex-col justify-between">
      <div className="space-y-2">
        <div className="flex justify-between items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-black text-black/90 dark:text-white/90">{suggestion.title}</p>
            <p className="text-[10px] text-black/50 dark:text-white/50 mt-0.5 leading-relaxed">{suggestion.rationale}</p>
            <p className="text-[8px] font-mono text-violet-500 uppercase tracking-widest mt-1">Sugerido por IA • Sección: {suggestion.section}</p>
          </div>
          <button
            onClick={onIgnore}
            title="Ignorar sugerencia"
            className="text-black/30 hover:text-red-500 transition-colors material-symbols-outlined !text-[16px] shrink-0"
          >
            close
          </button>
        </div>

        {/* Bloque de Fuente real asociada */}
        {source && (source.author || source.url) && (
          <div className="p-2 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 text-[9px] font-sans text-black/60 dark:text-white/60 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold flex items-center gap-1">
                <span className="material-symbols-outlined !text-[10px] text-copper">verified</span>
                {source.author || 'Fuente'} 
                <span className="px-1.5 py-0.5 text-[7px] bg-copper/10 text-copper font-mono uppercase rounded-none ml-1">
                  {source.type || 'EXTERNO'}
                </span>
              </span>
              {source.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-copper hover:underline font-bold flex items-center gap-0.5"
                >
                  Ver enlace
                  <span className="material-symbols-outlined !text-[8px]">open_in_new</span>
                </a>
              )}
            </div>
            {source.description && (
              <p className="text-black/45 dark:text-white/45 italic leading-tight">
                "{source.description}"
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-black/5 dark:border-white/5 justify-between">
        <p className="text-[9px] text-black/70 dark:text-white/70">
          Escriba <span className="font-mono text-copper font-bold">"registrar"</span> para confirmar:
        </p>
        <div className="flex gap-1.5 flex-1 max-w-full sm:max-w-[220px]">
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder="registrar"
            autoComplete="off"
            disabled={isSubmitting}
            className="px-2 h-7 text-[11px] bg-transparent border border-black/10 dark:border-white/15 focus:border-copper outline-none text-black dark:text-white font-sans flex-1 min-w-[60px]"
          />
          <button
            disabled={confirmInput.toLowerCase().trim() !== 'registrar' || isSubmitting}
            onClick={async () => {
              setIsSubmitting(true);
              try {
                await onConfirm(suggestion.title, suggestion.section, suggestion.rationale);
              } finally {
                setIsSubmitting(false);
              }
            }}
            className="px-3 h-7 bg-violet-600 hover:bg-violet-700 text-white font-bold text-[10px] disabled:opacity-40 transition-colors shrink-0"
          >
            {isSubmitting ? 'Registrando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
};



// ─── Pillar Tab Content ───────────────────────────────────────────────────────
interface PillarTabContentProps {
  pillarMeta: typeof PILLARS[number];
  pillar?:      PillarDocument;
  catalogId:   string;
  onItemize:   (pillarId: PillarId) => void;
  onHuntItem:  (pillarId: PillarId, itemId: string, correction?: string) => void;
  onAiAssistItem: (pillarId: PillarId, itemId: string, userRequest: string) => Promise<AiAssistResponse | null>;
  onApplyAssistItem: (pillarId: PillarId, itemId: string, finalContent: string, intent: string) => Promise<void>;
  onCreateItem: (pillarId: PillarId, title: string, section: string, rationale?: string, itemSource?: Record<string, unknown>) => Promise<void>;
  itemizing:    boolean;
  huntingItemId: string | null;
  huntStatusMessage?: string;
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
}

const PillarTabContent: React.FC<PillarTabContentProps> = ({
  pillarMeta, pillar, catalogId, onItemize, onHuntItem, onAiAssistItem, onApplyAssistItem, onCreateItem, itemizing, huntingItemId, huntStatusMessage, assistingItemId, expandedItems, onToggleExpand, onDiscardItem, onReactivateItem,
  isSealed, onUnlockItem, onUpdateApprovalState, onRollbackVersion,
  activeProposalView, onSetProposalView, onDecideProposal, onEvolveItemByType,
  resolveItemSymbology
}) => {
  const { t } = useTranslation();
  const [showArchive, setShowArchive] = useState(false);
  const [newManualItemTitle, setNewManualItemTitle] = useState('');

  // Estados para creación manual con validación de IA
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createFormTitle, setCreateFormTitle] = useState('');
  const [createFormRationale, setCreateFormRationale] = useState('');
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionResult, setCorrectionResult] = useState<{ title: string; rationale: string } | null>(null);
  const [registerConfirmation, setRegisterConfirmation] = useState('');

  // Estados para búsqueda complementaria
  const [isComplementarySearching, setIsComplementarySearching] = useState(false);
  const [suggestionsCollapsed, setSuggestionsCollapsed] = useState(false);

  const handleTriggerComplementarySearch = async () => {
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
          toast.update(toastId, { render: `✓ ${t('vault_dashboard.status.complementary_items_found', 'Sugerencias encontradas.')}`, type: 'success', isLoading: false, autoClose: 3000 });
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
        toast.update(toastId, { render: `✓ ${t('vault_dashboard.status.suggestion_discarded', 'Sugerencia descartada y archivada.')}`, type: 'success', isLoading: false, autoClose: 3000 });
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
  const isStuck = itemizeStatus === 'GENERATING' && startedTime > 0 && (Date.now() - startedTime > 5 * 60 * 1000);
  const isItemizing = (itemizeStatus === 'GENERATING' && !isStuck) || itemizing;
  const completedItems = activeItems.filter(it => it.content_status === 'COMPLETADO').length;
  const totalItems = activeItems.length;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-4 px-5 py-3 border-b border-black/10 dark:border-white/10 bg-white dark:bg-black">
        {/* Izquierda: Nombre del pilar + Campo de creación */}
        <div className="flex flex-wrap items-center gap-4 flex-1 min-w-0">
          <h1 className="text-[13px] font-black uppercase tracking-widest text-black dark:text-white leading-none whitespace-nowrap">
            {t(`vault_dashboard.pillars.${pillarMeta.id}`, pillarMeta.label)}
          </h1>



          {itemizeStatus === 'COMPLETED' && expandedItems.size === 0 && (
            <button
              disabled={isSealed || isComplementarySearching}
              onClick={handleTriggerComplementarySearch}
              title={t('vault_dashboard.actions.search_complementary_items', 'Buscar ítems complementarios con IA')}
              className={`flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 bg-transparent border-0 cursor-pointer ${
                isComplementarySearching
                  ? 'animate-spin text-copper'
                  : 'text-black/40 dark:text-white/40 hover:text-copper'
              }`}
            >
              <span className="material-symbols-outlined !text-[18px]">autorenew</span>
            </button>
          )}

          {/* Campo de creación manual de ítem */}
          {itemizeStatus === 'COMPLETED' && expandedItems.size === 0 && (
            <div className="flex items-center gap-1.5 flex-1 max-w-lg min-w-[200px]">
              <input
                type="text"
                value={newManualItemTitle}
                onChange={(e) => setNewManualItemTitle(e.target.value)}
                placeholder={t('vault_dashboard.labels.new_item_placeholder', 'Nombre del nuevo ítem...')}
                autoComplete="off"
                disabled={isSealed}
                className="w-full h-9 px-3 text-[13px] bg-transparent border border-black/10 dark:border-white/15 focus:border-copper dark:focus:border-copper outline-none transition-all duration-200 font-sans"
              />
              <button
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
                className={`flex items-center justify-center w-9 h-9 shrink-0 transition-colors border border-black/5 dark:border-white/5 bg-transparent ${
                  newManualItemTitle.trim() && !isSealed
                    ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:border-emerald-200 dark:hover:border-emerald-800'
                    : 'text-black/20 dark:text-white/20 cursor-not-allowed'
                }`}
              >
                <span className="material-symbols-outlined !text-[20px]">add_circle</span>
              </button>
            </div>
          )}
        </div>

        {/* Derecha: Progreso + Timestamp */}
        <div className="flex items-center gap-3 shrink-0 ml-auto">
          {hasItems && totalItems > 0 && (
            <div className="flex items-center gap-2" title={t('vault_dashboard.labels.items_progress', { completed: completedItems, total: totalItems })}>
              <div className="w-12 h-1 bg-black/5 dark:bg-white/10 overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${Math.round((completedItems / totalItems) * 100)}%` }} />
              </div>
              <span className="text-[9px] font-black tabular-nums text-emerald-600 dark:text-emerald-400">{completedItems}/{totalItems}</span>
            </div>
          )}
          {pillar?.itemized_at && (
            <span className="text-[9px] text-black/25 dark:text-white/25 font-mono">
              {new Date(pillar.itemized_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
        </div>
      </div>

      {/* Body scrollable */}
      <div className={`flex-1 min-h-0 px-5 py-5 ${expandedItems.size > 0 ? 'overflow-hidden flex flex-col' : 'overflow-y-auto hide-scrollbar'}`}>
        <>
          {/* Sugerencias de ítems complementarios para otros pilares */}
          {(pillar?.suggested_items_pending || []).length > 0 && (
            <div className="mb-6 p-4 border border-violet-500/30 bg-violet-500/5 dark:bg-violet-500/10 space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-black uppercase tracking-wider text-violet-600 dark:text-violet-400 flex items-center gap-1.5 font-sans">
                  <span className="material-symbols-outlined !text-[16px] animate-pulse">autorenew</span>
                  {t('vault_dashboard.suggestions.title', 'Ítems Complementarios Sugeridos por IA')} ({(pillar?.suggested_items_pending || []).length} {t('vault_dashboard.suggestions.pending', 'pendientes')})
                </h3>
                <button
                  onClick={() => setSuggestionsCollapsed(!suggestionsCollapsed)}
                  className="text-[9px] uppercase font-black tracking-wider text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70 flex items-center gap-0.5 transition-colors bg-transparent border-0 cursor-pointer"
                >
                  {suggestionsCollapsed ? t('vault_dashboard.actions.expand', 'Expandir') : t('vault_dashboard.actions.collapse', 'Contraer')}
                  <span className="material-symbols-outlined !text-[14px]">
                    {suggestionsCollapsed ? 'expand_more' : 'expand_less'}
                  </span>
                </button>
              </div>
              
              {!suggestionsCollapsed && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(pillar?.suggested_items_pending || []).map((sug) => (
                    <ComplementarySuggestionCard
                      key={sug.title}
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

          {/* Formulario de creación manual con validación de IA */}
          {showCreateForm && (
            <div className="mb-6 p-4 border border-copper/30 bg-copper/5 dark:bg-copper/10 animate-in fade-in duration-200">
              <h3 className="text-[12px] font-black uppercase tracking-wider text-copper mb-3 font-sans">
                Crear Nuevo Ítem Manualmente
              </h3>
              
              {!correctionResult ? (
                // Paso 1: Ingreso de datos
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-black text-black/50 dark:text-white/50 uppercase tracking-widest mb-1">
                      Título del ítem
                    </label>
                    <input
                      type="text"
                      value={createFormTitle}
                      onChange={(e) => setCreateFormTitle(e.target.value)}
                      placeholder="Escriba el nombre del ítem..."
                      autoComplete="off"
                      className="w-full h-9 px-3 text-[12px] bg-white dark:bg-black border border-black/10 dark:border-white/15 focus:border-copper dark:focus:border-copper outline-none text-black dark:text-white font-sans"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-black/50 dark:text-white/50 uppercase tracking-widest mb-1">
                      Breve descripción de contenidos (Rationale)
                    </label>
                    <textarea
                      value={createFormRationale}
                      onChange={(e) => setCreateFormRationale(e.target.value)}
                      placeholder="Escriba una breve descripción..."
                      autoComplete="off"
                      rows={3}
                      className="w-full p-3 text-[12px] bg-white dark:bg-black border border-black/10 dark:border-white/15 focus:border-copper dark:focus:border-copper outline-none text-black dark:text-white font-sans resize-none"
                    />
                  </div>

                  <div className="flex gap-2 justify-end pt-1">
                    <button
                      onClick={() => {
                        setShowCreateForm(false);
                        setCreateFormTitle('');
                        setCreateFormRationale('');
                      }}
                      className="px-3 py-1.5 text-[11px] font-bold bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-black/70 dark:text-white/70 border-0 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      disabled={isCorrecting || !createFormTitle.trim() || !createFormRationale.trim()}
                      onClick={async () => {
                        setIsCorrecting(true);
                        try {
                          const response = await authFetch(`${API_BASE_URL}/vault/correct-manual-item`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title: createFormTitle, rationale: createFormRationale })
                          });
                          if (response.ok) {
                            const data = await response.json();
                            if (data.corrected) {
                              setCorrectionResult(data.corrected);
                            } else {
                              setCorrectionResult({ title: createFormTitle, rationale: createFormRationale });
                            }
                          } else {
                            setCorrectionResult({ title: createFormTitle, rationale: createFormRationale });
                          }
                        } catch (_err) {
                          setCorrectionResult({ title: createFormTitle, rationale: createFormRationale });
                        } finally {
                          setIsCorrecting(false);
                        }
                      }}
                      className="px-3 py-1.5 text-[11px] font-bold bg-copper hover:bg-copper/80 text-white disabled:opacity-50 border-0 cursor-pointer"
                    >
                      {isCorrecting ? 'Validando con IA...' : 'Validar con IA'}
                    </button>
                  </div>
                </div>
              ) : (
                // Paso 2: Revisión y Confirmación
                <div className="space-y-4">
                  <div className="p-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 space-y-3">
                    <p className="text-[11px] font-bold text-copper uppercase tracking-wider mb-2">Revisión de IA (Original vs Sugerido)</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <p className="text-[9px] font-black text-black/40 dark:text-white/40 uppercase">Título Original</p>
                        <p className="text-[11px] line-through text-black/60 dark:text-white/60">{createFormTitle}</p>
                        <p className="text-[9px] font-black text-emerald-600 uppercase mt-2">Título Sugerido</p>
                        <p className="text-[12px] font-bold text-black dark:text-white">{correctionResult.title}</p>
                      </div>
                      
                      <div className="space-y-1">
                        <p className="text-[9px] font-black text-black/40 dark:text-white/40 uppercase">Descripción Original</p>
                        <p className="text-[11px] line-through text-black/60 dark:text-white/60">{createFormRationale}</p>
                        <p className="text-[9px] font-black text-emerald-600 uppercase mt-2">Descripción Sugerida</p>
                        <p className="text-[11px] text-black/70 dark:text-white/70">{correctionResult.rationale}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-black/80 dark:text-white/80">
                      Escriba <span className="font-mono text-copper">"registrar"</span> para autorizar el ingreso del nuevo ítem:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={registerConfirmation}
                        onChange={(e) => setRegisterConfirmation(e.target.value)}
                        placeholder="registrar"
                        autoComplete="off"
                        className="px-3 h-9 bg-white dark:bg-black border border-black/10 dark:border-white/15 focus:border-copper dark:focus:border-copper outline-none text-[12px] flex-1 text-black dark:text-white font-sans"
                      />
                      <button
                        disabled={registerConfirmation.toLowerCase().trim() !== 'registrar'}
                        onClick={async () => {
                          await onCreateItem(pillarMeta.id, correctionResult.title, 'GENERAL', correctionResult.rationale);
                          setShowCreateForm(false);
                          setCreateFormTitle('');
                          setCreateFormRationale('');
                          setCorrectionResult(null);
                          setRegisterConfirmation('');
                        }}
                        className="px-4 h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-40 text-[11px] transition-colors border-0 cursor-pointer"
                      >
                        Confirmar y Registrar
                      </button>
                      <button
                        onClick={() => {
                          setCorrectionResult(null);
                          setRegisterConfirmation('');
                        }}
                        className="px-4 h-9 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-black/70 dark:text-white/70 text-[11px] transition-colors border-0 cursor-pointer"
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
                catalogId={catalogId}
                onHunt={(itemId, correction) => onHuntItem(pillarMeta.id, itemId, correction)}
                onAiAssist={(itemId, req) => onAiAssistItem(pillarMeta.id, itemId, req)}
                onApplyAssist={(itemId, final, intent) => onApplyAssistItem(pillarMeta.id, itemId, final, intent)}
                isAssistingItemId={assistingItemId}
                huntingItemId={huntingItemId}
                huntStatusMessage={huntStatusMessage}
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
              />
              {(pillar?.classified_sources_itemized?.length ?? 0) > 0 && expandedItems.size === 0 && (
                <ItemizedSourcesBlock sources={pillar!.classified_sources_itemized!} />
              )}
            </div>
          )}
        </>

        {/* ARCHIVO DE ÍTEMS DESCARTADOS */}
        {discardedItems.length > 0 && !isItemizing && expandedItems.size === 0 && (
          <div className="mt-12 pt-8 border-t border-dashed border-black/10 dark:border-white/10">
            <M3Button 
            variant="ghost"
            onClick={() => setShowArchive(!showArchive)}
            icon={showArchive ? 'visibility_off' : 'visibility'}
            className="text-black/30 hover:text-black/60"
          >
            {t('vault_dashboard.discarded_items_archive')} ({discardedItems.length})
          </M3Button>
            
            {showArchive && (
              <div className="mt-4">
                <ItemizedItemsList
                  items={discardedItems}
                  catalogId={catalogId}
                  onHunt={() => {}}
                  onAiAssist={async () => null}
                  onApplyAssist={async () => {}}
                  isAssistingItemId={null}
                  huntingItemId={null}
                  expandedItems={expandedItems}
                  onToggleExpand={onToggleExpand}
                  onDiscard={onDiscardItem}
                  onReactivate={onReactivateItem}
                  isArchive
                  isSealed={isSealed}
                  onUnlockItem={async () => {}}
                  onUpdateApprovalState={async () => {}}
                  onRollbackVersion={async () => {}}
                  pillarId={pillarMeta.id}
                  activeProposalView={null}
                  onSetProposalView={() => {}}
                  onDecideProposal={async () => {}}
                  onEvolveItemByType={async () => {}}
                  resolveItemSymbology={resolveItemSymbology}
                />
              </div>
            )}
          </div>
        )}

        {/* Empty state — IDLE, ERROR, o proceso ATASCADO */}
        {(!hasItems && !isItemizing) && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-6">
            {/* Error message */}
            {pillar?.itemize_status === 'ERROR' && pillar?.itemize_error && (
              <div className="flex flex-col items-center max-w-md px-6 text-center animate-fade-in">
                <span className="material-symbols-outlined !text-xl text-red-500 mb-1 animate-pulse">error</span>
                <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1">
                  {t('vault_dashboard.labels.itemize_error')}
                </p>
                <p className="text-[11px] text-black/50 dark:text-white/50 leading-relaxed font-medium">
                  {pillar.itemize_error}
                </p>
              </div>
            )}

            {/* Aviso de proceso atascado */}
            {isStuck && (
              <div className="flex flex-col items-center max-w-md px-6 text-center animate-fade-in">
                <span className="material-symbols-outlined !text-xl text-amber-500 mb-1">warning</span>
                <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-1">
                  Proceso interrumpido
                </p>
                <p className="text-[11px] text-black/50 dark:text-white/50 leading-relaxed font-medium">
                  El proceso de itemización anterior falló o se interrumpió. Puedes reiniciarlo.
                </p>
              </div>
            )}

            <button
              disabled={isSealed}
              onClick={() => onItemize(pillarMeta.id)}
              className="w-14 h-14 bg-red-600 text-white hover:bg-red-700 active:scale-95 flex items-center justify-center transition-all duration-200 rounded-none shadow-md disabled:opacity-50 disabled:pointer-events-none"
              title={
                isStuck
                  ? 'Proceso interrumpido — Reiniciar itemización'
                  : pillar?.itemize_status === 'ERROR'
                  ? 'Reintentar itemización'
                  : 'Iniciar itemización del pilar'
              }
            >
              <span className="material-symbols-outlined !text-[28px]">
                {isStuck ? 'restart_alt' : 'format_list_bulleted'}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export const KnowledgeVaultDashboard: React.FC<VaultDashboardProps> = ({ assetId, onBack }) => {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PillarId>('ficha_tecnica');
  const [masterSymbols, setMasterSymbols] = useState<Record<string, any>>({});
  const [itemizingPillar, setItemizingPillar] = useState<PillarId | null>(null);
  const [huntingItem, setHuntingItem] = useState<{ pillarId: PillarId; itemId: string } | null>(null);
  const [huntStatusMessage, setHuntStatusMessage] = useState<string>('');
  const [assistingItemId, setAssistingItemId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isPremiumAIOpen, setIsPremiumAIOpen] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
  const [activeProposalView, setActiveProposalView] = useState<{
    itemId: string;
    pillarId: PillarId;
    view: 'nuevos' | 'conflictos';
  } | null>(null);

  useEffect(() => {
    setActiveProposalView(null);
  }, [activeTab]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'master_symbology_vault'), (snap) => {
      const symbolsMap: Record<string, any> = {};
      snap.forEach(doc => {
        symbolsMap[doc.id] = doc.data();
      });
      setMasterSymbols(symbolsMap);
    }, (err) => {
      console.warn('[VaultDashboard] Error listening to master_symbology_vault:', err);
    });
    return () => unsub();
  }, []);

  const resolveItemSymbology = useCallback((symbologyRefs?: string[]) => {
    if (!symbologyRefs || !Array.isArray(symbologyRefs)) return [];
    const make = (catalog?.make || '').toLowerCase().trim();
    
    return symbologyRefs.map(cid => {
      const symData = masterSymbols[cid];
      if (!symData) return null;
      
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
      return null;
    }).filter(Boolean) as Array<{ concept_id: string; url: string; technical_name_es: string }>;
  }, [catalog?.make, masterSymbols]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleItemExpansion = useCallback((itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const ensureVaultInitialized = useCallback(async (globalAssetId: string) => {
    try {
      await authFetch(`${API_BASE_URL}/vault/initialize-vault`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId }),
      });
    } catch (e) { console.warn('[Vault] Initialize silently failed:', e); }
  }, []);

  useEffect(() => {
    if (!assetId) return;
    let unsubGlobal: (() => void) | null = null;
    const unsubTenant = onSnapshot(doc(db, 'tenant_catalogs', assetId), async (tenantSnap) => {
      if (!tenantSnap.exists()) {
        // Fallback: if tenant doc does not exist, assetId is likely a global catalog ID
        if (unsubGlobal) unsubGlobal();
        unsubGlobal = onSnapshot(doc(db, 'global_asset_catalog', assetId), async (globalSnap) => {
          if (!globalSnap.exists()) { setLoading(false); return; }
          const data = globalSnap.data();
          const make = data?.make === 'GENÉRICO' ? '' : (data?.make ?? '');
          const makeModel = [make, data?.model].filter(Boolean).join(' ') || t('vault_dashboard.labels.equipment_default');
          setCatalog({ 
            id: globalSnap.id, 
            makeModel, 
            make: data?.make_oficial || data?.make || '',
            categoria_equipo: data?.categoria_equipo, 
            tipo_equipo: data?.tipo_equipo || '',
            ambiente_operativo: data?.ambiente_operativo || [],
            contexto_operativo: data?.contexto_operativo || [],
            caracteristicas_principales: data?.caracteristicas_principales || [],
            version: data?.version || 'ESTÁNDAR',
            official_url: data?.official_url || '',
            foto_url: data?.foto_url || '',
            is_sealed: data?.is_sealed,
            knowledge_vault: data?.knowledge_vault 
          });
          setLoading(false);
          const hasPillars = PILLARS.some(p => !!(data?.knowledge_vault)?.[p.id]);
          if (!hasPillars) await ensureVaultInitialized(globalSnap.id);
        });
        return;
      }
      
      const tenantData = tenantSnap.data();
      const globalId: string = tenantData.global_asset_id;
      if (!globalId) { setLoading(false); return; }
      if (unsubGlobal) unsubGlobal();
      unsubGlobal = onSnapshot(doc(db, 'global_asset_catalog', globalId), async (globalSnap) => {
        if (!globalSnap.exists()) { setLoading(false); return; }
        const data = globalSnap.data();
        const make = data?.make === 'GENÉRICO' ? '' : (data?.make ?? '');
        const makeModel = [make, data?.model].filter(Boolean).join(' ') || t('vault_dashboard.labels.equipment_default');
        setCatalog({ 
          id: globalSnap.id, 
          makeModel, 
          make: data?.make_oficial || data?.make || '',
          categoria_equipo: data?.categoria_equipo, 
          tipo_equipo: data?.tipo_equipo || '',
          ambiente_operativo: tenantData.ambiente_operativo || data?.ambiente_operativo || [],
          contexto_operativo: tenantData.contexto_operativo || data?.contexto_operativo || [],
          caracteristicas_principales: data?.caracteristicas_principales || [],
          version: tenantData.version || data?.version || 'ESTÁNDAR',
          official_url: tenantData.official_url || data?.official_url || '',
          foto_url: tenantData.foto_url || data?.foto_url || '',
          is_sealed: data?.is_sealed,
          knowledge_vault: data?.knowledge_vault 
        });
        setLoading(false);
        const hasPillars = PILLARS.some(p => !!(data?.knowledge_vault)?.[p.id]);
        if (!hasPillars) await ensureVaultInitialized(globalSnap.id);
      });
    });
    return () => { unsubTenant(); if (unsubGlobal) unsubGlobal(); };
  }, [assetId, ensureVaultInitialized, t]); // Added t to dependencies

  // ID estable derivado del catálogo — evita que los callbacks se recreen en cada snapshot de Firestore
  const catalogId = catalog?.id;

  const handlePhotoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !catalogId) return;

    setIsUploadingPhoto(true);
    const toastId = toast.loading('Optimizando y subiendo foto...');

    try {
      // 1. Compress image client side
      const compressedBlob = await compressImage(file);
      
      // 2. Upload to Firebase Storage
      const storagePath = `catalogs/${catalogId}/photo.jpg`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, compressedBlob);
      const downloadUrl = await getDownloadURL(storageRef);

      // 3. Update Firestore global catalog
      await updateDoc(doc(db, 'global_asset_catalog', catalogId), {
        foto_url: downloadUrl,
        updatedAt: new Date()
      });

        try {
          await updateDoc(doc(db, 'tenant_assets', assetId), {
            foto_url: downloadUrl,
            updatedAt: new Date()
          });
        } catch (_err) {
          // Safe to ignore if assetId is the global asset ID
        }

      toast.update(toastId, {
        render: 'Foto cargada con éxito',
        type: 'success',
        isLoading: false,
        autoClose: 3000
      });
    } catch (error: unknown) {
      console.error('Error uploading photo:', error);
      toast.update(toastId, {
        render: 'Error al subir foto',
        type: 'error',
        isLoading: false,
        autoClose: 3000
      });
    } finally {
      setIsUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [catalogId, assetId]);

  const handlePhotoDelete = useCallback(async () => {
    if (!catalogId) return;
    if (!window.confirm('¿Estás seguro de que deseas eliminar la foto del equipo?')) return;

    setIsUploadingPhoto(true);
    const toastId = toast.loading('Eliminando foto...');

    try {
      // 1. Update Firestore global catalog
      await updateDoc(doc(db, 'global_asset_catalog', catalogId), {
        foto_url: '',
        updatedAt: new Date()
      });
      // 2. Update tenant asset if applicable
      try {
        await updateDoc(doc(db, 'tenant_assets', assetId), {
          foto_url: '',
          updatedAt: new Date()
        });
      } catch (_err) {
        // Ignore
      }

      // 3. Delete from Firebase Storage if exists
      try {
        const storagePath = `catalogs/${catalogId}/photo.jpg`;
        const storageRef = ref(storage, storagePath);
        await deleteObject(storageRef);
      } catch (_e) {
        // Safe to ignore if storage file didn't exist
      }

      toast.update(toastId, {
        render: 'Foto eliminada con éxito',
        type: 'success',
        isLoading: false,
        autoClose: 3000
      });
    } catch (error: unknown) {
      console.error('Error deleting photo:', error);
      toast.update(toastId, {
        render: 'Error al eliminar la foto',
        type: 'error',
        isLoading: false,
        autoClose: 3000
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  }, [catalogId, assetId]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPhoto(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPhoto(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPhoto(false);

    const file = e.dataTransfer.files?.[0];
    if (!file || !catalogId) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Por favor, selecciona un archivo de imagen válido.');
      return;
    }

    setIsUploadingPhoto(true);
    const toastId = toast.loading('Optimizando y subiendo foto...');

    try {
      const compressedBlob = await compressImage(file);
      const storagePath = `catalogs/${catalogId}/photo.jpg`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, compressedBlob);
      const downloadUrl = await getDownloadURL(storageRef);

      await updateDoc(doc(db, 'global_asset_catalog', catalogId), {
        foto_url: downloadUrl,
        updatedAt: new Date()
      });
      try {
        await updateDoc(doc(db, 'tenant_assets', assetId), {
          foto_url: downloadUrl,
          updatedAt: new Date()
        });
      } catch (_err) { /* empty body */ }

      toast.update(toastId, {
        render: 'Foto cargada con éxito',
        type: 'success',
        isLoading: false,
        autoClose: 3000
      });
    } catch (error: unknown) {
      console.error('Error uploading photo:', error);
      toast.update(toastId, {
        render: 'Error al subir foto',
        type: 'error',
        isLoading: false,
        autoClose: 3000
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  }, [catalogId, assetId]);

  const handleItemizePillar = useCallback(async (pillarId: PillarId) => {
    if (!catalogId || itemizingPillar) return;
    setItemizingPillar(pillarId);
    const toastId = toast.loading(t('vault_dashboard.status.itemizing_pillar', { pillar: t(`vault_dashboard.pillars.${pillarId}`) }));
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/itemize-pillar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.update(toastId, { render: `✓ ${t('vault_dashboard.status.items_generated', { count: json.items?.length ?? 0 })}`, type: 'success', isLoading: false, autoClose: 3000 });
      } else if (res.status === 422 && json.error === 'PERFIL_INCOMPLETO') {
        toast.update(toastId, { render: `${t('vault_dashboard.status.incomplete_profile')}: ${(json.missingFields ?? []).join(', ')}`, type: 'warning', isLoading: false, autoClose: 6000 });
      } else if (res.status === 429) {
        toast.update(toastId, { render: t('vault_dashboard.status.ia_limit_reached'), type: 'error', isLoading: false, autoClose: 7000 });
      } else {
        toast.update(toastId, { render: `${t('vault_dashboard.labels.itemize_error')}: ${json.error ?? t('vault_dashboard.status.unknown_failure')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_err: unknown) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error_itemize'), type: 'error', isLoading: false, autoClose: 5000 });
    } finally {
      setItemizingPillar(null);
    }
  }, [catalogId, itemizingPillar, t]); // Added t to dependencies

  const handleHuntItem = useCallback(async (pillarId: PillarId, itemId: string, correction?: string) => {
    if (!catalogId || huntingItem) return;
    setHuntingItem({ pillarId, itemId });
    const toastId = toast.loading(t('vault_dashboard.status.starting_async_research').concat('…'));
    
    const taskId = `${catalogId}_${pillarId}_${itemId}`;
    let unsub: (() => void) | null = null;

    try {
      // 1. Solicitar tarea asíncrona
      const res = await authFetch(`${API_BASE_URL}/vault/hunt-item-async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, humanCorrection: correction }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || t('vault_dashboard.status.could_not_enqueue_task'));
      }

      toast.update(toastId, { render: t('vault_dashboard.status.task_enqueued') });
      setHuntStatusMessage(t('vault_dashboard.status.pending_in_queue').concat('…'));

      // 2. Suscribirse directamente a Firestore para progreso en tiempo real DESPUÉS de disparar la petición exitosamente
      unsub = onSnapshot(doc(db, 'task_status', taskId), (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();

        if (data.status === 'PROCESSING') {
          const msg = data.progress_message || t('vault_dashboard.status.investigating');
          const pct = data.progress_percent ? ` (${data.progress_percent}%)` : '';
          const fullMsg = `${msg}${pct}`;
          
          setHuntStatusMessage(fullMsg);
          toast.update(toastId, { render: `${t('vault_dashboard.labels.progress')}: ${fullMsg}` });
        } 
        else if (data.status === 'COMPLETED') {
          toast.update(toastId, { render: `✓ ${t('vault_dashboard.status.investigation_success')}`, type: 'success', isLoading: false, autoClose: 3000 });
          setHuntingItem(null);
          setHuntStatusMessage('');
          if (unsub) unsub();
          
          // Marcar como expandido para ver resultados
          setExpandedItems(prev => {
            const next = new Set(prev);
            next.add(itemId);
            return next;
          });
        } 
        else if (data.status === 'FAILED' || data.status === 'ERROR') {
          const errMsg = data.error || t('vault_dashboard.status.async_research_failed');
          toast.update(toastId, { render: `Error: ${errMsg}`, type: 'error', isLoading: false, autoClose: 5000 });
          setHuntingItem(null);
          setHuntStatusMessage('');
          if (unsub) unsub();
        }
      }, (error) => {
        console.error('[Vault] Error en listener de progreso:', error);
        toast.update(toastId, { render: t('vault_dashboard.status.connection_error_progress'), type: 'error', isLoading: false, autoClose: 3000 });
        setHuntingItem(null);
        setHuntStatusMessage('');
        if (unsub) unsub();
      });

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.update(toastId, { render: `Error: ${errorMessage}`, type: 'error', isLoading: false, autoClose: 5000 });
      setHuntingItem(null);
      if (unsub) unsub();
    }
  }, [catalogId, huntingItem, t]); // Added t to dependencies

  const handleAiAssistItem = useCallback(async (pillarId: PillarId, itemId: string, userRequest: string): Promise<AiAssistResponse | null> => {
    if (!catalogId || assistingItemId) return null;
    setAssistingItemId(itemId);
    const toastId = toast.loading(t('vault_dashboard.status.ia_assistant_analyzing').concat('…'));
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/ai-assist-item`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, userRequest }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.update(toastId, { render: `✓ ${t('vault_dashboard.status.proposal_generated')}`, type: 'success', isLoading: false, autoClose: 2000 });
        return json as AiAssistResponse;
      } else {
        toast.update(toastId, { render: `Error: ${json.error || t('vault_dashboard.status.assistant_failed')}`, type: 'error', isLoading: false, autoClose: 5000 });
        return null;
      }
    } catch (_err) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error'), type: 'error', isLoading: false, autoClose: 5000 });
      return null;
    } finally { setAssistingItemId(null); }
  }, [catalogId, assistingItemId, t]); // Added t to dependencies

  const handleApplyAssistProposal = useCallback(async (pillarId: PillarId, itemId: string, finalContent: string, intent: string) => {
    if (!catalogId) return;
    const toastId = toast.loading(t('vault_dashboard.status.applying_changes').concat('…'));
    try {
      const userEmail = auth.currentUser?.email || 'revisor.humano@opermaq.cl';
      const res = await authFetch(`${API_BASE_URL}/vault/apply-assist-proposal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, finalContent, userEmail, intent }),
      });
      if (res.ok) {
        toast.update(toastId, { render: `✓ ${t('vault_dashboard.status.changes_persisted_success')}`, type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || t('vault_dashboard.status.could_not_apply')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_err) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [catalogId, t]); // Added t to dependencies

  const handleCreateManualItem = useCallback(async (pillarId: PillarId, title: string, section: string, rationale?: string, itemSource?: Record<string, unknown>) => {
    if (!catalogId) return;

    // 1. Bloqueo de duplicados
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
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, title, section, rationale, itemSource }),
      });
      if (res.ok) {
        toast.update(toastId, { render: `✓ ${t('vault_dashboard.status.item_created_success')}`, type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || t('vault_dashboard.status.failed_to_create')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_err) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [catalogId, catalog?.knowledge_vault, t]); // Added t to dependencies

  const handleDiscardItem = useCallback(async (itemId: string) => {
    if (!catalogId) return;

    // Colapsar el ítem antes de descartar para evitar pantalla en blanco
    setExpandedItems(prev => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });

    const userEmail = auth.currentUser?.email || 'revisor.humano@opermaq.cl';
    const toastId = toast.loading(t('vault_dashboard.status.discarding_item').concat('…'));
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/discard-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId: activeTab, itemId, userEmail }),
      });
      if (res.ok) {
        toast.update(toastId, { render: `✓ ${t('vault_dashboard.status.item_discarded_success')}`, type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error ?? t('vault_dashboard.status.unknown_failure')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error_discard_item'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [catalogId, activeTab, t, setExpandedItems]);

  const handleReactivateItem = useCallback(async (itemId: string) => {
    if (!catalogId) return;

    const toastId = toast.loading(t('vault_dashboard.status.reactivating_item').concat('…'));
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/reactivate-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId: activeTab, itemId }),
      });
      if (res.ok) {
        toast.update(toastId, { render: `✓ ${t('vault_dashboard.status.item_reactivated_success')}`, type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error ?? t('vault_dashboard.status.unknown_failure')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error_reactivate_item'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [catalogId, activeTab, t]); // Added t to dependencies

  const handleDecideProposal = useCallback(async (
    pillarId: PillarId,
    itemId: string,
    proposalId: string,
    decision: 'APROBADO' | 'ELIMINADO'
  ) => {
    if (!catalogId) return;
    const toastId = toast.loading(
      decision === 'APROBADO'
        ? 'Aprobando propuesta…'
        : 'Eliminando propuesta…'
    );
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/decide-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, proposalId, decision }),
      });
      if (res.ok) {
        toast.update(toastId, {
          render: decision === 'APROBADO' ? '✓ Propuesta aprobada.' : '✓ Propuesta eliminada.',
          type: 'success',
          isLoading: false,
          autoClose: 3000
        });
      } else {
        const json = await res.json();
        toast.update(toastId, {
          render: `Error: ${json.error || 'No se pudo registrar la decisión.'}`,
          type: 'error',
          isLoading: false,
          autoClose: 5000
        });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al registrar decisión.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [catalogId]);

  const handleEvolveItemByType = useCallback(async (
    pillarId: PillarId,
    itemId: string,
    filterType: 'NUEVO' | 'CONFLICTO'
  ) => {
    if (!catalogId) return;
    const toastId = toast.loading(`Actualizando ítem con propuestas de tipo ${filterType}…`);
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/evolve-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, filterType }),
      });
      if (res.ok) {
        toast.update(toastId, { render: '✓ Ítem actualizado y redactado por IA.', type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo evolucionar la redacción.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al evolucionar ítem.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [catalogId]);





  const handleUnlockItem = useCallback(async (pillarId: PillarId, itemId: string) => {
    if (!catalogId) return;
    const toastId = toast.loading('Desbloqueando ítem…');
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/unlock-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId }),
      });
      if (res.ok) {
        toast.update(toastId, { render: '✓ Ítem desbloqueado exitosamente.', type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo desbloquear el ítem.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al desbloquear.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [catalogId]);

  const handleUpdateItemApprovalState = useCallback(async (pillarId: PillarId, itemId: string, nuevo_estado: EstadoAprobacion, review_notes?: string) => {
    if (!catalogId) return;
    const toastId = toast.loading('Actualizando estado de aprobación…');
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/update-item-approval-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, nuevo_estado, review_notes }),
      });
      if (res.ok) {
        toast.update(toastId, { render: '✓ Estado de aprobación actualizado.', type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo actualizar el estado de aprobación.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al actualizar estado de aprobación.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [catalogId]);



  const handleRollbackItemVersion = useCallback(async (pillarId: PillarId, itemId: string, timestamp: string) => {
    if (!catalogId) return;
    const toastId = toast.loading('Restaurando versión histórica del ítem…');
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/rollback-item-version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, timestamp }),
      });
      if (res.ok) {
        toast.update(toastId, { render: '✓ Versión restaurada exitosamente.', type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo restaurar la versión.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al restaurar versión.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [catalogId]);

  const activePillarMeta = PILLARS.find(p => p.id === activeTab)!;


  if (loading) return (
    <div className="h-full w-full bg-white dark:bg-black flex items-center justify-center">
      <span className="material-symbols-outlined animate-spin text-copper !text-4xl">progress_activity</span>
    </div>
  );
  if (!catalog) return (
    <div className="h-full w-full bg-white dark:bg-black flex flex-col items-center justify-center gap-4">
      <span className="material-symbols-outlined !text-5xl text-black/20">error</span>
      <p className="text-[13px] text-black/40">{t('vault_dashboard.labels.could_not_load_asset')}</p>
      <M3IconButton icon="arrow_back" onClick={onBack} variant="secondary" />
    </div>
  );

  return (
    <main className="h-full w-full bg-[#fcfcfc] dark:bg-black flex flex-col font-atkinson overflow-hidden">

      {/* ── TOP BAR: Breadcrumb + Título + Acciones ─────────────────────────── */}
      <div className="no-print shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-black/10 dark:border-white/10 bg-white dark:bg-black z-50">
        <div className="flex items-center gap-2 min-w-0">
          <M3IconButton
            icon="arrow_back"
            onClick={onBack}
            variant="ghost"
            className="!w-7 !h-7 !min-w-0 shrink-0 text-black/45 dark:text-white/45 hover:text-copper"
          />
          <div className="flex items-baseline gap-1.5 leading-none flex-wrap min-w-0">
            <span className="text-[14px] font-black uppercase text-black dark:text-white truncate">{catalog.makeModel}</span>
            {catalog.tipo_equipo && (
              <span className="text-[12px] text-black/45 dark:text-white/45 uppercase tracking-wider">/ {catalog.tipo_equipo}</span>
            )}
            <span className="text-[12px] text-black/45 dark:text-white/45 uppercase tracking-wider">
              / {catalog.categoria_equipo || 'MAQUINARIA'}
            </span>
          </div>
          {catalog.is_sealed && (
            <div className="shrink-0 px-1.5 py-0.5 bg-black dark:bg-white text-white dark:text-black flex items-center gap-1 ml-1">
              <span className="material-symbols-outlined !text-[9px]">lock</span>
              <span className="text-[7px] font-black uppercase tracking-[0.2em]">{t('vault_dashboard.labels.sealed')}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── BODY: Columna catálogo + Área de pilares ────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── COLUMNA IZQUIERDA: Datos del catálogo (ancho = foto) ──────────── */}
        <aside className="no-print shrink-0 w-[260px] flex flex-col border-r border-black/10 dark:border-white/10 bg-white dark:bg-black overflow-y-auto hide-scrollbar">

          {/* FOTO */}
          <div className="shrink-0 p-3">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative aspect-[4/3] w-full border rounded-none overflow-hidden transition-all duration-200 group ${
                isDraggingPhoto
                  ? 'border-copper bg-copper/5 shadow-[0_0_12px_rgba(184,115,51,0.25)]'
                  : 'border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]'
              }`}
            >
              {catalog.foto_url ? (
                <>
                  <img src={catalog.foto_url} alt={catalog.makeModel} className="w-full h-full object-cover" />
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1 text-white text-[9px] font-black uppercase tracking-widest cursor-pointer transition-all duration-200 ${
                      isDraggingPhoto ? 'opacity-100 bg-copper/80' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <span className="material-symbols-outlined !text-lg">
                      {isDraggingPhoto ? 'download' : 'photo_camera'}
                    </span>
                    {isDraggingPhoto ? 'SOLTAR' : 'REEMPLAZAR'}
                  </div>
                </>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full h-full flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all border border-dashed ${
                    isDraggingPhoto
                      ? 'border-copper text-copper'
                      : 'border-black/20 dark:border-white/20 text-black/35 dark:text-white/35 hover:text-copper hover:border-copper'
                  }`}
                >
                  {isUploadingPhoto ? (
                    <span className="material-symbols-outlined animate-spin text-copper !text-xl">progress_activity</span>
                  ) : (
                    <>
                      <span className="material-symbols-outlined !text-xl">
                        {isDraggingPhoto ? 'download' : 'photo_camera'}
                      </span>
                      <span className="text-[8px] font-black uppercase tracking-widest text-center px-2">
                        {isDraggingPhoto ? 'SOLTAR FOTO' : 'CARGAR FOTO'}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            {catalog.foto_url && (
              <div className="flex gap-1.5 w-full mt-1.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-1 border border-black/10 dark:border-white/10 hover:border-copper text-black/60 dark:text-white/60 hover:text-copper text-[9px] font-black uppercase tracking-wider transition-all"
                  disabled={isUploadingPhoto}
                >
                  ACTUALIZAR
                </button>
                <button
                  onClick={handlePhotoDelete}
                  className="flex-1 py-1 border border-black/10 dark:border-white/10 hover:border-red-500 text-black/60 dark:text-white/60 hover:text-red-500 text-[9px] font-black uppercase tracking-wider transition-all"
                  disabled={isUploadingPhoto}
                >
                  ELIMINAR
                </button>
              </div>
            )}
            <input type="file" ref={fileInputRef} onChange={handlePhotoUpload} accept="image/*" className="hidden" disabled={isUploadingPhoto} />
          </div>

          {/* CONTENEDOR FLEXIBLE PARA DISTRIBUIR VERTICALMENTE CP/CD/CT */}
          <div className="flex flex-col px-3 py-4 gap-6">

            {/* CARACTERÍSTICAS PRINCIPALES */}
            <div className="flex flex-col">
              <h3 className="text-[11px] font-black uppercase text-black dark:text-white tracking-wider mb-2">
                CARACTERÍSTICAS PRINCIPALES
              </h3>
              <ul className="space-y-1.5 text-[12px] font-normal text-black/65 dark:text-white/65">
                {catalog.caracteristicas_principales?.length ? (
                  catalog.caracteristicas_principales.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 leading-tight">
                      <span className="text-copper shrink-0 mt-px text-[10px]">•</span>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-black/30 dark:text-white/30 italic text-[10px]">Sin especificaciones</li>
                )}
              </ul>
            </div>

            {/* CONDICIONES DE DISEÑO */}
            <div className="flex flex-col">
              <h3 className="text-[11px] font-black uppercase text-black dark:text-white tracking-wider mb-2">
                CONDICIONES DE DISEÑO
              </h3>
              <ul className="space-y-1.5 text-[12px] font-normal text-black/65 dark:text-white/65">
                {catalog.ambiente_operativo?.length ? (
                  catalog.ambiente_operativo.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 leading-tight">
                      <span className="text-copper shrink-0 mt-px text-[10px]">•</span>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-black/30 dark:text-white/30 italic text-[10px]">Diseño estándar</li>
                )}
              </ul>
            </div>

            {/* CONTEXTO Y TRABAJO */}
            <div className="flex flex-col">
              <h3 className="text-[11px] font-black uppercase text-black dark:text-white tracking-wider mb-2">
                CONTEXTO Y TRABAJO
              </h3>
              <ul className="space-y-1.5 text-[12px] font-normal text-black/65 dark:text-white/65">
                {catalog.contexto_operativo?.length ? (
                  catalog.contexto_operativo.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 leading-tight">
                      <span className="text-copper shrink-0 mt-px text-[10px]">•</span>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-black/30 dark:text-white/30 italic text-[10px]">Uso industrial general</li>
                )}
              </ul>
            </div>
            
          </div>
        </aside>

        {/* ── ÁREA DERECHA: Pilares + Items ─────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

          {/* Tabs de pilares */}
          {expandedItems.size === 0 && (
            <nav className="shrink-0 flex border-b border-black/10 dark:border-white/10 bg-white dark:bg-black overflow-x-auto hide-scrollbar">
              {PILLARS.map(p => {
                const pillar = catalog.knowledge_vault?.[p.id];
                const isActive = activeTab === p.id;
                const hasItems = !!(pillar?.items?.length);
                const allCazados = hasItems && (pillar?.items ?? []).every(it => it.content_status === 'COMPLETADO');
                const isCompleted = pillar?.itemize_status === 'COMPLETED' && allCazados;
                return (
                  <M3Button
                    key={p.id}
                    onClick={() => setActiveTab(p.id)}
                    disabled={expandedItems.size > 0 && !isActive}
                    variant="ghost"
                    className={`relative flex-1 min-w-0 flex items-center justify-center !px-2 !py-4 !h-auto transition-all border-b-2 !rounded-none ${
                      expandedItems.size > 0 && !isActive ? 'opacity-30 pointer-events-none ' : ''
                    }${
                      isActive
                        ? `!border-current ${p.color} bg-black/[0.02] dark:bg-white/[0.02]`
                        : '!border-transparent text-black/35 dark:text-white/35 hover:text-black/60 dark:hover:text-white/60 hover:bg-black/[0.01]'
                    }`}
                    title={t(`vault_dashboard.pillars.${p.id}`, p.label)}
                  >
                    <span className={`material-symbols-outlined !text-[20px] ${isActive ? p.color : ''}`}>{p.icon}</span>
                    {isCompleted && <span className="w-1.5 h-1.5 rounded-none bg-emerald-500 shrink-0 ml-1.5" />}
                    {hasItems && !isCompleted && <span className="w-1.5 h-1.5 rounded-none bg-violet-400 shrink-0 ml-1.5" />}
                  </M3Button>
                );
              })}
            </nav>
          )}

          {/* Tab Content: Listado de ítems */}
          <section className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <PillarTabContent
              key={activeTab}
              pillarMeta={activePillarMeta}
              pillar={catalog.knowledge_vault?.[activeTab]}
              catalogId={catalog.id}
              onItemize={handleItemizePillar}
              onHuntItem={handleHuntItem}
              onAiAssistItem={handleAiAssistItem}
              onApplyAssistItem={handleApplyAssistProposal}
              onCreateItem={handleCreateManualItem}
              itemizing={itemizingPillar === activeTab}
              huntingItemId={huntingItem?.pillarId === activeTab ? huntingItem.itemId : null}
              huntStatusMessage={huntStatusMessage}
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
            />
          </section>
        </div>
      </div>

      {/* ── Modal: Premium AI ─────────────────────────────────────────────── */}
      <PremiumAIPanel
        globalAssetId={catalog.id}
        makeModel={catalog.makeModel}
        category={catalog.categoria_equipo || ''}
        isOpen={isPremiumAIOpen}
        onClose={() => setIsPremiumAIOpen(false)}
      />
    </main>
  );
}


export default KnowledgeVaultDashboard;

