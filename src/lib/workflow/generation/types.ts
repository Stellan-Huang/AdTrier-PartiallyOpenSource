/**
 * Generation-layer types — SceneSpec / AdSpec owned here (single definition).
 */

import type {
  AudioDirection,
  ScriptShotProductRole,
  ScriptShotTreatment,
  VisualDirection,
} from "@/lib/workflow/creative/v2/types";
import type { ValidationResult } from "@/lib/workflow/qa-delivery/types";

export type { ScriptShotProductRole, ScriptShotTreatment };

/** Timed scene compiled from a Script shot (pure code timeline). */
export type SceneSpec = {
  id: string;
  start: number;
  end: number;
  beatIndex: number;
  shotIndex: number;
  intent: string;
  action: string;
  treatment: ScriptShotTreatment;
  productRole: ScriptShotProductRole;
  assetIds: string[];
  voiceover?: string;
  text?: string;
  factIds?: string[];
  entry?: string;
  exit?: string;
  /** Compile-time Hero Close lockup — Mini env-only + real product pixels. */
  isHeroClose?: boolean;
  /** @deprecated derived for QA compat — true when productRole !== none */
  productRequired?: boolean;
};

export type AdSpec = {
  id: string;
  creativeId: string;
  scenes: SceneSpec[];
  visualDirection?: VisualDirection;
  audioDirection?: AudioDirection;
};

export type MotionPrimitive =
  | "scale_in"
  | "push_in"
  | "float"
  | "fade"
  | "light_sweep";

export type GeneratedSceneMedia = {
  sceneId: string;
  treatment: ScriptShotTreatment;
  mediaUrl: string;
  provider: string;
  model: string;
  latencyMs: number;
  retries: number;
  fallbackUsed: boolean;
  referenceAssetId?: string;
  /**
   * Isolated product cutout for Hero Close / element overlay.
   * Never a rectangular ecommerce frame; extract-fail ⇒ omit (do not paste original).
   */
  elementUrl?: string;
  motionPrimitive?: MotionPrimitive;
};

export type GenerationCallRecord = {
  capability: string;
  provider: string;
  model: string;
  promptVersion: string;
  status: "ok" | "failed" | "cached";
  latencyMs: number;
  cached: boolean;
  sceneId?: string;
  sceneTreatment?: ScriptShotTreatment;
  retries?: number;
  fallbackUsed?: boolean;
  qaFailReason?: string;
  errorType?: string;
  errorMessage?: string;
};

/** Parallel / wall-clock evidence (fix5). */
export type GenerationTimingMetrics = {
  seedanceSubmitWallMs: number;
  seedanceAwaitWallMs: number;
  seedanceSceneWallMs: number;
  seedanceTaskIds: string[];
  sceneLatencySumMs: number;
  sceneLatencyMaxMs: number;
  /** sceneWall / sum — nearer 1/n (or max/sum) ⇒ better parallel; ≈1 ⇒ serial. */
  wallVsSum: number;
  /** max / sceneWall — nearer 1 ⇒ wall dominated by slowest scene (good). */
  parallelEfficiency: number;
};

export type GeneratedAdManifest = {
  version: 1;
  scriptId: string;
  voiceoverDurationSec: number;
  composed: boolean;
  calls: GenerationCallRecord[];
  qa?: ValidationResult;
  timing?: GenerationTimingMetrics;
};

export type GeneratedAd = {
  id: string;
  creativeId: string;
  scriptId: string;
  adSpec: AdSpec;
  voiceoverUrl: string;
  voiceoverDurationSec: number;
  /** Beat timing shares (not per-beat TTS files on whole-script path). */
  beatVoiceovers?: Array<{
    beatIndex: number;
    text: string;
    audioUrl: string;
    durationSec: number;
  }>;
  scenes: GeneratedSceneMedia[];
  composedUrl?: string;
  /**
   * Local paths to per-scene normalized clips from compose (pre-concat).
   * Used to persist watermarked + clean shot panels after Preview render.
   */
  shotLocalPaths?: string[];
  /** True when compose mixed a BGM library track into the bed. */
  bgmUsed?: boolean;
  manifest: GeneratedAdManifest;
  validation?: ValidationResult;
};

/** @deprecated placeholder — prefer GeneratedAd */
export type RenderBundle = {
  version: 1;
  jobId: string;
};

export const GENERATION_STAGE_VERSION = "generation@3";
