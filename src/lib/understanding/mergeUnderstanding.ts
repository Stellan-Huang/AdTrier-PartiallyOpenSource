import type { AiUsageRecord, ExecutionError } from "@/lib/ai";
import type { NormalizedProduct } from "@/lib/normalize";
import type {
  StageExecution,
  StageResult,
} from "@/lib/workflow/types";
import {
  makeStageProvenance,
  newRunId,
  stableInputHash,
} from "@/lib/workflow/types";
import type {
  ImageUnderstanding,
  ModalityStatus,
  ProductUnderstanding,
  TextUnderstandingDraft,
  VideoUnderstanding,
} from "./types";

export const PRODUCT_INTELLIGENCE_STAGE_VERSION = "product-intelligence@1";

export type MergeUnderstandingInput = {
  product: NormalizedProduct;
  text: {
    draft: TextUnderstandingDraft;
    status: ModalityStatus;
    usage: AiUsageRecord[];
    errors: ExecutionError[];
  };
  images: {
    images: ImageUnderstanding[];
    status: ModalityStatus;
    usage: AiUsageRecord[];
    errors: ExecutionError[];
  };
  videos: {
    videos: VideoUnderstanding[];
    status: ModalityStatus;
    usage: AiUsageRecord[];
    errors: ExecutionError[];
  };
  nowIso?: string;
  runId?: string;
};

function computeReady(args: {
  textStatus: ModalityStatus;
  imagesStatus: ModalityStatus;
  videosStatus: ModalityStatus;
  factCount: number;
  name: string | null;
  imageCount: number;
}): {
  readyForCreativeStage: boolean;
  missingFields: string[];
  invalidFields: string[];
} {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  if (args.textStatus === "failed") {
    invalidFields.push("modality.text");
  }
  if (args.imageCount > 0 && args.imagesStatus === "failed") {
    invalidFields.push("modality.images");
    missingFields.push("images_ok_for_creative");
  }
  if (args.videosStatus === "failed") {
    invalidFields.push("modality.videos");
  }

  const textOk = args.textStatus === "ok";
  const hasFactOrName = args.factCount >= 1 || Boolean(args.name);
  if (!textOk) missingFields.push("text_modality_ok");
  if (!hasFactOrName) missingFields.push("facts_or_name");

  const readyForCreativeStage =
    textOk &&
    hasFactOrName &&
    !(args.imageCount > 0 && args.imagesStatus === "failed");

  return { readyForCreativeStage, missingFields, invalidFields };
}

function toStageExecution(
  calls: AiUsageRecord[],
  errors: ExecutionError[],
): StageExecution {
  return {
    calls: calls.map((c) => ({
      capability: c.capability,
      provider: c.provider,
      model: c.model,
      promptVersion: c.promptVersion,
      status: c.status,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      latencyMs: c.latencyMs,
      cached: c.cached,
      errorType: c.errorType,
      errorMessage: c.errorMessage,
    })),
    errors: errors.map((e) => ({
      capability: e.capability,
      errorType: e.errorType,
      errorMessage: e.errorMessage,
    })),
  };
}

/**
 * Deterministic code merge — replaces Gemini fusion.
 * Fact ≠ Inference ≠ Visual Observation ≠ Execution Error.
 * Returns StageResult; business payload has no execution/provenance.
 */
export function mergeUnderstanding(
  input: MergeUnderstandingInput,
): StageResult<ProductUnderstanding> {
  const { product, text, images, videos } = input;
  const facts = text.draft.facts;
  const name = text.draft.product.name ?? product.text.title;

  const calls = [...text.usage, ...images.usage, ...videos.usage];
  const errors = [...text.errors, ...images.errors, ...videos.errors];

  const warnings = [
    ...text.draft.warnings,
    ...(product.commercial.listPrice.status === "invalid"
      ? ["Upstream listPrice is invalid (integer-cents ambiguity)"]
      : []),
    ...(product.commercial.listPrice.status === "missing"
      ? ["Upstream listPrice is missing"]
      : []),
    ...(images.status === "failed"
      ? [
          "Image modality failed — creative stage needs images; see execution.errors",
        ]
      : []),
    ...(videos.status === "failed"
      ? ["Video modality failed — see execution.errors"]
      : []),
    ...(text.status === "failed"
      ? ["Text modality failed — see execution.errors"]
      : []),
  ];

  const validation = computeReady({
    textStatus: text.status,
    imagesStatus: images.status,
    videosStatus: videos.status,
    factCount: facts.length,
    name,
    imageCount: product.media.images.length,
  });

  const data: ProductUnderstanding = {
    version: 1,
    jobId: product.jobId,
    normalizedVersion: 1,
    product: {
      name,
      brand: text.draft.product.brand,
      category: text.draft.product.category,
    },
    userContext: {
      audience: product.text.audience,
      instructions: product.text.notes,
    },
    facts,
    inferences: text.draft.inferences,
    assets: {
      images: images.images,
      videos: videos.videos,
    },
    warnings,
    validation: {
      ...validation,
      modalityStatus: {
        text: text.status,
        images: images.status,
        videos: videos.status,
      },
    },
  };

  const status =
    text.status === "failed" && data.facts.length === 0 ? "failed" : "ok";

  return {
    status,
    data,
    execution: toStageExecution(calls, errors),
    provenance: makeStageProvenance(PRODUCT_INTELLIGENCE_STAGE_VERSION, {
      runId: input.runId ?? newRunId(),
      inputHash: stableInputHash({
        jobId: product.jobId,
        product: {
          name: product.text.title,
          bullets: product.text.bullets,
          description: product.text.description,
        },
        mediaCounts: {
          images: product.media.images.length,
          videos: product.media.videos.length,
        },
      }),
      generatedAt: input.nowIso ?? new Date().toISOString(),
    }),
  };
}
