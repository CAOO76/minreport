/**
 * SensorFusionService
 * Sincroniza la captura de imágenes con los datos del giroscopio, acelerómetro y GPS.
 * Estima la escala del acopio utilizando el sensor de movimiento del smartphone.
 */

import { Motion } from '@capacitor/motion';
import type { AccelListenerEvent, RotationRate } from '@capacitor/motion';
import { Geolocation } from '@capacitor/geolocation';

export interface SensorData {
    timestamp: number;
    gyroscope: RotationRate;
    accelerometer: { x: number; y: number; z: number };
    gps: {
        latitude: number;
        longitude: number;
        altitude: number | null;
        accuracy: number;
    };
}

export interface CalibratedImage {
    blob: Blob;
    sensorData: SensorData;
    timestamp: number;
}

export class SensorFusionService {
    private currentMotion: AccelListenerEvent | null = null;
    private isCapturing = false;

    /**
     * Inicia la captura de sensores
     */
    async startSensorCapture(): Promise<void> {
        if (this.isCapturing) return;

        try {
            // Solicitar permisos de Geolocalización
            await Geolocation.requestPermissions();

            // Suscribirse a cambios de movimiento
            await Motion.addListener('accel', (event) => {
                this.currentMotion = event;
            });

            this.isCapturing = true;
            console.log('📡 Captura de sensores iniciada');
        } catch (error) {
            console.error('❌ Error al iniciar captura de sensores:', error);
            throw error;
        }
    }

    /**
     * Detiene la captura de sensores
     */
    async stopSensorCapture(): Promise<void> {
        if (!this.isCapturing) return;

        await Motion.removeAllListeners();
        this.isCapturing = false;
        console.log('📡 Captura de sensores detenida');
    }

    /**
     * Sincroniza una imagen con los datos de los sensores en el momento de la captura
     * 
     * @param imageBlob - El blob de la imagen capturada
     * @returns CalibratedImage - Imagen con datos de sensores asociados
     */
    async syncImageWithSensors(imageBlob: Blob): Promise<CalibratedImage> {
        const timestamp = Date.now();

        // Obtenemos la última posición conocida (o la actualizamos si es necesario)
        const position = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
        });

        const sensorData: SensorData = {
            timestamp,
            gyroscope: this.currentMotion?.rotationRate || { alpha: 0, beta: 0, gamma: 0 },
            accelerometer: this.currentMotion?.accelerationIncludingGravity || { x: 0, y: 0, z: 0 },
            gps: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                altitude: position.coords.altitude,
                accuracy: position.coords.accuracy,
            },
        };

        return {
            blob: imageBlob,
            sensorData,
            timestamp,
        };
    }

    /**
     * Estima la escala del acopio utilizando el sensor de movimiento (AR para pobres)
     * Utiliza la integración de la aceleración para estimar la distancia recorrida
     * 
     * @param motionSamples - Muestras de movimiento capturadas durante la trayectoria
     * @returns number - Factor de escala estimado (metros por unidad de píxel/SFM)
     */
    estimateScale(motionSamples: AccelListenerEvent[]): number {
        if (motionSamples.length < 2) return 1.0;

        let totalDisplacement = 0;
        let velocity = { x: 0, y: 0, z: 0 };

        for (let i = 1; i < motionSamples.length; i++) {
            const dt = 0.016; // Asumimos 60fps constante para simplificación
            // Nota: En una implementación real usaríamos un filtro de Kalman o similar
            // y timestamps precisos suministrados por los sensores.

            const accel = motionSamples[i].acceleration;

            velocity.x += accel.x * dt;
            velocity.y += accel.y * dt;
            velocity.z += accel.z * dt;

            const disp = Math.sqrt(
                Math.pow(velocity.x * dt, 2) +
                Math.pow(velocity.y * dt, 2) +
                Math.pow(velocity.z * dt, 2)
            );

            totalDisplacement += disp;
        }

        console.log(`📏 Desplazamiento total estimado: ${totalDisplacement.toFixed(2)}m`);
        return totalDisplacement > 0 ? totalDisplacement : 1.0;
    }
}

export const sensorFusionService = new SensorFusionService();
