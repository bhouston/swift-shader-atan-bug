import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['verbose'],
    disableConsoleIntercept: true,
    include: ['test/shaders.test.js'],
    environment: 'node',
    hookTimeout: 60000,
    testTimeout: 30000
  }
});
