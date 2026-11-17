/**
 * Helper (not a stage): execute resolveScene plan → scene media URL.
 * Live path: Seedance Mini only. Extract-fail ≠ show original image.
 * Product shots use reference_image; cutout overlay is optional for Hero Close.
 *
 * Batch path (generateAd): prepareSceneSeedanceJob → submit storm → await.
 */

import {
  awaitSeedanceTask,
  generateSeedanceVideo,
  resolveSeedanceSubmit,
  submitSeedanceTask,
  type SeedanceGenerateInput,
  type SeedanceGenerateOptions,
  type SeedanceGenerateResult,
  type SeedanceSubmitResult,
  type SeedanceTier,
} from "@/lib/ai/providers/volcengine-seedance";
import type { CreativeBrief } from "@/lib/workflow/creative/types";
import type { VisualDirection } from "@/lib/workflow/creative/v2/types";
import type { GeneratedSceneMedia, SceneSpec } from "./types";
import {
  prepareAssetElement,
  type PrepareAssetElementInput,
  type PrepareAssetElementResult,
} from "./prepareAssetElement";
import {
  resolveScene,
  type GenerationQuality,
  type ResolveSceneAssets,
} from "./resolveScene";
import { HERO_MOTION_MAX_SEC } from "./composeAd";

export type GenerateSceneMediaOptions = {
  assets?: ResolveSceneAssets;
  generationQuality?: GenerationQuality;
  seedance?: SeedanceGenerateOptions;
  visualDirection?: VisualDirection;
  /** Test injection — bypass ffmpeg cutout. */
  prepareElementFn?: (
    input: PrepareAssetElementInput,
  ) => Promise<PrepareAssetElementResult>;
  /** @deprecated removed — asset layout/crop-fit is not a live scene path */
  layoutAssetFn?: never;
};

/** Prepared Seedance job — ready to POST (no network yet except cutout prep). */
export type PreparedSceneSeedanceJob = {
  scene: SceneSpec;
  tier: SeedanceTier;
  seedanceInput: SeedanceGenerateInput;
  elementUrl?: string;
  elementAssetId?: string;
  referenceAssetId?: string;
  motionPrimitive?: GeneratedSceneMedia["motionPrimitive"];
};

