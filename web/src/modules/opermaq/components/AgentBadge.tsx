import React from 'react';
import { agentConfig } from './AgentBadgeConfig';

type AgentBadgeProps = {
  pillarId: string;
};

export const AgentBadge: React.FC<AgentBadgeProps> = ({ pillarId }) => {
  const normalizedId = (pillarId || '').toLowerCase().replace('_', '');
  const config = agentConfig[normalizedId] || agentConfig.default;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-xs font-semibold tracking-wider uppercase border ${config.color} ${config.border}`}>
      <span className="material-symbols-outlined notranslate text-[14px]">
        {config.icon}
      </span>
      {config.label}
    </div>
  );
};
