import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
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
  updateQuantReservationSchema,
  type StockOnHandQuery,
  type UpdateQuantReservationInput,
} from './inventory-query.schema.js';

import {
  createWarehouseSchema,
  type CreateWarehouseInput,
} from './warehouse.schema.js';

import {
  createLotSchema,
  expiringLotsQuerySchema,
  fefoSaleSchema,
  receiveLotSchema,
  type CreateLotInput,
  type ExpiringLotsQuery,
  type FefoSaleInput,
  type ReceiveLotInput,
} from './lot.schema.js';

import {
  cancelReservationSchema,
  createReservationSchema,
  reservationQuerySchema,
  type CancelReservationInput,
  type CreateReservationInput,
  type ReservationQuery,
} from './reservation.schema.js';

import {
  createTransferSchema,
  dispatchTransferSchema,
  receiveTransferSchema,
  transferQuerySchema,
  type CreateTransferInput,
  type DispatchTransferInput,
  type ReceiveTransferInput,
  type TransferQuery,
} from './transfer.schema.js';

import {
  approveScrapSchema,
  createScrapSchema,
  rejectScrapSchema,
  scrapQuerySchema,
  type ApproveScrapInput,
  type CreateScrapInput,
  type RejectScrapInput,
  type ScrapQuery,
} from './scrap.schema.js';

import {
  createCountSchema,
  reconcileCountSchema,
  recordCountLinesSchema,
  type CreateCountInput,
  type ReconcileCountInput,
  type RecordCountLinesInput,
} from './count.schema.js';

