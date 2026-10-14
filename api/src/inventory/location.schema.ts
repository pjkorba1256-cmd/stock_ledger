import { z } from 'zod';

export const createLocationSchema = z.object({
  warehouseId: z.string().uuid(),
  parentLocationId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(50),
  type: z.enum([
    'INTERNAL',
    'SUPPLIER',
    'CUSTOMER',
    'LOSS',
    'SCRAP',
    'TRANSIT',
  ]),
  barcode: z.string().trim().max(100).optional(),
  sortOrder: z.number().int().default(0),
});

export type CreateLocationInput = z.infer<
  typeof createLocationSchema
>;