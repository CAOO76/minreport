import React, { useState, useEffect, useCallback } from 'react';
import { M3Button } from './M3Button';
import { M3IconButton } from './M3IconButton';
import { M3TextField } from './M3TextField';
import { M3Select } from './M3Select';
import { authFetch } from '../utils/authFetch';
import { toast } from 'react-toastify';
import { useCurrentUser } from '../hooks/useCurrentUser';

interface PendingItem {
  globalAssetId: string;
  makeModel: string;
  pillarId: string;
  itemId: string;
  title: string;
  content: string;
  estado_aprobacion: string;
  hunted_at: string;
  review_notes?: string;
}

const PILLAR_LABELS: Record<string, string> = {
  ficha_tecnica: 'Ficha Técnica',
  manual_operaciones: 'Operaciones',
  pauta_mantencion: 'Mantención',
  matriz_riesgos: 'Matriz Riesgos',
  checklist_pre_op: 'Checklist Pre-op',
};

export const VaultReviewDashboard: React.FC = () => {
  useCurrentUser();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPillar, setFilterPillar] = useState('all');
  const [filterStatus] = useState('all');
  
  // HITL v2.0 State
  const [selectedItem, setSelectedItem] = useState<PendingItem | null>(null);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await authFetch(`/api/vault/pending-review?pillarId=${filterPillar}`);
      const data = await resp.json();
      if (data.success) {
        setItems(data.items);
        // Clear selection if no longer in list
        if (selectedItem && !data.items.find((it: Record<string, unknown>) => it.itemId === selectedItem.itemId)) {
          setSelectedItem(null);
        }
      }
    } catch (err) {
      console.error('Error fetching pending items:', err);
      toast.error('Error al sincronizar ítems.');
    } finally {
      setLoading(false);
    }
  }, [filterPillar, selectedItem]);

  useEffect(() => {
    fetchPending();
  }, [filterPillar, filterStatus, fetchPending]);

  useEffect(() => {
    if (selectedItem) {
      setEditContent(selectedItem.content || '');
      setReviewNotes(selectedItem.review_notes || '');
    }
  }, [selectedItem]);

  const handleSelectItem = (item: PendingItem) => {
    setSelectedItem(item);
  };

  const handleToggleCheck = (itemId: string) => {
    const next = new Set(checkedItems);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    setCheckedItems(next);
  };

  const handleBulkApprove = async () => {
    if (checkedItems.size === 0) return;
    
    const itemsToApprove = items
      .filter(it => checkedItems.has(it.itemId))
      .map(it => ({
        globalAssetId: it.globalAssetId,
        pillarId: it.pillarId,
        itemId: it.itemId
      }));

    setSaving(true);
    try {
      const resp = await authFetch('/api/vault/bulk-approve', {
        method: 'POST',
        body: JSON.stringify({ items: itemsToApprove })
      });
      const data = await resp.json();
      if (data.success) {
        toast.success(`${data.approved} ítems aprobados correctamente.`);
        setCheckedItems(new Set());
        fetchPending();
      }
    } catch (_err) {
      toast.error('Error en aprobación masiva.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async (status: 'APROBADO_HUMANO' | 'REQUIERE_CAMBIOS') => {
    if (!selectedItem) return;

    if (status === 'REQUIERE_CAMBIOS' && !reviewNotes.trim()) {
      toast.warn('Por favor, indica qué cambios se requieren.');
      return;
    }

    setSaving(true);
    try {
      const resp = await authFetch('/api/vault/update-item-approval-state', {
        method: 'POST',
        body: JSON.stringify({
          globalAssetId: selectedItem.globalAssetId,
          pillarId: selectedItem.pillarId,
          itemId: selectedItem.itemId,
          nuevo_estado: status,
          review_notes: reviewNotes
        })
      });
      const data = await resp.json();
      if (data.success) {
        toast.success(`Ítem ${status === 'APROBADO_HUMANO' ? 'aprobado' : 'marcado para corrección'}.`);
        fetchPending();
      }
    } catch (_err) {
      toast.error('Error al actualizar estado.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveContent = async () => {
    if (!selectedItem) return;
    
    setSaving(true);
    try {
      const resp = await authFetch('/api/vault/update-item-content', {
        method: 'POST',
        body: JSON.stringify({
          globalAssetId: selectedItem.globalAssetId,
          pillarId: selectedItem.pillarId,
          itemId: selectedItem.itemId,
          newContent: editContent
        })
      });
      const data = await resp.json();
      if (data.success) {
        toast.success('Contenido actualizado correctamente.');
        // Update local items to reflect change without full fetch
        setItems(prev => prev.map(it => 
          it.itemId === selectedItem.itemId ? { ...it, content: editContent } : it
        ));
      }
    } catch (_err) {
      toast.error('Error al guardar cambios.');
    } finally {
      setSaving(false);
    }
  };

  const filteredItems = items.filter(it => {
    if (filterStatus === 'all') return true;
    return it.estado_aprobacion === filterStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APROBADO_HUMANO': return 'text-green-400';
      case 'REQUIERE_CAMBIOS': return 'text-amber-400';
      case 'GENERADO_IA': return 'text-blue-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0A0A0A] text-white font-atkinson overflow-hidden">
      {/* TOP HEADER */}
      <div className="flex justify-between items-center p-6 border-b border-white/5 bg-[#0F0F0F]">
        <div>
          <h1 className="text-xl font-black uppercase tracking-tighter flex items-center gap-3">
            <span className="material-symbols-outlined text-[#C68346]">engineering</span>
            HITL Engine <span className="text-[#C68346] opacity-50">v2.0</span>
          </h1>
          <p className="text-[10px] opacity-40 uppercase tracking-widest mt-1">
            Gobernanza de Datos Industriales • Opermaq Bóveda
          </p>
        </div>
        
        <div className="flex gap-4 items-center">
          <M3Select
            label="Filtrar Pilar"
            value={filterPillar}
            onChange={(e) => setFilterPillar(e.target.value)}
            options={[
              { value: 'all', label: 'Todos los Pilares' },
              ...Object.entries(PILLAR_LABELS).map(([k, v]) => ({ value: k, label: v }))
            ]}
          />
          <M3IconButton icon="refresh" onClick={fetchPending} />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANEL: ITEM LIST */}
        <div className="w-[400px] border-r border-white/5 flex flex-col bg-[#0F0F0F]">
          <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">
              {filteredItems.length} Ítems Pendientes
            </span>
            {checkedItems.size > 0 && (
              <M3Button variant="secondary" className="!h-10 !text-[10px]" onClick={handleBulkApprove} disabled={saving}>
                <span className="flex items-center gap-2">
                  APROBAR ({checkedItems.size}) <span className="material-symbols-outlined text-xs">done_all</span>
                </span>
              </M3Button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full opacity-20">
                <span className="material-symbols-outlined animate-spin text-4xl">sync</span>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full opacity-20 p-8 text-center">
                <span className="material-symbols-outlined text-4xl">inventory_2</span>
                <p className="text-xs mt-4 uppercase">No hay ítems que requieran atención inmediata.</p>
              </div>
            ) : (
              filteredItems.map((item) => (
                <div 
                  key={item.itemId}
                  className={`p-4 border-b border-white/5 cursor-pointer transition-all flex gap-3 group
                    ${selectedItem?.itemId === item.itemId ? 'bg-[#C68346]/10 border-l-4 border-l-[#C68346]' : 'hover:bg-white/[0.03] border-l-4 border-l-transparent'}
                  `}
                  onClick={() => handleSelectItem(item)}
                >
                  <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                    <input 
                      type="checkbox" 
                      checked={checkedItems.has(item.itemId)}
                      onChange={() => handleToggleCheck(item.itemId)}
                      className="accent-[#C68346] w-4 h-4 cursor-pointer"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-[9px] font-bold text-[#C68346] uppercase truncate w-2/3">
                        {item.makeModel}
                      </span>
                      <span className={`text-[8px] font-bold px-1 py-0.5 bg-white/5 ${getStatusColor(item.estado_aprobacion)}`}>
                        {item.estado_aprobacion.replace('APROBADO_HUMANO', 'APROBADO')}
                      </span>
                    </div>
                    <h3 className="text-xs font-medium truncate opacity-90 group-hover:opacity-100 transition-opacity">
                      {item.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[9px] opacity-30 uppercase tracking-tighter">
                        {PILLAR_LABELS[item.pillarId] || item.pillarId}
                      </span>
                      <span className="text-[9px] opacity-20">•</span>
                      <span className="text-[9px] opacity-30">
                        {item.hunted_at ? new Date(item.hunted_at).toLocaleDateString() : 'SIN FECHA'}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT PANEL: ITEM DETAIL & EDITOR */}
        <div className="flex-1 flex flex-col bg-[#0A0A0A] relative">
          {selectedItem ? (
            <>
              {/* DETAIL HEADER */}
              <div className="p-6 border-b border-white/5 flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[10px] bg-white/10 px-2 py-0.5 uppercase tracking-widest font-bold">
                      {PILLAR_LABELS[selectedItem.pillarId] || selectedItem.pillarId}
                    </span>
                    <span className="text-[10px] opacity-30 font-mono">ID: {selectedItem.itemId}</span>
                  </div>
                  <h2 className="text-2xl font-black uppercase tracking-tight leading-none mb-1">
                    {selectedItem.title}
                  </h2>
                  <p className="text-xs opacity-50 uppercase tracking-widest font-bold">
                    ASIGNADO A: <span className="text-white">{selectedItem.makeModel}</span>
                  </p>
                </div>

                <div className="flex gap-2">
                  <M3Button variant="secondary" onClick={() => window.open(`/admin/assets/${selectedItem.globalAssetId}`, '_blank')}>
                    VER ACTIVO
                  </M3Button>
                </div>
              </div>

              {/* EDITOR AREA */}
              <div className="flex-1 p-6 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
                <div className="flex-1 flex flex-col">
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-2 flex justify-between">
                    <span>Contenido Técnico (Markdown)</span>
                    <span className="text-[#C68346] cursor-help" title="Edición directa de la base de conocimientos">INLINE EDITOR</span>
                  </label>
                  <textarea
                    className="flex-1 bg-white/[0.03] border border-white/10 p-4 text-sm font-mono text-white/80 focus:text-white focus:border-[#C68346]/50 focus:outline-none transition-all resize-none leading-relaxed"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    placeholder="Contenido generado por IA..."
                  />
                  <div className="mt-2 flex justify-end">
                    <M3Button 
                      variant="primary" 
                      className="!h-10 !text-[10px]" 
                      onClick={handleSaveContent} 
                      disabled={saving || editContent === selectedItem.content}
                    >
                      <span className="flex items-center gap-2">
                        GUARDAR CAMBIOS <span className="material-symbols-outlined text-xs">save</span>
                      </span>
                    </M3Button>
                  </div>
                </div>

                <div className="p-4 bg-white/[0.02] border border-white/5">
                  <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 mb-2 block">
                    Notas de Revisión / Feedback
                  </label>
                  <M3TextField
                    label="Notas de Revisión / Feedback"
                    multiline
                    rows={2}
                    placeholder="Indica observaciones si el ítem requiere corrección..."
                    value={reviewNotes}
                    onChange={setReviewNotes}
                  />
                </div>
              </div>

              {/* BOTTOM ACTIONS */}
              <div className="p-6 border-t border-white/5 flex justify-between items-center bg-[#0F0F0F]">
                <div className="flex gap-4">
                  <M3Button 
                    variant="secondary" 
                    className="!text-amber-500 hover:!bg-amber-500/10 border border-amber-500/20"
                    onClick={() => handleUpdateStatus('REQUIERE_CAMBIOS')}
                    disabled={saving}
                  >
                    <span className="flex items-center gap-2">
                      SOLICITAR CAMBIOS <span className="material-symbols-outlined text-sm">edit_note</span>
                    </span>
                  </M3Button>
                </div>
                
                <M3Button 
                  variant="primary" 
                  className="px-12 h-14 !text-lg !font-black !tracking-tighter !bg-green-600 hover:!bg-green-500"
                  onClick={() => handleUpdateStatus('APROBADO_HUMANO')}
                  disabled={saving}
                >
                  <span className="flex items-center gap-3">
                    APROBAR ÍTEM <span className="material-symbols-outlined text-xl">verified</span>
                  </span>
                </M3Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center opacity-10">
              <span className="material-symbols-outlined text-[120px]">overview_key</span>
              <p className="text-xl font-black uppercase tracking-widest mt-4">
                Selecciona un ítem para revisar
              </p>
            </div>
          )}
          
          {saving && (
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
              <div className="flex flex-col items-center gap-4">
                <span className="material-symbols-outlined animate-spin text-4xl text-[#C68346]">sync</span>
                <span className="text-[10px] font-black uppercase tracking-[0.2em]">Procesando cambios...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(198, 131, 70, 0.2);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(198, 131, 70, 0.4);
        }
      `}</style>
    </div>
  );
};
