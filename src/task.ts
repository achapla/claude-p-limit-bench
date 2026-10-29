// The fixed benchmark task. It names every step, one tool call per step, so every run makes about the same calls.
// It only reads files in fixture/, so anyone can run the same task, and it changes nothing.

export const STEPS = [
  "Read book/chapter-03.txt",
  "Read book/chapter-06.txt",
  "Read book/chapter-07.txt",
  "Read book/chapter-08.txt",
  "Read book/chapter-09.txt",
  "Read book/chapter-10.txt",
  "Read book/chapter-11.txt",
  "Read book/chapter-12.txt",
  "Read book/chapter-13.txt",
  'Search with Grep for "Darcy" in the book folder (show the matching lines)',
  "Find the files that match book/*.txt with Glob",
  "Run: wc -w book/*.txt",
  "Read code/ledger.ts",
  "Read code/routes.ts",
  'Search with Grep for "export" in the code folder (show the matching lines)',
];

export const PROMPT =
  "Benchmark run. Do not change any file. " +
  "Do exactly these steps, in this order, and nothing else. Use one tool call per step, one at a time, " +
  "never several in parallel, and do not read other files:\n" +
  STEPS.map((s, i) => `${i + 1}. ${s}.`).join("\n") +
  `\nThen answer with one short line per step (${STEPS.length} lines): the main point of that file or output.`;

/** The same tools are allowed in both modes, so no permission prompt can stop a run. */
export const ALLOWED_TOOLS = ["Read", "Grep", "Glob", "Bash(wc:*)"];
