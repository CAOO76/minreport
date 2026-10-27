/**
 * SensorFusionService
 * Sincroniza la captura de imágenes con los datos del giroscopio, acelerómetro y GPS.
 * Estima la escala del acopio utilizando el sensor de movimiento del dispositivo.
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
            await Geolocation.requestPermissions();

            await Motion.addListener('accel', (event) => {
                this.currentMotion = event;
            });

            this.isCapturing = true;
            console.log('[SensorFusion] Captura de sensores iniciada');
        } catch (error) {
            console.error('[SensorFusion] Error al iniciar captura de sensores:', error);
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
        console.log('[SensorFusion] Captura de sensores detenida');
    }

    /**
     * Sincroniza una imagen con los datos de los sensores en el momento de la captura
     */
    async syncImageWithSensors(imageBlob: Blob): Promise<CalibratedImage> {
        const timestamp = Date.now();

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
     * Estima la escala del acopio utilizando la integración cinemática de la aceleración.
     */
    estimateScale(motionSamples: AccelListenerEvent[]): number {
        if (motionSamples.length < 2) return 1.0;

        let totalDisplacement = 0;
        const velocity = { x: 0, y: 0, z: 0 };

        for (let i = 1; i < motionSamples.length; i++) {
            const dt = 0.016;
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

        console.log(`[SensorFusion] Desplazamiento total estimado: ${totalDisplacement.toFixed(2)}m`);
        return totalDisplacement > 0 ? totalDisplacement : 1.0;
    }
}

export const sensorFusionService = new SensorFusionService();
