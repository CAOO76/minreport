export const agentConfig: Record<string, { label: string; icon: string; color: string; border: string; buttonColor: string }> = {
  checklist: { 
    label: 'INSPECTOR PRE-OP', 
    icon: 'fact_check',
    color: 'bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60',
    border: 'border-black/10 dark:border-white/10',
    buttonColor: 'bg-black/80 hover:bg-black dark:bg-white/80 dark:hover:bg-white text-white dark:text-black'
  },
  operation: { 
    label: 'ESPEC. OPERACIÓN', 
    icon: 'settings_applications',
    color: 'bg-copper/10 text-copper',
    border: 'border-copper/20',
    buttonColor: 'bg-copper hover:bg-copper/80 text-white'
  },
  maintenance: { 
    label: 'ING. MANTENIMIENTO', 
    icon: 'build',
    color: 'bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60',
    border: 'border-black/10 dark:border-white/10',
    buttonColor: 'bg-black/80 hover:bg-black dark:bg-white/80 dark:hover:bg-white text-white dark:text-black'
  },
  hsec: { 
    label: 'ESPEC. HSEC', 
    icon: 'health_and_safety',
    color: 'bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60',
    border: 'border-black/10 dark:border-white/10',
    buttonColor: 'bg-black/80 hover:bg-black dark:bg-white/80 dark:hover:bg-white text-white dark:text-black'
  },
  default: {
    label: 'SÍNTESIS IA',
    icon: 'smart_toy',
    color: 'bg-black/5 dark:bg-white/5 text-black/60 dark:text-white/60',
    border: 'border-black/10 dark:border-white/10',
    buttonColor: 'bg-black/80 hover:bg-black dark:bg-white/80 dark:hover:bg-white text-white dark:text-black'
  }
};
