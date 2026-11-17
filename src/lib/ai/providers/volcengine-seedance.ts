/**
 * Thin Volcengine Seedance video adapter — not part of runCapability / chat registry.
 * Env: SEEDANCE_2_0_MINI_API / SEEDANCE_1_0_PRO_FAST_API / SEEDANCE_2_5_API
 *
 * Ark task API: POST /contents/generations/tasks → poll GET …/tasks/{id}.
 *
 * Batch path: submitSeedanceTask (POST only) then awaitSeedanceTask (poll) so
 * generateAd can fire a submit storm — wall-clock ≈ max(scene), not sum.
 *
 * Resolution: Ark Seedance Mini request body has NO resolution / 480p field
 * (confirmed — only duration, ratio, generate_audio, watermark, content).
 * Live Generation uses Mini-default output; do not call 2.5 for "cheaper pixels".
 *
 * Reference role: Mini/2.5 default `reference_image` (r2v) keeps ratio (9:16).
 * Seedance 1.0 Pro Fast does **not** support r2v — coerce to `first_frame` (i2v).
 * `first_frame` omits ratio (Ark rejects first_frame + ratio).
 */

import { ARK_BASE_URL } from "./volcengine-models";

export type SeedanceTier = "mini" | "pro-fast" | "2.5";

export type SeedanceReferenceRole = "first_frame" | "reference_image";

export type SeedanceGenerateInput = {
  prompt: string;
  durationSec: number;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  /** Optional product reference image URL for reference_generate. */
  referenceImageUrl?: string;
  /**
   * How the reference image is consumed.
   * Default `reference_image` — product guides motion AND ratio is sent.
   * `first_frame` — image locks first frame; ratio omitted (Ark constraint).
   */
  referenceRole?: SeedanceReferenceRole;
};

export type SeedanceGenerateResult = {
  videoUrl: string;
  model: string;
  latencyMs: number;
  tier: SeedanceTier;
  /** Actual billed/output duration when returned by Ark. */
  durationSec?: number;
  /** Ark task id when async (for parallel evidence logs). */
  taskId?: string;
};

/** Handle from submitSeedanceTask — poll with awaitSeedanceTask. */
export type SeedanceTaskHandle = {
  kind: "pending";
  taskId: string;
  model: string;
  tier: SeedanceTier;
  apiKey: string;
  started: number;
  durationSec: number;
  timeoutMs: number;
  pollIntervalMs: number;
};

export type SeedanceSubmitResult =
  | ({ kind: "ready" } & SeedanceGenerateResult)
  | SeedanceTaskHandle;

export type SeedanceGenerateOptions = {
  generateFn?: (
    input: SeedanceGenerateInput,
    tier: SeedanceTier,
  ) => Promise<SeedanceGenerateResult>;
  /** Test injection — submit only (no poll). */
  submitFn?: (
    input: SeedanceGenerateInput,
    tier: SeedanceTier,
  ) => Promise<SeedanceSubmitResult>;
  /** Test injection — poll/await a pending handle. */
  awaitFn?: (handle: SeedanceTaskHandle) => Promise<SeedanceGenerateResult>;
  timeoutMs?: number;
  /** Poll interval for async tasks (ms). */
  pollIntervalMs?: number;
  /**
   * Called immediately after each successful POST (taskId×N evidence).
   * May be async — awaited so callers can persist ids before poll starts.
   */
  onSubmitted?: (info: {
    taskId: string;
    model: string;
    tier: SeedanceTier;
  }) => void | Promise<void>;
};

const MODEL_MINI = "doubao-seedance-2-0-mini-260615";
const MODEL_PRO_FAST = "doubao-seedance-1-0-pro-fast-251015";
const MODEL_25 = "doubao-seedance-2-5-260628";
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_MS = 2_000;
/** Seedance 2.x t2v accepts integer seconds in [4, 15] (or -1). */
const MIN_DURATION_SEC = 4;
const MAX_DURATION_SEC = 15;

function seedanceKeyEnvName(tier: SeedanceTier): string {
  if (tier === "mini") return "SEEDANCE_2_0_MINI_API";
  if (tier === "pro-fast") return "SEEDANCE_1_0_PRO_FAST_API";
  return "SEEDANCE_2_5_API";
}

