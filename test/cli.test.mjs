import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'dist', 'cli.js');

function run(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function makeFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'sweep-cli-'));
  await mkdir(path.join(dir, 'src'));
  await mkdir(path.join(dir, 'node_modules'));

  await writeFile(path.join(dir, 'src', 'a.ts'), 'same content\n');
  await writeFile(path.join(dir, 'src', 'b.ts'), 'same content\n');
  await writeFile(path.join(dir, 'src', 'unique.ts'), 'different\n');
  await writeFile(path.join(dir, 'empty.ts'), '');
  await writeFile(path.join(dir, 'notes.tmp'), 'scratch\n');
  await writeFile(path.join(dir, 'node_modules', 'dep.js'), 'same content\n');

  return dir;
}

test('dupes finds byte-identical files and ignores node_modules by default', async () => {
  const dir = await makeFixture();
  try {
    const output = run(['dupes', '.', '--json', '--quiet'], dir);
    const report = JSON.parse(output);

    assert.equal(report.groups.length, 1);
    assert.equal(report.groups[0].copies, 2);
    assert.deepEqual(report.groups[0].files, ['src/a.ts', 'src/b.ts']);
    assert.equal(report.totals.wasted, 13);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('junk reports empty and temporary files', async () => {
  const dir = await makeFixture();
  try {
    const output = run(['junk', '.', '--json', '--quiet'], dir);
    const report = JSON.parse(output);

    assert.deepEqual(report.empty, ['empty.ts']);
    assert.deepEqual(report.temp, ['notes.tmp']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('report summarises the whole tree', async () => {
  const dir = await makeFixture();
  try {
    const output = run(['report', '.', '--quiet'], dir);
    const report = JSON.parse(output);

    assert.equal(report.totals.files, 5);
    assert.equal(report.totals.duplicates, 1);
    assert.equal(report.totals.empty, 1);
    assert.equal(report.totals.temp, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('hash prints a digest per file', async () => {
  const dir = await makeFixture();
  try {
    const output = run(['hash', 'src/unique.ts'], dir).trim();
    assert.match(output, /^[0-9a-f]{64}\s+src\/unique\.ts$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dupes --delete removes redundant copies and keeps one', async () => {
  const dir = await makeFixture();
  try {
    run(['dupes', '.', '--delete', '--quiet'], dir);
    const remaining = await readdir(path.join(dir, 'src'));
    assert.deepEqual(remaining.sort(), ['a.ts', 'unique.ts']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a .gitignore file is respected', async () => {
  const dir = await makeFixture();
  try {
    await writeFile(path.join(dir, '.gitignore'), 'src/\n');
    const output = run(['report', '.', '--quiet'], dir);
    const report = JSON.parse(output);
    assert.equal(report.totals.files, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('version prints the package version', () => {
  const output = run(['--version']).trim();
  assert.match(output, /^\d+\.\d+\.\d+$/);
});
