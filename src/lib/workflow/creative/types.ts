/** Creative-layer schemas — brief → generate → premium → expand (V2). */

import type {
  ProductView,
  ReferenceQuality,
  VisualElement,
} from "@/lib/understanding";
import type {
  AdSpec as GenerationAdSpec,
  SceneSpec as GenerationSceneSpec,
} from "@/lib/workflow/generation/types";
import type {
  ValidationIssue as QaValidationIssue,
  ValidationResult as QaValidationResult,
} from "@/lib/workflow/qa-delivery/types";

export type CreativeBriefFact = {
  id: string;
  statement: string;
  type: string;
};

export type CreativeBriefImageAsset = {
  assetId: string;
  conciseDescription: string;
  possibleAssetRoles: string[];
  suitabilityForAd: string;
  productView: ProductView;
  referenceQuality: ReferenceQuality;
  visualElements: VisualElement[];
};

export type CreativeBriefVideoAsset = {
  assetId: string;
  conciseDescription: string;
  possibleAssetRoles: string[];
  usableTimeRanges?: Array<{
    startSec: number;
    endSec: number;
    purpose: string;
  }>;
};

export type CreativeBriefConstraints = {
  language: "en";
  aspectRatio: "9:16";
  durationSec: 15;
};

export type CreativeBrief = {
  jobId: string;
  product: {
    name: string | null;
    brand?: string | null;
    category?: string | null;
  };
  /** User-provided — never overwritten by AI inferences. */
  audience?: string;
  /** User-provided notes / additionalInstructions. */
  instructions?: string;
  facts: CreativeBriefFact[];
  insights: {
    audiences: string[];
    useCases: string[];
    motivations: string[];
  };
  assets: {
    images: CreativeBriefImageAsset[];
    videos: CreativeBriefVideoAsset[];
  };
  commercial: {
    allowPrice: boolean;
  };
  constraints: CreativeBriefConstraints;
};

/** @deprecated V1 concept shape — kept for fixture adapters during migration. */
export type CreativeConcept = {
  id: string;
  coreIdea: string;
  hook: string;
  purchaseMotivation: string;
  factIds: string[];
  inferenceIds: string[];
  assetIds: string[];
};

/** Single definition lives in generation/types — re-exported for workflow callers. */
export type SceneSpec = GenerationSceneSpec;
export type AdSpec = GenerationAdSpec;

/** @deprecated V1 plan envelope — ads now use Generation AdSpec. */
export type CreativePlan = {
  version: 1;
  jobId: string;
  ads: AdSpec[];
};

/** Single definition lives in qa-delivery/types. */
export type ValidationIssue = QaValidationIssue;
export type ValidationResult = QaValidationResult;

export const CREATIVE_STAGE_VERSION = "creative@2";

export const FIXED_CREATIVE_CONSTRAINTS: CreativeBriefConstraints = {
  language: "en",
  aspectRatio: "9:16",
  durationSec: 15,
};
