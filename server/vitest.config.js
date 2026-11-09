import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Chromium-backed report tests and app imports compete for CPU at the
    // default worker count, producing timeouts unrelated to their behavior.
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.js'],
    },
  },
});