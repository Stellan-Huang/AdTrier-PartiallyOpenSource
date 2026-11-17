/**
 * Generation layer — generateAd + helpers (TTS / Seedance / ffmpeg compose).
 * Seedream stub exported but unused on MAP default path.
 */

export type {
  AdSpec,
  GeneratedAd,
  GeneratedAdManifest,
  GeneratedSceneMedia,
  GenerationCallRecord,
  MotionPrimitive,
  RenderBundle,
  SceneSpec,
  ScriptShotProductRole,
  ScriptShotTreatment,
} from "./types";
export { GENERATION_STAGE_VERSION } from "./types";

export {
  generateAd,
  isComposeLevelIssueReason,
  isMediaLevelRegenIssue,
  uniqueMediaRegenIssues,
  softenValidationIssues,
  type GenerateAdOptions,
} from "./generateAd";
export {
  synthesizeVoice,
  scriptFullVoiceover,
  beatTimingWeights,
  apportionBeatDurations,
  detectVoicePauses,
  type VoicePause,
} from "./synthesizeVoice";
export {
  compileAdSpec,
  projectedAdDurationSec,
  voForcesOutsideHardWindow,
  TARGET_DURATION_SEC,
  DURATION_HARD_MIN_SEC,
  DURATION_HARD_MAX_SEC,
  MIN_HERO_CLOSE_SEC,
  VO_MAX_SEC,
  VO_MIN_SEC,
  VO_HARD_MAX_SEC,
} from "./compileAdSpec";
export {
  resolveScene,
  pickBestReferenceAssetId,
  isExcludedHeroElementAsset,
  compileSeedancePrompt,
  type GenerationQuality,
  type ResolvedScenePlan,
  type ResolveSceneAssets,
  type ResolveSceneOptions,
} from "./resolveScene";
export {
  generateSceneMedia,
  generateScenesSeedanceBatch,
  prepareSceneSeedanceJob,
} from "./generateSceneMedia";
export {
  prepareAssetElement,
  cutoutHasTransparentCorners,
  cutoutHasTransparency,
} from "./prepareAssetElement";
export {
  composeAd,
  wrapDrawtextLines,
  planSceneTake,
  subtitleCopyForScene,
  buildComposeCaptionCues,
  buildShotCaptionCues,
  HERO_MOTION_MAX_SEC,
  HERO_LOCKUP_CAPTION_DELAY_SEC,
  type ComposeAdOptions,
  type ComposeWorkspace,
} from "./composeAd";
export { pickBgmTrack, isComposeBgmEnabled } from "./audio/musicLibrary";
export { pickSfxForAction } from "./audio/sfxLibrary";
export {
  writeGenerationSnapshot,
  type GenerationSnapshotName,
} from "./snapshots";
