import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

/**
 * Hook to access native hardware (Camera, Geolocation) with Web Fallbacks.
 */
export function useNativeFeatures() {
    const isNative = Capacitor.isNativePlatform();

    // --- CAMERA ---
    const takePhoto = async () => {
        if (isNative) {
            try {
                const image = await Camera.getPhoto({
                    quality: 90,
                    allowEditing: false,
                    resultType: CameraResultType.Uri,
                    source: CameraSource.Camera
                });
                return image.webPath;
            } catch (error) {
                console.error("Native Camera Error:", error);
                throw error;
            }
        } else {
            console.log("📸 [WEB] Usando API de Cámara del navegador...");
            alert("La cámara nativa solo está disponible en la App. En web, usa el selector de archivos estándar.");
            return null;
        }
    };

    // --- GEOLOCATION ---
    const getCurrentPosition = async () => {
        if (isNative) {
            try {
                const coordinates = await Geolocation.getCurrentPosition();
                return {
                    lat: coordinates.coords.latitude,
                    lng: coordinates.coords.longitude
                };
            } catch (error) {
                console.error("Native Geolocation Error:", error);
                throw error;
            }
        } else {
            return new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error("Geolocation not supported by this browser."));
                } else {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                        (err) => reject(err)
                    );
                }
            });
        }
    };

    return {
        isNative,
        takePhoto,
        getCurrentPosition
    };
}