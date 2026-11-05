import assert from 'node:assert/strict';
import test from 'node:test';

import { formatBytes, formatCount, parseSize } from '../dist/format.js';

test('parseSize understands plain byte counts', () => {
  assert.equal(parseSize('1024'), 1024);
});

test('parseSize understands unit suffixes', () => {
  assert.equal(parseSize('1kb'), 1024);
  assert.equal(parseSize('4mb'), 4 * 1024 * 1024);
  assert.equal(parseSize('1gb'), 1024 ** 3);
  assert.equal(parseSize('2 MB'), 2 * 1024 * 1024);
});

test('parseSize rejects garbage', () => {
  assert.throws(() => parseSize('lots'), /Invalid size/);
});

test('formatBytes scales to readable units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('formatCount groups thousands', () => {
  assert.equal(formatCount(1234), '1,234');
});
