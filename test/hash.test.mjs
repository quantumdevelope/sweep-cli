import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { sha256Buffer, sha256File, shortHash } from '../dist/hash.js';

test('sha256Buffer matches the known digest of "abc"', () => {
  assert.equal(
    sha256Buffer('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('sha256File matches the known digest of "abc"', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sweep-hash-'));
  try {
    const file = path.join(dir, 'abc.txt');
    await writeFile(file, 'abc');
    assert.equal(await sha256File(file), sha256Buffer('abc'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('shortHash truncates the digest', () => {
  assert.equal(shortHash('0123456789abcdef', 4), '0123');
});
