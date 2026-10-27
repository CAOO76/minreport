/**
 * usePushNotifications — F-FIELD.4
 * Gestiona el registro de Push Notifications en dispositivos iOS/Android via Capacitor.
 * - Solicita permiso al usuario
 * - Captura el FCM token del dispositivo
 * - Persiste el token en Firestore → users/{uid}/fcmToken
 *
 * En web/emulador no hace nada (degradación elegante).
 */
import { useEffect } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { 
  PushNotificationsPlugin, 
  PushNotificationSchema, 
  ActionPerformed 
} from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

// Detección dinámica de Capacitor (no rompe en web/emulador)
const isCapacitor = (): boolean => {
  return Capacitor.isNativePlatform();
};

export function usePushNotifications(userId: string | null) {
  useEffect(() => {
    if (!userId || !isCapacitor()) return;

    // Import dinámico: solo se carga en plataformas nativas
    import('@capacitor/push-notifications').then(({ PushNotifications }) => {
      PushNotifications.checkPermissions().then((status) => {
        if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
          PushNotifications.requestPermissions().then((result) => {
            if (result.receive === 'granted') {
              registerDevice(PushNotifications, userId);
            }
          });
        } else if (status.receive === 'granted') {
          registerDevice(PushNotifications, userId);
        }
      });
    }).catch((err: Error) => {
      console.warn('[F-FIELD.4] @capacitor/push-notifications no disponible (web):', err.message);
    });
  }, [userId]);
}

async function registerDevice(PushNotifications: PushNotificationsPlugin, userId: string) {
  try {
    await PushNotifications.register();

    // Captura el token al registrarse
    PushNotifications.addListener('registration', async (token: { value: string }) => {
      console.log('[F-FIELD.4] FCM Token capturado:', token.value.substring(0, 20) + '...');
      
      // Guardar token en Firestore bajo el perfil del usuario
      await setDoc(
        doc(db, 'users', userId),
        {
          fcmToken: token.value,
          fcmTokenUpdatedAt: serverTimestamp(),
          platform: Capacitor.getPlatform(),
        },
        { merge: true }
      );
      
      console.log('[F-FIELD.4] FCM Token guardado en Firestore para usuario:', userId);
    });

    // Log de errores de registro
    PushNotifications.addListener('registrationError', (err: unknown) => {
      console.error('[F-FIELD.4] Error de registro FCM:', err);
    });

    // Manejo de notificaciones recibidas en primer plano
    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      console.log('[F-FIELD.4] Notificación recibida (foreground):', notification.title);
    });

    // Manejo de acción al presionar la notificación
    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      console.log('[F-FIELD.4] Notificación presionada:', action.notification.data);
    });

  } catch (err) {
    console.error('[F-FIELD.4] Error al registrar dispositivo para FCM:', err);
  }
}
