# sweep

**Find clutter in your project.** Duplicate files, empty leftovers, temp/backup
junk and oversized artifacts — one fast, dependency-free CLI.

```bash
npx sweep-cli dupes .          # what is duplicated?
npx sweep-cli junk .           # what is junk?
npx sweep-cli report . --json  # machine-readable summary
```

- 🪶 **Zero runtime dependencies** — only Node ≥ 18
- 🙈 **Respects `.gitignore`** (including nested ones)
- 🧹 **Safe by default** — reports first, deletes only with an explicit `--delete`
- 📦 **JSON output** for CI, scripts and dashboards
- 🧪 **Tested** — 24 unit and end-to-end tests, `node --test`, no test framework

---

## Install

```bash
npm install -g sweep-cli      # global
npx sweep-cli dupes .         # one-off, no install
```

Or run it straight from the repo:

```bash
npm install
npm run build
node dist/cli.js dupes .
```

## Commands

| Command | What it does |
| --- | --- |
| `sweep dupes [dir]` | Find byte-identical duplicate files and report the wasted bytes |
| `sweep junk [dir]` | Find empty files, temp/backup leftovers and oversized files |
| `sweep hash <file...>` | Print the SHA-256 digest of each file |
| `sweep report [dir]` | Full JSON report: totals, duplicates, junk |

`dir` defaults to the current directory.

## Options

```
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
-v, --version         show version
```

Sizes accept `1024`, `512kb`, `4mb`, `1gb`.

## Examples

List duplicates in the current project:

```bash
$ sweep dupes .
Duplicate files in /home/me/project
2 groups · 5 files · 12.4 MB wasted

  a1b2c3d4e5  4.2 MB  x3
      public/logo.png
      public/images/logo.png
      src/assets/logo.png

  f6e7d8c9b0  1.1 MB  x2
      dist/bundle.js
      build/bundle.js

Total reclaimable: 12.4 MB
```

Delete the redundant copies (the oldest copy of each group is kept):

```bash
sweep dupes . --delete
```

Find junk, including files above 100 MB:

```bash
$ sweep junk . --max-size 100mb
Empty files (<= 0 B) — 2
  src/types.ts
  src/index.ts

Temporary / backup leftovers — 3
  config.yml.bak
  notes.tmp
  old.log

Large files (>= 100.0 MB) — 1
  fixtures/dataset.bin  240.0 MB
```

Use it in CI to fail on clutter:

```bash
sweep report . --json | jq '.totals.wastedBytes' | grep -q '^0$' || exit 1
```

## What gets skipped by default

`sweep` skips the usual noise directories so it stays fast and the output stays
useful: `.git`, `node_modules`, `dist`, `build`, `coverage`, `.next`, `.nuxt`,
`.venv`, `__pycache__`, `.gradle`, `target` and friends. Turn that off with
`--no-default-excludes`.

Your own `.gitignore` files are honoured too, including rules from nested
directories.

## Library use

The CLI is a thin wrapper over a small API:

```ts
import { walkFiles, findDuplicates, wastedBytes } from 'sweep-cli';

const files = await walkFiles({ root: '.' });
const groups = await findDuplicates(files);

console.log(groups.length, 'groups', wastedBytes(groups), 'bytes wasted');
```

## How duplicates are found

Files are hashed with SHA-256, streamed so huge files stay cheap on memory.
Two files are duplicates only when their content is byte-identical — same size
is not enough.

## License

MIT © sweep contributors
