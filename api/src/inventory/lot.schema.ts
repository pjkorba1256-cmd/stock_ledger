import { z } from 'zod';

export const createLotSchema = z.object({
  productId: z.string().uuid('Product ID must be a valid UUID'),
  name: z.string().min(1, 'Lot name is required').max(100, 'Lot name cannot exceed 100 characters'),
  vendorId: z.string().uuid('Vendor ID must be a valid UUID').optional(),
  manufacturingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Manufacturing date must be in YYYY-MM-DD format')
    .optional(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be in YYYY-MM-DD format')
    .optional(),
  reference: z.string().max(100).optional(),
  notes: z.string().optional(),
});

export type CreateLotInput = z.infer<typeof createLotSchema>;

export const receiveLotSchema = z.object({
  productId: z.string().uuid('Product ID must be a valid UUID'),
  lotName: z.string().min(1, 'Lot name is required').max(100, 'Lot name cannot exceed 100 characters'),
  vendorId: z.string().uuid('Vendor ID must be a valid UUID').optional(),
  manufacturingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Manufacturing date must be in YYYY-MM-DD format')
    .optional(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be in YYYY-MM-DD format')
    .optional(),
  reference: z.string().max(100).optional(),
  notes: z.string().optional(),
  locationId: z.string().uuid('Location ID must be a valid UUID'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitCostPaise: z.coerce.number().int().nonnegative().optional(),
  performedBy: z.string().min(1, 'performedBy is required').max(100),
});

export type ReceiveLotInput = z.infer<typeof receiveLotSchema>;

export const fefoSaleSchema = z.object({
  merchantId: z.string().uuid().optional(),
  productId: z.string().uuid('Product ID must be a valid UUID'),
  sourceLocationId: z.string().uuid('Source location ID must be a valid UUID'),
  destinationLocationId: z.string().uuid().optional(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  performedBy: z.string().min(1).max(100),
  orderReference: z.string().max(100).optional(),
});

export type FefoSaleInput = z.infer<typeof fefoSaleSchema>;

export const expiringLotsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
  warehouseId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
});

export type ExpiringLotsQuery = z.infer<typeof expiringLotsQuerySchema>;
