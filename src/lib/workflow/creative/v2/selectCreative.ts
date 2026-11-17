/**
 * V2: AI_selectCreative + deterministic select repair.
 * Invalid/duplicate ids fixed in code — no second AI call.
 */
import type { AiRunner } from "@/lib/ai";
import { makeFailedUsage, runCapability } from "@/lib/ai";
import {
  makeStageProvenance,
  newRunId,
  stableInputHash,
  type StageResult,
} from "@/lib/workflow/types";
import {
  SELECT_CREATIVE_SYSTEM,
  SELECT_CREATIVE_USER_PREFIX,
  selectCreativeResponseSchema,
} from "./prompts/select-creative";
import {
  CREATIVE_V2_STAGE_VERSION,
  SELECTED_CREATIVE_COUNT,
  type Creative,
  type CreativeAngle,
  type CreativeClaim,
  type CreativeLineageOpts,
  type SelectCreativeInput,
  type SelectCreativeOutput,
} from "./types";

export type SelectCreativeOptions = CreativeLineageOpts & {
  runner?: AiRunner;
};

type CandidateIndexItem = {
  id: string;
  angleId: string;
  hook: string;
  coreIdea: string;
  claims: CreativeClaim[];
  factIds: string[];
  assetIds: string[];
  angleMotivation?: string;
};

function toIndex(
  shortlist: Creative[],
  angles?: CreativeAngle[],
): CandidateIndexItem[] {
  const motivationByAngle = new Map(
    (angles ?? []).map((a) => [a.id, a.motivation]),
  );
  return shortlist.map((c) => ({
    id: c.id,
    angleId: c.angleId,
    hook: c.hook,
    coreIdea: c.coreIdea,
    claims: c.claims,
    factIds: c.factIds,
    assetIds: c.assetIds,
    angleMotivation: motivationByAngle.get(c.angleId),
  }));
}

function minimalBrief(brief: SelectCreativeInput["brief"]) {
  return {
    product: brief.product,
    audience: brief.audience,
    instructions: brief.instructions,
    commercial: brief.commercial,
    constraints: brief.constraints,
    insights: brief.insights,
    facts: brief.facts.map((f) => ({ id: f.id, statement: f.statement })),
  };
}

/**
 * Deterministic repair: skip invalid/dup ids; top up from shortlist order to 5.
 */
export function repairSelectedIds(
  selectedIds: string[],
  shortlist: Creative[],
  target = SELECTED_CREATIVE_COUNT,
): { selected: Creative[]; warnings: string[] } {
  const byId = new Map(shortlist.map((c) => [c.id, c]));
  const warnings: string[] = [];
  const selected: Creative[] = [];
  const seen = new Set<string>();

  for (const id of selectedIds) {
    if (seen.has(id)) {
      warnings.push(`Skipped duplicate id ${id}`);
      continue;
    }
    const hit = byId.get(id);
    if (!hit) {
      warnings.push(`Skipped unknown id ${id}`);
      continue;
    }
    selected.push(hit);
    seen.add(id);
    if (selected.length >= target) break;
  }

  if (selected.length < target) {
    for (const c of shortlist) {
      if (selected.length >= target) break;
      if (seen.has(c.id)) continue;
      selected.push(c);
      seen.add(c.id);
      warnings.push(`Filled missing slot with ${c.id} from shortlist order`);
    }
  }

  return { selected, warnings };
}

export async function selectCreative(
  input: SelectCreativeInput,
  opts: SelectCreativeOptions = {},
): Promise<StageResult<SelectCreativeOutput>> {
  const nowIso = new Date().toISOString();
  const runId = opts.runId ?? newRunId();
  const inputHash = opts.inputHash ?? stableInputHash(input.brief);
  const provenance = makeStageProvenance(CREATIVE_V2_STAGE_VERSION, {
    runId,
    inputHash,
    generatedAt: nowIso,
  });

  if (input.shortlist.length === 0) {
    return {
      status: "failed",
      data: null,
      execution: {
        calls: [],
        errors: [
          {
            capability: "selectCreative",
            errorType: "validation",
            errorMessage: "Empty shortlist — cannot select",
          },
        ],
      },
      provenance,
    };
  }

  if (input.shortlist.length <= SELECTED_CREATIVE_COUNT) {
    return {
      status: "ok",
      data: {
        selected: input.shortlist.slice(0, SELECTED_CREATIVE_COUNT),
        warnings: [
          `Shortlist size ${input.shortlist.length} ≤ ${SELECTED_CREATIVE_COUNT}; skipped AI select`,
        ],
      },
      execution: { calls: [], errors: [] },
      provenance,
    };
  }

  const payload = {
    brief: minimalBrief(input.brief),
    candidates: toIndex(input.shortlist, input.angles),
  };
  const contents = `${SELECT_CREATIVE_USER_PREFIX}\n\n${JSON.stringify(payload)}`;

  try {
    const { data: raw, usage } = await runCapability<{
      selectedIds: string[];
    }>(
      "selectCreative",
      {
        responseJsonSchema: selectCreativeResponseSchema,
        systemInstruction: SELECT_CREATIVE_SYSTEM,
        contents,
      },
      { runner: opts.runner },
    );

    const repaired = repairSelectedIds(
      raw.selectedIds ?? [],
      input.shortlist,
    );

    if (repaired.selected.length === 0) {
      return {
        status: "failed",
        data: null,
        execution: {
          calls: [usage],
          errors: [
            {
              capability: "selectCreative",
              errorType: "validation",
              errorMessage: "No valid creative ids after repair",
            },
          ],
        },
        provenance,
      };
    }

    return {
      status: "ok",
      data: {
        selected: repaired.selected,
        warnings: repaired.warnings,
      },
      execution: { calls: [usage], errors: [] },
      provenance,
    };
  } catch (err) {
    const usage = makeFailedUsage("selectCreative", err);
    return {
      status: "failed",
      data: null,
      execution: {
        calls: [usage],
        errors: [
          {
            capability: "selectCreative",
            errorType: usage.errorType ?? "unknown",
            errorMessage: usage.errorMessage ?? String(err),
          },
        ],
      },
      provenance,
    };
  }
}
