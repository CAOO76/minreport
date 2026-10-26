import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface FleetHealthGaugeProps {
  score: number; // 0-100
  loading?: boolean;
}

export const FleetHealthGauge: React.FC<FleetHealthGaugeProps> = ({ score, loading }) => {
  const data = [
    { name: 'Score', value: score },
    { name: 'Remaining', value: 100 - score },
  ];

  const getColor = (val: number) => {
    if (val >= 90) return '#10b981'; // Green
    if (val >= 70) return '#f59e0b'; // Amber
    return '#ef4444'; // Red
  };

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center">
        <div className="w-16 h-16 border-4 border-copper/10 border-t-copper rounded-none animate-spin" />
        <span className="text-[10px] font-black uppercase mt-4 opacity-30 tracking-widest">Calculando Salud...</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="70%"
            outerRadius="90%"
            startAngle={180}
            endAngle={0}
            paddingAngle={0}
            dataKey="value"
            stroke="none"
          >
            <Cell fill={getColor(score)} />
            <Cell fill="rgba(0,0,0,0.05)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-8">
        <span className="text-4xl font-black tracking-tighter">{score}%</span>
        <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Salud de Flota</span>
      </div>
    </div>
  );
};
