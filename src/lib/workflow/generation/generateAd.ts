/**
 * generateAd — StageResult entry for Generation MAP.
 * Helpers (not stages): synthesizeVoice (whole-script), compileAdSpec (+Hero Close),
 * resolveScene, generateSceneMedia (Mini-only), composeAd. Optional validateAd.
 * No fallback_asset / rectangular image-card path.
 *
 * Speed (fix5): prepare scenes → Seedance submit-storm (all POSTs) → parallel poll
 * so wall-clock ≈ max(scene); Hero window QA retries re-encode Hero ss only.
 */

import type { AiRunner } from "@/lib/ai";
import { mapPool } from "@/lib/ai/pool";
import type { CreativeBrief } from "@/lib/workflow/creative/types";
import type { Script } from "@/lib/workflow/creative/v2/types";
import {
  emptyStageExecution,
  makeStageProvenance,
  newRunId,
  stableInputHash,
  type StageResult,
} from "@/lib/workflow/types";
import {
  validateAd,
  type ValidateAdOptions,
} from "@/lib/workflow/qa-delivery/validateAd";
import type { TtsSynthesizeOptions } from "@/lib/ai/providers/volcengine-tts";
import type { SeedanceGenerateOptions } from "@/lib/ai/providers/volcengine-seedance";
import {
  compileAdSpec,
  DURATION_HARD_MAX_SEC,
  DURATION_HARD_MIN_SEC,
  projectedAdDurationSec,
  VO_HARD_MAX_SEC,
  VO_MAX_SEC,
  VO_MIN_SEC,
  voForcesOutsideHardWindow,
} from "./compileAdSpec";
import { composeAd, type ComposeAdOptions } from "./composeAd";
import {
  generateSceneMedia,
  generateScenesSeedanceBatch,
  prepareSceneSeedanceJob,
  type GenerateSceneMediaOptions,
  type PreparedSceneSeedanceJob,
} from "./generateSceneMedia";
import { synthesizeVoice } from "./synthesizeVoice";
import { writeGenerationSnapshot } from "./snapshots";
import {
  GENERATION_STAGE_VERSION,
  type GeneratedAd,
  type GeneratedSceneMedia,
  type GenerationCallRecord,
  type SceneSpec,
} from "./types";
import type {
  GenerationQuality,
  ResolveSceneAssets,
} from "./resolveScene";
import { scriptVoWordCount } from "@/lib/workflow/creative/v2/expandScript";

export type GenerateAdOptions = {
  runId?: string;
  inputHash?: string;
  jobId?: string;
  skipSnapshots?: boolean;
  /**
   * preview → 720p compose; production → 1080 compose.
   * AI video is Mini-only regardless of quality.
   */
  generationQuality?: GenerationQuality;
  /** Run validateAd + one-shot scene repair after compose. */
  validate?: boolean;
  runner?: AiRunner;
  tts?: TtsSynthesizeOptions;
  seedance?: SeedanceGenerateOptions;
  compose?: ComposeAdOptions;
  sceneMedia?: Omit<
    GenerateSceneMediaOptions,
    "seedance" | "assets" | "generationQuality" | "visualDirection"
  >;
  assets?: ResolveSceneAssets;
  validateOpts?: ValidateAdOptions;
  /** Scene fan-out concurrency (default 4). */
  sceneConcurrency?: number;
  /**
   * S2: reuse already-successful scene media (skip Mini for those sceneIds).
   */
  existingScenes?: GeneratedSceneMedia[];
  /**
   * When VO overruns or underruns preferred budget, rewrite script once.
   * Must not burn Seedance; return null to fail closed.
   */
  reExpandOnVoOverrun?: (args: {
    script: Script;
    voiceDurationSec: number;
    maxVoWords: number;
    minVoWords?: number;
    reason: "overrun" | "underrun";
  }) => Promise<Script | null>;
};

const SCENE_CONCURRENCY = 4;
/** Allow one speech-rate bump when overrun ≤ 12%. */
const VO_RATE_RETRY_OVER_RATIO = 0.12;
const VO_SPEECH_RATE_BUMP = 15;
/** Slight slowdown on underrun re-TTS (OpenSpeech int32 relative). */
const VO_SPEECH_RATE_SLOW = -12;

