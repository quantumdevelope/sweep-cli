import assert from 'node:assert/strict';
import test from 'node:test';

import { IgnoreSet, globToRegExpSource, parseIgnoreFile } from '../dist/ignore.js';

function setFor(content, base = '') {
  const set = new IgnoreSet();
  set.add('', parseIgnoreFile(content, base));
  return set;
}

test('matches a bare name at any depth', () => {
  const set = setFor('node_modules\n');
  assert.equal(set.isIgnored('node_modules', true), true);
  assert.equal(set.isIgnored('packages/app/node_modules', true), true);
  assert.equal(set.isIgnored('src/index.ts', false), false);
});

test('anchors patterns that contain a slash', () => {
  const set = setFor('build/output\n');
  assert.equal(set.isIgnored('build/output', true), true);
  assert.equal(set.isIgnored('nested/build/output', true), false);
});

test('directory-only rules do not match files', () => {
  const set = setFor('cache/\n');
  assert.equal(set.isIgnored('cache', true), true);
  assert.equal(set.isIgnored('cache', false), false);
});

test('negation re-includes a previously ignored path', () => {
  const set = setFor('*.log\n!keep.log\n');
  assert.equal(set.isIgnored('debug.log', false), true);
  assert.equal(set.isIgnored('keep.log', false), false);
});

test('comments and blank lines are ignored', () => {
  const set = setFor('# a comment\n\n   \nreal.txt\n');
  assert.equal(set.isIgnored('real.txt', false), true);
  assert.equal(set.isIgnored('a comment', false), false);
});

test('double star matches nested directories', () => {
  const set = setFor('**/generated\n');
  assert.equal(set.isIgnored('generated', true), true);
  assert.equal(set.isIgnored('a/b/generated', true), true);
});

test('single star does not cross directory separators', () => {
  const set = setFor('*.tmp\n');
  assert.equal(set.isIgnored('file.tmp', false), true);
  assert.equal(set.isIgnored('nested/file.tmp', false), true);
  assert.equal(set.isIgnored('file.tmp.bak', false), false);
});

test('nested .gitignore rules are scoped to their directory', () => {
  const set = setFor('secret.txt\n', 'packages/app');
  assert.equal(set.isIgnored('packages/app/secret.txt', false), true);
  assert.equal(set.isIgnored('packages/other/secret.txt', false), false);
});

test('globToRegExpSource escapes regex metacharacters', () => {
  assert.equal(globToRegExpSource('a.b', true), '^a\\.b$');
});
