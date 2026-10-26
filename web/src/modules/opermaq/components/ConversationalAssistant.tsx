import React, { useState, useRef, useEffect } from 'react';
import { M3IconButton } from './M3IconButton';
import { toast } from 'react-toastify';
import { authFetch } from '../utils/authFetch';

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface ConversationalAssistantProps {
  globalAssetId: string;
  makeModel: string;
}

/**
 * F-FIELD.2 — Asistente Conversacional Industrial
 * Chat multi-turno con corpus OEM + entrada de voz (Web Speech API)
 */
export const ConversationalAssistant: React.FC<ConversationalAssistantProps> = ({
  globalAssetId,
  makeModel,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', text };
    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setInput('');
    setIsLoading(true);

    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const res = await authFetch(`${backendUrl}/api/vault/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: text,
          globalAssetId,
          history: messages, // contexto previo
        }),
      });

      const data = await res.json();
      const modelMessage: Message = {
        role: 'model',
        text: data.answer || 'Sin respuesta del sistema.',
      };
      setMessages([...newHistory, modelMessage]);
    } catch {
      setMessages([...newHistory, { role: 'model', text: '❌ Error de conexión con el núcleo de conocimiento.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const startVoice = () => {
    const win = window as any; // eslint-disable-line
    const SR = win.webkitSpeechRecognition || win.SpeechRecognition;
    if (!SR) { 
      toast.error('Tu navegador no soporta reconocimiento de voz.'); 
      return; 
    }
    const recognition = new SR();
    recognition.lang = 'es-CL';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (e: any) => { // eslint-disable-line
      const transcript = e.results[0][0].transcript;
      sendMessage(transcript);
    };
    recognition.start();
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0f0f0f] font-['Atkinson_Hyperlegible']">
      {/* Header */}
      <div className="px-6 py-3 border-b border-black/10 dark:border-white/10 flex items-center gap-3">
        <span className="material-symbols-outlined text-[#b08d57]">smart_toy</span>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest">ASISTENTE TÉCNICO</p>
          <p className="text-[9px] text-black/40 dark:text-white/30 uppercase">{makeModel}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-16 space-y-2">
            <span className="material-symbols-outlined text-4xl text-black/10 dark:text-white/10">forum</span>
            <p className="text-[10px] uppercase font-bold tracking-widest text-black/30 dark:text-white/20">
              Haz una consulta técnica
            </p>
            <p className="text-[9px] text-black/20 dark:text-white/10">
              Escribe o usa el micrófono
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-4 py-3 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#b08d57] text-white'
                  : 'bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-black dark:text-white shadow-sm'
              }`}
            >
              {msg.role === 'model' && (
                <p className="text-[8px] font-black uppercase tracking-widest text-[#b08d57] mb-1">SISTEMA</p>
              )}
              <p className="whitespace-pre-wrap">{msg.text}</p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 px-4 py-3 shadow-sm">
              <p className="text-[8px] font-black uppercase tracking-widest text-[#b08d57] mb-1">SISTEMA</p>
              <div className="flex gap-1 items-center h-4">
                <div className="w-1.5 h-1.5 rounded-none bg-[#b08d57] animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-none bg-[#b08d57] animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-none bg-[#b08d57] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-black/10 dark:border-white/10 flex gap-3 items-center">
        <M3IconButton
          icon={isListening ? 'graphic_eq' : 'mic'}
          onClick={startVoice}
          className={isListening ? '!bg-red-500 !text-white animate-pulse' : ''}
        />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
          placeholder="Consulta técnica..."
          className="flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 px-4 py-2.5 text-xs outline-none focus:border-[#b08d57] transition-colors text-black dark:text-white placeholder:text-black/30 dark:placeholder:text-white/20"
          autoComplete="off"
          disabled={isLoading}
        />
        <M3IconButton
          icon="send"
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isLoading}
        />
      </div>
    </div>
  );
};
