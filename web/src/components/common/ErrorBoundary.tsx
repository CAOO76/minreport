
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    private handleReset = () => {
        window.location.href = '/mobile/login';
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="h-screen w-screen flex flex-col items-center justify-center p-8 bg-zinc-950 text-white select-none">
                    <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-3xl flex flex-col items-center max-w-sm w-full">
                        <div className="w-16 h-16 bg-red-500 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-red-500/20">
                            <AlertTriangle size={32} className="text-white" />
                        </div>

                        <h1 className="text-xl font-bold mb-2">Error de Aplicación</h1>
                        <p className="text-zinc-400 text-sm text-center mb-6">
                            Se produjo un error crítico al renderizar la interfaz móvil.
                        </p>

                        <div className="w-full bg-black/40 rounded-xl p-4 mb-6 border border-zinc-800">
                            <p className="text-xs font-mono text-red-400 break-all">
                                {this.state.error?.message}
                            </p>
                            {this.state.errorInfo && (
                                <p className="text-[10px] font-mono text-zinc-600 mt-2 overflow-hidden h-20 opacity-50">
                                    {this.state.errorInfo.componentStack}
                                </p>
                            )}
                        </div>

                        <button
                            onClick={this.handleReset}
                            className="w-full py-4 bg-white text-black font-bold rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all"
                        >
                            <RefreshCcw size={18} />
                            Reiniciar App
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
