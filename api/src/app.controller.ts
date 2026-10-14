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
  async checkDatabase() {
    const rawUrl = process.env.DATABASE_URL || '';
    let host = 'unknown';
    let provider = 'unknown';

    try {
      const parsed = new URL(rawUrl);
      host = parsed.hostname;
      if (host.includes('neon.tech')) {
        provider = 'Neon Serverless Postgres (neon.tech)';
      } else if (host.includes('render.com')) {
        provider = 'Render Managed Postgres (render.com)';
      } else if (host.includes('localhost') || host.includes('127.0.0.1')) {
        provider = 'Localhost Postgres';
      } else {
        provider = host;
      }
    } catch {
      host = 'unparseable';
    }

    const [dbInfo, tablesRes, whCount, locCount, quantCount, moveCount] =
      await Promise.all([
        this.db.execute(
          sql`SELECT current_database() as db, current_user as usr, version() as ver`,
        ),
        this.db.execute(
          sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
        ),
        this.db.execute(
          sql`SELECT count(*)::int as count FROM inv_warehouses`,
        ),
        this.db.execute(
          sql`SELECT count(*)::int as count FROM inv_locations`,
        ),
        this.db.execute(
          sql`SELECT count(*)::int as count FROM inv_stock_quants`,
        ),
        this.db.execute(
          sql`SELECT count(*)::int as count FROM inv_stock_moves`,
        ),
      ]);

    const getRow0 = (res: any) => (res?.rows ? res.rows[0] : Array.isArray(res) ? res[0] : res);
    const getRows = (res: any) => (res?.rows ? res.rows : Array.isArray(res) ? res : []);

    return {
      status: 'ok',
      database: 'connected',
      provider,
      host,
      databaseName: getRow0(dbInfo)?.db,
      dbUser: getRow0(dbInfo)?.usr,
      tables: getRows(tablesRes).map((r: any) => r.table_name),
      rowCounts: {
        inv_warehouses: getRow0(whCount)?.count ?? 0,
        inv_locations: getRow0(locCount)?.count ?? 0,
        inv_stock_quants: getRow0(quantCount)?.count ?? 0,
        inv_stock_moves: getRow0(moveCount)?.count ?? 0,
      },
    };
  }
}
