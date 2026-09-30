/**
 * Reclaims rebuild runs whose worker died without them.
 *
 * A ClassificationRun is marked failed by the service's own catch block, which only runs if the
 * error is thrown. It is not, if the process is killed: `tsx watch` restarting on a file change,
 * a Ctrl-C, a crash. The row then sits at "running" forever, the Settings card shows "Rebuilding…"
 * indefinitely, and hasRunInProgress() refuses every later attempt — one lost job disables the
 * button permanently.
 *
 * This happened on the first real rebuild: the worker restarted twelve times while files were
 * changing underneath it, and the row stayed "running" for seven hours.
 */

/**
 * How long a run may go without any sign of life before it is presumed dead.
 *
 * Generous on purpose. A warm rebuild is about ten minutes, but the first one on a machine also
 * downloads PyTorch and the model weights, and there is no progress heartbeat to distinguish "slow"
 * from "gone". Reclaiming a live run would kill work someone is waiting on, so the threshold errs
 * heavily towards patience; the cost of waiting too long is a stale card, not a lost model.
 */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

const UNFINISHED = new Set(["queued", "running"]);

export function isStale(
  run: { status: string; startedAt: Date },
  now: Date = new Date(),
): boolean {
  if (!UNFINISHED.has(run.status)) return false;
  return now.getTime() - run.startedAt.getTime() > STALE_AFTER_MS;
}

/** What the card says about a run nobody finished. */
export function abandonMessageFor(stage: string): string {
  return (
    `Abandoned during "${stage}": the worker stopped before this run finished. ` +
    `Nothing was deployed, so the model already in use is unchanged. Press Update to try again.`
  );
}
