/** ProductUnderstanding — Fact ≠ Inference ≠ Visual Observation (business payload only). */

export type FactSource =
  | { kind: "text"; field: string }
  | { kind: "commercial"; field: string }
  | { kind: "image"; assetId: string }
  | { kind: "video"; assetId: string; timeRangeSec?: [number, number] };

/** @deprecated Use FactSource — kept as alias for call-site clarity. */
export type EvidenceSource = FactSource;

export type FactItem = {
  id: string;
  statement: string;
  type: string;
  source: FactSource;
  sourceText: string;
  confidence: number;
  /** Former claims[] migrated here — true when safe to use as an ad claim. */
  usableAsAdClaim: boolean;
};

export type InferenceItem = {
  id: string;
  statement: string;
  type: "audience" | "use_case" | "purchase_motivation" | "other";
  basedOnFactIds: string[];
  confidence: number;
};

/** Visible product orientation in the frame. */
export type ProductView =
  | "front"
  | "back"
  | "side"
  | "top"
  | "detail"
  | "in_use"
  | "none"
  | "unknown";

/** How usable the image is as a Seedance / reference frame. */
export type ReferenceQuality = "strong" | "usable" | "weak";

/**
 * Distinct visible element inside the frame (not a scene).
 * Max 3 per image — no boxes/graphs; type + short description + usability.
 */
export type VisualElement = {
  type: string;
  description: string;
  usability: string;
};

/** Visual observation only — never put quota/timeout/provider errors here. */
export type ImageUnderstanding = {
  assetId: string;
  conciseDescription: string;
  possibleAssetRoles: string[];
  suitabilityForAd: string;
  productView: ProductView;
  referenceQuality: ReferenceQuality;
  /** Up to 3 visible elements usable as compose/animate material — never full-frame scenes. */
  visualElements: VisualElement[];
};

export type VideoUnderstanding = {
  assetId: string;
  conciseDescription: string;
  possibleAssetRoles: string[];
  usableTimeRanges: Array<{
    startSec: number;
    endSec: number;
    purpose: string;
  }>;
};

export type ModalityStatus = "ok" | "skipped" | "failed";

/**
 * Business ProductUnderstanding payload.
 * Runtime execution + stage provenance live on StageResult (see workflow/types).
 */
export type ProductUnderstanding = {
  version: 1;
  jobId: string;
  normalizedVersion: 1;
  product: {
    name: string | null;
    brand: string | null;
    category: string | null;
  };
  /** User-provided fields from NormalizedProduct — never AI-inferred. */
  userContext: {
    audience: string | null;
    instructions: string | null;
  };
  facts: FactItem[];
  inferences: {
    possibleAudiences: InferenceItem[];
    possibleUseCases: InferenceItem[];
    possiblePurchaseMotivations: InferenceItem[];
  };
  assets: {
    images: ImageUnderstanding[];
    videos: VideoUnderstanding[];
  };
  /** Business readiness warnings (not execution/provider errors). */
  warnings: string[];
  validation: {
    readyForCreativeStage: boolean;
    missingFields: string[];
    invalidFields: string[];
    modalityStatus: {
      text: ModalityStatus;
      images: ModalityStatus;
      videos: ModalityStatus;
    };
  };
};

/** Draft from text modality before deterministic merge. */
export type TextUnderstandingDraft = {
  product: {
    name: string | null;
    brand: string | null;
    category: string | null;
  };
  facts: FactItem[];
  inferences: {
    possibleAudiences: InferenceItem[];
    possibleUseCases: InferenceItem[];
    possiblePurchaseMotivations: InferenceItem[];
  };
  warnings: string[];
};
