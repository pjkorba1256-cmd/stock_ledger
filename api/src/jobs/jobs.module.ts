import { DynamicModule, forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  EXPIRY_SWEEP_QUEUE,
  RECONCILIATION_QUEUE,
  RESERVATION_EXPIRY_QUEUE,
} from './jobs.constants.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { ReconciliationProcessor } from './reconciliation.processor.js';
import { ReservationExpiryProcessor } from './reservation-expiry.processor.js';
import { ExpirySweepProcessor } from './expiry-sweep.processor.js';
import { InventoryModule } from '../inventory/inventory.module.js';

@Module({})
export class JobsModule {
  static register(): DynamicModule {
    const isRedisEnabled = process.env.REDIS_ENABLED === 'true';

    if (!isRedisEnabled) {
      return {
        module: JobsModule,
        imports: [forwardRef(() => InventoryModule)],
        controllers: [JobsController],
        providers: [JobsService],
        exports: [JobsService],
      };
    }

    return {
      module: JobsModule,
      imports: [
        ConfigModule,
        forwardRef(() => InventoryModule),
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
        BullModule.registerQueue(
          { name: RECONCILIATION_QUEUE },
          { name: RESERVATION_EXPIRY_QUEUE },
          { name: EXPIRY_SWEEP_QUEUE },
        ),
      ],
      controllers: [JobsController],
      providers: [
        JobsService,
        ReconciliationProcessor,
        ReservationExpiryProcessor,
        ExpirySweepProcessor,
      ],
      exports: [JobsService],
    };
  }
}
