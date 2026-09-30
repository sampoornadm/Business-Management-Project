import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { redis } from "../../infra/redis/client.js";
import { logger } from "../../shared/logger/logger.js";

import { TrainerRegistry } from "./classification.cancel.js";
import type { PythonRunner } from "./classification.rebuild.service.js";

/**
 * Shared with the cancel endpoint, which runs in the API process and cannot otherwise reach a
 * trainer that is a child of the worker process.
 */
export const trainerRegistry = new TrainerRegistry(redis, (pid) => process.kill(pid, "SIGTERM") as unknown as boolean);

const run = promisify(execFile);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const TRAINER_DIR = path.join(REPO_ROOT, "ml/train");

/**
 * A fine-tune takes a couple of minutes on Metal; the export and index steps are shorter. The cap
 * is generous because the alternative to waiting is killing a half-written model directory.
 */
const TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Runs the Python trainer as a subprocess.
 *
 * Same shape as pdftotext in shared/utils/pdf-text.ts, and for the same reason: training needs
 * PyTorch and Metal, which Node cannot host. `uv run` resolves the pinned environment from
 * ml/train/pyproject.toml, so the server never has to know where Python lives.
 *
 * Note this requires `uv` on PATH wherever the worker runs. It is a developer-machine capability
 * today — a container that has no uv gets a clear failure recorded on the run rather than a silent
 * no-op, and can still serve the model that was trained elsewhere.
 */
export const pythonRunner: PythonRunner = {
  async run(script: string, args: string[] = []): Promise<{ stdout: string }> {
    const started = Date.now();
    logger.info({ script, args }, "Starting classifier training step");

    try {
      // --extra export, always. export_onnx.py needs onnx/onnxruntime/onnxscript, which live in
      // that optional group; plain `uv run` installs only the default dependencies and the step
      // dies with ModuleNotFoundError. It only bites on a checkout where nobody has run
      // `uv sync --extra export` by hand, which is to say every machine except the one it was
      // developed on — and only at the third stage, after the training has already been paid for.
      const pending = run("uv", ["run", "--extra", "export", "python", script, ...args], {
        cwd: TRAINER_DIR,
        timeout: TIMEOUT_MS,
        // The trainer prints progress to stdout and warnings to stderr; a few MB of both is normal.
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      // Recorded while the step runs so Cancel has something to kill. Killing `uv` takes the
      // python child with it, since uv runs it in its own process group.
      const pid = pending.child.pid;
      if (pid) await trainerRegistry.remember(pid);

      const { stdout, stderr } = await pending;
      await trainerRegistry.forget();

      logger.info({ script, ms: Date.now() - started }, "Classifier training step finished");
      // stderr carries the progress/warning noise, but the numbers this pipeline parses are on
      // stdout. Both are returned joined so a failure message is never missing its own explanation.
      return { stdout: `${stdout}\n${stderr}` };
    } catch (err) {
      await trainerRegistry.forget();
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ script, ms: Date.now() - started, err }, "Classifier training step failed");
      throw new Error(`${script} failed: ${message}`);
    }
  },
};
