import React from 'react';

interface OperationalChipGridProps {
  title: string;
  items: string[];
}

export const OperationalChipGrid: React.FC<OperationalChipGridProps> = ({ title, items }) => {
  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-muted whitespace-nowrap">{title}</h3>
        <div className="h-[1px] w-full bg-border-base" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((item, idx) => (
          <div 
            key={idx} 
            className="group relative px-4 py-3 bg-surface border border-border-base hover:border-copper/30 transition-all flex items-center gap-3"
          >
            <div className="w-1.5 h-1.5 rounded-none bg-copper/40 group-hover:bg-copper transition-colors" />
            <span className="text-[11px] font-black text-foreground/70 uppercase tracking-widest group-hover:text-foreground transition-colors">
              {item}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
