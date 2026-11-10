import React, { useState, useEffect } from 'react';
import { auth, API_BASE_URL } from '../firebase/config';
import { useOpermaqContext } from '../hooks/useOpermaqContext';
import { authFetch } from '../utils/authFetch';
import { toast } from 'react-toastify';
import type { MasterSymbologyItem } from '../types/vault';
import { M3CircularProgress } from './M3ProgressIndicator';

export const GlobalSymbologyDashboard: React.FC = () => {
  const { capabilities } = useOpermaqContext();
  const canCurate = capabilities.canCurateAI;
  const [concepts, setConcepts] = useState<MasterSymbologyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');


  // Estados de carga por concepto
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [drawingId, setDrawingId] = useState<string | null>(null);
  const [registeringId, setRegisteringId] = useState<string | null>(null);

  // Inputs por concepto para el flujo HITL
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState<Record<string, number>>({});
  const [drawConfirmText, setDrawConfirmText] = useState<Record<string, string>>({});
  const [registerConfirmText, setRegisterConfirmText] = useState<Record<string, string>>({});

  const fetchConcepts = async () => {
    setLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/symbology/concepts`);
      if (response.ok) {
        const data = await response.json();
        setConcepts(data);
      } else {
        toast.error('Error al cargar conceptos del catálogo global.');
      }
    } catch (err) {
      toast.error('Error de red al cargar el catálogo de simbología.');
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
    const toastId = toast.loading(`Buscando candidatos para "${isoReference}" en Wikimedia...`);
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/symbology/search-iso-icon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conceptId, isoReference })
      });
      if (response.ok) {
        toast.update(toastId, { render: 'Búsqueda completada. Selecciona un candidato para dibujar.', type: 'success', isLoading: false, autoClose: 3500 });
        // Limpiar selecciones previas si existían
        setSelectedCandidateIdx(prev => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        setDrawConfirmText(prev => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        await fetchConcepts();
      } else {
        const json = await response.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudieron buscar candidatos.'}`, type: 'error', isLoading: false, autoClose: 4000 });
      }
    } catch (err) {
      toast.update(toastId, { render: 'Error de red al buscar pictograma.', type: 'error', isLoading: false, autoClose: 5000 });
    } finally {
      setSearchingId(null);
    }
  };

  const handleSelectCandidate = (conceptId: string, idx: number) => {
    setSelectedCandidateIdx(prev => ({ ...prev, [conceptId]: idx }));
  };

  // Autorizar dibujo con IA (DRAW)
  const handleAutorizarDraw = async (conceptId: string, hasCandidates: boolean) => {
    const idx = selectedCandidateIdx[conceptId] ?? -1;
    if (hasCandidates && idx === -1) {
      toast.error('Por favor, selecciona una de las imágenes candidatas antes de dibujar.');
      return;
    }
    const text = (drawConfirmText[conceptId] || '').trim();
    if (text !== 'ACTUALIZAR') {
      toast.error('Debe ingresar la palabra exacta "ACTUALIZAR" para autorizar.');
      return;
    }

    setDrawingId(conceptId);
    const toastId = toast.loading('Generando dibujo final mediante Vertex AI Imagen 4.0...');
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/symbology/draw-standard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conceptId, candidateIndex: idx })
      });
      if (response.ok) {
        toast.update(toastId, { render: 'Pictograma generado. Escribe "ACTUALIZAR" para activarlo.', type: 'success', isLoading: false, autoClose: 3500 });
        // Limpiar campos de DRAW
        setDrawConfirmText(prev => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        setSelectedCandidateIdx(prev => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        await fetchConcepts();
      } else {
        const json = await response.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo rediseñar el ícono.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (err) {
      toast.update(toastId, { render: 'Error de red al autorizar dibujo.', type: 'error', isLoading: false, autoClose: 5000 });
    } finally {
      setDrawingId(null);
    }
  };

  // Confirmar registro del dibujo
  const handleRegistrar = async (conceptId: string) => {
    const text = (registerConfirmText[conceptId] || '').trim();
    if (text !== 'ACTUALIZAR') {
      toast.error('Debe escribir la palabra exacta "ACTUALIZAR" para confirmar.');
      return;
    }

    setRegisteringId(conceptId);
    const toastId = toast.loading('Sellando y registrando ícono base estándar...');
    try {
      const response = await authFetch(`${API_BASE_URL}/vault/symbology/register-standard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conceptId,
          confirmWord: text,
          userEmail: auth.currentUser?.email || 'operador@opermaq.cl'
        })
      });
      if (response.ok) {
        toast.update(toastId, { render: 'Ícono base registrado oficialmente y consolidado.', type: 'success', isLoading: false, autoClose: 3000 });
        setRegisterConfirmText(prev => {
          const next = { ...prev };
          delete next[conceptId];
          return next;
        });
        await fetchConcepts();
      } else {
        const json = await response.json();
        toast.update(toastId, { render: `Error: ${json.error || 'No se pudo registrar.'}`, type: 'error', isLoading: false, autoClose: 5000 });
      }
    } catch (err) {
      toast.update(toastId, { render: 'Error de red al registrar.', type: 'error', isLoading: false, autoClose: 5000 });
    } finally {
      setRegisteringId(null);
    }
  };

  // Filtrado de listas en base al buscador
  const filteredConcepts = concepts.filter(c => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      (c.technical_name_es || '').toLowerCase().includes(query) ||
      (c.iso_reference || '').toLowerCase().includes(query) ||
      (c.concept_id || '').toLowerCase().includes(query)
    );
  });

  const pendingList = filteredConcepts.filter(c => c.standard_icon_status !== 'encontrado');
  const consolidatedList = filteredConcepts.filter(c => c.standard_icon_status === 'encontrado');

  // Renderizado de tarjetas de pendientes
  const renderPendingCard = (c: MasterSymbologyItem) => {
    const isSearching = searchingId === c.concept_id;
    const isDrawing = drawingId === c.concept_id;
    const isRegistering = registeringId === c.concept_id;
    const hasCandidates = !!(c.temp_icon_candidates && c.temp_icon_candidates.length > 0);
    const hasTempIcon = !!c.temp_standard_icon_url;
    const selectedIdx = selectedCandidateIdx[c.concept_id];

    return (
      <div key={c.concept_id} className="border border-[#E2E8F0] dark:border-[#12151C] p-[21px] bg-[#FFFFFF] dark:bg-[#07090D] space-y-[13px] rounded-none shadow-none select-none">
        {/* Fila superior: Info básica + Botón Buscar */}
        <div className="flex items-start justify-between gap-[13px]">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-[8px]">
              <span className="material-symbols-outlined text-[#C68346] !text-[18px]">pending</span>
              <h3 className="text-[13px] font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">{c.technical_name_es}</h3>
            </div>
            <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums select-text">{c.iso_reference}</p>
          </div>
          <button
            type="button"
            onClick={() => handleBuscar(c.concept_id, c.iso_reference)}
            disabled={isSearching || isDrawing || isRegistering}
            className="px-[13px] h-8 bg-[#C68346] text-[#FFFFFF] font-bold text-[11px] uppercase tracking-[0.05em] hover:bg-[#b07239] transition-colors border-0 cursor-pointer rounded-none shadow-none flex items-center justify-center shrink-0 disabled:opacity-40"
          >
            {isSearching ? 'Buscando...' : 'Buscar'}
          </button>
        </div>

        {/* Sección: Candidatos de Wikimedia */}
        {!hasTempIcon && hasCandidates && (
          <div className="space-y-[13px] pt-[13px] border-t border-[#E2E8F0] dark:border-[#12151C]">
            <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">Candidatos Wikimedia (selecciona para rediseñar):</p>
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
                    <div className="w-[100px] h-[100px] flex items-center justify-center bg-[#FFFFFF] overflow-hidden p-1">
                      <img
                        src={cand.url}
                        alt={`Candidato ${idx + 1}`}
                        draggable={false}
                        onContextMenu={(e) => e.preventDefault()}
                        style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                        className="max-w-full max-h-full object-contain select-none pointer-events-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectCandidate(c.concept_id, idx)}
                      aria-label={`Seleccionar candidato ${idx + 1}`}
                      title="Seleccionar candidato para dibujar"
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
                ? `Autorizar rediseño IA de la imagen candidata seleccionada (Candidato ${selectedIdx + 1}).`
                : 'No se encontraron referencias en Wikimedia. Autorizar diseño desde cero con IA.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-[8px]">
              <input
                type="text"
                value={drawConfirmText[c.concept_id] || ''}
                onChange={(e) => setDrawConfirmText(prev => ({ ...prev, [c.concept_id]: e.target.value }))}
                placeholder="Escribe ACTUALIZAR para autorizar"
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
                {isDrawing ? 'Dibujando...' : 'Autorizar DRAW'}
              </button>
            </div>
          </div>
        )}

        {/* Sección: Confirmación de Dibujo Generado */}
        {hasTempIcon && (
          <div className="border border-[#00AEEF] bg-[#F8FAFC] dark:bg-[#000000] p-[13px] space-y-[13px] rounded-none shadow-none">
            <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#00AEEF]">Propuesta de Dibujo (IA Imagen 4.0):</p>
            <div className="flex flex-col sm:flex-row gap-[13px] items-center sm:items-start">
              <div className="w-[120px] h-[120px] border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] flex items-center justify-center overflow-hidden shrink-0 p-1">
                <img
                  src={c.temp_standard_icon_url}
                  alt="Borrador IA"
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                  className="max-w-full max-h-full object-contain select-none pointer-events-none"
                />
              </div>
              <div className="flex-1 space-y-[8px] w-full">
                <label className="text-[11px] font-bold uppercase text-[#475569] dark:text-[#8A93A6] block leading-normal">
                  Escribe <span className="font-mono text-[#C68346] font-bold">"ACTUALIZAR"</span> para activar:
                </label>
                <div className="flex gap-[8px]">
                  <input
                    type="text"
                    value={registerConfirmText[c.concept_id] || ''}
                    onChange={(e) => setRegisterConfirmText(prev => ({ ...prev, [c.concept_id]: e.target.value }))}
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
                    {isRegistering ? 'Confirmando...' : 'Confirmar'}
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
  const renderConsolidatedCard = (c: MasterSymbologyItem) => {
    return (
      <div key={c.concept_id} className="border border-[#E2E8F0] dark:border-[#12151C] p-[13px] bg-[#FFFFFF] dark:bg-[#07090D] flex items-center gap-[13px] rounded-none shadow-none select-none">
        <div className="w-12 h-12 border border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-center bg-[#FFFFFF] shrink-0 overflow-hidden p-1">
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
            <span className="material-symbols-outlined text-[#5A6072] !text-[20px]">broken_image</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-[#475569] dark:text-[#8A93A6] font-mono tabular-nums select-text">{c.iso_reference}</p>
          <h4 className="text-[12px] font-bold text-[#0F172A] dark:text-[#F3F4F6] truncate uppercase">{c.technical_name_es}</h4>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-sans overflow-hidden select-none rounded-none shadow-none">
      {/* Barra Superior Minimalista Uniforme (Cero Duplicación) */}
      <header className="h-12 px-[21px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-[21px] shrink-0">
        <h1 className="text-[12px] font-mono font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] shrink-0">
          SIMBOLOGÍA
        </h1>

        <div className="relative flex-1 max-w-sm flex items-center border-b border-[#E2E8F0] dark:border-[#12151C] focus-within:border-[#C68346] rounded-none">
          <span className="material-symbols-outlined text-[16px] text-[#94A3B8] dark:text-[#5A6072]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Filtrar por denominación técnica o código ISO..."
            autoComplete="off"
            spellCheck={false}
            className="w-full h-8 px-[8px] bg-transparent text-[13px] font-sans text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] outline-none rounded-none select-text"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              title="Limpiar búsqueda"
              aria-label="Limpiar búsqueda"
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
                Pendientes de Curación
              </h2>
              <span className="font-mono tabular-nums text-[11px] font-bold text-[#C68346]">
                {pendingList.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-[21px] space-y-[21px] bg-[#FFFFFF] dark:bg-[#000000]">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <M3CircularProgress size={24} strokeWidth={3} tone="copper" />
                </div>
              ) : pendingList.length === 0 ? (
                <div className="p-[34px] text-center text-[12px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                  [Sin conceptos pendientes de curación]
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
                Consolidados ISO 7000
              </h2>
              <span className="font-mono tabular-nums text-[11px] font-bold text-[#00AEEF]">
                {consolidatedList.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-[21px] space-y-[13px] bg-[#F8FAFC] dark:bg-[#07090D]">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <M3CircularProgress size={24} strokeWidth={3} tone="copper" />
                </div>
              ) : consolidatedList.length === 0 ? (
                <div className="p-[34px] text-center text-[12px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
                  [Información técnica no declarada en ficha]
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
            <div className="flex items-center justify-center py-20">
              <M3CircularProgress size={24} strokeWidth={3} tone="copper" />
            </div>
          ) : consolidatedList.length === 0 ? (
            <div className="p-[34px] text-center text-[12px] font-mono text-[#94A3B8] dark:text-[#5A6072]">
              [Información técnica no declarada en ficha]
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
