import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.js') ? [path] : [];
  });
}

it('parses every backend source module before deployment', () => {
  const directory = fileURLToPath(new URL('../../src/', import.meta.url));
  const failures = sourceFiles(directory).flatMap(path => {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', timeout: 5000 });
    return result.status === 0 ? [] : [`${path}: ${result.error?.message ?? result.stderr}`];
  });
  expect(failures).toEqual([]);
}, 30000);