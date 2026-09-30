/**
 * Cancelling a rebuild, across process boundaries.
 *
 * The Cancel button arrives on the API process. The thing that needs stopping is a Python trainer
 * that is a child of the WORKER process, several minutes into a GPU job. Marking the run row
 * cancelled would unblock the UI while the trainer kept running — and the next Update would then
 * start a second trainer on the same GPU, which is worse than not offering cancel at all.
 *
 * So the worker records the trainer's pid where the API process can see it, and cancel kills it.
 * Redis rather than a column: the pid is ephemeral, meaningless after the process exits, and
 * needs no migration.
 *
 * This works when both processes share a host, which is the case under `pnpm dev` and in the
 * compose setup. Split across hosts, the kill is a no-op and cancel degrades to marking the row —
 * still an improvement on a permanently stuck button, and the honest limit of this approach.
 */

const PID_KEY = "classification:rebuild:trainer-pid";

export const CANCEL_MESSAGE =
  "Cancelled. Nothing was deployed, so the model already in use is unchanged.";

/** The slice of Redis this needs, so tests do not need a server. */
export interface PidStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export type KillFn = (pid: number) => boolean;

export class TrainerRegistry {
  constructor(
    private readonly store: PidStore,
    private readonly kill: KillFn,
  ) {}

  async remember(pid: number): Promise<void> {
    await this.store.set(PID_KEY, String(pid));
  }

  async forget(): Promise<void> {
    await this.store.del(PID_KEY);
  }

  async currentPid(): Promise<number | null> {
    const raw = await this.store.get(PID_KEY);
    if (!raw) return null;
    const pid = Number(raw);
    // A non-numeric value means something else wrote this key. Passing it to kill() would be worse
    // than ignoring it.
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  /** Kills the recorded trainer. False when there was nothing to kill, or it had already exited. */
  async killCurrent(): Promise<boolean> {
    const pid = await this.currentPid();
    if (pid === null) {
      // Clear regardless: a garbage value should not survive a cancel.
      await this.forget();
      return false;
    }

    try {
      const killed = this.kill(pid);
      return killed;
    } catch {
      // ESRCH — the trainer finished between the click and the kill. A race, not a failure.
      return false;
    } finally {
      // Always forget, because pids are reused and a stale one could name an unrelated process.
      await this.forget();
    }
  }
}
