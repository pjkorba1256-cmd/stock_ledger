import { z } from 'zod';

export const createStockMoveSchema = z
  .object({
    referenceId: z.string().trim().max(100).optional(),
    referenceType: z
      .enum([
        'GRN',
        'SALE',
        'RETURN',
        'TRANSFER',
        'ADJUSTMENT',
        'SCRAP',
      ])
      .optional(),
    productId: z.string().uuid(),
    variantId: z.string().uuid().optional(),
    lotId: z.string().uuid().optional(),
    transferId: z.string().uuid().optional(),
    sourceLocationId: z.string().uuid(),
    destinationLocationId: z.string().uuid(),
    quantity: z.number().positive(),
    unitCostPaise: z.number().int().nonnegative().optional(),
    performedBy: z.string().trim().min(1).max(100),
    notes: z.string().max(5000).optional(),
  })
  .refine(
    (data) => data.sourceLocationId !== data.destinationLocationId,
    {
      message: 'Source and destination locations must be different',
      path: ['destinationLocationId'],
    },
  );

export type CreateStockMoveInput = z.infer<
  typeof createStockMoveSchema
>;

export const stockMoveParamsSchema = z.object({
  id: z.string().uuid({ message: 'Movement ID must be a valid UUID' }),
});

export type StockMoveParams = z.infer<
  typeof stockMoveParamsSchema
>;

export const stockMoveHistoryQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  state: z.enum(['DRAFT', 'CONFIRMED', 'DONE', 'CANCELLED']).optional(),
  referenceType: z
    .enum(['GRN', 'SALE', 'RETURN', 'TRANSFER', 'ADJUSTMENT', 'SCRAP'])
    .optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
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

export type StockMoveHistoryQuery = z.infer<
  typeof stockMoveHistoryQuerySchema
>;
