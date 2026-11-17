/**
 * Engine-facing input contract.
 *
 * The production app originally adapted database job rows into this shape.
 * The research edition intentionally keeps only the portable contract and
 * removes the database/session/email adapter.
 */

export type ProductStageMediaItem = {
  id: string;
  url: string;
  fileName?: string;
};

export type ProductStageInput = {
  version: 1;
  /** Correlation id for stage provenance; it is not a database identifier. */
  jobId: string;
  source: {
    url: string | null;
    kind: string | null;
    asin?: string;
  };
  product: {
    title: string;
    description: string;
    bullets: string[];
    pricing: {
      currency?: string;
      listPrice?: string;
      originalPrice?: string;
      promoPrice?: string;
      promotionDetails?: string;
      promotionalSummary?: string;
    };
    audience?: string;
    notes?: string;
  };
  branding: {
    brand?: string;
    logoUrl?: string;
  };
  media: {
    images: ProductStageMediaItem[];
    videos: ProductStageMediaItem[];
    primaryImageUrl?: string;
  };
  completeness: {
    readyForNextStage: boolean;
    missing: string[];
  };
};

function appOrigin(): string {
  return (process.env.PUBLIC_APP_ORIGIN || "").replace(/\/$/, "").trim();
}

/**
 * Resolve relative media paths when a public origin is configured.
 * Absolute HTTP(S) URLs pass through unchanged.
 */
export function resolvePublicMediaUrl(url: string): {
  url: string;
  unresolvedRelative: boolean;
} {
  const trimmed = (url || "").trim();
  if (!trimmed) return { url: trimmed, unresolvedRelative: false };
  if (/^https?:\/\//i.test(trimmed)) {
    return { url: trimmed, unresolvedRelative: false };
  }
  if (trimmed.startsWith("//")) {
    return { url: `https:${trimmed}`, unresolvedRelative: false };
  }
  if (trimmed.startsWith("/")) {
    const origin = appOrigin();
    if (origin) return { url: `${origin}${trimmed}`, unresolvedRelative: false };
    return { url: trimmed, unresolvedRelative: true };
  }
  return { url: trimmed, unresolvedRelative: false };
}