async function tryPrepareCutout(
  assetIds: string[],
  assetUrls: Record<string, string> | undefined,
  requireSuccess: boolean,
  prepareFn?: GenerateSceneMediaOptions["prepareElementFn"],
): Promise<{ elementUrl?: string; assetId?: string }> {
  const errors: string[] = [];
  const runPrepare = prepareFn ?? prepareAssetElement;
  for (const assetId of assetIds) {
    const url = assetUrls?.[assetId];
    if (!url) {
      errors.push(`${assetId}: missing url`);
      continue;
    }
    try {
      const prepared = await runPrepare({ assetId, assetUrl: url });
      return { elementUrl: prepared.elementUrl, assetId };
    } catch (err) {
      errors.push(
        `${assetId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Extract-fail ≠ show original — try next candidate.
    }
  }
  if (requireSuccess) {
    throw new Error(
      `Hero Close product extract failed for all candidates — ${errors.join("; ")}`,
    );
  }
  // Skip product overlay (do not paste original rectangular card).
  return {};
}

export async function prepareSceneSeedanceJob(
  scene: SceneSpec,
  brief: CreativeBrief,
  opts: GenerateSceneMediaOptions = {},
): Promise<PreparedSceneSeedanceJob> {
  const plan = resolveScene(scene, brief, {
    ...opts.assets,
    generationQuality: opts.generationQuality,
    visualDirection: opts.visualDirection,
  });
  // Hero: request short still-pouch clip (~4s); compose freezes last frame for remainder.
  const sceneLen = Math.max(0.5, scene.end - scene.start);
  const durationSec = plan.isHeroClose ? HERO_MOTION_MAX_SEC : sceneLen;

  let elementUrl: string | undefined;
  let elementAssetId: string | undefined;
  if (plan.prepareElementAssetId || plan.prepareElementCandidateIds?.length) {
    const candidates =
      plan.prepareElementCandidateIds?.length
        ? plan.prepareElementCandidateIds
        : plan.prepareElementAssetId
          ? [plan.prepareElementAssetId]
          : [];
    const prepared = await tryPrepareCutout(
      candidates,
      opts.assets?.assetUrls,
      Boolean(plan.requireElement),
      opts.prepareElementFn,
    );
    elementUrl = prepared.elementUrl;
    elementAssetId = prepared.assetId;
  }

  return {
    scene,
    tier: plan.tier,
    seedanceInput: {
      prompt: plan.prompt,
      durationSec,
      aspectRatio: "9:16",
      referenceImageUrl: plan.referenceImageUrl,
      referenceRole: plan.referenceRole ?? "reference_image",
    },
    ...(elementUrl ? { elementUrl } : {}),
    ...(elementAssetId ? { elementAssetId } : {}),
    referenceAssetId: elementAssetId ?? plan.referenceAssetId,
    motionPrimitive: plan.motionPrimitive,
  };
}

export function sceneMediaFromSeedanceResult(
  job: PreparedSceneSeedanceJob,
  result: SeedanceGenerateResult,
  retries = 0,
): GeneratedSceneMedia {
  return {
    sceneId: job.scene.id,
    treatment: job.scene.treatment,
    mediaUrl: result.videoUrl,
    provider: "volcengine-seedance",
    model: result.model,
    latencyMs: result.latencyMs,
    retries,
    fallbackUsed: false,
    referenceAssetId: job.referenceAssetId,
    ...(job.elementUrl ? { elementUrl: job.elementUrl } : {}),
    motionPrimitive: job.motionPrimitive,
  };
}

/**
 * Submit-storm then poll: wall-clock ≈ max(latency), not sum.
 * Returns media in the same order as `jobs`.
 */
export async function generateScenesSeedanceBatch(
  jobs: PreparedSceneSeedanceJob[],
  opts: SeedanceGenerateOptions = {},
): Promise<{
  media: GeneratedSceneMedia[];
  taskIds: string[];
  submitWallMs: number;
  awaitWallMs: number;
  sceneWallMs: number;
}> {
  const batchStarted = Date.now();
  const taskIds: string[] = [];
  const seedanceOpts: SeedanceGenerateOptions = {
    ...opts,
    onSubmitted: async (info) => {
      taskIds.push(info.taskId);
      await Promise.resolve(opts.onSubmitted?.(info));
    },
  };

  // Phase A: POST all tasks before any poll starts waiting on the first.
  // Persist-on-submit must finish inside each POST (awaited onSubmitted) so a
  // mid-batch kill still leaves already-accepted ids in the DB.
  const submitStarted = Date.now();
  const submitted: SeedanceSubmitResult[] = await Promise.all(
    jobs.map((job) =>
      submitSeedanceTask(job.seedanceInput, job.tier, seedanceOpts),
    ),
  );
  const submitWallMs = Date.now() - submitStarted;

  // Phase B: poll all in parallel.
  const awaitStarted = Date.now();
  const results = await Promise.all(
    submitted.map((s) => resolveSeedanceSubmit(s, seedanceOpts)),
  );
  const awaitWallMs = Date.now() - awaitStarted;

  const media = jobs.map((job, i) =>
    sceneMediaFromSeedanceResult(job, results[i]!),
  );
  return {
    media,
    taskIds,
    submitWallMs,
    awaitWallMs,
    sceneWallMs: Date.now() - batchStarted,
  };
}

export async function generateSceneMedia(
  scene: SceneSpec,
  brief: CreativeBrief,
  opts: GenerateSceneMediaOptions = {},
): Promise<GeneratedSceneMedia> {
  const job = await prepareSceneSeedanceJob(scene, brief, opts);
  const result = await generateSeedanceVideo(
    job.seedanceInput,
    job.tier,
    opts.seedance,
  );
  return sceneMediaFromSeedanceResult(job, result);
}

/** One technical retry: resubmit + await (used by generateAd repair path). */
export async function generateSceneMediaWithRetry(
  scene: SceneSpec,
  brief: CreativeBrief,
  opts: GenerateSceneMediaOptions = {},
): Promise<GeneratedSceneMedia> {
  try {
    return await generateSceneMedia(scene, brief, opts);
  } catch (err) {
    try {
      const retried = await generateSceneMedia(scene, brief, opts);
      return { ...retried, retries: 1 };
    } catch {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

// Re-export await helper for tests that inject pending handles.
export { awaitSeedanceTask, submitSeedanceTask };
