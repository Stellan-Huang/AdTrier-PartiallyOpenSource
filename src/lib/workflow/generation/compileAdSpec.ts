/**
 * Helper (not a stage): whole-script TTS duration → shot scenes + Hero Close.
 * Timeline anchors to max(15, heroStart+MIN_HERO); hard final window 14–17s.
 * Cut points prefer sentence-end large pauses; fallback pause-window snap.
 */

import type { Script } from "@/lib/workflow/creative/v2/types";
import { pickBestReferenceAssetId } from "./resolveScene";
import type { AdSpec, SceneSpec } from "./types";
import type { BeatVoiceover, VoicePause } from "./synthesizeVoice";
import { apportionBeatDurations } from "./synthesizeVoice";
import type { CreativeBrief } from "@/lib/workflow/creative/types";

export type CompileAdSpecResult = {
  adSpec: AdSpec;
  warnings: string[];
};

/** Prefer ~15s composed ads. */
export const TARGET_DURATION_SEC = 15;
/** Hard composed window (user): inclusive. */
export const DURATION_HARD_MIN_SEC = 14.0;
export const DURATION_HARD_MAX_SEC = 17.0;
/** Soft warn when TTS overruns preferred VO budget by this many seconds. */
const OVERRUN_WARN_SEC = 1.0;
/** Soft max cinematic scenes before Hero Close (prefer 2–4). */
const SOFT_MAX_CINEMATIC_SCENES = 4;
/** Soft min cinematic scenes before Hero Close. */
const SOFT_MIN_CINEMATIC_SCENES = 2;
/** Min cinematic shot length — use most of a Mini ≥4s clip. */
const MIN_SHOT_SEC = 3.0;
/** Last VO word lands on Hero; overlap into Hero Close. */
export const HERO_VO_OVERLAP_SEC = 0.6;
/** Floor Hero Close duration. */
export const MIN_HERO_CLOSE_SEC = 2.5;
/**
 * Preferred VO budget so total lands ~15 with Hero ≥ 2.5:
 * VO_MAX = 15 − 2.5 + 0.6 = 13.1
 */
export const VO_MAX_SEC =
  TARGET_DURATION_SEC - MIN_HERO_CLOSE_SEC + HERO_VO_OVERLAP_SEC;
/**
 * Absolute VO ceiling before Seedance: total would exceed 17.
 * VO_HARD = 17 − 2.5 + 0.6 = 15.1
 */
export const VO_HARD_MAX_SEC =
  DURATION_HARD_MAX_SEC - MIN_HERO_CLOSE_SEC + HERO_VO_OVERLAP_SEC;
/**
 * Preferred VO floor so Hero silence stays short:
 * VO_MIN ≈ 15 − 3.5 = 11.5 (Hero target ≤ ~3.5s).
 */
export const VO_MIN_SEC = 11.5;
/** Soft warn when VO is short and Hero Close stretches past this. */
const HERO_LONG_WARN_SEC = 3.6;
/** Fallback snap window to silence midpoints. */
const PAUSE_SNAP_SEC = 1.3;
/** Large pause used for sentence-boundary cuts. */
const LARGE_PAUSE_SEC = 0.4;

export type CompileAdSpecOptions = {
  /**
   * Optional beat shares (from whole-script apportionment).
   * Length must match beat count when provided.
   */
  beatDurations?: BeatVoiceover[];
  /** Brief used to pick best Hero Close product asset. */
  brief?: CreativeBrief;
  /** Silence midpoints from synthesizeVoice silencedetect. */
  pauses?: VoicePause[];
};

/** Projected compose total from VO (+ Hero floor). */
export function projectedAdDurationSec(voiceoverDurationSec: number): number {
  const heroStart = Math.max(0, voiceoverDurationSec - HERO_VO_OVERLAP_SEC);
  return Math.max(TARGET_DURATION_SEC, heroStart + MIN_HERO_CLOSE_SEC);
}

export function voForcesOutsideHardWindow(voiceoverDurationSec: number): boolean {
  const total = projectedAdDurationSec(voiceoverDurationSec);
  return total < DURATION_HARD_MIN_SEC - 1e-6 || total > DURATION_HARD_MAX_SEC + 1e-6;
}

