/**
 * OPERMAQ-DEV | PremiumAIPanel
 * Panel lateral flotante (Drawer) con las Capacidades Premium de IA (F5, F6, F7).
 * Diseño minimalista, Atkinson Hyperlegible, soporte Modo Claro/Oscuro.
 */
import React, { useState, useRef } from 'react';
import { M3Button } from './M3Button';
import { M3TextField } from './M3TextField';
import { M3IconButton } from './M3IconButton';
import { API_BASE_URL } from '../firebase/config';
import { authFetch } from '../utils/authFetch';
import { toast } from 'react-toastify';
import { compressToWebP } from '../utils/imageCompression';

interface PremiumAIPanelProps {
  globalAssetId: string;
  makeModel: string;
  category: string;
  isOpen: boolean;
  onClose: () => void;
}

interface VisualInspectionResult {
  diagnostico: 'BUENO' | 'DESGASTE_NORMAL' | 'DESGASTE_ANORMAL' | 'CRITICO';
  coincide_componente: boolean;
  detalles_detectados: string[];
  accion_inmediata: string;
  alerta_fcm_requerida: boolean;
}

export const PremiumAIPanel: React.FC<PremiumAIPanelProps> = ({
  globalAssetId,
  makeModel,
  category,
  isOpen,
  onClose,
}) => {
  const [activeSection, setActiveSection] = useState<'f5' | 'f6' | 'f7'>('f5');

  // F5: ImagenTech
  const [f5ComponentName, setF5ComponentName] = useState('');
  const [f5Image, setF5Image] = useState<string | null>(null);
  const [f5Loading, setF5Loading] = useState(false);

  // F6: VisualInspection
  const [f6Component, setF6Component] = useState('');
  const [f6ImageBase64, setF6ImageBase64] = useState<string | null>(null);
  const [f6MimeType, setF6MimeType] = useState('');
  const [f6Result, setF6Result] = useState<VisualInspectionResult | null>(null);
  const [f6Loading, setF6Loading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // F7: VoiceToVault
  const [isRecording, setIsRecording] = useState(false);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioMimeType, setAudioMimeType] = useState('');
  const [f7Result, setF7Result] = useState<{ transcribedText?: string; pilar?: string; message?: string } | null>(null);
  const [f7Loading, setF7Loading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  if (!isOpen) return null;

  // ─── Handlers F5 (ImagenTech) ───────────────────────────────────────────────
  const handleGenerateDiagram = async () => {
    if (!f5ComponentName.trim()) {
      toast.warning('Por favor, ingresa el nombre del componente.');
      return;
    }
    setF5Loading(true);
    setF5Image(null);
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/images/generate-technical`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentName: f5ComponentName,
          makeModel,
          category: category || 'Maquinaria Pesada',
        }),
      });
      const json = await res.json();
      if (res.ok && json.imageBase64) {
        setF5Image(`data:image/png;base64,${json.imageBase64}`);
        toast.success('✓ Diagrama generado exitosamente.');
      } else {
        toast.error(`Error: ${json.error || 'No se pudo generar el diagrama.'}`);
      }
    } catch (err) {
      toast.error('Error de red al generar diagrama.');
      console.error(err);
    } finally {
      setF5Loading(false);
    }
  };

  // ─── Handlers F6 (VisualInspection) ─────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { base64, mimeType } = await compressToWebP(file);
      setF6MimeType(mimeType);
      setF6ImageBase64(base64);
    } catch (err) {
      toast.error('Error al optimizar la imagen para análisis.');
      console.error(err);
    }
  };

  const handleInspectVisual = async () => {
    if (!f6ImageBase64 || !f6Component.trim()) {
      toast.warning('Falta la imagen o el componente esperado.');
      return;
    }
    setF6Loading(true);
    setF6Result(null);
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/inspect/visual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Image: f6ImageBase64,
          mimeType: f6MimeType,
          expectedComponent: f6Component,
          makeModel,
          globalAssetId,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setF6Result(json.result);
        toast.success('✓ Inspección completada.');
      } else {
        toast.error(`Error: ${json.error || 'Fallo en la inspección.'}`);
      }
    } catch (err) {
      toast.error('Error de red al realizar inspección.');
      console.error(err);
    } finally {
      setF6Loading(false);
    }
  };

  // ─── Handlers F7 (VoiceToVault) ─────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioMimeType('audio/webm');
        
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          setAudioBase64(base64);
        };
        reader.readAsDataURL(audioBlob);

        // Detener todas las pistas del stream
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
      toast.info('Grabando audio...');
    } catch (err) {
      toast.error('No se pudo acceder al micrófono.');
      console.error(err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      toast.info('Grabación detenida.');
    }
  };

  const handleSendVoice = async () => {
    if (!audioBase64) {
      toast.warning('Graba una nota de voz primero.');
      return;
    }
    setF7Loading(true);
    setF7Result(null);
    try {
      const res = await authFetch(`${API_BASE_URL}/vault/voice/transcribe-and-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType: audioMimeType,
          globalAssetId,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setF7Result(json.result);
        toast.success('✓ Dictado procesado y enviado a boveda.');
        setAudioBase64(null); // Limpiar
      } else {
        toast.error(`Error: ${json.error || 'Fallo al procesar dictado.'}`);
      }
    } catch (err) {
      toast.error('Error de red al enviar dictado.');
      console.error(err);
    } finally {
      setF7Loading(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[450px] bg-white dark:bg-[#0d0d0d] border-l border-black/10 dark:border-white/10 shadow-none z-[100] flex flex-col font-atkinson animate-in slide-in-from-right duration-300">
      {/* Header Drawer */}
      <div className="p-6 border-b border-black/5 dark:border-white/5 flex items-center justify-between bg-black/[0.02] dark:bg-white/[0.01]">
        <div>
          <h3 className="text-base font-black tracking-tight text-black/90 dark:text-white/90 uppercase">Capacidades Premium IA</h3>
          <p className="text-[10px] text-copper font-bold tracking-widest uppercase mt-0.5">OPERMAQ INTELLIGENCE</p>
        </div>
        <M3IconButton icon="close" onClick={onClose} variant="secondary" />
      </div>

      {/* Selector de Módulos */}
      <nav className="flex border-b border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01] shrink-0">
        {[
          { id: 'f5', label: 'Diagrama', icon: 'draw' },
          { id: 'f6', label: 'Inspección', icon: 'center_focus_strong' },
          { id: 'f7', label: 'Dictado', icon: 'mic' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSection(tab.id as 'f5' | 'f6' | 'f7')}
            className={`flex-1 py-4 text-[10px] font-black uppercase tracking-[0.15em] flex items-center justify-center gap-2 border-b-2 transition-all ${
              activeSection === tab.id
                ? 'border-copper text-copper bg-copper/[0.03]'
                : 'border-transparent text-black/40 dark:text-white/40 hover:text-copper/70'
            }`}
          >
            <span className="material-symbols-outlined !text-[16px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Contenido del módulo */}
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
        
        {/* F5: DIAGRAMA OEM (IMAGEN 3.0) */}
        {activeSection === 'f5' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="bg-black/[0.02] dark:bg-white/[0.02] p-5 border border-black/5 dark:border-white/5 border-l-4 border-l-copper">
              <p className="text-[11px] font-black text-black/80 dark:text-white/80 uppercase mb-1 tracking-tight">Generador de Diagramas OEM</p>
              <p className="text-[10px] text-black/50 dark:text-white/50 leading-relaxed">Utiliza Imagen 3.0 para renderizar un diagrama técnico limpio y profesional del componente solicitado.</p>
            </div>

            <M3TextField
              label="Nombre del Componente"
              placeholder="Ej: Cilindro de Dirección, Filtro de Aire"
              value={f5ComponentName}
              onChange={setF5ComponentName}
              autoComplete="off"
            />

            <div className="text-[9px] font-mono text-black/40 dark:text-white/40 space-y-1.5 px-2">
              <p className="flex justify-between"><span>EQUIPO:</span> <strong className="text-black/60 dark:text-white/60">{makeModel}</strong></p>
              <p className="flex justify-between"><span>CATEGORÍA:</span> <strong className="text-black/60 dark:text-white/60">{category || 'MAQUINARIA'}</strong></p>
            </div>

            <M3Button
              onClick={handleGenerateDiagram}
              loading={f5Loading}
              disabled={f5Loading}
              icon="palette"
              variant="primary"
              className="w-full py-7 font-black tracking-[0.2em] text-[11px] rounded-none"
            >
              {f5Loading ? 'GENERANDO DIAGRAMA...' : 'GENERAR DIAGRAMA TÉCNICO'}
            </M3Button>

            {f5Image && (
              <div className="mt-6 border border-black/10 dark:border-white/10 bg-black/5 p-2 animate-in zoom-in duration-500">
                <img src={f5Image} alt="Technical Diagram" className="w-full h-auto object-contain grayscale-[0.5] hover:grayscale-0 transition-all duration-700" />
                <p className="text-[9px] text-center text-black/30 dark:text-white/30 mt-3 font-mono uppercase tracking-widest">Renderizado por Imagen 3.0 via Vault Intelligence</p>
              </div>
            )}
          </div>
        )}

        {/* F6: INSPECCIÓN VISUAL (GEMINI 2.5 FLASH) */}
        {activeSection === 'f6' && (
          <div className="space-y-4">
            <div className="bg-black/[0.02] dark:bg-white/[0.02] p-4 border border-black/5 dark:border-white/5">
              <p className="text-[11px] font-black text-black/80 dark:text-white/80 uppercase mb-1">Análisis Multimodal en Terreno</p>
              <p className="text-[10px] text-black/50 dark:text-white/50 leading-relaxed">Gemini 2.5 Flash evalúa el estado del componente e identifica fallas o anomalías críticas.</p>
            </div>

            <M3TextField
              label="Componente Esperado"
              placeholder="Ej: Neumático trasero, Correa del alternador"
              value={f6Component}
              onChange={setF6Component}
              autoComplete="off"
            />

            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-black/40 dark:text-white/40 mb-1">Evidencia Fotográfica</label>
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border border-black/10 dark:border-white/10 hover:border-copper/50 p-8 flex flex-col items-center justify-center cursor-pointer bg-black/[0.02] dark:bg-white/[0.02] transition-all group active:scale-[0.99] duration-300"
              >
                <span className="material-symbols-outlined !text-4xl text-black/20 dark:text-white/20 group-hover:text-copper/50 transition-colors mb-2">add_a_photo</span>
                <span className="text-[10px] font-black uppercase tracking-widest text-black/40 dark:text-white/40 group-hover:text-black/60 dark:group-hover:text-white/60">
                  {f6ImageBase64 ? 'Reemplazar Captura' : 'Cargar Imagen de Inspección'}
                </span>
              </div>
              {f6ImageBase64 && (
                <div className="flex items-center gap-2 justify-center py-2 animate-in fade-in slide-in-from-top-1">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-none animate-pulse"></span>
                  <p className="text-[9px] text-emerald-500 font-black uppercase tracking-widest">Asset listo para análisis</p>
                </div>
              )}
            </div>

            <M3Button
              onClick={handleInspectVisual}
              loading={f6Loading}
              disabled={f6Loading || !f6ImageBase64}
              icon="troubleshoot"
              variant="primary"
              className="w-full py-6 font-black tracking-widest text-[11px]"
            >
              {f6Loading ? 'Analizando...' : 'Realizar Inspección Visual'}
            </M3Button>

            {f6Result && (
              <div className="mt-4 border border-black/10 dark:border-white/10 p-4 bg-black/[0.02] dark:bg-white/[0.02] space-y-3 animate-in fade-in duration-300">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-black/50 dark:text-white/50">Diagnóstico:</span>
                  <span className={`text-[11px] font-black px-2 py-0.5 rounded-none ${
                    f6Result.diagnostico === 'BUENO' ? 'bg-emerald-500/20 text-emerald-500' :
                    f6Result.diagnostico === 'DESGASTE_NORMAL' ? 'bg-blue-500/20 text-blue-500' :
                    f6Result.diagnostico === 'DESGASTE_ANORMAL' ? 'bg-amber-500/20 text-amber-500' :
                    'bg-red-500/20 text-red-500 animate-pulse'
                  }`}>{f6Result.diagnostico}</span>
                </div>

                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-black/70 dark:text-white/70">¿Coincide con el componente?</span>
                  <span className={`font-black ${f6Result.coincide_componente ? 'text-emerald-500' : 'text-red-500'}`}>
                    {f6Result.coincide_componente ? 'SÍ' : 'NO'}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-black/50 dark:text-white/50 block mb-1">Detalles detectados:</span>
                  <ul className="list-disc pl-4 text-[11px] text-black/70 dark:text-white/70 space-y-1">
                    {f6Result.detalles_detectados.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </div>

                <div className="pt-2 border-t border-black/5 dark:border-white/5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-black/50 dark:text-white/50 block">Acción inmediata:</span>
                  <p className="text-[11px] font-bold text-copper mt-0.5">{f6Result.accion_inmediata}</p>
                </div>

                {f6Result.alerta_fcm_requerida && (
                  <div className="flex items-center gap-2 p-2 bg-red-500/10 text-red-500 text-[10px] font-black tracking-wider uppercase">
                    <span className="material-symbols-outlined !text-[14px] animate-pulse">notifications_active</span>
                    Alerta crítica FCM enviada al Supervisor
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* F7: DICTADO TÉCNICO (VOICE TO VAULT) */}
        {activeSection === 'f7' && (
          <div className="space-y-4">
            <div className="bg-black/[0.02] dark:bg-white/[0.02] p-4 border border-black/5 dark:border-white/5">
              <p className="text-[11px] font-black text-black/80 dark:text-white/80 uppercase mb-1">Dictado Técnico Offline-to-Sync</p>
              <p className="text-[10px] text-black/50 dark:text-white/50 leading-relaxed">Graba tus observaciones operacionales. Gemini las clasificará y agregará como sugerencias a la bóveda.</p>
            </div>

            <div className="flex flex-col items-center justify-center py-10 space-y-4 bg-black/[0.01] dark:bg-white/[0.01] border border-black/5 dark:border-white/5">
              <div className="relative">
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`w-24 h-24 flex items-center justify-center border rounded-none transition-all duration-500 ${
                    isRecording
                      ? 'bg-red-500/10 border-red-500 text-red-500 animate-pulse'
                      : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:border-copper text-black/30 dark:text-white/30 hover:text-copper'
                  }`}
                >
                  <span className="material-symbols-outlined !text-4xl">{isRecording ? 'stop_circle' : 'mic'}</span>
                </button>
                {isRecording && (
                  <span className="absolute -inset-2 border border-red-500/20 animate-ping pointer-events-none"></span>
                )}
              </div>
              <div className="text-center">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-black/40 dark:text-white/40 block">
                  {isRecording ? 'Capturando Audio en Tiempo Real' : 'Dictado Técnico Activo'}
                </span>
                <span className="text-[9px] text-black/20 dark:text-white/20 uppercase font-bold tracking-widest mt-1 block">
                  {isRecording ? 'Pulse el centro para finalizar' : 'Pulse para iniciar grabación'}
                </span>
              </div>
            </div>

            {audioBase64 && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-center justify-between animate-in slide-in-from-bottom-2">
                <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  <span className="material-symbols-outlined !text-[16px]">audiotrack</span>
                  Audio grabado listo.
                </div>
                <M3IconButton icon="delete" onClick={() => setAudioBase64(null)} variant="secondary" className="text-red-500 hover:bg-red-500/10" />
              </div>
            )}

            <M3Button
              onClick={handleSendVoice}
              loading={f7Loading}
              disabled={f7Loading || !audioBase64}
              icon="cloud_upload"
              variant="primary"
              className="w-full py-6 font-black tracking-widest text-[11px]"
            >
              {f7Loading ? 'Procesando Audio...' : 'Enviar Dictado a Bóveda'}
            </M3Button>

            {f7Result && (
              <div className="mt-4 border border-black/10 dark:border-white/10 p-4 bg-black/[0.02] dark:bg-white/[0.02] space-y-3 animate-in fade-in duration-300 text-[11px]">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-black/50 dark:text-white/50 block">Texto Transcrito:</span>
                  <p className="italic text-black/80 dark:text-white/80 mt-0.5">"{f7Result.transcribedText}"</p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-black/5 dark:border-white/5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-black/50 dark:text-white/50">Pilar Clasificado:</span>
                  <span className="font-black text-copper uppercase tracking-wider">{f7Result.pilar?.replace(/_/g, ' ')}</span>
                </div>
                <div className="text-[9px] bg-black/5 dark:bg-white/5 p-2 font-bold tracking-wide text-black/40 dark:text-white/40 text-center">
                  Aporte registrado en estado <strong className="text-copper">PENDIENTE_HITL</strong>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 2px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(184, 115, 51, 0.2); }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(184, 115, 51, 0.4); }
      `}} />
    </div>
  );
};