function requireSeedanceKey(tier: SeedanceTier): string {
  const key =
    tier === "mini"
      ? process.env.SEEDANCE_2_0_MINI_API?.trim()
      : tier === "pro-fast"
        ? process.env.SEEDANCE_1_0_PRO_FAST_API?.trim()
        : process.env.SEEDANCE_2_5_API?.trim();
  if (!key) {
    throw new Error(`Missing ${seedanceKeyEnvName(tier)} for Seedance.`);
  }
  return key;
}

function modelForTier(tier: SeedanceTier): string {
  if (tier === "mini") {
    return process.env.ARK_SEEDANCE_MINI_MODEL?.trim() || MODEL_MINI;
  }
  if (tier === "pro-fast") {
    return (
      process.env.ARK_SEEDANCE_PREVIEW_MODEL?.trim() || MODEL_PRO_FAST
    );
  }
  return process.env.ARK_SEEDANCE_25_MODEL?.trim() || MODEL_25;
}

/** Ceiling so billed clip is never shorter than the scene; compose crops with `-t`. */
export function clampDurationSec(durationSec: number): number {
  const rounded = Math.max(1, Math.ceil(durationSec));
  return Math.min(MAX_DURATION_SEC, Math.max(MIN_DURATION_SEC, rounded));
}

type TaskCreateResponse = {
  id?: string;
  error?: { message?: string };
};

type TaskGetResponse = {
  id?: string;
  status?: string;
  content?: { video_url?: string; url?: string };
  video_url?: string;
  duration?: number;
  error?: { message?: string };
};

/**
 * Ark maps `reference_image` → task_type r2v. Pro Fast only supports t2v/i2v.
 * Export for unit tests + resolveScene alignment.
 */
export function referenceRoleForTier(
  tier: SeedanceTier,
  requested?: SeedanceReferenceRole,
): SeedanceReferenceRole {
  const role = requested ?? "reference_image";
  if (tier === "pro-fast" && role === "reference_image") {
    return "first_frame";
  }
  return role;
}

function buildRequestBody(
  input: SeedanceGenerateInput,
  model: string,
  tier: SeedanceTier,
): { body: Record<string, unknown>; duration: number } {
  const duration = clampDurationSec(input.durationSec);
  const ratio = input.aspectRatio ?? "9:16";
  const referenceRole = referenceRoleForTier(tier, input.referenceRole);

  const content: Array<Record<string, unknown>> = [
    { type: "text", text: input.prompt },
  ];
  const hasRef = Boolean(input.referenceImageUrl);
  if (input.referenceImageUrl) {
    content.push({
      type: "image_url",
      image_url: { url: input.referenceImageUrl },
      role: referenceRole,
    });
  }

  const body: Record<string, unknown> = {
    model,
    content,
    duration,
    generate_audio: false,
    watermark: false,
  };
  // Ark rejects first_frame + ratio; reference_image accepts ratio (native 9:16).
  if (!(hasRef && referenceRole === "first_frame")) {
    body.ratio = ratio;
  }
  return { body, duration };
}

