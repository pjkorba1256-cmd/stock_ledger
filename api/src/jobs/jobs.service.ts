import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { JOB_RECONCILE_LEDGER, RECONCILIATION_QUEUE } from './jobs.constants.js';
import type { ReconcileJobPayload } from './reconciliation.processor.js';

export const dispatchReconcileSchema = z.object({
  productId: z.string().uuid().optional(),
  triggeredBy: z.string().trim().min(1).max(100).default('system-admin'),
  batchId: z.string().trim().max(100).optional(),
});

export type DispatchReconcileInput = z.infer<typeof dispatchReconcileSchema>;

@Injectable()
export class JobsService {
  constructor(
    @InjectQueue(RECONCILIATION_QUEUE)
    private readonly queue: Queue<ReconcileJobPayload>,
  ) {}

  async dispatchReconciliation(input: DispatchReconcileInput) {
    const parsed = dispatchReconcileSchema.parse(input);

    const jobId = parsed.batchId ? `reconcile-${parsed.batchId}` : undefined;

    const job = await this.queue.add(
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

  async getJobStatus(jobId: string) {
    const job = await this.queue.getJob(jobId);

    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found in ${RECONCILIATION_QUEUE}`);
    }

    const state = await job.getState();

    return {
      jobId: job.id,
      name: job.name,
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
