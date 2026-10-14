import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DATABASE } from './database/database.module.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue({
        rows: [{ db: 'p02_stock_ledger', usr: 'test_user', ver: 'PostgreSQL 18.6', count: 0, table_name: 'inv_stock_moves' }],
      }),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: DATABASE,
          useValue: mockDb,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });

    it('should return database connected health status', async () => {
      const result = await appController.checkDatabase();
      expect(result).toMatchObject({ status: 'ok', database: 'connected' });
    });
  });
});
