/**
 * V2: premiumCreative = (optional trim) → selectCreative.
 * Small pools (≤ TRIM_EMBED_SKIP_MAX) skip trim and go straight to select.
 */
import type { AiRunner } from "@/lib/ai";
import type { EmbedTextsResult } from "@/lib/ai/embed";
import {
  makeStageProvenance,
  newRunId,
  stableInputHash,
  type StageResult,
} from "@/lib/workflow/types";
import { selectCreative } from "./selectCreative";
import { trimCreative } from "./trimCreative";
import {
  CREATIVE_V2_STAGE_VERSION,
  TRIM_EMBED_SKIP_MAX,
  type CreativeLineageOpts,
  type CreativeTrimMetrics,
  type PremiumCreativeInput,
  type PremiumCreativeOutput,
} from "./types";

export type PremiumCreativeOptions = CreativeLineageOpts & {
  runner?: AiRunner;
  embedFn?: (texts: string[]) => Promise<EmbedTextsResult>;
  forceJaccardFallback?: boolean;
};

function skipTrimMetrics(generatedCount: number): CreativeTrimMetrics {
  return {
    generatedCount,
    hardFilteredCount: generatedCount,
    semanticUniqueCount: generatedCount,
    semanticDuplicateCount: 0,
    semanticDuplicateRate: 0,
    trimmedCount: generatedCount,
    selectedCount: "pending",
    unsupportedClaimRejectedCount: "unavailable",
    embedFallback: "skipped",
  };
}

export async function premiumCreative(
  input: PremiumCreativeInput,
  opts: PremiumCreativeOptions = {},
): Promise<StageResult<PremiumCreativeOutput>> {
  const nowIso = new Date().toISOString();
  const runId = opts.runId ?? newRunId();
  const inputHash = opts.inputHash ?? stableInputHash(input.brief);
  const provenance = makeStageProvenance(CREATIVE_V2_STAGE_VERSION, {
    runId,
    inputHash,
    generatedAt: nowIso,
  });

  let shortlist = input.creatives;
  let warnings: string[] = [];
  let metrics: CreativeTrimMetrics = skipTrimMetrics(input.creatives.length);

  const shouldTrim =
    input.creatives.length > TRIM_EMBED_SKIP_MAX ||
    opts.forceJaccardFallback === true;

  if (shouldTrim) {
    const trimmed = await trimCreative(
      {
        brief: input.brief,
        angles: input.angles,
        creatives: input.creatives,
      },
      {
        embedFn: opts.embedFn,
        forceJaccardFallback: opts.forceJaccardFallback,
      },
    );
    shortlist = trimmed.shortlist;
    warnings = [...trimmed.warnings];
    metrics = trimmed.metrics;
  } else {
    warnings.push(
      `Pool size ${input.creatives.length} ≤ ${TRIM_EMBED_SKIP_MAX} — skipped trim, direct select`,
    );
  }

  if (shortlist.length === 0) {
    return {
      status: "failed",
      data: null,
      execution: {
        calls: [],
        errors: [
          {
            capability: "selectCreative",
            errorType: "validation",
            errorMessage: "premiumCreative produced empty shortlist",
          },
        ],
      },
      provenance,
    };
  }

  const selected = await selectCreative(
    {
      brief: input.brief,
      shortlist,
      angles: input.angles,
      pool: input.creatives,
    },
    { runner: opts.runner, runId, inputHash },
  );

  if (selected.status !== "ok" || !selected.data?.selected.length) {
    return {
      status: "failed",
      data: null,
      execution: selected.execution,
      provenance,
    };
  }

  return {
    status: "ok",
    data: {
      selected: selected.data.selected,
      shortlist,
      warnings: [...warnings, ...selected.data.warnings],
      metrics: {
        ...metrics,
        selectedCount: selected.data.selected.length,
      },
    },
    execution: selected.execution,
    provenance,
  };
}
