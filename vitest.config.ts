import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['shared/**/*.test.ts', 'src/**/*.test.ts', 'api/**/*.test.ts', 'spacetimedb/tests/**/*.test.ts'] } });
