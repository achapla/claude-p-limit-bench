# claude-p-limit-bench

Does `claude -p` use more of your Claude subscription limit than an interactive `claude` session doing the same work?

In our test: **yes, about 2 times more.** The work, the tokens and the API-price cost were about the same.
Only the share of the 5-hour limit was different.

| Mode | $ of work per 1% of the 5-hour limit |
|---|---|
| `claude -p` | $0.22 |
| interactive `claude` | $0.43–0.48 |

Tested on 29 October 2026 (outside US peak hours) with Claude Code 2.1.312, Opus 5.5, Claude Pro, Windows 11.
See [RESULTS.md](RESULTS.md) for all numbers and [`data/`](data) for the raw data.

The bug report [anthropics/claude-code#97074](https://github.com/anthropics/claude-code/issues/97074) found the
same thing (about 1.8×) on a Max plan. This repo lets anyone measure it on their own account, with one fixed,
public task. **Please [share your results](#share-your-results)**: more plans, models and systems make the
picture clearer.

## What it does

The benchmark runs one fixed task in two modes:

| Mode | How claude runs |
|---|---|
| `p` | `claude -p "<task>" --output-format json` (print mode, as scripts and CI use it) |
| `interactive` | `claude "<task>"` in a real terminal that the script drives, closed when the answer is done |

Both modes get the same prompt, the same allowed tools (`Read`, `Grep`, `Glob`, `Bash(wc:*)`) and the same folder.

**The task** reads files in [`fixture/`](fixture): 9 chapters of *Pride and Prejudice* (public domain, from
Project Gutenberg) and two small code files. It names every step, one tool call per step, so every run makes
about the same 16 API calls. It changes nothing. One run costs about $0.60–0.85 at API prices.

**For each run** it reads the token use from the session file that Claude Code writes:
cache writes, cache reads and output, for every API call.

**For each batch** (several runs of one mode) it reads your 5-hour and weekly limit % before and after.
It uses the same endpoint that `/usage` in Claude Code reads. Then it compares the % with the work done.

## Requirements

- Claude Code, logged in with a Claude subscription (Pro or Max)
- Node.js 22 or newer, and pnpm
- Windows, macOS or Linux

## Run it

```sh
pnpm install
pnpm bench usage                       # your 5-hour and weekly limit % now
pnpm bench run --runs 7 --rounds 2     # p, interactive, then interactive, p: 4 batches of 7 runs
pnpm bench report                      # tables per mode and per batch
pnpm bench report --markdown           # the same, as markdown tables
```

Other commands:

```sh
pnpm bench batch p 7                   # one batch of one mode
pnpm bench batch interactive 7
```

To use another Claude Code profile, add `--config-dir <folder>` or set `CLAUDE_CONFIG_DIR`.
The default is `~/.claude`.

The results go to `results/runs.jsonl` (one line per run) and `results/batches.jsonl` (one line per batch).
The `results/` folder is not committed. Our own raw data is in `data/`.

## Rules for a fair test

- **Nothing else may use the account during a batch**: no other Claude Code session, no claude.ai chat,
  not on another computer either. The script warns when other `claude` processes are running, but it cannot
  tell which account they use.
- **Batches must be big enough.** The limit % is a whole number, and 1% can be $0.15–0.45 of work.
  A batch of 7 runs moves the % by about 10–30 points, so a rounding error of 1 point matters little.
- **Take turns between modes in the same 5-hour window.** `pnpm bench run` does this. A batch that crosses
  a window reset is not used.
- **Note the time.** Anthropic said in March 2026 that the 5-hour limit runs out faster in peak hours
  (weekdays 5–11am US Pacific time). The report marks each batch as peak or not.
- **It uses your limit.** A full `run` (4 batches of 7) costs about $17 at API prices, which can be most of a
  5-hour window on Pro.

## How the numbers are counted

- **Priced tokens** weigh each token by its price, counted as input tokens: cache write (1 hour) 2×,
  cache read 0.1×, output 5×. This compares runs without a price table.
- **Cost** in print mode is what `claude -p` reports (`total_cost_usd`). Interactive mode reports no cost,
  so its cost is estimated from its tokens with the price per token of the print-mode runs.
- **$ per 1%** is the cost of a batch divided by the points its 5-hour % went up. Higher is better:
  your limit lasts longer.

## Limits of this test

- The usage endpoint (`/api/oauth/usage`) is not documented. Anthropic can change it at any time.
- The limit % is a whole number. Small batches are not precise.
- Anthropic does not publish how the limit is counted, and it may change it. We report what we measured.
  We do not know why print mode is counted this way.
- Our results come from one account, one plan (Pro), one model (Opus 5.5), one Claude Code version (2.1.312)
  and one system (Windows 11), outside peak hours. Please share yours.

## How the interactive mode works

The script starts `claude` in a pseudo-terminal ([node-pty](https://github.com/microsoft/node-pty)) with the
task as the first prompt. It watches the session file, and when the final answer is there
(`"stop_reason":"end_turn"`), it closes the terminal.

Interactive claude can show some questions once before it starts. The script answers them:
"Do you trust this folder?" → yes (only for `fixture/`); "Claude in Chrome extension detected" → keep browser
tools off. If another question blocks a run, the run stops after 15 minutes and is saved as failed.

If you run the script from inside a Claude Code session, Claude Code marks its child processes, and an
interactive child with that mark saves no session file. The script removes the mark
(`CLAUDE_CODE_CHILD_SESSION`) for its runs.

## Your login

To read the limit %, the script reads your Claude Code login token: from `<config dir>/.credentials.json`
(Windows, Linux), else from the macOS Keychain, or from the `CLAUDE_OAUTH_TOKEN` environment variable.
It sends the token only to `api.anthropic.com`. It never prints or saves it.

## Share your results

1. Run the benchmark: `pnpm bench run --runs 7 --rounds 2`. Follow the [rules for a fair test](#rules-for-a-fair-test).
2. Run `pnpm bench report --markdown`. It prints your setup (Claude Code version, system, models, time zone)
   and the tables.
3. [Open a results issue](https://github.com/achapla/claude-p-limit-bench/issues/new?template=results.yml)
   and paste the output. Add your plan (Pro, Max 5×, Max 20×, Team, ...).

If you also post `results/runs.jsonl` and `results/batches.jsonl`, others can check the numbers.
They hold only token counts, costs, limit % and random session ids, no file content.

Results that show **no** difference are just as useful.

## License

MIT. The book text in `fixture/book/` is in the public domain.
