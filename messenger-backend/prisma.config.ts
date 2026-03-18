import path from 'path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Явно указываем путь к .env, чтобы работало из любой рабочей директории
config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
