import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import {
  EXPIRY_SWEEP_QUEUE,
  JOB_EXPIRE_RESERVATION,
  JOB_EXPIRY_SWEEP,
  JOB_RECONCILE_LEDGER,
  RECONCILIATION_QUEUE,
  RESERVATION_EXPIRY_QUEUE,
} from './jobs.constants.js';
import type { ReconcileJobPayload } from './reconciliation.processor.js';
import type { ReservationExpiryJobPayload } from './reservation-expiry.processor.js';
import type { ExpirySweepJobPayload } from './expiry-sweep.processor.js';
import type { InventoryService } from '../inventory/inventory.service.js';

export const dispatchReconcileSchema = z.object({
  productId: z.string().uuid().optional(),
  triggeredBy: z.string().trim().min(1).max(100).default('system-admin'),
  batchId: z.string().trim().max(100).optional(),
});

export type DispatchReconcileInput = z.infer<typeof dispatchReconcileSchema>;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly fallbackTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly moduleRef: ModuleRef,

    @Optional()
    @InjectQueue(RECONCILIATION_QUEUE)
    private readonly reconcileQueue?: Queue<ReconcileJobPayload>,

    @Optional()
    @InjectQueue(RESERVATION_EXPIRY_QUEUE)
    private readonly reservationQueue?: Queue<ReservationExpiryJobPayload>,

    @Optional()
    @InjectQueue(EXPIRY_SWEEP_QUEUE)
    private readonly expirySweepQueue?: Queue<ExpirySweepJobPayload>,
  ) {}

  private getInventoryService(): InventoryService | null {
    try {
      return this.moduleRef.get('InventoryService', { strict: false });
    } catch {
      return null;
    }
  }

  async dispatchReconciliation(input: DispatchReconcileInput) {
    const parsed = dispatchReconcileSchema.parse(input);

    if (!this.reconcileQueue) {
      const invService = this.getInventoryService();
      if (invService) {
        const result = await invService.reconcileLedger(parsed.productId);
        return {
          jobId: `local-sync-${Date.now()}`,
          name: JOB_RECONCILE_LEDGER,
          queue: 'local-in-process',
          status: 'completed',
          result,
        };
      }
      return {
        status: 'REDIS_DISABLED',
        message: 'Redis background processing is disabled. Set REDIS_ENABLED=true in .env to enable BullMQ.',
        input: parsed,
      };
    }

    const jobId = parsed.batchId ? `reconcile-${parsed.batchId}` : undefined;

    const job = await this.reconcileQueue.add(
      JOB_RECONCILE_LEDGER,
      {
        productId: parsed.productId,
        triggeredBy: parsed.triggeredBy,
        batchId: parsed.batchId,
      },
      {
        jobId,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          age: 86400,
          count: 1000,
        },
        removeOnFail: {
          age: 604800,
        },
      },
    );

    return {
      jobId: job.id,
      name: job.name,
      queue: RECONCILIATION_QUEUE,
      data: job.data,
      status: await job.getState(),
    };
  }

  async scheduleReservationExpiry(
    reservationId: string,
    orderReference: string,
    merchantId: string,
    delayMs: number,
  ) {
    const stableJobId = `reservation-expiry-${reservationId}`;

    if (!this.reservationQueue) {
      this.logger.log(
        `[Fallback Worker] In-process delayed timer scheduled for reservation ${reservationId} (delay: ${delayMs}ms)`,
      );

      const invService = this.getInventoryService();
      if (invService) {
        const timer = setTimeout(async () => {
          try {
            await invService.releaseReservation(reservationId, 'TIMEOUT');
            this.fallbackTimers.delete(reservationId);
          } catch (err) {
            this.logger.error(`Error in fallback reservation expiry for ${reservationId}:`, err);
          }
        }, Math.max(delayMs, 10));

        this.fallbackTimers.set(reservationId, timer);
      }

      return {
        jobId: stableJobId,
        name: JOB_EXPIRE_RESERVATION,
        queue: 'fallback-timer',
        status: 'delayed',
        delayMs,
      };
    }

    const job = await this.reservationQueue.add(
      JOB_EXPIRE_RESERVATION,
      {
        reservationId,
        orderReference,
        merchantId,
      },
      {
        jobId: stableJobId,
        delay: delayMs,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return {
      jobId: job.id,
      name: job.name,
      queue: RESERVATION_EXPIRY_QUEUE,
      data: job.data,
      status: await job.getState(),
    };
  }

  cancelFallbackTimer(reservationId: string) {
    const timer = this.fallbackTimers.get(reservationId);
    if (timer) {
      clearTimeout(timer);
      this.fallbackTimers.delete(reservationId);
    }
  }

  async dispatchExpirySweep(merchantId?: string, triggeredBy = 'manual-dispatch') {
    if (!this.expirySweepQueue) {
      const invService = this.getInventoryService();
      if (invService) {
        const result = await invService.runExpirySweep(merchantId);
        return {
          jobId: `local-sweep-${Date.now()}`,
          name: JOB_EXPIRY_SWEEP,
          queue: 'local-in-process',
          status: 'completed',
          result,
        };
      }
      return {
        status: 'REDIS_DISABLED',
        message: 'Redis disabled.',
      };
    }

    const job = await this.expirySweepQueue.add(
      JOB_EXPIRY_SWEEP,
      {
        merchantId,
        triggeredBy,
      },
      {
        attempts: 2,
        removeOnComplete: true,
      },
    );

    return {
      jobId: job.id,
      name: job.name,
      queue: EXPIRY_SWEEP_QUEUE,
      status: await job.getState(),
    };
  }

  async getJobStatus(jobId: string, queueName: string = RECONCILIATION_QUEUE) {
    let targetQueue = this.reconcileQueue;
    if (queueName === RESERVATION_EXPIRY_QUEUE) {
      targetQueue = this.reservationQueue as unknown as Queue<ReconcileJobPayload>;
    } else if (queueName === EXPIRY_SWEEP_QUEUE) {
      targetQueue = this.expirySweepQueue as unknown as Queue<ReconcileJobPayload>;
    }

    if (!targetQueue) {
      return {
        jobId,
        queue: queueName,
        status: 'REDIS_DISABLED',
        message: 'Redis background processing is disabled.',
      };
    }

    const job = await targetQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found in queue ${queueName}`);
    }

    const state = await job.getState();

    return {
      jobId: job.id,
      name: job.name,
      queue: queueName,
      state,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }
}
