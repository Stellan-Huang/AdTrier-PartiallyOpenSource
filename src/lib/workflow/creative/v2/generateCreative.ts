/**
 * V2: generateCreative — compact portfolio via runCapability.
 * factIds derived from claims union — never dual-written by AI.
 * sanitize = sole deterministic structure gate (incl. lexical safety net).
 */
import type { AiRunner, AiUsageRecord, ExecutionError } from "@/lib/ai";
import {
  makeFailedUsage,
  runCapability,
} from "@/lib/ai";
import {
  makeStageProvenance,
  newRunId,
  stableInputHash,
  type StageResult,
} from "@/lib/workflow/types";
import {
  GENERATE_CREATIVE_SYSTEM,
  GENERATE_CREATIVE_USER_PREFIX,
  generateCreativeResponseSchema,
} from "./prompts/generate-creative";
import {
  CREATIVE_ANGLE_MAX,
  CREATIVE_ANGLE_MIN,
  CREATIVE_TOTAL_MAX,
  CREATIVE_TOTAL_MIN,
  CREATIVE_V2_STAGE_VERSION,
  type Creative,
  type CreativeAngle,
  type CreativeClaim,
  type CreativeLineageOpts,
  type GenerateCreativeInput,
  type GenerateCreativeOutput,
} from "./types";

export type GenerateCreativeOptions = CreativeLineageOpts & {
  runner?: AiRunner;
};

/** Small lexical safety net — not a full entailment lexicon. */
export const LEXICAL_BLOCKLIST = [
  "sugar crash",
  "guilt-free",
  "guilt free",
  "no jitters",
  "no artificial",
  "clinically",
] as const;

export function hitsLexicalBlocklist(text: string): boolean {
  const lower = text.toLowerCase();
  return LEXICAL_BLOCKLIST.some((p) => lower.includes(p));
}

function briefAssetIds(brief: GenerateCreativeInput["brief"]): Set<string> {
  return new Set([
    ...brief.assets.images.map((i) => i.assetId),
    ...brief.assets.videos.map((v) => v.assetId),
  ]);
}

function briefFactIds(brief: GenerateCreativeInput["brief"]): Set<string> {
  return new Set(brief.facts.map((f) => f.id));
}

export function sanitizeClaims(
  raw: unknown,
  knownFacts: Set<string>,
): CreativeClaim[] {
  if (!Array.isArray(raw)) return [];
  const out: CreativeClaim[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const text = String((item as CreativeClaim).text ?? "").trim();
    if (!text) continue;
    const factIds = ((item as CreativeClaim).factIds ?? []).filter(
      (id) => typeof id === "string" && knownFacts.has(id),
    );
    if (factIds.length === 0) continue;
    out.push({ text, factIds });
  }
  return out;
}

