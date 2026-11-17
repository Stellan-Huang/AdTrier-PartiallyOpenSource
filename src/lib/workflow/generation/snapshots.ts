/** Minimal generation snapshots under existing run dirs. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { creativeSnapshotDir } from "@/lib/workflow/creative/snapshots";

export type GenerationSnapshotName =
  | "generation/input-script"
  | "generation/compiled-adspec"
  | "generation/result-manifest";

export function writeGenerationSnapshot(
  jobId: string,
  name: GenerationSnapshotName,
  payload: unknown,
  opts?: { runId?: string },
): string {
  const base = creativeSnapshotDir(jobId);
  const path = join(base, `${name.replace(/\//g, "__")}.json`);
  mkdirSync(base, { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        runId: opts?.runId ?? null,
        writtenAt: new Date().toISOString(),
        data: payload,
      },
      null,
      2,
    ),
    "utf8",
  );
  return path;
}
