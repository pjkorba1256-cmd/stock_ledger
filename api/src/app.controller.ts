import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE } from './database/database.module.js';

@Controller()
export class AppController {
  constructor(
    @Inject(DATABASE)
    private readonly db: NodePgDatabase,
  ) {}

  @Get()
  getHello(): string {
    return 'Hello World!';
  }

  @Get('health/db')
  async checkDatabase(): Promise<{
    status: string;
    database: string;
  }> {
    await this.db.execute(sql`SELECT 1`);

    return {
      status: 'ok',
      database: 'connected',
    };
  }
}
