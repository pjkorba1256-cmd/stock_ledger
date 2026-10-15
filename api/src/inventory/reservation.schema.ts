import { z } from 'zod';

export const createReservationSchema = z.object({
  merchantId: z.string().uuid('Merchant ID must be a valid UUID'),
  orderReference: z.string().min(1, 'Order reference is required').max(100),
  productId: z.string().uuid('Product ID must be a valid UUID'),
  variantId: z.string().uuid().optional(),
  locationId: z.string().uuid('Location ID must be a valid UUID'),
  lotId: z.string().uuid().optional(),
  quantity: z.coerce.number().positive('Reservation quantity must be greater than zero'),
  timeoutMinutes: z.coerce.number().int().min(1).max(1440).default(15),
  createdBy: z.string().min(1).max(100),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const cancelReservationSchema = z.object({
  reason: z.string().max(255).optional(),
  disposition: z
    .enum(['RETURN_TO_STOCK', 'STAGING_HOLD', 'SCRAP'])
    .default('RETURN_TO_STOCK'),
  performedBy: z.string().min(1).max(100).optional(),
});

export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;

export const reservationQuerySchema = z.object({
  merchantId: z.string().uuid().optional(),
  orderReference: z.string().optional(),
  productId: z.string().uuid().optional(),
  state: z
    .enum([
      'RESERVED',
      'CONFIRMED',
      'PICKED',
      'DELIVERED',
      'CANCELLED',
      'EXPIRED',
      'RELEASED',
    ])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ReservationQuery = z.infer<typeof reservationQuerySchema>;
