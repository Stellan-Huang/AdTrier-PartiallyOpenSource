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
import type { NormalizedProduct, NormalizedVideo } from "@/lib/normalize/types";
import { buildCacheKey, readCache, writeCache } from "./cache";
import { guardAssetRoles } from "./guards";
import {
  UNDERSTAND_VIDEO_SYSTEM,
  UNDERSTAND_VIDEO_USER_PREFIX,
  understandVideoResponseSchema,
} from "./prompts/understand-video";
import type { VideoUnderstanding } from "./types";

export type UnderstandVideosResult = {
  videos: VideoUnderstanding[];
  usage: AiUsageRecord[];
  errors: ExecutionError[];
  status: "ok" | "skipped" | "failed";
};

export type UnderstandVideosOptions = {
  runner?: AiRunner;
  skipCache?: boolean;
  fetchImpl?: typeof fetch;
};

async function fetchVideoPart(
  url: string,
  fetchImpl: typeof fetch,
): Promise<AiPart> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch video ${url}: HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") || "video/mp4";
  const mimeType = contentType.split(";")[0].trim() || "video/mp4";
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    inlineData: {
      mimeType,
      data: buf.toString("base64"),
    },
  };
}

function sanitizeVideos(
  raw: VideoUnderstanding[],
  expectedIds: string[],
): VideoUnderstanding[] {
  const byId = new Map(
    (raw ?? [])
      .filter((v) => v && typeof v.assetId === "string")
      .map((v) => [v.assetId, v]),
  );
  return expectedIds.map((assetId) => {
    const hit = byId.get(assetId);
    if (!hit) {
      return emptyVideo(assetId);
    }
    return {
      assetId,
      conciseDescription: hit.conciseDescription ?? "",
      possibleAssetRoles: guardAssetRoles(hit.possibleAssetRoles),
      usableTimeRanges: Array.isArray(hit.usableTimeRanges)
        ? hit.usableTimeRanges
        : [],
    };
  });
}

function emptyVideo(assetId: string): VideoUnderstanding {
  return {
    assetId,
    conciseDescription: "",
    possibleAssetRoles: [],
    usableTimeRanges: [],
  };
}

function cachePayloadForVideos(videos: NormalizedVideo[]) {
  return videos.map((v) => ({
    assetId: v.id,
    canonicalUrl: v.canonicalUrl,
  }));
}

/**
 * videos.length === 0 → { videos: [] } with ZERO API calls.
 * Execution failures → status failed + errors; no fake videos.
 */
export async function understandVideos(
  product: NormalizedProduct,
  opts: UnderstandVideosOptions = {},
): Promise<UnderstandVideosResult> {
  const videos = product.media.videos;
  if (videos.length === 0) {
    return {
      videos: [],
      usage: [],
      errors: [],
      status: "skipped",
    };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const payload = cachePayloadForVideos(videos);
  const cacheKey = buildCacheKey("understandVideos", payload);

  if (!opts.skipCache) {
    const hit = readCache<VideoUnderstanding[]>(cacheKey);
    if (hit) {
      return {
        videos: sanitizeVideos(
          hit,
          videos.map((v) => v.id),
        ),
        usage: [makeCachedUsage("understandVideo")],
        errors: [],
        status: "ok",
      };
    }
  }

  try {
    const parts: AiPart[] = [
      {
        text: `${UNDERSTAND_VIDEO_USER_PREFIX}\n\nassetIds: ${JSON.stringify(videos.map((v) => v.id))}`,
      },
    ];
    for (const vid of videos) {
      parts.push({ text: `assetId=${vid.id}` });
      parts.push(await fetchVideoPart(vid.url, fetchImpl));
    }

    const { data, usage } = await runCapability<{
      videos: VideoUnderstanding[];
    }>(
      "understandVideo",
      {
        responseJsonSchema: understandVideoResponseSchema,
        systemInstruction: UNDERSTAND_VIDEO_SYSTEM,
        contents: [{ role: "user", parts }],
        timeoutMs: 180_000,
      },
      { runner: opts.runner },
    );
    const sanitized = sanitizeVideos(
      data.videos ?? [],
      videos.map((v) => v.id),
    );
    if (!opts.skipCache) writeCache(cacheKey, sanitized);
    return {
      videos: sanitized,
      usage: [usage],
      errors: [],
      status: "ok",
    };
  } catch (err) {
    const failed = makeFailedUsage("understandVideo", err);
    return {
      videos: [],
      usage: [failed],
      errors: [
        {
          capability: "understandVideo",
          errorType: failed.errorType ?? "unknown",
          errorMessage: failed.errorMessage ?? String(err),
        },
      ],
      status: "failed",
    };
  }
}
