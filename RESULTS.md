# Results

## Setup

| | |
|---|---|
| Plan | Claude Pro |
| Model | Opus 5.5 (`claude-opus-5-5`), effort medium |
| Claude Code | 2.1.312 |
| System | Windows 11 Pro (10.0.26100), Node.js 24.18.0, pnpm 12.15.0 |
| Times | India time (IST, UTC+5:30). Until 1 November 2026, US peak hours (weekdays 5–11am Pacific) are 5:30pm–11:30pm IST. |
| Plugins | A few local plugins were on (a status line, a sound when a task ends, a hook that blocks `npm`). They are the same in both modes. |

Each batch had 7 runs. Nothing else used the account during a batch.

## 29 October 2026 (Thursday), outside peak hours

`pnpm bench run --runs 7 --rounds 2`, the task in [`src/task.ts`](src/task.ts). All 28 runs finished.

| Start (IST) | US peak | Mode | Cost | 5-hour % | Weekly % | $ per 1% |
|---|---|---|---|---|---|---|
| 09:42 | no | `-p` | $4.14 | 1 → 20 (19) | 79 → 80 | **$0.22** |
| 09:50 | no | interactive | $3.82 | 20 → 28 (8) | 80 → 82 | **$0.48** |
| 09:57 | no | interactive | $3.47 | 28 → 36 (8) | 82 → 82 | **$0.43** |
| 10:03 | no | `-p` | $3.60 | 36 → 52 (16) | 82 → 84 | **$0.22** |

Average per run:

| Mode | Runs | API calls | Cache write | Cache read | Output | Priced tokens | Cost |
|---|---|---|---|---|---|---|---|
| `-p` | 14 | 15.7 | 41.7k | 869k | 2.3k | 182k | $0.55 |
| interactive | 14 | 16.0 | 31.7k | 962k | 2.3k | 171k | $0.52 (estimate) |

The raw data is in [`data/2026-10-29-morning/`](data/2026-10-29-morning).

## What we see

1. **The same work costs about the same in both modes.** Calls, cache reads and output are within a few
   percent. `-p` writes about 10k more cache tokens per run, so its priced tokens are about 6% higher.
   That is far too small to explain the difference in the limit.
2. **`-p` used about 2× the 5-hour limit for the same work**: $0.22 of work per 1% for `-p`,
   $0.43–0.48 for interactive.
3. **The order of the batches does not explain it.** `-p` gave $0.22 per 1% both as the first and as the
   last batch.
4. **The weekly % moved little** (79 → 84 for about $15 of work). A whole number is too coarse to compare
   the modes with it.

This agrees with [anthropics/claude-code#97074](https://github.com/anthropics/claude-code/issues/97074), which
found about 1.8× on a Max plan with a different task, a different model and `claude -p --input-format stream-json`.

## Next

- The same test in peak hours.
- Results from other accounts, plans and systems. See [Share your results](README.md#share-your-results).
