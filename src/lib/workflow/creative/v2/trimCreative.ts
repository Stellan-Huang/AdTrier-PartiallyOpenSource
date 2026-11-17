/**
 * V2: trimCreative — semantic redundancy only (+ Jaccard fallback).
 * No angle coverage / per-angle quota. Embed skipped when pool ≤ TRIM_EMBED_SKIP_MAX.
 * hardFilterCreatives is a helper sharing generate sanitize rules — not a funnel stage.
 */
import { cosineSimilarity, embedTexts, type EmbedTextsResult } from "@/lib/ai/embed";
import type { CreativeBrief } from "../types";
import {
  sanitizeOneCreative,
} from "./generateCreative";
import {
  CREATIVE_SEMANTIC_SIMILARITY_THRESHOLD,
  TRIM_EMBED_SKIP_MAX,
  type Creative,
  type CreativeAngle,
  type CreativeTrimMetrics,
  type TrimCreativeOutput,
} from "./types";

const JACCARD_THRESHOLD = 0.72;

export type TrimCreativeOptions = {
  embedFn?: (texts: string[]) => Promise<EmbedTextsResult>;
  /** Force Jaccard path (tests). */
  forceJaccardFallback?: boolean;
};

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function briefFactIds(brief: CreativeBrief): Set<string> {
  return new Set(brief.facts.map((f) => f.id));
}

function briefAssetIds(brief: CreativeBrief): Set<string> {
  return new Set([
    ...brief.assets.images.map((i) => i.assetId),
    ...brief.assets.videos.map((v) => v.assetId),
  ]);
}

/** Embed text = hook + coreIdea + claims[].text — no angle/motivation. */
export function creativeEmbedText(c: Creative): string {
  return [c.hook, c.coreIdea, ...c.claims.map((cl) => cl.text)]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Helper — same deterministic rules as generate sanitize (per-creative).
 * Not a product funnel stage (generated→hardFiltered).
 */
export function hardFilterCreatives(input: {
  brief: CreativeBrief;
  angles: CreativeAngle[];
  creatives: Creative[];
}): { kept: Creative[]; warnings: string[]; dropped: number } {
  const warnings: string[] = [];
  const angleIds = new Set(input.angles.map((a) => a.id));
  const factIds = briefFactIds(input.brief);
  const assetIds = briefAssetIds(input.brief);
  const seenIds = new Set<string>();
  const kept: Creative[] = [];

  for (const raw of input.creatives) {
    const { creative, error } = sanitizeOneCreative(raw, {
      angleIds,
      factIds,
      assetIds,
      seenIds,
    });
    if (!creative) {
      warnings.push(error ? `Dropped: ${error}` : "Dropped invalid creative");
      continue;
    }
    kept.push(creative);
  }

  return {
    kept,
    warnings,
    dropped: input.creatives.length - kept.length,
  };
}

/** Legacy Jaccard deterministic dedupe — used when embed fails. */
function jaccardTrim(
  pool: Creative[],
  warnings: string[],
): Creative[] {
  const kept: Creative[] = [];
  for (const c of pool) {
    const dup = kept.find(
      (k) => jaccard(k.hook, c.hook) >= JACCARD_THRESHOLD,
    );
    if (dup) {
      warnings.push(`Jaccard dedupe drop ${c.id} similar to ${dup.id}`);
      continue;
    }
    kept.push(c);
  }
  return kept;
}

/**
 * semanticTrim — cosine greedy within + across angles. No angle quota.
 */
function semanticTrimFromVectors(
  pool: Creative[],
  angles: CreativeAngle[],
  vectors: number[][],
  warnings: string[],
): { shortlist: Creative[]; unique: Creative[]; duplicateCount: number } {
  const byAngle = new Map<string, { c: Creative; v: number[]; i: number }[]>();
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    const list = byAngle.get(c.angleId) ?? [];
    list.push({ c, v: vectors[i], i });
    byAngle.set(c.angleId, list);
  }

  const withinKept: { c: Creative; v: number[] }[] = [];
  let duplicateCount = 0;

  for (const a of angles) {
    const list = byAngle.get(a.id) ?? [];
    const survivors: { c: Creative; v: number[] }[] = [];
    for (const item of list) {
      const dup = survivors.find(
        (s) =>
          cosineSimilarity(s.v, item.v) >= CREATIVE_SEMANTIC_SIMILARITY_THRESHOLD,
      );
      if (dup) {
        duplicateCount += 1;
        warnings.push(
          `Semantic within-angle drop ${item.c.id} ~ ${dup.c.id}`,
        );
        continue;
      }
      survivors.push({ c: item.c, v: item.v });
    }
    withinKept.push(...survivors);
  }

  // Orphans with unknown angleId still compete cross-angle
  for (const [angleId, list] of byAngle) {
    if (angles.some((a) => a.id === angleId)) continue;
    for (const item of list) {
      withinKept.push({ c: item.c, v: item.v });
    }
  }

  const unique: { c: Creative; v: number[] }[] = [];
  for (const item of withinKept) {
    const dup = unique.find(
      (s) =>
        cosineSimilarity(s.v, item.v) >= CREATIVE_SEMANTIC_SIMILARITY_THRESHOLD,
    );
    if (dup) {
      duplicateCount += 1;
      warnings.push(`Semantic cross-angle drop ${item.c.id} ~ ${dup.c.id}`);
      continue;
    }
    unique.push(item);
  }

  const ordered = unique.map((u) => u.c);
  return {
    shortlist: ordered,
    unique: ordered,
    duplicateCount,
  };
}

