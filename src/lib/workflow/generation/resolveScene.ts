/**
 * Helper (not a stage): code-only media routing for a SceneSpec.
 * Live path: Seedance (Preview tier from SEEDANCE_PREVIEW_TIER; default 2.5) —
 * production quality stays Mini. No Seedream / static asset scenes.
 * Prompt compiled from VisualDirection + intent/action/entry/exit.
 * Product shots: Mini/2.5 use reference_image (r2v + 9:16); Pro Fast → first_frame.
 */

import type { CreativeBrief, CreativeBriefImageAsset } from "@/lib/workflow/creative/types";
import type { VisualDirection } from "@/lib/workflow/creative/v2/types";
import type { SeedanceTier } from "@/lib/ai/providers/volcengine-seedance";
import { referenceRoleForTier } from "@/lib/ai/providers/volcengine-seedance";
import { resolveSeedancePreviewTier } from "@/lib/video/seedance-preview-tier";
import type { MotionPrimitive, SceneSpec } from "./types";

export type ResolvedScenePlan = {
  mode: "seedance";
  tier: SeedanceTier;
  prompt: string;
  treatment: SceneSpec["treatment"];
  productRole: SceneSpec["productRole"];
  referenceAssetId?: string;
  referenceImageUrl?: string;
  /**
   * Mini/2.5: reference_image (r2v, keeps 9:16).
   * Pro Fast: first_frame (i2v) — Ark rejects r2v on 1.0 Pro Fast.
   */
  referenceRole?: "reference_image" | "first_frame";
  /**
   * Optional product cutout for Hero Close overlay when extract gate passes.
   * Mid-shot extract fail → skip (no original card).
   */
  prepareElementAssetId?: string;
  /** Hero Close may try multiple product assets on extract fail. */
  prepareElementCandidateIds?: string[];
  /** When false, cutout failure is non-fatal (reference_image is primary). */
  requireElement?: boolean;
  motionPrimitive: MotionPrimitive;
  isHeroClose?: boolean;
};

export type GenerationQuality = "preview" | "production";

export type ResolveSceneAssets = {
  /** Map assetId → public/fetchable URL (from job media). */
  assetUrls?: Record<string, string>;
};

export type ResolveSceneOptions = ResolveSceneAssets & {
  /** preview → SEEDANCE_PREVIEW_TIER (default 2.5); production → Mini. */
  generationQuality?: GenerationQuality;
  visualDirection?: VisualDirection;
};

function seedanceTierForQuality(
  generationQuality?: GenerationQuality,
): SeedanceTier {
  if (generationQuality === "preview") {
    return resolveSeedancePreviewTier();
  }
  return "mini";
}

const REF_RANK: Record<string, number> = {
  strong: 0,
  usable: 1,
  weak: 2,
};

const VIEW_RANK: Record<string, number> = {
  front: 0,
  side: 1,
  back: 2,
  top: 3,
  in_use: 4,
  detail: 5,
  unknown: 6,
  none: 7,
};

export type PickReferenceOpts = {
  /** Exclude callout/ingredient detail assets for hero/element picks. */
  forRole?: "hero" | "element" | "reference" | "any";
};

function hasHeroOrPackshotRole(img: CreativeBriefImageAsset): boolean {
  return img.possibleAssetRoles.some((r) => {
    const x = r.toLowerCase();
    return x === "hero" || x === "packshot";
  });
}

/**
 * Callout / annotation / ingredient-detail assets — never use as Seedance
 * product reference (hero / element / reference). Environment refs must be packshots.
 */
export function isExcludedHeroElementAsset(
  img: CreativeBriefImageAsset,
): boolean {
  if (hasHeroOrPackshotRole(img)) return false;
  const roles = img.possibleAssetRoles.map((r) => r.toLowerCase());
  const roleHit = roles.some((r) =>
    ["ingredient", "detail", "ugc", "other"].includes(r),
  );
  const veBlob = JSON.stringify(img.visualElements ?? []).toLowerCase();
  const callout =
    /callout|annotation|infographic|labeled/.test(veBlob) ||
    (img.visualElements ?? []).some(
      (el) =>
        /callout|annotation|text/i.test(el.type) ||
        /callout|annotation|labeled|four labeled/i.test(el.description),
    );
  return roleHit && callout;
}

function roleRank(img: CreativeBriefImageAsset): number {
  return hasHeroOrPackshotRole(img) ? 0 : 1;
}

/**
 * Pick best product reference by role → productView → referenceQuality → id.
 * For hero/element/reference: exclude callout/ingredient-detail assets.
 */
export function pickBestReferenceAssetId(
  brief: CreativeBrief,
  preferredIds?: string[],
  opts: PickReferenceOpts = {},
): string | undefined {
  const images = brief.assets.images;
  if (!images.length) return undefined;

  const forRole = opts.forRole ?? "any";
  // Exclude callouts for every product role that feeds Seedance reference_image.
  const excludeCallouts =
    forRole === "hero" ||
    forRole === "element" ||
    forRole === "reference" ||
    forRole === "any";

  const pool =
    preferredIds && preferredIds.length
      ? images.filter((i) => preferredIds.includes(i.assetId))
      : images;
  let candidates = pool.length ? pool : images;

  if (excludeCallouts) {
    const filtered = candidates.filter((i) => !isExcludedHeroElementAsset(i));
    if (filtered.length) {
      candidates = filtered;
    } else {
      // Preferred were all callouts — fall back to brief-wide packshots.
      const global = images.filter((i) => !isExcludedHeroElementAsset(i));
      if (global.length) candidates = global;
    }
  }

  return [...candidates].sort((a, b) => {
    const roleA = roleRank(a);
    const roleB = roleRank(b);
    if (roleA !== roleB) return roleA - roleB;
    const va = VIEW_RANK[a.productView] ?? 9;
    const vb = VIEW_RANK[b.productView] ?? 9;
    if (va !== vb) return va - vb;
    const ra = REF_RANK[a.referenceQuality] ?? 9;
    const rb = REF_RANK[b.referenceQuality] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.assetId.localeCompare(b.assetId);
  })[0]?.assetId;
}

