import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useMinReportSession } from './MinReportSessionContext';

export type ErgonomicScale = '100' | '125' | '150';

export const ERGONOMIC_SCALE_STORAGE_KEY = 'minreport_ergonomic_scale';
export const ERGONOMIC_SCALE_EXPLICIT_KEY = 'minreport_ergonomic_scale_explicit';

const SCALE_TO_ROOT_PX: Record<ErgonomicScale, string> = {
    '100': '16px',
    '125': '20px',
    '150': '24px',
};

interface ErgonomicScaleContextType {
    scale: ErgonomicScale;
    setScale: (nextScale: ErgonomicScale) => void;
    cycleScale: () => void;
}

const ErgonomicScaleContext = createContext<ErgonomicScaleContextType>({
    scale: '100',
    setScale: () => {},
    cycleScale: () => {},
});

function readStoredScale(): ErgonomicScale {
    try {
        const stored = localStorage.getItem(ERGONOMIC_SCALE_STORAGE_KEY);
        if (stored === '125' || stored === '150' || stored === '100') {
            return stored;
        }
    } catch {
        // Almacenamiento bloqueado
    }
    return '100';
}

function applyScaleToDom(nextScale: ErgonomicScale): void {
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.dataset.ergonomicScale = nextScale;
        document.documentElement.style.fontSize = SCALE_TO_ROOT_PX[nextScale];
    }
}

export const ErgonomicScaleProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { session, isLoaded } = useMinReportSession();
    const [scale, setScaleState] = useState<ErgonomicScale>(() => readStoredScale());

    useEffect(() => {
        applyScaleToDom(scale);
    }, [scale]);

    // Auto-activar confort 125% por defecto para 3º TEST-PILOT si el usuario no eligió manualmente otra escala
    useEffect(() => {
        if (!isLoaded || !session) return;
        const isSeniorPilotProfile = Boolean(
            session.isTestPilot || session.role === 'TEST_PILOT'
        );
        if (!isSeniorPilotProfile) return;

        try {
            const hasExplicitChoice = localStorage.getItem(ERGONOMIC_SCALE_EXPLICIT_KEY) === '1';
            const stored = localStorage.getItem(ERGONOMIC_SCALE_STORAGE_KEY);
            if (!hasExplicitChoice && (!stored || stored === '100')) {
                setScaleState('125');
                localStorage.setItem(ERGONOMIC_SCALE_STORAGE_KEY, '125');
            }
        } catch {
            // Ignorar si almacenamiento local no disponible
        }
    }, [isLoaded, session]);

    const setScale = useCallback((nextScale: ErgonomicScale) => {
        setScaleState(nextScale);
        applyScaleToDom(nextScale);
        try {
            localStorage.setItem(ERGONOMIC_SCALE_STORAGE_KEY, nextScale);
            localStorage.setItem(ERGONOMIC_SCALE_EXPLICIT_KEY, '1');
        } catch {
            // Ignorar en entornos sin localStorage
        }
    }, []);

    const cycleScale = useCallback(() => {
        const order: ErgonomicScale[] = ['100', '125', '150'];
        const nextIdx = (order.indexOf(scale) + 1) % order.length;
        setScale(order[nextIdx]);
    }, [scale, setScale]);

    return (
        <ErgonomicScaleContext.Provider value={{ scale, setScale, cycleScale }}>
            {children}
        </ErgonomicScaleContext.Provider>
    );
};

export const useErgonomicScale = (): ErgonomicScaleContextType => {
    return useContext(ErgonomicScaleContext);
};
