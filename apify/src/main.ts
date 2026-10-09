import { run } from './runtime.js';

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});