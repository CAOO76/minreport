/**
 * ItemFiguresAndAdvisoriesBlock — Galería CAS de Figuras Técnicas Reales y Avisos sobre Ítems con Candado Humano
 */
import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import type {
  ExtractedFigureRef,
  LockedItemAdvisory,
  PillarId,
} from '../types/vault';

interface ItemFiguresAndAdvisoriesBlockProps {
  catalogId: string;
  pillarId: PillarId;
  itemId: string;
  canCurateAI?: boolean;
  isHumanLocked?: boolean;
  isSealed?: boolean;
  figures?: ExtractedFigureRef[];
  advisories?: LockedItemAdvisory[];
}

export function resolveMediaSrc(storageUrl: string): string {
  if (!storageUrl) return '';
  if (storageUrl.startsWith('http://') || storageUrl.startsWith('https://') || storageUrl.startsWith('data:')) {
    return storageUrl;
  }
  if (storageUrl.startsWith('/api/')) {
    const cleanBase = API_BASE_URL.replace(/\/api\/?$/, '');
    return `${cleanBase}${storageUrl}`;
  }
  return storageUrl;
}

export function formatByteWeight(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return '[No declarado]';
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Filtra plantillas SVG genéricas obsoletas (`bp_*`, siluetas `DIMENSION_SPEC_SHEET`, `WALKAROUND_LOTO_MAP`, `PM_HOROMETER_TIMELINE`)
 * para mostrar únicamente recortes reales de manuales/web OEM y gráficos estadísticos de datos tabulados verificados.
 */
export function isVerifiedTechnicalFigure(fig?: ExtractedFigureRef | null): fig is ExtractedFigureRef {
  if (!fig || !fig.storage_url) return false;
  const fid = String(fig.figure_id || '');
  if (fid.startsWith('bp_') || fid.startsWith('fig_tbl_')) return false;
  const titleAndCaption = `${fig.title_es || ''} ${fig.caption_es || ''}`;
  if (
    /Plano Dimensional Acotado|Plano Dimensional y Par[aá]metros|Mapa de Inspecci[oó]n 360|Matriz Cronol[oó]gica PM|OpermaqSvgBlueprintEngine|Comparativa\s+de\s+magnitudes|Comparativa\s+Param[eé]trica\s+SI|\b(?:conjunto\s+de\s+filtro|filtro\s+separador\s+de\s+agua|carcasa\s+de\s+(?:filtro|bomba)|con\s+arn[eé]s\s+y\s+herrajes|casquillos\s+met[aá]licos|aisladores)\b/i.test(
      titleAndCaption
    )
  ) {
    return false;
  }
  if (fig.is_parametric_svg && fig.figure_type === 'DIAGRAMA_ACOTADO') {
    return false;
  }
  return true;
}

export const ItemFiguresAndAdvisoriesBlock: React.FC<ItemFiguresAndAdvisoriesBlockProps> = ({
  catalogId,
  pillarId,
  itemId,
  canCurateAI = true,
  figures = [],
  advisories = [],
}) => {
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const pendingAdvisories = advisories.filter((a) => !a.acknowledged);
  const validFigures = (figures || []).filter(isVerifiedTechnicalFigure);

  const handleAcknowledgeAdvisory = async (advisoryId: string) => {
    if (!canCurateAI) return;
    setAcknowledgingId(advisoryId);
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/acknowledge-locked-advisory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalAssetId: catalogId,
          pillarId,
          itemId,
          advisoryId,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'No se pudo acusar recibo.');
      }
      toast.success('Aviso técnico marcado como revisado.');
    } catch (err: any) {
      toast.error(err?.message || 'Error confirmando aviso.');
    } finally {
      setAcknowledgingId(null);
    }
  };

  if (validFigures.length === 0 && (!canCurateAI || pendingAdvisories.length === 0)) {
    return null;
  }

  return (
    <div className="flex flex-col gap-[21px] mt-[21px] select-none font-atkinson">
      {/* 1. Avisos No Destructivos cuando el ítem tiene candado humano activo */}
      {canCurateAI && pendingAdvisories.length > 0 && (
        <section className="border border-[#C68346] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] rounded-none shadow-none">
          <div className="flex items-center justify-between gap-[13px] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#C68346]">
                AVISOS DE ACTUALIZACIÓN OEM SOBRE ÍTEM CON CANDADO HUMANO
              </p>
              <p className="text-[13px] text-[#475569] dark:text-[#8A93A6] mt-[4px]">
                El texto aprobado no fue modificado. Revise la evidencia entrante si desea desbloquear e integrar.
              </p>
            </div>
            <span className="font-mono tabular-nums text-[13px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
              {pendingAdvisories.length}
            </span>
          </div>

          <div className="flex flex-col gap-[13px] mt-[13px]">
            {pendingAdvisories.map((adv) => (
              <div
                key={adv.advisory_id}
                className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] p-[13px] rounded-none shadow-none"
              >
                <div className="flex items-center justify-between gap-[13px]">
                  <span className="font-mono tabular-nums text-[11px] font-bold text-[#00AEEF]">
                    FUENTE: {adv.source_label} · {new Date(adv.detected_at).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    disabled={acknowledgingId === adv.advisory_id}
                    onClick={() => handleAcknowledgeAdvisory(adv.advisory_id)}
                    title="Marcar aviso como revisado"
                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined">done_all</span>
                  </button>
                </div>
                {adv.kind === 'PENDING_FIGURE' && adv.figure?.storage_url ? (
                  <figure className="mt-[8px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] p-[8px] rounded-none shadow-none">
                    <img
                      src={resolveMediaSrc(adv.figure.storage_url)}
                      alt={adv.figure.title_es}
                      loading="lazy"
                      draggable={false}
                      onContextMenu={(e) => e.preventDefault()}
                      className="max-h-[260px] w-auto mx-auto object-contain select-none pointer-events-none"
                      style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                    />
                    <figcaption className="mt-[8px] text-[11px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                      {adv.summary} · ORIG {adv.figure.original_bytes ?? 0} B ➔ CAS {adv.figure.optimized_bytes ?? 0} B (-{adv.figure.savings_pct ?? 0}%)
                    </figcaption>
                  </figure>
                ) : (
                  <p className="text-[13px] text-[#0F172A] dark:text-[#F3F4F6] mt-[8px] whitespace-pre-wrap select-text">
                    {adv.proposed_value}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. Galería de Figuras Técnicas Reales CAS (Recortes PDF OEM, Imágenes Técnicas Web y Gráficos de Tablas) */}
      {validFigures.length > 0 && (
        <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] rounded-none shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-[13px] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6]">
                FIGURAS TÉCNICAS OEM Y GRÁFICOS DE DATOS VERIFICADOS (<span className="font-mono tabular-nums">{validFigures.length}</span>)
              </h4>
              <p className="text-[13px] text-[#475569] dark:text-[#8A93A6]">
                Activos extraídos de documentación técnica y optimizados en almacenamiento CAS deduplicado (SHA-256 / dHash).
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-[21px] mt-[21px]">
            {validFigures.map((fig) => (
              <figure
                key={fig.figure_id}
                className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] p-[21px] rounded-none shadow-none"
              >
                <div className="flex flex-col lg:flex-row gap-[21px]">
                  {/* Área Mayor (61.8%): Visor de figura blindado */}
                  <div className="lg:w-[61.8%] bg-[#FFFFFF] border border-[#E2E8F0] dark:border-[#12151C] p-[13px] flex items-center justify-center">
                    <img
                      src={resolveMediaSrc(fig.storage_url)}
                      alt={fig.title_es}
                      loading="lazy"
                      draggable={false}
                      onContextMenu={(e) => e.preventDefault()}
                      style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                      className="max-h-[380px] w-auto object-contain select-none pointer-events-none"
                    />
                  </div>

                  {/* Área Menor (38.2%): Especificación y tabla de Callouts 1..N */}
                  <figcaption className="lg:w-[38.2%] flex flex-col justify-between gap-[13px]">
                    <div className="flex flex-col gap-[8px]">
                      <span className="font-mono tabular-nums text-[11px] font-bold uppercase text-[#C68346]">
                        {fig.figure_type.replace(/_/g, ' ')}
                        {fig.source_page ? ` · PÁG. ${fig.source_page} OEM` : ''}
                      </span>
                      <h5 className="text-[15px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                        {fig.title_es}
                      </h5>
                      {fig.caption_es && (
                        <p className="text-[13px] text-[#475569] dark:text-[#8A93A6]">
                          {fig.caption_es}
                        </p>
                      )}

                      {fig.callouts && fig.callouts.length > 0 && (
                        <div className="mt-[8px] border border-[#E2E8F0] dark:border-[#12151C]">
                          <table className="w-full border-collapse text-[13px] font-mono tabular-nums">
                            <thead>
                              <tr className="bg-[#F8FAFC] dark:bg-[#07090D] border-b border-[#E2E8F0] dark:border-[#12151C]">
                                <th className="px-[8px] py-[6px] text-left text-[11px] text-[#475569] dark:text-[#8A93A6]">
                                  REF
                                </th>
                                <th className="px-[8px] py-[6px] text-left text-[11px] text-[#475569] dark:text-[#8A93A6]">
                                  COMPONENTE / ESPECIFICACIÓN
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {fig.callouts.map((c, idx) => (
                                <tr
                                  key={idx}
                                  className="border-b border-[#E2E8F0] dark:border-[#12151C] last:border-b-0"
                                >
                                  <td className="px-[8px] py-[6px] font-bold text-[#C68346]">
                                    [{c.callout}]
                                  </td>
                                  <td className="px-[8px] py-[6px] font-atkinson text-[#0F172A] dark:text-[#F3F4F6]">
                                    {c.component_es}
                                    {c.function_or_spec ? ` — ${c.function_or_spec}` : ''}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div className="pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] flex flex-wrap items-center justify-between gap-[8px] font-mono tabular-nums text-[11px] text-[#5A6072] select-text">
                      <span>SHA-256: {fig.sha256.slice(0, 16)}…</span>
                      {typeof fig.original_bytes === 'number' && typeof fig.optimized_bytes === 'number' && (
                        <span className="text-[#00AEEF] font-bold">
                          ORIG: {formatByteWeight(fig.original_bytes)} ➔ CAS: {formatByteWeight(fig.optimized_bytes)} (
                          {typeof fig.savings_pct === 'number'
                            ? `-${fig.savings_pct.toFixed(1)}%`
                            : fig.original_bytes > 0
                              ? `-${Math.max(0, ((fig.original_bytes - fig.optimized_bytes) / fig.original_bytes) * 100).toFixed(1)}%`
                              : '0%'}
                          )
                        </span>
                      )}
                    </div>
                  </figcaption>
                </div>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default ItemFiguresAndAdvisoriesBlock;
