import type {
  AiCapabilityId,
  AiProvider,
  AiRegistryEntry,
  ReasoningLevel,
} from "./types";
import {
  VOLC_LOGICAL_LITE,
  VOLC_LOGICAL_PRO,
  resolveVolcModelId,
} from "./providers/volcengine-models";

/** Legacy Gemini default — kept for gemini adapter / deprecated re-exports. */
export const DEFAULT_AI_MODEL = "gemini-3.8-flash";

/** Understanding promptVersion bumped for product-vs-bg tighten (cache isolation). */
export const DEFAULT_PROMPT_VERSION = "v3.1";

/** Creative capabilities — do not share UNDERSTANDING_PROMPT_VERSION. */
export const CREATIVE_PROMPT_VERSION = "creative-v2";

/** ExpandScript dramaturgy + VD/AD + entry/exit V3.4 — version-gates expand cache only. */
export const EXPAND_SCRIPT_PROMPT_VERSION = "creative-expand-v3.4";

/**
 * Single source of truth for current capabilities.
 * No router / fallback chain — each capability maps to one provider+model+reasoning.
 * Understanding + generateCreative → Lite; select/expand/validateAd → Pro.
 */
export const aiRegistry: Record<AiCapabilityId, AiRegistryEntry> = {
  understandText: {
    capability: "understandText",
    provider: "volcengine",
    model: VOLC_LOGICAL_LITE,
    reasoningLevel: "minimal",
    promptVersion: DEFAULT_PROMPT_VERSION,
  },
  understandImages: {
    capability: "understandImages",
    provider: "volcengine",
    model: VOLC_LOGICAL_LITE,
    reasoningLevel: "minimal",
    promptVersion: DEFAULT_PROMPT_VERSION,
  },
  understandVideo: {
    capability: "understandVideo",
    provider: "volcengine",
    model: VOLC_LOGICAL_LITE,
    reasoningLevel: "minimal",
    promptVersion: DEFAULT_PROMPT_VERSION,
  },
  generateCreative: {
    capability: "generateCreative",
    provider: "volcengine",
    model: VOLC_LOGICAL_LITE,
    reasoningLevel: "minimal",
    promptVersion: CREATIVE_PROMPT_VERSION,
  },
  selectCreative: {
    capability: "selectCreative",
    provider: "volcengine",
    model: VOLC_LOGICAL_PRO,
    reasoningLevel: "high",
    promptVersion: CREATIVE_PROMPT_VERSION,
  },
  expandScript: {
    capability: "expandScript",
    provider: "volcengine",
    model: VOLC_LOGICAL_PRO,
    reasoningLevel: "medium",
    promptVersion: EXPAND_SCRIPT_PROMPT_VERSION,
  },
  validateAd: {
    capability: "validateAd",
    provider: "volcengine",
    model: VOLC_LOGICAL_PRO,
    reasoningLevel: "high",
    promptVersion: "validate-ad-v1",
  },
};

export function getCapability(
  capability: AiCapabilityId,
): AiRegistryEntry {
  const entry = aiRegistry[capability];
  if (!entry) {
    throw new Error(`Unknown AI capability: ${capability}`);
  }
  return entry;
}

/**
 * Resolve logical Registry model → concrete provider model id.
 * Gemini: GEMINI_MODEL may override google entries only.
 * Volcengine: ARK_MODEL_LITE / ARK_MODEL_PRO via resolveVolcModelId — never GEMINI_MODEL.
 */
export function resolveModel(entry: AiRegistryEntry): string {
  if (entry.provider === "volcengine") {
    return resolveVolcModelId(entry.model);
  }
  const fromEnv = process.env.GEMINI_MODEL?.trim();
  return fromEnv || entry.model;
}

const REASONING_LEVELS = new Set<ReasoningLevel>([
  "minimal",
  "low",
  "medium",
  "high",
]);

/**
 * Resolve reasoning for a capability.
 * EXPAND_SCRIPT_REASONING=high (etc.) overrides expandScript only — for eval.
 */
export function getReasoningLevel(entry: AiRegistryEntry): ReasoningLevel {
  if (entry.capability === "expandScript") {
    const fromEnv = process.env.EXPAND_SCRIPT_REASONING?.trim() as
      | ReasoningLevel
      | undefined;
    if (fromEnv && REASONING_LEVELS.has(fromEnv)) return fromEnv;
  }
  return entry.reasoningLevel;
}

const CREATIVE_CAPABILITIES = new Set<AiCapabilityId>([
  "generateCreative",
  "selectCreative",
  "expandScript",
]);

/**
 * Resolve prompt version for a capability.
 * Creative caps use registry creative-v2 (or CREATIVE_PROMPT_VERSION env).
 * Understanding caps may override via UNDERSTANDING_PROMPT_VERSION.
 * Never apply UNDERSTANDING_PROMPT_VERSION to creative capabilities.
 */
export function getPromptVersion(entry: AiRegistryEntry): string {
  if (CREATIVE_CAPABILITIES.has(entry.capability)) {
    const creativeEnv = process.env.CREATIVE_PROMPT_VERSION?.trim();
    return creativeEnv || entry.promptVersion;
  }
  const fromEnv = process.env.UNDERSTANDING_PROMPT_VERSION?.trim();
  return fromEnv || entry.promptVersion;
}

export function listCapabilities(): AiCapabilityId[] {
  return Object.keys(aiRegistry) as AiCapabilityId[];
}

/** Reverse lookup — capabilities that resolve to this model (after env). */
export function getCapabilitiesByModel(model: string): AiCapabilityId[] {
  return listCapabilities().filter((id) => {
    const entry = getCapability(id);
    return resolveModel(entry) === model || entry.model === model;
  });
}

/** Reverse lookup — capabilities registered for this provider. */
export function getCapabilitiesByProvider(
  provider: AiProvider,
): AiCapabilityId[] {
  return listCapabilities().filter(
    (id) => getCapability(id).provider === provider,
  );
}
