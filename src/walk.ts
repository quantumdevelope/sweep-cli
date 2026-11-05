import { opendir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { IgnoreSet, parseIgnoreFile } from './ignore.js';

export interface FileEntry {
  /** Absolute path on disk. */
  readonly absPath: string;
  /** Path relative to the scan root, using forward slashes. */
  readonly relPath: string;
  /** Size in bytes. */
  readonly size: number;
  /** Last modification time, milliseconds since epoch. */
  readonly mtimeMs: number;
}

export interface WalkOptions {
  /** Absolute path of the scan root. */
  readonly root: string;
  /** Extra glob patterns to exclude, relative to the root. */
  readonly exclude?: readonly string[];
  /** Honour .gitignore files found in the tree. */
  readonly useGitignore?: boolean;
  /** Apply the built-in exclusion list. */
  readonly useDefaultExcludes?: boolean;
  /** Follow symbolic links while walking. */
  readonly followSymlinks?: boolean;
  /** Maximum directory depth to descend into (0 = root only). */
  readonly maxDepth?: number;
  /** Report progress via this callback (path of the directory being scanned). */
  readonly onProgress?: (dir: string) => void;
}

/** Directories that are almost never interesting when hunting for clutter. */
export const DEFAULT_EXCLUDES: readonly string[] = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.gradle',
  '.idea',
  '.vscode',
  'target',
];

/** Filename patterns that indicate leftovers rather than real content. */
export const TEMP_FILE_PATTERNS: readonly RegExp[] = [
  /\.tmp$/i,
  /\.temp$/i,
  /\.bak$/i,
  /\.backup$/i,
  /\.old$/i,
  /\.orig$/i,
  /\.swp$/i,
  /\.swo$/i,
  /~$/,
  /^#.+#$/,
  /\.copy$/i,
  /\.rej$/i,
  /\.pyc$/i,
  /\.log$/i,
];

/**
 * Walk a directory tree and return every file that survives the ignore rules.
 */
export async function walkFiles(options: WalkOptions): Promise<FileEntry[]> {
  const root = path.resolve(options.root);
  const ignores = new IgnoreSet();
  const files: FileEntry[] = [];

  if (options.useDefaultExcludes !== false) {
    ignores.add('', parseIgnoreFile(DEFAULT_EXCLUDES.join('\n')));
  }
  for (const pattern of options.exclude ?? []) {
    ignores.add('', parseIgnoreFile(pattern));
  }

  await walkDir(root, root, 0, ignores, files, options);

  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}

async function walkDir(
  dir: string,
  root: string,
  depth: number,
  ignores: IgnoreSet,
  out: FileEntry[],
  options: WalkOptions,
): Promise<void> {
  options.onProgress?.(dir);

  const relDir = toPosix(path.relative(root, dir));
  if (relDir !== '' && ignores.isIgnored(relDir, true)) return;

  const nested = options.useGitignore === false ? ignores : await loadNestedIgnores(dir, relDir, ignores);

  let entries;
  try {
    entries = await opendir(dir);
  } catch {
    return;
  }

  const pending: Array<Promise<void>> = [];

  for await (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;

    if (entry.isDirectory()) {
      if (!options.followSymlinks && entry.name === '.git') continue;
      if (nested.isIgnored(relPath, true)) continue;
      if (options.maxDepth !== undefined && depth + 1 > options.maxDepth) continue;
      pending.push(walkDir(absPath, root, depth + 1, nested, out, options));
      continue;
    }

    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (nested.isIgnored(relPath, false)) continue;

    try {
      const stats = await stat(absPath);
      out.push({
        absPath,
        relPath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    } catch {
      // Unreadable file (permissions, broken link): skip it.
    }
  }

  await Promise.all(pending);
}

/**
 * Load the .gitignore of a directory (if any) and merge its rules into the set.
 */
async function loadNestedIgnores(
  dir: string,
  relDir: string,
  inherits: IgnoreSet,
): Promise<IgnoreSet> {
  const ignorePath = path.join(dir, '.gitignore');
  try {
    const content = await readFile(ignorePath, 'utf8');
    const merged = new IgnoreSet();
    merged.add('', inherits.rules);
    merged.add('', parseIgnoreFile(content, relDir));
    return merged;
  } catch {
    return inherits;
  }
}

/**
 * Convert a platform path to forward slashes.
 */
export function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/**
 * Check whether a file name looks like a temporary or backup artifact.
 */
export function isTempFile(name: string): boolean {
  return TEMP_FILE_PATTERNS.some((pattern) => pattern.test(name));
}
