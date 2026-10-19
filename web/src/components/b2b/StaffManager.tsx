import React, { useState } from 'react';
import { M3Switch } from '../common/M3Switch';
import { SYSTEM_MODULES } from '../../constants/modules';

interface StaffManagerProps {
    userId: string;
    userName: string;
}

export const StaffManager: React.FC<StaffManagerProps> = ({ userId, userName }) => {
    // Permisos por módulo de sistema
    const [permissions, setPermissions] = useState<Record<string, boolean>>({
        'opermaq': true,
        'stockpile': true,
        'mining-flow': true,
    });

    const togglePermission = (moduleId: string) => {
        setPermissions(prev => ({
            ...prev,
            [moduleId]: !prev[moduleId]
        }));
    };

    return (
        <div className="border border-gray-200 dark:border-gray-800 rounded-none bg-white dark:bg-[#111827] flex flex-col h-full font-['Atkinson_Hyperlegible'] shadow-none">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1F2937]">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#C68346] mb-1">Permisos de Módulo</h3>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">Colaborador: {userName}</p>
                <p className="text-xs text-gray-500 font-mono mt-1">ID: {userId}</p>
            </div>

            {/* Module List */}
            <div className="flex-1 overflow-y-auto p-0">
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                    {SYSTEM_MODULES.map((mod) => (
                        <li key={mod.id} className="p-6 flex items-start justify-between hover:bg-gray-50 dark:hover:bg-[#1F2937]/30 transition-colors">
                            <div className="pr-6">
                                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-1">
                                    {mod.name}
                                </h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                    {mod.description}
                                </p>
                            </div>
                            <div className="pt-1 flex-shrink-0">
                                <M3Switch
                                    checked={!!permissions[mod.id]}
                                    onChange={() => togglePermission(mod.id)}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            </div>

            {/* Footer Alert */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-[#C68346]/10 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#b0743e] dark:text-[#C68346]">
                    Los cambios se aplican en tiempo real
                </p>
            </div>
        </div>
    );
};
