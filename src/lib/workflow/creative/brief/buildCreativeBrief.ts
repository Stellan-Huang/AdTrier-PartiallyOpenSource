import type { ProductUnderstanding } from "@/lib/understanding";
import {
  FIXED_CREATIVE_CONSTRAINTS,
  type CreativeBrief,
} from "../types";

export type CreativeBriefUserContext = {
  audience?: string | null;
  instructions?: string | null;
};

function dedupeFacts(
  facts: ProductUnderstanding["facts"],
): ProductUnderstanding["facts"] {
  const seen = new Set<string>();
  const out: ProductUnderstanding["facts"] = [];
  for (const f of facts) {
    const key = f.statement.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function statementsOf(
  items: Array<{ statement: string }>,
  max = 2,
): string[] {
  return items
    .map((i) => i.statement.trim())
    .filter(Boolean)
    .slice(0, max);
}

function computeAllowPrice(understanding: ProductUnderstanding): boolean {
  const priceInvalid = understanding.warnings.some(
    (w) =>
      /listPrice is invalid/i.test(w) ||
      /listPrice is missing/i.test(w) ||
      /invalid.*price/i.test(w) ||
      /missing.*price/i.test(w),
  );
  return !priceInvalid;
}

/**
 * Deterministic filter: usable ad-claim facts, string insights, slim assets,
 * allowPrice + fixed constraints. Drops sourceText/confidence/provenance/execution.
 *
 * audience / instructions come from user fields (NormalizedProduct / opts),
 * never from AI inferences.
 */
export function buildCreativeBrief(
  understanding: ProductUnderstanding,
  userContext?: CreativeBriefUserContext,
): CreativeBrief {
  const audience =
    (userContext?.audience ?? understanding.userContext?.audience)?.trim() ||
    undefined;
  const instructions =
    (
      userContext?.instructions ?? understanding.userContext?.instructions
    )?.trim() || undefined;

  const facts = dedupeFacts(
    understanding.facts.filter((f) => f.usableAsAdClaim),
  ).map((f) => ({
    id: f.id,
    statement: f.statement,
    type: f.type,
  }));

  return {
    jobId: understanding.jobId,
    product: {
      name: understanding.product.name,
      brand: understanding.product.brand ?? undefined,
      category: understanding.product.category ?? undefined,
    },
    ...(audience ? { audience } : {}),
    ...(instructions ? { instructions } : {}),
    facts,
    insights: {
      audiences: statementsOf(understanding.inferences.possibleAudiences),
      useCases: statementsOf(understanding.inferences.possibleUseCases),
      motivations: statementsOf(
        understanding.inferences.possiblePurchaseMotivations,
      ),
    },
    assets: {
      images: understanding.assets.images.map((img) => ({
        assetId: img.assetId,
        conciseDescription: img.conciseDescription,
        possibleAssetRoles: [...img.possibleAssetRoles],
        suitabilityForAd: img.suitabilityForAd,
        productView: img.productView,
        referenceQuality: img.referenceQuality,
        visualElements: (img.visualElements ?? []).map((el) => ({
          type: el.type,
          description: el.description,
          usability: el.usability,
        })),
      })),
      videos: understanding.assets.videos.map((vid) => ({
        assetId: vid.assetId,
        conciseDescription: vid.conciseDescription,
        possibleAssetRoles: [...vid.possibleAssetRoles],
        usableTimeRanges:
          vid.usableTimeRanges.length > 0
            ? vid.usableTimeRanges.map((r) => ({ ...r }))
            : undefined,
      })),
    },
    commercial: {
      allowPrice: computeAllowPrice(understanding),
    },
    constraints: { ...FIXED_CREATIVE_CONSTRAINTS },
  };
}
