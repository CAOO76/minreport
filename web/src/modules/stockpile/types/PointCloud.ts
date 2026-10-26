/**
 * PointCloud Types
 * Estructura de datos optimizada para procesamiento 3D en móvil
 */

export interface Point3D {
    x: number;
    y: number;
    z: number;
    confidence: number; // 0-1
}

export interface BoundingBox {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
}

export interface PointCloud {
    points: Point3D[];
    bounds: BoundingBox;
    density: 'low' | 'medium' | 'high';
    scale: number; // metros por unidad
}

export interface Mesh3D {
    vertices: Float32Array;
    indices: Uint32Array;
    normals?: Float32Array;
}