async function pollSeedanceTask(
  taskId: string,
  apiKey: string,
  started: number,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<TaskGetResponse> {
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(
      `${ARK_BASE_URL}/contents/generations/tasks/${taskId}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    const raw = (await res.json()) as TaskGetResponse;
    if (!res.ok) {
      throw new Error(
        raw.error?.message ||
          `Seedance poll HTTP ${res.status}: ${JSON.stringify(raw).slice(0, 200)}`,
      );
    }
    const status = raw.status ?? "";
    if (status === "succeeded") return raw;
    if (status === "failed" || status === "expired" || status === "cancelled") {
      throw new Error(
        raw.error?.message || `Seedance task ${taskId} ended with status=${status}`,
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`Seedance task ${taskId} timed out after ${timeoutMs}ms`);
}

function resultFromFinished(
  finished: TaskGetResponse,
  model: string,
  tier: SeedanceTier,
  started: number,
  fallbackDuration: number,
  taskId?: string,
): SeedanceGenerateResult {
  const videoUrl =
    finished.content?.video_url ??
    finished.content?.url ??
    finished.video_url;
  if (!videoUrl) {
    throw new Error("Seedance response missing video URL");
  }
  return {
    videoUrl,
    model,
    latencyMs: Date.now() - started,
    tier,
    durationSec:
      typeof finished.duration === "number" ? finished.duration : fallbackDuration,
    ...(taskId ? { taskId } : {}),
  };
}

/**
 * POST only — returns immediately with taskId (or ready result if sync).
 * Use with awaitSeedanceTask for submit-storm parallelism.
 */
export async function submitSeedanceTask(
  input: SeedanceGenerateInput,
  tier: SeedanceTier,
  opts: SeedanceGenerateOptions = {},
): Promise<SeedanceSubmitResult> {
  if (opts.submitFn) {
    const submitted = await opts.submitFn(input, tier);
    const taskId =
      submitted.kind === "pending"
        ? submitted.taskId
        : (submitted.taskId ?? "sync");
    await Promise.resolve(
      opts.onSubmitted?.({
        taskId,
        model: submitted.model,
        tier: submitted.tier,
      }),
    );
    return submitted;
  }
  if (opts.generateFn) {
    // Legacy inject: treat as already-complete generate.
    const ready = await opts.generateFn(input, tier);
    await Promise.resolve(
      opts.onSubmitted?.({
        taskId: ready.taskId ?? "sync",
        model: ready.model,
        tier: ready.tier,
      }),
    );
    return { kind: "ready", ...ready };
  }

  const apiKey = requireSeedanceKey(tier);
  const model = modelForTier(tier);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  const started = Date.now();
  const { body, duration } = buildRequestBody(input, model, tier);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${ARK_BASE_URL}/contents/generations/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = (await res.json()) as TaskCreateResponse & TaskGetResponse;
    if (!res.ok) {
      throw new Error(
        raw.error?.message ||
          `Seedance HTTP ${res.status}: ${JSON.stringify(raw).slice(0, 200)}`,
      );
    }

    const immediateUrl =
      raw.content?.video_url ?? raw.content?.url ?? raw.video_url;
    if (immediateUrl) {
      const ready = resultFromFinished(raw, model, tier, started, duration, raw.id);
      await Promise.resolve(
        opts.onSubmitted?.({
          taskId: raw.id ?? "sync",
          model,
          tier,
        }),
      );
      return { kind: "ready", ...ready };
    }

    const taskId = raw.id;
    if (!taskId) {
      throw new Error("Seedance response missing task id and video URL");
    }
    await Promise.resolve(opts.onSubmitted?.({ taskId, model, tier }));
    return {
      kind: "pending",
      taskId,
      model,
      tier,
      apiKey,
      started,
      durationSec: duration,
      timeoutMs,
      pollIntervalMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Poll a pending Seedance task to completion. */
export async function awaitSeedanceTask(
  handle: SeedanceTaskHandle,
  opts: SeedanceGenerateOptions = {},
): Promise<SeedanceGenerateResult> {
  if (opts.awaitFn) {
    return opts.awaitFn(handle);
  }
  const finished = await pollSeedanceTask(
    handle.taskId,
    handle.apiKey,
    handle.started,
    handle.timeoutMs,
    handle.pollIntervalMs,
  );
  return resultFromFinished(
    finished,
    handle.model,
    handle.tier,
    handle.started,
    handle.durationSec,
    handle.taskId,
  );
}

/** Resolve any submit result (ready or pending) to a final video. */
export async function resolveSeedanceSubmit(
  submitted: SeedanceSubmitResult,
  opts: SeedanceGenerateOptions = {},
): Promise<SeedanceGenerateResult> {
  if (submitted.kind === "ready") {
    const { kind: _k, ...result } = submitted;
    return result;
  }
  return awaitSeedanceTask(submitted, opts);
}

/**
 * Generate a short scene video via Seedance (submit + poll).
 * Prefer submitSeedanceTask + awaitSeedanceTask in batch fans-out.
 * Overlays (logo/CTA/price/subtitle) must NOT be requested here — compose only.
 */
export async function generateSeedanceVideo(
  input: SeedanceGenerateInput,
  tier: SeedanceTier,
  opts: SeedanceGenerateOptions = {},
): Promise<SeedanceGenerateResult> {
  if (opts.generateFn) {
    return opts.generateFn(input, tier);
  }
  const submitted = await submitSeedanceTask(input, tier, opts);
  return resolveSeedanceSubmit(submitted, opts);
}
