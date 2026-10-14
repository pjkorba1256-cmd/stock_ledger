import { DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RECONCILIATION_QUEUE } from './jobs.constants.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { ReconciliationProcessor } from './reconciliation.processor.js';
import { InventoryModule } from '../inventory/inventory.module.js';

@Module({})
export class JobsModule {
  static register(): DynamicModule {
    const isRedisEnabled = process.env.REDIS_ENABLED === 'true';

    if (!isRedisEnabled) {
      return {
        module: JobsModule,
        imports: [InventoryModule],
        controllers: [JobsController],
        providers: [
          {
            provide: JobsService,
            useValue: {
              dispatchReconciliation: async (input: unknown) => ({
                status: 'REDIS_DISABLED',
                message:
                  'Redis background processing is disabled. Set REDIS_ENABLED=true in .env to enable BullMQ.',
                input,
              }),
              getJobStatus: async (jobId: string) => ({
                jobId,
                status: 'REDIS_DISABLED',
                message:
                  'Redis background processing is disabled. Set REDIS_ENABLED=true in .env to enable BullMQ.',
              }),
            },
          },
        ],
        exports: [JobsService],
      };
    }

    return {
      module: JobsModule,
      imports: [
        ConfigModule,
        InventoryModule,
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const host = config.get<string>('REDIS_HOST', '127.0.0.1');
            const port = Number(config.get<string>('REDIS_PORT', '6379'));
            const password = config.get<string>('REDIS_PASSWORD') || undefined;

            return {
              connection: {
                host,
                port,
                password,
                maxRetriesPerRequest: null,
              },
            };
          },
        }),
        BullModule.registerQueue({
          name: RECONCILIATION_QUEUE,
        }),
      ],
      controllers: [JobsController],
      providers: [JobsService, ReconciliationProcessor],
      exports: [JobsService],
    };
  }
}
