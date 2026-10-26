import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ChecklistComplianceChartProps {
  data: Array<{ date: string; count: number }>;
  loading?: boolean;
}

export const ChecklistComplianceChart: React.FC<ChecklistComplianceChartProps> = ({ data, loading }) => {
  if (loading) {
    return <div className="h-full w-full bg-black/5 dark:bg-white/5 animate-pulse" />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
        <XAxis 
          dataKey="date" 
          tick={{ fontSize: 9, fontWeight: 900 }} 
          axisLine={false} 
          tickLine={false}
          tickFormatter={(str) => str.split('-').slice(1).join('/')}
        />
        <YAxis tick={{ fontSize: 9, fontWeight: 900 }} axisLine={false} tickLine={false} />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: '#1a1a2e', 
            border: 'none', 
            borderRadius: '0',
            fontSize: '10px',
            color: '#fff'
          }}
          itemStyle={{ color: '#fff', fontWeight: 900 }}
          cursor={{ fill: 'rgba(184, 115, 51, 0.1)' }}
        />
        <Bar dataKey="count" fill="#b87333" radius={[0, 0, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};
