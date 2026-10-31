import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { REQUIRED_DOCS, validateDocs } from './check-docs.mjs';

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fair-docs-'));
  for (const relativePath of REQUIRED_DOCS) {
    const fullPath = path.join(root, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, `# ${relativePath}\n`);
  }
  return root;
}

test('accepts valid local links and indexed paths', async (context) => {
  const root = await createRepository();
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n');
  await writeFile(
    path.join(root, 'DIRECTORY.md'),
    '# Directory\n\nRead [`guide`](docs/guide.md) and `client/CONTEXT.md`.\n',
  );

  assert.deepEqual(await validateDocs(root), []);
});

test('reports missing required docs, links, and indexed paths', async (context) => {
  const root = await createRepository();
  context.after(() => rm(root, { recursive: true, force: true }));
  await rm(path.join(root, 'AGENTS.md'));
  await writeFile(
    path.join(root, 'DIRECTORY.md'),
    '# Directory\n\n[Missing](docs/missing.md) and `server/src/missing.js`.\n',
  );

  const errors = await validateDocs(root);
  assert.ok(errors.includes('Missing required navigation document: AGENTS.md'));
  assert.ok(errors.some((error) => error.includes('missing link target docs/missing.md')));
  assert.ok(errors.some((error) => error.includes('missing backtick target server/src/missing.js')));
});

test('does not require skipped directories referenced by indexed docs', async (context) => {
  const root = await createRepository();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, 'DIRECTORY.md'),
    '# Directory\n\nDo not load `node_modules/` or `client/.react-router/`.\n',
  );

  assert.deepEqual(await validateDocs(root), []);
});

test('enforces the always-read document budgets', async (context) => {
  const root = await createRepository();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'AGENTS.md'), `# Agents\n${'x'.repeat(1_300)}`);

  const errors = await validateDocs(root);
  assert.ok(errors.some((error) => error.startsWith('AGENTS.md is ')));
});