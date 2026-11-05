/**
 * Programmatic API for sweep.
 *
 * The CLI is a thin wrapper around these functions, so the same logic can be
 * embedded in scripts or other tools.
 */

export { walkFiles, DEFAULT_EXCLUDES, TEMP_FILE_PATTERNS, isTempFile, toPosix } from './walk.js';
export type { FileEntry, WalkOptions } from './walk.js';
export { sha256File, sha256Buffer, shortHash } from './hash.js';
export { IgnoreSet, parseIgnoreFile, globToRegExpSource } from './ignore.js';
export type { IgnoreRule } from './ignore.js';
export { formatBytes, parseSize, formatCount } from './format.js';

import { sha256File } from './hash.js';
import type { FileEntry } from './walk.js';

export interface DuplicateGroup {
  hash: string;
  size: number;
  files: FileEntry[];
}

/**
 * Group files by content hash and return only the groups with more than one copy.
 */
export async function findDuplicates(
  files: FileEntry[],
): Promise<DuplicateGroup[]> {
  const byHash = new Map<string, FileEntry[]>();

  for (const file of files) {
    const hash = await sha256File(file.absPath);
    const bucket = byHash.get(hash);
    if (bucket) bucket.push(file);
    else byHash.set(hash, [file]);
  }

  return [...byHash.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([hash, bucket]) => ({
      hash,
      size: bucket[0]!.size,
      files: bucket.sort((a, b) => a.relPath.localeCompare(b.relPath)),
    }))
    .sort((a, b) => b.files.length * b.size - a.files.length * a.size);
}

/**
 * Total number of bytes that would be freed by removing redundant copies.
 */
export function wastedBytes(groups: DuplicateGroup[]): number {
  return groups.reduce((sum, group) => sum + group.size * (group.files.length - 1), 0);
}
