/** One rebuild of the HSN classifier, as the Settings card reads it. */
export interface ClassificationRunDto {
  id: string;
  /** Which step it reached: taxonomy, datasets, training, index, export, deploy, reclassify, done. */
  stage: string;
  /** queued | running | succeeded | failed | skipped */
  status: string;
  message: string | null;
  trainedRows: number | null;
  /** Share correct on the real labelled items, 0-1. */
  evalAccuracy: number | null;
  evalTopK: number | null;
  /** What the model already in service scores on the same items, for comparison. */
  baselineAccuracy: number | null;
  deployed: boolean;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string | null;
}

export interface ClassificationStatusDto {
  /** False until someone has trained a model — it is rebuilt by ml/train, not shipped in the repo. */
  modelInstalled: boolean;
  latestRun: ClassificationRunDto | null;
}
