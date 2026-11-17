/**
 * Creative V2 types — generate → (optional trim) → select → expand.
 */

import type { CreativeBrief } from "../types";
import type { StageResult } from "@/lib/workflow/types";

export const CREATIVE_V2_STAGE_VERSION = "creative-v2@1";

/** Angle / pool shape — ranges, not exact quotas. */
export const CREATIVE_ANGLE_MIN = 3;
export const CREATIVE_ANGLE_MAX = 6;
export const CREATIVE_TOTAL_MIN = 8;
export const CREATIVE_TOTAL_MAX = 18;
export const SELECTED_CREATIVE_COUNT = 3;
/** Skip semantic embed when candidate pool is at or below this size. */
export const TRIM_EMBED_SKIP_MAX = 18;
/**
 * Preferred spoken VO for ~15s ad at ~1.9–2.2 w/s × ≤13.1s TTS budget.
 * Word count is a screen only — real gate is measured TTS duration.
 */
export const VO_WORD_MIN = 24;
export const VO_WORD_MAX = 30;
/**
 * Hard band for total VO words (fail + one expand retry).
 * Preferred band remains VO_WORD_MIN–VO_WORD_MAX.
 */
export const VO_WORD_SOFT_MIN = 22;
export const VO_WORD_SOFT_MAX = 34;

/** Cosine threshold for semanticTrim near-duplicate drops (centralized). */
export const CREATIVE_SEMANTIC_SIMILARITY_THRESHOLD = 0.86;

export type CreativeAngle = {
  id: string;
  angle: string;
  motivation: string;
};

export type CreativeClaim = {
  text: string;
  factIds: string[];
};

export type Creative = {
  id: string;
  angleId: string;
  hook: string;
  coreIdea: string;
  claims: CreativeClaim[];
  /** Derived = union(claims[].factIds). Never dual-written by AI. */
  factIds: string[];
  assetIds: string[];
};

/** @deprecated alias during migration */
export type CreativeCandidate = Creative;

export type CreativeTrimMetrics = {
  generatedCount: number;
  /** Compat — not a product funnel stage; equals pool size entering trim. */
  hardFilteredCount: number;
  semanticUniqueCount: number;
  semanticDuplicateCount: number;
  semanticDuplicateRate: number;
  trimmedCount: number;
  selectedCount: number | "pending";
  /** Select returns IDs only — rejected-claim count unavailable at trim. */
  unsupportedClaimRejectedCount: "unavailable";
  embedFallback?: "jaccard" | "skipped" | null;
  embedError?: string;
  embedLatencyMs?: number;
  embedModel?: string;
};

export type GenerateCreativeInput = {
  brief: CreativeBrief;
};

export type GenerateCreativeOutput = {
  angles: CreativeAngle[];
  creatives: Creative[];
};

export type TrimCreativeInput = {
  brief: CreativeBrief;
  angles: CreativeAngle[];
  creatives: Creative[];
};

export type TrimCreativeOutput = {
  shortlist: Creative[];
  warnings: string[];
  metrics: CreativeTrimMetrics;
};

export type SelectCreativeInput = {
  brief: CreativeBrief;
  shortlist: Creative[];
  angles?: CreativeAngle[];
  /** Full pool for repair fallback (optional). */
  pool?: Creative[];
};

export type SelectCreativeOutput = {
  selected: Creative[];
  warnings: string[];
};

export type PremiumCreativeInput = {
  brief: CreativeBrief;
  angles: CreativeAngle[];
  creatives: Creative[];
};

export type PremiumCreativeOutput = {
  selected: Creative[];
  shortlist: Creative[];
  warnings: string[];
  metrics: CreativeTrimMetrics;
};

/** How Generation treats product material in a shot — never "play image as scene". */
export type ScriptShotTreatment = "generate" | "animate" | "composite";

/** Product presence in the shot. */
export type ScriptShotProductRole = "none" | "reference" | "element" | "hero";

/** Shared cinematic world for the whole 15s performance (expand v3.4). */
export type VisualDirection = {
  world: string;
  palette: string;
  lighting: string;
  cameraEnergy: string;
};

/** Shared audio direction for whole-script TTS + BGM mood. */
export type AudioDirection = {
  voiceStyle: string;
  musicMood: string;
};

/**
 * One directed shot inside a beat (1–2 per beat).
 * Assets are material (reference / element), never a static full-frame scene.
 */
export type ScriptShot = {
  intent: string;
  /** Visible event / motion that must happen on screen. */
  action: string;
  assetIds: string[];
  productRole: ScriptShotProductRole;
  treatment: ScriptShotTreatment;
  /** Continuity glue into this shot (not a separate transition clip). */
  entry?: string;
  /** Continuity glue out of this shot (not a separate transition clip). */
  exit?: string;
};

export type ScriptBeat = {
  /** Free dramatic function label (e.g. tension, reveal, payoff) — not an enum. */
  purpose: string;
  voiceover: string;
  text?: string;
  factIds?: string[];
  /** @deprecated beat-level assetIds — prefer shots[].assetIds */
  assetIds?: string[];
  shots: ScriptShot[];
};

/**
 * @deprecated Removed from live ScriptBeat — kept for fixture migration only.
 * Live path uses shots[] (treatment/productRole). Never restore source=asset scenes.
 */
export type ScriptVisualSource = "reference_generate" | "generate";

/** @deprecated use ScriptShot */
export type ScriptBeatVisual = {
  source: ScriptVisualSource;
  intent: string;
  productRequired: boolean;
};

export type Script = {
  id: string;
  creativeId: string;
  /** Required on live expand v3.4 path; optional for legacy fixtures. */
  visualDirection?: VisualDirection;
  audioDirection?: AudioDirection;
  beats: ScriptBeat[];
};

export type ExpandScriptInput = {
  brief: CreativeBrief;
  selected: Creative[];
};

export type ExpandScriptOutput = {
  scripts: Script[];
  warnings: string[];
};

export type CreativeFlowResult = {
  brief: CreativeBrief;
  angles: CreativeAngle[];
  creatives: Creative[];
  shortlist: Creative[];
  selected: Creative[];
  scripts: Script[];
  warnings: string[];
  metrics?: CreativeTrimMetrics;
};

export type V2StageResult<T> = StageResult<T>;

/** Lineage opts shared by V2 stages. */
export type CreativeLineageOpts = {
  runId?: string;
  inputHash?: string;
};
