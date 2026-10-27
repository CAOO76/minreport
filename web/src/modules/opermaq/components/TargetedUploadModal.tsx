import React, { useState } from 'react';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import { useTranslation } from 'react-i18next';
import { M3Button } from './M3Button';
import { M3IconButton } from './M3IconButton';

interface TargetedUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  assetId: string;
  pillar?: string;
  onUploadSuccess: () => void;
}

/**
 * STITCH-UI-Governance: TargetedUploadModal
 * Modal de Drag & Drop para ingesta dirigida.
 */
const TargetedUploadModal: React.FC<TargetedUploadModalProps> = ({
  isOpen,
  onClose,
  assetId,
  pillar,
  onUploadSuccess
}) => {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    if (pillar) formData.append('pillar', pillar);

    try {
      const response = await authFetch(`${API_BASE_URL}/assets/${assetId}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        onUploadSuccess();
        onClose();
      } else {
        console.error('Upload failed');
      }
    } catch (error) {
      console.error('Error uploading:', error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-neutral-900 w-full max-w-md border border-neutral-200 dark:border-neutral-800 rounded-none shadow-none overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-100 dark:border-neutral-800">
          <h3 className="text-lg font-bold uppercase tracking-tight text-neutral-900 dark:text-neutral-100">
            {pillar ? `${t('detail.upload_manual')}: ${pillar}` : t('detail.upload_title')}
          </h3>
          <M3IconButton onClick={onClose} icon="close" variant="ghost" />
        </div>

        {/* Content */}
        <div className="p-6">
          <div 
            className={`border-2 border-dashed p-8 text-center transition-colors cursor-pointer rounded-none
              ${file ? 'border-copper bg-copper/5' : 'border-neutral-300 dark:border-neutral-700 hover:border-copper/50'}`}
            onClick={() => document.getElementById('fileInput')?.click()}
          >
            <input 
              id="fileInput" 
              type="file" 
              className="hidden" 
              onChange={handleFileChange}
              accept=".pdf,.png,.jpg,.jpeg"
              autoComplete="off"
            />
            {file ? (
              <div className="flex flex-col items-center">
                <span className="material-symbols-outlined text-copper mb-2 !text-[40px]">description</span>
                <span className="text-sm font-medium truncate max-w-full text-neutral-800 dark:text-neutral-200">
                  {file.name}
                </span>
                <span className="text-xs text-neutral-500 mt-1">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <span className="material-symbols-outlined text-neutral-400 mb-2 !text-[40px]">upload_file</span>
                <span className="text-sm font-bold uppercase tracking-widest text-neutral-600 dark:text-neutral-400">
                  {t('detail.drag_drop')}
                </span>
                <span className="text-xs text-neutral-500 mt-2">
                  {t('detail.file_types')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 bg-neutral-50 dark:bg-neutral-950/50 border-t border-neutral-100 dark:border-neutral-800">
          <M3Button 
            onClick={onClose} 
            variant="ghost"
          >
            {t('common.cancel', 'Cancelar')}
          </M3Button>
          <M3Button 
            disabled={!file || uploading}
            onClick={handleUpload}
            variant="primary"
          >
            {uploading ? t('detail.processing') : t('detail.confirm_upload')}
          </M3Button>
        </div>

      </div>
    </div>
  );
};

export default TargetedUploadModal;
