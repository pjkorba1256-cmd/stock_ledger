import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DATABASE } from './database/database.module.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([{ 1: 1 }]),
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
      expect(result).toEqual({ status: 'ok', database: 'connected' });
    });
  });
});
