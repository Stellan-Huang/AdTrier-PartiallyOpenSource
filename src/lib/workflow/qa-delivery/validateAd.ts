/**
 * validateAd — deterministic checks + optional Pro multimodal QA.
 * Soft aesthetic → ACCEPT. No fallback_asset static packshot repair.
 * Duration 14–17s hard when finalDurationSec known; hero-close no-product → hard.
 * Hero visibility comes from the model looking at an attached mid-frame (not signalstats).
 */

import { existsSync, mkdtempSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiInlineDataPart, AiPart, AiRunner } from "@/lib/ai";
import { makeFailedUsage, runCapability } from "@/lib/ai";
import {
  probeMediaDurationSec,
  runFfmpeg,
} from "@/lib/media/ffmpeg";
import type { CreativeBrief } from "@/lib/workflow/creative/types";
import type { Script } from "@/lib/workflow/creative/v2/types";
import type { AdSpec, GeneratedAd } from "@/lib/workflow/generation/types";
import type { StageExecution } from "@/lib/workflow/types";
import {
  VALIDATE_AD_SYSTEM,
  VALIDATE_AD_USER_PREFIX,
  validateAdResponseSchema,
} from "./prompts/validate-ad";
import type { ValidationIssue, ValidationResult } from "./types";

export type ValidateAdOptions = {
  runner?: AiRunner;
  /** Skip multimodal capability — deterministic only. */
  skipAi?: boolean;
  /** Optional composed duration override (from composeAd.finalDurationSec). */
  finalDurationSec?: number;
  /**
   * Optional override for tests. When omitted, multimodal QA sets heroVisible
   * from the attached Hero mid-frame answer.
   */
  heroVisible?: boolean;
  /**
   * fix5: on Hero window retries — only ask heroProductVisible (skip full aesthetic).
   * Uses Hero open frame (+0.3s) which is where the pouch should already be settled.
   */
  heroVisibilityOnly?: boolean;
};

export type ValidateAdFullResult = {
  result: ValidationResult;
  executionCalls: StageExecution["calls"];
  /** Model (or override) answer for Hero package visibility. */
  heroVisible?: boolean;
};

/** User hard window for composed ads (fix3). */
const DURATION_MIN = 14.0;
const DURATION_MAX = 17.0;

type ValidateAdAiResponse = {
  pass: boolean;
  issues: ValidationIssue[];
  heroProductVisible?: boolean;
};

function probeDurationSec(filePath: string): number | null {
  if (!filePath || /^https?:\/\//i.test(filePath) || !existsSync(filePath)) {
    return null;
  }
  return probeMediaDurationSec(filePath);
}

/**
 * Extract a Hero Close frame for multimodal QA. Returns local PNG path or null.
 * Default: +0.3s into Hero (settled pouch after open skip) — mid often lands
 * on freeze-pad and caused false "no product" → expensive window retries.
 */
