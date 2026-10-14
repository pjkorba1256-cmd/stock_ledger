import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import {
  createLocationSchema,
  type CreateLocationInput,
} from './location.schema.js';

import {
  createStockMoveSchema,
  stockMoveHistoryQuerySchema,
  stockMoveParamsSchema,
  type CreateStockMoveInput,
  type StockMoveHistoryQuery,
  type StockMoveParams,
} from './stock-move.schema.js';

import {
  stockOnHandQuerySchema,
  type StockOnHandQuery,
} from './inventory-query.schema.js';

import {
  createWarehouseSchema,
  type CreateWarehouseInput,
} from './warehouse.schema.js';

import { InventoryService } from './inventory.service.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
  ) {}

  @Get('stock-on-hand')
  getStockOnHand(
    @Query(new ZodValidationPipe(stockOnHandQuerySchema))
    query: StockOnHandQuery,
  ) {
    return this.inventoryService.getStockOnHand(query);
  }

  @Post('warehouses')
  createWarehouse(
    @Body(new ZodValidationPipe(createWarehouseSchema))
    body: CreateWarehouseInput,
  ) {
    return this.inventoryService.createWarehouse(body);
  }

  @Post('locations')
  createLocation(
    @Body(new ZodValidationPipe(createLocationSchema))
    body: CreateLocationInput,
  ) {
    return this.inventoryService.createLocation(body);
  }

  @Post('stock-moves')
  createStockMove(
    @Body(new ZodValidationPipe(createStockMoveSchema))
    body: CreateStockMoveInput,
  ) {
    return this.inventoryService.createStockMove(body);
  }

  @Get('stock-moves')
  getStockMoves(
    @Query(
      new ZodValidationPipe(
        stockMoveHistoryQuerySchema,
        'Invalid stock move history query parameters',
      ),
    )
    query: StockMoveHistoryQuery,
  ) {
    return this.inventoryService.getStockMoves(query);
  }

  @Get('reconcile')
  reconcileLedger(
    @Query('productId') productId?: string,
  ) {
    return this.inventoryService.reconcileLedger(productId);
  }

  @Get('stock-moves/:id')
  getStockMoveById(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid route parameter',
      ),
    )
    params: StockMoveParams,
  ) {
    return this.inventoryService.getStockMoveById(params.id);
  }

  @Post('stock-moves/:id/confirm')
  confirmStockMove(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid route parameter',
      ),
    )
    params: StockMoveParams,
  ) {
    return this.inventoryService.confirmStockMove(params.id);
  }

  @Post('stock-moves/:id/cancel')
  cancelStockMove(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid route parameter',
      ),
    )
    params: StockMoveParams,
  ) {
    return this.inventoryService.cancelStockMove(params.id);
  }

  @Post('stock-moves/:id/post')
  postStockMove(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid route parameter',
      ),
    )
    params: StockMoveParams,
  ) {
    return this.inventoryService.postStockMove(params.id);
  }
}
