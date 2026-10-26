import React, { useState } from 'react';
import { db } from '../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import { M3Button } from './M3Button';
import { M3IconButton } from './M3IconButton';
import { toast } from 'react-toastify';

export interface ExtractedRow {
  [key: string]: string;
}


interface M3IndexEditorModalProps {
  globalAssetId: string;
  dimension: string;       // e.g. 'operation'
  indexKey: string;        // e.g. 'SISTEMA_HIDRAULICO'
  label: string;
  extractedData: ExtractedRow[];
  onClose: () => void;
  onSaved: () => void;
}

export const M3IndexEditorModal: React.FC<M3IndexEditorModalProps> = ({
  globalAssetId,
  dimension,
  indexKey,
  label,
  extractedData,
  onClose,
  onSaved,
}) => {
  const [rows, setRows] = useState<ExtractedRow[]>(
    extractedData.length > 0 ? extractedData.map(r => ({ ...r })) : [{}]
  );
  const [isSaving, setIsSaving] = useState(false);

  const allKeys = Array.from(
    new Set(rows.flatMap(r => Object.keys(r)))
  ).filter(k => k !== '__proto__');

  const handleCellChange = (rowIdx: number, key: string, value: string) => {
    setRows(prev => {
      const updated = [...prev];
      updated[rowIdx] = { ...updated[rowIdx], [key]: value };
      return updated;
    });
  };

  const handleAddRow = () => setRows(prev => [...prev, {}]);

  const handleDeleteRow = (idx: number) =>
    setRows(prev => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const fieldPath = `knowledge_vault.${dimension}.indices.${indexKey}.extracted_data`;
      await updateDoc(doc(db, 'global_asset_catalog', globalAssetId), {
        [fieldPath]: rows,
      });
      toast.success('Índice actualizado por especialista HITL.');
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar. Verifica permisos Firestore.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-background border border-border-base w-full max-w-3xl max-h-[90vh] flex flex-col font-sans shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 dark:border-white/5">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-1 h-3 bg-copper" />
              <span className="text-[9px] font-black tracking-widest text-black/30 dark:text-white/20 uppercase">
                HITL · EDICIÓN MANUAL
              </span>
            </div>
            <h3 className="text-base font-black uppercase tracking-tight text-foreground mt-1">
              {label || indexKey}
            </h3>
            <p className="text-[9px] text-muted uppercase tracking-widest">{dimension} › {indexKey}</p>
          </div>
          <M3IconButton icon="close" variant="ghost" onClick={onClose} className="!text-black/30 dark:!text-white/30" />
        </div>

        {/* Table Editor */}
        <div className="flex-1 overflow-auto p-6">
          {allKeys.length === 0 ? (
            <p className="text-[10px] text-black/30 italic text-center py-8">
              Sin campos detectados. Añade una fila para comenzar.
            </p>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10">
                  {allKeys.map(k => (
                    <th key={k} className="text-left font-black uppercase tracking-widest text-[9px] text-black/40 dark:text-white/30 pb-2 pr-3">
                      {k}
                    </th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rIdx) => (
                  <tr key={rIdx} className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    {allKeys.map(k => (
                      <td key={k} className="pr-3 py-1.5">
                        <input
                          className="w-full bg-transparent border-b border-border-base focus:border-copper outline-none text-foreground py-0.5 text-[11px] font-medium transition-colors"
                          value={String(row[k] ?? '')}
                          onChange={e => handleCellChange(rIdx, k, e.target.value)}
                          autoComplete="off"
                        />
                      </td>
                    ))}
                    <td>
                      <M3IconButton
                        icon="delete"
                        variant="ghost"
                        className="!text-red-400/60 hover:!text-red-500"
                        onClick={() => handleDeleteRow(rIdx)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <button
            onClick={handleAddRow}
            className="mt-4 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-copper/60 hover:text-copper transition-colors"
          >
            <span className="material-symbols-outlined !text-[14px]">add</span>
            AÑADIR FILA
          </button>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-black/5 dark:border-white/5">
          <M3Button variant="ghost" onClick={onClose}>CANCELAR</M3Button>
          <M3Button
            variant="primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'GUARDANDO...' : 'GUARDAR CORRECCIÓN'}
          </M3Button>
        </div>
      </div>
    </div>
  );
};

export default M3IndexEditorModal;