import { InventoryService } from './inventory.service.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ==========================================
  // WAREHOUSES & LOCATIONS
  // ==========================================

  @Get('warehouses')
  getWarehouses(@Headers('x-merchant-id') merchantId?: string) {
    return this.inventoryService.getWarehouses(merchantId);
  }

  @Post('warehouses')
  createWarehouse(
    @Body(new ZodValidationPipe(createWarehouseSchema))
    body: CreateWarehouseInput,
  ) {
    return this.inventoryService.createWarehouse(body);
  }

  @Get('locations')
  getLocations(@Query('warehouseId') warehouseId?: string) {
    return this.inventoryService.getLocations(warehouseId);
  }

  @Post('locations')
  createLocation(
    @Body(new ZodValidationPipe(createLocationSchema))
    body: CreateLocationInput,
  ) {
    return this.inventoryService.createLocation(body);
  }

  // ==========================================
  // STOCK ON HAND & QUANTS
  // ==========================================

  @Get('stock-on-hand')
  getStockOnHand(
    @Query(new ZodValidationPipe(stockOnHandQuerySchema))
    query: StockOnHandQuery,
  ) {
    return this.inventoryService.getStockOnHand(query);
  }

  @Patch('quants/:id/reserve')
  updateQuantReservation(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid quant ID parameter',
      ),
    )
    params: StockMoveParams,
    @Body(new ZodValidationPipe(updateQuantReservationSchema))
    body: UpdateQuantReservationInput,
  ) {
    return this.inventoryService.updateQuantReservation(
      params.id,
      body.reservedQuantity,
    );
  }

  // ==========================================
  // LOTS & EXPIRY WORKFLOWS
  // ==========================================

  @Post('lots')
  createLot(
    @Body(new ZodValidationPipe(createLotSchema))
    body: CreateLotInput,
  ) {
    return this.inventoryService.createLot(body);
  }

  @Get('lots')
  getLots(@Query('productId') productId?: string) {
    return this.inventoryService.getLots(productId);
  }

  @Get('lots/:id')
  getLotById(
    @Param(
      new ZodValidationPipe(stockMoveParamsSchema, 'Invalid lot ID parameter'),
    )
    params: StockMoveParams,
  ) {
    return this.inventoryService.getLotById(params.id);
  }

  @Post('lots/receive')
  receiveLot(
    @Body(new ZodValidationPipe(receiveLotSchema))
    body: ReceiveLotInput,
    @Headers('x-merchant-id') merchantId?: string,
  ) {
    return this.inventoryService.receiveLot(body, merchantId);
  }

  @Post('fefo/sell')
  fefoSell(
    @Body(new ZodValidationPipe(fefoSaleSchema))
    body: FefoSaleInput,
    @Headers('x-merchant-id') merchantId?: string,
  ) {
    return this.inventoryService.fefoAllocateAndSell(body, merchantId);
  }

  @Get('expiring-lots')
  getExpiringLots(
    @Query(new ZodValidationPipe(expiringLotsQuerySchema))
    query: ExpiringLotsQuery,
    @Headers('x-merchant-id') merchantId?: string,
  ) {
    return this.inventoryService.getExpiringLots(query, merchantId);
  }

  @Post('expiry-sweep')
  runExpirySweep(@Headers('x-merchant-id') merchantId?: string) {
    return this.inventoryService.runExpirySweep(merchantId);
  }

  // ==========================================
  // RESERVATIONS (LIFECYCLE & TIMEOUT)
  // ==========================================

  @Post('reservations')
  createReservation(
    @Body(new ZodValidationPipe(createReservationSchema))
    body: CreateReservationInput,
  ) {
    return this.inventoryService.createReservation(body);
  }

  @Get('reservations')
  getReservations(
    @Query(new ZodValidationPipe(reservationQuerySchema))
    query: ReservationQuery,
  ) {
    return this.inventoryService.getReservations(query);
  }

  @Get('reservations/:id')
  getReservationById(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid reservation ID parameter',
      ),
    )
    params: StockMoveParams,
    @Headers('x-merchant-id') merchantId?: string,
  ) {
    return this.inventoryService.getReservationById(params.id, merchantId);
  }

  @Post('reservations/:id/confirm')
  confirmReservation(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid reservation ID parameter',
      ),
    )
    params: StockMoveParams,
    @Headers('x-merchant-id') merchantId?: string,
  ) {
    return this.inventoryService.confirmReservation(params.id, merchantId);
  }

  @Post('reservations/:id/pick')
  pickReservation(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid reservation ID parameter',
      ),
    )
    params: StockMoveParams,
    @Headers('x-merchant-id') merchantId?: string,
  ) {
    return this.inventoryService.pickReservation(params.id, merchantId);
  }

  @Post('reservations/:id/deliver')
  deliverReservation(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid reservation ID parameter',
      ),
    )
    params: StockMoveParams,
    @Body('customerLocationId') customerLocationId?: string,
    @Headers('x-merchant-id') merchantId?: string,
  ) {
    return this.inventoryService.deliverReservation(
      params.id,
      merchantId,
      customerLocationId,
    );
  }

  @Post('reservations/:id/cancel')
  cancelReservation(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid reservation ID parameter',
      ),
    )
    params: StockMoveParams,
    @Body(new ZodValidationPipe(cancelReservationSchema))
    body: CancelReservationInput,
    @Headers('x-merchant-id') merchantId?: string,
  ) {
    return this.inventoryService.cancelReservation(params.id, body, merchantId);
  }

  @Post('reservations/:id/release')
  releaseReservation(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid reservation ID parameter',
      ),
    )
    params: StockMoveParams,
    @Body('reason') reason?: string,
  ) {
    return this.inventoryService.releaseReservation(params.id, reason);
  }

  // ==========================================
  // TWO-STEP TRANSFERS
  // ==========================================

  @Post('transfers')
  createTransfer(
    @Body(new ZodValidationPipe(createTransferSchema))
    body: CreateTransferInput,
  ) {
    return this.inventoryService.createTransfer(body);
  }

  @Get('transfers')
  getTransfers(
    @Query(new ZodValidationPipe(transferQuerySchema))
    query: TransferQuery,
  ) {
    return this.inventoryService.getTransfers(query);
  }

  @Get('transfers/:id')
  getTransferById(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid transfer ID parameter',
      ),
    )
    params: StockMoveParams,
  ) {
    return this.inventoryService.getTransferById(params.id);
  }

  @Post('transfers/:id/confirm')
  confirmTransfer(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid transfer ID parameter',
      ),
    )
    params: StockMoveParams,
  ) {
    return this.inventoryService.confirmTransfer(params.id);
  }

  @Post('transfers/:id/dispatch')
  dispatchTransfer(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid transfer ID parameter',
      ),
    )
    params: StockMoveParams,
    @Body(new ZodValidationPipe(dispatchTransferSchema))
    body: DispatchTransferInput,
  ) {
    return this.inventoryService.dispatchTransfer(params.id, body);
  }

  @Post('transfers/:id/receive')
  receiveTransfer(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid transfer ID parameter',
      ),
    )
    params: StockMoveParams,
    @Body(new ZodValidationPipe(receiveTransferSchema))
    body: ReceiveTransferInput,
  ) {
    return this.inventoryService.receiveTransfer(params.id, body);
  }

  @Post('transfers/:id/cancel')
  cancelTransfer(
    @Param(
      new ZodValidationPipe(
        stockMoveParamsSchema,
        'Invalid transfer ID parameter',
      ),
    )
    params: StockMoveParams,
  ) {
    return this.inventoryService.cancelTransfer(params.id);
  }

  // ==========================================
  // SCRAP & WRITE-OFFS
  // ==========================================

  @Post('scrap')
  createScrap(
    @Body(new ZodValidationPipe(createScrapSchema))
    body: CreateScrapInput,
  ) {
    return this.inventoryService.createScrap(body);
  }

  @Get('scrap')
  getScraps(
    @Query(new ZodValidationPipe(scrapQuerySchema))
    query: ScrapQuery,
  ) {
    return this.inventoryService.getScraps(query);
  }

  @Get('scrap/:id')
  getScrapById(
    @Param(
      new ZodValidationPipe(stockMoveParamsSchema, 'Invalid scrap ID parameter'),
    )
    params: StockMoveParams,
  ) {
    return this.inventoryService.getScrapById(params.id);
  }

  @Post('scrap/:id/approve')
  approveScrap(
    @Param(
      new ZodValidationPipe(stockMoveParamsSchema, 'Invalid scrap ID parameter'),
    )
    params: StockMoveParams,
    @Body(new ZodValidationPipe(approveScrapSchema))
    body: ApproveScrapInput,
  ) {
    return this.inventoryService.approveScrap(params.id, body);
  }

  @Post('scrap/:id/reject')
  rejectScrap(
    @Param(
      new ZodValidationPipe(stockMoveParamsSchema, 'Invalid scrap ID parameter'),
    )
    params: StockMoveParams,
    @Body(new ZodValidationPipe(rejectScrapSchema))
    body: RejectScrapInput,
  ) {
    return this.inventoryService.rejectScrap(params.id, body);
  }

  // ==========================================
  // PHYSICAL COUNTS
  // ==========================================

  @Post('counts')
  createCount(
    @Body(new ZodValidationPipe(createCountSchema))
    body: CreateCountInput,
  ) {
    return this.inventoryService.createStockCount(body);
  }

  @Get('counts')
  getStockCounts(@Query('warehouseId') warehouseId?: string) {
    return this.inventoryService.getStockCounts(warehouseId);
  }

  @Get('counts/:id')
  getStockCountById(
    @Param(
      new ZodValidationPipe(stockMoveParamsSchema, 'Invalid count ID parameter'),
    )
    params: StockMoveParams,
  ) {
    return this.inventoryService.getStockCountById(params.id);
  }

  @Post('counts/:id/record')
  recordCountLines(
    @Param(
      new ZodValidationPipe(stockMoveParamsSchema, 'Invalid count ID parameter'),
    )
    params: StockMoveParams,
    @Body(new ZodValidationPipe(recordCountLinesSchema))
    body: RecordCountLinesInput,
  ) {
    return this.inventoryService.recordCountLines(params.id, body);
  }

  @Post('counts/:id/reconcile')
  reconcileCount(
    @Param(
      new ZodValidationPipe(stockMoveParamsSchema, 'Invalid count ID parameter'),
    )
    params: StockMoveParams,
    @Body(new ZodValidationPipe(reconcileCountSchema))
    body: ReconcileCountInput,
  ) {
    return this.inventoryService.reconcileStockCount(params.id, body);
  }

  // ==========================================
  // SEED & RECONCILIATION
  // ==========================================

  @Post('seed')
  seedDemoData() {
    return this.inventoryService.seedDemoData(true);
  }

  @Get('reconcile')
  reconcileLedger(@Query('productId') productId?: string) {
    return this.inventoryService.reconcileLedger(productId);
  }

  // ==========================================
  // STOCK MOVES (LEDGER AUDIT)
  // ==========================================

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
