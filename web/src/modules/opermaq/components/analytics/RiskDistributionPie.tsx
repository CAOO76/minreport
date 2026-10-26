import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface RiskDistributionPieProps {
  distribution: Record<string, number>;
  loading?: boolean;
}

export const RiskDistributionPie: React.FC<RiskDistributionPieProps> = ({ distribution, loading }) => {
  const data = [
    { name: 'Crítico', value: distribution['CRITICAL'] || 0, color: '#ef4444' },
    { name: 'Falla', value: distribution['FAIL'] || 0, color: '#f59e0b' },
    { name: 'Operativo', value: distribution['PASS'] || 0, color: '#10b981' },
  ].filter(d => d.value > 0);

  if (loading) {
    return <div className="h-full w-full bg-black/5 dark:bg-white/5 animate-pulse" />;
  }

  if (data.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center opacity-20">
        <span className="text-[10px] font-black uppercase tracking-widest">Sin datos de riesgo</span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius="50%"
          outerRadius="80%"
          paddingAngle={5}
          dataKey="value"
          stroke="none"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip 
          contentStyle={{ backgroundColor: '#1a1a2e', border: 'none', borderRadius: '0', fontSize: '10px' }}
          itemStyle={{ color: '#fff', fontWeight: 900 }}
        />
        <Legend 
          verticalAlign="bottom" 
          height={36} 
          formatter={(val) => <span className="text-[9px] font-black uppercase tracking-widest ml-2">{val}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
};
