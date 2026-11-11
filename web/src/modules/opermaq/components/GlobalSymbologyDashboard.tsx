import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { auth, API_BASE_URL } from '../firebase/config';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { authFetch } from '../utils/authFetch';
import { toast } from 'react-toastify';
import type { MasterSymbologyItem } from '../types/vault';
import { M3CircularProgress } from './M3ProgressIndicator';

type SymbologyItemWithCasTelemetry = MasterSymbologyItem & {
  original_bytes?: number;
  optimized_bytes?: number;
  savings_pct?: number;
  temp_original_bytes?: number;
  temp_optimized_bytes?: number;
  temp_savings_pct?: number;
};

interface PendingManualStandardUpload {
  blob: Blob;
  filename: string;
  previewUrl: string;
  originalBytes: number;
  optimizedBytes: number;
  savingsPct: number;
}

function formatSymbologyBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function renderCasTelemetryBadge(
  orig?: number,
  opt?: number,
  savings?: number
): React.ReactNode {
  if (typeof orig !== 'number' || typeof opt !== 'number' || orig <= 0) return null;
  const pct =
    typeof savings === 'number'
      ? savings
      : Number(Math.max(0, ((orig - opt) / orig) * 100).toFixed(1));
  return (
    <p className="text-[10px] font-mono tabular-nums text-[#00AEEF] mt-[4px] select-text">
      ORIG: {formatSymbologyBytes(orig)} -&gt; CAS: {formatSymbologyBytes(opt)} (-{pct.toFixed(1)}%)
    </p>
  );
}