export function extractHeroMidFrame(
  composedUrl: string,
  heroStartSec: number,
  heroEndSec: number,
  mode: "open" | "mid" = "open",
): string | null {
  if (!composedUrl || /^https?:\/\//i.test(composedUrl)) return null;
  if (!existsSync(composedUrl)) return null;
  const at =
    mode === "mid"
      ? (heroStartSec + heroEndSec) / 2
      : Math.min(heroEndSec - 0.05, heroStartSec + 0.3);
  const dir = mkdtempSync(join(tmpdir(), "adtrier-qa-hero-"));
  const frame = join(dir, "hero.png");
  const extract = runFfmpeg([
    "-y",
    "-ss",
    String(at),
    "-i",
    composedUrl,
    "-frames:v",
    "1",
    frame,
  ]);
  if (extract.status !== 0 || !existsSync(frame)) return null;
  return frame;
}

function frameToInlinePart(framePath: string): AiInlineDataPart {
  const buf = readFileSync(framePath);
  return {
    inlineData: {
      mimeType: "image/png",
      data: buf.toString("base64"),
    },
  };
}

function deterministicIssues(
  ad: GeneratedAd,
  script: Script,
  adSpec: AdSpec,
  opts: ValidateAdOptions,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!ad.composedUrl) {
    issues.push({
      severity: "hard",
      reason: "Missing composed ad URL",
      action: "regenerate",
    });
  }
  if (!ad.voiceoverUrl) {
    issues.push({
      severity: "hard",
      reason: "Missing voiceover audio",
      action: "regenerate",
    });
  }
  if (ad.scenes.length !== adSpec.scenes.length) {
    issues.push({
      severity: "hard",
      reason: `Scene count mismatch media=${ad.scenes.length} spec=${adSpec.scenes.length}`,
      action: "regenerate",
    });
  }

  const expectedShots = script.beats.reduce(
    (n, b) => n + (b.shots?.length ?? 0),
    0,
  );
  // +1 Hero Close scene beyond script shots
  if (
    ad.scenes.length !== expectedShots &&
    ad.scenes.length !== expectedShots + 1
  ) {
    issues.push({
      severity: "soft",
      reason: `Scene/shot count mismatch scenes=${ad.scenes.length} shots=${expectedShots}`,
      action: "accept",
    });
  }

  let prevEnd = 0;
  for (const scene of adSpec.scenes) {
    if (scene.end <= scene.start) {
      issues.push({
        sceneId: scene.id,
        severity: "hard",
        reason: `Invalid timing ${scene.start}-${scene.end}`,
        action: "regenerate",
      });
    }
    if (scene.start + 0.001 < prevEnd && !scene.isHeroClose) {
      issues.push({
        sceneId: scene.id,
        severity: "hard",
        reason: "Scene timing overlaps previous",
        action: "regenerate",
      });
    }
    if (scene.start > prevEnd + 0.05 && !scene.isHeroClose) {
      issues.push({
        sceneId: scene.id,
        severity: "soft",
        reason: "Timing gap before scene",
        action: "accept",
      });
    }
    if (!scene.isHeroClose) prevEnd = scene.end;

    const media = ad.scenes.find((s) => s.sceneId === scene.id);
    if (!media?.mediaUrl) {
      issues.push({
        sceneId: scene.id,
        severity: "hard",
        reason: "Missing scene media",
        action: "regenerate",
      });
    }
    if (
      media &&
      (media.provider === "layout" ||
        media.model === "crop-fit" ||
        media.model === "fallback_asset")
    ) {
      issues.push({
        sceneId: scene.id,
        severity: "hard",
        reason: "Static asset scene forbidden (asset ≠ scene)",
        action: "regenerate",
      });
    }
    if (
      scene.productRole === "hero" &&
      (!scene.assetIds.length || !media?.referenceAssetId)
    ) {
      issues.push({
        sceneId: scene.id,
        severity: "hard",
        reason: "hero shot missing product reference",
        action: "regenerate",
      });
    }
  }

  // Composed duration hard band 14–17s — compose-level (no sceneId). Fixed; never VO-drift.
  const finalDur =
    opts.finalDurationSec ??
    (ad.composedUrl ? probeDurationSec(ad.composedUrl) : null);
  if (finalDur !== null && finalDur !== undefined) {
    if (finalDur < DURATION_MIN || finalDur > DURATION_MAX) {
      issues.push({
        severity: "hard",
        reason: `Composed duration ${finalDur.toFixed(2)}s outside hard 14–17s band`,
        action: "regenerate",
      });
    }
  }

  if (
    ad.voiceoverDurationSec > 0 &&
    (ad.voiceoverDurationSec < 8 || ad.voiceoverDurationSec > 23)
  ) {
    issues.push({
      severity: "soft",
      reason: `VO duration ${ad.voiceoverDurationSec}s outside soft 8–23s band`,
      action: "accept",
    });
  }

  return issues;
}

function sanitizeAiIssues(raw: unknown): ValidationIssue[] {
  if (!raw || typeof raw !== "object") return [];
  const issues = (raw as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  const out: ValidationIssue[] = [];
  for (const item of issues) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    let severity: ValidationIssue["severity"] =
      i.severity === "hard" ? "hard" : "soft";
    let action: ValidationIssue["action"] =
      i.action === "regenerate" ||
      i.action === "fallback_asset" ||
      i.action === "accept"
        ? i.action
        : "accept";
    if (action === "fallback_asset") action = "regenerate";
    const reason =
      typeof i.reason === "string" && i.reason.trim()
        ? i.reason.trim()
        : "unspecified";
    // Elevate "no product in hero close" to hard even if model said soft.
    if (
      /no product visible in hero|hero close.*no product|product not visible.*hero/i.test(
        reason,
      )
    ) {
      severity = "hard";
      action = "regenerate";
    }
    if (severity === "soft") action = "accept";
    out.push({
      ...(typeof i.sceneId === "string" ? { sceneId: i.sceneId } : {}),
      severity,
      reason,
      action,
    });
  }
  return out;
}

