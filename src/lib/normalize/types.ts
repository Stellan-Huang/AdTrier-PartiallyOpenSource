/** Money in major currency units after conservative parse. */
export type MoneyAmount = {
  amountMajor: number | null;
  currency: string | null;
  raw: string | null;
  status: "ok" | "invalid" | "missing";
};

export type NormalizedMediaAsset = {
  id: string;
  url: string;
  canonicalUrl: string;
  fileName: string | null;
  extension: string | null;
  host: string | null;
  sourceIndex: number;
};

export type NormalizedImage = NormalizedMediaAsset & {
  isPrimary: boolean;
};

export type NormalizedVideo = NormalizedMediaAsset;

export type NormalizedLogo = {
  id: string;
  url: string;
  fileName: string | null;
  extension: string | null;
  host: string | null;
};

export type NormalizedProduct = {
  version: 1;
  jobId: string;
  stageInputVersion: 1;

  identity: {
    sourceUrl: string | null;
    sourceKind: string | null;
    asin: string | null;
  };

  text: {
    title: string | null;
    description: string | null;
    bullets: string[];
    audience: string | null;
    notes: string | null;
  };

  commercial: {
    listPrice: MoneyAmount;
    originalPrice: MoneyAmount;
    promoPrice: MoneyAmount;
    promotionDetails: string | null;
    promotionValid: boolean;
    promotionalSummary: string | null;
  };

  branding: {
    logo: NormalizedLogo | null;
  };

  media: {
    images: NormalizedImage[];
    videos: NormalizedVideo[];
    primaryImageId: string | null;
    primaryImageUrl: string | null;
  };

  validation: {
    readyForNextStage: boolean;
    missingFields: string[];
    invalidFields: string[];
    repairs: string[];
    warnings: string[];
  };

  provenance: {
    fromStageInput: true;
    generatedAt: string;
  };
};

/** Accumulator shared across normalize modules. */
export type NormalizeNotes = {
  missingFields: string[];
  invalidFields: string[];
  repairs: string[];
  warnings: string[];
};

export function emptyNotes(): NormalizeNotes {
  return {
    missingFields: [],
    invalidFields: [],
    repairs: [],
    warnings: [],
  };
}

export function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}
