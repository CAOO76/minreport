import { z } from 'zod';

/**
 * CORE SDK SHIELD - Mock/Stub para el Remote Plugin
 * Simula el comportamiento de @core/sdk (Ecosistema Independiente).
 * EVENT-LEDGER-AUDITOR: Este esquema DEBE usarse para todo evento de estado crítico.
 */

export const SystemEventSchema = z.object({
  event_type: z.string(),
  source_skill: z.string(),
  payload: z.any(),
  timestamp: z.string().datetime(),
});

export type SystemEvent = z.infer<typeof SystemEventSchema>;

type EventCallback = (data: SystemEvent) => void;

class EventBusStub {
  private listeners: Record<string, EventCallback[]> = {};

  emit(eventType: string, data: SystemEvent) {
    // Validar esquema (Auditoría estricta)
    SystemEventSchema.parse(data);

    // En un Remote Plugin real, esto viaja al Host iframe/window message
    console.log(`[EVENT-LEDGER-AUDITOR] 🛡️ Evento universal emitido: ${eventType}`, data);
    
    if (this.listeners[eventType]) {
      this.listeners[eventType].forEach(fn => fn(data));
    }
  }

  on(eventType: string, callback: EventCallback) {
    if (!this.listeners[eventType]) this.listeners[eventType] = [];
    this.listeners[eventType].push(callback);
  }
}

export const eventBus = new EventBusStub();
