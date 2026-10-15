import { z } from 'zod';

export const createTransferSchema = z.object({
  type: z.enum(['RECEIPT', 'DELIVERY', 'INTERNAL', 'RETURN']).default('INTERNAL'),
  warehouseId: z.string().uuid('Warehouse ID must be a valid UUID'),
  sourceLocationId: z.string().uuid('Source location ID must be a valid UUID').optional(),
  destinationLocationId: z.string().uuid('Destination location ID must be a valid UUID').optional(),
  partnerId: z.string().max(100).optional(),
  partnerType: z.enum(['VENDOR', 'CUSTOMER']).optional(),
  referenceId: z.string().max(100).optional(),
  referenceType: z.string().max(30).optional(),
  scheduledDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  createdBy: z.string().min(1, 'createdBy is required').max(100),
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;

export const transferLineSchema = z.object({
  productId: z.string().uuid('Product ID must be a valid UUID'),
  variantId: z.string().uuid().optional(),
  lotId: z.string().uuid().optional(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
});

export const dispatchTransferSchema = z.object({
  transitLocationId: z.string().uuid().optional(),
  performedBy: z.string().min(1).max(100),
  lines: z.array(transferLineSchema).min(1, 'At least one line is required for dispatch'),
});

export type DispatchTransferInput = z.infer<typeof dispatchTransferSchema>;

export const receiveTransferLineSchema = z.object({
  productId: z.string().uuid('Product ID must be a valid UUID'),
  variantId: z.string().uuid().optional(),
  lotId: z.string().uuid().optional(),
  receivedQuantity: z.coerce.number().nonnegative('Received quantity cannot be negative'),
  shortageQuantity: z.coerce.number().nonnegative('Shortage quantity cannot be negative').default(0),
  shortageReason: z.string().optional(),
});

export const receiveTransferSchema = z.object({
  performedBy: z.string().min(1).max(100),
  lines: z.array(receiveTransferLineSchema).min(1, 'At least one line is required for receipt'),
  lossLocationId: z.string().uuid().optional(),
});

export type ReceiveTransferInput = z.infer<typeof receiveTransferSchema>;

export const transferQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  state: z
    .enum(['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'DONE', 'CANCELLED'])
    .optional(),
  type: z.enum(['RECEIPT', 'DELIVERY', 'INTERNAL', 'RETURN']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type TransferQuery = z.infer<typeof transferQuerySchema>;
