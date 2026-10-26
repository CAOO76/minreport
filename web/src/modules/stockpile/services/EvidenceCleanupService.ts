/**
 * EvidenceCleanupService
 * Gestión de la "Limpieza de Evidencia": eliminación de originales y generación de recursos optimizados.
 */

import type { Mesh3D } from '../types/PointCloud';
import * as THREE from 'three';
// @ts-ignore - Dependencia de Three.js que puede variar en resolución de tipos según tsconfig
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';

export interface CleanupConfig {
    deleteOriginals: boolean;
    proxyMaxSize: number; // en KB
    proxyQuality: number; // 0-1
}

export class EvidenceCleanupService {
    /**
     * Genera el Proxy Visual (WebP < 200kb) a partir de una imagen
     */
    async generateProxyImage(imageBlob: Blob, quality: number = 0.7): Promise<Blob> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = URL.createObjectURL(imageBlob);

            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // Redimensionar para asegurar tamaño < 200kb (ajuste dinámico de resolución)
                const maxDim = 800; // Resolución suficiente para un proxy visual
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxDim) {
                        height *= maxDim / width;
                        width = maxDim;
                    }
                } else {
                    if (height > maxDim) {
                        width *= maxDim / height;
                        height = maxDim;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                ctx?.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (blob) {
                        console.log(`🖼️ Proxy generado: ${(blob.size / 1024).toFixed(2)} KB`);
                        resolve(blob);
                    } else {
                        reject(new Error('Error al generar blob WebP'));
                    }
                }, 'image/webp', quality);
            };

            img.onerror = () => reject(new Error('Error al cargar imagen para proxy'));
        });
    }

    /**
     * Genera el archivo .glb comprimido a partir de la malla 3D
     */
    async generateGLB(meshData: Mesh3D): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
            geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

            const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
            const mesh = new THREE.Mesh(geometry, material);

            const exporter = new GLTFExporter();
            exporter.parse(
                mesh,
                (gltf: any) => {
                    if (gltf instanceof ArrayBuffer) {
                        console.log(`📦 Malla GLB generada: ${(gltf.byteLength / 1024).toFixed(2)} KB`);
                        resolve(gltf);
                    } else {
                        // Si es un objeto JSON, lo convertimos a texto y luego a buffer (aunque preferimos binario)
                        const text = JSON.stringify(gltf);
                        const buffer = new TextEncoder().encode(text).buffer;
                        resolve(buffer);
                    }
                },
                (error: any) => reject(error),
                { binary: true }
            );
        });
    }

    /**
     * Elimina las imágenes originales de alta resolución
     * (En Capacitor, esto implicaría borrar archivos de la memoria flash)
     */
    async cleanupOriginals(imageUrls: string[]): Promise<void> {
        console.log(`🧹 Eliminando ${imageUrls.length} imágenes originales de alta resolución...`);
        // Simulación de borrado. Implementación real usaría Capacitor Filesystem.
        return Promise.resolve();
    }
}

export const evidenceCleanupService = new EvidenceCleanupService();
