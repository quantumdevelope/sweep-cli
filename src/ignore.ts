/**
 * Minimal, dependency-free .gitignore matcher.
 *
 * Supports the subset of gitignore semantics that matters in practice:
 * comments, negation (`!`), anchoring (`/`), directory-only rules (`/` suffix),
 * `*`, `?`, `**`, and nested .gitignore files with per-directory base paths.
 */

export interface IgnoreRule {
  /** Compiled glob matcher, already anchored for the rule's base directory. */
  readonly regex: RegExp;
  /** True when the rule re-includes files (`!pattern`). */
  readonly negated: boolean;
  /** True when the rule only matches directories (pattern ended with `/`). */
  readonly dirOnly: boolean;
  /** True when the pattern contains a slash and is therefore anchored. */
  readonly anchored: boolean;
  /** Directory the rule is relative to, relative to the scan root ("" = root). */
  readonly base: string;
}

export class IgnoreSet {
  readonly rules: IgnoreRule[] = [];

  add(base: string, rules: IgnoreRule[]): void {
    for (const rule of rules) this.rules.push(rule);
  }

  get size(): number {
    return this.rules.length;
  }

  /**
   * Decide whether a path is ignored.
   *
   * @param relPath Path relative to the scan root, using forward slashes.
   * @param isDir Whether the path is a directory.
   */
  isIgnored(relPath: string, isDir: boolean): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (!this.ruleMatches(rule, relPath, isDir)) continue;
      ignored = !rule.negated;
    }
    return ignored;
  }

  private ruleMatches(rule: IgnoreRule, relPath: string, isDir: boolean): boolean {
    if (rule.dirOnly && !isDir) return false;

    const scoped = rule.base === '' ? relPath : stripPrefix(relPath, rule.base);
    if (scoped === undefined) return false;

    const candidates = rule.anchored ? [scoped] : [basename(scoped)];

    for (const candidate of candidates) {
      if (candidate === '') continue;
      if (rule.regex.test(candidate)) return true;
    }
    return false;
  }
}

function stripPrefix(path: string, base: string): string | undefined {
  if (base === '') return path;
  if (path === base) return '';
  if (path.startsWith(base + '/')) return path.slice(base.length + 1);
  return undefined;
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? '';
}

/**
 * Parse the textual content of a .gitignore file into rules.
 *
 * @param content Raw file content.
 * @param base Directory the file lives in, relative to the scan root ("" = root).
 */
export function parseIgnoreFile(content: string, base = ''): IgnoreRule[] {
  const rules: IgnoreRule[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine;

    // Trailing whitespace is insignificant unless escaped.
    line = line.replace(/(?:(?<!\\)\s)+$/, '');
    if (line === '' || line.startsWith('#')) continue;

    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
      if (line === '') continue;
    }

    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }

    // Leading slash anchors the pattern to the base directory.
    let anchored = false;
    if (line.startsWith('/')) {
      anchored = true;
      line = line.replace(/^\/+/, '');
    }
    if (line === '') continue;

    if (line.includes('/')) anchored = true;

    rules.push({
      regex: new RegExp(globToRegExpSource(line, anchored)),
      negated,
      dirOnly,
      anchored,
      base,
    });
  }

  return rules;
}

/**
 * Convert a gitignore glob to a regular expression source.
 *
 * @param glob Pattern without leading `!` or trailing `/`.
 * @param anchored Whether the pattern must match from the start of the path.
 */
export function globToRegExpSource(glob: string, anchored: boolean): string {
  let out = '';
  let i = 0;

  while (i < glob.length) {
    const char = glob[i]!;

    if (char === '*') {
      const isDoubleStar = glob[i + 1] === '*';

      if (isDoubleStar) {
        const followedBySlash = glob[i + 2] === '/';
        if (followedBySlash) {
          // `**/` matches zero or more directories.
          out += '(?:.*/)?';
          i += 3;
          continue;
        }
        // Trailing `**` matches everything below.
        out += '.*';
        i += 2;
        continue;
      }

      out += '[^/]*';
      i += 1;
      continue;
    }

    if (char === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }

    out += escapeRegExp(char);
    i += 1;
  }

  return anchored ? `^${out}$` : `(?:^|/)${out}$`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
