import { Component, ErrorInfo, ReactNode } from 'react';
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
                <div className="h-screen w-screen flex flex-col items-center justify-center p-8 bg-[#0D0D0D] text-white select-none relative overflow-hidden">
                    <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none"></div>
                    <div className="bg-red-500/5 border border-red-500/20 p-8 rounded-none flex flex-col items-center max-w-sm w-full relative z-10">
                        <div className="w-16 h-16 bg-red-600 rounded-none flex items-center justify-center mb-8 border border-red-500/40">
                            <AlertTriangle size={32} className="text-white" />
                        </div>

                        <h1 className="hud-label text-red-500 text-lg mb-2">[CRITICAL_FAULT_DETECTION]</h1>
                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest text-center mb-8">
                            Se ha detectado una ruptura en la integridad del renderizado.
                        </p>

                        <div className="w-full bg-black/40 rounded-none p-5 mb-8 border border-white/5">
                            <p className="hud-label text-red-500/60 text-[9px] mb-2">[EXCEPTION_LOG]</p>
                            <p className="text-xs font-mono text-red-400/80 break-all">
                                {this.state.error?.message}
                            </p>
                            {this.state.errorInfo && (
                                <p className="text-[9px] font-mono text-white/20 mt-4 overflow-hidden h-20 opacity-40">
                                    {this.state.errorInfo.componentStack}
                                </p>
                            )}
                        </div>

                        <button
                            onClick={this.handleReset}
                            className="w-full py-5 bg-white text-black font-black text-[11px] uppercase tracking-[0.3em] rounded-none flex items-center justify-center gap-3 active:scale-95 transition-all shadow-antigravity-accent/5 shadow-2xl"
                        >
                            <RefreshCcw size={18} />
                            RECOVER_SYSTEM
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
