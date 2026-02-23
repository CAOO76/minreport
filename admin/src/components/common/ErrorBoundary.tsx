import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onReset?: () => void;
}

interface State {
    hasError: boolean;
}

/**
 * Standard Error Boundary to isolate plugin failures
 */
export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false
    };

    public static getDerivedStateFromError(_: Error): State {
        return { hasError: true };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error inside Plugin:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div className="p-6 bg-red-500/5 dark:bg-red-500/10 border border-red-500/20 rounded-none text-red-700 dark:text-red-400">
                    <h3 className="hud-label text-red-600 dark:text-red-500 mb-2">
                        [CORE_PLUGIN_FAULT]
                    </h3>
                    <p className="text-xs font-bold uppercase tracking-tight opacity-70">
                        El módulo ha dejado de funcionar de forma inesperada.
                    </p>
                    <button
                        onClick={() => {
                            this.setState({ hasError: false });
                            this.props.onReset?.();
                        }}
                        className="mt-4 px-4 py-2 bg-red-600 text-white hud-label text-[9px] hover:bg-red-700 transition-all active:scale-95"
                    >
                        RETRY_INIT
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