function emptyMetrics(
  generatedCount: number,
  poolCount: number,
): CreativeTrimMetrics {
  return {
    generatedCount,
    hardFilteredCount: poolCount,
    semanticUniqueCount: poolCount,
    semanticDuplicateCount: 0,
    semanticDuplicateRate: 0,
    trimmedCount: poolCount,
    selectedCount: "pending",
    unsupportedClaimRejectedCount: "unavailable",
  };
}

/**
 * Semantic-only trim. Async only for embed. Does not call chat AI.
 * Pool ≤ TRIM_EMBED_SKIP_MAX → skip embed, return candidates as-is.
 */
export async function trimCreative(
  input: {
    brief: CreativeBrief;
    angles: CreativeAngle[];
    creatives: Creative[];
  },
  opts: TrimCreativeOptions = {},
): Promise<TrimCreativeOutput> {
  const generatedCount = input.creatives.length;
  const warnings: string[] = [];
  // Assume generate sanitize already ran; re-apply helper only to drop dirt (compat).
  const filtered = hardFilterCreatives(input);
  warnings.push(...filtered.warnings);
  const pool = filtered.kept;
  const poolCount = pool.length;

  if (pool.length === 0) {
    return {
      shortlist: [],
      warnings,
      metrics: {
        ...emptyMetrics(generatedCount, 0),
        trimmedCount: 0,
      },
    };
  }

  // Small pool: skip embedding — select receives full candidate set.
  if (pool.length <= TRIM_EMBED_SKIP_MAX && !opts.forceJaccardFallback) {
    warnings.push(
      `Pool size ${pool.length} ≤ ${TRIM_EMBED_SKIP_MAX} — skipped embedding`,
    );
    return {
      shortlist: pool,
      warnings,
      metrics: {
        ...emptyMetrics(generatedCount, poolCount),
        embedFallback: "skipped",
      },
    };
  }

  const texts = pool.map((c) => creativeEmbedText(c));

  let embedResult: EmbedTextsResult | null = null;
  if (!opts.forceJaccardFallback) {
    embedResult = await embedTexts(texts, { embedFn: opts.embedFn });
  }

  if (
    opts.forceJaccardFallback ||
    !embedResult ||
    embedResult.error ||
    embedResult.vectors.length !== pool.length
  ) {
    if (embedResult?.error) {
      warnings.push(`Embed failed — Jaccard fallback: ${embedResult.error}`);
    } else if (opts.forceJaccardFallback) {
      warnings.push("Forced Jaccard fallback");
    } else {
      warnings.push("Embed incomplete — Jaccard fallback");
    }
    const shortlist = jaccardTrim(pool, warnings);
    return {
      shortlist,
      warnings,
      metrics: {
        generatedCount,
        hardFilteredCount: poolCount,
        semanticUniqueCount: shortlist.length,
        semanticDuplicateCount: Math.max(0, poolCount - shortlist.length),
        semanticDuplicateRate:
          poolCount === 0
            ? 0
            : Math.max(0, poolCount - shortlist.length) / poolCount,
        trimmedCount: shortlist.length,
        selectedCount: "pending",
        unsupportedClaimRejectedCount: "unavailable",
        embedFallback: "jaccard",
        embedError: embedResult?.error,
        embedLatencyMs: embedResult?.latencyMs,
        embedModel: embedResult?.model,
      },
    };
  }

  const { shortlist, unique, duplicateCount } = semanticTrimFromVectors(
    pool,
    input.angles,
    embedResult.vectors,
    warnings,
  );

  return {
    shortlist,
    warnings,
    metrics: {
      generatedCount,
      hardFilteredCount: poolCount,
      semanticUniqueCount: unique.length,
      semanticDuplicateCount: duplicateCount,
      semanticDuplicateRate:
        poolCount === 0 ? 0 : duplicateCount / poolCount,
      trimmedCount: shortlist.length,
      selectedCount: "pending",
      unsupportedClaimRejectedCount: "unavailable",
      embedFallback: null,
      embedLatencyMs: embedResult.latencyMs,
      embedModel: embedResult.model,
    },
  };
}
