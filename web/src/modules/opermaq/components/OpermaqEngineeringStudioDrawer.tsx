import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { mediaDigestorClient } from '../../../core/media/MediaDigestorClient';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import type { AdHocManualProfileId } from '../types/vault';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { CatalogContributionsReviewPanel } from './CatalogContributionsReviewPanel';
import { M3Switch } from './M3Switch';

export type StudioTabId = 'INGESTION' | 'CONTRIBUTIONS_REVIEW' | 'SYMBOLOGY_PACK' | 'MANUAL_PUBLISHER';

interface OpermaqEngineeringStudioDrawerProps {
  isOpen: boolean;
  initialTab?: StudioTabId;
  catalogId: string;
  tenantAssetId?: string;
  makeModel: string;
  isSealed?: boolean;
  onClose: () => void;
}

interface CorpusFileRecord {
  sha256: string;
  originalFilename: string;
  documentCategory: string;
  originalBytes: number;
  optimizedBytes: number;
  savingsRatio: number;
  savingsPct?: number;
  totalPages: number;
  skippedUnchangedPages: number;
  extractedChaptersCount: number;
  extractedFiguresCount: number;
  vectorizedSymbolsCount: number;
  status: string;
  updatedAt: string;
  pillarDistribution?: Record<string, number>;
}

interface CompiledManualState {
  manualId: string;
  profileId: AdHocManualProfileId;
  profileTitleEs: string;
  pdfDownloadUrl: string;
  pdfSha256: string;
  optimizedBytes: number;
  pageCount: number;
  embeddedFiguresCount: number;
  embeddedSymbolsCount: number;
  ledgerEntryId: string;
  htmlEdition?: string;
  compiledAt: string;
}

const MANUAL_PROFILES: Array<{
  id: AdHocManualProfileId;
  title: string;
  scope: string;
}> = [
  {
    id: 'MASTER_5_PILLARS',
    title: 'MANUAL TÉCNICO MAESTRO INTEGRAL (5 PILARES)',
    scope: 'Ficha SI + Operación + Pauta PM + Matriz de Riesgos + Pre-Uso + Planos SVG + Simbología Completa',
  },
  {
    id: 'OPERATOR_POCKET_GUIDE',
    title: 'GUÍA OPERATIVA DE CABINA Y CARTILLA DE TESTIGOS',
    scope: 'Controles + Significado de Testigos Luminosos + EPP + Inspección 360° Walk-Around',
  },
  {
    id: 'WORKSHOP_PM_MANUAL',
    title: 'MANUAL DE TALLER, FLUIDOS Y PAUTA HOROMÉTRICA PM',
    scope: 'Capacidades SI + Torques + Matriz 10h–2000h + Puntos de Aislamiento',
  },
  {
    id: 'REGULATORY_DS132_LOTO',
    title: 'DOSSIER DE SEGURIDAD MINERA DS 132 Y ENERGÍA CERO (LOTO)',
    scope: 'Matriz de Riesgos + Placa ISO 3864/7010 + Estaciones LOTO + Sello Criptográfico AuditLedger',
  },
];

function formatKbMb(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

function resolveDownloadHref(url: string): string {
  if (!url) return '#';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/api/')) {
    const cleanBase = API_BASE_URL.replace(/\/api\/?$/, '');
    return `${cleanBase}${url}`;
  }
  return url;
}

