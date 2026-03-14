import { FinancialEventSchema, type FinancialEvent } from '../schemas/FinancialEvent';

type EventCallback = (payload: any) => void;

/**
 * GlobalEventBus
 * Motor de enrutamiento central y estricto.
 */
export class GlobalEventBus {
    private static instance: GlobalEventBus;
    private listeners: Map<string, Set<EventCallback>> = new Map();

    private constructor() {}

    public static getInstance(): GlobalEventBus {
        if (!GlobalEventBus.instance) {
            GlobalEventBus.instance = new GlobalEventBus();
        }
        return GlobalEventBus.instance;
    }

    /**
     * Dispatch estricto para eventos financieros.
     * Valida la estructura mediante el Global Ledger Contract antes de emitir.
     */
    public dispatchFinancialEvent(payload: FinancialEvent): void {
        try {
            // Validación estricta Zod
            const validData = FinancialEventSchema.parse(payload);
            this.internalDispatch('FINANCIAL_TRANSACTION', validData);
        } catch (error) {
            console.error('[AUDIT_ERROR] FinancialEvent payload rejected by Zod Schema:', error);
            // Evitamos propagar el error crudo al plugin para no crashear la UI,
            // pero el Ledger bloquea el ingreso.
        }
    }

    /**
     * Suscripción a eventos.
     * Retorna una función de cleanup para evitar memory leaks (ej. useEffect en React).
     */
    public subscribe(eventType: string, callback: EventCallback): () => void {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        
        this.listeners.get(eventType)!.add(callback);
        
        // Función Cleanup (Desuscripción atómica)
        return () => {
            const callbacks = this.listeners.get(eventType);
            if (callbacks) {
                callbacks.delete(callback);
            }
        };
    }

    private internalDispatch(eventType: string, data: any): void {
        const callbacks = this.listeners.get(eventType);
        if (callbacks) {
            callbacks.forEach(cb => cb(data));
        }
    }
}

export const eventBus = GlobalEventBus.getInstance();
