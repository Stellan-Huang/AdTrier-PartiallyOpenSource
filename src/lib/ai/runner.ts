import {
  cachedUsageRecord,
  classifyGeminiError,
  failedUsageRecord,
  geminiGenerateStructured,
} from "./providers/gemini";
import {
  classifyVolcError,
  volcCachedUsageRecord,
  volcFailedUsageRecord,
  volcengineGenerateStructured,
} from "./providers/volcengine";
import {
  getCapability,
  getPromptVersion,
  resolveModel,
} from "./registry";
import type {
  AiCapabilityId,
  AiProvider,
  AiRunner,
  AiUsageRecord,
  CapabilityOverride,
  ReasoningLevel,
  RunCapabilityInput,
  RunCapabilityResult,
} from "./types";

function assertStructuredObject(data: unknown, capability: AiCapabilityId): void {
  if (data === null || typeof data !== "object") {
    throw new Error(
      `AI structured output for "${capability}" is not an object`,
    );
  }
}

function effectiveProvider(
  entryProvider: AiProvider,
  override?: CapabilityOverride,
): AiProvider {
  return override?.provider ?? entryProvider;
}

function mergeInput(
  entry: ReturnType<typeof getCapability>,
  input: RunCapabilityInput,
  override?: CapabilityOverride,
): {
  input: RunCapabilityInput;
  model: string;
  reasoningLevel: ReasoningLevel;
} {
  const reasoningLevel: ReasoningLevel =
    override?.reasoningLevel ??
    input.thinkingLevel ??
    entry.reasoningLevel;
  const model =
    override?.model ??
    input.model ??
    resolveModel(entry);
  return {
    input: {
      ...input,
      model,
      thinkingLevel: reasoningLevel,
    },
    model,
    reasoningLevel,
  };
}

/**
 * runCapability: registry → provider → structured validate → usage → normalize errors.
 * No router, no auto-fallback, no multi-provider stubs.
 * Debug overrides (provider/model/reasoningLevel) apply for this call only.
 */
export async function runCapability<T>(
  capability: AiCapabilityId,
  input: RunCapabilityInput,
  opts: { runner?: AiRunner; override?: CapabilityOverride } = {},
): Promise<RunCapabilityResult<T>> {
  if (opts.runner) {
    return opts.runner.runCapability<T>(capability, input);
  }

  const entry = getCapability(capability);
  const provider = effectiveProvider(entry.provider, opts.override);
  const merged = mergeInput(entry, input, opts.override);

  try {
    let result: RunCapabilityResult<T>;
    if (provider === "volcengine") {
      result = await volcengineGenerateStructured<T>(capability, merged.input, {
        model: merged.model,
        reasoningLevel: merged.reasoningLevel,
      });
    } else if (provider === "google") {
      result = await geminiGenerateStructured<T>(capability, merged.input);
    } else {
      throw new Error(
        `Unsupported AI provider "${provider as string}" for ${capability}`,
      );
    }
    assertStructuredObject(result.data, capability);
    // Ensure usage carries reasoningLevel even if adapter omitted it.
    if (!result.usage.reasoningLevel) {
      result.usage = {
        ...result.usage,
        reasoningLevel: merged.reasoningLevel,
      };
    }
    return result;
  } catch (err) {
    const usage =
      provider === "volcengine"
        ? volcFailedUsageRecord(capability, err)
        : failedUsageRecord(capability, err);
    if (opts.override?.model) usage.model = opts.override.model;
    if (opts.override?.reasoningLevel) {
      usage.reasoningLevel = opts.override.reasoningLevel;
    }
    if (opts.override?.provider) usage.provider = opts.override.provider;

    const classified =
      provider === "volcengine"
        ? classifyVolcError(err)
        : classifyGeminiError(err);
    const error = new Error(classified.errorMessage) as Error & {
      usage: AiUsageRecord;
      aiErrorType: typeof classified.errorType;
    };
    error.usage = usage;
    error.aiErrorType = classified.errorType;
    throw error;
  }
}

/** Build a one-shot AiRunner that applies debug overrides without mutating Registry. */
export function makeOverrideRunner(override: CapabilityOverride): AiRunner {
  return {
    runCapability: <T>(capability: AiCapabilityId, input: RunCapabilityInput) =>
      runCapability<T>(capability, input, { override }),
  };
}

export function makeCachedUsage(capability: AiCapabilityId) {
  const entry = getCapability(capability);
  if (entry.provider === "volcengine") {
    return volcCachedUsageRecord(capability);
  }
  return cachedUsageRecord(capability);
}

/** Test helper: build a failed usage without inventing tokens. */
export function makeFailedUsage(capability: AiCapabilityId, err: unknown) {
  const entry = getCapability(capability);
  if (entry.provider === "volcengine") {
    return volcFailedUsageRecord(capability, err);
  }
  return failedUsageRecord(capability, err);
}

export function defaultProvenanceModel(): string {
  const entry = getCapability("understandText");
  return resolveModel(entry);
}

export function defaultPromptVersion(): string {
  const entry = getCapability("understandText");
  return getPromptVersion(entry);
}

export type { AiRunner };
