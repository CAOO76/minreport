/**
 * EvidenceCleanupService
 * Gestión de la limpieza de evidencia fotogramétrica: liberación determinista de memoria GPU/DOM y generación de recursos optimizados.
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
     * Genera el Proxy Visual (WebP < 200kb) a partir de una imagen y libera el ObjectURL temporal.
     */
    async generateProxyImage(imageBlob: Blob, quality: number = 0.7): Promise<Blob> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const objectUrl = URL.createObjectURL(imageBlob);
            img.src = objectUrl;

            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                const maxDim = 800;
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
                    canvas.width = 0;
                    canvas.height = 0;
                    if (blob) {
                        console.log(`[EvidenceCleanup] Proxy WebP generado: ${(blob.size / 1024).toFixed(2)} KB`);
                        resolve(blob);
                    } else {
                        reject(new Error('Error al generar blob WebP'));
                    }
                }, 'image/webp', quality);
            };

            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('Error al cargar imagen para proxy'));
            };
        });
    }

    /**
     * Genera el archivo .glb comprimido a partir de la malla 3D y libera recursos WebGL/Three.js (dispose).
     */
    async generateGLB(meshData: Mesh3D): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
            geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

            const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
            const mesh = new THREE.Mesh(geometry, material);

            const cleanupThreeResources = () => {
                geometry.dispose();
                material.dispose();
            };

            const exporter = new GLTFExporter();
            exporter.parse(
                mesh,
                (gltf: any) => {
                    cleanupThreeResources();
                    if (gltf instanceof ArrayBuffer) {
                        console.log(`[EvidenceCleanup] Malla GLB generada: ${(gltf.byteLength / 1024).toFixed(2)} KB`);
                        resolve(gltf);
                    } else {
                        const text = JSON.stringify(gltf);
                        const buffer = new TextEncoder().encode(text).buffer;
                        resolve(buffer);
                    }
                },
                (error: any) => {
                    cleanupThreeResources();
                    reject(error);
                },
                { binary: true }
            );
        });
    }

    /**
     * Elimina las imágenes originales de alta resolución tras consolidar el proxy WebP.
     */
    async cleanupOriginals(imageUrls: string[]): Promise<void> {
        for (const url of imageUrls) {
            if (typeof url === 'string' && url.startsWith('blob:')) {
                try {
                    URL.revokeObjectURL(url);
                } catch {
                    // Ignorar si ya fue revocado
                }
            }
        }
        console.log(`[EvidenceCleanup] Liberadas ${imageUrls.length} referencias temporales de alta resolución.`);
        return Promise.resolve();
    }
}

export const evidenceCleanupService = new EvidenceCleanupService();
