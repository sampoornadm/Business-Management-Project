/**
 * Turns the trainer's own stdout into something the Settings card can show.
 *
 * Training is minutes of silence otherwise. The card said "Training the model" and nothing else,
 * which is indistinguishable from a hang — a run that had actually died sat there looking busy for
 * seven hours, and a healthy 20-minute run looks identical to a broken one. A step counter is the
 * difference between waiting and wondering.
 *
 * Parsing the trainer's printed output rather than adding a progress channel keeps one source of
 * truth: what train.py prints is what the log shows and what the card shows. The formats are pinned
 * by tests on both sides, so changing the trainer's wording breaks loudly instead of silently
 * showing nothing.
 */

export interface RebuildProgress {
  label: string;
  /** 0-1 where the line carries a countable position, else null. */
  fraction: number | null;
}

const STEP = /epoch\s+(\d+)\/(\d+)\s+step\s+(\d+)\/(\d+)\s+loss\s+([\d.]+)/;
const EPOCH_START = /epoch\s+(\d+):\s+(\d+)\s+batches/;
const EMBEDDING = /embedding\s+(\d+)\s+texts/;
const FROZEN_SCORE = /before fine-tuning:\s+\d+\/\d+\s+=\s+([\d.]+%)/;

export function parseProgressLine(line: string): RebuildProgress | null {
  const step = STEP.exec(line);
  if (step) {
    const [, epoch, epochs, current, total, loss] = step;
    return {
      label: `Training — epoch ${epoch}/${epochs}, step ${current} of ${total} (loss ${loss})`,
      fraction: Number(current) / Number(total),
    };
  }

  const epochStart = EPOCH_START.exec(line);
  if (epochStart) {
    const [, epoch, batches] = epochStart;
    return { label: `Training — starting epoch ${epoch} (${batches} batches)`, fraction: null };
  }

  const embedding = EMBEDDING.exec(line);
  if (embedding) {
    return {
      label: `Embedding ${Number(embedding[1]).toLocaleString("en-US")} texts`,
      fraction: null,
    };
  }

  const frozen = FROZEN_SCORE.exec(line);
  if (frozen) {
    return { label: `Scored the current model: ${frozen[1]}`, fraction: null };
  }

  return null;
}
