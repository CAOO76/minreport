import { Component, ErrorInfo, ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';

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
        errorInfo: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary] Uncaught render error:', error, errorInfo);
        this.setState({ errorInfo });
    }

    private handleReset = () => {
        window.location.href = Capacitor.isNativePlatform() ? '/mobile/login' : '/login';
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen w-full flex flex-col items-center justify-center p-fib-34 bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] select-none font-sans">
                    <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-34 rounded-none shadow-none flex flex-col items-center max-w-md w-full space-y-fib-21">
                        <span className="material-symbols-outlined text-[32px] text-red-500">
                            warning
                        </span>

                        <div className="text-center space-y-fib-8">
                            <h1 className="text-microcopy font-mono font-bold uppercase text-red-500">
                                [EXCEPCIÓN CRÍTICA DE INTERFAZ]
                            </h1>
                            <p className="text-data-dense text-[#475569] dark:text-[#8A93A6]">
                                Se interrumpió el ciclo de renderizado del componente activo.
                            </p>
                        </div>

                        <div className="w-full bg-[#FFFFFF] dark:bg-[#000000] rounded-none p-fib-13 border border-[#E2E8F0] dark:border-[#12151C]">
                            <p className="text-microcopy font-mono text-red-500 mb-fib-8">[DETALLE TÉCNICO]</p>
                            <p className="text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] break-all select-text">
                                {this.state.error?.message || 'Error de ejecución no especificado'}
                            </p>
                            {this.state.errorInfo && (
                                <p className="text-microcopy font-mono text-[#94A3B8] dark:text-[#5A6072] mt-fib-8 overflow-hidden max-h-20">
                                    {this.state.errorInfo.componentStack}
                                </p>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={this.handleReset}
                            className="w-full py-fib-13 px-fib-21 bg-[#C68346] hover:bg-[#B0743E] text-white font-mono font-bold text-microcopy uppercase rounded-none shadow-none transition-colors cursor-pointer"
                        >
                            RESTABLECER SESIÓN OPERATIVA
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
