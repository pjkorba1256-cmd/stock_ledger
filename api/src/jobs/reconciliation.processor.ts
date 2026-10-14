import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { InventoryService } from '../inventory/inventory.service.js';
import { JOB_RECONCILE_LEDGER, RECONCILIATION_QUEUE } from './jobs.constants.js';

export interface ReconcileJobPayload {
  productId?: string;
  triggeredBy: string;
  batchId?: string;
}

@Processor(RECONCILIATION_QUEUE)
export class ReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(private readonly inventoryService: InventoryService) {
    super();
  }

  async process(job: Job<ReconcileJobPayload>): Promise<unknown> {
    this.logger.log(
      `Processing reconciliation job ${job.id} for product ${job.data?.productId ?? 'ALL'} triggered by ${job.data?.triggeredBy}`,
    );

    switch (job.name) {
      case JOB_RECONCILE_LEDGER: {
        const result = await this.inventoryService.reconcileLedger(
          job.data?.productId,
        );

        this.logger.log(
          `Reconciliation job ${job.id} finished with status: ${result.status}. Total audited: ${result.totalAuditedItems}, discrepancies: ${result.discrepanciesCount}`,
        );

        if (result.status === 'DISCREPANCY_DETECTED') {
          this.logger.warn(
            `DISCREPANCY DETECTED in job ${job.id}: ${JSON.stringify(result.discrepancies)}`,
          );
        }

        return result;
      }

      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }
}
