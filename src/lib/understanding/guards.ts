import type {
  EvidenceSource,
  FactItem,
  InferenceItem,
  ProductView,
  ReferenceQuality,
  VisualElement,
} from "./types";

const PRODUCT_VIEWS = new Set<ProductView>([
  "front",
  "back",
  "side",
  "top",
  "detail",
  "in_use",
  "none",
  "unknown",
]);

const REFERENCE_QUALITIES = new Set<ReferenceQuality>([
  "strong",
  "usable",
  "weak",
]);

/** Unknown / missing → "unknown" (fail-soft). */
export function guardProductView(value: unknown): ProductView {
  if (typeof value === "string" && PRODUCT_VIEWS.has(value as ProductView)) {
    return value as ProductView;
  }
  return "unknown";
}

/** Unknown / missing → "usable" (fail-soft). */
export function guardReferenceQuality(value: unknown): ReferenceQuality {
  if (
    typeof value === "string" &&
    REFERENCE_QUALITIES.has(value as ReferenceQuality)
  ) {
    return value as ReferenceQuality;
  }
  return "usable";
}

export const MAX_TEXT_FACTS = 8;
export const MAX_INFERENCES_PER_CATEGORY = 2;
export const MAX_ASSET_ROLES = 2;
export const MAX_CONCISE_DESCRIPTION_WORDS = 20;
export const MAX_VISUAL_ELEMENTS = 3;
export const MAX_VISUAL_ELEMENT_DESCRIPTION_WORDS = 12;

/** Cap visualElements at 3; drop empty type/description. */
export function guardVisualElements(raw: unknown): VisualElement[] {
  if (!Array.isArray(raw)) return [];
  const out: VisualElement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    const type = typeof v.type === "string" ? v.type.trim() : "";
    const description =
      typeof v.description === "string" ? v.description.trim() : "";
    const usability =
      typeof v.usability === "string" ? v.usability.trim() : "usable";
    if (!type || !description) continue;
    out.push({
      type,
      description: truncateWords(description, MAX_VISUAL_ELEMENT_DESCRIPTION_WORDS),
      usability: usability || "usable",
    });
    if (out.length >= MAX_VISUAL_ELEMENTS) break;
  }
  return out;
}

/** Facts without sourceText must never enter ProductUnderstanding.facts. */
export function guardFactsWithSourceText(facts: FactItem[]): {
  kept: FactItem[];
  dropped: number;
} {
  const kept: FactItem[] = [];
  let dropped = 0;
  for (const f of facts) {
    if (
      typeof f.sourceText === "string" &&
      f.sourceText.trim().length > 0 &&
      typeof f.statement === "string" &&
      f.statement.trim().length > 0 &&
      typeof f.id === "string"
    ) {
      kept.push({
        ...f,
        sourceText: f.sourceText.trim(),
        statement: f.statement.trim(),
        confidence: clamp01(f.confidence),
        usableAsAdClaim: Boolean(f.usableAsAdClaim),
      });
    } else {
      dropped += 1;
    }
  }
  return { kept, dropped };
}

/** Deterministic truncate — keep first N after sourceText guard. */
export function truncateFacts(
  facts: FactItem[],
  max = MAX_TEXT_FACTS,
): FactItem[] {
  return facts.slice(0, max);
}

/**
 * Migrate legacy claims[] (if a model still returns them) onto facts.usableAsAdClaim.
 * Prefer explicit usableAsAdClaim on facts; claims matching by id/statement flip the flag.
 */
export function applyUsableAsAdClaimFromLegacyClaims(
  facts: FactItem[],
  legacyClaims: Array<Partial<FactItem>> | undefined,
): FactItem[] {
  if (!Array.isArray(legacyClaims) || legacyClaims.length === 0) {
    return facts.map((f) => ({
      ...f,
      usableAsAdClaim: Boolean(f.usableAsAdClaim),
    }));
  }
  const claimIds = new Set(
    legacyClaims
      .filter((c) => c && typeof c.id === "string")
      .map((c) => c.id as string),
  );
  const claimStatements = new Set(
    legacyClaims
      .filter((c) => c && typeof c.statement === "string")
      .map((c) => (c.statement as string).trim().toLowerCase()),
  );
  return facts.map((f) => {
    if (f.usableAsAdClaim) return f;
    const match =
      claimIds.has(f.id) ||
      claimStatements.has(f.statement.trim().toLowerCase());
    return { ...f, usableAsAdClaim: match };
  });
}

export function guardInferences(
  items: InferenceItem[] | undefined,
  max = MAX_INFERENCES_PER_CATEGORY,
): InferenceItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(
      (i) =>
        i &&
        typeof i.id === "string" &&
        typeof i.statement === "string" &&
        i.statement.trim().length > 0,
    )
    .map((i) => ({
      ...i,
      statement: i.statement.trim(),
      basedOnFactIds: Array.isArray(i.basedOnFactIds) ? i.basedOnFactIds : [],
      confidence: clamp01(i.confidence),
      type: normalizeInferenceType(i.type),
    }))
    .slice(0, max);
}

export function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ");
}

export function guardAssetRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    .map((r) => r.trim())
    .slice(0, MAX_ASSET_ROLES);
}

function normalizeInferenceType(t: string): InferenceItem["type"] {
  if (
    t === "audience" ||
    t === "use_case" ||
    t === "purchase_motivation" ||
    t === "other"
  ) {
    return t;
  }
  return "other";
}

export function clamp01(n: unknown): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function isEvidenceSource(value: unknown): value is EvidenceSource {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "text" || v.kind === "commercial") {
    return typeof v.field === "string";
  }
  if (v.kind === "image") {
    return typeof v.assetId === "string";
  }
  if (v.kind === "video") {
    return typeof v.assetId === "string";
  }
  return false;
}

export function normalizeEvidenceSource(
  raw: Record<string, unknown>,
): EvidenceSource | null {
  if (raw.kind === "text" || raw.kind === "commercial") {
    if (typeof raw.field !== "string") return null;
    return { kind: raw.kind, field: raw.field };
  }
  if (raw.kind === "image") {
    if (typeof raw.assetId !== "string") return null;
    return { kind: "image", assetId: raw.assetId };
  }
  if (raw.kind === "video") {
    if (typeof raw.assetId !== "string") return null;
    const out: EvidenceSource = { kind: "video", assetId: raw.assetId };
    if (
      Array.isArray(raw.timeRangeSec) &&
      raw.timeRangeSec.length === 2 &&
      typeof raw.timeRangeSec[0] === "number" &&
      typeof raw.timeRangeSec[1] === "number"
    ) {
      out.timeRangeSec = [raw.timeRangeSec[0], raw.timeRangeSec[1]];
    }
    return out;
  }
  return null;
}
