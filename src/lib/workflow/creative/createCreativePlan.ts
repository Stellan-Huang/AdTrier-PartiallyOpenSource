/**
 * Compatibility entry point retained for existing callers.
 * The public edition keeps this wrapper but excludes the original app debug API.
 */
import type { ProductUnderstanding } from "@/lib/understanding";
import type { StageResult } from "@/lib/workflow/types";
import {
  createCreativeFlow,
  type CreateCreativeFlowOptions,
} from "./createCreativeFlow";
import type { CreativeFlowResult } from "./v2/types";

export type CreateCreativePlanOptions = CreateCreativeFlowOptions;

export async function createCreativePlan(
  understanding: ProductUnderstanding,
  opts: CreateCreativePlanOptions = {},
): Promise<StageResult<CreativeFlowResult>> {
  return createCreativeFlow(understanding, opts);
}
