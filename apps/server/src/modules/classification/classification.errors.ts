/**
 * Reduces a trainer failure to something a person can read on a card.
 *
 * execFile's error message is the command line followed by everything the process wrote to stderr.
 * For the trainer that is hundreds of characters of HuggingFace token warnings, tqdm progress bars,
 * a deprecation notice and a leaked-semaphore warning — none of which say why the run failed. It
 * rendered as a wall of text that overflowed the card and buried the one line that mattered.
 */

/** Enough for a real error line, short enough to sit in a card. */
export const MAX_MESSAGE_CHARS = 400;

/** Noise the Python stack prints on every run, failed or not. */
const NOISE = [
  /^Warning: You are sending unauthenticated requests/i,
  /HF_TOKEN/,
  /^Loading weights:/,
  /\d+%\|/, // tqdm bars
  /resource_tracker/i,
  /leaked semaphore/i,
  /is deprecated, please use/i,
  /^warning: `VIRTUAL_ENV=/i,
  /^\s*$/,
];

/** Lines that name a real failure. */
const LOOKS_LIKE_ERROR = /(Error|Exception|Traceback|failed|not found|No module named|out of memory)/i;

export function summariseTrainerError(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !NOISE.some((pattern) => pattern.test(line)));

  // Last error-looking line first: a Python traceback puts the actual exception at the end, and
  // the first line is usually just "<script> failed: Command failed: ...".
  const meaningful = [...lines].reverse().find(
    (line) => LOOKS_LIKE_ERROR.test(line) && !line.startsWith("Command failed:"),
  );

  const chosen = meaningful ?? lines[0] ?? "The rebuild failed with no output.";

  // Drop the command echo: the reader knows which step ran, and the flags are noise.
  const cleaned = chosen.replace(/Command failed:\s*uv run[^\n]*?python\s+\S+\s*/i, "").trim();
  const text = cleaned || chosen;

  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…` : text;
}
