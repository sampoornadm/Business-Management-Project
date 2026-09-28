import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ClassificationRebuildService,
  type IClassificationRunRepository,
  type PythonRunner,
  type RebuildDeps,
} from "../classification.rebuild.service.js";

class FakeRunRepository implements IClassificationRunRepository {
  runs = new Map<string, Record<string, unknown>>();
  order: string[] = [];

  async create(data: { triggeredById: string | null }) {
    const id = `run-${this.runs.size + 1}`;
    this.runs.set(id, { id, stage: "queued", status: "queued", deployed: false, ...data });
    return { id };
  }

  async update(id: string, data: Record<string, unknown>) {
    this.runs.set(id, { ...this.runs.get(id), ...data });
    if (typeof data.stage === "string") this.order.push(data.stage);
  }

  async findLatest() {
    return null;
  }

  async findLastDeployed() {
    return this.lastDeployed;
  }

  lastDeployed: { evalAccuracy: number | null } | null = null;

  latest(): Record<string, unknown> {
    return [...this.runs.values()].at(-1)!;
  }
}

function build(overrides: Partial<RebuildDeps> = {}) {
  const repository = new FakeRunRepository();
  const python: PythonRunner & { calls: string[] } = {
    calls: [],
    async run(script: string) {
      this.calls.push(script);
      // train.py is the one whose output is parsed for the headline numbers.
      if (script === "train.py") {
        return { stdout: "top-1:            70/76 = 92.1%  (frozen: 28.9%)\ntop-5:            95.0%" };
      }
      return { stdout: "" };
    },
  };
  const deps: RebuildDeps = {
    runRepository: repository,
    python,
    importTaxonomy: vi.fn().mockResolvedValue({ chapters: 98, headings: 1301 }),
    buildDatasets: vi.fn().mockResolvedValue({ examples: 11147, headings: 1301 }),
    reloadModel: vi.fn().mockResolvedValue(undefined),
    reclassify: vi.fn().mockResolvedValue({ items: 40, boqItems: 120 }),
    ...overrides,
  };
  return { service: new ClassificationRebuildService(deps), repository, python, deps };
}

describe("ClassificationRebuildService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("walks the stages in order and records where it got to", async () => {
    // The UI polls this row. A run that stalls has to say which step it stalled on, because there
    // is no job-progress mechanism in this codebase to ask instead.
    const { service, repository } = build();

    await service.rebuild("user-1");

    expect(repository.order).toEqual([
      "taxonomy",
      "datasets",
      "training",
      "index",
      "export",
      "deploy",
      "reclassify",
      "done",
    ]);
    expect(repository.latest().status).toBe("succeeded");
  });

  it("deploys and reloads the model when it beats the last deployed run", async () => {
    const { service, repository, deps } = build();
    repository.lastDeployed = { evalAccuracy: 0.5 };

    await service.rebuild("user-1");

    expect(deps.reloadModel).toHaveBeenCalled();
    expect(repository.latest().deployed).toBe(true);
    expect(repository.latest().evalAccuracy).toBeCloseTo(0.921, 3);
    expect(repository.latest().baselineAccuracy).toBe(0.5);
  });

  it("refuses to deploy a model worse than the one already running", async () => {
    // The whole reason this compares against the previous run rather than just reporting: a sheet
    // edit can make things worse, and a rebuild must not quietly ship a regression.
    const { service, repository, deps } = build({
      python: {
        calls: [],
        async run() {
          return { stdout: "top-1:            30/76 = 39.5%  (frozen: 28.9%)" };
        },
      } as PythonRunner,
    });
    repository.lastDeployed = { evalAccuracy: 0.921 };

    await service.rebuild("user-1");

    expect(deps.reloadModel).not.toHaveBeenCalled();
    expect(deps.reclassify).not.toHaveBeenCalled();
    expect(repository.latest().deployed).toBe(false);
    expect(repository.latest().status).toBe("skipped");
    expect(String(repository.latest().message)).toMatch(/39\.5%.*92\.1%|worse|not deployed/i);
  });

  it("deploys the first ever run, which has nothing to be compared against", async () => {
    const { service, repository, deps } = build();
    repository.lastDeployed = null;

    await service.rebuild("user-1");

    expect(deps.reloadModel).toHaveBeenCalled();
    expect(repository.latest().deployed).toBe(true);
  });

  it("records the stage that failed instead of losing it", async () => {
    const { service, repository } = build({
      buildDatasets: vi.fn().mockRejectedValue(new Error("sheet is missing a header row")),
    });

    await expect(service.rebuild("user-1")).rejects.toThrow("sheet is missing a header row");

    expect(repository.latest().status).toBe("failed");
    expect(repository.latest().stage).toBe("datasets");
    expect(String(repository.latest().message)).toContain("sheet is missing a header row");
  });

  it("does not re-classify anything when training itself fails", async () => {
    const { service, deps } = build({
      python: {
        calls: [],
        async run() {
          throw new Error("MPS out of memory");
        },
      } as PythonRunner,
    });

    await expect(service.rebuild("user-1")).rejects.toThrow("MPS out of memory");
    expect(deps.reclassify).not.toHaveBeenCalled();
    expect(deps.reloadModel).not.toHaveBeenCalled();
  });

  it("adopts the run row the request already created, rather than opening a second one", async () => {
    // The endpoint creates the row so the card shows "queued" the moment the button is pressed.
    // If the worker created its own, the UI would poll a row nothing ever writes to.
    const { service, repository } = build();
    const existing = await repository.create({ triggeredById: "user-1" });

    await service.rebuild("user-1", existing.id);

    expect(repository.runs.size).toBe(1);
    expect(repository.latest().id).toBe(existing.id);
    expect(repository.latest().status).toBe("succeeded");
  });

  it("runs the python steps in the order the pipeline needs them", async () => {
    const { service, python } = build();

    await service.rebuild("user-1");

    expect(python.calls).toEqual(["train.py", "build_index.py", "export_onnx.py"]);
  });
});