export const OpermaqEngineeringStudioDrawer: React.FC<OpermaqEngineeringStudioDrawerProps> = ({
  isOpen,
  initialTab = 'INGESTION',
  catalogId,
  tenantAssetId,
  makeModel,
  isSealed = false,
  onClose,
}) => {
  const { capabilities } = useOpermaqContext();
  const canCurateAI = capabilities.canCurateAI;
  const resolvedInitialTab: StudioTabId =
    !canCurateAI && (initialTab === 'INGESTION' || initialTab === 'CONTRIBUTIONS_REVIEW')
      ? 'MANUAL_PUBLISHER'
      : initialTab === 'SYMBOLOGY_PACK'
      ? 'MANUAL_PUBLISHER'
      : initialTab;
  const [activeTab, setActiveTab] = useState<StudioTabId>(resolvedInitialTab);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Estado Pestaña 1: Ingesta Multimodal OEM & Digestor
  const [docCategory, setDocCategory] = useState<
    'OEM_MANUAL' | 'CATALOG_BROCHURE' | 'ETT_SPEC_SHEET' | 'TECHNICAL_CHART_PHOTO'
  >('OEM_MANUAL');
  const [privateTenantOnly, setPrivateTenantOnly] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [digestStatusText, setDigestStatusText] = useState('');
  const [lastIngestionReport, setLastIngestionReport] = useState<any | null>(null);
  const [corpusFiles, setCorpusFiles] = useState<CorpusFileRecord[]>([]);

  // Estado Pestaña 3: Editorial de Manuales Ad-Hoc
  const [selectedProfile, setSelectedProfile] = useState<AdHocManualProfileId>('MASTER_5_PILLARS');
  const [includeTenantOverrides, setIncludeTenantOverrides] = useState(false);
  const [isCompilingManual, setIsCompilingManual] = useState(false);
  const [activeManual, setActiveManual] = useState<CompiledManualState | null>(null);
  const [manualHistory, setManualHistory] = useState<CompiledManualState[]>([]);

  useEffect(() => {
    setActiveTab(
      !canCurateAI && (initialTab === 'INGESTION' || initialTab === 'CONTRIBUTIONS_REVIEW')
        ? 'MANUAL_PUBLISHER'
        : initialTab === 'SYMBOLOGY_PACK'
        ? 'MANUAL_PUBLISHER'
        : initialTab
    );
  }, [initialTab, canCurateAI]);

  const fetchCorpus = useCallback(async () => {
    if (!catalogId || !canCurateAI) return;
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/corpus/${catalogId}`);
      if (res.ok) {
        const json = await res.json();
        setCorpusFiles(Array.isArray(json.files) ? json.files : []);
      }
    } catch {
      // Silencioso
    }
  }, [catalogId, canCurateAI]);

  const fetchManuals = useCallback(async () => {
    if (!catalogId) return;
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/manuals/${catalogId}`);
      if (res.ok) {
        const json = await res.json();
        setManualHistory(Array.isArray(json.manuals) ? json.manuals : []);
      }
    } catch {
      // Silencioso
    }
  }, [catalogId]);

  useEffect(() => {
    if (!isOpen || !catalogId) return;
    fetchCorpus();
    fetchManuals();
  }, [isOpen, catalogId, fetchCorpus, fetchManuals]);

  if (!isOpen) return null;

  const handleSelectAndIngestFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    e.target.value = '';
    if (!rawFile || !catalogId) return;

    setIsIngesting(true);
    setDigestStatusText('1/2 Ejecutando MinreportMediaDigestor local (compresión sin pérdida técnica)...');

    try {
      // Pre-optimizar en cliente con `MediaDigestorClient` antes de transmitir por red
      const targetProfile = rawFile.type.includes('pdf') || rawFile.name.toLowerCase().endsWith('.pdf')
        ? 'PDF_HYBRID_OEM'
        : rawFile.type.startsWith('video/')
        ? 'VIDEO_FIELD_COMPACT'
        : 'IMAGE_TECHNICAL_HD';

      const clientDigested = await mediaDigestorClient.digestFile(rawFile, targetProfile);

      // Si es un video técnico de inspección, subir video optimizado a CAS e ingerir su keyframe principal en los 5 pilares
      const uploadBlob =
        targetProfile === 'VIDEO_FIELD_COMPACT' && clientDigested.posterBlob
          ? clientDigested.posterBlob
          : clientDigested.blob;
      const uploadFilename =
        targetProfile === 'VIDEO_FIELD_COMPACT'
          ? `${rawFile.name.replace(/\.[^.]+$/, '')}_keyframe.webp`
          : rawFile.name;

      if (targetProfile === 'VIDEO_FIELD_COMPACT') {
        await mediaDigestorClient.digestAndUploadCas(rawFile, {
          profile: 'VIDEO_FIELD_COMPACT',
          scope: privateTenantOnly ? 'TENANT_PRIVATE' : 'GLOBAL_OEM',
        });
      }

      setDigestStatusText(
        `2/2 Extrayendo capítulos, recortando figuras (box_2d) y repartiendo entre los 5 pilares...`
      );

      const form = new FormData();
      form.append('file', uploadBlob, uploadFilename);
      form.append('globalAssetId', catalogId);
      form.append('documentCategory', docCategory);
      form.append('visibilityScope', privateTenantOnly ? 'TENANT_ONLY' : 'COMMONS_OEM');
      form.append('clientOriginalBytes', String(rawFile.size));

      const res = await authFetch(`${API_BASE_URL}/vault/ingest-document`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Error en procesamiento segmentado.');
      }

      // Conservar peso crudo original previo a la digestión cliente para reflejar ahorro extremo real
      const trueOriginalBytes = json.originalBytes || rawFile.size;
      const finalOptimizedBytes = json.optimizedBytes || clientDigested.optimizedBytes;
      const totalSavingsPct =
        trueOriginalBytes > 0
          ? Number(Math.max(0, (1 - finalOptimizedBytes / trueOriginalBytes) * 100).toFixed(1))
          : 0;

      setLastIngestionReport({
        ...json,
        trueOriginalBytes,
        finalOptimizedBytes,
        totalSavingsPct,
      });

      await fetchCorpus();

      if (json.deduplicatedDocumentHit) {
        toast.info('Documento ya registrado en CAS: 0 duplicados y $0 re-procesamiento.');
      } else {
        toast.success(
          `Ingesta completada: ${json.extractedChaptersCount} capítulo(s), ${json.extractedFiguresCount} figura(s) CAS.`
        );
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error procesando documento.');
    } finally {
      setIsIngesting(false);
      setDigestStatusText('');
    }
  };

  const handleCompileManual = async () => {
    setIsCompilingManual(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/compile-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalAssetId: catalogId,
          profileId: selectedProfile,
          tenantAssetId,
          includeTenantOverrides,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Error compilando manual ad-hoc.');
      setActiveManual(json);
      await fetchManuals();
      toast.success('Manual Ad-Hoc ilustrado compilado y sellado en AuditLedger.');
    } catch (err: any) {
      toast.error(err?.message || 'Error compilando manual.');
    } finally {
      setIsCompilingManual(false);
    }
  };

  const handlePrintHtmlEdition = () => {
    if (!activeManual?.htmlEdition) return;
    const printWin = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWin) return;
    printWin.document.open();
    printWin.document.write(activeManual.htmlEdition);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => printWin.print(), 350);
  };

  return (
    <div className="fixed inset-0 z-[120] bg-[#000000]/75 flex flex-col font-atkinson select-none">
      <div className="flex-1 flex flex-col w-full h-full bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none overflow-hidden">
        {/* Cabezal Superior Quirúrgico */}
        <header className="shrink-0 flex items-center justify-between px-[21px] py-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
          <div className="flex items-center gap-[21px]">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#C68346]">
                ESTUDIO DE INGENIERÍA MULTIMODAL OPERMAQ
              </span>
              <h2 className="text-[17px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                {makeModel}
              </h2>
            </div>

            <nav className="flex items-center gap-[8px] ml-[21px]">
              {(
                [
                  ...(canCurateAI
                    ? ([
                        ['INGESTION', 'INGESTA PDF / ETT / MULTIMEDIA'],
                        ['CONTRIBUTIONS_REVIEW', 'COLA ESCLUSA APORTES CLIENTES'],
                      ] as Array<[StudioTabId, string]>)
                    : []),
                  ['MANUAL_PUBLISHER', 'EDITORIAL MANUALES AD-HOC'],
                ] as Array<[StudioTabId, string]>
              ).map(([tabId, label]) => (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => setActiveTab(tabId)}
                  className={`px-[13px] py-[8px] text-[11px] font-bold uppercase tracking-[0.05em] border rounded-none shadow-none transition-colors cursor-pointer ${
                    activeTab === tabId
                      ? 'border-[#C68346] bg-[#C68346] text-[#FFFFFF]'
                      : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Cerrar estudio"
            className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {/* Macro-Layout Paramétrico Áureo (38.2% Controles | 61.8% Informe / Visor Protagonista) */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {canCurateAI && activeTab === 'INGESTION' && (
            <>
              {/* Área Menor (38.2%): Controles de Carga y Digestor */}
              <aside className="lg:w-[38.2%] border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] overflow-y-auto flex flex-col gap-[21px]">
                <div>
                  <h3 className="text-[15px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                    Procesador de Manuales Extensos y Digestor CAS
                  </h3>
                  <p className="text-[13px] text-[#475569] dark:text-[#8A93A6] mt-[8px]">
                    Comprime PDFs, planos, fotos y videos antes de persistir, descarta páginas repetidas (`FastCDC`), recorta figuras (`box_2d`) y distribuye hechos en los 5 pilares.
                  </p>
                </div>

                <form
                  autoComplete="off"
                  spellCheck={false}
                  onSubmit={(e) => e.preventDefault()}
                  className="flex flex-col gap-[13px] bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] p-[21px] rounded-none shadow-none"
                >
                  <label className="flex flex-col gap-[8px]">
                    <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                      NATURALEZA DEL DOCUMENTO
                    </span>
                    <select
                      value={docCategory}
                      onChange={(e) => setDocCategory(e.target.value as any)}
                      className="px-[13px] py-[8px] bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-[13px] text-[#0F172A] dark:text-[#F3F4F6] rounded-none outline-none"
                    >
                      <option value="OEM_MANUAL">Manual Oficial Operación / Taller OEM (PDF Extenso)</option>
                      <option value="ETT_SPEC_SHEET">Especificación Técnica / ETT / Ficha Nominal</option>
                      <option value="CATALOG_BROCHURE">Catálogo Técnico / Folleto de Dimensiones</option>
                      <option value="TECHNICAL_CHART_PHOTO">Lámina de Carga, Esquema o Video Técnico</option>
                    </select>
                  </label>

                  <M3Switch
                    checked={privateTenantOnly}
                    onChange={setPrivateTenantOnly}
                    label="Restringir solo a mi empresa (No aportar a Bóveda Común)"
                  />

                  <input
                    ref={docInputRef}
                    type="file"
                    accept=".pdf,image/*,video/*"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={handleSelectAndIngestFile}
                    className="hidden"
                  />

                  <button
                    type="button"
                    disabled={isIngesting || (isSealed && !privateTenantOnly)}
                    onClick={() => docInputRef.current?.click()}
                    className="w-full py-[13px] px-[21px] bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] text-[11px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                  >
                    {isIngesting ? 'PROCESANDO Y OPTIMIZANDO...' : 'SELECCIONAR PDF / ETT / IMAGEN / VIDEO'}
                  </button>

                  {digestStatusText && (
                    <p className="font-mono tabular-nums text-[11px] text-[#00AEEF]">
                      {digestStatusText}
                    </p>
                  )}
                </form>

                {lastIngestionReport && (
                  <div className="border border-[#00AEEF] bg-[#FFFFFF] dark:bg-[#000000] p-[21px] flex flex-col gap-[13px] rounded-none shadow-none">
                    <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#00AEEF]">
                      RESULTADO DE DIGESTIÓN E INGESTA
                    </span>
                    <div className="grid grid-cols-2 gap-[13px] font-mono tabular-nums text-[13px]">
                      <div>
                        <span className="block text-[11px] text-[#475569] dark:text-[#8A93A6]">PESO ORIGINAL</span>
                        <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                          {formatKbMb(lastIngestionReport.trueOriginalBytes)}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[11px] text-[#475569] dark:text-[#8A93A6]">PESO CAS OPTIMIZADO</span>
                        <strong className="text-[#C68346]">
                          {formatKbMb(lastIngestionReport.finalOptimizedBytes)} (-{lastIngestionReport.totalSavingsPct}%)
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[11px] text-[#475569] dark:text-[#8A93A6]">PÁGINAS (TOTAL / SALTADAS)</span>
                        <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                          {lastIngestionReport.totalPages} / {lastIngestionReport.skippedUnchangedPages}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[11px] text-[#475569] dark:text-[#8A93A6]">FIGURAS / SÍMBOLOS SVG</span>
                        <strong className="text-[#0F172A] dark:text-[#F3F4F6]">
                          {lastIngestionReport.extractedFiguresCount} / {lastIngestionReport.vectorizedSymbolsCount}
                        </strong>
                      </div>
                    </div>
                  </div>
                )}
              </aside>

              {/* Área Mayor (61.8%): Registro Histórico CAS y Distribución en 5 Pilares */}
              <section className="lg:w-[61.8%] p-[34px] overflow-y-auto bg-[#FFFFFF] dark:bg-[#000000] flex flex-col gap-[21px]">
                <h3 className="text-[17px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                  Corpus Técnico Indexado en CAS (<span className="font-mono tabular-nums">{corpusFiles.length}</span>)
                </h3>

                {corpusFiles.length === 0 ? (
                  <p className="text-[13px] text-[#5A6072]">
                    [Pendiente de registro] — Aún no se han ingerido manuales PDF, ETT ni láminas técnicas para este activo.
                  </p>
                ) : (
                  <table className="w-full border-collapse text-[13px] font-mono tabular-nums">
                    <thead>
                      <tr className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C]">
                        <th className="p-[13px] text-left text-[11px] text-[#475569] dark:text-[#8A93A6]">DOCUMENTO</th>
                        <th className="p-[13px] text-right text-[11px] text-[#475569] dark:text-[#8A93A6]">PESO ORIGINAL</th>
                        <th className="p-[13px] text-right text-[11px] text-[#475569] dark:text-[#8A93A6]">GUARDADO CAS</th>
                        <th className="p-[13px] text-right text-[11px] text-[#475569] dark:text-[#8A93A6]">% OPTIMIZACIÓN</th>
                        <th className="p-[13px] text-right text-[11px] text-[#475569] dark:text-[#8A93A6]">PÁGS</th>
                        <th className="p-[13px] text-right text-[11px] text-[#475569] dark:text-[#8A93A6]">CAPÍTULOS</th>
                        <th className="p-[13px] text-right text-[11px] text-[#475569] dark:text-[#8A93A6]">FIGURAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {corpusFiles.map((f) => {
                        const rowSavingsPct =
                          typeof f.savingsPct === 'number'
                            ? f.savingsPct
                            : typeof f.savingsRatio === 'number'
                            ? Number((f.savingsRatio * 100).toFixed(1))
                            : f.originalBytes > 0
                            ? Number(Math.max(0, (1 - f.optimizedBytes / f.originalBytes) * 100).toFixed(1))
                            : 0;
                        return (
                          <tr
                            key={f.sha256}
                            className="border border-[#E2E8F0] dark:border-[#12151C]"
                          >
                            <td className="p-[13px] font-atkinson text-[#0F172A] dark:text-[#F3F4F6]">
                              <div className="font-semibold">{f.originalFilename}</div>
                              <div className="font-mono text-[11px] text-[#5A6072] select-text">
                                SHA-256: {f.sha256.slice(0, 14)}… · {f.documentCategory}
                              </div>
                            </td>
                            <td className="p-[13px] text-right text-[#475569] dark:text-[#8A93A6]">
                              {formatKbMb(f.originalBytes || f.optimizedBytes)}
                            </td>
                            <td className="p-[13px] text-right text-[#C68346] font-bold">
                              {formatKbMb(f.optimizedBytes)}
                            </td>
                            <td className="p-[13px] text-right text-[#00AEEF] font-bold">
                              -{rowSavingsPct.toFixed(1)}%
                            </td>
                            <td className="p-[13px] text-right text-[#0F172A] dark:text-[#F3F4F6]">
                              {f.totalPages}
                            </td>
                            <td className="p-[13px] text-right text-[#0F172A] dark:text-[#F3F4F6]">
                              {f.extractedChaptersCount}
                            </td>
                            <td className="p-[13px] text-right text-[#00AEEF] font-bold">
                              {f.extractedFiguresCount}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}

          {canCurateAI && activeTab === 'CONTRIBUTIONS_REVIEW' && (
            <div className="flex-1 w-full h-full min-h-0 overflow-y-auto bg-[#FFFFFF] dark:bg-[#000000]">
              <CatalogContributionsReviewPanel
                filterGlobalAssetId={catalogId}
                onReviewed={fetchCorpus}
              />
            </div>
          )}

          {activeTab === 'MANUAL_PUBLISHER' && (
            <>
              {/* Área Menor (38.2%): Selección de Perfil Editorial y Compilación */}
              <aside className="lg:w-[38.2%] border-b lg:border-b-0 lg:border-r border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] overflow-y-auto flex flex-col gap-[21px]">
                <div>
                  <h3 className="text-[15px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                    Compilador de Manuales Ad-Hoc Propios
                  </h3>
                  <p className="text-[13px] text-[#475569] dark:text-[#8A93A6] mt-[8px]">
                    Integra texto curado de los 5 pilares, diagramas recortados CAS, planos paramétricos SVG y la cartilla completa de simbología normativa en una edición PDF + Imprimible A4.
                  </p>
                </div>

                <div className="flex flex-col gap-[13px]">
                  {MANUAL_PROFILES.map((prof) => (
                    <button
                      key={prof.id}
                      type="button"
                      onClick={() => setSelectedProfile(prof.id)}
                      className={`text-left p-[13px] border rounded-none shadow-none transition-colors cursor-pointer ${
                        selectedProfile === prof.id
                          ? 'border-[#C68346] bg-[#FFFFFF] dark:bg-[#000000]'
                          : 'border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF]/60 dark:bg-[#000000]/40'
                      }`}
                    >
                      <div className="text-[12px] font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                        {prof.title}
                      </div>
                      <div className="text-[11px] text-[#475569] dark:text-[#8A93A6] mt-[4px]">
                        {prof.scope}
                      </div>
                    </button>
                  ))}
                </div>

                {tenantAssetId && (
                  <M3Switch
                    checked={includeTenantOverrides}
                    onChange={setIncludeTenantOverrides}
                    label="Fusionar estándares internos privados de mi faena"
                  />
                )}

                <button
                  type="button"
                  disabled={isCompilingManual}
                  onClick={handleCompileManual}
                  className="py-[13px] px-[21px] bg-[#C68346] hover:bg-[#b07239] text-[#FFFFFF] text-[11px] font-bold uppercase tracking-[0.05em] rounded-none shadow-none transition-colors cursor-pointer disabled:opacity-40"
                >
                  {isCompilingManual ? 'COMPILANDO EDICIÓN ILUSTRADA...' : 'COMPILAR MANUAL AD-HOC AHORA'}
                </button>

                {manualHistory.length > 0 && (
                  <div className="flex flex-col gap-[8px] pt-[13px] border-t border-[#E2E8F0] dark:border-[#12151C]">
                    <span className="text-[11px] font-bold uppercase text-[#475569] dark:text-[#8A93A6]">
                      EDICIONES RECIENTES EN CAS
                    </span>
                    {manualHistory.map((m) => (
                      <a
                        key={m.manualId}
                        href={resolveDownloadHref(m.pdfDownloadUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-[13px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] hover:border-[#00AEEF] flex items-center justify-between text-[12px]"
                      >
                        <span className="font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                          {m.profileTitleEs}
                        </span>
                        <span className="font-mono tabular-nums text-[11px] text-[#00AEEF]">
                          {m.pageCount} págs · {formatKbMb(m.optimizedBytes)}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </aside>

              {/* Área Mayor (61.8%): Visor de Edición Ilustrada y Descarga PDF Sellado */}
              <section className="lg:w-[61.8%] p-[21px] overflow-hidden bg-[#FFFFFF] dark:bg-[#000000] flex flex-col gap-[13px]">
                {!activeManual ? (
                  <div className="flex-1 flex items-center justify-center border border-[#E2E8F0] dark:border-[#12151C] p-[34px]">
                    <p className="text-[13px] text-[#5A6072]">
                      Seleccione un perfil editorial y presione COMPILAR MANUAL AD-HOC AHORA para generar la edición ilustrada con planos vectoriales y simbología.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="shrink-0 flex flex-wrap items-center justify-between gap-[13px] p-[13px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
                      <div>
                        <span className="font-mono tabular-nums text-[11px] text-[#00AEEF] select-text">
                          LEDGER ID: {activeManual.ledgerEntryId} · SHA-256: {activeManual.pdfSha256.slice(0, 14)}…
                        </span>
                        <h4 className="text-[15px] font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                          {activeManual.profileTitleEs} ({activeManual.pageCount} págs · {formatKbMb(activeManual.optimizedBytes)})
                        </h4>
                      </div>
                      <div className="flex items-center gap-[13px]">
                        <button
                          type="button"
                          onClick={handlePrintHtmlEdition}
                          className="px-[13px] py-[8px] border border-[#0F172A] dark:border-[#F3F4F6] text-[11px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] rounded-none cursor-pointer"
                        >
                          IMPRIMIR EDICIÓN A4
                        </button>
                        <a
                          href={resolveDownloadHref(activeManual.pdfDownloadUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-[13px] py-[8px] bg-[#C68346] text-[#FFFFFF] text-[11px] font-bold uppercase rounded-none"
                        >
                          DESCARGAR PDF CAS
                        </a>
                      </div>
                    </div>

                    {activeManual.htmlEdition && (
                      <iframe
                        title={activeManual.profileTitleEs}
                        srcDoc={activeManual.htmlEdition}
                        className="flex-1 w-full border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF]"
                      />
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default OpermaqEngineeringStudioDrawer;


