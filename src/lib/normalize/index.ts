import type { ProductStageInput } from "@/lib/product-stage-input";
import { normalizeBranding } from "./branding";
import { systemClock, type NormalizeClock } from "./clock";
import { normalizeImages } from "./images";
import { normalizePricing } from "./pricing";
import { normalizeText } from "./text";
import { emptyNotes, type NormalizedProduct } from "./types";
import { validateNormalizedProduct } from "./validate";
import { normalizeVideos } from "./videos";

export type NormalizeOptions = {
  clock?: NormalizeClock;
};

/** Deterministic ProductStageInput → NormalizedProduct (no AI). */
export function normalizeProductStageInput(
  input: ProductStageInput,
  opts?: NormalizeOptions,
): NormalizedProduct {
  const notes = emptyNotes();
  const clock = opts?.clock ?? systemClock;

  const text = normalizeText(input, notes);
  const commercial = normalizePricing(input, notes);
  const { images, primaryImageId, primaryImageUrl } = normalizeImages(
    input,
    notes,
  );
  const videos = normalizeVideos(input, notes);
  const { identity, branding } = normalizeBranding(input, notes);

  const validation = validateNormalizedProduct(
    {
      title: text.title,
      description: text.description,
      imageCount: images.length,
      videoCount: videos.length,
    },
    notes,
  );

  return {
    version: 1,
    jobId: input.jobId,
    stageInputVersion: 1,
    identity,
    text,
    commercial,
    branding,
    media: {
      images,
      videos,
      primaryImageId,
      primaryImageUrl,
    },
    validation,
    provenance: {
      fromStageInput: true,
      generatedAt: clock.now().toISOString(),
    },
  };
}

export type { NormalizedProduct, MoneyAmount } from "./types";
export { fixedClock, systemClock } from "./clock";
export type { NormalizeClock } from "./clock";
