import React from 'react';

interface VaultCompletenessProgressProps {
  byPillar: Record<string, number>;
  totalFiles: number;
  totalChunks: number;
  loading?: boolean;
}

export const VaultCompletenessProgress: React.FC<VaultCompletenessProgressProps> = ({ byPillar, totalFiles, totalChunks, loading }) => {
  const pillars = [
    { key: 'ficha_tecnica', label: 'Ficha Técnica' },
    { key: 'manual_operaciones', label: 'Manual Operaciones' },
    { key: 'pauta_mantencion', label: 'Pauta Mantención' },
    { key: 'matriz_riesgo', label: 'Matriz Riesgo' },
    { key: 'checklist_pre_op', label: 'Checklist Pre-op' },
  ];

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-8 bg-black/5 dark:bg-white/5 animate-pulse" />
        ))}
      </div>
    );
  }

  // En esta versión simplificada del backend, byPillar cuenta ITEMS totales.
  // Pero necesitamos saber cuánto de eso está investigado.
  // Como el backend no nos da por pilar investigado (solo totalChunks global),
  // usaremos el ratio global para ilustrar, o simplemente mostraremos volumen de datos.
  // El plan maestro dice "Vault Completeness Progress".

  return (
    <div className="flex flex-col gap-6">
      {pillars.map((pillar) => {
        const count = byPillar[pillar.key] || 0;
        const percentage = totalFiles > 0 ? (count / totalFiles) * 100 : 0;
        
        return (
          <div key={pillar.key} className="flex flex-col gap-2">
            <div className="flex justify-between items-end">
              <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{pillar.label}</span>
              <span className="text-[10px] font-black">{count} ITEMS</span>
            </div>
            <div className="h-1 w-full bg-black/5 dark:bg-white/5 overflow-hidden">
              <div 
                className="h-full bg-copper transition-all duration-1000" 
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        );
      })}
      
      <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5">
        <div className="flex justify-between items-end">
          <span className="text-[10px] font-black uppercase tracking-widest text-copper">Investigación Global</span>
          <span className="text-xl font-black">{totalFiles > 0 ? Math.round((totalChunks / totalFiles) * 100) : 0}%</span>
        </div>
        <div className="text-[9px] font-bold opacity-40 uppercase tracking-tighter">
          {totalChunks} de {totalFiles} puntos de datos validados por IA
        </div>
      </div>
    </div>
  );
};