export const GlobalSymbologyDashboard: React.FC = () => {
  const { t } = useTranslation();
  const { capabilities } = useOpermaqContext();
  const canCurate = capabilities.canCurateAI;
  const [concepts, setConcepts] = useState<SymbologyItemWithCasTelemetry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Estados de carga por concepto
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [drawingId, setDrawingId] = useState<string | null>(null);
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [uploadingStandardId, setUploadingStandardId] = useState<string | null>(null);
  const [generatingVariantId, setGeneratingVariantId] = useState<string | null>(null);
  const [registeringVariantId, setRegisteringVariantId] = useState<string | null>(null);

  // Inputs por concepto para el flujo HITL
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState<Record<string, number>>({});
  const [drawConfirmText, setDrawConfirmText] = useState<Record<string, string>>({});
  const [registerConfirmText, setRegisterConfirmText] = useState<Record<string, string>>({});
  const [pendingManualUploads, setPendingManualUploads] = useState<Record<string, PendingManualStandardUpload>>({});
  const [uploadStandardConfirmText, setUploadStandardConfirmText] = useState<Record<string, string>>({});
  const [openVariantEditorId, setOpenVariantEditorId] = useState<string | null>(null);
  const [variantBrandInput, setVariantBrandInput] = useState<Record<string, string>>({});
  const [variantPreviewUrl, setVariantPreviewUrl] = useState<Record<string, string>>({});
  const [variantConfirmText, setVariantConfirmText] = useState<Record<string, string>>({});

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const fetchConcepts = async () => {
    setLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/symbology/concepts`);
      if (response.ok) {
        const data = await response.json();
        setConcepts(data);
      } else {
        toast.error(t('symbology_dashboard.toast_load_error'));
      }
    } catch {
      toast.error(t('symbology_dashboard.toast_network_load_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConcepts();
    const handleNavigateHome = () => {
      setSearchQuery('');
      setSelectedCandidateIdx({});
      setDrawConfirmText({});
      setRegisterConfirmText({});
      setUploadStandardConfirmText({});
      setVariantConfirmText({});
    };
    window.addEventListener('opermaq:navigate-home', handleNavigateHome);
    return () => window.removeEventListener('opermaq:navigate-home', handleNavigateHome);
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  // Buscar candidatos en Wikimedia
  const handleBuscar = async (conceptId: string, isoReference: string) => {
    setSearchingId(conceptId);
    const toastId = toast.loading(t('symbology_dashboard.toast_searching_wiki', { iso: isoReference }));
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/symbology/search-iso-icon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conceptId, isoReference }),
      });
      if (response.ok) {
        toast.update(toastId, {
          render: t('symbology_dashboard.toast_search_done'),
          type: 'success',
          isLoading: false,
          autoClose: 3500,
        });
        setSelectedCandidateIdx((prev) => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        setDrawConfirmText((prev) => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        await fetchConcepts();
      } else {
        const json = await response.json().catch(() => ({}));
        toast.update(toastId, {
          render: `${t('common.error')}: ${json.error || t('symbology_dashboard.toast_search_failed')}`,
          type: 'error',
          isLoading: false,
          autoClose: 4000,
        });
      }
    } catch {
      toast.update(toastId, {
        render: t('symbology_dashboard.toast_network_search_error'),
        type: 'error',
        isLoading: false,
        autoClose: 5000,
      });
    } finally {
      setSearchingId(null);
    }
  };

  const handleSelectCandidate = (conceptId: string, idx: number) => {
    setSelectedCandidateIdx((prev) => ({ ...prev, [conceptId]: idx }));
  };

  // Autorizar dibujo con IA (DRAW)
  const handleAutorizarDraw = async (conceptId: string, hasCandidates: boolean) => {
    const idx = selectedCandidateIdx[conceptId] ?? -1;
    if (hasCandidates && idx === -1) {
      toast.error(t('symbology_dashboard.toast_select_candidate_first'));
      return;
    }
    const text = (drawConfirmText[conceptId] || '').trim();
    if (text !== 'ACTUALIZAR') {
      toast.error(t('symbology_dashboard.toast_require_actualizar'));
      return;
    }

    setDrawingId(conceptId);
    const toastId = toast.loading(t('symbology_dashboard.toast_drawing_loading'));
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/symbology/draw-standard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conceptId, candidateIndex: idx, confirmWord: 'ACTUALIZAR' }),
      });
      if (response.ok) {
        toast.update(toastId, {
          render: t('symbology_dashboard.toast_draw_done'),
          type: 'success',
          isLoading: false,
          autoClose: 3500,
        });
        setDrawConfirmText((prev) => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        setSelectedCandidateIdx((prev) => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        await fetchConcepts();
      } else {
        const json = await response.json().catch(() => ({}));
        toast.update(toastId, {
          render: `${t('common.error')}: ${json.error || t('symbology_dashboard.toast_draw_failed')}`,
          type: 'error',
          isLoading: false,
          autoClose: 5000,
        });
      }
    } catch {
      toast.update(toastId, {
        render: t('symbology_dashboard.toast_network_draw_error'),
        type: 'error',
        isLoading: false,
        autoClose: 5000,
      });
    } finally {
      setDrawingId(null);
    }
  };

  // Confirmar registro del dibujo estándar
  const handleRegistrar = async (conceptId: string) => {
    const text = (registerConfirmText[conceptId] || '').trim();
    if (text !== 'ACTUALIZAR') {
      toast.error(t('symbology_dashboard.toast_require_actualizar'));
      return;
    }

    setRegisteringId(conceptId);
    const toastId = toast.loading(t('symbology_dashboard.toast_registering_loading'));
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/symbology/register-standard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conceptId,
          confirmWord: 'ACTUALIZAR',
          userEmail: auth.currentUser?.email || 'operador@opermaq.cl',
        }),
      });
      if (response.ok) {
        toast.update(toastId, {
          render: t('symbology_dashboard.toast_register_done'),
          type: 'success',
          isLoading: false,
          autoClose: 3000,
        });
        setRegisterConfirmText((prev) => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        await fetchConcepts();
      } else {
        const json = await response.json().catch(() => ({}));
        toast.update(toastId, {
          render: `${t('common.error')}: ${json.error || t('symbology_dashboard.toast_register_failed')}`,
          type: 'error',
          isLoading: false,
          autoClose: 5000,
        });
      }
    } catch {
      toast.update(toastId, {
        render: t('symbology_dashboard.toast_network_register_error'),
        type: 'error',
        isLoading: false,
        autoClose: 5000,
      });
    } finally {
      setRegisteringId(null);
    }
  };

  // Paso 1: Pre-vuelo CAS local para subida manual de pictograma estándar (`upload-standard`)
  const handleSelectStandardFile = async (conceptId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    e.target.value = '';
    if (!rawFile) return;

    try {
      const isSvg = rawFile.type.includes('svg') || rawFile.name.toLowerCase().endsWith('.svg');
      const digested = await mediaDigestorClient.digestFile(
        rawFile,
        isSvg ? 'VECTOR_SVG_CLEAN' : 'IMAGE_ISO_SYMBOL'
      );
      const previewUrl = URL.createObjectURL(digested.blob);
      const savingsPct =
        rawFile.size > 0
          ? Number(Math.max(0, (1 - digested.optimizedBytes / rawFile.size) * 100).toFixed(1))
          : 0;

      setPendingManualUploads((prev) => {
        if (prev[conceptId]?.previewUrl) {
          URL.revokeObjectURL(prev[conceptId].previewUrl);
        }
        return {
          ...prev,
          [conceptId]: {
            blob: digested.blob,
            filename: rawFile.name,
            previewUrl,
            originalBytes: rawFile.size,
            optimizedBytes: digested.optimizedBytes,
            savingsPct,
          },
        };
      });
      setUploadStandardConfirmText((prev) => ({ ...prev, [conceptId]: '' }));
    } catch {
      toast.error(t('symbology_dashboard.toast_upload_failed'));
    }
  };

  // Paso 2: Confirmar con "ACTUALIZAR" y enviar `/symbology/upload-standard`
  const handleUploadStandard = async (conceptId: string) => {
    const pending = pendingManualUploads[conceptId];
    if (!pending) return;
    const text = (uploadStandardConfirmText[conceptId] || '').trim();
    if (text !== 'ACTUALIZAR') {
      toast.error(t('symbology_dashboard.toast_require_actualizar'));
      return;
    }

    setUploadingStandardId(conceptId);
    const toastId = toast.loading(t('symbology_dashboard.toast_uploading_standard'));
    try {
      const formData = new FormData();
      formData.append('conceptId', conceptId);
      formData.append('confirmWord', 'ACTUALIZAR');
      formData.append('clientOriginalBytes', String(pending.originalBytes));
      formData.append('file', pending.blob, pending.filename);

      const response = await authFetch(`${API_BASE_URL}/vault/symbology/upload-standard`, {
        method: 'POST',
        body: formData,
      });
      if (response.ok) {
        toast.update(toastId, {
          render: t('symbology_dashboard.toast_upload_done'),
          type: 'success',
          isLoading: false,
          autoClose: 3000,
        });
        URL.revokeObjectURL(pending.previewUrl);
        setPendingManualUploads((prev) => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        setUploadStandardConfirmText((prev) => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        await fetchConcepts();
      } else {
        const json = await response.json().catch(() => ({}));
        toast.update(toastId, {
          render: `${t('common.error')}: ${json.error || t('symbology_dashboard.toast_upload_failed')}`,
          type: 'error',
          isLoading: false,
          autoClose: 5000,
        });
      }
    } catch {
      toast.update(toastId, {
        render: t('symbology_dashboard.toast_upload_failed'),
        type: 'error',
        isLoading: false,
        autoClose: 5000,
      });
    } finally {
      setUploadingStandardId(null);
    }
  };

  // Variante OEM por marca: Paso 1 generar propuesta -> Paso 2 consolidar con "ACTUALIZAR" (`/register-variant`)
  const handleGenerateVariant = async (conceptId: string) => {
    const brand = (variantBrandInput[conceptId] || '').trim();
    if (!brand) return;
    setGeneratingVariantId(conceptId);
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/symbology/generate-variant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conceptId, brand }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error || t('symbology_dashboard.toast_variant_error'));
      }
      if (json.temp_storage_url) {
        setVariantPreviewUrl((prev) => ({ ...prev, [conceptId]: json.temp_storage_url }));
        setVariantConfirmText((prev) => ({ ...prev, [conceptId]: '' }));
      }
    } catch (err: any) {
      toast.error(err?.message || t('symbology_dashboard.toast_variant_error'));
    } finally {
      setGeneratingVariantId(null);
    }
  };

  const handleRegisterVariant = async (conceptId: string) => {
    const brand = (variantBrandInput[conceptId] || '').trim();
    const confirm = (variantConfirmText[conceptId] || '').trim();
    if (!brand || confirm !== 'ACTUALIZAR') {
      toast.error(t('symbology_dashboard.toast_require_actualizar'));
      return;
    }
    setRegisteringVariantId(conceptId);
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/symbology/register-variant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conceptId,
          brand,
          confirmWord: 'ACTUALIZAR',
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error || t('symbology_dashboard.toast_variant_error'));
      }
      toast.success(t('symbology_dashboard.toast_variant_registered'));
      setVariantPreviewUrl((prev) => {
        const next = { ...prev };
        delete next[conceptId];
        return next;
      });
      setVariantConfirmText((prev) => {
        const next = { ...prev };
        delete next[conceptId];
        return next;
      });
      setOpenVariantEditorId(null);
      await fetchConcepts();
    } catch (err: any) {
      toast.error(err?.message || t('symbology_dashboard.toast_variant_error'));
    } finally {
      setRegisteringVariantId(null);
    }
  };

  // Filtrado de listas en base al buscador
  const filteredConcepts = concepts.filter((c) => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      (c.technical_name_es || '').toLowerCase().includes(query) ||
      (c.iso_reference || '').toLowerCase().includes(query) ||
      (c.concept_id || '').toLowerCase().includes(query)
    );
  });

  const pendingList = filteredConcepts.filter((c) => c.standard_icon_status !== 'encontrado');
  const consolidatedList = filteredConcepts.filter((c) => c.standard_icon_status === 'encontrado');

  // Renderizado de tarjetas de pendientes
  const renderPendingCard = (c: SymbologyItemWithCasTelemetry) => {
    const isSearching = searchingId === c.concept_id;
    const isDrawing = drawingId === c.concept_id;
    const isRegistering = registeringId === c.concept_id;
    const isUploading = uploadingStandardId === c.concept_id;
    const hasCandidates = !!(c.temp_icon_candidates && c.temp_icon_candidates.length > 0);
    const hasTempIcon = !!c.temp_standard_icon_url;
    const selectedIdx = selectedCandidateIdx[c.concept_id];
    const pendingUpload = pendingManualUploads[c.concept_id];

    return (
      <div
        key={c.concept_id}
        className="border border-[#E2E8F0] dark:border-[#12151C] p-[21px] bg-[#FFFFFF] dark:bg-[#07090D] space-y-[13px] rounded-none shadow-none select-none"
      >
        {/* Fila superior: Info básica + Acciones */}
        <div className="flex items-start justify-between gap-[13px]">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-[8px]">
              <span className="material-symbols-outlined text-[#C68346] !text-[18px]">pending</span>
              <h3 className="text-[13px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">
                {c.technical_name_es}
              </h3>
            </div>
            <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums select-text">
              {c.iso_reference}
            </p>
            {renderCasTelemetryBadge(c.original_bytes, c.optimized_bytes, c.savings_pct)}
          </div>
          <div className="flex items-center gap-[8px] shrink-0">
            <input
              ref={(el) => {
                fileInputRefs.current[c.concept_id] = el;
              }}
              type="file"
              accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => handleSelectStandardFile(c.concept_id, e)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRefs.current[c.concept_id]?.click()}
              disabled={isSearching || isDrawing || isRegistering || isUploading}
              title={t('symbology_dashboard.upload_standard_title')}
              aria-label={t('symbology_dashboard.upload_standard_title')}
              className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer disabled:opacity-40"
            >
              <span className="material-symbols-outlined !text-[18px]">upload_file</span>
            </button>
            <button
              type="button"
              onClick={() => handleBuscar(c.concept_id, c.iso_reference)}
              disabled={isSearching || isDrawing || isRegistering || isUploading}
              className="px-[13px] h-8 bg-[#C68346] text-[#FFFFFF] font-bold text-[11px] uppercase tracking-[0.05em] hover:bg-[#b07239] transition-colors border-0 cursor-pointer rounded-none shadow-none flex items-center justify-center shrink-0 disabled:opacity-40"
            >
              {isSearching ? t('symbology_dashboard.btn_searching') : t('symbology_dashboard.btn_search')}
            </button>
          </div>
        </div>

        {/* Vista comparativa HITL para subida manual directa (`upload-standard`) */}
        {pendingUpload && (
          <div className="border border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#000000] p-[13px] space-y-[13px] rounded-none shadow-none">
            <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
              {t('symbology_dashboard.manual_upload_preview_heading')}
            </p>
            <div className="grid grid-cols-2 gap-[13px]">
              <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-[8px] flex flex-col items-center justify-center min-h-[100px]">
                <span className="text-[10px] font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] mb-[8px]">
                  {t('opermaq_domains.hitl_col_current', { defaultValue: t('opermaq_domains.homologate_col_current') })}
                </span>
                {c.standard_icon_url ? (
                  <img
                    src={c.standard_icon_url}
                    alt={c.technical_name_es}
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                    className="max-h-[72px] w-auto object-contain select-none pointer-events-none"
                  />
                ) : (
                  <span className="text-[11px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                    {t('opermaq_domains.pending_record')}
                  </span>
                )}
              </div>
              <div className="border border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#07090D] p-[8px] flex flex-col items-center justify-center min-h-[100px]">
                <span className="text-[10px] font-mono font-bold uppercase text-[#00AEEF] mb-[8px]">
                  {t('symbology_dashboard.proposed_cas_label')}
                </span>
                <img
                  src={pendingUpload.previewUrl}
                  alt={pendingUpload.filename}
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                  className="max-h-[72px] w-auto object-contain select-none pointer-events-none"
                />
                {renderCasTelemetryBadge(
                  pendingUpload.originalBytes,
                  pendingUpload.optimizedBytes,
                  pendingUpload.savingsPct
                )}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-[8px]">
              <input
                type="text"
                value={uploadStandardConfirmText[c.concept_id] || ''}
                onChange={(e) =>
                  setUploadStandardConfirmText((prev) => ({
                    ...prev,
                    [c.concept_id]: e.target.value,
                  }))
                }
                placeholder="ACTUALIZAR"
                autoComplete="off"
                spellCheck={false}
                disabled={isUploading}
                className="px-[13px] h-8 text-[12px] bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-center flex-1 rounded-none shadow-none"
              />
              <button
                type="button"
                onClick={() => handleUploadStandard(c.concept_id)}
                disabled={
                  isUploading || (uploadStandardConfirmText[c.concept_id] || '').trim() !== 'ACTUALIZAR'
                }
                className="px-[13px] h-8 bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] font-bold text-[11px] uppercase tracking-[0.05em] disabled:opacity-40 transition-colors border-0 cursor-pointer rounded-none shadow-none"
              >
                {isUploading ? t('symbology_dashboard.btn_confirming') : t('symbology_dashboard.btn_confirm')}
              </button>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(pendingUpload.previewUrl);
                  setPendingManualUploads((prev) => {
                    const next = { ...prev };
                    delete next[c.concept_id];
                    return next;
                  });
                }}
                className="px-[13px] h-8 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] text-[#475569] dark:text-[#8A93A6] text-[11px] font-bold uppercase rounded-none shadow-none cursor-pointer"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Sección: Candidatos de Wikimedia */}
        {!hasTempIcon && hasCandidates && (
          <div className="space-y-[13px] pt-[13px] border-t border-[#E2E8F0] dark:border-[#12151C]">
            <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
              {t('symbology_dashboard.candidates_heading')}
            </p>
            <div className="grid grid-cols-3 gap-[13px]">
              {c.temp_icon_candidates?.map((cand, idx) => {
                const isSelected = selectedIdx === idx;
                return (
                  <div
                    key={idx}
                    className={`border p-[8px] flex flex-col items-center justify-between bg-[#F8FAFC] dark:bg-[#000000] transition-colors rounded-none shadow-none ${
                      isSelected ? 'border-[#C68346]' : 'border-[#E2E8F0] dark:border-[#12151C]'
                    }`}
                  >
                    <div className="w-[100px] h-[100px] flex items-center justify-center bg-[#FFFFFF] dark:bg-[#07090D] overflow-hidden p-1">
                      <img
                        src={cand.url}
                        alt={t('symbology_dashboard.candidate_alt', { num: idx + 1 })}
                        draggable={false}
                        onContextMenu={(e) => e.preventDefault()}
                        style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                        className="max-w-full max-h-full object-contain select-none pointer-events-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectCandidate(c.concept_id, idx)}
                      aria-label={t('symbology_dashboard.select_candidate_aria', { num: idx + 1 })}
                      title={t('symbology_dashboard.select_candidate_title')}
                      className={`bg-transparent border-0 outline-none p-1 mt-[8px] transition-colors cursor-pointer ${
                        isSelected
                          ? 'text-[#C68346]'
                          : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <span className="material-symbols-outlined !text-[18px]">draw</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Sección: Autorización de dibujo (DRAW) */}
        {!hasTempIcon && (selectedIdx !== undefined || c.standard_icon_status === 'pendiente_dibujo_humano') && (
          <div className="bg-[#F8FAFC] dark:bg-[#000000] border border-[#C68346] p-[13px] space-y-[13px] rounded-none shadow-none">
            <p className="text-[11px] text-[#C68346] font-bold leading-normal">
              {selectedIdx !== undefined
                ? t('symbology_dashboard.authorize_candidate_draw', { num: selectedIdx + 1 })
                : t('symbology_dashboard.authorize_scratch_draw')}
            </p>
            <div className="flex flex-col sm:flex-row gap-[8px]">
              <input
                type="text"
                value={drawConfirmText[c.concept_id] || ''}
                onChange={(e) => setDrawConfirmText((prev) => ({ ...prev, [c.concept_id]: e.target.value }))}
                placeholder={t('symbology_dashboard.placeholder_write_actualizar')}
                autoComplete="off"
                spellCheck={false}
                disabled={isDrawing}
                className="px-[13px] h-8 text-[12px] bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-center flex-1 rounded-none shadow-none"
              />
              <button
                type="button"
                onClick={() => handleAutorizarDraw(c.concept_id, hasCandidates)}
                disabled={isDrawing || (drawConfirmText[c.concept_id] || '').trim() !== 'ACTUALIZAR'}
                className="px-[13px] h-8 bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] font-bold text-[11px] uppercase tracking-[0.05em] disabled:opacity-40 transition-colors border-0 cursor-pointer rounded-none shadow-none flex items-center justify-center shrink-0"
              >
                {isDrawing ? t('symbology_dashboard.btn_drawing') : t('symbology_dashboard.btn_authorize_draw')}
              </button>
            </div>
          </div>
        )}

        {/* Sección: Confirmación de Dibujo Generado */}
        {hasTempIcon && (
          <div className="border border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#000000] p-[13px] space-y-[13px] rounded-none shadow-none">
            <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
              {t('symbology_dashboard.draw_proposal_heading')}
            </p>
            <div className="flex flex-col sm:flex-row gap-[13px] items-center sm:items-start">
              <div className="w-[120px] h-[120px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] flex items-center justify-center overflow-hidden shrink-0 p-1">
                <img
                  src={c.temp_standard_icon_url}
                  alt={t('symbology_dashboard.ai_draft_alt')}
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                  className="max-w-full max-h-full object-contain select-none pointer-events-none"
                />
              </div>
              <div className="flex-1 space-y-[8px] w-full">
                {renderCasTelemetryBadge(
                  c.temp_original_bytes ?? c.original_bytes,
                  c.temp_optimized_bytes ?? c.optimized_bytes,
                  c.temp_savings_pct ?? c.savings_pct
                )}
                <label className="text-[11px] font-bold uppercase text-[#475569] dark:text-[#8A93A6] block leading-normal">
                  {t('symbology_dashboard.write_actualizar_to_activate')}
                </label>
                <div className="flex gap-[8px]">
                  <input
                    type="text"
                    value={registerConfirmText[c.concept_id] || ''}
                    onChange={(e) => setRegisterConfirmText((prev) => ({ ...prev, [c.concept_id]: e.target.value }))}
                    placeholder="ACTUALIZAR"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isRegistering}
                    className="px-[13px] h-8 text-[12px] bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-center flex-1 rounded-none shadow-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleRegistrar(c.concept_id)}
                    disabled={isRegistering || (registerConfirmText[c.concept_id] || '').trim() !== 'ACTUALIZAR'}
                    className="px-[13px] h-8 bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] font-bold text-[11px] uppercase tracking-[0.05em] disabled:opacity-40 transition-colors border-0 cursor-pointer rounded-none shadow-none flex items-center justify-center shrink-0"
                  >
                    {isRegistering ? t('symbology_dashboard.btn_confirming') : t('symbology_dashboard.btn_confirm')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Renderizado de tarjetas de consolidados
  const renderConsolidatedCard = (c: SymbologyItemWithCasTelemetry) => {
    const isEditorOpen = openVariantEditorId === c.concept_id;
    const previewVariant = variantPreviewUrl[c.concept_id];
    const isGeneratingVar = generatingVariantId === c.concept_id;
    const isRegisteringVar = registeringVariantId === c.concept_id;

    return (
      <div
        key={c.concept_id}
        className="border border-[#E2E8F0] dark:border-[#12151C] p-[13px] bg-[#FFFFFF] dark:bg-[#07090D] flex flex-col gap-[8px] rounded-none shadow-none select-none"
      >
        <div className="flex items-center gap-[13px]">
          <div className="w-12 h-12 border border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-center bg-[#FFFFFF] dark:bg-[#000000] shrink-0 overflow-hidden p-1">
            {c.standard_icon_url ? (
              <img
                src={c.standard_icon_url}
                alt={c.technical_name_es}
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                className="max-w-full max-h-full object-contain select-none pointer-events-none"
              />
            ) : (
              <span className="material-symbols-outlined text-[#94A3B8] dark:text-[#5A6072] !text-[20px]">
                broken_image
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums select-text">
              {c.iso_reference}
            </p>
            <h4 className="text-[12px] font-bold text-[#0F172A] dark:text-[#F3F4F6] truncate uppercase">
              {c.technical_name_es}
            </h4>
            {renderCasTelemetryBadge(c.original_bytes, c.optimized_bytes, c.savings_pct)}
          </div>
          {canCurate && (
            <button
              type="button"
              onClick={() =>
                setOpenVariantEditorId((prev) => (prev === c.concept_id ? null : c.concept_id))
              }
              title={t('symbology_dashboard.oem_variant_btn_title')}
              aria-label={t('symbology_dashboard.oem_variant_btn_title')}
              className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shrink-0"
            >
              <span className="material-symbols-outlined !text-[18px]">edit</span>
            </button>
          )}
        </div>

        {canCurate && isEditorOpen && (
          <div className="pt-[8px] border-t border-[#E2E8F0] dark:border-[#12151C] space-y-[8px]">
            <div className="flex gap-[8px]">
              <input
                type="text"
                value={variantBrandInput[c.concept_id] || ''}
                onChange={(e) =>
                  setVariantBrandInput((prev) => ({ ...prev, [c.concept_id]: e.target.value }))
                }
                placeholder={t('symbology_dashboard.oem_brand_placeholder')}
                autoComplete="off"
                spellCheck={false}
                className="px-[8px] h-8 text-[11px] bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono flex-1 rounded-none shadow-none select-text"
              />
              <button
                type="button"
                disabled={isGeneratingVar || !(variantBrandInput[c.concept_id] || '').trim()}
                onClick={() => handleGenerateVariant(c.concept_id)}
                className="px-[13px] h-8 bg-[#C68346] text-[#FFFFFF] text-[10px] font-bold uppercase rounded-none shadow-none border-0 cursor-pointer disabled:opacity-40"
              >
                {isGeneratingVar ? t('symbology_dashboard.btn_drawing') : t('symbology_dashboard.btn_propose_variant')}
              </button>
            </div>

            {previewVariant && (
              <div className="border border-[#00AEEF] p-[8px] bg-[#F8FAFC] dark:bg-[#000000] space-y-[8px] rounded-none shadow-none">
                <div className="grid grid-cols-2 gap-[8px]">
                  <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] p-[8px] flex flex-col items-center">
                    <span className="text-[9px] font-mono font-bold uppercase text-[#475569] dark:text-[#8A93A6] mb-[4px]">
                      {t('opermaq_domains.homologate_col_current')}
                    </span>
                    {c.standard_icon_url && (
                      <img
                        src={c.standard_icon_url}
                        alt={c.technical_name_es}
                        draggable={false}
                        onContextMenu={(e) => e.preventDefault()}
                        style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                        className="h-10 w-10 object-contain select-none pointer-events-none"
                      />
                    )}
                  </div>
                  <div className="border border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#07090D] p-[8px] flex flex-col items-center">
                    <span className="text-[9px] font-mono font-bold uppercase text-[#00AEEF] mb-[4px]">
                      {t('symbology_dashboard.proposed_cas_label')}
                    </span>
                    <img
                      src={previewVariant}
                      alt={c.technical_name_es}
                      draggable={false}
                      onContextMenu={(e) => e.preventDefault()}
                      style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                      className="h-10 w-10 object-contain select-none pointer-events-none"
                    />
                  </div>
                </div>
                <div className="flex gap-[8px]">
                  <input
                    type="text"
                    value={variantConfirmText[c.concept_id] || ''}
                    onChange={(e) =>
                      setVariantConfirmText((prev) => ({ ...prev, [c.concept_id]: e.target.value }))
                    }
                    placeholder="ACTUALIZAR"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isRegisteringVar}
                    className="px-[8px] h-8 text-[11px] bg-[#FFFFFF] dark:bg-[#07090D] text-[#0F172A] dark:text-[#F3F4F6] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] outline-none font-mono text-center flex-1 rounded-none shadow-none"
                  />
                  <button
                    type="button"
                    disabled={
                      isRegisteringVar || (variantConfirmText[c.concept_id] || '').trim() !== 'ACTUALIZAR'
                    }
                    onClick={() => handleRegisterVariant(c.concept_id)}
                    className="px-[13px] h-8 bg-[#C68346] text-[#FFFFFF] text-[10px] font-bold uppercase rounded-none shadow-none border-0 cursor-pointer disabled:opacity-40"
                  >
                    {isRegisteringVar ? t('symbology_dashboard.btn_confirming') : t('symbology_dashboard.btn_confirm')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-atkinson overflow-hidden select-none rounded-none shadow-none">
      {/* Barra Superior Minimalista Uniforme (Cero Duplicación) */}
      <header className="h-12 px-[21px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-[21px] shrink-0">
        <h1 className="text-[12px] font-mono font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] shrink-0">
          {t('symbology_dashboard.title')}
        </h1>

        <div className="relative flex-1 max-w-sm flex items-center border-b border-[#E2E8F0] dark:border-[#12151C] focus-within:border-[#C68346] rounded-none">
          <span className="material-symbols-outlined text-[16px] text-[#94A3B8] dark:text-[#5A6072]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder={t('symbology_dashboard.search_placeholder')}
            autoComplete="off"
            spellCheck={false}
            className="w-full h-8 px-[8px] bg-transparent text-[13px] font-atkinson text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] outline-none rounded-none select-text"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              title={t('symbology_dashboard.clear_search')}
              aria-label={t('symbology_dashboard.clear_search')}
              className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          )}
        </div>
      </header>

      {canCurate ? (
        /* Macro-Layout Paramétrico Áureo (61.8% Curación Protagonista | 38.2% Catálogo Consolidado) */
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-[#E2E8F0] dark:divide-[#12151C]">
          {/* Área Mayor (61.8%): PENDIENTES */}
          <section className="w-full lg:w-[61.8%] flex flex-col h-full overflow-hidden">
            <div className="px-[21px] py-[8px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between shrink-0">
              <h2 className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#C68346]">
                {t('symbology_dashboard.pending_heading')}
              </h2>
              <span className="font-mono tabular-nums text-[11px] font-bold text-[#C68346]">
                {pendingList.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-[21px] space-y-[21px] bg-[#FFFFFF] dark:bg-[#000000]">
              {loading ? (
                <div className="flex items-center justify-center py-[55px]">
                  <M3CircularProgress size={24} strokeWidth={3} tone="copper" />
                </div>
              ) : pendingList.length === 0 ? (
                <div className="p-[34px] text-center text-[12px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                  {t('symbology_dashboard.empty_pending')}
                </div>
              ) : (
                pendingList.map((c) => renderPendingCard(c))
              )}
            </div>
          </section>

          {/* Área Menor (38.2%): CONSOLIDADOS */}
          <section className="w-full lg:w-[38.2%] flex flex-col h-full overflow-hidden">
            <div className="px-[21px] py-[8px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between shrink-0">
              <h2 className="text-[11px] font-mono font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                {t('symbology_dashboard.consolidated_heading')}
              </h2>
              <span className="font-mono tabular-nums text-[11px] font-bold text-[#00AEEF]">
                {consolidatedList.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-[21px] space-y-[13px] bg-[#F8FAFC] dark:bg-[#07090D]">
              {loading ? (
                <div className="flex items-center justify-center py-[55px]">
                  <M3CircularProgress size={24} strokeWidth={3} tone="copper" />
                </div>
              ) : consolidatedList.length === 0 ? (
                <div className="p-[34px] text-center text-[12px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                  {t('opermaq_domains.not_declared')}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-[13px]">
                  {consolidatedList.map((c) => renderConsolidatedCard(c))}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        /* Vista Consulta Transversal de Solo Lectura (Clientes B2B / EDU — únicamente símbolos autorizados) */
        <div className="flex-1 overflow-y-auto p-[21px]">
          {loading ? (
            <div className="flex items-center justify-center py-[55px]">
              <M3CircularProgress size={24} strokeWidth={3} tone="copper" />
            </div>
          ) : consolidatedList.length === 0 ? (
            <div className="p-[34px] text-center text-[12px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
              {t('opermaq_domains.not_declared')}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[13px]">
              {consolidatedList.map((c) => renderConsolidatedCard(c))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
