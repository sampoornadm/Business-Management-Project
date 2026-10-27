import { describe, expect, it } from "vitest";

import { ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import { PortalFillService, type PortalFillRun } from "../portal-fill.service.js";

const result = { responseNumber: "8100095756", filled: 3, skipped: [], mismatches: [], warnings: [], saved: false };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PortalFillService", () => {
  it("reports progress while running and the result when done", async () => {
    const gate = deferred();
    let run!: PortalFillRun;
    const service = new PortalFillService(async (r) => {
      run = r;
      await gate.promise;
      return result;
    });
    const job = service.start("t1", "b1", "u1");
    expect(job).toMatchObject({ status: "running", progress: 0 });
    run.onProgress(42);
    expect(service.get(job.id, "b1")).toMatchObject({ status: "running", progress: 42 });
    gate.resolve();
    await tick();
    expect(service.get(job.id, "b1")).toMatchObject({ status: "done", progress: 100, result });
  });

  it("turns a thrown error into a failed job carrying the message", async () => {
    const service = new PortalFillService(async () => {
      throw new Error("Chrome is not reachable");
    });
    const job = service.start("t1", "b1", "u1");
    await tick();
    expect(service.get(job.id, "b1")).toMatchObject({ status: "failed", error: "Chrome is not reachable" });
  });

  it("allows one running fill per business and starts again once it has finished", async () => {
    const gate = deferred();
    const service = new PortalFillService(() => gate.promise.then(() => result));
    service.start("t1", "b1", "u1");
    expect(() => service.start("t2", "b1", "u1")).toThrow(ConflictError);
    expect(() => service.start("t3", "b2", "u2")).not.toThrow();
    gate.resolve();
    await tick();
    expect(() => service.start("t2", "b1", "u1")).not.toThrow();
  });

  it("does not show one business's job to another", () => {
    const service = new PortalFillService(() => new Promise(() => undefined));
    const job = service.start("t1", "b1", "u1");
    expect(() => service.get(job.id, "b2")).toThrow(NotFoundError);
  });
});
