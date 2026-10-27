import React, { useState, useEffect } from 'react';
import { auth, API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import { toast } from 'react-toastify';
import type { MasterSymbologyItem } from '../backend/types/schema';

export const GlobalSymbologyDashboard: React.FC = () => {
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
        toast.update(toastId, { render: '✓ Búsqueda completada. Selecciona un candidato para dibujar.', type: 'success', isLoading: false, autoClose: 3500 });
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
    const text = (drawConfirmText[conceptId] || '').toLowerCase().trim();
    if (text !== 'dibujar') {
      toast.error('Debe ingresar la palabra exacta "dibujar" para autorizar.');
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
        toast.update(toastId, { render: '✓ Pictograma generado. Escribe "registrar" para activarlo.', type: 'success', isLoading: false, autoClose: 3500 });
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
    const text = (registerConfirmText[conceptId] || '').toLowerCase().trim();
    if (text !== 'registrar') {
      toast.error('Debe escribir la palabra exacta "registrar" para confirmar.');
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
        toast.update(toastId, { render: '✓ Ícono base registrado oficialmente y consolidado.', type: 'success', isLoading: false, autoClose: 3000 });
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
      <div key={c.concept_id} className="border border-black/10 dark:border-white/10 p-5 bg-white dark:bg-zinc-950 space-y-4 rounded-none shadow-none">
        {/* Fila superior: Info básica + Botón Buscar */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-500 !text-[18px]">pending</span>
              <h3 className="text-[13px] font-black uppercase text-foreground truncate">{c.technical_name_es}</h3>
            </div>
            <p className="text-[10px] text-foreground/45 font-mono">{c.iso_reference}</p>
          </div>
          <button
            onClick={() => handleBuscar(c.concept_id, c.iso_reference)}
            disabled={isSearching || isDrawing || isRegistering}
            className="px-4 h-8 bg-copper text-white font-black text-[10px] uppercase tracking-wider hover:bg-copper/90 transition-colors border-0 cursor-pointer rounded-none flex items-center justify-center shrink-0"
          >
            {isSearching ? (
              <>
                <span className="material-symbols-outlined animate-spin !text-[12px] mr-1">progress_activity</span>
                Buscando...
              </>
            ) : (
              'Buscar'
            )}
          </button>
        </div>

        {/* Sección: Candidatos de Wikimedia */}
        {!hasTempIcon && hasCandidates && (
          <div className="space-y-3 pt-3 border-t border-black/5 dark:border-white/5">
            <p className="text-[9px] font-black uppercase tracking-wider text-foreground/50">Candidatos Wikimedia (selecciona para rediseñar):</p>
            <div className="grid grid-cols-3 gap-3">
              {c.temp_icon_candidates?.map((cand, idx) => {
                const isSelected = selectedIdx === idx;
                return (
                  <div
                    key={idx}
                    className={`border p-2 flex flex-col items-center justify-between bg-black/[0.01] dark:bg-white/[0.01] transition-all ${
                      isSelected ? 'border-copper bg-copper/[0.03]' : 'border-black/10 dark:border-white/10'
                    }`}
                  >
                    <div className="w-[100px] h-[100px] flex items-center justify-center bg-white overflow-hidden p-1">
                      <img src={cand.url} alt={`Candidato ${idx + 1}`} className="max-w-full max-h-full object-contain" />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectCandidate(c.concept_id, idx)}
                      className={`w-full mt-2 h-7 flex items-center justify-center rounded-none transition-all cursor-pointer border ${
                        isSelected
                          ? 'bg-copper text-white border-copper'
                          : 'bg-transparent text-foreground/60 border-black/15 hover:text-foreground'
                      }`}
                      title="Seleccionar candidato para dibujar"
                    >
                      <span className="material-symbols-outlined !text-[16px]">draw</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Sección: Autorización de dibujo (DRAW) */}
        {!hasTempIcon && (selectedIdx !== undefined || c.standard_icon_status === 'pendiente_dibujo_humano') && (
          <div className="bg-amber-500/[0.02] border border-amber-500/15 p-3 space-y-3 rounded-none">
            <p className="text-[10px] text-amber-600 dark:text-amber-500 font-bold leading-normal">
              {selectedIdx !== undefined
                ? `Autorizar rediseño IA de la imagen candidata seleccionada (Candidato ${selectedIdx + 1}).`
                : 'No se encontraron referencias en Wikimedia. Autorizar diseño desde cero con IA.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={drawConfirmText[c.concept_id] || ''}
                onChange={(e) => setDrawConfirmText(prev => ({ ...prev, [c.concept_id]: e.target.value }))}
                placeholder="Escribe 'dibujar' para autorizar"
                autoComplete="off"
                disabled={isDrawing}
                className="px-3 h-8 text-[11px] bg-white dark:bg-zinc-950 border border-black/10 focus:border-copper outline-none font-sans text-center flex-1 rounded-none"
              />
              <button
                type="button"
                onClick={() => handleAutorizarDraw(c.concept_id, hasCandidates)}
                disabled={isDrawing || (drawConfirmText[c.concept_id] || '').toLowerCase().trim() !== 'dibujar'}
                className="px-4 h-8 bg-copper hover:bg-copper/90 text-white font-black text-[10px] uppercase tracking-wider disabled:opacity-40 transition-colors border-0 cursor-pointer rounded-none flex items-center justify-center shrink-0"
              >
                {isDrawing ? (
                  <>
                    <span className="material-symbols-outlined animate-spin !text-[12px] mr-1">progress_activity</span>
                    Dibujando...
                  </>
                ) : (
                  'Autorizar DRAW'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Sección: Confirmación de Dibujo Generado */}
        {hasTempIcon && (
          <div className="border border-emerald-500/20 bg-emerald-500/[0.02] p-4 space-y-3 rounded-none">
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-500">Propuesta de Dibujo (IA Imagen 4.0):</p>
            <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
              <div className="w-[120px] h-[120px] border border-black/10 bg-white flex items-center justify-center overflow-hidden shrink-0 p-1">
                <img src={c.temp_standard_icon_url} alt="Borrador IA" className="max-w-full max-h-full object-contain" />
              </div>
              <div className="flex-1 space-y-2 w-full">
                <label className="text-[9.5px] font-black uppercase text-foreground/60 block leading-normal">
                  Escribe <span className="font-mono text-copper font-black">"registrar"</span> para activar:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={registerConfirmText[c.concept_id] || ''}
                    onChange={(e) => setRegisterConfirmText(prev => ({ ...prev, [c.concept_id]: e.target.value }))}
                    placeholder="registrar"
                    autoComplete="off"
                    disabled={isRegistering}
                    className="px-3 h-8 text-[11px] bg-white dark:bg-zinc-950 border border-black/10 focus:border-copper outline-none font-sans text-center flex-1 rounded-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleRegistrar(c.concept_id)}
                    disabled={isRegistering || (registerConfirmText[c.concept_id] || '').toLowerCase().trim() !== 'registrar'}
                    className="px-4 h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-wider disabled:opacity-40 transition-colors border-0 cursor-pointer rounded-none flex items-center justify-center shrink-0"
                  >
                    {isRegistering ? (
                      <>
                        <span className="material-symbols-outlined animate-spin !text-[12px] mr-1">progress_activity</span>
                        Confirmando...
                      </>
                    ) : (
                      'Confirmar'
                    )}
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
      <div key={c.concept_id} className="border border-black/10 dark:border-white/10 p-3 bg-white dark:bg-zinc-950 flex items-center gap-4 rounded-none shadow-none">
        <div className="w-12 h-12 border border-black/5 flex items-center justify-center bg-white shrink-0 overflow-hidden p-1">
          {c.standard_icon_url ? (
            <img src={c.standard_icon_url} alt={c.technical_name_es} className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="material-symbols-outlined text-foreground/20 !text-[20px]">broken_image</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] text-foreground/45 font-mono">{c.iso_reference}</p>
          <h4 className="text-[12px] font-black text-foreground truncate uppercase">{c.technical_name_es}</h4>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground font-atkinson overflow-hidden transition-colors duration-300">
      {/* Header global */}
      <header className="flex flex-col gap-4 p-6 border-b border-black/[0.08] dark:border-white/[0.08] bg-surface/30 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-foreground !text-[24px]">dangerous</span>
            <h1 className="text-[18px] font-black uppercase tracking-wider text-foreground">Simbología Global</h1>
          </div>

        </div>

        <div className="relative max-w-md w-full">
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Buscar por nombre o ISO..."
            autoComplete="off"
            className="w-full h-9 pl-9 pr-3 text-[12px] bg-transparent border border-black/10 dark:border-white/15 focus:border-copper outline-none transition-all font-sans"
          />
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/40 !text-[16px]">search</span>
        </div>
      </header>

      {/* Main de 2 columnas */}
      <div className="flex-1 flex overflow-hidden min-h-0 divide-x divide-black/[0.08] dark:divide-white/[0.08]">
        {/* Columna Izquierda: PENDIENTES */}
        <section className="flex-1 flex flex-col h-full overflow-hidden">
          <div className="p-4 border-b border-black/[0.08] dark:border-white/[0.08] bg-black/[0.01] dark:bg-white/[0.01] flex items-center gap-2 shrink-0">
            <span className="material-symbols-outlined text-amber-500 !text-[20px]">pending</span>
            <h2 className="text-[12px] font-black uppercase tracking-wider text-foreground">Pendientes ({pendingList.length})</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/[0.01] dark:bg-white/[0.01]">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <span className="material-symbols-outlined animate-spin text-copper !text-2xl">progress_activity</span>
                <span className="text-[10px] uppercase font-black tracking-widest text-foreground/40">Cargando...</span>
              </div>
            ) : pendingList.length === 0 ? (
              <div className="p-8 text-center text-[11px] text-foreground/40 italic font-sans">
                No hay símbolos pendientes de procesar.
              </div>
            ) : (
              pendingList.map(c => renderPendingCard(c))
            )}
          </div>
        </section>

        {/* Columna Derecha: CONSOLIDADOS */}
        <section className="flex-1 flex flex-col h-full overflow-hidden">
          <div className="p-4 border-b border-black/[0.08] dark:border-white/[0.08] bg-black/[0.01] dark:bg-white/[0.01] flex items-center gap-2 shrink-0">
            <span className="material-symbols-outlined text-foreground !text-[20px]">dangerous</span>
            <h2 className="text-[12px] font-black uppercase tracking-wider text-foreground">Consolidados ({consolidatedList.length})</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <span className="material-symbols-outlined animate-spin text-copper !text-2xl">progress_activity</span>
                <span className="text-[10px] uppercase font-black tracking-widest text-foreground/40">Cargando...</span>
              </div>
            ) : consolidatedList.length === 0 ? (
              <div className="p-8 text-center text-[11px] text-foreground/40 italic font-sans">
                No hay símbolos consolidados.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {consolidatedList.map(c => renderConsolidatedCard(c))}
              </div>
            )}
          </div>
        </section>
      </div>


    </div>
  );
};
