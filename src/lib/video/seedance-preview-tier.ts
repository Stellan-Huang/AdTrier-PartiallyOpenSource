/**
 * Preview-phase Seedance tier — env-driven (default: Seedance 2.5).
 * Set SEEDANCE_PREVIEW_TIER=mini | pro-fast to roll back Preview video model.
 * Production MAP (generationQuality=production) stays on Mini in resolveScene.
 *
 * Reference modes (via referenceRoleForTier):
 * - mini / 2.5 → reference_image (r2v + 9:16)
 * - pro-fast → first_frame (i2v; Ark rejects r2v on 1.0 Pro Fast)
 */

export type SeedancePreviewTier = "mini" | "pro-fast" | "2.5";

const DEFAULT_PREVIEW_TIER: SeedancePreviewTier = "2.5";

/** Resolve tier for credits Preview / MAP generateAd (generationQuality=preview). */
export function resolveSeedancePreviewTier(): SeedancePreviewTier {
  const raw = (process.env.SEEDANCE_PREVIEW_TIER || "").toLowerCase().trim();
  if (
    raw === "mini" ||
    raw === "2.0-mini" ||
    raw === "2-0-mini" ||
    raw === "seedance-mini"
  ) {
    return "mini";
  }
  if (
    raw === "pro-fast" ||
    raw === "pro_fast" ||
    raw === "1.0-pro-fast" ||
    raw === "seedance-pro-fast"
  ) {
    return "pro-fast";
  }
  if (
    raw === "2.5" ||
    raw === "2-5" ||
    raw === "25" ||
    raw === "seedance-2.5" ||
    raw === "seedance-2-5"
  ) {
    return "2.5";
  }
  if (!raw) return DEFAULT_PREVIEW_TIER;
  return DEFAULT_PREVIEW_TIER;
}

export function seedancePreviewTierEnvVar(
  tier: SeedancePreviewTier = resolveSeedancePreviewTier(),
): "SEEDANCE_2_0_MINI_API" | "SEEDANCE_1_0_PRO_FAST_API" | "SEEDANCE_2_5_API" {
  if (tier === "pro-fast") return "SEEDANCE_1_0_PRO_FAST_API";
  if (tier === "2.5") return "SEEDANCE_2_5_API";
  return "SEEDANCE_2_0_MINI_API";
}

export function seedancePreviewVideoConfigured(): boolean {
  const tier = resolveSeedancePreviewTier();
  if (tier === "pro-fast") {
    return Boolean(process.env.SEEDANCE_1_0_PRO_FAST_API?.trim());
  }
  if (tier === "2.5") {
    return Boolean(process.env.SEEDANCE_2_5_API?.trim());
  }
  return Boolean(process.env.SEEDANCE_2_0_MINI_API?.trim());
}

/** UI / specs strip label for the active preview video model. */
export function previewSeedanceModelLabel(): string {
  const tier = resolveSeedancePreviewTier();
  if (tier === "pro-fast") return "Seedance 1.0 Pro Fast (testing)";
  if (tier === "2.5") return "Seedance 2.5";
  return "Seedance 2.0 Mini";
}
