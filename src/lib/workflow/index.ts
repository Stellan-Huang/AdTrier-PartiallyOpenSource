/**
 * Public engine facade.
 *
 * SaaS persistence, billing, authentication, upload routes, and app debug
 * endpoints are not part of this package.
 */
export type {
  StageExecution,
  StageProvenance,
  StageResult,
  StageStatus,
} from "./types";
export {
  emptyStageExecution,
  makeStageProvenance,
  newRunId,
  stableInputHash,
} from "./types";

export {
  normalizeProductStageInput,
  buildProductUnderstanding,
  runProductIntelligence,
} from "./product-intelligence";
export type {
  BuildProductUnderstandingOptions,
  ProductUnderstanding,
} from "./product-intelligence";

export {
  createCreativeFlow,
  createCreativePlan,
  buildCreativeBrief,
  generateCreative,
  premiumCreative,
  selectCreative,
  trimCreative,
  expandScript,
} from "./creative";
export type {
  CreativeBrief,
  CreativeFlowResult,
  Script,
} from "./creative";

export {
  generateAd,
  compileAdSpec,
  composeAd,
  GENERATION_STAGE_VERSION,
} from "./generation";
export type {
  GeneratedAd,
  SceneSpec as GenerationSceneSpec,
  AdSpec as GenerationAdSpec,
} from "./generation";

export { validateAd } from "./qa-delivery";
export type {
  QAResult,
  ValidationIssue,
  ValidationResult,
} from "./qa-delivery";
