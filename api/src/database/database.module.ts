import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export const DATABASE = 'DATABASE';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DATABASE,
      inject: [],
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;

        if (!connectionString) {
          throw new Error('DATABASE_URL is not configured');
        }

        const isCloudDb =
          connectionString.includes('sslmode=require') ||
          connectionString.includes('render.com') ||
          connectionString.includes('supabase') ||
          connectionString.includes('neon.tech') ||
          process.env.NODE_ENV === 'production';

        const pool = new Pool({
          connectionString,
          ssl: isCloudDb ? { rejectUnauthorized: false } : undefined,
        });

        return drizzle(pool);
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
