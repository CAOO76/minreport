import { z } from 'zod';

/**
 * EVENT-LEDGER-AUDITOR — Bus de Eventos Nativo Polimórfico (MINREPORT / OPERMAQ)
 * Valida y propaga eventos de estado crítico bajo SystemEventSchema.
 */

export const SystemEventSchema = z.object({
  event_type: z.string(),
  source_skill: z.string(),
  payload: z.any(),
  timestamp: z.string().datetime(),
});

export type SystemEvent = z.infer<typeof SystemEventSchema>;

type EventCallback = (data: SystemEvent) => void;

class NativeEventBus {
  private listeners: Record<string, EventCallback[]> = {};

  emit(eventType: string, data: SystemEvent) {
    SystemEventSchema.parse(data);

    if (this.listeners[eventType]) {
      this.listeners[eventType].forEach(fn => fn(data));
    }
  }

  on(eventType: string, callback: EventCallback) {
    if (!this.listeners[eventType]) this.listeners[eventType] = [];
    this.listeners[eventType].push(callback);
  }
}

export const eventBus = new NativeEventBus();