function toExecCall(c: GenerationCallRecord) {
  return {
    capability: c.capability,
    provider: c.provider,
    model: c.model,
    promptVersion: c.promptVersion,
    status: c.status,
    latencyMs: c.latencyMs,
    cached: c.cached,
    errorType: c.errorType,
    errorMessage: c.errorMessage,
  };
}

function qualityOf(opts: GenerateAdOptions): GenerationQuality {
  return opts.generationQuality ?? "production";
}

/** Compose / audio / global issues must not burn another Seedance call. */
export function isComposeLevelIssueReason(reason: string): boolean {
  return /duration|14\.|17\.|14–17|14-17|14\.5|16s|too short|too long|timeline|requested 15s|loudnorm|lufs|audio volume|silence|letterbox|black bar|composed duration|mux|ffmpeg|missing composed|missing voiceover/i.test(
    reason,
  );
}

/**
 * Only media-level hard issues (has sceneId, not compose/audio) may retry Mini.
 */
export function isMediaLevelRegenIssue(issue: {
  severity: string;
  action: string;
  sceneId?: string;
  reason: string;
}): boolean {
  if (issue.severity !== "hard" || issue.action !== "regenerate") return false;
  if (!issue.sceneId) return false;
  if (isComposeLevelIssueReason(issue.reason)) return false;
  return true;
}

function isHeroNoProductIssue(issue: {
  sceneId?: string;
  reason: string;
}): boolean {
  return /no product visible in hero|hero close.*no product|product not visible.*hero/i.test(
    issue.reason,
  );
}

/** One Mini retry per sceneId even if multiple hard issues name it. */
export function uniqueMediaRegenIssues<
  T extends {
    sceneId?: string;
    severity: string;
    action: string;
    reason: string;
  },
>(issues: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const issue of issues) {
    if (!isMediaLevelRegenIssue(issue) || !issue.sceneId) continue;
    if (seen.has(issue.sceneId)) continue;
    seen.add(issue.sceneId);
    out.push(issue);
  }
  return out;
}

/** Soften AI aesthetic only — never soften deterministic duration hard fails. */
export function softenValidationIssues(
  issues: Array<{
    severity: string;
    action: string;
    sceneId?: string;
    reason: string;
  }>,
): typeof issues {
  return issues.map((i) => {
    if (i.severity === "soft") return { ...i, action: "accept" };
    if (i.action === "fallback_asset") {
      return { ...i, action: "regenerate" };
    }
    // Deterministic duration / compose band stays hard (14–17 gate).
    if (isComposeLevelIssueReason(i.reason) && !i.sceneId) {
      return i;
    }
    return i;
  });
}

async function tryRegenerateScene(
  scene: SceneSpec,
  brief: CreativeBrief,
  opts: GenerateAdOptions,
  prior: GeneratedSceneMedia,
  visualDirection?: Script["visualDirection"],
): Promise<{ ok: boolean; media: GeneratedSceneMedia }> {
  try {
    const next = await generateSceneMedia(scene, brief, {
      assets: opts.assets,
      generationQuality: qualityOf(opts),
      seedance: opts.seedance,
      visualDirection,
      ...opts.sceneMedia,
    });
    return {
      ok: true,
      media: { ...next, retries: prior.retries + 1 },
    };
  } catch {
    return {
      ok: false,
      media: { ...prior, retries: prior.retries + 1 },
    };
  }
}

