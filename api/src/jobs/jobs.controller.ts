import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../inventory/zod-validation.pipe.js';
import {
  dispatchReconcileSchema,
  type DispatchReconcileInput,
  JobsService,
} from './jobs.service.js';

const jobParamSchema = z.object({
  jobId: z.string().trim().min(1, 'Job ID is required'),
});

type JobParams = z.infer<typeof jobParamSchema>;

@Controller('inventory/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post('reconcile')
  dispatchReconciliation(
    @Body(
      new ZodValidationPipe(
        dispatchReconcileSchema,
        'Invalid background reconciliation job payload',
      ),
    )
    body: DispatchReconcileInput,
  ) {
    return this.jobsService.dispatchReconciliation(body);
  }

  @Get('reconcile/:jobId')
  getReconciliationJobStatus(
    @Param(
      new ZodValidationPipe(jobParamSchema, 'Invalid job ID parameter'),
    )
    params: JobParams,
  ) {
    return this.jobsService.getJobStatus(params.jobId);
  }
}
