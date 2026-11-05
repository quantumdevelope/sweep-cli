#!/usr/bin/env node
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { formatBytes, formatCount, parseSize } from './format.js';
import { sha256File, shortHash } from './hash.js';
import { isTempFile, walkFiles, type FileEntry } from './walk.js';

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Set<string>;
  options: Map<string, string[]>;
}

interface DuplicateGroup {
  hash: string;
  size: number;
  files: FileEntry[];
}

const VERSION = await readVersion();

main();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.has('version') || args.flags.has('v') || args.command === 'version') {
    console.log(VERSION);
    return;
  }
  if (args.flags.has('help') || args.flags.has('h') || args.command === 'help') {
    printHelp(args.command);
    return;
  }

  try {
    switch (args.command) {
      case 'dupes':
        await commandDupes(args);
        break;
      case 'junk':
        await commandJunk(args);
        break;
      case 'hash':
        await commandHash(args);
        break;
      case 'report':
        await commandReport(args);
        break;
      default:
        console.error(`Unknown command: ${args.command}`);
        printHelp();
        process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`sweep: ${message}`);
    process.exitCode = 1;
  }
}

/* ---------------------------------------------------------------- commands */

async function commandDupes(args: ParsedArgs): Promise<void> {
  const root = path.resolve(args.positionals[0] ?? '.');
  const minSize = args.options.has('min-size') ? parseSize(args.options.get('min-size')![0]!) : 1;
  const files = await collectFiles(args, root);

  const candidates = files.filter((file) => file.size >= minSize);
  const byHash = new Map<string, FileEntry[]>();
  for (const file of candidates) {
    const hash = await sha256File(file.absPath);
    const bucket = byHash.get(hash);
    if (bucket) bucket.push(file);
    else byHash.set(hash, [file]);
  }

  const groups: DuplicateGroup[] = [...byHash.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([hash, bucket]) => ({
      hash,
      size: bucket[0]!.size,
      files: bucket.sort((a, b) => a.relPath.localeCompare(b.relPath)),
    }))
    .sort((a, b) => b.files.length * b.size - a.files.length * a.size);

  const totalWasted = groups.reduce((sum, group) => sum + group.size * (group.files.length - 1), 0);
  const totalFiles = groups.reduce((sum, group) => sum + group.files.length, 0);

  if (args.flags.has('json')) {
    console.log(
      JSON.stringify(
        {
          root,
          groups: groups.map((group) => ({
            hash: group.hash,
            size: group.size,
            copies: group.files.length,
            wasted: group.size * (group.files.length - 1),
            files: group.files.map((file) => file.relPath),
          })),
          totals: {
            groups: groups.length,
            scanned: files.length,
            files: totalFiles,
            wasted: totalWasted,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (groups.length === 0) {
    console.log(`No duplicates found in ${root} (${formatCount(files.length)} files scanned).`);
    return;
  }

  console.log(`Duplicate files in ${root}`);
  console.log(
    `${formatCount(groups.length)} groups · ${formatCount(totalFiles)} files · ${formatBytes(totalWasted)} wasted\n`,
  );

  for (const group of groups) {
    console.log(`  ${shortHash(group.hash)}  ${formatBytes(group.size)}  x${group.files.length}`);
    for (const file of group.files) console.log(`      ${file.relPath}`);
    console.log('');
  }

  console.log(`Total reclaimable: ${formatBytes(totalWasted)}`);

  if (args.flags.has('delete')) {
    const deleted = await deleteDuplicates(groups);
    console.log(`Deleted ${formatCount(deleted.length)} duplicate file(s).`);
  } else if (!args.flags.has('quiet')) {
    console.log('Run with --delete to remove duplicates (the oldest copy is kept).');
  }
}

async function commandJunk(args: ParsedArgs): Promise<void> {
  const root = path.resolve(args.positionals[0] ?? '.');
  const emptyLimit = args.options.has('empty-size') ? parseSize(args.options.get('empty-size')![0]!) : 0;
  const largeLimit = args.options.has('max-size') ? parseSize(args.options.get('max-size')![0]!) : 10 * 1024 * 1024;
  const files = await collectFiles(args, root);

  const empty = files.filter((file) => file.size <= emptyLimit);
  const temp = files.filter((file) => isTempFile(path.basename(file.relPath)));
  const large = files.filter((file) => file.size >= largeLimit);

  if (args.flags.has('json')) {
    console.log(
      JSON.stringify(
        {
          root,
          empty: empty.map((file) => file.relPath),
          temp: temp.map((file) => file.relPath),
          large: large.map((file) => ({ path: file.relPath, size: file.size })),
          totals: {
            empty: empty.length,
            temp: temp.length,
            large: large.length,
            bytes: large.reduce((sum, file) => sum + file.size, 0),
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const sections: Array<[string, string[]]> = [
    [`Empty files (<= ${formatBytes(emptyLimit)})`, empty.map((file) => file.relPath)],
    ['Temporary / backup leftovers', temp.map((file) => file.relPath)],
    [`Large files (>= ${formatBytes(largeLimit)})`, large.map((file) => `${file.relPath}  ${formatBytes(file.size)}`)],
  ];

  let found = false;
  for (const [title, items] of sections) {
    if (items.length === 0) continue;
    found = true;
    console.log(`${title} — ${formatCount(items.length)}`);
    for (const item of items) console.log(`  ${item}`);
    console.log('');
  }

  if (!found) console.log(`Nothing to clean up in ${root} (${formatCount(files.length)} files scanned).`);
}

async function commandHash(args: ParsedArgs): Promise<void> {
  const targets = args.positionals;
  if (targets.length === 0) throw new Error('hash: provide at least one file path.');

  for (const target of targets) {
    const absPath = path.resolve(target);
    const stats = await stat(absPath);
    if (!stats.isFile()) throw new Error(`hash: not a file: ${target}`);
    const hash = await sha256File(absPath);
    console.log(`${hash}  ${target}`);
  }
}

async function commandReport(args: ParsedArgs): Promise<void> {
  const root = path.resolve(args.positionals[0] ?? '.');
  const files = await collectFiles(args, root);

  const byHash = new Map<string, FileEntry[]>();
  for (const file of files) {
    const hash = await sha256File(file.absPath);
    const bucket = byHash.get(hash);
    if (bucket) bucket.push(file);
    else byHash.set(hash, [file]);
  }

  const duplicateGroups = [...byHash.entries()].filter(([, bucket]) => bucket.length > 1);
  const duplicates = duplicateGroups.map(([hash, bucket]) => ({ hash, bucket }));
  const wasted = duplicates.reduce((sum, group) => sum + group.bucket[0]!.size * (group.bucket.length - 1), 0);
  const empty = files.filter((file) => file.size === 0);
  const temp = files.filter((file) => isTempFile(path.basename(file.relPath)));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  console.log(
    JSON.stringify(
      {
        root,
        totals: {
          files: files.length,
          bytes: totalBytes,
          duplicates: duplicates.length,
          wastedBytes: wasted,
          empty: empty.length,
          temp: temp.length,
        },
        duplicates: duplicates.map((group) => ({
          hash: group.hash,
          size: group.bucket[0]!.size,
          copies: group.bucket.length,
          files: group.bucket.map((file) => file.relPath),
        })),
        empty: empty.map((file) => file.relPath),
        temp: temp.map((file) => file.relPath),
      },
      null,
      2,
    ),
  );
}

/* ---------------------------------------------------------------- helpers */

async function collectFiles(args: ParsedArgs, root: string): Promise<FileEntry[]> {
  const exclude = args.options.get('exclude') ?? [];
  return walkFiles({
    root,
    exclude,
    useGitignore: !args.flags.has('no-gitignore'),
    useDefaultExcludes: !args.flags.has('no-default-excludes'),
    followSymlinks: args.flags.has('follow-symlinks'),
    maxDepth: args.options.has('max-depth') ? Number.parseInt(args.options.get('max-depth')![0]!, 10) : undefined,
    onProgress: args.flags.has('quiet') ? undefined : (dir) => process.stderr.write(`\rscanning ${dir}`.padEnd(80)),
  });
}

async function deleteDuplicates(groups: DuplicateGroup[]): Promise<FileEntry[]> {
  const removed: FileEntry[] = [];

  for (const group of groups) {
    // Keep the oldest copy, remove the rest.
    const sorted = [...group.files].sort((a, b) => a.mtimeMs - b.mtimeMs || a.relPath.localeCompare(b.relPath));
    for (const file of sorted.slice(1)) {
      try {
        await rm(file.absPath, { force: true });
        removed.push(file);
      } catch {
        // Keep going: a locked file should not abort the whole cleanup.
      }
    }
  }

  return removed;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Set<string>();
  const options = new Map<string, string[]>();
  const positionals: string[] = [];

  const valueFlags = new Set([
    'exclude',
    'min-size',
    'max-size',
    'empty-size',
    'max-depth',
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const [name, inlineValue] = splitOnce(arg.slice(2), '=');

      if (name.startsWith('no-')) {
        flags.add(name);
        continue;
      }

      if (valueFlags.has(name)) {
        const value = inlineValue ?? argv[++i];
        if (value === undefined) throw new Error(`Option --${name} needs a value.`);
        const bucket = options.get(name);
        if (bucket) bucket.push(value);
        else options.set(name, [value]);
        continue;
      }

      flags.add(name);
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      for (const letter of arg.slice(1)) flags.add(letter);
      continue;
    }

    positionals.push(arg);
  }

  const command = positionals.shift() ?? 'help';

  return { command, positionals, flags, options };
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator);
  if (index === -1) return [value, undefined];
  return [value.slice(0, index), value.slice(index + separator.length)];
}

async function readVersion(): Promise<string> {
  try {
    const url = new URL('../package.json', import.meta.url);
    const raw = await readFile(url, 'utf8');
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

function printHelp(topic?: string): void {
  if (topic === 'dupes' || topic === 'junk' || topic === 'hash' || topic === 'report') {
    console.log(`${topic}: ${topicHelp(topic)}`);
    console.log('');
    console.log(commonOptions());
    return;
  }

  console.log(`sweep ${VERSION} — find clutter in your project

Usage:
  sweep <command> [dir] [options]

Commands:
  dupes [dir]     Find byte-identical duplicate files
  junk [dir]      Find empty, temporary and oversized files
  hash <file...>  Print the SHA-256 of each file
  report [dir]    Full JSON report of the whole tree
  help [cmd]      Show help for a command
  version         Print the version

Examples:
  sweep dupes .                  list duplicate files
  sweep dupes . --delete         remove duplicates, keeping the oldest
  sweep junk . --max-size 5mb    find files larger than 5 MB
  sweep report . --json          machine-readable summary
`);
}

function topicHelp(topic: string): string {
  switch (topic) {
    case 'dupes':
      return 'Find byte-identical duplicate files in a tree (default: .)';
    case 'junk':
      return 'Find empty files, temp/backup leftovers and oversized files (default: .)';
    case 'hash':
      return 'Print the SHA-256 digest of one or more files';
    case 'report':
      return 'Print a JSON report of duplicates, junk and totals for a tree (default: .)';
    default:
      return '';
  }
}

function commonOptions(): string {
  return `Options:
  --json                machine-readable output
  --exclude <glob>      extra exclude pattern (repeatable)
  --min-size <size>     minimum file size for duplicates (e.g. 4kb)
  --max-size <size>     large-file threshold (default 10mb)
  --empty-size <size>   empty-file threshold (default 0)
  --max-depth <n>       limit directory depth
  --no-gitignore        ignore .gitignore rules
  --no-default-excludes do not skip node_modules, dist, .git, ...
  --follow-symlinks     descend into symbolic links
  --delete              (dupes) delete redundant copies, keeping the oldest
  --quiet               no progress output
  -h, --help            show help
  -v, --version         show version`;
}