export async function generateAd(
  script: Script,
  brief: CreativeBrief,
  opts: GenerateAdOptions = {},
): Promise<StageResult<GeneratedAd>> {
  const nowIso = new Date().toISOString();
  const runId = opts.runId ?? newRunId();
  const inputHash =
    opts.inputHash ?? stableInputHash({ script, briefJobId: brief.jobId });
  const provenance = makeStageProvenance(GENERATION_STAGE_VERSION, {
    runId,
    inputHash,
    generatedAt: nowIso,
  });
  const execution = emptyStageExecution();
  const calls: GenerationCallRecord[] = [];
  const jobId = opts.jobId ?? brief.jobId;
  let workingScript = script;

  try {
    if (!opts.skipSnapshots) {
      writeGenerationSnapshot(jobId, "generation/input-script", workingScript, {
        runId,
      });
    }

    let voice = await synthesizeVoice(workingScript, {
      ...opts.tts,
      audioDirection: workingScript.audioDirection,
    });
    calls.push({
      capability: "synthesizeVoice",
      provider: "volcengine-tts",
      model: voice.model,
      promptVersion: "tts-script-v1",
      status: "ok",
      latencyMs: voice.latencyMs,
      cached: false,
    });

    // Pre-Seedance TTS hard gate — never burn Mini when VO forces outside 14–17
    // or preferred floor (avoid ~5s silent Hero).
    const voInPreferredBand = (sec: number) =>
      sec >= VO_MIN_SEC - 1e-6 &&
      sec <= VO_MAX_SEC + 1e-6 &&
      !voForcesOutsideHardWindow(sec);

    const gateVo = async (): Promise<boolean> => {
      if (voInPreferredBand(voice.durationSec)) {
        return true;
      }
      const overrun = voice.durationSec - VO_MAX_SEC;
      const withinRateRetry =
        overrun > 0 && overrun / VO_MAX_SEC <= VO_RATE_RETRY_OVER_RATIO;
      if (withinRateRetry || voice.durationSec <= VO_HARD_MAX_SEC) {
        if (voice.durationSec > VO_MAX_SEC) {
          const sped = await synthesizeVoice(workingScript, {
            ...opts.tts,
            audioDirection: workingScript.audioDirection,
            speechRate: VO_SPEECH_RATE_BUMP,
          });
          calls.push({
            capability: "synthesizeVoice",
            provider: "volcengine-tts",
            model: sped.model,
            promptVersion: "tts-script-v1-rate",
            status: "ok",
            latencyMs: sped.latencyMs,
            cached: false,
          });
          if (
            sped.durationSec <= VO_MAX_SEC + 1e-6 ||
            (sped.durationSec < voice.durationSec &&
              !voForcesOutsideHardWindow(sped.durationSec))
          ) {
            voice = sped;
          }
        }
      }

      if (voInPreferredBand(voice.durationSec)) {
        return true;
      }

      if (opts.reExpandOnVoOverrun) {
        const words = scriptVoWordCount(workingScript);
        const wps = words / Math.max(0.1, voice.durationSec);
        const reason: "overrun" | "underrun" =
          voice.durationSec < VO_MIN_SEC - 1e-6 ? "underrun" : "overrun";
        const maxVoWords = Math.max(
          18,
          Math.floor(VO_MAX_SEC * wps),
        );
        const minVoWords =
          reason === "underrun"
            ? Math.max(30, Math.ceil(VO_MIN_SEC * wps * 1.08))
            : undefined;
        const rewritten = await opts.reExpandOnVoOverrun({
          script: workingScript,
          voiceDurationSec: voice.durationSec,
          maxVoWords,
          minVoWords,
          reason,
        });
        if (rewritten) {
          workingScript = rewritten;
          const again = await synthesizeVoice(workingScript, {
            ...opts.tts,
            audioDirection: workingScript.audioDirection,
            ...(reason === "overrun"
              ? { speechRate: VO_SPEECH_RATE_BUMP }
              : reason === "underrun"
                ? { speechRate: VO_SPEECH_RATE_SLOW }
                : {}),
          });
          calls.push({
            capability: "synthesizeVoice",
            provider: "volcengine-tts",
            model: again.model,
            promptVersion:
              reason === "underrun"
                ? "tts-script-v1-reexpand-min"
                : "tts-script-v1-reexpand",
            status: "ok",
            latencyMs: again.latencyMs,
            cached: false,
          });
          voice = again;
        }
      }

      if (
        voice.durationSec > VO_HARD_MAX_SEC + 1e-6 ||
        voForcesOutsideHardWindow(voice.durationSec)
      ) {
        return false;
      }
      // Soft: allow underrun if total still ≥14 (Hero freeze absorbs); warn via compile.
      // Soft: allow slight overrun ≤ hard VO max.
      return (
        voice.durationSec <= VO_HARD_MAX_SEC + 1e-6 &&
        !voForcesOutsideHardWindow(voice.durationSec)
      );
    };

    const voOk = await gateVo();
    if (!voOk) {
      const projected = projectedAdDurationSec(voice.durationSec);
      execution.errors.push({
        capability: "synthesizeVoice",
        errorType: "validation",
        errorMessage: `TTS ${voice.durationSec.toFixed(2)}s would force ad ~${projected.toFixed(2)}s outside hard ${DURATION_HARD_MIN_SEC}–${DURATION_HARD_MAX_SEC}s (VO budget ${VO_MIN_SEC.toFixed(1)}–${VO_MAX_SEC.toFixed(1)}s preferred, ≤${VO_HARD_MAX_SEC.toFixed(1)}s hard) — no Seedance burned`,
      });
      execution.calls.push(...calls.map(toExecCall));
      return { status: "failed", data: null, execution, provenance };
    }

    const { adSpec } = compileAdSpec(workingScript, voice.durationSec, {
      beatDurations: voice.beats,
      brief,
      pauses: voice.pauses,
    });

    if (!opts.skipSnapshots) {
      writeGenerationSnapshot(jobId, "generation/compiled-adspec", adSpec, {
        runId,
      });
    }

    const generationQuality = qualityOf(opts);
    const existingById = new Map(
      (opts.existingScenes ?? []).map((s) => [s.sceneId, s]),
    );
    const concurrency = opts.sceneConcurrency ?? SCENE_CONCURRENCY;
    const visualDirection =
      workingScript.visualDirection ?? adSpec.visualDirection;

    // fix5: prepare all → submit-storm (POST×N) → parallel poll.
    // Wall-clock for Seedance ≈ max(scene.latency), not sum.
    type SceneSlot =
      | { kind: "reuse"; media: GeneratedSceneMedia }
      | { kind: "job"; job: PreparedSceneSeedanceJob };

    const slots: SceneSlot[] = await mapPool(
      adSpec.scenes,
      concurrency,
      async (scene) => {
        const reused = existingById.get(scene.id);
        if (reused?.mediaUrl) {
          return { kind: "reuse" as const, media: reused };
        }
        try {
          const job = await prepareSceneSeedanceJob(scene, brief, {
            assets: opts.assets,
            generationQuality,
            visualDirection,
            ...opts.sceneMedia,
          });
          return { kind: "job" as const, job };
        } catch (err) {
          // Technical prepare fail → one retry, then rethrow.
          try {
            const job = await prepareSceneSeedanceJob(scene, brief, {
              assets: opts.assets,
              generationQuality,
              visualDirection,
              ...opts.sceneMedia,
            });
            return { kind: "job" as const, job };
          } catch {
            throw err instanceof Error ? err : new Error(String(err));
          }
        }
      },
    );

    const jobs = slots
      .filter((s): s is { kind: "job"; job: PreparedSceneSeedanceJob } => s.kind === "job")
      .map((s) => s.job);

    const submittedTaskIds: string[] = [];
    const seedanceBatchOpts: SeedanceGenerateOptions = {
      ...opts.seedance,
      onSubmitted: async (info) => {
        submittedTaskIds.push(info.taskId);
        await Promise.resolve(opts.seedance?.onSubmitted?.(info));
      },
    };

    let batchWall = {
      submitWallMs: 0,
      awaitWallMs: 0,
      sceneWallMs: 0,
      taskIds: [] as string[],
    };
    let freshMedia: GeneratedSceneMedia[] = [];
    if (jobs.length) {
      try {
        const batch = await generateScenesSeedanceBatch(jobs, seedanceBatchOpts);
        freshMedia = batch.media;
        batchWall = {
          submitWallMs: batch.submitWallMs,
          awaitWallMs: batch.awaitWallMs,
          sceneWallMs: batch.sceneWallMs,
          taskIds: batch.taskIds,
        };
      } catch (firstErr) {
        // One full-batch retry on technical fail (still no static fallback).
        try {
          const batch = await generateScenesSeedanceBatch(
            jobs,
            seedanceBatchOpts,
          );
          freshMedia = batch.media.map((m) => ({ ...m, retries: 1 }));
          batchWall = {
            submitWallMs: batch.submitWallMs,
            awaitWallMs: batch.awaitWallMs,
            sceneWallMs: batch.sceneWallMs,
            taskIds: batch.taskIds,
          };
        } catch {
          throw firstErr instanceof Error
            ? firstErr
            : new Error(String(firstErr));
        }
      }
    }

    let freshIdx = 0;
    const scenes: GeneratedSceneMedia[] = [];
    for (const slot of slots) {
      if (slot.kind === "reuse") {
        scenes.push(slot.media);
        calls.push({
          capability: "generateSceneMedia",
          provider: slot.media.provider,
          model: slot.media.model,
          promptVersion: "scene-v3-reuse",
          status: "ok",
          latencyMs: 0,
          cached: true,
          sceneId: slot.media.sceneId,
          sceneTreatment: slot.media.treatment,
          retries: slot.media.retries,
          fallbackUsed: slot.media.fallbackUsed,
        });
      } else {
        const media = freshMedia[freshIdx++]!;
        scenes.push(media);
        calls.push({
          capability: "generateSceneMedia",
          provider: media.provider,
          model: media.model,
          promptVersion: "scene-v3",
          status: "ok",
          latencyMs: media.latencyMs,
          cached: false,
          sceneId: media.sceneId,
          sceneTreatment: media.treatment,
          retries: media.retries,
          fallbackUsed: media.fallbackUsed,
        });
      }
    }

    // Parallel evidence for manifests / metrics (not a billed capability).
    const sceneLatencySumMs = scenes.reduce((a, s) => a + (s.latencyMs || 0), 0);
    const sceneLatencyMaxMs = scenes.reduce(
      (a, s) => Math.max(a, s.latencyMs || 0),
      0,
    );

    // End-card lockup: full brand + product name only — never first-word
    // truncation or brief.facts / internal scene.text (those painted as
    // "This is a second-generation…" on the product hold).
    const productName = (brief.product.name ?? "").trim();
    const brandName = (brief.product.brand ?? "").trim() ||
      productName.split(/\s+[-–—]\s+/)[0]?.trim() ||
      "";
    const brandLockup = brandName
      ? {
          brand: brandName,
          ...(productName && productName !== brandName
            ? { claim: productName }
            : {}),
        }
      : undefined;

    const composeInput = {
      adSpec,
      scenes,
      voiceoverUrl: voice.audioUrl,
      ...(brandLockup ? { brandLockup } : {}),
    };

    // keepWorkspace so Hero window retries only re-encode Hero ss (no full compose×N).
    let composed = await composeAd(composeInput, {
      generationQuality,
      heroWindow: "tail",
      keepWorkspace: true,
      ...opts.compose,
    });
    calls.push({
      capability: "composeAd",
      provider: composed.provider,
      model: composed.model,
      promptVersion: "compose-v3",
      status: "ok",
      latencyMs: composed.latencyMs,
      cached: false,
    });

    const sceneWall = Math.max(batchWall.sceneWallMs, sceneLatencyMaxMs);
    const timingMetrics = {
      seedanceSubmitWallMs: batchWall.submitWallMs,
      seedanceAwaitWallMs: batchWall.awaitWallMs,
      seedanceSceneWallMs: batchWall.sceneWallMs,
      seedanceTaskIds: batchWall.taskIds.length
        ? batchWall.taskIds
        : submittedTaskIds,
      sceneLatencySumMs,
      sceneLatencyMaxMs,
      wallVsSum:
        sceneLatencySumMs > 0
          ? Number((sceneWall / sceneLatencySumMs).toFixed(3))
          : 1,
      parallelEfficiency:
        sceneWall > 0
          ? Number((sceneLatencyMaxMs / sceneWall).toFixed(3))
          : 1,
    };

    let ad: GeneratedAd = {
      id: adSpec.id,
      creativeId: workingScript.creativeId,
      scriptId: workingScript.id,
      adSpec,
      voiceoverUrl: voice.audioUrl,
      voiceoverDurationSec: voice.durationSec,
      beatVoiceovers: voice.beats.map((b) => ({
        beatIndex: b.beatIndex,
        text: b.text,
        audioUrl: b.audioUrl,
        durationSec: b.durationSec,
      })),
      scenes: [...scenes],
      composedUrl: composed.composedUrl,
      shotLocalPaths: composed.shotLocalPaths,
      bgmUsed: Boolean(composed.bgmUsed),
      manifest: {
        version: 1,
        scriptId: workingScript.id,
        voiceoverDurationSec: voice.durationSec,
        composed: true,
        calls: [...calls],
        timing: timingMetrics,
      },
    };

    if (opts.validate) {
      let validation = await validateAd(ad, workingScript, brief, adSpec, {
        runner: opts.runner,
        finalDurationSec: composed.finalDurationSec,
        ...opts.validateOpts,
      });
      execution.calls.push(...validation.executionCalls);

      const issues = softenValidationIssues(validation.result.issues);
      validation = {
        ...validation,
        result: {
          pass: issues.every((i) => i.severity !== "hard"),
          issues: issues as typeof validation.result.issues,
        },
      };

      // Hero "no product": Hero ss-only re-encode (zero Seedance) before Mini regen.
      const heroScene = adSpec.scenes.find((s) => s.isHeroClose);
      const heroProductHard = validation.result.issues.find(
        (i) =>
          i.severity === "hard" &&
          isHeroNoProductIssue(i) &&
          (!i.sceneId || i.sceneId === heroScene?.id),
      );
      if (heroProductHard && heroScene && composed.workspace) {
        for (const window of ["mid", "head"] as const) {
          const retryCompose = await composeAd(composeInput, {
            generationQuality,
            heroWindow: window,
            reuseWorkspace: composed.workspace,
            keepWorkspace: true,
            ...opts.compose,
          });
          calls.push({
            capability: "composeAd",
            provider: retryCompose.provider,
            model: retryCompose.model,
            promptVersion: `compose-v3-hero-${window}${retryCompose.heroOnlyReencode ? "-ss" : ""}`,
            status: "ok",
            latencyMs: retryCompose.latencyMs,
            cached: false,
          });
          const probeAd: GeneratedAd = {
            ...ad,
            composedUrl: retryCompose.composedUrl,
            shotLocalPaths: retryCompose.shotLocalPaths,
            bgmUsed: Boolean(retryCompose.bgmUsed),
          };
          // Hero-visibility-only AI on window retries (cheaper than full aesthetic).
          const recheck = await validateAd(
            probeAd,
            workingScript,
            brief,
            adSpec,
            {
              runner: opts.runner,
              finalDurationSec: retryCompose.finalDurationSec,
              heroVisibilityOnly: true,
              ...opts.validateOpts,
            },
          );
          execution.calls.push(...recheck.executionCalls);
          const stillHeroHard = recheck.result.issues.some(
            (i) => i.severity === "hard" && isHeroNoProductIssue(i),
          );
          if (!stillHeroHard) {
            composed = retryCompose;
            ad = { ...probeAd, scenes: [...scenes] };
            // Full validate once after accepting a window (restore soft aesthetics).
            const full = await validateAd(ad, workingScript, brief, adSpec, {
              runner: opts.runner,
              finalDurationSec: composed.finalDurationSec,
              ...opts.validateOpts,
            });
            execution.calls.push(...full.executionCalls);
            validation = {
              ...full,
              result: {
                pass: softenValidationIssues(full.result.issues).every(
                  (i) => i.severity !== "hard",
                ),
                issues: softenValidationIssues(
                  full.result.issues,
                ) as typeof full.result.issues,
              },
            };
            break;
          }
          if (retryCompose.workspace) {
            composed = { ...composed, workspace: retryCompose.workspace };
          }
        }
      }

      // Media-level only — one Mini retry per sceneId; Hero Mini regen capped at 1.
      const hardRegen = uniqueMediaRegenIssues(validation.result.issues);
      let heroRegenUsed = 0;
      let repaired = false;

      for (const issue of hardRegen) {
        const scene = adSpec.scenes.find((s) => s.id === issue.sceneId);
        if (!scene) continue;
        const idx = scenes.findIndex((s) => s.sceneId === issue.sceneId);
        if (idx < 0) continue;
        const prior = scenes[idx]!;

        if (scene.isHeroClose || isHeroNoProductIssue(issue)) {
          if (heroRegenUsed >= 1) continue;
          heroRegenUsed += 1;
        }

        const { ok, media: retried } = await tryRegenerateScene(
          scene,
          brief,
          opts,
          prior,
          workingScript.visualDirection,
        );
        calls.push({
          capability: "generateSceneMedia",
          provider: retried.provider,
          model: retried.model,
          promptVersion: "scene-v3",
          status: ok ? "ok" : "failed",
          latencyMs: retried.latencyMs,
          cached: false,
          sceneId: scene.id,
          sceneTreatment: scene.treatment,
          retries: retried.retries,
          qaFailReason: issue.reason,
        });

        if (!ok) {
          throw new Error(
            `Scene ${scene.id} hard fail after Mini retry — fail closed (no static asset fallback)`,
          );
        }

        scenes[idx] = retried;
        repaired = true;
      }

      if (repaired) {
        composed = await composeAd(
          {
            adSpec,
            scenes,
            voiceoverUrl: voice.audioUrl,
            ...(brandLockup ? { brandLockup } : {}),
          },
          {
            generationQuality,
            heroWindow: "tail",
            ...opts.compose,
          },
        );
        calls.push({
          capability: "composeAd",
          provider: composed.provider,
          model: composed.model,
          promptVersion: "compose-v3",
          status: "ok",
          latencyMs: composed.latencyMs,
          cached: false,
        });
        ad = {
          ...ad,
          scenes: [...scenes],
          composedUrl: composed.composedUrl,
          shotLocalPaths: composed.shotLocalPaths,
          bgmUsed: Boolean(composed.bgmUsed),
        };
        validation = await validateAd(ad, workingScript, brief, adSpec, {
          runner: opts.runner,
          finalDurationSec: composed.finalDurationSec,
          ...opts.validateOpts,
        });
        execution.calls.push(...validation.executionCalls);
        const softened = softenValidationIssues(validation.result.issues);
        validation = {
          ...validation,
          result: {
            pass: softened.every((i) => i.severity !== "hard"),
            issues: softened as typeof validation.result.issues,
          },
        };
      }

      ad = {
        ...ad,
        scenes: [...scenes],
        composedUrl: composed.composedUrl,
        shotLocalPaths: composed.shotLocalPaths,
        bgmUsed: Boolean(composed.bgmUsed),
        validation: validation.result,
        manifest: {
          version: 1,
          scriptId: workingScript.id,
          voiceoverDurationSec: voice.durationSec,
          composed: true,
          calls: [...calls],
          qa: validation.result,
          timing: timingMetrics,
        },
      };

      execution.calls.push(...calls.map(toExecCall));

      if (!opts.skipSnapshots) {
        writeGenerationSnapshot(
          jobId,
          "generation/result-manifest",
          ad.manifest,
          { runId },
        );
      }

      if (!validation.result.pass) {
        const remainingHard = validation.result.issues.filter(
          (i) => i.severity === "hard",
        );
        execution.errors.push({
          capability: "validateAd",
          errorType: "validation",
          errorMessage: remainingHard.map((i) => i.reason).join("; "),
        });
        return { status: "failed", data: ad, execution, provenance };
      }

      return { status: "ok", data: ad, execution, provenance };
    }

    ad = {
      ...ad,
      manifest: {
        version: 1,
        scriptId: workingScript.id,
        voiceoverDurationSec: voice.durationSec,
        composed: true,
        calls: [...calls],
        timing: timingMetrics,
      },
    };

    if (!opts.skipSnapshots) {
      writeGenerationSnapshot(
        jobId,
        "generation/result-manifest",
        ad.manifest,
        { runId },
      );
    }

    execution.calls.push(...calls.map(toExecCall));
    return { status: "ok", data: ad, execution, provenance };
  } catch (err) {
    execution.errors.push({
      capability: "generateAd",
      errorType: "provider",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    execution.calls.push(...calls.map(toExecCall));
    return { status: "failed", data: null, execution, provenance };
  }
}
