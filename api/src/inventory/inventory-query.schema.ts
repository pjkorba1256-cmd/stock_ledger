import { z } from 'zod';

export const stockOnHandQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),

  page: z
    .string()
    .default('1')
    .transform(Number)
    .pipe(z.number().int().min(1)),

  limit: z
    .string()
    .default('20')
    .transform(Number)
    .pipe(z.number().int().min(1).max(100)),
});

export type StockOnHandQuery = z.infer<
  typeof stockOnHandQuerySchema
>;
