/** Shared StageResult envelope for workflow layers. */

import { createHash, randomUUID } from "node:crypto";

export type StageStatus = "ok" | "failed" | "skipped" | "not_implemented";

export type StageExecution = {
  calls: Array<{
    capability: string;
    provider: string;
    model: string;
    promptVersion: string;
    status: "ok" | "failed" | "cached";
    inputTokens?: number;
    outputTokens?: number;
    latencyMs: number;
    cached: boolean;
    errorType?: string;
    errorMessage?: string;
  }>;
  errors: Array<{
    capability: string;
    errorType: string;
    errorMessage: string;
  }>;
};

export type StageProvenance = {
  /** e.g. "product-intelligence@1" */
  stageVersion: string;
  /** ISO timestamp */
  generatedAt: string;
  /** One id per flow/debug run — isolates snapshots across re-runs of same job. */
  runId: string;
  /** Stable hash of upstream payload (PU or Brief). */
  inputHash: string;
};

export type StageResult<T> = {
  status: StageStatus;
  data: T | null;
  execution: StageExecution;
  provenance: StageProvenance;
};

export function emptyStageExecution(): StageExecution {
  return { calls: [], errors: [] };
}

export function newRunId(): string {
  return randomUUID();
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

/** Deterministic SHA-256 of canonical JSON (sorted keys). */
export function stableInputHash(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortKeys(payload)))
    .digest("hex");
}

export function makeStageProvenance(
  stageVersion: string,
  lineage: { runId: string; inputHash: string; generatedAt?: string },
): StageProvenance {
  return {
    stageVersion,
    generatedAt: lineage.generatedAt ?? new Date().toISOString(),
    runId: lineage.runId,
    inputHash: lineage.inputHash,
  };
}
