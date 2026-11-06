/**
 * KnowledgeVaultDashboard — v9.0 ITEMIZADO + CAZA POR ÍTEM
 * Flujo: 1º ITEMIZADO por pilar → 2º CAZA on-demand por ítem.
 * Sin generación monolítica de pilares.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { doc, onSnapshot, updateDoc, collection } from 'firebase/firestore';
import { db, auth, API_BASE_URL, storage } from '../firebase/config';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { authFetch } from '../utils/authFetch';
import { toast } from 'react-toastify';
import { M3IconButton } from './M3IconButton';
import { M3Button } from './M3Button';
import { useTranslation } from 'react-i18next';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { ItemFiguresAndAdvisoriesBlock } from './ItemFiguresAndAdvisoriesBlock';
import { OpermaqEngineeringStudioDrawer, type StudioTabId } from './OpermaqEngineeringStudioDrawer';
import type { PillarId, PillarDocument, PillarItem, ItemizedSource, ProposedUpdate, EstadoAprobacion, HistorialAuditoria, ChatMessage } from '../types/vault';

// ─── Types ───────────────────────────────────────────────────────────────────
interface VaultDashboardProps {
  assetId: string;
  onBack: () => void;
  onOpenContributions?: (assetId: string) => void;
}
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
  { id: 'ficha_tecnica',      icon: 'fact_check',  romanNumeral: '0',   label: 'Ficha Técnica',             color: 'text-[#C68346]', accent: '#C68346' },
  { id: 'manual_operaciones', icon: 'settings',    romanNumeral: 'I',   label: 'Manual de Operaciones',     color: 'text-[#C68346]', accent: '#C68346' },
  { id: 'pauta_mantencion',   icon: 'build',       romanNumeral: 'II',  label: 'Pauta de Mantención',       color: 'text-[#C68346]', accent: '#C68346' },
  { id: 'matriz_riesgos',     icon: 'security',    romanNumeral: 'III', label: 'Matriz de Riesgos',         color: 'text-[#C68346]', accent: '#C68346' },
  { id: 'checklist_pre_op',   icon: 'rule',        romanNumeral: 'IV',  label: 'Checklist Pre-Op',          color: 'text-[#C68346]', accent: '#C68346' },
];

const SOURCE_ICONS: Record<string, string> = { OEM: 'precision_manufacturing', EXTERNO: 'school', YOUTUBE: 'smart_display', MANUAL: 'person' };
const SOURCE_COLORS: Record<string, string> = { OEM: 'text-[#00AEEF]', EXTERNO: 'text-[#C68346]', YOUTUBE: 'text-[#C68346]', MANUAL: 'text-[#475569] dark:text-[#8A93A6]' };


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
      result.push(<code key={m.index} className="bg-black/5 dark:bg-white/5 px-1 py-0.5 rounded-none text-[11px] font-mono text-copper">{m[4]}</code>);
    } else if (m[5]) {
      result.push(<em key={m.index} className="italic text-black/80 dark:text-white/80">{m[6]}</em>);
    } else if (m[7]) {
      const conceptId = m[8].trim();
      const sym = resolvedSymbology?.find(s => s.concept_id === conceptId);
      
      if (sym && sym.url) {
        result.push(
          <span 
            key={m.index} 
            className="inline-flex items-center gap-1 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] px-1 py-0.5 rounded-none align-middle mx-0.5 group relative select-none cursor-help"
            title={sym.technical_name_es}
          >
            <img
              src={sym.url}
              alt={sym.technical_name_es}
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
              style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
              className="w-4 h-4 object-contain inline-block bg-[#FFFFFF] select-none pointer-events-none"
            />
            <span className="text-[9px] font-bold text-[#0F172A] dark:text-[#F3F4F6] font-mono">{conceptId}</span>
          </span>
        );
      } else {
        result.push(
          <span 
            key={m.index} 
            className="inline-flex items-center gap-1 bg-[#C68346]/10 border border-[#C68346]/30 text-[#C68346] px-1.5 py-0.5 rounded-none align-middle mx-0.5 select-none cursor-help"
            title="Símbolo pendiente de dibujo o confirmación en el catálogo global"
          >
            <span className="material-symbols-outlined !text-[11px]">warning</span>
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

  const interactiveCls = onFragmentClick ? 'hover:bg-[#C68346]/10 cursor-pointer' : '';
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]; const line = raw.trim();
    if (!line) { i++; continue; }
    if (line.startsWith('#### ')) { 
      const currentRaw = raw;
      nodes.push(<h4 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className={`text-[12px] font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] mt-5 mb-2 ${interactiveCls} rounded-none px-1 -mx-1 transition-colors duration-150`}>{parseInlineStyles(line.replace('#### ', ''), activeHighlightText, resolvedSymbology)}</h4>); 
      i++; 
      continue; 
    }
    if (line.startsWith('### ')) { 
      const currentRaw = raw;
      nodes.push(<h3 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className={`text-[13px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6] mt-6 mb-2 border-b border-[#E2E8F0] dark:border-[#12151C] pb-1 ${interactiveCls} rounded-none px-1 -mx-1 transition-colors duration-150`}>{parseInlineStyles(line.replace('### ', ''), activeHighlightText, resolvedSymbology)}</h3>); 
      i++; 
      continue; 
    }
    if (line.startsWith('## ')) { 
      const currentRaw = raw;
      nodes.push(<h2 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className={`text-[15px] font-bold uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6] mt-8 mb-3 ${interactiveCls} rounded-none px-1 -mx-1 transition-colors duration-150`}>{parseInlineStyles(line.replace('## ', ''), activeHighlightText, resolvedSymbology)}</h2>); 
      i++; 
      continue; 
    }
    if (line.startsWith('# ')) { 
      const currentRaw = raw;
      nodes.push(<h1 key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className={`text-[17px] font-bold uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6] mt-8 mb-4 ${interactiveCls} rounded-none px-1 -mx-1 transition-colors duration-150`}>{parseInlineStyles(line.replace('# ', ''), activeHighlightText, resolvedSymbology)}</h1>); 
      i++; 
      continue; 
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: { rawText: string; cleanText: string }[] = [];
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        items.push({ rawText: lines[i], cleanText: lines[i].trim().replace(/^[-*] /, '') }); i++;
      }
      nodes.push(<ul key={`ul-${i}`} className="list-none space-y-1.5 my-3 ml-0">{items.map((it, idx) => <li key={idx} onClick={(e) => onFragmentClick?.(it.rawText, e)} className={`flex items-start gap-2 text-[13px] text-[#0F172A] dark:text-[#F3F4F6] ${interactiveCls} rounded-none px-1 -mx-1 transition-colors duration-150`}><span className="text-[#C68346] mt-0.5 shrink-0">›</span><span>{parseInlineStyles(it.cleanText, activeHighlightText, resolvedSymbology)}</span></li>)}</ul>);
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
        nodes.push(<div key={`tbl-${i}`} className="overflow-x-auto my-4"><table className="w-full text-[12px] border-collapse tabular-nums font-mono"><thead><tr>{header.map((h, ci) => <th key={ci} className="text-left px-3 py-2 bg-[#F8FAFC] dark:bg-[#07090D] font-bold uppercase tracking-wider text-[#475569] dark:text-[#8A93A6] border border-[#E2E8F0] dark:border-[#12151C]">{parseInlineStyles(h, activeHighlightText, resolvedSymbology)}</th>)}</tr></thead><tbody>{body.map((row, ri) => <tr key={ri} className="border-b border-[#E2E8F0] dark:border-[#12151C]">{row.map((cell, ci) => <td key={ci} onClick={(e) => onFragmentClick?.(cell, e)} className={`px-3 py-2 text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] ${interactiveCls} transition-colors duration-150`}>{parseInlineStyles(cell, activeHighlightText, resolvedSymbology)}</td>)}</tr>)}</tbody></table></div>);
      }
      continue;
    }
    const currentRaw = raw;
    nodes.push(<p key={i} onClick={(e) => onFragmentClick?.(currentRaw, e)} className={`text-[13px] text-[#0F172A] dark:text-[#F3F4F6] leading-relaxed mb-2 ${interactiveCls} rounded-none px-1 -mx-1 transition-colors duration-150`}>{parseInlineStyles(raw, activeHighlightText, resolvedSymbology)}</p>);
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
  canCurateAI: boolean;
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
  onOpenStudio?: (tab: StudioTabId) => void;
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
    if (!proposal.proposal_id || !confirmingDecision || confirmText.trim() !== 'ACTUALIZAR') return;
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
      className={`border p-4 transition-colors duration-300 font-atkinson rounded-none shadow-none ${
        isApproved
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
            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#00AEEF] border border-[#00AEEF]/30 px-2 py-0.5 rounded-none">
              Aprobado
            </span>
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
                title="Aprobar hallazgo"
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
            Escribe <span className="font-mono text-[#C68346] font-bold">"ACTUALIZAR"</span> para confirmar ({confirmingDecision}):
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
              disabled={confirmText.trim() !== 'ACTUALIZAR' || isSubmitting}
              onClick={handleConfirm}
              className="px-3 py-1 font-bold text-[10px] text-[#FFFFFF] bg-[#C68346] hover:bg-[#b07239] disabled:opacity-40 rounded-none shadow-none transition-colors border-0 cursor-pointer"
            >
              {isSubmitting ? 'Procesando...' : 'Confirmar'}
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
  const [evolveInput, setEvolveInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firstValidUrl = item.item_sources?.find(s => s.url && s.url !== '#')?.url;

  const proposals = (item.pending_conflicts ?? []).filter(
    p => p.estado_fusion === 'NUEVO' && p.human_decision !== 'ELIMINADO'
  );

  const approvedCount = proposals.filter(p => p.human_decision === 'APROBADO').length;
  const pendingCount = proposals.filter(p => p.human_decision === null).length;

  const handleEvolve = async () => {
    if (evolveInput.trim() !== 'ACTUALIZAR') return;
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
              {pendingCount} pendiente(s) · {approvedCount} aprobado(s)
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
        <div className="mt-3 p-3 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#00AEEF] flex flex-col gap-2 shrink-0 rounded-none shadow-none">
          <p className="text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
            Propuestas aprobadas (<span className="font-mono tabular-nums">{approvedCount}</span>). Escribe <span className="font-mono text-[#C68346]">"ACTUALIZAR"</span> para integrar estos cambios:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={evolveInput}
              onChange={(e) => setEvolveInput(e.target.value)}
              placeholder="ACTUALIZAR"
              autoComplete="off"
              spellCheck={false}
              className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[11px] font-mono flex-1 text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
            />
            <button
              type="button"
              disabled={evolveInput.trim() !== 'ACTUALIZAR' || isSealed || isSubmitting}
              onClick={handleEvolve}
              className="px-3 py-1 bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] font-bold text-[10px] disabled:opacity-40 rounded-none shadow-none transition-colors border-0 cursor-pointer"
            >
              {isSubmitting ? 'Actualizando...' : 'Actualizar Ítem'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1 custom-scrollbar">
        {proposals.length === 0 ? (
          <div className="py-12 text-center text-[12px] text-[#5A6072] border border-[#E2E8F0] dark:border-[#12151C]">
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
  const [evolveInput, setEvolveInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firstValidUrl = item.item_sources?.find(s => s.url && s.url !== '#')?.url;

  const proposals = (item.pending_conflicts ?? []).filter(
    p => p.estado_fusion === 'CONFLICTO' && p.human_decision !== 'ELIMINADO'
  );

  const approvedCount = proposals.filter(p => p.human_decision === 'APROBADO').length;
  const pendingCount = proposals.filter(p => p.human_decision === null).length;

  const handleEvolve = async () => {
    if (evolveInput.trim() !== 'ACTUALIZAR') return;
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
              {pendingCount} pendiente(s) · {approvedCount} aprobado(s)
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
        <div className="mt-3 p-3 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#C68346] flex flex-col gap-2 shrink-0 rounded-none shadow-none">
          <p className="text-[11px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
            Propuestas aprobadas (<span className="font-mono tabular-nums">{approvedCount}</span>). Escribe <span className="font-mono text-[#C68346]">"ACTUALIZAR"</span> para resolver los conflictos:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={evolveInput}
              onChange={(e) => setEvolveInput(e.target.value)}
              placeholder="ACTUALIZAR"
              autoComplete="off"
              spellCheck={false}
              className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[11px] font-mono flex-1 text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
            />
            <button
              type="button"
              disabled={evolveInput.trim() !== 'ACTUALIZAR' || isSealed || isSubmitting}
              onClick={handleEvolve}
              className="px-3 py-1 bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] font-bold text-[10px] disabled:opacity-40 rounded-none shadow-none transition-colors border-0 cursor-pointer"
            >
              {isSubmitting ? 'Actualizando...' : 'Actualizar Ítem'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1 custom-scrollbar">
        {proposals.length === 0 ? (
          <div className="py-12 text-center text-[12px] text-[#5A6072] border border-[#E2E8F0] dark:border-[#12151C]">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-2 border-b border-[#E2E8F0] dark:border-[#12151C]">
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-[#5A6072] uppercase tracking-wide">Contenido Actual</span>
                    <div className="p-2 border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] leading-relaxed font-mono break-all max-h-32 overflow-y-auto custom-scrollbar">
                      {prop.valor_actual || '[Información técnica no declarada en ficha]'}
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

function ItemContentBlock({ 
  item, 
  canCurateAI,
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
  onOpenStudio,
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
  const [draftConfirmInput, setDraftConfirmInput] = useState('');
  const [rollbackConfirmTimestamp, setRollbackConfirmTimestamp] = useState<string | null>(null);
  const [rollbackConfirmInput, setRollbackConfirmInput] = useState('');
  const [showHuntConfirm, setShowHuntConfirm] = useState(false);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const chatFeedRef = useRef<HTMLDivElement>(null);

  const isGenerating = item.content_status === 'GENERANDO' || isHunting || isSearching;

  useEffect(() => {
    if (!canCurateAI) return;
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
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
  }, [canCurateAI, catalogId, item.item_id]);

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

  const latestDraftMessage = [...messages].reverse().find(msg => msg.role === 'model' && msg.draftContent);
  const latestDraftContent = latestDraftMessage?.draftContent || null;
  const latestDraftIntent = latestDraftMessage?.intent || 'EDIT_PROPOSAL';

  const latestModelMessage = [...messages].reverse().find(msg => msg.role === 'model');
  const activeHighlightText = latestModelMessage?.highlightText || undefined;

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
        ) : (
          item.content && (
            <div className="space-y-6">
              <>
                <MarkdownRenderer 
                  content={item.content} 
                  activeHighlightText={canCurateAI ? activeHighlightText : undefined}
                  onFragmentClick={canCurateAI ? handleFragmentClick : undefined}
                  resolvedSymbology={resolvedSymbology}
                />
                <ItemFiguresAndAdvisoriesBlock
                  catalogId={catalogId}
                  pillarId={pillarId}
                  itemId={item.item_id}
                  canCurateAI={canCurateAI}
                  isHumanLocked={item.is_human_locked}
                  isSealed={isSealed}
                  figures={item.figures}
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
          )
        )}
      </div>

      {canCurateAI && (
      <div className="w-[260px] shrink-0 flex flex-col justify-between border-l border-[#E2E8F0] dark:border-[#12151C] pl-4 pb-2 h-full min-h-0 overflow-hidden select-none">
        <div className="flex-1 flex flex-col min-h-0 pb-4 gap-4 overflow-hidden">
          <div className="flex items-center justify-between mb-1 shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#475569] dark:text-[#8A93A6]">OPERMAQ IA</span>
            {isGenerating && (
              <span className="material-symbols-outlined !text-[12px] text-[#C68346] animate-spin">progress_activity</span>
            )}
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
                      className={`p-2.5 text-[11px] leading-relaxed font-atkinson rounded-none shadow-none ${
                        isUser 
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

                    {msg.draftContent && (
                      <div className="mt-2 w-full bg-[#FFFFFF] dark:bg-[#07090D] border border-[#00AEEF]/40 p-2.5 flex flex-col gap-2 rounded-none shadow-none shrink-0">
                        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-[#00AEEF]">
                          <span className="material-symbols-outlined !text-[14px]">edit_document</span>
                          Propuesta de Borrador
                        </div>
                        <p className="text-[10px] text-[#475569] dark:text-[#8A93A6] leading-snug">
                          Escribe <span className="font-mono font-bold text-[#C68346]">"ACTUALIZAR"</span> para aplicar estos cambios en el catálogo:
                        </p>
                        <div className="max-h-24 overflow-y-auto border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000] p-1.5 text-[9px] font-mono text-[#0F172A] dark:text-[#F3F4F6] custom-scrollbar">
                          <pre className="whitespace-pre-wrap">{msg.draftContent}</pre>
                        </div>
                        <input
                          type="text"
                          value={draftConfirmInput}
                          onChange={(e) => setDraftConfirmInput(e.target.value)}
                          placeholder="ACTUALIZAR"
                          autoComplete="off"
                          spellCheck={false}
                          className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[10px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none"
                        />
                        <button
                          type="button"
                          disabled={isSealed || isSending || draftConfirmInput.trim() !== 'ACTUALIZAR'}
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
                          className="w-full bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] text-[10px] py-1.5 font-bold uppercase tracking-wider transition-colors disabled:opacity-40 rounded-none shadow-none border-0 cursor-pointer"
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
              <div className="flex items-center gap-1.5 py-1 justify-start text-[10px] text-[#C68346] shrink-0">
                <span className="material-symbols-outlined !text-[14px] animate-spin">progress_activity</span>
                <span>Procesando consulta...</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col shrink-0">
          {selectedFragment && (
            <div className="mb-2 bg-[#C68346]/5 border border-[#C68346]/30 p-2 text-[10px] flex items-start gap-2 shrink-0 rounded-none">
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
            <div className="flex flex-col gap-2 pb-3">
              <div className="bg-[#F8FAFC] dark:bg-[#07090D] rounded-none flex flex-col p-2 border border-[#E2E8F0] dark:border-[#12151C]">
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
                <div className="flex justify-end items-center mt-1 gap-2">
                  <button
                    type="button"
                    onClick={() => toast.info('Función de dictado disponible próximamente.')}
                    title="Dictado por voz"
                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    disabled={isSending || isGenerating || isSealed}
                  >
                    <span className="material-symbols-outlined !text-[20px]">mic</span>
                  </button>
                  <button
                    type="button"
                    disabled={!correctionText.trim() || isSending || isSealed || isGenerating}
                    onClick={handleSendMessage}
                    title="Enviar instrucción"
                    className={`bg-transparent border-0 outline-none p-1 transition-colors cursor-pointer ${
                      correctionText.trim() && !isSending && !isSealed && !isGenerating
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

          {!item.is_human_locked && (
            <div className="flex justify-start py-2 px-2 border-t border-[#E2E8F0] dark:border-[#12151C]">
              <button
                type="button"
                onClick={() => onOpenStudio ? onOpenStudio('INGESTION') : toast.info('Ingesta documental no disponible.')}
                title="Ingesta documental / multimedia (PDF, ETT, esquemas, fotos)"
                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none"
                disabled={isSending || isGenerating || isSealed}
              >
                <span className="material-symbols-outlined !text-[20px]">add_photo_alternate</span>
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-3 border-t border-[#E2E8F0] dark:border-[#12151C]">
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={isSealed || isGenerating || item.is_human_locked}
                onClick={() => setShowHuntConfirm(!showHuntConfirm)}
                className="w-full text-left px-3 py-2 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] transition-colors text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] disabled:opacity-40 disabled:pointer-events-none text-[10px] font-bold uppercase tracking-wider rounded-none cursor-pointer"
              >
                Regenerar con IA
              </button>

              {showHuntConfirm && (
                <div className="p-2 border border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col gap-2 rounded-none">
                  <p className="text-[10px] text-[#C68346] font-bold">Escribe "ACTUALIZAR" para confirmar la regeneración por IA:</p>
                  <input
                    type="text"
                    value={huntConfirmText}
                    onChange={(e) => setHuntConfirmText(e.target.value)}
                    placeholder="ACTUALIZAR"
                    autoComplete="off"
                    spellCheck={false}
                    className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[10px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={huntConfirmText.trim() !== 'ACTUALIZAR' || isGenerating || isSealed}
                      onClick={() => {
                        onHunt();
                        setHuntConfirmText('');
                        setShowHuntConfirm(false);
                      }}
                      className="px-2 py-1 bg-[#C68346] text-[#FFFFFF] font-bold text-[10px] disabled:opacity-40 rounded-none border-0 cursor-pointer"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowHuntConfirm(false)}
                      className="px-2 py-1 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[10px] rounded-none cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                if (activeProposalView?.itemId === item.item_id && activeProposalView.view === 'nuevos') {
                  onSetProposalView(null);
                } else {
                  onSetProposalView({ itemId: item.item_id, pillarId, view: 'nuevos' });
                }
              }}
              className={`w-full flex items-center justify-between px-3 py-2 bg-transparent transition-colors border rounded-none cursor-pointer ${
                activeProposalView?.itemId === item.item_id && activeProposalView.view === 'nuevos'
                  ? 'text-[#00AEEF] font-bold border-[#00AEEF]'
                  : 'text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
              }`}
              title="Nuevo Contenido"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider">Nuevo Contenido</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-none font-mono tabular-nums text-[#00AEEF]">
                {(item.pending_conflicts ?? []).filter(p => p.estado_fusion === 'NUEVO' && p.human_decision !== 'ELIMINADO').length}
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
              className={`w-full flex items-center justify-between px-3 py-2 bg-transparent transition-colors border rounded-none cursor-pointer ${
                activeProposalView?.itemId === item.item_id && activeProposalView.view === 'conflictos'
                  ? 'text-[#C68346] font-bold border-[#C68346]'
                  : 'text-[#475569] dark:text-[#8A93A6] border-[#E2E8F0] dark:border-[#12151C] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
              }`}
              title="Contenido en Conflicto"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider">Contenido en Conflicto</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-none font-mono tabular-nums text-[#C68346]">
                {(item.pending_conflicts ?? []).filter(p => p.estado_fusion === 'CONFLICTO' && p.human_decision !== 'ELIMINADO').length}
              </span>
            </button>
          </div>

          <div className="flex flex-col gap-2 pt-3 mt-2 border-t border-[#E2E8F0] dark:border-[#12151C]">
            <button
              type="button"
              onClick={() => onOpenStudio ? onOpenStudio('MANUAL_PUBLISHER') : toast.info('Exportación PDF no disponible.')}
              className="w-full text-left px-3 py-2 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] transition-colors text-[#475569] dark:text-[#8A93A6] hover:text-[#00AEEF] text-[10px] font-bold uppercase tracking-wider rounded-none cursor-pointer"
            >
              Manuales Ilustrados PDF
            </button>

            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="w-full text-left px-3 py-2 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] transition-colors text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] text-[10px] font-bold uppercase tracking-wider rounded-none cursor-pointer"
            >
              Historial de Cambios
            </button>

          {item.is_human_locked ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={isSealed || isGenerating}
                onClick={() => setShowUnlockConfirm(!showUnlockConfirm)}
                className="w-full text-left px-3 py-2 bg-transparent border border-[#C68346] transition-colors text-[#C68346] hover:bg-[#C68346] hover:text-[#FFFFFF] disabled:opacity-40 disabled:pointer-events-none text-[10px] font-bold uppercase tracking-wider rounded-none cursor-pointer"
              >
                EDITAR ÍTEM
              </button>
              {showUnlockConfirm && (
                <div className="p-2 border border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col gap-2 rounded-none">
                  <p className="text-[10px] text-[#C68346] font-bold">Escribe "ACTUALIZAR" para confirmar el desbloqueo:</p>
                  <input
                    type="text"
                    value={confirmUnlockInput}
                    onChange={(e) => setConfirmUnlockInput(e.target.value)}
                    placeholder="ACTUALIZAR"
                    autoComplete="off"
                    spellCheck={false}
                    className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[10px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={confirmUnlockInput.trim() !== 'ACTUALIZAR'}
                      onClick={async () => {
                        await onUnlockItem();
                        setConfirmUnlockInput('');
                        setShowUnlockConfirm(false);
                      }}
                      className="px-2 py-1 bg-[#C68346] text-[#FFFFFF] font-bold text-[10px] disabled:opacity-40 rounded-none border-0 cursor-pointer"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmUnlockInput('');
                        setShowUnlockConfirm(false);
                      }}
                      className="px-2 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[10px] text-[#475569] dark:text-[#8A93A6] rounded-none cursor-pointer"
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
                type="button"
                disabled={isSealed || isGenerating}
                onClick={() => setShowApprovalConfirm(!showApprovalConfirm)}
                className="w-full text-left px-3 py-2 bg-transparent border border-[#00AEEF] transition-colors text-[#00AEEF] hover:bg-[#00AEEF] hover:text-[#FFFFFF] disabled:opacity-40 disabled:pointer-events-none text-[10px] font-bold uppercase tracking-wider rounded-none cursor-pointer"
              >
                Aprobar Ítem
              </button>
              {showApprovalConfirm && (
                <div className="p-2 border border-[#00AEEF]/40 bg-[#F8FAFC] dark:bg-[#07090D] flex flex-col gap-2 rounded-none">
                  <p className="text-[10px] text-[#00AEEF] font-bold">Escribe "ACTUALIZAR" para confirmar la aprobación:</p>
                  <input
                    type="text"
                    value={confirmApprovalInput}
                    onChange={(e) => setConfirmApprovalInput(e.target.value)}
                    placeholder="ACTUALIZAR"
                    autoComplete="off"
                    spellCheck={false}
                    className="px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#00AEEF] outline-none text-[10px] font-mono text-[#0F172A] dark:text-[#F3F4F6] rounded-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={confirmApprovalInput.trim() !== 'ACTUALIZAR'}
                      onClick={async () => {
                        await onUpdateApprovalState('APROBADO_HUMANO');
                        setConfirmApprovalInput('');
                        setShowApprovalConfirm(false);
                      }}
                      className="px-2 py-1 bg-[#00AEEF] text-[#FFFFFF] font-bold text-[10px] disabled:opacity-40 rounded-none border-0 cursor-pointer"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmApprovalInput('');
                        setShowApprovalConfirm(false);
                      }}
                      className="px-2 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[10px] text-[#475569] dark:text-[#8A93A6] rounded-none cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={isSealed || isGenerating || item.is_human_locked}
            onClick={onDiscard}
            className="w-full text-left px-3 py-2 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#0F172A] dark:hover:border-[#F3F4F6] transition-colors text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] disabled:opacity-40 disabled:pointer-events-none text-[10px] font-bold uppercase tracking-wider rounded-none cursor-pointer"
          >
            Descartar Ítem
          </button>
          </div>

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
  onOpenStudio?: (tab: StudioTabId) => void;
}


function ItemizedItemsList({ 
  items, canCurateAI, onHunt, onAiAssist, onApplyAssist, isAssistingItemId: assistingItemId, huntingItemId, huntStatusMessage,
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
  const hasExpanded = expandedItems.size > 0;

  return (
    <div className={`mt-4 ${isArchive ? 'opacity-60' : ''} ${hasExpanded ? 'flex-1 flex flex-col h-full min-h-0' : 'space-y-5'}`}>
      {sections.map(sec => {
        const secItems = items.filter(it => it.section === sec);
        if (hasExpanded && !secItems.some(it => expandedItems.has(it.item_id))) return null;
        return (
          <div key={sec} className={hasExpanded ? 'flex-1 flex flex-col h-full min-h-0' : ''}>
            {!hasExpanded && <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#475569] dark:text-[#8A93A6] mb-2">{sec}</p>}
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
                    className={`p-3 border transition-colors duration-200 flex flex-col rounded-none shadow-none ${
                      isCompleted ? 'border-[#00AEEF]/30 bg-[#FFFFFF] dark:bg-[#07090D]' :
                      isError     ? 'border-[#C68346]/40 bg-[#F8FAFC] dark:bg-[#07090D]' :
                      isGenerating? 'border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D]' :
                      'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D]'
                    } ${isExpanded ? 'flex-1 h-full min-h-0 border-[#C68346]' : ''}`}
                  >
                    {/* Cabecera del ítem */}
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center gap-1 shrink-0 mt-0.5">
                        <span className="text-[11px] font-mono tabular-nums text-[#5A6072]">{String(item.order).padStart(2,'0')}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className={hasContent && !isArchive ? 'cursor-pointer' : ''} onClick={() => hasContent && !isArchive ? onToggleExpand(item.item_id) : undefined}>
                          <p className="text-[13px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">{item.title}</p>
                          <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] mt-0.5">{item.rationale}</p>
                          {!hasContent && !canCurateAI && (
                            <p className="text-[11px] text-[#5A6072] mt-1">[Información técnica no declarada en ficha]</p>
                          )}
                        </div>
                        {item.created_by ? (
                          <p className="text-[10px] font-mono text-[#C68346] mt-1">{item.created_by}</p>
                        ) : item.standard ? (
                          <p className="text-[10px] font-mono text-[#C68346] mt-1">{item.standard}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {!isArchive && (
                          <div className="flex items-center gap-1">
                            {canCurateAI && item.pending_conflicts && item.pending_conflicts.length > 0 && (
                              <span className="flex items-center justify-center w-8 h-8 shrink-0">
                                <span className="material-symbols-outlined !text-[20px] text-[#00AEEF]" title="Nuevos hallazgos o conflictos pendientes">release_alert</span>
                              </span>
                            )}
                            {item.is_human_locked ? (
                              <span className="flex items-center justify-center w-8 h-8 shrink-0">
                                <span className="material-symbols-outlined !text-[20px] text-[#00AEEF]" title="Verificado">verified</span>
                              </span>
                            ) : canCurateAI && hasContent ? (
                              <span className="flex items-center justify-center w-8 h-8 shrink-0">
                                <span className="material-symbols-outlined !text-[20px] text-[#C68346]" title="Editable">edit_document</span>
                              </span>
                            ) : null}
                          </div>
                        )}

                        {canCurateAI && !isExpanded && (
                          <div className="flex items-center gap-1">
                            {!isArchive ? (
                              !hasContent && (
                                <>
                                  <M3IconButton
                                    icon="travel_explore"
                                    onClick={(e) => { e.stopPropagation(); onHunt(item.item_id); }}
                                    variant="ghost"
                                    title="Cazar contenido"
                                    className={`text-[#C68346] ${isSealed || isGenerating ? 'opacity-20 cursor-not-allowed' : ''}`}
                                    disabled={isSealed || isGenerating || item.is_human_locked}
                                  />
                                  <M3IconButton
                                    icon="text_ad_off"
                                    onClick={(e) => { e.stopPropagation(); if (!isSealed) setConfirmDiscardId(item.item_id); }}
                                    variant="ghost"
                                    title="Descartar ítem"
                                    className={`text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] ${isSealed ? 'opacity-20 cursor-not-allowed' : ''}`}
                                    disabled={isSealed || isGenerating || item.is_human_locked}
                                  />
                                </>
                              )
                            ) : (
                              <M3Button
                                variant="ghost"
                                onClick={() => { if (!isSealed) setConfirmReactivateId(item.item_id); }}
                                className={`text-[10px] text-[#00AEEF] ${isSealed ? 'opacity-40 cursor-not-allowed' : ''}`}
                                disabled={isSealed}
                              >
                                {isSealed ? (t('vault_dashboard.bloqueado') || 'BLOQUEADO').toUpperCase() : (t('vault_dashboard.reactivate') || 'REACTIVAR').toUpperCase()}
                              </M3Button>
                            )}
                          </div>
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
                      <div className="mt-4 flex-1 flex flex-row min-h-0 border-t border-[#E2E8F0] dark:border-[#12151C] pt-4 h-full">
                        <ItemContentBlock
                          item={item}
                          canCurateAI={canCurateAI}
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
    <div className="p-3 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#00AEEF]/30 hover:border-[#00AEEF] transition-colors space-y-3 flex flex-col justify-between rounded-none shadow-none">
      <div className="space-y-2">
        <div className="flex justify-between items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">{suggestion.title}</p>
            <p className="text-[10px] text-[#475569] dark:text-[#8A93A6] mt-0.5 leading-relaxed">{suggestion.rationale}</p>
            <p className="text-[9px] font-mono text-[#00AEEF] uppercase tracking-widest mt-1">Sugerencia IA · Sección: {suggestion.section}</p>
          </div>
          <button
            type="button"
            onClick={onIgnore}
            title="Ignorar sugerencia"
            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined !text-[16px]">close</span>
          </button>
        </div>

        {/* Bloque de Fuente real asociada */}
        {source && (source.author || source.url) && (
          <div className="p-2 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-[10px] font-atkinson text-[#475569] dark:text-[#8A93A6] space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold flex items-center gap-1">
                <span className="material-symbols-outlined !text-[11px] text-[#C68346]">verified</span>
                {source.author || 'Fuente'} 
                <span className="px-1.5 py-0.5 text-[8px] bg-[#C68346]/10 text-[#C68346] font-mono uppercase rounded-none ml-1">
                  {source.type || 'EXTERNO'}
                </span>
              </span>
              {source.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#00AEEF] hover:underline font-bold"
                >
                  Ver enlace
                </a>
              )}
            </div>
            {source.description && (
              <p className="text-[#5A6072] leading-tight">
                "{source.description}"
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-[#E2E8F0] dark:border-[#12151C] justify-between">
        <p className="text-[10px] text-[#475569] dark:text-[#8A93A6]">
          Escriba <span className="font-mono text-[#C68346] font-bold">"ACTUALIZAR"</span> para confirmar:
        </p>
        <div className="flex gap-1.5 flex-1 max-w-full sm:max-w-[220px]">
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder="ACTUALIZAR"
            autoComplete="off"
            spellCheck={false}
            disabled={isSubmitting}
            className="px-2 h-7 text-[11px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none text-[#0F172A] dark:text-[#F3F4F6] font-mono flex-1 min-w-[60px] rounded-none"
          />
          <button
            type="button"
            disabled={confirmInput.trim() !== 'ACTUALIZAR' || isSubmitting}
            onClick={async () => {
              setIsSubmitting(true);
              try {
                await onConfirm(suggestion.title, suggestion.section, suggestion.rationale);
              } finally {
                setIsSubmitting(false);
              }
            }}
            className="px-3 h-7 bg-[#C68346] hover:bg-[#b0743e] text-[#FFFFFF] font-bold text-[10px] disabled:opacity-40 transition-colors shrink-0 rounded-none border-0 cursor-pointer"
          >
            {isSubmitting ? 'Actualizando...' : 'Confirmar'}
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
  canCurateAI: boolean;
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
  onOpenStudio?: (tab: StudioTabId) => void;
}

const PillarTabContent: React.FC<PillarTabContentProps> = ({
  pillarMeta, pillar, catalogId, canCurateAI, onItemize, onHuntItem, onAiAssistItem, onApplyAssistItem, onCreateItem, itemizing, huntingItemId, huntStatusMessage, assistingItemId, expandedItems, onToggleExpand, onDiscardItem, onReactivateItem,
  isSealed, onUnlockItem, onUpdateApprovalState, onRollbackVersion,
  activeProposalView, onSetProposalView, onDecideProposal, onEvolveItemByType,
  resolveItemSymbology, onOpenStudio
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
  const isStuck = itemizeStatus === 'GENERATING' && startedTime > 0 && (Date.now() - startedTime > 5 * 60 * 1000);
  const isItemizing = (itemizeStatus === 'GENERATING' && !isStuck) || itemizing;
  const completedItems = activeItems.filter(it => it.content_status === 'COMPLETADO').length;
  const totalItems = activeItems.length;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-4 px-5 py-3 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
        {/* Izquierda: Nombre del pilar + Controles exclusivos de curación */}
        <div className="flex flex-wrap items-center gap-4 flex-1 min-w-0">
          <h1 className="text-[13px] font-bold uppercase tracking-widest text-[#0F172A] dark:text-[#F3F4F6] leading-none whitespace-nowrap">
            {t(`vault_dashboard.pillars.${pillarMeta.id}`, pillarMeta.label)}
          </h1>

          {canCurateAI && itemizeStatus === 'COMPLETED' && expandedItems.size === 0 && (
            <button
              type="button"
              disabled={isSealed || isComplementarySearching}
              onClick={handleTriggerComplementarySearch}
              title={t('vault_dashboard.actions.search_complementary_items', 'Buscar ítems complementarios con IA')}
              className={`bg-transparent border-0 outline-none p-1 transition-colors cursor-pointer ${
                isComplementarySearching
                  ? 'animate-spin text-[#C68346]'
                  : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined !text-[18px]">autorenew</span>
            </button>
          )}

          {/* Campo de creación manual de ítem (exclusivo curación) */}
          {canCurateAI && itemizeStatus === 'COMPLETED' && expandedItems.size === 0 && (
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
                className={`bg-transparent border-0 outline-none p-1 shrink-0 transition-colors cursor-pointer ${
                  newManualItemTitle.trim() && !isSealed
                    ? 'text-[#C68346] hover:text-[#b07239]'
                    : 'text-[#5A6072] opacity-40 cursor-not-allowed'
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
              <div className="w-12 h-1 bg-[#E2E8F0] dark:bg-[#12151C] overflow-hidden">
                <div className="h-full bg-[#00AEEF] transition-all duration-700" style={{ width: `${Math.round((completedItems / totalItems) * 100)}%` }} />
              </div>
              <span className="text-[10px] font-bold font-mono tabular-nums text-[#00AEEF]">{completedItems}/{totalItems}</span>
            </div>
          )}
          {pillar?.itemized_at && (
            <span className="text-[10px] text-[#5A6072] font-mono tabular-nums">
              {new Date(pillar.itemized_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          )}
        </div>
      </div>

      {/* Body scrollable */}
      <div className={`flex-1 min-h-0 px-5 py-5 ${expandedItems.size > 0 ? 'overflow-hidden flex flex-col' : 'overflow-y-auto hide-scrollbar'}`}>
        <>
          {/* Sugerencias de ítems complementarios (exclusivo curación) */}
          {canCurateAI && (pillar?.suggested_items_pending || []).length > 0 && (
            <div className="mb-6 p-4 border border-[#00AEEF]/30 bg-[#F8FAFC] dark:bg-[#07090D] space-y-4 rounded-none shadow-none">
              <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-[#00AEEF] flex items-center gap-1.5 font-atkinson">
                  {t('vault_dashboard.suggestions.title', 'Ítems Complementarios Sugeridos por IA')} (<span className="font-mono tabular-nums">{(pillar?.suggested_items_pending || []).length}</span> {t('vault_dashboard.suggestions.pending', 'pendientes')})
                </h3>
                <button
                  type="button"
                  onClick={() => setSuggestionsCollapsed(!suggestionsCollapsed)}
                  className="text-[10px] uppercase font-bold tracking-wider text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] transition-colors bg-transparent border-0 cursor-pointer"
                >
                  {suggestionsCollapsed ? t('vault_dashboard.actions.expand', 'Expandir') : t('vault_dashboard.actions.collapse', 'Contraer')}
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
                          await onCreateItem(pillarMeta.id, correctionResult.title, 'GENERAL', correctionResult.rationale);
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
            {canCurateAI ? (
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
  onOpenContributions,
}) => {
  const { t } = useTranslation();
  const { tenantId, capabilities } = useOpermaqContext();
  const canCurateAI = capabilities.canCurateAI;
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PillarId>('ficha_tecnica');
  const [masterSymbols, setMasterSymbols] = useState<Record<string, any>>({});
  const [itemizingPillar, setItemizingPillar] = useState<PillarId | null>(null);
  const [huntingItem, setHuntingItem] = useState<{ pillarId: PillarId; itemId: string } | null>(null);
  const [huntStatusMessage, setHuntStatusMessage] = useState<string>('');
  const [assistingItemId, setAssistingItemId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
  const [showPhotoDeleteConfirm, setShowPhotoDeleteConfirm] = useState(false);
  const [photoDeleteConfirmText, setPhotoDeleteConfirmText] = useState('');
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioTab, setStudioTab] = useState<StudioTabId>(canCurateAI ? 'INGESTION' : 'SYMBOLOGY_PACK');
  const openStudio = useCallback((tab: StudioTabId) => {
    const safeTab: StudioTabId = !canCurateAI && tab === 'INGESTION' ? 'SYMBOLOGY_PACK' : tab;
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
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;
    const unsub = onSnapshot(collection(db, 'master_symbology_vault'), (snap) => {
      const symbolsMap: Record<string, any> = {};
      snap.forEach(docSnap => {
        symbolsMap[docSnap.id] = docSnap.data();
      });
      setMasterSymbols(symbolsMap);
    }, async (err) => {
      console.warn('[VaultDashboard] Error listening to master_symbology_vault:', err);
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
          }
        }
      } catch {
        // Silencioso en respaldo HTTP
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
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
    if (!canCurateAI) return;
    try {
      await authFetch(`${API_BASE_URL}/vault/initialize-vault`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId }),
      });
    } catch (e) { console.warn('[Vault] Initialize silently failed:', e); }
  }, [canCurateAI]);

  useEffect(() => {
    if (!assetId) return;
    let unsubTenant: (() => void) | null = null;
    let unsubLinkedGlobal: (() => void) | null = null;

    const applyCatalogSnapshot = async (
      globalId: string,
      data: Record<string, any> | undefined,
      tenantOverrides?: Record<string, any>
    ) => {
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
        ambiente_operativo: tenantOverrides?.ambiente_operativo || data?.ambiente_operativo || [],
        contexto_operativo: tenantOverrides?.contexto_operativo || data?.contexto_operativo || [],
        caracteristicas_principales: data?.caracteristicas_principales || [],
        version: tenantOverrides?.version || data?.version || 'ESTÁNDAR',
        official_url: tenantOverrides?.official_url || data?.official_url || '',
        foto_url: tenantOverrides?.foto_url || data?.foto_url || '',
        is_sealed: data?.is_sealed,
        knowledge_vault: data?.knowledge_vault,
      });
      setLoading(false);
      const hasPillars = PILLARS.some((p) => !!(data?.knowledge_vault)?.[p.id]);
      if (!hasPillars && canCurateAI) await ensureVaultInitialized(globalId);
    };

    const unsubDirectGlobal = onSnapshot(
      doc(db, 'global_asset_catalog', assetId),
      async (globalSnap) => {
        if (globalSnap.exists()) {
          if (unsubTenant) {
            unsubTenant();
            unsubTenant = null;
          }
          if (unsubLinkedGlobal) {
            unsubLinkedGlobal();
            unsubLinkedGlobal = null;
          }
          await applyCatalogSnapshot(globalSnap.id, globalSnap.data());
          return;
        }

        // Fallback: si assetId corresponde a una unidad física en tenant_assets, resolver su global_asset_id
        if (!unsubTenant) {
          unsubTenant = onSnapshot(
            doc(db, 'tenant_assets', assetId),
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
              if (unsubLinkedGlobal) unsubLinkedGlobal();
              unsubLinkedGlobal = onSnapshot(
                doc(db, 'global_asset_catalog', globalId),
                async (linkedSnap) => {
                  if (!linkedSnap.exists()) {
                    setLoading(false);
                    return;
                  }
                  await applyCatalogSnapshot(linkedSnap.id, linkedSnap.data(), tenantData);
                },
                (err) => {
                  console.warn('[VaultDashboard] Error escuchando global_asset_catalog vinculado:', err);
                  setLoading(false);
                }
              );
            },
            (err) => {
              console.warn('[VaultDashboard] Error escuchando tenant_assets fallback:', err);
              setLoading(false);
            }
          );
        }
      },
      async (err) => {
        console.warn('[VaultDashboard] Error escuchando global_asset_catalog:', err);
        try {
          const res = await authFetch(`${API_BASE_URL}/vault/asset/${encodeURIComponent(assetId)}`);
          if (res.ok) {
            const data = await res.json().catch(() => null);
            if (data && data.exists !== false) {
              await applyCatalogSnapshot(String(data.id || assetId), data);
              return;
            }
          }
        } catch {
          // Respaldo silencioso
        }
        setLoading(false);
      }
    );

    return () => {
      unsubDirectGlobal();
      if (unsubTenant) unsubTenant();
      if (unsubLinkedGlobal) unsubLinkedGlobal();
    };
  }, [assetId, canCurateAI, ensureVaultInitialized, t, tenantId]);

  // ID estable derivado del catálogo — evita que los callbacks se recreen en cada snapshot de Firestore
  const catalogId = catalog?.id;

  const uploadCatalogHeroPhotoCas = useCallback(async (file: File) => {
    if (!canCurateAI || !catalogId) return;
    setIsUploadingPhoto(true);
    const toastId = toast.loading('Digiriendo en WebP HD y registrando en bóveda CAS...');

    try {
      let downloadUrl = '';
      let savingsPct = 0;

      try {
        const { descriptor, digested } = await mediaDigestorClient.digestAndUploadCas(file, {
          profile: 'IMAGE_TECHNICAL_HD',
          scope: 'GLOBAL_OEM',
          filename: file.name,
        });
        downloadUrl = descriptor.downloadUrl;
        savingsPct = Math.round(digested.savingsRatio * 100);
      } catch (_casErr) {
        // Fallback Storage directo en ruta CAS autorizada cas_blobs/global_oem/
        const digested = await mediaDigestorClient.digestFile(file, 'IMAGE_TECHNICAL_HD');
        savingsPct = Math.round(digested.savingsRatio * 100);
        const storagePath = `cas_blobs/global_oem/${digested.sha256}.${digested.extension}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, digested.blob, { contentType: digested.mimeType });
        downloadUrl = await getDownloadURL(storageRef);
      }

      await updateDoc(doc(db, 'global_asset_catalog', catalogId), {
        foto_url: downloadUrl,
        updatedAt: new Date(),
      });

      try {
        await updateDoc(doc(db, 'tenant_assets', assetId), {
          foto_url: downloadUrl,
          updatedAt: new Date(),
        });
      } catch (_err) {
        // Seguro de ignorar cuando assetId es el ID global
      }

      toast.update(toastId, {
        render: `Foto optimizada registrada en CAS (-${savingsPct}% peso)`,
        type: 'success',
        isLoading: false,
        autoClose: 3000,
      });
    } catch (error: unknown) {
      console.error('Error uploading photo:', error);
      toast.update(toastId, {
        render: 'Error al optimizar o subir fotografía',
        type: 'error',
        isLoading: false,
        autoClose: 3000,
      });
    } finally {
      setIsUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [canCurateAI, catalogId, assetId]);

  const handlePhotoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!canCurateAI || !file || !catalogId) return;
    await uploadCatalogHeroPhotoCas(file);
  }, [canCurateAI, catalogId, uploadCatalogHeroPhotoCas]);

  const handlePhotoDelete = useCallback(async () => {
    if (!canCurateAI || !catalogId || photoDeleteConfirmText.trim() !== 'ACTUALIZAR') return;

    setIsUploadingPhoto(true);
    const toastId = toast.loading('Limpiando referencia fotográfica...');

    try {
      await updateDoc(doc(db, 'global_asset_catalog', catalogId), {
        foto_url: '',
        updatedAt: new Date()
      });

      try {
        await updateDoc(doc(db, 'tenant_assets', assetId), {
          foto_url: '',
          updatedAt: new Date()
        });
      } catch (_err) {
        // Seguro de ignorar cuando assetId corresponde al ID global
      }

      setShowPhotoDeleteConfirm(false);
      setPhotoDeleteConfirmText('');

      toast.update(toastId, {
        render: 'Referencia fotográfica eliminada',
        type: 'success',
        isLoading: false,
        autoClose: 3000
      });
    } catch (error: unknown) {
      console.error('Error deleting photo:', error);
      toast.update(toastId, {
        render: 'Error al eliminar la referencia fotográfica',
        type: 'error',
        isLoading: false,
        autoClose: 3000
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  }, [canCurateAI, catalogId, assetId, photoDeleteConfirmText]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!canCurateAI) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPhoto(true);
  }, [canCurateAI]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!canCurateAI) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPhoto(false);
  }, [canCurateAI]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    if (!canCurateAI) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPhoto(false);

    const file = e.dataTransfer.files?.[0];
    if (!file || !catalogId) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Selecciona un archivo de imagen válido.');
      return;
    }

    await uploadCatalogHeroPhotoCas(file);
  }, [canCurateAI, catalogId, uploadCatalogHeroPhotoCas]);

  const handleItemizePillar = useCallback(async (pillarId: PillarId) => {
    if (!canCurateAI || !catalogId || itemizingPillar) return;
    setItemizingPillar(pillarId);
    const toastId = toast.loading(t('vault_dashboard.status.itemizing_pillar', { pillar: t(`vault_dashboard.pillars.${pillarId}`) }));
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/itemize-pillar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.update(toastId, { render: t('vault_dashboard.status.items_generated', { count: json.items?.length ?? 0 }), type: 'success', isLoading: false, autoClose: 3000 });
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
  }, [canCurateAI, catalogId, itemizingPillar, t]);

  const handleHuntItem = useCallback(async (pillarId: PillarId, itemId: string, correction?: string) => {
    if (!canCurateAI || !catalogId || huntingItem) return;
    setHuntingItem({ pillarId, itemId });
    const toastId = toast.loading(t('vault_dashboard.status.starting_async_research').concat('…'));
    
    const taskId = `${catalogId}_${pillarId}_${itemId}`;
    let unsub: (() => void) | null = null;

    try {
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
          toast.update(toastId, { render: t('vault_dashboard.status.investigation_success'), type: 'success', isLoading: false, autoClose: 3000 });
          setHuntingItem(null);
          setHuntStatusMessage('');
          if (unsub) unsub();
          
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
  }, [canCurateAI, catalogId, huntingItem, t]);

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
      const userEmail = auth.currentUser?.email || 'revisor.humano@opermaq.cl';
      const res = await authFetch(`${API_BASE_URL}/vault/apply-assist-proposal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, finalContent, userEmail, intent }),
      });
      if (res.ok) {
        toast.update(toastId, { render: t('vault_dashboard.status.changes_persisted_success'), type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || t('vault_dashboard.status.could_not_apply')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_err) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, t]);

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
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, title, section, rationale, itemSource }),
      });
      if (res.ok) {
        toast.update(toastId, { render: t('vault_dashboard.status.item_created_success'), type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || t('vault_dashboard.status.failed_to_create')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_err) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, catalog?.knowledge_vault, t]);

  const handleDiscardItem = useCallback(async (itemId: string) => {
    if (!canCurateAI || !catalogId) return;

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
        toast.update(toastId, { render: t('vault_dashboard.status.item_discarded_success'), type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error ?? t('vault_dashboard.status.unknown_failure')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error_discard_item'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, activeTab, t, setExpandedItems]);

  const handleReactivateItem = useCallback(async (itemId: string) => {
    if (!canCurateAI || !catalogId) return;

    const toastId = toast.loading(t('vault_dashboard.status.reactivating_item').concat('…'));
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/reactivate-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId: activeTab, itemId }),
      });
      if (res.ok) {
        toast.update(toastId, { render: t('vault_dashboard.status.item_reactivated_success'), type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error ?? t('vault_dashboard.status.unknown_failure')}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: t('vault_dashboard.status.network_error_reactivate_item'), type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId, activeTab, t]);

  const handleDecideProposal = useCallback(async (
    pillarId: PillarId,
    itemId: string,
    proposalId: string,
    decision: 'APROBADO' | 'ELIMINADO'
  ) => {
    if (!canCurateAI || !catalogId) return;
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
          render: decision === 'APROBADO' ? 'Propuesta aprobada.' : 'Propuesta eliminada.',
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
  }, [canCurateAI, catalogId]);

  const handleEvolveItemByType = useCallback(async (
    pillarId: PillarId,
    itemId: string,
    filterType: 'NUEVO' | 'CONFLICTO'
  ) => {
    if (!canCurateAI || !catalogId) return;
    const toastId = toast.loading(`Actualizando ítem con propuestas de tipo ${filterType}…`);
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/evolve-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalAssetId: catalogId, pillarId, itemId, filterType }),
      });
      if (res.ok) {
        toast.update(toastId, { render: 'Ítem actualizado y redactado por IA.', type: 'success', isLoading: false, autoClose: 3000 });
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo evolucionar la redacción.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al evolucionar ítem.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId]);

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
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo desbloquear el ítem.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al desbloquear.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId]);

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
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo actualizar el estado de aprobación.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al actualizar estado de aprobación.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId]);

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
      } else {
        const json = await res.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo restaurar la versión.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (_e) {
      toast.update(toastId, { render: 'Error de red al restaurar versión.', type: 'error', isLoading: false, autoClose: 5000 });
    }
  }, [canCurateAI, catalogId]);

  const activePillarMeta = PILLARS.find(p => p.id === activeTab)!;

  if (loading) return (
    <div className="h-full w-full bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-center">
      <span className="material-symbols-outlined animate-spin text-[#C68346] !text-4xl">progress_activity</span>
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

        {/* Acciones de Estudio de Ingeniería (Ingesta PDF/ETT solo curadores · Simbología Ad-Hoc · Manuales Ilustrados) */}
        <div className="flex items-center gap-[8px] shrink-0">
          {canCurateAI && onOpenContributions && catalogId && (
            <button
              type="button"
              onClick={() => onOpenContributions(catalogId)}
              title={t('opermaq_domains.hitl_queue_title')}
              aria-label={t('opermaq_domains.hitl_queue_title')}
              className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-none shadow-none"
            >
              <span className="material-symbols-outlined text-[20px]">fact_check</span>
            </button>
          )}
          {canCurateAI && (
            <button
              type="button"
              onClick={() => openStudio('INGESTION')}
              className="px-[13px] py-[8px] border border-[#C68346] bg-transparent hover:bg-[#C68346]/10 text-[#C68346] text-[11px] font-bold uppercase tracking-wider font-mono tabular-nums rounded-none shadow-none transition-colors cursor-pointer"
            >
              INGESTA PDF / ETT
            </button>
          )}
          <button
            type="button"
            onClick={() => openStudio('SYMBOLOGY_PACK')}
            className="px-[13px] py-[8px] border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] hover:text-[#00AEEF] text-[11px] font-bold uppercase tracking-wider font-mono tabular-nums rounded-none shadow-none transition-colors cursor-pointer"
          >
            SIMBOLOGÍA AD-HOC
          </button>
          <button
            type="button"
            onClick={() => openStudio('MANUAL_PUBLISHER')}
            className="px-[13px] py-[8px] border border-[#00AEEF] bg-[#00AEEF]/10 hover:bg-[#00AEEF]/20 text-[#00AEEF] text-[11px] font-bold uppercase tracking-wider font-mono tabular-nums rounded-none shadow-none transition-colors cursor-pointer"
          >
            MANUALES ILUSTRADOS
          </button>
        </div>
      </div>

      {/* ── BODY: Columna catálogo + Área de pilares ────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── COLUMNA IZQUIERDA: Datos del catálogo (ancho = foto) ──────────── */}
        <aside className="no-print shrink-0 w-[260px] flex flex-col border-r border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] overflow-y-auto hide-scrollbar">

          {/* FOTO */}
          <div className="shrink-0 p-[13px]">
            <div
              onDragOver={canCurateAI ? handleDragOver : undefined}
              onDragLeave={canCurateAI ? handleDragLeave : undefined}
              onDrop={canCurateAI ? handleDrop : undefined}
              className={`relative aspect-[4/3] w-full border rounded-none shadow-none overflow-hidden transition-all duration-200 group ${
                canCurateAI && isDraggingPhoto
                  ? 'border-[#C68346] bg-[#C68346]/5'
                  : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#000000]'
              }`}
            >
              {catalog.foto_url ? (
                <>
                  <img
                    src={catalog.foto_url}
                    alt={catalog.makeModel}
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                    className="w-full h-full object-cover select-none pointer-events-none"
                  />
                  {canCurateAI && (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className={`absolute inset-0 bg-[#000000]/70 flex flex-col items-center justify-center gap-1 text-[#FFFFFF] text-[9px] font-bold uppercase tracking-widest cursor-pointer transition-all duration-200 ${
                        isDraggingPhoto ? 'opacity-100 bg-[#C68346]/85' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <span className="material-symbols-outlined !text-lg">
                        {isDraggingPhoto ? 'download' : 'photo_camera'}
                      </span>
                      {isDraggingPhoto ? 'SOLTAR' : 'REEMPLAZAR'}
                    </div>
                  )}
                </>
              ) : canCurateAI ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full h-full flex flex-col items-center justify-center gap-[8px] cursor-pointer transition-all border border-dashed rounded-none ${
                    isDraggingPhoto
                      ? 'border-[#C68346] text-[#C68346]'
                      : 'border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] hover:border-[#C68346]'
                  }`}
                >
                  {isUploadingPhoto ? (
                    <span className="material-symbols-outlined animate-spin text-[#C68346] !text-xl">progress_activity</span>
                  ) : (
                    <>
                      <span className="material-symbols-outlined !text-xl">
                        {isDraggingPhoto ? 'download' : 'photo_camera'}
                      </span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-center px-2">
                        {isDraggingPhoto ? 'SOLTAR FOTO' : 'CARGAR FOTO'}
                      </span>
                    </>
                  )}
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center p-[13px] text-center">
                  <span className="text-[11px] text-[#94A3B8] dark:text-[#5A6072]">
                    [Información técnica no declarada en ficha]
                  </span>
                </div>
              )}
            </div>

            {canCurateAI && catalog.foto_url && (
              <div className="flex flex-col gap-[8px] w-full mt-[8px]">
                <div className="flex gap-[8px] w-full">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer"
                    disabled={isUploadingPhoto}
                  >
                    REEMPLAZAR
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPhotoDeleteConfirm((prev) => !prev);
                      setPhotoDeleteConfirmText('');
                    }}
                    className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] text-[#475569] dark:text-[#8A93A6] hover:text-[#C68346] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none transition-colors cursor-pointer"
                    disabled={isUploadingPhoto}
                  >
                    ELIMINAR
                  </button>
                </div>

                {showPhotoDeleteConfirm && (
                  <div className="flex flex-col gap-[8px] p-[8px] border border-[#C68346] bg-[#F8FAFC] dark:bg-[#000000] rounded-none">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#0F172A] dark:text-[#F3F4F6]">
                      Escriba ACTUALIZAR para confirmar baja fotográfica:
                    </span>
                    <input
                      type="text"
                      value={photoDeleteConfirmText}
                      onChange={(e) => setPhotoDeleteConfirmText(e.target.value)}
                      placeholder="ACTUALIZAR"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full px-[8px] py-1 text-[11px] font-mono bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] rounded-none outline-none focus:border-[#C68346] select-text"
                    />
                    <div className="flex gap-[8px]">
                      <button
                        type="button"
                        onClick={handlePhotoDelete}
                        disabled={isUploadingPhoto || photoDeleteConfirmText.trim() !== 'ACTUALIZAR'}
                        className="flex-1 py-1 bg-[#C68346] text-[#000000] disabled:opacity-40 text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer disabled:cursor-not-allowed"
                      >
                        CONFIRMAR
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPhotoDeleteConfirm(false);
                          setPhotoDeleteConfirmText('');
                        }}
                        className="flex-1 py-1 border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-none cursor-pointer"
                      >
                        CANCELAR
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {canCurateAI && (
              <input
                type="file"
                ref={fileInputRef}
                onChange={handlePhotoUpload}
                accept="image/*"
                autoComplete="off"
                spellCheck={false}
                className="hidden"
                disabled={isUploadingPhoto}
              />
            )}
          </div>

          {/* CONTENEDOR FLEXIBLE PARA DISTRIBUIR VERTICALMENTE CP/CD/CT */}
          <div className="flex flex-col px-[13px] py-[21px] gap-[21px]">

            {/* CARACTERÍSTICAS PRINCIPALES */}
            <div className="flex flex-col">
              <h3 className="text-[11px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] tracking-wider mb-[8px]">
                CARACTERÍSTICAS PRINCIPALES
              </h3>
              <ul className="space-y-1.5 text-[12px] font-normal text-[#475569] dark:text-[#8A93A6]">
                {catalog.caracteristicas_principales?.length ? (
                  catalog.caracteristicas_principales.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 leading-tight">
                      <span className="text-[#C68346] shrink-0 mt-px text-[10px]">•</span>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[#94A3B8] dark:text-[#5A6072] text-[11px]">[Información técnica no declarada en ficha]</li>
                )}
              </ul>
            </div>

            {/* CONDICIONES DE DISEÑO */}
            <div className="flex flex-col">
              <h3 className="text-[11px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] tracking-wider mb-[8px]">
                CONDICIONES DE DISEÑO
              </h3>
              <ul className="space-y-1.5 text-[12px] font-normal text-[#475569] dark:text-[#8A93A6]">
                {catalog.ambiente_operativo?.length ? (
                  catalog.ambiente_operativo.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 leading-tight">
                      <span className="text-[#C68346] shrink-0 mt-px text-[10px]">•</span>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[#94A3B8] dark:text-[#5A6072] text-[11px]">[Información técnica no declarada en ficha]</li>
                )}
              </ul>
            </div>

            {/* CONTEXTO Y TRABAJO */}
            <div className="flex flex-col">
              <h3 className="text-[11px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] tracking-wider mb-[8px]">
                CONTEXTO Y TRABAJO
              </h3>
              <ul className="space-y-1.5 text-[12px] font-normal text-[#475569] dark:text-[#8A93A6]">
                {catalog.contexto_operativo?.length ? (
                  catalog.contexto_operativo.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 leading-tight">
                      <span className="text-[#C68346] shrink-0 mt-px text-[10px]">•</span>
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-[#94A3B8] dark:text-[#5A6072] text-[11px]">[Información técnica no declarada en ficha]</li>
                )}
              </ul>
            </div>
            
          </div>
        </aside>

        {/* ── ÁREA DERECHA: Pilares + Items ─────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">

          {/* Tabs de pilares */}
          {expandedItems.size === 0 && (
            <nav className="shrink-0 flex border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] overflow-x-auto hide-scrollbar">
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
                        ? `!border-current ${p.color} bg-[#F8FAFC] dark:bg-[#07090D]`
                        : '!border-transparent text-[#94A3B8] dark:text-[#5A6072] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                    }`}
                    title={t(`vault_dashboard.pillars.${p.id}`, p.label)}
                  >
                    <span className={`material-symbols-outlined !text-[20px] ${isActive ? p.color : ''}`}>{p.icon}</span>
                    {isCompleted && <span className="w-1.5 h-1.5 rounded-none bg-[#00AEEF] shrink-0 ml-1.5" />}
                    {hasItems && !isCompleted && <span className="w-1.5 h-1.5 rounded-none bg-[#C68346] shrink-0 ml-1.5" />}
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
              canCurateAI={canCurateAI}
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
              onOpenStudio={openStudio}
            />
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

