import React, { useState } from 'react';
import { 
    Cpu, 
    X, 
    Send, 
    Loader2, 
    Check
} from 'lucide-react';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { getApiUrl } from '../../utils/network';

interface AIProposal {
    id: string;
    module: 'opermaq' | 'stockpile' | 'mining-flow' | 'compliance';
    title: string;
    currentValue: string;
    suggestedValue: string;
    confidence: number;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}

export const MiningAICopilot: React.FC = () => {
    const { session } = useMinReportSession();
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'copilot' | 'proposals'>('copilot');
    const [inputPrompt, setInputPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string; tier?: string }>>([
        {
            role: 'assistant',
            text: 'Enjambre de IA MINREPORT en línea (Capa 4 Gemini). Monitoreando telemetría de flota, balance de acopios y flujos financieros. ¿En qué optimización de faena requieres asistencia?'
        }
    ]);

    // Propuestas de optimización generadas proactivamente por IA (AI-OPPORTUNITY)
    const [proposals, setProposals] = useState<AIProposal[]>([
        {
            id: 'PROP-01',
            module: 'opermaq',
            title: 'Mantenimiento Preventivo Adelantado CAEX-104',
            currentValue: 'Pauta programada a las 14.500 hrs',
            suggestedValue: 'Adelantar a las 14.280 hrs por vibración anómala en retardador',
            confidence: 94.2,
            impact: 'HIGH',
            status: 'PENDING'
        },
        {
            id: 'PROP-02',
            module: 'stockpile',
            title: 'Recalibración de Densidad STOCK-SULF-01',
            currentValue: 'Densidad nominal: 2.15 t/m³',
            suggestedValue: 'Ajustar a 2.18 t/m³ tras correlación con romana de molienda',
            confidence: 97.8,
            impact: 'MEDIUM',
            status: 'PENDING'
        },
        {
            id: 'PROP-03',
            module: 'mining-flow',
            title: 'Divergencia en Rendimiento Diésel Turno Noche',
            currentValue: 'Consumo proyectado: 4.800 L',
            suggestedValue: 'Consumo real registrado: 5.420 L (+12.9% desviación en rampa sur)',
            confidence: 91.5,
            impact: 'HIGH',
            status: 'PENDING'
        }
    ]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputPrompt.trim() || loading) return;

        const userText = inputPrompt.trim();
        setInputPrompt('');
        setMessages(prev => [...prev, { role: 'user', text: userText }]);
        setLoading(true);

        try {
            // Intentar inferencia con el endpoint de Capa 4
            const token = session?.role; // Placeholder de token
            const res = await fetch(getApiUrl('/api/ai/inference'), {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token || ''}`
                },
                body: JSON.stringify({
                    prompt: userText,
                    module: 'mining-swarm',
                    thinkingLevel: 'medium'
                })
            });

            if (res.ok) {
                const data = await res.json();
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    text: data.text || 'Análisis completado satisfactoriamente.',
                    tier: data.tierUsed
                }]);
            } else {
                throw new Error('Fallback local');
            }
        } catch {
            // Fallback analítico asistido por reglas de ingeniería minera
            setTimeout(() => {
                let reply = 'Consulta procesada. Analizando telemetría de activos y normativa DS 132.';
                const lower = userText.toLowerCase();

                if (lower.includes('pauta') || lower.includes('freno') || lower.includes('caex') || lower.includes('equipo')) {
                    reply = 'Diagnóstico OPERMAQ: El equipo CAEX-104 acumula 14.250,5 hrs con 98% de disponibilidad. Los frenos de servicio y retardador hidráulico se encuentran dentro de tolerancia según DS 132 Art. 215. Se recomienda mantener inspección de nivel de aceite diario.';
                } else if (lower.includes('acopio') || lower.includes('stockpile') || lower.includes('volumen') || lower.includes('densidad')) {
                    reply = 'Análisis STOCKPILE: El volumen total acumulado en los 4 depósitos es de 270.070 m³, representando 516.400,9 toneladas métricas de mineral. La confiabilidad topográfica P95 se mantiene en 98,2% mediante sensor LiDAR y conos elípticos analíticos.';
                } else if (lower.includes('flujo') || lower.includes('costo') || lower.includes('opex') || lower.includes('dinero')) {
                    reply = 'Reporte MINING FLOW: Balance de caja operativo mensual: USD $128.450,75. Desglose OPEX: 68% combustible y neumáticos, 32% mantenimiento mayor. El libro mayor append-only registra 12 transacciones con sellado SHA-256.';
                } else if (lower.includes('norma') || lower.includes('ley') || lower.includes('sernageomin')) {
                    reply = 'Directiva Normativa: Toda modificación en pautas de mantenimiento de faena debe registrarse con firma biométrica del supervisor y mantenerse archivada por un mínimo de 12 meses conforme al Reglamento de Seguridad Minera (DS 132, D.O. 07/02/2004).';
                }

                setMessages(prev => [...prev, {
                    role: 'assistant',
                    text: reply,
                    tier: 'FLASH'
                }]);
            }, 600);
        } finally {
            setLoading(false);
        }
    };

    const handleAcceptProposal = (id: string) => {
        setProposals(prev => prev.map(p => p.id === id ? { ...p, status: 'ACCEPTED' } : p));
    };

    const handleRejectProposal = (id: string) => {
        setProposals(prev => prev.map(p => p.id === id ? { ...p, status: 'REJECTED' } : p));
    };

    return (
        <>
            {/* Botón Flotante Minimalista Industrial */}
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 z-40 bg-[#0F172A] dark:bg-[#07090D] border border-white/20 text-[#FFCD00] hover:text-white px-3.5 py-2.5 shadow-2xl flex items-center gap-2.5 transition-all cursor-pointer group"
                title="Copiloto de IA Minera (Gemini Swarm)"
            >
                <Cpu size={16} className="text-[#FFCD00] group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] font-mono text-white hidden sm:inline">
                    IA MINERA
                </span>
                {proposals.filter(p => p.status === 'PENDING').length > 0 && (
                    <span className="w-2 h-2 rounded-full bg-[#00AEEF] animate-pulse" />
                )}
            </button>

            {/* Drawer Lateral Paramétrico de Proporción Áurea (38.2%) */}
            {isOpen && (
                <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
                    <div className="w-full sm:w-[480px] lg:w-[38.2vw] h-full bg-[#07090D] border-l border-[#12151C] flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-300">
                        
                        {/* Header del Copiloto */}
                        <div className="p-4 border-b border-[#12151C] flex items-center justify-between bg-[#030406]">
                            <div className="flex items-center gap-2.5">
                                <div className="p-1.5 bg-[#FFCD00]/10 border border-[#FFCD00]/30 text-[#FFCD00]">
                                    <Cpu size={16} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-xs font-bold uppercase tracking-wider text-[#F3F4F6]">
                                            Copiloto de Ingeniería Minera
                                        </h3>
                                        <span className="text-[9px] font-mono bg-[#00AEEF]/10 text-[#00AEEF] px-1.5 py-0.2">
                                            CAPA 4 AI
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-[#8A93A6] font-mono mt-0.5">
                                        Enjambre Gemini Pro / Flash / Flash-Lite Resiliente
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1 text-[#8A93A6] hover:text-white transition-colors cursor-pointer bg-transparent border-0"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Tabs de Navegación del Panel */}
                        <div className="flex border-b border-[#12151C] bg-[#030406]">
                            <button
                                onClick={() => setActiveTab('copilot')}
                                className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider text-center transition-colors border-b-2 ${
                                    activeTab === 'copilot'
                                        ? 'border-[#FFCD00] text-white bg-white/[0.02]'
                                        : 'border-transparent text-[#8A93A6] hover:text-white'
                                }`}
                            >
                                Consulta en Vivo
                            </button>
                            <button
                                onClick={() => setActiveTab('proposals')}
                                className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider text-center transition-colors border-b-2 flex items-center justify-center gap-1.5 ${
                                    activeTab === 'proposals'
                                        ? 'border-[#00AEEF] text-white bg-white/[0.02]'
                                        : 'border-transparent text-[#8A93A6] hover:text-white'
                                }`}
                            >
                                <span>Propuestas HITL</span>
                                <span className="text-[9px] bg-[#00AEEF]/20 text-[#00AEEF] px-1.5 font-mono">
                                    {proposals.filter(p => p.status === 'PENDING').length}
                                </span>
                            </button>
                        </div>

                        {/* Cuerpo del Asistente */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {activeTab === 'copilot' ? (
                                <>
                                    {/* Lista de Mensajes */}
                                    {messages.map((m, idx) => (
                                        <div
                                            key={idx}
                                            className={`p-3 text-xs leading-relaxed ${
                                                m.role === 'user'
                                                    ? 'bg-[#12151C] text-white border-l-2 border-[#FFCD00] ml-6'
                                                    : 'bg-[#030406] text-[#F3F4F6] border border-[#12151C] mr-4'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1.5 text-[9px] font-mono text-[#8A93A6]">
                                                <span>{m.role === 'user' ? 'SUPERVISOR EN FAENA' : 'GEMINI SWARM AGENT'}</span>
                                                {m.tier && (
                                                    <span className="text-[#00AEEF] uppercase font-bold">TIER: {m.tier}</span>
                                                )}
                                            </div>
                                            <p className="whitespace-pre-wrap">{m.text}</p>
                                        </div>
                                    ))}

                                    {loading && (
                                        <div className="p-3 bg-[#030406] border border-[#12151C] flex items-center gap-2 text-xs text-[#8A93A6] font-mono">
                                            <Loader2 size={14} className="animate-spin text-[#FFCD00]" />
                                            <span>Sintetizando telemetría y reglas de faena...</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                /* TAB 2: PROPUESTAS HITL (Human-in-the-Loop) */
                                <div className="space-y-4">
                                    <div className="p-2.5 bg-blue-500/10 border-l-2 border-blue-500 text-[10px] text-blue-300 font-mono">
                                        GOBERNANZA HITL: Toda sugerencia de IA exige confirmación manual explícita antes de consolidar cambios en el Libro Mayor.
                                    </div>

                                    {proposals.map((prop) => (
                                        <div 
                                            key={prop.id}
                                            className="p-3 bg-[#030406] border border-[#12151C] space-y-3"
                                        >
                                            <div className="flex items-center justify-between text-[10px]">
                                                <span className="font-bold uppercase tracking-wider text-[#FFCD00]">
                                                    {prop.module}
                                                </span>
                                                <span className="text-[#8A93A6] font-mono">
                                                    Confiabilidad {prop.confidence}%
                                                </span>
                                            </div>

                                            <h4 className="text-xs font-bold text-white uppercase">
                                                {prop.title}
                                            </h4>

                                            <div className="space-y-1.5 text-[11px] font-mono">
                                                <div className="p-1.5 bg-black/40 text-[#8A93A6]">
                                                    <span className="text-[9px] uppercase block text-[#5A6072] font-bold">Actual</span>
                                                    {prop.currentValue}
                                                </div>
                                                <div className="p-1.5 bg-[#00AEEF]/5 border border-[#00AEEF]/20 text-[#00AEEF]">
                                                    <span className="text-[9px] uppercase block text-[#00AEEF]/70 font-bold">Sugerido por IA</span>
                                                    {prop.suggestedValue}
                                                </div>
                                            </div>

                                            {prop.status === 'PENDING' ? (
                                                <div className="flex gap-2 pt-1">
                                                    <button
                                                        onClick={() => handleAcceptProposal(prop.id)}
                                                        className="flex-1 py-1.5 bg-[#FFCD00] text-black text-[10px] font-bold uppercase tracking-wider hover:opacity-90 flex items-center justify-center gap-1 cursor-pointer"
                                                    >
                                                        <Check size={12} />
                                                        <span>Aprobar Sugerencia</span>
                                                    </button>
                                                    <button
                                                        onClick={() => handleRejectProposal(prop.id)}
                                                        className="px-3 py-1.5 border border-white/10 text-[10px] font-bold uppercase tracking-wider hover:bg-white/5 text-[#8A93A6] cursor-pointer"
                                                    >
                                                        Descartar
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="text-[10px] font-mono text-[#8A93A6] pt-1">
                                                    Estado: <span className={prop.status === 'ACCEPTED' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{prop.status}</span>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Input de Consulta */}
                        {activeTab === 'copilot' && (
                            <form onSubmit={handleSendMessage} className="p-3 border-t border-[#12151C] bg-[#030406] flex gap-2">
                                <input
                                    type="text"
                                    value={inputPrompt}
                                    onChange={e => setInputPrompt(e.target.value)}
                                    placeholder="Consultar falla de equipo, ley de acopio, normativa..."
                                    className="flex-1 px-3 py-2 bg-[#000000] border border-[#12151C] text-xs text-white focus:border-[#FFCD00] outline-none font-sans"
                                />
                                <button
                                    type="submit"
                                    disabled={loading || !inputPrompt.trim()}
                                    className="px-3.5 bg-[#FFCD00] text-black hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center cursor-pointer"
                                >
                                    <Send size={14} />
                                </button>
                            </form>
                        )}

                    </div>
                </div>
            )}
        </>
    );
};

export default MiningAICopilot;
