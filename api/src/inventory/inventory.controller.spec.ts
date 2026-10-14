import { Test, TestingModule } from '@nestjs/testing';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

describe('InventoryController', () => {
  let controller: InventoryController;

  beforeEach(async () => {
    const mockInventoryService = {
      getStockOnHand: vi.fn(),
      createWarehouse: vi.fn(),
      createLocation: vi.fn(),
      createStockMove: vi.fn(),
      getStockMoveById: vi.fn(),
      confirmStockMove: vi.fn(),
      cancelStockMove: vi.fn(),
      postStockMove: vi.fn(),
      getStockMoves: vi.fn(),
      reconcileLedger: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        {
          provide: InventoryService,
          useValue: mockInventoryService,
        },
      ],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
