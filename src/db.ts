import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { config } from './config';

// Prisma 7 se conecta a SQLite a través de un adaptador de driver.
export const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: config.databaseUrl }) });
