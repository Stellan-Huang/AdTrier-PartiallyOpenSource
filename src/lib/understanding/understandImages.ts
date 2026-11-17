import type {
  AiPart,
  AiRunner,
  AiUsageRecord,
  ExecutionError,
} from "@/lib/ai";
import {
  makeCachedUsage,
  makeFailedUsage,
  runCapability,
} from "@/lib/ai";
import type { NormalizedImage, NormalizedProduct } from "@/lib/normalize/types";
import { buildCacheKey, readCache, writeCache } from "./cache";
import {
  guardAssetRoles,
  guardProductView,
  guardReferenceQuality,
  guardVisualElements,
  truncateWords,
  MAX_CONCISE_DESCRIPTION_WORDS,
} from "./guards";
import {
  UNDERSTAND_IMAGE_SYSTEM,
  UNDERSTAND_IMAGE_USER_PREFIX,
  understandImageResponseSchema,
} from "./prompts/understand-image";
import type { ImageUnderstanding } from "./types";

const DEFAULT_BATCH_SIZE = 8;

export type UnderstandImagesResult = {
  images: ImageUnderstanding[];
  usage: AiUsageRecord[];
  errors: ExecutionError[];
  status: "ok" | "skipped" | "failed";
};

export type UnderstandImagesOptions = {
  runner?: AiRunner;
  skipCache?: boolean;
  batchSize?: number;
  fetchImpl?: typeof fetch;
};

async function fetchImagePart(
  url: string,
  fetchImpl: typeof fetch,
): Promise<AiPart> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image ${url}: HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const mimeType = contentType.split(";")[0].trim() || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    inlineData: {
      mimeType,
      data: buf.toString("base64"),
    },
  };
}

/**
 * Sanitize successful model results only.
 * Missing assetIds from a successful response → visual gap (not execution error).
 */
function sanitizeImages(
  raw: ImageUnderstanding[],
  expectedIds: string[],
): ImageUnderstanding[] {
  const byId = new Map(
    (raw ?? [])
      .filter((i) => i && typeof i.assetId === "string")
      .map((i) => [i.assetId, i]),
  );
  return expectedIds.map((assetId) => {
    const hit = byId.get(assetId);
    if (!hit) {
      return {
        assetId,
        conciseDescription: "No model description returned for this asset",
        possibleAssetRoles: [],
        suitabilityForAd: "unknown",
        productView: "unknown",
        referenceQuality: "usable",
        visualElements: [],
      };
    }
    return {
      assetId,
      conciseDescription: truncateWords(
        hit.conciseDescription ?? "",
        MAX_CONCISE_DESCRIPTION_WORDS,
      ),
      possibleAssetRoles: guardAssetRoles(hit.possibleAssetRoles),
      suitabilityForAd: hit.suitabilityForAd ?? "unknown",
      productView: guardProductView(
        (hit as ImageUnderstanding).productView,
      ),
      referenceQuality: guardReferenceQuality(
        (hit as ImageUnderstanding).referenceQuality,
      ),
      visualElements: guardVisualElements(
        (hit as ImageUnderstanding).visualElements,
      ),
    };
  });
}

function cachePayloadForImages(images: NormalizedImage[]) {
  return images.map((i) => ({
    assetId: i.id,
    canonicalUrl: i.canonicalUrl,
  }));
}

/**
 * Empty images → skip API, return [].
 * Quota/timeout failures → status failed + execution.errors; NO fake placeholders.
 */
export async function understandImages(
  product: NormalizedProduct,
  opts: UnderstandImagesOptions = {},
): Promise<UnderstandImagesResult> {
  const images = product.media.images;
  if (images.length === 0) {
    return {
      images: [],
      usage: [],
      errors: [],
      status: "skipped",
    };
  }

  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const all: ImageUnderstanding[] = [];
  const usage: AiUsageRecord[] = [];
  const errors: ExecutionError[] = [];
  let anyFailed = false;

  for (let i = 0; i < images.length; i += batchSize) {
    const batch = images.slice(i, i + batchSize);
    const payload = cachePayloadForImages(batch);
    const cacheKey = buildCacheKey("understandImages", payload);

    if (!opts.skipCache) {
      const hit = readCache<ImageUnderstanding[]>(cacheKey);
      if (hit) {
        all.push(...sanitizeImages(hit, batch.map((b) => b.id)));
        usage.push(makeCachedUsage("understandImages"));
        continue;
      }
    }

    try {
      const parts: AiPart[] = [
        {
          text: `${UNDERSTAND_IMAGE_USER_PREFIX}\n\nassetIds: ${JSON.stringify(batch.map((b) => b.id))}`,
        },
      ];
      for (const img of batch) {
        parts.push({ text: `assetId=${img.id}` });
        parts.push(await fetchImagePart(img.url, fetchImpl));
      }

      const { data, usage: u } = await runCapability<{
        images: ImageUnderstanding[];
      }>(
        "understandImages",
        {
          responseJsonSchema: understandImageResponseSchema,
          systemInstruction: UNDERSTAND_IMAGE_SYSTEM,
          contents: [{ role: "user", parts }],
        },
        { runner: opts.runner },
      );
      const sanitized = sanitizeImages(
        data.images ?? [],
        batch.map((b) => b.id),
      );
      if (!opts.skipCache) writeCache(cacheKey, sanitized);
      all.push(...sanitized);
      usage.push(u);
    } catch (err) {
      anyFailed = true;
      const failed = makeFailedUsage("understandImages", err);
      usage.push(failed);
      errors.push({
        capability: "understandImages",
        errorType: failed.errorType ?? "unknown",
        errorMessage: failed.errorMessage ?? String(err),
      });
    }
  }

  return {
    images: all,
    usage,
    errors,
    status: anyFailed ? "failed" : "ok",
  };
}
