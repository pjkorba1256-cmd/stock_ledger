import { z } from 'zod';

export const createScrapSchema = z.object({
  productId: z.string().uuid('Product ID must be a valid UUID'),
  variantId: z.string().uuid().optional(),
  lotId: z.string().uuid().optional(),
  locationId: z.string().uuid('Location ID must be a valid UUID'),
  scrapLocationId: z.string().uuid('Scrap location ID must be a valid UUID'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  reason: z.enum(['DAMAGED', 'EXPIRED', 'QUALITY_FAILED', 'OTHER']),
  notes: z.string().optional(),
  performedBy: z.string().min(1, 'performedBy is required').max(100),
});

export type CreateScrapInput = z.infer<typeof createScrapSchema>;

export const approveScrapSchema = z.object({
  approvedBy: z.string().min(1, 'approvedBy is required').max(100),
});

export type ApproveScrapInput = z.infer<typeof approveScrapSchema>;

export const rejectScrapSchema = z.object({
  rejectedBy: z.string().min(1, 'rejectedBy is required').max(100),
  reason: z.string().min(1, 'Rejection reason is required').max(255),
});

export type RejectScrapInput = z.infer<typeof rejectScrapSchema>;

export const scrapQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  reason: z.enum(['DAMAGED', 'EXPIRED', 'QUALITY_FAILED', 'OTHER']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ScrapQuery = z.infer<typeof scrapQuerySchema>;
