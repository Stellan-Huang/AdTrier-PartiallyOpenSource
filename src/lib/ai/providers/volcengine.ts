/**
 * Volcengine Ark provider adapter — sole place that talks to Ark HTTP APIs.
 * Workflow modules must not import this file or hardcode model IDs.
 */
import type {
  AiCapabilityId,
  AiContent,
  AiErrorType,
  AiPart,
  AiUsageRecord,
  ReasoningLevel,
  RunCapabilityInput,
  RunCapabilityResult,
} from "../types";
import {
  getCapability,
  getPromptVersion,
  resolveModel,
} from "../registry";
import {
  ARK_BASE_URL,
  requireArkApiKeyForCapability,
} from "./volcengine-models";

const DEFAULT_TIMEOUT_MS = 90_000;
/** Creative caps (creative claims pool / medium expand) need a longer wall clock. */
const CREATIVE_TIMEOUT_MS = 180_000;

type ArkChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ArkContentPart[];
};

type ArkContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } };

type ArkChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string; code?: string; type?: string };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function classifyVolcError(err: unknown): {
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
    lower.includes("econnreset") ||
    lower.includes("fetch failed") ||
    lower.includes("502") ||
    lower.includes("high demand")
  ) {
    return { errorType: "provider", errorMessage, retryable: true };
  }
  if (
    lower.includes("non-json") ||
    lower.includes("empty text") ||
    lower.includes("invalidparameter")
  ) {
    return { errorType: "validation", errorMessage, retryable: false };
  }
  return { errorType: "unknown", errorMessage, retryable: false };
}

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
  if (lower.includes("503") || lower.includes("unavailable")) return 8000;
  if (lower.includes("429") || lower.includes("rate") || lower.includes("quota")) {
    return 5000;
  }
  return 400;
}

function partToArk(part: AiPart): ArkContentPart {
  if ("text" in part) {
    return { type: "text", text: part.text };
  }
  const { mimeType, data } = part.inlineData;
  const url = `data:${mimeType};base64,${data}`;
  if (mimeType.startsWith("video/")) {
    return { type: "video_url", video_url: { url } };
  }
  return { type: "image_url", image_url: { url } };
}

/** Exported for unit tests — builds Ark chat messages (incl. multimodal). */
export function toArkMessages(
  contents: AiContent,
  systemInstruction?: string,
): ArkChatMessage[] {
  const messages: ArkChatMessage[] = [];
  if (systemInstruction?.trim()) {
    messages.push({ role: "system", content: systemInstruction.trim() });
  }
  if (typeof contents === "string") {
    messages.push({ role: "user", content: contents });
    return messages;
  }
  for (const block of contents) {
    const role =
      block.role === "assistant" || block.role === "system"
        ? block.role
        : "user";
    const parts = block.parts ?? [];
    const hasMedia = parts.some((p) => "inlineData" in p);
    if (!hasMedia && parts.length === 1 && "text" in parts[0]) {
      messages.push({ role, content: parts[0].text });
    } else if (!hasMedia) {
      messages.push({
        role,
        content: parts
          .map((p) => ("text" in p ? p.text : ""))
          .filter(Boolean)
          .join("\n"),
      });
    } else {
      messages.push({
        role,
        content: parts.map(partToArk),
      });
    }
  }
  return messages;
}

/** Exported for unit tests — Ark response_format from JSON schema. */
export function buildVolcResponseFormat(schema: unknown): Record<string, unknown> {
  if (
    schema &&
    typeof schema === "object" &&
    ("type" in (schema as object) || "properties" in (schema as object))
  ) {
    return {
      type: "json_schema",
      json_schema: {
        name: "capability_response",
        strict: true,
        schema,
      },
    };
  }
  return { type: "json_object" };
}

/**
 * Exported for unit tests — full chat/completions body (no network).
 */
/** Large structured outputs (e.g. compact generateCreative) need headroom. */
export const VOLC_DEFAULT_MAX_TOKENS = 12_288;

export function buildVolcChatBody(params: {
  model: string;
  contents: AiContent;
  systemInstruction?: string;
  responseJsonSchema: unknown;
  reasoningLevel: ReasoningLevel;
  maxTokens?: number;
}): Record<string, unknown> {
  const thinking = toArkThinkingParams(params.reasoningLevel);
  return {
    model: params.model,
    messages: toArkMessages(params.contents, params.systemInstruction),
    temperature: 0.2,
    max_tokens: params.maxTokens ?? VOLC_DEFAULT_MAX_TOKENS,
    ...thinking,
    response_format: buildVolcResponseFormat(params.responseJsonSchema),
  };
}

/**
 * Internal ReasoningLevel → Ark thinking + reasoning_effort.
 * On model rejection of a level, caller may degrade once (adapter-only).
 */
export function toArkThinkingParams(level: ReasoningLevel): {
  thinking: { type: "enabled" };
  reasoning_effort: ReasoningLevel;
} {
  return {
    thinking: { type: "enabled" },
    reasoning_effort: level,
  };
}

const EFFORT_DOWNGRADE: Record<ReasoningLevel, ReasoningLevel | null> = {
  high: "medium",
  medium: "low",
  low: "minimal",
  minimal: null,
};

function isEffortRejected(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("reasoning_effort") ||
    msg.includes("thinking") ||
    (msg.includes("invalidparameter") && msg.includes("effort"))
  );
}

