import { z } from 'zod';

export const createCountSchema = z.object({
  warehouseId: z.string().uuid('Warehouse ID must be a valid UUID'),
  locationId: z.string().uuid('Location ID must be a valid UUID'),
  countedBy: z.string().min(1, 'countedBy is required').max(100),
  notes: z.string().optional(),
});

export type CreateCountInput = z.infer<typeof createCountSchema>;

export const countLineInputSchema = z.object({
  productId: z.string().uuid('Product ID must be a valid UUID'),
  lotId: z.string().uuid().optional(),
  countedQuantity: z.coerce.number().nonnegative('Counted quantity cannot be negative'),
  notes: z.string().optional(),
});

export const recordCountLinesSchema = z.object({
  lines: z.array(countLineInputSchema).min(1, 'At least one line is required'),
});

export type RecordCountLinesInput = z.infer<typeof recordCountLinesSchema>;

export const reconcileCountSchema = z.object({
  approvedBy: z.string().min(1, 'approvedBy is required').max(100),
  lossLocationId: z.string().uuid().optional(),
});

export type ReconcileCountInput = z.infer<typeof reconcileCountSchema>;
