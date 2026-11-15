import { useEffect, useRef } from 'react';

export const XCOVER_KEY_EVENT_NAME = 'geolapp:xcover-key';

export const XCOVER_HARDWARE_KEY_CODES = {
    XCOVER_SIDE_KEY: 1015,
    XCOVER_TOP_KEY: 1079,
    F1: 131,
    CAMERA: 27,
} as const;

export type XCoverKeyAction = 'DOWN' | 'UP';

export interface XCoverHardwareKeyDetail {
    keyCode: number;
    action: XCoverKeyAction;
    timestamp: number;
}

export interface UseXCoverHardwareKeyOptions {
    enabled?: boolean;
    action?: XCoverKeyAction | 'BOTH';
    keyCodes?: readonly number[];
}

/**
 * Suscribe un componente React al evento nativo `geolapp:xcover-key` despachado desde MainActivity.java
 * al presionar las teclas programables del Samsung Galaxy XCover7 (1015 lateral, 1079 superior, F1, Camera).
 */
export function useXCoverHardwareKey(
    onKeyEvent: (detail: XCoverHardwareKeyDetail) => void,
    options: UseXCoverHardwareKeyOptions = {}
): void {
    const { enabled = true, action = 'DOWN', keyCodes } = options;

    const callbackRef = useRef(onKeyEvent);
    callbackRef.current = onKeyEvent;

    const keyCodesRef = useRef(keyCodes);
    keyCodesRef.current = keyCodes;

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') {
            return;
        }

        const handleXCoverKey: EventListener = (event: Event) => {
            const customEvent = event as CustomEvent<Partial<XCoverHardwareKeyDetail> | undefined>;
            const detail = customEvent.detail;

            if (
                !detail ||
                typeof detail.keyCode !== 'number' ||
                !Number.isFinite(detail.keyCode) ||
                (detail.action !== 'DOWN' && detail.action !== 'UP')
            ) {
                return;
            }

            if (action !== 'BOTH' && detail.action !== action) {
                return;
            }

            const allowedCodes = keyCodesRef.current;
            if (allowedCodes && allowedCodes.length > 0 && !allowedCodes.includes(detail.keyCode)) {
                return;
            }

            callbackRef.current({
                keyCode: detail.keyCode,
                action: detail.action,
                timestamp:
                    typeof detail.timestamp === 'number' && Number.isFinite(detail.timestamp)
                        ? detail.timestamp
                        : Date.now(),
            });
        };

        window.addEventListener(XCOVER_KEY_EVENT_NAME, handleXCoverKey);
        return () => {
            window.removeEventListener(XCOVER_KEY_EVENT_NAME, handleXCoverKey);
        };
    }, [enabled, action]);
}
