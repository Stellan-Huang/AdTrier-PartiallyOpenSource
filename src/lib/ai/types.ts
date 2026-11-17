/** Lightweight AI capability types — Volcengine default; Gemini retained. */

export type AiProvider = "volcengine" | "google";

export type AiCapabilityId =
  | "understandText"
  | "understandImages"
  | "understandVideo"
  | "generateCreative"
  | "selectCreative"
  | "expandScript"
  | "validateAd";

/**
 * Internal reasoning intensity. Registry is the source of truth for production.
 * Volcengine maps → thinking.enabled + reasoning_effort; Gemini maps → thinkingConfig.
 */
export type ReasoningLevel = "minimal" | "low" | "medium" | "high";

/** @deprecated Prefer ReasoningLevel — kept as alias for call sites / Gemini adapter. */
export type AiThinkingLevel = ReasoningLevel;

export type AiRegistryEntry = {
  capability: AiCapabilityId;
  provider: AiProvider;
  /**
   * Logical model id (e.g. doubao-seed-2.1-lite).
   * resolveModel() maps to the real Ark Model/Endpoint ID.
   */
  model: string;
  reasoningLevel: ReasoningLevel;
  promptVersion: string;
};

export type AiErrorType =
  | "quota"
  | "timeout"
  | "provider"
  | "validation"
  | "unknown";

export type AiUsageRecord = {
  capability: AiCapabilityId;
  provider: AiProvider;
  model: string;
  promptVersion: string;
  reasoningLevel?: ReasoningLevel;
  status: "ok" | "failed" | "cached";
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  cached: boolean;
  errorType?: AiErrorType;
  errorMessage?: string;
};

export type AiTextPart = { text: string };
export type AiInlineDataPart = {
  inlineData: { mimeType: string; data: string };
};
export type AiPart = AiTextPart | AiInlineDataPart;
export type AiContent =
  | string
  | Array<{ role: string; parts: AiPart[] }>;

export type RunCapabilityInput = {
  responseJsonSchema: unknown;
  systemInstruction?: string;
  contents: AiContent;
  timeoutMs?: number;
  /** Optional model override (tests / debug). Does not mutate Registry. */
  model?: string;
  /**
   * Optional reasoning override (tests / debug).
   * Production callers omit this — Registry reasoningLevel is used.
   */
  thinkingLevel?: ReasoningLevel;
};

/** Temporary debug override — never written into Registry files. */
export type CapabilityOverride = {
  provider?: AiProvider;
  model?: string;
  reasoningLevel?: ReasoningLevel;
};

export type RunCapabilityResult<T> = {
  data: T;
  usage: AiUsageRecord;
};

export type AiRunner = {
  runCapability: <T>(
    capability: AiCapabilityId,
    input: RunCapabilityInput,
  ) => Promise<RunCapabilityResult<T>>;
};

export type ExecutionError = {
  capability: AiCapabilityId;
  errorType: AiErrorType;
  errorMessage: string;
};

export type ExecutionTrace = {
  calls: AiUsageRecord[];
  errors: ExecutionError[];
};
