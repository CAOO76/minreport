import React, { type ReactNode } from 'react';
import App from './App';
import type { PluginConfig, SecureContext } from '@minreport/sdk';
import { enableOfflinePersistence, getFirebaseConfig } from './config/firebase.config';
import { dataService, type StockpileData } from './services/DataService';
import { storageService } from './services/StorageService';
import { connectivityMonitor } from './utils/offline';

/**
 * Plugin de Control de Stockpile para MINREPORT
 * Implementa el ciclo de vida requerido por la plataforma
 */
export class StockpileControlPlugin {
    private config: PluginConfig;
    private isActive: boolean = false;

    constructor() {
        this.config = {
            name: 'stockpile-control',
            version: '2.1.0',
            description: 'Plugin de control y monitoreo de stockpile para MINREPORT',
            author: 'MinReport Engineering',
        };
    }

    /**
   * Método del ciclo de vida: Activación del plugin
   * Se ejecuta cuando MINREPORT activa el plugin
   */
    async onActivate(): Promise<void> {
        console.log('[StockpileControl] Plugin activado');
        this.isActive = true;

        // Habilitar persistencia offline de Firestore
        await enableOfflinePersistence();

        // Mostrar configuración de Firebase
        const firebaseConfig = getFirebaseConfig();
        console.log('🔥 Firebase configurado:', firebaseConfig);
        console.log(`📍 Región: ${firebaseConfig.region}`);
        console.log(`⛔ App Engine: ${firebaseConfig.appEngineProhibited ? 'PROHIBIDO' : 'Permitido'}`);

        // Inicializar monitor de conectividad
        connectivityMonitor.subscribe((state) => {
            console.log(`📡 Estado de conexión: ${state.online ? '🟢 Online' : '🔴 Offline'}`);
        });

        // TODO: Inicializar servicios y componentes del plugin
        await this.initializeServices();
    }

    /**
     * Método del ciclo de vida: Desactivación del plugin
     * Se ejecuta cuando MINREPORT desactiva el plugin
     */
    async onDeactivate(): Promise<void> {
        console.log('[StockpileControl] Plugin desactivado');
        this.isActive = false;

        // TODO: Limpiar recursos y cerrar conexiones
        await this.cleanupResources();
    }

    /**
     * Método del ciclo de vida opcional: Inicialización
     * Se ejecuta al cargar el plugin por primera vez
     */
    async onInit(context: SecureContext): Promise<void> {
        console.log('[StockpileControl] Plugin inicializado con contexto seguro:', context);

        // Inyectar contexto en el servicio de datos para habilitar persistencia blindada
        dataService.setSecureContext(context);

        console.log('Configuración:', this.config);
        this.isActive = true; // Forzamos activo para asegurar rendering en admin
    }

    /**
     * RETORNA EL COMPONENTE PRINCIPAL (Requerido por MINREPORT)
     */
    public renderWidget(): ReactNode {
        return React.createElement(App);
    }

    /**
     * Método del ciclo de vida opcional: Recepción de datos
     * Se ejecuta cuando el plugin recibe datos desde MINREPORT
     */
    async onData(data: any): Promise<void> {
        console.log('[StockpileControl] Datos recibidos:', data);

        // TODO: Procesar datos recibidos desde la plataforma
    }

    /**
     * Inicializar servicios del plugin
     */
    private async initializeServices(): Promise<void> {
        // TODO: Implementar inicialización de servicios
        console.log('[StockpileControl] Inicializando servicios...');
    }

    /**
     * Limpiar recursos del plugin
     */
    private async cleanupResources(): Promise<void> {
        // TODO: Implementar limpieza de recursos
        console.log('[StockpileControl] Limpiando recursos...');
    }

    /**
   * Obtener el estado actual del plugin
   */
    public getStatus(): { active: boolean; config: PluginConfig } {
        return {
            active: this.isActive,
            config: this.config,
        };
    }

    /**
     * Guardar datos de stockpile
     * Utiliza MinReport.Data.extendEntity para guardar en extensions.stockpile-control
     */
    public async saveStockpileData(data: StockpileData): Promise<string> {
        if (!this.isActive) {
            throw new Error('Plugin no está activo');
        }
        return dataService.saveStockpileData(data);
    }

    /**
     * Obtener datos de stockpile
     */
    public async getStockpileData(id: string): Promise<StockpileData | null> {
        return dataService.getStockpileData(id);
    }

    /**
     * Subir imagen de stockpile
     */
    public async uploadStockpileImage(
        file: File | Blob,
        stockpileId: string,
        onProgress?: (progress: number) => void
    ) {
        if (!this.isActive) {
            throw new Error('Plugin no está activo');
        }
        return storageService.uploadStockpileImage(file, stockpileId, {}, onProgress);
    }

    /**
     * Obtener imágenes de stockpile
     */
    public async getStockpileImages(stockpileId: string): Promise<string[]> {
        return storageService.listStockpileImages(stockpileId);
    }
}

// Exportar instancia única del plugin por defecto (MANDATORIO)
export default new StockpileControlPlugin();
