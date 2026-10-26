import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { M3Button } from './M3Button';
import { M3IconButton } from './M3IconButton';
import { authFetch } from '../utils/authFetch';

interface VaultManagerPanelProps {
  globalAssetId: string;
  isSealed: boolean;
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponente: fila de archivo
// ─────────────────────────────────────────────────────────────────────────────

export interface VaultFile {
  id: string;
  name: string;
  url: string;
  size: number;
  createdAt: string;
}

function VaultFileRow({
  file,
  onDeleteFile,
  isSealed
}: { 
  file: VaultFile;
  onDeleteFile: (fileId: string) => void;
  isSealed: boolean;
}) {
  const { t } = useTranslation();
  const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
  const createdAtDate = new Date(file.createdAt).toLocaleDateString('es-CL');

  return (
    <div className="flex items-center gap-3 p-3 bg-surface border border-border-base/50 hover:border-border-base transition-colors">
      <span className="material-symbols-outlined text-foreground/40 shrink-0">insert_drive_file</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground truncate">{file.name}</p>
        <p className="text-xs text-foreground/60">{fileSizeMB} MB · {createdAtDate}</p>
      </div>
      <M3IconButton
        icon="delete"
        onClick={() => onDeleteFile(file.id)}
        variant="ghost"
        className={`!text-error/60 hover:!text-error ${isSealed ? 'opacity-30 cursor-not-allowed' : ''}`}
        disabled={isSealed}
      >
        {t('actions.delete')}
      </M3IconButton>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel Principal
// ─────────────────────────────────────────────────────────────────────────────

export function VaultManagerPanel({ globalAssetId, isSealed, onClose }: VaultManagerPanelProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [confirmModal, setConfirmModal] = useState({
    show: false,
    title: '',
    message: '',
    onConfirm: async () => {},
  });

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch(`/api/vault/corpus-files?globalAssetId=${globalAssetId}`);
      if (!response.ok) throw new Error('Error fetching files');
      const data = await response.json();
      setFiles(data.files.map((f: Record<string, unknown>) => ({
        id: f.id,
        name: f.name,
        url: f.url,
        size: f.size,
        createdAt: f.createdAt,
      })));
    } catch (err) {
      console.error('Error fetching vault files:', err);
      toast.error(t('vault_manager.error_fetch_files') || 'Error al cargar archivos.');
    } finally {
      setLoading(false);
    }
  }, [globalAssetId, t]); // Added t to dependencies

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setSelectedFile(event.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    const toastId = toast.loading(t('vault_manager.upload_in_progress') || 'Subiendo archivo…');

    const formData = new FormData();
    formData.append('pdf', selectedFile);
    formData.append('globalAssetId', globalAssetId);
    // makeModel y category ya no son necesarios para ingest-pdf v2.0
    formData.append('makeModel', 'DEFAULT'); // TEMPORAL: Se requiere en backend pero no se usa

    try {
      const response = await authFetch('/api/vault/ingest-pdf', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al subir y procesar PDF');
      }

      toast.update(toastId, {
        render: t('vault_manager.upload_success') || 'Archivo subido y procesado.',
        type: 'success',
        isLoading: false,
        autoClose: 3000,
      });
      setSelectedFile(null);
      fetchFiles(); // Recargar la lista de archivos
    } catch (err: unknown) {
      console.error('Error uploading file:', err);
      toast.update(toastId, {
        render: `${t('vault_manager.error_upload') || 'Error al subir:'} ${err instanceof Error ? err.message : String(err)}`,
        type: 'error',
        isLoading: false,
        autoClose: 5000,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = (fileId: string) => {
    setConfirmModal({
      show: true,
      title: t('vault_manager.confirm_delete_title') || 'Confirmar Eliminación',
      message: t('vault_manager.confirm_delete_message') || '¿Está seguro de que desea eliminar este archivo? Esta acción es irreversible.',
      onConfirm: async () => {
        setLoading(true);
        try {
          const response = await authFetch(`/api/vault/corpus-files/${fileId}?globalAssetId=${globalAssetId}`, {
            method: 'DELETE',
          });
          if (!response.ok) throw new Error('Error deleting file');
          toast.success(t('vault_manager.delete_success') || 'Archivo eliminado.');
          fetchFiles();
        } catch (err) {
          console.error('Error deleting file:', err);
          toast.error(t('vault_manager.error_delete') || 'Error al eliminar archivo.');
        } finally {
          setLoading(false);
          setConfirmModal(prev => ({ ...prev, show: false }));
        }
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col font-atkinson text-foreground transition-all duration-300">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-border-base shrink-0">
        <div className="flex items-center gap-3">
          <M3IconButton icon="arrow_back" onClick={onClose} variant="ghost" className="!text-[20px]" />
          <h2 className="text-xl font-black uppercase tracking-tight">{t('vault_manager.title')}</h2>
        </div>
        <M3Button 
          onClick={handleUpload} 
          disabled={!selectedFile || uploading || isSealed}
          loading={uploading}
          icon="upload_file"
          variant="primary"
        >
          {t('vault_manager.upload_btn')}
        </M3Button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Sección de Subida */}
        <div className="bg-surface p-4 border border-border-base space-y-4">
          <p className="text-sm font-bold text-foreground/80">{t('vault_manager.upload_section_title')}</p>
          <input 
            type="file" 
            accept="application/pdf" 
            onChange={handleFileChange} 
            className="w-full text-sm text-foreground/80 file:mr-4 file:py-2 file:px-4 file:rounded-none file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-on-primary hover:file:bg-primary-hover"
            disabled={uploading || isSealed}
          />
          {!selectedFile && <p className="text-xs text-foreground/60">{t('vault_manager.no_file_selected')}</p>}
        </div>

        {/* Lista de Archivos Existentes */}
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm font-bold text-foreground/80">
            <h3>{t('vault_manager.existing_files_title')} ({files.length})</h3>
            {loading && <span className="material-symbols-outlined animate-spin text-foreground/40 !text-[16px]">progress_activity</span>}
          </div>
          {files.length === 0 && !loading ? (
            <div className="text-center py-12 border border-dashed border-border-base text-foreground/40">
              <p>{t('vault_manager.no_existing_files')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {files.map(file => (
                <VaultFileRow key={file.id} file={file} onDeleteFile={handleDeleteFile} isSealed={isSealed} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal de Confirmación */}
      {confirmModal.show && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl max-w-sm w-full p-6 text-foreground font-atkinson border border-border-base">
            <h3 className="text-xl font-bold mb-2 text-foreground">{confirmModal.title}</h3>
            <p className="text-sm opacity-70 mb-6 text-foreground">{confirmModal.message}</p>
            <div className="flex justify-end gap-2">
              <M3Button variant="ghost" onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}>
                {t('actions.cancel') || 'Cancelar'}
              </M3Button>
              <M3Button onClick={confirmModal.onConfirm} className="bg-red-600 text-white hover:bg-red-700 hover:text-white">
                {t('actions.confirm') || 'Confirmar'}
              </M3Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VaultManagerPanel;
