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

const PILLAR_DEFAULT_BLUEPRINT: Record<
  PillarId,
  { kind: string; labelEs: string }
> = {
  ficha_tecnica: {
    kind: 'DIMENSION_SPEC_SHEET',
    labelEs: 'GENERAR PLANO DIMENSIONAL ACOTADO (SI)',
  },
  manual_operaciones: {
    kind: 'PERFORMANCE_CURVE',
    labelEs: 'GENERAR CURVA OPERACIONAL PARAMÉTRICA',
  },
  pauta_mantencion: {
    kind: 'PM_HOROMETER_TIMELINE',
    labelEs: 'GENERAR MATRIZ HOROMÉTRICA PM',
  },
  matriz_riesgos: {
    kind: 'ISO_SAFETY_PLAQUE',
    labelEs: 'GENERAR PLACA NORMATIVA ISO 3864 / 7010',
  },
  checklist_pre_op: {
    kind: 'WALKAROUND_LOTO_MAP',
    labelEs: 'GENERAR MAPA 360° PRE-OP Y LOTO',
  },
};

function resolveMediaSrc(storageUrl: string): string {
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

export const ItemFiguresAndAdvisoriesBlock: React.FC<ItemFiguresAndAdvisoriesBlockProps> = ({
  catalogId,
  pillarId,
  itemId,
  canCurateAI = true,
  isHumanLocked = false,
  isSealed = false,
  figures = [],
  advisories = [],
}) => {
  const [generatingBlueprint, setGeneratingBlueprint] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const pendingAdvisories = advisories.filter((a) => !a.acknowledged);
  const bpSpec = PILLAR_DEFAULT_BLUEPRINT[pillarId];

  const handleGenerateBlueprint = async () => {
    if (!canCurateAI || isSealed || isHumanLocked || generatingBlueprint) return;
    setGeneratingBlueprint(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/generate-blueprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalAssetId: catalogId,
          kind: bpSpec.kind,
          targetPillarId: pillarId,
          targetItemId: itemId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Error generando esquema vectorial.');
      }
      toast.success('Esquema vectorial paramétrico generado y anclado al capítulo.');
    } catch (err: any) {
      toast.error(err?.message || 'Error al generar esquema vectorial.');
    } finally {
      setGeneratingBlueprint(false);
    }
  };

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
                <p className="text-[13px] text-[#0F172A] dark:text-[#F3F4F6] mt-[8px] whitespace-pre-wrap select-text">
                  {adv.proposed_value}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. Galería de Figuras Técnicas CAS y Esquemas Vectoriales Paramétricos */}
      <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] rounded-none shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-[13px] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6]">
              APOYO GRÁFICO, DIAGRAMAS RECORTADOS Y ESQUEMAS VECTORIALES (<span className="font-mono tabular-nums">{figures.length}</span>)
            </h4>
            <p className="text-[13px] text-[#475569] dark:text-[#8A93A6]">
              Activos optimizados en almacenamiento CAS deduplicado (SHA-256 / pHash).
            </p>
          </div>

          {canCurateAI && !isHumanLocked && !isSealed && (
            <button
              type="button"
              disabled={generatingBlueprint}
              onClick={handleGenerateBlueprint}
              className="px-[13px] py-[8px] border border-[#C68346] bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] hover:bg-[#C68346] hover:text-[#FFFFFF] text-[11px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
            >
              {generatingBlueprint ? 'PROCESANDO ESQUEMA SVG...' : bpSpec.labelEs}
            </button>
          )}
        </div>

        {figures.length === 0 ? (
          <p className="text-[13px] text-[#5A6072] dark:text-[#5A6072] mt-[13px]">
            [Información técnica no declarada en ficha]
          </p>
        ) : (
          <div className="flex flex-col gap-[21px] mt-[21px]">
            {figures.map((fig) => (
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
                      draggable={false}
                      onContextMenu={(e) => e.preventDefault()}
                      style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                      className="max-h-[360px] w-auto object-contain select-none pointer-events-none"
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

                    <div className="pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] font-mono tabular-nums text-[11px] text-[#5A6072] select-text">
                      SHA-256: {fig.sha256.slice(0, 16)}…
                    </div>
                  </figcaption>
                </div>
              </figure>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

