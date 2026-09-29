import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Substitui a secao "prisma" do package.json, que esta deprecada e sera removida
 * no Prisma 7. A partir daqui o .env precisa ser carregado explicitamente.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
});
