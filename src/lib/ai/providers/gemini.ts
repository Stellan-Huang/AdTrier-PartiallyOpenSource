/**
 * Gemini provider adapter — sole place that imports @google/genai.
 * Workflow / understanding modules must not call this SDK directly.
 */
import {
  GoogleGenAI,
  ThinkingLevel,
  type ContentListUnion,
  type ThinkingConfig,
} from "@google/genai";
import type {
  AiCapabilityId,
  AiContent,
  AiErrorType,
  AiThinkingLevel,
  AiUsageRecord,
  RunCapabilityInput,
  RunCapabilityResult,
} from "../types";
import {
  getCapability,
  getPromptVersion,
  resolveModel,
} from "../registry";

const DEFAULT_TIMEOUT_MS = 90_000;

/** Map ReasoningLevel → Gemini ThinkingConfig (level only; not budget). */
function toThinkingConfig(level?: AiThinkingLevel): ThinkingConfig | undefined {
  if (!level) return undefined;
  // Gemini SDK historically exposes HIGH / MEDIUM; map minimal/low → MEDIUM.
  if (level === "high") {
    return { thinkingLevel: ThinkingLevel.HIGH };
  }
  return { thinkingLevel: ThinkingLevel.MEDIUM };
}

export function getGeminiApiKey(): string | undefined {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key || undefined;
}

export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey());
}

export function requireGeminiApiKey(): string {
  const key = getGeminiApiKey();
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Live Gemini calls require an API key.",
    );
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function classifyGeminiError(err: unknown): {
  errorType: AiErrorType;
  errorMessage: string;
  retryable: boolean;
} {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const lower = errorMessage.toLowerCase();

  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("quota") ||
    lower.includes("resource_exhausted")
  ) {
    return { errorType: "quota", errorMessage, retryable: true };
  }
  if (
    lower.includes("timeout") ||
    lower.includes("aborted") ||
    lower.includes("etimedout")
  ) {
    return { errorType: "timeout", errorMessage, retryable: true };
  }
  if (
    lower.includes("503") ||
    lower.includes("unavailable") ||
    lower.includes("high demand") ||
    lower.includes("econnreset") ||
    lower.includes("fetch failed")
  ) {
    return { errorType: "provider", errorMessage, retryable: true };
  }
  if (lower.includes("non-json") || lower.includes("empty text")) {
    return { errorType: "validation", errorMessage, retryable: false };
  }
  return { errorType: "unknown", errorMessage, retryable: false };
}

/** Honor Gemini RetryInfo when present; cap at 65s for the single allowed retry. */
function retryDelayMs(err: unknown): number {
  if (!(err instanceof Error)) return 400;
  const msg = err.message;
  const lower = msg.toLowerCase();
  const retryIn = msg.match(/retry in\s+([0-9.]+)\s*s/i);
  if (retryIn) {
    const sec = Number(retryIn[1]);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(Math.ceil(sec * 1000) + 250, 65_000);
    }
  }
  const retryDelayField = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (retryDelayField) {
    const sec = Number(retryDelayField[1]);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(sec * 1000 + 250, 65_000);
    }
  }
  if (
    lower.includes("503") ||
    lower.includes("unavailable") ||
    lower.includes("high demand")
  ) {
    return 8000;
  }
  if (
    lower.includes("429") ||
    lower.includes("rate") ||
    lower.includes("quota")
  ) {
    return 5000;
  }
  return 400;
}

function toContentListUnion(contents: AiContent): ContentListUnion {
  return contents as ContentListUnion;
}

async function callOnce<T>(
  capability: AiCapabilityId,
  params: RunCapabilityInput,
  model: string,
  promptVersion: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<RunCapabilityResult<T>> {
  const ai = new GoogleGenAI({ apiKey });
  const started = Date.now();
  const entry = getCapability(capability);

  const thinkingConfig = toThinkingConfig(params.thinkingLevel);

  const response = await ai.models.generateContent({
    model,
    contents: toContentListUnion(params.contents),
    config: {
      abortSignal: signal,
      systemInstruction: params.systemInstruction,
      responseMimeType: "application/json",
      responseJsonSchema: params.responseJsonSchema,
      temperature: 0.2,
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  });

  const latencyMs = Date.now() - started;
  const text = response.text;
  if (!text) {
    throw new Error(
      `Gemini returned empty text for capability "${capability}" (model=${model})`,
    );
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Gemini returned non-JSON for capability "${capability}": ${text.slice(0, 200)}`,
    );
  }

  const usageMeta = response.usageMetadata;
  const usage: AiUsageRecord = {
    capability,
    provider: entry.provider,
    model,
    promptVersion,
    reasoningLevel: params.thinkingLevel ?? entry.reasoningLevel,
    status: "ok",
    latencyMs,
    inputTokens: usageMeta?.promptTokenCount,
    outputTokens: usageMeta?.candidatesTokenCount,
    cached: false,
  };

  return { data, usage };
}

/** Live Gemini structured generation: timeout + at most 1 retry. */
export async function geminiGenerateStructured<T>(
  capability: AiCapabilityId,
  params: RunCapabilityInput,
): Promise<RunCapabilityResult<T>> {
  const entry = getCapability(capability);
  const apiKey = requireGeminiApiKey();
  const model = params.model ?? resolveModel(entry);
  const promptVersion = getPromptVersion(entry);
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await callOnce<T>(
        capability,
        params,
        model,
        promptVersion,
        apiKey,
        controller.signal,
      );
    } catch (err) {
      lastError = err;
      const classified = classifyGeminiError(err);
      if (attempt === 0 && classified.retryable) {
        await sleep(retryDelayMs(err));
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  const classified = classifyGeminiError(lastError);
  const wrapped = new Error(
    `Gemini runCapability failed (capability=${capability}, model=${model}): ${classified.errorMessage}`,
  );
  (wrapped as Error & { aiErrorType?: AiErrorType }).aiErrorType =
    classified.errorType;
  throw wrapped;
}

export function cachedUsageRecord(
  capability: AiCapabilityId,
  latencyMs = 0,
): AiUsageRecord {
  const entry = getCapability(capability);
  return {
    capability,
    provider: entry.provider,
    model: resolveModel(entry),
    promptVersion: getPromptVersion(entry),
    reasoningLevel: entry.reasoningLevel,
    status: "cached",
    latencyMs,
    inputTokens: 0,
    outputTokens: 0,
    cached: true,
  };
}

export function failedUsageRecord(
  capability: AiCapabilityId,
  err: unknown,
  latencyMs = 0,
): AiUsageRecord {
  const entry = getCapability(capability);
  const classified = classifyGeminiError(err);
  const aiType = (err as { aiErrorType?: AiErrorType } | null)?.aiErrorType;
  return {
    capability,
    provider: entry.provider,
    model: resolveModel(entry),
    promptVersion: getPromptVersion(entry),
    reasoningLevel: entry.reasoningLevel,
    status: "failed",
    latencyMs,
    cached: false,
    errorType: aiType ?? classified.errorType,
    errorMessage: classified.errorMessage,
  };
}
