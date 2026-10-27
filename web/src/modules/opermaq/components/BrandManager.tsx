import { useState } from 'react';
import { db, storage } from '../firebase/config';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc } from 'firebase/firestore';
import { useBrandConfig, type BrandConfig } from '../hooks/useBrandConfig';
import { M3IconButton } from './M3IconButton';
import { M3ConfirmModal } from './M3ConfirmModal';
import { useTranslation } from 'react-i18next';

/**
 * BrandManager: Panel de control de identidad visual unificada (settings/branding)
 */
export function BrandManager() {
  const { t } = useTranslation();
  const { brand, loading } = useBrandConfig();
  const [uploading, setUploading] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ show: boolean; type: keyof BrandConfig | null }>({ show: false, type: null });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: keyof BrandConfig) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(type);
    try {
      const storageRef = ref(storage, `brand/${type}_${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      const docRef = doc(db, 'settings', 'branding');
      await setDoc(docRef, {
        [type]: url,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.error("Error uploading logo:", err);
    } finally {
      setUploading(null);
    }
  };

  const removeLogo = async (type: keyof BrandConfig) => {
    setConfirmModal({ show: true, type });
  };

  const confirmRemoveLogo = async () => {
    if (!confirmModal.type) return;
    const type = confirmModal.type;
    setConfirmModal({ show: false, type: null });
    try {
      const docRef = doc(db, 'settings', 'branding');
      await setDoc(docRef, { [type]: null, updatedAt: new Date().toISOString() }, { merge: true });
    } catch (err) {
      console.error("Error removing logo:", err);
    }
  };

  if (loading) return (
    <div className="h-full flex items-center justify-center">
      <span className="material-symbols-outlined animate-spin text-copper !text-4xl opacity-20">progress_activity</span>
    </div>
  );

  const LogoSection = ({ title, type, desc, current }: { title: string; type: keyof BrandConfig; desc: string; current?: string }) => (
    <div className="bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 p-6 rounded-none shadow-none flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <h3 className="text-[10px] font-black text-black/80 dark:text-white/90 uppercase tracking-[0.3em]">{title}</h3>
          <p className="text-[9px] text-black/40 dark:text-white/30 uppercase font-bold tracking-widest max-w-[250px] leading-relaxed">{desc}</p>
        </div>
        {current && (
          <M3IconButton icon="delete" onClick={() => removeLogo(type)} variant="secondary" />
        )}
      </div>

      <div className="h-40 w-full flex items-center justify-center border border-dashed border-black/10 dark:border-white/10 rounded-none relative overflow-hidden group bg-black/[0.01] dark:bg-white/[0.01]">
        {current ? (
          <img
            src={current}
            alt={title}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            className="max-h-[70%] max-w-[70%] object-contain shadow-none grayscale hover:grayscale-0 transition-all duration-700 select-none pointer-events-none"
          />
        ) : (
          <span className="material-symbols-outlined text-4xl text-black/10 dark:text-white/5">image</span>
        )}

        <label className="absolute inset-0 bg-black/90 dark:bg-white/90 text-white dark:text-black flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-all duration-300">
          <span className="material-symbols-outlined mb-2">upload_file</span>
          <span className="text-[10px] font-black uppercase tracking-[0.2em]">
            {uploading === type ? t('brand.uploading', 'SUBIENDO...') : t('brand.change_image', 'CAMBIAR IMAGEN')}
          </span>
          <input type="file" autoComplete="off" spellCheck={false} className="hidden" accept=".png,.svg,.jpg,.jpeg" onChange={(e) => handleUpload(e, type)} disabled={!!uploading} />
        </label>
      </div>
    </div>
  );

  return (
    <div className="p-8 max-w-6xl mx-auto overflow-y-auto h-full custom-scrollbar">
      <header className="flex items-center gap-6 mb-12 border-b border-black/5 dark:border-white/5 pb-10">
        <div className="p-4 bg-copper/10 rounded-none">
          <span className="material-symbols-outlined text-copper !text-4xl">palette</span>
        </div>
        <div>
          <h1 className="text-[12px] font-black tracking-[0.5em] text-black/40 dark:text-white/20 uppercase mb-1">{t('brand.title', 'BRAND MANAGER')}</h1>
          <p className="text-xl font-black text-black dark:text-white tracking-tighter uppercase">{t('brand.subtitle', 'Centralización de identidad visual')}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <LogoSection
          title={t('brand.favicon_title', 'Favicon')}
          type="favicon"
          desc={t('brand.favicon_desc', 'Ícono de pestaña del navegador.')}
          current={brand.favicon}
        />
        <LogoSection
          title={t('brand.isotype_title', 'Isotipo')}
          type="isotype"
          desc={t('brand.isotype_desc', 'Símbolo puro sin texto.')}
          current={brand.isotype}
        />
        <LogoSection
          title={t('brand.imagotype_title', 'Imagotipo')}
          type="imagotype"
          desc={t('brand.imagotype_desc', 'Logo completo: Símbolo + Nombre.')}
          current={brand.imagotype}
        />
        <LogoSection
          title={t('brand.logotype_title', 'Logotype')}
          type="logotype"
          desc={t('brand.logotype_desc', 'Solo tipografía.')}
          current={brand.logotype}
        />
      </div>

      <div className="mt-12 p-8 bg-black/5 dark:bg-white/5 border-l-4 border-copper flex gap-6 items-start animate-in slide-in-from-left-4 duration-1000">
        <span className="material-symbols-outlined text-copper !text-3xl">info</span>
        <div className="space-y-2">
          <p className="text-[11px] font-black text-copper uppercase tracking-widest">{t('brand.sync_info_title', 'Sincronización Industrial Automática')}</p>
          <p className="text-[10px] text-black/50 dark:text-white/40 uppercase font-bold leading-relaxed tracking-wider">
            {t('brand.sync_info_desc', 'Al actualizar un logo aquí, los cambios se reflejarán instantáneamente en todos los usuarios activos.')}
          </p>
        </div>
      </div>

      {confirmModal.show && (
        <M3ConfirmModal
          title={t('brand.delete_confirm_title', 'Confirmar Eliminación')}
          description={t('brand.delete_confirm', '¿Seguro que deseas eliminar este logo?')}
          confirmLabel={t('actions.confirm', 'Confirmar')}
          cancelLabel={t('actions.cancel', 'Cancelar')}
          onConfirm={confirmRemoveLogo}
          onCancel={() => setConfirmModal({ show: false, type: null })}
        />
      )}
    </div>
  );
}
