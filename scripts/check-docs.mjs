import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_DOCS = [
  'AGENTS.md',
  'CLAUDE.md',
  'DIRECTORY.md',
  'client/CONTEXT.md',
  'server/CONTEXT.md',
  'apify/CONTEXT.md',
  'supabase/CONTEXT.md',
];

export const SIZE_BUDGETS = {
  'AGENTS.md': 1_200,
  'CLAUDE.md': 5_000,
  'DIRECTORY.md': 12_000,
};

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.react-router',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const WILDCARD = /[*?{}]/;
const INDEX_DOCUMENTS = new Set(['AGENTS.md', 'CLAUDE.md', 'DIRECTORY.md']);

function stripAnchor(value) {
  return value.split('#', 1)[0].split('?', 1)[0];
}

function isExternal(value) {
  return /^(?:[a-z]+:|#|mailto:)/i.test(value);
}

function normalizeCandidate(value) {
  return stripAnchor(value.trim().replace(/^['"]|['"]$/g, ''));
}

function markdownTargets(content) {
  const targets = [];
  const linkPattern = /!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of content.matchAll(linkPattern)) targets.push(match[1]);
  return targets;
}

function backtickTargets(content) {
  const targets = [];
  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    const value = match[1].trim();
    if (!value || value.includes(' ') || value.startsWith('/') || WILDCARD.test(value)) continue;
    if (value.includes('/')) targets.push(value);
  }
  return targets;
}

function resolveTarget(root, documentPath, rawTarget, source) {
  const target = normalizeCandidate(rawTarget);
  if (!target || isExternal(target) || WILDCARD.test(target)) return null;

  if (source === 'backtick') {
    if (target.split('/').some((segment) => SKIPPED_DIRECTORIES.has(segment))) return null;
    return path.resolve(root, target.replace(/\/$/, ''));
  }
  return path.resolve(path.dirname(documentPath), decodeURIComponent(target));
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function markdownFiles(root) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(fullPath);
    }
  }
  await walk(root);
  return files;
}

export async function validateDocs(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const errors = [];

  for (const relativePath of REQUIRED_DOCS) {
    if (!(await exists(path.join(root, relativePath)))) {
      errors.push(`Missing required navigation document: ${relativePath}`);
    }
  }

  for (const [relativePath, maximumBytes] of Object.entries(SIZE_BUDGETS)) {
    const fullPath = path.join(root, relativePath);
    if (!(await exists(fullPath))) continue;
    const { size } = await stat(fullPath);
    if (size > maximumBytes) {
      errors.push(`${relativePath} is ${size} bytes; budget is ${maximumBytes} bytes`);
    }
  }

  for (const documentPath of await markdownFiles(root)) {
    const content = await readFile(documentPath, 'utf8');
    const relativeDocument = path.relative(root, documentPath);
    const references = [
      ...markdownTargets(content).map((target) => ({ source: 'link', target })),
      ...(INDEX_DOCUMENTS.has(relativeDocument)
        ? backtickTargets(content).map((target) => ({ source: 'backtick', target }))
        : []),
    ];
    const seen = new Set();
    for (const reference of references) {
      const resolved = resolveTarget(root, documentPath, reference.target, reference.source);
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      if (!(await exists(resolved))) {
        errors.push(`${relativeDocument}: missing ${reference.source} target ${reference.target}`);
      }
    }
  }

  return errors;
}

async function main() {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const errors = await validateDocs(root);
  if (errors.length) {
    console.error(`Documentation validation failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('Documentation validation passed.');
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) await main();