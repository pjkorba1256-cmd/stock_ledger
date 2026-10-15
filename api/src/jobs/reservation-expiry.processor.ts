import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { InventoryService } from '../inventory/inventory.service.js';
import {
  JOB_EXPIRE_RESERVATION,
  RESERVATION_EXPIRY_QUEUE,
} from './jobs.constants.js';

export interface ReservationExpiryJobPayload {
  reservationId: string;
  orderReference: string;
  merchantId: string;
}

@Processor(RESERVATION_EXPIRY_QUEUE)
export class ReservationExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(ReservationExpiryProcessor.name);

  constructor(private readonly inventoryService: InventoryService) {
    super();
  }

  async process(job: Job<ReservationExpiryJobPayload>): Promise<unknown> {
    const { reservationId, orderReference } = job.data;
    this.logger.log(
      `[BullMQ] Processing reservation expiry job ${job.id} for reservation ${reservationId} (Order: ${orderReference})`,
    );

    switch (job.name) {
      case JOB_EXPIRE_RESERVATION: {
        const result = await this.inventoryService.releaseReservation(
          reservationId,
          'TIMEOUT',
        );

        if (result.released) {
          this.logger.log(
            `[BullMQ] Reservation ${reservationId} successfully expired and reserved stock released back to available inventory.`,
          );
        } else {
          this.logger.log(
            `[BullMQ] Reservation ${reservationId} was already resolved (state: ${result.state}). No stock release needed.`,
          );
        }

        return result;
      }

      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }
}
