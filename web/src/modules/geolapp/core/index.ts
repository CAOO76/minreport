/**
 * GEOLAPP® Headless Core Barrel (Fase 4)
 *
 * Exporta tipos, cálculos geocientíficos puros, adaptadores de hardware/superficie
 * (UAV, LiDAR móvil, GNSS/RTK NMEA), constructores glTF 2.0 `.glb`, servicios de
 * datos/almacenamiento, generadores PDF vectoriales y hook de clinometría IMU.
 *
 * Cero React JSX para portabilidad futura hacia runtimes Capacitor nativo y Node.js.
 */

export * from './types/GeolappTypes';
export * from './utils/geoscienceCalculations';

export * from './adapters/ISurfaceSourceAdapter';
export * from './adapters/UavPointCloudAdapter';
export * from './adapters/MobileLidarAdapter';
export * from './adapters/GnssRtkNmeaAdapter';

export * from './utils/glbMeshBuilder';

export * from './services/DataService';
export * from './services/StorageService';
export * from './utils/vectorPdfGenerator';

export * from './hooks/useImuClinometer';
