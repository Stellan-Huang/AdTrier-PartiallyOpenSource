import type { AiRunner, AiUsageRecord, ExecutionError } from "@/lib/ai";
import {
  makeCachedUsage,
  makeFailedUsage,
  runCapability,
} from "@/lib/ai";
import type { NormalizedProduct } from "@/lib/normalize";
import { buildCacheKey, readCache, writeCache } from "./cache";
import {
  applyUsableAsAdClaimFromLegacyClaims,
  guardFactsWithSourceText,
  guardInferences,
  truncateFacts,
} from "./guards";
import {
  UNDERSTAND_TEXT_SYSTEM,
  UNDERSTAND_TEXT_USER_PREFIX,
  understandTextResponseSchema,
} from "./prompts/understand-text";
import type { FactItem, TextUnderstandingDraft } from "./types";

export type UnderstandTextResult = {
  draft: TextUnderstandingDraft;
  usage: AiUsageRecord[];
  errors: ExecutionError[];
  status: "ok" | "skipped" | "failed";
};

/** Audience/notes are user fields — never sent to text AI as claimable text. */
type TextPayload = {
  text: {
    title: string | null;
    description: string | null;
    bullets: string[];
  };
  commercial: {
    listPrice: NormalizedProduct["commercial"]["listPrice"];
    originalPrice: NormalizedProduct["commercial"]["originalPrice"];
    promoPrice: NormalizedProduct["commercial"]["promoPrice"];
    promotionDetails: string | null;
    promotionValid: boolean;
    promotionalSummary: string | null;
  };
  brandingMeta: {
    hasLogo: boolean;
    logoFileName: string | null;
  };
  identity: NormalizedProduct["identity"];
};

function buildTextPayload(product: NormalizedProduct): TextPayload {
  const commercial = product.commercial;
  return {
    text: {
      title: product.text.title,
      description: product.text.description,
      bullets: product.text.bullets,
    },
    commercial: {
      listPrice: commercial.listPrice,
      originalPrice: commercial.originalPrice,
      promoPrice: commercial.promoPrice,
      promotionDetails: commercial.promotionValid
        ? commercial.promotionDetails
        : null,
      promotionValid: commercial.promotionValid,
      promotionalSummary: commercial.promotionValid
        ? commercial.promotionalSummary
        : null,
    },
    brandingMeta: {
      hasLogo: Boolean(product.branding.logo),
      logoFileName: product.branding.logo?.fileName ?? null,
    },
    identity: product.identity,
  };
}

type RawTextDraft = TextUnderstandingDraft & {
  claims?: Array<Partial<FactItem>>;
};

function sanitizeDraft(raw: RawTextDraft): TextUnderstandingDraft {
  const factsGuard = guardFactsWithSourceText(raw.facts ?? []);
  const facts = truncateFacts(
    applyUsableAsAdClaimFromLegacyClaims(factsGuard.kept, raw.claims),
  );
  const warnings = [...(raw.warnings ?? [])];
  if (factsGuard.dropped > 0) {
    warnings.push(
      `Dropped ${factsGuard.dropped} text fact(s) missing sourceText`,
    );
  }
  if ((raw.facts ?? []).length > facts.length) {
    warnings.push(
      `Truncated facts to ${facts.length} (max 8)`,
    );
  }
  return {
    product: {
      name: raw.product?.name ?? null,
      brand: raw.product?.brand ?? null,
      category: raw.product?.category ?? null,
    },
    facts,
    inferences: {
      possibleAudiences: guardInferences(raw.inferences?.possibleAudiences),
      possibleUseCases: guardInferences(raw.inferences?.possibleUseCases),
      possiblePurchaseMotivations: guardInferences(
        raw.inferences?.possiblePurchaseMotivations,
      ),
    },
    warnings,
  };
}

function emptyDraft(
  warnings: string[],
  product?: NormalizedProduct,
): TextUnderstandingDraft {
  return {
    product: {
      name: product?.text.title ?? null,
      brand: null,
      category: null,
    },
    facts: [],
    inferences: {
      possibleAudiences: [],
      possibleUseCases: [],
      possiblePurchaseMotivations: [],
    },
    warnings,
  };
}

export type UnderstandTextOptions = {
  runner?: AiRunner;
  skipCache?: boolean;
};

export async function understandText(
  product: NormalizedProduct,
  opts: UnderstandTextOptions = {},
): Promise<UnderstandTextResult> {
  const payload = buildTextPayload(product);
  const hasText =
    Boolean(payload.text.title) ||
    Boolean(payload.text.description) ||
    payload.text.bullets.length > 0;

  if (!hasText) {
    return {
      draft: emptyDraft(["No text fields available for understanding"]),
      usage: [],
      errors: [],
      status: "skipped",
    };
  }

  const cacheKey = buildCacheKey("understandText", payload);
  if (!opts.skipCache) {
    const hit = readCache<RawTextDraft>(cacheKey);
    if (hit) {
      return {
        draft: sanitizeDraft(hit),
        usage: [makeCachedUsage("understandText")],
        errors: [],
        status: "ok",
      };
    }
  }

  const contents = `${UNDERSTAND_TEXT_USER_PREFIX}\n\n${JSON.stringify(payload)}`;

  try {
    const { data, usage } = await runCapability<RawTextDraft>(
      "understandText",
      {
        responseJsonSchema: understandTextResponseSchema,
        systemInstruction: UNDERSTAND_TEXT_SYSTEM,
        contents,
      },
      { runner: opts.runner },
    );
    const draft = sanitizeDraft(data);
    if (!opts.skipCache) writeCache(cacheKey, draft);
    return { draft, usage: [usage], errors: [], status: "ok" };
  } catch (err) {
    const usage = makeFailedUsage("understandText", err);
    return {
      draft: emptyDraft(
        ["understandText failed — see execution.errors"],
        product,
      ),
      usage: [usage],
      errors: [
        {
          capability: "understandText",
          errorType: usage.errorType ?? "unknown",
          errorMessage: usage.errorMessage ?? String(err),
        },
      ],
      status: "failed",
    };
  }
}
