import { forwardRef, Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { JobsModule } from '../jobs/jobs.module.js';

@Module({
  imports: [forwardRef(() => JobsModule)],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}