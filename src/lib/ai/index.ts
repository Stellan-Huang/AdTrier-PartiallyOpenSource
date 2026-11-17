export {
  aiRegistry,
  CREATIVE_PROMPT_VERSION,
  EXPAND_SCRIPT_PROMPT_VERSION,
  DEFAULT_AI_MODEL,
  DEFAULT_PROMPT_VERSION,
  getCapability,
  getCapabilitiesByModel,
  getCapabilitiesByProvider,
  getReasoningLevel,
  listCapabilities,
  resolveModel,
  getPromptVersion,
} from "./registry";

export {
  runCapability,
  makeCachedUsage,
  makeFailedUsage,
  makeOverrideRunner,
  defaultProvenanceModel,
  defaultPromptVersion,
} from "./runner";

export {
  hasGeminiApiKey,
  getGeminiApiKey,
  requireGeminiApiKey,
  classifyGeminiError,
} from "./providers/gemini";

export {
  getArkApiKeyForCapability,
  hasArkApiKeyForCapability,
  requireArkApiKeyForCapability,
  getArkLiteModelId,
  getArkProModelId,
  getArkEmbeddingModelId,
  resolveVolcModelId,
  VOLC_LOGICAL_LITE,
  VOLC_LOGICAL_PRO,
  VOLC_DISCOVERED_LITE_ID,
  VOLC_DISCOVERED_PRO_ID,
  VOLC_DISCOVERED_EMBEDDING_ID,
  ARK_BASE_URL,
} from "./providers/volcengine-models";

export { embedTexts, cosineSimilarity } from "./embed";
export type { EmbedTextsResult, EmbedTextsOptions } from "./embed";

export {
  classifyVolcError,
  toArkThinkingParams,
  toArkMessages,
  buildVolcResponseFormat,
  buildVolcChatBody,
  volcengineGenerateStructured,
} from "./providers/volcengine";

export type {
  AiCapabilityId,
  AiContent,
  AiErrorType,
  AiInlineDataPart,
  AiPart,
  AiProvider,
  AiRegistryEntry,
  AiRunner,
  AiTextPart,
  AiThinkingLevel,
  AiUsageRecord,
  CapabilityOverride,
  ExecutionError,
  ExecutionTrace,
  ReasoningLevel,
  RunCapabilityInput,
  RunCapabilityResult,
} from "./types";
