import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error in component:', error, errorInfo);
    }

    public handleReset = () => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 border border-rose-500/20 bg-rose-500/5 text-black dark:text-white font-sans space-y-4 max-w-xl mx-auto my-12">
                    <div className="flex items-center gap-2 text-rose-500">
                        <span className="material-symbols-outlined text-[24px]">error</span>
                        <h2 className="text-base font-bold">Interrupción de Renderizado en Vista</h2>
                    </div>
                    <p className="text-xs text-black/70 dark:text-white/70">
                        Se detectó una discrepancia de formato al procesar datos del servidor:
                    </p>
                    <pre className="p-3 bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 font-mono text-[11px] text-rose-600 dark:text-rose-400 overflow-x-auto">
                        {this.state.error?.message || 'Error desconocido'}
                    </pre>
                    <button
                        onClick={this.handleReset}
                        className="px-4 py-2 bg-antigravity-accent text-white text-xs font-bold hover:opacity-90 transition-opacity flex items-center gap-2"
                    >
                        <span className="material-symbols-outlined text-[16px]">refresh</span>
                        Recargar Vista
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
