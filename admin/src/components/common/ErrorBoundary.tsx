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
                <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
                    <h3 className="font-bold flex items-center gap-2">
                        <span className="material-symbols-rounded text-lg">warning</span>
                        Error de Plugin
                    </h3>
                    <p className="text-sm opacity-80 mt-1">
                        El plugin ha dejado de funcionar de forma inesperada.
                    </p>
                    <button
                        onClick={() => {
                            this.setState({ hasError: false });
                            this.props.onReset?.();
                        }}
                        className="mt-3 text-xs font-semibold underline"
                    >
                        Reintentar carga
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
