import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('parses every backend source module before deployment', () => {
  const directory = fileURLToPath(new URL('../../src/', import.meta.url));
  const checkModules = `
    const { readdirSync, readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const { SourceTextModule } = require('node:vm');
    function sourceFiles(directory) {
      return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.js') ? [path] : [];
      });
    }
    let failed = false;
    for (const path of sourceFiles(process.argv[1])) {
      try {
        new SourceTextModule(readFileSync(path, 'utf8'), { identifier: path });
      } catch (error) {
        console.error(path + ': ' + error.message);
        failed = true;
      }
    }
    if (failed) process.exitCode = 1;
  `;
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', '--experimental-vm-modules', '-e', checkModules, directory],
    { encoding: 'utf8', timeout: 15_000 },
  );
  expect(result.status, result.stderr || result.error?.message).toBe(0);
}, 30000);