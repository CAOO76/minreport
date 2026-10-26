import { useState, useEffect } from 'react';
import { Network } from '@capacitor/network';

/**
 * SyncIndicator
 * Visualizador de estado Offline-First para OPERMAQ.
 * Diseño: Minimalismo Industrial (Stitch UI).
 */
export function SyncIndicator() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Obtener estado inicial
    Network.getStatus().then(status => {
      setIsOnline(status.connected);
    });

    // Escuchar cambios de red nativos
    const listener = Network.addListener('networkStatusChange', (status) => {
      setIsOnline(status.connected);
    });

    return () => {
      listener.then(l => l.remove());
    };
  }, []);

  if (isOnline) return null;

  return (
    <div 
      className="flex items-center gap-2 px-3 py-1.5 rounded-none bg-amber-100 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200 text-xs font-medium animate-pulse"
      title="Edge: Offline"
    >
      <span className="w-2 h-2 rounded-none bg-amber-500"></span>
      <span>Sin conexión</span>
    </div>
  );
}
