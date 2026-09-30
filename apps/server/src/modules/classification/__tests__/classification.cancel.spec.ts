import { describe, expect, it, vi } from "vitest";

import { CANCEL_MESSAGE, TrainerRegistry } from "../classification.cancel.js";

/** Stands in for Redis: the API process and the worker process share it, nothing else. */
function fakeStore() {
  const values = new Map<string, string>();
  return {
    values,
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async set(key: string, value: string) {
      values.set(key, value);
    },
    async del(key: string) {
      values.delete(key);
    },
  };
}

describe("TrainerRegistry", () => {
  it("remembers the trainer's pid so another process can find it", async () => {
    // Cancel arrives on the API process; the trainer is a child of the worker process. Without a
    // shared record, the endpoint has nothing to kill and "cancel" would only relabel a row while
    // the GPU kept working.
    const store = fakeStore();
    const registry = new TrainerRegistry(store, () => true);

    await registry.remember(4242);
    expect(await registry.currentPid()).toBe(4242);
  });

  it("forgets the pid when the step finishes, so a later cancel kills nothing", async () => {
    const store = fakeStore();
    const registry = new TrainerRegistry(store, () => true);

    await registry.remember(4242);
    await registry.forget();

    expect(await registry.currentPid()).toBeNull();
  });

  it("kills the recorded process and reports that it did", async () => {
    const store = fakeStore();
    const killed: number[] = [];
    const registry = new TrainerRegistry(store, (pid) => {
      killed.push(pid);
      return true;
    });

    await registry.remember(4242);
    expect(await registry.killCurrent()).toBe(true);
    expect(killed).toEqual([4242]);
  });

  it("clears the record after killing, so a second cancel is not a second kill", async () => {
    // Pids get reused. Killing a stale one could take out an unrelated process.
    const store = fakeStore();
    const registry = new TrainerRegistry(store, () => true);

    await registry.remember(4242);
    await registry.killCurrent();

    expect(await registry.currentPid()).toBeNull();
    expect(await registry.killCurrent()).toBe(false);
  });

  it("reports no kill when nothing is running", async () => {
    const registry = new TrainerRegistry(fakeStore(), () => true);
    expect(await registry.killCurrent()).toBe(false);
  });

  it("treats a process that has already exited as nothing to kill", async () => {
    // The trainer finishing between the click and the kill is a race, not an error.
    const store = fakeStore();
    const registry = new TrainerRegistry(store, () => {
      throw new Error("ESRCH");
    });

    await registry.remember(4242);
    expect(await registry.killCurrent()).toBe(false);
    expect(await registry.currentPid()).toBeNull();
  });

  it("ignores a garbage pid rather than passing it to kill", async () => {
    const store = fakeStore();
    const kill = vi.fn(() => true);
    const registry = new TrainerRegistry(store, kill);

    await store.set("classification:rebuild:trainer-pid", "not-a-number");
    expect(await registry.currentPid()).toBeNull();
    expect(await registry.killCurrent()).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });
});

describe("CANCEL_MESSAGE", () => {
  it("says it was cancelled by a person and that nothing shipped", () => {
    // Distinguishable on the card from a crash — the two need different reactions.
    expect(CANCEL_MESSAGE.toLowerCase()).toContain("cancel");
    expect(CANCEL_MESSAGE.toLowerCase()).toContain("nothing was deployed");
  });
});