function pickMotionPrimitive(scene: SceneSpec): MotionPrimitive {
  if (scene.isHeroClose) return "light_sweep";
  if (scene.treatment === "composite") {
    if (scene.productRole === "hero") return "scale_in";
    if (scene.productRole === "element") return "float";
    return "fade";
  }
  if (scene.treatment === "animate") return "push_in";
  return "fade";
}

/**
 * Compile Seedance prompt from VisualDirection + shot fields.
 * Hero Close = positive product-in-scene description (Mini ignores negations).
 */
export function compileSeedancePrompt(
  scene: SceneSpec,
  visualDirection?: VisualDirection,
): string {
  const parts: string[] = [];
  if (visualDirection) {
    parts.push(
      `World: ${visualDirection.world}. Palette: ${visualDirection.palette}. Lighting: ${visualDirection.lighting}. Camera energy: ${visualDirection.cameraEnergy}.`,
    );
  }

  if (scene.isHeroClose) {
    parts.push(
      "Hero Close brand hold: from the first frame the exact pouch from the reference is already standing still, large and centered filling the middle of the frame on the wooden table, front label facing camera — no cup, no settle-in animation, no empty stage opening.",
      "Exactly one pouch in frame, no duplicate package, no second bag in background.",
      "The product package is the clear hero subject — match the reference pouch shape, label, and colors faithfully. Static product, only soft light moves, shallow depth of field.",
      "ONE continuous shot only, single unbroken take of one pouch, no cuts, no montage, no jump cuts.",
      "Vertical 9:16, natural camera, no on-screen text, no logo overlay, no rectangular image cards.",
    );
    if (scene.entry) parts.push(`Entry continuity: ${scene.entry}.`);
    if (scene.action?.trim()) parts.push(`Motion: ${scene.action.trim()}.`);
    return parts.join(" ");
  }

  parts.push(`${scene.intent.trim()}. Action: ${scene.action.trim()}.`);
  if (scene.productRole !== "none") {
    parts.push(
      "The exact product from the reference participates naturally in the action.",
      "Exactly one pouch in frame, no duplicate package, no second bag in background.",
    );
  }
  if (scene.entry) parts.push(`Enter from: ${scene.entry}.`);
  if (scene.exit) parts.push(`Exit toward: ${scene.exit}.`);
  parts.push(
    "ONE continuous shot only, single unbroken take, no cuts, no montage, no jump cuts, no second product appearing mid-shot.",
    "Vertical 9:16 ecommerce motion, natural camera, no on-screen text, no logo overlay, no rectangular image cards.",
  );
  return parts.join(" ");
}

/**
 * Resolve a shot → Mini Seedance plan. Image assets are refs only (reference_image).
 */
export function resolveScene(
  scene: SceneSpec,
  brief: CreativeBrief,
  assets: ResolveSceneOptions = {},
): ResolvedScenePlan {
  if (!scene.intent?.trim() || !scene.action?.trim()) {
    throw new Error(`Scene ${scene.id}: intent/action required`);
  }

  const tier = seedanceTierForQuality(assets.generationQuality);

  const prompt = compileSeedancePrompt(
    scene,
    assets.visualDirection,
  );
  const motionPrimitive = pickMotionPrimitive(scene);

  if (scene.isHeroClose) {
    const primary =
      pickBestReferenceAssetId(brief, scene.assetIds, { forRole: "hero" }) ??
      scene.assetIds[0];
    if (!primary) {
      throw new Error(`Scene ${scene.id}: Hero Close requires product asset`);
    }
    const refUrl = assets.assetUrls?.[primary];
    return {
      mode: "seedance",
      tier,
      prompt,
      treatment: "composite",
      productRole: "hero",
      referenceAssetId: primary,
      referenceImageUrl: refUrl,
      referenceRole: referenceRoleForTier(tier, "reference_image"),
      // Seedance already paints the pouch — never stack a cutout (double pouch risk).
      prepareElementAssetId: undefined,
      prepareElementCandidateIds: [],
      requireElement: false,
      motionPrimitive,
      isHeroClose: true,
    };
  }

  if (scene.productRole === "none") {
    return {
      mode: "seedance",
      tier,
      prompt,
      treatment: scene.treatment,
      productRole: scene.productRole,
      motionPrimitive,
    };
  }

  const pickRole =
    scene.productRole === "hero" || scene.productRole === "element"
      ? scene.productRole
      : "reference";
  const referenceAssetId = pickBestReferenceAssetId(brief, scene.assetIds, {
    forRole: pickRole,
  });
  if (scene.productRole === "hero" && !referenceAssetId) {
    throw new Error(
      `Scene ${scene.id}: productRole=hero requires a resolvable product asset`,
    );
  }
  if (!referenceAssetId) {
    throw new Error(
      `Scene ${scene.id}: productRole=${scene.productRole} needs ≥1 product ref`,
    );
  }

  // Product roles: Mini uses reference_image (r2v + 9:16); Pro Fast → first_frame (i2v).
  return {
    mode: "seedance",
    tier,
    prompt,
    treatment: scene.treatment,
    productRole: scene.productRole,
    referenceAssetId,
    referenceImageUrl: assets.assetUrls?.[referenceAssetId],
    referenceRole: referenceRoleForTier(tier, "reference_image"),
    motionPrimitive,
  };
}
