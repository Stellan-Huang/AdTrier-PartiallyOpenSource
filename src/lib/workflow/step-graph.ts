/** Fixed Workflow Inspector step graph (PI → Creative V2). */

export const DEBUG_PIPELINE_STEP_IDS = [
  "extract",
  "productStageInput",
  "normalizedProduct",
  "productUnderstanding",
  "brief",
  "generateCreative",
  "premiumCreative",
  "expandScript",
] as const;

export type DebugPipelineStepId = (typeof DEBUG_PIPELINE_STEP_IDS)[number];

/** Layer label for breakpoint UI (Product Intelligence / Creative). */
export type DebugPipelineLayer = "Product Intelligence" | "Creative";

/** Breakpoint picker steps (layer + function). */
export const DEBUG_BREAKPOINT_STEPS: ReadonlyArray<{
  id: DebugPipelineStepId;
  layer: DebugPipelineLayer;
  label: string;
}> = [
  { id: "extract", layer: "Product Intelligence", label: "extract" },
  {
    id: "productStageInput",
    layer: "Product Intelligence",
    label: "productStageInput",
  },
  {
    id: "normalizedProduct",
    layer: "Product Intelligence",
    label: "normalizedProduct",
  },
  {
    id: "productUnderstanding",
    layer: "Product Intelligence",
    label: "productUnderstanding",
  },
  { id: "brief", layer: "Creative", label: "brief" },
  {
    id: "generateCreative",
    layer: "Creative",
    label: "generateCreative",
  },
  {
    id: "premiumCreative",
    layer: "Creative",
    label: "premiumCreative",
  },
  { id: "expandScript", layer: "Creative", label: "expandScript" },
];

export function layerForStep(id: string): DebugPipelineLayer | null {
  const hit = DEBUG_BREAKPOINT_STEPS.find((s) => s.id === id);
  return hit?.layer ?? null;
}

export function isDebugPipelineStepId(v: string): v is DebugPipelineStepId {
  return (DEBUG_PIPELINE_STEP_IDS as readonly string[]).includes(v);
}

export function isV2CreativeStepId(
  id: DebugPipelineStepId,
): id is "generateCreative" | "premiumCreative" | "expandScript" {
  return (
    id === "generateCreative" ||
    id === "premiumCreative" ||
    id === "expandScript"
  );
}

export function stepIndex(id: DebugPipelineStepId): number {
  return DEBUG_PIPELINE_STEP_IDS.indexOf(id);
}

/** Steps up to and including `stopAfter` (inclusive). */
export function stepsThrough(stopAfter: DebugPipelineStepId): DebugPipelineStepId[] {
  const idx = stepIndex(stopAfter);
  return DEBUG_PIPELINE_STEP_IDS.slice(0, idx + 1);
}

/** Steps from `from` inclusive through the end (or stopAfter). */
export function stepsFrom(
  from: DebugPipelineStepId,
  stopAfter?: DebugPipelineStepId,
): DebugPipelineStepId[] {
  const start = stepIndex(from);
  const end = stopAfter
    ? stepIndex(stopAfter)
    : DEBUG_PIPELINE_STEP_IDS.length - 1;
  if (end < start) return [];
  return DEBUG_PIPELINE_STEP_IDS.slice(start, end + 1);
}

/** Map stopAfter aliases used in HTTP bodies. */
export const STOP_AFTER_ALIASES: Record<string, DebugPipelineStepId> = {
  extract: "extract",
  productStageInput: "productStageInput",
  product_stage_input: "productStageInput",
  normalizedProduct: "normalizedProduct",
  normalized_product: "normalizedProduct",
  productUnderstanding: "productUnderstanding",
  product_understanding: "productUnderstanding",
  pi: "productUnderstanding",
  brief: "brief",
  creative: "expandScript",
  generateCreative: "generateCreative",
  generate_creative: "generateCreative",
  premiumCreative: "premiumCreative",
  premium_creative: "premiumCreative",
  expandScript: "expandScript",
  expand_script: "expandScript",
  // Legacy V1 aliases → nearest V2 step
  concepts: "generateCreative",
  plan: "premiumCreative",
  validation: "expandScript",
  repair: "expandScript",
  revalidation: "expandScript",
};
