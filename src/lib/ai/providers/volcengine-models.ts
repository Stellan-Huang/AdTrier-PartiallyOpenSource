/**
 * Volcengine Ark model config — sole place holding real Lite/Pro Model IDs.
 * Workflow / Registry use logical names only; never hardcode suffixes elsewhere.
 *
 * IDs discovered via GET /api/v3/models + live chat/completions probe (2026-09-29):
 *   Lite: doubao-seed-2-1-lite-260915
 *   Pro:  doubao-seed-2-1-pro-260915
 * Turbo must NEVER substitute for Lite.
 */

export const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

/** Logical model ids used in Registry (stable product names). */
export const VOLC_LOGICAL_LITE = "doubao-seed-2.1-lite";
export const VOLC_LOGICAL_PRO = "doubao-seed-2.1-pro";

/**
 * Discovered working chat Model IDs from the project model list.
 * Override with ARK_MODEL_LITE / ARK_MODEL_PRO (full Model or Endpoint ID).
 */
export const VOLC_DISCOVERED_LITE_ID = "doubao-seed-2-1-lite-260915";
export const VOLC_DISCOVERED_PRO_ID = "doubao-seed-2-1-pro-260915";

/**
 * Multimodal embedding Model ID for DOUBAO_EMBEDDING_VISION_API
 * (POST /embeddings/multimodal). Override with ARK_EMBEDDING_MODEL.
 */
export const VOLC_DISCOVERED_EMBEDDING_ID = "doubao-embedding-vision-251215";

export function getArkLiteModelId(): string {
  return process.env.ARK_MODEL_LITE?.trim() || VOLC_DISCOVERED_LITE_ID;
}

export function getArkProModelId(): string {
  return process.env.ARK_MODEL_PRO?.trim() || VOLC_DISCOVERED_PRO_ID;
}

export function getArkEmbeddingModelId(): string {
  return process.env.ARK_EMBEDDING_MODEL?.trim() || VOLC_DISCOVERED_EMBEDDING_ID;
}

/** Map Registry logical model → real Ark Model/Endpoint ID. */
export function resolveVolcModelId(logicalModel: string): string {
  const m = logicalModel.trim();
  if (m === VOLC_LOGICAL_LITE) return getArkLiteModelId();
  if (m === VOLC_LOGICAL_PRO) return getArkProModelId();
  // Concrete Model/Endpoint ID already (env / debug override / discovered form).
  return m;
}

export function isVolcLiteModel(logicalModel: string): boolean {
  const m = logicalModel.trim().toLowerCase();
  return m === VOLC_LOGICAL_LITE || m.includes("lite");
}

export function isVolcProModel(logicalModel: string): boolean {
  const m = logicalModel.trim().toLowerCase();
  if (isVolcLiteModel(logicalModel)) return false;
  return m === VOLC_LOGICAL_PRO || m.includes("pro");
}

/**
 * API key by model family: SEED_2_1_LITE_API / SEED_2_1_PRO_API first,
 * then optional AI_<capability> / ARK_API_KEY fallbacks.
 * Pro caps fall back to Lite key when SEED_2_1_PRO_API is unset (same Ark
 * project key often authorizes both model families).
 * Never log or return the secret value.
 *
 * @param logicalModel Registry logical model (defaults to Lite — all current caps).
 */
export function getArkApiKeyForCapability(
  capability: string,
  logicalModel: string = VOLC_LOGICAL_LITE,
): string | undefined {
  if (isVolcLiteModel(logicalModel)) {
    const lite = process.env.SEED_2_1_LITE_API?.trim();
    if (lite) return lite;
  } else if (isVolcProModel(logicalModel)) {
    const pro = process.env.SEED_2_1_PRO_API?.trim();
    if (pro) return pro;
    // Ops often set only Lite — still attempt Pro model with Lite credential.
    const lite = process.env.SEED_2_1_LITE_API?.trim();
    if (lite) return lite;
  } else {
    // Concrete / unknown id — prefer Lite, then Pro.
    const lite = process.env.SEED_2_1_LITE_API?.trim();
    if (lite) return lite;
    const pro = process.env.SEED_2_1_PRO_API?.trim();
    if (pro) return pro;
  }

  const perCap = process.env[`AI_${capability}`]?.trim();
  if (perCap) return perCap;
  const shared = process.env.ARK_API_KEY?.trim();
  return shared || undefined;
}

export function hasArkApiKeyForCapability(
  capability: string,
  logicalModel: string = VOLC_LOGICAL_LITE,
): boolean {
  return Boolean(getArkApiKeyForCapability(capability, logicalModel));
}

export function requireArkApiKeyForCapability(
  capability: string,
  logicalModel: string = VOLC_LOGICAL_LITE,
): string {
  const key = getArkApiKeyForCapability(capability, logicalModel);
  if (!key) {
    const familyHint = isVolcProModel(logicalModel)
      ? "SEED_2_1_PRO_API"
      : "SEED_2_1_LITE_API";
    throw new Error(
      `Missing Ark API key for "${capability}". ` +
        `Set ${familyHint} (preferred), or AI_${capability} / ARK_API_KEY fallback.`,
    );
  }
  return key;
}
