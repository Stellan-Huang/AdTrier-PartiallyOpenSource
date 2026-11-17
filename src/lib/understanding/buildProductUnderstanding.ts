import type { AiRunner } from "@/lib/ai";
import type { NormalizedProduct } from "@/lib/normalize";
import type { StageResult } from "@/lib/workflow/types";
import { mergeUnderstanding } from "./mergeUnderstanding";
import { understandImages } from "./understandImages";
import { understandText } from "./understandText";
import { understandVideos } from "./understandVideos";
import type { ProductUnderstanding } from "./types";

export type BuildProductUnderstandingOptions = {
  /** Injectable AI runner for tests — workflow never imports Gemini SDK. */
  runner?: AiRunner;
  skipCache?: boolean;
  /** ISO timestamp override for tests */
  nowIso?: string;
  fetchImpl?: typeof fetch;
};

/**
 * Orchestrate text + images + videos in parallel → deterministic merge.
 * Empty image/video modalities make 0 runCapability calls (skipped).
 */
export async function buildProductUnderstanding(
  product: NormalizedProduct,
  opts: BuildProductUnderstandingOptions = {},
): Promise<StageResult<ProductUnderstanding>> {
  const shared = {
    runner: opts.runner,
    skipCache: opts.skipCache,
  };

  const [textRes, imagesRes, videosRes] = await Promise.all([
    understandText(product, shared),
    understandImages(product, {
      ...shared,
      fetchImpl: opts.fetchImpl,
    }),
    understandVideos(product, {
      ...shared,
      fetchImpl: opts.fetchImpl,
    }),
  ]);

  return mergeUnderstanding({
    product,
    text: {
      draft: textRes.draft,
      status: textRes.status,
      usage: textRes.usage,
      errors: textRes.errors,
    },
    images: {
      images: imagesRes.images,
      status: imagesRes.status,
      usage: imagesRes.usage,
      errors: imagesRes.errors,
    },
    videos: {
      videos: videosRes.videos,
      status: videosRes.status,
      usage: videosRes.usage,
      errors: videosRes.errors,
    },
    nowIso: opts.nowIso,
  });
}
