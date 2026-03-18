import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
    env: config({ path: '.env.test' }).parsed ?? {},
  },
});
