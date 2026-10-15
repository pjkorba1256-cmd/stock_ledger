import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { InventoryService } from '../inventory/inventory.service.js';
import { EXPIRY_SWEEP_QUEUE, JOB_EXPIRY_SWEEP } from './jobs.constants.js';

export interface ExpirySweepJobPayload {
  merchantId?: string;
  triggeredBy: string;
}

@Processor(EXPIRY_SWEEP_QUEUE)
export class ExpirySweepProcessor extends WorkerHost {
  private readonly logger = new Logger(ExpirySweepProcessor.name);

  constructor(private readonly inventoryService: InventoryService) {
    super();
  }

  async process(job: Job<ExpirySweepJobPayload>): Promise<unknown> {
    this.logger.log(
      `[BullMQ] Running nightly expiry sweep job ${job.id} triggered by ${job.data?.triggeredBy ?? 'scheduler'}`,
    );

    switch (job.name) {
      case JOB_EXPIRY_SWEEP: {
        const result = await this.inventoryService.runExpirySweep(
          job.data?.merchantId,
        );
        this.logger.log(
          `[BullMQ] Expiry sweep finished: ${result.totalExpiredLots} expired lots found across ${result.affectedQuants} stock quants. Total value: ₹${(result.totalExpiredValuePaise / 100).toFixed(2)}`,
        );
        return result;
      }

      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }
}
