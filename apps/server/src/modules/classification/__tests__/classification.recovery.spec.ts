import { describe, expect, it } from "vitest";

import { abandonMessageFor, isStale, STALE_AFTER_MS } from "../classification.recovery.js";

describe("isStale", () => {
  const now = new Date("2026-09-30T12:00:00Z");

  it("treats a run still inside the plausible window as live", () => {
    // A real rebuild takes about ten minutes, and the first one on a machine takes longer because
    // it downloads PyTorch and the model weights. Reclaiming those would kill working runs.
    const started = new Date(now.getTime() - 8 * 60 * 1000);
    expect(isStale({ status: "running", startedAt: started }, now)).toBe(false);
  });

  it("treats a run past the window as abandoned", () => {
    const started = new Date(now.getTime() - STALE_AFTER_MS - 1000);
    expect(isStale({ status: "running", startedAt: started }, now)).toBe(true);
  });

  it("reclaims a queued run too, not just a running one", () => {
    // A worker that died before picking the job up leaves it queued forever, which blocks the
    // button exactly as a stuck running row does.
    const started = new Date(now.getTime() - STALE_AFTER_MS - 1000);
    expect(isStale({ status: "queued", startedAt: started }, now)).toBe(true);
  });

  it("never reclaims a run that already finished", () => {
    const started = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    for (const status of ["succeeded", "failed", "skipped"]) {
      expect(isStale({ status, startedAt: started }, now)).toBe(false);
    }
  });

  it("allows well over the observed runtime before giving up on a run", () => {
    // Measured: ~10 minutes warm, longer on a first run that has to fetch PyTorch. The threshold
    // has to clear that comfortably or a slow first build gets killed as though it had hung.
    expect(STALE_AFTER_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});

describe("abandonMessageFor", () => {
  it("says what happened, that nothing shipped, and what to do", () => {
    // This lands on the Settings card. "failed" with no explanation tells nobody whether their
    // model changed, or whether pressing Update again is safe.
    const message = abandonMessageFor("training");

    expect(message).toContain("training");
    expect(message.toLowerCase()).toContain("nothing was deployed");
    expect(message).toMatch(/press Update|try again/i);
  });
});
