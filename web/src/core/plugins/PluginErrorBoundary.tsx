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
                    className="p-8 bg-zinc-100/50 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-800 rounded-3xl flex flex-col items-center justify-center gap-5 min-h-[220px] text-center select-none active:scale-[0.99] transition-transform animate-in fade-in duration-500"
                >
                    {/* Icon Container (Sandboxed Widget Style) */}
                    <div className="w-14 h-14 rounded-2xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 flex items-center justify-center shadow-sm">
                        <span className="material-symbols-rounded text-slate-400 dark:text-zinc-500 text-3xl">
                            extension_off
                        </span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <h3 className="font-bold text-slate-900 dark:text-zinc-100 text-lg tracking-tight">
                            Plugin Roto
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-zinc-400 max-w-[240px] leading-relaxed">
                            El widget ha fallado y se aisló por seguridad para no interrumpir tu trabajo en MINREPORT Core.
                        </p>
                    </div>

                    <button
                        onClick={this.handleRestart}
                        className="mt-2 font-bold text-sm py-3 px-8 bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 rounded-2xl hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 group"
                    >
                        <span className="material-symbols-rounded text-lg group-active:rotate-180 transition-transform duration-500">
                            refresh
                        </span>
                        Recargar Plugin
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default PluginErrorBoundary;
