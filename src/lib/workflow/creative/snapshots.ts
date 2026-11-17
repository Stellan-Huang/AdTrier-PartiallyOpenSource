import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CreativeSnapshotName =
  | "00-input"
  | "01-brief"
  | "02-generateCreative"
  | "03-premiumCreative"
  | "04-expandScript";

export type CreativeSnapshotLineage = {
  runId: string;
  inputHash: string;
};

const RUNS_REL = join(".data", "runs");

function safeJobId(jobId: string): string {
  const safe = (jobId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  return safe || "unknown";
}

export function runsRootAbs(): string {
  const useTmp =
    process.env.RUNS_TO_TMP === "1" ||
    process.env.RUNS_TO_TMP === "true";
  return useTmp
    ? join("/tmp", RUNS_REL)
    : join(process.cwd(), RUNS_REL);
}

/** Write snapshots under .data/runs/{correlationId}/creative/. */
export function writeCreativeSnapshot(
  jobId: string,
  name: CreativeSnapshotName,
  payload: unknown,
  lineage?: CreativeSnapshotLineage,
): string {
  const filePath = join(creativeSnapshotDir(jobId), `${name}.json`);
  const envelope = lineage
    ? {
        runId: lineage.runId,
        inputHash: lineage.inputHash,
        writtenAt: new Date().toISOString(),
        data: payload,
      }
    : payload;
  try {
    mkdirSync(creativeSnapshotDir(jobId), { recursive: true });
    writeFileSync(filePath, JSON.stringify(envelope, null, 2), "utf8");
  } catch (err) {
    console.warn(
      `[creative/snapshots] skip write ${filePath}:`,
      err instanceof Error ? err.message : err,
    );
  }
  return filePath;
}

export function creativeSnapshotDir(jobId: string): string {
  return join(runsRootAbs(), safeJobId(jobId), "creative");
}
