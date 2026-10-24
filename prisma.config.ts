import { defineConfig } from 'prisma/config';

// Prisma 7 no carga el .env solo: se carga acá, como en src/config.ts.
try {
  process.loadEnvFile();
} catch {
  // Sin .env: se usa DATABASE_URL del entorno.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { seed: 'tsx prisma/seed.ts' },
  datasource: { url: process.env.DATABASE_URL ?? 'file:./dev.db' },
});
