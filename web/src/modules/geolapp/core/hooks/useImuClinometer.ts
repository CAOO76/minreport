import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Motion } from '@capacitor/motion';

export interface ImuClinometerState {
    pitchDeg: number | null;
    rollDeg: number | null;
    frozenPitchDeg: number | null;
    isListening: boolean;
    isSupported: boolean;
    error: string | null;
    startListening: () => Promise<void>;
    stopListening: () => Promise<void>;
    freezeReading: () => void;
    resetFrozen: () => void;
}

const SMOOTHING_ALPHA = 0.25;

function roundTenth(value: number): number {
    return Math.round(value * 10) / 10;
}

function clampAngle(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function checkImuSupport(): boolean {
    if (Capacitor.isNativePlatform()) {
        return true;
    }
    if (typeof window !== 'undefined') {
        return 'DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window;
    }
    return false;
}

/**
 * Hook React offline para clinometría IMU mediante `@capacitor/motion` en nativo
 * y fallback `DeviceOrientationEvent` en navegador web. Libera listeners al desmontar.
 */
export function useImuClinometer(): ImuClinometerState {
    const [pitchDeg, setPitchDeg] = useState<number | null>(null);
    const [rollDeg, setRollDeg] = useState<number | null>(null);
    const [frozenPitchDeg, setFrozenPitchDeg] = useState<number | null>(null);
    const [isListening, setIsListening] = useState<boolean>(false);
    const [isSupported] = useState<boolean>(() => checkImuSupport());
    const [error, setError] = useState<string | null>(null);

    const isListeningRef = useRef<boolean>(false);
    const mountedRef = useRef<boolean>(true);
    const accelHandleRef = useRef<PluginListenerHandle | null>(null);
    const webHandlerRef = useRef<((event: DeviceOrientationEvent) => void) | null>(null);
    const pitchRef = useRef<number | null>(null);
    const rollRef = useRef<number | null>(null);

    const cleanupListeners = useCallback(async () => {
        if (accelHandleRef.current) {
            const handle = accelHandleRef.current;
            accelHandleRef.current = null;
            try {
                await handle.remove();
            } catch {
                // Ignorar error de liberación al desmontar
            }
        }
        if (webHandlerRef.current && typeof window !== 'undefined') {
            window.removeEventListener('deviceorientation', webHandlerRef.current);
            webHandlerRef.current = null;
        }
    }, []);

    const updateAngles = useCallback((rawPitch: number, rawRoll: number) => {
        if (!mountedRef.current || !Number.isFinite(rawPitch) || !Number.isFinite(rawRoll)) {
            return;
        }
        const boundedPitch = clampAngle(rawPitch, -89.9, 89.9);
        const boundedRoll = clampAngle(rawRoll, -180, 180);

        const nextPitch =
            pitchRef.current === null
                ? boundedPitch
                : pitchRef.current + SMOOTHING_ALPHA * (boundedPitch - pitchRef.current);
        const nextRoll =
            rollRef.current === null
                ? boundedRoll
                : rollRef.current + SMOOTHING_ALPHA * (boundedRoll - rollRef.current);

        pitchRef.current = nextPitch;
        rollRef.current = nextRoll;

        setPitchDeg(roundTenth(nextPitch));
        setRollDeg(roundTenth(nextRoll));
    }, []);

    const stopListening = useCallback(async () => {
        isListeningRef.current = false;
        await cleanupListeners();
        if (mountedRef.current) {
            setIsListening(false);
        }
    }, [cleanupListeners]);

    const startListening = useCallback(async () => {
        if (!isSupported) {
            if (mountedRef.current) {
                setError('Sensor clinometrico IMU no soportado en este dispositivo.');
            }
            return;
        }

        if (isListeningRef.current) {
            return;
        }

        setError(null);
        await cleanupListeners();
        isListeningRef.current = true;
        if (mountedRef.current) {
            setIsListening(true);
        }

        try {
            if (Capacitor.isNativePlatform()) {
                const handle = await Motion.addListener('accel', (event) => {
                    const g = event?.accelerationIncludingGravity;
                    if (!g) return;
                    const { x, y, z } = g;
                    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                        return;
                    }
                    // Dispositivo en modo vertical apuntando con cámara trasera (-Z):
                    // inclinación positiva hacia arriba incrementa proyección positiva sobre eje Z.
                    const planar = Math.hypot(x, y);
                    const pitchRad = Math.atan2(z, planar);
                    const rollRad = Math.atan2(x, y);
                    updateAngles((pitchRad * 180) / Math.PI, (rollRad * 180) / Math.PI);
                });

                if (!mountedRef.current || !isListeningRef.current) {
                    await handle.remove().catch(() => {});
                    return;
                }
                accelHandleRef.current = handle;
                return;
            }

            if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
                const DevOrientationCtor = window.DeviceOrientationEvent as unknown as {
                    requestPermission?: () => Promise<'granted' | 'denied'>;
                };
                if (typeof DevOrientationCtor?.requestPermission === 'function') {
                    const permission = await DevOrientationCtor.requestPermission();
                    if (permission !== 'granted') {
                        throw new Error('Permiso de orientacion IMU denegado por el usuario.');
                    }
                }

                const onDeviceOrientation = (event: DeviceOrientationEvent) => {
                    if (typeof event.beta !== 'number' || !Number.isFinite(event.beta)) {
                        return;
                    }
                    // En orientación vertical portrait: beta=90° corresponde al horizonte (pitch=0°).
                    const computedPitch = event.beta - 90;
                    const computedRoll =
                        typeof event.gamma === 'number' && Number.isFinite(event.gamma)
                            ? event.gamma
                            : 0;
                    updateAngles(computedPitch, computedRoll);
                };

                if (!mountedRef.current || !isListeningRef.current) {
                    return;
                }
                webHandlerRef.current = onDeviceOrientation;
                window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
                return;
            }

            throw new Error('API de sensores de orientacion no disponible en este navegador.');
        } catch (err: unknown) {
            isListeningRef.current = false;
            await cleanupListeners();
            if (mountedRef.current) {
                setIsListening(false);
                setError(
                    err instanceof Error
                        ? err.message
                        : 'No fue posible iniciar el clinometro IMU.'
                );
            }
        }
    }, [cleanupListeners, isSupported, updateAngles]);

    const freezeReading = useCallback(() => {
        if (pitchRef.current !== null) {
            setFrozenPitchDeg(roundTenth(pitchRef.current));
        }
    }, []);

    const resetFrozen = useCallback(() => {
        setFrozenPitchDeg(null);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            isListeningRef.current = false;
            void cleanupListeners();
        };
    }, [cleanupListeners]);

    return {
        pitchDeg,
        rollDeg,
        frozenPitchDeg,
        isListening,
        isSupported,
        error,
        startListening,
        stopListening,
        freezeReading,
        resetFrozen,
    };
}
