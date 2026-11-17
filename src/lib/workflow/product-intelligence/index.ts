/**
 * Portable Product Intelligence entry point.
 *
 * The original SaaS job-row adapter and URL scraper are intentionally not
 * included. Callers provide ProductStageInput directly.
 */
import { normalizeProductStageInput } from "@/lib/normalize";
import type { ProductStageInput } from "@/lib/product-stage-input";
import {
  buildProductUnderstanding,
  type BuildProductUnderstandingOptions,
  type ProductUnderstanding,
} from "@/lib/understanding";
import type { StageResult } from "../types";

export { normalizeProductStageInput } from "@/lib/normalize";
export { buildProductUnderstanding } from "@/lib/understanding";
export type { ProductUnderstanding, BuildProductUnderstandingOptions };

export async function runProductIntelligence(
  input: ProductStageInput,
  opts: BuildProductUnderstandingOptions = {},
): Promise<StageResult<ProductUnderstanding>> {
  const normalized = normalizeProductStageInput(input);
  return buildProductUnderstanding(normalized, opts);
}
