import { z } from 'zod';

export { FinancialEventSchema, type FinancialEvent } from '../schemas/FinancialEvent';

/**
 * SensorLogicSchema: Para validación de datos técnicos contrastados con normativa.
 */
export const SensorLogicSchema = z.object({
    sensorId: z.string(),
    reading: z.number(),
    unit: z.string(),
    normativeCheck: z.boolean(),
    sourceDocument: z.string().optional() // Referencia a NotebookLM/Normativa
});

export type SensorLogic = z.infer<typeof SensorLogicSchema>;
