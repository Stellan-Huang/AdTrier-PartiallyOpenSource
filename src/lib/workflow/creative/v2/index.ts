/**
 * Creative V2 exports.
 * Flow: generateCreative → premiumCreative (optional trim→select) → expandScript.
 */
export { generateCreative } from "./generateCreative";
export { premiumCreative } from "./premiumCreative";
export { trimCreative, hardFilterCreatives, creativeEmbedText } from "./trimCreative";
export { selectCreative, repairSelectedIds } from "./selectCreative";
export { expandScript, countWords, scriptVoWordCount } from "./expandScript";
export type {
  Creative,
  CreativeAngle,
  CreativeCandidate,
  CreativeClaim,
  CreativeFlowResult,
  CreativeTrimMetrics,
  ExpandScriptInput,
  ExpandScriptOutput,
  GenerateCreativeInput,
  GenerateCreativeOutput,
  PremiumCreativeInput,
  PremiumCreativeOutput,
  Script,
  ScriptBeat,
  ScriptBeatVisual,
  ScriptShot,
  ScriptShotProductRole,
  ScriptShotTreatment,
  ScriptVisualSource,
  SelectCreativeInput,
  SelectCreativeOutput,
  TrimCreativeInput,
  TrimCreativeOutput,
} from "./types";
export {
  CREATIVE_ANGLE_MAX,
  CREATIVE_ANGLE_MIN,
  CREATIVE_SEMANTIC_SIMILARITY_THRESHOLD,
  CREATIVE_TOTAL_MAX,
  CREATIVE_TOTAL_MIN,
  CREATIVE_V2_STAGE_VERSION,
  SELECTED_CREATIVE_COUNT,
  TRIM_EMBED_SKIP_MAX,
  VO_WORD_MAX,
  VO_WORD_MIN,
  VO_WORD_SOFT_MAX,
  VO_WORD_SOFT_MIN,
} from "./types";