function validateScriptForGeneration(script: Script): string[] {
  const errors: string[] = [];
  for (const [bi, beat] of script.beats.entries()) {
    const shots = beat.shots ?? [];
    if (shots.length < 1 || shots.length > 2) {
      errors.push(`beat[${bi}] must have 1–2 shots`);
    }
    for (const [si, shot] of shots.entries()) {
      if (!shot.intent?.trim() || !shot.action?.trim()) {
        errors.push(`beat[${bi}] shot[${si}] missing intent/action`);
      }
      if (
        shot.productRole === "hero" &&
        (!shot.assetIds || shot.assetIds.length === 0)
      ) {
        errors.push(
          `beat[${bi}] shot[${si}] productRole=hero requires assetIds`,
        );
      }
    }
  }
  return errors;
}

function assertNoImageCardLanguage(script: Script): void {
  const blob = JSON.stringify(script).toLowerCase();
  if (
    /source\s*[:=]\s*["']?asset["']?/.test(blob) ||
    /packshot[- ]hold|static full-?frame|crop\/fit listing/.test(blob)
  ) {
    throw new Error(
      "compileAdSpec preflight HARD: rectangular image card / static packshot language forbidden",
    );
  }
}

function normalizeToBudget(durations: number[], budget: number): number[] {
  const sum = durations.reduce((a, b) => a + b, 0) || 1;
  return durations.map((d) => (Math.max(0.1, d) / sum) * budget);
}

/**
 * Enforce min shot duration by borrowing from the longest beat, then merging
 * undersized beats into the neighbor (compile-local — does not re-expand).
 */
function enforceMinBeatDurations(
  inputDurations: number[],
  inputBeatIndices: number[],
  budget: number,
  warnings: string[],
): { durations: number[]; beatIndices: number[] } {
  let durations = normalizeToBudget(inputDurations, budget);
  let beatIndices = [...inputBeatIndices];

  for (let pass = 0; pass < durations.length * 2; pass++) {
    const shortIdx = durations.findIndex((d) => d < MIN_SHOT_SEC - 1e-6);
    if (shortIdx < 0) break;
    const need = MIN_SHOT_SEC - durations[shortIdx]!;
    let longest = -1;
    let longestVal = -1;
    for (let i = 0; i < durations.length; i++) {
      if (i === shortIdx) continue;
      const spare = durations[i]! - MIN_SHOT_SEC;
      if (spare > longestVal) {
        longestVal = spare;
        longest = i;
      }
    }
    if (longest < 0 || longestVal <= 0.05) break;
    const take = Math.min(need, longestVal);
    durations[shortIdx]! += take;
    durations[longest]! -= take;
  }

  while (true) {
    const shortIdx = durations.findIndex((d) => d < MIN_SHOT_SEC - 1e-6);
    if (shortIdx < 0 || durations.length <= 1) break;
    const mergeInto = shortIdx > 0 ? shortIdx - 1 : shortIdx + 1;
    if (mergeInto < 0 || mergeInto >= durations.length) break;
    warnings.push(
      `Merged short beat[${beatIndices[shortIdx]}] (${durations[shortIdx]!.toFixed(2)}s) into beat[${beatIndices[mergeInto]}]`,
    );
    durations[mergeInto]! += durations[shortIdx]!;
    durations.splice(shortIdx, 1);
    beatIndices.splice(shortIdx, 1);
  }

  durations = normalizeToBudget(durations, budget);
  return { durations, beatIndices };
}

/**
 * When 4-way split would leave shots < MIN_SHOT_SEC, collapse to ≤3 narrative
 * beats (reuse neighbor-merge). Keeps soft band 2–4 major scenes.
 */
function capNarrativeBeatCount(
  inputDurations: number[],
  inputBeatIndices: number[],
  budget: number,
  warnings: string[],
): { durations: number[]; beatIndices: number[] } {
  let durations = [...inputDurations];
  let beatIndices = [...inputBeatIndices];
  const maxByBudget = Math.max(
    SOFT_MIN_CINEMATIC_SCENES,
    Math.floor(budget / MIN_SHOT_SEC + 1e-9),
  );
  const targetCount = Math.min(
    beatIndices.length,
    SOFT_MAX_CINEMATIC_SCENES,
    maxByBudget,
  );
  while (durations.length > targetCount && durations.length > SOFT_MIN_CINEMATIC_SCENES) {
    let shortIdx = 0;
    for (let i = 1; i < durations.length; i++) {
      if (durations[i]! < durations[shortIdx]!) shortIdx = i;
    }
    const mergeInto = shortIdx > 0 ? shortIdx - 1 : shortIdx + 1;
    if (mergeInto < 0 || mergeInto >= durations.length) break;
    warnings.push(
      `Auto-merged beat[${beatIndices[shortIdx]}] into beat[${beatIndices[mergeInto]}] (cap narrative ≤${targetCount} for ≥${MIN_SHOT_SEC}s shots)`,
    );
    durations[mergeInto]! += durations[shortIdx]!;
    durations.splice(shortIdx, 1);
    beatIndices.splice(shortIdx, 1);
  }
  durations = normalizeToBudget(durations, budget);
  return { durations, beatIndices };
}

function countSentenceEnds(text: string): number {
  return (text.match(/[.!?:]/g) || []).length;
}

function snapBoundariesToPauses(
  boundaries: number[],
  pauses: VoicePause[],
  maxSec: number,
): number[] {
  if (!pauses.length || boundaries.length === 0) return boundaries;
  const mids = pauses
    .map((p) => (p.startSec + p.endSec) / 2)
    .filter((m) => m > 0.15 && m < maxSec - 0.15);
  if (!mids.length) return boundaries;

  return boundaries.map((b) => {
    let best = b;
    let bestDist = PAUSE_SNAP_SEC + 1;
    for (const m of mids) {
      const d = Math.abs(m - b);
      if (d <= PAUSE_SNAP_SEC && d < bestDist) {
        best = m;
        bestDist = d;
      }
    }
    return best;
  });
}

/**
 * Prefer the k-th ≥0.4s pause after cumulative sentence ends per beat.
 * Fallback: window snap (PAUSE_SNAP_SEC) with monotonic enforce.
 */
function snapBoundariesBySentencePauses(
  boundaries: number[],
  script: Script,
  beatIndices: number[],
  pauses: VoicePause[],
  maxSec: number,
): number[] {
  const largeMids = pauses
    .filter((p) => p.endSec - p.startSec >= LARGE_PAUSE_SEC - 1e-9)
    .map((p) => (p.startSec + p.endSec) / 2)
    .filter((m) => m > 0.15 && m < maxSec - 0.15)
    .sort((a, b) => a - b);

  if (largeMids.length < beatIndices.length - 1) {
    return snapBoundariesToPauses(boundaries, pauses, maxSec);
  }

  const out = [...boundaries];
  out[0] = 0;
  out[out.length - 1] = maxSec;
  let sentenceAcc = 0;
  let usedSentenceSnap = 0;
  for (let i = 0; i < beatIndices.length - 1; i++) {
    const beat = script.beats[beatIndices[i]!]!;
    const ends = Math.max(1, countSentenceEnds(beat.voiceover ?? ""));
    sentenceAcc += ends;
    const pauseIdx = sentenceAcc - 1;
    if (pauseIdx >= 0 && pauseIdx < largeMids.length) {
      out[i + 1] = largeMids[pauseIdx]!;
      usedSentenceSnap += 1;
    }
  }

  if (usedSentenceSnap < beatIndices.length - 1) {
    return snapBoundariesToPauses(boundaries, pauses, maxSec);
  }
  return out;
}

function enforceMonotonicBoundaries(
  snapped: number[],
  maxSec: number,
): number[] {
  const out = [...snapped];
  out[0] = 0;
  out[out.length - 1] = maxSec;
  for (let i = 1; i < out.length; i++) {
    if (out[i]! <= out[i - 1]!) {
      out[i] = Math.min(maxSec, out[i - 1]! + MIN_SHOT_SEC * 0.5);
    }
  }
  out[out.length - 1] = maxSec;
  return out;
}

/**
 * Compile Script → AdSpec from whole-script TTS duration.
 * Guarantees a final Hero Close scene with real product asset id.
 * total = max(15, heroStart + 2.5); hard fail if projected total > 17.
 */
export function compileAdSpec(
  script: Script,
  voiceoverDurationSec: number,
  opts: CompileAdSpecOptions = {},
): CompileAdSpecResult {
  const warnings: string[] = [];
  const preflight = validateScriptForGeneration(script);
  if (preflight.length) {
    throw new Error(
      `compileAdSpec preflight: ${preflight.join("; ")} — image asset must never be a static full-frame scene`,
    );
  }
  assertNoImageCardLanguage(script);

  if (!(voiceoverDurationSec > 0) || !Number.isFinite(voiceoverDurationSec)) {
    throw new Error("compileAdSpec requires positive voiceoverDurationSec");
  }

  if (voiceoverDurationSec > VO_HARD_MAX_SEC + 1e-6) {
    throw new Error(
      `TTS duration ${voiceoverDurationSec.toFixed(2)}s overruns hard VO budget ${VO_HARD_MAX_SEC.toFixed(1)}s (would force ad > ${DURATION_HARD_MAX_SEC}s)`,
    );
  }
  if (voiceoverDurationSec > VO_MAX_SEC + OVERRUN_WARN_SEC) {
    warnings.push(
      `TTS duration ${voiceoverDurationSec.toFixed(2)}s overruns preferred VO budget ${VO_MAX_SEC.toFixed(1)}s — soft warning`,
    );
  } else if (voiceoverDurationSec > VO_MAX_SEC) {
    warnings.push(
      `TTS duration ${voiceoverDurationSec.toFixed(2)}s slightly over preferred ${VO_MAX_SEC.toFixed(1)}s — soft warning`,
    );
  }

  const beatCount = script.beats.length;
  let rawBeatDurations: number[];
  if (opts.beatDurations && opts.beatDurations.length === beatCount) {
    rawBeatDurations = opts.beatDurations.map((b) =>
      Math.max(0.1, b.durationSec),
    );
  } else {
    rawBeatDurations = apportionBeatDurations(script, voiceoverDurationSec);
  }

  let total = projectedAdDurationSec(voiceoverDurationSec);
  if (total > DURATION_HARD_MAX_SEC + 1e-6) {
    throw new Error(
      `Projected ad duration ${total.toFixed(2)}s outside hard ${DURATION_HARD_MIN_SEC}–${DURATION_HARD_MAX_SEC}s window`,
    );
  }
  let heroStart = Math.max(0, voiceoverDurationSec - HERO_VO_OVERLAP_SEC);
  let heroEnd = total;
  if (heroEnd - heroStart < MIN_HERO_CLOSE_SEC) {
    heroEnd = heroStart + MIN_HERO_CLOSE_SEC;
    total = heroEnd;
  }
  const cinematicBudget = Math.max(MIN_SHOT_SEC, heroStart);
  const heroDur = heroEnd - heroStart;
  if (heroDur > HERO_LONG_WARN_SEC) {
    warnings.push(
      `VO short for 15s — Hero Close ${heroDur.toFixed(2)}s > ${HERO_LONG_WARN_SEC}s`,
    );
  }

  let durations = normalizeToBudget(rawBeatDurations, cinematicBudget);
  let beatIndices = script.beats.map((_, i) => i);

  let boundaries = [0];
  let acc = 0;
  for (const d of durations) {
    acc += d;
    boundaries.push(acc);
  }
  let snapped = snapBoundariesBySentencePauses(
    boundaries,
    script,
    beatIndices,
    opts.pauses ?? [],
    cinematicBudget,
  );
  snapped = enforceMonotonicBoundaries(snapped, cinematicBudget);
  durations = [];
  for (let i = 0; i < snapped.length - 1; i++) {
    durations.push(Math.max(0.1, snapped[i + 1]! - snapped[i]!));
  }

  ({ durations, beatIndices } = capNarrativeBeatCount(
    durations,
    beatIndices,
    cinematicBudget,
    warnings,
  ));
  ({ durations, beatIndices } = enforceMinBeatDurations(
    durations,
    beatIndices,
    cinematicBudget,
    warnings,
  ));

  const finalBounds = [0];
  acc = 0;
  for (const d of durations) {
    acc += d;
    finalBounds.push(acc);
  }
  finalBounds[finalBounds.length - 1] = cinematicBudget;

  const scenes: SceneSpec[] = [];
  let sceneOrdinal = 0;
  for (const [di, bi] of beatIndices.entries()) {
    const beat = script.beats[bi]!;
    let shots = beat.shots;
    const beatStart = finalBounds[di]!;
    const beatEnd = finalBounds[di + 1]!;
    const beatLen = Math.max(0.1, beatEnd - beatStart);
    if (shots.length === 2 && beatLen < 2 * MIN_SHOT_SEC) {
      warnings.push(
        `Collapsed dual-shot beat[${bi}] (${beatLen.toFixed(2)}s < ${2 * MIN_SHOT_SEC}s) to 1 shot`,
      );
      shots = [shots[0]!];
    }
    const shares = shots.length === 1 ? [1] : [0.5, 0.5];
    let beatCursor = 0;
    for (const [si, shot] of shots.entries()) {
      const len =
        si === shots.length - 1
          ? Math.max(0.1, beatLen - beatCursor)
          : Math.max(0.1, beatLen * shares[si]!);
      const start = beatStart + beatCursor;
      const end = start + len;
      beatCursor += len;
      sceneOrdinal += 1;
      scenes.push({
        id: `scene_${String(sceneOrdinal).padStart(2, "0")}`,
        start: round3(start),
        end: round3(end),
        beatIndex: bi,
        shotIndex: si,
        intent: shot.intent,
        action: shot.action,
        treatment: shot.treatment,
        productRole: shot.productRole,
        assetIds: [...shot.assetIds],
        voiceover: beat.voiceover,
        ...(beat.text ? { text: beat.text } : {}),
        ...(beat.factIds?.length ? { factIds: [...beat.factIds] } : {}),
        ...(shot.entry ? { entry: shot.entry } : {}),
        ...(shot.exit ? { exit: shot.exit } : {}),
        productRequired: shot.productRole !== "none",
        isHeroClose: false,
      });
    }
  }

  if (scenes.length > SOFT_MAX_CINEMATIC_SCENES) {
    warnings.push(
      `Cinematic scene count ${scenes.length} soft-exceeds ~${SOFT_MAX_CINEMATIC_SCENES} (prefer 2–4 + Hero) — kept`,
    );
  } else if (scenes.length < SOFT_MIN_CINEMATIC_SCENES) {
    warnings.push(
      `Cinematic scene count ${scenes.length} soft-below ~${SOFT_MIN_CINEMATIC_SCENES} (prefer 2–4 + Hero) — kept`,
    );
  }

  const preferredHeroIds = [
    ...new Set(
      scenes
        .filter((s) => s.productRole === "hero" || s.productRole === "element")
        .flatMap((s) => s.assetIds),
    ),
  ];
  const heroAssetId = opts.brief
    ? pickBestReferenceAssetId(opts.brief, preferredHeroIds, {
        forRole: "hero",
      })
    : preferredHeroIds[0] ??
      scenes.find((s) => s.assetIds.length)?.assetIds[0];

  if (!heroAssetId) {
    throw new Error(
      "compileAdSpec HARD: Hero Close requires a resolvable product assetId",
    );
  }

  sceneOrdinal += 1;
  scenes.push({
    id: `scene_${String(sceneOrdinal).padStart(2, "0")}`,
    start: round3(heroStart),
    end: round3(heroEnd),
    beatIndex: Math.max(0, beatCount - 1),
    shotIndex: 99,
    intent: "Hero Close brand lockup",
    action:
      "Exact product pouch already standing still, front label facing camera, static product, only light moves",
    treatment: "composite",
    productRole: "hero",
    assetIds: [heroAssetId],
    entry: "Match energy from prior shot into calm product hold",
    exit: "Hold brand presence to end",
    productRequired: true,
    isHeroClose: true,
  });

  const hasProduct = scenes.some((s) => s.productRole !== "none");
  if (!hasProduct) {
    warnings.push("No product exposure shot — soft warning");
  }

  return {
    adSpec: {
      id: `ad_${script.id}`,
      creativeId: script.creativeId,
      scenes,
      ...(script.visualDirection
        ? { visualDirection: script.visualDirection }
        : {}),
      ...(script.audioDirection
        ? { audioDirection: script.audioDirection }
        : {}),
    },
    warnings,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