export async function validateAd(
  ad: GeneratedAd,
  script: Script,
  brief: CreativeBrief,
  adSpec?: AdSpec,
  opts: ValidateAdOptions = {},
): Promise<ValidateAdFullResult> {
  const spec = adSpec ?? ad.adSpec;
  const executionCalls: StageExecution["calls"] = [];
  const issues = deterministicIssues(ad, script, spec, opts);
  const heroScene = spec.scenes.find((s) => s.isHeroClose);
  let heroVisible = opts.heroVisible;
  let heroFramePath: string | null = null;

  if (
    heroVisible === undefined &&
    heroScene &&
    ad.composedUrl &&
    !/^https?:\/\//i.test(ad.composedUrl)
  ) {
    heroFramePath = extractHeroMidFrame(
      ad.composedUrl,
      heroScene.start,
      heroScene.end,
    );
  }

  if (!opts.skipAi) {
    const heroSceneForMeta = spec.scenes.find((s) => s.isHeroClose);
    const brandFromBrief =
      (brief.product.brand ?? brief.product.name ?? "").trim().split(/\s+/)[0] ??
      "";
    const claimFromHero =
      [...spec.scenes].reverse().find((s) => s.text?.trim())?.text ?? null;

    const compact = opts.heroVisibilityOnly
      ? {
          check: [
            "From the attached Hero Close open-frame (+0.3s): is the real product package / pouch visible?",
          ],
          product: brief.product,
          heroFrameAttached: Boolean(heroFramePath),
        }
      : {
          aspectRatio: "9:16",
          durationSec: ad.voiceoverDurationSec,
          finalDurationSec: opts.finalDurationSec ?? null,
          composedUrl: ad.composedUrl ?? null,
          heroFrameAttached: Boolean(heroFramePath),
          brandLockup: brandFromBrief
            ? { brand: brandFromBrief, claim: claimFromHero }
            : null,
          heroStartSec: heroSceneForMeta?.start ?? null,
          heroEndSec: heroSceneForMeta?.end ?? null,
          scenes: spec.scenes.map((s) => ({
            id: s.id,
            start: s.start,
            end: s.end,
            treatment: s.treatment,
            productRole: s.productRole,
            intent: s.intent,
            action: s.action,
            isHeroClose: Boolean(s.isHeroClose),
            text: s.text ?? null,
            hasMedia: Boolean(
              ad.scenes.find((m) => m.sceneId === s.id)?.mediaUrl,
            ),
            hasElement: Boolean(
              ad.scenes.find((m) => m.sceneId === s.id)?.elementUrl,
            ),
          })),
          product: brief.product,
          assetCount: brief.assets.images.length,
          check: [
            "From the attached Hero Close open-frame: is the real product package visible?",
            "From the attached frame / timeline: are there black letterbox bars or floating stickers?",
            "Brand lockup drawtext (brandLockup) at top is expected — do not flag it as unscripted floating text.",
            "From the attached frame: does the ending show brand presence?",
          ],
        };

    const textPart: AiPart = {
      text: `${VALIDATE_AD_USER_PREFIX}\n\n${JSON.stringify(compact)}`,
    };
    const parts: AiPart[] = [textPart];
    if (heroFramePath) {
      parts.push({
        text: "Hero Close frame — answer heroProductVisible from THIS image only:",
      });
      parts.push(frameToInlinePart(heroFramePath));
    }

    try {
      const { data, usage } = await runCapability<ValidateAdAiResponse>(
        "validateAd",
        {
          responseJsonSchema: validateAdResponseSchema,
          systemInstruction: VALIDATE_AD_SYSTEM,
          contents: [{ role: "user", parts }],
        },
        { runner: opts.runner },
      );
      executionCalls.push(usage);
      if (!opts.heroVisibilityOnly) {
        issues.push(...sanitizeAiIssues(data));
      }
      if (typeof data?.heroProductVisible === "boolean") {
        heroVisible = data.heroProductVisible;
      }
    } catch (err) {
      const usage = makeFailedUsage("validateAd", err);
      executionCalls.push(usage);
      if (!opts.heroVisibilityOnly) {
        issues.push({
          severity: "soft",
          reason: `validateAd AI unavailable: ${usage.errorMessage ?? String(err)}`,
          action: "accept",
        });
      }
    }
  }

  if (heroFramePath) {
    try {
      unlinkSync(heroFramePath);
    } catch {
      // ignore
    }
  }

  if (heroVisible === false && heroScene) {
    const already = issues.some((i) =>
      /no product visible in hero|hero close.*no product/i.test(i.reason),
    );
    if (!already) {
      issues.push({
        sceneId: heroScene.id,
        severity: "hard",
        reason: "no product visible in hero close",
        action: "regenerate",
      });
    }
  }

  const hard = issues.filter((i) => i.severity === "hard");
  return {
    result: {
      pass: hard.length === 0,
      issues,
    },
    executionCalls,
    ...(heroVisible !== undefined ? { heroVisible } : {}),
  };
}
