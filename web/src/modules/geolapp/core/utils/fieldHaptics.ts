import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * Feedback Háptico Industrial (Operación con guantes, polvo o ruido ambiental).
 * Prioriza @capacitor/haptics nativo en Android y degrada a navigator.vibrate en Web.
 */
export async function triggerFieldImpact(style: 'LIGHT' | 'MEDIUM' | 'HEAVY' = 'MEDIUM'): Promise<void> {
    if (Capacitor.isNativePlatform()) {
        try {
            const impact =
                style === 'LIGHT'
                    ? ImpactStyle.Light
                    : style === 'HEAVY'
                      ? ImpactStyle.Heavy
                      : ImpactStyle.Medium;
            await Haptics.impact({ style: impact });
            return;
        } catch {
            // Fallback a Vibrate WebView
        }
    }

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        const duration = style === 'LIGHT' ? 20 : style === 'HEAVY' ? 70 : 40;
        navigator.vibrate(duration);
    }
}

export async function triggerFieldNotification(
    type: 'SUCCESS' | 'WARNING' | 'ERROR' = 'SUCCESS'
): Promise<void> {
    if (Capacitor.isNativePlatform()) {
        try {
            const notif =
                type === 'ERROR'
                    ? NotificationType.Error
                    : type === 'WARNING'
                      ? NotificationType.Warning
                      : NotificationType.Success;
            await Haptics.notification({ type: notif });
            return;
        } catch {
            // Fallback a Vibrate WebView
        }
    }

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        if (type === 'ERROR') {
            navigator.vibrate([70, 40, 70]);
        } else if (type === 'WARNING') {
            navigator.vibrate([45, 30, 45]);
        } else {
            navigator.vibrate([30, 30, 60]);
        }
    }
}
