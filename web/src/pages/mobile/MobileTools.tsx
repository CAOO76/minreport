
import React from 'react';
import { Map, Triangle, Radio, FileText, ChevronRight, HardHat } from 'lucide-react';

const MobileTools: React.FC = () => {

    const tools = [
        { id: 'maps', name: 'Mapa de Mina', icon: Map, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
        { id: 'topo', name: 'Topografía', icon: Triangle, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
        { id: 'sensors', name: 'Sensores IoT', icon: Radio, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
        { id: 'reports', name: 'Reportes', icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
        { id: 'safety', name: 'Seguridad', icon: HardHat, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-900/20' },
    ];

    const handleToolClick = (toolName: string) => {
        // Aquí iría la navegación real: navigate('/mobile/tools/map')
        alert(`Abriendo herramienta: ${toolName}`);
    };

    return (
        <div className="space-y-6 px-1 pt-2">

            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Herramientas</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Plugins activos en tu plan
                </p>
            </div>

            {/* Tools Grid */}
            <div className="grid grid-cols-2 gap-4">
                {tools.map((tool) => (
                    <button
                        key={tool.id}
                        onClick={() => handleToolClick(tool.name)}
                        className="flex flex-col items-center justify-center p-6 rounded-3xl bg-white dark:bg-zinc-900 shadow-sm border border-gray-100 dark:border-zinc-800 transition-all active:scale-95 active:shadow-none h-40 group"
                    >
                        <div className={`p-4 rounded-2xl ${tool.bg} mb-4 group-hover:scale-110 transition-transform`}>
                            <tool.icon size={32} className={tool.color} />
                        </div>
                        <span className="font-bold text-gray-900 dark:text-white text-sm">
                            {tool.name}
                        </span>
                    </button>
                ))}
            </div>

            {/* Accesos Rápidos / Lista Secundaria */}
            <div className="pt-4">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider mb-3 px-1">
                    Utilidades
                </h3>
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden">
                    <button className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors border-b border-gray-100 dark:border-zinc-800 last:border-0">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Escáner QR</span>
                        <ChevronRight size={18} className="text-gray-400" />
                    </button>
                    <button className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Sincronizar Datos Offline</span>
                        <ChevronRight size={18} className="text-gray-400" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MobileTools;