async function callOnce<T>(
  capability: AiCapabilityId,
  params: RunCapabilityInput,
  model: string,
  promptVersion: string,
  reasoningLevel: ReasoningLevel,
  apiKey: string,
  signal: AbortSignal,
): Promise<RunCapabilityResult<T>> {
  const entry = getCapability(capability);
  const started = Date.now();
  const thinking = toArkThinkingParams(reasoningLevel);
  const body = {
    model,
    messages: toArkMessages(params.contents, params.systemInstruction),
    temperature: 0.2,
    max_tokens: VOLC_DEFAULT_MAX_TOKENS,
    ...thinking,
    response_format: buildVolcResponseFormat(params.responseJsonSchema),
  };

  const res = await fetch(`${ARK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  const rawText = await res.text();
  let parsed: ArkChatResponse;
  try {
    parsed = JSON.parse(rawText) as ArkChatResponse;
  } catch {
    throw new Error(
      `Volcengine returned non-JSON HTTP ${res.status}: ${rawText.slice(0, 200)}`,
    );
  }

  if (!res.ok) {
    const msg =
      parsed.error?.message ||
      rawText.slice(0, 400) ||
      `HTTP ${res.status}`;
    throw new Error(
      `Volcengine HTTP ${res.status} (capability=${capability}, model=${model}): ${msg}`,
    );
  }

  const choice = parsed.choices?.[0];
  const text = choice?.message?.content ?? "";
  const finishReason = choice?.finish_reason ?? "unknown";
  if (!text) {
    throw new Error(
      `Volcengine returned empty text for capability "${capability}" (model=${model}, finish_reason=${finishReason})`,
    );
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Volcengine returned non-JSON for capability "${capability}" (finish_reason=${finishReason}): ${text.slice(0, 200)}`,
    );
  }

  const latencyMs = Date.now() - started;
  const usageMeta = parsed.usage;
  const usage: AiUsageRecord = {
    capability,
    provider: entry.provider === "volcengine" ? "volcengine" : "volcengine",
    model,
    promptVersion,
    reasoningLevel,
    status: "ok",
    latencyMs,
    ...(typeof usageMeta?.prompt_tokens === "number"
      ? { inputTokens: usageMeta.prompt_tokens }
      : {}),
    ...(typeof usageMeta?.completion_tokens === "number"
      ? { outputTokens: usageMeta.completion_tokens }
      : {}),
    cached: false,
  };

  return { data, usage };
}

/** Live Volcengine structured generation: timeout + at most 1 retry (+ optional effort downgrade). */
export async function volcengineGenerateStructured<T>(
  capability: AiCapabilityId,
  params: RunCapabilityInput,
  opts: {
    model?: string;
    reasoningLevel?: ReasoningLevel;
    providerForUsage?: "volcengine" | "google";
  } = {},
): Promise<RunCapabilityResult<T>> {
  const entry = getCapability(capability);
  const apiKey = requireArkApiKeyForCapability(capability, entry.model);
  const model = opts.model ?? params.model ?? resolveModel(entry);
  const promptVersion = getPromptVersion(entry);
  const timeoutMs =
    params.timeoutMs ??
    (capability === "generateCreative" ||
    capability === "selectCreative" ||
    capability === "expandScript"
      ? CREATIVE_TIMEOUT_MS
      : DEFAULT_TIMEOUT_MS);
  let reasoningLevel: ReasoningLevel =
    opts.reasoningLevel ??
    params.thinkingLevel ??
    entry.reasoningLevel;

  let lastError: unknown;
  let effortDowngraded = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await callOnce<T>(
        capability,
        params,
        model,
        promptVersion,
        reasoningLevel,
        apiKey,
        controller.signal,
      );
    } catch (err) {
      lastError = err;
      if (!effortDowngraded && isEffortRejected(err)) {
        const next = EFFORT_DOWNGRADE[reasoningLevel];
        if (next) {
          effortDowngraded = true;
          reasoningLevel = next;
          // Retry same attempt slot with degraded effort.
          attempt -= 1;
          continue;
        }
      }
      const classified = classifyVolcError(err);
      if (attempt === 0 && classified.retryable) {
        await sleep(retryDelayMs(err));
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  const classified = classifyVolcError(lastError);
  const wrapped = new Error(
    `Volcengine runCapability failed (capability=${capability}, model=${model}): ${classified.errorMessage}`,
  );
  (wrapped as Error & { aiErrorType?: AiErrorType }).aiErrorType =
    classified.errorType;
  // Attach degraded-effort note for usage records when applicable.
  if (effortDowngraded) {
    (wrapped as Error & { reasoningDegradedTo?: ReasoningLevel }).reasoningDegradedTo =
      reasoningLevel;
  }
  throw wrapped;
}

export function volcCachedUsageRecord(
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

export function volcFailedUsageRecord(
  capability: AiCapabilityId,
  err: unknown,
  latencyMs = 0,
): AiUsageRecord {
  const entry = getCapability(capability);
  const classified = classifyVolcError(err);
  const aiType = (err as { aiErrorType?: AiErrorType } | null)?.aiErrorType;
  const degraded = (err as { reasoningDegradedTo?: ReasoningLevel } | null)
    ?.reasoningDegradedTo;
  return {
    capability,
    provider: entry.provider,
    model: resolveModel(entry),
    promptVersion: getPromptVersion(entry),
    reasoningLevel: degraded ?? entry.reasoningLevel,
    status: "failed",
    latencyMs,
    cached: false,
    errorType: aiType ?? classified.errorType,
    errorMessage: classified.errorMessage,
  };
}
