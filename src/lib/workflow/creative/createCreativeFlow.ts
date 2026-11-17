/**
 * Creative V2 orchestrator:
 * brief → generateCreative → premiumCreative → expandScript
 */
import type { AiRunner } from "@/lib/ai";
import type { EmbedTextsResult } from "@/lib/ai/embed";
import type { ProductUnderstanding } from "@/lib/understanding";
import {
  emptyStageExecution,
  makeStageProvenance,
  newRunId,
  stableInputHash,
  type StageExecution,
  type StageResult,
} from "@/lib/workflow/types";
import {
  buildCreativeBrief,
  type CreativeBriefUserContext,
} from "./brief/buildCreativeBrief";
import { expandScript } from "./v2/expandScript";
import { generateCreative } from "./v2/generateCreative";
import { premiumCreative } from "./v2/premiumCreative";
import {
  CREATIVE_V2_STAGE_VERSION,
  type CreativeFlowResult,
} from "./v2/types";
import { writeCreativeSnapshot } from "./snapshots";

export type CreateCreativeFlowOptions = {
  runner?: AiRunner;
  nowIso?: string;
  skipSnapshots?: boolean;
  userContext?: CreativeBriefUserContext;
  /** Debug: stop after this V2 step (inclusive). */
  stopAfter?: "brief" | "generateCreative" | "premiumCreative" | "expandScript";
  /** Test injection for semanticTrim. */
  embedFn?: (texts: string[]) => Promise<EmbedTextsResult>;
  forceJaccardFallback?: boolean;
  /** Optional override — otherwise generated per flow. */
  runId?: string;
};

function mergeExecution(...parts: StageExecution[]): StageExecution {
  return {
    calls: parts.flatMap((p) => p.calls),
    errors: parts.flatMap((p) => p.errors),
  };
}

/**
 * Full V2 creative flow. Fail closed — never invent AI results.
 */
export async function createCreativeFlow(
  understanding: ProductUnderstanding,
  opts: CreateCreativeFlowOptions = {},
): Promise<StageResult<CreativeFlowResult>> {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const runId = opts.runId ?? newRunId();
  const brief = buildCreativeBrief(understanding, opts.userContext);
  const inputHash = stableInputHash(brief);
  const provenance = makeStageProvenance(CREATIVE_V2_STAGE_VERSION, {
    runId,
    inputHash,
    generatedAt: nowIso,
  });
  const lineage = { runId, inputHash };

  if (!opts.skipSnapshots) {
    writeCreativeSnapshot(understanding.jobId, "01-brief", brief, lineage);
  }

  if (opts.stopAfter === "brief") {
    return {
      status: "ok",
      data: {
        brief,
        angles: [],
        creatives: [],
        shortlist: [],
        selected: [],
        scripts: [],
        warnings: [],
        metrics: undefined,
      },
      execution: emptyStageExecution(),
      provenance,
    };
  }

  const generated = await generateCreative(
    { brief },
    { runner: opts.runner, ...lineage },
  );
  if (generated.status !== "ok" || !generated.data) {
    return {
      status: "failed",
      data: null,
      execution: generated.execution,
      provenance,
    };
  }

  if (!opts.skipSnapshots) {
    writeCreativeSnapshot(
      understanding.jobId,
      "02-generateCreative",
      generated.data,
      lineage,
    );
  }

  if (opts.stopAfter === "generateCreative") {
    return {
      status: "ok",
      data: {
        brief,
        angles: generated.data.angles,
        creatives: generated.data.creatives,
        shortlist: [],
        selected: [],
        scripts: [],
        warnings: [],
        metrics: undefined,
      },
      execution: generated.execution,
      provenance,
    };
  }

  const premium = await premiumCreative(
    {
      brief,
      angles: generated.data.angles,
      creatives: generated.data.creatives,
    },
    {
      runner: opts.runner,
      embedFn: opts.embedFn,
      forceJaccardFallback: opts.forceJaccardFallback,
      ...lineage,
    },
  );
  if (premium.status !== "ok" || !premium.data?.selected.length) {
    return {
      status: "failed",
      data: null,
      execution: mergeExecution(generated.execution, premium.execution),
      provenance,
    };
  }

  if (!opts.skipSnapshots) {
    writeCreativeSnapshot(
      understanding.jobId,
      "03-premiumCreative",
      premium.data,
      lineage,
    );
  }

  if (opts.stopAfter === "premiumCreative") {
    return {
      status: "ok",
      data: {
        brief,
        angles: generated.data.angles,
        creatives: generated.data.creatives,
        shortlist: premium.data.shortlist,
        selected: premium.data.selected,
        scripts: [],
        warnings: premium.data.warnings,
        metrics: premium.data.metrics,
      },
      execution: mergeExecution(generated.execution, premium.execution),
      provenance,
    };
  }

  const expanded = await expandScript(
    {
      brief,
      selected: premium.data.selected,
    },
    { runner: opts.runner, ...lineage },
  );
  if (expanded.status !== "ok" || !expanded.data) {
    return {
      status: "failed",
      data: expanded.data
        ? {
            brief,
            angles: generated.data.angles,
            creatives: generated.data.creatives,
            shortlist: premium.data.shortlist,
            selected: premium.data.selected,
            scripts: expanded.data.scripts,
            warnings: [
              ...premium.data.warnings,
              ...(expanded.data.warnings ?? []),
            ],
            metrics: premium.data.metrics,
          }
        : null,
      execution: mergeExecution(
        generated.execution,
        premium.execution,
        expanded.execution,
      ),
      provenance,
    };
  }

  if (!opts.skipSnapshots) {
    writeCreativeSnapshot(
      understanding.jobId,
      "04-expandScript",
      expanded.data,
      lineage,
    );
  }

  const warnings = [
    ...premium.data.warnings,
    ...(expanded.data.warnings ?? []),
  ];

  return {
    status: "ok",
    data: {
      brief,
      angles: generated.data.angles,
      creatives: generated.data.creatives,
      shortlist: premium.data.shortlist,
      selected: premium.data.selected,
      scripts: expanded.data.scripts,
      warnings,
      metrics: premium.data.metrics,
    },
    execution: mergeExecution(
      generated.execution,
      premium.execution,
      expanded.execution,
    ),
    provenance,
  };
}
