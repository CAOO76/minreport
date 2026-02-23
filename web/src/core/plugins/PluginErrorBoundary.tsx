import { Component, ErrorInfo, ReactNode } from 'react';

/**
 * PluginErrorBoundary
 * 
 * Este componente actúa como un muro de contención (Sandboxing) para plugins.
 * Si un plugin falla, captura el error y evita que la aplicación principal se rompa.
 * Proporciona una interfaz de recuperación minimalista y aislada.
 */

interface Props {
    children: ReactNode;
    pluginName?: string;
    onReset?: () => void;
}

interface State {
    hasError: boolean;
}

export class PluginErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(_: Error): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // Aquí se podría enviar a un servicio de telemetría interno del Core
        console.error(`[PluginErrorBoundary] Fallo detectado en plugin "${this.props.pluginName || 'desconocido'}":`, error, errorInfo);
    }

    handleRestart = () => {
        this.setState({ hasError: false });
        this.props.onReset?.();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div
                    style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}
                    className="p-8 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-none flex flex-col items-center justify-center gap-6 min-h-[220px] text-center select-none animate-in fade-in duration-500 relative overflow-hidden"
                >
                    <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none"></div>
                    {/* Icon Container (Sandboxed Widget Style) */}
                    {/* Icon Container (Sandboxed Widget Style) */}
                    <div className="w-14 h-14 rounded-none bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center">
                        <span className="material-symbols-rounded text-black/40 dark:text-white/40 text-3xl">
                            extension_off
                        </span>
                    </div>

                    <div className="flex flex-col gap-2 relative z-10">
                        <h3 className="hud-label text-red-500 text-lg">
                            FAULT_DETECTED
                        </h3>
                        <p className="text-[10px] font-bold uppercase tracking-tight text-black/40 dark:text-white/40 max-w-[280px] leading-relaxed">
                            Error en el aislamiento del widget. Se ha suspendido la ejecución del módulo para preservar la integridad del Core.
                        </p>
                    </div>

                    <button
                        onClick={this.handleRestart}
                        className="mt-4 font-black text-[10px] uppercase tracking-[0.3em] py-4 px-10 bg-black dark:bg-white text-white dark:text-black rounded-none hover:opacity-90 active:scale-95 transition-all flex items-center gap-3 group relative z-10"
                    >
                        <span className="material-symbols-rounded text-lg group-active:rotate-180 transition-transform duration-500">
                            refresh
                        </span>
                        RESTART_MODULE
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default PluginErrorBoundary;
