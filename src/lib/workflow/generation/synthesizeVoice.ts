/**
 * Helper (not a stage): whole-script TTS — one OpenSpeech performance.
 * Beat shares are word/punctuation weights for timeline only (no per-beat concat).
 * After TTS, ffmpeg silencedetect yields pause midpoints for compile cut snapping.
 */

import { existsSync } from "node:fs";
import type {
  TtsSynthesizeOptions,
  TtsSynthesizeResult,
} from "@/lib/ai/providers/volcengine-tts";
import { synthesizeSpeech } from "@/lib/ai/providers/volcengine-tts";
import { hasFfmpeg, runFfmpeg } from "@/lib/media/ffmpeg";
import type { AudioDirection, Script } from "@/lib/workflow/creative/v2/types";
import { countWords } from "@/lib/workflow/creative/v2/expandScript";

export type BeatVoiceover = {
  beatIndex: number;
  text: string;
  /** Same whole-script audio for all beats on the live path. */
  audioUrl: string;
  /** Apportioned duration share (not a separate TTS segment). */
  durationSec: number;
  wordCount: number;
  latencyMs: number;
  model: string;
};

export type VoicePause = {
  startSec: number;
  endSec: number;
};

export type SynthesizeVoiceResult = TtsSynthesizeResult & {
  text: string;
  wordCount: number;
  beats: BeatVoiceover[];
  /** Always whole-script on live path. */
  mode: "whole-script";
  transport?: "websocket" | "http";
  /** Silence regions from ffmpeg silencedetect (for compile cut snap). */
  pauses: VoicePause[];
};

export type SynthesizeVoiceOptions = TtsSynthesizeOptions & {
  audioDirection?: AudioDirection;
};

export function scriptFullVoiceover(script: Script): string {
  return script.beats
    .map((b) => b.voiceover.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Weight beats by words + light punctuation pause budget for timeline share.
 * Used by compileAdSpec — not a second TTS pass.
 */
export function beatTimingWeights(script: Script): number[] {
  return script.beats.map((b) => {
    const text = (b.voiceover ?? "").trim();
    const words = Math.max(1, countWords(text));
    const pauses = (text.match(/[,.;:!?…]/g) || []).length;
    return words + pauses * 0.35;
  });
}

export function apportionBeatDurations(
  script: Script,
  totalDurationSec: number,
): number[] {
  const weights = beatTimingWeights(script);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return weights.map((w) => (w / sum) * totalDurationSec);
}

/**
 * Detect silence pauses in a local audio file (noise=-35dB, d=0.18s).
 * Returns [] when ffmpeg missing or path is remote/unreadable.
 */
export function detectVoicePauses(audioPath: string): VoicePause[] {
  if (!audioPath || /^https?:\/\//i.test(audioPath)) return [];
  if (!existsSync(audioPath)) return [];
  if (!hasFfmpeg()) return [];

  const run = runFfmpeg([
    "-i",
    audioPath,
    "-af",
    "silencedetect=noise=-35dB:d=0.18",
    "-f",
    "null",
    "-",
  ]);
  const log = `${run.stderr || ""}\n${run.stdout || ""}`;
  const pauses: VoicePause[] = [];
  let start: number | null = null;
  for (const line of log.split("\n")) {
    const s = line.match(/silence_start:\s*([0-9.]+)/);
    if (s) {
      start = Number.parseFloat(s[1]!);
      continue;
    }
    const e = line.match(/silence_end:\s*([0-9.]+)/);
    if (e && start !== null) {
      const end = Number.parseFloat(e[1]!);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        pauses.push({ startSec: start, endSec: end });
      }
      start = null;
    }
  }
  return pauses;
}

/**
 * One continuous TTS call for the full script copy.
 * No per-beat concat / announcer splice.
 */
export async function synthesizeVoice(
  script: Script,
  opts: SynthesizeVoiceOptions = {},
): Promise<SynthesizeVoiceResult> {
  const text = scriptFullVoiceover(script);
  if (!text.trim()) {
    throw new Error("Script has empty voiceover — cannot synthesize TTS");
  }

  for (const [i, beat] of script.beats.entries()) {
    if (!(beat.voiceover ?? "").trim()) {
      throw new Error(
        `Script beat[${i}] has empty voiceover — cannot synthesize TTS`,
      );
    }
  }

  const audioDirection =
    opts.audioDirection ?? script.audioDirection ?? undefined;
  const voiceStyle = opts.voiceStyle ?? audioDirection?.voiceStyle;

  const result = await synthesizeSpeech(text, {
    ...opts,
    ...(voiceStyle ? { voiceStyle } : {}),
  });

  const shares = apportionBeatDurations(script, result.durationSec);
  const beats: BeatVoiceover[] = script.beats.map((b, i) => ({
    beatIndex: i,
    text: b.voiceover.trim(),
    audioUrl: result.audioUrl,
    durationSec: Math.max(0.1, shares[i] ?? 0.1),
    wordCount: countWords(b.voiceover),
    latencyMs: result.latencyMs,
    model: result.model,
  }));

  const pauses = detectVoicePauses(result.audioUrl);

  return {
    audioUrl: result.audioUrl,
    durationSec: result.durationSec,
    model: result.model,
    latencyMs: result.latencyMs,
    transport: result.transport,
    text,
    wordCount: countWords(text),
    beats,
    mode: "whole-script",
    pauses,
  };
}