export function unionFactIds(claims: CreativeClaim[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of claims) {
    for (const id of c.factIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Sanitize one creative against brief — returns null + reason if invalid.
 * Shared by pool sanitize and hardFilterCreatives helper.
 */
export function sanitizeOneCreative(
  raw: Creative,
  ctx: {
    angleIds: Set<string>;
    factIds: Set<string>;
    assetIds: Set<string>;
    seenIds: Set<string>;
  },
): { creative: Creative | null; error?: string } {
  if (!raw?.id?.trim()) {
    return { creative: null, error: "empty id" };
  }
  const id = raw.id.trim();
  if (ctx.seenIds.has(id)) {
    return { creative: null, error: `duplicate id ${id}` };
  }
  ctx.seenIds.add(id);

  const hook = String(raw.hook ?? "").trim();
  const coreIdea = String(raw.coreIdea ?? "").trim();
  if (!hook || !coreIdea) {
    return { creative: null, error: `Creative ${id} missing hook/coreIdea` };
  }

  const angleId = String(raw.angleId ?? "").trim();
  if (!ctx.angleIds.has(angleId)) {
    return {
      creative: null,
      error: `Creative ${id} has unknown angleId ${angleId}`,
    };
  }

  const claims = sanitizeClaims(
    (raw as Creative & { claims?: unknown }).claims,
    ctx.factIds,
  );
  if (!claims.length) {
    return {
      creative: null,
      error: `Creative ${id} has empty/unknown claim factIds`,
    };
  }

  const blob = `${hook}\n${coreIdea}\n${claims.map((c) => c.text).join("\n")}`;
  if (hitsLexicalBlocklist(blob)) {
    return {
      creative: null,
      error: `Creative ${id} failed lexical safety net`,
    };
  }

  return {
    creative: {
      id,
      angleId,
      hook,
      coreIdea,
      claims,
      factIds: unionFactIds(claims),
      assetIds: (raw.assetIds ?? []).filter((aid) => ctx.assetIds.has(aid)),
    },
  };
}

function sanitize(
  raw: GenerateCreativeOutput,
  brief: GenerateCreativeInput["brief"],
): { data: GenerateCreativeOutput | null; errors: string[] } {
  const errors: string[] = [];
  const factIds = briefFactIds(brief);
  const assetIds = briefAssetIds(brief);

  const angles = (raw.angles ?? [])
    .filter((a) => a && typeof a.id === "string" && a.angle?.trim())
    .map(
      (a): CreativeAngle => ({
        id: String(a.id).trim(),
        angle: String(a.angle).trim(),
        motivation: String(a.motivation ?? "").trim(),
      }),
    );

  const angleIdSet = new Set(angles.map((a) => a.id));
  if (angles.length !== new Set(angles.map((a) => a.id)).size) {
    errors.push("Duplicate angle ids");
  }

  if (
    angles.length < CREATIVE_ANGLE_MIN ||
    angles.length > CREATIVE_ANGLE_MAX
  ) {
    errors.push(
      `Expected ${CREATIVE_ANGLE_MIN}–${CREATIVE_ANGLE_MAX} angles, got ${angles.length}`,
    );
  }

  const seenIds = new Set<string>();
  const creatives: Creative[] = [];
  for (const c of raw.creatives ?? []) {
    if (!c || typeof c.id !== "string") continue;
    const { creative, error } = sanitizeOneCreative(c as Creative, {
      angleIds: angleIdSet,
      factIds,
      assetIds,
      seenIds,
    });
    if (!creative) {
      if (error) errors.push(error);
      continue;
    }
    creatives.push(creative);
  }

  if (
    creatives.length < CREATIVE_TOTAL_MIN ||
    creatives.length > CREATIVE_TOTAL_MAX
  ) {
    errors.push(
      `Expected ${CREATIVE_TOTAL_MIN}–${CREATIVE_TOTAL_MAX} creatives, got ${creatives.length}`,
    );
  }

  const byAngle = new Map<string, number>();
  for (const c of creatives) {
    byAngle.set(c.angleId, (byAngle.get(c.angleId) ?? 0) + 1);
  }
  for (const a of angles) {
    const n = byAngle.get(a.id) ?? 0;
    if (n < 1) {
      errors.push(`Angle ${a.id} has 0 creatives, expected ≥1`);
    }
  }

  if (errors.length) return { data: null, errors };
  return { data: { angles, creatives }, errors: [] };
}

export async function generateCreative(
  input: GenerateCreativeInput,
  opts: GenerateCreativeOptions = {},
): Promise<StageResult<GenerateCreativeOutput>> {
  const nowIso = new Date().toISOString();
  const runId = opts.runId ?? newRunId();
  const inputHash = opts.inputHash ?? stableInputHash(input.brief);
  const provenance = makeStageProvenance(CREATIVE_V2_STAGE_VERSION, {
    runId,
    inputHash,
    generatedAt: nowIso,
  });
  const contents = `${GENERATE_CREATIVE_USER_PREFIX}\n\n${JSON.stringify(input.brief)}`;

  try {
    const { data: raw, usage } = await runCapability<GenerateCreativeOutput>(
      "generateCreative",
      {
        responseJsonSchema: generateCreativeResponseSchema,
        systemInstruction: GENERATE_CREATIVE_SYSTEM,
        contents,
      },
      { runner: opts.runner },
    );

    const { data, errors } = sanitize(raw, input.brief);
    if (!data) {
      const failed = makeFailedUsage(
        "generateCreative",
        new Error(errors.join("; ")),
      );
      failed.errorType = "validation";
      failed.errorMessage = errors.join("; ");
      return {
        status: "failed",
        data: null,
        execution: {
          calls: [usage, failed],
          errors: [
            {
              capability: "generateCreative",
              errorType: "validation",
              errorMessage: errors.join("; "),
            },
          ],
        },
        provenance,
      };
    }

    return {
      status: "ok",
      data,
      execution: {
        calls: [usage],
        errors: [],
      },
      provenance,
    };
  } catch (err) {
    const usage = makeFailedUsage("generateCreative", err);
    return {
      status: "failed",
      data: null,
      execution: {
        calls: [usage],
        errors: [
          {
            capability: "generateCreative",
            errorType: usage.errorType ?? "unknown",
            errorMessage: usage.errorMessage ?? String(err),
          },
        ],
      },
      provenance,
    };
  }
}

/** Exported for unit tests — deterministic validation without AI. */
export function validateGenerateCreativeOutput(
  raw: GenerateCreativeOutput,
  brief: GenerateCreativeInput["brief"],
): { data: GenerateCreativeOutput | null; errors: string[] } {
  return sanitize(raw, brief);
}

export type { AiUsageRecord, ExecutionError };
