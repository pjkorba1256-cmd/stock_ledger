import { z } from 'zod';

export const createWarehouseSchema = z.object({
  merchantId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(20),
  address: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().default(false),
});

export type CreateWarehouseInput = z.infer<
  typeof createWarehouseSchema
>;